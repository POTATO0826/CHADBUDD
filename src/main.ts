/**
 * ChadBuddy — the dynamic island and the dashboard it opens into.
 *
 * One element changes size through three states (idle → peek → open); the
 * content layers cross-fade. Everything rendered here is derived from the seed
 * threads: the numbers come from src/signals.ts (measured), the severities from
 * src/score.ts (provisional, replaced in Stage 2), and every ledger item has
 * already passed the verbatim check in src/ledger.ts before it gets this far.
 */

import { NOW } from "../data/clock.ts";
import type { ClientKey, SeedMessage } from "../data/types.ts";
import { threads } from "../data/threads/index.ts";
import { ledgerFor, openDays, openEntries } from "./ledger.ts";
import type { LedgerEntry } from "./ledger.ts";
import type { Score } from "./score.ts";
import { score, severityBand } from "./score.ts";
import { isTauri, quit, reportHotRect, watchHotRect } from "./shell.ts";
import { windows } from "./signals.ts";

/* ── view model ──────────────────────────────────────────────────── */

interface ClientView {
  key: ClientKey;
  name: string;
  handle: string;
  score: Score;
  open: LedgerEntry[];
  discarded: number;
  lastContact: number;
}

const clients: ClientView[] = threads
  .map((t) => {
    const last = t.messages[t.messages.length - 1]!;
    return {
      key: t.key,
      name: t.clientName,
      handle: t.handle,
      score: score(windows(t)),
      open: openEntries(t.key),
      discarded: ledgerFor(t.key).rejected.length,
      lastContact: Date.parse(last.at),
    };
  })
  // Silent churn first — it is the case a human would never surface on their
  // own — then by how far the composite has moved.
  .sort((a, b) => Number(b.score.silent) - Number(a.score.silent) || b.score.composite - a.score.composite);

const needsAttention = clients.filter((c) => c.score.status !== "healthy");
const top = clients[0]!;

/* ── formatting ──────────────────────────────────────────────────── */

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kuala_Lumpur",
});
const stampFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kuala_Lumpur",
});

const daysAgo = (ms: number) => Math.round((NOW - ms) / 86_400_000);

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function signed(n: number | null): string {
  if (n === null) return "—";
  return `${n > 0 ? "+" : ""}${n}%`;
}

/* ── dom ─────────────────────────────────────────────────────────── */

function need<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

const island = need("island");
const pill = need("pill");
const peek = need("peek");
const list = need("list");
const threadPane = need("thread");

/* ── island states ───────────────────────────────────────────────── */

type State = "idle" | "peek" | "open";

function setState(s: State): void {
  island.dataset.state = s;
  if (s !== "open") closeThread();
  // The shell needs the new live region before the morph finishes, so that
  // collapsing hands the desktop back immediately.
  reportHotRect(island);
}

island.addEventListener("pointerenter", () => {
  if (island.dataset.state === "idle") setState("peek");
});
island.addEventListener("pointerleave", () => {
  if (island.dataset.state === "peek") setState("idle");
});
pill.addEventListener("click", () => setState("open"));
peek.addEventListener("click", () => setState("open"));
need("close").addEventListener("click", () => setState("idle"));

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (island.dataset.thread !== undefined) closeThread();
  else setState("idle");
});
document.addEventListener("pointerdown", (e) => {
  if (island.dataset.state !== "open") return;
  if (!island.contains(e.target as Node)) setState("idle");
});

/* ── idle + peek content ─────────────────────────────────────────── */

need("pill-count").textContent =
  needsAttention.length === 0
    ? "All four steady"
    : `${needsAttention.length} need${needsAttention.length === 1 ? "s" : ""} you`;
need("pill-who").textContent = top.name.split(" ")[0] ?? "";

need("peek-name").textContent = top.name;
need("peek-reason").textContent = top.score.headline;
need("peek-score").textContent = String(top.score.composite);

