/**
 * Tasks with deadlines, living on the calendar.
 *
 * Deliberately not a todo list. The rule that keeps it honest: a task is only
 * allowed here if it has a date by which it stops being optional — a maturity,
 * a promotion window, prep for a rated meeting. Undated work ("they went
 * quiet", "owes you a reply") stays on the dashboard desk, because those
 * cannot be rescheduled, only done — and a calendar full of them is how the
 * dated ones drown.
 *
 * ── one date, draggable ──────────────────────────────────────────────
 * `dueMs` is both the deadline and the plan: dragging a task to another day
 * moves it, because the advisor owns their own schedule. `hardMs`, where set,
 * is the fact underneath that no drag can change — the day the product
 * actually matures — so the UI can warn when the plan slides past the fact
 * rather than silently letting a deadline become fiction.
 *
 * ── the today contract ───────────────────────────────────────────────
 * The point of the whole table: what is due today is finite and countable.
 * Finish it and you are genuinely done — not "done until you remember
 * something", done. Thirty things can be in flight; only today's are load.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DAY = 86_400_000;

export const list = query({
  args: {},
  handler: async (ctx) => {
    const floor = Date.now() - 30 * DAY;
    // Done tasks fall out of the window quickly — yesterday's finished work
    // is the ledger's business, not the calendar's.
    return (
      await ctx.db
        .query("tasks")
        .withIndex("by_due", (q) => q.gte("dueMs", floor))
        .collect()
    ).filter((t) => !t.done || t.doneTs === undefined || t.doneTs > Date.now() - 2 * DAY);
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    dueMs: v.number(),
    clientKey: v.optional(v.string()),
    hardMs: v.optional(v.number()),
    source: v.union(v.literal("advisor"), v.literal("chadbuddy")),
    ref: v.optional(v.string()),
    cite: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // One task per fact. A prep task for the same meeting, a reach-out for
    // the same maturity — re-creating them on every render or rating change
    // would turn the plan into an echo chamber.
    if (args.ref) {
      const dupe = await ctx.db
        .query("tasks")
        .withIndex("by_ref", (q) => q.eq("ref", args.ref))
        .first();
      if (dupe) return { id: dupe._id, existed: true };
    }
    const id = await ctx.db.insert("tasks", { ...args, done: false, createdTs: Date.now() });
    return { id, existed: false };
  },
});

/** The drag. Day-granular on purpose — a deadline is a day, not a minute. */
export const move = mutation({
  args: { id: v.id("tasks"), dueMs: v.number() },
  handler: async (ctx, { id, dueMs }) => {
    await ctx.db.patch(id, { dueMs });
  },
});

export const setDone = mutation({
  args: { id: v.id("tasks"), done: v.boolean() },
  handler: async (ctx, { id, done }) => {
    await ctx.db.patch(id, { done, ...(done ? { doneTs: Date.now() } : { doneTs: undefined }) });
  },
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
