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

import { browserConvexUrl } from "./convex-url.ts";

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
