/**
 * The holdings CSV, parsed and validated — shared by the manual import script
 * and the bridge's startup sync, because two parsers for one file format is
 * how a file imports cleanly in one place and silently drops rows in the
 * other.
 *
 * No IO here: text in, rows out. The callers own where the text came from and
 * where the rows go.
 */

export const VALID_CLASSES = new Set([
  "us-bonds",
  "global-bonds",
  "asia-equity",
  "malaysia-equity",
  "global-equity",
  "tech-equity",
  "money-market",
]);

export const VALID_KINDS = new Set(["fund", "structured", "prs", "plan", "policy"]);

export interface HoldingImportRow {
  hid: string;
  clientKey: string;
  name: string;
  kind: string;
  classes: string[];
  invested: number;
  value: number;
  value1yAgo: number;
  startIso: string;
  maturityIso?: string;
  contribution: number;
  frequency: string;
  lastUpdateIso: string;
  risk: string;
  notes: string;
}

export interface HoldingsImport {
  rows: HoldingImportRow[];
  /** clientKey → email, last row wins. */
  emails: Map<string, string>;
  problems: string[];
}

/** Minimal quoted-CSV parse — commas inside quotes survive. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}

export function readHoldingsCsv(text: string): HoldingsImport {
  const table = parseCsv(text);
  const problems: string[] = [];
  if (table.length === 0) return { rows: [], emails: new Map(), problems: ["empty file"] };

  const header = table[0]!.map((h) => h.trim());
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) problems.push(`CSV is missing column "${name}"`);
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
  if (problems.length > 0) return { rows: [], emails: new Map(), problems };

  const rows: HoldingImportRow[] = [];
  const emails = new Map<string, string>();

  table.slice(1).forEach((r, n) => {
    const line = n + 2;
    const cell = (i: number): string => (r[i] ?? "").trim();
    const key = cell(iKey);
    const kind = cell(iKind).toLowerCase();
    const classes = cell(iClasses).split(";").map((x) => x.trim()).filter(Boolean);

    if (key === "") return void problems.push(`line ${line}: empty client_key — skipped`);
    if (!VALID_KINDS.has(kind))
      return void problems.push(`line ${line}: unknown product_type "${kind}" — skipped`);
    const badClass = classes.find((c) => !VALID_CLASSES.has(c));
    if (badClass)
      return void problems.push(`line ${line}: unknown asset class "${badClass}" — skipped`);

    const num = (i: number): number => Number(cell(i).replace(/[^\d.-]/g, "") || 0);
    const invested = num(iInvested);
    const value = num(iValue);

    rows.push({
      hid: `I-${key}${rows.length + 1}`,
      clientKey: key,
      name: cell(iName),
      // "policy" folds into "plan": the frontend's four kinds already carry it.
      kind: kind === "policy" ? "plan" : kind,
      classes,
      invested,
      value,
      value1yAgo: num(iValue1y) || invested || value,
      startIso: cell(iStart),
      ...(cell(iMature) ? { maturityIso: cell(iMature) } : {}),
      contribution: num(iContrib),
      frequency: cell(iFreq) || "none",
      lastUpdateIso: cell(iLast),
      risk: cell(iRisk),
      notes: cell(iNotes),
    });

    const email = cell(iEmail);
    if (email !== "") emails.set(key, email);
  });

  return { rows, emails, problems };
}
