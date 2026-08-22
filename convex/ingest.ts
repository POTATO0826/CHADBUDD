/**
 * Everything that writes messages into the database.
 *
 * Two constraints shape this file, and both are hard:
 *
 *   1. **Mutations get one second of user code.** A Telegram history pull can
 *      return thousands of messages in a single call, so the bridge chunks and
 *      loops rather than handing over a thread at a time. 200 is comfortably
 *      inside the budget with room for the dedupe reads.
 *
 *   2. **externalId must be unique, stable and never reused.** It is the
 *      citation key the entire UI points at. Minting it needs a read of the
 *      client's counter, an assignment, and a write-back — which is only safe
 *      if nothing interleaves. Convex mutations are transactional, so that
 *      sequence is atomic here for free. This is the main reason the counter
 *      lives in the database rather than in the bridge.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/** Per-call ceiling. The bridge is responsible for chunking to this size. */
export const BATCH_LIMIT = 200;

const messageShape = v.object({
  sourceId: v.string(),
  from: v.union(v.literal("advisor"), v.literal("client")),
  ts: v.number(),
  text: v.string(),
});

/**
 * Record the chats the account can see, so the advisor has something to pick
 * from. Upsert rather than replace: a chat's identity is its sourceId, and
 * losing the row would orphan any client already promoted from it.
 */
export const upsertChats = mutation({
  args: {
    chats: v.array(
      v.object({
        sourceId: v.string(),
        name: v.string(),
        handle: v.string(),
        isGroup: v.boolean(),
        isBot: v.boolean(),
        lastTs: v.number(),
        msgCount: v.number(),
        spanDays: v.number(),
      }),
    ),
  },
  handler: async (ctx, { chats }) => {
    for (const c of chats) {
      const existing = await ctx.db
        .query("chats")
        .withIndex("by_source", (q) => q.eq("sourceId", c.sourceId))
        .unique();
      if (existing) await ctx.db.patch(existing._id, c);
      else await ctx.db.insert("chats", c);
    }
    return chats.length;
  },
});

/**
 * Promote chats to tracked clients.
 *
 * Keys are assigned in pick order — A, B, C … Z, then AA — and are permanent:
 * every citation ever rendered begins with one, so reassigning a key would
 * invalidate history that is already on screen. Re-picking an existing chat is
 * therefore a no-op rather than a re-key.
 */
export const pickClients = mutation({
  args: { sourceIds: v.array(v.string()) },
  handler: async (ctx, { sourceIds }) => {
    const existing = await ctx.db.query("clients").collect();
    const taken = new Set(existing.map((c) => c.key));
    const bySource = new Map(existing.map((c) => [c.sourceId, c]));

    const picked: Array<{ key: string; sourceId: string }> = [];

    for (const sourceId of sourceIds) {
      const already = bySource.get(sourceId);
      if (already) {
        picked.push({ key: already.key, sourceId });
        continue;
      }

      const chat = await ctx.db
        .query("chats")
        .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
        .unique();
      if (!chat) continue;

      const key = nextKey(taken);
      taken.add(key);

      await ctx.db.insert("clients", {
        key,
        sourceId,
        name: chat.name,
        handle: chat.handle,
        seq: 1,
      });
      picked.push({ key, sourceId });
    }

    return picked;
  },
});

/**
 * Write one chunk of messages for one client.
 *
 * Idempotent by construction: every message is checked against
 * `by_client_source` before insert, so re-running a full backfill adds nothing
 * and — critically — burns no externalIds. A re-sync that silently advanced
 * the counter would leave gaps in the citation sequence and make the same
 * message answer to two different ids across restarts.
 */
