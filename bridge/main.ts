/**
 * The bridge: a Telegram session in one hand, Convex in the other.
 *
 *   bun run wa          (name kept: "the message bridge", not the platform)
 *
 * It owns exactly one thing the rest of the system cannot — a long-lived
 * connection. Convex actions time out after ten minutes and hold no sockets,
 * so something local has to sit on the wire. That is the whole reason this
 * process exists, and it deliberately does nothing else: no scoring, no agent,
 * no citation minting. It moves messages and gets out of the way.
 *
 * Talks to Convex over the HTTP client with `anyApi`, so the bridge needs none
 * of the generated types and stays typecheckable without a running backend.
 */

import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";

import { TelegramSource } from "./telegram/source.ts";
import { DAY, WANTED_DAYS, type BridgeChat, type BridgeMessage, type Source } from "./types.ts";
import { MISSING_CONVEX, convexUrl as resolveConvexUrl } from "../scripts/convex-url.ts";

/** Must match BATCH_LIMIT in convex/ingest.ts — mutations get one second. */
const BATCH = 200;

/** Refresh the picker's chat list this often. */
const CHAT_REFRESH_MS = 5 * 60_000;

/**
 * How far back to pull history on start. **Zero by default — live only.**
 *
 * The dashboard measures decay against a 90-day baseline, so old history is
 * normally the whole point. On this account it isn't: profiling found 0 of 50
 * chats scorable — every DM is a bot, too short, or dormant. Backfilling that
 * fills the dashboard with conversations that cannot be scored and buries the
 * messages the advisor actually wants to watch.
 *
 * So the default is to start blank and accumulate from the first live message.
 * Set BRIDGE_BACKFILL_DAYS=120 to pull history once a chat is worth it.
 */
const BACKFILL_DAYS = Number(process.env["BRIDGE_BACKFILL_DAYS"] ?? "0");

/* Resolved the same way the page resolves it, so a backend the dashboard can
   reach is a backend this can reach. It covers both deployments: self-hosted on
   loopback, and Convex Cloud, where `convex dev` writes only CONVEX_DEPLOYMENT
   and the hostname is derived from it. */
const convexUrl = resolveConvexUrl();
const apiId = Number(process.env["TELEGRAM_API_ID"] ?? "");
const apiHash = process.env["TELEGRAM_API_HASH"] ?? "";

if (convexUrl === "") {
  console.error(MISSING_CONVEX);
  process.exit(1);
}
if (!Number.isInteger(apiId) || apiId <= 0 || apiHash === "") {
  console.error("Missing TELEGRAM_API_ID / TELEGRAM_API_HASH in .env.local. See `bun run tg:check`.");
  process.exit(1);
}

const convex = new ConvexHttpClient(convexUrl);
const source: Source = new TelegramSource(apiId, apiHash);

/**
 * Every Convex function this process depends on, named once.
 *
 * The bridge uses `anyApi` rather than convex/_generated on purpose: generated
 * types only exist after `convex dev` has run against a live backend, and the
 * bridge should typecheck without one. The cost is that `anyApi` is typed with
 * index signatures, which `noUncheckedIndexedAccess` makes optional at every
 * lookup — so the narrowing happens here, in one table, instead of behind a
 * dozen non-null assertions scattered through the file.
 *
 * The table doubles as the dependency list: if a name here stops existing in
 * convex/, this is the only place that needs changing.
 */
const lookup = anyApi as unknown as Record<string, Record<string, unknown>>;
const q = (module: string, name: string): FunctionReference<"query"> =>
  lookup[module]?.[name] as FunctionReference<"query">;
const m = (module: string, name: string): FunctionReference<"mutation"> =>
  lookup[module]?.[name] as FunctionReference<"mutation">;

const API = {
  pickClients: m("ingest", "pickClients"),
  pendingSends: q("outbox", "pending"),
  markSent: m("outbox", "markSent"),
  markFailed: m("outbox", "markFailed"),
  setPairing: m("ingest", "setPairing"),
  upsertChats: m("ingest", "upsertChats"),
  ingestBatch: m("ingest", "ingestBatch"),
  tracked: q("chats", "tracked"),
  recentChats: q("chats", "recent"),
} as const;

const say = (state: string, detail?: string): Promise<unknown> =>
  convex.mutation(API.setPairing, {
    platform: source.platform,
    state,
    ...(detail === undefined ? {} : { detail }),
  });

/** Chunked because a mutation that runs long is a mutation that fails. */
async function ingest(sourceId: string, messages: BridgeMessage[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < messages.length; i += BATCH) {
    const res = (await convex.mutation(API.ingestBatch, {
      sourceId,
      messages: messages.slice(i, i + BATCH),
    })) as { inserted: number };
    inserted += res.inserted;
  }
  return inserted;
}

