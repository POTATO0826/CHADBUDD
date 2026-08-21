/**
 * Whether the advisor is reachable, and what may be said about it.
 *
 * Two jobs that turn out to be one. Someone messages and gets nothing for three
 * minutes — the useful thing to send back is not an answer, it is *"he is in
 * something until 3:15."* And knowing that requires knowing whether the 13:15
 * actually finished, which the calendar cannot tell you, because a calendar
 * records intentions rather than events.
 *
 * ── the overrun ladder ───────────────────────────────────────────────
 * Three signals, escalating, and the order matters more than any of them:
 *
 *   1. the advisor taps "running over"     always right, costs a second
 *   2. someone mentions a delay in a thread  free when it happens, rare
 *   3. the assistant asks, and is ignored    the fallback, and only after asking
 *
 * The third is the one that needed care. "They went quiet, so assume the meeting
 * is still running" is wrong every time somebody is driving or eating. So it
 * does not assume — it *asks*, and only treats silence as confirmation ten
 * minutes later. A prompt that goes unanswered is much better evidence than
 * quiet on its own, because it was addressed to a person who would have said no.
 *
 * ── what a status reply may say ──────────────────────────────────────
 * Availability, and nothing else. Never who the meeting is with: leaking one
 * client's schedule to another loses both of them, and it is the single easiest
 * mistake for a well-meaning automatic message to make. Never a reason the
 * calendar does not support — no entry means no status, not an invented one.
 */

import { DAY, NOW } from "../data/clock.ts";
import type { ClientKey } from "../data/types.ts";
import type { CalendarEvent } from "./calendar.ts";

const MIN = 60_000;

/** How long a message may sit before a status reply is warranted. */
export const REPLY_GRACE_MIN = 3;

/** How long after a block ends before the assistant asks whether it finished. */
export const CHECK_AFTER_MIN = 0;

/** How long an unanswered check stands before silence counts as confirmation. */
export const ASSUME_AFTER_MIN = 10;

/** A delay under this is noise. Nobody needs telling you are four minutes late. */
export const NOTIFY_THRESHOLD_MIN = 10;

/** One status per person per busy block, however many times they write. */
export const ONE_PER_BLOCK = true;

export type OverrunSignal = "tapped" | "mentioned" | "unanswered-check";

export interface Overrun {
  event: CalendarEvent;
  by: OverrunSignal;
  /** Minutes past the scheduled end. */
  minutes: number;
  /** The message that mentioned it, when that is how we know. */
  cite?: string;
}

/** What the advisor is inside right now, if anything. */
export interface Busy {
  event: CalendarEvent;
  /** When it is expected to end, overrun included. */
  until: number;
  overrun: Overrun | null;
}

const ts = (e: CalendarEvent): number => Date.parse(e.at);
const endOf = (e: CalendarEvent): number => ts(e) + e.minutes * MIN;

/**
 * Mutable overrun state.
 *
 * Held here rather than in the calendar because an overrun is not a calendar
 * fact — Google will never know the 13:15 ran long. It is something this app
 * observed, and it belongs with the observation.
 */
const overruns = new Map<string, Overrun>();
const checksSentAt = new Map<string, number>();

/** Signal 1: the advisor said so. */
export function markRunningOver(event: CalendarEvent, nowMs: number = NOW): void {
  overruns.set(event.id, {
    event,
    by: "tapped",
    minutes: Math.max(0, Math.round((nowMs - endOf(event)) / MIN)),
  });
}

/** Signal 2: somebody mentioned it in a thread. */
export function noteDelayMentioned(event: CalendarEvent, cite: string, nowMs: number = NOW): void {
  if (overruns.has(event.id)) return;
  overruns.set(event.id, {
    event,
    by: "mentioned",
    minutes: Math.max(0, Math.round((nowMs - endOf(event)) / MIN)),
    cite,
  });
}

/** Record that the assistant has asked whether a block finished. */
export function noteCheckSent(eventId: string, atMs: number = NOW): void {
  if (!checksSentAt.has(eventId)) checksSentAt.set(eventId, atMs);
}

export function clearOverrun(eventId: string): void {
  overruns.delete(eventId);
  checksSentAt.delete(eventId);
}

/**
 * Blocks that have ended and should be asked about.
 *
 * No upper bound, and that was a bug worth keeping the note for: the window
 * was once `< ASSUME_AFTER_MIN`, which meant a block that ended while the app
 * was closed came back already past its own question and was never asked about
 * at all. The assume-clock starts when the question is *sent*, not when the
 * block ended — so a late question is still a question, and silence after it
 * still means something.
 */
