/**
 * Telegram, meeting the calendar.
 *
 * Every message ingested is read for a schedule change, and the ones that
 * carry one act on Google Calendar. This is the "live" half of the feature:
 * because it runs on ingest rather than in the page, a client who confirms a
 * time at midnight has a block in the diary at midnight, whether or not the
 * desktop app was open.
 *
 * ── it used to run in the browser, and that was the bug ──────────────
 * The first version lived in src/booker.ts on the arrival callback, which only
 * fires while the app is running. That made "live" mean "live if you happen to
 * be looking", which is the opposite of what an assistant is for. The reader
 * itself is unchanged and shared — see shared/scheduletalk.ts — so the page and
 * the backend cannot drift into disagreeing about what a sentence meant.
 *
 * ── what it will and will not do ─────────────────────────────────────
 *   agree  → a tentative block appears
 *   move   → the block moves, and goes back to tentative
 *   cancel → nothing. Deliberately. See below.
 *
 * Creating and moving are recoverable: a wrong block is one tap to delete, a
 * wrongly moved one is visibly unconfirmed and still on the diary. Cancelling
 * is not. If this misreads "cancel my card" as "cancel my meeting" and clears
 * the block, the failure is the advisor not turning up to something a client is
 * sitting at — and no amount of flagging afterwards undoes that. So a
 * cancellation is read, recorded against the event as unconfirmed, and left for
 * a person. The asymmetry is the point: automate what a tap can undo.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { dayOf, readSchedule, whenOf } from "../shared/scheduletalk";

/** Default length for something booked out of a chat. */
const DEFAULT_MINUTES = 45;

/** How far ahead to look for the meeting a "can we move it" refers to. */
const LOOKAHEAD_MS = 45 * 86_400_000;

/** Has this sentence already been acted on? */
export const actedOn = internalQuery({
  args: { cite: v.string() },
  handler: async (ctx, { cite }) => {
    const hit = await ctx.db
      .query("events")
      .withIndex("by_cite", (q) => q.eq("inferredCite", cite))
      .first();
    return hit !== null;
  },
});

/**
 * The meeting a client means when they say "can we move it".
 *
 * Two ways to match, and both are needed. Events this app created carry the
 * client key in Google's private properties, which is exact. Everything else —
 * the hundred events already in the advisor's diary before any of this existed
 * — has only a title, so the client's name in it is the only link there is.
 * That is a heuristic and it is allowed to be one, because what it produces is
 * a *tentative* change rather than a silent one.
 */
export const nextFor = internalQuery({
  args: { clientKey: v.string(), name: v.string(), afterMs: v.number() },
  handler: async (ctx, { clientKey, name, afterMs }) => {
    const rows = await ctx.db
      .query("events")
      .withIndex("by_start", (q) => q.gte("startsAt", afterMs).lt("startsAt", afterMs + LOOKAHEAD_MS))
      .collect();

    const first = name.split(" ")[0]?.toLowerCase() ?? "";
    const mine = rows.filter(
      (r) =>
        r.booking !== "cancelled" &&
        (r.clientKey === clientKey || (first !== "" && r.title.toLowerCase().includes(first))),
    );

    mine.sort((a, b) => a.startsAt - b.startsAt);
    return mine[0] ?? null;
  },
});

/** The client's name and key, for a message's client id. */
export const clientOf = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const c = await ctx.db.get(clientId);
    return c ? { key: c.key, name: c.name } : null;
  },
});

/**
 * Record that a cancellation was read, without acting on it.
 *
 * The block stays on the diary and becomes tentative, so it shows up on the
 * calendar page dashed with its citation attached and two buttons under it.
 * The advisor decides; the assistant only makes sure they know.
 */
export const flagCancel = internalMutation({
  args: { eventId: v.id("events"), cite: v.string() },
  handler: async (ctx, { eventId, cite }) => {
    await ctx.db.patch(eventId, {
      booking: "tentative",
      inferredSource: "telegram",
      inferredCite: cite,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Read one message, and act if it asked for something.
 *
 * Scheduled from `ingestBatch` rather than called inline: writing to Google is
 * a network round trip and mutations get one second, so doing it in the ingest
 * path would make a Telegram backfill of a thousand messages time out on the
 * first one that mentioned a Tuesday.
 */
export const consider = internalAction({
  args: {
    clientId: v.id("clients"),
    cite: v.string(),
    text: v.string(),
    ts: v.number(),
  },
  handler: async (ctx: ActionCtx, a): Promise<void> => {
    const reading = readSchedule(a.text, a.ts);
    if (!reading) return;

    // One attempt per sentence, forever. A backfill re-reading history must
    // not re-book a meeting that happened three months ago.
    if (await ctx.runQuery(internal.scheduling.actedOn, { cite: a.cite })) return;

    const client = await ctx.runQuery(internal.scheduling.clientOf, { clientId: a.clientId });
    if (!client) return;

    const now = Date.now();

    if (reading.intent === "agree") {
      const at = whenOf(reading);
      // Already past. A thread scrolling by an old agreement is history.
      if (at === null || at <= now) return;

      await ctx.runAction(api.calendar.createEvent, {
        title: `${client.name.split(" ")[0] ?? client.name} — agreed in chat`,
        startsAt: at,
        minutes: DEFAULT_MINUTES,
        kind: "meeting",
        clientKey: client.key,
        // Nobody confirmed this to the advisor. The whole safety property.
        tentative: true,
        inferredCite: a.cite,
        prepAi: `Re-read what was agreed: "${reading.phrase.slice(0, 140)}" (${a.cite})`,
      });
      return;
    }

    const target = await ctx.runQuery(internal.scheduling.nextFor, {
      clientKey: client.key,
      name: client.name,
      afterMs: now,
    });
    // Nothing on the diary to move or cancel. Booking something new off a
    // "can we push it" would invent the meeting it claims to be rescheduling.
    if (!target) return;

    if (reading.intent === "cancel") {
      await ctx.runMutation(internal.scheduling.flagCancel, { eventId: target._id, cite: a.cite });
      return;
    }

    // A move with no day named means the same day it is already on.
    const at = whenOf(reading, dayOf(target.startsAt));
    if (at === null || at <= now) return;

    if (target.googleId) {
      await ctx.runAction(api.calendar.moveEvent, {
        googleId: target.googleId,
        startsAt: at,
        minutes: target.minutes,
      });
      /* Back to tentative after a move it read rather than was told. The block
         is where the message said it should be, and visibly needs a person to
         agree that the message meant what it seemed to. */
      await ctx.runAction(api.calendar.settleEvent, {
        googleId: target.googleId,
        booking: "tentative",
      });
    }
  },
});
