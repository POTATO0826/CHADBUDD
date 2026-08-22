"use node";

/**
 * The agent pass: a thread in, cited recommendations out.
 *
 * Runs as a Node action because it makes a network call, and Convex queries
 * and mutations cannot. That also gives it a ten-minute budget instead of one
 * second, which a slow model on a long thread genuinely needs.
 *
 * ── The shape of the trust ──────────────────────────────────────────────────
 *
 * The model is never asked for a recommendation directly. It is asked for a
 * recommendation *plus the evidence for every claim inside it*, and the
 * evidence is checked against real message text before anything is stored.
 * Claims whose quotes don't survive are dropped; ideas left with no surviving
 * claims are dropped whole. Both outcomes are written to `rejected` rather than
 * discarded, because how often the model invents a quote is the only honest
 * measure of whether it can be trusted at all.
 *
 * What this cannot do is check whether a real quote actually *supports* the
 * claim built on it. Measured, not assumed: asked a question a thread could
 * not answer, a model answered anyway and cited a real message that says
 * nothing of the kind. See convex/verbatim.ts.
 *
 * ── Provider ────────────────────────────────────────────────────────────────
 *
 * An OpenAI-compatible chat-completions call, configured by environment. The
 * plan called for Hermes 4; self-hosting it means keeping a GPU model server
 * running, so OpenAI is what this is pointed at. Swapping to Hermes via Nous
 * Portal, OpenRouter, vLLM or Ollama changes AGENT_BASE_URL and AGENT_API_KEY
 * and nothing else.
 */

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { gate, type Claim } from "./verbatim";

