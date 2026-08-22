/**
 * Database access for the agent.
 *
 * Split from agent.ts because that file carries the `"use node"` directive,
 * and a Node-runtime file may contain only actions — an action cannot touch
 * the database directly. So the action reads through `threadFor` and writes
 * through `recordAnalysis`, and both stay ordinary Convex functions.
 *
 * All internal: nothing here is callable from the browser. The agent is
 * triggered by ingest or by hand, never by whoever can reach port 3210.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Must match the window in threads.ts — see below.
 */
const WINDOW_DAYS = 120;
const DAY = 86_400_000;

/**
 * Everything one analysis pass needs, in one round trip.
 *
 * **Windowed to exactly what the frontend can see.** This is not an
 * optimisation; it is a correctness requirement, and it was found the hard way.
 *
 * `threads.list` returns the last 120 days, because that is all the dashboard
 * measures. An earlier version of this query returned the *entire* thread, so
 * the agent reasoned over messages the UI would never receive — and duly cited
 * one. The gate passed it, correctly: the message was real and the quote was
 * exact. But the citation resolved to nothing on screen, which is precisely the
 * broken evidence link the whole design exists to prevent.
 *
 * The agent must not be able to cite something the advisor cannot click.
 * Whatever window the UI reads, this reads the same one.
 */
export const threadFor = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const client = await ctx.db
      .query("clients")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!client) return null;

    const floor = Date.now() - WINDOW_DAYS * DAY;
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_client_ts", (q) => q.eq("clientId", client._id).gte("ts", floor))
      .collect();

    return {
      clientId: client._id,
      key: client.key,
      name: client.name,
      analyzedTs: client.analyzedTs ?? null,
      messages: messages
        .sort((a, b) => a.ts - b.ts)
        .map((m) => ({ externalId: m.externalId, sender: m.sender, ts: m.ts, text: m.text })),
    };
  },
});

/** Every tracked client's key, for the analyse-everything entry point. */
export const clientKeys = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("clients").collect()).map((c) => c.key),
});

/**
 * Queue a message the agent decided to send, with nobody reading it first.
 *
 * This is the autonomous path, and every guard in it exists because the normal
 * path has a human in it and this one does not:
 *
 *   · seed clients are refused — a fictional client has no real chat, and the
 *     failure mode is delivering to the wrong person rather than erroring
 *   · a cooldown per client, so a re-analysis loop cannot turn into a stream of
 *     messages to someone who has not replied yet
 *   · identical text is never sent twice, because "the model produced the same
 *     recommendation again" is not the same as "the client should hear it again"
 *
 * Returns why it declined rather than throwing, so a refusal is visible in the
 * pass result instead of failing the whole analysis.
 */
export const autoQueue = internalMutation({
  args: {
    clientId: v.id("clients"),
    text: v.string(),
    ideaRank: v.string(),
    cooldownMs: v.number(),
  },
  handler: async (ctx, { clientId, text, ideaRank, cooldownMs }) => {
    const trimmed = text.trim();
    if (trimmed === "") return { queued: false, reason: "empty draft" };

    const client = await ctx.db.get(clientId);
    if (!client) return { queued: false, reason: "no such client" };
    if (client.sourceId.startsWith("seed:")) {
      return { queued: false, reason: "seed client has no real chat" };
    }

    const prior = await ctx.db
      .query("outbox")
      .withIndex("by_client", (q) => q.eq("clientId", clientId))
      .collect();

    if (prior.some((r) => r.text.trim() === trimmed)) {
      return { queued: false, reason: "already sent this exact message" };
    }

    const last = prior.reduce((m, r) => Math.max(m, r.queuedTs), 0);
    const since = Date.now() - last;
    if (last > 0 && since < cooldownMs) {
      return { queued: false, reason: `cooldown, ${Math.round((cooldownMs - since) / 60000)}m left` };
    }

    await ctx.db.insert("outbox", {
      clientId,
      sourceId: client.sourceId,
      text: trimmed,
      ideaRank,
      state: "queued",
      queuedTs: Date.now(),
    });

    return { queued: true, reason: `auto-sent to ${client.name}` };
  },
});

/**
 * Write one pass's results.
 *
 * Ideas are replaced wholesale rather than appended: they are a view of the
 * thread as it stands, and yesterday's advice sitting beside today's would be
 * indistinguishable from two current recommendations.
 *
 * Rejections accumulate. They are the record of how often the model fabricated
 * a citation, and a rate you reset every run is a rate you cannot read.
 */
export const recordAnalysis = internalMutation({
  args: {
    clientId: v.id("clients"),
    model: v.string(),
    ideas: v.array(
      v.object({
        rank: v.string(),
        title: v.string(),
        why: v.string(),
        draftLabel: v.string(),
        draft: v.string(),
        btn: v.string(),
        meta: v.string(),
        intent: v.union(
          v.literal("send"),
          v.literal("hold"),
          v.literal("blocked"),
          v.literal("note"),
        ),
        cites: v.array(v.string()),
      }),
    ),
    rejected: v.array(
      v.object({
        claim: v.string(),
        sourceId: v.string(),
        quote: v.string(),
        reason: v.union(
          v.literal("no-such-message"),
          v.literal("quote-not-verbatim"),
          v.literal("no-surviving-cites"),
        ),
      }),
    ),
  },
  handler: async (ctx, { clientId, model, ideas, rejected }) => {
    const now = Date.now();

    for (const stale of await ctx.db
      .query("ideas")
      .withIndex("by_client", (q) => q.eq("clientId", clientId))
      .collect()) {
      await ctx.db.delete(stale._id);
    }

    for (const i of ideas) {
      await ctx.db.insert("ideas", { ...i, clientId, generatedTs: now, model });
    }
    for (const r of rejected) {
      await ctx.db.insert("rejected", { ...r, clientId, ts: now, model });
    }

    await ctx.db.patch(clientId, { analyzedTs: now });
    return { ideas: ideas.length, rejected: rejected.length };
  },
});
