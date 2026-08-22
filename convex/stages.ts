/**
 * The live funnel stage per client, as the model last proved it from their
 * own messages. Written only by the classifier in suggestions.run — which
 * demands confidence and a verbatim-gated quote — and read by the page,
 * where it overrides the authored book. Not a mutation a person calls:
 * the whole point is that nobody has to.
 */

import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

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