const MODEL = process.env["AGENT_MODEL"] ?? "gpt-5.5";
const BASE_URL = (process.env["AGENT_BASE_URL"] ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const API_KEY = process.env["AGENT_API_KEY"] ?? process.env["OPENAI_API_KEY"] ?? "";

/** Don't re-analyse a client more often than this. */
const DEBOUNCE_MS = 10 * 60_000;

/**
 * Autonomous sending. Off unless explicitly switched on.
 *
 *   bunx convex env set AUTO_SEND 1
 *
 * With it on, the agent's rank-1 "send" recommendation goes to the client
 * without anyone reading it first. That is a different product from the one
 * this file otherwise implements: the gate proves the agent quoted a real
 * message, and proves nothing about whether the advice built on that quote is
 * sound — a distinction this codebase measured rather than assumed.
 *
 * Only rank 1, and only intent "send". A "hold" recommendation is advice to
 * stay quiet; firing a message off the back of one would invert its meaning.
 */
const AUTO_SEND = process.env["AUTO_SEND"] === "1";

/** Minimum gap between autonomous messages to the same client. */
const AUTO_COOLDOWN_MS = Number(process.env["AUTO_SEND_COOLDOWN_MS"] ?? 6 * 60 * 60_000);

/**
 * Below this there is nothing to reason about at all.
 *
 * Was 8, which was a number picked without much thought and turned out to
 * conflate two different jobs. Scoring *decay* needs volume — you cannot
 * measure a change in reply rate from three messages. But the agent's other
 * job is "this client asked something and you have not answered", and that
 * needs two messages, not eight. A fresh enquiry is exactly the case worth
 * surfacing, and the old floor threw it away.
 *
 * The decay side is protected elsewhere: chats.recent refuses to call a thread
 * scorable without 120 days of span and 20 messages in the window.
 */
const MIN_MESSAGES = 3;

const IDEA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ideas", "notes"],
  properties: {
    notes: {
      type: "array",
      description: "Durable facts about the person, each with verbatim evidence.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["note", "sourceId", "quote"],
        properties: {
          note: { type: "string", description: "The fact, under 15 words, no advice" },
          sourceId: { type: "string", description: "A message id exactly as shown" },
          quote: { type: "string", description: "Copied character-for-character from that message" },
        },
      },
    },
    ideas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rank", "title", "why", "draftLabel", "draft", "btn", "meta", "intent", "claims"],
        properties: {
          rank: { type: "string", description: "1 is what to do today" },
          title: { type: "string", description: "The action, stated plainly" },
          why: { type: "string", description: "Why this, grounded in what they said" },
          draftLabel: { type: "string", description: "e.g. 'draft · one question, no product'" },
          draft: { type: "string", description: "The actual message to send, in the advisor's voice" },
          btn: { type: "string", description: "e.g. 'Send as me'" },
          meta: { type: "string", description: "One short qualifier" },
          intent: { type: "string", enum: ["send", "hold", "blocked", "note"] },
          claims: {
            type: "array",
            description: "Evidence. Every factual assertion in `why` needs one.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["statement", "sourceId", "quote"],
              properties: {
                statement: { type: "string" },
                sourceId: { type: "string", description: "A message id exactly as shown, e.g. C-058" },
                quote: {
                  type: "string",
                  description: "Copied character-for-character from that message. Never paraphrased.",
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const SYSTEM = `You advise a financial advisor on which client relationships need attention.

You are given one client's WhatsApp/Telegram thread, one message per line, as:
  [ID] sender: text

Produce ranked recommendations for what the advisor should do next.

RULES, in order of importance:

1. Every factual assertion you make about the client MUST appear in \`claims\`
   with the message id it came from and a quote copied EXACTLY from that
   message — character for character, including capitalisation. Never
   paraphrase inside a quote. Quotes that do not appear verbatim are discarded
   and the recommendation dies with them.

2. If the thread does not support a claim, do not make it. Saying "there is
   nothing here to act on" is a correct and useful answer. Inventing a
   timeline, a product interest or a sentiment the client never expressed is
   the single worst thing you can do.

3. Prefer the client's own words over your inference. A question only they can
   answer beats a generic check-in.

4. Respect explicit instructions. If they said to leave something alone, the
   recommendation is to leave it alone — with intent "hold".

5. \`draft\` is a message the advisor could send as-is. No placeholders, no
   [square brackets], no product pitches unless the client raised it first.

At most 3 ideas. Fewer is better than padded.

Separately, fill \`notes\`: durable facts about the PERSON, not the thread —
family, dates that matter, stated preferences, money facts, things they are
proud or worried about. These are what let the advisor open the next call
like someone who remembered. Same evidence rule: each note carries the
message id and an EXACT quote, or it is discarded. At most 6, each under 15
words, no advice, no sentiment-guessing. An empty list is fine.`;

interface ModelIdea {
  rank: string;
  title: string;
  why: string;
  draftLabel: string;
  draft: string;
  btn: string;
  meta: string;
  intent: "send" | "hold" | "blocked" | "note";
  claims: Claim[];
}

interface PassResult {
  key: string;
  skipped?: string;
  name?: string;
  messages?: number;
  ideasKept?: number;
  claimsRejected?: number;
  /** What the autonomous path did, or why it declined. Absent when AUTO_SEND is off. */
  autoSend?: string;
}

/**
 * One analysis pass, as a plain function.
 *
 * Both entry points call this directly rather than one action invoking the
 * other. Convex actions can call actions, but routing `analyzeAll` through
 * `analyze` would mean a public function reachable from the browser sitting in
 * the middle of an internal loop — more surface, no benefit.
 */
/**
 * `ActionCtx` rather than a hand-written shape.
 *
 * This was `{ runQuery: (ref: never, args: never) => Promise<unknown> }`, which
 * types every function reference as unassignable and every result as `{}` — so
 * the seventeen errors it produced were the type system correctly reporting
 * that nothing here was checked. `convex dev` typechecks before it deploys,
 * which is what turned that from cosmetic into a push that will not go.
 *
 * The generated context carries the whole api graph, so `thread.messages` and
 * `thread.clientId` are now real. The explicit `Promise<PassResult>` is what
 * keeps that from becoming circular: the return type is declared rather than
 * inferred from calls that themselves depend on it.
 */
async function runPass(
  ctx: ActionCtx,
  key: string,
  force: boolean,
): Promise<PassResult> {
  {
    if (API_KEY === "") throw new Error("No AGENT_API_KEY or OPENAI_API_KEY set for the Convex backend.");

    const thread = await ctx.runQuery(internal.agentData.threadFor, { key });
    if (!thread) return { key, skipped: "no such client" };
    if (thread.messages.length < MIN_MESSAGES) {
      return { key, skipped: `only ${thread.messages.length} messages` };
    }
    if (
      force !== true &&
      thread.analyzedTs !== null &&
      Date.now() - thread.analyzedTs < DEBOUNCE_MS
    ) {
      return { key, skipped: "analysed recently" };
    }

    const rendered = thread.messages
      .map((m) => `[${m.externalId}] ${m.sender}: ${m.text}`)
      .join("\n");

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Client: ${thread.name}\n\n${rendered}` },
        ],
        response_format: { type: "json_schema", json_schema: { name: "ideas", strict: true, schema: IDEA_SCHEMA } },
      }),
    });

    if (!res.ok) throw new Error(`${MODEL} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = body.choices?.[0]?.message?.content ?? "";

    let parsed: { ideas?: ModelIdea[]; notes?: Array<{ note: string; sourceId: string; quote: string }> };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      throw new Error(`${MODEL} returned non-JSON despite a schema: ${raw.slice(0, 200)}`);
    }

    // The gate. Nothing reaches the database without passing through here.
    const byId = new Map(thread.messages.map((m) => [m.externalId, m.text]));

    const keptIdeas: Array<Omit<ModelIdea, "claims"> & { cites: string[] }> = [];
    const rejections: Array<{ claim: string; sourceId: string; quote: string; reason: "no-such-message" | "quote-not-verbatim" | "no-surviving-cites" }> = [];

    for (const idea of parsed.ideas ?? []) {
      const { kept, rejected } = gate(idea.claims ?? [], byId);

      for (const r of rejected) {
        rejections.push({ claim: r.statement, sourceId: r.sourceId, quote: r.quote, reason: r.reason });
      }

      // An idea with no surviving evidence is not a weaker idea, it is an
      // unsourced one. It goes in the reject pile whole.
      if (kept.length === 0) {
        rejections.push({
          claim: idea.title,
          sourceId: "",
          quote: "",
          reason: "no-surviving-cites",
        });
        continue;
      }

      const { claims: _drop, ...rest } = idea;
      keptIdeas.push({ ...rest, cites: [...new Set(kept.map((c) => c.sourceId))] });
    }

    /* Notes pass the same gate as claims — a note is a claim about a person,
       and a personalisation fact the client never said is worse than none:
       it gets repeated back to them at the exact moment trust is being built. */
    const keptNotes: Array<{ text: string; cite: string }> = [];
    for (const n of parsed.notes ?? []) {
      const { kept, rejected } = gate(
        [{ statement: n.note, sourceId: n.sourceId, quote: n.quote }],
        byId,
      );
      if (kept.length > 0) keptNotes.push({ text: n.note, cite: n.sourceId });
      for (const r of rejected) {
        rejections.push({ claim: r.statement, sourceId: r.sourceId, quote: r.quote, reason: r.reason });
      }
    }

    await ctx.runMutation(internal.agentData.recordAnalysis, {
      clientId: thread.clientId,
      model: MODEL,
      ideas: keptIdeas,
      notes: keptNotes,
      rejected: rejections,
    });

    /**
     * The autonomous send, if it has been switched on.
     *
     * After recordAnalysis on purpose: the recommendation is written down
     * before it is acted on, so there is a record of what went out and what it
     * was based on even if delivery fails afterwards.
     */
    let autoSend: string | undefined;
    if (AUTO_SEND) {
      const top = keptIdeas.find((i) => i.rank === "1" && i.intent === "send");
      if (!top) {
        autoSend = "nothing sent — no rank-1 send recommendation";
      } else {
        const res = (await ctx.runMutation(internal.agentData.autoQueue, {
          clientId: thread.clientId,
          text: top.draft,
          ideaRank: top.rank,
          cooldownMs: AUTO_COOLDOWN_MS,
        })) as { queued: boolean; reason: string };
        autoSend = res.reason;
      }
    }

    return {
      key,
      name: thread.name,
      messages: thread.messages.length,
      ideasKept: keptIdeas.length,
      claimsRejected: rejections.length,
      ...(autoSend === undefined ? {} : { autoSend }),
    };
  }
}

/** Analyse one client by key. */
export const analyze = action({
  args: { key: v.string(), force: v.optional(v.boolean()) },
  handler: async (ctx, { key, force }): Promise<PassResult> => await runPass(ctx, key, force === true),
});

/** Analyse every tracked client — what `bun run agent:run` calls. */
/* ── the shared model call ──────────────────────────────────────────
   One place that knows how to talk to the provider, so the new seats below
   cannot drift from the pass above in auth, model or failure shape. */
async function callModel<T>(system: string, user: string, name: string, schema: object): Promise<T> {
  if (API_KEY === "") throw new Error("No AGENT_API_KEY or OPENAI_API_KEY set for the Convex backend.");
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    }),
  });
  if (!res.ok) throw new Error(`${MODEL} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = body.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${MODEL} returned non-JSON despite a schema: ${raw.slice(0, 200)}`);
  }
}

