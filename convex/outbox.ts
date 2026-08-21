/**
 * Sending, and the deliberate seam in the middle of it.
 *
 * The agent drafts. A human approves. The bridge delivers. Those are three
 * separate steps in three separate processes, and the queue between them is
 * what makes the middle one unskippable — the page cannot reach Telegram, and
 * nothing the agent writes lands in this table.
 *
 * That seam is not ceremony. The verbatim gate proves the agent quoted a real
 * message; it cannot prove the advice built on that quote is sound, and this
 * codebase has already measured a model asserting a claim its own citation did
 * not support. Here the output stops being a suggestion on a screen and becomes
 * a message from a financial advisor to a client. A person should press that.
 *
 * `send` also exists as an autonomous path — see AUTO_SEND in the bridge — but
 * it is off, and it should stay off until the rejection rate on real threads is
 * something you have watched for a while rather than something you assume.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Queue an approved message.
 *
 * Takes the text as given rather than re-reading the idea, because the advisor
 * may have edited the draft before approving it — and what was approved is what
 * should be sent, not what the model originally wrote.
 */
export const queueSend = mutation({
  args: {
    key: v.string(),
    text: v.string(),
    ideaRank: v.optional(v.string()),
  },
  handler: async (ctx, { key, text, ideaRank }) => {
    const trimmed = text.trim();
    if (trimmed === "") throw new Error("Refusing to queue an empty message.");

    const client = await ctx.db
      .query("clients")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!client) throw new Error(`No tracked client with key ${key}`);

    // A seeded client has no real chat behind it. Sending would either fail
    // obscurely or, worse, deliver a fictional client's message to a real one.
    if (client.sourceId.startsWith("seed:")) {
      throw new Error(`${client.name} is seed data, not a real chat — nothing to send to.`);
    }

    const id = await ctx.db.insert("outbox", {
      clientId: client._id,
      sourceId: client.sourceId,
      text: trimmed,
      ...(ideaRank === undefined ? {} : { ideaRank }),
      state: "queued",
      queuedTs: Date.now(),
    });

    return { id, to: client.name };
  },
});

/** What the bridge should deliver. Subscribed to, so a click sends in about a second. */
export const pending = query({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("outbox")
      .withIndex("by_state", (q) => q.eq("state", "queued"))
      .collect(),
});

export const markSent = mutation({
  args: { id: v.id("outbox") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { state: "sent", sentTs: Date.now() });
  },
});

export const markFailed = mutation({
  args: { id: v.id("outbox"), error: v.string() },
  handler: async (ctx, { id, error }) => {
    await ctx.db.patch(id, { state: "failed", error });
  },
});

/**
 * Everything that has been sent or tried, newest first.
 *
 * Exposed so the record is visible in the product rather than only in the
 * database. A queue you cannot inspect is indistinguishable from a system that
 * sends things on its own.
 */
export const history = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("outbox").order("desc").take(limit ?? 30);
    const names = new Map(
      (await ctx.db.query("clients").collect()).map((c) => [c._id, { key: c.key, name: c.name }]),
    );
    return rows.map((r) => ({
      id: r._id,
      key: names.get(r.clientId)?.key ?? "?",
      name: names.get(r.clientId)?.name ?? "unknown",
      text: r.text,
      state: r.state,
      queuedTs: r.queuedTs,
      sentTs: r.sentTs ?? null,
      error: r.error ?? null,
    }));
  },
});
