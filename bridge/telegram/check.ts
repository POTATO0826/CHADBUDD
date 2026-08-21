/**
 * Credentials check — the cheap half of pairing.
 *
 * Signing in needs a phone number and a live code, which means a human at a
 * terminal. But an invalid api_id/api_hash fails long before that, and finding
 * out *after* typing a login code is a waste of a code. So this does the part
 * that needs no human: open a connection and make one unauthenticated call.
 *
 * Telegram validates api_id on that call, so API_ID_INVALID surfaces here
 * rather than halfway through an interactive login.
 *
 * Also reports whether a cached session already exists, so you know whether
 * `bun run tg:spike` will prompt you or just go.
 */

import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { existsSync, readFileSync } from "node:fs";

const SESSION_FILE = ".tg/session.txt";

const apiId = Number(process.env["TELEGRAM_API_ID"] ?? "");
const apiHash = process.env["TELEGRAM_API_HASH"] ?? "";

if (!Number.isInteger(apiId) || apiId <= 0 || apiHash === "") {
  console.error("✗ TELEGRAM_API_ID / TELEGRAM_API_HASH missing from .env.local");
  process.exit(1);
}
if (apiHash.length !== 32 || !/^[0-9a-f]+$/i.test(apiHash)) {
  console.error(`✗ TELEGRAM_API_HASH looks wrong: expected 32 hex chars, got ${apiHash.length}`);
  process.exit(1);
}
console.log(`✓ credentials well-formed (api_id ${apiId}, hash ${apiHash.length} hex chars)`);

const cached = existsSync(SESSION_FILE) ? readFileSync(SESSION_FILE, "utf8").trim() : "";
const session = new StringSession(cached);

const client = new TelegramClient(session, apiId, apiHash, {
  connectionRetries: 2,
  floodSleepThreshold: 120,
  baseLogger: undefined,
});

try {
  await client.connect();

  // Unauthenticated, but api_id is still validated server-side.
  const cfg = await client.invoke(new Api.help.GetNearestDc());
  console.log(`✓ Telegram accepted the credentials (nearest DC ${cfg.nearestDc}, country ${cfg.country})`);

  if (cached === "") {
    console.log("\n→ No cached session. `bun run tg:spike` will ask for your phone number and a login code.");
  } else {
    const authed = await client.isUserAuthorized();
    console.log(
      authed
        ? "\n→ Cached session is live. `bun run tg:spike` will run without prompting."
        : "\n→ Cached session exists but is not authorised (expired or revoked). You'll be asked to log in again.",
    );
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n✗ ${msg}`);
  if (msg.includes("API_ID_INVALID") || msg.includes("API_ID_PUBLISHED")) {
    console.error(
      "\n  That means the api_id/api_hash pair is wrong or mismatched.\n" +
        "  Re-copy BOTH from my.telegram.org → API development tools → App configuration.\n" +
        "  They must come from the same app — mixing an id from one and a hash from another fails exactly like this.",
    );
  }
  await client.disconnect();
  process.exit(1);
}

await client.disconnect();
process.exit(0);
