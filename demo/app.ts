/**
 * The demo page's whole brain.
 *
 * Three live subscriptions, and the point of the exercise is that they are
 * *subscriptions* — nothing here polls, and nothing re-fetches. Send yourself a
 * Telegram message while the bridge is running and the relevant panel updates
 * on its own.
 *
 * This is the reference implementation for wiring the real dashboard. The three
 * changes named in bridge/README.md are all visible here:
 *
 *   · `ConvexClient.onUpdate` replaces the static import of seed threads
 *   · thread.key is a `string`, not the "A"|"B"|"C"|"D" union
 *   · timestamps are real, so nothing reads data/clock.ts's frozen NOW
 *
 * Rendering is a full innerHTML swap per update, matching src/main.ts:1118 —
 * at this size it beats any diffing and keeps each screen readable in one place.
 */

import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";

declare const __CONVEX_URL__: string;

/* ── the contract, named once ────────────────────────────────────── */

const lookup = anyApi as unknown as Record<string, Record<string, unknown>>;
const q = (m: string, n: string): FunctionReference<"query"> =>
  lookup[m]?.[n] as FunctionReference<"query">;

const API = {
  threads: q("threads", "list"),
  ideas: q("threads", "ideas"),
  rejections: q("threads", "rejections"),
  pairing: q("chats", "pairing"),
  chats: q("chats", "recent"),
};

/* ── shapes, mirroring data/types.ts ─────────────────────────────── */

interface Msg { externalId: string; from: "advisor" | "client"; at: string; text: string }
/** `key` is a string here — the live widening data/types.ts:22 still needs. */
interface Thread { key: string; clientName: string; handle: string; messages: Msg[] }
interface Idea {
  rank: string; title: string; why: string; draftLabel: string; draft: string;
  btn: string; meta: string; intent: string; cites: string[]; model: string; generatedTs: number;
}
interface ChatRow {
  name: string; handle: string; isBot: boolean; isGroup: boolean;
  msgCount: number; spanDays: number; tracked: boolean; scorable: boolean; reason: string | null;
}

const state: {
  threads: Thread[]; ideas: Array<{ key: string; ideas: Idea[] }>;
  rejections: { total: number; byReason: Record<string, number> };
  pairing: { state: string; detail?: string }; chats: ChatRow[];
} = {
  threads: [], ideas: [], rejections: { total: 0, byReason: {} },
  pairing: { state: "…" }, chats: [],
};

/* ── helpers ─────────────────────────────────────────────────────── */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const e = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ESC[c]!);

/** Every message by citation key, so a cite can be resolved to real text. */
function messageIndex(): Map<string, { text: string; client: string }> {
  const out = new Map<string, { text: string; client: string }>();
  for (const t of state.threads) {
    for (const m of t.messages) out.set(m.externalId, { text: m.text, client: t.clientName });
  }
  return out;
}

const when = (iso: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    hour12: false, timeZone: "Asia/Kuala_Lumpur",
  }).format(Date.parse(iso));

/* ── render ──────────────────────────────────────────────────────── */

function ideaCard(idea: Idea, index: Map<string, { text: string; client: string }>): string {
  // The citation is the product. Rendering the quoted text underneath each
  // recommendation is what makes it checkable rather than merely plausible —
  // a claim you cannot trace is a claim that can be wrong quietly.
  const cites = idea.cites
    .map((id) => {
      const src = index.get(id);
      return src
        ? `<div class="cite"><span class="cid">${e(id)}</span><span class="ctext">${e(src.text)}</span></div>`
        : `<div class="cite bad"><span class="cid">${e(id)}</span><span class="ctext">— does not resolve</span></div>`;
    })
    .join("");

  return `
    <article class="idea" data-intent="${e(idea.intent)}">
      <header>
        <span class="rank">${e(idea.rank)}</span>
        <h4>${e(idea.title)}</h4>
        <span class="intent">${e(idea.intent)}</span>
      </header>
      <p class="why">${e(idea.why)}</p>
      <div class="draft">
        <span class="dlabel">${e(idea.draftLabel)}</span>
        <p>${e(idea.draft)}</p>
      </div>
      <div class="cites">${cites}</div>
    </article>`;
}

