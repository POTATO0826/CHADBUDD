/**
 * The three-minute status reply, actually sent.
 *
 * src/presence.ts designed this and computed it correctly for months without
 * anything ever going out — the classic "present in code, not running". This
 * is the dispatcher: a cron sweeps once a minute, and a client whose message
 * has sat unanswered past the grace period while the calendar says the
 * advisor is inside something gets one line saying so.
 *
 * ── why this one is allowed to send itself ───────────────────────────
 * The status class is the T0 of the whole risk design: it contains no advice,
 * no numbers, no promises — only availability, and only what the calendar
 * supports. It never names who the meeting is with (leaking one client's
 * schedule to another loses both), and it says nothing at all when the
 * calendar has no entry, because an invented excuse is worse than silence.
 *
 * ── one per person per busy block ────────────────────────────────────
 * `presenceSent` is the dedupe: however many times they write during the same
 * meeting, they hear from the assistant once. A second status is nagging.
 */

import { internalMutation } from "./_generated/server";

/** How long a message may sit before a status reply is warranted. */
const GRACE_MS = 3 * 60_000;

/** Older than this and a status reads as a bot archaeology project. */
const STALE_MS = 45 * 60_000;

const hhmm = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kuala_Lumpur",
});

export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const advisor = process.env["ADVISOR_NAME"] ?? "He";

    /* What the advisor is inside right now, per the mirrored calendar.
       Busy means a real commitment — meetings, calls, and the travel between
       them. Focus time is interruptible; lunch is nobody's business. */
    const dayEvents = await ctx.db
      .query("events")
      .withIndex("by_start", (q) => q.gte("startsAt", now - 12 * 3_600_000).lt("startsAt", now + 60_000))
      .collect();
    const busy = dayEvents.find(
      (e) =>
        e.booking === "confirmed" &&
        (e.kind === "meeting" || e.kind === "call" || e.kind === "travel") &&
        e.startsAt <= now &&
        now < e.startsAt + e.minutes * 60_000,
    );
    if (!busy) return;

    const what = busy.kind === "travel" ? "away from his desk" : "in a meeting";
    const until = hhmm.format(busy.startsAt + busy.minutes * 60_000);
    const blockId = busy._id;

    const clients = await ctx.db.query("clients").collect();
    for (const c of clients) {
      if (c.sourceId.startsWith("seed:")) continue;

      const last = await ctx.db
        .query("messages")
        .withIndex("by_client_ts", (q) => q.eq("clientId", c._id))
        .order("desc")
        .first();
      if (!last || last.sender !== "client") continue;

      const age = now - last.ts;
      if (age < GRACE_MS || age > STALE_MS) continue;

      // One status per person per busy block, however many times they write.
      const already = await ctx.db
        .query("presenceSent")
        .withIndex("by_client_block", (q) => q.eq("clientId", c._id).eq("blockId", blockId))
        .first();
      if (already) continue;

      await ctx.db.insert("outbox", {
        clientId: c._id,
        sourceId: c.sourceId,
        text:
          `${advisor} is ${what} until about ${until} — he's seen your message ` +
          `and will come back to you after that.`,
        state: "queued",
        queuedTs: now,
      });
      await ctx.db.insert("presenceSent", { clientId: c._id, blockId, ts: now });
    }
  },
});

export const clearOld = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 2 * 86_400_000;
    for (const row of await ctx.db.query("presenceSent").collect()) {
      if (row.ts < cutoff) await ctx.db.delete(row._id);
    }
  },
});

