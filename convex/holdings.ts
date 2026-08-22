/**
 * The book's real holdings, imported from the advisor's own CSV.
 *
 * data/holdings.ts is the seeded demo book; this table is the live one, and
 * everything that reads holdings — the desk, importance pre-fill, maturity
 * tasks, market matching — prefers it the moment it has rows. One import
 * replaces the whole table: a holdings file is a statement of the book as of
 * a date, not a stream of edits, and partial merges are how two products
 * with the same name end up both being believed.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const ROW = v.object({
  hid: v.string(),
  clientKey: v.string(),
  name: v.string(),
  kind: v.string(),
  classes: v.array(v.string()),
  invested: v.number(),
  value: v.number(),
  value1yAgo: v.number(),
  startIso: v.string(),
  maturityIso: v.optional(v.string()),
  contribution: v.number(),
  frequency: v.string(),
  lastUpdateIso: v.string(),
  risk: v.string(),
  notes: v.string(),
});

export const replaceAll = mutation({
  args: { rows: v.array(ROW) },
  handler: async (ctx, { rows }) => {
    for (const old of await ctx.db.query("holdings").collect()) await ctx.db.delete(old._id);
    const now = Date.now();
    for (const r of rows) await ctx.db.insert("holdings", { ...r, importedAt: now });
    return { imported: rows.length };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("holdings").collect(),
});
