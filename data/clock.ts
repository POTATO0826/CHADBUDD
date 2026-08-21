/**
 * One reference "now" for the whole build.
 *
 * The seed threads are fixed in time, so anything that talks about "the last
 * 30 days" has to measure from a fixed point or the demo drifts out from under
 * itself. Every window — baselines, recent metrics, the dashboard — reads this.
 */

export const NOW_ISO = "2026-08-17T12:00:00+08:00";
export const NOW = Date.parse(NOW_ISO);

export const DAY = 86_400_000;

/** Most recent 30 days: (NOW - 30d, NOW]. */
export const RECENT_DAYS = 30;

/** Baseline: the 90 days ending where the recent window starts. */
export const BASELINE_DAYS = 90;

export const RECENT_FROM = NOW - RECENT_DAYS * DAY;
export const BASELINE_FROM = RECENT_FROM - BASELINE_DAYS * DAY;
export const BASELINE_TO = RECENT_FROM;
