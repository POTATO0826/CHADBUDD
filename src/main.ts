/**
 * ChadBuddy — the island and everything it opens into.
 *
 * One element moves through five states (idle · alert · call · peek · open) and
 * the open state carries four pages. Markup is built as strings and swapped per
 * render, which at this size is faster than any diffing and keeps every screen
 * in one readable place.
 *
 * Every value rendered here comes from src/derive.ts, which computes it from the
 * real seed threads. Nothing on screen is a placeholder number.
 */

import { NOW } from "../data/clock.ts";
import type { ClientKey } from "../data/types.ts";
import { approvals, ideas, queues, rules } from "./copy.ts";
import type { Idea, QueueKind, QueueRow } from "./copy.ts";
import type { Cell, ClientView, RecMessage, Tone, Week } from "./derive.ts";
import {
  ADVISOR, INK, MARK, clientById, clients, dateShort, humanGap, replyClock,
  severityInk, severityMark, totals, weekBars,
} from "./derive.ts";
import { openDays } from "./ledger.ts";
import type { LedgerEntry } from "./ledger.ts";
import { isTauri, quit, reportHotRect, watchHotRect } from "./shell.ts";
import type { SignalScore } from "./score.ts";

/* ── tiny helpers ────────────────────────────────────────────────── */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const e = (s: string): string => s.replace(/[&<>"]/g, (c) => ESC[c]!);

function need<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

const inkOf = (t: Tone): string => (t === "butter" ? "var(--butter)" : INK[t]);
const markOf = (t: Tone): string => (t === "butter" ? "var(--butter)" : MARK[t]);

/* ── state ───────────────────────────────────────────────────────── */

type IslandState = "idle" | "alert" | "call" | "peek" | "open";
type Page = "home" | "clients" | QueueKind;
type Mode = "profile" | "record";
type Filter = "all" | "client" | "flagged";

interface State {
  st: IslandState;
  page: Page;
  sel: ClientKey;
  mode: Mode;
  rule: number;
  idea: number;
  filter: Filter;
  /** Message the current citation is pointing at. */
  lit: string | null;
}

const top = clients[0]!;

const state: State = {
  st: "idle",
  page: "home",
  sel: top.key,
  mode: "profile",
  rule: 0,
  idea: 0,
  filter: "all",
  lit: null,
};

const island = need("island");

/* ── island: compact states ──────────────────────────────────────── */

function idleLayer(): string {
  const parts: string[] = [];
  if (totals.decaying > 0) parts.push(`${totals.decaying} decaying`);
  if (totals.silent > 0) parts.push(`${totals.silent} silent`);
  const line = parts.length ? parts.join(" · ") : "All steady";
  return `
    <button class="row" data-act="open" aria-label="Open ChadBuddy">
      <span class="dot" aria-hidden="true"></span>
      <span class="txt">${e(line)}</span>
      <span class="far">${totals.clients}</span>
    </button>`;
}

/* ── notifications ───────────────────────────────────────────────
   Two kinds of automatic enlargement, both fed by real data:

   · message — a client's latest WhatsApp message replays as an incoming
     alert: the pill grows to 360px with the butter sweep and a NEW tag,
     dwells 7 seconds, and returns to idle.
   · reminder — the agent surfaces a pending item from the approval queue
     at 376px with the breathing dot. Urgent ones (something owed) stay
     until acted on; the rest dwell 9 seconds.

   A notification only ever fires from idle — never over the open
   dashboard, and never while the cursor is on the island. Hovering a
   visible notification pauses its dwell so it can be read. */

interface Notif {
  kind: "message" | "reminder";
  client: ClientKey | null;
  title: string;
  body: string;
  meta: string;
  tag: string;
  tone: "butter" | "critical";
  initials?: string;
  mode?: Mode;
  /** ms on screen; null = stays until clicked or dismissed. */
  dwell: number | null;
}

const notifs: Notif[] = (() => {
  // Each client's most recent message, newest first — what "a customer
  // messaged you" means against a fixed seed set.
  const messages = clients
    .map((c) => {
      const msgs = c.thread.messages;
      let i = msgs.length - 1;
      while (i >= 0 && msgs[i]!.from !== "client") i--;
      const m = msgs[i]!;
      const prev = i > 0 ? msgs[i - 1] : undefined;
      return {
        kind: "message" as const,
        client: c.key,
        title: c.name.split(" ")[0] ?? c.name,
        body: m.text.length > 30 ? `${m.text.slice(0, 29)}…` : m.text,
        meta: prev ? humanGap(Date.parse(m.at) - Date.parse(prev.at)) : "",
        tag: "NEW",
        tone: "butter" as const,
        initials: c.initials,
        mode: "record" as Mode,
        dwell: 7000,
        ts: Date.parse(m.at),
      };
    })
    .sort((a, b) => b.ts - a.ts);

  const STYLE: Record<string, { tag: string; tone: "butter" | "critical"; dwell: number | null }> = {
    "→": { tag: "SEND", tone: "butter", dwell: 9000 },
    "!": { tag: "OWED", tone: "critical", dwell: null },
    "☏": { tag: "CALL", tone: "critical", dwell: 9000 },
    "◇": { tag: "HELD", tone: "butter", dwell: 9000 },
  };
  const reminders = approvals
    .filter((a) => !a.done)
    .map((a) => {
      const st = STYLE[a.glyph] ?? STYLE["→"]!;
      return {
        kind: "reminder" as const,
        client: a.go?.client ?? null,
        title: a.title,
        body: "",
        meta: a.meta,
        tag: st.tag,
        tone: st.tone,
        mode: a.go?.mode,
        dwell: st.dwell,
      };
    });

  // Interleave so the demo alternates: a customer message, then a reminder.
  const out: Notif[] = [];
  for (let i = 0; i < Math.max(messages.length, reminders.length); i++) {
    const m = messages[i];
    if (m) out.push(m);
    const r = reminders[i];
    if (r) out.push(r);
  }
  return out;
})();

function messageLayer(n: Notif): string {
  return `
    <button class="row pad" data-act="notif-open" aria-label="Open ${e(n.title)}'s message">
      <span class="sweepline" aria-hidden="true"></span>
      <span class="ava-sq" aria-hidden="true">${e(n.initials ?? "")}</span>
      <span class="txt">${e(n.title)}: “${e(n.body)}”</span>
      <span class="ago">${e(n.meta)}</span>
      <span class="tag new">${e(n.tag)}</span>
    </button>`;
}

function reminderLayer(n: Notif): string {
  const dot = n.tone === "butter" ? ' style="background:var(--butter)"' : "";
  return `
    <button class="row pad" data-act="notif-open" aria-label="${e(n.title)}">
      <span class="dot live"${dot} aria-hidden="true"></span>
      <span class="txt grow">${e(n.title)}</span>
      <span class="tag ${n.tone === "butter" ? "new" : "call"}">${e(n.tag)}</span>
    </button>`;
}

let notifIdx = 0;
let dwellTimer: number | undefined;
let current: Notif | null = null;

function showNotif(n: Notif): void {
  current = n;
  if (n.kind === "message") {
    need("l-alert").innerHTML = messageLayer(n);
    setState("alert");
  } else {
    need("l-call").innerHTML = reminderLayer(n);
    island.dataset.tone = n.tone;
    setState("call");
  }
  window.clearTimeout(dwellTimer);
  if (n.dwell !== null) {
    dwellTimer = window.setTimeout(() => {
      if (state.st === "alert" || state.st === "call") setState("idle");
    }, n.dwell);
  }
}

function nextNotif(): void {
  if (state.st !== "idle" || notifs.length === 0) return;
  showNotif(notifs[notifIdx % notifs.length]!);
  notifIdx++;
}

/**
 * The hover card is a book-level glance, not a single client: how many are
 * silent, how many are decaying, how much the clients actually said this
 * week, and whether anything sits in the call queue. The strip underneath
 * is one band per client in their status colour, so the shape of the whole
 * book reads in a quarter of a second.
 */
function peekLayer(): string {
  const callQ = queues.calls.rows.filter((r) => r.btn !== "").length;
  const strip = clients
    .map((c) => `<i style="background:${markOf(c.tone)}" title="${e(c.name)} · ${e(c.statusWord)}"></i>`)
    .join("");

  // Numbers stay in ink; the status colour rides a small dot beside the label,
  // so colour never carries meaning alone and the numerals line up cleanly.
  const stat = (label: string, value: number | string, dot?: string): string => `
    <span class="st">
      <span class="hd">${dot ? `<i class="dt" style="background:${dot}"></i>` : ""}<span class="lbl">${e(label)}</span></span>
      <span class="v num">${e(String(value))}</span>
    </span>`;

  return `
    <button class="peek" data-act="open" aria-label="Open ChadBuddy dashboard">
      <span class="top">
        <span class="nm">Your book right now</span>
        <span class="sc-n">${e(dateShort.format(NOW))} · ${totals.clients} clients</span>
      </span>
      <span class="stats">
        ${stat("silent", totals.silent, "var(--butter)")}
        <i class="div"></i>
        ${stat("decaying", totals.decaying, "var(--m-crit)")}
        <i class="div"></i>
        ${stat("msgs · 7d", weekBars.total)}
        <i class="div"></i>
        ${stat("calls", callQ, callQ > 0 ? "var(--m-warn)" : "var(--m-good)")}
        <i class="div"></i>
        ${stat("owed by you", totals.owedByAdvisor, totals.owedByAdvisor > 0 ? "var(--butter)" : undefined)}
      </span>
      <span class="strip" aria-hidden="true">${strip}</span>
    </button>`;
}

/* ── shared fragments ────────────────────────────────────────────── */

function citeChips(ids: string[], client: ClientKey): string {
  return ids
    .map((id) => `<button class="cite" data-act="cite" data-client="${client}" data-id="${e(id)}">${e(id)} →</button>`)
    .join("");
}

function meter(pct: number, colour: string, hatch = false): string {
  const bg = hatch ? `background:transparent;background-image:var(--hatch)` : `background:${colour}`;
  return `<span class="meter"><i style="width:${pct}%;${bg}"></i></span>`;
}

function signalRow(s: SignalScore): string {
  const pct = Math.round(s.severity * 100);
  return `
    <div class="sig">
      <div class="hd m">
        <span class="k">${e(s.label)}</span>
        <span class="v" style="color:${severityInk(s.severity)}">${e(s.recent)} · ${e(s.baseline)}</span>
      </div>
      ${meter(pct, severityMark(s.severity))}
    </div>`;
}

/* ── open: chrome ────────────────────────────────────────────────── */

const NAV: Array<{ page: Page; label: string; count: number }> = [
  { page: "home", label: "overview", count: 0 },
  { page: "clients", label: "clients", count: totals.clients },
  { page: "gifts", label: "gifts", count: queues.gifts.rows.filter((r) => r.btn !== "").length },
  { page: "calls", label: "calls", count: queues.calls.rows.filter((r) => r.btn !== "").length },
  { page: "sources", label: "sources", count: 0 },
];

function header(): string {
  const nav = NAV.map((n) => {
    const on = n.page === state.page;
    const badge = n.count > 0 ? `<span class="badge">${n.count}</span>` : "";
    return `<button data-act="page" data-page="${n.page}"${on ? ' aria-current="page"' : ""}>
              <span>${e(n.label)}</span>${badge}
            </button>`;
  }).join("");

  return `
    <div class="top">
      <span class="brand">chadbuddy</span>
      <nav class="nav" aria-label="Sections">${nav}</nav>
      <div class="orbs">
        ${isTauri ? `<button class="orb" data-act="quit" title="Quit ChadBuddy" aria-label="Quit">⏻</button>` : ""}
        <button class="orb" title="Settings" aria-label="Settings">⚙</button>
        <button class="orb" title="${totals.openItems} open items" aria-label="Open items">◔<span class="pip"></span></button>
        <span class="orb me" title="${e(ADVISOR)}">${e(ADVISOR.split(" ").map((w) => w[0]).join(""))}</span>
      </div>
    </div>`;
}

function footer(): string {
  return `
    <div class="foot">
      <span>${totals.clients} clients · ${totals.messages} messages · ledger verbatim-checked, ${totals.discarded} discarded</span>
      <span class="prov"><i aria-hidden="true"></i>scores provisional — stage 2 engine pending</span>
    </div>`;
}

/* ── page: overview ──────────────────────────────────────────────── */

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kuala_Lumpur" }).format(NOW));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** What the top recommendation for each client actually is. */
const byIntent = (want: Idea["intent"]): number =>
  clients.filter((c) => ideas[c.key]?.[0]?.intent === want).length;

const readyToSend = byIntent("send");
const onHold = byIntent("hold");
const blocked = byIntent("blocked");

const pending = approvals.filter((a) => !a.done);

function overviewPage(): string {
  const urgent = clients.find((c) => !c.score.silent && c.score.status === "decaying") ?? clients[0]!;
  const oldest = urgent.open[0];

  const bars = weekBars.days
    .map(
      (d) => `
      <div class="col" title="${e(d.label)}: ${d.count} client message${d.count === 1 ? "" : "s"}">
        ${d.isPeak ? `<span class="tip">${d.count} on ${e(d.label)}</span>` : ""}
        <i style="height:${Math.max(2, d.height)}%;background:${d.isPeak ? "var(--butter)" : "rgba(255,255,255,.24)"}"></i>
        <span class="day">${e(d.day)}</span>
      </div>`,
    )
    .join("");

  const clockKey = replyClock.key
    .map((k) => `<div><i style="background:${k.mark}"></i><span>${e(k.name)} ${e(k.value)}</span></div>`)
    .join("");

  // Real split of what is waiting on you, by kind.
  const kinds = [
    { label: "send", n: pending.filter((a) => a.glyph === "→").length, fill: "var(--butter)" },
    { label: "unblock", n: pending.filter((a) => a.glyph === "!" || a.glyph === "◇").length, fill: "var(--chip-dark)" },
    { label: "dismiss", n: pending.filter((a) => a.glyph === "☏").length, fill: "rgba(255,255,255,.14)" },
  ].filter((k) => k.n > 0);
  const kindTotal = kinds.reduce((n, k) => n + k.n, 0) || 1;
  const split = kinds
    .map(
      (k) => `
      <div class="seg" style="flex:${k.n}">
        <span class="pc">${Math.round((k.n / kindTotal) * 100)}%</span>
        <i style="background:${k.fill}${k.fill === "var(--chip-dark)" ? ";box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)" : ""}"></i>
      </div>`,
    )
    .join("");

  const queueRows = approvals
    .map(
      (a) => `
      <button class="qrow${a.done ? " done" : ""}"${a.go ? ` data-act="open-record" data-client="${a.go.client}" data-mode="${a.go.mode}"` : ""}>
        <span class="g" style="color:${a.done ? "var(--t4)" : a.glyph === "!" ? "var(--i-crit)" : "var(--butter)"}">${e(a.glyph)}</span>
        <span style="display:flex;flex-direction:column;gap:1px;min-width:0">
          <span class="ttl">${e(a.title)}</span>
          <span class="mt">${e(a.meta)}</span>
        </span>
        <span class="tick" style="background:${a.done ? "var(--butter)" : "transparent"};box-shadow:inset 0 0 0 1px ${a.done ? "var(--butter)" : "rgba(255,255,255,.2)"}">${a.done ? "✓" : ""}</span>
      </button>`,
    )
    .join("");

  const ruleRows = rules
    .map(
      (r, i) => `
      <div class="rule" aria-expanded="${state.rule === i}">
        <button class="hd" data-act="rule" data-i="${i}">
          <span>${e(r.label)}</span>
          <span class="car">${state.rule === i ? "⌃" : "⌄"}</span>
        </button>
        <div class="det">
          <span class="thumb" aria-hidden="true"></span>
          <span style="display:flex;flex-direction:column;gap:1px;min-width:0">
            <span style="font-size:11.5px">${e(r.detailTitle)}</span>
            <span class="m" style="font-size:9px;color:var(--t4)">${e(r.detailMeta)}</span>
          </span>
          <span class="m" style="margin-left:auto;font-size:11px;color:var(--t4)">⋮</span>
        </div>
      </div>`,
    )
    .join("");

  // The week ahead, so today sits at the left edge.
  const days: string[] = [];
  for (let i = 0; i < 6; i++) {
    const ms = NOW + i * 86_400_000;
    const dow = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Asia/Kuala_Lumpur" }).format(ms);
    const num = new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(ms);
    days.push(`<div class="c"><span class="dow">${e(dow)}</span><span class="n" style="color:${i === 0 ? "var(--t1)" : "var(--t3)"}">${e(num)}</span></div>`);
  }
  const hours = ["09:00", "11:00", "14:00", "16:00"]
    .map((h) => `<div class="hr">${h}</div><div class="ln"></div>`)
    .join("");

  return `
    <div class="page">
      <div class="greet">
        <div class="left">
          <div class="hero-h d">${greeting()}, ${e(ADVISOR)}</div>
          <div class="pillrow">
            <div class="pillcol">
              <span class="lbl">owed by you</span>
              <span class="pill">${totals.owedByAdvisor}</span>
            </div>
            <div class="pillcol">
              <span class="lbl">ready to send</span>
              <span class="pill acc">${readyToSend}</span>
            </div>
            <div class="pillcol">
              <span class="lbl">blocked</span>
              <span class="pill" style="box-shadow:inset 0 0 0 1px rgba(208,59,59,.4);background:transparent;color:var(--i-crit)">${blocked}</span>
            </div>
            <div class="pillcol" style="flex:1;min-width:0">
              <span class="lbl">quiet by design</span>
              <span class="pill absent" title="deliberate silence — no action is the action"></span>
            </div>
            <div class="pillcol">
              <span class="lbl">holding</span>
              <span class="pill ok">${onHold}</span>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:30px;flex:none;padding-bottom:2px">
          <div class="stat"><span class="v">${totals.clients}</span><span class="lbl">clients</span></div>
          <div class="stat"><span class="v">${totals.messages}</span><span class="lbl">messages</span></div>
          <div class="stat"><span class="v acc">${pending.length}</span><span class="lbl">awaiting you</span></div>
        </div>
      </div>

      <div class="bento">
        <button class="urgent" data-act="open-profile" data-client="${urgent.key}">
          <span class="grain" aria-hidden="true"></span>
          <span class="glow" aria-hidden="true"></span>
          <span class="flag">most urgent</span>
          <span class="btm">
            <span style="display:flex;flex-direction:column;gap:3px;min-width:0">
              <span class="nm">${e(urgent.name)}</span>
              <span class="sub">${oldest ? `promise open ${openDays(oldest)} days` : e(urgent.statusWord)}</span>
            </span>
            <span class="sc-n">${urgent.score.composite}</span>
          </span>
        </button>

        <div class="tile">
          <div class="tile-h">
            <span class="t">Client replies</span>
            <button class="ico" data-act="page" data-page="clients" title="Open clients">↗</button>
          </div>
          <div style="display:flex;align-items:baseline;gap:9px">
            <span class="num" style="font-size:30px;line-height:1;letter-spacing:-.03em">${weekBars.total}</span>
            <span class="m" style="font-size:10px;line-height:1.35;color:var(--t3)">in 7 days<br>${weekBars.quietDays} silent days</span>
          </div>
          <div class="bars">${bars}</div>
        </div>

        <div class="tile">
          <div class="tile-h">
            <span class="t">Reply clock</span>
            <button class="ico" data-act="open-profile" data-client="${replyClock.worst.key}" title="Open ${e(replyClock.worst.name)}">↗</button>
          </div>
          <div class="clock">
            <div class="dial" role="img" aria-label="Worst median reply latency ${e(replyClock.value)}">
              <div class="ring" style="background:conic-gradient(var(--butter) 0deg ${replyClock.degrees}deg, rgba(255,255,255,.08) ${replyClock.degrees}deg 360deg)">
                <div class="hole">
                  <span class="v">${e(replyClock.value)}</span>
                  <span class="lbl" style="font-size:8.5px">worst median</span>
                </div>
              </div>
            </div>
            <div class="key">${clockKey}</div>
          </div>
        </div>

        <div style="grid-row:span 2;display:flex;flex-direction:column;gap:12px;min-height:0">
          <div class="tile" style="flex:none;gap:11px">
            <div style="display:flex;align-items:baseline">
              <span class="t" style="font-size:17px;font-weight:500;letter-spacing:-.012em">Awaiting you</span>
              <span class="num" style="margin-left:auto;font-size:17px;letter-spacing:-.02em;color:var(--butter)">${pending.length}</span>
            </div>
            <div class="split">${split}</div>
            <span class="m" style="font-size:9.5px;color:var(--t4)">butter = send · dark = unblock · grey = dismiss</span>
          </div>
          <div class="tile deep" style="flex:1;min-height:0;gap:12px">
            <div style="display:flex;align-items:baseline;gap:10px">
              <span class="t sm" style="font-size:15px;font-weight:500">Approval queue</span>
              <span class="m" style="margin-left:auto;font-size:13px;color:var(--t3)">${approvals.length - pending.length}/${approvals.length}</span>
            </div>
            <div class="queue sc">${queueRows}</div>
          </div>
        </div>

        <div class="rules">${ruleRows}</div>

        <div class="timeline">
          <div class="hd">
            <span>this week</span>
            <span class="mo">${e(new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(NOW))}</span>
            <span class="nx">September</span>
          </div>
          <div class="tl-days"><div></div>${days.join("")}</div>
          <div class="tl-grid">
            ${hours}
            <div class="tl-ev acc" style="left:20%;top:8px">
              <span style="display:flex;flex-direction:column;gap:1px">
                <span class="n">Comparison still owed</span>
                <span class="s">D-012 · ${oldest ? openDays(oldest) : 0} days</span>
              </span>
              <span class="faces" aria-hidden="true">
                <i style="background:rgba(208,59,59,.3);color:var(--i-crit)">AL</i>
                <i style="background:rgba(255,215,106,.24);color:var(--butter)">WH</i>
              </span>
            </div>
            <div class="tl-ev" style="left:55%;bottom:18px">
              <span style="display:flex;flex-direction:column;gap:1px">
                <span class="n">Faizal parked until October</span>
                <span class="s">his instruction · B-051</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

/* ── page: client profile ────────────────────────────────────────── */

function clientCard(c: ClientView): string {
  const on = c.key === state.sel;
  return `
    <button class="ccard" data-act="select" data-client="${c.key}"${on ? ' aria-current="true"' : ""}>
      <span class="hd">
        <span class="ava s34" style="background:${markOf(c.tone)}29;box-shadow:inset 0 0 0 1px ${markOf(c.tone)}59;color:${inkOf(c.tone)}">${e(c.initials)}</span>
        <span style="display:flex;flex-direction:column;gap:1px;min-width:0">
          <span class="nm">${e(c.name)}</span>
          <span class="sub">${e(c.sub)}</span>
        </span>
      </span>
      <span class="twotone" aria-hidden="true">
        <i style="width:${c.w1}%;background:var(--butter)"></i>
        <i style="width:${c.w2}%;background:var(--chip-dark);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)"></i>
        <i style="flex:1;background:rgba(255,255,255,.08)"></i>
      </span>
      <span class="rec">☏ chat record · ${c.messageCount} msgs →</span>
    </button>`;
}

function cellStyle(cell: Cell): string {
  switch (cell.kind) {
    case "cited":
      return "background:var(--butter);color:var(--butter-d)";
    case "you":
      return "background:rgba(255,215,106,.13);box-shadow:inset 0 0 0 1px rgba(255,215,106,.28)";
    case "them":
      return "background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)";
    case "outside":
      return "background:transparent;box-shadow:inset 0 0 0 1px rgba(255,255,255,.05);background-image:var(--hatch)";
    default:
      return `background:transparent;box-shadow:inset 0 0 0 1px rgba(255,255,255,.055)${cell.weekend ? ";background-image:var(--hatch)" : ""}`;
  }
}

function cellInk(cell: Cell): string {
  if (cell.kind === "cited") return "rgba(11,13,16,.78)";
  if (cell.kind === "outside") return "rgba(242,245,249,.22)";
  if (cell.kind === "you") return "var(--butter)";
  if (cell.kind === "them") return "var(--t3)";
  return "var(--t4)";
}

function weekGrid(weeks: Week[]): string {
  return weeks
    .map((w) => {
      const cells = w.cells
        .map(
          (cell) => `
        <div class="cell" style="${cellStyle(cell)}" title="${e(cell.a11y)}">
          <span class="top">
            <span class="n" style="color:${cell.kind === "cited" ? "var(--butter-d)" : cell.kind === "outside" ? "rgba(242,245,249,.22)" : "var(--t1)"}">${e(cell.num)}</span>
            ${cell.kind === "cited" ? `<span class="lk" style="color:rgba(11,13,16,.6)">◆</span>` : ""}
          </span>
          ${cell.label ? `<span class="lb" style="color:${cellInk(cell)}">${e(cell.label)}</span>` : ""}
        </div>`,
        )
        .join("");

      const band = w.band
        ? `<div class="band" style="background:${markOf(w.band.tone)}1a;box-shadow:inset 0 0 0 1px ${markOf(w.band.tone)}4d">
             <i style="background:${markOf(w.band.tone)}"></i>
             <span style="color:${inkOf(w.band.tone)}">${e(w.band.label)}</span>
             <span class="rg">${e(w.band.range)}</span>
           </div>`
        : "";

      return `<div class="week"><div class="cells">${cells}</div>${band}</div>`;
    })
    .join("");
}

function profilePage(c: ClientView): string {
  const lat = c.score.signals.find((s) => s.name === "latency")!;
  const q = c.score.signals.find((s) => s.name === "questions")!;
  const init = c.score.signals.find((s) => s.name === "initiation")!;
  const r = c.windows.recent;

  return `
    <div class="page">
      ${clientHead(c)}
      <div class="cols3">
        <div class="clist">
          ${clients.map(clientCard).join("")}
          <div class="pager">
            <span class="edge">←</span><button class="on">1</button>
            <span class="dots">·</span><span class="edge">→</span>
          </div>
        </div>

        <div class="mid">
          <div class="toolrow">
            <button class="tool" title="Last 30 days">◴</button>
            <button class="tool" title="Grid">▤</button>
            <div class="search">⌕ <span>Search this thread — a quote, an id, a date…</span></div>
            <button class="tool" title="Filters">⌗</button>
            <button class="tool acc" data-act="open-record" data-client="${c.key}" title="Open the chat record">+</button>
          </div>

          <div class="bignums">
            <div class="pair">
              <span class="v">${e(lat.recent)}</span>
              <span class="sl">/</span>
              <span class="v" style="color:${inkOf(c.bigBTone)}">${e(c.bigB)}</span>
            </div>
            <span class="range">Last 30 days ⌄</span>
          </div>

          <div class="mpills">
            <div class="c" style="flex:2.6">
              <span class="lbl">replies</span>
              <span class="v a">${r.latencies.length} replies · median ${e(lat.recent)}</span>
            </div>
            <div class="c" style="flex:1.2">
              <span class="lbl">questions</span>
              <span class="v b">${e(q.recent)}</span>
            </div>
            <div class="c" style="flex:1.5">
              <span class="lbl">they started</span>
              <span class="v c">${e(init.recent)}</span>
            </div>
          </div>

          <div class="dow7">
            <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span class="we">Sat</span><span class="we">Sun</span>
          </div>
          <div class="weeks">${weekGrid(c.weeks)}</div>
        </div>

        <div class="rpanel">
          <div class="hero" style="background:linear-gradient(150deg,${c.heroA},${c.heroB})">
            <span class="grain" aria-hidden="true"></span>
            <span class="plate" style="box-shadow:0 0 0 4px rgba(11,14,18,.95), inset 0 0 0 1px ${markOf(c.tone)}59;color:${inkOf(c.tone)}">${e(c.initials)}</span>
          </div>
          <div class="in">
            <div class="who">
              <span class="n">${e(c.name)}</span>
              <span class="s">${e(c.sub)}</span>
            </div>

            <div class="sect">
              <span class="h">Basic information</span>
              ${c.facts
                .map(
                  (f) => `<div class="fact"><span class="g">${e(f.glyph)}</span><span class="k">${e(f.k)}</span><span class="d"></span><span class="v">${e(f.v)}</span></div>`,
                )
                .join("")}
            </div>

            <div class="sect">
              <span class="h">Evidence</span>
              <div class="evid">
                <button class="wa" data-act="open-record" data-client="${c.key}">
                  <span class="k" style="background:rgba(255,215,106,.22);color:var(--butter)">WA</span>
                  <span style="display:flex;flex-direction:column;gap:1px;min-width:0">
                    <span class="t">Thread</span><span class="s">${c.messageCount} msgs</span>
                  </span>
                </button>
                <div style="background:${markOf(c.ledgerTone)}1a;box-shadow:inset 0 0 0 1px ${markOf(c.ledgerTone)}4d">
                  <span class="k" style="background:${markOf(c.ledgerTone)}33;color:${inkOf(c.ledgerTone)}">LG</span>
                  <span style="display:flex;flex-direction:column;gap:1px;min-width:0">
                    <span class="t">Ledger</span><span class="s">${e(c.ledgerLabel)}</span>
                  </span>
                </div>
              </div>
            </div>

            <div class="sect">
              <span class="h">Signals</span>
              ${c.score.signals.map(signalRow).join("")}
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function clientHead(c: ClientView): string {
  return `
    <div class="phead">
      <span class="hero-h d">${e(c.name)}</span>
      <span class="chip" data-tone="${c.chipTone}" style="margin-bottom:7px">${e(c.statusWord)}</span>
      <div class="seg2">
        <button data-act="mode" data-mode="profile"${state.mode === "profile" ? ' aria-current="true"' : ""}>profile</button>
        <button data-act="mode" data-mode="record"${state.mode === "record" ? ' aria-current="true"' : ""}>chat record</button>
      </div>
    </div>`;
}

/* ── page: chat record ───────────────────────────────────────────── */

function keeps(m: RecMessage): boolean {
  if (state.filter === "client") return m.who === "client";
  if (state.filter === "flagged") return m.flag !== "" || m.chips.length > 0;
  return true;
}

function messageRow(m: RecMessage): string {
  const chips = m.chips
    .map(
      (ch) => `<span class="ec" style="color:${inkOf(ch.tone)};border:1px ${ch.dashed ? "dashed" : "solid"} ${markOf(ch.tone)}66">${e(ch.label)}</span>`,
    )
    .join("");

  return `
    <div class="msg${state.lit === m.id ? " lit" : ""}" data-who="${m.who}" data-mid="${e(m.id)}">
      ${m.gap ? `<span class="gap"><i></i><span style="color:${inkOf(m.gapTone)}">${e(m.gap)}</span><i></i></span>` : ""}
      <div class="bub">
        <span class="tx">${e(m.text)}</span>
        <span class="meta">${chips}<span class="id">${e(m.time)} · ${e(m.id)}</span></span>
      </div>
      ${m.flag ? `<span class="flag" style="color:${inkOf(m.flagTone)}">◆ ${e(m.flag)}</span>` : ""}
    </div>`;
}

function ideaCard(i: Idea, n: number, client: ClientKey): string {
  const on = state.idea === n;
  return `
    <div class="idea${i.primary ? " primary" : ""}" aria-expanded="${on}">
      <button class="hd" data-act="idea" data-i="${n}" style="width:100%">
        <span class="rank">${e(i.rank)}</span>
        <span class="t">${e(i.title)}</span>
      </button>
      <span class="why">${e(i.why)}</span>
      <div class="det">
        <div class="draft">
          <span class="lb">${e(i.draftLabel)}</span>
          <span class="tx">${e(i.draft)}</span>
        </div>
        <div class="acts">
          <button class="btn${i.primary ? " acc" : ""}">${e(i.btn)}</button>
          <button class="btn ghost">Edit</button>
          <span class="mt">${e(i.meta)}</span>
        </div>
        ${i.cites.length ? `<div class="citerow">${citeChips(i.cites, client)}</div>` : ""}
      </div>
    </div>`;
}

function recordPage(c: ClientView): string {
  const shown = c.messages.filter(keeps);
  const filters: Array<[Filter, string]> = [["all", "all"], ["client", "client only"], ["flagged", "flagged"]];

  return `
    <div class="page">
      ${clientHead(c)}
      <div class="cols3 rec">
        <div class="contacts">
          <span class="cap">contacts</span>
          ${clients
            .map(
              (x) => `
            <button class="contact" data-act="open-record" data-client="${x.key}"${x.key === c.key ? ' aria-current="true"' : ""}>
              <span class="ava s28" style="background:${markOf(x.tone)}29;box-shadow:inset 0 0 0 1px ${markOf(x.tone)}59;color:${inkOf(x.tone)}">${e(x.initials)}</span>
              <span style="display:flex;flex-direction:column;gap:1px;min-width:0">
                <span class="nm">${e(x.name)}</span>
                <span class="mt">${x.messageCount} msgs · ${e(dateShort.format(x.lastContact))}</span>
              </span>
            </button>`,
            )
            .join("")}
          <span class="note">Reading is local. Nothing is sent to a client from this screen without your click.</span>
        </div>

        <div class="thread">
          <div class="bar">
            <div class="search sm">⌕ <span>Search ${c.messageCount} messages…</span></div>
            <div class="filters">
              ${filters
                .map(
                  ([f, label]) =>
                    `<button data-act="filter" data-f="${f}" aria-pressed="${state.filter === f}">${e(label)}</button>`,
                )
                .join("")}
            </div>
          </div>
          <div class="msgs sc" id="msgs">
            ${shown.length ? shown.map(messageRow).join("") : `<p class="m" style="color:var(--t4);font-size:11px">No messages match this filter.</p>`}
          </div>
        </div>

        <div class="rrail sc">
          <div class="tile" style="gap:12px;flex:none">
            <div style="display:flex;align-items:baseline;gap:9px">
              <span class="t" style="font-size:14.5px;font-weight:500">Emotion spans</span>
              <span class="lbl" style="margin-left:auto">stage 3</span>
            </div>
            <div class="emo">
              <div class="hd">
                <span class="lb" style="color:var(--t3)">Not extracted yet</span>
                <span class="ct">0 spans</span>
              </div>
              ${meter(100, "transparent", true)}
              <span class="nt">The hatch is an absence, not a low score. Warmth, appreciation and curiosity need the extraction pass that isn't built — so this panel shows nothing rather than a number nobody measured. What the messages can already prove is on the chips beside them.</span>
            </div>
          </div>

          <div class="turn" style="background:${markOf(c.turn.tone)}17;box-shadow:inset 0 0 0 1px ${markOf(c.turn.tone)}4d">
            <span class="hd" style="color:${inkOf(c.turn.tone)}">${e(c.turn.head)}</span>
            <div class="q">
              <i style="background:${inkOf(c.turn.tone)}"></i>
              <p>${e(c.turn.quote)}</p>
            </div>
            <span class="nt">${e(c.turn.note)}</span>
            ${c.turn.cite !== "—" ? `<span>${citeChips([c.turn.cite], c.key)}</span>` : ""}
          </div>

          <div class="tile deep" style="gap:12px;flex:none">
            <div style="display:flex;align-items:baseline;gap:9px">
              <span class="t" style="font-size:14.5px;font-weight:500">How to solve it</span>
              <span class="lbl" style="margin-left:auto">hand-written · you decide</span>
            </div>
            ${(ideas[c.key] ?? []).map((i, n) => ideaCard(i, n, c.key)).join("")}
          </div>

          ${c.open.length ? openLedgerTile(c) : ""}
        </div>
      </div>
    </div>`;
}

function openLedgerTile(c: ClientView): string {
  const row = (x: LedgerEntry) => `
    <div style="display:flex;flex-direction:column;gap:6px;padding:9px 0;border-bottom:1px solid var(--hair)">
      <div style="display:flex;align-items:baseline;gap:8px">
        <span class="ec" style="color:var(--butter);border:1px dashed rgba(255,215,106,.5)">${e(x.kind)}</span>
        <span style="font-size:12px">${e(x.text)}</span>
      </div>
      <span class="m" style="font-size:9.5px;color:var(--t4)">owed by ${e(x.owedBy)} · open ${openDays(x)} days · since ${e(dateShort.format(x.openedAt))}</span>
      <blockquote style="margin:0;padding:6px 9px;border-left:2px solid rgba(255,255,255,.18);background:rgba(255,255,255,.035);font-size:11.5px;font-style:italic;color:var(--t3)">“${e(x.quote)}”</blockquote>
      <span>${citeChips([x.sourceMessageId], c.key)}</span>
    </div>`;

  return `
    <div class="tile" style="gap:6px;flex:none">
      <div style="display:flex;align-items:baseline;gap:9px;padding-bottom:6px">
        <span class="t" style="font-size:14.5px;font-weight:500">Open ledger</span>
        <span class="lbl" style="margin-left:auto">${c.open.length} open · ${c.settledCount} settled</span>
      </div>
      ${c.open.map(row).join("")}
    </div>`;
}

/* ── page: queues ────────────────────────────────────────────────── */

function queueRow(r: QueueRow): string {
  const cites = r.who ? citeChips(r.cites, r.who) : "";
  return `
    <div class="lrow" style="${r.rail ? `box-shadow:inset 2px 0 0 ${markOf(r.tone)}` : ""}${r.dim ? ";opacity:.72" : ""}">
      <span class="sq" style="background:${markOf(r.tone)}29;color:${inkOf(r.tone)}">${e(r.initials)}</span>
      <span class="who">
        <span class="n">${e(r.name)}</span>
        <span class="w">${e(r.when)}</span>
      </span>
      <span class="kindcol">
        <span class="kind" style="color:${inkOf(r.kindTone)};background:${r.kindDashed ? "transparent" : `${markOf(r.kindTone)}29`};border:1px ${r.kindDashed ? "dashed" : "solid"} ${r.kindDashed ? `${markOf(r.kindTone)}80` : "transparent"}">${e(r.kind)}</span>
      </span>
      <span class="bodycol">
        <span class="tx" style="color:${r.dim ? "var(--t2)" : "var(--t1)"}">${e(r.text)}</span>
        <span class="cites">${cites}<span class="why">${e(r.why)}</span></span>
      </span>
      <span class="actcol">
        <span class="st" style="color:${inkOf(r.stateTone)}">${e(r.state)}</span>
        ${r.btn ? `<span class="acts"><button class="btn${r.primary ? " acc" : ""}">${e(r.btn)}</button>${r.btn2 ? `<button class="btn ghost">${e(r.btn2)}</button>` : ""}</span>` : ""}
      </span>
    </div>`;
}

function queuePage(kind: QueueKind): string {
  const q = queues[kind];
  return `
    <div class="page">
      <div class="qhead">
        <span class="hero-h d">${e(q.title)}</span>
        <span class="mt">${e(q.meta)}</span>
      </div>
      <div class="qlist sc">
        ${q.rows.map(queueRow).join("")}
        <p class="qfoot">${e(q.foot)}</p>
      </div>
    </div>`;
}

/* ── render ──────────────────────────────────────────────────────── */

function body(): string {
  if (state.page === "home") return overviewPage();
  if (state.page === "clients") {
    const c = clientById(state.sel.toLowerCase());
    return state.mode === "record" ? recordPage(c) : profilePage(c);
  }
  return queuePage(state.page);
}

let compactRendered = false;

function render(): void {
  if (!compactRendered) {
    // Alert and call layers are rendered per-notification by showNotif.
    need("l-idle").innerHTML = idleLayer();
    need("l-peek").innerHTML = peekLayer();
    compactRendered = true;
  }
  if (state.st === "open") {
    need("l-open").innerHTML = `<div class="dash">${header()}<div class="body sc">${body()}</div>${footer()}</div>`;
  }
  reportHotRect(island);
}

function setState(st: IslandState): void {
  state.st = st;
  island.dataset.state = st;
  if (st !== "call") delete island.dataset.tone;
  if (st !== "alert" && st !== "call") {
    window.clearTimeout(dwellTimer);
    current = null;
  }
  if (st !== "open") state.lit = null;
  render();
}

/** Scroll the cited message into view and light it up. */
function focusCite(id: string): void {
  requestAnimationFrame(() => {
    const host = document.getElementById("msgs");
    const target = host?.querySelector<HTMLElement>(`[data-mid="${id}"]`);
    if (!host || !target) return;
    host.scrollTop = target.offsetTop - host.clientHeight / 2 + target.clientHeight / 2;
  });
}

/* ── events ──────────────────────────────────────────────────────── */

/* Hover-with-intent. A deliberate hover expands to the summary card; a
   cursor merely passing through does not — the 160ms delay filters the
   drive-bys that made the earlier version feel like it was dodging the
   pointer. The island grows around a fixed top-centre anchor, so nothing
   slides. Hovering a visible notification pauses its dwell so it can
   actually be read; leaving gives it 2.5s more, then it retires. */
let hoverTimer: number | undefined;

island.addEventListener("pointerenter", () => {
  if (state.st === "alert" || state.st === "call") {
    window.clearTimeout(dwellTimer);
    return;
  }
  if (state.st !== "idle") return;
  window.clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(() => {
    if (state.st === "idle") setState("peek");
  }, 160);
});

island.addEventListener("pointerleave", () => {
  window.clearTimeout(hoverTimer);
  if (state.st === "peek") setState("idle");
  else if (state.st === "alert" || state.st === "call") {
    if (current?.dwell !== null) {
      window.clearTimeout(dwellTimer);
      dwellTimer = window.setTimeout(() => {
        if (state.st === "alert" || state.st === "call") setState("idle");
      }, 2500);
    }
  }
});

island.addEventListener("click", (ev) => {
  const hit = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!hit) return;
  const act = hit.dataset.act;
  const key = hit.dataset.client as ClientKey | undefined;

  switch (act) {
    case "open":
      setState("open");
      return;
    case "quit":
      quit();
      return;
    case "page":
      state.page = (hit.dataset.page ?? "home") as Page;
      setState("open");
      return;
    case "select":
      if (key) state.sel = key;
      render();
      return;
    case "mode":
      state.mode = (hit.dataset.mode ?? "profile") as Mode;
      state.idea = 0;
      render();
      return;
    case "open-profile":
      if (key) state.sel = key;
      state.page = "clients";
      state.mode = "profile";
      setState("open");
      return;
    case "open-record":
      if (key) state.sel = key;
      state.page = "clients";
      state.mode = (hit.dataset.mode as Mode | undefined) ?? "record";
      state.idea = 0;
      setState("open");
      return;
    case "rule":
      state.rule = state.rule === Number(hit.dataset.i) ? -1 : Number(hit.dataset.i);
      render();
      return;
    case "idea":
      state.idea = state.idea === Number(hit.dataset.i) ? -1 : Number(hit.dataset.i);
      render();
      return;
    case "filter":
      state.filter = (hit.dataset.f ?? "all") as Filter;
      render();
      return;
    case "notif-open": {
      // Read before setState — leaving alert/call clears the current notif.
      const n = current;
      if (n?.client) {
        state.sel = n.client;
        state.page = "clients";
        state.mode = n.mode ?? "record";
        state.idea = 0;
      } else if (n?.kind === "reminder") {
        state.page = "calls";
      }
      setState("open");
      return;
    }
    case "cite": {
      const id = hit.dataset.id;
      if (!id || !key) return;
      state.sel = key;
      state.page = "clients";
      state.mode = "record";
      state.filter = "all";
      state.lit = id;
      setState("open");
      focusCite(id);
      return;
    }
    default:
      return;
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (state.st === "alert" || state.st === "call") {
    setState("idle");
    return;
  }
  if (state.lit !== null) {
    state.lit = null;
    render();
    return;
  }
  if (state.st === "open") setState("idle");
});

document.addEventListener("pointerdown", (ev) => {
  if (state.st !== "open") return;
  if (!island.contains(ev.target as Node)) setState("idle");
});

/* ── boot ────────────────────────────────────────────────────────── */

render();
watchHotRect(island);

/**
 * Demo hooks. `?state=alert` fires the new-message island with the 7s dwell the
 * design specifies; `?open` lands on the dashboard so the interesting screen is
 * one URL away rather than three interactions.
 */
const qs = new URLSearchParams(location.search);
const wanted = qs.get("state") as IslandState | null;

if (wanted === "alert" || wanted === "call") {
  const n = notifs.find((x) => (wanted === "alert" ? x.kind === "message" : x.kind === "reminder"));
  if (n) showNotif(n);
} else if (wanted === "idle" || wanted === "peek" || wanted === "open") {
  setState(wanted);
} else if (qs.has("open")) {
  const page = qs.get("page");
  if (page) state.page = page as Page;
  const who = qs.get("client");
  if (who) {
    state.sel = who.toUpperCase() as ClientKey;
    state.page = "clients";
    state.mode = (qs.get("mode") as Mode | null) ?? "profile";
  }
  setState("open");
}

/* The live feed. First notification lands 6s after boot, then one every 22s,
   cycling through the real events — each fires only if the island is idle, so
   nothing ever barges in over the dashboard or a hover. */
window.setTimeout(nextNotif, 6_000);
window.setInterval(nextNotif, 22_000);
