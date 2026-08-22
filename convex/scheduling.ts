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
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { OFFSET_MIN, dayOf, readSchedule, whenOf } from "../shared/scheduletalk";
import type { Reading } from "../shared/scheduletalk";

/** Default length for something booked out of a chat. */
const DEFAULT_MINUTES = 45;

/** How far ahead to look for the meeting a "can we move it" refers to. */
const LOOKAHEAD_MS = 45 * 86_400_000;

/** Has this sentence already been acted on — as a booking or as a proposal? */
export const actedOn = internalQuery({
  args: { cite: v.string() },
  handler: async (ctx, { cite }) => {
    const booked = await ctx.db
      .query("events")
      .withIndex("by_cite", (q) => q.eq("inferredCite", cite))
      .first();
    if (booked) return true;
    const proposed = await ctx.db
      .query("proposals")
      .withIndex("by_cite", (q) => q.eq("cite", cite))
      .first();
    return proposed !== null;
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
    /** Optional so in-flight invocations from before this arg survive a deploy. */
    sender: v.optional(v.string()),
  },
  handler: async (ctx: ActionCtx, a): Promise<void> => {
    let reading: Reading | null = readSchedule(a.text, a.ts);

    /* The regex is the fast path and stays first — deterministic, free,
       incapable of hallucinating a booking. The model is the second pass,
       only for messages the regex could not parse but that smell of
       scheduling (a digit, a day-word, a time-word). It inherits every guard
       the fast path has: output is only ever tentative, deduped per message,
       future-only — so a wrong extraction costs the advisor one tap. */
    if (!reading && /\d|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|morning|afternoon|evening|noon|next week/i.test(a.text)) {
      try {
        const ex = (await ctx.runAction(internal.agent.extractTime, {
          text: a.text,
          nowIso: new Date(a.ts).toISOString(),
        })) as { intent: string; date: string; time: string; confident: boolean };

        if (ex.confident && ex.intent !== "none") {
          const minutesOfDay = /^(\d{2}):(\d{2})$/.test(ex.time)
            ? Number(ex.time.slice(0, 2)) * 60 + Number(ex.time.slice(3))
            : null;
          // Midnight of that date in Kuala Lumpur, as an instant — the same
          // convention shared/scheduletalk.ts uses throughout.
          const day = /^\d{4}-\d{2}-\d{2}$/.test(ex.date)
            ? Date.UTC(
                Number(ex.date.slice(0, 4)),
                Number(ex.date.slice(5, 7)) - 1,
                Number(ex.date.slice(8, 10)),
              ) -
              OFFSET_MIN * 60_000
            : null;

          // The same shape the regex produces, so everything downstream is
          // shared — one acting path, two readers.
          if (
            (ex.intent === "agree" && minutesOfDay !== null && day !== null) ||
            (ex.intent === "move" && minutesOfDay !== null) ||
            ex.intent === "cancel"
          ) {
            reading = {
              intent: ex.intent as Reading["intent"],
              minutesOfDay,
              day,
              phrase: a.text.trim(),
            };
          }
        }
      } catch (err) {
        // A model outage must not break ingest; the message simply reads as
        // non-scheduling, which is what the regex already concluded.
        console.error("extractTime failed", err instanceof Error ? err.message : err);
      }
    }

    if (!reading) return;

    // One attempt per sentence, forever. A backfill re-reading history must
    // not re-book a meeting that happened three months ago.
    if (await ctx.runQuery(internal.scheduling.actedOn, { cite: a.cite })) return;

    const client = await ctx.runQuery(internal.scheduling.clientOf, { clientId: a.clientId });
    if (!client) return;

    const now = Date.now();

    /**
     * A client offering a time. Nothing was agreed, so nothing touches the
     * calendar — a proposal row appears on the calls page and waits for the
     * advisor. Client side only: the advisor offering 6pm is a question the
     * CLIENT answers, and their "6pm works" reply comes back through the
     * agree path above like any other assent.
     */
    const propose = async (): Promise<void> => {
      if (a.sender !== "client") return;
      // "6pm?" with no day named, asked at 7pm, means tomorrow — resolve
      // against the message's own day first, then bump past times forward.
      let at = whenOf(reading, dayOf(a.ts));
      if (at === null) return;
      if (at <= a.ts) at += 86_400_000;
      if (at <= now) return; // resolved into the past — history scrolling by
      await ctx.runMutation(internal.scheduling.recordProposal, {
        clientId: a.clientId,
        cite: a.cite,
        text: reading.phrase,
        at,
        ts: a.ts,
      });
    };

    if (reading.intent === "propose") {
      await propose();
      return;
    }

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
    /* Nothing on the diary to move or cancel. Booking something new off a
       "can we push it" would invent the meeting it claims to be rescheduling —
       but "can we do 6pm?" with nothing to move is not a reschedule at all,
       it is an offered time that used to die right here. It becomes a
       proposal: the advisor answers it, the calendar does not. */
    if (!target) {
      if (reading.intent === "move") await propose();
      return;
    }

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

/* ── proposals: the confirm-first path ───────────────────────────────── */

export const recordProposal = internalMutation({
  args: {
    clientId: v.id("clients"),
    cite: v.string(),
    text: v.string(),
    at: v.number(),
    ts: v.number(),
  },
  handler: async (ctx, a) => {
    /* Max asked for 6pm three times in a row. Three cites, one question —
       so one open card per client per instant, and the first sentence to ask
       keeps the citation. actedOn() already stops the same cite twice. */
    const open = await ctx.db
      .query("proposals")
      .withIndex("by_client", (q) => q.eq("clientId", a.clientId))
      .collect();
    if (open.some((p) => p.status === "open" && p.at === a.at)) return;

    await ctx.db.insert("proposals", {
      clientId: a.clientId,
      cite: a.cite,
      text: a.text,
      at: a.at,
      minutes: DEFAULT_MINUTES,
      status: "open",
      ts: a.ts,
    });
  },
});

/**
 * Open proposals, with the one thing the advisor needs before saying yes:
 * whether the slot collides with something already on the diary.
 */
export const proposals = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("proposals")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();

    return await Promise.all(
      rows.map(async (p) => {
        const client = await ctx.db.get(p.clientId);
        const clash = (
          await ctx.db
            .query("events")
            .withIndex("by_start", (q) => q.gte("startsAt", p.at - 4 * 3_600_000).lt("startsAt", p.at + p.minutes * 60_000))
            .collect()
        ).find((e) => e.booking !== "cancelled" && e.startsAt + e.minutes * 60_000 > p.at);

        return {
          id: p._id,
          key: client?.key ?? "",
          name: client?.name ?? "",
          cite: p.cite,
          text: p.text,
          at: p.at,
          minutes: p.minutes,
          conflict: clash ? clash.title : null,
        };
      }),
    );
  },
});

