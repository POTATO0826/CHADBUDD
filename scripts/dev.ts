/**
 * bun run dev — every long-running process, in one terminal.
 *
 *   bun run dev         convex watch + bridge + the Tauri window
 *   bun run dev --web   the same, but a browser tab instead of Tauri
 *   bun run dev --no-bridge --no-convex   any part can be dropped
 *
 * There are three things that have to be running at once and no reason for
 * three terminals: `convex dev` pushes convex/ on save, the bridge holds the
 * Telegram socket, and the shell renders. Started separately they also stop
 * separately, which is how you end up with a bridge still ingesting into a
 * deployment the window in front of you is no longer reading.
 *
 * The web server is deliberately absent from that list. `tauri dev` runs
 * `bun run web` itself via beforeDevCommand in src-tauri/tauri.conf.json, so
 * starting it here too would put two servers on port 4321. `--web` swaps the
 * Tauri child for that same server rather than adding one. And beforeDevCommand
 * MUST stay `web`, not `dev`: this script is `dev` now, and a Tauri that calls
 * back into it would spawn another Tauri, forever.
 *
 * Output is prefixed rather than interleaved raw, because three processes
 * writing to one terminal is unreadable otherwise — and the prefix is the only
 * way to tell which of them is the one that failed.
 */

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";
import { browserConvexUrl, convexUrl } from "./convex-url.ts";

type Spec = {
  tag: string;
  colour: string;
  cmd: string[];
  /** When this exits, bring everything down. The window is the session. */
  primary?: boolean;
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

const flags = new Set(process.argv.slice(2));
const web = flags.has("--web");

/* ── preflight: the command decides what this machine can run ─────────
   One command for two developers and any machine state, so the command has
   to look before it leaps: install if never installed, say if git is
   behind, skip children whose prerequisites are missing (with the exact
   fix printed), and know when a demo override is active. Everything here
   degrades to a note, never a crash — the page with seed data is the
   floor, and the floor always runs. */

const say = (line: string): void => console.log(`${DIM}${line}${RESET}`);
const warn = (line: string): void => console.log(`[33m!${RESET} ${line}`);

async function run(cmd: string[], timeoutMs: number): Promise<{ out: string; code: number }> {
  const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe", env: process.env });
  const killer = setTimeout(() => proc.kill(), timeoutMs);
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  clearTimeout(killer);
  return { out, code };
}

// First clone: node_modules missing means nothing below can even import.
if (!(await Bun.file("node_modules/convex/package.json").exists())) {
  say("first run — installing dependencies…");
  await run(["bun", "install"], 300_000);
}

// Behind origin? Say so; --pull acts on it (ff-only, so a diverged branch
// refuses cleanly instead of surprise-merging under uncommitted work).
try {
  await run(["git", "fetch", "--quiet"], 8_000);
  const behind = (await run(["git", "rev-list", "--count", "HEAD..@{upstream}"], 4_000)).out.trim();
  if (behind !== "" && behind !== "0") {
    if (flags.has("--pull")) {
      say(`${behind} commit(s) behind — pulling (ff-only)…`);
      const pulled = await run(["git", "pull", "--ff-only"], 30_000);
      if (pulled.code !== 0) warn("pull needs a merge — do it by hand, then restart");
    } else {
      warn(`${behind} commit(s) behind origin — git pull when convenient (or: bun run dev --pull)`);
    }
  }
} catch {
  /* offline, detached, or no upstream: none are dev-blocking */
}

const deployment = process.env["CONVEX_DEPLOYMENT"] ?? "";
const selfHosted = (process.env["CONVEX_SELF_HOSTED_URL"] ?? "") !== "";
const hasBackend = deployment !== "" || selfHosted;

const ownUrl =
  deployment !== ""
    ? `https://${deployment.includes(":") ? deployment.split(":").pop() : deployment}.convex.cloud`
    : "";
const demoOverride =
  !selfHosted &&
  ownUrl !== "" &&
  (process.env["CONVEX_URL"] ?? "") !== "" &&
  (process.env["CONVEX_URL"] ?? "").replace(new RegExp("/+$"), "") !== ownUrl;

if (!hasBackend) {
  warn("no Convex deployment configured — running seed-only.");
  warn("one-time setup: bunx convex dev   (interactive login, then Ctrl+C and rerun this)");
  flags.add("--no-convex");
  flags.add("--no-bridge");
}

if (demoOverride) {
  warn(`DEMO OVERRIDE: the page reads ${process.env["CONVEX_URL"]}`);
  warn("the bridge stays OFF so your Telegram cannot write into a teammate's database");
  flags.add("--no-convex"); // convex dev would push YOUR code at THEIR deployment
  flags.add("--no-bridge");
}

// No Telegram session yet: the bridge would crash-loop asking for a login.
if (!flags.has("--no-bridge") && !(await Bun.file(".tg/session.txt").exists())) {
  warn("no Telegram session — bridge skipped. One-time: bun run tg:spike");
  flags.add("--no-bridge");
}

// What this deployment is armed with, so a missing key is a line here and
// not a mystery three features deep.
if (hasBackend && !demoOverride) {
  try {
    const { out } = await run(["bunx", "convex", "env", "list"], 10_000);
    const has = (name: string): boolean => out.includes(name);
    const bit = (label: string, on: boolean): string => `${label} ${on ? "✓" : "✗"}`;
    say(
      `armed: ${bit("agent", has("OPENAI_API_KEY") || has("AGENT_API_KEY"))} · ` +
        `${bit("calendar", has("GOOGLE_CLIENT_ID"))} · ` +
        `${bit("email", has("GMAIL_APP_PASSWORD"))} · ` +
        `${bit("phone", has("PHONE_WEBHOOK_TOKEN"))}`,
    );
    if (!has("OPENAI_API_KEY") && !has("AGENT_API_KEY")) {
      warn("the AI is off — bunx convex env set OPENAI_API_KEY <key>  (ask a teammate for it)");
    }
  } catch {
    /* dashboard unreachable: the children will complain if it matters */
  }
}

if (flags.has("--preflight-only")) {
  say("preflight only — not starting anything.");
  process.exit(0);
}

/**
 * Seed the book if the deployment is empty — after convex has had a moment
 * to push the schema, retried because first-ever runs race the push. The
 * loader dedupes, so the worst cost of a retry is a fast no-op. Never runs
 * under a demo override: seeding a teammate's database is not this
 * machine's call.
 */
function autoSeedSoon(): void {
  if (!hasBackend || demoOverride) return;
  const target = convexUrl();
  if (target === "") return;
  void (async () => {
    const lookup = anyApi as unknown as Record<string, Record<string, unknown>>;
    const client = new ConvexHttpClient(target);
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((r) => setTimeout(r, attempt === 0 ? 6_000 : 5_000));
      try {
        const rows = (await client.query(
          lookup["threads"]?.["list"] as FunctionReference<"query">,
          {},
        )) as unknown[];
        if (rows.length === 0) {
          say("backend is empty — loading the seeded threads…");
          await run(["bun", "run", "bridge/seed-load.ts"], 120_000);
          say("seeded.");
        }
        return;
      } catch {
        /* schema not pushed yet — try again */
      }
    }
  })();
}

