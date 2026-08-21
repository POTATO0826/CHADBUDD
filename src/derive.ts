/**
 * The view model.
 *
 * Everything the redesigned UI renders comes from here, and everything here is
 * computed from the real seed threads. The design document this was built from
 * carried its own numbers — per-client message counts, message ids like M-101,
 * paraphrased quotes, a "2029 handover" that appears nowhere in the threads.
 * None of that survived: if a value is on screen it is measured or quoted from
 * an actual message, because the alternative is a dashboard that lies.
 *
 * Where the design asks for something this build genuinely cannot measure yet
 * (emotion spans, warmth), the answer is the design's own hatch idiom — an
 * explicit absence, never a plausible-looking number.
 */

import { NOW, RECENT_FROM } from "../data/clock.ts";
import type { ClientKey, SeedMessage, SeedThread } from "../data/types.ts";
import { tsOf } from "../data/types.ts";
import { threads } from "../data/threads/index.ts";
import { isOpen, ledgerFor, openDays, openEntries } from "./ledger.ts";
import type { LedgerEntry } from "./ledger.ts";
import type { Score, SignalScore } from "./score.ts";
import { fmtMinutes, score } from "./score.ts";
import { conversationStarts, isQuestion, windows } from "./signals.ts";
import type { Windows } from "./signals.ts";

export const ADVISOR = "Wei Han";

const DAY = 86_400_000;
const TZ = "Asia/Kuala_Lumpur";

export const dateShort = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: TZ });
export const dateLong = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
export const monthYear = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: TZ });
export const stamp = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ,
});
const dayNum = new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: TZ });
const dayOfWeek = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: TZ });

/** Local (MYT) calendar-day key, so grid cells line up with what the advisor saw. */
function dayKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(ms);
}

export function initialsOf(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();
}

export function humanGap(ms: number): string {
  const min = ms / 60_000;
  if (min < 90) return `${Math.round(min)}m later`;
  if (min < 48 * 60) return `${(min / 60).toFixed(1)}h later`;
  return `${Math.round(min / 1440)} days later`;
}

/* ── tone ────────────────────────────────────────────────────────── */

export type Tone = "good" | "warn" | "serious" | "critical" | "butter";

export const MARK: Record<Exclude<Tone, "butter">, string> = {
  good: "var(--m-good)", warn: "var(--m-warn)", serious: "var(--m-ser)", critical: "var(--m-crit)",
};
export const INK: Record<Exclude<Tone, "butter">, string> = {
  good: "var(--i-good)", warn: "var(--i-warn)", serious: "var(--i-ser)", critical: "var(--i-crit)",
};

function toneOf(s: Score): Tone {
  if (s.silent) return "butter";
  if (s.status === "decaying") return "critical";
  if (s.status === "watch") return "warn";
  return "good";
}

/** MARK colour for a signal's severity — the band vocabulary from score.ts. */
export function severityMark(sev: number): string {
  if (sev < 0.15) return MARK.good;
  if (sev < 0.45) return MARK.warn;
  if (sev < 0.75) return MARK.serious;
  return MARK.critical;
}
export function severityInk(sev: number): string {
  if (sev < 0.15) return INK.good;
  if (sev < 0.45) return INK.warn;
  if (sev < 0.75) return INK.serious;
  return INK.critical;
}

/* ── the month grid ──────────────────────────────────────────────── */

export type CellKind = "outside" | "quiet" | "them" | "you" | "cited";

export interface Cell {
  kind: CellKind;
  num: string;
  weekend: boolean;
  /** Short label printed in the cell. */
  label: string;
  /** Screen-reader / title description. */
  a11y: string;
}

export interface Band {
  label: string;
  range: string;
  tone: Tone;
}

export interface Week {
  cells: Cell[];
  band?: Band;
}

/**
 * A 5x7 grid of the 35 days ending today, so the grid covers the same recent
 * window every other number on the screen is measured over. The design showed a
 * calendar month; the product's unit is "the last 30 days", and a grid that
 * disagrees with the metric beside it is worse than one that isn't a month.
 */
