/**
 * The task layer the calendar draws.
 *
 * Same seam philosophy as src/daysource.ts: the page reads `tasks()`
 * synchronously and never learns whether Convex or localStorage answered.
 * Live mode subscribes to the deployment — so a task ChadBuddy creates
 * server-side appears without a refresh, and two windows agree. Seed mode
 * keeps everything in localStorage so the browser demo stays reproducible
 * and needs no backend.
 *
 * ── what a task is here ──────────────────────────────────────────────
 * Dated work only. The rule lives in convex/tasks.ts and is repeated where
 * the desk decides what to offer a "Plan it" button: no date by which the
 * thing stops being optional, no task. Undated obligations stay on the desk.
 *
 * ── urgency, computed one way ────────────────────────────────────────
 * `urgencyOf` is the single source of the closer-is-darker rule the three
 * calendar views share. Overdue is its own state, not "very urgent": a
 * missed deadline is a fact to be looked at, and it wears the alarm colour
 * nothing else on the calendar is allowed to.
 */

import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";
import type { ClientKey } from "../data/types.ts";
import { nowMs } from "./daysource.ts";
import { convexClient } from "./live.ts";

export interface Task {
  id: string;
  title: string;
  /** The deadline, and the plan. Day-granular. */
  dueMs: number;
  clientKey?: ClientKey;
  /** The immovable fact underneath, where there is one. */
  hardMs?: number;
  source: "advisor" | "chadbuddy";
  ref?: string;
  cite?: string;
  done: boolean;
}

const DAY = 86_400_000;
const STORE = "cb-tasks-v1";

const lookup = anyApi as unknown as Record<string, Record<string, unknown>>;
const q = (m: string, n: string): FunctionReference<"query"> =>
  lookup[m]?.[n] as FunctionReference<"query">;
const mut = (m: string, n: string): FunctionReference<"mutation"> =>
  lookup[m]?.[n] as FunctionReference<"mutation">;

let rows: Task[] = [];
let live = false;
let notify: () => void = () => {};

/* ── local fallback ───────────────────────────────────────────────── */

let localSeq = 1;

function loadLocal(): Task[] {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const parsed = JSON.parse(raw) as { seq: number; rows: Task[] };
      localSeq = parsed.seq;
      return parsed.rows;
    }
  } catch {
    /* private mode: start fresh */
  }
  return seedTasks();
}

function saveLocal(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify({ seq: localSeq, rows }));
  } catch {
    /* private mode: tasks last the session */
  }
}

/**
 * Three seeded tasks, offsets from now so the demo always has a today.
 * Each is the kind of thing the rule admits: a real date underneath.
 */
function seedTasks(): Task[] {
  const today = startOfDayMs(nowMs());
  localSeq = 4;
  return [
    {
      id: "T-1",
      title: "Send Adrian the fund comparison",
      dueMs: today + 12 * 3_600_000,
      clientKey: "D",
      // The 13:15 is the fact underneath: arriving without it is the failure.
      hardMs: today + 13.25 * 3_600_000,
      source: "chadbuddy",
      cite: "D-014",
      done: false,
    },
    {
      id: "T-2",
      title: "Renewal papers to Priya before her plan matures",
      dueMs: today + 6 * DAY,
      clientKey: "A",
      hardMs: today + 8 * DAY,
      source: "chadbuddy",
      done: false,
    },
    {
      id: "T-3",
      title: "Quarterly statements batch — send by Friday",
      dueMs: today + 3 * DAY,
      source: "advisor",
      done: false,
    },
  ];
}

function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* ── the seam ─────────────────────────────────────────────────────── */

/** Everything not done, plus today's finished ones (the contract shows both). */
export function tasks(): Task[] {
  return rows;
}

export function tasksOn(dayMs: number): Task[] {
  const day = startOfDayMs(dayMs);
  return rows
    .filter((t) => startOfDayMs(t.dueMs) === day)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.dueMs - b.dueMs);
}

export type Urgency = "over" | "today" | "soon" | "week" | "far";

/** The one closer-is-darker rule all three views share. */
export function urgencyOf(t: Task): Urgency {
  if (t.done) return "far";
  const days = Math.floor((startOfDayMs(t.dueMs) - startOfDayMs(nowMs())) / DAY);
  if (days < 0) return "over";
  if (days === 0) return "today";
  if (days <= 2) return "soon";
  if (days <= 7) return "week";
  return "far";
}

export function initTasks(onChange: () => void): void {
  notify = onChange;
  const client = convexClient();

  if (!client) {
    rows = loadLocal();
    notify();
    return;
  }

  live = true;
  client.onUpdate(q("tasks", "list"), {}, (value) => {
    const raw = value as Array<{
      _id: string;
      title: string;
      dueMs: number;
      clientKey?: string;
      hardMs?: number;
      source: "advisor" | "chadbuddy";
      ref?: string;
      cite?: string;
      done: boolean;
    }>;
    rows = raw
      .map((r) => ({
        id: r._id,
        title: r.title,
        dueMs: r.dueMs,
        ...(r.clientKey ? { clientKey: r.clientKey as ClientKey } : {}),
        ...(r.hardMs !== undefined ? { hardMs: r.hardMs } : {}),
        source: r.source,
        ...(r.ref ? { ref: r.ref } : {}),
        ...(r.cite ? { cite: r.cite } : {}),
        done: r.done,
      }))
      .sort((a, b) => a.dueMs - b.dueMs);
    notify();
  });
}

export async function taskCreate(t: {
  title: string;
  dueMs: number;
  clientKey?: ClientKey;
  hardMs?: number;
  source: "advisor" | "chadbuddy";
  ref?: string;
  cite?: string;
}): Promise<void> {
  const client = convexClient();
  if (live && client) {
    await client.mutation(mut("tasks", "create"), t);
    return;
  }
  // One task per fact, locally too.
  if (t.ref && rows.some((r) => r.ref === t.ref)) return;
  rows = [...rows, { ...t, id: `T-${localSeq++}`, done: false }].sort((a, b) => a.dueMs - b.dueMs);
  saveLocal();
  notify();
}

export async function taskMove(id: string, dueMs: number): Promise<void> {
  const client = convexClient();
  if (live && client) {
    await client.mutation(mut("tasks", "move"), { id, dueMs });
    return;
  }
  rows = rows.map((r) => (r.id === id ? { ...r, dueMs } : r)).sort((a, b) => a.dueMs - b.dueMs);
  saveLocal();
  notify();
}

export async function taskDone(id: string, done: boolean): Promise<void> {
  const client = convexClient();
  if (live && client) {
    await client.mutation(mut("tasks", "setDone"), { id, done });
    return;
  }
  rows = rows.map((r) => (r.id === id ? { ...r, done } : r));
  saveLocal();
  notify();
}

export async function taskRemove(id: string): Promise<void> {
  const client = convexClient();
  if (live && client) {
    await client.mutation(mut("tasks", "remove"), { id });
    return;
  }
  rows = rows.filter((r) => r.id !== id);
  saveLocal();
  notify();
}
