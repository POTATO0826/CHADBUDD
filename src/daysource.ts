/**
 * The day, from whichever calendar is behind the interface.
 *
 * A thin cache between the renderer and `CalendarSource`. It exists because the
 * source is async by design — a Google-backed implementation cannot be
 * anything else — while `render()` builds markup as a synchronous string. Rather
 * than make every caller await, the day is fetched once, held, and refreshed
 * when something changes it.
 *
 * That also keeps the seam honest: swapping `seedCalendar()` for a Google
 * implementation changes this file and nothing else.
 */

import { NOW } from "../data/clock.ts";
import type { CalendarEvent, CalendarSource } from "./calendar.ts";
import { seedCalendar } from "./calendar.ts";

let source: CalendarSource = seedCalendar();
let today: CalendarEvent[] = [];
let month: CalendarEvent[] = [];
let monthAnchor = 0;

/** The clock the day is measured against. Live once the clock is live. */
export function nowMs(): number {
  return NOW;
}

/** Today's events, as last fetched. Empty until refreshCalendar has run once. */
export function calendarDay(): CalendarEvent[] {
  return today;
}

/** Re-read the day. Called at boot and after anything that changes it. */
export async function refreshCalendar(): Promise<void> {
  today = await source.day(nowMs());
  // The month view reads the same cache, so a booking made anywhere has to
  // reach it too — otherwise a new block appears on the day page and the month
  // grid keeps showing the old count until something else happens to refetch.
  if (monthAnchor !== 0) await refreshMonth(monthAnchor);
}

/** Everything in the month last fetched, in start order. */
export function calendarMonth(): CalendarEvent[] {
  return month;
}

/**
 * Fetch a whole month.
 *
 * `upcoming` answers "everything up to this point", so the month is the tail of
 * that. Wasteful in principle, exactly right in practice: the Convex mirror
 * only holds the sync window either side of now, so the set being filtered is
 * already bounded by how much of the calendar was ever asked for.
 */
export async function refreshMonth(anchorMs: number): Promise<void> {
  const start = new Date(anchorMs);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  monthAnchor = start.getTime();
  const all = await source.upcoming(end.getTime());
  month = all
    .filter((e) => {
      const t = Date.parse(e.at);
      return t >= start.getTime() && t < end.getTime();
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * Swap the calendar behind the app.
 *
 * The only function a Google integration needs to call. Everything downstream —
 * the day page, the next-up tile, the overrun ladder, the conflict sweep —
 * reads through `calendarDay()` and never learns which source answered.
 */
export function useCalendar(next: CalendarSource): void {
  source = next;
}

export function calendarSource(): CalendarSource {
  return source;
}