need("dash-sub").textContent = `as of ${dateFmt.format(NOW)} 2026 · last 30 days vs own 90-day baseline`;

/* In the shell there is no titlebar and no taskbar entry, so the dashboard has
   to offer the way out itself. In a browser the tab close button is the way out,
   so the button isn't rendered at all. */
if (isTauri) {
  const q = document.createElement("button");
  q.className = "trace";
  q.type = "button";
  q.textContent = "quit";
  q.addEventListener("click", quit);
  need("close").before(q);
}

const totalMessages = threads.reduce((n, t) => n + t.messages.length, 0);
const totalDiscarded = clients.reduce((n, c) => n + c.discarded, 0);
need("foot-note").textContent =
  `${clients.length} clients · ${totalMessages} messages · ledger verbatim-checked, ${totalDiscarded} discarded` +
  ` · scores provisional until the stage 2 engine lands`;

/* ── client list ─────────────────────────────────────────────────── */

function signalRow(s: Score["signals"][number]): string {
  const band = severityBand(s.severity);
  const width = Math.round(s.severity * 100);
  const cite = s.evidence.length
    ? `<button class="trace" type="button" data-cite="${s.evidence.join(",")}">
         ${s.evidence.length} message${s.evidence.length === 1 ? "" : "s"} →
       </button>`
    : "";

  return `
    <div class="sig" data-sev="${band}">
      <div class="sig-head">
        <span class="nm">${esc(s.label)}</span>
        <span class="vs"><b>${esc(s.recent)}</b> &nbsp;vs&nbsp; ${esc(s.baseline)} &nbsp;·&nbsp; ${signed(s.changePct)}</span>
      </div>
      <div class="meter" role="img"
           aria-label="${esc(s.label)}: ${esc(s.recent)} in the last 30 days against a baseline of ${esc(s.baseline)}">
        <i style="width:${width}%"></i>
      </div>
      <div class="sig-foot">
        <span class="id">${esc(s.note)}</span>
        ${cite}
      </div>
    </div>`;
}

function ledgerRow(e: LedgerEntry): string {
  const open = e.settledAt === undefined;
  const age = openDays(e);
  const meta = open
    ? `owed by ${e.owedBy} · open ${age} day${age === 1 ? "" : "s"} · since ${dateFmt.format(e.openedAt)}`
    : `owed by ${e.owedBy} · settled after ${age} day${age === 1 ? "" : "s"} by ${e.settledByMessageId}`;

  return `
    <div class="item" data-open="${open}">
      <span class="kind">${e.kind}</span>
      <span class="txt">${esc(e.text)}</span>
      <span class="meta">${esc(meta)}</span>
      <blockquote>“${esc(e.quote)}”</blockquote>
      <span class="cite">
        <button class="trace" type="button" data-cite="${e.sourceMessageId}">
          ${e.sourceMessageId} →
        </button>
      </span>
    </div>`;
}

function clientCard(c: ClientView): string {
  const s = c.score;
  const owed = c.open.length;
  const context = ledgerFor(c.key).entries.filter((e) => e.kind === "disclosure");

  return `
    <section class="client" data-client="${c.key}" aria-expanded="false">
      <button class="chead" type="button" data-toggle="${c.key}">
        <svg class="chev" viewBox="0 0 9 9" aria-hidden="true">
          <path d="M2.5 1L6.5 4.5L2.5 8" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>
        </svg>
        <span class="cname">
          <span class="n">${esc(c.name)}</span>
          <span class="id">${esc(c.handle)}</span>
          <span class="sub">${esc(s.headline)}</span>
        </span>
        <span class="chip" data-status="${s.status}">
          <span class="sw" aria-hidden="true"></span>${s.status}
        </span>
        <span class="score">
          <span class="v num">${s.composite}</span>
        </span>
      </button>

      <div class="cbody">
        ${s.signals.map(signalRow).join("")}

        <div class="ledger">
          <span class="lbl">open items · ${owed}</span>
          ${owed ? c.open.map(ledgerRow).join("") : `<p class="empty">Nothing owed in either direction. Everything promised in this thread was delivered.</p>`}
        </div>

        ${
          context.length
            ? `<div class="ledger">
                 <span class="lbl">what they've told you</span>
                 ${context.map(ledgerRow).join("")}
               </div>`
            : ""
        }

        <div class="ledger">
          <span class="lbl">last message · ${daysAgo(c.lastContact)} days ago</span>
          <p class="empty">
            <button class="trace" type="button" data-open-thread="${c.key}">open the whole conversation →</button>
          </p>
        </div>
      </div>
    </section>`;
}

