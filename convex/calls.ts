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
import { internalMutation, query } from "./_generated/server";

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
