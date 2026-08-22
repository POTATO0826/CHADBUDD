/**
 * The call log, matched to the book.
 *
 * Rows arrive from the phone via /phone/call (see convex/http.ts). Matching
 * is by the last eight digits of the number, which survives the ways the same
 * phone gets written — +60 12-345 6789, 0123456789, 60123456789 — without
 * pretending to a precision phone numbers do not have. An unmatched call is
 * kept with no client: a missed call from an unknown number is still a fact.
 *
 * What this deliberately does not do is mint message ids or touch threads.
 * A call has no quotable text, and the citation lattice is text-only by
 * construction — calls sit beside the record, never inside it.
 */

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

const digitsOf = (s: string): string => s.replace(/\D/g, "");
const tail = (s: string): string => digitsOf(s).slice(-8);

export const record = internalMutation({
  args: {
    number: v.string(),
    direction: v.union(v.literal("incoming"), v.literal("outgoing"), v.literal("missed")),
    durationSec: v.number(),
    ts: v.number(),
  },
  handler: async (ctx, a) => {
    const t = tail(a.number);

    let clientId;
    if (t.length >= 7) {
      const clients = await ctx.db.query("clients").collect();
      clientId = clients.find((c) => tail(c.handle) === t)?._id;
    }

    // The phone may retry a webhook; the same call twice is one call.
    const dupe = await ctx.db
      .query("phoneCalls")
      .withIndex("by_ts", (q) => q.gte("ts", a.ts - 5_000).lte("ts", a.ts + 5_000))
      .collect();
    if (dupe.some((d) => d.digits === digitsOf(a.number) && d.direction === a.direction)) {
      return { recorded: false };
    }

    await ctx.db.insert("phoneCalls", {
      number: a.number,
      digits: digitsOf(a.number),
      direction: a.direction,
      durationSec: a.durationSec,
      ts: a.ts,
      ...(clientId ? { clientId } : {}),
    });
    return { recorded: true, matched: clientId !== undefined };
  },
});

/**
 * A Telegram voice call, reported by the bridge.
 *
 * Public like the bridge's other mutations. The client is known exactly —
 * calls arrive with the chat's sourceId — so there is no digit matching to
 * go wrong, and an untracked caller is stored unmatched like any other.
 */
export const fromTelegram = mutation({
  args: {
    sourceId: v.string(),
    outgoing: v.boolean(),
    missed: v.boolean(),
    durationSec: v.number(),
    ts: v.number(),
  },
  handler: async (ctx, a) => {
    const client = await ctx.db
      .query("clients")
      .withIndex("by_source", (q) => q.eq("sourceId", a.sourceId))
      .unique();

    const dupe = await ctx.db
      .query("phoneCalls")
      .withIndex("by_ts", (q) => q.gte("ts", a.ts - 5_000).lte("ts", a.ts + 5_000))
      .collect();
    if (dupe.some((d) => d.number === `tg:${a.sourceId}`)) return { recorded: false, matched: client !== null };

    await ctx.db.insert("phoneCalls", {
      number: `tg:${a.sourceId}`,
      digits: "",
      direction: a.outgoing ? "outgoing" : a.missed ? "missed" : "incoming",
      durationSec: a.durationSec,
      ts: a.ts,
      ...(client ? { clientId: client._id } : {}),
    });

    /* The call also lands in the chat log as an advisor-only line, so the
       thread reads as the relationship actually happened — texts and calls
       interleaved. Metadata only: call audio is end-to-end encrypted and
       this system does not pretend otherwise. */
    if (client) {
      const logSource = `calllog:${a.ts}`;
      const dupeLog = await ctx.db
        .query("messages")
        .withIndex("by_client_source", (q) => q.eq("clientId", client._id).eq("sourceId", logSource))
        .unique();
      if (!dupeLog) {
        const mins = Math.max(1, Math.round(a.durationSec / 60));
        const text = a.missed
          ? a.outgoing
            ? "Call log — you called, no answer."
            : "Call log — missed call from them, not yet returned."
          : `Call log — ${a.outgoing ? "you called them" : "they called you"}, ${mins} min.`;
        const externalId = `${client.key}-${String(client.seq).padStart(3, "0")}`;
        await ctx.db.insert("messages", {
          clientId: client._id, externalId, sourceId: logSource,
          sender: "advisor", ts: a.ts, text, via: "call",
        });
        await ctx.db.patch(client._id, { seq: client.seq + 1 });
      }
    }
    return { recorded: true, matched: client !== null };
  },
});

/** The phone started ringing. Name resolved here so the page needn't. */
export const ringStart = mutation({
  args: { sourceId: v.string() },
  handler: async (ctx, { sourceId }) => {
    const client = await ctx.db
      .query("clients")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .unique();
    const chat = client
      ? null
      : await ctx.db
          .query("chats")
          .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
          .unique();
    const name = client?.name ?? chat?.name ?? "Someone";

    // One live ring at a time: whatever was ringing before, isn't.
    for (const r of await ctx.db
      .query("ringing")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect()) {
      await ctx.db.patch(r._id, { active: false });
    }
    const existing = await ctx.db
      .query("ringing")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { name, startedTs: Date.now(), active: true });
    else await ctx.db.insert("ringing", { sourceId, name, startedTs: Date.now(), active: true });
  },
});

/** The ringing stopped — answered, declined, or gave up. Ends every ring. */
export const ringEnd = mutation({
  args: {},
  handler: async (ctx) => {
    for (const r of await ctx.db
      .query("ringing")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect()) {
      await ctx.db.patch(r._id, { active: false });
    }
  },
});

/** What is ringing right now, if anything. Stale rings age out at 2 min. */
export const ringingNow = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("ringing")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    const floor = Date.now() - 120_000;
    return rows
      .filter((r) => r.startedTs > floor)
      .map((r) => ({ sourceId: r.sourceId, name: r.name, startedTs: r.startedTs }));
  },
});

/** Per-client call history, newest first, for the contact panel. */
export const forClients = query({
  args: {},
  handler: async (ctx) => {
    const clients = await ctx.db.query("clients").collect();
    const out: Array<{
      key: string;
      calls: Array<{ direction: string; durationSec: number; ts: number }>;
    }> = [];
    for (const c of clients) {
      const rows = await ctx.db
        .query("phoneCalls")
        .withIndex("by_client", (q) => q.eq("clientId", c._id))
        .collect();
      out.push({
        key: c.key,
        calls: rows
          .sort((a, b) => b.ts - a.ts)
          .slice(0, 50)
          .map((r) => ({ direction: r.direction, durationSec: r.durationSec, ts: r.ts })),
      });
    }
    return out;
  },
});

/** The unmatched tail — recent calls from numbers not on the book. */
export const unmatched = query({
  args: {},
  handler: async (ctx) =>
    (
      await ctx.db
        .query("phoneCalls")
        .withIndex("by_ts", (q) => q.gte("ts", Date.now() - 7 * 86_400_000))
        .collect()
    )
      .filter((r) => r.clientId === undefined)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 20),
});
