/**
 * The calendar, backed by Convex.
 *
 * The other half of the seam `src/daysource.ts` describes: `seedCalendar()`
 * reads a hand-written file, this reads the `events` table that
 * `convex/calendar.ts` mirrors from Google. Nothing downstream — the day page,
 * the next-up tile, the overrun ladder, the conflict sweep — can tell which one
 * answered, which is the property the whole design was arranged around.
 *
 * ── reads go to the mirror, writes go to Google ──────────────────────
 * `day` and `upcoming` read Convex rows, so a render never waits on Google and
 * never breaks when Google is slow. `create`, `move` and `settle` call actions
 * that hit Google first and mirror the result, because the calendar on the
 * advisor's phone is the real one — a write that only landed here would be a
 * meeting they never see.
 *
 * ── what a Google event does not carry ───────────────────────────────
 * `purpose`, `cites` and `prep` come back empty for anything created outside
 * this app, and they stay empty. The seeded day has a traceable reason for
 * every meeting because someone wrote one; an event dragged into Google
 * Calendar on a phone has a title and nothing else, and inventing a purpose for
 * it would put unattributed prose in the one place this product promises is
 * always traceable. An empty purpose renders as no purpose, which is true.
 */

import { anyApi } from "convex/server";
import type { ConvexClient } from "convex/browser";
import type { FunctionReference } from "convex/server";

import type { ClientKey } from "../data/types.ts";
import type { SlotKind } from "../data/schedule.ts";
import type { Booking, CalendarEvent, CalendarSource, Importance } from "./calendar.ts";
import { useCalendar } from "./daysource.ts";
import { convexClient } from "./live.ts";

const lookup = anyApi as unknown as Record<string, Record<string, unknown>>;
const q = (m: string, n: string): FunctionReference<"query"> =>
  lookup[m]?.[n] as FunctionReference<"query">;
const act = (m: string, n: string): FunctionReference<"action"> =>
  lookup[m]?.[n] as FunctionReference<"action">;

/** How far ahead the subscription and the re-reads look. */
const HORIZON_MS = 90 * 86_400_000;

/** A row of the `events` table, as it arrives over the wire. */
interface EventRow {
  _id: string;
  googleId?: string;
  title: string;
  startsAt: number;
  minutes: number;
  kind: string;
  where: string;
  booking: Booking;
  clientKey?: string;
  withName?: string;
  inferredSource?: string;
  inferredCite?: string;
  conferenceUrl?: string;
  importance?: string;
  prepUser?: string;
  prepAi?: string;
}

const KINDS: ReadonlySet<string> = new Set(["meeting", "call", "travel", "break", "focus", "admin"]);

/**
 * A Google row, as the interface sees it.
 *
 * `kind` is checked against the known set rather than cast, because it can
 * arrive from an event this app never created. An unknown value falling back to
 * "meeting" is the safe direction: a meeting is the kind everything downstream
 * treats most carefully, so a mislabelled block gets more caution than it
 * needs rather than less than it should.
 */
function toEvent(r: EventRow): CalendarEvent {
  const kind = (KINDS.has(r.kind) ? r.kind : "meeting") as SlotKind;

  return {
    // googleId is the id wherever it exists, so an overrun recorded against a
    // block survives the row being rewritten by the next sync.
    id: r.googleId ?? r._id,
    kind,
    title: r.title,
    at: new Date(r.startsAt).toISOString(),
    minutes: r.minutes,
    ...(r.clientKey ? { withClient: r.clientKey as ClientKey } : {}),
    ...(r.withName ? { withName: r.withName } : {}),
    where: r.where || (r.conferenceUrl ? "Online" : ""),
    // Deliberately empty. See the header.
    purpose: "",
    cites: [],
    prep: [],
    booking: r.booking,
    ...(r.importance ? { importance: r.importance as Importance } : {}),
    ...(r.prepUser ? { prepUser: r.prepUser } : {}),
    ...(r.prepAi ? { prepAi: r.prepAi.split("\n").filter(Boolean) } : {}),
    ...(r.inferredSource && r.inferredCite
      ? {
          inferredFrom: {
            source: r.inferredSource === "email" ? ("email" as const) : ("telegram" as const),
            cite: r.inferredCite,
          },
        }
      : {}),
    // Same rule as the seed: own time can be shuffled, anything with another
    // person in it cannot be moved without telling them.
    movable: kind === "focus" || kind === "admin" || kind === "break",
  };
}

