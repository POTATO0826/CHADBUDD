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

/**
 * The demo book of dated work.
 *
 * Idempotent by construction — every task carries a `demo:` ref and every
 * suggestion dedupes on (client, title) — so the bridge can call this at
 * every startup and the second call costs nothing. Dates are relative to
 * now, because a demo where everything went overdue last Tuesday is a demo
 * of neglect.
 */
export const demoWork = mutation({
  args: {},
  handler: async (ctx) => {
    const DAY = 86_400_000;
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    const today = noon.getTime();

    const TASKS: Array<{
      ref: string; title: string; dueMs: number; clientKey?: string;
      hardMs?: number; cite?: string; kind?: "email" | "outreach" | "prep";
      done?: boolean;
    }> = [
      { ref: "demo:t1", title: "Send Michelle the written quarterly summary", dueMs: today, clientKey: "C", cite: "C-051", kind: "email" },
      { ref: "demo:t2", title: "Rebook Faizal — he asked for next week", dueMs: today + 1 * DAY, clientKey: "B", cite: "B-041", kind: "outreach" },
      { ref: "demo:t3", title: "Quarterly statements batch — send by Friday", dueMs: today + 3 * DAY, kind: "email" },
      { ref: "demo:t4", title: "Call Priya about the 5% gold fund switch", dueMs: today + 2 * DAY, clientKey: "A", cite: "A-068", kind: "outreach" },
      { ref: "demo:t5", title: "Renewal papers to Priya before her plan matures", dueMs: today + 6 * DAY, clientKey: "A", hardMs: today + 8 * DAY, kind: "email" },
      { ref: "demo:t6", title: "Chase ops for the transfer confirmation", dueMs: today - 2 * DAY },
      { ref: "demo:t7", title: "Morning book review", dueMs: today, done: true },
      { ref: "demo:t8", title: "KYC refresh — compliance window closes", dueMs: today + 10 * DAY, kind: "email" },
    ];

    let tasks = 0;
    for (const t of TASKS) {
      const dupe = await ctx.db
        .query("tasks")
        .withIndex("by_ref", (q) => q.eq("ref", t.ref))
        .first();
      if (dupe) continue;
      const { done, ...rest } = t;
      await ctx.db.insert("tasks", {
        ...rest,
        done: done ?? false,
        ...(done ? { doneTs: Date.now() } : {}),
        source: "chadbuddy",
        createdTs: Date.now(),
      });
      tasks++;
    }

    const SUGGS: Array<{
      clientKey: string; title: string; dueMs: number; why: string;
      cite: string; kind: "email" | "outreach" | "prep";
    }> = [
      { clientKey: "A", title: "Set up Priya's 5% gold fund allocation", dueMs: today + 2 * DAY, why: "She agreed to 5% in gold, held as a fund rather than physical.", cite: "A-068", kind: "outreach" },
      { clientKey: "B", title: "Offer Faizal two slots for next week", dueMs: today + 4 * DAY, why: "He said this week is hard and next week is better.", cite: "B-041", kind: "outreach" },
      { clientKey: "C", title: "Draft Michelle's written summary", dueMs: today + 1 * DAY, why: "She asked for a written summary instead of a call this quarter.", cite: "C-051", kind: "email" },
    ];

    let suggs = 0;
    for (const s of SUGGS) {
      const dupe = await ctx.db
        .query("taskSuggestions")
        .withIndex("by_client_title", (q) =>
          q.eq("clientKey", s.clientKey).eq("title", s.title),
        )
        .first();
      if (dupe) continue;
      await ctx.db.insert("taskSuggestions", { ...s, status: "pending", createdTs: Date.now() });
      suggs++;
    }

    return { tasks, suggs };
  },
});
