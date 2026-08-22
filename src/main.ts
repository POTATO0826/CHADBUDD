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
import { approvals, ideas, queues } from "./copy.ts";
import type { Idea, QueueKind, QueueRow } from "./copy.ts";
import type { ClientView, RecMessage, Tone } from "./derive.ts";
import {
  ADVISOR, INK, MARK, clientById, clients, dateShort, findClient, humanGap, replyClock,
  stamp, totals, weekBars,
} from "./derive.ts";
import { openDays } from "./ledger.ts";
import type { LedgerEntry } from "./ledger.ts";
import { bookTotals, buckets, stageOf } from "./book.ts";
import { STAGE_NOTE } from "../data/book.ts";
import { funnelElement } from "./funnel.tsx";
import type { Stage } from "../data/book.ts";
import { agenda, bigSlots, dayTotals, happeningNow, nextUp, nextUpIndex, slotById, untilText } from "./agenda.ts";
import type { AgendaSlot } from "./agenda.ts";
import { acceptProposal, askAgent, clientMeta, declineProposal, initLive, liveHoldings, liveNotes, queueSend, sendEmail, setClientEmail } from "./live.ts";
import { aiText, initDeskAi } from "./deskAi.ts";
import type { Task } from "./tasks.ts";
import { initTasks, taskCreate, taskDone, taskMove, taskRemove, tasks, tasksOn, urgencyOf } from "./tasks.ts";
import { openProposals, proposalReply, proposalWhen } from "./proposals.ts";
import { digestFor, emotionTone, keyPointsFor, latestEmotion } from "./emotions.ts";
import type { KeyPoint } from "./emotions.ts";
import { connectCalendar } from "./convexCalendar.ts";
import { initScramble } from "./scramble.ts";
import { POINT_GLYPH, POINT_LABEL, notesFor } from "./contact.ts";
import type { TaskKind } from "./inbox.ts";
import { TASK_GLYPH, TASK_LABEL, decisions, inboxTotals, tasksOfKind } from "./inbox.ts";
import { GATE_REASON, TIER_ACTION } from "./gates.ts";
import { NOTIFY_THRESHOLD_MIN, conflictsFrom, delayText, laterToday, markRunningOver, overrunFor } from "./presence.ts";
import { calendarDay, calendarMonth, calendarSource, calendarWeek, mondayOf, nowMs, refreshCalendar, refreshMonth, refreshWeek } from "./daysource.ts";
import type { CalendarEvent, Importance } from "./calendar.ts";
import { IMPORTANCE } from "./calendar.ts";
import { BIG } from "../data/schedule.ts";
import { holdings } from "../data/holdings.ts";
import type { MarketRow, MaturingRow, Report, StaleRow } from "./desk.ts";
import { deskView, dismissBrief, snoozeBrief } from "./desk.ts";
import { initDrag } from "./drag.ts";
import { focusWindow, isTauri, openExternal, openTelegram, quit, reportHotRect, setContentProtected, watchHotRect } from "./shell.ts";

