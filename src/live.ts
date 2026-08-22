/**
 * Live mode: the dashboard, fed by Convex instead of the seed.
 *
 * On in the desktop app, off in the browser. The Tauri window is the product,
 * so it shows real conversations and real agent output; a browser tab stays on
 * the seed, which keeps the reproducible demo and the frontend work in progress
 * unaffected by whether Convex happens to be running. `?live` and `?seed`
 * override either way.
 *
 * How it avoids rewriting the render model: everything downstream reads
 * `clients`, `totals` and `ideas` as imported bindings, and ES module imports
 * are live views of those bindings. Reassigning them at their source updates
 * every consumer at once. So this file moves the clock, rebuilds the view
 * model, swaps in the agent's recommendations, and asks for a render — and
 * main.ts needs to know almost nothing about it.
 *
 * Written in the defensive style of shell.ts: if Convex is unreachable, every
 * path degrades to the seed and the island keeps working. A backend that is
 * down must not take the UI with it.
 */

import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";

import { setNow } from "../data/clock.ts";
import { applyLiveStages } from "./book.ts";
import { refreshFunnel } from "./funnel.tsx";
import type { ClientKey, SeedThread } from "../data/types.ts";
import { initialsOf, rebuild, setDecayTempo } from "./derive.ts";
import { rebuildAgenda, shiftAgendaToDay } from "./agenda.ts";
import { setIdeas } from "./copy.ts";
import { setEmotions } from "./emotions.ts";
import type { Digest, EmotionSpan, KeyPoint } from "./emotions.ts";
import { setProposals } from "./proposals.ts";
import type { Proposal } from "./proposals.ts";
import { isTauri } from "./shell.ts";
import type { Idea } from "./copy.ts";

const params = new URLSearchParams(window.location.search);

/**
 * The deployment URL, baked in at build time by scripts/convex-url.ts.
 *
 * This was a hard-coded loopback address, on the reasoning that the value was
 * the same on every developer's machine. True of a self-hosted backend; not
 * true of Convex Cloud, where each deployment has its own hostname. So it now
 * follows `CONVEX_DEPLOYMENT` in .env.local.
 *
 * `typeof` rather than a plain read: if something bundles this module without
 * the define — a test harness, an editor's own type-check run — an undeclared
 * identifier throws on load, and live mode failing has to stay survivable.
 */
declare const __CONVEX_URL__: string;
const BUILT_URL = typeof __CONVEX_URL__ === "string" ? __CONVEX_URL__ : "";

/**
 * Loopback when nothing was configured, which is what a self-hosted deployment
 * answers on. `?convex=` overrides either way.
 */
const DEFAULT_URL = BUILT_URL || "http://127.0.0.1:3210";

/**
 * Decay on a timescale a person can watch.
 *
 * The real model compares a 30-day window against a 90-day baseline, which
 * cannot move while someone is looking at it. Live mode adds a quiet-time rule
 * on top — half an hour without a word is "going quiet", a day is "silent" —
 * so the states are reachable in a demo instead of theoretical.
 *
 * This is a demo tempo, not a claim about relationships: the four measured
 * signals still sit underneath, and the breakdown still shows what they say.
 * Overridable so the thresholds can be shortened further when showing someone.
 */
const DEMO_TEMPO = {
  decayAfterMs: Number(params.get("decayMin") ?? 30) * 60_000,
  silentAfterMs: Number(params.get("silentMin") ?? 24 * 60) * 60_000,
};

/** How often the clock is re-read. A minute, unless a demo wants it snappier. */
const TICK_MS = Number(params.get("tickSec") ?? 60) * 1_000;

/**
 * Live in the desktop app, seed in the browser, either overridable.
 *
 * The Tauri window is the product — an advisor running it wants their real
 * conversations, and it loads a bare URL with no query string to put `?live`
 * into. The browser stays on the seed so the reproducible demo, the screenshots
 * and the frontend work in progress are all unaffected by whether Convex
 * happens to be running.
 *
 *   ?live   force live anywhere
 *   ?seed   force seed anywhere, including in Tauri
 */
