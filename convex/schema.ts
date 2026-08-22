/**
 * The tables data/types.ts has been describing in a comment since the seed was
 * written. `messages` mirrors SeedMessage one-for-one, and `by_client_ts` is
 * the index that comment names, deliberately unchanged.
 *
 * Two things this schema is careful about, both of them citation integrity:
 *
 *   · `externalId` is minted here and never anywhere else. It is the key every
 *     ledger entry, evidence link and scroll-to-source target in the UI points
 *     at, so it has to be unique and stable for the life of the message. An
 *     adapter cannot guarantee that — it has no transaction — so the mutation
 *     mints it and the adapter never sees one.
 *
 *   · `rejected` is a first-class table, not a debug log. The agent will
 *     fabricate quotes; that is a property of language models, not a bug to be
 *     fixed. What makes the product honest is that fabrications are caught,
 *     counted and visible. derive.ts already renders a discarded count, and a
 *     rejection rate you cannot see is a rejection rate you will stop believing.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  /**
   * Every conversation the account can see, tracked or not — this is what the
   * advisor's chat picker reads. Groups and channels are stored so they can be
   * *shown and declined*, rather than hidden by a rule the advisor can't audit.
   */
  chats: defineTable({
    /** Platform-native id: a Telegram peer id today. */
    sourceId: v.string(),
    name: v.string(),
    handle: v.string(),
    isGroup: v.boolean(),
    /** Bots and service accounts are not relationships. Surfaced, never tracked. */
    isBot: v.boolean(),
    lastTs: v.number(),
    msgCount: v.number(),
    /** Age in days of the oldest message. Below ~120 there is no baseline to decay from. */
    spanDays: v.number(),
  })
    .index("by_source", ["sourceId"])
    .index("by_last", ["lastTs"]),

  /** A chat the advisor has explicitly promoted to a tracked client. */
  clients: defineTable({
    /** Citation prefix — "A". Assigned in pick order, stable for life. */
    key: v.string(),
    sourceId: v.string(),
    name: v.string(),
    handle: v.string(),
    /**
     * Next externalId number. Read-modify-written inside the ingest mutation,
     * which Convex runs transactionally, so concurrent batches cannot collide
     * on a number the way a file-based store would.
     */
    seq: v.number(),
    /** Last Hermes pass, epoch ms. Debounce lives here, not in the bridge. */
    analyzedTs: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    .index("by_source", ["sourceId"]),

  messages: defineTable({
    clientId: v.id("clients"),
    /** "D-012". The citation key. Minted once, never renumbered. */
    externalId: v.string(),
    /** The platform's own id, for dedupe on re-sync. */
    sourceId: v.string(),
    sender: v.union(v.literal("advisor"), v.literal("client")),
    ts: v.number(),
    text: v.string(),
  })
    // The index data/types.ts:13 specifies, kept verbatim.
    .index("by_client_ts", ["clientId", "ts"])
    .index("by_client_source", ["clientId", "sourceId"])
    .index("by_external", ["externalId"]),

  /** Agent output that survived the verbatim gate. Mirrors Idea at src/copy.ts:33. */
  ideas: defineTable({
    clientId: v.id("clients"),
    rank: v.string(),
    title: v.string(),
    why: v.string(),
    draftLabel: v.string(),
    draft: v.string(),
    btn: v.string(),
    meta: v.string(),
    intent: v.union(
      v.literal("send"),
      v.literal("hold"),
      v.literal("blocked"),
      v.literal("note"),
    ),
    /** externalIds, every one already verified against real message text. */
    cites: v.array(v.string()),
    generatedTs: v.number(),
    model: v.string(),
  }).index("by_client", ["clientId"]),

  /**
   * Emotion spans, extracted per message and grounded in it.
   *
   * The extraction pass derive.ts:268 said did not exist. It runs outside
   * Convex (LangExtract is Python — see bridge/emotion/), but nothing lands
   * here without passing the same verbatim gate the ideas pass: `quote` is the
   * exact span the label was read from, checked against the cited message's
   * real text in emotions.record. A label that cannot show its span is not a
   * weaker label, it is an invented one, and it goes to `rejected` like any
   * other fabricated citation.
   *
   * One row per grounded span, not per client: Faizal being "appreciative" in
   * April and "curt" in August is the decay story itself, and collapsing that
   * to a single mood would throw away exactly what the dashboard measures.
   */
  emotions: defineTable({
    clientId: v.id("clients"),
    /** externalId of the message the span sits in. The citation. */
    sourceId: v.string(),
    /** The span, character-for-character from that message. */
    quote: v.string(),
    /** e.g. "frustrated", "appreciative". The extractor's word, not an enum. */
    label: v.string(),
    intensity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    /** The cited message's own timestamp, so "latest read" needs no join. */
    ts: v.number(),
    generatedTs: v.number(),
    model: v.string(),
  }).index("by_client", ["clientId"]),

  /**
   * Key points the client stated, from the same extraction pass.
   *
   * A budget, a constraint, an instruction, a life event — the facts an
   * advisor pages back through a thread to re-find before replying. `point` is
   * the model's short restatement and is displayed AS a restatement, with the
   * verbatim `quote` and its message id beside it; that is the ideas table's
   * own precedent (model prose, evidence attached), and the quote passes the
   * same gate before any of it is stored.
   */
  keypoints: defineTable({
    clientId: v.id("clients"),
    sourceId: v.string(),
    quote: v.string(),
    /** e.g. "budget", "goal", "constraint", "deadline", "instruction". */
    kind: v.string(),
    /** The point, restated small enough to scan. */
    point: v.string(),
    ts: v.number(),
    generatedTs: v.number(),
    model: v.string(),
  }).index("by_client", ["clientId"]),

  /**
   * Agent output that did NOT survive the gate. Kept, not discarded.
   *
   * Note `reason`: the gate can only prove a quote exists, not that the quote
   * supports the claim built on it. Measured this directly — a model answered
   * an unanswerable question by stretching a real quote, and passed. So this
   * table is a rate to watch, not a certificate of safety.
   */
  rejected: defineTable({
    clientId: v.id("clients"),
    claim: v.string(),
    sourceId: v.string(),
    quote: v.string(),
    reason: v.union(
      v.literal("no-such-message"),
      v.literal("quote-not-verbatim"),
      v.literal("no-surviving-cites"),
    ),
    ts: v.number(),
    model: v.string(),
  }).index("by_client", ["clientId"]),

  /**
   * Messages the advisor has approved for sending.
   *
   * A queue rather than a direct call, for two reasons. The page cannot reach
   * Telegram — only the bridge holds that socket — so something has to carry
   * the intent across. And a queue leaves a record: every message the agent
   * drafted and a human approved is a row here, with what happened to it.
   *
   * `state` never starts as anything but "queued". Nothing in this schema lets
   * the agent write here directly; the mutation that does is called by a click.
   */
  outbox: defineTable({
    clientId: v.id("clients"),
    /** The chat to deliver to — platform-native id, same as clients.sourceId. */
    sourceId: v.string(),
    text: v.string(),
    /** Which recommendation this came from, for auditing what was acted on. */
    ideaRank: v.optional(v.string()),
    state: v.union(v.literal("queued"), v.literal("sent"), v.literal("failed")),
    queuedTs: v.number(),
    sentTs: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_state", ["state"])
    .index("by_client", ["clientId"]),

  /**
   * Connection state, single row. The bridge writes it; the island subscribes.
   *
   * `qr` exists because GramJS can pair by QR as well as by phone code, and the
   * frontend contract was written around a QR image. Optional because the
   * phone-code path never populates it.
   */
  /**
   * Google's tokens, and nothing else in the system may hold them.
   *
   * The OAuth callback lands on a Convex httpAction rather than in the app, so
   * the authorization code is exchanged server-side and the refresh token never
   * travels to a client that a user could open devtools on. The dashboard asks
   * Convex for events; it has no idea Google exists.
   *
   * `syncToken` is Google's incremental cursor. Keeping it turns every sync
   * after the first into a delta rather than a full list — which matters
   * because Google expires the token on its own schedule and the correct
   * response is a full resync, not an error. See calendar.ts:pull.
   */
  calendarAuth: defineTable({
    account: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    /** Epoch ms. Refreshed a minute early rather than on expiry. */
    expiresAt: v.number(),
    scope: v.string(),
    syncToken: v.optional(v.string()),
    /** Google's push channel, so it can be renewed before it lapses. */
    channelId: v.optional(v.string()),
    channelExpiresAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_account", ["account"]),

  /**
   * The calendar, mirrored.
   *
   * Mirrored rather than proxied for the same reason messages are: the
   * dashboard renders synchronously from a reactive query, and a render that
   * waits on Google's API is a render that stutters when Google is slow. The
   * mirror is also what makes the seed and the live path identical — both
   * answer the same query.
   *
   * `booking` carries Google's own status. A tentative row is one this system
   * created from a message it read, and the advisor has not confirmed; that
   * distinction has to survive the round trip or the confirm button has nothing
   * to act on.
   */
  events: defineTable({
    /** Google's event id. Absent until a locally-created event has synced up. */
    googleId: v.optional(v.string()),
    calendarId: v.string(),
    title: v.string(),
    /** Epoch ms, so every consumer compares numbers rather than strings. */
    startsAt: v.number(),
    minutes: v.number(),
    kind: v.string(),
    where: v.string(),
    booking: v.union(v.literal("confirmed"), v.literal("tentative"), v.literal("cancelled")),
    /** The client this is with, when it is with one. */
    clientKey: v.optional(v.string()),
    withName: v.optional(v.string()),
    /** Set when this was booked from a message rather than by a person. */
    inferredSource: v.optional(v.string()),
    inferredCite: v.optional(v.string()),
    /** A conferencing link, which is also how an online meeting is detected. */
    conferenceUrl: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_google", ["googleId"])
    .index("by_start", ["startsAt"])
    /* One message must never book twice. The citation is the dedupe key, so
       "have we already acted on this sentence" is a lookup rather than a scan
       that gets slower as the diary fills. */
    .index("by_cite", ["inferredCite"])
    .index("by_client", ["clientKey"]),

  pairing: defineTable({
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
    updatedAt: v.number(),
  }),
});
