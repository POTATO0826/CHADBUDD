/**
 * Times clients have offered, waiting on the advisor.
 *
 * Same live-binding idiom as copy.ts and emotions.ts: an exported `let` the
 * render reads, a setter live mode calls. Empty in seed mode — the seed
 * threads asked for nothing — so the calls page carries no extra section
 * there and the reproducible demo stays exactly as it was.
 */

import { NOW } from "../data/clock.ts";

export interface Proposal {
  id: string;
  key: string;
  name: string;
  /** externalId of the asking message. */
  cite: string;
  /** The sentence, verbatim. */
  text: string;
  /** The instant asked for. */
  at: number;
  minutes: number;
  /** Title of whatever already occupies the slot, or null. */
  conflict: string | null;
}

export let proposals: Proposal[] = [];

export function setProposals(next: Proposal[]): void {
  proposals = next.slice().sort((a, b) => a.at - b.at);
}

/** Still answerable: the moment hasn't passed under the open card. */
export function openProposals(): Proposal[] {
  return proposals.filter((p) => p.at > NOW);
}

const when = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short",
  hour: "numeric", minute: "2-digit", hour12: true,
  timeZone: "Asia/Kuala_Lumpur",
});

export function proposalWhen(p: Proposal): string {
  return when.format(p.at);
}

const replyClock = new Intl.DateTimeFormat("en-GB", {
  weekday: "long", hour: "numeric", minute: "2-digit", hour12: true,
  timeZone: "Asia/Kuala_Lumpur",
});

/**
 * The reply that goes back when the advisor accepts. Composed here so the
 * card can show it before the button is pressed — a message that sends as
 * the advisor is never invisible, even a one-liner.
 */
export function proposalReply(p: Proposal): string {
  return `${replyClock.format(p.at)} works — see you then.`;
}
