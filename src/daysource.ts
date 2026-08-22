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
let week: CalendarEvent[] = [];
let weekAnchor = 0;

/** The clock the day is measured against. Live once the clock is live. */
export function nowMs(): number {
  return NOW;
}

/**
 * Hidden for now, per the advisor: the recurring Google "Focus time" blocks
 * paint every single day and drown the meetings the calendar exists to
 * show. Display-level only — the busy/presence logic still sees them.
 */
function shown(list: CalendarEvent[]): CalendarEvent[] {
  return list.filter((ev) => !/focus time/i.test(ev.title));
}

/** Today's events, as last fetched. Empty until refreshCalendar has run once. */
export function calendarDay(): CalendarEvent[] {
  return shown(today);
}

/** Re-read the day. Called at boot and after anything that changes it. */
export async function refreshCalendar(): Promise<void> {
  today = await source.day(nowMs());
  // The month and week views read their own caches, so a booking made anywhere
  // has to reach them too — otherwise a new block appears on the day page and
  // the grids keep showing the old state until something else refetches.
  if (monthAnchor !== 0) await refreshMonth(monthAnchor);
  if (weekAnchor !== 0) await refreshWeek(weekAnchor);
}

/** The Monday 00:00 of the week containing `ms`, in local time. */
export function mondayOf(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** The week last fetched, Monday to Sunday, in start order. */
export function calendarWeek(): CalendarEvent[] {
  return shown(week);
}

export function calendarWeekAnchor(): number {
  return weekAnchor || mondayOf(nowMs());
}

/**
 * Fetch one week. Same tail-of-upcoming trick as the month — see refreshMonth
 * for why the apparent waste is bounded by the sync window.
 */
export async function refreshWeek(anchorMs: number): Promise<void> {
  const start = mondayOf(anchorMs);
  const end = start + 7 * 86_400_000;

  weekAnchor = start;
  const all = await source.upcoming(end);
  week = all
    .filter((e) => {
      const t = Date.parse(e.at);
      return t >= start && t < end;
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Everything in the month last fetched, in start order. */
export function calendarMonth(): CalendarEvent[] {
  return shown(month);
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
