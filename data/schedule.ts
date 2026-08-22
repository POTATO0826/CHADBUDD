/**
 * The advisor's day, as actually planned.
 *
 * A retention tool that knows a promise is 104 days old and does not know the
 * advisor is standing in it at 13:15 is only half a tool. This is the other
 * half: the schedule the assistant has already built — meetings, the travel
 * between them, and the breaks that are as real as the meetings, because a day
 * packed to the minute is how the follow-ups get dropped in the first place.
 *
 * ── traceability ─────────────────────────────────────────────────────
 * `purpose` is the advisor's own framing and is allowed to be prose. `cites`
 * is not: every id must resolve to a real seed message, and src/agenda.ts runs
 * them through the same `findVerbatim` gate the ledger uses. A meeting whose
 * stated reason cannot be traced to something the client actually said is a
 * meeting the product has no business explaining.
 *
 * ── the clock ────────────────────────────────────────────────────────
 * Times are ISO with the +08:00 offset, on the one day data/clock.ts freezes:
 * Monday 17 August 2026. NOW is 12:00, mid-lunch — so the next real commitment
 * is the 13:15 with Adrian Lim, which is the one meeting on this day where a
 * 104-day-old promise is finally in the room.
 */

import type { ClientKey } from "./types.ts";

/**
 * Travel and breaks are first-class rather than gaps between the real entries.
 * The assistant scheduled them, the advisor is committed to them, and a missed
 * call at 12:50 is explained by the drive to Bangsar — which is exactly the
 * context the client never gets and this build intends to send them.
 */
export type SlotKind = "meeting" | "call" | "travel" | "break" | "focus" | "admin";

/** Kinds that count as a commitment worth counting down to. */
export const BIG: ReadonlySet<SlotKind> = new Set<SlotKind>(["meeting", "call"]);

export interface ScheduleSlot {
  /** Stable citation key, same idea as a message externalId. */
  id: string;
  kind: SlotKind;
  /**
   * Advisor-set weight, where the advisor has set one. Absent means unrated —
   * a real state the UI shows, never silently treated as routine.
   */
  importance?: "routine" | "important" | "key";
  title: string;
  /** ISO 8601 with the +08:00 offset the day actually happened in. */
  at: string;
  minutes: number;
  /** Set when the counterparty is a client, so the slot can open their profile. */
  withClient?: ClientKey;
  /** Who it is with, when that is not a client — a colleague, or nobody. */
  withName?: string;
  where: string;
  /** Why this is in the diary, in the advisor's language. */
  purpose: string;
  /** Messages that establish the purpose. Verbatim-checked in src/agenda.ts. */
  cites: string[];
  /** What to have ready. Kept short — this is read in a car park. */
  prep: string[];
}

