/**
 * Test oracle. What each seeded thread is *supposed* to look like.
 *
 * Deliberately kept out of data/threads/* so none of it can leak into the
 * engine or the UI. The decay engine only ever sees messages; this file exists
 * so scripts can check that what the engine concludes matches what was seeded.
 */

import type { ClientKey } from "./types.ts";

export type Verdict = "healthy" | "decaying" | "silent";

export interface Fixture {
  key: ClientKey;
  label: string;
  /** What the engine should conclude in Stage 2. */
  expect: Verdict;
  /** Which of the four signals should read as deviated in the last 30 days. */
  expectDeviated: Array<"latency" | "initiation" | "questions" | "length">;
  /** Ledger entries Stage 3 must find, by source message. */
  expectOpenLedger: Array<{ sourceMessageId: string; owedBy: "advisor" | "client"; gist: string }>;
  notes: string;
}

export const fixtures: Record<ClientKey, Fixture> = {
  A: {
    key: "A",
    label: "Healthy",
    expect: "healthy",
    expectDeviated: [],
    expectOpenLedger: [],
    notes:
      "Latency, initiation, questions and length all hold steady across the four months. This is the control — if the engine flags Priya, the engine is wrong.",
  },
  B: {
    key: "B",
    label: "Obvious decay",
    expect: "decaying",
    expectDeviated: ["latency", "initiation", "questions", "length"],
    expectOpenLedger: [],
    notes:
      "Every signal degrades. Latency climbs from ~40 min to 2+ days, replies shrink to a few words, no client-initiated conversation after 10 June, and two meeting reschedules (B-045, B-048) in the final fortnight.",
  },
  C: {
    key: "C",
    label: "Silent churn",
    expect: "silent",
    expectDeviated: ["initiation", "questions"],
    expectOpenLedger: [],
    notes:
      "Latency stays inside half an hour for the whole period and the tone never sours. Question flow and initiation both go to zero from 9 June. Nothing is owed in either direction — C-043 (she'll think about the Asia allocation) sat for 44 days but the advisor closed it himself at C-054, so there is no broken promise to point at. Composite alone will look mild; the silent override is the only thing that catches this one.",
  },
  D: {
    key: "D",
    label: "Advisor-caused",
    expect: "decaying",
    expectDeviated: ["latency", "initiation", "questions", "length"],
    expectOpenLedger: [
      {
        sourceMessageId: "D-012",
        owedBy: "advisor",
        gist: "promised a side-by-side fund comparison 'this week' on 5 May — still not sent",
      },
      {
        sourceMessageId: "D-014",
        owedBy: "advisor",
        gist: "re-promised the comparison for end of that week on 20 May — still not sent",
      },
    ],
    notes:
      "Decay is real but caused from the advisor's side: three pitches in five days (D-024, D-026, D-028) and an unfulfilled promise opened at D-012. Engagement drops immediately after 23 June and never recovers.",
  },
};
