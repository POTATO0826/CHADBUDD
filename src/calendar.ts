/**
 * Where the day comes from.
 *
 * The schedule is currently a hand-written file. It will be Google Calendar.
 * Neither the day page nor the next-up tile should have to know which, so both
 * sit behind this interface — the same instinct bridge/types.ts already applies
 * to chat platforms, where nothing downstream knows whether a message arrived
 * over Telegram or anywhere else.
 *
 * ── what a live source has to answer ─────────────────────────────────
 * Only four things, and they are deliberately few. A calendar API can tell you
 * a great deal; the product needs the day, the ability to put something on it,
 * the ability to move something, and a way to know whether a booking is real
 * yet. Everything else is somebody else's feature.
 *
 * ── tentative is a first-class state, not a flag ─────────────────────
 * When the assistant reads "Thursday 4pm works" in a thread and books it, it is
 * guessing. Guessing is allowed here because Google has a status for exactly
 * this and because the failure is visible and reversible: a tentative block the
 * advisor deletes costs a tap, where a missed booking costs a meeting. What is
 * not allowed is a *confirmed* event nobody agreed to, or a message to the
 * client saying it is booked — see src/presence.ts for where that line sits.
 */

import type { ClientKey } from "../data/types.ts";
import type { ScheduleSlot } from "../data/schedule.ts";
import { schedule } from "../data/schedule.ts";

/** Whether a booking is real yet. Mirrors Google's own event status. */
export type Booking = "confirmed" | "tentative" | "cancelled";

export interface CalendarEvent extends ScheduleSlot {
  booking: Booking;
  /** Set when the assistant created this from a message rather than a person. */
  inferredFrom?: { source: "telegram" | "email"; cite: string };
  /** Whether this can be moved without asking anyone else. */
  movable: boolean;
}

/**
 * The contract a live calendar has to satisfy.
 *
 * Async by design even though the seed answers instantly: a Google-backed
 * implementation cannot be synchronous, and discovering that at integration
 * time would mean changing every call site.
 */
export interface CalendarSource {
  /** The day containing `dayMs`, in start order. */
  day(dayMs: number): Promise<CalendarEvent[]>;
  /** Everything from now to `untilMs`, for the maturity and conflict views. */
  upcoming(untilMs: number): Promise<CalendarEvent[]>;
  /** Put something on the calendar. Tentative unless a person confirmed it. */
  create(event: Omit<CalendarEvent, "id">): Promise<CalendarEvent>;
  /** Move an existing event. Returns the moved copy. */
  move(id: string, startMs: number): Promise<CalendarEvent>;
  /** Promote a tentative booking, or drop it. */
  settle(id: string, booking: Booking): Promise<CalendarEvent>;
}

const ts = (iso: string): number => Date.parse(iso);
const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * The seeded calendar.
 *
 * Holds the hand-written day in memory and lets it be mutated, so overruns and
 * tentative bookings behave exactly as they will against Google — the engine
 * above cannot tell the difference, which is the point of writing it this way
 * before the OAuth exists.
 */
export function seedCalendar(): CalendarSource {
  let events: CalendarEvent[] = schedule.map((s) => ({
    ...s,
    booking: "confirmed" as Booking,
    // Own time can be shuffled freely; anything with another person in it
    // cannot be moved without telling them, which is a decision, not a write.
    movable: s.kind === "focus" || s.kind === "admin" || s.kind === "break",
  }));

  let minted = 0;
  const sameDay = (a: number, b: number): boolean =>
    new Date(a).toDateString() === new Date(b).toDateString();

  return {
    async day(dayMs) {
      return events
        .filter((e) => e.booking !== "cancelled" && sameDay(ts(e.at), dayMs))
        .sort((a, b) => ts(a.at) - ts(b.at));
    },

    async upcoming(untilMs) {
      return events
        .filter((e) => e.booking !== "cancelled" && ts(e.at) <= untilMs)
        .sort((a, b) => ts(a.at) - ts(b.at));
    },

    async create(event) {
      minted += 1;
      const made: CalendarEvent = { ...event, id: `E-${String(minted).padStart(3, "0")}` };
      events = [...events, made];
      return made;
    },

    async move(id, startMs) {
      let moved: CalendarEvent | undefined;
      events = events.map((e) => {
        if (e.id !== id) return e;
        moved = { ...e, at: iso(startMs) };
        return moved;
      });
      if (!moved) throw new Error(`No event ${id}`);
      return moved;
    },

    async settle(id, booking) {
      let settled: CalendarEvent | undefined;
      events = events.map((e) => {
        if (e.id !== id) return e;
        settled = { ...e, booking };
        return settled;
      });
      if (!settled) throw new Error(`No event ${id}`);
      return settled;
    },
  };
}

/**
 * A time somebody agreed to, spotted in a thread.
 *
 * Deliberately conservative: an explicit weekday and clock time, both present
 * in one message, alongside a word that reads as assent. "Thursday 4pm works"
 * qualifies; "sometime Thursday?" does not, and neither does "4pm" on its own.
 *
 * It will still be wrong sometimes. That is survivable only because what it
 * produces is a tentative block the advisor can delete — the moment this starts
 * confirming events or telling the client it is booked, the error stops being
 * cheap.
 */
export interface AgreedTime {
  client: ClientKey;
  cite: string;
  at: string;
  minutes: number;
  phrase: string;
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ASSENT = ["works", "sounds good", "see you", "confirmed", "ok then", "perfect", "that's fine", "deal"];

export function findAgreedTime(
  client: ClientKey,
  cite: string,
  text: string,
  fromMs: number,
): AgreedTime | null {
  const s = text.toLowerCase();
  if (!ASSENT.some((a) => s.includes(a))) return null;

  const day = DAYS.findIndex((d) => s.includes(d));
  if (day < 0) return null;

  const time = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/.exec(s);
  if (!time) return null;

  let hour = Number(time[1]);
  const mins = Number(time[2] ?? 0);
  if (time[3] === "pm" && hour < 12) hour += 12;
  if (time[3] === "am" && hour === 12) hour = 0;

  // The next occurrence of that weekday, counting today only if it is ahead.
  const base = new Date(fromMs);
  const ahead = (day - base.getDay() + 7) % 7;
  const when = new Date(base);
  when.setDate(base.getDate() + ahead);
  when.setHours(hour, mins, 0, 0);
  if (when.getTime() <= fromMs) when.setDate(when.getDate() + 7);

  return {
    client,
    cite,
    at: when.toISOString(),
    minutes: 45,
    phrase: text.trim(),
  };
}
