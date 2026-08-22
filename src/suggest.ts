/**
 * The task-suggestion seam.
 *
 * Same shape as src/tasks.ts: the page reads `suggestions()` synchronously
 * and never learns whether Convex or the seed answered. Live mode subscribes
 * to the review queue the model fills from the chats (convex/suggestions.ts);
 * seed mode carries three authored suggestions whose cites are real seed
 * messages, resolved in localStorage so a dismissal survives a refresh.
 *
 * A suggestion becomes a task only through `resolveSuggestion(id, true)` —
 * a person's click. The model proposes; it never files.
 */

import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";
import type { ClientKey } from "../data/types.ts";
import { nowMs } from "./daysource.ts";
import { convexClient } from "./live.ts";
import type { TaskCat } from "./tasks.ts";
import { taskCreate } from "./tasks.ts";

export interface Suggestion {
  id: string;
  clientKey: ClientKey;
  title: string;
  dueMs: number;
  why: string;
  cite?: string;
  kind?: TaskCat;
}

const DAY = 86_400_000;
const STORE = "cb-sugg-v1";

const lookup = anyApi as unknown as Record<string, Record<string, unknown>>;

let rows: Suggestion[] = [];
let live = false;
let notify: () => void = () => {};

/* ── seed fallback ────────────────────────────────────────────────── */

function seedSuggestions(): Suggestion[] {
  const today = new Date(nowMs());
  today.setHours(12, 0, 0, 0);
  const noon = today.getTime();
  return [
    {
      id: "S-1",
      clientKey: "A",
      title: "Set up Priya's 5% gold fund allocation",
      dueMs: noon + 2 * DAY,
      why: "She agreed to 5% in gold, held as a fund rather than physical.",
      cite: "A-068",
      kind: "outreach",
    },
    {
      id: "S-2",
      clientKey: "B",
      title: "Offer Faizal two slots for next week",
      dueMs: noon + 4 * DAY,
      why: "He said this week is hard and next week is better.",
      cite: "B-041",
      kind: "outreach",
    },
    {
      id: "S-3",
      clientKey: "C",
      title: "Draft Michelle's written summary",
      dueMs: noon + 1 * DAY,
      why: "She asked for a written summary instead of a call this quarter.",
      cite: "C-051",
      kind: "email",
    },
  ];
}

function resolvedLocal(): Set<string> {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* private mode: nothing remembered */
  }
  return new Set();
}

function rememberLocal(id: string): void {
  try {
    const seen = resolvedLocal();
    seen.add(id);
    localStorage.setItem(STORE, JSON.stringify([...seen]));
  } catch {
    /* private mode: the dismissal lasts the session */
  }
}

/* ── the seam ─────────────────────────────────────────────────────── */

/** Pending suggestions, soonest deadline first. */
export function suggestions(): Suggestion[] {
  return rows;
}

export function initSuggest(onChange: () => void): void {
  notify = onChange;
  const client = convexClient();

  if (!client) {
    const gone = resolvedLocal();
    rows = seedSuggestions().filter((s) => !gone.has(s.id));
    notify();
    return;
  }

  live = true;
  client.onUpdate(
    lookup["suggestions"]?.["pending"] as FunctionReference<"query">,
    {},
    (value) => {
      const raw = value as Array<{
        _id: string;
        clientKey: string;
        title: string;
        dueMs: number;
        why: string;
        cite?: string;
        kind?: TaskCat;
      }>;
      rows = raw.map((r) => ({
        id: r._id,
        clientKey: r.clientKey as ClientKey,
        title: r.title,
        dueMs: r.dueMs,
        why: r.why,
        ...(r.cite ? { cite: r.cite } : {}),
        ...(r.kind ? { kind: r.kind } : {}),
      }));
      notify();
    },
  );
}

/** The person's verdict. Accept files the task; either way the card leaves. */
export async function resolveSuggestion(id: string, accept: boolean): Promise<void> {
  const client = convexClient();
  if (live && client) {
    await client.mutation(
      lookup["suggestions"]?.["resolve"] as FunctionReference<"mutation">,
      { id, accept },
    );
    return;
  }
  const s = rows.find((x) => x.id === id);
  if (!s) return;
  if (accept) {
    await taskCreate({
      title: s.title,
      dueMs: s.dueMs,
      clientKey: s.clientKey,
      ...(s.cite ? { cite: s.cite } : {}),
      ...(s.kind ? { kind: s.kind } : {}),
      ref: `sugg:${s.id}`,
      source: "chadbuddy",
    });
  }
  rememberLocal(id);
  rows = rows.filter((x) => x.id !== id);
  notify();
}

/**
 * The on-demand pass, for the demo: "read the chats now". Resolves with how
 * many new suggestions were added — the subscription delivers them — or null
 * in seed mode, where there is no model to ask.
 */
export async function runSuggest(): Promise<number | null> {
  const client = convexClient();
  if (!live || !client) return null;
  const added = (await client.action(
    lookup["suggestions"]?.["runNow"] as FunctionReference<"action">,
    {},
  )) as number;
  return added;
}
