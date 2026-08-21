/**
 * Hand-seeded ledger entries — the placeholder for Stage 3.
 *
 * Stage 3 replaces this file with one extraction pass (generateObject + a Zod
 * schema) that produces the same shape. Until then these are written by hand so
 * the dashboard has real, traceable items to render.
 *
 * The rule that makes them trustworthy is enforced in code, not by care:
 * `quote` must appear verbatim in the message named by `sourceMessageId`, or
 * src/ledger.ts discards the entry. Nothing reaches the UI that can't be traced
 * back to an exact message. `openedAt` and `settledAt` are never written here —
 * they're derived from the cited messages, so they cannot drift from the thread.
 */

import type { ClientKey } from "./types.ts";

export type LedgerKind = "promise" | "question" | "disclosure";

export interface LedgerSeed {
  client: ClientKey;
  kind: LedgerKind;
  /** Short description, in the advisor's language. */
  text: string;
  owedBy: "advisor" | "client";
  /** Must appear verbatim in sourceMessageId. Checked, not trusted. */
  quote: string;
  sourceMessageId: string;
  /** Present only if the obligation was actually discharged. */
  settledByMessageId?: string;
}

export const ledgerSeed: LedgerSeed[] = [
  // ── Client A — everything opened has been closed ──────────────────
  {
    client: "A",
    kind: "promise",
    text: "Check the group policy's outpatient limit before recommending a rider trim",
    owedBy: "advisor",
    quote: "Give me till Friday.",
    sourceMessageId: "A-016",
    settledByMessageId: "A-018",
  },
  {
    client: "A",
    kind: "promise",
    text: "Read the ESOS offer document and give a straight answer",
    owedBy: "advisor",
    quote: "I'll give you a straight answer by Friday.",
    sourceMessageId: "A-027",
    settledByMessageId: "A-028",
  },
  {
    client: "A",
    kind: "promise",
    text: "Chase Priya for the renewal signature in late August",
    owedBy: "advisor",
    quote: "I'll chase you for it.",
    sourceMessageId: "A-040",
    settledByMessageId: "A-062",
  },
  {
    client: "A",
    kind: "question",
    text: "Whether the rider trim changes the premium now or in September",
    owedBy: "advisor",
    quote: "Does the trim change my premium immediately or from September?",
    sourceMessageId: "A-063",
    settledByMessageId: "A-064",
  },

  // ── Client B — one thing left hanging, on the client's side ───────
  {
    client: "B",
    kind: "promise",
    text: "Write the staff medical one-pager in English and Malay",
    owedBy: "advisor",
    quote: "I'll get you a one-pager in both.",
    sourceMessageId: "B-011",
    settledByMessageId: "B-012",
  },
  {
    client: "B",
    kind: "promise",
    text: "Check the succession meeting dates with Hafiz",
    owedBy: "client",
    quote: "Let me check with Hafiz about the dates",
    sourceMessageId: "B-025",
    settledByMessageId: "B-027",
  },
  {
    client: "B",
    kind: "promise",
    text: "Read the buy-sell agreement draft",
    owedBy: "client",
    quote: "Received. Will read.",
    sourceMessageId: "B-033",
  },
  {
    client: "B",
    kind: "question",
    text: "Whether the buy-sell is still happening this year or should be parked",
    owedBy: "client",
    quote: "Is the buy-sell still something you want to do this year, or should I park it and leave you alone until you're ready?",
    sourceMessageId: "B-050",
    settledByMessageId: "B-051",
  },

  // ── Client C — nothing is owed. That is the whole point. ──────────
  {
    client: "C",
    kind: "promise",
    text: "Send the plan modelled both with and without the Singapore role",
    owedBy: "advisor",
    quote: "Both versions by Monday.",
    sourceMessageId: "C-030",
    settledByMessageId: "C-031",
  },
  {
    client: "C",
    kind: "promise",
    text: "Come back on whether to add a 10% Asia ex-Japan allocation",
    owedBy: "client",
    quote: "Let me have a think about that one and get back to you.",
    sourceMessageId: "C-043",
    settledByMessageId: "C-055",
  },
  {
    client: "C",
    kind: "disclosure",
    text: "Asked directly how the advisor is paid, and was told",
    owedBy: "advisor",
    quote: "how do you get paid on my plan?",
    sourceMessageId: "C-010",
  },
  {
    client: "C",
    kind: "disclosure",
    text: "Premium ceiling of RM250 a month, so the condo plan isn't squeezed",
    owedBy: "client",
    quote: "keep the premium under RM250 a month",
    sourceMessageId: "C-017",
  },
  {
    client: "C",
    kind: "disclosure",
    text: "Turned down a Singapore role — no travel, staying on the original plan",
    owedBy: "client",
    quote: "I turned the Singapore role down in the end.",
    sourceMessageId: "C-034",
  },

  // ── Client D — the unfulfilled promise, twice over ────────────────
  {
    client: "D",
    kind: "question",
    text: "How much rougher the Kenanga fund's ride actually is in practice",
    owedBy: "advisor",
    quote: "How different is the rougher ride in practice?",
    sourceMessageId: "D-009",
    settledByMessageId: "D-010",
  },
  {
    client: "D",
    kind: "promise",
    text: "Send a side-by-side comparison of Titans and Kenanga — fees, 5y returns, worst drawdown",
    owedBy: "advisor",
    quote: "I'll pull together a proper side-by-side of the two — fees, five year returns, worst drawdown — and get it to you this week.",
    sourceMessageId: "D-012",
  },
  {
    client: "D",
    kind: "promise",
    text: "Re-promised the fund comparison for the end of that week",
    owedBy: "advisor",
    quote: "End of this week, I promise.",
    sourceMessageId: "D-014",
  },
  {
    client: "D",
    kind: "promise",
    text: "Report back once the shift allowance restructure was confirmed",
    owedBy: "client",
    quote: "Should know by early July, I'll tell you either way.",
    sourceMessageId: "D-021",
    settledByMessageId: "D-041",
  },
  {
    client: "D",
    kind: "promise",
    text: "Third promise of the fund comparison, 101 days after the first",
    owedBy: "advisor",
    quote: "I'm going to get it to you this week, properly this time.",
    sourceMessageId: "D-044",
  },
];