export function needsCheck(events: CalendarEvent[], nowMs: number = NOW): CalendarEvent[] {
  return events.filter((e) => {
    if (overruns.has(e.id)) return false;
    if (checksSentAt.has(e.id)) return false;
    return (nowMs - endOf(e)) / MIN >= CHECK_AFTER_MIN;
  });
}

/**
 * Signal 3, resolved.
 *
 * Only fires for a block the assistant already asked about, and only once the
 * question has stood unanswered long enough that silence means something. The
 * prompt is what makes this evidence rather than a guess.
 */
export function resolveUnansweredChecks(events: CalendarEvent[], nowMs: number = NOW): void {
  for (const e of events) {
    if (overruns.has(e.id)) continue;
    const asked = checksSentAt.get(e.id);
    if (asked === undefined) continue;
    if ((nowMs - asked) / MIN < ASSUME_AFTER_MIN) continue;

    overruns.set(e.id, {
      event: e,
      by: "unanswered-check",
      minutes: Math.max(0, Math.round((nowMs - endOf(e)) / MIN)),
    });
  }
}

export function overrunFor(eventId: string): Overrun | null {
  return overruns.get(eventId) ?? null;
}

export function allOverruns(): Overrun[] {
  return [...overruns.values()].sort((a, b) => b.minutes - a.minutes);
}

/** What the advisor is inside now, counting an overrun as still inside it. */
export function busyNow(events: CalendarEvent[], nowMs: number = NOW): Busy | null {
  for (const e of events) {
    const start = ts(e);
    const end = endOf(e);
    const over = overruns.get(e.id) ?? null;
    const until = over ? Math.max(end, nowMs + 5 * MIN) : end;
    if (start <= nowMs && nowMs < until) return { event: e, until, overrun: over };
  }
  return null;
}

const hhmm = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kuala_Lumpur",
});

/**
 * The status message, or null when there is nothing truthful to say.
 *
 * `kind` is deliberately the most the client is told. "In a meeting" covers a
 * meeting with anyone; travel and breaks become "away from my desk", because
 * telling a client you are at lunch while they wait reads differently to
 * telling them you are with someone else, and neither is their business.
 */
export function statusText(busy: Busy | null): string | null {
  if (!busy) return null;

  const what =
    busy.event.kind === "meeting" || busy.event.kind === "call"
      ? "in a meeting"
      : "away from my desk";

  const until = hhmm.format(busy.until);
  return busy.overrun
    ? `Vince is ${what} — it has run a little over, so he should be free around ${until}. He has seen this and will come back to you.`
    : `Vince is ${what} until about ${until}. He will come back to you after that.`;
}

/** Who needs telling that the day has shifted, and by how much. */
export interface Conflict {
  event: CalendarEvent;
  client: ClientKey;
  /** Minutes the start is expected to slip. */
  slip: number;
}

/**
 * The people a delay lands on.
 *
 * Only those with someone on the other side, and only past the noise floor:
 * a four-minute slip does not need a message, and sending one teaches people
 * to ignore the ones that matter.
 */
export function conflictsFrom(
  overrun: Overrun,
  events: CalendarEvent[],
  nowMs: number = NOW,
): Conflict[] {
  const slip = overrun.minutes;
  if (slip < NOTIFY_THRESHOLD_MIN) return [];

  /* Only things the client is actually expecting to attend. A focus block for
     preparing someone's review carries their name but is the advisor's own
     time — telling them "running late for our 15:15" invents an appointment
     they never had, which is worse than saying nothing. */
  return events
    .filter(
      (e) =>
        ts(e) > nowMs &&
        e.withClient !== undefined &&
        (e.kind === "meeting" || e.kind === "call"),
    )
    .map((e) => ({ event: e, client: e.withClient as ClientKey, slip }))
    // Only what the slip actually reaches. A 15-minute overrun does not move
    // an appointment three hours later, and saying so would be a lie.
    .filter((c) => ts(c.event) - nowMs < slip * MIN + 30 * MIN);
}

export function delayText(c: Conflict): string {
  const at = hhmm.format(Date.parse(c.event.at));
  return `Running about ${c.slip} minutes behind for our ${at}. Nothing needs doing at your end — I will message when I am on my way.`;
}

/** Only what is still ahead today, for the conflict sweep. */
export function laterToday(events: CalendarEvent[], nowMs: number = NOW): CalendarEvent[] {
  return events.filter((e) => ts(e) > nowMs && ts(e) - nowMs < DAY);
}
