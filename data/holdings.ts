/**
 * What each client actually holds.
 *
 * The layer the desk runs on. The threads carry the relationship; this carries
 * the money — funds, plans, values, maturity dates — because the target user is
 * an investment-led advisor and the service they sell is precisely "here is
 * where your money stands and why". See README, "Who this is built for".
 *
 * ── dates are offsets, not timestamps ────────────────────────────────
 * `maturesInDays` and `lastUpdateDaysAgo` are resolved against the live clock
 * in src/desk.ts, never stored as ISO here. A hand-written date is perfect on
 * the day it is written and wrong two weeks later — the demo that ran fine on
 * Thursday shows an expired maturity on launch day. Offsets track whichever
 * clock is active: frozen Monday in seed mode, the real one in live mode.
 * The two exceptions carry a fixed ISO because a *message* states the date
 * (A-040, B-042 both say the September renewal) and the data must not
 * contradict what the client was told.
 *
 * ── where the numbers come from ──────────────────────────────────────
 * Values and the 12-month series are hand-written, and shaped to agree with
 * data/market.ts: the bond funds sag into August because the August bond rout
 * is real, the tech sleeve runs up and wobbles, the money market line is flat.
 * A series that contradicted the news it sits next to would be the kind of
 * staging a judge catches in one glance.
 */

import type { ClientKey } from "./types.ts";

/**
 * Asset classes double as the join key to market events: an event tagged
 * `us-bonds` lands on every holding tagged `us-bonds`. Deliberately coarse —
 * a real system maps by fund constituents; the coarse version is honest about
 * being a filter, and a filter is all the desk claims.
 */
export type AssetClass =
  | "us-bonds"
  | "global-bonds"
  | "asia-equity"
  | "malaysia-equity"
  | "global-equity"
  | "tech-equity"
  | "money-market";

export interface Holding {
  id: string;
  client: ClientKey;
  /** Fund or plan name, as it appears on the client's statement. */
  name: string;
  kind: "fund" | "structured" | "prs" | "plan";
  classes: AssetClass[];
  /** Current value, RM. */
  value: number;
  /** Cost basis, RM — what went in. */
  invested: number;
  /**
   * Last 12 month-end values as % of a year ago (index 0 = 11 months back,
   * index 11 = now). Drawn as the sparkline and quoted in the brief.
   */
  series: number[];
  /** Days until the plan matures, where it does. Resolved against nowMs(). */
  maturesInDays?: number;
  /** Fixed maturity where a cited message states the date. Wins over offset. */
  maturesAtIso?: string;
  /** Days since the advisor last sent this client an update on this holding. */
  lastUpdateDaysAgo: number;
}

/* Hand-shaped 12-month curves per flavour. Bond curves sag at the tail —
   August's rout is real (see data/market.ts E-ROUT) and the chart must agree
   with the news beside it. */
const BOND_SAG = [100, 100.8, 101.5, 102.1, 102.6, 103.4, 104.0, 104.6, 104.1, 103.2, 101.9, 100.7];
const KLCI_FLAT = [100, 101.2, 102.8, 101.9, 103.5, 104.8, 106.1, 105.2, 106.9, 107.4, 106.6, 106.1];
const TECH_RUN = [100, 103, 108, 105, 112, 118, 124, 121, 129, 136, 132, 134];
const GLOBAL_MILD = [100, 101.5, 103.2, 102.4, 104.6, 106.3, 108.0, 107.1, 109.2, 110.5, 109.4, 110.1];
const CASH_FLAT = [100, 100.3, 100.6, 100.9, 101.2, 101.5, 101.8, 102.1, 102.4, 102.7, 103.0, 103.3];

