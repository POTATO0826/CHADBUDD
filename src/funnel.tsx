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
 * One hue for the whole funnel.
 *
 * Giving each stage its own colour was wrong twice over. Five hues across
 * five *ordered* categories reads as five unrelated things rather than one
 * sequence, and it fought a palette built on a single cool accent — the tile
 * looked like it came from a different product.
 *
 * The reference does the same thing: every segment is one grey, and the depth
 * comes from the halo rings rather than from hue.
 *
 * Mixed toward the card rather than used at full strength, so it sits on the
 * surface instead of shouting off it.
 */
const FUNNEL_COLOR = "color-mix(in oklab, var(--iris) 62%, var(--card))";

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
          showLabels
        />
      </div>

    </div>
  );
}

let host: HTMLElement | null = null;
let root: Root | null = null;

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
  root.render(
    <StrictMode>
      <Funnel onStage={onStage} />
    </StrictMode>,
  );
  return host;
}
