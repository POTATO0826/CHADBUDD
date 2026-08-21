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

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";

import { TelegramSource } from "./telegram/source.ts";
import { DAY, WANTED_DAYS, type BridgeMessage, type Source } from "./types.ts";

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

const convexUrl = process.env["CONVEX_SELF_HOSTED_URL"] ?? process.env["CONVEX_URL"] ?? "";
const apiId = Number(process.env["TELEGRAM_API_ID"] ?? "");
const apiHash = process.env["TELEGRAM_API_HASH"] ?? "";

if (convexUrl === "") {
  console.error(
    "Missing CONVEX_SELF_HOSTED_URL in .env.local.\n\n" +
      "  docker compose up -d\n" +
      "  docker compose exec backend ./generate_admin_key.sh\n\n" +
      "  CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210\n" +
      "  CONVEX_SELF_HOSTED_ADMIN_KEY=<key>\n",
  );
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

async function publishChats(): Promise<void> {
  const chats = await source.listChats(50);
  await convex.mutation(API.upsertChats, { chats });
  console.log(`[bridge] published ${chats.length} chats to the picker`);
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

  await publishChats();
  await backfill();

  // Live arrivals. Only chats already promoted to clients are ingested —
  // everything else is noise until the advisor says otherwise.
  source.onMessage((chatId, message) => {
    void (async () => {
      try {
        const n = await ingest(chatId, [message]);
        if (n > 0) console.log(`[live] ${chatId}: ${message.text.slice(0, 60)}`);
      } catch {
        // An untracked chat throws by design; it is not an error worth logging.
      }
    })();
  });
  console.log("[bridge] listening for new messages. Ctrl+C to stop.");

  const refresh = setInterval(() => void publishChats(), CHAT_REFRESH_MS);

  const shutdown = async (): Promise<void> => {
    clearInterval(refresh);
    console.log("\n[bridge] shutting down");
    await say("closed").catch(() => {});
    await source.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

await main();