export const holdings: Holding[] = [
  /* ── A · Priya — the maturing conversation ───────────────────────── */
  {
    id: "H-A1",
    client: "A",
    name: "Capital Secure Income Plan VII",
    kind: "structured",
    classes: ["us-bonds", "global-bonds"],
    value: 152_400,
    invested: 140_000,
    series: BOND_SAG,
    // Inside the 10-day window: this is the desk's urgent row.
    maturesInDays: 8,
    lastUpdateDaysAgo: 34,
  },
  {
    id: "H-A2",
    client: "A",
    name: "Global Sukuk Income Fund",
    kind: "fund",
    classes: ["global-bonds"],
    value: 88_700,
    invested: 82_000,
    series: BOND_SAG,
    lastUpdateDaysAgo: 34,
  },
  {
    id: "H-A3",
    client: "A",
    name: "Medical rider · September renewal",
    kind: "plan",
    classes: [],
    value: 0,
    invested: 0,
    series: CASH_FLAT,
    // A-040: "queued with the insurer for the September renewal" — the message
    // names the date, so the date is fixed rather than drifting with the demo.
    maturesAtIso: "2026-09-01T00:00:00+08:00",
    lastUpdateDaysAgo: 7,
  },

  /* ── B · Faizal — business money, rate-sensitive ─────────────────── */
  {
    id: "H-B1",
    client: "B",
    name: "Corporate Cash Management Fund",
    kind: "fund",
    classes: ["money-market"],
    value: 210_000,
    invested: 205_000,
    series: CASH_FLAT,
    lastUpdateDaysAgo: 41,
  },
  {
    id: "H-B2",
    client: "B",
    name: "Asia Pacific Bond Fund",
    kind: "fund",
    classes: ["global-bonds", "asia-equity"],
    value: 64_300,
    invested: 70_000,
    series: BOND_SAG,
    lastUpdateDaysAgo: 41,
  },
  {
    id: "H-B3",
    client: "B",
    name: "Keyman cover · September renewal",
    kind: "plan",
    classes: [],
    value: 0,
    invested: 0,
    series: CASH_FLAT,
    // B-042 states it: "your keyman premium renews 1 September".
    maturesAtIso: "2026-09-01T00:00:00+08:00",
    lastUpdateDaysAgo: 12,
  },

  /* ── C · Michelle — the condo-deposit plan, mid-journey ──────────── */
  {
    id: "H-C1",
    client: "C",
    name: "Balanced Growth Portfolio",
    kind: "fund",
    classes: ["global-equity", "global-bonds"],
    value: 118_900,
    invested: 104_000,
    series: GLOBAL_MILD,
    // The stale row: a plan she is actively paying into, and nobody has sent
    // her a word on it in a quarter. C-005 promised "I'll redo the page and
    // send it tomorrow" — the desk is what stops that going the way of D-012.
    lastUpdateDaysAgo: 96,
  },
  {
    id: "H-C2",
    client: "C",
    name: "Malaysia Dividend Equity Fund",
    kind: "fund",
    classes: ["malaysia-equity"],
    value: 46_200,
    invested: 45_000,
    series: KLCI_FLAT,
    lastUpdateDaysAgo: 96,
  },

  /* ── D · Adrian — holds tech, is being pitched two funds ─────────── */
  {
    id: "H-D1",
    client: "D",
    name: "Global Technology Fund",
    kind: "fund",
    classes: ["tech-equity", "global-equity"],
    value: 93_800,
    invested: 60_000,
    series: TECH_RUN,
    // 104 days: the same number as the comparison he has been owed since May.
    // One client, one pattern, visible from two directions.
    lastUpdateDaysAgo: 104,
  },
  {
    id: "H-D2",
    client: "D",
    name: "PRS Growth — self + spouse",
    kind: "prs",
    classes: ["malaysia-equity", "global-equity"],
    value: 71_500,
    invested: 66_000,
    series: KLCI_FLAT,
    lastUpdateDaysAgo: 58,
  },

  /* ── E · Vince — brand new, small, current ───────────────────────── */
  {
    id: "H-E1",
    client: "E",
    name: "Money Market Fund",
    kind: "fund",
    classes: ["money-market"],
    value: 10_000,
    invested: 10_000,
    series: CASH_FLAT,
    lastUpdateDaysAgo: 1,
  },
];
