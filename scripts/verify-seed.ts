/**
 * bun run verify:seed
 *
 * Stage 1 proof. Purely descriptive — no scoring, no thresholds, nothing the
 * decay engine will do later. It measures the four raw signals month by month so
 * the decay can be seen in the data rather than trusted from a comment.
 *
 * It reads data/fixtures.ts only to print the intended label alongside, and to
 * confirm the ledger entries later stages must find are actually there.
 */

import { BASELINE_FROM, BASELINE_TO, NOW, NOW_ISO, RECENT_FROM } from "../data/clock.ts";
import { fixtures } from "../data/fixtures.ts";
import { threads } from "../data/threads/index.ts";
import { ledgerFor, isOpen, openDays } from "../src/ledger.ts";
import { measure } from "../src/signals.ts";
import type { Signals } from "../src/signals.ts";

function latency(min: number | null): string {
  if (min === null) return "     —";
  if (min < 90) return `${Math.round(min)}m`.padStart(6);
  return `${(min / 60).toFixed(1)}h`.padStart(6);
}

function ratio(s: Signals): string {
  return s.initiationRatio === null ? "   —" : s.initiationRatio.toFixed(2).padStart(4);
}

function pct(b: number, r: number): string {
  if (b === 0) return "n/a";
  return `${r >= b ? "+" : ""}${Math.round(((r - b) / b) * 100)}%`;
}

const MONTHS: Array<[string, string, string]> = [
  ["Apr", "2026-04-01T00:00:00+08:00", "2026-05-01T00:00:00+08:00"],
  ["May", "2026-05-01T00:00:00+08:00", "2026-06-01T00:00:00+08:00"],
  ["Jun", "2026-06-01T00:00:00+08:00", "2026-07-01T00:00:00+08:00"],
  ["Jul", "2026-07-01T00:00:00+08:00", "2026-08-01T00:00:00+08:00"],
  ["Aug", "2026-08-01T00:00:00+08:00", "2026-09-01T00:00:00+08:00"],
];

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

console.log(`\nStage 1 — seed data check.  reference now = ${NOW_ISO}`);
console.log(
  `baseline window = ${day(BASELINE_FROM)} → ${day(BASELINE_TO)}   ` +
    `recent window = ${day(RECENT_FROM)} → ${day(NOW)}`,
);

for (const t of threads) {
  const fx = fixtures[t.key];
  const first = t.messages[0]!;
  const last = t.messages[t.messages.length - 1]!;

  console.log(`\n${"─".repeat(78)}`);
  console.log(
    `Client ${t.key} · ${t.clientName} · ${t.handle}   [seeded as: ${fx?.label ?? "unknown"}]\n` +
      `${t.messages.length} messages · ${first.at.slice(0, 10)} → ${last.at.slice(0, 10)} · ` +
      `${t.messages.filter((m) => m.from === "client").length} from client`,
  );

  console.log(`\n  month   msgs   reply latency   initiated   questions   avg client len`);
  for (const [name, fromISO, toISO] of MONTHS) {
    const from = Date.parse(fromISO);
    const to = Math.min(Date.parse(toISO), NOW);
    if (to <= from) continue;
    const s = measure(t, from, to);
    console.log(
      `  ${name}   ${String(s.messages).padStart(4)}   ${latency(s.medianLatencyMin)}        ` +
        `${ratio(s)} (${s.clientInitiated}/${s.conversations})` +
        `${String(s.questions).padStart(9)}   ${String(s.avgClientChars).padStart(11)}`,
    );
  }

  const b = measure(t, BASELINE_FROM, BASELINE_TO);
  const r = measure(t, RECENT_FROM, NOW);

  console.log(`\n  signal                  baseline (90d)   recent (30d)   change`);
  console.log(
    `  median reply latency    ${latency(b.medianLatencyMin)}           ${latency(r.medianLatencyMin)}         ` +
      `${b.medianLatencyMin && r.medianLatencyMin ? pct(b.medianLatencyMin, r.medianLatencyMin) : "n/a"}`,
  );
  console.log(
    `  client-initiated ratio    ${ratio(b)}             ${ratio(r)}           ` +
      `${pct(b.initiationRatio ?? 0, r.initiationRatio ?? 0)}`,
  );
  console.log(
    `  questions per 30d       ${b.questionsPer30d.toFixed(1).padStart(6)}           ` +
      `${r.questionsPer30d.toFixed(1).padStart(6)}         ${pct(b.questionsPer30d, r.questionsPer30d)}`,
  );
  console.log(
    `  avg client message      ${String(b.avgClientChars).padStart(4)} ch         ` +
      `${String(r.avgClientChars).padStart(4)} ch       ${pct(b.avgClientChars, r.avgClientChars)}`,
  );

  // ledger: what survived the verbatim gate, and what is still open
  const led = ledgerFor(t.key);
  const open = led.entries.filter(isOpen);
  console.log(
    `\n  ledger: ${led.entries.length} entries verbatim-verified, ${led.rejected.length} discarded, ${open.length} still open`,
  );
  for (const rej of led.rejected) {
    console.log(`    ✗ DISCARDED ${rej.sourceMessageId} — ${rej.reason}: “${rej.quote}”`);
    process.exitCode = 1;
  }
  for (const e of open) {
    console.log(
      `    ! ${e.sourceMessageId} ${e.kind} owed by ${e.owedBy} · open ${openDays(e)} days · “${e.quote.slice(0, 64)}${e.quote.length > 64 ? "…" : ""}”`,
    );
  }

  for (const want of fx?.expectOpenLedger ?? []) {
    const hit = open.find((e) => e.sourceMessageId === want.sourceMessageId && e.owedBy === want.owedBy);
    console.log(`    ${hit ? "✓" : "✗"} expected open: ${want.sourceMessageId} (${want.owedBy}) — ${want.gist}`);
    if (!hit) process.exitCode = 1;
  }
}

console.log(`\n${"─".repeat(78)}`);
console.log(
  `total ${threads.reduce((n, t) => n + t.messages.length, 0)} messages across ${threads.length} threads\n`,
);