export const ingestBatch = mutation({
  args: {
    sourceId: v.string(),
    messages: v.array(messageShape),
  },
  handler: async (ctx, { sourceId, messages }) => {
    if (messages.length > BATCH_LIMIT) {
      throw new Error(
        `ingestBatch got ${messages.length} messages; the limit is ${BATCH_LIMIT}. ` +
          "Mutations have a one-second budget — chunk in the bridge.",
      );
    }

    const client = await ctx.db
      .query("clients")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .unique();
    if (!client) throw new Error(`No tracked client for chat ${sourceId} — call pickClients first.`);

    let inserted = 0;
    let seq = client.seq;

    for (const m of messages) {
      // Text-only is enforced at the adapter, but a placeholder slipping
      // through here would become a quotable "message" that no human wrote.
      if (m.text.trim() === "") continue;

      const dupe = await ctx.db
        .query("messages")
        .withIndex("by_client_source", (q) => q.eq("clientId", client._id).eq("sourceId", m.sourceId))
        .unique();
      if (dupe) continue;

      const externalId = `${client.key}-${String(seq).padStart(3, "0")}`;

      await ctx.db.insert("messages", {
        clientId: client._id,
        externalId,
        sourceId: m.sourceId,
        sender: m.from,
        ts: m.ts,
        text: m.text,
      });

      /* Read for a schedule change. Scheduled rather than called: writing to
         Google is a network round trip and a mutation gets one second, so
         doing it inline would make a backfill of a thousand messages die on
         the first one that mentioned a Tuesday.

         Both senders, not just the client. "Thursday 4pm works" is an
         agreement whichever end of the thread types it. */
      await ctx.scheduler.runAfter(0, internal.scheduling.consider, {
        clientId: client._id,
        cite: externalId,
        text: m.text,
        ts: m.ts,
        // Proposals need to know who asked: a client offering 6pm is a card
        // for the advisor; the advisor offering 6pm is a question the CLIENT
        // answers, and carding it would have the advisor confirm to themselves.
        sender: m.from,
      });

      seq++;
      inserted++;
    }

    if (seq !== client.seq) await ctx.db.patch(client._id, { seq });

    return { inserted, skipped: messages.length - inserted, nextSeq: seq };
  },
});

/**
 * One email into the record, with the same guarantees as a chat message:
 * externalId minted transactionally, deduped on (client, sourceId), text only.
 * Everything downstream — ledger, agent, schedule reader — reads messages,
 * not channels, which is the whole point of ingesting email here rather than
 * building an email pipeline beside the chat one.
 */
/** Which client tracks this chat, for actions that only hold a sourceId. */
export const clientForSource = internalQuery({
  args: { sourceId: v.string() },
  handler: async (ctx, { sourceId }) => {
    const c = await ctx.db
      .query("clients")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .unique();
    return c ? { clientId: c._id, key: c.key } : null;
  },
});

/**
 * A transcribed voice note enters the thread as the client's own words —
 * which they are — and gets the same second reader chat gets: "Thursday 4pm
 * works" said aloud is the same agreement it is typed.
 */
export const ingestVoice = internalMutation({
  args: { clientId: v.id("clients"), sourceId: v.string(), ts: v.number(), text: v.string() },
  handler: async (ctx, { clientId, sourceId, ts, text }) => {
    if (text.trim() === "") return { inserted: 0 };
    const client = await ctx.db.get(clientId);
    if (!client) return { inserted: 0 };

    const dupe = await ctx.db
      .query("messages")
      .withIndex("by_client_source", (q) => q.eq("clientId", clientId).eq("sourceId", sourceId))
      .unique();
    if (dupe) return { inserted: 0 };

    const externalId = `${client.key}-${String(client.seq).padStart(3, "0")}`;
    await ctx.db.insert("messages", {
      clientId, externalId, sourceId, sender: "client", ts, text, via: "voice",
    });
    await ctx.db.patch(clientId, { seq: client.seq + 1 });

    await ctx.scheduler.runAfter(0, internal.scheduling.consider, {
      clientId, cite: externalId, text, ts,
    });
    return { inserted: 1 };
  },
});

