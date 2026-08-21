/**
 * Phase 0, Telegram edition — measure before building.
 *
 * The WhatsApp spike existed to answer "does this run, and how much history do
 * we get". Telegram answers the second question differently and much better:
 * history lives on Telegram's servers and is paged on demand, so there is no
 * initial-sync lottery to lose. What still needs measuring is whether *this
 * account's* chats actually contain 120 days of conversation — a server that
 * will happily page back four years doesn't help if the chats are two weeks old.
 *
 * So this prints, per chat: how many text messages fall inside the window the
 * dashboard measures, and how far back the chat really goes.
 *
 * Unlike the WhatsApp spike, this one uses an official API. It still gets the
 * same reconnect discipline, because "official" is not the same as "unlimited"
 * — see the FLOOD_WAIT note below.
 *
 * First run asks for your phone number and the login code Telegram sends you
 * (and your 2FA password, if you have one). After that the session string in
 * .tg/session.txt is reused and it will not ask again.
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import type { Api } from "telegram";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { DAY, WANTED_DAYS } from "../types.ts";

const SESSION_FILE = ".tg/session.txt";

/**
 * From my.telegram.org → API development tools. The hash is a real secret;
 * it lives in .env.local, which Bun loads automatically and git ignores.
 */
const apiId = Number(process.env["TELEGRAM_API_ID"] ?? "");
const apiHash = process.env["TELEGRAM_API_HASH"] ?? "";

if (!Number.isInteger(apiId) || apiId <= 0 || apiHash === "") {
  console.error(
    "\nMissing Telegram credentials.\n\n" +
      "  1. Go to https://my.telegram.org → API development tools\n" +
      "  2. Create an app (only App title and Short name matter)\n" +
      "  3. Put both values in .env.local at the repo root:\n\n" +
      "       TELEGRAM_API_ID=1234567\n" +
      "       TELEGRAM_API_HASH=abcdef0123456789abcdef0123456789\n\n" +
      "  .env.local is already gitignored. The hash is a secret — treat it like a password.\n",
  );
  process.exit(1);
}

/** How many chats to profile. The picker will show more; this is a sample. */
const SAMPLE_CHATS = 15;
/** Per-chat ceiling so one busy group can't turn this into a 20-minute crawl. */
const MAX_SCAN = 2_000;

const cutoff = Date.now() - WANTED_DAYS * DAY;

function loadSession(): string {
  return existsSync(SESSION_FILE) ? readFileSync(SESSION_FILE, "utf8").trim() : "";
}

function saveSession(s: string): void {
  mkdirSync(".tg", { recursive: true });
  writeFileSync(SESSION_FILE, s, "utf8");
}

/**
 * The same extraction the real adapter uses. Anything without text — stickers,
 * calls, media with no caption, service messages — is skipped rather than
 * stubbed: a synthetic "[image]" would be a quote surface no human wrote, and
 * the ledger's verbatim gate matches against message text.
 */
function textOf(m: Api.Message): string | null {
  const t = m.message;
  return typeof t === "string" && t.trim() !== "" ? t : null;
}

const ask = (q: string): string => (globalThis.prompt(q) ?? "").trim();

const session = new StringSession(loadSession());
const client = new TelegramClient(session, apiId, apiHash, {
  connectionRetries: 3,
  // GramJS sleeps through FLOOD_WAIT below this threshold instead of throwing.
  // Telegram rate-limits rather than bans for reads, but the polite path is
  // still to back off rather than to retry into the wall — the WhatsApp ban
  // came from exactly that mistake.
  floodSleepThreshold: 120,
});

console.log("[tg] connecting…");

await client.start({
  phoneNumber: async () => ask("phone number (with country code, e.g. +60…): "),
  password: async () => ask("2FA password (blank if you have none): "),
  phoneCode: async () => ask("login code Telegram just sent you: "),
  onError: (err) => console.error("[tg] auth error:", err.message),
});

saveSession(session.save());
console.log(`[tg] connected. session cached in ${SESSION_FILE} — you won't be asked again.\n`);

const me = await client.getMe();
console.log(`[tg] signed in as ${me.firstName ?? ""} ${me.lastName ?? ""}`.trim());

/* ── profile the chats ───────────────────────────────────────────── */

const dialogs = await client.getDialogs({ limit: SAMPLE_CHATS });
console.log(`[tg] profiling ${dialogs.length} most recent chats against a ${WANTED_DAYS}-day window…\n`);

