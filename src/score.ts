/**
 * PROVISIONAL SCORING — delete this file in Stage 2.
 *
 * convex/baselines.ts and convex/decay.ts don't exist yet, and the dashboard
 * needs something in the score column. So this is the smallest honest stand-in:
 * it consumes the *measured* signals from src/signals.ts and turns each one into
 * a severity, relative to that client's own baseline and nobody else's.
 *
 * What it is not:
 *   · not tuned — the weights and knees below are a first guess
 *   · not sentiment-aware — the real silent-churn override also requires
 *     sentiment to be inside normal range. There is no sentiment signal until
 *     the extraction pass exists, so this version leans on latency alone as the
 *     "nothing looks wrong on the surface" test.
 *
 * The numbers it *displays* are measured facts. The severities and the composite
 * are the provisional part, and the UI says so.
 */

import type { Signals, Windows } from "./signals.ts";

export type SignalName = "latency" | "initiation" | "questions" | "length";
export type Status = "healthy" | "watch" | "silent" | "decaying";

export interface SignalScore {
  name: SignalName;
  label: string;
  /** 0 = indistinguishable from this client's baseline, 1 = fully collapsed. */
  severity: number;
  baseline: string;
  recent: string;
  /** Signed percentage change, or null when a baseline of zero makes it meaningless. */
  changePct: number | null;
  /** externalIds of the messages this signal was computed from. */
  evidence: string[];
  /** Plain-language note, shown under the bar. */
  note: string;
}

export interface Score {
  signals: SignalScore[];
  /** 0–100. Always presented alongside the breakdown, never on its own. */
  composite: number;
  status: Status;
  silent: boolean;
  headline: string;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A rise this many times over baseline counts as fully collapsed. */
const LATENCY_KNEE = 4;

/** How much each signal contributes to the composite. Untuned. */
const WEIGHTS: Record<SignalName, number> = {
  latency: 0.3,
  initiation: 0.25,
  questions: 0.25,
  length: 0.2,
};

/** Severity of a metric that is bad when it *falls* (questions, initiation, length). */
function dropSeverity(baseline: number, recent: number): number {
  if (baseline <= 0) return 0;
  return clamp01((baseline - recent) / baseline);
}

/** Severity of a metric that is bad when it *rises* (latency). */
function riseSeverity(baseline: number | null, recent: number | null): number {
  if (baseline === null || baseline <= 0) return 0;
  if (recent === null) return 1; // stopped replying altogether
  return clamp01((recent / baseline - 1) / (LATENCY_KNEE - 1));
}

export function fmtMinutes(min: number | null): string {
  if (min === null) return "never";
  if (min < 90) return `${Math.round(min)}m`;
  if (min < 48 * 60) return `${(min / 60).toFixed(1)}h`;
  return `${(min / 1440).toFixed(1)}d`;
}

function pct(baseline: number, recent: number): number | null {
  if (baseline === 0) return null;
  return Math.round(((recent - baseline) / baseline) * 100);
}

function latencyEvidence(s: Signals): string[] {
  return s.latencies.map((l) => l.replyId);
}

export function score(w: Windows): Score {
  const b = w.baseline;
  const r = w.recent;

  const latency: SignalScore = {
    name: "latency",
    label: "reply latency",
    severity: riseSeverity(b.medianLatencyMin, r.medianLatencyMin),
    baseline: fmtMinutes(b.medianLatencyMin),
    recent: fmtMinutes(r.medianLatencyMin),
    changePct:
      b.medianLatencyMin && r.medianLatencyMin ? pct(b.medianLatencyMin, r.medianLatencyMin) : null,
    evidence: latencyEvidence(r),
    note: `median of ${r.latencies.length} ${r.latencies.length === 1 ? "reply" : "replies"} in the last 30 days`,
  };

  const bRatio = b.initiationRatio ?? 0;
  const rRatio = r.initiationRatio ?? 0;
  const initiation: SignalScore = {
    name: "initiation",
    label: "conversations they start",
    severity: dropSeverity(bRatio, rRatio),
    baseline: `${Math.round(bRatio * 100)}%`,
    recent: `${Math.round(rRatio * 100)}%`,
    changePct: pct(bRatio, rRatio),
    evidence: r.clientInitiatedIds,
    note:
      r.clientInitiated === 0
        ? `all ${r.conversations} of the last 30 days' conversations were started by you`
        : `${r.clientInitiated} of ${r.conversations} recent conversations started by them`,
  };

  const questions: SignalScore = {
    name: "questions",
    label: "questions asked",
    severity: dropSeverity(b.questionsPer30d, r.questionsPer30d),
    baseline: `${b.questionsPer30d.toFixed(1)}/mo`,
    recent: `${r.questionsPer30d.toFixed(1)}/mo`,
    changePct: pct(b.questionsPer30d, r.questionsPer30d),
    evidence: r.questionIds,
    note:
      r.questions === 0
        ? "not one question in the last 30 days"
        : `${r.questions} in the last 30 days`,
  };

  const length: SignalScore = {
    name: "length",
    label: "message length",
    severity: dropSeverity(b.avgClientChars, r.avgClientChars),
    baseline: `${b.avgClientChars} ch`,
    recent: `${r.avgClientChars} ch`,
    changePct: pct(b.avgClientChars, r.avgClientChars),
    evidence: [],
    note: `mean over ${r.clientMessages} of their messages`,
  };

  const signals = [latency, initiation, questions, length];
  const composite = Math.round(
    signals.reduce((sum, s) => sum + s.severity * WEIGHTS[s.name], 0) * 100,
  );

  /**
   * The silent-churn override, stated explicitly: latency still normal, but
   * question flow and initiation have both collapsed. It fires regardless of
   * where the composite lands — that is the entire point of having it, because
   * a client whose latency is fine drags the composite down into "watch".
   */
  const silent =
    latency.severity < 0.25 && questions.severity > 0.6 && initiation.severity > 0.6;

  const status: Status = silent
    ? "silent"
    : composite >= 55
      ? "decaying"
      : composite >= 30
        ? "watch"
        : "healthy";

  const headline = silent
    ? `Replies in ${r.medianLatencyMin === null ? "—" : fmtMinutes(r.medianLatencyMin)}, and hasn't asked a single question in 30 days`
    : status === "decaying"
      ? `Replies ${latency.changePct ? `${latency.changePct}%` : "much"} slower, ${questions.recent} questions, ${initiation.recent} of conversations theirs`
      : status === "watch"
        ? `Drifting — ${signals.filter((s) => s.severity > 0.4).map((s) => s.label).join(" and ") || "mild movement"} off baseline`
        : "Steady on all four signals";

  return { signals, composite, status, silent, headline };
}

export function severityBand(sev: number): "none" | "mild" | "bad" | "gone" {
  if (sev < 0.15) return "none";
  if (sev < 0.45) return "mild";
  if (sev < 0.75) return "bad";
  return "gone";
}