export const isLive = params.has("live") || (isTauri && !params.has("seed"));

const lookup = anyApi as unknown as Record<string, Record<string, unknown>>;
const q = (m: string, n: string): FunctionReference<"query"> =>
  lookup[m]?.[n] as FunctionReference<"query">;
const mut = (m: string, n: string): FunctionReference<"mutation"> =>
  lookup[m]?.[n] as FunctionReference<"mutation">;
const act = (m: string, n: string): FunctionReference<"action"> =>
  lookup[m]?.[n] as FunctionReference<"action">;

/**
 * Held so a mutation can be issued outside the subscription callbacks.
 * Undefined until initLive runs, which is also why queueSend refuses politely
 * rather than throwing something opaque when live mode is off.
 */
let convex: ConvexClient | undefined;

/**
 * Queue an approved draft for delivery.
 *
 * Deliberately not "send": the page cannot reach Telegram. It writes a row the
 * bridge picks up, which keeps the one irreversible step in the one process
 * that holds the socket — and leaves a record of what was approved.
 */
/**
 * Answer a proposal. Accepting books the slot server-side (Google when it is
 * connected, the local mirror when not) — the reply to the client is a
 * separate queueSend the caller makes, so the one irreversible act stays in
 * the same approval path every outgoing message takes.
 */
export async function acceptProposal(id: string): Promise<{ booked: boolean; reason?: string }> {
  if (!convex) throw new Error("Not connected to the backend — proposals need live mode.");
  return (await convex.action(act("scheduling", "accept"), { id })) as { booked: boolean; reason?: string };
}

export async function declineProposal(id: string): Promise<void> {
  if (!convex) throw new Error("Not connected to the backend — proposals need live mode.");
  await convex.mutation(mut("scheduling", "decline"), { id });
}

export async function queueSend(key: ClientKey, text: string, ideaRank?: string): Promise<string> {
  if (!convex) throw new Error("Not connected to the backend — sending needs live mode.");
  const res = (await convex.mutation(mut("outbox", "queueSend"), {
    key,
    text,
    ...(ideaRank === undefined ? {} : { ideaRank }),
  })) as { to: string };
  return res.to;
}

/**
 * Per-client facts that ride threads:list but are not messages: the platform
 * sourceId (for the Telegram deep link) and the email on file. Held here so
 * the render path can ask synchronously.
 */
const meta = new Map<string, { sourceId: string; email: string | null }>();

export function clientMeta(key: ClientKey): { sourceId: string; email: string | null } | null {
  return meta.get(key) ?? null;
}

/**
 * What the agent noticed about each person, verbatim-gated server-side.
 * Null means live mode is off or nothing has arrived yet — the seed notes
 * render instead. An empty array is a real answer: analysed, nothing noted.
 */
const notesLive = new Map<ClientKey, Array<{ text: string; cite: string; updatedAt: number }>>();
let notesReady = false;

export function liveNotes(key: ClientKey): Array<{ text: string; cite: string; updatedAt: number }> | null {
  if (!notesReady) return null;
  return notesLive.get(key) ?? [];
}

/**
 * The imported book, shaped exactly like data/holdings.ts rows so the desk
 * and importance pre-fill cannot tell which answered. Null until an import
 * exists — the seed remains the demo's book.
 */
interface HoldingRow {
  startIso?: string;
  hid: string;
  clientKey: string;
  name: string;
  kind: string;
  classes: string[];
  invested: number;
  value: number;
  value1yAgo: number;
  maturityIso?: string;
  lastUpdateIso: string;
}
let holdingRows: HoldingRow[] = [];