function grid(thread: SeedThread, cited: Set<string>): Week[] {
  const starts = conversationStarts(thread.messages);

  // What happened on each local day.
  const byDay = new Map<string, { client: boolean; advisorStart: boolean; cited: boolean }>();
  for (const m of thread.messages) {
    const k = dayKey(tsOf(m));
    const e = byDay.get(k) ?? { client: false, advisorStart: false, cited: false };
    if (m.from === "client") e.client = true;
    if (m.from === "advisor" && starts.has(m.externalId)) e.advisorStart = true;
    if (cited.has(m.externalId)) e.cited = true;
    byDay.set(k, e);
  }

  // Anchor the last row so today sits in it, then walk back 34 days.
  const cells: Cell[] = [];
  for (let i = 34; i >= 0; i--) {
    const ms = NOW - i * DAY;
    const k = dayKey(ms);
    const e = byDay.get(k);
    const dow = dayOfWeek.format(ms);
    const weekend = dow === "Sat" || dow === "Sun";
    const num = dayNum.format(ms);
    const label = dateShort.format(ms);

    if (ms < RECENT_FROM - 5 * DAY) {
      cells.push({ kind: "outside", num, weekend, label: "", a11y: `${label}: outside the window` });
    } else if (e?.cited) {
      cells.push({ kind: "cited", num, weekend, label: "cited", a11y: `${label}: cited evidence` });
    } else if (e?.advisorStart) {
      cells.push({ kind: "you", num, weekend, label: "you", a11y: `${label}: you started the conversation` });
    } else if (e?.client) {
      cells.push({ kind: "them", num, weekend, label: "them", a11y: `${label}: they replied` });
    } else {
      cells.push({ kind: "quiet", num, weekend, label: "", a11y: `${label}: silent` });
    }
  }

  const weeks: Week[] = [];
  for (let w = 0; w < 5; w++) weeks.push({ cells: cells.slice(w * 7, w * 7 + 7) });
  return weeks;
}

/** Attach at most two bands, and only ones that are true of this thread. */
function bands(weeks: Week[], w: Windows, open: LedgerEntry[], key: ClientKey): void {
  const last = weeks[4]!;
  const third = weeks[2]!;

  const oldest = open[0];
  if (oldest) {
    last.band = {
      label: oldest.text.length > 34 ? `${oldest.text.slice(0, 33)}…` : oldest.text,
      range: `${oldest.sourceMessageId} · ${openDays(oldest)} days`,
      tone: "butter",
    };
  }

  const r = w.recent;
  if (r.clientInitiated === 0 && r.conversations > 0) {
    third.band = {
      label: "You started every thread",
      range: `${r.conversations} of ${r.conversations}`,
      tone: key === "A" ? "good" : "critical",
    };
  } else if (r.initiationRatio !== null && r.initiationRatio >= 0.5) {
    third.band = {
      label: "They opened most threads",
      range: `${r.clientInitiated} of ${r.conversations}`,
      tone: "good",
    };
  }

  if (!last.band && r.questions === 0) {
    last.band = { label: "No question asked", range: "last 30 days", tone: "butter" };
  }
}

/* ── the turning point ───────────────────────────────────────────── */

export interface Turn {
  head: string;
  quote: string;
  note: string;
  cite: string;
  tone: Tone;
}

/**
 * The last question the client asked, and when. For three of these four clients
 * that date *is* the turn — everything after it is acknowledgement. It's derived
 * rather than asserted: find the final client message containing a question.
 */
function turn(thread: SeedThread, w: Windows, s: Score): Turn {
  const questions = thread.messages.filter(isQuestion);
  const lastQ = questions[questions.length - 1];

  if (!lastQ) {
    return {
      head: "no question in this thread",
      quote: "—",
      note: "This client has not asked a single question in the whole imported history.",
      cite: "—",
      tone: "critical",
    };
  }

  const ts = tsOf(lastQ);
  const daysAgo = Math.round((NOW - ts) / DAY);
  const healthy = s.status === "healthy";
  const inWindow = ts > RECENT_FROM;

  return {
    head: healthy
      ? "nothing turned · this is the control case"
      : `where it turned · ${dateShort.format(ts)}`,
    quote: `“${lastQ.text.length > 190 ? `${lastQ.text.slice(0, 189)}…` : lastQ.text}”`,
    note: healthy
      ? `Still asking questions — this one ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago, and ${w.recent.questions} in the last 30 days. Nothing here needs fixing.`
      : `The last question from them was ${daysAgo} days ago. Everything since has been acknowledgement: ${w.recent.questions} questions in the last 30 days against a baseline of ${w.baseline.questionsPer30d.toFixed(1)} a month.`,
    cite: lastQ.externalId,
    tone: healthy ? "good" : inWindow ? "warn" : "butter",
  };
}

