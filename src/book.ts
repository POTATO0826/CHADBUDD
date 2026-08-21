/**
 * The book, derived: who is in which stage, and what matures when.
 *
 * ── the gate ─────────────────────────────────────────────────────────
 * Every entry's citations run through the ledger's own `findVerbatim`. An entry
 * whose ids do not resolve is dropped from the book entirely rather than drawn
 * on a guess — a client silently missing from the funnel is honest, a client
 * placed in a stage nothing supports is the thing this product exists not to do.
 *
 * ── the maturity window ──────────────────────────────────────────────
 * Two numbers, deliberately different. `MATURING_WINDOW` is how far ahead the
 * funnel counts something as maturing; `OUTREACH_LEAD` is when the assistant
 * drafts the renewal message. The gap between them is the advisor's own
 * thinking time — a product that appears in the funnel three months out has not
 * generated a task yet, which is the difference between a plan and a nag.
 */

import { DAY, NOW } from "../data/clock.ts";
import type { BookEntry, Stage } from "../data/book.ts";
import { STAGES, book } from "../data/book.ts";
import type { ClientKey } from "../data/types.ts";
import { findVerbatim } from "./ledger.ts";

/** How far ahead a maturity counts as "maturing". One quarter. */
export const MATURING_WINDOW = 90;

/** When the assistant drafts the renewal message. */
export const OUTREACH_LEAD = 7;

export interface BookRow extends BookEntry {
  /** Only the ids that resolve to a real message. */
  cites: string[];
  /** Days from now until it matures, or null when no date was ever stated. */
  daysToMaturity: number | null;
}

let dropped = 0;

const rows: BookRow[] = book
  .map((e) => {
    // Same gate the ledger applies to a promise.
    const cites = e.cites.filter((id) => findVerbatim(id, "") !== null);
    const ms = e.maturesAt ? Date.parse(e.maturesAt) : NaN;
    return {
      ...e,
      cites,
      daysToMaturity: Number.isNaN(ms) ? null : Math.round((ms - NOW) / DAY),
    };
  })
  .filter((e) => {
    // A stage nobody said anything to justify is not a stage.
    if (e.cites.length > 0) return true;
    dropped++;
    console.warn(`[chadbuddy] ${e.client} dropped from the book — no citation resolved`);
    return false;
  });

export const bookRows: BookRow[] = rows;

/** Entries dropped by the gate. Surfaced, never hidden. */
export const droppedEntries = dropped;

export function stageOf(key: ClientKey): Stage | null {
  return rows.find((r) => r.client === key)?.stage ?? null;
}

export function bookRowFor(key: ClientKey): BookRow | null {
  return rows.find((r) => r.client === key) ?? null;
}

export interface StageBucket {
  stage: Stage;
  count: number;
  clients: ClientKey[];
  /** Share of the book, 0-1. Used for the label, never for the bar width. */
  share: number;
}

/**
 * One bucket per stage, including the empty ones.
 *
 * Empty stages are kept rather than filtered out. A funnel that silently omits
 * "nobody is here" reads as a book with no gaps in it, and the gap is usually
 * the finding — nothing in `renewing` means nothing came back last quarter.
 */
export const buckets: StageBucket[] = STAGES.map((stage) => {
  const clients = rows.filter((r) => r.stage === stage).map((r) => r.client);
  return {
    stage,
    count: clients.length,
    clients,
    share: rows.length ? clients.length / rows.length : 0,
  };
});

export interface FunnelRow {
  stage: Stage;
  /** Clients who have reached this stage or moved past it. */
  reached: number;
  /** Clients sitting here right now. */
  here: number;
  /** Who is here right now — what a click on this segment filters to. */
  clients: ClientKey[];
}

/**
 * The funnel, as a funnel actually has to be: monotonically decreasing.
 *
 * The chart normalises every segment against the *first* one, so a stage that
 * exceeds it renders wider than its own container. Per-stage occupancy cannot
 * satisfy that — two clients can sit in `maturing` while nobody sits in
 * `completed`, and the shape would widen halfway along.
 *
 * So the width is `reached`: everyone who got this far, counting those who
 * moved beyond. That is monotonic by construction, and it is also the more
 * useful number — the step down between two segments is the conversion that
 * did not happen, which is the thing the advisor is being asked to work.
 *
 * `here` is carried alongside for the label, because occupancy is what a click
 * filters to. Reached tells you the shape of the book; here tells you who is
 * standing still in it.
 */
export const funnelStages: FunnelRow[] = STAGES.map((stage, i) => {
  const clients = rows.filter((r) => r.stage === stage).map((r) => r.client);
  const reached = rows.filter((r) => STAGES.indexOf(r.stage) >= i).length;
  return { stage, reached, here: clients.length, clients };
});

/**
 * Maturities inside the window, soonest first.
 *
 * This is the list the assistant drafts against, so it is sorted by urgency
 * rather than by client — the thing that matters is which deadline is nearest.
 */
export const maturingSoon: BookRow[] = rows
  .filter((r) => r.daysToMaturity !== null && r.daysToMaturity >= 0 && r.daysToMaturity <= MATURING_WINDOW)
  .sort((a, b) => (a.daysToMaturity ?? 0) - (b.daysToMaturity ?? 0));

/** Those close enough that a draft should already exist. */
export const dueForOutreach: BookRow[] = maturingSoon.filter(
  (r) => (r.daysToMaturity ?? Infinity) <= OUTREACH_LEAD,
);

export const bookTotals = {
  onBook: rows.length,
  maturingSoon: maturingSoon.length,
  dueForOutreach: dueForOutreach.length,
  /** The nearest deadline, for the dashboard figure. */
  nextMaturityDays: maturingSoon[0]?.daysToMaturity ?? null,
};
