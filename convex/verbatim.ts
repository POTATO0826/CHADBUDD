/**
 * The citation gate.
 *
 * Mirrors `findVerbatim` at src/ledger.ts:50 — that function is the source of
 * truth and this one must not drift from it. It is reimplemented rather than
 * imported because src/ belongs to the frontend work happening in parallel,
 * and a backend that reaches across that boundary makes both jobs harder.
 *
 * The rule, verbatim from the original: whitespace is normalised, because a
 * line break is not a different quote. **Every other character must match,
 * including case.** An earlier version of this check lowercased both sides and
 * was quietly more permissive than the gate it claimed to mirror.
 *
 * ── What this gate does not do ──────────────────────────────────────────────
 *
 * It proves the quote is real. It does NOT prove the quote supports the claim
 * built on top of it. That distinction is not theoretical: asked a question a
 * thread could not answer ("what is the client's stated timeline?" against a
 * thread that states none), a model answered anyway — "the timeline is
 * indefinite" — citing a real, correctly-quoted message that says nothing of
 * the kind. It passed this gate cleanly.
 *
 * So this is a floor, not a guarantee. It makes fabricated *evidence*
 * impossible and leaves fabricated *inference* to be caught by watching the
 * rejection rate and by choosing a model that declines rather than guesses.
 */

export type RejectReason = "no-such-message" | "quote-not-verbatim" | "no-surviving-cites";

/** One factual assertion the agent makes, with the evidence it claims for it. */
export interface Claim {
  statement: string;
  /** externalId of the message the quote is supposed to come from. */
  sourceId: string;
  quote: string;
}

export interface RejectedClaim extends Claim {
  reason: RejectReason;
}

export interface GateResult {
  kept: Claim[];
  rejected: RejectedClaim[];
}

/** A line break is not a different quote; nothing else is negotiable. */
export function flatten(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Deliberate divergence from src/ledger.ts:50, and the only one.
 *
 * The original does a bare `includes()`, and `"anything".includes("")` is
 * true — so an empty quote cites any message successfully. Harmless for
 * hand-written seed data, and the single cheapest way for a model to
 * manufacture a citation. Empty quotes are rejected here.
 *
 * Short quotes are still allowed. A three-character reply like "No." is
 * genuine evidence in this domain, and a minimum length would throw it away
 * to catch something the rejection rate will surface anyway.
 */
export function isVerbatim(sourceText: string, quote: string): boolean {
  const q = flatten(quote);
  if (q === "") return false;
  return flatten(sourceText).includes(q);
}

/**
 * Run every claim past the gate.
 *
 * `messages` maps externalId → the message's real text. Claims citing an id
 * that isn't there are rejected as firmly as claims that misquote one: a
 * citation pointing at nothing is not a weaker citation, it is a fabricated one.
 */
export function gate(claims: readonly Claim[], messages: ReadonlyMap<string, string>): GateResult {
  const kept: Claim[] = [];
  const rejected: RejectedClaim[] = [];

  for (const c of claims) {
    const source = messages.get(c.sourceId);
    if (source === undefined) {
      rejected.push({ ...c, reason: "no-such-message" });
      continue;
    }
    if (!isVerbatim(source, c.quote)) {
      rejected.push({ ...c, reason: "quote-not-verbatim" });
      continue;
    }
    kept.push(c);
  }

  return { kept, rejected };
}
