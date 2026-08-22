/**
 * Reading a schedule change out of what somebody typed.
 *
 * Shared between the page and the Convex backend deliberately: the page reads
 * messages that arrive while the app is open, the backend reads every message
 * as it is ingested, and two copies of this logic would drift into two
 * different products — one that books a meeting and one that does not, for the
 * same sentence.
 *
 * ── the timezone is explicit, and that is not fussiness ──────────────
 * The first version used `new Date().getHours()`, which reads the *host*
 * clock. That is accidentally correct on a laptop in Kuala Lumpur and wrong by
 * eight hours on a Convex server, which runs UTC — so "Thursday 4pm" booked
 * from the backend would land at midnight. Wall-clock arithmetic across two
 * runtimes has to name its offset.
 *
 * ── conservative on purpose ──────────────────────────────────────────
 * Every reading requires more than one signal: a time *and* a day *and* a word
 * of assent before anything counts as agreed. "Thursday 4pm works" qualifies;
 * "sometime Thursday?" does not, and neither does a bare "4pm". The cost of
 * that is missed bookings the advisor makes by hand, which is the cheap
 * failure. The expensive one is a diary that fills with things nobody agreed.
 */

/** Asia/Kuala_Lumpur. Fixed all year — Malaysia has no daylight saving. */
export const OFFSET_MIN = 8 * 60;

export type Intent = "agree" | "move" | "cancel" | "propose";

export interface Reading {
  intent: Intent;
  /** Minutes past midnight, local, when a clock time was given. */
  minutesOfDay: number | null;
  /** Midnight of the day meant, as an instant, when a day was given. */
  day: number | null;
  /** The sentence this was read out of, for the citation. */
  phrase: string;
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Assent, not enthusiasm. "Great!" is not agreement to anything — it is what
 * people type before saying what they actually mean.
 */
const ASSENT = [
  "works", "sounds good", "see you", "confirmed", "ok then", "okay then",
  "perfect", "that's fine", "thats fine", "deal", "let's do", "lets do",
  "noted", "see u", "fine by me", "works for me",
];

const MOVE = [
  "move", "reschedule", "push", "shift", "instead", "postpone",
  "bring forward", "push back", "another time", "change it to", "can we do",
];

const CANCEL = ["cancel", "call it off", "can't make", "cant make", "cannot make", "won't make", "wont make"];

/**
 * An offer of a time, not agreement to one. "Is it possible to meet at 6pm"
 * books nothing — someone asked a question, and the calendar answering it
 * would put words in the advisor's mouth. It becomes a proposal: a card the
 * advisor accepts or declines, which is the confirmation step everything
 * here refuses to skip.
 */
const PROPOSE = [
  "is it possible", "how about", "what about", "are you free", "you free",
  "u free", "available", "shall we", "can we meet", "could we meet",
  "can i come", "meet up", "meet at", "call at", "call you at", "call u at",
];

/** Words that make a bare "…at 6pm?" question clearly about meeting. */
const MEETING_WORDS = /\b(meet|meeting|call|session|appointment|zoom|come by|drop by)\b/;

/** Wall-clock parts of an instant, in the fixed offset. */
function partsOf(ms: number): { y: number; m: number; d: number; dow: number } {
  const shifted = new Date(ms + OFFSET_MIN * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    dow: shifted.getUTCDay(),
  };
}

/** The instant for a wall-clock date in the fixed offset. */
export function instantOf(y: number, m: number, d: number, minutesOfDay = 0): number {
  return Date.UTC(y, m, d, 0, minutesOfDay) - OFFSET_MIN * 60_000;
}

/** Midnight of the day containing `ms`, in the fixed offset. */
export function dayOf(ms: number): number {
  const p = partsOf(ms);
  return instantOf(p.y, p.m, p.d);
}

/**
 * A clock time, as minutes past midnight.
 *
 * Accepts "4pm", "4.30pm", "16:30" and "9 am". Rejects a bare number: "let's
 * say 4" is a time to a person and a coin flip to a parser, and booking on a
 * coin flip is how the diary stops being trustworthy.
 */
function readTime(s: string): number | null {
  const ampm = /(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/.exec(s);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2] ?? 0);
    if (h > 12 || m > 59) return null;
    if (ampm[3] === "pm" && h < 12) h += 12;
    if (ampm[3] === "am" && h === 12) h = 0;
    return h * 60 + m;
  }

  const h24 = /\b(\d{1,2}):(\d{2})\b/.exec(s);
  if (h24) {
    const h = Number(h24[1]);
    const m = Number(h24[2]);
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
  }

  return null;
}

/**
 * Which day, when one was named.
 *
 * A weekday resolves to its next occurrence, counting today only if the time
 * given is still ahead — "Monday 3pm" said at 4pm on a Monday means next
 * Monday, and booking it for an hour ago would be worse than not booking.
 */
function readDay(s: string, fromMs: number, minutesOfDay: number | null): number | null {
  const today = dayOf(fromMs);
  const DAY_MS = 86_400_000;

  if (/\btomorrow\b/.test(s)) return today + DAY_MS;
  if (/\btoday\b/.test(s) || /\bthis afternoon\b/.test(s) || /\bthis morning\b/.test(s)) return today;

  const dow = DAYS.findIndex((d) => s.includes(d));
  if (dow < 0) return null;

  const p = partsOf(fromMs);
  let ahead = (dow - p.dow + 7) % 7;

  if (ahead === 0) {
    const nowMinutes = Math.round((fromMs - today) / 60_000);
    // Named today, but the hour has gone — they mean the week after.
    if (minutesOfDay === null || minutesOfDay <= nowMinutes) ahead = 7;
  }

  return today + ahead * DAY_MS;
}

/**
 * What a message is asking of the calendar, or null for the overwhelming
 * majority that ask nothing.
 *
 * Order matters. Cancelling is checked first because "can we cancel Thursday
 * and do Friday 3pm instead" contains both a cancellation and a proposal, and
 * treating it as a booking would leave the Thursday standing.
 */
export function readSchedule(text: string, fromMs: number): Reading | null {
  const s = text.toLowerCase();
  const minutesOfDay = readTime(s);
  const day = readDay(s, fromMs, minutesOfDay);
  const phrase = text.trim();

  if (CANCEL.some((w) => s.includes(w))) {
    return { intent: "cancel", minutesOfDay, day, phrase };
  }

  /* A move needs a new time to move to. "Can we reschedule?" is a question for
     the advisor, not an instruction to the calendar, and answering it by
     moving something to an invented hour is the worst available outcome. */
  if (MOVE.some((w) => s.includes(w)) && minutesOfDay !== null) {
    return { intent: "move", minutesOfDay, day, phrase };
  }

  if (ASSENT.some((w) => s.includes(w)) && minutesOfDay !== null && day !== null) {
    return { intent: "agree", minutesOfDay, day, phrase };
  }

  /* Last, so assent and moves win when a sentence carries both. Needs a real
     clock time, same bar as everything else; "can we meet next week?" stays a
     question for a person. */
  if (
    minutesOfDay !== null &&
    (PROPOSE.some((w) => s.includes(w)) || (s.includes("?") && MEETING_WORDS.test(s)))
  ) {
    return { intent: "propose", minutesOfDay, day, phrase };
  }

  return null;
}

/** The instant a reading points at, when it points at one. */
export function whenOf(r: Reading, fallbackDay?: number): number | null {
  if (r.minutesOfDay === null) return null;
  const base = r.day ?? fallbackDay;
  if (base === undefined) return null;
  return base + r.minutesOfDay * 60_000;
}
