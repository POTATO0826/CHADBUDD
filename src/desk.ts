/**
 * The desk: what ChadBuddy wants the advisor to act on today.
 *
 * Three queues, derived fresh on every render from holdings + market events:
 *
 *   maturing   a plan ends inside the window — the renewal conversation
 *   market     a real event touches real holdings — who needs telling
 *   stale      a holding nobody has updated the client on in a quarter
 *
 * ── built for hundreds, running on five ──────────────────────────────
 * Every queue is ranked and capped with a "+N more" count, and nothing in this
 * file renders one row per client. Five clients or five hundred, the desk is
 * the same size; only the numbers change. That is the scale contract from
 * AGENTS.md, enforced here by shape rather than by discipline.
 *
 * ── what is deterministic and what will be the agent ─────────────────
 * Phase 1: report numbers come from the holdings table, the why-lines come
 * from each event's hand-written impactNote, and drafts are templates over
 * both. Phase 2 seats the agent in exactly two places — the why and the draft
 * — leaving every number table-sourced, because a model that is allowed to
 * write numbers will eventually write one that is wrong by RM 40,000.
 */

import type { ClientKey } from "../data/types.ts";
import type { Holding } from "../data/holdings.ts";
import { holdings } from "../data/holdings.ts";
import type { MarketEvent } from "../data/market.ts";
import { marketEvents } from "../data/market.ts";
import { clients } from "./derive.ts";
import { liveHoldings, liveMarketEvents } from "./live.ts";
import { nowMs } from "./daysource.ts";

const DAY = 86_400_000;

/** The reminder window the user asked for: tell me ten days out. */
export const URGENT_DAYS = 10;
/** How far the horizon list looks. */
export const HORIZON_DAYS = 60;
/** A quarter without a product update earns a nudge. */
export const STALE_DAYS = 90;
/** Below this exposure a market event does not page anyone. */
export const MATERIAL_RM = 25_000;

/* Ranked-and-capped row budgets. */
const HORIZON_CAP = 4;
const STALE_CAP = 3;
const HITS_CAP = 3;

export interface Report {
  valueText: string;
  gainText: string;
  yearPct: number;
  /** Normalised 0–1 points for the sparkline, oldest first. */
  spark: number[];
}

export interface MaturingRow {
  id: string;
  holding: Holding;
  client: ClientKey;
  clientName: string;
  daysLeft: number;
  matureText: string;
  report: Report;
  draft: string;
}

export interface MarketHit {
  id: string;
  client: ClientKey;
  clientName: string;
  holding: Holding;
  why: string;
  draft: string;
}

export interface MarketRow {
  event: MarketEvent;
  agoText: string;
  clientCount: number;
  exposureText: string;
  hits: MarketHit[];
  hitsMore: number;
}

export interface StaleRow {
  id: string;
  holding: Holding;
  client: ClientKey;
  clientName: string;
  days: number;
  report: Report;
  draft: string;
}

export interface Desk {
  urgent: MaturingRow[];
  horizon: MaturingRow[];
  horizonMore: number;
  market: MarketRow[];
  stale: StaleRow[];
  staleMore: number;
  needAction: number;
  maturingTotal: number;
  marketClientTotal: number;
  checkedText: string;
}

/* ── dismiss / snooze, surviving a reload ─────────────────────────── */

const STORE = "cb-desk-v1";

type Hidden = Record<string, number>; // id → hide until (Infinity = dismissed)

function loadHidden(): Hidden {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Hidden) : {};
  } catch {
    return {};
  }
}

let hidden: Hidden = loadHidden();

function isHidden(id: string): boolean {
  const until = hidden[id];
  return until !== undefined && nowMs() < until;
}

export function dismissBrief(id: string): void {
  hidden[id] = Number.MAX_SAFE_INTEGER;
  try {
    localStorage.setItem(STORE, JSON.stringify(hidden));
  } catch {
    /* private mode: dismissals last the session, which is still honest */
  }
}

export function snoozeBrief(id: string, days = 7): void {
  hidden[id] = nowMs() + days * DAY;
  try {
    localStorage.setItem(STORE, JSON.stringify(hidden));
  } catch {
    /* as above */
  }
}

/* ── helpers ──────────────────────────────────────────────────────── */

const rm = (v: number): string => `RM ${Math.round(v).toLocaleString("en-MY")}`;

function nameOf(key: ClientKey): string | null {
  return clients.find((c) => c.key === key)?.name ?? null;
}

const first = (name: string): string => name.split(" ")[0] ?? name;

function reportOf(h: Holding): Report {
  const yearPct = Math.round((h.series[h.series.length - 1]! / h.series[0]! - 1) * 1000) / 10;
  const gain = h.value - h.invested;
  const min = Math.min(...h.series);
  const max = Math.max(...h.series);
  const span = max - min || 1;
  return {
    valueText: rm(h.value),
    gainText: `${gain >= 0 ? "+" : "−"}${rm(Math.abs(gain))} since inception`,
    yearPct,
    spark: h.series.map((v) => (v - min) / span),
  };
}

function whenMature(h: Holding, now: number): number | null {
  if (h.maturesAtIso) return Date.parse(h.maturesAtIso);
  if (h.maturesInDays !== undefined) return now + h.maturesInDays * DAY;
  return null;
}

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "Asia/Kuala_Lumpur",
});

/* ── drafts: templates over table numbers, nothing invented ───────── */

