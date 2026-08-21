/**
 * Authored copy: the recommendations, the queues, the house rules.
 *
 * These are written by hand, not generated — the agent pass doesn't exist yet.
 * What makes them legitimate rather than decorative is that every claim in them
 * points at a real message id from the seed threads, and the numbers in them
 * (104 days, 44.7h, 2 reschedules) are the numbers src/signals.ts measures.
 *
 * They read differently from the design document in three places, because the
 * real threads say something different from the design's invented history:
 *
 *   · Faizal is NOT called today. On 15 Aug he answered the advisor's question
 *     with "Park it for now." (B-051). Ringing him the next morning ignores the
 *     one clear instruction he has given. The call reminder that fired on his
 *     two reschedules is now stale, and the queue says so.
 *   · Michelle's third idea is about the advisor closing her open question for
 *     her at C-054, which is what actually happened in the thread.
 *   · Priya has an outstanding instruction (A-068), so "do nothing" is second,
 *     not first.
 */

import type { ClientKey } from "../data/types.ts";
import type { Tone } from "./derive.ts";

/**
 * `intent` is what the recommendation actually is, stated rather than inferred
 * from the button label. "Send & set hold" and "Attach & send" both contain the
 * word send but one is a deliberate silence and the other is blocked, and the
 * overview counters were wrong until this was explicit.
 */
export type Intent = "send" | "hold" | "blocked" | "note";

export interface Idea {
  rank: string;
  title: string;
  why: string;
  draftLabel: string;
  draft: string;
  btn: string;
  meta: string;
  intent: Intent;
  primary?: boolean;
  cites: string[];
}

/** Ranked recommendations per client. Rank 1 is what to do today. */
export const ideas: Record<ClientKey, Idea[]> = {
  C: [
    {
      rank: "1",
      title: "Ask something only she can answer",
      why: "She agrees with everything, so anything answerable with yes will come back as “sounds good”. A question about her own plan can't be.",
      draftLabel: "draft · one question, no product",
      draft:
        "When we set this up in April the plan was to be looking at condo areas seriously by the end of the year. Is that still the timeline, or has it moved?",
      btn: "Send as me",
      meta: "no product mentioned",
      intent: "send",
      primary: true,
      cites: ["C-058", "C-059"],
    },
    {
      rank: "2",
      title: "Give her something to correct",
      why: "People who won't start a conversation will still fix a wrong assumption. Low effort for her, real signal for you.",
      draftLabel: "draft · an assumption to correct",
      draft:
        "I'm still working to the mid-2028 deposit date at RM1,900 a month. Tell me if either of those has changed and I'll redo the page.",
      btn: "Use this draft",
      meta: "invites a correction",
      intent: "send",
      cites: ["C-005"],
    },
    {
      rank: "3",
      title: "Stop answering her open questions for her",
      why:
        "On 6 Aug you took her silence on the Asia allocation as a no and closed it yourself. Efficient — but it removed the last thing she owed you, and she has owed you nothing since.",
      draftLabel: "what to do differently",
      draft:
        "Next time an item sits, leave it open and ask again rather than deciding it. An open question is the only reason a disengaged client has to come back.",
      btn: "Note on file",
      meta: "advisor-side habit",
      intent: "note",
      cites: ["C-043", "C-054"],
    },
  ],

  D: [
    {
      rank: "1",
      title: "Send the comparison. Nothing attached.",
      why:
        "104 days open, promised twice and now a third time. It is the only thing he ever asked you for, and any message that isn't it is the fourth ask.",
      draftLabel: "draft · unlocks when the file is attached",
      draft:
        "Adrian — the comparison, finally. Titans and Kenanga side by side: fees, five year returns and worst drawdown, no recommendation attached. Sorry it took this long.",
      btn: "Attach & send",
      meta: "blocked until a file is attached",
      intent: "blocked",
      primary: true,
      cites: ["D-012", "D-014", "D-044"],
    },
    {
      rank: "2",
      title: "Answer the question in the form he asked for",
      why:
        "He didn't ask for a view, he asked for a table — “I'd rather decide from a table than from a description”. A paragraph is what he already declined.",
      draftLabel: "draft · one line to go with the table",
      draft:
        "The short version if you'd rather not read it: Kenanga's worse year was 27% down against Titans' 18%, and it recovered faster. Your call, the numbers are all there.",
      btn: "Append to send",
      meta: "pair with idea 1",
      intent: "send",
      cites: ["D-011", "D-010"],
    },
    {
      rank: "3",
      title: "Do not promise it a fourth time",
      why:
        "Three days ago you said “properly this time”. A fourth promise costs more than the silence would — it teaches him your dates mean nothing.",
      draftLabel: "sequence",
      draft:
        "Send nothing else until the file exists. No check-in, no apology message, no product. The next thing he hears from you should be the attachment.",
      btn: "Hold all sends",
      meta: "reversible",
      intent: "hold",
      cites: ["D-044"],
    },
  ],

  B: [
    {
      rank: "1",
      title: "He asked you to park it. Park it.",
      why:
        "Two days ago you asked whether to leave him alone and he said “Park it for now.” That is the clearest thing he has said in a month. Calling him tomorrow answers a question he already answered.",
      draftLabel: "draft · one line, then nothing",
      draft:
        "Understood — parked. I'll leave it with you and check in after the cutter is installed. Shout if anything changes before then.",
      btn: "Send & set hold",
      meta: "hold until 1 Oct",
      intent: "hold",
      primary: true,
      cites: ["B-050", "B-051"],
    },
    {
      rank: "2",
      title: "The call reminder that fired is stale",
      why:
        "It fired on the two reschedules on 4 and 10 Aug, which were real friction. But he answered on the 15th. The reminder predates his answer — dismiss it rather than act on it.",
      draftLabel: "why the queue is wrong",
      draft:
        "Reschedules are a good trigger for a call. An explicit “park it” five days later has to outrank the trigger, or the product ends up arguing with the client.",
      btn: "Dismiss reminder",
      meta: "logged as stale",
      intent: "note",
      cites: ["B-045", "B-048", "B-051"],
    },
    {
      rank: "3",
      title: "One thing is still his, and it isn't urgent",
      why:
        "The buy-sell draft has been unread since 25 June — his item, not yours. It comes back on the table when the hold lifts, not before.",
      draftLabel: "what stays open",
      draft:
        "Leave B-033 open in the ledger. When the hold lifts, the opening line is the draft, not the meeting: “still happy to do the ten-minute version whenever”.",
      btn: "Keep open",
      meta: "owed by client · 53 days",
      intent: "note",
      cites: ["B-033"],
    },
  ],

  A: [
    {
      rank: "1",
      title: "Execute the gold switch she just approved",
      why:
        "On 14 Aug she said “5% as a fund then.” That is an instruction, and nothing in the thread confirms it has been done. It is the only thing outstanding here.",
      draftLabel: "draft · confirmation, once it's placed",
      draft:
        "Gold fund is in at 5%, taken proportionally from the global and bond sleeves. Confirmation is in your email — that's everything we discussed now done.",
      btn: "Confirm & send",
      meta: "no open ledger item yet",
      intent: "send",
      primary: true,
      cites: ["A-067", "A-068"],
    },
    {
      rank: "2",
      title: "Then nothing until she writes",
      why:
        "She opened 3 of the last 5 conversations and asked 4 questions in 30 days. Inbound is working; unprompted contact competes with a channel that is already healthy.",
      draftLabel: "recommendation",
      draft:
        "No outreach, no review invite. The September payslip change and the rider trim are both already agreed and diarised. Silence is the correct action.",
      btn: "Confirm hold",
      meta: "breaks automatically if she messages",
      intent: "hold",
      cites: ["A-056", "A-059", "A-066"],
    },
  ],
};

