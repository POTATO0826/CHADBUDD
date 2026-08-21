/**
 * The four raw relationship signals, measured from messages.
 *
 * This is measurement only — no scoring, no thresholds, no judgement. It is
 * shared by the browser and by scripts/verify-seed.ts so there is exactly one
 * definition of "reply latency" in the codebase. When convex/decay.ts lands in
 * Stage 2 it consumes this, it does not reimplement it.
 */

import { BASELINE_FROM, BASELINE_TO, NOW, RECENT_FROM } from "../data/clock.ts";
import type { SeedMessage, SeedThread } from "../data/types.ts";
import { tsOf } from "../data/types.ts";

const HOUR = 3_600_000;

/** Silence after which the next message is a new conversation, not a reply. */
export const CONVERSATION_GAP = 12 * HOUR;

export interface Signals {
  /** Window the numbers describe, epoch ms. */
  from: number;
  to: number;
  days: number;

  messages: number;
  clientMessages: number;

  /** Median minutes for the client to answer the advisor. null = never replied. */
  medianLatencyMin: number | null;
  /** Every latency in the window, for the evidence list. */
  latencies: Array<{ minutes: number; replyId: string; toId: string }>;

  conversations: number;
  clientInitiated: number;
  /** clientInitiated / conversations, or null when there were no conversations. */
  initiationRatio: number | null;
  /** externalIds of the client messages that opened a conversation. */
  clientInitiatedIds: string[];

  questions: number;
  questionsPer30d: number;
  questionIds: string[];

  avgClientChars: number;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * A question is a client message containing a question mark. Deliberately
 * dumb and deliberately visible: the UI shows you which messages counted, so a
 * bad call is something you can see rather than something you have to trust.
 */
export function isQuestion(m: SeedMessage): boolean {
  return m.from === "client" && m.text.includes("?");
}

/**
 * Conversation boundaries for a whole thread.
 *
 * A new conversation starts after CONVERSATION_GAP of silence — unless the last
 * exchange is still one-sided, in which case the other party's next message is
 * a late reply and belongs to the conversation it answers. Without that clause
 * a client who takes 30 hours to reply looks like a client who started a
 * conversation, and decay reads as engagement.
 */
export function conversationStarts(all: SeedMessage[]): Set<string> {
  const starts = new Set<string>();
  let sawAdvisor = false;
  let sawClient = false;

  for (let i = 0; i < all.length; i++) {
    const m = all[i]!;
    const prev = i > 0 ? all[i - 1] : undefined;
    const silence = prev ? tsOf(m) - tsOf(prev) : Infinity;
    const stillOneSided = !(sawAdvisor && sawClient);

    if (!prev || (silence > CONVERSATION_GAP && !stillOneSided)) {
      starts.add(m.externalId);
      sawAdvisor = false;
      sawClient = false;
    }
    if (m.from === "advisor") sawAdvisor = true;
    else sawClient = true;
  }
  return starts;
}

/**
 * Signals over (from, to]. Conversation boundaries are computed on the full
 * thread first, so a window edge cannot invent an initiation that never
 * happened.
 */
export function measure(thread: SeedThread, from: number, to: number): Signals {
  const all = thread.messages;
  const starts = conversationStarts(all);
  const inWindow = (m: SeedMessage) => tsOf(m) > from && tsOf(m) <= to;

  const latencies: Signals["latencies"] = [];
  for (let i = 1; i < all.length; i++) {
    const m = all[i]!;
    const prev = all[i - 1]!;
    if (m.from !== "client" || prev.from !== "advisor" || !inWindow(m)) continue;
    latencies.push({
      minutes: (tsOf(m) - tsOf(prev)) / 60_000,
      replyId: m.externalId,
      toId: prev.externalId,
    });
  }

  const windowed = all.filter(inWindow);
  const clientMsgs = windowed.filter((m) => m.from === "client");
  const convos = windowed.filter((m) => starts.has(m.externalId));
  const clientConvos = convos.filter((m) => m.from === "client");
  const questionMsgs = clientMsgs.filter(isQuestion);
  const chars = clientMsgs.reduce((n, m) => n + m.text.length, 0);
  const days = (to - from) / 86_400_000;

  return {
    from,
    to,
    days,
    messages: windowed.length,
    clientMessages: clientMsgs.length,
    medianLatencyMin: median(latencies.map((l) => l.minutes)),
    latencies,
    conversations: convos.length,
    clientInitiated: clientConvos.length,
    initiationRatio: convos.length ? clientConvos.length / convos.length : null,
    clientInitiatedIds: clientConvos.map((m) => m.externalId),
    questions: questionMsgs.length,
    questionsPer30d: (questionMsgs.length / days) * 30,
    questionIds: questionMsgs.map((m) => m.externalId),
    avgClientChars: clientMsgs.length ? Math.round(chars / clientMsgs.length) : 0,
  };
}

export interface Windows {
  baseline: Signals;
  recent: Signals;
}

/** The two windows every comparison in the product uses. */
export function windows(thread: SeedThread): Windows {
  return {
    baseline: measure(thread, BASELINE_FROM, BASELINE_TO),
    recent: measure(thread, RECENT_FROM, NOW),
  };
}
