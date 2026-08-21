/**
 * What is waiting for the advisor, and what was dealt with without them.
 *
 * The problem this exists for: three hours of meetings, and the pile that
 * built up while you were in them. Messages, missed calls, questions that went
 * cold. Every inbox shows you the pile. What none of them show is how much of
 * it never needed you — and that number is the whole argument for the product.
 *
 * ── the three tiers, and why the line falls there ────────────────────
 * A published rate is the same answer for every client on the book. Whether a
 * client should act on it is not, and a recommendation from a licensed advisor
 * is regulated activity. So:
 *
 *   factual     answered automatically — rates, terms, mechanics, logistics
 *   advisory    drafted, held for approval — anything about their money
 *   relational  never drafted for sending — the case the product exists for
 *
 * The third tier is the one worth defending. Michelle needs a question only she
 * can answer, asked by the person she has the relationship with. An assistant
 * that auto-sends relationship repair is the failure mode, not the feature.
 *
 * ── measured, not authored ───────────────────────────────────────────
 * Call-backs come from the phone log and follow-ups from the threads. Both are
 * counted from real records, so the list is right for whatever data is loaded
 * rather than right for the demo. Only the handled tier is seeded, and it says
 * so on screen.
 */

import { DAY, NOW } from "../data/clock.ts";
import { calls } from "../data/calls.ts";
import type { HandledReply } from "../data/handled.ts";
import { handled } from "../data/handled.ts";
import type { ClientKey } from "../data/types.ts";
import { threads } from "../data/threads/index.ts";
import { approvals } from "./copy.ts";
import type { Decision } from "./gates.ts";
import { decide } from "./gates.ts";
import { notesFor } from "./contact.ts";
import { openDays, openEntries } from "./ledger.ts";

/**
 * How long something sits before it counts as needing a chase.
 *
 * Three days. Under that it is a weekend or a busy week; past it, a thing that
 * had momentum has stopped having it, and the moment to pick it back up is
 * closing. The only threshold in the file, and a judgement — stated here rather
 * than buried in a condition.
 */
export const STALE_DAYS = 3;

export type TaskKind = "call-back" | "approve" | "follow-up" | "answer";

export interface Task {
  kind: TaskKind;
  client: ClientKey;
  /** One line, in the advisor's language. */
  what: string;
  /** Why this one needs a person. */
  why: string;
  /** Messages or calls behind it. */
  cites: string[];
  /** How long it has been waiting. Drives the ordering. */
  days: number;
}

const ts = (iso: string): number => Date.parse(iso);
const daysSince = (ms: number): number => Math.max(0, Math.round((NOW - ms) / DAY));

/**
 * Inbound calls that were never returned.
 *
 * Only inbound: a call the advisor placed and the client did not take is the
 * client's to return. Counting it here would pad the list with work that is not
 * the advisor's, which is the fastest way to make a to-do list ignorable.
 */
function callBacks(): Task[] {
  return calls
    .filter((c) => c.direction === "in" && c.outcome === "missed" && !c.returnedBy)
    .map((c) => ({
      kind: "call-back" as const,
      client: c.client,
      what: "Missed call, never returned",
      why: "They called you and nobody called back",
      cites: [c.id],
      days: daysSince(ts(c.at)),
    }));
}

/**
 * Things the advisor said they would do, and has not.
 *
 * Three definitions were measured against the real threads before this one was
 * kept. "The client asked and never got an answer" finds nothing — the advisor
 * always replies. "They spoke last and you have not" finds three clients at two
 * or three days, which is a Tuesday rather than a problem. Open obligations owed
 * by the advisor find Adrian: a fund comparison promised on 5 May, re-promised
 * on 20 May, still unsent 104 days later.
 *
 * That is the shape worth surfacing — an inquiry that was never completed,
 * rather than a message that was never sent. It also carries its own evidence:
 * every entry cites the message the promise was made in, so the follow-up
 * arrives with the advisor's own words attached.
 */
function followUps(): Task[] {
  const out: Task[] = [];

  for (const t of threads) {
    for (const e of openEntries(t.key)) {
      // Only what the advisor owes. What a client owes is not the advisor's
      // task list, and padding it with their obligations is how a to-do list
      // stops being read.
      if (e.owedBy !== "advisor") continue;

      const days = openDays(e);
      if (days < STALE_DAYS) continue;

      out.push({
        kind: "follow-up",
        client: t.key,
        what: e.text,
        why: `${e.kind} open ${days} days`,
        cites: [e.sourceMessageId],
        days,
      });
    }
  }

  return out;
}
/** Drafts the assistant will not send on its own. */
function toApprove(): Task[] {
  return approvals
    .filter((a) => !a.done && a.go)
    .map((a) => ({
      kind: "approve" as const,
      client: a.go!.client,
      what: a.title,
      why: a.meta,
      cites: [],
      // Authored rows carry no timestamp, so they sort below anything measured
      // rather than being given an age they do not have.
      days: 0,
    }));
}


