/**
 * The mouse trail: a short glacial comet behind the cursor.
 *
 * One canvas over everything, pointer-events none, drawing a tapering
 * stroke through the last few hundred milliseconds of cursor positions in
 * the surface tint (--glacial), so the flourish and the tiles agree on a
 * hue. The loop only runs while there is something to fade — an idle
 * cursor costs zero frames — and a reduced-motion preference turns the
 * whole thing off before the canvas is even created.
 */

const LIFE_MS = 420;
const MAX_POINTS = 64;

interface Pt {
  x: number;
  y: number;
  t: number;
}

export function initTrail(): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  canvas.id = "mousetrail";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let dpr = 1;
  const fit = (): void => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  };
  fit();
  window.addEventListener("resize", fit);

  // The hue is read off the stylesheet, not duplicated here — retheme the
  // token and the trail follows.
  const hue = (): string =>
    getComputedStyle(document.documentElement).getPropertyValue("--glacial").trim() || "#a8c8dc";

  const pts: Pt[] = [];
  let running = false;

  function frame(now: number): void {
    if (!ctx) return;
    while (pts.length > 0 && now - pts[0]!.t > LIFE_MS) pts.shift();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (pts.length < 2) {
      running = false;
      return;
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = hue();

    // Oldest to newest: each segment fades by age and thins toward the tail.
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const age = (now - b.t) / LIFE_MS;
      const alpha = Math.max(0, 1 - age);
      ctx.globalAlpha = alpha * 0.5;
      ctx.lineWidth = (0.6 + 2.2 * alpha) * dpr;
      ctx.beginPath();
      ctx.moveTo(a.x * dpr, a.y * dpr);
      ctx.lineTo(b.x * dpr, b.y * dpr);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    requestAnimationFrame(frame);
  }

  window.addEventListener("pointermove", (ev) => {
    pts.push({ x: ev.clientX, y: ev.clientY, t: performance.now() });
    if (pts.length > MAX_POINTS) pts.shift();
    if (!running) {
      running = true;
      requestAnimationFrame(frame);
    }
  });
}
