import type { ClientKey, SeedThread } from "../types.ts";
import { tsOf } from "../types.ts";
import { clientA } from "./client-a.ts";
import { clientB } from "./client-b.ts";
import { clientC } from "./client-c.ts";
import { clientD } from "./client-d.ts";

export const threads: SeedThread[] = [clientA, clientB, clientC, clientD];

export function threadFor(key: ClientKey): SeedThread {
  const t = threads.find((x) => x.key === key);
  if (!t) throw new Error(`No seed thread for client ${key}`);
  return t;
}

/**
 * Cheap integrity pass. Runs on import so a bad hand-edit fails loudly rather
 * than quietly skewing a metric: ids must be globally unique and every thread
 * must be in chronological order.
 */
function assertWellFormed(): void {
  const seen = new Set<string>();
  for (const t of threads) {
    let prev = -Infinity;
    for (const m of t.messages) {
      if (seen.has(m.externalId)) throw new Error(`Duplicate externalId: ${m.externalId}`);
      seen.add(m.externalId);
      const ts = tsOf(m);
      if (ts < prev) throw new Error(`${m.externalId} is out of chronological order`);
      prev = ts;
    }
  }
}

assertWellFormed();
