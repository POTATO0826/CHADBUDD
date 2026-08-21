/**
 * bun run dev  —  serve index.html at http://localhost:3000
 *
 * Static only. No API, no framework, nothing written to disk. The site works
 * just as well opened straight from the filesystem; this exists so backdrop-filter
 * and the Google Fonts <link> behave the same way they will in production.
 */

const PORT = Number(Bun.env.PORT ?? 3000);
const ROOT = import.meta.dir;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname === "/" ? "/index.html" : url.pathname;

    // Refuse anything that tries to climb out of the project directory.
    if (path.includes("..")) {
      return new Response("forbidden", { status: 403 });
    }

    const file = Bun.file(ROOT + path);
    if (await file.exists()) {
      return new Response(file, {
        headers: { "cache-control": "no-cache" },
      });
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`Voltage → http://localhost:${server.port}`);
