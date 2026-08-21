/**
 * bun run dev — serves index.html and bundles src/main.ts to /app.js on request.
 *
 * No watcher and no cache: every reload re-bundles, which at this size is a
 * couple of milliseconds and means the page is never stale.
 */

// Must match `build.devUrl` in src-tauri/tauri.conf.json — `tauri dev` runs this
// server as its beforeDevCommand and then points the webview at that URL.
const PORT = Number(process.env.PORT ?? 4321);

async function bundle(): Promise<Response> {
  const built = await Bun.build({
    entrypoints: ["src/main.ts"],
    target: "browser",
    format: "esm",
    minify: false,
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
    if (pathname === "/fonts.css") {
      return new Response(Bun.file("assets/fonts.css"), {
        headers: { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (pathname === "/" || pathname === "/index.html") {
      return new Response(Bun.file("index.html"), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`ChadBuddy dev → http://localhost:${PORT}   (add ?open to land on the dashboard)`);