/* ── tiny helpers ────────────────────────────────────────────────── */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const e = (s: string): string => s.replace(/[&<>"]/g, (c) => ESC[c]!);

function need<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

/** Is this specific recommendation's draft currently open for editing? */
const isEditing = (key: ClientKey, rank: string): boolean => state.editing === `${key}:${rank}`;

const inkOf = (t: Tone): string => (t === "butter" ? "var(--butter)" : INK[t]);
const markOf = (t: Tone): string => (t === "butter" ? "var(--butter)" : MARK[t]);

/**
 * A status colour at partial strength — a fill behind a chip, a ring, a glow.
 *
 * These used to be written by suffixing two hex digits onto the token — mark
 * followed by "29" — which worked only because custom-property substitution is
 * textual and the tokens happened to be six-digit hex. They are `oklch()` now,
 * and `oklch(...)29` is not a colour, so the alpha has to be applied rather
 * than appended. `oklab` keeps the mix perceptually even across the four hues.
 */
const tint = (colour: string, pct: number): string =>
  `color-mix(in oklab, ${colour} ${pct}%, transparent)`;

/* ── state ───────────────────────────────────────────────────────── */

/**
 * Which calendar view greets the advisor.
 *
 * Decided by a five-advisor council review rather than by taste — the verdict
 * and its reasoning are in the working record. The toggle persists per user,
 * so this only shapes the first opening and anyone who disagrees overrules it
 * once, permanently.
 */
const DEFAULT_CAL_VIEW: "week" | "month" = "week";

type IslandState = "idle" | "alert" | "call" | "peek" | "open";
type Page = "home" | "clients" | "agenda" | "calendar" | "assist" | QueueKind;
type Mode = "profile" | "record";
type Filter = "all" | "client" | "flagged";
/** The clients page is a grid of cards until one of them is opened. */
type ClientView2 = "grid" | "detail";

/** One turn in the ask-the-agent box. `sug` indexes into ideas[client]. */
interface AskTurn {
  from: "you" | "agent";
  text: string;
  sug?: number[];
  cites?: string[];
}

interface State {
  st: IslandState;
  page: Page;
  sel: ClientKey;
  filter: Filter;
  /** Message the current citation is pointing at. */
  lit: string | null;
  /** Clients page: the grid of cards, or one client opened. */
  cview: ClientView2;
  /** Clients page: the stage the grid is filtered to. Null shows everyone. */
  stage: Stage | null;
  /** Dashboard tile: index into bigSlots being shown. Null follows nextUp. */
  up: number | null;
  /** Agenda page: which slot's context is open. Defaults to the next one. */
  slot: string | null;
  /** Calendar page: first-of-month being shown. Null follows the clock. */
  month: number | null;
  /** Calendar page: which view is the main one. Persisted per user. */
  calView: "week" | "month";
  /** Calendar page: whether the other view is open as an overlay. */
  calOverlay: boolean;
  /** Calendar page: the single-day page, or null for the main view. */
  calDay: number | null;
  /** Week view: Monday of the week shown. Null follows the clock. */
  wk: number | null;
  /** Desk: the expanded row, by brief id. Null is everything collapsed. */
  desk: string | null;
  /** Desk: which market hit's draft is open inside an expanded event. */
  deskHit: string | null;
  /** Live text in the chat-history search box. */
  q: string;
  /** Ask-the-agent transcript, per client — switching clients keeps yours. */
  ask: Partial<Record<ClientKey, AskTurn[]>>;
  /** Draft in the ask composer. */
  draft: string;
  /**
   * Which recommendation's draft is open for editing, as "key:rank".
   *
   * The agent writes a message in the advisor's name, and the advisor is the
   * one who has to stand behind it. Editing before sending is the difference
   * between a tool that suggests and a tool that dictates — and what actually
   * goes out is what was approved, not what the model originally wrote.
   */
  editing: string | null;
  /** Reply composer: which channel, and the draft surviving re-renders. */
  replyVia: "tg" | "em";
  replyDraft: string;
  /** The edited text, held apart so cancelling restores the agent's original. */
  editText: string;
  /**
   * Whether the shell reports the window as hidden from screen capture.
   * Set from Rust's answer, never from the request — see setContentProtected.
   */
  hidden: boolean;
}

const top = clients[0]!;

const state: State = {
  st: "idle",
  page: "home",
  sel: top.key,
  filter: "all",
  lit: null,
  cview: "grid",
  stage: null,
  up: null,
  slot: null,
  month: null,
  calView: ((): "week" | "month" => {
    try {
      const saved = localStorage.getItem("cb-calview");
      if (saved === "week" || saved === "month") return saved;
    } catch {
      /* private mode: the default stands */
    }
    return DEFAULT_CAL_VIEW;
  })(),
  calOverlay: false,
  calDay: null,
  wk: null,
  desk: null,
  deskHit: null,
  q: "",
  ask: {},
  draft: "",
  editing: null,
  replyVia: "tg",
  replyDraft: "",
  editText: "",
  // Off by default: the island should be visible in a screen recording made
  // deliberately, and hidden only when the advisor says so.
  hidden: false,
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

   · message — a client's latest Telegram message replays as an incoming
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
    /* Owed items used to sit here until acted on — dwell: null — on the
       reasoning that a 104-day promise should not be dismissable by waiting.
       In practice it meant the island parked over whatever the advisor was
       working in and stayed there, which is not urgency, it is an obstruction:
       the one notification you cannot dismiss is the one you learn to ignore.

       Nine seconds like the rest. The urgency is not lost — the item stays in
       the approval queue and the overview keeps counting it. */
    "!": { tag: "OWED", tone: "critical", dwell: 9000 },
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

/** When the notification on screen began, so its remaining dwell is knowable. */
let shownAt = 0;

/**
 * A notification set aside while the pointer is on the island.
 *
 * Hovering expands to the summary card from any compact state, which means a
 * hover can interrupt a notification that had seconds left to run. Discarding
 * it there would make a passing cursor silently eat an alert. Parking it keeps
 * the two behaviours from fighting: the hover wins while it lasts, and what
 * was underneath comes back afterwards if it has not expired in the meantime.
 */
let parked: { notif: Notif; left: number | null } | null = null;

function showNotif(n: Notif): void {
  current = n;
  shownAt = Date.now();
  if (n.kind === "message") {
    need("l-alert").innerHTML = messageLayer(n);
    setState("alert");
  } else {
    need("l-call").innerHTML = reminderLayer(n);
    island.dataset.tone = n.tone;
    setState("call");
  }
  window.clearTimeout(dwellTimer);
  arm(n.dwell);
}

/** Start the retirement clock. `null` means this one waits to be acted on. */
function arm(ms: number | null): void {
  window.clearTimeout(dwellTimer);
  if (ms === null) return;
  dwellTimer = window.setTimeout(() => {
    if (state.st === "alert" || state.st === "call") setState("idle");
  }, ms);
}

/** Put a parked notification back with the time it had left. */
function resumeParked(): boolean {
  const p = parked;
  parked = null;
  if (!p) return false;

  current = p.notif;
  if (p.notif.kind === "message") {
    need("l-alert").innerHTML = messageLayer(p.notif);
    setState("alert");
  } else {
    need("l-call").innerHTML = reminderLayer(p.notif);
    island.dataset.tone = p.notif.tone;
    setState("call");
  }
  // Resumed, not restarted: a notification interrupted with two seconds left
  // gets two seconds, not a fresh nine.
  arm(p.left);
  return true;
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

/* ── open: chrome ────────────────────────────────────────────────── */

const NAV: Array<{ page: Page; label: string; count: number }> = [
  { page: "home", label: "overview", count: 0 },
  { page: "agenda", label: "day", count: dayTotals.left },
  { page: "calendar", label: "calendar", count: 0 },
  { page: "clients", label: "clients", count: totals.clients },
  { page: "calls", label: "calls", count: queues.calls.rows.filter((r) => r.btn !== "").length },
];

/**
 * The mark: a squircle with two bars cut out of it.
 *
 * The bars are the product in one glyph. The top one runs the full width, the
 * one under it reaches barely half as far — a message, and the reply that came
 * back shorter. That is not decorative shorthand, it is the signal the engine
 * actually measures: across the seed threads a decaying client's average
 * message falls from 105 characters to 20 while everything else stays polite.
 *
 * Drawn as negative space rather than as two strokes on a plate, so the mark
 * stays one solid silhouette and survives being set at 14px next to the
 * wordmark. One path, one `currentColor` fill, no gradients and no ids — it
 * inherits whatever colour the brand pill is using and cannot collide with
 * another copy of itself on the page.
 */
const BRAND_MARK = `
  <svg class="mk" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" fill-rule="evenodd" d="M7.6 0h8.8C20.6 0 24 3.4 24 7.6v8.8c0 4.2-3.4 7.6-7.6 7.6H7.6C3.4 24 0 20.6 0 16.4V7.6C0 3.4 3.4 0 7.6 0Z M7.55 8.05a1.3 1.3 0 0 0 0 2.6h8.9a1.3 1.3 0 0 0 0-2.6Z M7.55 13.35a1.3 1.3 0 0 0 0 2.6h3.8a1.3 1.3 0 0 0 0-2.6Z"/>
  </svg>`;

function header(): string {
  const nav = NAV.map((n) => {
    const on = n.page === state.page;
    // NAV is built once at load; proposals arrive by subscription afterwards,
    // so the calls badge has to pick them up at render time or sit at zero.
    const count = n.page === "calls" ? n.count + openProposals().length : n.count;
    const badge = count > 0 ? `<span class="badge">${count}</span>` : "";
    return `<button data-act="page" data-page="${n.page}"${on ? ' aria-current="page"' : ""}>
              <span>${e(n.label)}</span>${badge}
            </button>`;
  }).join("");

  /* The latest emotional read across the book, or the hatch when the
     extraction pass has not run — an explicit absence, never a guess. Every
     shown label carries its evidence in the tooltip: the client, the verbatim
     span it was read from, and the message id, because a feeling with no
     quote behind it is exactly what this dashboard refuses to display. */
  const latest = latestEmotion();
  const emo = latest
    ? (() => {
        const c = clients.find((x) => x.key === latest.key);
        const tone = emotionTone(latest.span.label);
        return `<span class="orb emo" style="color:${inkOf(tone)};box-shadow:inset 0 0 0 1px ${tint(markOf(tone), 40)};background:${tint(markOf(tone), 10)}"
                      title="${e(c?.name ?? latest.key)}: “${e(latest.span.quote)}” — ${e(latest.span.sourceId)}"
                >${e(latest.span.label)}</span>`;
      })()
    : `<span class="orb emo absent" title="emotion — extraction not run against these threads"></span>`;

  return `
    <div class="hdr">
      <span class="brand">${BRAND_MARK}<span class="wm">chadbuddy</span></span>
      <nav class="nav" aria-label="Sections">${nav}</nav>
      <div class="orbs">
        ${emo}
        ${isTauri ? `<button class="orb" data-act="quit" title="Quit ChadBuddy" aria-label="Quit">⏻</button>` : ""}
        ${isTauri
          ? `<button class="orb${state.hidden ? " on" : ""}" data-act="protect"
                     aria-pressed="${state.hidden}"
                     aria-label="${state.hidden ? "Show during screen sharing" : "Hide during screen sharing"}"
                     title="${state.hidden
                       ? "Hidden from screen capture — Zoom, Teams, OBS and PrintScreen see the desktop behind. Not proof against a camera pointed at the screen."
                       : "Visible to screen capture. Click to hide the island while sharing your screen."}"
             >${state.hidden ? "⊘" : "◉"}</button>`
          : ""}
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

/* ── the day ─────────────────────────────────────────────────────
   The top-left tile used to name the most urgent client. That is a fact the
   clients page already leads with — it sorts silent churn first — so the most
   valuable slot on the dashboard was spending itself on a repeat. What it did
   not answer is the question actually being asked at noon on a Monday: where
   do I have to be next, and what do I need to know when I walk in. */

/** A glyph per kind, so a row is never colour alone. */
const SLOT_GLYPH: Record<string, string> = {
  meeting: "◍", call: "☏", travel: "→", break: "◔", focus: "✦", admin: "▤",
};

const hhmmFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" });
const hhmmOf = (ms: number): string => hhmmFmt.format(ms);


/** A slot borrows its client's status colour; the advisor's own time stays quiet. */
function slotTone(s: AgendaSlot): Tone {
  if (s.kind === "break" || s.kind === "travel") return "good";
  const c = s.withClient ? clientById(s.withClient.toLowerCase()) : null;
  return c ? c.tone : "butter";
}

/**
 * The next commitment, counted down — and steppable.
 *
 * Travel and breaks are left out on purpose: "next up: drive to Bangsar" is
 * true and useless. What is wanted from across the room is the next thing a
 * person is waiting for you at, which is why the arrows walk `bigSlots` rather
 * than the whole day.
 *
 * The arrows are siblings of the face rather than children of it, because a
 * button inside a button is invalid and the delegated click handler would have
 * had to guess which one was meant. `closest("[data-act]")` then resolves an
 * arrow to the arrow and everything else to the face, with no stopPropagation
 * anywhere.
 *
 * Whatever the face is showing is what the face opens — `data-slot` is written
 * from the same slot the countdown describes, so stepping to Ms Tan and
 * clicking lands on Ms Tan.
 */
function upNextTile(): string {
  const list = bigSlots;
  const now = happeningNow;

  if (!list.length) {
    return `
      <div class="upnext"><button class="face" data-act="page" data-page="agenda">
        <span class="grain" aria-hidden="true"></span>
        <span class="flag">the day</span>
        <span class="btm"><span style="display:flex;flex-direction:column;gap:3px;min-width:0">
          <span class="nm">Nothing scheduled</span>
          <span class="sub">no commitments on the book today</span>
        </span></span>
      </button></div>`;
  }

  const at = Math.min(list.length - 1, Math.max(0, state.up ?? nextUpIndex));
  const s = list[at]!;
  const who = s.withClient ? clientById(s.withClient.toLowerCase()).name : (s.withName ?? s.where);
  const tone = slotTone(s);

  // The flag has to say which way you have stepped, or a past meeting reads as
  // the next one with a strange countdown attached to it.
  const flag = at === nextUpIndex ? "next up" : s.past ? "earlier today" : "later today";

  const arrow = (dir: number, glyph: string, label: string): string => {
    const to = at + dir;
    const off = to < 0 || to > list.length - 1;
    return `<button class="ar" data-act="up-step" data-dir="${dir}"${off ? " disabled" : ""}
      aria-label="${e(label)}">${glyph}</button>`;
  };

  return `
    <div class="upnext">
      <button class="face" data-act="open-slot" data-slot="${e(s.id)}"
        aria-label="${e(flag)}: ${e(s.title)}, ${e(untilText(s.inMinutes))}. Open its context.">
        <span class="grain" aria-hidden="true"></span>
        <span class="glow" aria-hidden="true" style="background:radial-gradient(closest-side, ${tint(markOf(tone), 20)}, transparent)"></span>
        <span class="flag">${e(flag)}</span>
        <span class="cd" style="color:${inkOf(tone)}">${e(untilText(s.inMinutes))}</span>
        <span class="btm">
          <span style="display:flex;flex-direction:column;gap:3px;min-width:0">
            <span class="nm">${e(who)}</span>
            <span class="sub">${e(s.clock)} · ${e(s.title)}</span>
          </span>
        </span>
        ${now ? `<span class="nowline">now · ${e(now.title.toLowerCase())} until ${e(hhmmOf(now.end))}</span>` : ""}
      </button>
      <span class="step">
        ${arrow(-1, "‹", "Earlier commitment")}
        <span class="pos">${at + 1}/${list.length}</span>
        ${arrow(1, "›", "Later commitment")}
      </span>
    </div>`;
}

/** One row in the day list. */
function slotRow(s: AgendaSlot, on: boolean): string {
  const tone = slotTone(s);
  const who = s.withClient ? clientById(s.withClient.toLowerCase()).name : s.withName;
  return `
    <button class="slot${on ? " on" : ""}${s.past ? " past" : ""}" data-act="open-slot" data-slot="${e(s.id)}">
      <span class="tm">${e(s.clock)}</span>
      <span class="gl" style="color:${inkOf(tone)};background:${tint(markOf(tone), 14)}">${e(SLOT_GLYPH[s.kind] ?? "◍")}</span>
      <span class="col">
        <span class="ttl">${e(s.title)}</span>
        <span class="mt">${who ? `${e(who)} · ` : ""}${s.minutes} min${s.live ? " · now" : ""}</span>
      </span>
    </button>`;
}



/**
 * The context panel.
 *
 * Purpose is the advisor's own framing, so it is allowed to be prose. Nothing
 * under it is: the citations came through the same verbatim gate the ledger
 * uses, and "where the purpose stands" is that client's measured state rather
 * than a sentence about how the relationship feels.
 */
/**
 * Running over, and who that lands on.
 *
 * A calendar records intentions; it has no idea whether the 13:15 actually
 * finished. The advisor does, and one tap here is the only signal that is
 * never wrong — the assistant's own two routes (somebody mentioning a delay,
 * a check that goes unanswered for ten minutes) exist because this tap will
 * often not happen, not because they are better.
 *
 * The consequences are shown before the tap rather than after. Anyone about
 * to tell three clients they are late should see which three first.
 */
function overrunBlock(s: AgendaSlot): string {
  const event = calendarDay().find((x) => x.id === s.id);
  if (!event) return "";

  const over = overrunFor(s.id);
  const now = nowMs();
  const ended = Date.parse(event.at) + event.minutes * 60_000;
  // Nothing to say about a block that has not started.
  if (now < Date.parse(event.at)) return "";

  const affected = over ? conflictsFrom(over, laterToday(calendarDay(), now), now) : [];

  const who = affected.length
    ? `<div class="told">${affected
        .map((x) => {
          const cc = clientById(x.client.toLowerCase());
          return `<span class="t1">${e(cc.name)}<em>${e(delayText(x))}</em></span>`;
        })
        .join("")}</div>`
    : over
      ? `<span class="none">Under ${NOTIFY_THRESHOLD_MIN} minutes, or nobody close enough to affect — no messages sent.</span>`
      : "";

  return `
    <div class="sect over" data-on="${over ? "yes" : "no"}">
      <span class="lbl">running over</span>
      ${over
        ? `<span class="state">${over.minutes} minutes past ${e(
             over.by === "tapped"
               ? "— you said so"
               : over.by === "mentioned"
                 ? "— someone mentioned it in a thread"
                 : "— the check went unanswered for ten minutes",
           )}</span>`
        : now > ended
          ? `<span class="state">Scheduled to end at ${e(hhmmOf(ended))}. Did it?</span>`
          : `<span class="state">Ends at ${e(hhmmOf(ended))}.</span>`}
      ${who}
      <div class="ctxacts">
        <button class="btn${over ? "" : " acc"}" data-act="running-over" data-slot="${e(s.id)}">
          ${over ? "Still running" : "Running over"}</button>
      </div>
    </div>`;
}

/**
 * A block this app booked from something it read.
 *
 * The whole reason inferring a time from a message is safe is that the result
 * arrives here rather than in the client's inbox: pencilled in, attributed to
 * the message it came from, and one tap from gone. A tentative block with no
 * way to resolve it would be worse than not booking at all — it would leave the
 * advisor with a diary they cannot trust and no way to fix it.
 */
function tentativeBlock(s: AgendaSlot): string {
  const event = calendarDay().find((x) => x.id === s.id);
  if (!event || event.booking !== "tentative") return "";

  const from = event.inferredFrom;
  return `
    <div class="sect tent">
      <span class="lbl">pencilled in</span>
      <span class="state">Nobody confirmed this to you — it was read out of a ${e(
        from?.source ?? "message",
      )} thread, so check it before you rely on it.</span>
      ${from && s.withClient ? `<div class="citerow">${citeChips([from.cite], s.withClient)}</div>` : ""}
      <div class="ctxacts">
        <button class="btn acc" data-act="confirm-slot" data-slot="${e(s.id)}">That is right</button>
        <button class="btn" data-act="drop-slot" data-slot="${e(s.id)}">Remove it</button>
      </div>
    </div>`;
}

function slotContext(s: AgendaSlot): string {
  const c = s.withClient ? clientById(s.withClient.toLowerCase()) : null;
  const tone = slotTone(s);
  const lat = c?.score.signals.find((x) => x.name === "latency");
  const qs = c?.score.signals.find((x) => x.name === "questions");

  const progress = c
    ? `
      <div class="sect">
        <span class="lbl">where the purpose stands</span>
        <div class="fact"><span class="g">◆</span><span class="k">Open items</span><span class="d"></span>
          <span class="v" style="color:${c.open.length ? inkOf(c.ledgerTone) : "var(--t1)"}">${e(c.ledgerLabel)}</span></div>
        <div class="fact"><span class="g">◷</span><span class="k">Median reply</span><span class="d"></span>
          <span class="v">${e(lat ? lat.recent : "—")}</span></div>
        <div class="fact"><span class="g">?</span><span class="k">Questions, 30d</span><span class="d"></span>
          <span class="v">${e(qs ? qs.recent : "—")}</span></div>
        <div class="fact"><span class="g">✦</span><span class="k">Status</span><span class="d"></span>
          <span class="v" style="color:${inkOf(c.tone)}">${e(c.statusWord)}</span></div>
      </div>
      ${c.open.length ? `<div class="owe">${c.open.map((x) => `<span class="ow">${e(x.text)}<em> · ${openDays(x)} days, owed by ${e(x.owedBy)}</em></span>`).join("")}</div>` : ""}`
    : "";

  return `
    <div class="ctx">
      <div class="ctxhead">
        <span class="kind" style="color:${inkOf(tone)};background:${tint(markOf(tone), 16)}">${e(SLOT_GLYPH[s.kind] ?? "◍")} ${e(s.kind)}</span>
        <span class="when">${e(s.clock)} · ${s.minutes} min · ${e(untilText(s.inMinutes))}</span>
      </div>
      <span class="hero-h d" style="font-size:25px">${e(s.title)}</span>
      <span class="whereline">${e(s.where)}${s.withName ? ` · ${e(s.withName)}` : ""}</span>

      ${s.purpose ? `<div class="sect"><span class="lbl">why this is in the diary</span>
        <p class="prose">${e(s.purpose)}</p>
        ${s.cites.length && s.withClient ? `<div class="citerow">${citeChips(s.cites, s.withClient)}</div>` : ""}</div>` : ""}

      ${progress}

      ${s.prep.length ? `<div class="sect"><span class="lbl">have ready</span>
        ${s.prep.map((p) => `<span class="prep">▢ ${e(p)}</span>`).join("")}</div>` : ""}

      ${tentativeBlock(s)}

      ${overrunBlock(s)}

      ${c ? `<div class="ctxacts"><button class="btn acc" data-act="open-client" data-client="${c.key}">Open ${e(c.name.split(" ")[0]!)}</button></div>` : ""}
    </div>`;
}

function agendaPage(): string {
  const sel = slotById(state.slot ?? "") ?? nextUp ?? agenda[0]!;
  return `
    <div class="page fixed">
      <div class="qhead">
        <span class="hero-h d">Monday</span>
        <span class="mt">${dayTotals.meetings} commitments · ${dayTotals.travelMinutes} min on the road ·
          ${dayTotals.breakMinutes} min of break the assistant is protecting. These are the plan, not a guess.</span>
      </div>
      <div class="daycols">
        <div class="daylist sc" id="daylist">${agenda.map((x) => slotRow(x, x.id === sel.id)).join("")}</div>
        <div class="dayctx sc" id="dayctx">${slotContext(sel)}</div>
      </div>
    </div>`;
}

/* ── the month ───────────────────────────────────────────────────
   A calendar the advisor can step through, shaded by how committed each day
   is. The day tab answers "where am I going next"; this answers the question
   that comes before booking anything — "what does that week already look
   like". */

/* The density machinery that used to live here — load minutes, hour steps,
   the four-step fill — is gone with the question it answered. The desk keeps
   its own copy in src/desk.ts, where "how much committed time" is still the
   right question to ask. */

const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

/** Monday-first, which is how a working week is read here. */
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** How many entries fit in a cell before the rest become a count. */
const CHIPS_PER_CELL = 3;

const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/* ── importance, drawn ──────────────────────────────────────────────
   The heatmap changed its question. Density asked "how packed"; importance
   asks "how heavy" — and a day with one meeting with the biggest client on
   the book outranks four routine check-ins. The shade of a day is the weight
   of its heaviest meeting, never a sum, and *unrated* is shown as unrated:
   silently treating it as routine would make the map lie exactly where it
   matters most. */

const IMP_RANK: Record<Importance, number> = { routine: 1, important: 2, key: 3 };

/* One calm hue deepening. Key does not wear gold or red on purpose —
   importance is not alarm, and a heavy week must not read as an incident. */
const IMP_FILL: Record<Importance, string> = { routine: "8%", important: "19%", key: "32%" };

const impTint = (imp: Importance | null): string =>
  imp === null ? "transparent" : `color-mix(in oklab, var(--foam) ${IMP_FILL[imp]}, transparent)`;

/** A day's weight: its heaviest rated meeting, and whether any await rating. */
function dayImportance(list: CalendarEvent[]): { imp: Importance | null; unrated: boolean } {
  let imp: Importance | null = null;
  let unrated = false;
  for (const ev of list) {
    if (!BIG.has(ev.kind)) continue;
    if (ev.importance === undefined) {
      unrated = true;
      continue;
    }
    if (imp === null || IMP_RANK[ev.importance] > IMP_RANK[imp]) imp = ev.importance;
  }
  return { imp, unrated };
}

/**
 * What the book says this meeting is probably worth.
 *
 * The council review's decisive fix: an advisor with hundreds of clients will
 * not hand-rate every meeting, and a heatmap built on sparse voluntary tags
 * looks authoritative while lying. So the rating arrives pre-filled from data
 * the app already holds — how much the client has with you, whether anything
 * of theirs matures inside the window, how long their holdings have gone
 * without an update — and confirming accepts it in one click. The advisor
 * always outranks the suggestion; the suggestion only outranks silence.
 */
function suggestImportance(ev: CalendarEvent): Importance {
  if (!ev.withClient) return "routine";
  const book = (liveHoldings() as typeof holdings | null) ?? holdings;
  const theirs = book.filter((h) => h.client === ev.withClient);
  if (theirs.length === 0) return "routine";

  const total = theirs.reduce((n, h) => n + h.value, 0);
  const soonDays = (h: (typeof theirs)[number]): number | undefined =>
    h.maturesInDays !== undefined
      ? h.maturesInDays
      : h.maturesAtIso
        ? Math.ceil((Date.parse(h.maturesAtIso) - nowMs()) / 86_400_000)
        : undefined;
  const maturingSoon = theirs.some((h) => {
    const d = soonDays(h);
    return d !== undefined && d >= 0 && d <= 14;
  });
  const stale = theirs.some((h) => h.lastUpdateDaysAgo >= 90);

  if (maturingSoon || total >= 150_000) return "key";
  if (stale || total >= 50_000) return "important";
  return "routine";
}

/**
 * The three-way control. `cur` is what the advisor set; `suggested` is what
 * the book proposes when they have not — drawn dashed, never solid, because a
 * suggestion wearing the same ink as a decision would erase the difference.
 */
function impSeg(id: string, cur?: Importance, suggested?: Importance): string {
  return `<span class="impseg" role="group" aria-label="Importance">${IMPORTANCE.map(
    (v) =>
      `<button class="isb${cur === v ? " on" : cur === undefined && suggested === v ? " sug" : ""}" data-act="cal-set" data-ev="${e(id)}" data-imp="${v}">${v}</button>`,
  ).join("")}</span>`;
}

const IMP_LEGEND = `
  <div class="ramp">
    <span class="lbl">importance</span>
    <span class="sw" style="--fill:${impTint("routine")}"></span>
    <span class="sw" style="--fill:${impTint("important")}"></span>
    <span class="sw" style="--fill:${impTint("key")}"></span>
    <span class="rt">routine · important · key — shading is importance, not volume · ? = unrated</span>
  </div>`;

/**
 * The month, shaded by weight.
 *
 * Grid mechanics unchanged from the density era: lead/tail days of the
 * neighbouring months are holes, chips carry what is on the day, counts stay
 * as text. Only the meaning of the fill changed.
 */
function monthGrid(anchorMs: number, events: CalendarEvent[]): string {
  const first = new Date(anchorMs);
  first.setDate(1);
  first.setHours(0, 0, 0, 0);

  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  // getDay() is Sunday-first; shift so Monday is column 0.
  const lead = (first.getDay() + 6) % 7;

  const today = startOfDay(nowMs());

  const byDay = new Map<number, CalendarEvent[]>();
  for (const ev of events) {
    const k = startOfDay(Date.parse(ev.at));
    const list = byDay.get(k);
    if (list) list.push(ev);
    else byDay.set(k, [ev]);
  }

  const cells: string[] = [];

  for (let i = 0; i < lead; i++) cells.push(`<span class="cell out" aria-hidden="true"></span>`);

  for (let d = 1; d <= daysInMonth; d++) {
    const at = new Date(first.getFullYear(), first.getMonth(), d).getTime();
    const list = byDay.get(at) ?? [];
    const { imp, unrated } = dayImportance(list);
    const isToday = at === today;
    const weekend = [5, 6].includes((new Date(at).getDay() + 6) % 7);

    const n = list.length;

    const chips = list
      .slice(0, CHIPS_PER_CELL)
      .map((x) => {
        const start = Date.parse(x.at);
        const heavy = x.kind === "meeting" || x.kind === "call";
        const who = x.withClient ? clientById(x.withClient.toLowerCase()).name.split(" ")[0] : "";
        return `<span class="chip${heavy ? " hv" : ""}${x.booking === "tentative" ? " tent" : ""}">
          <i>${e(hhmmOf(start))}</i>${e(who || x.title)}</span>`;
      })
      .join("");

    const over = n - CHIPS_PER_CELL;

    const cellTasks = tasksOn(at).filter((t) => !t.done);

    cells.push(`
      <button class="cell${isToday ? " today" : ""}${state.calDay === at ? " on" : ""}${weekend ? " wk" : ""}"
        data-act="cal-day" data-day="${at}" data-drop-day="${at}"
        style="--fill:${impTint(imp)}"
        aria-current="${isToday ? "date" : "false"}"
        aria-label="${e(new Date(at).toDateString())}, ${n} ${n === 1 ? "entry" : "entries"}, ${cellTasks.length} task${cellTasks.length === 1 ? "" : "s"}">
        <span class="top">
          <span class="dn">${d}</span>
          ${unrated ? `<span class="unm" title="Has unrated meetings">?</span>` : ""}
          ${n ? `<span class="cn">${n}</span>` : ""}
        </span>
        <span class="chips">
          ${cellTasks.slice(0, 2).map(taskChip).join("")}
          ${cellTasks.length > 2 ? `<span class="more">+${cellTasks.length - 2} tasks</span>` : ""}
          ${chips}${over > 0 ? `<span class="more">+${over} more</span>` : ""}
        </span>
      </button>`);
  }

  const tail = (7 - ((lead + daysInMonth) % 7)) % 7;
  for (let i = 0; i < tail; i++) cells.push(`<span class="cell out" aria-hidden="true"></span>`);

  return `
    <div class="dow">${DOW.map((x) => `<span>${x}</span>`).join("")}</div>
    <div class="grid">${cells.join("")}</div>`;
}

/**
 * One day, drawn to scale.
 *
 * Blocks are positioned and sized by real time rather than listed, because the
 * thing worth seeing is the shape of the day — where the gaps are, and whether
 * two commitments are back to back. A list of five rows makes an hour and a
 * ten-minute call look the same size.
 */
function dayBlocks(dayMs: number, events: CalendarEvent[]): string {
  const day = startOfDay(dayMs);
  const list = events
    .filter((x) => startOfDay(Date.parse(x.at)) === day)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  if (list.length === 0) {
    return `
      <div class="empty">
        <span class="hero-h d" style="font-size:19px">Nothing booked</span>
        <span class="mt">No commitments on this day. Worth keeping some of it.</span>
      </div>`;
  }

  /* The window fits the day rather than assuming office hours: a 07:00 airport
     run and a 20:00 call both have to be inside it, and a fixed 09–18 scale
     would quietly clip them off the top or bottom of the column. */
  const starts = list.map((x) => Date.parse(x.at));
  const ends = list.map((x, i) => starts[i]! + x.minutes * 60_000);
  const from = Math.min(...starts, day + 8 * 3_600_000);
  const to = Math.max(...ends, day + 18 * 3_600_000);
  const span = to - from;

  const hours: string[] = [];
  for (let h = new Date(from).getHours(); h * 3_600_000 + day <= to; h++) {
    const at = day + h * 3_600_000;
    if (at < from) continue;
    hours.push(`<span class="hr" style="top:${((at - from) / span) * 100}%">${String(h).padStart(2, "0")}</span>`);
  }

  /**
   * Side by side when they overlap.
   *
   * A real calendar has a call inside a travel block and a meeting that runs
   * into the next one; drawn full width they cover each other and the one
   * underneath simply is not there. Lanes are assigned greedily in start order
   * — the first lane whose last block has already ended — which is what every
   * calendar does and is right for the handful of overlaps a day can hold.
   */
  const laneEnds: number[] = [];
  const lane = starts.map((start, i) => {
    const free = laneEnds.findIndex((endsAt) => endsAt <= start);
    const at = free === -1 ? laneEnds.length : free;
    laneEnds[at] = ends[i]!;
    return at;
  });
  const lanes = Math.max(1, laneEnds.length);

  const blocks = list
    .map((x, i) => {
      const top = ((starts[i]! - from) / span) * 100;
      const height = ((ends[i]! - starts[i]!) / span) * 100;
      const width = 100 / lanes;
      const left = lane[i]! * width;
      const c = x.withClient ? clientById(x.withClient.toLowerCase()) : null;
      const heavy = x.kind === "meeting" || x.kind === "call";

      return `
        <button class="blk${heavy ? " hv" : ""}${x.booking === "tentative" ? " tent" : ""}"
          style="top:${top}%;height:${Math.max(height, 4)}%;left:${left}%;width:calc(${width}% - 3px)"
          ${c ? `data-act="open-client" data-client="${c.key}"` : `data-act="noop"`}
          aria-label="${e(x.title)} at ${e(hhmmOf(starts[i]!))}">
          <span class="bt">${e(hhmmOf(starts[i]!))}</span>
          <span class="bn">${e(SLOT_GLYPH[x.kind] ?? "◍")} ${e(x.title)}</span>
          ${x.where ? `<span class="bw">${e(x.where)}</span>` : ""}
        </button>`;
    })
    .join("");

  return `<div class="track">${hours.join("")}<div class="blocks">${blocks}</div></div>`;
}

/* ── the calendar page: one main view, the other summoned ──────────
   Week and month never share the row. Whichever the advisor made main takes
   the page; the other slides over it on demand and gets out. Clicking any
   day — a week column head or a month cell — becomes the single-day page.
   To the right, the confirm rail: every meeting ChadBuddy created from a
   thread, and every meeting that arrived from Google sync unrated, queues
   there until a person has decided what it is. Nothing reaches the heatmap
   unrated without having been asked about once. */

const DAY_MS = 86_400_000;

/**
 * "Prepare a day before", made mechanical.
 *
 * Rating a meeting key is the advisor saying this one deserves preparation —
 * so the preparation appears as a dated task the day before, with the meeting
 * itself as the hard deadline underneath. One per meeting, ref-deduped; done
 * or dragged, it is theirs from then on.
 */
function prepTaskFor(eventId: string): void {
  const ev = findCalEvent(eventId);
  if (!ev || !BIG.has(ev.kind)) return;
  const start = Date.parse(ev.at);
  if (start <= nowMs()) return;
  const dayBefore = Math.max(startOfDay(nowMs()), startOfDay(start) - 86_400_000);
  void taskCreate({
    title: `Prep — ${ev.title}`,
    dueMs: dayBefore + 12 * 3_600_000,
    hardMs: start,
    ...(ev.withClient ? { clientKey: ev.withClient } : {}),
    ref: `prep:${ev.id}`,
    source: "chadbuddy",
  }).then(() => render());
}

function findCalEvent(id: string): CalendarEvent | undefined {
  return (
    calendarWeek().find((x) => x.id === id) ??
    calendarMonth().find((x) => x.id === id) ??
    calendarDay().find((x) => x.id === id)
  );
}

const dayTitleFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kuala_Lumpur",
});
const shortDayFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur",
});
const railWhenFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  hour12: false, timeZone: "Asia/Kuala_Lumpur",
});

/**
 * A task, wherever the calendar draws one.
 *
 * The chip is the drag handle; the circle is the done toggle. Urgency is the
 * chip's own colour — closer to the deadline, darker gold; overdue wears the
 * alarm red nothing else on the calendar is allowed to. Day fills keep
 * meaning importance: two signals, two surfaces, no fight.
 */
function taskChip(t: Task): string {
  const late = t.hardMs !== undefined && startOfDay(t.dueMs) > startOfDay(t.hardMs);
  return `
    <div class="tchip urg-${urgencyOf(t)}${t.done ? " tdone" : ""}" draggable="true"
      data-task="${e(t.id)}"
      title="${e(t.title)}${late ? " — planned AFTER the hard deadline" : ""}">
      <button class="tk" data-act="task-done" data-task="${e(t.id)}"
        aria-label="${t.done ? "Reopen" : "Mark done"}">${t.done ? "✓" : "○"}</button>
      <span class="tt">${e(t.title)}</span>
      ${late ? `<span class="tlate" title="Past the hard deadline underneath">!</span>` : ""}
    </div>`;
}

/**
 * The today contract — the reason the table exists.
 *
 * What is due today is finite and countable: finish it and you are genuinely
 * free, not "free until you remember something". Thirty things can be in
 * flight; only these are load.
 */
function todayContract(): string {
  const today = startOfDay(nowMs());
  const meets = [...calendarWeek(), ...calendarDay()]
    .filter(
      (ev, i, arr) =>
        arr.findIndex((x) => x.id === ev.id) === i &&
        BIG.has(ev.kind) &&
        ev.booking !== "cancelled" &&
        startOfDay(Date.parse(ev.at)) === today,
    );
  const due = tasksOn(today);
  const open = due.filter((t) => !t.done).length;
  const doneN = due.length - open;
  const overdue = tasks().filter((t) => !t.done && startOfDay(t.dueMs) < today).length;

  const parts = [
    `${meets.length} meeting${meets.length === 1 ? "" : "s"}`,
    `${open} task${open === 1 ? "" : "s"} due`,
    ...(doneN > 0 ? [`${doneN} done`] : []),
    ...(overdue > 0 ? [`<b class="odue">${overdue} overdue</b>`] : []),
  ];

  return `
    <div class="contract${open === 0 && overdue === 0 ? " clear" : ""}">
      <span class="clabel">today</span>
      <span class="cbody">${parts.join(" · ")}</span>
      <span class="cnote">${
        open === 0 && overdue === 0
          ? "clear — finish the meetings and nothing slips today"
          : "finish these and you are genuinely free"
      }</span>
    </div>`;
}

function weekTitle(anchor: number): string {
  return `${shortDayFmt.format(anchor)} – ${shortDayFmt.format(anchor + 6 * DAY_MS)}`;
}

/**
 * The week: Mon–Sun in a line, hours down the side, blocks to real time.
 *
 * One shared hour window across all seven days, fitted to the events rather
 * than assumed — a 07:00 flight and a 20:00 call must both be inside it, and
 * a fixed 9-to-6 would clip them silently.
 */
function weekGrid(anchor: number): string {
  const events = calendarWeek();
  const today = startOfDay(nowMs());

  let from = 8 * 60;
  let to = 18 * 60;
  for (const ev of events) {
    const start = Date.parse(ev.at);
    const m0 = Math.round((start - startOfDay(start)) / 60_000);
    from = Math.min(from, Math.floor(m0 / 60) * 60);
    to = Math.max(to, Math.ceil((m0 + ev.minutes) / 60) * 60);
  }
  const span = to - from;

  const hours: string[] = [];
  for (let h = from; h <= to; h += 60) {
    hours.push(`<span class="whr" style="top:${(((h - from) / span) * 100).toFixed(2)}%">${String(Math.floor(h / 60)).padStart(2, "0")}</span>`);
  }

  const cols = Array.from({ length: 7 }, (_, i) => {
    // Malaysia has no DST, so day arithmetic in plain milliseconds is exact.
    const day = anchor + i * DAY_MS;
    const list = events
      .filter((x) => startOfDay(Date.parse(x.at)) === day)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    /* Same greedy lanes as the day view: first lane whose last block ended. */
    const starts = list.map((x) => Date.parse(x.at));
    const ends = list.map((x, j) => starts[j]! + x.minutes * 60_000);
    const laneEnds: number[] = [];
    const lane = starts.map((start, j) => {
      const free = laneEnds.findIndex((endsAt) => endsAt <= start);
      const at = free === -1 ? laneEnds.length : free;
      laneEnds[at] = ends[j]!;
      return at;
    });
    const lanes = Math.max(1, laneEnds.length);

    const blocks = list
      .map((x, j) => {
        const m0 = Math.round((starts[j]! - day) / 60_000);
        const top = ((m0 - from) / span) * 100;
        const height = Math.max((x.minutes / span) * 100, 3.4);
        const width = 100 / lanes;
        const big = BIG.has(x.kind);
        const impClass = !big ? " own" : x.importance ? ` imp-${x.importance[0]}` : " imp-u";

        /* The dot is the weekly adjust control: tap to cycle the rating in
           place. Everything else on the block opens the day. */
        const dot = big
          ? `<button class="impdot" data-act="cal-rate" data-ev="${e(x.id)}"
               title="${x.importance ?? "unrated"} — tap to change">${x.importance ? "●" : "?"}</button>`
          : "";

        return `
          <div class="wblk${impClass}${x.booking === "tentative" ? " tent" : ""}"
            data-act="cal-day" data-day="${day}"
            style="top:${top.toFixed(2)}%;height:${height.toFixed(2)}%;left:${(lane[j]! * width).toFixed(2)}%;width:calc(${width.toFixed(2)}% - 2px)">
            ${dot}
            <span class="bt">${e(hhmmOf(starts[j]!))}</span>
            <span class="bn">${e(x.title)}</span>
          </div>`;
      })
      .join("");

    const dayTasks = tasksOn(day);
    return `
      <div class="wcol${day === today ? " today" : ""}" data-drop-day="${day}">
        <button class="whead" data-act="cal-day" data-day="${day}">
          <span class="wd">${DOW[i]}</span><span class="wn">${new Date(day).getDate()}</span>
          ${dayTasks.filter((t) => !t.done).length ? `<span class="wtc">${dayTasks.filter((t) => !t.done).length}</span>` : ""}
        </button>
        <div class="wtasks">${dayTasks.map(taskChip).join("")}</div>
        <div class="wtrack">${blocks}</div>
      </div>`;
  }).join("");

  return `
    <div class="wgrid">
      <div class="wrail">${hours.join("")}</div>
      ${cols}
    </div>`;
}

function weekMain(): string {
  const anchor = state.wk ?? mondayOf(nowMs());
  return `
    <div class="mnav">
      <span class="hero-h d" style="font-size:19px">${e(weekTitle(anchor))}</span>
      <button class="ico" data-act="wk-step" data-by="-1" aria-label="Previous week">‹</button>
      <button class="btn" data-act="wk-step" data-by="0">Today</button>
      <button class="ico" data-act="wk-step" data-by="1" aria-label="Next week">›</button>
      <button class="btn" data-act="cal-over" style="margin-left:auto">Month ⌗</button>
    </div>
    ${todayContract()}
    ${weekGrid(anchor)}
    ${IMP_LEGEND}`;
}

function monthMain(): string {
  const anchor = state.month ?? nowMs();
  const events = calendarMonth();
  return `
    <div class="mnav">
      <span class="hero-h d" style="font-size:19px">${e(monthFmt.format(anchor))}</span>
      <button class="ico" data-act="month-step" data-by="-1" aria-label="Previous month">‹</button>
      <button class="btn" data-act="month-step" data-by="0">Today</button>
      <button class="ico" data-act="month-step" data-by="1" aria-label="Next month">›</button>
      <button class="btn" data-act="cal-over" style="margin-left:auto">Week ☰</button>
    </div>
    ${monthGrid(anchor, events)}
    ${IMP_LEGEND}`;
}

/**
 * The other view, summoned over the main one.
 *
 * Escape stays sacred — one press still exits the dashboard, a rule fought
 * for and kept. The overlay closes on the backdrop or the ✕ instead.
 */
function calOverlay(): string {
  const other = state.calView === "month" ? "week" : "month";
  const inner =
    other === "month"
      ? `<div class="mnav">
          <span class="hero-h d" style="font-size:17px">${e(monthFmt.format(state.month ?? nowMs()))}</span>
          <button class="ico" data-act="month-step" data-by="-1">‹</button>
          <button class="btn" data-act="month-step" data-by="0">Today</button>
          <button class="ico" data-act="month-step" data-by="1">›</button>
          <button class="btn" data-act="cal-view" data-view="month">Make main</button>
          <button class="ico" data-act="cal-over" style="margin-left:auto" aria-label="Close">✕</button>
        </div>
        ${monthGrid(state.month ?? nowMs(), calendarMonth())}`
      : `<div class="mnav">
          <span class="hero-h d" style="font-size:17px">${e(weekTitle(state.wk ?? mondayOf(nowMs())))}</span>
          <button class="ico" data-act="wk-step" data-by="-1">‹</button>
          <button class="btn" data-act="wk-step" data-by="0">Today</button>
          <button class="ico" data-act="wk-step" data-by="1">›</button>
          <button class="btn" data-act="cal-view" data-view="week">Make main</button>
          <button class="ico" data-act="cal-over" style="margin-left:auto" aria-label="Close">✕</button>
        </div>
        ${weekGrid(state.wk ?? mondayOf(nowMs()))}`;

  return `
    <div class="calover">
      <div class="covback" data-act="cal-over"></div>
      <div class="covpanel">${inner}</div>
    </div>`;
}

/* ── the confirm rail ─────────────────────────────────────────────── */

/** What still needs a person: tentative bookings, and unrated meetings. */
function pendingEvents(): CalendarEvent[] {
  const seen = new Map<string, CalendarEvent>();
  for (const ev of [...calendarWeek(), ...calendarMonth(), ...calendarDay()]) seen.set(ev.id, ev);
  const now = nowMs();
  return [...seen.values()]
    .filter((ev) => BIG.has(ev.kind))
    .filter(
      (ev) =>
        ev.booking === "tentative" ||
        (ev.importance === undefined && Date.parse(ev.at) + ev.minutes * 60_000 > now),
    )
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const RAIL_CAP = 4;

/**
 * One card per decision. Two sources, one queue: a block ChadBuddy read out
 * of a thread (tentative, cited), and a meeting that arrived from Google sync
 * without a rating — booked on the phone, added by hand, either way nobody
 * has said how much it matters yet.
 *
 * The prep field lives here because the confirm moment is when the advisor
 * knows why the meeting exists. A note typed later is a chore; the same note
 * typed now is just finishing the thought.
 */
function railCard(ev: CalendarEvent): string {
  const tent = ev.booking === "tentative";
  const who = ev.withClient ? clientById(ev.withClient.toLowerCase()).name : ev.withName;
  const ai = ev.prepAi ?? [];

  return `
    <div class="ccard${tent ? " tent" : ""}">
      <span class="lbl" style="color:${tent ? "var(--iris)" : "var(--t3)"}">${tent ? "pencilled in — confirm it" : "new — rate it"}</span>
      <span class="ct">${e(ev.title)}</span>
      <span class="cw">${e(railWhenFmt.format(Date.parse(ev.at)))} · ${ev.minutes} min${who ? ` · ${e(who)}` : ""}</span>
      ${
        tent && ev.inferredFrom && ev.withClient
          ? `<div class="citerow">${citeChips([ev.inferredFrom.cite], ev.withClient)}</div>`
          : ""
      }
      ${impSeg(ev.id, ev.importance, suggestImportance(ev))}
      ${
        ev.importance === undefined
          ? `<span class="sughint">suggested from their book — tap to change</span>`
          : ""
      }
      ${railPrep(ev, ai)}
      <textarea class="prepin" id="prep-${e(ev.id)}" rows="2"
        placeholder="Your prep note — what to have ready">${e(ev.prepUser ?? "")}</textarea>
      <div class="ctxacts">
        ${
          tent
            ? `<button class="btn acc" data-act="rail-confirm" data-ev="${e(ev.id)}">Confirm</button>
               <button class="btn" data-act="rail-drop" data-ev="${e(ev.id)}">Remove</button>`
            : `<button class="btn acc" data-act="rail-save" data-ev="${e(ev.id)}">Save</button>`
        }
      </div>
    </div>`;
}

/**
 * The prep bullets on a rail card: the model's, when live — it reads the
 * client's actual recent messages server-side — with whatever the event
 * already carried as the instant fallback.
 */
function railPrep(ev: CalendarEvent, carried: string[]): string {
  let lines = carried;
  let label = "chadbuddy suggests";
  const req = {
    kind: "prep",
    facts: `Meeting: ${ev.title}, ${new Date(Date.parse(ev.at)).toString().slice(0, 21)}, ${ev.minutes} minutes.`,
    ask: "2-3 prep bullets for this meeting, one short line each, grounded in what the client has actually said recently.",
    ...(ev.withClient ? { key: ev.withClient } : {}),
  };
  const aiRes = aiText(`prep:${ev.id}`, req);
  if (aiRes.status === "ready" && aiRes.text) {
    lines = aiRes.text.split("\n").map((x) => x.replace(/^[-•▢\s]+/, "").trim()).filter(Boolean).slice(0, 3);
    label = "chadbuddy suggests · from their messages";
  } else if (aiRes.status === "pending" && lines.length === 0) {
    return `<div class="aiprep"><span class="lbl" style="color:var(--iris)">chadbuddy is reading the thread…</span></div>`;
  }
  if (lines.length === 0) return "";
  return `<div class="aiprep"><span class="lbl" style="color:var(--iris)">${e(label)}</span>
    ${lines.map((p) => `<span class="prep">▢ ${e(p)}</span>`).join("")}</div>`;
}

function calRail(): string {
  const pending = pendingEvents();
  if (pending.length === 0) return "";
  const more = pending.length - RAIL_CAP;
  return `
    <div class="crail sc">
      <span class="lbl">needs deciding · ${pending.length}</span>
      ${pending.slice(0, RAIL_CAP).map(railCard).join("")}
      ${more > 0 ? `<span class="dmore">+${more} more, oldest first</span>` : ""}
    </div>`;
}

/* ── the single-day page ──────────────────────────────────────────── */

function dayPage(dayMs: number): string {
  const events = (() => {
    const seen = new Map<string, CalendarEvent>();
    for (const ev of [...calendarMonth(), ...calendarWeek(), ...calendarDay()]) seen.set(ev.id, ev);
    return [...seen.values()];
  })();
  const list = events
    .filter((x) => startOfDay(Date.parse(x.at)) === startOfDay(dayMs))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const slots = list
    .filter((x) => BIG.has(x.kind))
    .map((x) => {
      const tent = x.booking === "tentative";
      const ai = x.prepAi ?? [];
      return `
        <div class="dslot${tent ? " tent" : ""}">
          <div class="dsl">
            <span class="kind">${e(SLOT_GLYPH[x.kind] ?? "◍")} ${e(x.kind)}</span>
            <span class="dst">${e(x.title)}</span>
            <span class="dsw">${e(hhmmOf(Date.parse(x.at)))} · ${x.minutes} min${x.where ? ` · ${e(x.where)}` : ""}</span>
          </div>
          ${impSeg(x.id, x.importance)}
          ${
            ai.length
              ? `<div class="aiprep"><span class="lbl" style="color:var(--iris)">chadbuddy suggests</span>
                  ${ai.map((p) => `<span class="prep">▢ ${e(p)}</span>`).join("")}</div>`
              : ""
          }
          <textarea class="prepin" id="prep-${e(x.id)}" rows="2"
            placeholder="Your prep note">${e(x.prepUser ?? "")}</textarea>
          <div class="ctxacts">
            ${
              tent
                ? `<button class="btn acc" data-act="rail-confirm" data-ev="${e(x.id)}">Confirm</button>
                   <button class="btn" data-act="rail-drop" data-ev="${e(x.id)}">Remove</button>`
                : `<button class="btn" data-act="rail-save" data-ev="${e(x.id)}">Save note</button>`
            }
            ${x.withClient ? `<button class="btn" data-act="open-client" data-client="${x.withClient}">Open ${e(clientById(x.withClient.toLowerCase()).name.split(" ")[0]!)}</button>` : ""}
          </div>
        </div>`;
    })
    .join("");

  return `
    <div class="page fixed">
      <div class="qhead" style="flex-direction:row;align-items:baseline;gap:14px">
        <button class="btn" data-act="cal-back">‹ ${state.calView === "month" ? "Month" : "Week"}</button>
        <span class="hero-h d">${e(dayTitleFmt.format(dayMs))}</span>
      </div>
      <div class="daycols2">
        <div class="dayside sc">${dayBlocks(dayMs, events)}</div>
        <div class="dayslots sc">
          ${dayPlan(dayMs)}
          ${slots || `<div class="empty"><span class="hero-h d" style="font-size:19px">No meetings</span><span class="mt">Own time only. Worth protecting.</span></div>`}
        </div>
      </div>
    </div>`;
}

/**
 * The day's dated work, checkable and extendable in place.
 *
 * The quick-add asks for exactly two things — what, and by when — because a
 * task here is only legal with a date. Anything undated belongs on the desk,
 * and the desk already has it.
 */
function dayPlan(dayMs: number): string {
  const list = tasksOn(dayMs);
  const iso = new Date(startOfDay(dayMs) + 12 * 3_600_000).toISOString().slice(0, 10);
  return `
    <div class="dtasks" data-drop-day="${startOfDay(dayMs)}">
      <span class="lbl">the plan — finish these and the day is clear</span>
      ${list.map((t) => `
        <div class="trow${t.done ? " tdone" : ""}">
          ${taskChip(t)}
          ${t.hardMs !== undefined ? `<span class="thard">hard: ${e(shortDayFmt.format(t.hardMs))}</span>` : ""}
          ${t.clientKey ? `<button class="btn sm" data-act="open-client" data-client="${t.clientKey}">${e(clientById(t.clientKey.toLowerCase()).name.split(" ")[0]!)}</button>` : ""}
          <button class="trm" data-act="task-remove" data-task="${e(t.id)}" title="Remove">✕</button>
        </div>`).join("")}
      <div class="taddrow">
        <input class="tadd" id="taskbox" type="text" placeholder="Add dated work — what must be done…">
        <input class="tdate" id="taskdate" type="date" value="${iso}">
        <button class="btn acc sm" data-act="task-add">Add</button>
      </div>
    </div>`;
}

function calendarPage(): string {
  if (state.calDay !== null) return dayPage(state.calDay);

  const rail = calRail();
  return `
    <div class="page fixed">
      <div class="calwrap${rail ? " withrail" : ""}">
        <div class="calmain">${state.calView === "month" ? monthMain() : weekMain()}</div>
        ${rail}
      </div>
      ${state.calOverlay ? calOverlay() : ""}
    </div>`;
}

/* ── the book, by stage ──────────────────────────────────────────
   What used to sit here was a week grid with two hand-written events on it —
   the only block on the dashboard that showed something no message supported,
   on the screen whose whole claim is the opposite. The day tab already owns
   time, and owns it better as a list, so the slot went to the question the
   advisor cannot answer by scrolling: where is my book. */


/**
 * The stage strip.
 *
 * Drawn with even weights rather than as a taper, and that is a deliberate
 * departure from the funnel it is modelled on. A funnel narrows because the far
 * end is the residue of the first — five percent of what went in. Here the far
 * end is the most valuable cohort on the book: a client with a maturity date is
 * a renewal with a deadline attached. Tapering would shrink the segment the
 * advisor most needs to see, in proportion to how well the business is doing.
 *
 * Counts, not names. At four clients names would fit; at the several hundred an
 * advisor actually carries they would not, and a component that stops working
 * once the demo data is replaced is not built, it is staged. The names live one
 * click away, which is where they belong.
 */
function stageFunnel(): string {
  /* One tile, one sentence: here is the book, and this much of it is ending
     soon. Everything else was moved out.

     The first version put a 30px figure, a wrapped caption, a rule and three
     client rows underneath the chart, in a cell that could not hold them.
     The labels collided with the rows, the halo rings escaped the tile, and
     the one thing it was for — the shape of the book at a glance — was the
     hardest part to see. The maturity list is one click away under the
     `maturing` segment, which is where someone looking for it would go. */
  const soon =
    bookTotals.maturingSoon === 0
      ? "nothing maturing"
      : `${bookTotals.maturingSoon} maturing · nearest in ${bookTotals.nextMaturityDays}d`;

  return `
    <div class="book">
      <div class="tile-h">
        <span class="t">The book</span>
        <span class="soon">${e(soon)}</span>
      </div>
      <div class="strip" id="funnel-slot"></div>
    </div>`;
}

/**
 * What is waiting, and how much of it never needed you.
 *
 * This replaced the rules accordion, which was four lines of static policy text
 * that never changed and never told anyone to do anything.
 *
 * ── the headline is the ratio, not the count ─────────────────────────
 * Every inbox can tell you eight things are waiting. The number that argues for
 * the product is the second one: seventeen arrived and nine were dealt with
 * without you. Leading with "8" alone would make the assistant look like a
 * source of work rather than a filter on it.
 *
 * ── ordered by what it costs to ignore ───────────────────────────────
 * By age, oldest first, because a 104-day promise does not become less urgent
 * for sitting under a fresh draft. The approval rows carry no timestamp — they
 * are authored — so they sort last rather than being given an age they do not
 * have.
 *
 * ── the cell is 250px ────────────────────────────────────────────────
 * Too narrow to carry the evidence inline, so each row shows the count and the
 * single worst instance, and the click opens the client where the citations
 * already live. A summary that tries to be the detail ends up being neither.
 */
function needsYouTile(): string {
  const kinds: TaskKind[] = ["call-back", "follow-up", "answer", "approve"];

  const rows = kinds
    .map((kind) => {
      const of = tasksOfKind(kind);
      if (of.length === 0) return "";

      // Worst first, and the list is already sorted, so this is the head.
      const worst = of[0]!;
      const c = clientById(worst.client.toLowerCase());
      const age = worst.days > 0 ? `${worst.days} days` : "ready";

      return `
        <button class="nrow" data-act="open-client" data-client="${e(worst.client)}"
          aria-label="${of.length} to ${e(TASK_LABEL[kind])}. Oldest: ${e(c.name)}, ${e(age)}.">
          <span class="g" data-kind="${e(kind)}">${e(TASK_GLYPH[kind])}</span>
          <span class="col">
            <span class="k">${e(TASK_LABEL[kind])}</span>
            <span class="m">${e(c.name.split(" ")[0]!)} · ${e(age)}</span>
          </span>
          <span class="n">${of.length}</span>
        </button>`;
    })
    .join("");

  return `
    <div class="needs">
      <div class="nhead">
        <span class="lbl">needs you</span>
        <span class="fig">${inboxTotals.needsYou}</span>
      </div>
      <span class="sub">of ${inboxTotals.arrived} that arrived today</span>

      <div class="nlist">${rows || `<p class="nempty">Nothing waiting. Everything that came in was answered.</p>`}</div>

      <button class="done" data-act="page" data-page="assist"
        aria-label="${inboxTotals.handled} answered automatically. Review them.">
        <span class="g">✓</span>
        <span class="col">
          <span class="k">${inboxTotals.handled} sent · ${inboxTotals.held + inboxTotals.refused} stopped</span>
          <span class="m">see what the gates decided</span>
        </span>
      </button>
    </div>`;
}

/**
 * The decision log.
 *
 * Every message the assistant considered, what it did, and which rule made it
 * do that. With no outbox and no recall, this is the only recourse after the
 * fact — so it records the gates by name rather than a verdict, and it records
 * the ones that fired on messages that still went out.
 *
 * The refusals are the part worth reading. A T4 is not the assistant failing to
 * produce something; it is the assistant declining to write a message that
 * would have cost more than silence, and handing over a question instead.
 */
function assistPage(): string {
  const rows = decisions
    .map((a) => {
      const c = clientById(a.reply.client.toLowerCase());
      const d = a.decision;

      const gates = d.gates.length
        ? `<div class="gates">${d.gates
            .map((g) => `<span class="gate" title="${e(GATE_REASON[g])}">${e(g)}</span>`)
            .join("")}</div>`
        : "";

      const prompt = a.prompt
        ? `<div class="ask">
             <span class="lbl">ask her instead</span>
             <span class="tx">${e(a.prompt.text)}</span>
             <span class="from">from her meeting notes · ${e(a.prompt.cite)}</span>
           </div>`
        : "";

      return `
        <div class="drow" data-outcome="${e(d.outcome)}">
          <div class="dhd">
            <span class="tier" data-tier="${e(d.tier)}">${e(d.tier)}</span>
            <button class="who" data-act="open-client" data-client="${e(a.reply.client)}">${e(c.name)}</button>
            <span class="act">${e(TIER_ACTION[d.tier])}</span>
            <span class="when">${e(stamp.format(Date.parse(a.reply.at)))}</span>
          </div>
          <span class="q">“${e(a.reply.asked)}”</span>
          <span class="rz">${e(d.reason)}</span>
          ${gates}
          ${d.outcome === "refused" ? "" : `<p class="body">${e(a.reply.sent)}</p>`}
          ${a.reply.source ? `<span class="src">source · ${e(a.reply.source.ref)}</span>` : ""}
          ${prompt}
        </div>`;
    })
    .join("");

  return `
    <div class="page fixed">
      <div class="qhead">
        <span class="hero-h d">What the assistant decided</span>
        <span class="mt">${inboxTotals.handled} sent · ${inboxTotals.held} held for you ·
          ${inboxTotals.refused} it would not write. Nine gates run before anything goes out, and
          any one of them forces a person. Every decision below records which fired — with no
          recall on a sent message, the log is the only recourse there is.</span>
      </div>
      <div class="dlist sc" id="dlist">${rows}</div>
    </div>`;
}

function overviewPage(): string {

  const bars = weekBars.days
    .map(
      (d) => `
      <div class="col" title="${e(d.label)}: ${d.count} client message${d.count === 1 ? "" : "s"}">
        ${d.isPeak ? `<span class="tip">${d.count} on ${e(d.label)}</span>` : ""}
        <i style="height:${Math.max(2, d.height)}%;background:${d.isPeak ? "var(--butter)" : "color-mix(in oklab, var(--foreground) 24%, transparent)"}"></i>
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
    { label: "dismiss", n: pending.filter((a) => a.glyph === "☏").length, fill: "color-mix(in oklab, var(--foreground) 14%, transparent)" },
  ].filter((k) => k.n > 0);
  const kindTotal = kinds.reduce((n, k) => n + k.n, 0) || 1;
  const split = kinds
    .map(
      (k) => `
      <div class="seg" style="flex:${k.n}">
        <span class="pc">${Math.round((k.n / kindTotal) * 100)}%</span>
        <i style="background:${k.fill}${k.fill === "var(--chip-dark)" ? ";box-shadow:inset 0 0 0 1px color-mix(in oklab, var(--foreground) 10%, transparent)" : ""}"></i>
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
        <span class="tick" style="background:${a.done ? "var(--butter)" : "transparent"};box-shadow:inset 0 0 0 1px ${a.done ? "var(--butter)" : "color-mix(in oklab, var(--foreground) 20%, transparent)"}">${a.done ? "✓" : ""}</span>
      </button>`,
    )
    .join("");


  return `
    <div class="page">
      <div class="ovfill">
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
              <span class="pill" style="box-shadow:inset 0 0 0 1px color-mix(in oklab, var(--destructive) 40%, transparent);background:transparent;color:var(--i-crit)">${blocked}</span>
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
        ${upNextTile()}

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
              <!-- The swept arc is a severity reading, not an affordance, so it
                   takes the MARK ramp rather than the accent — on the light
                   ramp the accent is near-black and the dial went to a blob. -->
              <div class="ring" style="background:conic-gradient(var(--m-warn) 0deg ${replyClock.degrees}deg, color-mix(in oklab, var(--foreground) 8%, transparent) ${replyClock.degrees}deg 360deg)">
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
            <span class="m" style="font-size:9.5px;color:var(--t4)">accent = send · dark = unblock · grey = dismiss</span>
          </div>
          <div class="tile deep" style="flex:1;min-height:0;gap:12px">
            <div style="display:flex;align-items:baseline;gap:10px">
              <span class="t sm" style="font-size:15px;font-weight:500">Approval queue</span>
              <span class="m" style="margin-left:auto;font-size:13px;color:var(--t3)">${approvals.length - pending.length}/${approvals.length}</span>
            </div>
            <div class="queue sc">${queueRows}</div>
          </div>
        </div>

        ${needsYouTile()}

        ${stageFunnel()}
        </div>
      </div>
      </div>

      ${deskSection()}
    </div>`;
}

/* ── the desk ────────────────────────────────────────────────────────
   ChadBuddy's own section, scrolled to below the dashboard grid. Three
   ranked queues — maturing, market, stale — derived in src/desk.ts. This
   file only draws them; the shapes arrive capped, so nothing here can
   accidentally render one row per client when the book grows. */

/** Twelve months in 120px. Shape, not axes — the numbers sit beside it. */
function sparkline(r: Report): string {
  const pts = r.spark.map((v, i) => `${(i * (120 / 11)).toFixed(1)},${(26 - 22 * v).toFixed(1)}`);
  const last = pts[pts.length - 1]!.split(",");
  return `
    <svg class="spark" viewBox="0 0 120 30" aria-hidden="true">
      <polyline points="${pts.join(" ")}" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="2" fill="currentColor"/>
    </svg>`;
}

/**
 * The draft, its provenance label, and what can be done with it.
 *
 * With a brief request attached and live mode on, the model writes the prose
 * — digit-guarded server-side, cached forever after one call — and the label
 * says so. While it writes, the template shows with a label admitting it is
 * one. In seed mode the template is all there is, also said plainly.
 */
function deskDraft(id: string, draft: string, req?: { kind: string; facts: string; ask: string; key?: string }): string {
  let text = draft;
  let label = "template — check before sending";
  if (req) {
    const ai = aiText(`draft:${id}`, req);
    if (ai.status === "ready" && ai.text) {
      text = ai.text;
      label = "drafted by chadbuddy · model, figures table-checked";
    } else if (ai.status === "pending") {
      label = "template — chadbuddy is rewriting…";
    } else if (ai.status === "failed") {
      label = "template — the model's draft was refused";
    }
  }
  return `
    <div class="ddraft">
      <span class="lbl" style="color:var(--iris)">${e(label)}</span>
      <p class="dtext">${e(text)}</p>
      <div class="ctxacts">
        <button class="btn" disabled title="Sending connects in phase 3">Send Telegram</button>
        <button class="btn" disabled title="Sending connects in phase 3">Send Email</button>
        <button class="btn" data-act="desk-snooze" data-brief="${e(id)}">Snooze 7d</button>
        <button class="btn" data-act="desk-dismiss" data-brief="${e(id)}">Dismiss</button>
      </div>
    </div>`;
}

function maturingRow(row: MaturingRow, urgent: boolean): string {
  const on = state.desk === row.id;
  const tone = urgent ? "var(--gold)" : "var(--t3)";
  return `
    <div class="drow${on ? " on" : ""}">
      <button class="dhead" data-act="desk-open" data-brief="${e(row.id)}" aria-expanded="${on}">
        <span class="dd" style="color:${tone}">${row.daysLeft}d</span>
        <span class="dwho">${e(row.clientName)}</span>
        <span class="dwhat">${e(row.holding.name)}</span>
        <span class="dval">${row.holding.value > 0 ? e(row.report.valueText) : "renewal"}</span>
        <span class="dcaret">${on ? "⌃" : "⌄"}</span>
      </button>
      ${
        on
          ? `<div class="dbody">
              ${
                row.holding.value > 0
                  ? `<div class="dfacts">
                      <span class="dspark" style="color:var(--foam)">${sparkline(row.report)}</span>
                      <span class="df"><i>matures</i>${e(row.matureText)}</span>
                      <span class="df"><i>stands at</i>${e(row.report.valueText)}</span>
                      <span class="df"><i>12 months</i>${row.report.yearPct >= 0 ? "+" : ""}${row.report.yearPct}%</span>
                      <span class="df"><i>since start</i>${e(row.report.gainText)}</span>
                    </div>`
                  : `<div class="dfacts"><span class="df"><i>renews</i>${e(row.matureText)}</span></div>`
              }
              ${deskDraft(row.id, row.draft, {
                kind: "maturity-draft",
                facts: `Client: ${row.clientName}. Product: ${row.holding.name}. Current value: ${row.report.valueText}. Change over 12 months: ${row.report.yearPct}%. ${row.report.gainText}. Matures: ${row.matureText}.`,
                ask: "Draft a short Telegram message: their plan matures soon; suggest 15 minutes on what the money does next.",
                key: row.client,
              })}
              <div class="ctxacts">
                <button class="btn acc" data-act="open-client" data-client="${row.client}">Open ${e(row.clientName.split(" ")[0]!)}</button>
                <button class="btn" data-act="task-plan"
                  data-title="Reach out to ${e(row.clientName.split(" ")[0]!)} — ${e(row.holding.name)} matures"
                  data-due="${startOfDay(nowMs() + (row.daysLeft - 1) * 86_400_000) + 12 * 3_600_000}"
                  data-hard="${startOfDay(nowMs() + row.daysLeft * 86_400_000)}"
                  data-client="${row.client}" data-ref="mature:${e(row.holding.id)}">Plan it → calendar</button>
              </div>
            </div>`
          : ""
      }
    </div>`;
}

function marketRow(row: MarketRow): string {
  const evId = `ev:${row.event.id}`;
  const on = state.desk === evId;
  const leanGlyph = row.event.lean === "pressure" ? "▼" : row.event.lean === "relief" ? "▲" : "●";
  const leanInk =
    row.event.lean === "pressure" ? "var(--alarm)" : row.event.lean === "relief" ? "var(--foam)" : "var(--t3)";
  return `
    <div class="drow${on ? " on" : ""}">
      <button class="dhead" data-act="desk-open" data-brief="${e(evId)}" aria-expanded="${on}">
        <span class="dd" style="color:${leanInk}">${leanGlyph}</span>
        <span class="dwhat wide">${e(row.event.headline)}</span>
        <span class="dval">${row.clientCount} client${row.clientCount === 1 ? "" : "s"} · ${e(row.exposureText)}</span>
        <span class="dcaret">${on ? "⌃" : "⌄"}</span>
      </button>
      ${
        on
          ? `<div class="dbody">
              <p class="dsum">${e(row.event.summary)}</p>
              <div class="dchiprow">
                <span class="dchip">${e(row.event.source.name)} · ${e(new URL(row.event.source.url).hostname)}</span>
                <span class="dchip dim">${e(row.agoText)}</span>
              </div>
              ${row.hits
                .map((hit) => {
                  const hitOn = state.deskHit === hit.id;
                  return `
                    <div class="dhit${hitOn ? " on" : ""}">
                      <button class="dhithead" data-act="desk-hit" data-brief="${e(hit.id)}">
                        <span class="dwho">${e(hit.clientName)}</span>
                        <span class="dwhat">${e(hit.holding.name)}</span>
                        <span class="dval">${e(hit.holding.value.toLocaleString("en-MY"))}</span>
                        <span class="dcaret">${hitOn ? "⌃" : "⌄"}</span>
                      </button>
                      ${hitOn ? deskDraft(hit.id, hit.draft, {
                        kind: "market-draft",
                        facts: `Client: ${hit.clientName}. Holding: ${hit.holding.name}, value ${hit.holding.value.toLocaleString("en-MY")} RM. News headline: ${row.event.headline}. What it means: ${row.event.impactNote}`,
                        ask: "A short reassurance note about this news for this holding. No action needed from them, no figures beyond the facts.",
                        key: hit.client,
                      }) : ""}
                    </div>`;
                })
                .join("")}
              ${row.hitsMore > 0 ? `<span class="dmore">+${row.hitsMore} more above the RM 25k floor</span>` : ""}
            </div>`
          : ""
      }
    </div>`;
}

function staleRow(row: StaleRow): string {
  const on = state.desk === row.id;
  return `
    <div class="drow${on ? " on" : ""}">
      <button class="dhead" data-act="desk-open" data-brief="${e(row.id)}" aria-expanded="${on}">
        <span class="dd" style="color:var(--t4)">${row.days}d</span>
        <span class="dwho">${e(row.clientName)}</span>
        <span class="dwhat">${e(row.holding.name)} — no product update since ${row.days} days ago</span>
        <span class="dcaret">${on ? "⌃" : "⌄"}</span>
      </button>
      ${
        on
          ? `<div class="dbody">
              <div class="dfacts">
                <span class="dspark" style="color:var(--foam)">${sparkline(row.report)}</span>
                <span class="df"><i>stands at</i>${e(row.report.valueText)}</span>
                <span class="df"><i>12 months</i>${row.report.yearPct >= 0 ? "+" : ""}${row.report.yearPct}%</span>
              </div>
              ${deskDraft(row.id, row.draft, {
                kind: "stale-draft",
                facts: `Client: ${row.clientName}. Holding: ${row.holding.name}, standing at ${row.report.valueText}, ${row.report.yearPct}% over 12 months. Days since last product update: ${row.days}.`,
                ask: "A warm quarterly check-in about this holding, offering 15 minutes this week.",
                key: row.client,
              })}
            </div>`
          : ""
      }
    </div>`;
}

/**
 * The section itself. Counts lead, rows follow, and the whole thing sits
 * below the existing dashboard grid so nothing above it moved an inch —
 * this is an experiment scrolled into, not a replacement.
 */
function deskSection(): string {
  const d = deskView();
  return `
    <div class="desk">
      <div class="deskhead">
        <span class="hero-h d" style="font-size:21px">ChadBuddy · desk</span>
        <span class="dstat">${d.needAction} need action ·
          ${d.maturingTotal} maturing within ${60} days ·
          ${d.marketClientTotal} client${d.marketClientTotal === 1 ? "" : "s"} touched by the market ·
          checked ${e(d.checkedText)}</span>
      </div>

      ${
        d.urgent.length || d.horizon.length
          ? `<div class="dsec">
              <span class="lbl">maturing soon</span>
              ${d.urgent.map((r) => maturingRow(r, true)).join("")}
              ${d.horizon.map((r) => maturingRow(r, false)).join("")}
              ${d.horizonMore > 0 ? `<span class="dmore">+${d.horizonMore} more within 60 days</span>` : ""}
            </div>`
          : ""
      }

      ${
        d.market.length
          ? `<div class="dsec">
              <span class="lbl">market watch</span>
              ${d.market.map(marketRow).join("")}
            </div>`
          : ""
      }

      ${
        d.stale.length
          ? `<div class="dsec">
              <span class="lbl">quiet holdings</span>
              ${d.stale.map(staleRow).join("")}
              ${d.staleMore > 0 ? `<span class="dmore">+${d.staleMore} more past ${90} days</span>` : ""}
            </div>`
          : ""
      }
    </div>`;
}

/* ── page: clients ───────────────────────────────────────────────── */

/**
 * How long since anyone said anything, and whether that counts as quiet.
 *
 * "Silent" is a scored judgement, not a stopwatch: score.ts decides it from a
 * client's own baseline, so a client who was always slow does not get called
 * silent for being slow again. The day count here is only the caption.
 */
/**
 * The pulse and the status chip beside it answer two different questions, and
 * keeping them apart is the point.
 *
 * The pulse is traffic: is anyone still typing? The chip is the scored verdict:
 * is the relationship holding? A silently churning client is normally *both* —
 * still messaging every week and no longer asking anything — so a pulse that
 * read "silent" would contradict the thread sitting right next to it. Traffic
 * is the only thing the pulse reports; the colour it reports it in comes from
 * the score, which is how the two stay legible as one reading.
 */
function pulseOf(c: ClientView): { live: boolean; word: string; rest: string; tone: Tone } {
  const days = Math.max(0, Math.round((NOW - c.lastContact) / 86_400_000));
  const live = days <= 14;
  return {
    live,
    word: live ? "active" : "dormant",
    rest: `last ${dateShort.format(c.lastContact)}`,
    tone: c.score.silent
      ? "butter"
      : c.score.status === "decaying"
        ? "critical"
        : c.score.status === "watch"
          ? "warn"
          : "good",
  };
}

function pulse(c: ClientView): string {
  const p = pulseOf(c);
  return `
    <span class="pulse" style="color:${inkOf(p.tone)}">
      <i class="${p.live ? "live" : ""}" style="background:${markOf(p.tone)}"></i>
      ${e(p.word)}
      <span class="rest">· ${e(p.rest)}</span>
    </span>`;
}

function clientTile(c: ClientView): string {
  const lat = c.score.signals.find((s) => s.name === "latency")!;
  const owed = c.open.length;

  return `
    <button class="pcard" data-act="open-client" data-client="${c.key}" aria-label="Open ${e(c.name)}">
      <span class="rail" style="background:${markOf(c.tone)}"></span>
      <span class="glow" aria-hidden="true" style="background:radial-gradient(closest-side, ${tint(markOf(c.tone), 12)}, transparent)"></span>

      <span class="top">
        <span class="ava s34" style="background:${tint(markOf(c.tone), 16)};box-shadow:inset 0 0 0 1px ${tint(markOf(c.tone), 35)};color:${inkOf(c.tone)}">${e(c.initials)}</span>
        <span class="who">
          <span class="nm">${e(c.name)}</span>
          <span class="sub">${e(c.handle)}</span>
        </span>
        <span class="chip" data-tone="${c.chipTone}">${e(c.statusWord)}</span>
      </span>

      ${pulse(c)}
      <span class="line">${e(c.headline)}</span>

      <span class="nums">
        <span class="n"><span class="v">${c.messageCount}</span><span class="lbl">messages</span></span>
        <span class="n"><span class="v">${e(lat.recent)}</span><span class="lbl">median reply</span></span>
        <span class="n"><span class="v" style="color:${owed ? inkOf(c.ledgerTone) : "var(--t1)"}">${owed}</span><span class="lbl">open items</span></span>
      </span>

      <span class="go">☏ Telegram · ${c.clientMessageCount} theirs <b>Open →</b></span>
    </button>`;
}

/**
 * The clients page, filtered by stage when one was clicked.
 *
 * The chips are duplicated from the dashboard strip on purpose. Arriving
 * here from the funnel needs a way to widen the filter without going back,
 * and arriving from the nav needs a way to narrow it without going to the
 * dashboard first — the same control answers both.
 */
function clientsGrid(): string {
  const shown = state.stage ? clients.filter((c) => stageOf(c.key) === state.stage) : clients;

  const chips = buckets
    .map((b) => {
      const on = state.stage === b.stage;
      return `
        <button class="schip${on ? " on" : ""}" data-act="stage" data-stage="${e(b.stage)}"
          title="${e(STAGE_NOTE[b.stage])}">${e(b.stage)} <b>${b.count}</b></button>`;
    })
    .join("");

  return `
    <div class="page">
      <div class="qhead">
        <span class="hero-h d">${state.stage ? e(state.stage) : "Clients"}</span>
        <span class="mt">${state.stage
          ? `${e(STAGE_NOTE[state.stage])}. ${shown.length} of ${clients.length} ${shown.length === 1 ? "client" : "clients"} — most recently active first. Clear the filter to see the whole book.`
          : `One card per thread, ordered so silent churn sits first — it is the case a human would never surface unaided. Open a card for the chat, what they are waiting on, and what to say next.`}</span>
      </div>
      <div class="schips">${chips}${state.stage ? `<button class="schip clear" data-act="stage-clear">clear</button>` : ""}</div>
      ${shown.length
        ? `<div class="cgrid">${shown.map(clientTile).join("")}</div>`
        : `<p class="empty">Nobody is at this stage. That is a measurement, not a gap — the strip keeps empty stages so the absence stays visible.</p>`}
    </div>`;
}

/* ── the ask-the-agent box ───────────────────────────────────────── */

/**
 * The agent reads this client's thread and answers out of it.
 *
 * There is no model behind this and the UI does not pretend there is: the
 * intents below map a question onto a derivation that already exists — the
 * score, the ledger, the turning point, the ranked ideas in copy.ts — and the
 * answer carries the message ids it was built from. An agent that cannot cite
 * is an agent that can be wrong quietly, which is the failure this product is
 * built to avoid.
 */
type AskIntent = "suggest" | "why" | "owed" | "history" | "help";

const ASK_PRESETS: Array<[string, AskIntent]> = [
  ["What should I say?", "suggest"],
  ["Why have they gone quiet?", "why"],
  ["What do I owe them?", "owed"],
  ["Summarise the thread", "history"],
];

function classify(q: string): AskIntent {
  const s = q.toLowerCase();
  const has = (...w: string[]): boolean => w.some((x) => s.includes(x));

  if (has("owe", "owed", "promise", "open item", "outstanding", "pending", "waiting on me")) return "owed";
  if (has("quiet", "silent", "why", "decay", "stopped", "ghost", "gone cold", "not repl")) return "why";
  if (has("summar", "history", "recap", "background", "context", "how long", "when did", "last spoke")) return "history";
  if (has("say", "talk", "message", "send", "write", "draft", "suggest", "topic", "next", "do", "reach out", "follow up")) {
    return "suggest";
  }
  return "help";
}

function answer(c: ClientView, intent: AskIntent): AskTurn {
  const lat = c.score.signals.find((s) => s.name === "latency")!;
  const q = c.score.signals.find((s) => s.name === "questions")!;
  const init = c.score.signals.find((s) => s.name === "initiation")!;
  const list = ideas[c.key] ?? [];
  const days = Math.max(0, Math.round((NOW - c.lastContact) / 86_400_000));

  switch (intent) {
    case "suggest":
      return {
        from: "agent",
        text: list.length
          ? `<b>${e(c.name.split(" ")[0]!)}</b> is ${e(c.statusWord)}. ${list.length} thing${list.length === 1 ? "" : "s"} worth opening with, ranked — the first is what I would send today.`
          : `Nothing to suggest for <b>${e(c.name)}</b>: the thread is current and nothing is owed either way.`,
        sug: list.map((_, n) => n),
      };

    /* Silence here means "stopped asking", not "stopped replying" — that
       distinction is the product's whole thesis, so the answer has to lead
       with it rather than quote a days-since-last-message count that would
       say the opposite. The quote already carries its own quotation marks. */
    case "why":
      return {
        from: "agent",
        text: c.score.silent
          ? `Not a complaint — a fade. Median reply is still <b>${e(lat.recent)}</b>, so they are answering. What stopped is the asking: <b>${e(q.recent)}</b> questions, and they start <b>${e(init.recent)}</b> of the conversations. The turning point reads: <em>${e(c.turn.quote)}</em>`
          : `${e(c.headline)} Median reply <b>${e(lat.recent)}</b>, questions <b>${e(q.recent)}</b>. Last exchange ${e(dateShort.format(c.lastContact))}, ${days} days ago.`,
        cites: c.turn.cite !== "—" ? [c.turn.cite] : [],
      };

    case "owed":
      return {
        from: "agent",
        text: c.open.length === 0
          ? `Nothing open. ${c.settledCount} item${c.settledCount === 1 ? "" : "s"} settled and verbatim-checked against the thread.`
          // ledgerLabel already reads "3 open · yours" — do not count it twice
          : `<b>${e(c.ledgerLabel)}</b>.<br>${c.open
              .map((x) => `· ${e(x.kind)} — ${e(x.text)} <em>(${openDays(x)} days, owed by ${e(x.owedBy)})</em>`)
              .join("<br>")}`,
        cites: c.open.map((x) => x.sourceMessageId),
      };

    case "history":
      return {
        from: "agent",
        text: `<b>${c.messageCount}</b> messages since ${e(dateShort.format(c.firstContact))}, ${c.clientMessageCount} of them theirs. Last contact ${e(dateShort.format(c.lastContact))} — ${days} days ago. Telegram, the phone log and meeting notes — nothing else was read.<br>${e(c.headline)}`,
      };

    default:
      return {
        from: "agent",
        text: `I only read <b>${e(c.name)}</b>'s thread — ${c.messageCount} messages, nothing else. Ask me what to say, why they have gone quiet, what is owed, or for a summary.`,
      };
  }
}

function askTurn(t: AskTurn, c: ClientView): string {
  const sug = (t.sug ?? [])
    .map((n) => {
      const i = ideas[c.key]?.[n];
      if (!i) return "";
      return `
        <div class="sug${i.primary ? " primary" : ""}">
          <div class="hd">
            <span class="rank">${e(i.rank)}</span>
            <span class="t">${e(i.title)}</span>
          </div>
          <span class="why">${e(i.why)}</span>
          <div class="draft">
            <span class="lb">${e(i.draftLabel)}${isEditing(c.key, i.rank) ? " · editing" : ""}</span>
            ${
              isEditing(c.key, i.rank)
                ? /* Styled inline rather than in index.html: that file is being
                     edited in parallel and a textarea is one element. Tokens,
                     not literals, so it tracks the palette either way. */
                  `<textarea class="tx edit" data-act="edit-draft" rows="4"
                     aria-label="Edit the draft before sending"
                     style="width:100%;resize:vertical;font:inherit;color:var(--t1);
                            background:color-mix(in oklab, var(--background) 55%, transparent);
                            border:1px solid color-mix(in oklab, var(--primary) 45%, transparent);
                            border-radius:.5rem;padding:.5rem .6rem;outline:none"
                   >${e(state.editText)}</textarea>`
                : `<span class="tx">${e(i.draft)}</span>`
            }
          </div>
          <div class="acts">
            <button class="btn${i.primary ? " acc" : ""}" data-act="send-idea"
              data-key="${e(c.key)}" data-rank="${e(i.rank)}"
              ${i.intent === "send" ? "" : "disabled"}
              title="${i.intent === "send" ? "Send this draft to the client as you" : "Not a send — this recommendation is to " + e(i.intent)}"
            >${e(i.btn)}</button>
            ${
              isEditing(c.key, i.rank)
                ? `<button class="btn ghost" data-act="edit-cancel">Revert</button>`
                : `<button class="btn ghost" data-act="edit-idea"
                     data-key="${e(c.key)}" data-rank="${e(i.rank)}">Edit</button>`
            }
            ${i.cites.length ? citeChips(i.cites, c.key) : ""}
          </div>
        </div>`;
    })
    .join("");

  const cites = (t.cites ?? []).length ? `<div class="citerow">${citeChips(t.cites!, c.key)}</div>` : "";

  return `
    <div class="at" data-from="${t.from}">
      <span class="b">${t.text}</span>
      ${sug}
      ${cites}
    </div>`;
}

function askBox(c: ClientView): string {
  const log = state.ask[c.key] ?? [];
  const opening: AskTurn = {
    from: "agent",
    text: `I have read all <b>${c.messageCount}</b> of ${e(c.name.split(" ")[0]!)}'s messages. Ask me what to say next — or pick one below.`,
  };

  return `
    <div class="ask">
      <div class="hd">
        <span class="t">Ask the agent</span>
        <span class="tag">reads this thread only</span>
      </div>
      <div class="log sc" id="asklog">
        ${[opening, ...log].map((t) => askTurn(t, c)).join("")}
      </div>
      <div class="chips">
        ${ASK_PRESETS.map(([label]) => `<button data-act="ask-preset" data-q="${e(label)}">${e(label)}</button>`).join("")}
      </div>
      <div class="composer">
        <input data-act="draft" type="text" value="${e(state.draft)}" placeholder="Ask about ${e(c.name.split(" ")[0]!)}…" aria-label="Ask the agent about ${e(c.name)}">
        <button class="send" data-act="ask" title="Ask" aria-label="Ask"${state.draft.trim() ? "" : " disabled"}>→</button>
      </div>
      <span class="note" title="Answers are derived from this thread and cite the messages they came from. Nothing is sent to ${e(c.name)} without your click.">Derived from this thread · cited · nothing sends without your click</span>
    </div>`;
}

/* ── one client, opened ──────────────────────────────────────────── */

/** Wrap the run of characters the search matched, so the hit is visible. */
function mark(text: string, q: string): string {
  if (!q) return e(text);
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return e(text);
  return `${e(text.slice(0, at))}<span class="hit">${e(text.slice(at, at + q.length))}</span>${e(text.slice(at + q.length))}`;
}

function searchKeeps(m: RecMessage): boolean {
  if (!keeps(m)) return false;
  const q = state.q.trim().toLowerCase();
  if (!q) return true;
  return m.text.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.time.toLowerCase().includes(q);
}

/**
 * What was actually said, and when.
 *
 * This replaces the activity heatmap that used to sit here. The heatmap showed
 * *that* there had been contact — thirty-five squares, darker where there were
 * more messages — which is a shape the four signals already measure, and
 * measure better. What no view showed was the thing an advisor with three
 * hundred clients genuinely cannot hold: what this particular person said about
 * their own life, in a meeting, four months ago.
 *
 * That is what personalised retention is made of. Michelle turned down the
 * Singapore role because of the travel, not the money; her brother lost money
 * on a Johor property in 2019 and she will not touch a five-year lock-in. Ask
 * her the wrong question and the relationship costs nothing to lose. Neither
 * sentence appears anywhere in her chat export.
 *
 * ── every note carries its moment ────────────────────────────────────
 * Date and time to the minute, and a relative age beside it. The timestamp is
 * not decoration: it is what lets someone find the passage again in a
 * recording, and what makes a note from June read differently from one from
 * last week.
 *
 * ── silence is shown, not hidden ─────────────────────────────────────
 * A meeting that produced no notes still appears, with the reason. "He declined
 * recording" is a fact about the relationship; "nobody asked" is a fact about
 * the advisor, and collapsing both into an empty list would conceal the second
 * — which is the one that can be fixed.
 */
function keyInfoTile(c: ClientView): string {
  /* Live mode: the agent's own notes, verbatim-gated server-side. Null means
     no live data yet (seed renders); an empty array is a real answer. */
  const live = liveNotes(c.key);
  if (live !== null) {
    const rows = live
      .map(
        (n) => `
        <div class="kp" data-kind="fact">
          <span class="g" title="Noted by ChadBuddy">✎</span>
          <span class="col">
            <span class="tx">${e(n.text)}</span>
            <span class="mt">noted by chadbuddy · ${citeChips([n.cite], c.key)}</span>
          </span>
        </div>`,
      )
      .join("");
    return `
      <div class="tile keyinfo" style="gap:9px">
        <div class="kihead">
          <span class="t" style="font-size:14px;font-weight:500">Key information</span>
          <span class="lbl">${live.length} noted</span>
        </div>
        ${rows || `<p class="empty" style="font-size:11px">Nothing noted yet — the agent reads every 15 minutes once a thread has a few messages.</p>`}
      </div>`;
  }

  const notes = notesFor(c.key);

  const rows = notes.moments
    .map(
      (m) => `
      <div class="kp" data-kind="${e(m.kind)}">
        <span class="g" title="${e(POINT_LABEL[m.kind])}">${e(POINT_GLYPH[m.kind])}</span>
        <span class="col">
          <span class="tx">${e(m.text)}</span>
          <span class="mt">${e(stamp.format(Date.parse(m.at)))} · ${m.daysAgo}d ago · ${e(m.where)}</span>
        </span>
      </div>`,
    )
    .join("");

  const quiet = notes.silent
    .map(
      (s) => `
      <div class="kp quiet">
        <span class="g">○</span>
        <span class="col">
          <span class="tx">${e(s.meeting.where)} · ${s.meeting.minutes} min</span>
          <span class="mt">${e(dateShort.format(Date.parse(s.meeting.at)))} · ${
            s.reason === "declined"
              ? "no notes — they declined recording"
              : "no notes — consent was never asked for"
          }</span>
        </span>
      </div>`,
    )
    .join("");

  const empty = !rows && !quiet;

  return `
    <div class="tile keyinfo" style="gap:9px">
      <div class="kihead">
        <span class="t" style="font-size:14px;font-weight:500">Key information</span>
        <span class="lbl">${notes.moments.length} noted</span>
      </div>
      ${
        empty
          ? `<p class="kempty">No meetings recorded with this client yet. Notes appear here once a
             conversation is captured with their consent.</p>`
          : `<div class="klist sc" id="keynotes">${rows}${quiet}</div>`
      }
    </div>`;
}

/**
 * Call them, without leaving to find them.
 *
 * Honest about what it is: Telegram voice runs on MTProto's own call stack,
 * which a webview cannot host — so this deep-links straight into the Telegram
 * app's call screen for this exact person. One click here, one click there.
 * The button only exists when there is a real Telegram peer behind the card:
 * seeded clients have nobody to ring.
 */
function callButton(c: ClientView): string {
  const meta = clientMeta(c.key);
  if (!isTauri || !meta || meta.sourceId === "" || meta.sourceId.startsWith("seed:")) return "";
  return `<button class="btn callbtn" data-act="call-tg" data-client="${c.key}"
    title="Opens the call screen in Telegram">☏ Call</button>`;
}

/**
 * The email on file, editable in place.
 *
 * Advisor-entered because no platform we read carries it. An empty save
 * clears it — a wrong address is worse than none.
 */
function emailRow(c: ClientView): string {
  const meta = clientMeta(c.key);
  const email = meta?.email ?? "";
  return `
    <div class="fact emailrow">
      <span class="g">✉</span><span class="k">Email</span><span class="d"></span>
      <span class="v" style="display:flex;gap:5px;align-items:center">
        <input class="emailbox" id="emailbox" type="email" value="${e(email)}" placeholder="none on file">
        <button class="btn sm" data-act="email-save" data-client="${c.key}">Save</button>
      </span>
    </div>`;
}

/**
 * Replying without leaving.
 *
 * Telegram goes through the outbox — the bridge holds the socket and its
 * echo puts the sent message straight back into this thread. Email goes
 * through the deployment's Gmail action. Both paths end at a human pressing
 * this one button; nothing composes itself.
 */
function composer(c: ClientView): string {
  const meta = clientMeta(c.key);
  const emailReady = (meta?.email ?? "") !== "";
  const via = state.replyVia;
  return `
    <div class="composer">
      <div class="cvia">
        <button class="cv${via === "tg" ? " on" : ""}" data-act="reply-via" data-via="tg">Telegram</button>
        <button class="cv${via === "em" ? " on" : ""}" data-act="reply-via" data-via="em"
          ${emailReady ? "" : `title="No email on file — add one in Basic information"`}>Email${emailReady ? "" : " ·?"}</button>
      </div>
      <textarea class="replybox" data-act="reply-input" rows="2"
        placeholder="${via === "tg" ? `Message ${e(c.name.split(" ")[0]!)} on Telegram…` : `Email ${e(c.name.split(" ")[0]!)}…`}">${e(state.replyDraft)}</textarea>
      <div class="crow">
        <span class="mt">${via === "tg" ? "sends as you, lands in this thread" : emailReady ? `to ${e(meta?.email ?? "")}` : "add an email first"}</span>
        <button class="btn acc" data-act="reply-send" data-client="${c.key}">Send</button>
      </div>
    </div>`;
}

function clientDetail(c: ClientView): string {
  const shown = c.messages.filter(searchKeeps);
  const filters: Array<[Filter, string]> = [["all", "all"], ["client", "theirs"], ["flagged", "flagged"]];

  return `
    <div class="page fixed">
      <div class="dhead">
        <button class="back" data-act="clients-back" title="Back to all clients">← All</button>
        <span class="ava s34" style="background:${tint(markOf(c.tone), 16)};box-shadow:inset 0 0 0 1px ${tint(markOf(c.tone), 35)};color:${inkOf(c.tone)}">${e(c.initials)}</span>
        <span class="nm">${e(c.name)}</span>
        <span class="chip" data-tone="${c.chipTone}">${e(c.statusWord)}</span>
        ${pulse(c)}
        ${callButton(c)}
      </div>

      <div class="dcols">
        <!-- who they are -->
        <div class="dcol info sc">
          <div class="tile" style="gap:11px">
            <span class="t" style="font-size:14px;font-weight:500">Basic information</span>
            <div class="sect">
              ${c.facts
                .map((f) => `<div class="fact"><span class="g">${e(f.glyph)}</span><span class="k">${e(f.k)}</span><span class="d"></span><span class="v">${e(f.v)}</span></div>`)
                .join("")}
              ${emailRow(c)}
            </div>
          </div>

          ${keyInfoTile(c)}

          ${keyPointsTile(c)}

          ${c.open.length ? openLedgerTile(c) : ""}
        </div>

        <!-- what was actually said -->
        <div class="thread sm">
          <div class="bar">
            <span class="qwrap">
              <span class="mag" aria-hidden="true">⌕</span>
              <input class="qbox" data-act="search" type="text" value="${e(state.q)}"
                     placeholder="Search ${c.messageCount} messages…" aria-label="Search this thread">
              ${state.q ? `<button class="clr" data-act="search-clear" title="Clear" aria-label="Clear search">✕</button>` : ""}
            </span>
            <div class="filters">
              ${filters.map(([f, label]) => `<button data-act="filter" data-f="${f}" aria-pressed="${state.filter === f}">${e(label)}</button>`).join("")}
            </div>
            <span class="count">${shown.length}/${c.messageCount}</span>
          </div>
          <div class="msgs sc" id="msgs">
            ${shown.length
              ? shown.map((m) => messageRow(m, state.q.trim())).join("")
              : `<p class="empty">No message matches “${e(state.q)}”.<br>Search runs over the text, the id and the timestamp.</p>`}
          </div>
          ${composer(c)}
        </div>

        <!-- what to do about it -->
        <div class="dcol agent">
          <div class="turn" style="background:${tint(markOf(c.turn.tone), 9)};box-shadow:inset 0 0 0 1px ${tint(markOf(c.turn.tone), 30)}">
            <span class="hd" style="color:${inkOf(c.turn.tone)}">${e(c.turn.head)}</span>
            <div class="q">
              <i style="background:${inkOf(c.turn.tone)}"></i>
              <p>${e(c.turn.quote)}</p>
            </div>
            <span class="nt">${e(c.turn.note)}</span>
            ${c.turn.cite !== "—" ? `<span>${citeChips([c.turn.cite], c.key)}</span>` : ""}
          </div>
          ${askBox(c)}
        </div>
      </div>
    </div>`;
}


function keeps(m: RecMessage): boolean {
  if (state.filter === "client") return m.who === "client";
  if (state.filter === "flagged") return m.flag !== "" || m.chips.length > 0;
  return true;
}

function messageRow(m: RecMessage, hit = ""): string {
  const chips = m.chips
    .map(
      (ch) => `<span class="ec" style="color:${inkOf(ch.tone)};border:1px ${ch.dashed ? "dashed" : "solid"} ${tint(markOf(ch.tone), 40)}">${e(ch.label)}</span>`,
    )
    .join("");

  return `
    <div class="msg${state.lit === m.id ? " lit" : ""}" data-who="${m.who}" data-mid="${e(m.id)}">
      ${m.gap ? `<span class="gap"><i></i><span style="color:${inkOf(m.gapTone)}">${e(m.gap)}</span><i></i></span>` : ""}
      <div class="bub">
        <span class="tx">${mark(m.text, hit)}</span>
        <span class="meta">${chips}<span class="id">${e(m.time)} · ${e(m.id)}</span></span>
      </div>
      ${m.flag ? `<span class="flag" style="color:${inkOf(m.flagTone)}">◆ ${e(m.flag)}</span>` : ""}
    </div>`;
}

/**
 * What the client actually told you — one reading, then the recent facts.
 *
 * The digest leads: two model-written sentences (how they feel, what they
 * want), rendered as prose with the cites they rest on, which the server
 * verified against gate-surviving spans before storing. Under it, only the
 * five most recent raw points — Faizal produced thirty-seven, and a tile
 * that long buries the column it lives in. The full history is one cite
 * click away; each row's quote lives in the message it lights up.
 */
function keyPointsTile(c: ClientView): string {
  const points = keyPointsFor(c.key);
  const digest = digestFor(c.key);
  if (points.length === 0 && !digest) return "";

  const lead = digest
    ? `
      <div style="display:flex;flex-direction:column;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--hair)">
        <div style="display:flex;gap:8px;font-size:12px;line-height:1.5">
          <span class="lbl" style="flex:none;width:38px;padding-top:2px">feels</span>
          <span>${e(digest.feel)}</span>
        </div>
        <div style="display:flex;gap:8px;font-size:12px;line-height:1.5">
          <span class="lbl" style="flex:none;width:38px;padding-top:2px">wants</span>
          <span>${e(digest.want)}</span>
        </div>
        <span>${citeChips(digest.cites, c.key)}</span>
      </div>`
    : "";

  const recent = points.slice(-5).reverse();
  const earlier = points.length - recent.length;

  const row = (p: KeyPoint) => `
    <div style="display:flex;align-items:baseline;gap:8px;padding:7px 0;border-bottom:1px solid var(--hair)">
      <span class="ec" style="flex:none;color:var(--iris);border:1px dashed color-mix(in oklab, var(--iris) 55%, transparent)">${e(p.kind.replace(/_/g, " "))}</span>
      <span style="font-size:12px;flex:1;min-width:0">${e(p.point)}</span>
      <span style="flex:none">${citeChips([p.sourceId], c.key)}</span>
    </div>`;

  return `
    <div class="tile" style="gap:6px;flex:none">
      <div style="display:flex;align-items:baseline;gap:9px;padding-bottom:6px">
        <span class="t" style="font-size:14.5px;font-weight:500">Key points</span>
        <span class="lbl" style="margin-left:auto">${points.length} noted · gate-checked</span>
      </div>
      ${lead}
      <div class="sect" style="gap:0">${recent.map(row).join("")}</div>
      ${earlier > 0 ? `<span class="lbl" style="padding-top:4px">+ ${earlier} earlier — cites in the thread</span>` : ""}
    </div>`;
}

function openLedgerTile(c: ClientView): string {
  const row = (x: LedgerEntry) => `
    <div style="display:flex;flex-direction:column;gap:6px;padding:9px 0;border-bottom:1px solid var(--hair)">
      <div style="display:flex;align-items:baseline;gap:8px">
        <span class="ec" style="color:var(--butter);border:1px dashed color-mix(in oklab, var(--primary) 50%, transparent)">${e(x.kind)}</span>
        <span style="font-size:12px">${e(x.text)}</span>
      </div>
      <span class="m" style="font-size:9.5px;color:var(--t4)">owed by ${e(x.owedBy)} · open ${openDays(x)} days · since ${e(dateShort.format(x.openedAt))}</span>
      <blockquote style="margin:0;padding:6px 9px;border-left:2px solid color-mix(in oklab, var(--foreground) 18%, transparent);background:color-mix(in oklab, var(--foreground) 3.5%, transparent);font-size:11.5px;font-style:italic;color:var(--t3)">“${e(x.quote)}”</blockquote>
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
      <span class="sq" style="background:${tint(markOf(r.tone), 16)};color:${inkOf(r.tone)}">${e(r.initials)}</span>
      <span class="who">
        <span class="n">${e(r.name)}</span>
        <span class="w">${e(r.when)}</span>
      </span>
      <span class="kindcol">
        <span class="kind" style="color:${inkOf(r.kindTone)};background:${r.kindDashed ? "transparent" : `${tint(markOf(r.kindTone), 16)}`};border:1px ${r.kindDashed ? "dashed" : "solid"} ${r.kindDashed ? `${tint(markOf(r.kindTone), 50)}` : "transparent"}">${e(r.kind)}</span>
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

/**
 * A client offered a time; these cards are the advisor answering.
 *
 * Rendered in the same .lrow language as the queue under them, on the calls
 * page because that is where "who needs a decision from me about talking to
 * them" already lives. Nothing here has touched the calendar: the whole
 * point of the proposal path is that accepting IS the first write. The card
 * shows the sentence verbatim with its cite, the exact reply that will go
 * out, and the clash if the slot is already taken — the three things a yes
 * needs to be an informed one.
 */
function proposalCards(): string {
  const open = openProposals();
  if (open.length === 0) return "";

  return open
    .map((p) => {
      const initials = p.name.split(" ").map((w) => w[0] ?? "").slice(0, 2).join("").toUpperCase();
      return `
    <div class="lrow" style="box-shadow:inset 2px 0 0 var(--butter)">
      <span class="sq" style="background:${tint("var(--butter)", 16)};color:var(--butter)">${e(initials)}</span>
      <span class="who">
        <span class="n">${e(p.name)}</span>
        <span class="w">${e(proposalWhen(p))}</span>
      </span>
      <span class="kindcol">
        <span class="kind" style="color:var(--butter);background:transparent;border:1px dashed ${tint("var(--butter)", 50)}">asked in chat</span>
      </span>
      <span class="bodycol">
        <span class="tx" style="color:var(--t1)">“${e(p.text)}”</span>
        <span class="cites">${citeChips([p.cite], p.key as ClientKey)}<span class="why">${
          p.conflict
            ? `clashes with “${e(p.conflict)}”`
            : `reply on accept: “${e(proposalReply(p))}”`
        }</span></span>
      </span>
      <span class="actcol">
        <span class="st" style="color:${p.conflict ? "var(--i-warn)" : "var(--t3)"}">${p.conflict ? "slot taken" : "awaiting you"}</span>
        <span class="acts">
          <button class="btn acc" data-act="proposal-book" data-pid="${e(p.id)}">Book &amp; reply</button>
          <button class="btn ghost" data-act="proposal-decline" data-pid="${e(p.id)}">Decline</button>
        </span>
      </span>
    </div>`;
    })
    .join("");
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
        ${kind === "calls" ? proposalCards() : ""}
        ${q.rows.map(queueRow).join("")}
        <p class="qfoot">${e(q.foot)}</p>
      </div>
    </div>`;
}

/* ── render ──────────────────────────────────────────────────────── */

/** Filter the clients page to a stage, or clear it if it is already on. */
function openStage(stage: Stage): void {
  state.stage = state.stage === stage ? null : stage;
  state.page = "clients";
  state.cview = "grid";
  setState("open");
}

function body(): string {
  if (state.page === "home") return overviewPage();
  if (state.page === "agenda") return agendaPage();
  if (state.page === "calendar") return calendarPage();
  if (state.page === "assist") return assistPage();
  if (state.page === "clients") {
    if (state.cview === "grid") return clientsGrid();
    // The selection can go stale under the render: live mode swaps the book
    // after connect, and a seed client open at that moment no longer exists.
    // Falling back to clients[0] here is how a page changed people mid-look.
    const sel = findClient(state.sel.toLowerCase());
    return sel ? clientDetail(sel) : clientsGrid();
  }
  return queuePage(state.page);
}

let compactRendered = false;

/* Rendering is a full innerHTML swap, which throws away the focused element —
   fine for a screen you click, fatal for one you type into. Any handler that
   fires per keystroke names the input it wants back and render() restores it,
   caret at the end, after the swap. Scroll offsets in the ask log and the
   message list are preserved the same way, so the view does not jump under the
   cursor while a search narrows. */
let refocus: string | null = null;

function render(): void {
  if (!compactRendered) {
    // Alert and call layers are rendered per-notification by showNotif.
    need("l-idle").innerHTML = idleLayer();
    need("l-peek").innerHTML = peekLayer();
    compactRendered = true;
  }
  if (state.st === "open") {
    const keep = new Map<string, number>();
    /* dashbody is the page scroll itself. It joined this list with the desk —
       the first page that scrolls — because a full innerHTML swap resets
       scrollTop to 0, and expanding a row three screens down must not
       teleport anyone back to the greeting. */
    for (const id of ["dashbody", "msgs", "asklog", "daylist", "dayctx", "keynotes", "dlist"]) {
      const el = document.getElementById(id);
      if (el) keep.set(id, el.scrollTop);
    }

    need("l-open").innerHTML = `<div class="dash">${header()}<div id="dashbody" class="body sc">${body()}</div>${footer()}</div>`;

    /* The funnel is React and this render just replaced the subtree it was in.
       Re-parenting the same node rather than recreating it is what keeps the
       root alive — otherwise the entrance animation would replay on every
       keystroke in the search box. */
    const slot = document.getElementById("funnel-slot");
    if (slot && !slot.firstChild) slot.append(funnelElement(openStage));

    for (const [id, y] of keep) {
      const el = document.getElementById(id);
      if (el) el.scrollTop = y;
    }
    if (refocus) {
      const el = island.querySelector<HTMLInputElement>(refocus);
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
      refocus = null;
    }
  }
  reportHotRect(island);
}

/**
 * Open one client's detail screen.
 *
 * The search box and the filter are cleared on the way in: they belong to the
 * thread being read, and carrying "flagged only" from one client into the next
 * makes the new thread look emptier than it is. The ask-the-agent transcript is
 * deliberately *not* cleared — it is keyed by client, so going back and forth
 * keeps each conversation where you left it.
 */
function openClient(key: ClientKey): void {
  /* Authored copy — approvals, queues, agenda notes — still references seed
     clients, and in live mode the book holds different people. clientById's
     fallback made that click silently open the first client instead; the
     grid is the honest landing when the person a row names is not in the
     book. */
  if (!findClient(key.toLowerCase())) {
    state.page = "clients";
    state.cview = "grid";
    return;
  }
  if (key !== state.sel) {
    state.q = "";
    state.filter = "all";
    state.draft = "";
  }
  state.sel = key;
  state.page = "clients";
  state.cview = "detail";
}

/** Put a question to the agent and append both halves of the exchange. */
function ask(c: ClientView, q: string): void {
  const text = q.trim();
  if (!text) return;
  const log = (state.ask[c.key] ??= []);
  log.push({ from: "you", text: e(text) });

  /* Live mode asks the actual model, which reads the actual thread — the
     canned classifier below is only the seed demo's stand-in now. The reply
     lands as a placeholder that swaps when the answer arrives, claims
     verbatim-gated server-side; an answer whose evidence all died says so to
     the advisor's face instead of dressing up. */
  if (clientMeta(c.key) !== null) {
    const turn: AskTurn = { from: "agent", text: "Reading the thread…" };
    log.push(turn);
    void askAgent(c.key, text)
      .then((r) => {
        turn.text = e(r.uncited ? `${r.answer}\n\n(No verbatim evidence survived the gate — treat this one as the model's guess.)` : r.answer);
        turn.cites = r.cites;
        render();
      })
      .catch((err) => {
        turn.text = e(`The model is unreachable: ${err instanceof Error ? err.message : String(err)}`);
        render();
      });
    state.draft = "";
    render();
    requestAnimationFrame(() => {
      const el = document.getElementById("asklog");
      if (el) el.scrollTop = el.scrollHeight;
    });
    return;
  }

  log.push(answer(c, classify(text)));
  state.draft = "";
  render();
  // The reply lands below the fold on anything but the first exchange.
  requestAnimationFrame(() => {
    const el = document.getElementById("asklog");
    if (el) el.scrollTop = el.scrollHeight;
  });
}

/**
 * Move the island to a state, and render it.
 *
 * Wrapped because of what the failure looks like otherwise. `data-state` is
 * set before render() runs, and the shell reads that attribute to decide how
 * much of the screen to make interactive — so a render that throws on the way
 * to `open` leaves a full-screen, fully transparent, always-on-top window that
 * captures every click and draws nothing. That is not a broken dashboard, it
 * is a laptop that has stopped responding.
 *
 * On a throw the island is put back to idle, which is always renderable, and
 * the shell is told the small rectangle rather than the whole screen.
 */
function setState(st: IslandState): void {
  state.st = st;
  island.dataset.state = st;
  if (st !== "call") delete island.dataset.tone;
  if (st !== "alert" && st !== "call") {
    window.clearTimeout(dwellTimer);
    current = null;
  }
  /* Anything that is not the hover taking over discards the parked
     notification. Resuming an alert minutes later, because it happened to be
     interrupted before the dashboard was opened, would be a message arriving
     out of nowhere. */
  if (st === "open" || st === "idle") parked = null;
  if (st !== "open") state.lit = null;
  /* Focus is taken on open and never on the compact states: a pill that
     steals the caret from whatever is being typed behind it is a pill nobody
     keeps running, but a dashboard that cannot be closed with Escape because
     the keystroke went to the editor behind is just as bad. */
  if (st === "open") focusWindow();

  try {
    render();
  } catch (err) {
    console.error("[chadbuddy] render failed — falling back to idle", err);
    if (st !== "idle") {
      state.st = "idle";
      island.dataset.state = "idle";
      try {
        render();
      } catch (fatal) {
        console.error("[chadbuddy] idle render failed too", fatal);
      }
    }
    reportHotRect(island);
  }
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



/* Bound once to the island rather than to the names themselves, because
   render() replaces those on every state change. */
initScramble(island);


/* Hover-with-intent. A deliberate hover expands to the summary card; a
   cursor merely passing through does not — the 160ms delay filters the
   drive-bys that made the earlier version feel like it was dodging the
   pointer. The island grows around a fixed top-centre anchor, so nothing
   slides. Hovering a visible notification pauses its dwell so it can
   actually be read; leaving gives it 2.5s more, then it retires. */
let hoverTimer: number | undefined;
/**
 * Grace before a hover is believed to be over.
 *
 * The shell can hand the page a spurious pointerleave: it samples the cursor
 * on a 60ms timer and flips the window between capturing and ignoring, so a
 * pointer resting near the edge produces leave/enter pairs it never asked for.
 * Collapsing on the first of those is what made the island flutter. Waiting a
 * beat and cancelling on re-entry absorbs the noise while still feeling
 * immediate — 140ms is under the threshold where a deliberate exit starts to
 * feel sticky.
 */
let leaveTimer: number | undefined;
const LEAVE_GRACE = 140;

/**
 * Hover intent, measured in stillness rather than in elapsed time.
 *
 * A plain delay cannot tell a hover from a pass. The pill is 232px wide and a
 * cursor crossing it on the way somewhere else is inside it for longer than any
 * delay short enough to still feel responsive — so it expanded mid-sweep and
 * collapsed again the moment the pointer left. From the outside that reads as
 * the island flinching at passing traffic.
 *
 * Stillness separates the two cleanly. The timer restarts on every real
 * movement, so it only ever elapses once the pointer has come to rest: a sweep
 * never expands the island at all, and a deliberate hover — which always ends
 * in stopping — still does.
 */
const HOVER_DWELL = 150;

/**
 * Movement below this is not movement.
 *
 * A hand resting on a mouse still emits pointermove; without a floor the timer
 * would be restarted by tremor forever and the island would never open.
 */
const JITTER = 4;

let lastPoint: { x: number; y: number } | null = null;

/** The states a deliberate hover may expand out of. */
const COMPACT = new Set<IslandState>(["idle", "alert", "call"]);

/**
 * Is the pointer genuinely on the island right now?
 *
 * Asked rather than assumed, because pointerleave cannot be relied on here.
 * The shell flips this window between capturing the cursor and ignoring it on
 * a 60ms timer, and when it flips to ignoring the page simply stops receiving
 * pointer events — with no leave to mark the moment. A hover armed on the way
 * in then fires after the cursor has already swept past and gone, expanding an
 * island nobody is pointing at, with no matching leave to collapse it again.
 * Sweeping across repeatedly is exactly the gesture that produces it.
 *
 * :hover is the browser's own answer to the same question, and it does not
 * depend on an event having been delivered.
 */
function pointerIsOnIsland(): boolean {
  return island.matches(":hover");
}

function armHover(): void {
  window.clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(() => {
    if (!COMPACT.has(state.st)) return;
    // The gesture that armed this may have finished long ago.
    if (!pointerIsOnIsland()) return;
    setState("peek");
  }, HOVER_DWELL);
}

/**
 * Collapse a summary card the pointer has left without saying so.
 *
 * The same missing-leave problem, one step later: expanded correctly, then the
 * cursor goes without the page hearing about it, and the card stays open. The
 * poll is cheap and only ever acts when the DOM already disagrees with the
 * state, so it corrects that case and does nothing the rest of the time.
 */
window.setInterval(() => {
  if (state.st !== "peek") return;
  if (pointerIsOnIsland()) return;
  window.clearTimeout(leaveTimer);
  if (!resumeParked()) setState("idle");
}, 300);

island.addEventListener("pointerenter", (ev) => {
  // Back before the grace ran out: the leave never really happened.
  window.clearTimeout(leaveTimer);
  /* A notification pauses while the pointer is on it, so it can be read
     rather than snatched away mid-sentence — and is set aside with whatever
     time it had left, in case the hover expands past it. */
  if ((state.st === "alert" || state.st === "call") && current) {
    window.clearTimeout(dwellTimer);
    const left = current.dwell === null ? null : Math.max(0, current.dwell - (Date.now() - shownAt));
    parked = left === null || left > 0 ? { notif: current, left } : null;
  }

  // Resting expands from any compact state. Restricting this to idle meant a
  // notification made the island stop responding to the pointer entirely.
  if (!COMPACT.has(state.st)) return;
  lastPoint = { x: ev.clientX, y: ev.clientY };
  armHover();
});

/* Every real movement restarts the clock, so it can only elapse where the
   pointer has stopped. This is what makes a sweep cost nothing. */
island.addEventListener("pointermove", (ev) => {
  if (!COMPACT.has(state.st)) return;
  const p = { x: ev.clientX, y: ev.clientY };
  if (lastPoint && Math.hypot(p.x - lastPoint.x, p.y - lastPoint.y) < JITTER) return;
  lastPoint = p;
  armHover();
});

island.addEventListener("pointerleave", () => {
  window.clearTimeout(hoverTimer);
  lastPoint = null;
  if (state.st === "peek") {
    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => {
      if (state.st !== "peek") return;
      // Whatever the hover interrupted gets the rest of its time back; if it
      // ran out while being read, the island simply returns to the pill.
      if (!resumeParked()) setState("idle");
    }, LEAVE_GRACE);
  } else if (state.st === "alert" || state.st === "call") {
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
    /* The toggle waits for the shell's answer before it moves. If the OS
       declines — the capture-exclusion flag needs Windows 10 2004 or newer —
       the control stays off rather than telling the advisor they are hidden
       when they are not. */
    case "protect": {
      const want = !state.hidden;
      void setContentProtected(want).then((applied) => {
        state.hidden = applied;
        if (want && !applied) {
          console.warn("[chadbuddy] the shell declined to hide the window from capture");
        }
        render();
      });
      return;
    }
    case "page":
      state.page = (hit.dataset.page ?? "home") as Page;
      // A section tab goes to the section, so clicking "clients" from inside a
      // client returns to the grid rather than looking like a dead button.
      if (state.page === "clients") state.cview = "grid";
      setState("open");
      return;
    /* Answering a proposal. Book first, reply second, in that order on
       purpose: a booked slot with the reply still unsent is a card the
       advisor can see and finish; a sent "6pm works" with the booking failed
       is a promise the diary doesn't hold. The card leaves the page by
       subscription when the status flips, not by anything here. */
    case "proposal-book": {
      const pid = hit.dataset.pid;
      const p = openProposals().find((x) => x.id === pid);
      if (!p) return;
      const btn = hit as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = "Booking…";
      void acceptProposal(p.id)
        .then(async (res) => {
          if (!res.booked) {
            btn.textContent = res.reason ?? "not booked";
            return;
          }
          btn.textContent = "Replying…";
          await queueSend(p.key as ClientKey, proposalReply(p));
        })
        .catch((err: unknown) => {
          btn.disabled = false;
          btn.textContent = "Book & reply";
          console.error("[chadbuddy] proposal failed", err);
        });
      return;
    }
    case "proposal-decline": {
      const pid = hit.dataset.pid;
      if (!pid) return;
      (hit as HTMLButtonElement).disabled = true;
      void declineProposal(pid).catch((err: unknown) => {
        (hit as HTMLButtonElement).disabled = false;
        console.error("[chadbuddy] decline failed", err);
      });
      return;
    }
    /* Every route into a client — a card, an overview tile, a queue row, a
       notification, a citation — lands on the same detail screen. There is no
       longer a profile/record split to choose between. */
    case "open-client":
    case "open-profile":
    case "open-record":
      if (key) openClient(key);
      setState("open");
      return;
    /* Stepping only changes what the tile is describing, so it re-renders
       where it stands rather than routing anywhere. */
    case "up-step": {
      const dir = Number(hit.dataset.dir ?? 0);
      const at = state.up ?? nextUpIndex;
      state.up = Math.min(bigSlots.length - 1, Math.max(0, at + dir));
      render();
      return;
    }
    /* The strip is a filter, not a chart with a tooltip. A stage is only
       useful once it resolves to the names inside it, so the click carries
       straight through to the list rather than expanding in place. */
    case "stage": {
      const want = hit.dataset.stage as Stage | undefined;
      if (want) openStage(want);
      return;
    }
    /* The advisor saying the meeting has not finished. Everything downstream
       — who is told, and how late they are told they are — follows from this
       one fact, which is why it is a tap and not an inference. */
    /* Resolving a pencilled-in block. Both write to the real calendar, which
       is the point: a block the advisor confirmed here has to be confirmed on
       the phone they will actually check. */
    case "confirm-slot":
    case "drop-slot": {
      const id = hit.dataset.slot;
      if (id) {
        void calendarSource()
          .settle(id, act === "confirm-slot" ? "confirmed" : "cancelled")
          .then(refreshCalendar)
          .then(render)
          .catch((err) => console.error("[chadbuddy] could not settle", id, err));
      }
      return;
    }
    case "month-step": {
      const by = Number(hit.dataset.by ?? "0");
      const base = new Date(state.month ?? nowMs());
      base.setDate(1);
      base.setHours(0, 0, 0, 0);

      if (by === 0) state.month = null;
      else {
        base.setMonth(base.getMonth() + by);
        state.month = base.getTime();
      }

      void refreshMonth(state.month ?? nowMs()).then(render);
      render();
      return;
    }

    case "wk-step": {
      const by = Number(hit.dataset.by ?? "0");
      if (by === 0) state.wk = null;
      else state.wk = mondayOf(state.wk ?? nowMs()) + by * 7 * 86_400_000;
      void refreshWeek(state.wk ?? nowMs()).then(render);
      render();
      return;
    }

    /* A day, from either view. Closing the overlay here is what makes the
       month usable as a jump: summon it, click the day, land on the day. */
    case "cal-day": {
      const at = Number(hit.dataset.day ?? "");
      if (Number.isFinite(at)) {
        state.calDay = at;
        state.calOverlay = false;
        void refreshMonth(at).then(render);
      }
      render();
      return;
    }

    case "cal-back":
      state.calDay = null;
      render();
      return;

    case "cal-over":
      state.calOverlay = !state.calOverlay;
      render();
      return;

    case "cal-view": {
      const v = hit.dataset.view === "month" ? "month" : "week";
      state.calView = v;
      state.calOverlay = false;
      try {
        localStorage.setItem("cb-calview", v);
      } catch {
        /* private mode: the choice lasts the session */
      }
      render();
      return;
    }

    /* The weekly dot: cycle the rating in place. An unrated meeting jumps
       straight to "important" — that is the likeliest intent of the tap. */
    case "cal-rate": {
      const id = hit.dataset.ev;
      const ev = id ? findCalEvent(id) : undefined;
      if (id && ev) {
        const next: Importance =
          ev.importance === undefined || ev.importance === "routine"
            ? ev.importance === undefined
              ? "important"
              : "important"
            : ev.importance === "important"
              ? "key"
              : "routine";
        void calendarSource()
          .annotate(id, { importance: next })
          .then(refreshCalendar)
          .then(() => {
            if (next === "key") prepTaskFor(id);
            render();
          })
          .catch((err) => console.error("[chadbuddy] could not rate", id, err));
      }
      return;
    }

    /* The explicit three-way control, on rail cards and the day page. */
    case "cal-set": {
      const id = hit.dataset.ev;
      const imp = hit.dataset.imp as Importance | undefined;
      if (id && imp) {
        void calendarSource()
          .annotate(id, { importance: imp })
          .then(refreshCalendar)
          .then(() => {
            if (imp === "key") prepTaskFor(id);
            render();
          })
          .catch((err) => console.error("[chadbuddy] could not rate", id, err));
      }
      return;
    }

    /* Confirming from the rail writes everything at once: the rating chosen
       (routine if none was), the prep note as typed, and the booking itself.
       All three land on the real Google event, because the calendar on the
       advisor's phone is the real one. */
    case "rail-confirm":
    case "rail-save":
    case "rail-drop": {
      const id = hit.dataset.ev;
      if (!id) return;
      const ev = findCalEvent(id);
      const ta = document.getElementById(`prep-${id}`) as HTMLTextAreaElement | null;
      const prepUser = ta?.value.trim() ?? "";

      const run = async (): Promise<void> => {
        if (act === "rail-drop") {
          await calendarSource().settle(id, "cancelled");
        } else {
          await calendarSource().annotate(id, {
            importance: ev?.importance ?? (ev ? suggestImportance(ev) : "routine"),
            ...(prepUser !== "" || ev?.prepUser ? { prepUser } : {}),
          });
          if (act === "rail-confirm") {
            await calendarSource().settle(id, "confirmed");
            if ((ev?.importance ?? (ev ? suggestImportance(ev) : "routine")) === "key") prepTaskFor(id);
          }
        }
        await refreshCalendar();
        render();
      };
      void run().catch((err) => console.error("[chadbuddy] rail action failed", id, err));
      return;
    }

    /* The call: Telegram Web in ChadBuddy's own window, on this client's
       chat — no desktop app needed, first use links the device by QR. The
       OS deep link survives only as the fallback for when the window cannot
       be created. */
    case "call-tg": {
      const who = hit.dataset.client;
      const meta2 = who ? clientMeta(who) : null;
      if (meta2 && meta2.sourceId !== "" && !meta2.sourceId.startsWith("seed:")) {
        const id = meta2.sourceId;
        void openTelegram(id).catch(() => openExternal(`tg://user?id=${id}`));
      }
      return;
    }

    case "email-save": {
      const who = hit.dataset.client;
      const box = document.getElementById("emailbox") as HTMLInputElement | null;
      if (who && box) {
        void setClientEmail(who, box.value)
          .then(() => render())
          .catch((err) => {
            console.error("[chadbuddy] email save failed", err);
            showNotif({ kind: "reminder", client: null, title: "Not saved", body: String(err instanceof Error ? err.message : err).slice(0, 60), meta: "", tag: "EMAIL", tone: "critical", dwell: 6000 });
          });
      }
      return;
    }

    case "reply-via": {
      state.replyVia = hit.dataset.via === "em" ? "em" : "tg";
      render();
      return;
    }

    /* The send. Both channels end here, at a person pressing a button on a
       message they wrote — nothing about this path is autonomous. Telegram
       rides the outbox and comes back into the thread through the bridge's
       echo; email is fire-and-notify because it is not part of the citation
       record. */
    case "reply-send": {
      const who = hit.dataset.client;
      const text = state.replyDraft.trim();
      if (!who || text === "") return;

      const done = (title: string, body: string, tone: "butter" | "critical"): void => {
        showNotif({ kind: "reminder", client: who, title, body: body.slice(0, 60), meta: "", tag: tone === "critical" ? "FAILED" : "SENT", tone, dwell: 6000 });
      };

      if (state.replyVia === "tg") {
        void queueSend(who, text)
          .then(() => {
            state.replyDraft = "";
            render();
            done("Queued", "the bridge delivers it in about a second", "butter");
          })
          .catch((err) => done("Not sent", err instanceof Error ? err.message : String(err), "critical"));
      } else {
        void sendEmail(who, `Message from ${ADVISOR}`, text)
          .then(() => {
            state.replyDraft = "";
            render();
            done("Email sent", clientMeta(who)?.email ?? "", "butter");
          })
          .catch((err) => done("Not sent", err instanceof Error ? err.message : String(err), "critical"));
      }
      return;
    }

    case "task-done": {
      const id = hit.dataset.task;
      const t = id ? tasks().find((x) => x.id === id) : undefined;
      if (id && t) void taskDone(id, !t.done).then(() => render());
      return;
    }

    case "task-remove": {
      const id = hit.dataset.task;
      if (id) void taskRemove(id).then(() => render());
      return;
    }

    /* The quick-add: what, and by when. Undated work is refused by shape —
       the date input always has a value. */
    case "task-add": {
      const box = document.getElementById("taskbox") as HTMLInputElement | null;
      const date = document.getElementById("taskdate") as HTMLInputElement | null;
      const title = box?.value.trim() ?? "";
      const when = date?.value ? Date.parse(`${date.value}T12:00:00`) : NaN;
      if (title === "" || !Number.isFinite(when)) return;
      void taskCreate({ title, dueMs: when, source: "advisor" }).then(() => render());
      return;
    }

    /* The desk handing dated work to the calendar. */
    case "task-plan": {
      const title = hit.dataset.title ?? "";
      const due = Number(hit.dataset.due ?? "");
      if (title === "" || !Number.isFinite(due)) return;
      void taskCreate({
        title,
        dueMs: due,
        ...(hit.dataset.client ? { clientKey: hit.dataset.client as ClientKey } : {}),
        ...(hit.dataset.hard ? { hardMs: Number(hit.dataset.hard) } : {}),
        ...(hit.dataset.ref ? { ref: hit.dataset.ref } : {}),
        source: "chadbuddy",
      }).then(() => {
        showNotif({ kind: "reminder", client: (hit.dataset.client as ClientKey) ?? null, title: "Planned", body: title.slice(0, 50), meta: "on the calendar", tag: "TASK", tone: "butter", dwell: 5000 });
        render();
      });
      return;
    }

    /* A block with nobody on the other side.    /* A block with nobody on the other side. The button still exists so the
       whole row is one hit target rather than a mix of live and dead pixels. */
    case "noop":
      return;

    /* Desk rows expand in place, one at a time — the queue stays scannable
       with a detail open, which matters more as the book grows. */
    case "desk-open": {
      const id = hit.dataset.brief ?? null;
      state.desk = state.desk === id ? null : id;
      state.deskHit = null;
      render();
      return;
    }

    case "desk-hit": {
      const id = hit.dataset.brief ?? null;
      state.deskHit = state.deskHit === id ? null : id;
      render();
      return;
    }

    case "desk-dismiss":
    case "desk-snooze": {
      const id = hit.dataset.brief;
      if (id) {
        if (act === "desk-dismiss") dismissBrief(id);
        else snoozeBrief(id);
        if (state.desk === id) state.desk = null;
        if (state.deskHit === id) state.deskHit = null;
      }
      render();
      return;
    }

    case "running-over": {
      const id = hit.dataset.slot;
      const ev = id ? calendarDay().find((x) => x.id === id) : undefined;
      if (ev) {
        markRunningOver(ev, nowMs());
        /* The consequences were on screen before the tap — that is the
           consent. Each affected client with a real chat behind them now
           actually hears; seeded ones are refused by the outbox and logged. */
        const over = overrunFor(ev.id);
        if (over) {
          for (const c of conflictsFrom(over, laterToday(calendarDay(), nowMs()), nowMs())) {
            void queueSend(c.client, delayText(c)).catch((err) =>
              console.warn(`[chadbuddy] delay note to ${c.client} not sent: ${err instanceof Error ? err.message : err}`),
            );
          }
        }
      }
      render();
      return;
    }
    case "open-slot":
      state.slot = hit.dataset.slot ?? null;
      state.page = "agenda";
      setState("open");
      return;
    case "stage-clear":
      state.stage = null;
      render();
      return;
    case "clients-back":
      state.cview = "grid";
      render();
      return;
    case "filter":
      state.filter = (hit.dataset.f ?? "all") as Filter;
      render();
      return;
    case "search-clear":
      state.q = "";
      refocus = ".qbox";
      render();
      return;
    case "ask":
      ask(clientById(state.sel.toLowerCase()), state.draft);
      return;
    case "ask-preset":
      ask(clientById(state.sel.toLowerCase()), hit.dataset.q ?? "");
      return;
    case "notif-open": {
      // Read before setState — leaving alert/call clears the current notif.
      const n = current;
      if (n?.client) openClient(n.client);
      else if (n?.kind === "reminder") state.page = "calls";
      setState("open");
      return;
    }
    /* Sending is the only irreversible thing the dashboard can do, so it
       confirms, names the recipient, and reports what actually happened.
       The agent cannot reach this path: it queues nothing and clicks nothing. */
    case "edit-idea": {
      const k = hit.dataset.key;
      const r = hit.dataset.rank;
      if (!k || !r) break;
      const target = (ideas[k] ?? []).find((x) => x.rank === r);
      if (!target) break;
      state.editing = `${k}:${r}`;
      state.editText = target.draft;
      refocus = '[data-act="edit-draft"]';
      render();
      break;
    }

    /* "Revert", not "Cancel": what the advisor is choosing between is their
       edit and the agent's original, and the label should say so. */
    case "edit-cancel":
      state.editing = null;
      state.editText = "";
      render();
      break;

    case "send-idea": {
      const btn = hit as HTMLButtonElement;
      const sendKey = hit.dataset.key;
      const rank = hit.dataset.rank;
      if (!sendKey || !rank) break;
      const idea = (ideas[sendKey] ?? []).find((x) => x.rank === rank);
      const who = clients.find((c) => c.key === sendKey);
      if (!idea || !who) break;

      /* What was edited is what gets sent. queueSend takes the text as given
         rather than re-reading the idea, for exactly this reason: the advisor
         signs their name to what is on screen, not to what the model wrote. */
      const outgoing = isEditing(sendKey, rank) ? state.editText.trim() : idea.draft;
      if (outgoing === "") {
        window.alert("Nothing to send — the draft is empty.");
        break;
      }

      const ok = window.confirm(
        `Send this to ${who.name} as you?\n\n${outgoing}\n\nThis cannot be undone.`,
      );
      if (!ok) break;

      btn.disabled = true;
      btn.textContent = "Sending…";
      queueSend(sendKey, outgoing, rank)
        .then((to) => {
          btn.textContent = `Sent to ${to}`;
        })
        .catch((err: unknown) => {
          btn.disabled = false;
          btn.textContent = idea.btn;
          window.alert(`Could not send: ${err instanceof Error ? err.message : String(err)}`);
        });
      break;
    }

    case "cite": {
      const id = hit.dataset.id;
      if (!id || !key) return;
      openClient(key);
      state.lit = id;
      setState("open");
      focusCite(id);
      return;
    }
    default:
      return;
  }
});

/* The two live inputs. Both re-render on every keystroke — the search because
   it filters as you type, the composer because the send button enables on the
   first non-space character — and both name themselves for refocus so the
   caret survives the swap. */
/* ── drag and drop for tasks ─────────────────────────────────────────
   Native HTML5 DnD, delegated from the island so it survives every render.
   No render fires during a drag — hover feedback is a class toggled on the
   real DOM, and the one render happens after the drop commits. */
let dragTaskId: string | null = null;
let dropHover: Element | null = null;

island.addEventListener("dragstart", (ev) => {
  const chip = (ev.target as HTMLElement).closest?.("[data-task]");
  if (!chip) return;
  dragTaskId = (chip as HTMLElement).dataset["task"] ?? null;
  if (ev.dataTransfer) {
    ev.dataTransfer.setData("text/plain", dragTaskId ?? "");
    ev.dataTransfer.effectAllowed = "move";
  }
});

island.addEventListener("dragover", (ev) => {
  if (dragTaskId === null) return;
  const zone = (ev.target as HTMLElement).closest?.("[data-drop-day]");
  if (!zone) return;
  ev.preventDefault();
  if (dropHover !== zone) {
    dropHover?.classList.remove("dropok");
    zone.classList.add("dropok");
    dropHover = zone;
  }
});

island.addEventListener("drop", (ev) => {
  const zone = (ev.target as HTMLElement).closest?.("[data-drop-day]");
  dropHover?.classList.remove("dropok");
  dropHover = null;
  if (!zone || dragTaskId === null) return;
  ev.preventDefault();
  const day = Number((zone as HTMLElement).dataset["dropDay"]);
  const id = dragTaskId;
  dragTaskId = null;
  // Noon, not midnight: day-granular, and immune to timezone edges.
  if (Number.isFinite(day)) void taskMove(id, day + 12 * 3_600_000).then(() => render());
});

island.addEventListener("dragend", () => {
  dropHover?.classList.remove("dropok");
  dropHover = null;
  dragTaskId = null;
});

island.addEventListener("input", (ev) => {
  const el = ev.target as HTMLInputElement;
  const act = el.dataset.act;
  if (act === "search") {
    state.q = el.value;
    refocus = ".qbox";
    render();
  } else if (act === "reply-input") {
    /* No render: nothing on screen depends on the draft, and re-rendering
       per keystroke would fight the caret. State is only the lifeboat for
       when something ELSE re-renders mid-thought. */
    state.replyDraft = el.value;
  } else if (act === "edit-draft") {
    /* Held in state rather than read off the DOM at send time, because the
       island re-renders by swapping innerHTML — the textarea the advisor typed
       into is gone by then. `refocus` puts the caret back afterwards. */
    state.editText = el.value;
    refocus = '[data-act="edit-draft"]';
    render();
  } else if (act === "draft") {
    state.draft = el.value;
    refocus = '[data-act="draft"]';
    render();
  }
});

/* Enter sends the question. Escape inside a text field clears that field
   rather than closing the island — closing the whole dashboard because someone
   wanted to abandon a search is a hostile amount of undo. */
island.addEventListener("keydown", (ev) => {
  const el = ev.target as HTMLElement;
  const act = el.dataset?.act;
  if (act !== "draft" && act !== "search") return;

  if (ev.key === "Enter" && act === "draft") {
    ev.preventDefault();
    ask(clientById(state.sel.toLowerCase()), state.draft);
    return;
  }
  if (ev.key === "Escape") {
    ev.stopPropagation();
    if (act === "search") state.q = "";
    else state.draft = "";
    refocus = act === "search" ? ".qbox" : '[data-act="draft"]';
    render();
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (state.st === "alert" || state.st === "call") {
    setState("idle");
    return;
  }
  /* One press, one exit. Clearing a lit citation used to come first, which
     meant Escape did nothing visible the first time you pressed it whenever a
     citation happened to be open — so the dashboard now closes on the first
     press and takes the highlight with it. */
  if (state.st === "open") {
    state.lit = null;
    setState("idle");
    return;
  }
  if (state.lit !== null) {
    state.lit = null;
    render();
  }
});

document.addEventListener("pointerdown", (ev) => {
  if (state.st !== "open") return;
  if (!island.contains(ev.target as Node)) setState("idle");
});

/* Clicking the taskbar closes the dashboard too.

   The window covers the work area, which stops short of the taskbar — so a
   click down there never reaches the page and the handler above cannot see it.
   The dashboard stayed open, and because focus had gone with the click, it had
   also stopped receiving Escape: open, unclosable from the keyboard, and only
   dismissable by clicking back into it first.

   Losing focus is the one signal that does arrive, and treating it as dismissal
   is what an overlay should do anyway — it is how Spotlight and Alfred behave.
   Only the dashboard closes; the compact states never take focus, so they are
   never affected by this. */
window.addEventListener("blur", () => {
  if (state.st !== "open") return;
  /* Confirmed a beat later rather than acted on immediately. Toggling
     click-through restyles the window, and a restyle can produce a blur the
     user never caused — closing the dashboard the moment the cursor wandered
     over the taskbar. Re-checking means only a focus change that actually
     stuck counts as walking away. */
  window.setTimeout(() => {
    if (state.st === "open" && !document.hasFocus()) setState("idle");
  }, 180);
});

/* ── boot ────────────────────────────────────────────────────────── */

/* Last resort, and deliberately a light touch.

   This used to force the island back to idle on any error, which turned every
   stray warning into the dashboard closing itself under the user — and one of
   those warnings, 'ResizeObserver loop completed with undelivered
   notifications', is raised as a window error on ordinary frames of the morph.
   The dashboard collapsed while being hovered, repeatedly, for no reason the
   user could see.

   Re-reporting the rectangle is enough on its own. reportHotRect already
   refuses to claim the screen for an open state that has not drawn, so the
   dangerous case is covered without touching what is on screen. */
window.addEventListener("error", () => {
  reportHotRect(island);
});

/* The calendar is async by design — a Google-backed source cannot be
   anything else — so the day is fetched once here and re-read after
   anything that changes it. render() stays synchronous. */
void refreshCalendar().then(render);

/* The month the calendar page opens on. Fetched at boot rather than on first
   visit, so stepping onto the tab shows a filled grid rather than an empty one
   that populates a frame later — an empty calendar reads as a free month. */
void refreshMonth(nowMs()).then(render);
void refreshWeek(nowMs()).then(render);

render();
watchHotRect(island);

/* The island parks where the browser keeps its tabs, so it has to be movable.
   Reporting on every move rather than on drop: the shell polls the cursor at
   60ms and a stale rectangle mid-drag drops the pill out from under the
   pointer holding it. */
initDrag(need("stage"), island, () => reportHotRect(island));

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
  if (who) openClient(who.toUpperCase() as ClientKey);
  setState("open");
}

/* The live feed. First notification lands 6s after boot, then one every 22s,
   cycling through the real events — each fires only if the island is idle, so
   nothing ever barges in over the dashboard or a hover. */
const demoFirst = window.setTimeout(nextNotif, 6_000);
const demoLoop = window.setInterval(nextNotif, 22_000);

/* Live mode, off unless `?live` is in the URL.
   `clients`, `totals` and `ideas` are imported bindings, and ES modules make
   imports live views — so live.ts reassigns them at their source and a plain
   render() picks everything up. Nothing above this line had to change. */
const live = initLive(
  () => {
    state.sel = clients[0]?.key ?? state.sel;
    render();
  },
  /* A real message arriving is exactly what the alert state was built for:
     the pill grows to 360px, the gold ring spins, and it returns to idle.
     showNotif already refuses to fire unless the island is idle, so this can
     never barge over the open dashboard or a hover. */
  (a) => {
    showNotif({
      kind: "message",
      client: a.key,
      title: a.clientName.split(" ")[0] ?? a.clientName,
      body: a.text.length > 30 ? `${a.text.slice(0, 29)}…` : a.text,
      meta: a.gapMs === null ? "just now" : humanGap(a.gapMs),
      tag: "NEW",
      tone: "butter",
      initials: a.initials,
      mode: "record",
      dwell: 9000,
    });

    /* Reading this message for an agreed time is the backend's job now —
       convex/scheduling.ts runs on ingest, so it works when the app is shut.
       Doing it here as well would put two writers on the same sentence. The
       block it creates arrives back through the calendar subscription. */
  },
);

/* Tasks after live is decided: the seam subscribes to Convex when there is
   a client to subscribe to, and falls back to localStorage when there is not
   — the browser demo needs no backend. */
initTasks(render);
initDeskAi(render);

if (live) {
  /* The day, from Google rather than the seed file.
     After initLive because it needs the connected client, and re-fetching
     immediately because the seeded day is on screen by now and the live one
     replaces it wholesale. Nothing below the swap knows which source answered
     — see src/daysource.ts. */
  if (connectCalendar(() => void refreshCalendar().then(render))) {
    void refreshCalendar().then(render);
  }

  /* The seed replay loop is a stand-in for events that have not happened yet.
     Once real ones do, it stops — two sources competing for the same island
     would show a months-old seed message over a live one. */
  window.clearTimeout(demoFirst);
  window.clearInterval(demoLoop);
}