async function publishChats(): Promise<BridgeChat[]> {
  const chats = await source.listChats(50);
  await convex.mutation(API.upsertChats, { chats });
  console.log(`[bridge] published ${chats.length} chats to the picker`);
  return chats;
}

/* ── auto-promotion ──────────────────────────────────────────────────
   The original rule was "nothing is a client until the advisor picks it",
   and it produced exactly the failure it was guarding against, seen from the
   other side: a real person messaged, the bridge shrugged, and the advisor
   heard about it a day later from the person. So the rule narrows: a HUMAN
   DIRECT MESSAGE promotes itself. Groups stay manual — a group is not a
   client — and bots stay out entirely; both were the actual noise the old
   rule existed for. Every promotion is logged loudly, because an automatic
   client the advisor cannot see being created is how trust in the list dies. */

/** How much history a self-promoted chat pulls, so the agent has context. */
const PROMOTE_BACKFILL_DAYS = 45;

/** A person who messaged while the bridge was down is caught this far back. */
const SWEEP_HOURS = 48;

const promoting = new Set<string>();

async function promoteChat(chat: BridgeChat, why: string): Promise<void> {
  if (promoting.has(chat.sourceId)) return;
  promoting.add(chat.sourceId);

  await convex.mutation(API.upsertChats, { chats: [chat] });
  const picked = (await convex.mutation(API.pickClients, {
    sourceIds: [chat.sourceId],
  })) as Array<{ key: string }>;

  const history = await source.history(chat.sourceId, Date.now() - PROMOTE_BACKFILL_DAYS * DAY);
  const inserted = await ingest(chat.sourceId, history);

  console.log(
    `[auto] ${chat.name} promoted to client ${picked[0]?.key ?? "?"} (${why}) — ` +
      `${history.length} messages read, ${inserted} new`,
  );
}

/** Human DM: not a group, not a bot, not the service account. */
const promotable = (c: BridgeChat): boolean => !c.isGroup && !c.isBot;

/**
 * Startup sweep: whoever messaged while nothing was listening.
 *
 * The bridge holds the only socket, so its downtime is a hole in the record.
 * On start, any untracked human DM whose last message landed inside the sweep
 * window is promoted and backfilled — the "someone messaged me yesterday and
 * nothing happened" failure, repaired at the next start rather than
 * discovered in person. Capped, so a first run against a busy account cannot
 * promote half an address book in one go.
 */
