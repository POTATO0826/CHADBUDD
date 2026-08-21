/**
 * The phone log.
 *
 * The chat thread is only half of how an advisor and a client actually talk. The other
 * half is the phone, and it carries a signal the messages cannot: a missed call
 * that was returned in twenty minutes and a missed call that was never returned
 * look identical in a chat export, and mean opposite things.
 *
 * ── what is measured, and why these four ─────────────────────────────
 *   · whether a missed call was returned at all — the bluntest signal there is
 *   · how long it took — a relationship degrades in the gap, not in the miss
 *   · who missed whom — an advisor who does not call back is a different
 *     failure from a client who has stopped picking up, and the product exists
 *     to tell the advisor which one is happening
 *   · missed against total — one missed call is a Tuesday, a third of them is
 *     a pattern
 *
 * ── the join ─────────────────────────────────────────────────────────
 * `returnedBy` points at the call that answered a miss, so the gap is derived
 * from two real records rather than authored as a duration. Same rule the
 * ledger applies to `openedAt`: a number that could drift is computed, never
 * written down.
 *
 * Ids are `K-nnn` — a namespace of their own, so a call can be cited without
 * colliding with a message id.
 */

import type { ClientKey } from "./types.ts";

export type CallDirection = "in" | "out";
export type CallOutcome = "answered" | "missed";

export interface CallRecord {
  id: string;
  client: ClientKey;
  /** ISO 8601 with the +08:00 offset these calls happened in. */
  at: string;
  /** "in" is the client calling the advisor. */
  direction: CallDirection;
  outcome: CallOutcome;
  /** Length of an answered call. Zero for a miss. */
  minutes: number;
  /** The call that returned this one, when it was returned at all. */
  returnedBy?: string;
}

export const calls: CallRecord[] = [
  /* A · Priya — the healthy one. Calls get picked up, and the one miss came
     back inside the hour. */
  { id: "K-001", client: "A", at: "2026-05-14T10:12:00+08:00", direction: "in", outcome: "answered", minutes: 14 },
  { id: "K-002", client: "A", at: "2026-06-09T15:40:00+08:00", direction: "out", outcome: "answered", minutes: 9 },
  { id: "K-003", client: "A", at: "2026-07-02T09:05:00+08:00", direction: "in", outcome: "missed", minutes: 0, returnedBy: "K-004" },
  { id: "K-004", client: "A", at: "2026-07-02T09:48:00+08:00", direction: "out", outcome: "answered", minutes: 11 },
  { id: "K-005", client: "A", at: "2026-08-11T14:20:00+08:00", direction: "out", outcome: "answered", minutes: 7 },

  /* B · Faizal — parked until October on his own instruction. The calls stop
     because he asked them to, which is why silence here is not decay. */
  { id: "K-010", client: "B", at: "2026-04-28T11:30:00+08:00", direction: "out", outcome: "answered", minutes: 22 },
  { id: "K-011", client: "B", at: "2026-05-21T16:15:00+08:00", direction: "in", outcome: "answered", minutes: 6 },
  { id: "K-012", client: "B", at: "2026-06-30T10:00:00+08:00", direction: "out", outcome: "missed", minutes: 0 },

  /* C · Michelle — the case the product exists for. She answers the phone
     every time. Nothing in this log looks wrong, and nothing in it is. */
  { id: "K-020", client: "C", at: "2026-04-30T13:10:00+08:00", direction: "out", outcome: "answered", minutes: 18 },
  { id: "K-021", client: "C", at: "2026-05-19T09:25:00+08:00", direction: "in", outcome: "answered", minutes: 12 },
  { id: "K-022", client: "C", at: "2026-06-24T15:55:00+08:00", direction: "out", outcome: "answered", minutes: 8 },
  { id: "K-023", client: "C", at: "2026-08-04T11:40:00+08:00", direction: "out", outcome: "answered", minutes: 5 },

  /* D · Adrian — decay the advisor caused, and the phone says so louder than
     the thread does. He called three times. Two were never returned, and the
     one that was took nine days. */
  { id: "K-030", client: "D", at: "2026-05-08T09:15:00+08:00", direction: "in", outcome: "missed", minutes: 0, returnedBy: "K-031" },
  { id: "K-031", client: "D", at: "2026-05-17T16:30:00+08:00", direction: "out", outcome: "answered", minutes: 4 },
  { id: "K-032", client: "D", at: "2026-06-11T14:05:00+08:00", direction: "in", outcome: "missed", minutes: 0 },
  { id: "K-033", client: "D", at: "2026-07-23T10:50:00+08:00", direction: "in", outcome: "missed", minutes: 0 },
  { id: "K-034", client: "D", at: "2026-08-02T17:20:00+08:00", direction: "out", outcome: "answered", minutes: 3 },
];