interface Profile {
  name: string;
  kind: string;
  isBot: boolean;
  inWindow: number;
  fromThem: number;
  /** Age in days of the chat's genuinely oldest message. */
  spanDays: number;
  truncated: boolean;
}

const profiles: Profile[] = [];
const now = Date.now();

for (const d of dialogs) {
  const kind = d.isGroup ? "group" : d.isChannel ? "channel" : "dm";

  // A bot is not a relationship. BotFather and the Telegram service account
  // (id 777000) both look like busy DMs by message count, and counting them
  // as clients is what made the first version of this script report a far
  // rosier verdict than the data supports.
  const ent = d.entity as { bot?: boolean; id?: { toString(): string } } | undefined;
  const isBot = ent?.bot === true || ent?.id?.toString() === "777000";

  // Ground truth, one request: reverse+limit:1 is the oldest message Telegram
  // still holds. Walking backwards and stopping at the window edge cannot
  // distinguish "chat is young" from "iterator gave up early".
  let spanDays = 0;
  const first = (await client.getMessages(d.entity, { limit: 1, reverse: true }))[0];
  if (first) spanDays = Math.floor((now - first.date * 1000) / DAY);

  let inWindow = 0;
  let fromThem = 0;
  let scanned = 0;
  let truncated = false;

  for await (const m of client.iterMessages(d.entity, { limit: MAX_SCAN, waitTime: 1 })) {
    scanned++;
    const ts = m.date * 1000;
    if (ts < cutoff) break;
    if (textOf(m) === null) continue;
    inWindow++;
    if (!m.out) fromThem++;
    if (scanned >= MAX_SCAN) {
      truncated = true;
      break;
    }
  }

  profiles.push({ name: d.title ?? "(untitled)", kind, isBot, inWindow, fromThem, spanDays, truncated });
}

/* ── report ──────────────────────────────────────────────────────── */

profiles.sort((a, b) => b.inWindow - a.inWindow);

console.log(`${"chat".padEnd(28)} ${"kind".padEnd(8)} ${"msgs".padStart(6)} ${"theirs".padStart(7)} ${"span".padStart(7)}`);
console.log("─".repeat(70));
for (const p of profiles) {
  const name = p.name.length > 27 ? `${p.name.slice(0, 26)}…` : p.name;
  const tag = p.isBot ? "  ← bot" : p.truncated ? "  (capped)" : "";
  console.log(
    `${name.padEnd(28)} ${p.kind.padEnd(8)} ${String(p.inWindow).padStart(6)} ${String(p.fromThem).padStart(7)} ${`${p.spanDays}d`.padStart(7)}${tag}`,
  );
}
console.log("─".repeat(70));

/**
 * What "usable" actually requires.
 *
 * The dashboard does not score volume, it scores *change* — a 30-day recent
 * window measured against a 90-day baseline. So a chat needs three things at
 * once, and the first version of this check tested only the second:
 *
 *   · a human on the other end (not a bot, not a service account)
 *   · enough messages to measure
 *   · enough elapsed time to have a baseline to decay from
 *
 * A 41-message chat that started three weeks ago has no baseline. Scoring it
 * produces a number, and the number means nothing.
 */
const human = profiles.filter((p) => p.kind === "dm" && !p.isBot);
const chatty = human.filter((p) => p.fromThem >= 10 && p.inWindow >= 20);
const usable = chatty.filter((p) => p.spanDays >= WANTED_DAYS);

console.log(`\n  human DMs (not bots):            ${human.length}`);
console.log(`  …with 20+ msgs, 10+ from them:   ${chatty.length}`);
console.log(`  …AND ${WANTED_DAYS}+ days of history:      ${usable.length}   ← usable as clients\n`);

if (usable.length >= 2) {
  console.log("VERDICT  enough real conversation to drive the decay model.");
} else {
  const best = human.reduce((m, p) => Math.max(m, p.spanDays), 0);
  console.log(
    "VERDICT  NOT enough to drive the decay model.\n" +
      `         Deepest human DM spans ${best}d; the baseline alone needs 90d after\n` +
      "         the 30-day recent window. Chats here are either too new or too sparse.\n\n" +
      "         This does not block the backend. Ingest, the Convex schema, the\n" +
      "         Hermes pass and the verbatim gate can all be built and verified\n" +
      "         against these threads — they just cannot be *scored* meaningfully.\n" +
      "         Demo the dashboard on the seed threads; treat live Telegram as\n" +
      "         proof that ingest works, not proof that the model works.",
  );
}

await client.disconnect();
process.exit(0);