/** An advisor-only line in the thread: call logs, voice-note digests. */
export const noteInThread = internalMutation({
  args: { clientId: v.id("clients"), sourceId: v.string(), ts: v.number(), text: v.string() },
  handler: async (ctx, { clientId, sourceId, ts, text }) => {
    const client = await ctx.db.get(clientId);
    if (!client) return { inserted: 0 };
    const dupe = await ctx.db
      .query("messages")
      .withIndex("by_client_source", (q) => q.eq("clientId", clientId).eq("sourceId", sourceId))
      .unique();
    if (dupe) return { inserted: 0 };
    const externalId = `${client.key}-${String(client.seq).padStart(3, "0")}`;
    await ctx.db.insert("messages", {
      clientId, externalId, sourceId, sender: "advisor", ts, text, via: "call",
    });
    await ctx.db.patch(clientId, { seq: client.seq + 1 });
    return { inserted: 1 };
  },
});

export const ingestEmail = internalMutation({
  args: {
    key: v.string(),
    sourceId: v.string(),
    ts: v.number(),
    text: v.string(),
  },
  handler: async (ctx, { key, sourceId, ts, text }) => {
    if (text.trim() === "") return { inserted: 0 };
    const client = await ctx.db
      .query("clients")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!client) return { inserted: 0 };

    const dupe = await ctx.db
      .query("messages")
      .withIndex("by_client_source", (q) => q.eq("clientId", client._id).eq("sourceId", sourceId))
      .unique();
    if (dupe) return { inserted: 0 };

    const externalId = `${client.key}-${String(client.seq).padStart(3, "0")}`;
    await ctx.db.insert("messages", {
      clientId: client._id,
      externalId,
      sourceId,
      sender: "client",
      ts,
      text,
    });
    await ctx.db.patch(client._id, { seq: client.seq + 1 });

    // Email gets the same second reader chat gets: "Thursday 4pm works" in an
    // email is the same agreement it is in a chat.
    await ctx.scheduler.runAfter(0, internal.scheduling.consider, {
      clientId: client._id,
      cite: externalId,
      text,
      ts,
    });

    return { inserted: 1 };
  },
});

/**
 * Where this client's email replies go.
 *
 * Advisor-entered, because no platform we read carries it. Stored on the
 * client rather than in the page so it survives reinstalls and is one fact,
 * not one per machine.
 */
export const setEmail = mutation({
  args: { key: v.string(), email: v.string() },
  handler: async (ctx, { key, email }) => {
    const client = (await ctx.db.query("clients").collect()).find((c) => c.key === key);
    if (!client) throw new Error(`No client ${key}`);
    // Empty clears it: a wrong address is worse than none.
    await ctx.db.patch(client._id, { email: email.trim() === "" ? undefined : email.trim() });
  },
});

/** Connection state for the pairing UI. Single row, replaced in place. */
export const setPairing = mutation({
  args: {
    platform: v.string(),
    state: v.union(
      v.literal("connecting"),
      v.literal("needs-login"),
      v.literal("qr"),
      v.literal("open"),
      v.literal("closed"),
      v.literal("logged-out"),
    ),
    qr: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("pairing").first();
    const next = { ...args, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, next);
    else await ctx.db.insert("pairing", next);
  },
});

/** Marks a Hermes pass as done, so the debounce has something to read. */
export const markAnalyzed = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx: MutationCtx, { clientId }: { clientId: Id<"clients"> }) => {
    await ctx.db.patch(clientId, { analyzedTs: Date.now() });
  },
});

/**
 * A, B, … Z, AA, AB … — spreadsheet columns.
 *
 * `data/types.ts` types ClientKey as the union "A"|"B"|"C"|"D" today, which the
 * frontend widens to string as part of going live. Single letters cover the
 * realistic case; the two-letter tail exists so the 27th client is a naming
 * question rather than a crash.
 */
function nextKey(taken: ReadonlySet<string>): string {
  for (let i = 0; i < 26 * 27; i++) {
    const key = i < 26 ? letter(i) : `${letter(Math.floor(i / 26) - 1)}${letter(i % 26)}`;
    if (!taken.has(key)) return key;
  }
  throw new Error("Ran out of client keys");
}

const letter = (i: number): string => String.fromCharCode(65 + i);

/** Exported for the query layer, which needs the same client→doc lookup. */
export async function clientBySource(
  ctx: MutationCtx,
  sourceId: string,
): Promise<Doc<"clients"> | null> {
  return await ctx.db
    .query("clients")
    .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
    .unique();
}
