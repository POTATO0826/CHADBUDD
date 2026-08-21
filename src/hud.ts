/**
 * Voltage HUD — the only script on the page.
 *
 * Source of truth for the inline <script> in index.html.
 * `bun run build` bundles this file and injects it between the
 * hud:start / hud:end markers. index.html stays standalone either way.
 */

type WallName = "dusk" | "pine" | "ember";

interface Readout {
  draw: number;   // watts
  temp: number;   // °C, cpu package
  fan: number;    // rpm
  mins: number;   // estimated minutes remaining
  chrome: number; // watts, top offender
}

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ── wallpaper swatches ──────────────────────────────────────────── */

const swatches = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".sw"),
);

for (const btn of swatches) {
  btn.addEventListener("click", () => {
    const wall = btn.dataset.wall as WallName | undefined;
    if (!wall) return;
    document.documentElement.setAttribute("data-wall", wall);
    for (const b of swatches) {
      b.setAttribute("aria-pressed", String(b === btn));
    }
  });
}

/* ── thermal sparkline: one hour of package temperature ──────────── */

const SERIES = [
  54, 56, 55, 58, 61, 64, 63, 67, 71, 74, 78, 81,
  79, 76, 73, 70, 68, 66, 69, 72, 70, 67, 64, 62,
];
const FLOOR = 45;
const CEIL = 85;
const HOT = 75;

const spark = document.getElementById("spark");
if (spark) {
  for (const t of SERIES) {
    const bar = document.createElement("span");
    const h = Math.round(((t - FLOOR) / (CEIL - FLOOR)) * 100);
    bar.style.height = `${Math.max(8, h)}%`;
    if (t >= HOT) bar.className = "hot";
    spark.appendChild(bar);
  }
}

/* ── live drift ──────────────────────────────────────────────────── */

/** Clamped random walk — small steps, never leaves the plausible band. */
function walk(v: number, step: number, lo: number, hi: number): number {
  const next = v + (Math.random() - 0.5) * 2 * step;
  return Math.min(hi, Math.max(lo, next));
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function startDrift(): void {
  const state: Readout = { draw: 18.4, temp: 62, fan: 2180, mins: 252, chrome: 6.2 };

  const procs = Array.from(
    document.querySelectorAll<HTMLElement>("[data-proc]"),
  );

  const out = {
    draw: el("draw"),
    railWatts: el("rail-watts"),
    railBar: el<HTMLElement>("rail-bar"),
    temp: el("temp"),
    fan: el("fan"),
    remaining: el("remaining"),
    offender: el("offender"),
    total: el("p-total"),
  };

  const tick = (): void => {
    state.draw = walk(state.draw, 0.55, 14.2, 23.8);
    state.temp = walk(state.temp, 1.2, 54, 74);
    state.fan = walk(state.fan, 60, 1900, 2600);
    state.mins = walk(state.mins, 2, 236, 268);
    state.chrome = walk(state.chrome, 0.25, 4.9, 7.6);

    const watts = `${state.draw.toFixed(1)} W`;
    if (out.draw) out.draw.textContent = watts;
    if (out.railWatts) out.railWatts.textContent = watts;
    if (out.railBar) {
      out.railBar.style.width = `${Math.round(((state.draw - 10) / 20) * 100)}%`;
    }
    if (out.temp) out.temp.textContent = `${Math.round(state.temp)} °C`;
    if (out.fan) {
      const rpm = Math.round(state.fan / 10) * 10;
      out.fan.textContent = rpm.toLocaleString("en-US");
    }
    if (out.remaining) {
      const h = Math.floor(state.mins / 60);
      const m = `0${Math.round(state.mins % 60)}`.slice(-2);
      out.remaining.textContent = `${h}h ${m}m`;
    }
    if (out.offender) {
      out.offender.textContent = `Chrome  ·  ${state.chrome.toFixed(1)} W`;
    }

    let total = 0;
    for (const p of procs) {
      const base = Number.parseFloat(p.dataset.proc ?? "0");
      const v = walk(base, 0.18, base * 0.82, base * 1.18);
      p.dataset.proc = v.toFixed(2);
      p.textContent = `${v.toFixed(1)} W`;
      total += v;
    }
    if (out.total) out.total.textContent = `${total.toFixed(1)} W`;
  };

  window.setInterval(tick, 2400);
}

// Instrumentation holds still when the visitor asks for less motion.
if (!reduce) startDrift();