/* ── queues ──────────────────────────────────────────────────────── */

export type QueueKind = "calls";

export interface QueueRow {
  who: ClientKey | null;
  name: string;
  initials: string;
  when: string;
  kind: string;
  kindTone: Tone;
  kindDashed: boolean;
  tone: Tone;
  rail: boolean;
  dim: boolean;
  text: string;
  why: string;
  cites: string[];
  state: string;
  stateTone: Tone;
  btn: string;
  btn2: string;
  primary: boolean;
}

export interface Queue {
  title: string;
  meta: string;
  foot: string;
  rows: QueueRow[];
}

export const queues: Record<QueueKind, Queue> = {
  calls: {
    title: "Call reminders",
    meta: "fires only on friction the agent can quote back to you · never on a client who is merely quiet",
    foot:
      "A warm, silent client never enters this queue. An unprompted call to someone who is perfectly polite reads as a sales call — they get a question instead.",
    rows: [
      {
        who: "B", name: "Faizal Rahman", initials: "FR", when: "fired 10 Aug",
        kind: "stale", kindTone: "butter", kindDashed: true, tone: "warn", rail: true, dim: false,
        text: "Fired on two reschedules in a fortnight — real friction, correctly caught. But on 15 Aug he answered “Park it for now.” The reminder is older than his answer, so it is wrong now. Dismiss it.",
        why: "trigger 10 Aug · superseded 15 Aug",
        cites: ["B-048", "B-051"],
        state: "superseded", stateTone: "butter", btn: "Dismiss", btn2: "Keep", primary: true,
      },
      {
        who: "D", name: "Adrian Lim", initials: "AL", when: "after you send",
        kind: "sequenced", kindTone: "butter", kindDashed: true, tone: "critical", rail: false, dim: false,
        text: "A call is right, but only after the comparison lands. Ringing him before the document exists is a fifth ask, and he has stopped answering asks.",
        why: "send → then call within 24h",
        cites: ["D-012"],
        state: "queued behind a send", stateTone: "warn", btn: "Schedule after send", btn2: "···", primary: false,
      },
      {
        who: "C", name: "Michelle Tan", initials: "MT", when: "suppressed",
        kind: "no call", kindTone: "good", kindDashed: false, tone: "good", rail: false, dim: true,
        text: "Nothing quotable in 59 messages — not one complaint, not one flat reply. She is disengaged, not dissatisfied, and the two need different answers.",
        why: "suppressed by rule · silent ≠ unhappy",
        cites: [],
        state: "suppressed", stateTone: "good", btn: "", btn2: "", primary: false,
      },
    ],
  },

};

/* ── overview furniture ──────────────────────────────────────────── */

export interface ApprovalRow {
  glyph: string;
  title: string;
  meta: string;
  done: boolean;
  go: { client: ClientKey; mode: "profile" | "record" } | null;
}

export const approvals: ApprovalRow[] = [
  { glyph: "✓", title: "Priya's gold switch approved", meta: "she instructed it · A-068", done: true, go: { client: "A", mode: "record" } },
  { glyph: "✓", title: "Faizal hold logged", meta: "his instruction · B-051", done: true, go: { client: "B", mode: "record" } },
  { glyph: "→", title: "Send Michelle's question", meta: "draft ready in her record", done: false, go: { client: "C", mode: "record" } },
  { glyph: "!", title: "Adrian comparison — blocked", meta: "104 days · attach the file first", done: false, go: { client: "D", mode: "record" } },
  { glyph: "☏", title: "Dismiss Faizal's call reminder", meta: "superseded by B-051", done: false, go: { client: "B", mode: "record" } },
];

