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
import type { ClientKey, SeedThread } from "../data/types.ts";
import { initialsOf, rebuild, setDecayTempo } from "./derive.ts";
import { rebuildAgenda, shiftAgendaToDay } from "./agenda.ts";
import { setIdeas } from "./copy.ts";
import { setEmotions } from "./emotions.ts";
import type { Digest, EmotionSpan, KeyPoint } from "./emotions.ts";
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
export function initLive(onRender: () => void, onArrive?: (a: Arrival) => void): boolean {
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

    if (!primed) {
      for (const t of next) for (const m of t.messages) seen.add(m.externalId);
      primed = true;
    } else if (onArrive) {
      for (const t of next) {
        // Only the newest unseen message per client is announced. A burst of
        // five should grow the island once, not five times — and the latest is
        // the one worth reading.
        let latest: { text: string; at: string; cite: string; gapMs: number | null } | null = null;

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
          };
        });

        if (latest !== null) {
          const a = latest as { text: string; at: string; cite: string; gapMs: number | null };
          onArrive({
            key: t.key,
            clientName: t.clientName,
            initials: initialsOf(t.clientName),
            text: a.text,
            at: a.at,
            cite: a.cite,
            gapMs: a.gapMs,
          });
        }
      }
    }

    threads = next;
    ready = true;
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

  console.info(`[chadbuddy] live mode on — subscribed to ${url}`);
  return true;
}