/* ── thread view ─────────────────────────────────────────────────── */

export interface Chip {
  label: string;
  tone: Tone;
  /** Dashed edge = an absence or an obligation, solid = an observation. */
  dashed: boolean;
}

export interface RecMessage {
  id: string;
  who: "advisor" | "client";
  text: string;
  time: string;
  /** Divider above the bubble, when the delay is worth naming. */
  gap: string;
  gapTone: Tone;
  chips: Chip[];
  flag: string;
  flagTone: Tone;
}

/**
 * Derived chips only. The design had emotion labels ("warm", "appreciative")
 * from an extraction pass that does not exist yet, so these are the things the
 * messages themselves can prove: a question mark, a cited promise, a reply that
 * opened nothing, a two-word answer.
 */
function chipsFor(m: SeedMessage, cited: Map<string, LedgerEntry>, starts: Set<string>, avg: number): Chip[] {
  const out: Chip[] = [];
  const entry = cited.get(m.externalId);

  if (entry) {
    out.push({
      label: entry.settledAt === undefined ? `${entry.kind} · open` : `${entry.kind} · settled`,
      tone: entry.settledAt === undefined ? "butter" : "good",
      dashed: entry.settledAt === undefined,
    });
  }
  if (isQuestion(m)) out.push({ label: "question", tone: "good", dashed: false });
  if (m.from === "client" && starts.has(m.externalId)) out.push({ label: "they opened this", tone: "good", dashed: false });
  if (m.from === "client" && !isQuestion(m) && m.text.length < Math.max(24, avg * 0.4)) {
    out.push({ label: `minimal · ${m.text.length} chars`, tone: "critical", dashed: false });
  }
  return out;
}

function recMessages(thread: SeedThread, ledgerBySource: Map<string, LedgerEntry>): RecMessage[] {
  const all = thread.messages;
  const starts = conversationStarts(all);
  const clientMsgs = all.filter((m) => m.from === "client");
  const avg = clientMsgs.reduce((n, m) => n + m.text.length, 0) / Math.max(1, clientMsgs.length);

  return all.map((m, i) => {
    const prev = i > 0 ? all[i - 1] : undefined;
    const delta = prev ? tsOf(m) - tsOf(prev) : 0;
    const isReply = prev !== undefined && prev.from !== m.from;

    // Only name a delay when it is long enough to be the story.
    const nameGap = isReply && delta > 6 * 3_600_000;
    const veryLong = delta > 24 * 3_600_000;

    const entry = ledgerBySource.get(m.externalId);
    const stillOpen = entry !== undefined && isOpen(entry);

    return {
      id: m.externalId,
      who: m.from,
      text: m.text,
      time: stamp.format(tsOf(m)),
      gap: nameGap ? humanGap(delta) : "",
      gapTone: veryLong ? "critical" : "warn",
      chips: chipsFor(m, ledgerBySource, starts, avg),
      flag: stillOpen ? `${entry.owedBy === "advisor" ? "you owe this" : "they owe this"} · open ${openDays(entry)} days` : "",
      flagTone: stillOpen ? "butter" : "good",
    };
  });
}

/* ── the client view ─────────────────────────────────────────────── */

export interface Fact { glyph: string; k: string; v: string }

export interface ClientView {
  key: ClientKey;
  id: string;
  name: string;
  initials: string;
  handle: string;
  thread: SeedThread;

  score: Score;
  tone: Tone;
  /** The word beside the colour. Never a colour alone. */
  statusWord: string;
  chipTone: string;
  headline: string;
  sub: string;

  messageCount: number;
  clientMessageCount: number;
  firstContact: number;
  lastContact: number;

  windows: Windows;
  open: LedgerEntry[];
  settledCount: number;
  ledgerLabel: string;
  ledgerTone: Tone;

  facts: Fact[];
  weeks: Week[];
  turn: Turn;
  messages: RecMessage[];

  /** Two-tone bar in the client list: butter = questions, dark = initiation. */
  w1: number;
  w2: number;

