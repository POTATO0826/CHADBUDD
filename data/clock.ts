/**
 * One reference "now" for the whole build.
 *
 * The seed threads are fixed in time, so anything that talks about "the last
 * 30 days" has to measure from a fixed point or the demo drifts out from under
 * itself. Every window — baselines, recent metrics, the dashboard — reads this.
 */

export const NOW_ISO = "2026-08-17T12:00:00+08:00";

export const DAY = 86_400_000;

/** Most recent 30 days: (NOW - 30d, NOW]. */
export const RECENT_DAYS = 30;

/** Baseline: the 90 days ending where the recent window starts. */
export const BASELINE_DAYS = 90;

/**
 * `let`, not `const`, so live mode can move the clock.
 *
 * The seed threads are fixed in time and must stay measured from a fixed
 * point, so this still defaults to NOW_ISO and the demo reads identically
 * every run. Real conversations need a real clock, and `setNow` is how it
 * moves — see src/live.ts.
 *
 * These are exported bindings rather than a getter because every consumer
 * already imports them by name. ES modules make imports live views of the
 * binding, so reassigning here updates all six importing modules without a
 * single call site changing.
 */
export let NOW = Date.parse(NOW_ISO);
export let RECENT_FROM = NOW - RECENT_DAYS * DAY;
export let BASELINE_FROM = RECENT_FROM - BASELINE_DAYS * DAY;
export let BASELINE_TO = RECENT_FROM;

/** Move the reference point. Call before deriving, never during a render. */
export function setNow(ms: number): void {
  NOW = ms;
  RECENT_FROM = NOW - RECENT_DAYS * DAY;
  BASELINE_FROM = RECENT_FROM - BASELINE_DAYS * DAY;
  BASELINE_TO = RECENT_FROM;
}