function render(): void {
  const index = messageIndex();
  const ideasFor = new Map(state.ideas.map((r) => [r.key, r.ideas]));
  const totalIdeas = state.ideas.reduce((n, r) => n + r.ideas.length, 0);
  const totalMsgs = state.threads.reduce((n, t) => n + t.messages.length, 0);
  const model = state.ideas.flatMap((r) => r.ideas).find((i) => i.model)?.model ?? "—";

  const clients = state.threads
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((t) => {
      const list = ideasFor.get(t.key) ?? [];
      const last = t.messages.at(-1);
      return `
        <section class="client">
          <header class="chead">
            <span class="ckey">${e(t.key)}</span>
            <h3>${e(t.clientName)}</h3>
            <span class="handle">${e(t.handle)}</span>
            <span class="count">${t.messages.length} msgs${last ? ` · last ${e(when(last.at))}` : ""}</span>
          </header>
          ${
            list.length === 0
              ? `<div class="hatch">no recommendation — the agent has not run for this client, or nothing here survived the gate</div>`
              : list.map((i) => ideaCard(i, index)).join("")
          }
        </section>`;
    })
    .join("");

  const pickable = state.chats.filter((c) => !c.isBot && !c.isGroup).slice(0, 8);

  document.getElementById("app")!.innerHTML = `
    <header class="top">
      <div class="brand"><span class="dot"></span> ChadBuddy <span class="sub">backend</span></div>
      <div class="stats">
        <span><b>${state.threads.length}</b> clients</span>
        <span><b>${totalMsgs}</b> messages</span>
        <span><b>${totalIdeas}</b> recommendations</span>
        <span><b>${state.rejections.total}</b> rejected by the gate</span>
        <span class="model">${e(model)}</span>
        <span class="pair" data-state="${e(state.pairing.state)}">telegram: ${e(state.pairing.state)}</span>
      </div>
    </header>

    <main>${clients || `<div class="hatch">no clients yet — run <code>bun run seed:load</code></div>`}</main>

    <aside>
      <h5>Chats the picker offers</h5>
      <p class="note">Annotated, never filtered — the advisor sees what was excluded and why.</p>
      ${
        pickable
          .map(
            (c) => `
        <div class="chat ${c.scorable ? "ok" : "no"}">
          <span class="cname">${e(c.name || "(unnamed)")}</span>
          <span class="cmeta">${c.msgCount} msgs · ${c.spanDays}d</span>
          <span class="creason">${e(c.reason ?? "scorable")}</span>
        </div>`,
          )
          .join("") || `<div class="hatch">no chats — run <code>bun run bridge</code></div>`
      }
      <h5 class="mt">The gate</h5>
      <p class="note">
        Every quote above is checked character-for-character against real message text before
        it is stored. What the gate cannot check is whether a real quote actually
        <em>supports</em> the claim built on it.
      </p>
      ${
        state.rejections.total > 0
          ? `<div class="rej">${Object.entries(state.rejections.byReason)
              .map(([k, v]) => `<div><b>${v}</b> ${e(k)}</div>`)
              .join("")}</div>`
          : `<div class="note">Nothing rejected in the last run.</div>`
      }
    </aside>`;
}

/* ── subscribe ───────────────────────────────────────────────────── */

const client = new ConvexClient(__CONVEX_URL__);

client.onUpdate(API.threads, {}, (v) => { state.threads = v as Thread[]; render(); });
client.onUpdate(API.ideas, {}, (v) => { state.ideas = v as typeof state.ideas; render(); });
client.onUpdate(API.rejections, {}, (v) => { state.rejections = v as typeof state.rejections; render(); });
client.onUpdate(API.pairing, {}, (v) => { state.pairing = v as typeof state.pairing; render(); });
client.onUpdate(API.chats, { limit: 40 }, (v) => { state.chats = v as ChatRow[]; render(); });

render();