export const decline = mutation({
  args: { id: v.id("proposals") },
  handler: async (ctx, { id }) => {
    const p = await ctx.db.get(id);
    if (!p || p.status !== "open") return;
    await ctx.db.patch(id, { status: "declined", decidedAt: Date.now() });
  },
});

/** For accept: everything it needs in one read. */
export const proposalById = internalQuery({
  args: { id: v.id("proposals") },
  handler: async (ctx, { id }) => {
    const p = await ctx.db.get(id);
    if (!p) return null;
    const client = await ctx.db.get(p.clientId);
    return client ? { ...p, clientKey: client.key, clientName: client.name } : null;
  },
});

/** The mirror row, when there is no Google to write to. */
export const bookLocal = internalMutation({
  args: {
    title: v.string(),
    startsAt: v.number(),
    minutes: v.number(),
    clientKey: v.string(),
    cite: v.string(),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert("events", {
      calendarId: "local",
      title: a.title,
      startsAt: a.startsAt,
      minutes: a.minutes,
      kind: "meeting",
      where: "",
      booking: "confirmed",
      clientKey: a.clientKey,
      inferredSource: "telegram",
      inferredCite: a.cite,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Remove a locally-booked block. Local rows have no Google id, so nothing in
 * calendar.ts can touch them once made — this is their one exit, kept
 * internal so removing a booking stays an operator's deliberate act.
 */
export const discardLocal = internalMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const e = await ctx.db.get(eventId);
    if (e && e.calendarId === "local") await ctx.db.delete(eventId);
  },
});

export const markDecided = internalMutation({
  args: { id: v.id("proposals"), status: v.union(v.literal("accepted"), v.literal("declined")) },
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, { status, decidedAt: Date.now() });
  },
});

/**
 * The advisor said yes. THIS is where the calendar is first touched — booked
 * as confirmed, not tentative, because a person just confirmed it. Google
 * when it is connected, the local mirror when it is not; either way the row
 * carries the asking message's cite, so the block can always say why it
 * exists. The reply to the client is the page's job — it goes through the
 * same outbox approval every outgoing message goes through.
 */
export const accept = action({
  args: { id: v.id("proposals") },
  handler: async (ctx: ActionCtx, { id }): Promise<{ booked: boolean; reason?: string }> => {
    const p = await ctx.runQuery(internal.scheduling.proposalById, { id });
    if (!p) return { booked: false, reason: "no such proposal" };
    if (p.status !== "open") return { booked: false, reason: `already ${p.status}` };
    if (p.at <= Date.now()) {
      await ctx.runMutation(internal.scheduling.markDecided, { id, status: "declined" });
      return { booked: false, reason: "that time has passed" };
    }

    const title = `${p.clientName.split(" ")[0] ?? p.clientName} — asked in chat`;

    const connected = (await ctx.runQuery(api.calendar.connected, {})) as { connected: boolean };
    if (connected.connected) {
      await ctx.runAction(api.calendar.createEvent, {
        title,
        startsAt: p.at,
        minutes: p.minutes,
        kind: "meeting",
        clientKey: p.clientKey,
        tentative: false,
        inferredCite: p.cite,
      });
    } else {
      await ctx.runMutation(internal.scheduling.bookLocal, {
        title,
        startsAt: p.at,
        minutes: p.minutes,
        clientKey: p.clientKey,
        cite: p.cite,
      });
    }

    await ctx.runMutation(internal.scheduling.markDecided, { id, status: "accepted" });
    return { booked: true };
  },
});
