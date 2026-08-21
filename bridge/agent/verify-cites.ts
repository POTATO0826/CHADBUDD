/**
 * Independent audit of what the agent stored.
 *
 *   bun run agent:verify
 *
 * The gate already runs inside the analysis pass, so in principle nothing
 * unsourced can reach the `ideas` table. This checks that claim from outside,
 * against what is actually in the database, because "the gate says it gated"
 * is not evidence — it is the same code asserting its own correctness.
 *
 * Deliberately mirrors scripts/verify-ui.ts, which does exactly this for the
 * hand-authored copy: resolve every citation, fail loudly if one dangles.
 */

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";

import { MISSING_CONVEX, convexUrl as resolveConvexUrl } from "../../scripts/convex-url.ts";

/* Resolved the same way the page resolves it, so a backend the dashboard can
   reach is a backend this can reach. It covers both deployments: self-hosted on
   loopback, and Convex Cloud, where `convex dev` writes only CONVEX_DEPLOYMENT
   and the hostname is derived from it. */
const convexUrl = resolveConvexUrl();
if (convexUrl === "") {
  console.error(MISSING_CONVEX);
  process.exit(1);
}

const lookup = anyApi as unknown as Record<string, Record<string, unknown>>;
const listThreads = lookup["threads"]?.["list"] as FunctionReference<"query">;
const listIdeas = lookup["threads"]?.["ideas"] as FunctionReference<"query">;
const rejections = lookup["threads"]?.["rejections"] as FunctionReference<"query">;

const convex = new ConvexHttpClient(convexUrl);

interface Msg { externalId: string; text: string }
interface Thread { key: string; clientName: string; messages: Msg[] }
interface Idea { rank: string; title: string; intent: string; cites: string[]; model: string }

const threads = (await convex.query(listThreads, {})) as Thread[];
const byClient = (await convex.query(listIdeas, {})) as Array<{ key: string; ideas: Idea[] }>;
const rejected = (await convex.query(rejections, {})) as { total: number; byReason: Record<string, number> };

const messages = new Map<string, string>();
for (const t of threads) for (const m of t.messages) messages.set(m.externalId, m.text);

console.log(`${messages.size} messages across ${threads.length} threads\n`);

let ideas = 0;
let cites = 0;
let dangling = 0;
let uncited = 0;

for (const { key, ideas: list } of byClient) {
  const name = threads.find((t) => t.key === key)?.clientName ?? key;
  if (list.length === 0) continue;
  console.log(`${key} · ${name}`);

  for (const idea of list) {
    ideas++;
    // An idea with no citation should be impossible — the pass drops those as
    // "no-surviving-cites" — so finding one means the gate was bypassed.
    if (idea.cites.length === 0) {
      uncited++;
      console.log(`   ✗ [${idea.intent}] ${idea.title}  — NO CITATIONS`);
      continue;
    }

    const bad = idea.cites.filter((c) => !messages.has(c));
    dangling += bad.length;
    cites += idea.cites.length;

    console.log(
      `   ${bad.length === 0 ? "✓" : "✗"} [${idea.intent}] ${idea.title.slice(0, 58)}`,
    );
    console.log(`       cites ${idea.cites.join(", ")}${bad.length ? `  DANGLING: ${bad.join(", ")}` : ""}`);
  }
  console.log("");
}

console.log("─".repeat(70));
console.log(`${ideas} ideas · ${cites} citations · ${dangling} dangling · ${uncited} uncited`);
console.log(`${rejected.total} claims rejected by the gate${rejected.total > 0 ? `: ${JSON.stringify(rejected.byReason)}` : ""}`);

if (dangling > 0 || uncited > 0) {
  console.error("\nFAIL — a stored recommendation does not resolve to a real message.");
  process.exit(1);
}
console.log("\nPASS — every stored recommendation resolves to a real message.");
console.log("Note: this proves the citations exist, not that they support the claims.");
