/**
 * bun run build — writes dist/index.html + dist/app.js.
 *
 * Kept deliberately dumb: the page is one HTML file and one ES module, which is
 * what the Tauri shell will load from disk later.
 */

const built = await Bun.build({
  entrypoints: ["src/main.ts"],
  target: "browser",
  format: "esm",
  minify: true,
  outdir: "dist",
  naming: "app.js",
});

if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}

await Bun.write("dist/index.html", Bun.file("index.html"));

const bytes = (await Bun.file("dist/app.js").text()).length;
console.log(`dist/app.js  ${bytes.toLocaleString("en-US")} bytes`);
console.log(`dist/index.html written.`);
