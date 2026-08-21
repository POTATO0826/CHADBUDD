/**
 * The quiet-time rule, tested at its edges.
 *
 *   bun test bridge/agent/decay.test.ts
 *
 * This rule exists so decay is reachable in a demo, which makes it exactly the
 * kind of thing that gets eyeballed once and trusted forever. The thresholds
 * are the whole feature, so they get asserted rather than observed.
 *
 * Note what the last two cases protect: the rule only ever *promotes* a status.
 * A client the four measured signals already call decaying must not be talked
 * back down to healthy because they happened to message a minute ago — silence
 * is evidence of trouble, but noise is not evidence of health.
 */

import { describe, expect, test } from "bun:test";

import { setNow } from "../../data/clock.ts";
import { rebuild, setDecayTempo } from "../../src/derive.ts";
import { clients } from "../../src/derive.ts";
import type { SeedThread } from "../../data/types.ts";

const MIN = 60_000;
const NOW = Date.parse("2026-08-20T12:00:00+08:00");

const TEMPO = { decayAfterMs: 30 * MIN, silentAfterMs: 24 * 60 * MIN };

/** A thread whose last client message sits `quietMin` minutes before NOW. */
function threadQuietFor(quietMin: number): SeedThread {
  const at = (minAgo: number): string => new Date(NOW - minAgo * MIN).toISOString();
  return {
    key: "T",
    clientName: "Test Client",
    handle: "+60 12-000 0000",
    messages: [
      { externalId: "T-001", from: "client", at: at(quietMin + 240), text: "Morning, transferred the top-up." },
      { externalId: "T-002", from: "advisor", at: at(quietMin + 235), text: "Received, thank you." },
      { externalId: "T-003", from: "client", at: at(quietMin + 200), text: "Is it worth adding to the education fund?" },
      { externalId: "T-004", from: "advisor", at: at(quietMin + 60), text: "Let me pull the numbers." },
      { externalId: "T-005", from: "client", at: at(quietMin), text: "Not yet, sorry — been swamped." },
    ],
  };
}

/** Build one thread under the demo tempo and report the status it lands on. */
function statusAfter(quietMin: number): string {
  setNow(NOW);
  setDecayTempo(TEMPO);
  rebuild([threadQuietFor(quietMin)]);
  return clients[0]!.score.status;
}

describe("quiet-time decay", () => {
  test("a client who just spoke is not decaying", () => {
    expect(statusAfter(1)).not.toBe("decaying");
    expect(statusAfter(1)).not.toBe("silent");
  });

  test("29 minutes is still under the line", () => {
    expect(statusAfter(29)).not.toBe("decaying");
  });

  test("30 minutes tips into decaying", () => {
    expect(statusAfter(30)).toBe("decaying");
  });

  test("still decaying, not silent, hours later", () => {
    expect(statusAfter(6 * 60)).toBe("decaying");
  });

  test("just under a day is decaying, not yet silent", () => {
    expect(statusAfter(24 * 60 - 1)).toBe("decaying");
  });

  test("a full day is silent", () => {
    expect(statusAfter(24 * 60)).toBe("silent");
    setNow(NOW);
    setDecayTempo(TEMPO);
    rebuild([threadQuietFor(24 * 60)]);
    expect(clients[0]!.score.silent).toBe(true);
  });

  test("the headline names the gap rather than asserting a cause", () => {
    setNow(NOW);
    setDecayTempo(TEMPO);
    rebuild([threadQuietFor(45)]);
    expect(clients[0]!.score.headline).toContain("45 minutes");
  });
});

describe("tempo off", () => {
  test("with no tempo the quiet rule does nothing, however long the silence", () => {
    setNow(NOW);
    setDecayTempo(null);
    rebuild([threadQuietFor(48 * 60)]);
    // Whatever the four measured signals say, they are not saying it because
    // of this rule — which is the guarantee the seed demo depends on.
    const s = clients[0]!.score;
    expect(s.headline).not.toContain("no message in");
    expect(s.headline).not.toContain("nothing from them in");
  });
});
