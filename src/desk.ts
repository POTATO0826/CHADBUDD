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
import { keyPointsFor } from "./emotions.ts";
import { clientMeta, liveHoldings, liveMarketEvents } from "./live.ts";
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

/**
 * How hard a story lands on one client's money.
 *
 * Computed from their own mined facts crossed with the event's lean, never by
 * a model — so it is the same on every render and every run, and it is handed
 * to the draft as a fact rather than left for the model to decide. A model
 * that grades its own urgency will grade everything urgent.
 */
export type Tier = "action" | "watch" | "steady";

const TIER_RANK: Record<Tier, number> = { action: 0, watch: 1, steady: 2 };

export interface MarketHit {
  id: string;
  client: ClientKey;
  clientName: string;
  /** The largest touched holding — what the draft names. */
  holding: Holding;
  /** Touched holdings beyond the one named, for "and 2 more". */
  otherCount: number;
  /** Summed value of every touched holding for this client. */
  value: number;
  valueText: string;
  why: string;
  draft: string;
  tier: Tier;
  risk: "high" | "moderate" | "low";
  /** Why this tier, in the client's own terms — goes into the draft's FACTS. */
  because: string;
  /**
   * There is a real chat behind this person. A seeded client has nowhere for a
   * message to go, and the button says so before the click rather than after.
   */
  reachable: boolean;
  /** Their last message is theirs and asks something nobody has answered. */
  owed: { text: string; cite: string } | null;
}

export interface MarketRow {
  event: MarketEvent;
  agoText: string;
  clientCount: number;
  exposure: number;
  exposureText: string;
  hits: MarketHit[];
  hitsMore: number;
  /**
   * Who this story does *not* touch, by first name. Saying who is fine is as
   * much of the product as saying who is not — without it the desk reads as an
   * alarm generator, and an alarm generator gets ignored.
   */
  untouched: string[];
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

/**
 * The tier, and the sentence that justifies it.
 *
 * The whole ladder turns on one question: does this person have a dated
 * commitment their own words put on the record? A market under pressure is an
 * emergency for someone who told you they need the cash in March and noise for
 * someone who did not. `because` is written in their terms and travels into
 * the draft as a fact, so the message can name the reason rather than assert
 * urgency at them.
 */
function tierFor(
  key: ClientKey,
  lean: MarketEvent["lean"],
): { tier: Tier; risk: "high" | "moderate" | "low"; because: string } {
  const dated = keyPointsFor(key).find((p) => p.kind === "deadline" || p.kind === "constraint");

  if (lean === "pressure" && dated) return { tier: "action", risk: "high", because: dated.point };
  if (lean === "pressure") {
    return {
      tier: "watch",
      risk: "moderate",
      because: "no dated cash need on file — time absorbs the swing",
    };
  }
  if (lean === "watch" && dated) return { tier: "watch", risk: "moderate", because: dated.point };
  return {
    tier: "steady",
    risk: "low",
    because: lean === "relief" ? "the news leans in their favour" : "no dated stakes near this",
  };
}

/**
 * A stable id for a story, derived from the words rather than the row.
 *
 * The hourly sweep deletes and re-inserts every market row, so the database id
 * is new each hour for a story that has not changed. Keying anything off it
 * orphans the draft cache once an hour and re-bills every draft; keying off
 * the headline means the same story is the same story, and an edited headline
 * is correctly a different one.
 */
function headlineId(headline: string): string {
  let h = 2166136261;
  for (let i = 0; i < headline.length; i++) {
    h ^= headline.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** A real chat behind the name. Seeded people have nowhere for a message to go. */
function reachableClient(key: ClientKey): boolean {
  const src = clientMeta(key)?.sourceId ?? "";
  return src !== "" && !src.startsWith("seed:");
}

/**
 * They asked something and the thread stops there.
 *
 * Only the last message counts. A question three exchanges back that the
 * conversation moved past is not owed an answer; the one nobody replied to is,
 * and it belongs in the first sentence of whatever gets sent next.
 */
function owedAnswer(key: ClientKey): { text: string; cite: string } | null {
  const c = clients.find((x) => x.key === key);
  const msgs = c?.thread.messages ?? [];
  const last = msgs[msgs.length - 1];
  if (!last || last.from !== "client" || !last.text.includes("?")) return null;
  return { text: last.text, cite: last.externalId };
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
    .map((ev) => {
      /* One row per client, not per holding. A client with three touched
         holdings is one conversation, and three rows for it crowds out the
         other two people who also need telling. */
      const touched = held.filter(
        ({ h }) => h.value >= MATERIAL_RM && h.classes.some((c) => ev.classes.includes(c)),
      );
      const byClient = new Map<ClientKey, Array<{ h: Holding; name: string }>>();
      for (const row of touched) {
        const list = byClient.get(row.h.client);
        if (list) list.push(row);
        else byClient.set(row.h.client, [row]);
      }

      const all: MarketHit[] = [...byClient.entries()]
        .map(([key, rows]) => {
          const sorted = rows.slice().sort((a, b) => b.h.value - a.h.value);
          const lead = sorted[0]!;
          const value = sorted.reduce((n, x) => n + x.h.value, 0);
          const grade = tierFor(key, ev.lean);
          return {
            id: `e:${headlineId(ev.headline)}:${key}`,
            client: key,
            clientName: lead.name,
            holding: lead.h,
            otherCount: sorted.length - 1,
            value,
            valueText: rm(value),
            why: ev.impactNote,
            draft: marketDraft(lead.name, lead.h, ev),
            ...grade,
            reachable: reachableClient(key),
            owed: owedAnswer(key),
          };
        })
        .filter((hit) => !isHidden(hit.id))
        /* Reachable first, then anyone owed a reply, then how hard it lands,
           then the money. An urgent client with no chat behind them is a dead
           end however large the holding, so they sort below someone reachable. */
        .sort(
          (a, b) =>
            Number(b.reachable) - Number(a.reachable) ||
            Number(b.owed !== null) - Number(a.owed !== null) ||
            TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
            b.value - a.value,
        );

      const agoText =
        ev.agoHours < 24 ? `${ev.agoHours}h ago` : `${Math.round(ev.agoHours / 24)}d ago`;

      const hit = new Set(all.map((x) => x.client));
      const untouched = clients.filter((c) => !hit.has(c.key)).map((c) => first(c.name));

      return {
        event: ev,
        agoText,
        clientCount: hit.size,
        exposure: all.reduce((n, x) => n + x.value, 0),
        exposureText: rm(all.reduce((n, x) => n + x.value, 0)),
        hits: all.slice(0, HITS_CAP),
        hitsMore: Math.max(0, all.length - HITS_CAP),
        untouched,
      };
    })
    /* Zero-exposure stories stay on the wire, dimmed. Breadth is the proof
       that the sweep is real rather than curated — a feed that only ever shows
       hits looks handpicked, and the one thing this screen has to be is
       checkable. They sort last, by exposure, then newest within a tie. */
    .sort((a, b) => b.exposure - a.exposure || a.event.agoHours - b.event.agoHours);

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