/* ── ask: the panel answers from the thread, for real ───────────────
   This used to be canned classification in the page, dressed as the agent.
   Now it is the agent: the model reads the actual thread and answers the
   actual question, under the same evidence rule as everything else — claims
   carry exact quotes or they are discarded, and an answer whose evidence all
   died is returned flagged as uncited rather than dressed up. */

const ASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "claims"],
  properties: {
    answer: { type: "string", description: "Direct answer to the advisor's question, 2-5 sentences, grounded in the thread." },
    claims: {
      type: "array",
      description: "Evidence for every factual assertion in the answer.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "sourceId", "quote"],
        properties: {
          statement: { type: "string" },
          sourceId: { type: "string" },
          quote: { type: "string", description: "Copied character-for-character. Never paraphrased." },
        },
      },
    },
  },
} as const;

const SYSTEM_ASK = `You are a financial advisor's assistant. You are given one client's full
message thread ([ID] sender: text, one per line) and a question from the
advisor about this client.

Answer ONLY from the thread. Every factual assertion needs an entry in
\`claims\` with the message id and an EXACT character-for-character quote.
If the thread cannot answer the question, say so plainly — that is a good
answer. Never invent a fact, a date, or a sentiment. 2-5 sentences.`;

export const ask = action({
  args: { key: v.string(), question: v.string() },
  handler: async (
    ctx,
    { key, question },
  ): Promise<{ answer: string; cites: string[]; uncited: boolean }> => {
    const thread = await ctx.runQuery(internal.agentData.threadFor, { key });
    if (!thread) throw new Error(`No client ${key}`);

    const rendered = thread.messages.map((m) => `[${m.externalId}] ${m.sender}: ${m.text}`).join("\n");
    const parsed = await callModel<{ answer: string; claims: Claim[] }>(
      SYSTEM_ASK,
      `Client: ${thread.name}\n\n${rendered}\n\nQuestion from the advisor: ${question}`,
      "ask",
      ASK_SCHEMA,
    );

    const byId = new Map(thread.messages.map((m) => [m.externalId, m.text]));
    const { kept } = gate(parsed.claims ?? [], byId);

    return {
      answer: parsed.answer,
      cites: [...new Set(kept.map((c) => c.sourceId))],
      // Claims were made and none survived: the answer is a guess wearing a
      // suit. The page says so instead of hiding it.
      uncited: (parsed.claims ?? []).length > 0 && kept.length === 0,
    };
  },
});

