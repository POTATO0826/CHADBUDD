/**
 * Emotion spans, as the UI reads them.
 *
 * The pass that fills this is bridge/emotion/extract.py → convex/emotions.ts;
 * this module is the live binding the render reads, in the exact idiom of
 * copy.ts `ideas`: an exported `let`, a setter live mode calls, and importers
 * who see the swap for free because ES module bindings are live views.
 *
 * Empty in seed mode, on purpose. The seed threads have no extraction run
 * against them and the design's rule for an unmeasured thing is the hatch,
 * never a plausible-looking value — so every consumer must render the absence
 * when a lookup misses, and does.
 */

import type { Tone } from "./derive.ts";

export interface EmotionSpan {
  /** externalId of the message the span was read from. The citation. */
  sourceId: string;
  /** The exact span, already through the server's verbatim gate. */
  quote: string;
  /** The extractor's own word — "curt", "appreciative" — not an enum. */
  label: string;
  intensity: "low" | "medium" | "high";
  /** The cited message's timestamp. */
  ts: number;
}

/** Oldest-first spans per client key. */
export let emotions: Record<string, EmotionSpan[]> = {};

/** sourceId → span, for the conversation pane's per-message chip. */
let bySource = new Map<string, EmotionSpan>();

export function setEmotions(next: Record<string, EmotionSpan[]>): void {
  emotions = next;
  bySource = new Map();
  for (const spans of Object.values(next)) {
    // Later spans win a collision; one chip per message is all the row has room for.
    for (const s of spans) bySource.set(s.sourceId, s);
  }
}

export function emotionAt(externalId: string): EmotionSpan | undefined {
  return bySource.get(externalId);
}

/** The most recent read across the whole book, for the header. */
export function latestEmotion(): { key: string; span: EmotionSpan } | undefined {
  let best: { key: string; span: EmotionSpan } | undefined;
  for (const [key, spans] of Object.entries(emotions)) {
    const last = spans[spans.length - 1];
    if (last && (best === undefined || last.ts > best.span.ts)) best = { key, span: last };
  }
  return best;
}

/**
 * Label → tone, by what the label means for the relationship.
 *
 * Withdrawal reads as critical alongside outright distress, and that is the
 * point of the product: "Park it for now" is politer than anger and worse
 * news. Strain is a warn — it is about the client's week, not about the
 * advisor. Anything unrecognised gets butter, the "noted, unclassified" tone,
 * rather than a guess in either direction.
 */
const GOOD = new Set(["appreciative", "satisfied", "trusting", "warm", "caring", "grateful", "enthusiastic", "excited", "relieved", "happy", "curious", "hopeful", "reassured"]);
const CRITICAL = new Set(["frustrated", "angry", "annoyed", "upset", "disappointed", "ignored", "impatient", "curt", "disengaged", "dismissive", "cold", "distant"]);
const WARN = new Set(["stressed", "overwhelmed", "anxious", "worried", "nervous", "uncertain", "apologetic", "embarrassed", "hesitant", "confused"]);

export function emotionTone(label: string): Tone {
  if (GOOD.has(label)) return "good";
  if (CRITICAL.has(label)) return "critical";
  if (WARN.has(label)) return "warn";
  return "butter";
}