export function tasksOfKind(kind: TaskKind): Task[] {
  return tasks.filter((t) => t.kind === kind);
}

export interface Assisted {
  reply: HandledReply;
  decision: Decision;
  /** For a refusal: what to ask instead, and where it came from. */
  prompt?: { text: string; cite: string };
}

/**
 * What to ask when the assistant will not write the message.
 *
 * Drawn from the meeting notes rather than generated, which is the point: the
 * thing worth asking a quiet client is something they already told you and
 * nobody wrote down. Michelle moved her condo target forward by a year in June
 * and never said why — that is a better opening than any draft.
 *
 * Goals first, then anything personal. A fact is not a conversation.
 */
function promptFor(client: ClientKey): { text: string; cite: string } | undefined {
  const notes = notesFor(client).moments;
  const pick = notes.find((n) => n.kind === "goal") ?? notes.find((n) => n.kind === "personal");
  if (!pick) return undefined;
  return { text: pick.text, cite: pick.id };
}

/**
 * Every seeded reply, put through the gates.
 *
 * The seed claims all nine were sent automatically. Running the gates over it
 * says otherwise — three send, three need approving, three should never have
 * been drafted at all. That disagreement is the system working: the data was
 * authored before the rules existed, and the rules win.
 */
const assisted: Assisted[] = (() => {
  const out: Assisted[] = [];
  const perClient: Partial<Record<ClientKey, number>> = {};

  for (const reply of [...handled].sort((a, b) => ts(a.at) - ts(b.at))) {
    const decision = decide({
      client: reply.client,
      intent: reply.kind,
      asked: reply.asked,
      reply: reply.sent,
      source: reply.source,
      sentToday: perClient[reply.client] ?? 0,
      seenBefore: reply.earned === true,
    });
    if (decision.outcome === "sent") {
      perClient[reply.client] = (perClient[reply.client] ?? 0) + 1;
    }
    out.push({
      reply,
      decision,
      prompt: decision.tier === "T4" ? promptFor(reply.client) : undefined,
    });
  }

  return out.reverse();
})();

export const decisions: Assisted[] = assisted;

/** Only what actually went out. */
export const handledToday: Assisted[] = assisted.filter((a) => a.decision.outcome === "sent");

const heldByGate: Assisted[] = assisted.filter((a) => a.decision.outcome === "held");
const refused: Assisted[] = assisted.filter((a) => a.decision.outcome === "refused");

/** Drafts the gates stopped, which are now the advisor's to send. */
function fromGates(): Task[] {
  const held = heldByGate.map((a) => ({
    kind: "approve" as const,
    client: a.reply.client,
    what: a.reply.asked,
    why: a.decision.reason,
    cites: a.reply.cite ? [a.reply.cite] : [],
    days: 0,
  }));

  // A refusal is not nothing happening. It is the assistant saying this one is
  // yours, and handing over what to ask.
  const mine = refused.map((a) => ({
    kind: "answer" as const,
    client: a.reply.client,
    what: a.reply.asked,
    why: a.decision.reason,
    cites: a.reply.cite ? [a.reply.cite] : [],
    days: 0,
  }));

  return [...mine, ...held];
}

/** Everything needing the advisor, most overdue first. */
export const tasks: Task[] = [
  ...callBacks(),
  ...followUps(),
  ...toApprove(),
  ...fromGates(),
].sort((a, b) => b.days - a.days);

export const inboxTotals = {
  needsYou: tasks.length,
  callBacks: tasksOfKind("call-back").length,
  approve: tasksOfKind("approve").length,
  followUp: tasksOfKind("follow-up").length,
  handled: handledToday.length,
  held: heldByGate.length,
  refused: refused.length,
  /** Everything that arrived, so the split can be stated as a share. */
  arrived: tasks.length + handledToday.length,
  /** The single most overdue thing. */
  worst: tasks[0] ?? null,
};

/** Glyph per kind — a count list should be scannable without reading it. */
export const TASK_GLYPH: Record<TaskKind, string> = {
  "call-back": "☏",
  approve: "◇",
  "follow-up": "◷",
  answer: "✎",
};

export const TASK_LABEL: Record<TaskKind, string> = {
  "call-back": "call back",
  approve: "approve",
  "follow-up": "follow up",
  answer: "answer",
};
