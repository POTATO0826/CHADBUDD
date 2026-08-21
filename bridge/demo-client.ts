/**
 * A mock client that decays while you watch.
 *
 *   bun run demo:decay          last word 25 minutes ago — turns "going quiet" in 5
 *   bun run demo:decay 45       already decaying when the app opens
 *   bun run demo:decay 1500     silent (over a day)
 *   bun run demo:decay 2        healthy, for the before shot
 *
 * The real decay model compares a 30-day window against a 90-day baseline, so
 * nothing it measures can move during a demo. Live mode adds a quiet-time rule
 * on top — 30 minutes is "going quiet", a day is "silent" — and this writes a
 * thread positioned against that rule instead of against a fixed date.
 *
 * Its timestamps are relative to when you run it, which is the whole point and
 * also why it is a separate script from seed-load: the four hand-written
 * threads are fixed in time on purpose, and a demo prop that moves must not be
 * mistaken for them.
 *
 * Written through the seed path, so it carries `seed:` as its source id and the
 * outbox refuses to send to it. A fictional client has no chat to deliver to.
 */

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";

const convexUrl = process.env["CONVEX_SELF_HOSTED_URL"] ?? process.env["CONVEX_URL"] ?? "";
if (convexUrl === "") {
  console.error("Missing CONVEX_SELF_HOSTED_URL — is `docker compose up -d` running?");
  process.exit(1);
}

const lookup = anyApi as unknown as Record<string, Record<string, unknown>>;
const importThread = lookup["seed"]?.["importThread"] as FunctionReference<"mutation">;
const convex = new ConvexHttpClient(convexUrl);

/** Minutes since the client's last message. Everything else hangs off this. */
const quietMinutes = Number(process.argv[2] ?? 25);
if (!Number.isFinite(quietMinutes) || quietMinutes < 0) {
  console.error(`Expected a number of minutes, got "${process.argv[2]}"`);
  process.exit(1);
}

const KEY = "M";
const MIN = 60_000;
const now = Date.now();

/** ISO with the +08:00 offset the rest of the data uses. */
const at = (minutesAgo: number): string => new Date(now - minutesAgo * MIN).toISOString();

/**
 * A thread that reads like a relationship cooling rather than a wall of filler.
 *
 * The advisor asks twice at the end and gets nothing back, which is the shape
 * the four signals are looking for — so the breakdown underneath the status
 * agrees with the quiet-time rule instead of contradicting it.
 */
const script: Array<{ from: "advisor" | "client"; text: string; minutesAgo: number }> = [
  { from: "client", text: "Morning! Just transferred the top-up for this month.", minutesAgo: quietMinutes + 2880 },
  { from: "advisor", text: "Received, thank you. I'll allocate it the same way as last quarter unless you'd like a change.", minutesAgo: quietMinutes + 2875 },
  { from: "client", text: "Same is fine. Actually — is it worth putting a bit more into the education fund? Aqil starts secondary in two years.", minutesAgo: quietMinutes + 2860 },
  { from: "advisor", text: "It could be. Let me pull the numbers on what two more years of contributions would look like and send them over.", minutesAgo: quietMinutes + 2850 },
  { from: "client", text: "Great, thanks.", minutesAgo: quietMinutes + 2840 },
  { from: "advisor", text: "Sorry for the delay on those education fund numbers — I'll have them to you this week.", minutesAgo: quietMinutes + 1440 },
  { from: "advisor", text: "Hi Aisyah, did you get a chance to look at the projection I sent?", minutesAgo: quietMinutes + 180 },
  { from: "client", text: "Not yet, sorry — been swamped. Will look tonight.", minutesAgo: quietMinutes },
];

const messages = script
  .slice()
  .sort((a, b) => b.minutesAgo - a.minutesAgo)
  .map((m, i) => ({
    externalId: `${KEY}-${String(i + 1).padStart(3, "0")}`,
    from: m.from,
    at: at(m.minutesAgo),
    text: m.text,
  }));

const res = (await convex.mutation(importThread, {
  key: KEY,
  clientName: "Aisyah Kamal",
  handle: "+60 12-••• 4471",
  messages,
})) as { inserted: number; skipped: number };

const state =
  quietMinutes >= 24 * 60 ? "silent" : quietMinutes >= 30 ? "going quiet" : "healthy for now";
const until = quietMinutes < 30 ? `, turns "going quiet" in ${30 - quietMinutes} min` : "";

console.log(`[demo] ${KEY} · Aisyah Kamal — ${messages.length} messages, ${res.inserted} new`);
console.log(`[demo] last word from her ${quietMinutes} min ago → ${state}${until}`);
console.log(`\nRe-run with a different number to move her. Remove with:`);
console.log(`  bunx convex run seed:clearSeed   (clears every mock client)`);
