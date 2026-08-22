/**
 * bun run scripts/import-holdings.ts [path/to/holdings.csv]
 *
 * The advisor's book, from a CSV into the live deployment. Defaults to the
 * sample so `bun run scripts/import-holdings.ts` alone demos the flow; point
 * it at a real export when there is one.
 *
 * Replaces the whole holdings table (a CSV is a statement of the book, not a
 * diff) and sets each client's email where the row carries one. Rows whose
 * client_key matches no tracked client still import — the desk drops them at
 * render until the client exists, which is the same rule the seed follows.
 */

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";
import { convexUrl, MISSING_CONVEX } from "./convex-url.ts";

const VALID_CLASSES = new Set([
  "us-bonds", "global-bonds", "asia-equity", "malaysia-equity",
  "global-equity", "tech-equity", "money-market",
]);
const VALID_KINDS = new Set(["fund", "structured", "prs", "plan", "policy"]);

const url = convexUrl();
if (url === "") {
  console.error(MISSING_CONVEX);
  process.exit(1);
}

const file = process.argv[2] ?? "data/import/holdings.sample.csv";
const raw = await Bun.file(file).text();

/** Minimal quoted-CSV parse — commas inside quotes survive. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some((c) => c.trim() !== "")) rows.push(row); }
  return rows;
}

const table = parseCsv(raw);
const header = table[0]!.map((h) => h.trim());
const col = (name: string): number => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`CSV is missing column "${name}"`);
  return i;
};

const iKey = col("client_key");
const iEmail = col("client_email");
const iName = col("product_name");
const iKind = col("product_type");
const iClasses = col("asset_classes");
const iInvested = col("invested_amount");
const iValue = col("current_value");
const iValue1y = col("value_1y_ago");
const iStart = col("start_date");
const iMature = col("maturity_date");
const iContrib = col("contribution_amount");
const iFreq = col("contribution_frequency");
const iLast = col("last_update_sent");
const iRisk = col("risk_rating");
const iNotes = col("notes");

const rows: Array<Record<string, unknown>> = [];
const emails = new Map<string, string>();
const problems: string[] = [];

table.slice(1).forEach((r, n) => {
  const line = n + 2;
  const key = r[iKey]!.trim();
  const kind = r[iKind]!.trim().toLowerCase();
  const classes = r[iClasses]!.split(";").map((x) => x.trim()).filter(Boolean);

  if (key === "") return void problems.push(`line ${line}: empty client_key — skipped`);
  if (!VALID_KINDS.has(kind)) return void problems.push(`line ${line}: unknown product_type "${kind}" — skipped`);
  const badClass = classes.find((c) => !VALID_CLASSES.has(c));
  if (badClass) return void problems.push(`line ${line}: unknown asset class "${badClass}" — skipped`);

  const num = (i: number): number => Number(r[i]!.replace(/[^\d.-]/g, "") || 0);
  const invested = num(iInvested);
  const value = num(iValue);

  rows.push({
    hid: `I-${key}${rows.length + 1}`,
    clientKey: key,
    name: r[iName]!.trim(),
    // "policy" folds into "plan": the frontend's four kinds already carry it.
    kind: kind === "policy" ? "plan" : kind,
    classes,
    invested,
    value,
    value1yAgo: num(iValue1y) || invested || value,
    startIso: r[iStart]!.trim(),
    ...(r[iMature]!.trim() ? { maturityIso: r[iMature]!.trim() } : {}),
    contribution: num(iContrib),
    frequency: r[iFreq]!.trim() || "none",
    lastUpdateIso: r[iLast]!.trim(),
    risk: r[iRisk]!.trim(),
    notes: r[iNotes]!.trim(),
  });

  const email = r[iEmail]!.trim();
  if (email !== "") emails.set(key, email);
});

const lookup = anyApi as unknown as Record<string, Record<string, unknown>>;
const convex = new ConvexHttpClient(url);

const res = (await convex.mutation(
  lookup["holdings"]!["replaceAll"] as FunctionReference<"mutation">,
  { rows },
)) as { imported: number };

let emailsSet = 0;
for (const [key, email] of emails) {
  try {
    await convex.mutation(lookup["ingest"]!["setEmail"] as FunctionReference<"mutation">, { key, email });
    emailsSet++;
  } catch (err) {
    problems.push(`email for ${key} not set: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  }
}

console.log(`${res.imported} holdings imported from ${file}`);
console.log(`${emailsSet} client email(s) set`);
for (const p of problems) console.log(`  ! ${p}`);