list.innerHTML = clients.map(clientCard).join("");

/* ── expand / collapse ───────────────────────────────────────────── */

list.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;

  const toggle = target.closest<HTMLElement>("[data-toggle]");
  if (toggle) {
    const card = toggle.closest<HTMLElement>(".client")!;
    const nowOpen = card.getAttribute("aria-expanded") !== "true";
    card.setAttribute("aria-expanded", String(nowOpen));
    return;
  }

  const openWhole = target.closest<HTMLElement>("[data-open-thread]");
  if (openWhole) {
    showThread(openWhole.dataset.openThread as ClientKey, []);
    return;
  }

  const cite = target.closest<HTMLElement>("[data-cite]");
  if (cite) {
    const ids = (cite.dataset.cite ?? "").split(",").filter(Boolean);
    const card = cite.closest<HTMLElement>(".client")!;
    showThread(card.dataset.client as ClientKey, ids);
  }
});

/* ── conversation pane ───────────────────────────────────────────── */

function messageRow(m: SeedMessage, lit: boolean, dim: boolean): string {
  return `
    <div class="msg${lit ? " lit" : ""}${dim ? " dim" : ""}" data-from="${m.from}" data-mid="${m.externalId}">
      <div class="bub">${esc(m.text)}</div>
      <div class="stamp">
        <span class="id">${m.externalId}</span>
        <span class="id">${stampFmt.format(Date.parse(m.at))}</span>
      </div>
    </div>`;
}

function showThread(key: ClientKey, highlight: string[]): void {
  const t = threads.find((x) => x.key === key)!;
  const lit = new Set(highlight);
  const dimming = lit.size > 0;

  threadPane.innerHTML = `
    <div class="thead">
      <span class="n">${esc(t.clientName)}</span>
      <span class="id">${t.messages.length} messages</span>
      <span class="sp" style="margin-left:auto"></span>
      <button class="xbtn" type="button" data-close-thread aria-label="Close conversation">
        <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
          <path d="M1 1l7 7M8 1l-7 7" stroke="currentColor" stroke-width="1.4" fill="none"/>
        </svg>
      </button>
    </div>
    <div class="msgs">
      ${t.messages.map((m) => messageRow(m, lit.has(m.externalId), dimming && !lit.has(m.externalId))).join("")}
    </div>`;

  island.dataset.thread = key;

  // Scroll to the first cited message once the pane has been laid out.
  const anchorId = highlight[0] ?? t.messages[t.messages.length - 1]!.externalId;
  requestAnimationFrame(() => {
    const anchor = threadPane.querySelector<HTMLElement>(`[data-mid="${anchorId}"]`);
    if (!anchor) return;
    threadPane.scrollTop = anchor.offsetTop - threadPane.clientHeight / 2 + anchor.clientHeight / 2;
  });
}

function closeThread(): void {
  delete island.dataset.thread;
}

threadPane.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("[data-close-thread]")) closeThread();
});

watchHotRect(island);

/* Open the dashboard straight onto the silent-churn case in dev, so the demo
   lands on the interesting screen rather than an empty pill. */
if (new URLSearchParams(location.search).has("open")) {
  setState("open");
  const first = list.querySelector<HTMLElement>(`.client[data-client="${top.key}"]`);
  first?.setAttribute("aria-expanded", "true");
}
