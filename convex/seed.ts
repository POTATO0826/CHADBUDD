/**
 * Loading the hand-written seed threads into Convex.
 *
 * Separate from ingest.ts on purpose, because it breaks that file's central
 * rule — that externalId is minted in the database and nowhere else. Seed
 * messages arrive *already carrying* their citation keys: `src/copy.ts` cites
 * "C-058" by hand, `scripts/verify-ui.ts` fails the build if that id doesn't
 * resolve, and `data/ledger-seed.ts` quotes against specific ids. Re-minting
 * them would break every one of those references.
 *
 * So this path preserves ids rather than assigning them, and lives in its own
 * file where that exception is visible instead of hidden behind a flag on the
 * live ingest path.
 *
 * Live messages keep the original rule. Only pre-keyed seed data comes through
 * here, and only for demos and for testing the agent against a corpus whose
 * correct answers are already known.
 */

import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const importThread = mutation({
  args: {
    key: v.string(),
    clientName: v.string(),
    handle: v.string(),
    messages: v.array(
      v.object({
        externalId: v.string(),
        from: v.union(v.literal("advisor"), v.literal("client")),
        /** ISO 8601 with offset, exactly as data/types.ts stores it. */
        at: v.string(),
        text: v.string(),
      }),
    ),
  },
  handler: async (ctx, { key, clientName, handle, messages }) => {
    let client = await ctx.db
      .query("clients")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    if (!client) {
      const id = await ctx.db.insert("clients", {
        key,
        sourceId: `seed:${key}`,
        name: clientName,
        handle,
        seq: 1,
      });
      client = (await ctx.db.get(id))!;
    }

    let inserted = 0;
    let highest = 0;

    for (const m of messages) {
      const ts = Date.parse(m.at);
      if (Number.isNaN(ts)) throw new Error(`Unparseable timestamp on ${m.externalId}: ${m.at}`);

      // Track the highest number seen so live messages appended later continue
      // the sequence instead of colliding with a seeded id.
      const n = Number(m.externalId.split("-")[1] ?? "0");
      if (Number.isFinite(n) && n > highest) highest = n;

      const dupe = await ctx.db
        .query("messages")
        .withIndex("by_client_source", (q) => q.eq("clientId", client._id).eq("sourceId", m.externalId))
        .unique();
      if (dupe) continue;

      await ctx.db.insert("messages", {
        clientId: client._id,
        externalId: m.externalId,
        sourceId: m.externalId,
        sender: m.from,
        ts,
        text: m.text,
      });
      inserted++;
    }

    if (highest + 1 > client.seq) await ctx.db.patch(client._id, { seq: highest + 1 });

    return { key, inserted, skipped: messages.length - inserted };
  },
});

/** Remove every seeded client and its messages, leaving live data alone. */
export const clearSeed = mutation({
  args: {},
  handler: async (ctx) => {
    const seeded = (await ctx.db.query("clients").collect()).filter((c) =>
      c.sourceId.startsWith("seed:"),
    );
    let removed = 0;
    for (const c of seeded) {
      for (const m of await ctx.db
        .query("messages")
        .withIndex("by_client_ts", (q) => q.eq("clientId", c._id))
        .collect()) {
        await ctx.db.delete(m._id);
        removed++;
      }
      for (const i of await ctx.db
        .query("ideas")
        .withIndex("by_client", (q) => q.eq("clientId", c._id))
        .collect()) {
        await ctx.db.delete(i._id);
      }
      for (const r of await ctx.db
        .query("rejected")
        .withIndex("by_client", (q) => q.eq("clientId", c._id))
        .collect()) {
        await ctx.db.delete(r._id);
      }
      await ctx.db.delete(c._id);
    }
    return { clients: seeded.length, messages: removed };
  },
});
