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

  /**
   * A phone ringing right now. One row per caller, flipped active/inactive
   * by the bridge as Telegram reports the call — the page subscribes and
   * turns the island into an answer button while a row is live.
   */
  ringing: defineTable({
    sourceId: v.string(),
    name: v.string(),
    startedTs: v.number(),
    active: v.boolean(),
  })
    .index("by_active", ["active"])
    .index("by_source", ["sourceId"]),

  /**
   * Each client's lifecycle stage as the model last read it from their own
   * messages — agreement to a proposal moves them forward, a completed
   * purchase moves them on, all without a hand touching it. Only confident,
   * verbatim-cited readings land here; the authored book is the floor.
   */
  clientStages: defineTable({
    clientKey: v.string(),
    stage: v.union(
      v.literal("inquiring"),
      v.literal("proposing"),
      v.literal("completed"),
      v.literal("maturing"),
      v.literal("renewing"),
    ),
    why: v.string(),
    /** externalId of the message that proves the move. Verbatim-gated. */
    cite: v.string(),
    ts: v.number(),
  }).index("by_client", ["clientKey"]),

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
    /** Where email replies go. Set by the advisor; absent until they do. */
    email: v.optional(v.string()),
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
    /**
     * How it arrived, when not typed: "voice" is a transcribed voice note —
     * the client's real words, a legitimate quote surface — and "call" is
     * an advisor-only log line (call metadata, voice-note digests). Nothing
     * in a thread is ever sent to a client, so both are advisor-only by
     * construction; the flag exists so the page can say so.
     */
    via: v.optional(v.union(v.literal("voice"), v.literal("call"), v.literal("email"))),
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
   * One reading of the whole client, model-written: how they feel, what they
   * want. Prose, and displayed as prose — but its cites must name spans that
   * survived this run's gate, checked in emotions.record, so the sentence can
   * always be traced to messages that actually carry it. A digest whose cites
   * do not survive is not stored at all.
   */
  digests: defineTable({
    clientId: v.id("clients"),
    feel: v.string(),
    want: v.string(),
    /** externalIds of gate-surviving spans this reading rests on. */
    cites: v.array(v.string()),
    generatedTs: v.number(),
    model: v.string(),
  }).index("by_client", ["clientId"]),

  /**
   * A time a client offered, waiting for the advisor to answer.
   *
   * The deliberate opposite of the agree path. "Thursday 4pm works" becomes a
   * tentative block immediately, because it is agreement and a wrong block is
   * one tap to undo. "Is it possible to meet at 6pm" is a question — nothing
   * was agreed, so nothing touches the calendar until the advisor accepts,
   * and accepting is also how the client gets their answer. Same cite rule as
   * events: one sentence proposes once, forever.
   */
  proposals: defineTable({
    clientId: v.id("clients"),
    /** externalId of the message that asked. The citation, and the dedupe key. */
    cite: v.string(),
    /** The sentence, verbatim, so the card shows what was actually asked. */
    text: v.string(),
    /** The instant asked for, resolved in Asia/Kuala_Lumpur. */
    at: v.number(),
    minutes: v.number(),
    status: v.union(v.literal("open"), v.literal("accepted"), v.literal("declined")),
    /** The asking message's own timestamp. */
    ts: v.number(),
    decidedAt: v.optional(v.number()),
  })
    .index("by_cite", ["cite"])
    .index("by_status", ["status"])
    .index("by_client", ["clientId"]),

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
    /** Advisor-set weight. Absent means unrated, which the UI shows as such. */
    importance: v.optional(v.string()),
    /** The advisor's own prep note, written at confirm time or after. */
    prepUser: v.optional(v.string()),
    /** Assistant-suggested prep, newline-joined. */
    prepAi: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_google", ["googleId"])
    .index("by_start", ["startsAt"])
    /* One message must never book twice. The citation is the dedupe key, so
       "have we already acted on this sentence" is a lookup rather than a scan
       that gets slower as the diary fills. */
    .index("by_cite", ["inferredCite"])
    .index("by_client", ["clientKey"]),

  /**
   * What the agent noticed about the person, as opposed to the thread.
   *
   * Personalisation is the product for this advisor — a daughter starting
   * secondary school, a renovation, a stated risk allergy — and it is exactly
   * what falls out of memory at a hundred clients. Every note passed the same
   * verbatim gate as a recommendation claim: the quote is in the message or
   * the note was never stored. Replaced wholesale on each analysis, because a
   * note is a reading of the thread as it stands, not an archive.
   */
  notes: defineTable({
    clientId: v.id("clients"),
    text: v.string(),
    /** The message that says so. */
    cite: v.string(),
    updatedAt: v.number(),
  }).index("by_client", ["clientId"]),

  /**
   * Dated work. See convex/tasks.ts for the rule that keeps this from
   * becoming a todo list: no date by which it stops being optional, no row.
   */
  tasks: defineTable({
    title: v.string(),
    /** The deadline, and the plan. Dragging a task moves this. */
    dueMs: v.number(),
    clientKey: v.optional(v.string()),
    /** The immovable fact underneath, where there is one. Drags warn past it. */
    hardMs: v.optional(v.number()),
    source: v.union(v.literal("advisor"), v.literal("chadbuddy")),
    /** Dedupe key: prep:<eventId>, mature:<holdingId>. One task per fact. */
    ref: v.optional(v.string()),
    cite: v.optional(v.string()),
    /** What kind of work, for the calendar's filters. Absent = uncategorised. */
    kind: v.optional(v.union(v.literal("email"), v.literal("outreach"), v.literal("prep"))),
    done: v.boolean(),
    doneTs: v.optional(v.number()),
    createdTs: v.number(),
  })
    .index("by_due", ["dueMs"])
    .index("by_ref", ["ref"]),

  /**
   * Dated work the model read out of the chats, waiting for a person.
   *
   * A suggestion is not a task: it becomes one only when the advisor accepts
   * it, and a dismissed one stays here so the same reading of the same
   * message cannot come back tomorrow wearing a fresh id. Every suggestion
   * carries the verbatim quote that convinced the model, gated against the
   * real message before it is ever stored.
   */
  taskSuggestions: defineTable({
    clientKey: v.string(),
    title: v.string(),
    dueMs: v.number(),
    /** One line of why, in the model's words. */
    why: v.string(),
    /** externalId of the message it read this from. Verbatim-gated. */
    cite: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("email"), v.literal("outreach"), v.literal("prep"))),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("dismissed")),
    createdTs: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_client_title", ["clientKey", "title"]),

  /**
   * The live market feed: Google News, filtered and tagged by the model
   * hourly. Headlines and links are the outlet's own, verbatim — the model
   * chooses and annotates, it never rewrites, so every card still ends at a
   * real article. The desk falls back to the curated seed when this is empty.
   */
  marketEvents: defineTable({
    ts: v.number(),
    headline: v.string(),
    summary: v.string(),
    lean: v.string(),
    classes: v.array(v.string()),
    sourceName: v.string(),
    sourceUrl: v.string(),
    impactNote: v.string(),
    fetchedAt: v.number(),
  }).index("by_ts", ["ts"]),

  /** One status reply per person per busy block. The dedupe, durable. */
  presenceSent: defineTable({
    clientId: v.id("clients"),
    blockId: v.id("events"),
    ts: v.number(),
  }).index("by_client_block", ["clientId", "blockId"]),

  /**
   * The phone's call log, one row per call, posted by an automation app on
   * the phone itself — the only device that can see it. Matched to a client
   * by number where possible; kept anyway where not, because an unmatched
   * missed call is still a fact the advisor may want to see.
   */
  phoneCalls: defineTable({
    /** As the phone reported it. Normalised digits kept alongside. */
    number: v.string(),
    digits: v.string(),
    direction: v.union(v.literal("incoming"), v.literal("outgoing"), v.literal("missed")),
    durationSec: v.number(),
    ts: v.number(),
    clientId: v.optional(v.id("clients")),
  })
    .index("by_ts", ["ts"])
    .index("by_client", ["clientId"]),

  /** The real book, one row per product, replaced whole on each import. */
  holdings: defineTable({
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
    importedAt: v.number(),
  }).index("by_client", ["clientKey"]),

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
