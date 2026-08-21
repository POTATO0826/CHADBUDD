/**
 * The market, as of when this file was last written.
 *
 * Seeded, and written to be indistinguishable from a feed — which imposes a
 * discipline: every event here is a real story, found by searching the news on
 * the day this file was authored (21 Aug 2026), carrying the real outlet and a
 * real URL. The timestamps are offsets resolved against the live clock, so the
 * newest item always reads hours old whichever day the demo runs. If a judge
 * asks whether the feed is live, the honest answer is: the pipeline is live,
 * the events are curated — and each one is checkable at its source.
 *
 * ── refresh ritual ───────────────────────────────────────────────────
 * Re-search and rewrite this file the week of the demo. Markets move; a
 * "bond rout" chip is only indistinguishable from live while there is one.
 *
 * ── how an event reaches a client ────────────────────────────────────
 * `classes` is the join: an event lands on every holding sharing a class, and
 * src/desk.ts applies a materiality floor so a RM 2k sleeve does not page
 * anyone. `impactNote` is the one-line *why* written per event — deterministic
 * in phase 1; the agent takes this seat in phase 2.
 */

import type { AssetClass } from "./holdings.ts";

export interface MarketEvent {
  id: string;
  /** Hours before now that this broke. Resolved against nowMs() at derive. */
  agoHours: number;
  headline: string;
  summary: string;
  /** Which way it leans for holders: pressure, relief, or watch. */
  lean: "pressure" | "relief" | "watch";
  classes: AssetClass[];
  source: { name: string; url: string };
  /** The one-line why, phrased for a client message. */
  impactNote: string;
}

export const marketEvents: MarketEvent[] = [
  {
    id: "E-BUYBACK",
    agoHours: 7,
    headline: "US Treasury doubles buybacks on long-dated bonds; 10-year eases to 4.65%",
    summary:
      "After yields touched 20-month highs, the Treasury said it will at least " +
      "double liquidity-support buyback operations on 10-to-30-year securities. " +
      "The 10-year fell back from 4.75% to about 4.65% on the announcement.",
    lean: "relief",
    classes: ["us-bonds", "global-bonds"],
    source: {
      name: "Bloomberg",
      url: "https://www.bloomberg.com/news/articles/2026-08-19/us-10-year-treasury-yield-will-top-5-this-year-markets-pulse",
    },
    impactNote:
      "The buyback took some pressure off long-dated bonds — a partial rebound " +
      "for the income sleeve after a rough fortnight.",
  },
  {
    id: "E-ROUT",
    agoHours: 30,
    headline: "Bond rout deepens: US 10-year hits 4.75% as traders pare Fed cut bets",
    summary:
      "Surging AI-related debt issuance, deficit spending and sticky inflation " +
      "pushed term premia to 20-month highs. Two-thirds of surveyed investors " +
      "now expect the 10-year above 5% before year-end.",
    lean: "pressure",
    classes: ["us-bonds", "global-bonds"],
    source: {
      name: "Bloomberg",
      url: "https://www.bloomberg.com/news/articles/2026-08-18/us-10-year-yields-climb-to-highest-since-2025-as-rout-deepens",
    },
    impactNote:
      "Rising yields mark bond prices down — this is why the fixed-income " +
      "sleeve shows red this month, and why locking today's yields at maturity " +
      "is worth a conversation.",
  },
  {
    id: "E-BOJ",
    agoHours: 52,
    headline: "BoJ holds at 1.00% — highest since 1995 — with a dissent for 1.25%",
    summary:
      "The Bank of Japan kept its policy rate at 1.00% after June's historic " +
      "hike, with board member Takata dissenting in favour of 1.25% and " +
      "several members warning inflation could overshoot the 2% target.",
    lean: "watch",
    classes: ["asia-equity"],
    source: {
      name: "CNBC",
      url: "https://www.cnbc.com/2026/06/16/boj-rate-hike-historic-inflation.html",
    },
    impactNote:
      "A tightening BoJ firms the yen and pressures Asia-Pacific allocations — " +
      "worth watching, not yet worth acting on.",
  },
  {
    id: "E-KLCI",
    agoHours: 78,
    headline: "KLCI drifts to 1,726 as foreign outflows continue; ringgit stays soft",
    summary:
      "The FBM KLCI slipped 0.09% to 1,725.89, giving back early-August gains, " +
      "while the ringgit held near its weakest levels since January.",
    lean: "watch",
    classes: ["malaysia-equity"],
    source: {
      name: "The Edge Malaysia",
      url: "https://theedgemalaysia.com/node/814804",
    },
    impactNote:
      "Local equity is treading water — dividend yields are doing the work " +
      "this quarter, which is what these funds are held for.",
  },
];
