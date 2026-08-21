/**
 * The ledger: what was promised, asked and disclosed — and whether it was ever
 * settled.
 *
 * The one rule that matters lives here. An entry whose `quote` cannot be found
 * verbatim in the message it cites is discarded, not shown with a caveat. That
 * holds whether the entry was hand-written (today) or produced by the Stage 3
 * extraction pass (later) — same gate, same function.
 */

import { NOW } from "../data/clock.ts";
import type { LedgerKind, LedgerSeed } from "../data/ledger-seed.ts";
import { ledgerSeed } from "../data/ledger-seed.ts";
import type { ClientKey } from "../data/types.ts";
import { tsOf } from "../data/types.ts";
import { threads } from "../data/threads/index.ts";

/** The Stage 3 output shape. Hand-seeded entries land in the same struct. */
export interface LedgerEntry {
  kind: LedgerKind;
  text: string;
  owedBy: "advisor" | "client";
  quote: string;
  sourceMessageId: string;
  openedAt: number;
  settledAt?: number;
  settledByMessageId?: string;
  confidence: number;
}

export interface Rejection {
  sourceMessageId: string;
  quote: string;
  reason: "no such message" | "quote not found verbatim";
}

/** Every message in the seed set, by externalId. */
const byId = new Map<string, { clientKey: ClientKey; text: string; ts: number }>();
for (const t of threads) {
  for (const m of t.messages) {
    byId.set(m.externalId, { clientKey: t.key, text: m.text, ts: tsOf(m) });
  }
}

/**
 * The gate. Returns the source message only if the quote is genuinely in it.
 * Whitespace is normalised because a line break is not a different quote; every
 * other character has to match.
 */
export function findVerbatim(sourceMessageId: string, quote: string): { text: string; ts: number } | null {
  const src = byId.get(sourceMessageId);
  if (!src) return null;
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  return flat(src.text).includes(flat(quote)) ? { text: src.text, ts: src.ts } : null;
}

export interface Ledger {
  entries: LedgerEntry[];
  rejected: Rejection[];
}

function build(seeds: LedgerSeed[]): Map<ClientKey, Ledger> {
  const out = new Map<ClientKey, Ledger>();
  for (const t of threads) out.set(t.key, { entries: [], rejected: [] });

  for (const s of seeds) {
    const bucket = out.get(s.client)!;
    const src = byId.get(s.sourceMessageId);

    if (!src) {
      bucket.rejected.push({ sourceMessageId: s.sourceMessageId, quote: s.quote, reason: "no such message" });
      continue;
    }
    if (!findVerbatim(s.sourceMessageId, s.quote)) {
      bucket.rejected.push({ sourceMessageId: s.sourceMessageId, quote: s.quote, reason: "quote not found verbatim" });
      continue;
    }

    const settledBy = s.settledByMessageId ? byId.get(s.settledByMessageId) : undefined;
    bucket.entries.push({
      kind: s.kind,
      text: s.text,
      owedBy: s.owedBy,
      quote: s.quote,
      sourceMessageId: s.sourceMessageId,
      openedAt: src.ts,
      settledAt: settledBy?.ts,
      settledByMessageId: settledBy ? s.settledByMessageId : undefined,
      confidence: 1,
    });
  }

  for (const l of out.values()) l.entries.sort((a, b) => a.openedAt - b.openedAt);
  return out;
}

const ledgers = build(ledgerSeed);

export function ledgerFor(key: ClientKey): Ledger {
  return ledgers.get(key) ?? { entries: [], rejected: [] };
}

/** A disclosure is context, not a debt — only promises and questions can be owed. */
export function isOwable(e: LedgerEntry): boolean {
  return e.kind === "promise" || e.kind === "question";
}

export function isOpen(e: LedgerEntry): boolean {
  return isOwable(e) && e.settledAt === undefined;
}

export function openEntries(key: ClientKey): LedgerEntry[] {
  return ledgerFor(key).entries.filter(isOpen).sort((a, b) => a.openedAt - b.openedAt);
}

export function openDays(e: LedgerEntry): number {
  return Math.round(((e.settledAt ?? NOW) - e.openedAt) / 86_400_000);
}
