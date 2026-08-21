/**
 * bun run verify:ui
 *
 * Guards the one promise the product makes: every id shown in the UI resolves to
 * a real message in the seed threads.
 *
 * The recommendations, queue rows and house rules in src/copy.ts are written by
 * hand, so their citations are exactly the kind of thing that rots — a renamed
 * message or a mistyped id would leave a butter chip on screen pointing at
 * nothing, which is worse than showing no citation at all. This fails the build
 * rather than letting that ship.
 */

import { threads } from "../data/threads/index.ts";
import { approvals, ideas, queues, rules } from "../src/copy.ts";
import { clients, replyClock, totals, weekBars } from "../src/derive.ts";
import { ledgerFor } from "../src/ledger.ts";

const real = new Set<string>();
for (const t of threads) for (const m of t.messages) real.add(m.externalId);

let failures = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};
const pass = (msg: string): void => console.log(`  ✓ ${msg}`);

/** Every id-looking token in a string, e.g. A-001 / D-012. */
const IDS = /\b[A-D]-\d{3}\b/g;

console.log(`\nUI verification\n${"─".repeat(66)}`);

console.log("\ncitations declared in copy.ts");
{
  let checked = 0;
  const check = (where: string, ids: string[]): void => {
    for (const id of ids) {
      checked++;
      if (!real.has(id)) fail(`${where} cites ${id}, which is not a real message`);
    }
  };

  for (const [key, list] of Object.entries(ideas)) {
    list.forEach((i, n) => check(`ideas.${key}[${n}] "${i.title}"`, i.cites));
  }
  for (const [kind, q] of Object.entries(queues)) {
    q.rows.forEach((r, n) => check(`queues.${kind}.rows[${n}] (${r.name})`, r.cites));
  }
  if (failures === 0) pass(`${checked} declared citations all resolve`);
}

console.log("\nids mentioned in prose (not just in cites arrays)");
{
  let checked = 0;
  const scan = (where: string, text: string): void => {
    for (const id of text.match(IDS) ?? []) {
      checked++;
      if (!real.has(id)) fail(`${where} mentions ${id}, which is not a real message`);
    }
  };
  for (const [key, list] of Object.entries(ideas)) {
    list.forEach((i, n) => {
      scan(`ideas.${key}[${n}].why`, i.why);
      scan(`ideas.${key}[${n}].draft`, i.draft);
      scan(`ideas.${key}[${n}].meta`, i.meta);
    });
  }
  for (const [kind, q] of Object.entries(queues)) {
    q.rows.forEach((r, n) => {
      scan(`queues.${kind}.rows[${n}].text`, r.text);
      scan(`queues.${kind}.rows[${n}].why`, r.why);
    });
    scan(`queues.${kind}.foot`, q.foot);
  }
  approvals.forEach((a, n) => { scan(`approvals[${n}].title`, a.title); scan(`approvals[${n}].meta`, a.meta); });
  rules.forEach((r, n) => { scan(`rules[${n}]`, `${r.detailTitle} ${r.detailMeta}`); });
  if (checked > 0) pass(`${checked} ids mentioned in prose all resolve`);
}

console.log("\nderived view model");
{
  for (const c of clients) {
    const led = ledgerFor(c.key);
    if (led.rejected.length > 0) fail(`${c.name}: ${led.rejected.length} ledger entries failed the verbatim gate`);
    if (c.messageCount !== c.thread.messages.length) fail(`${c.name}: message count disagrees with the thread`);
    if (c.weeks.length !== 5) fail(`${c.name}: month grid has ${c.weeks.length} weeks, expected 5`);
    for (const w of c.weeks) {
      if (w.cells.length !== 7) fail(`${c.name}: a week has ${w.cells.length} cells`);
    }
    if (c.turn.cite !== "—" && !real.has(c.turn.cite)) fail(`${c.name}: turn cites ${c.turn.cite}, not a real message`);
    if (c.score.signals.length !== 4) fail(`${c.name}: ${c.score.signals.length} signals, expected 4`);
    for (const m of c.messages) {
      if (!real.has(m.id)) fail(`${c.name}: record row ${m.id} is not a real message`);
    }
  }
  pass(`${clients.length} clients · grids, turns, signals and record rows all consistent`);

  // The turning point must be a real question the client actually asked.
  for (const c of clients) {
    const msg = c.thread.messages.find((m) => m.externalId === c.turn.cite);
    if (!msg) continue;
    if (msg.from !== "client") fail(`${c.name}: turn cites ${c.turn.cite}, which is not from the client`);
    if (!msg.text.includes("?")) fail(`${c.name}: turn cites ${c.turn.cite}, which contains no question`);
  }
  pass("every turning point is a real client question");
}

console.log("\ncounters shown on the overview");
{
  const owed = clients.reduce((n, c) => n + c.open.filter((x) => x.owedBy === "advisor").length, 0);
  if (owed !== totals.owedByAdvisor) fail(`owed-by-you counter (${totals.owedByAdvisor}) disagrees with the ledger (${owed})`);
  const tips = weekBars.days.filter((d) => d.isPeak).length;
  if (tips > 1) fail(`engagement chart labels ${tips} bars — label one, never every mark`);
  if (!replyClock.value) fail("reply clock has no value");
  const worstMins = replyClock.worst.windows.recent.medianLatencyMin ?? 0;
  for (const c of clients) {
    if ((c.windows.recent.medianLatencyMin ?? 0) > worstMins) fail(`reply clock names ${replyClock.worst.name} but ${c.name} is slower`);
  }
  pass(`owed ${owed} · ${tips} chart label · worst median ${replyClock.value} (${replyClock.worst.name})`);
}

console.log(`\n${"─".repeat(66)}`);
if (failures === 0) {
  console.log(`all checks passed · ${totals.messages} messages · ${totals.ledgerEntries} ledger entries · 0 discarded\n`);
} else {
  console.log(`${failures} check${failures === 1 ? "" : "s"} FAILED\n`);
  process.exitCode = 1;
}