/* ── brief: the model writes the desk's prose, never its numbers ─────
   The desk's whys and drafts were templates wearing the assistant's name.
   Now the model writes them — against a hard rule the template never needed:
   every figure in the output must already appear in the FACTS block, or the
   whole draft is refused and the template stands. A model that is allowed to
   write numbers will eventually write one that is wrong by RM 40,000, and a
   digit-guard is cheaper than an apology. */

const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: {
    text: { type: "string" },
  },
} as const;

const SYSTEM_BRIEF = `You write short client-facing messages and working notes for a Malaysian
financial advisor, in his voice: warm, plain, no jargon, no exclamation
marks, no emoji. Never pitch a product.

HARD RULES:
- Use ONLY figures that appear in the FACTS block. Do not compute, round,
  or invent any number, date or percentage.
- If recent messages are provided, you may echo the client's own phrasing
  and concerns, and should.
- Output is the finished text only. No preamble, no placeholders.`;

/** Every digit-run in the text must already exist in the facts. */
function digitsGuard(text: string, facts: string): string | null {
  const normal = (x: string): string => x.replace(/[,\s]/g, "");
  const pool = normal(facts);
  for (const m of text.matchAll(/\d[\d,.]*/g)) {
    const token = normal(m[0]).replace(/\.$/, "");
    if (token.length > 0 && !pool.includes(token)) return m[0];
  }
  return null;
}

