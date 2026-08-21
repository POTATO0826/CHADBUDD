/**
 * bun run build
 *
 * Bundles src/hud.ts and injects it into the inline <script> of index.html,
 * between the hud:start / hud:end markers. Nothing else is touched, and the
 * output stays a single self-contained file with no runtime dependencies.
 */

const HTML = "index.html";
const START = "/* hud:start — generated from src/hud.ts by build.ts */";
const END = "/* hud:end */";

const built = await Bun.build({
  entrypoints: ["src/hud.ts"],
  target: "browser",
  format: "iife",
  minify: false,
});

if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}

const code = (await built.outputs[0]!.text()).trim();

const html = await Bun.file(HTML).text();
const from = html.indexOf(START);
const to = html.indexOf(END);

if (from === -1 || to === -1) {
  console.error(`Could not find the hud:start / hud:end markers in ${HTML}.`);
  process.exit(1);
}

const next =
  html.slice(0, from + START.length) +
  "\n" +
  code +
  "\n" +
  html.slice(to);

if (next === html) {
  console.log(`${HTML} already up to date.`);
} else {
  await Bun.write(HTML, next);
  console.log(`Injected ${code.length.toLocaleString("en-US")} bytes into ${HTML}.`);
}

// Tauri bundles from dist/ so the bundle doesn't swallow src-tauri and node_modules.
await Bun.write(`dist/${HTML}`, next);
console.log(`Copied ${HTML} to dist/.`);
