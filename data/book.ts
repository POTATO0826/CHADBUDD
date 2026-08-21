/**
 * Where each client sits in the conversion loop, and what they hold.
 *
 * ── why a loop and not a funnel ──────────────────────────────────────
 * The stages read like a funnel and are drawn like one, but they do not
 * terminate. A completed product matures, the maturity opens the next
 * conversation, and the client re-enters at `inquiring` on whatever comes next:
 *
 *     inquiring → proposing → completed → maturing → renewing ─┐
 *         ↑                                                     │
 *         └─────────────────────────────────────────────────────┘
 *
 * That matters for how the chart is drawn. A true funnel tapers because the
 * last stage is the residue of the first — 5% of what went in. Here the far end
 * is the most valuable cohort on the book, because a client with a maturity date
 * is a renewal with a deadline attached. The stages are therefore weighted
 * evenly rather than tapered; see stageFunnel() in src/main.ts.
 *
 * ── stage is a position, not a label ─────────────────────────────────
 * A client sits in exactly one stage: the most actionable thing true of them
 * right now. Priya has completed products *and* a renewal due — she is filed
 * under `maturing`, because that is the conversation this month.
 *
 * ── the same gate as everything else ─────────────────────────────────
 * Every entry cites the messages that put the client in that stage, and those
 * ids run through the ledger's `findVerbatim` in src/book.ts. A stage nobody
 * said anything to justify is not a stage, and the client falls out of the
 * funnel rather than being drawn on a guess.
 */

import type { ClientKey } from "./types.ts";

/**
 * The loop, in order. `renewing` is not an end state — a client who renews
 * re-enters at `inquiring` for the next product.
 */
export type Stage = "inquiring" | "proposing" | "completed" | "maturing" | "renewing";

export const STAGES: readonly Stage[] = [
  "inquiring",
  "proposing",
  "completed",
  "maturing",
  "renewing",
] as const;

/** What each stage means, shown under the funnel so nobody has to be taught it. */
export const STAGE_NOTE: Record<Stage, string> = {
  inquiring: "asked about something, nothing sent yet",
  proposing: "options with them, waiting on a decision",
  completed: "holds a live product, nothing due",
  maturing: "product ends soon — the renewal conversation is open",
  renewing: "matured, next plan still being decided",
};

export interface BookEntry {
  client: ClientKey;
  stage: Stage;
  /** What they hold, or what is being discussed. */
  product: string;
  /** ISO date the product matures or renews, where one is actually stated. */
  maturesAt?: string;
  /** Messages that put them in this stage. Verbatim-checked in src/book.ts. */
  cites: string[];
}

/**
 * Four clients is not a book, and the funnel drawn from it will look sparse.
 * That is the honest rendering of four clients rather than a defect: the shape
 * is computed from this array, so seeding a realistic book is adding rows here,
 * not touching the chart.
 */
export const book: BookEntry[] = [
  {
    client: "D",
    stage: "inquiring",
    product: "Two funds, side by side",
    // Asked on 5 May, re-promised on 20 May, still not sent. He cannot move to
    // proposing because the thing that would move him has never been sent.
    cites: ["D-012", "D-014"],
  },
  {
    client: "C",
    stage: "proposing",
    product: "Retirement plan · condo deposit in 3 years",
    cites: ["C-001", "C-005"],
  },
  {
    client: "A",
    stage: "maturing",
    product: "Medical rider trim · September renewal",
    maturesAt: "2026-09-01T00:00:00+08:00",
    cites: ["A-040", "A-062"],
  },
  {
    client: "B",
    stage: "maturing",
    product: "Keyman premium",
    maturesAt: "2026-09-01T00:00:00+08:00",
    cites: ["B-042"],
  },
];