  bigA: string;
  bigB: string;
  bigBTone: Tone;
  heroA: string;
  heroB: string;
}

function statusWord(s: Score): string {
  if (s.silent) return "silent";
  if (s.status === "decaying") return "decaying";
  if (s.status === "watch") return "watch";
  return "healthy";
}

/** Ratio of a signal's recent value to its baseline, as a 0–100 bar width. */
function pctOf(recent: number, baseline: number): number {
  if (baseline <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((recent / baseline) * 100)));
}

function build(thread: SeedThread): ClientView {
  const w = windows(thread);
  const s = score(w);
  const led = ledgerFor(thread.key);
  const open = openEntries(thread.key);
  const bySource = new Map(led.entries.map((e) => [e.sourceMessageId, e]));
  const cited = new Set(open.map((e) => e.sourceMessageId));

  const first = thread.messages[0]!;
  const last = thread.messages[thread.messages.length - 1]!;
  const tone = toneOf(s);
  const clientCount = thread.messages.filter((m) => m.from === "client").length;

  const weeks = grid(thread, cited);
  bands(weeks, w, open, thread.key);

  const owedByYou = open.filter((e) => e.owedBy === "advisor").length;
  const ledgerLabel = open.length === 0
    ? "0 open"
    : `${open.length} open · ${owedByYou > 0 ? "yours" : "theirs"}`;

  const latency = s.signals.find((x) => x.name === "latency")!;
  const questions = s.signals.find((x) => x.name === "questions")!;

  return {
    key: thread.key,
    id: thread.key.toLowerCase(),
    name: thread.clientName,
    initials: initialsOf(thread.clientName),
    handle: thread.handle,
    thread,

    score: s,
    tone,
    statusWord: statusWord(s),
    chipTone: statusWord(s),
    headline: s.headline,
    sub: s.silent
      ? `Silent churn · ${open.length === 0 ? "nothing owed" : `${open.length} open`}`
      : s.status === "healthy"
        ? "Healthy · nothing owed"
        : `Decaying · ${ledgerLabel}`,

    messageCount: thread.messages.length,
    clientMessageCount: clientCount,
    firstContact: tsOf(first),
    lastContact: tsOf(last),

    windows: w,
    open,
    settledCount: led.entries.filter((e) => !isOpen(e)).length,
    ledgerLabel,
    ledgerTone: open.length === 0 ? "good" : owedByYou > 0 ? "critical" : "warn",

    facts: [
      { glyph: "◷", k: "First message", v: dateLong.format(tsOf(first)) },
      { glyph: "☏", k: "Phone", v: thread.handle },
      { glyph: "✉", k: "Channel", v: "WhatsApp only" },
      { glyph: "✦", k: "Messages", v: `${thread.messages.length} · ${clientCount} theirs` },
      { glyph: "◔", k: "Last contact", v: stamp.format(tsOf(last)) },
      { glyph: "⌂", k: "Adviser", v: ADVISOR },
    ],
    weeks,
    turn: turn(thread, w, s),
    messages: recMessages(thread, bySource),

    // butter bar = questions held vs baseline, dark bar = initiation held
    w1: Math.round(pctOf(w.recent.questionsPer30d, w.baseline.questionsPer30d) * 0.62),
    w2: Math.round(pctOf(w.recent.initiationRatio ?? 0, w.baseline.initiationRatio ?? 0) * 0.3),

    bigA: latency.recent,
    bigB: questions.recent === "0.0/mo" ? "0 questions" : `${questions.recent} questions`,
    bigBTone: questions.severity > 0.6 ? "critical" : questions.severity > 0.3 ? "serious" : "good",
    // Each hero washes the client's own status hue into the surface, so the
    // plate reads as a tint of the palette rather than as a new colour. Mixed
    // from tokens rather than written as hex, so it tracks the token set.
    heroA: `color-mix(in oklab, ${tone === "butter" ? "var(--m-warn)" : MARK[tone]} 26%, var(--card))`,
    heroB: "var(--card)",
  };
}

/* ── the set ─────────────────────────────────────────────────────── */

/**
 * `let`, not `const`, so live data can replace the seed without this file
 * knowing where threads come from.
 *
 * Both were computed once at module load, which was correct while the only
 * source was a static import. Convex data arrives after import and again on
 * every update, so they became rebuildable — and because ES module imports are
 * live views of the binding, reassigning them here updates every consumer
 * without a single call site changing. That is the whole reason main.ts needs
 * no rewrite to render live threads.
 */
