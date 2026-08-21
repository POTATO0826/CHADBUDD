/**
 * Whether the assistant may answer on the advisor's behalf.
 *
 * ── the premise ──────────────────────────────────────────────────────
 * Risk is not a property of the message. It is a property of the message *and*
 * the relationship it is being sent into. "What is the current FD rate?" is the
 * same question from every client on the book, and the right handling differs
 * for each of them: Priya gets an answer, Adrian does not — because a cheerful
 * rate quote sent to a man still waiting on a comparison promised 104 days ago
 * says the machine is paying attention and the advisor is not.
 *
 * A lookup table cannot express that. Gates can.
 *
 * ── gates first, score second ────────────────────────────────────────
 * Nine gates, each of which forces a human regardless of anything else. What
 * survives all nine is then scored, and the score only chooses between degrees
 * of "probably fine". The gates do the safety work; the score does the tuning.
 *
 * ── why the gates carry all the weight here ──────────────────────────
 * This build sends immediately. There is no outbox, no hold, no recall — so a
 * wrong send is permanent, and the gates are the entire safety mechanism rather
 * than the first of two. That is why they fail closed without exception, why
 * `first-of-kind` exists at all, and why every decision records the gates it
 * tripped: with nothing to recall, the log is the only recourse left.
 */

import { NOW } from "../data/clock.ts";
import type { ClientKey } from "../data/types.ts";
import { clientById } from "./derive.ts";
import { openEntries } from "./ledger.ts";

export type GateId =
  | "advice"
  | "uncited"
  | "silent"
  | "decaying"
  | "owed"
  | "complaint"
  | "asked-human"
  | "restricted"
  | "rate-limit"
  | "first-of-kind";

/** What each gate means, in the advisor's language. Shown, not just logged. */
export const GATE_REASON: Record<GateId, string> = {
  advice: "this is a recommendation — regulated activity, and it carries your name",
  uncited: "no current source for the figure",
  silent: "they have stopped asking questions — this one needs your voice",
  decaying: "this relationship is slipping — answered, but you should see it",
  owed: "you owe them something that has not been delivered",
  complaint: "they raised a complaint or mentioned leaving",
  "asked-human": "they asked to speak to you directly",
  restricted: "competitor, complaint or compliance topic",
  "rate-limit": "already answered automatically today",
  "first-of-kind": "first time answering this for them — approve once and it is earned",
};

/**
 * The five tiers.
 *
 * T4 is the one that matters. For a decaying relationship the correct output is
 * not a better draft, it is no draft — and a note saying so. An assistant that
 * ghost-writes relationship repair is the failure mode, not the feature.
 */
export type Tier = "T0" | "T1" | "T2" | "T3" | "T4";

export const TIER_ACTION: Record<Tier, string> = {
  T0: "sent",
  T1: "sent · flagged",
  T2: "held for approval",
  T3: "held · evidence required",
  T4: "not drafted",
};

export type Outcome = "sent" | "held" | "refused";

export interface Source {
  /** Where the figure came from. */
  ref: string;
  /** ISO date the figure stops being current. */
  validUntil: string;
}

/**
 * What kind of message this is, which decides which gates even apply.
 *
 *   answer   a reply to what they asked — the content gates all apply
 *   status   where the advisor is and when they are free — availability only
 *
 * The distinction is not cosmetic. Michelle is refused an *answer*, because a
 * silently churning relationship needs a person. She should still be told he
 * is in a meeting until 3:15 — leaving her waiting with no word is the same
 * neglect the product exists to catch, performed by the tool itself.
 */
export type MessageClass = "answer" | "status";

export interface Ask {
  client: ClientKey;
  /** Defaults to `answer`, which is the stricter path. */
  kind?: MessageClass;
  /** What kind of thing is being answered. Used for first-of-kind. */
  intent: string;
  /** The client's words, scanned for the complaint and human gates. */
  asked: string;
  /** The proposed reply, scanned for advice language. */
  reply: string;
  /** Required whenever the reply states a figure. */
  source?: Source;
  /** How many auto-replies this client has already had today. */
  sentToday: number;
  /** Whether this intent has been approved for this client before. */
  seenBefore: boolean;
}

export interface Score {
  /** 1 = published today, 0 = expired. */
  freshness: number;
  /** 0 = identical for every client, 1 = depends on theirs. */
  specificity: number;
  /** 0 = an apology fixes it, 1 = money moves. */
  consequence: number;
  /** 0 = answered this before, 1 = never seen. */
  novelty: number;
  /** Weighted total, 0-1. Higher is riskier. */
  total: number;
}

export interface Decision {
  client: ClientKey;
  intent: string;
  tier: Tier;
  outcome: Outcome;
  gates: GateId[];
  score: Score;
  /** The first gate tripped, or the score's verdict. */
  reason: string;
  /**
   * Populated for the learning loop, which is designed but not yet running.
   * Kept on the record now so the log does not need migrating later.
   */
  editedBeforeApproval?: boolean;
  approvedUnchangedCount?: number;
}

/** Caps per client per day. Two in a row without a human between is a bot. */
const DAILY_CAP = 3;

/**
 * Speech acts the automatic tier is allowed to perform.
 *
 * A whitelist rather than a blocklist, because the failure mode is a phrasing
 * nobody thought to ban. Anything that reads as a recommendation, a prediction
 * or a reassurance about performance is advice, whoever typed it.
 */
const ADVICE_MARKERS = [
  "i recommend", "you should", "i'd suggest", "i suggest", "better option",
  "best for you", "worth switching", "i'd go with", "will likely return",
  "expect returns", "guaranteed", "you'll be fine", "don't worry",
  "in your case", "for someone like you",
];