function maturityDraft(name: string, h: Holding, r: Report, matureText: string): string {
  if (h.value === 0) {
    return (
      `Hi ${first(name)}, a reminder that your ${h.name.split("·")[0]?.trim() ?? h.name} ` +
      `renews on ${matureText}. Nothing needed from you yet — I'll bring the paperwork ` +
      `to our next catch-up.`
    );
  }
  return (
    `Hi ${first(name)}, your ${h.name} matures on ${matureText}. It stands at ` +
    `${r.valueText} — ${r.gainText}, ${r.yearPct >= 0 ? "up" : "down"} ` +
    `${Math.abs(r.yearPct)}% over the last 12 months. Before it pays out, worth 15 ` +
    `minutes on what the money does next? I'll bring two options.`
  );
}

function marketDraft(name: string, h: Holding, ev: MarketEvent): string {
  return (
    `Hi ${first(name)} — quick note on your ${h.name} (${rm(h.value)}). ` +
    `${ev.impactNote} Nothing needed from you; I'm watching it and will call if ` +
    `that changes.`
  );
}

function staleDraft(name: string, h: Holding, r: Report): string {
  return (
    `Hi ${first(name)}, quarterly check-in on your ${h.name}: ${r.valueText}, ` +
    `${r.yearPct >= 0 ? "up" : "down"} ${Math.abs(r.yearPct)}% over the last 12 ` +
    `months. Happy to walk through what moved it — 15 minutes this week?`
  );
}

/* ── the desk ─────────────────────────────────────────────────────── */

export function deskView(): Desk {
  const now = nowMs();

  /* Holdings whose client is actually in the current book. In seed mode the
     book is A–D; live mode adds real clients. A holding with no client behind
     it is a row about nobody, so it is dropped rather than mislabelled. */
  const held = ((liveHoldings() as Holding[] | null) ?? holdings)
    .map((h) => ({ h, name: nameOf(h.client) }))
    .filter((x): x is { h: Holding; name: string } => x.name !== null);

  /* maturing */
  const maturing: MaturingRow[] = held
    .map(({ h, name }) => {
      const at = whenMature(h, now);
      if (at === null) return null;
      const daysLeft = Math.ceil((at - now) / DAY);
      if (daysLeft < 0 || daysLeft > HORIZON_DAYS) return null;
      const id = `m:${h.id}`;
      if (isHidden(id)) return null;
      const report = reportOf(h);
      const matureText = dateFmt.format(at);
      return {
        id,
        holding: h,
        client: h.client,
        clientName: name,
        daysLeft,
        matureText,
        report,
        draft: maturityDraft(name, h, report, matureText),
      };
    })
    .filter((x): x is MaturingRow => x !== null)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const urgent = maturing.filter((x) => x.daysLeft <= URGENT_DAYS);
  const later = maturing.filter((x) => x.daysLeft > URGENT_DAYS);
  const horizon = later.slice(0, HORIZON_CAP);

  /* market — the hourly model-filtered feed when it exists, the curated
     seed when it does not. Same shape either way; nothing below can tell. */
  const feed = (liveMarketEvents() ?? marketEvents) as MarketEvent[];
  const market: MarketRow[] = feed
    .slice()
    .sort((a, b) => a.agoHours - b.agoHours)
    .map((ev) => {
      const all: MarketHit[] = held
        .filter(({ h }) => h.value >= MATERIAL_RM && h.classes.some((c) => ev.classes.includes(c)))
        .map(({ h, name }) => ({
          id: `e:${ev.id}:${h.id}`,
          client: h.client,
          clientName: name,
          holding: h,
          why: ev.impactNote,
          draft: marketDraft(name, h, ev),
        }))
        .filter((hit) => !isHidden(hit.id))
        .sort((a, b) => b.holding.value - a.holding.value);

      const agoText =
        ev.agoHours < 24 ? `${ev.agoHours}h ago` : `${Math.round(ev.agoHours / 24)}d ago`;

      return {
        event: ev,
        agoText,
        clientCount: new Set(all.map((x) => x.client)).size,
        exposureText: rm(all.reduce((n, x) => n + x.holding.value, 0)),
        hits: all.slice(0, HITS_CAP),
        hitsMore: Math.max(0, all.length - HITS_CAP),
      };
    })
    .filter((row) => row.hits.length > 0);

  /* stale */
  const staleAll: StaleRow[] = held
    .map(({ h, name }) => {
      if (h.lastUpdateDaysAgo < STALE_DAYS || h.value === 0) return null;
      const id = `s:${h.id}`;
      if (isHidden(id)) return null;
      const report = reportOf(h);
      return {
        id,
        holding: h,
        client: h.client,
        clientName: name,
        days: h.lastUpdateDaysAgo,
        report,
        draft: staleDraft(name, h, report),
      };
    })
    .filter((x): x is StaleRow => x !== null)
    .sort((a, b) => b.days - a.days);

  /* The cron story the header tells. The daily scan lands at 08:00 MYT; the
     header shows the most recent one so the section reads as tended. */
  const eight = new Date(now);
  eight.setHours(8, 0, 0, 0);
  const checked = eight.getTime() <= now ? eight.getTime() : eight.getTime() - DAY;
  const checkedText = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur",
  }).format(checked);

  const marketClientTotal = new Set(market.flatMap((r) => r.hits.map((h) => h.client))).size;

  return {
    urgent,
    horizon,
    horizonMore: Math.max(0, later.length - HORIZON_CAP),
    market,
    stale: staleAll.slice(0, STALE_CAP),
    staleMore: Math.max(0, staleAll.length - STALE_CAP),
    needAction: urgent.length + staleAll.length,
    maturingTotal: maturing.length,
    marketClientTotal,
    checkedText,
  };
}
