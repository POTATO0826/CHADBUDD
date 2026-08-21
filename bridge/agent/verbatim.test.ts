/**
 * The gate is the only thing standing between a language model and the app's
 * central claim — that everything on screen traces to something a human
 * actually wrote. It gets tested properly.
 *
 *   bun test bridge/agent/verbatim.test.ts
 *
 * The cases below are the ways a model actually fails, not invented edge
 * cases: it paraphrases while sounding verbatim, it changes capitalisation, it
 * cites a plausible id that doesn't exist, it quotes across a line break, it
 * merges two messages into one quote.
 */

import { describe, expect, test } from "bun:test";

import { flatten, gate, isVerbatim, type Claim } from "../../convex/verbatim.ts";

const A1 = "Sorry been quiet, quarter end has been brutal.";
const A2 = "Park it for now,\nI'll come back to you.";
const A3 = "No.";

const messages = new Map<string, string>([
  ["A-001", A1],
  ["A-002", A2],
  ["A-003", A3],
]);

const claim = (sourceId: string, quote: string): Claim => ({ statement: "s", sourceId, quote });

describe("flatten", () => {
  test("collapses runs of whitespace and trims", () => {
    expect(flatten("  a \n\t b  ")).toBe("a b");
  });
});

describe("isVerbatim", () => {
  test("accepts an exact substring", () => {
    expect(isVerbatim(A1, "quarter end has been brutal")).toBe(true);
  });

  test("accepts the whole message", () => {
    expect(isVerbatim(A1, A1)).toBe(true);
  });

  test("accepts a quote spanning a line break, since a break is not a different quote", () => {
    expect(isVerbatim(A2, "Park it for now, I'll come back to you.")).toBe(true);
  });

  test("accepts a very short but genuine reply", () => {
    expect(isVerbatim(A3, "No.")).toBe(true);
  });

  // The failure that matters: fluent, close, and not what was said.
  test("rejects a paraphrase", () => {
    expect(isVerbatim(A1, "quarter end has been rough")).toBe(false);
  });

  test("rejects a case change — the original gate is case-sensitive", () => {
    expect(isVerbatim(A1, "Quarter End Has Been Brutal")).toBe(false);
  });

  test("rejects a word silently dropped from the middle", () => {
    expect(isVerbatim(A1, "quarter end has brutal")).toBe(false);
  });

  test("rejects an empty quote, which bare includes() would accept", () => {
    expect(isVerbatim(A1, "")).toBe(false);
    expect(isVerbatim(A1, "   \n  ")).toBe(false);
  });

  test("rejects a quote stitched from two different messages", () => {
    expect(isVerbatim(A1, "quarter end has been brutal. Park it for now")).toBe(false);
  });
});

describe("gate", () => {
  test("keeps well-cited claims and rejects the rest, without dropping either", () => {
    const claims = [
      claim("A-001", "quarter end has been brutal"),
      claim("A-002", "Park it for now"),
      claim("A-001", "quarter end has been rough"),
      claim("A-404", "anything at all"),
      claim("A-003", ""),
    ];

    const { kept, rejected } = gate(claims, messages);

    expect(kept).toHaveLength(2);
    expect(rejected).toHaveLength(3);
    expect(kept.length + rejected.length).toBe(claims.length);
  });

  test("labels why each claim failed, so the rate is diagnosable", () => {
    const { rejected } = gate(
      [
        claim("A-404", "anything"),
        claim("A-001", "a paraphrase of sorts"),
        claim("A-001", ""),
      ],
      messages,
    );

    expect(rejected.map((r) => r.reason)).toEqual([
      "no-such-message",
      "quote-not-verbatim",
      "quote-not-verbatim",
    ]);
  });

  test("a missing message is rejected as firmly as a misquote", () => {
    const { kept } = gate([claim("A-404", "quarter end has been brutal")], messages);
    expect(kept).toHaveLength(0);
  });

  test("empty input is not an error", () => {
    expect(gate([], messages)).toEqual({ kept: [], rejected: [] });
  });
});

/**
 * The documented limitation, asserted rather than described.
 *
 * This claim is false — nothing in A-002 states a timeline — but its quote is
 * real and exact, so the gate passes it. If this test ever starts failing, the
 * gate has grown semantic judgement it was never designed to have, and the
 * comments promising otherwise need rewriting.
 */
describe("known limitation", () => {
  test("a real quote supporting an unsupported claim still passes", () => {
    const unsupported: Claim = {
      statement: "The client's stated timeline is indefinite.",
      sourceId: "A-002",
      quote: "Park it for now",
    };
    expect(gate([unsupported], messages).kept).toHaveLength(1);
  });
});
