/**
 * Replies the assistant sent without asking.
 *
 * ── SEEDED. Nothing here was actually sent. ──────────────────────────
 * There is no model behind this build and no outbound channel, so these are
 * hand-written examples of what the factual tier *would* answer. They are kept
 * in data/ rather than derived in src/ for the same reason ledger-seed.ts is:
 * so the boundary between measured and authored stays a directory, not a
 * comment someone has to notice. The UI labels the block accordingly.
 *
 * ── the line these sit on ────────────────────────────────────────────
 * Every entry answers a question whose answer is published, identical for
 * every client, and not advice. A current FD board rate is a fact. Whether a
 * client should move into one is a recommendation, and a recommendation from a
 * licensed advisor is regulated activity — that goes to the approval queue and
 * carries the advisor's name, not the assistant's.
 *
 * The test, applied to every row here: could this answer be read aloud
 * unchanged to any client on the book? If not, it does not belong in this file.
 */

import type { ClientKey } from "./types.ts";

/** Why this was safe to answer without a human. */
export type FactualKind = "rate" | "terms" | "mechanics" | "logistics";

export interface HandledReply {
  id: string;
  client: ClientKey;
  /** ISO 8601, +08:00. */
  at: string;
  kind: FactualKind;
  /** What they asked, in their words. */
  asked: string;
  /** What was sent back. */
  sent: string;
  /** The message that asked it, where one exists in the thread. */
  cite?: string;
  /**
   * Where the figures came from, and when they stop being current.
   *
   * Required whenever the reply states a number. A rate with no source is a
   * rate the assistant invented, and an expired source is an invented rate
   * with a date on it — src/gates.ts refuses both.
   */
  source?: { ref: string; validUntil: string };
  /**
   * Whether this kind of question has been approved for this client before.
   *
   * The first-of-kind gate holds anything new, which is right on a cold start
   * and wrong for a set meant to represent a system that has been running.
   * Two are left unearned so the gate is visible rather than theoretical.
   */
  earned?: boolean;
}

export const handled: HandledReply[] = [
  {
    id: "H-001",
    earned: true,
    client: "A",
    at: "2026-08-17T09:12:00+08:00",
    kind: "rate",
    asked: "What's the current 12-month FD board rate?",
    sent: "The 12-month board rate is 3.65% p.a. as of 1 August. Promotional tiers for placements above RM50k are 3.85%. Both are published rates, not a recommendation — happy to talk through whether either fits you.",
    source: { ref: "Board rates, 1 Aug 2026", validUntil: "2026-09-01T00:00:00+08:00" },
  },
  {
    id: "H-002",
    earned: true,
    client: "C",
    at: "2026-08-17T09:41:00+08:00",
    kind: "terms",
    asked: "Is there a penalty if I withdraw the FD early?",
    sent: "Yes — early withdrawal forfeits accrued interest for the current tenure. The principal is never at risk. Clause 7.2 of the terms, and I can send the page if useful.",
    source: { ref: "Deposit T&C, clause 7.2", validUntil: "2027-01-01T00:00:00+08:00" },
  },
  {
    id: "H-003",
    earned: true,
    client: "A",
    at: "2026-08-17T10:05:00+08:00",
    kind: "mechanics",
    asked: "How does the rider trim actually take effect?",
    sent: "It takes effect at the policy renewal date rather than immediately, and the premium adjusts from that date. Nothing changes on the current term.",
  },
  {
    id: "H-004",
    earned: true,
    client: "B",
    at: "2026-08-17T10:33:00+08:00",
    kind: "logistics",
    asked: "When does the keyman premium get debited?",
    sent: "The first of the renewal month, from the account already on file. No action needed at your end.",
  },
  {
    id: "H-005",
    earned: true,
    client: "C",
    at: "2026-08-17T11:02:00+08:00",
    kind: "rate",
    asked: "What's the promo rate on the current unit trust tranche?",
    sent: "Sales charge on the current tranche is 1.5%, down from the standard 2.0%, until 30 September. That is the published promotion — whether the fund suits your plan is a separate conversation and I'd rather have it properly.",
    source: { ref: "Tranche promotion sheet", validUntil: "2026-09-30T00:00:00+08:00" },
  },
  {
    id: "H-006",
    earned: true,
    client: "D",
    at: "2026-08-17T11:20:00+08:00",
    kind: "terms",
    asked: "Does the capital protection apply if I exit before maturity?",
    sent: "No — capital protection applies at maturity only. Exiting early is at prevailing market value. That is in the product highlights sheet, section 4.",
    source: { ref: "Product highlights sheet, s.4", validUntil: "2026-12-31T00:00:00+08:00" },
  },
  {
    id: "H-007",
    client: "A",
    at: "2026-08-17T11:38:00+08:00",
    kind: "mechanics",
    asked: "Can I nominate more than one beneficiary?",
    sent: "Yes, and you can split by percentage. The form takes up to four nominees; anything beyond that needs a trust arrangement.",
    source: { ref: "Nomination form guidance", validUntil: "2027-06-30T00:00:00+08:00" },
  },
  {
    id: "H-008",
    client: "B",
    at: "2026-08-17T11:47:00+08:00",
    kind: "logistics",
    asked: "What documents do I need for the October review?",
    sent: "Latest EPF statement, this year's EA form, and the existing policy schedules. I'll send a checklist nearer the time.",
  },
  {
    id: "H-009",
    earned: true,
    client: "C",
    at: "2026-08-17T11:55:00+08:00",
    kind: "terms",
    asked: "Is the ASB portion locked in for any period?",
    sent: "No lock-in. Units can be redeemed on any business day and settle in one to three days.",
  },
];