export function liveHoldings(): Array<{
  id: string;
  client: ClientKey;
  name: string;
  kind: "fund" | "structured" | "prs" | "plan";
  classes: string[];
  value: number;
  invested: number;
  series: number[];
  maturesAtIso?: string;
  startIso?: string;
  lastUpdateDaysAgo: number;
}> | null {
  if (holdingRows.length === 0) return null;
  const now = Date.now();
  return holdingRows.map((r) => ({
    id: r.hid,
    client: r.clientKey as ClientKey,
    name: r.name,
    kind: (["fund", "structured", "prs", "plan"].includes(r.kind) ? r.kind : "plan") as
      | "fund"
      | "structured"
      | "prs"
      | "plan",
    classes: r.classes,
    value: r.value,
    invested: r.invested,
    // Twelve points, linear from a year ago to now. Honest about what it is:
    // a 12-month change with a straight line between the endpoints, because
    // the CSV carries endpoints, not a NAV history.
    series: Array.from({ length: 12 }, (_, i) => r.value1yAgo + ((r.value - r.value1yAgo) * i) / 11),
    ...(r.maturityIso ? { maturesAtIso: r.maturityIso } : {}),
    ...(r.startIso ? { startIso: r.startIso } : {}),
    lastUpdateDaysAgo: Math.max(
      0,
      Math.floor((now - (Date.parse(r.lastUpdateIso) || now)) / 86_400_000),
    ),
  }));
}

/** The Ask panel's real backend. Throws plainly when live mode is off. */
export async function askAgent(
  key: ClientKey,
  question: string,
): Promise<{ answer: string; cites: string[]; uncited: boolean }> {
  if (!convex) throw new Error("Not connected to the backend.");
  const lookupA = anyApi as unknown as Record<string, Record<string, unknown>>;
  return (await convex.action(
    lookupA["agent"]?.["ask"] as FunctionReference<"action">,
    { key, question },
  )) as { answer: string; cites: string[]; uncited: boolean };
}

/**
 * The live market feed, when the hourly sweep has produced one.
 *
 * Null means "no live rows" — the desk falls back to the curated seed, so an
 * RSS outage can never blank the section. Shaped here into the exact type
 * data/market.ts exports, which is what lets the desk not care.
 */
let marketRows: Array<{
  _id: string;
  ts: number;
  headline: string;
  summary: string;
  lean: string;
  classes: string[];
  sourceName: string;
  sourceUrl: string;
  impactNote: string;
}> = [];

export function liveMarketEvents(): Array<{
  id: string;
  agoHours: number;
  headline: string;
  summary: string;
  lean: "pressure" | "relief" | "watch";
  classes: string[];
  source: { name: string; url: string };
  impactNote: string;
}> | null {
  if (marketRows.length === 0) return null;
  const now = Date.now();
  return marketRows.map((r) => ({
    id: r._id,
    agoHours: Math.max(1, Math.round((now - r.ts) / 3_600_000)),
    headline: r.headline,
    summary: r.summary,
    lean: r.lean === "pressure" ? "pressure" : r.lean === "relief" ? "relief" : "watch",
    classes: r.classes,
    source: { name: r.sourceName, url: r.sourceUrl },
    impactNote: r.impactNote,
  }));
}

/** Send an email through the deployment. Throws plainly when not connected. */
export async function sendEmail(key: ClientKey, subject: string, text: string): Promise<void> {
  if (!convex) throw new Error("Not connected to the backend — email needs live mode.");
  const to = meta.get(key)?.email;
  if (!to) throw new Error("No email on file for this client — add one in Basic information.");
  const lookup2 = anyApi as unknown as Record<string, Record<string, unknown>>;
  await convex.action(
    lookup2["email"]?.["send"] as FunctionReference<"action">,
    { to, subject, text },
  );
}

/** Store the client's email on the backend, where it survives reinstalls. */
export async function setClientEmail(key: ClientKey, email: string): Promise<void> {
  if (!convex) throw new Error("Not connected to the backend — saving needs live mode.");
  await convex.mutation(mut("ingest", "setEmail"), { key, email });
  const m2 = meta.get(key);
  if (m2) meta.set(key, { ...m2, email: email.trim() === "" ? null : email.trim() });
}

/**
 * The connected client, for modules that issue their own calls.
 *
 * Undefined until initLive has run and succeeded, which is the signal
 * convexCalendar.ts uses to decide whether there is a live calendar to point
 * at — the same "no backend, no change" posture the rest of this file takes.
 */
