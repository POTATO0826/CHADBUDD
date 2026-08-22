/**
 * bun run scripts/import-holdings.ts [path/to/holdings.csv]
 *
 * The manual path. The bridge also runs this sync automatically at startup
 * (bridge/main.ts), so for a demo the import is "start the bridge" — this
 * script exists for importing without restarting anything, and for pointing
 * at a file that is not in the standard place.
 *
 * File resolution matches the bridge: an explicit argument wins, then
 * data/import/holdings.csv (the advisor's real book, gitignored), then the
 * sample.
 */

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";
import { convexUrl, MISSING_CONVEX } from "./convex-url.ts";
import { readHoldingsCsv } from "../shared/holdingsCsv.ts";

const url = convexUrl();
if (url === "") {
  console.error(MISSING_CONVEX);
  process.exit(1);
}

const explicit = process.argv[2];
const real = "data/import/holdings.csv";
const sample = "data/import/holdings.sample.csv";
const file = explicit ?? ((await Bun.file(real).exists()) ? real : sample);

const { rows, emails, problems } = readHoldingsCsv(await Bun.file(file).text());
if (rows.length === 0) {
  console.error(`Nothing to import from ${file}:`);
  for (const p of problems) console.error(`  ! ${p}`);
  process.exit(1);
}

const lookup = anyApi as unknown as Record<string, Record<string, unknown>>;
const convex = new ConvexHttpClient(url);

const res = (await convex.mutation(
  lookup["holdings"]!["replaceAll"] as FunctionReference<"mutation">,
  { rows },
)) as { imported: number };

let emailsSet = 0;
for (const [key, email] of emails) {
  try {
    await convex.mutation(lookup["ingest"]!["setEmail"] as FunctionReference<"mutation">, {
      key,
      email,
    });
    emailsSet++;
  } catch (err) {
    problems.push(
      `email for ${key} not set: ${err instanceof Error ? err.message.split("\n")[0] : err}`,
    );
  }
}

console.log(`${res.imported} holdings imported from ${file}`);
console.log(`${emailsSet} client email(s) set`);
for (const p of problems) console.log(`  ! ${p}`);