async function sweepMissed(chats: BridgeChat[]): Promise<void> {
  const rows = (await convex.query(API.recentChats, { limit: 200 })) as Array<{
    sourceId: string;
    tracked: boolean;
  }>;
  const trackedIds = new Set(rows.filter((r) => r.tracked).map((r) => r.sourceId));

  const missed = chats
    .filter(promotable)
    .filter((c) => !trackedIds.has(c.sourceId))
    .filter((c) => c.lastTs > Date.now() - SWEEP_HOURS * 3_600_000)
    .sort((a, b) => b.lastTs - a.lastTs);

  const CAP = 10;
  for (const chat of missed.slice(0, CAP)) {
    try {
      await promoteChat(chat, "messaged while the bridge was down");
    } catch (err) {
      console.error(`[auto] could not promote ${chat.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (missed.length > CAP) {
    console.log(`[auto] ${missed.length - CAP} more recent DMs left unpromoted (cap ${CAP}) — pick them manually`);
  }
}

/**
 * Pull history for every tracked client.
 *
 * Idempotent end to end: ingestBatch dedupes on (client, sourceId), so running
 * this on every start costs requests but never duplicates a thread and never
 * burns an externalId. That property is worth more than the requests saved by
 * tracking a watermark, because a wrong watermark corrupts citations silently.
 */
async function backfill(): Promise<void> {
  if (BACKFILL_DAYS <= 0) {
    console.log(
      "[bridge] live-only: no history pulled. The dashboard starts blank and fills\n" +
        "         from your next message. Set BRIDGE_BACKFILL_DAYS=120 to pull history.",
    );
    return;
  }

  const clients = (await convex.query(API.tracked, {})) as Array<{
    key: string;
    name: string;
  }>;
  if (clients.length === 0) {
    console.log("[bridge] no clients picked yet — nothing to backfill");
    return;
  }

  const chats = (await convex.query(API.recentChats, { limit: 200 })) as Array<{
    sourceId: string;
    name: string;
    tracked: boolean;
  }>;

  const since = Date.now() - BACKFILL_DAYS * DAY;

  for (const chat of chats.filter((c) => c.tracked)) {
    const history = await source.history(chat.sourceId, since);
    const inserted = await ingest(chat.sourceId, history);
    const span = history.length > 0 ? Math.floor((Date.now() - history[0]!.ts) / DAY) : 0;
    console.log(
      `[bridge] ${chat.name}: ${history.length} messages read, ${inserted} new, ${span}d span` +
        (span < WANTED_DAYS ? `  ⚠ under the ${WANTED_DAYS}d the baseline needs` : ""),
    );
  }
}

/* ── run ─────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  await say("connecting");
  try {
    await source.connect();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await say("needs-login", msg);
    console.error(`[bridge] ${msg}`);
    process.exit(1);
  }
  await say("open");
  console.log("[bridge] connected");

  const chats = await publishChats();
  await sweepMissed(chats);
  await backfill();

  // Live arrivals. Only chats already promoted to clients are ingested —
  // everything else is noise until the advisor says otherwise.
  /**
   * Untracked chats are expected to fail here and are not worth logging — most
   * of the account is noise the advisor never picked.
   *
   * But they fail *identically* to a chat id that does not match the one the
   * picker stored, and that is a real hazard: listChats reads the dialog id
   * while live events carry message.chatId, and Telegram's sign conventions for
   * groups and channels are not obviously the same. A silent catch would make
   * "your messages never arrive" indistinguishable from "you didn't pick that
   * chat". So each unknown id is reported once, with the tracked set beside it.
   */
  const warned = new Set<string>();

  source.onMessage((chatId, message) => {
    void (async () => {
      try {
        const n = await ingest(chatId, [message]);
        if (n > 0) console.log(`[live] ${chatId} · ${message.from}: ${message.text.slice(0, 60)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        /* An unknown sender. If it is a human DM, this is a prospective
           client introducing themselves — promote, backfill, then ingest the
           message that triggered all of it. A chat with a fresh message is by
           definition near the top of the dialog list, so one listChats call
           finds it. */
        if (msg.includes("No tracked client") && !promoting.has(chatId)) {
          try {
            const chat = (await source.listChats(30)).find((c) => c.sourceId === chatId);
            if (chat && promotable(chat)) {
              await promoteChat(chat, "new conversation");
              await ingest(chatId, [message]);
              return;
            }
          } catch (inner) {
            console.error(`[auto] promotion of ${chatId} failed: ${inner instanceof Error ? inner.message : inner}`);
          }
        }

        if (warned.has(chatId)) return;
        warned.add(chatId);
        if (msg.includes("No tracked client")) {
          console.log(`[skip] ${chatId} — group or bot, not promoted. Pick it manually if it is a client.`);
        } else {
          console.error(`[live] ${chatId} failed: ${msg}`);
        }
      }
    })();
  });
  console.log("[bridge] listening for new messages. Ctrl+C to stop.");

  /**
   * The outbox: approved drafts leaving as real messages.
   *
   * A reactive subscription rather than a poll, so a click in the dashboard
   * lands in Telegram in about a second. Its own ConvexClient because the HTTP
   * client cannot subscribe.
   *
   * Every row here was put there by a human pressing a button — convex/outbox.ts
   * is the only writer, and the agent has no path to it. Sending is the one
   * thing this process does that cannot be undone, so it is also the one thing
   * it refuses to do on its own initiative.
   */
  const live = new ConvexClient(convexUrl);
  const sending = new Set<string>();

  live.onUpdate(API.pendingSends, {}, (value) => {
    const rows = value as Array<{ _id: string; sourceId: string; text: string }>;
    for (const row of rows) {
      // onUpdate can fire again before a send resolves; without this the same
      // row goes out twice and the client gets the message twice.
      if (sending.has(row._id)) continue;
      sending.add(row._id);

      void (async () => {
        try {
          await source.sendMessage(row.sourceId, row.text);
          await convex.mutation(API.markSent, { id: row._id });
          console.log(`[sent] ${row.sourceId}: ${row.text.slice(0, 60)}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await convex.mutation(API.markFailed, { id: row._id, error: msg });
          console.error(`[send failed] ${row.sourceId}: ${msg}`);
        } finally {
          sending.delete(row._id);
        }
      })();
    }
  });

  const refresh = setInterval(() => void publishChats(), CHAT_REFRESH_MS);

  const shutdown = async (): Promise<void> => {
    clearInterval(refresh);
    await live.close().catch(() => {});
    console.log("\n[bridge] shutting down");
    await say("closed").catch(() => {});
    await source.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

await main();
