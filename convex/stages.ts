/**
 * The live funnel stage per client, as the model last proved it from their
 * own messages. Written only by the classifier in suggestions.run — which
 * demands confidence and a verbatim-gated quote — and read by the page,
 * where it overrides the authored book. Not a mutation a person calls:
 * the whole point is that nobody has to.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { callModel } from "./agent";
import { gate } from "./verbatim";

const STAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stage", "confident", "why", "sourceId", "quote"],
  properties: {
    stage: { type: "string", enum: ["inquiring", "proposing", "completed", "maturing", "renewing"] },
    confident: { type: "boolean" },
    why: { type: "string" },
    sourceId: { type: "string" },
    quote: { type: "string" },
  },
} as const;

const SYSTEM_STAGE = `You read a financial advisor's client conversation and say which lifecycle
stage the client is in RIGHT NOW:

- inquiring: asking about products or services; nothing proposed yet.
- proposing: options or a proposal are on the table; the client is deciding.
- completed: the client clearly AGREED to proceed, or the product was set up.
- maturing: a held product is approaching maturity; renewal talk is near.
- renewing: renewal or rollover is actively in motion (paperwork, signatures).

RULES:
- Judge from the client's OWN words. An agreement moves them to completed;
  a signed/created product moves them onward. Never advance on the
  advisor's hopes.
- Return the id of the ONE message that proves it and that message's
  decisive sentence QUOTED VERBATIM, character for character.
- confident=false when the thread does not clearly place them. When in
  doubt: not confident. A wrong stage is worse than no answer.`;

interface StageRead {
  stage: "inquiring" | "proposing" | "completed" | "maturing" | "renewing";
  confident: boolean;
  why: string;
  sourceId: string;
  quote: string;
}

/** clientId → citation key, for callers that only hold the id. */
export const keyOf = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => (await ctx.db.get(clientId))?.key ?? null,
});

/**
 * One client, read now. Scheduled a second after every inbound message —
 * an agreement moves the funnel within seconds, not at the next sweep —
 * and swept by suggestions.run as the safety net.
 */
export const classifyOne = internalAction({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<void> => {
    const thread = await ctx.runQuery(internal.agentData.threadFor, { key });
    if (!thread || thread.messages.length === 0) return;
    const recent = thread.messages.slice(-40);
    const rendered = recent.map((m) => `[${m.externalId}] ${m.sender}: ${m.text}`).join("\n");

    let read: StageRead;
    try {
      read = await callModel<StageRead>(SYSTEM_STAGE, `Client: ${thread.name}\n\n${rendered}`, "stage", STAGE_SCHEMA);
    } catch (err) {
      console.warn(`[stage] read failed for ${key}: ${String(err)}`);
      return;
    }
    if (!read.confident) return;

    const byId = new Map(recent.map((m) => [m.externalId, m.text]));
    const { kept } = gate([{ statement: read.why, sourceId: read.sourceId, quote: read.quote }], byId);
    if (kept.length === 0) return;

    await ctx.runMutation(internal.stages.record, {
      clientKey: key,
      stage: read.stage,
      why: read.why.slice(0, 160),
      cite: read.sourceId,
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("clientStages").collect();
    return rows.map((r) => ({ clientKey: r.clientKey, stage: r.stage, why: r.why, cite: r.cite }));
  },
});

export const record = internalMutation({
  args: {
    clientKey: v.string(),
    stage: v.union(
      v.literal("inquiring"),
      v.literal("proposing"),
      v.literal("completed"),
      v.literal("maturing"),
      v.literal("renewing"),
    ),
    why: v.string(),
    cite: v.string(),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db
      .query("clientStages")
      .withIndex("by_client", (q) => q.eq("clientKey", a.clientKey))
      .unique();
    if (existing) {
      if (existing.stage !== a.stage) {
        await ctx.db.patch(existing._id, { stage: a.stage, why: a.why, cite: a.cite, ts: Date.now() });
      }
    } else {
      await ctx.db.insert("clientStages", { ...a, ts: Date.now() });
    }
  },
});
