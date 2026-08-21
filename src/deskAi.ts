/**
 * The model's seat at the desk.
 *
 * Desk drafts and rail prep were templates wearing the assistant's name — the
 * exact gap the audit called out. This closes it: when live, each expanded
 * brief asks the model to write the prose once, against the digit-guard in
 * convex/agent.ts (`brief` refuses any figure not present in the facts), and
 * the result is cached — in memory and localStorage — so a draft costs one
 * call ever, not one per render.
 *
 * The template never leaves: it is the instant answer while the model writes,
 * the fallback when the guard refuses, and the whole answer in seed mode. The
 * label on screen says which one you are reading.
 */

import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";
import { convexClient } from "./live.ts";

const act = (m: string, n: string): FunctionReference<"action"> =>
  (anyApi as unknown as Record<string, Record<string, unknown>>)[m]?.[n] as FunctionReference<"action">;

export interface BriefReq {
  kind: string;
  facts: string;
  ask: string;
  key?: string;
}

export type AiState = "off" | "pending" | "ready" | "failed";

const STORE = "cb-deskai-v1";

const cache = new Map<string, { status: AiState; text: string }>();
let onChange: () => void = () => {};
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      for (const [id, text] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
        cache.set(id, { status: "ready", text });
      }
    }
  } catch {
    /* private mode: cache lasts the session */
  }
}

function persist(): void {
  try {
    const out: Record<string, string> = {};
    for (const [id, v] of cache) if (v.status === "ready") out[id] = v.text;
    localStorage.setItem(STORE, JSON.stringify(out));
  } catch {
    /* as above */
  }
}

export function initDeskAi(cb: () => void): void {
  onChange = cb;
  load();
}

/**
 * The model's text for this brief, or the reason there is none yet.
 *
 * First call with an id fires the request; every call after answers from the
 * cache. Never called with different `req` for the same id — the id embeds
 * what the brief is about, so a changed brief is a changed id.
 */
export function aiText(id: string, req: BriefReq): { status: AiState; text: string | null } {
  load();
  const client = convexClient();
  if (!client) return { status: "off", text: null };

  const hit = cache.get(id);
  if (hit) return { status: hit.status, text: hit.status === "ready" ? hit.text : null };

  cache.set(id, { status: "pending", text: "" });
  void client
    .action(act("agent", "brief"), req)
    .then((r) => {
      const res = r as { text: string; refused: string | null };
      if (res.refused !== null || res.text.trim() === "") {
        // The guard did its job — a refused draft is the system working, and
        // the template stands. Logged so the rate is observable.
        console.warn(`[chadbuddy] brief ${id} refused: ${res.refused}`);
        cache.set(id, { status: "failed", text: "" });
      } else {
        cache.set(id, { status: "ready", text: res.text });
        persist();
      }
      onChange();
    })
    .catch((err) => {
      console.error(`[chadbuddy] brief ${id} failed`, err);
      cache.set(id, { status: "failed", text: "" });
      onChange();
    });

  return { status: "pending", text: null };
}
