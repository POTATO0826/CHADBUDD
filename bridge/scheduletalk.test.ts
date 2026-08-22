/**
 * The propose intent, and proof it did not loosen anything around it.
 *
 * The reader's conservatism is a promise the rest of the system leans on —
 * a proposal card costs the advisor a decision, so a chatty client must not
 * generate a deck of them. Every negative case here is a sentence that
 * plausibly tempts the parser and must stay unread.
 */

import { describe, expect, test } from "bun:test";

import { OFFSET_MIN, readSchedule, whenOf, dayOf, instantOf } from "../shared/scheduletalk";

/** Wed 19 Aug 2026, 14:00 in Asia/Kuala_Lumpur — the instant "now". */
const FROM = Date.UTC(2026, 7, 19, 14, 0) - OFFSET_MIN * 60_000;

describe("propose", () => {
  test("a question with a time is a proposal, not a booking", () => {
    const r = readSchedule("is it possible to have meeting at 6pm", FROM);
    expect(r?.intent).toBe("propose");
    expect(r?.minutesOfDay).toBe(18 * 60);
  });

  test("offering availability counts", () => {
    expect(readSchedule("I'm available 4.30pm on friday", FROM)?.intent).toBe("propose");
    expect(readSchedule("how about 10am tomorrow", FROM)?.intent).toBe("propose");
    expect(readSchedule("are you free at 3pm?", FROM)?.intent).toBe("propose");
  });

  test("a bare question-mark needs a meeting word beside the time", () => {
    expect(readSchedule("can we call at 5pm?", FROM)?.intent).toBe("propose");
    // "does the 4pm price hold?" — a time, a question, nothing about meeting.
    expect(readSchedule("does the 4pm price still hold?", FROM)).toBeNull();
  });

  test("no clock time, no proposal — 'next week' is a question for a person", () => {
    expect(readSchedule("can we meet next week?", FROM)).toBeNull();
    expect(readSchedule("are you free tomorrow?", FROM)).toBeNull();
  });

  test("assent still outranks it — an agreement is not re-read as a question", () => {
    expect(readSchedule("thursday 4pm works for me", FROM)?.intent).toBe("agree");
  });

  test("moves and cancellations are untouched", () => {
    expect(readSchedule("can we do 5pm instead", FROM)?.intent).toBe("move");
    expect(readSchedule("cancel thursday, can't make it", FROM)?.intent).toBe("cancel");
  });

  test("a bare time still reads as nothing", () => {
    expect(readSchedule("4pm", FROM)).toBeNull();
    expect(readSchedule("let's say 4", FROM)).toBeNull();
  });
});

describe("whenOf, for a proposal with no day named", () => {
  test("resolves against the message's own day", () => {
    const r = readSchedule("is it possible to have meeting at 6pm", FROM);
    // 18:00 the same wall-clock day the message was sent.
    expect(whenOf(r!, dayOf(FROM))).toBe(instantOf(2026, 7, 19, 18 * 60));
  });
});