export let clients: ClientView[] = [];
export let totals = emptyTotals();

function emptyTotals() {
  return {
    clients: 0, messages: 0, ledgerEntries: 0, discarded: 0, openItems: 0,
    owedByAdvisor: 0, owedByClient: 0, needAttention: 0, decaying: 0, silent: 0,
  };
}

/** Recompute the view model from a set of threads. Seed or live, same path. */
export function rebuild(source: SeedThread[]): void {
  clients = source
    .map(build)
    // Silent churn first: it's the case a human would never surface unaided.
    .sort((a, b) => Number(b.score.silent) - Number(a.score.silent) || b.score.composite - a.score.composite);

  totals = {
    clients: clients.length,
    messages: clients.reduce((n, c) => n + c.messageCount, 0),
    ledgerEntries: clients.reduce((n, c) => n + ledgerFor(c.key).entries.length, 0),
    discarded: clients.reduce((n, c) => n + ledgerFor(c.key).rejected.length, 0),
    openItems: clients.reduce((n, c) => n + c.open.length, 0),
    owedByAdvisor: clients.reduce((n, c) => n + c.open.filter((e) => e.owedBy === "advisor").length, 0),
    owedByClient: clients.reduce((n, c) => n + c.open.filter((e) => e.owedBy === "client").length, 0),
    needAttention: clients.filter((c) => c.score.status !== "healthy").length,
    decaying: clients.filter((c) => !c.score.silent && c.score.status === "decaying").length,
    silent: clients.filter((c) => c.score.silent).length,
  };
}

// The seed remains the default. Live mode overwrites this after boot; without
// it, the page behaves exactly as it did before any of this existed.
rebuild(threads);

export function clientById(id: string): ClientView {
  return clients.find((c) => c.id === id) ?? clients[0]!;
}

/**
 * Client messages per day over the last seven days, for the engagement tile.
 * The design showed a decimal "engagement score"; there is no such measure in
 * this build, so the tile plots the thing that actually exists — how much the
 * clients said, day by day.
 */
export const weekBars = (() => {
  const days: Array<{ day: string; count: number; label: string }> = [];
  for (let i = 6; i >= 0; i--) {
    const ms = NOW - i * DAY;
    const k = dayKey(ms);
    let count = 0;
    for (const c of clients) {
      for (const m of c.thread.messages) {
        if (m.from === "client" && dayKey(tsOf(m)) === k) count++;
      }
    }
    days.push({ day: (dayOfWeek.format(ms)[0] ?? "").toUpperCase(), count, label: dateShort.format(ms) });
  }
  const peak = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((n, d) => n + d.count, 0);
  // Label one bar, not every bar that ties for the peak: a value on every mark
  // is chaos and goes unread. The most recent peak is the one worth naming.
  const peakAt = days.reduce((best, d, i) => (d.count === peak && d.count > 0 ? i : best), -1);
  return {
    days: days.map((d, i) => ({
      ...d,
      height: Math.round((d.count / peak) * 100),
      isPeak: i === peakAt,
    })),
    total,
    peak,
    quietDays: days.filter((d) => d.count === 0).length,
  };
})();

/** Worst median reply latency across the book, for the reply-clock tile. */
export const replyClock = (() => {
  const ranked = [...clients].sort(
    (a, b) => (b.windows.recent.medianLatencyMin ?? 0) - (a.windows.recent.medianLatencyMin ?? 0),
  );
  const worst = ranked[0]!;
  const mins = worst.windows.recent.medianLatencyMin ?? 0;
  return {
    worst,
    value: fmtMinutes(mins),
    // 48h of latency fills the dial; anything past that is already terminal.
    degrees: Math.min(360, Math.round((mins / (48 * 60)) * 360)),
    key: ranked.map((c) => ({
      name: c.name.split(" ")[0] ?? c.name,
      value: fmtMinutes(c.windows.recent.medianLatencyMin),
      mark: c === worst ? "var(--butter)" : severityMark(c.score.signals.find((s) => s.name === "latency")!.severity),
    })),
  };
})();

export type { Score, SignalScore };