const COMPLAINT_MARKERS = [
  "disappointed", "unhappy", "complaint", "complain", "another adviser",
  "moving my", "switch adviser", "close my account", "not happy", "frustrated",
];

const HUMAN_MARKERS = ["call me", "speak to you", "rather talk", "can we meet", "phone me"];

const RESTRICTED_MARKERS = ["competitor", "ombudsman", "regulator", "bank negara", "complaint form"];

const has = (text: string, markers: string[]): boolean => {
  const s = text.toLowerCase();
  return markers.some((m) => s.includes(m));
};

/** Days until a source stops being current. Negative once it has expired. */
function daysValid(src: Source | undefined): number | null {
  if (!src) return null;
  const until = Date.parse(src.validUntil);
  if (Number.isNaN(until)) return null;
  return Math.round((until - NOW) / 86_400_000);
}

/**
 * Run the nine gates.
 *
 * Order matters only for which reason is shown first, and it is deliberately
 * the order an advisor would care about: the relationship before the paperwork.
 */
export function gatesFor(ask: Ask): GateId[] {
  const out: GateId[] = [];
  const c = clientById(ask.client.toLowerCase());

  /* A status message says only where the advisor is. It carries no figure, no
     recommendation and nothing about their money, so the gates that exist to
     stop those do not apply to it — and applying them anyway would mean the
     clients most at risk of being neglected are the ones told nothing while
     they wait.

     Three still apply, and they are the ones that are about the person rather
     than the content: a complaint, an explicit request for a human, and the
     rate limit. Somebody who has said they want to talk to you does not want
     an automated note about your calendar. */
  if (ask.kind === "status") {
    if (has(ask.asked, COMPLAINT_MARKERS)) out.push("complaint");
    if (has(ask.asked, HUMAN_MARKERS)) out.push("asked-human");
    if (ask.sentToday >= DAILY_CAP) out.push("rate-limit");
    return out;
  }

  /* The gates no generic assistant has, and the reason this product can make
     the call at all: both come free from the engine already running.

     Split, because the first version was one gate and it was too blunt — it
     refused to tell a decaying client when his premium debits, which is not
     safety, it is worse service. Silence is the case that genuinely needs a
     person; ordinary decay just needs the advisor to see that a machine
     touched the relationship. */
  if (c.score.silent) out.push("silent");
  else if (c.score.status === "decaying") out.push("decaying");
  if (openEntries(ask.client).some((e) => e.owedBy === "advisor")) out.push("owed");

  if (has(ask.asked, COMPLAINT_MARKERS) || has(ask.reply, COMPLAINT_MARKERS)) out.push("complaint");
  if (has(ask.asked, HUMAN_MARKERS)) out.push("asked-human");
  if (has(ask.asked, RESTRICTED_MARKERS) || has(ask.reply, RESTRICTED_MARKERS)) out.push("restricted");
  if (has(ask.reply, ADVICE_MARKERS)) out.push("advice");

  // A figure with no source, or one whose source has expired, is a number the
  // assistant is inventing — which is the one thing this product does not do.
  const valid = daysValid(ask.source);
  if (/\d/.test(ask.reply) && (valid === null || valid < 0)) out.push("uncited");

  if (ask.sentToday >= DAILY_CAP) out.push("rate-limit");

  // With no outbox there is no undo, so nothing fires into a category it has
  // never been approved for. One click per category per client, then earned.
  if (!ask.seenBefore) out.push("first-of-kind");

  return out;
}

/** Which tier a tripped gate forces. The worst tripped gate wins. */
const GATE_TIER: Record<GateId, Tier> = {
  silent: "T4",
  // Sends, but never invisibly: every automated touch on a slipping
  // relationship lands in front of the advisor.
  decaying: "T1",
  complaint: "T4",
  "asked-human": "T4",
  advice: "T3",
  restricted: "T3",
  owed: "T2",
  uncited: "T2",
  "rate-limit": "T2",
  "first-of-kind": "T2",
};

const RANK: Record<Tier, number> = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4 };

export function scoreFor(ask: Ask): Score {
  const valid = daysValid(ask.source);
  const freshness = valid === null ? 0 : Math.max(0, Math.min(1, valid / 60));
  // A reply that names the client, or reasons about their circumstances, is not
  // the same answer for everyone.
  const specificity = /\byour\b|\byou\b/i.test(ask.reply) ? 0.4 : 0.1;
  const consequence = /\d+(\.\d+)?%|rm\s?\d/i.test(ask.reply) ? 0.6 : 0.2;
  const novelty = ask.seenBefore ? 0 : 1;

  const total =
    (1 - freshness) * 0.3 + specificity * 0.2 + consequence * 0.3 + novelty * 0.2;

  return { freshness, specificity, consequence, novelty, total: Math.min(1, total) };
}

/**
 * The decision, and why.
 *
 * Fails closed by construction: the tier only ever moves *up* from the score's
 * verdict, never down, so no gate can be scored away.
 */
export function decide(ask: Ask): Decision {
  const gates = gatesFor(ask);
  const score = scoreFor(ask);

  let tier: Tier = score.total < 0.25 ? "T0" : score.total < 0.5 ? "T1" : "T2";
  for (const g of gates) {
    const forced = GATE_TIER[g];
    if (RANK[forced] > RANK[tier]) tier = forced;
  }

  const outcome: Outcome = tier === "T4" ? "refused" : tier === "T0" || tier === "T1" ? "sent" : "held";

  const reason =
    gates.length > 0
      ? GATE_REASON[gates[0]!]
      : tier === "T0"
        ? "published fact, current source, nothing owed"
        : "fine to send, worth a glance";

  return { client: ask.client, intent: ask.intent, tier, outcome, gates, score, reason };
}