export function convexCalendar(client: ConvexClient): CalendarSource {
  /**
   * Everything seen since the last read, keyed by the id the interface uses.
   *
   * `move` and `settle` are handed an id and need the Google id and the
   * duration to send with it. Holding the last-read rows is cheaper and less
   * fragile than a round trip to look up something that was just rendered.
   */
  const known = new Map<string, EventRow>();

  const remember = (rows: EventRow[]): CalendarEvent[] => {
    for (const r of rows) known.set(r.googleId ?? r._id, r);
    return rows
      .filter((r) => r.booking !== "cancelled")
      .map(toEvent)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  };

  const rowFor = (id: string): EventRow => {
    const r = known.get(id);
    if (!r) throw new Error(`No event ${id}`);
    if (!r.googleId) throw new Error(`Event ${id} has not synced to Google yet`);
    return r;
  };

  /** Re-read one event after a write, so the caller gets what Google stored. */
  const reread = async (id: string): Promise<CalendarEvent> => {
    const rows = (await client.query(q("calendar", "upcoming"), {
      untilMs: Date.now() + HORIZON_MS,
    })) as EventRow[];
    remember(rows);
    const found = rows.find((r) => (r.googleId ?? r._id) === id);
    if (!found) throw new Error(`Event ${id} vanished after the write`);
    return toEvent(found);
  };

  return {
    async day(dayMs) {
      return remember((await client.query(q("calendar", "day"), { dayMs })) as EventRow[]);
    },

    async upcoming(untilMs) {
      return remember((await client.query(q("calendar", "upcoming"), { untilMs })) as EventRow[]);
    },

    async create(event) {
      const googleId = (await client.action(act("calendar", "createEvent"), {
        title: event.title,
        startsAt: Date.parse(event.at),
        minutes: event.minutes,
        kind: event.kind,
        where: event.where,
        ...(event.withClient ? { clientKey: event.withClient } : {}),
        /* Whether a person confirmed this is the caller's fact, not a default
           to be guessed at here: `booking` is exactly what the agreed-time
           reader sets to "tentative" when it books from something it read. */
        tentative: event.booking !== "confirmed",
        ...(event.inferredFrom ? { inferredCite: event.inferredFrom.cite } : {}),
      })) as string;

      return reread(googleId);
    },

    async move(id, startMs) {
      const r = rowFor(id);
      await client.action(act("calendar", "moveEvent"), {
        googleId: r.googleId,
        startsAt: startMs,
        minutes: r.minutes,
      });
      return reread(id);
    },

    async settle(id, booking) {
      const r = rowFor(id);
      await client.action(act("calendar", "settleEvent"), {
        googleId: r.googleId,
        booking,
      });
      // A cancelled event is removed from the mirror, so there is nothing left
      // to re-read — the local row, marked, is the honest answer.
      if (booking === "cancelled") return { ...toEvent(r), booking };
      return reread(id);
    },

    async annotate(id, patch) {
      const r = rowFor(id);
      await client.action(act("calendar", "annotateEvent"), {
        googleId: r.googleId,
        ...(patch.importance ? { importance: patch.importance } : {}),
        ...(patch.prepUser !== undefined ? { prepUser: patch.prepUser } : {}),
      });
      return reread(id);
    },
  };
}

/**
 * Point the app at Convex's calendar, if there is one to point at.
 *
 * Returns false when live mode is off or the client never connected, and the
 * seeded day stays exactly as it was — the same failure posture as the rest of
 * live.ts, where a backend that is down must not take the interface with it.
 *
 * `onChange` fires whenever the mirror changes, which is what makes a meeting
 * booked on a phone appear here without anyone pressing refresh. The
 * subscription is on `upcoming` rather than `day` because a change to
 * tomorrow's schedule still matters to the conflict sweep, and one subscription
 * covers both.
 */
export function connectCalendar(onChange: () => void): boolean {
  const client = convexClient();
  if (!client) return false;

  useCalendar(convexCalendar(client));

  client.onUpdate(q("calendar", "upcoming"), { untilMs: Date.now() + HORIZON_MS }, () => {
    onChange();
  });

  return true;
}

/** Where to send the advisor to grant access. Null when live mode is off. */
export async function calendarAuthUrl(): Promise<string | null> {
  const client = convexClient();
  if (!client) return null;
  return (await client.action(act("calendar", "authUrl"), {})) as string;
}

/** Whether an account is connected. Null when there is no backend to ask. */
export async function calendarConnected(): Promise<boolean | null> {
  const client = convexClient();
  if (!client) return null;
  const res = (await client.query(q("calendar", "connected"), {})) as { connected: boolean };
  return res.connected;
}