export const brief = action({
  args: {
    kind: v.string(),
    facts: v.string(),
    ask: v.string(),
    key: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<{ text: string; refused: string | null }> => {
    let context = "";
    if (a.key) {
      const thread = await ctx.runQuery(internal.agentData.threadFor, { key: a.key });
      if (thread) {
        const recent = thread.messages.slice(-12);
        context = `\n\nRECENT MESSAGES:\n${recent.map((m) => `${m.sender}: ${m.text}`).join("\n")}`;
      }
    }

    const parsed = await callModel<{ text: string }>(
      SYSTEM_BRIEF,
      `TASK (${a.kind}): ${a.ask}\n\nFACTS:\n${a.facts}${context}`,
      "brief",
      BRIEF_SCHEMA,
    );

    const bad = digitsGuard(parsed.text, a.facts);
    if (bad !== null) return { text: "", refused: `invented figure "${bad}"` };
    return { text: parsed.text.trim(), refused: null };
  },
});

/* ── extractTime: the schedule reader's second pass ─────────────────
   The regex reader is the fast path and stays first: deterministic, free,
   and incapable of hallucinating a booking. This is the fallback for the
   sentences it cannot parse — "same time as last week works", "let's do the
   morning after Raya" — and it inherits every guard the regex path has: the
   output is only ever a TENTATIVE block, deduped per message, future-only.
   A wrong extraction costs the advisor one tap; a missed one costs nothing
   the regex path was catching anyway. */

const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "date", "time", "confident"],
  properties: {
    intent: { type: "string", enum: ["none", "agree", "move", "cancel"] },
    date: { type: "string", description: "YYYY-MM-DD in Asia/Kuala_Lumpur, or empty if none stated" },
    time: { type: "string", description: "HH:MM 24h, or empty if none stated" },
    confident: { type: "boolean", description: "true only if a reasonable person would read it the same way" },
  },
} as const;

const SYSTEM_EXTRACT = `You read one chat message and decide if it schedules something.

"agree": the sender is agreeing to meet at a stated day and time.
"move": asking to shift an existing appointment to a stated time.
"cancel": calling an appointment off.
"none": everything else — including vague interest with no concrete time.

Resolve relative dates against NOW (given). Timezone Asia/Kuala_Lumpur.
Set confident=true ONLY when both the intent and the moment are unambiguous.
When in doubt: intent "none". A missed booking costs nothing; an invented
one costs trust.`;

export const extractTime = internalAction({
  args: { text: v.string(), nowIso: v.string() },
  handler: async (
    _ctx,
    { text, nowIso },
  ): Promise<{ intent: string; date: string; time: string; confident: boolean }> => {
    return await callModel(
      SYSTEM_EXTRACT,
      `NOW: ${nowIso}\n\nMESSAGE: ${text}`,
      "extract",
      EXTRACT_SCHEMA,
    );
  },
});

export const analyzeAll = action({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, { force }): Promise<PassResult[]> => {
    const keys = (await ctx.runQuery(internal.agentData.clientKeys, {})) as string[];
    const out: PassResult[] = [];
    // Sequential on purpose: parallel passes would fan out into simultaneous
    // inference calls, and nothing here is urgent enough to be worth the spike.
    for (const key of keys) out.push(await runPass(ctx, key, force === true));
    return out;
  },
});
