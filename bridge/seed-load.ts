/**
 * Push the hand-written seed threads into Convex.
 *
 *   bun run seed:load
 *
 * Two reasons this exists.
 *
 * The demo one: profiling the live Telegram account found 0 of 50 chats
 * scorable — every DM is a bot, too short, or dormant. The dashboard measures
 * decay against a 90-day baseline, so it has nothing real to score. The seed
 * threads are what the dashboard was built against and remain the honest way
 * to show it working.
 *
 * The testing one, which matters more: these 222 messages are a corpus whose
 * correct answers are already known. src/copy.ts cites specific ids by hand and
 * scripts/verify-ui.ts fails the build if any of them stops resolving. That
 * makes them a far better test of the agent than live data — when the model
 * quotes something, it can be checked against text a human actually wrote.
 *
 * Reads data/ and writes nothing there; that directory belongs to the frontend.
 */

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";

import { threads } from "../data/threads/index.ts";

const convexUrl = process.env["CONVEX_SELF_HOSTED_URL"] ?? process.env["CONVEX_URL"] ?? "";
if (convexUrl === "") {
  console.error("Missing CONVEX_SELF_HOSTED_URL in .env.local — is `docker compose up -d` running?");
  process.exit(1);
}

const lookup = anyApi as unknown as Record<string, Record<string, unknown>>;
const importThread = lookup["seed"]?.["importThread"] as FunctionReference<"mutation">;

const convex = new ConvexHttpClient(convexUrl);

/** Same ceiling as the live path — mutations get one second of user code. */
const BATCH = 200;

/**
 * Optional key filter: `bun run seed:load B` loads only Faizal.
 *
 * Four fictional clients beside one real one reads as a dashboard of made-up
 * people with a stranger in it. One is enough to show the shape.
 */
const only = new Set(process.argv.slice(2).map((a) => a.toUpperCase()));
const wanted = only.size === 0 ? threads : threads.filter((t) => only.has(t.key));

if (wanted.length === 0) {
  console.error(`No seed thread matches ${[...only].join(", ")}. Available: ${threads.map((t) => t.key).join(", ")}`);
  process.exit(1);
}

let total = 0;

for (const t of wanted) {
  let inserted = 0;

  for (let i = 0; i < t.messages.length; i += BATCH) {
    const res = (await convex.mutation(importThread, {
      key: t.key,
      clientName: t.clientName,
      handle: t.handle,
      messages: t.messages.slice(i, i + BATCH),
    })) as { inserted: number };
    inserted += res.inserted;
  }

  total += inserted;
  console.log(
    `[seed] ${t.key} · ${t.clientName.padEnd(18)} ${String(t.messages.length).padStart(3)} messages, ${inserted} new`,
  );
}

console.log(`\n${total} messages loaded across ${wanted.length} thread(s).`);
console.log("Citation ids are preserved, so copy.ts references still resolve.");
