/**
 * The frontend contract. Four reactive queries, and nothing else crosses the line.
 *
 * `list` returns data already shaped as `SeedThread[]` — the exact type in
 * data/types.ts that derive.ts, signals.ts, score.ts and ledger.ts already
 * consume. The frontend reshapes nothing; it swaps its data source and the
 * rest of the pipeline cannot tell the difference. That is the whole point of
 * matching the seed shape rather than inventing a wire format.
 *
 * Subscribe with the vanilla client — no React needed, which suits a codebase
 * that renders by swapping innerHTML:
 *
 *   import { ConvexClient } from "convex/browser";
 *   const client = new ConvexClient(import.meta.env.VITE_CONVEX_URL);
 *   client.onUpdate(api.threads.list, {}, (threads) => { rebuild(threads); render(); });
 *
 * ── Three things the frontend must change to consume this ──────────────────
 *
 *   1. `ClientKey` at data/types.ts:22 is the union "A"|"B"|"C"|"D". Live keys
 *      are assigned in pick order and go past D, so it widens to `string`.
 *      Everything keyed by it (`Record<ClientKey, …>` in copy.ts) becomes
 *      partial under noUncheckedIndexedAccess.
 *   2. `NOW` in data/clock.ts is frozen at 2026-08-17. Live threads carry real
 *      timestamps and need a real clock.
 *   3. src/copy.ts has no authored recommendations for live clients. `ideas`
 *      below fills that gap once the agent has run; until then the honest
 *      render is the existing hatch idiom, not an empty list.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";

/** 30-day recent window + 90-day baseline. Nothing older is measured. */
const WINDOW_DAYS = 120;
const DAY = 86_400_000;

/**
 * Every tracked client as a SeedThread.
 *
 * Windowed deliberately. The dashboard measures the last 120 days and nothing
 * else, so shipping a five-year archive would cost payload and change no
 * number on screen. It also keeps the result far inside Convex's 16 MiB cap.
 *
 * `ts` becomes an ISO string here because `tsOf()` at data/types.ts:42 parses
 * `at`. A Z-suffixed ISO is safe: every formatter in derive.ts:32-44 pins
 * timeZone "Asia/Kuala_Lumpur" explicitly, so what the advisor sees does not
 * depend on the offset the string happens to carry.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const clients = await ctx.db.query("clients").collect();
    const floor = Date.now() - WINDOW_DAYS * DAY;

    const threads = await Promise.all(
      clients.map(async (c) => {
        const messages = await ctx.db
          .query("messages")
          .withIndex("by_client_ts", (q) => q.eq("clientId", c._id).gte("ts", floor))
          .collect();

        return {
          key: c.key,
          clientName: c.name,
          handle: c.handle,
          /* For the reply composer and the call button. sourceId lets the
             page deep-link into Telegram; email is where written replies go
             when the advisor picks that channel. */
          sourceId: c.sourceId,
          email: c.email ?? null,
          messages: messages
            .sort((a, b) => a.ts - b.ts)
            .map((m) => ({
              externalId: m.externalId,
              from: m.sender,
              at: new Date(m.ts).toISOString(),
              text: m.text,
              ...(m.via ? { via: m.via } : {}),
            })),
        };
      }),
    );

    // Empty threads are still returned: a client who has said nothing in 120
    // days is the single most important row on this dashboard, and filtering
    // them out would hide exactly the case the product exists to surface.
    return threads;
  },
});

/**
 * Agent recommendations, shaped like `Idea` at src/copy.ts:33.
 *
 * Every `cites` entry has already passed convex/verbatim.ts, so the frontend
 * can render them without re-checking. It is still free to — the gate is
 * cheap and defence in depth costs nothing here.
 */
export const ideas = query({
  args: { key: v.optional(v.string()) },
  handler: async (ctx, { key }) => {
    const clients = key === undefined
      ? await ctx.db.query("clients").collect()
      : await ctx.db.query("clients").withIndex("by_key", (q) => q.eq("key", key)).collect();

    const out = await Promise.all(
      clients.map(async (c) => ({
        key: c.key,
        ideas: await ctx.db
          .query("ideas")
          .withIndex("by_client", (q) => q.eq("clientId", c._id))
          .collect(),
      })),
    );

    return out;
  },
});

/**
 * How often the agent fabricated a citation.
 *
 * Exposed as a query rather than buried in logs because derive.ts already
 * renders a discarded count, and because a rejection rate nobody looks at is a
 * rejection rate nobody believes. Rising numbers here are a fact about the
 * model, not a bug in the gate.
 */
/** What the agent noticed about each person, verbatim-gated. */
export const notes = query({
  args: {},
  handler: async (ctx) => {
    const clients = await ctx.db.query("clients").collect();
    return await Promise.all(
      clients.map(async (c) => ({
        key: c.key,
        notes: (
          await ctx.db
            .query("notes")
            .withIndex("by_client", (q) => q.eq("clientId", c._id))
            .collect()
        ).map((n) => ({ text: n.text, cite: n.cite, updatedAt: n.updatedAt })),
      })),
    );
  },
});

export const rejections = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("rejected").collect();
    const byReason: Record<string, number> = {};
    for (const r of rows) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
    return { total: rows.length, byReason };
  },
});
