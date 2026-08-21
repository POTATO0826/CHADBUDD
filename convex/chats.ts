/**
 * What the advisor's chat picker reads, and the pairing state above it.
 *
 * The picker is a judgement call presented to a human, not a filter applied
 * behind one. So `recent` returns everything and annotates it, rather than
 * quietly dropping rows: `isBot`, `isGroup` and `spanDays` are all reported so
 * the UI can sort, warn and default sensibly while still letting the advisor
 * pick something the heuristics would have excluded.
 *
 * That distinction is not academic. Profiling a real account, three of five
 * DMs were bots and the busiest of them — BotFather — looked like an ideal
 * client by message count alone. A filter would have hidden that; an
 * annotation makes it obvious.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";

/** Below this there is no baseline to measure decay against — see threads.ts. */
const MIN_SPAN_DAYS = 120;

/**
 * Text messages needed inside the window before a chat is worth scoring.
 *
 * Span and density are independent, and an earlier version of this file
 * checked only span — which reads as "this chat is old enough to score" and
 * was taken to mean "this chat has something to score". Two chats promoted on
 * that basis, spanning 172 and 753 days, yielded 1 message and 0 messages.
 *
 * 20 is deliberately modest: enough to distinguish a live conversation from a
 * dormant one, not so high that a quiet-but-real client gets filtered out of
 * the advisor's own picker.
 */
const MIN_MESSAGES = 20;

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const chats = await ctx.db
      .query("chats")
      .withIndex("by_last")
      .order("desc")
      .take(limit ?? 50);

    const tracked = new Set((await ctx.db.query("clients").collect()).map((c) => c.sourceId));

    return chats.map((c) => ({
      sourceId: c.sourceId,
      name: c.name,
      handle: c.handle,
      isGroup: c.isGroup,
      isBot: c.isBot,
      lastTs: c.lastTs,
      spanDays: c.spanDays,
      msgCount: c.msgCount,
      tracked: tracked.has(c.sourceId),
      /**
       * Whether this chat can actually be scored, and if not, why.
       *
       * Needs all four: a human, one relationship, enough elapsed time to have
       * a baseline, and enough messages in the window to have anything to
       * measure. A busy three-week-old chat and a two-year-old dormant one
       * fail for opposite reasons, and both would otherwise produce a number
       * with nothing behind it.
       */
      scorable:
        !c.isBot && !c.isGroup && c.spanDays >= MIN_SPAN_DAYS && c.msgCount >= MIN_MESSAGES,
      reason: c.isBot
        ? "bot or service account"
        : c.isGroup
          ? "group chat, not one relationship"
          : c.spanDays < MIN_SPAN_DAYS
            ? `only ${c.spanDays}d of history; needs ${MIN_SPAN_DAYS}d for a baseline`
            : c.msgCount < MIN_MESSAGES
              ? `dormant: ${c.msgCount} messages in the last ${MIN_SPAN_DAYS}d, needs ${MIN_MESSAGES}`
              : null,
    }));
  },
});

/** Connection state. Drives the pairing screen; `qr` is a PNG data URL when present. */
export const pairing = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("pairing").first();
    return row ?? { platform: "telegram", state: "closed" as const, updatedAt: 0 };
  },
});

/** Tracked clients, with counts. Cheap enough for a status strip. */
export const tracked = query({
  args: {},
  handler: async (ctx) => {
    const clients = await ctx.db.query("clients").collect();
    return await Promise.all(
      clients.map(async (c) => {
        const messages = await ctx.db
          .query("messages")
          .withIndex("by_client_ts", (q) => q.eq("clientId", c._id))
          .collect();
        return {
          key: c.key,
          name: c.name,
          handle: c.handle,
          messageCount: messages.length,
          lastTs: messages.reduce((m, x) => Math.max(m, x.ts), 0),
          analyzedTs: c.analyzedTs ?? null,
        };
      }),
    );
  },
});
