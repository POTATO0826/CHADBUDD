/**
 * The bklit funnel chart, mounted into an app that is otherwise not React.
 *
 * ── why this file exists at all ──────────────────────────────────────
 * main.ts builds markup as template strings and replaces whole subtrees with
 * innerHTML on every render. React needs a root that survives, so the two
 * cannot share a container. This module owns one detached element with a React
 * root inside it, and main.ts *moves* that element into a placeholder after
 * each render. Moving a node does not recreate it, so the root — and the
 * entrance animation, and the hover state — outlive the swap.
 *
 * The alternative was re-rendering the chart on every keystroke in the search
 * box, which would have replayed the entrance animation each time.
 *
 * ── clicking ─────────────────────────────────────────────────────────
 * The vendored component has no onClick, only a controlled `hoveredIndex` with
 * `onHoverChange`. Rather than patch the file — which would make it painful to
 * re-pull from the registry — the hovered segment is tracked here and a click
 * anywhere on the container resolves to whatever the pointer is over. Same
 * result, and src/charts/ stays byte-identical to what bklit ships.
 */

import { StrictMode, useCallback, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { Stage } from "../data/book.ts";
import { STAGE_NOTE } from "../data/book.ts";
import { funnelStages } from "./book.ts";
import { FunnelChart, type FunnelStage } from "./charts/funnel-chart.tsx";

/**
 * One hue for the whole funnel — the chart system's lead token, mixed toward
 * the card so it sits on the surface instead of shouting off it.
 *
 * A per-stage ramp was tried and reverted: the vendored renderer draws its
 * depth from halo rings around one colour, and feeding it five broke the
 * segment shapes and swallowed the stage labels. One hue is also the honest
 * grammar for an ordered scale.
 */
const FUNNEL_COLOR = "color-mix(in oklab, var(--chart-1) 58%, var(--card))";

interface Props {
  onStage: (stage: Stage) => void;
}

function Funnel({ onStage }: Props): React.JSX.Element {
  const [hovered, setHovered] = useState<number | null>(null);

  const data = useMemo<FunnelStage[]>(
    () =>
      funnelStages.map((r) => ({
        label: r.stage,
        value: r.reached,
        // The width is everyone who got this far; the number shown is who is
        // standing here now. The gap between them is the conversion work.
        displayValue: String(r.here),
      })),
    [],
  );

  const click = useCallback(() => {
    if (hovered === null) return;
    const row = funnelStages[hovered];
    if (row) onStage(row.stage);
  }, [hovered, onStage]);

  const key = useCallback(
    (ev: React.KeyboardEvent) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      click();
    },
    [click],
  );

  return (
    <div className="cb-funnel">
      {/* Keyboard users get a real control per stage; the chart itself is
          pointer-only, and a chart that can only be used with a mouse is a
          filter half the people cannot reach. */}
      <div className="cb-funnel-keys">
        {funnelStages.map((r, i) => (
          <button
            key={r.stage}
            type="button"
            onFocus={() => setHovered(i)}
            onBlur={() => setHovered(null)}
            onClick={() => onStage(r.stage)}
            aria-label={`${r.here} clients at ${r.stage}. ${STAGE_NOTE[r.stage]}. Open the list.`}
          />
        ))}
      </div>

      <div
        className="cb-funnel-plot"
        onClick={click}
        onKeyDown={key}
        role="group"
        aria-label="Book by stage. Click a stage to filter the client list."
      >
        <FunnelChart
          data={data}
          orientation="horizontal"
          color={FUNNEL_COLOR}
          layers={2}
          gap={4}
          edges="curved"
          labelLayout="spread"
          hoveredIndex={hovered}
          onHoverChange={setHovered}
          showPercentage
          showValues
          showLabels={false}
        />
      </div>

      {/* The stage names, in a row this file owns. The vendored chart draws
          its labels inside the measured plot, and a tight tile clips that
          bottom band silently — so the names live outside the measurement. */}
      <div aria-hidden="true" className="cb-funnel-names">
        {data.map((d) => (
          <span key={d.label}>{d.label}</span>
        ))}
      </div>

    </div>
  );
}

let host: HTMLElement | null = null;
let root: Root | null = null;
let ver = 0;
let renderNow: (() => void) | null = null;

/** Redraw with the current funnelStages — called when live stages arrive. */
export function refreshFunnel(): void {
  ver++;
  renderNow?.();
}

/**
 * The element carrying the chart. Created once, never recreated.
 *
 * main.ts calls this on every render and appends the result into the current
 * placeholder. Because it is the same node each time, React is undisturbed.
 */
export function funnelElement(onStage: (stage: Stage) => void): HTMLElement {
  if (host && root) return host;

  host = document.createElement("div");
  host.className = "cb-funnel-host";
  root = createRoot(host);
  renderNow = () => {
    root?.render(
      <StrictMode>
        <Funnel key={ver} onStage={onStage} />
      </StrictMode>,
    );
  };
  renderNow();
  return host;
}
