/**
 * Can the agent provider actually do what the verbatim gate needs?
 *
 * The plan calls for Hermes 4, but every candidate — Hermes via Nous Portal,
 * OpenRouter, a local vLLM, or OpenAI — speaks the same OpenAI-compatible
 * chat-completions dialect. So provider choice is configuration, and this
 * check is written against the config rather than against one vendor.
 *
 * "Reachable" is the easy half and not the interesting one. The agent has to
 * return claims as structured JSON carrying {sourceId, quote} per claim, or
 * convex/verbatim.ts has nothing to gate. A provider that answers in prose is
 * useless here no matter how good the prose is. So this asks for a schema and
 * checks the shape that comes back.
 *
 *   AGENT_BASE_URL  default https://api.openai.com/v1
 *   AGENT_API_KEY   falls back to OPENAI_API_KEY
 *   AGENT_MODEL     required — no default, because guessing a model name
 *                   produces a 404 that reads like a broken key
 */

import { gate } from "../../convex/verbatim.ts";

const baseUrl = (process.env["AGENT_BASE_URL"] ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const apiKey = process.env["AGENT_API_KEY"] ?? process.env["OPENAI_API_KEY"] ?? "";
const model = process.env["AGENT_MODEL"] ?? "";

if (apiKey === "") {
  console.error("✗ No AGENT_API_KEY or OPENAI_API_KEY in .env.local");
  process.exit(1);
}
console.log(`base   ${baseUrl}`);
console.log(`key    ${apiKey.slice(0, 7)}… (${apiKey.length} chars)`);

/* ── 1. reachable, and what can it run? ──────────────────────────── */

const listRes = await fetch(`${baseUrl}/models`, {
  headers: { Authorization: `Bearer ${apiKey}` },
});

if (!listRes.ok) {
  const body = await listRes.text();
  console.error(`\n✗ ${listRes.status} ${listRes.statusText}\n${body.slice(0, 400)}`);
  if (listRes.status === 401) console.error("\n  401 means the key is rejected — wrong, revoked, or from another account.");
  process.exit(1);
}

const listed = (await listRes.json()) as { data?: Array<{ id: string }> };
const ids = (listed.data ?? []).map((m) => m.id).sort();
console.log(`\n✓ reachable — ${ids.length} models available`);

// Chat-capable models, newest-looking first. Filtered because the raw list is
// mostly embeddings, audio and image endpoints that cannot serve this agent.
const chat = ids.filter((id) => /^(gpt|o[0-9]|chatgpt|hermes|llama|claude)/i.test(id) && !/embed|audio|tts|whisper|image|dall|moderation|realtime|transcribe/i.test(id));
console.log(`  chat-capable: ${chat.slice(0, 14).join(", ")}${chat.length > 14 ? ` … +${chat.length - 14}` : ""}`);

if (model === "") {
  console.log("\n→ Set AGENT_MODEL in .env.local to one of the above, then re-run to test structured output.");
  process.exit(0);
}
if (!ids.includes(model)) {
  console.error(`\n✗ AGENT_MODEL="${model}" is not in this provider's list.`);
  process.exit(1);
}

/* ── 2. the part that actually matters: schema-constrained claims ── */

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["claims"],
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "sourceId", "quote"],
        properties: {
          statement: { type: "string" },
          sourceId: { type: "string" },
          quote: { type: "string" },
        },
      },
    },
  },
} as const;

// Two real messages and one deliberate trap: nothing in the thread mentions a
// timeline. A model that invents one here would invent one on live data, and
// the gate is what catches it — but it is worth knowing the rate up front.
const thread = [
  "[X-001] client: Sorry been quiet, quarter end has been brutal.",
  "[X-002] advisor: No problem at all. Shall we push our review to next month?",
  "[X-003] client: Park it for now, I'll come back to you.",
].join("\n");

const res = await fetch(`${baseUrl}/chat/completions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    messages: [
      {
        role: "system",
        content:
          "You extract claims from an advisor's chat thread. Every claim MUST cite one message id and " +
          "quote text copied EXACTLY from that message, character for character. Never paraphrase a quote. " +
          "If nothing supports a claim, return no claims.",
      },
      { role: "user", content: `${thread}\n\nWhat has the client asked for? Also: what is the client's stated timeline?` },
    ],
    response_format: { type: "json_schema", json_schema: { name: "claims", strict: true, schema } },
  }),
});

if (!res.ok) {
  const body = await res.text();
  console.error(`\n✗ completion failed: ${res.status}\n${body.slice(0, 500)}`);
  process.exit(1);
}

const out = (await res.json()) as {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};
const raw = out.choices?.[0]?.message?.content ?? "";

let parsed: { claims?: Array<{ statement: string; sourceId: string; quote: string }> };
try {
  parsed = JSON.parse(raw) as typeof parsed;
} catch {
  console.error(`\n✗ returned non-JSON despite a schema — unusable for the gate:\n${raw.slice(0, 300)}`);
  process.exit(1);
}

console.log(`\n✓ structured output honoured (${out.usage?.prompt_tokens ?? "?"} in / ${out.usage?.completion_tokens ?? "?"} out tokens)\n`);

/* ── 3. run the claims through the real gate ─────────────────────── */

// The real gate, imported rather than reimplemented. An earlier version of
// this file kept its own copy that lowercased both sides — quietly more
// permissive than the gate it was standing in for, which would have made this
// probe report a cleaner result than production would produce.
const messages = new Map<string, string>([
  ["X-001", "Sorry been quiet, quarter end has been brutal."],
  ["X-002", "No problem at all. Shall we push our review to next month?"],
  ["X-003", "Park it for now, I'll come back to you."],
]);

const { kept, rejected } = gate(parsed.claims ?? [], messages);

for (const c of kept) {
  console.log(`  PASS  [${c.sourceId}] "${c.quote.slice(0, 60)}"`);
  console.log(`        ${c.statement.slice(0, 90)}`);
}
for (const r of rejected) {
  console.log(`  FAIL  [${r.sourceId}] "${r.quote.slice(0, 60)}"  (${r.reason})`);
  console.log(`        ${r.statement.slice(0, 90)}`);
}

console.log(`\n${kept.length} passed the verbatim gate, ${rejected.length} rejected.`);
console.log(
  rejected.length === 0
    ? "This provider can drive the agent. The gate stays in regardless — one clean run is not a guarantee,\n" +
        "and a passing quote still does not mean the claim built on it is supported."
    : "Rejections here are the gate doing its job, not a failure. Watch the rate on real threads.",
);
