/**
 * The day, derived.
 *
 * Turns data/schedule.ts into what the dashboard shows: what is happening now,
 * what is next, how long until it starts, and — for a slot with a client on the
 * other side — what that relationship's state actually is when you walk in.
 *
 * ── the same gate as everything else ─────────────────────────────────
 * A slot's `cites` are run through the ledger's own `findVerbatim`, so a
 * meeting cannot claim a reason that no message supports. Ids that do not
 * resolve are dropped and counted in `discardedCites`, never rendered with a
 * caveat — the same rule the ledger applies to a promise.
 *
 * ── measured, not invented ───────────────────────────────────────────
 * Countdowns come from the fixed NOW in data/clock.ts, the same clock every
 * other window in the product measures from. The day does not move, so neither
 * does "in 1h 15m" — which is the point: the number on screen is reproducible
 * rather than a live tick that makes the build unverifiable.
 */

import { NOW } from "../data/clock.ts";
import type { ScheduleSlot, SlotKind } from "../data/schedule.ts";
import { BIG, schedule } from "../data/schedule.ts";
import { findVerbatim } from "./ledger.ts";

const MIN = 60_000;

export interface AgendaSlot extends ScheduleSlot {
  start: number;
  end: number;
  /** Only the ids that resolve to a real message. */
  cites: string[];
  /** Minutes from NOW to the start. Negative once it has begun. */
  inMinutes: number;
  past: boolean;
  live: boolean;
  /** "09:45", in the advisor's timezone. */
  clock: string;
}

const hhmm = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kuala_Lumpur",
});

/**
 * "in 1h 15m" / "in 12 min" / "now" / "2h ago".
 *
 * Minutes below an hour rather than a decimal fraction, because a person
 * leaving for a meeting reads minutes and does not read 1.25h.
 */
export function untilText(minutes: number): string {
  const m = Math.round(minutes);
  if (m === 0) return "now";
  const a = Math.abs(m);
  const body = a < 60 ? `${a} min` : a % 60 === 0 ? `${a / 60}h` : `${Math.floor(a / 60)}h ${a % 60}m`;
  return m > 0 ? `in ${body}` : `${body} ago`;
}

/** The word for a kind, where the UI wants one. */
export const KIND_LABEL: Record<SlotKind, string> = {
  meeting: "meeting",
  call: "call",
  travel: "travel",
  break: "break",
  focus: "focus",
  admin: "admin",
};

let discarded = 0;

const built: AgendaSlot[] = schedule
  .map((s) => {
    const start = Date.parse(s.at);
    if (Number.isNaN(start)) throw new Error(`Unparseable time on ${s.id}: ${s.at}`);
    const end = start + s.minutes * MIN;

    // The gate. A reason that cannot be traced is not shown as a weaker reason.
    const cites = s.cites.filter((id) => {
      const ok = findVerbatim(id, "") !== null;
      if (!ok) discarded++;
      return ok;
    });

    return {
      ...s,
      cites,
      start,
      end,
      inMinutes: (start - NOW) / MIN,
      past: end <= NOW,
      live: start <= NOW && NOW < end,
      clock: hhmm.format(start),
    };
  })
  .sort((a, b) => a.start - b.start);

export const agenda: AgendaSlot[] = built;

/** Citations dropped because no such message exists. Surfaced, never hidden. */
export const discardedCites = discarded;

/** What the advisor is inside right now — a meeting, or the lunch break. */
export const happeningNow: AgendaSlot | null = built.find((s) => s.live) ?? null;

/**
 * The next real commitment.
 *
 * Travel and breaks are deliberately skipped: "next up: drive to Bangsar" is
 * true and useless. What the advisor needs from across the room is the next
 * thing a person is waiting for them at.
 */
export const nextUp: AgendaSlot | null =
  built.find((s) => BIG.has(s.kind) && s.start > NOW) ?? null;

/**
 * Every real commitment of the day, past and future, in order.
 *
 * This is what the dashboard tile steps through. Travel and breaks are left
 * out for the same reason they are skipped by nextUp: they are the connective
 * tissue of the day, not the things someone is waiting for you at.
 */
export const bigSlots: AgendaSlot[] = built.filter((s) => BIG.has(s.kind));

/** Where nextUp sits in bigSlots, or the last one once the day is done. */
export const nextUpIndex: number = (() => {
  const i = bigSlots.findIndex((s) => s.start > NOW);
  return i === -1 ? Math.max(0, bigSlots.length - 1) : i;
})();

/** Everything still ahead, in order. */
export const remaining: AgendaSlot[] = built.filter((s) => !s.past);

export const dayTotals = {
  meetings: built.filter((s) => s.kind === "meeting" || s.kind === "call").length,
  travelMinutes: built.filter((s) => s.kind === "travel").reduce((n, s) => n + s.minutes, 0),
  breakMinutes: built.filter((s) => s.kind === "break").reduce((n, s) => n + s.minutes, 0),
  /** Slots left today, including travel and breaks. */
  left: remaining.length,
};

/** Look one up by id, for the detail panel. */
export function slotById(id: string): AgendaSlot | null {
  return built.find((s) => s.id === id) ?? null;
}
