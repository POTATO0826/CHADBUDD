/**
 * bun run build — writes dist/index.html + dist/app.js.
 *
 * Kept deliberately dumb: the page is one HTML file and one ES module, which is
 * what the Tauri shell will load from disk later.
 */

import { browserConvexUrl, convexDefine } from "./scripts/convex-url.ts";

const built = await Bun.build({
  entrypoints: ["src/main.ts"],
  target: "browser",
  format: "esm",
  minify: true,
  outdir: "dist",
  naming: "app.js",
  // The deployment URL is baked in: a Tauri build loads from disk with no
  // server in front of it to inject anything, and a browser cannot read .env.
  define: convexDefine(),
});

if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}

await Bun.write("dist/index.html", Bun.file("index.html"));
// The three design faces are inlined here so the Tauri shell needs no network.
await Bun.write("dist/fonts.css", Bun.file("assets/fonts.css"));

const bytes = (await Bun.file("dist/app.js").text()).length;
console.log(`dist/app.js  ${bytes.toLocaleString("en-US")} bytes`);
console.log(`dist/index.html written.`);
// browserConvexUrl, not convexUrl: report what was actually baked in. They
// differ whenever the bridge writes to docker and the page reads from Cloud,
// and a build log naming the wrong one is worse than no log at all.
const baked = browserConvexUrl();
console.log(baked ? `convex       ${baked}` : `convex       not configured — the bundle will use the seed`);