export function convexClient(): ConvexClient | undefined {
  return convex;
}

interface IdeaRow extends Idea {
  generatedTs: number;
  model: string;
}

/** A message that genuinely just arrived, for the island to announce. */
export interface Arrival {
  key: ClientKey;
  clientName: string;
  initials: string;
  text: string;
  at: string;
  /** The message's own id, so anything derived from it stays traceable. */
  cite: string;
  /** Gap since the previous message in that thread, or null if it's the first. */
  gapMs: number | null;
  /** How it arrived, when not typed in chat. */
  via?: "voice" | "call" | "email";
}

/** Whatever is ringing right now, or null. */
export interface Ring {
  sourceId: string;
  name: string;
}

/**
 * Connect and keep the view model in step with the database.
 *
 * `onRender` is called after each update rather than this module importing
 * main.ts, which would be a cycle; `onArrive` fires for client messages that
 * appear after the first payload. Returns false if live mode wasn't asked for
 * or the client could not be constructed, so the caller can carry on with the
 * seed.
 */
export function initLive(
  onRender: () => void,
  onArrive?: (a: Arrival) => void,
  onRing?: (r: Ring | null) => void,
): boolean {
  if (!isLive) return false;

  const url = params.get("convex") ?? DEFAULT_URL;

  let client: ConvexClient;
  try {
    client = new ConvexClient(url);
    convex = client;
  } catch (err) {
    console.error("[chadbuddy] live mode requested but Convex client failed to start", err);
    return false;
  }

  let threads: SeedThread[] = [];
  let ready = false;
  let clockMoved = false;

  const apply = (): void => {
    // Wait for the first threads payload. Rendering an empty book would flash
    // "all steady" before the data lands, which reads as a real answer.
    if (!ready) return;

    /**
     * The clock moves only once real data has arrived — not at connect time.
     *
     * Moving it up front looked equivalent and was not: if Convex is
     * unreachable the subscription never fires, the seed stays on screen, and
     * an unfrozen clock would date those fixed threads to whenever you happened
     * to open the app. Every window in derive/signals/score measures from NOW,
     * so a healthy seed client would render as months silent. Failing back to
     * the seed has to fail back completely.
     */
    if (!clockMoved) {
      setNow(Date.now());
      shiftAgendaToDay(Date.now());
      setDecayTempo(DEMO_TEMPO);
      clockMoved = true;
      startDayTicker();
    }

    rebuild(threads);
    onRender();
  };

  /**
   * Keep the day moving.
   *
   * The Day page's countdowns are computed against NOW, and NOW no longer
   * stands still in live mode — so "in 1h 15m" would be however stale the tab
   * is. A minute is the right cadence: the page shows whole minutes, so
   * anything finer redraws without changing a character.
   *
   * The seed path never starts this. Its clock is frozen deliberately, and a
   * ticking countdown there would make the demo unreproducible.
   */
  const startDayTicker = (): void => {
    window.setInterval(() => {
      setNow(Date.now());
      rebuildAgenda();
      // Also rebuilds the book: a client crosses into decaying by the clock
      // moving, not by anything arriving, so nothing else would notice.
      rebuild();
      onRender();
    }, TICK_MS);
  };

  /**
   * Every message id already accounted for.
   *
   * Seeded from the first payload *without* announcing anything, which is the
   * whole reason it exists. A backfill can deliver months of history in one
   * update, and firing the island for each would turn the first second of the
   * app into a notification storm of conversations the advisor had long ago.
   * Only messages that appear after the app is watching are arrivals.
   */
  const seen = new Set<string>();
  let primed = false;

  client.onUpdate(q("threads", "list"), {}, (value) => {
    const next = value as SeedThread[];

    for (const row of value as Array<{ key: string; sourceId?: string; email?: string | null }>) {
      meta.set(row.key, { sourceId: row.sourceId ?? "", email: row.email ?? null });
    }

    if (!primed) {
      for (const t of next) for (const m of t.messages) seen.add(m.externalId);
      primed = true;
    } else if (onArrive) {
      for (const t of next) {
        // Only the newest unseen message per client is announced. A burst of
        // five should grow the island once, not five times — and the latest is
        // the one worth reading.
        let latest: { text: string; at: string; cite: string; gapMs: number | null; via?: "voice" | "call" | "email" } | null = null;

        t.messages.forEach((m, i) => {
          if (seen.has(m.externalId)) return;
          seen.add(m.externalId);
          if (m.from !== "client") return; // the advisor's own replies are not news
          const prev = i > 0 ? t.messages[i - 1] : undefined;
          latest = {
            text: m.text,
            at: m.at,
            cite: m.externalId,
            gapMs: prev ? Date.parse(m.at) - Date.parse(prev.at) : null,
            ...(m.via ? { via: m.via } : {}),
          };
        });

        if (latest !== null) {
          const a = latest as { text: string; at: string; cite: string; gapMs: number | null; via?: "voice" | "call" | "email" };
          onArrive({
            key: t.key,
            clientName: t.clientName,
            initials: initialsOf(t.clientName),
            text: a.text,
            at: a.at,
            cite: a.cite,
            gapMs: a.gapMs,
            ...(a.via ? { via: a.via } : {}),
          });
        }
      }
    }

    threads = next;
    ready = true;
    apply();
  });

  client.onUpdate(q("stages", "list"), {}, (value) => {
    const rows = value as Array<{ clientKey: string; stage: string; why: string; cite: string }>;
    applyLiveStages(rows);
    refreshFunnel();
    apply();
  });

  client.onUpdate(q("calls", "ringingNow"), {}, (value) => {
    const rows = value as Array<{ sourceId: string; name: string; startedTs: number }>;
    onRing?.(rows[0] ?? null);
  });

  client.onUpdate(q("holdings", "list"), {}, (value) => {
    holdingRows = value as HoldingRow[];
    apply();
  });

  client.onUpdate(q("news", "list"), {}, (value) => {
    marketRows = value as typeof marketRows;
    apply();
  });

  client.onUpdate(q("threads", "notes"), {}, (value) => {
    const rows = value as Array<{ key: string; notes: Array<{ text: string; cite: string; updatedAt: number }> }>;
    notesLive.clear();
    for (const row of rows) notesLive.set(row.key, row.notes);
    notesReady = true;
    apply();
  });

  client.onUpdate(q("threads", "ideas"), {}, (value) => {
    const rows = value as Array<{ key: string; ideas: IdeaRow[] }>;
    const next: Record<ClientKey, Idea[]> = {};
    for (const row of rows) {
      // Rank is what orders the panel, and the agent emits it as a string.
      next[row.key] = row.ideas
        .slice()
        .sort((a, b) => a.rank.localeCompare(b.rank, undefined, { numeric: true }))
        .map((i) => ({
          rank: i.rank,
          title: i.title,
          why: i.why,
          draftLabel: i.draftLabel,
          draft: i.draft,
          btn: i.btn,
          meta: i.meta,
          intent: i.intent,
          cites: i.cites,
          ...(i.rank === "1" ? { primary: true } : {}),
        }));
    }
    setIdeas(next);
    apply();
  });

  client.onUpdate(q("emotions", "forAll"), {}, (value) => {
    const rows = value as Array<{
      key: string;
      rows: EmotionSpan[];
      points?: KeyPoint[];
      digest?: Digest | null;
    }>;
    const next: Record<string, EmotionSpan[]> = {};
    const points: Record<string, KeyPoint[]> = {};
    const digests: Record<string, Digest> = {};
    for (const row of rows) {
      next[row.key] = row.rows;
      points[row.key] = row.points ?? [];
      if (row.digest) digests[row.key] = row.digest;
    }
    setEmotions(next, points, digests);
    apply();
  });

  client.onUpdate(q("scheduling", "proposals"), {}, (value) => {
    setProposals(value as Proposal[]);
    apply();
  });

  console.info(`[chadbuddy] live mode on — subscribed to ${url}`);
  return true;
}
