/**
 * bun run demo — the backend, on screen.
 *
 * A deliberate sibling of server.ts rather than a change to it. The real
 * dashboard is being built in parallel by someone else; this proves the Convex
 * layer end to end without touching src/, index.html or data/.
 *
 * It is also a working reference for the three changes the real frontend needs:
 * subscribing with ConvexClient.onUpdate, reading threads.list as SeedThread[],
 * and treating client keys as strings rather than the A|B|C|D union.
 *
 * Port 4322, one above the real dev server, so both can run at once.
 */

const PORT = Number(process.env["DEMO_PORT"] ?? 4322);

/**
 * The deployment URL is baked in at bundle time.
 *
 * The page needs it, the page cannot read .env.local, and there is no config
 * endpoint to fetch it from. Substituting it into the bundle keeps the browser
 * free of process.env without inventing a second source of truth.
 */
const CONVEX_URL = process.env["CONVEX_SELF_HOSTED_URL"] ?? process.env["CONVEX_URL"] ?? "";

if (CONVEX_URL === "") {
  console.error("Missing CONVEX_SELF_HOSTED_URL in .env.local — is `docker compose up -d` running?");
  process.exit(1);
}

async function bundle(): Promise<Response> {
  const built = await Bun.build({
    entrypoints: ["demo/app.ts"],
    target: "browser",
    format: "esm",
    minify: false,
    define: { __CONVEX_URL__: JSON.stringify(CONVEX_URL) },
  });

  if (!built.success) {
    const log = built.logs.map(String).join("\n");
    console.error(log);
    return new Response(`console.error(${JSON.stringify(log)});`, {
      headers: { "content-type": "text/javascript" },
    });
  }

  return new Response(await built.outputs[0]!.text(), {
    headers: { "content-type": "text/javascript", "cache-control": "no-store" },
  });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/app.js") return bundle();
    if (pathname === "/" || pathname === "/index.html") {
      return new Response(Bun.file("demo/index.html"), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`ChadBuddy backend demo → http://localhost:${PORT}`);
console.log(`   subscribing to ${CONVEX_URL}`);
