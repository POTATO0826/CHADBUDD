/**
 * ChadBuddy proposing dated work from the chats.
 *
 * The advisor should not have to transcribe their own conversations into a
 * todo list. This pass reads each client's recent messages and proposes
 * tasks — with a date, because the calendar refuses undated work — and every
 * proposal waits in a review queue until a person accepts or dismisses it.
 * Nothing here ever creates a task by itself.
 *
 * ── the honesty guards, same as everywhere else ──────────────────────
 * Each suggestion must carry a verbatim quote from the message it claims to
 * be reading, checked through the same gate the notes and answers go
 * through; a suggestion whose quote is not really in the thread is dropped
 * before it is stored. Dismissed suggestions are kept, not deleted, so the
 * same reading cannot return tomorrow with a fresh id.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { callModel } from "./agent";
import { gate } from "./verbatim";

const DAY = 86_400_000;

/* ── the review queue ─────────────────────────────────────────────── */

export const pending = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("taskSuggestions")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    return rows.sort((a, b) => a.dueMs - b.dueMs);
  },
});

/** Accept turns the suggestion into a real task; dismiss remembers the no. */
export const resolve = mutation({
  args: { id: v.id("taskSuggestions"), accept: v.boolean() },
  handler: async (ctx, { id, accept }) => {
    const s = await ctx.db.get(id);
    if (!s || s.status !== "pending") return;
    if (accept) {
      await ctx.db.insert("tasks", {
        title: s.title,
        dueMs: s.dueMs,
        clientKey: s.clientKey,
        ...(s.cite ? { cite: s.cite } : {}),
        ...(s.kind ? { kind: s.kind } : {}),
        ref: `sugg:${id}`,
        source: "chadbuddy",
        done: false,
        createdTs: Date.now(),
      });
    }
    await ctx.db.patch(id, { status: accept ? "accepted" : "dismissed" });
  },
});

/* ── the reading pass ─────────────────────────────────────────────── */

const SUGGEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "dueInDays", "why", "sourceId", "quote", "kind"],
        properties: {
          title: { type: "string" },
          /** Days from today. The model reasons in relative time; we anchor it. */
          dueInDays: { type: "integer", minimum: 0, maximum: 30 },
          why: { type: "string" },
          sourceId: { type: "string" },
          quote: { type: "string" },
          kind: { type: "string", enum: ["email", "outreach", "prep"] },
        },
      },
    },
  },
} as const;

const SYSTEM_SUGGEST = `You read a financial advisor's client conversation and propose the DATED
work it implies — things that stop being optional on a specific day.

RULES:
- Only suggest work the client's own words call for: something they asked to
  receive, agreed to, or postponed to a specific time. Never invent outreach.
- Each suggestion needs: a short imperative title (under 60 characters), a
  due date as days-from-today, one line of why, the id of the message you
  read it from, and that message's decisive sentence QUOTED VERBATIM —
  copied exactly, character for character.
- kind: "email" if the work is sending something written, "outreach" if it
  is a call or rebooking, "prep" if it is preparing for a meeting.
- Suggest at most 2 per client. If the thread implies no dated work, return
  an empty list. An empty list is a good answer.`;

interface Proposed {
  title: string;
  dueInDays: number;
  why: string;
  sourceId: string;
  quote: string;
  kind: "email" | "outreach" | "prep";
}

export const record = internalMutation({
  args: {
    rows: v.array(
      v.object({
        clientKey: v.string(),
        title: v.string(),
        dueMs: v.number(),
        why: v.string(),
        cite: v.string(),
        kind: v.union(v.literal("email"), v.literal("outreach"), v.literal("prep")),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    let added = 0;
    const pendingAll = await ctx.db
      .query("taskSuggestions")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const pendingPerClient = new Map();
    for (const p of pendingAll) {
      pendingPerClient.set(p.clientKey, (pendingPerClient.get(p.clientKey) ?? 0) + 1);
    }
    for (const row of rows) {
      // Two pending per client is the ceiling. The model re-words the same
      // idea across runs, and a queue that grows every half hour is nagging,
      // not helping.
      if ((pendingPerClient.get(row.clientKey) ?? 0) >= 2) continue;
      // One suggestion per (client, title), across every status — a dismissal
      // is a decision, and re-suggesting over it would nag.
      const dupe = await ctx.db
        .query("taskSuggestions")
        .withIndex("by_client_title", (q) =>
          q.eq("clientKey", row.clientKey).eq("title", row.title),
        )
        .first();
      if (dupe) continue;
      await ctx.db.insert("taskSuggestions", {
        ...row,
        status: "pending",
        createdTs: Date.now(),
      });
      pendingPerClient.set(row.clientKey, (pendingPerClient.get(row.clientKey) ?? 0) + 1);
      added++;
    }
    return added;
  },
});

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    await ctx.runMutation(internal.suggestions.prune, {});
    const keys = await ctx.runQuery(internal.agentData.clientKeys, {});
    let total = 0;

    for (const key of keys.slice(0, 8)) {
      const thread = await ctx.runQuery(internal.agentData.threadFor, { key });
      if (!thread || thread.messages.length === 0) continue;

      const recent = thread.messages.slice(-40);
      const rendered = recent
        .map((m) => `[${m.externalId}] ${m.sender}: ${m.text}`)
        .join("\n");

      let parsed: { suggestions: Proposed[] };
      try {
        parsed = await callModel<{ suggestions: Proposed[] }>(
          SYSTEM_SUGGEST,
          `Client: ${thread.name}\n\n${rendered}`,
          "suggest",
          SUGGEST_SCHEMA,
        );
      } catch (err) {
        console.warn(`[suggest] model failed for ${key}: ${String(err)}`);
        continue;
      }

      const byId = new Map(recent.map((m) => [m.externalId, m.text]));
      const today = new Date();
      today.setHours(12, 0, 0, 0);

      const rows = (parsed.suggestions ?? [])
        .slice(0, 2)
        .map((s) => {
          // The same verbatim gate the notes go through: the quote must
          // actually be in the message it names, or the suggestion dies.
          const { kept } = gate(
            [{ statement: s.why, sourceId: s.sourceId, quote: s.quote }],
            byId,
          );
          if (kept.length === 0) return null;
          return {
            clientKey: key,
            title: s.title.slice(0, 80),
            dueMs: today.getTime() + Math.min(30, Math.max(0, s.dueInDays)) * DAY,
            why: s.why.slice(0, 160),
            cite: s.sourceId,
            kind: s.kind,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (rows.length > 0) {
        total += await ctx.runMutation(internal.suggestions.record, { rows });
      }
    }
    return total;
  },
});

/**
 * Keep the queue reviewable: the two soonest-due pending suggestions per
 * client stay, the rest are dismissed. Run by the pass before it reads, so
 * an over-grown queue heals itself.
 */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const pendingAll = await ctx.db
      .query("taskSuggestions")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const byClient = new Map<string, typeof pendingAll>();
    for (const p of pendingAll) {
      const list = byClient.get(p.clientKey) ?? [];
      list.push(p);
      byClient.set(p.clientKey, list);
    }
    let dropped = 0;
    for (const list of byClient.values()) {
      list.sort((a, b) => a.dueMs - b.dueMs);
      for (const extra of list.slice(2)) {
        await ctx.db.patch(extra._id, { status: "dismissed" });
        dropped++;
      }
    }
    return dropped;
  },
});

/** The demo button: same pass, on demand, answer in hand. */
export const runNow = action({
  args: {},
  handler: async (ctx): Promise<number> => {
    return await ctx.runAction(internal.suggestions.run, {});
  },
});