export const schedule: ScheduleSlot[] = [
  {
    id: "S-001",
    kind: "focus",
    title: "Desk prep",
    at: "2026-08-17T08:30:00+08:00",
    minutes: 30,
    where: "Office",
    purpose: "Read the two threads that move today before anyone is awake enough to call.",
    cites: [],
    prep: ["Adrian's comparison file", "Priya's gold confirmation"],
  },
  {
    id: "S-002",
    kind: "travel",
    title: "Drive to KLCC",
    at: "2026-08-17T09:15:00+08:00",
    minutes: 30,
    where: "Office → KLCC",
    purpose: "Morning traffic on Jalan Tun Razak; the assistant padded this by ten minutes.",
    cites: [],
    prep: [],
  },
  {
    id: "S-003",
    kind: "meeting",
    importance: "important",
    title: "Priya Ramasamy — gold switch",
    at: "2026-08-17T09:45:00+08:00",
    minutes: 45,
    withClient: "A",
    where: "KLCC, her office",
    purpose:
      "She instructed the switch herself and it is already approved. This is signing and confirming, not selling — she is the one relationship on the book that is genuinely steady.",
    cites: ["A-068"],
    prep: ["Signed instruction", "Updated allocation sheet"],
  },
  {
    id: "S-004",
    kind: "travel",
    title: "Drive back to office",
    at: "2026-08-17T10:30:00+08:00",
    minutes: 40,
    where: "KLCC → Office",
    purpose: "",
    cites: [],
    prep: [],
  },
  {
    id: "S-005",
    kind: "admin",
    title: "Log Priya's instruction",
    at: "2026-08-17T11:10:00+08:00",
    minutes: 20,
    where: "Office",
    purpose: "Same-day logging, because an instruction recorded from memory is an instruction argued about later.",
    cites: ["A-068"],
    prep: [],
  },
  {
    id: "S-006",
    kind: "break",
    title: "Lunch",
    at: "2026-08-17T11:30:00+08:00",
    minutes: 45,
    where: "Office",
    purpose: "Protected. The 13:15 is the hardest conversation of the week and should not be walked into hungry.",
    cites: [],
    prep: [],
  },
  {
    id: "S-007",
    kind: "travel",
    title: "Drive to Bangsar",
    at: "2026-08-17T12:40:00+08:00",
    minutes: 35,
    where: "Office → Bangsar",
    purpose: "",
    cites: [],
    prep: [],
  },
  {
    id: "S-008",
    kind: "meeting",
    // The 104-day promise finally lands in a room. If any meeting on this day
    // deserves preparing the night before, it is this one.
    importance: "key",
    title: "Adrian Lim — the comparison, finally",
    at: "2026-08-17T13:15:00+08:00",
    minutes: 60,
    withClient: "D",
    where: "Bangsar, his office",
    purpose:
      "A side-by-side of the two funds was promised on 5 May, re-promised on 20 May, and has never been sent. He has not asked a question in 30 days and no longer starts conversations. Bring the file or do not go.",
    cites: ["D-012", "D-014", "D-044"],
    prep: ["The fund comparison, printed", "Fee table, five-year net", "No new product. None."],
  },
  {
    id: "S-009",
    kind: "travel",
    title: "Drive back to office",
    at: "2026-08-17T14:15:00+08:00",
    minutes: 30,
    where: "Bangsar → Office",
    purpose: "",
    cites: [],
    prep: [],
  },
  {
    id: "S-010",
    kind: "call",
    importance: "routine",
    title: "Michelle Tan — check-in",
    at: "2026-08-17T14:45:00+08:00",
    minutes: 20,
    withClient: "C",
    where: "Phone",
    purpose:
      "Nothing is wrong on the surface: she still replies in twenty minutes and nothing is owed either way. She has also not asked a single question in 30 days and has stopped starting conversations. Ask her something only she can answer.",
    cites: ["C-034", "C-059"],
    prep: ["One open question about her own timeline", "No product"],
  },
  {
    id: "S-011",
    kind: "focus",
    title: "Prepare Faizal's October review",
    at: "2026-08-17T15:15:00+08:00",
    minutes: 40,
    withClient: "B",
    where: "Office",
    purpose: "He parked everything until October on his own instruction. This is getting the pack ready early, not contacting him.",
    cites: ["B-051"],
    prep: ["Keyman renewal dates", "Do not message him"],
  },
  {
    id: "S-012",
    kind: "meeting",
    title: "1:1 with Sarah Ng",
    at: "2026-08-17T16:00:00+08:00",
    minutes: 30,
    withName: "Sarah Ng · branch manager",
    where: "Office, upstairs",
    purpose: "Monthly review. She will ask about the book's retention numbers and about Adrian specifically.",
    cites: [],
    prep: ["Retention figures", "An honest answer on D-012"],
  },
  {
    id: "S-013",
    kind: "admin",
    title: "Write the day up",
    at: "2026-08-17T16:30:00+08:00",
    minutes: 30,
    where: "Office",
    purpose: "",
    cites: [],
    prep: [],
  },
];
