/**
 * The phone log and the meeting notes, derived.
 *
 * Two sources that are not WhatsApp, measured the same way the messages are:
 * nothing here is authored, every figure comes from counting real records, and
 * a claim that cannot be traced is not made.
 *
 * ## Why calls are not folded into the message thread
 *
 * The obvious thing to do is interleave calls into `thread.messages` so every
 * existing signal picks them up for free. It would also silently corrupt the
 * one signal that matters most. Reply latency is computed from *adjacent*
 * advisor→client pairs in that array (src/signals.ts) — drop a call record
 * between two messages and the pair no longer touches, so the latency that made
 * Faizal look like he was fading would quietly stop being measured.
 *
 * So calls live beside the thread rather than in it, and produce their own
 * numbers. The four signals stay exactly what they were, and `verify-ui.ts`
 * still asserts there are four of them.
 */

import { DAY, NOW } from "../data/clock.ts";
import type { CallRecord } from "../data/calls.ts";
import { calls } from "../data/calls.ts";
import type { Consent, KeyPoint, Meeting, PointKind } from "../data/meetings.ts";
import { meetings } from "../data/meetings.ts";
import type { ClientKey } from "../data/types.ts";

const MIN = 60_000;

const ts = (iso: string): number => {
  const n = Date.parse(iso);
  if (Number.isNaN(n)) throw new Error(`Unparseable time: ${iso}`);
  return n;
};

const byId = new Map(calls.map((c) => [c.id, c]));

export interface CallStats {
  total: number;
  missed: number;
  /** Missed calls the advisor never returned. The number that matters. */
  unreturned: number;
  /** Share of all calls that were missed, 0-1. */
  missedRatio: number;
  /** Median minutes to return a missed call, or null if none were returned. */
  medianCallbackMin: number | null;
  /** Longest a miss went unreturned before it was, in minutes. */
  worstCallbackMin: number | null;
  /** Ids of the calls behind these figures. */
  evidence: string[];
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Call behaviour for one client.
 *
 * Only *inbound* misses count as unreturned: a call the advisor placed and the
 * client did not pick up is the client's to return, and counting it against the
 * advisor would flatter nobody. The asymmetry is the point — this measure
 * exists to catch the advisor's own dropped threads.
 */
export function callStats(key: ClientKey): CallStats {
  const mine = calls.filter((c) => c.client === key);
  const missed = mine.filter((c) => c.outcome === "missed");
  const inboundMissed = missed.filter((c) => c.direction === "in");

  const gaps: number[] = [];
  for (const m of inboundMissed) {
    if (!m.returnedBy) continue;
    const back = byId.get(m.returnedBy);
    if (!back) continue;
    gaps.push((ts(back.at) - ts(m.at)) / MIN);
  }

  return {
    total: mine.length,
    missed: missed.length,
    unreturned: inboundMissed.filter((c) => !c.returnedBy).length,
    missedRatio: mine.length ? missed.length / mine.length : 0,
    medianCallbackMin: median(gaps),
    worstCallbackMin: gaps.length ? Math.max(...gaps) : null,
    evidence: mine.map((c) => c.id),
  };
}

/** "43m" / "9.2h" / "9 days" — the same shape the latency figures use. */
export function fmtGap(min: number | null): string {
  if (min === null) return "—";
  if (min < 90) return `${Math.round(min)}m`;
  if (min < 48 * 60) return `${(min / 60).toFixed(1)}h`;
  return `${Math.round(min / 1440)} days`;
}

export interface Moment extends KeyPoint {
  /** The meeting it was said in. */
  meeting: string;
  where: string;
  /** Days ago, from the fixed clock. */
  daysAgo: number;
}

export interface ClientNotes {
  /** Every point, newest first. */
  moments: Moment[];
  meetings: Meeting[];
  /** Meetings that produced no notes, and why. */
  silent: Array<{ meeting: Meeting; reason: Consent }>;
  /** Points discarded because their meeting had no consent. */
  withheld: number;
}

/**
 * Key points for one client, newest first.
 *
 * ## The gate
 *
 * A meeting without granted consent contributes nothing, and that is enforced
 * here rather than trusted to the data. It is the same shape as the ledger's
 * verbatim rule: the check lives in code, so an entry that should not be shown
 * cannot be shown by writing it down anyway.
 *
 * The meetings themselves are still listed. "We met for 38 minutes and he
 * declined recording" is information; dropping the meeting entirely would make
 * the relationship look emptier than it is.
 */
export function notesFor(key: ClientKey): ClientNotes {
  const mine = meetings.filter((m) => m.client === key).sort((a, b) => ts(b.at) - ts(a.at));

  const moments: Moment[] = [];
  const silent: ClientNotes["silent"] = [];
  let withheld = 0;

  for (const m of mine) {
    if (m.consent !== "granted") {
      // Points on a meeting nobody consented to are not shown, whatever the
      // data says. Counted, so the absence is visible rather than invisible.
      withheld += m.points.length;
      silent.push({ meeting: m, reason: m.consent });
      continue;
    }
    for (const p of m.points) {
      moments.push({
        ...p,
        meeting: m.id,
        where: m.where,
        daysAgo: Math.max(0, Math.round((NOW - ts(p.at)) / DAY)),
      });
    }
  }

  moments.sort((a, b) => ts(b.at) - ts(a.at));
  return { moments, meetings: mine, silent, withheld };
}

/** Glyph per kind, so a list of notes is scannable without reading it. */
export const POINT_GLYPH: Record<PointKind, string> = {
  personal: "◆",
  concern: "▲",
  goal: "◎",
  promise: "◷",
  fact: "▪",
};

export const POINT_LABEL: Record<PointKind, string> = {
  personal: "personal",
  concern: "concern",
  goal: "goal",
  promise: "promise",
  fact: "fact",
};

/** Everything, for the verification script. */
export const allCalls: CallRecord[] = calls;