const specs: Spec[] = [];

if (!flags.has("--no-convex")) {
  specs.push({ tag: "convex", colour: "\x1b[35m", cmd: ["bunx", "convex", "dev"] });
}

if (!flags.has("--no-bridge")) {
  specs.push({ tag: "bridge", colour: "\x1b[36m", cmd: ["bun", "run", "bridge/main.ts"] });
}

specs.push(
  web
    ? { tag: "web", colour: "\x1b[32m", cmd: ["bun", "run", "server.ts"], primary: true }
    : { tag: "tauri", colour: "\x1b[33m", cmd: ["bun", "run", "tauri:dev"], primary: true },
);

const width = Math.max(...specs.map((s) => s.tag.length));

function write(spec: Spec, line: string): void {
  console.log(`${spec.colour}${spec.tag.padEnd(width)}${RESET} ${DIM}│${RESET} ${line}`);
}

/**
 * Prefix every line of a child's output.
 *
 * Buffered across chunks because a read boundary lands mid-line often enough to
 * matter — split naively and a stack trace arrives with its indentation and its
 * prefixes in the wrong places.
 */
async function pump(spec: Spec, stream: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!stream) return;
  const decoder = new TextDecoder();
  // A reader loop rather than `for await`: Bun iterates these fine at runtime,
  // but the DOM lib this project typechecks against declares no asyncIterator.
  const reader = stream.getReader();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) write(spec, line.replace(/\r$/, ""));
  }

  if (buffer !== "") write(spec, buffer);
}

const backend = browserConvexUrl();
console.log(`${DIM}chadbuddy dev — ${specs.map((s) => s.tag).join(", ")}${RESET}`);
console.log(`${DIM}backend: ${backend === "" ? "none configured (seed only)" : backend}${RESET}`);
if (!web) console.log(`${DIM}the web server starts with tauri, via beforeDevCommand${RESET}`);
console.log("");

autoSeedSoon();

const running = specs.map((spec) => {
  const proc = Bun.spawn({
    cmd: spec.cmd,
    stdout: "pipe",
    stderr: "pipe",
    // Inherited so .env.local, which Bun has already loaded, reaches the
    // children — the bridge reads CONVEX_URL from it and would otherwise have
    // no deployment to write to.
    env: process.env,
  });

  void pump(spec, proc.stdout);
  void pump(spec, proc.stderr);

  return { spec, proc };
});

let stopping = false;

/**
 * One Ctrl+C stops all of them.
 *
 * Without this the signal reaches this process and the children keep their
 * sockets — a bridge that outlives the terminal that started it is invisible
 * and still writing.
 */
function stop(): void {
  if (stopping) return;
  stopping = true;
  console.log(`\n${DIM}stopping…${RESET}`);
  for (const { proc } of running) proc.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await Promise.all(
  running.map(async ({ spec, proc }) => {
    const code = await proc.exited;
    if (stopping) return;

    // A non-primary child dying is worth saying loudly and worth surviving:
    // losing the bridge should not close the window someone is working in.
    if (spec.primary === true) {
      write(spec, `exited (${code}) — stopping the rest`);
      stop();
    } else {
      write(spec, `exited (${code}) — the others keep running`);
    }
  }),
);
