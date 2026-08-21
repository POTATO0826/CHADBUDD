/**
 * Client C — Michelle Tan. SILENT CHURN. The centrepiece.
 *
 * Read any single message in this thread and nothing is wrong. She replies
 * inside half an hour for four straight months, never once goes cold, stays
 * warm and appreciative, and agrees with almost everything.
 *
 * What changes, quietly, in the second week of June: she stops asking
 * questions, and she never starts a conversation again. Every exchange from
 * June onwards is the advisor talking and Michelle acknowledging. Twice she
 * says she'll come back to him, and doesn't. No complaint, no friction, no
 * gap in latency — the relationship is over and the surface is undisturbed.
 *
 * No message here states the cause. There is nothing to find in the text;
 * it's only in the shape.
 */

import type { SeedThread } from "../types.ts";

export const clientC: SeedThread = {
  key: "C",
  clientName: "Michelle Tan",
  handle: "+60 16-903 ••55",
  messages: [
    // ── April — curious, quick, drives the conversation ──────────────
    {
      externalId: "C-001",
      from: "advisor",
      at: "2026-04-19T14:10:00+08:00",
      text: "Michelle, I've put together the first version of your plan from what we discussed — condo deposit in 3 years, and the retirement number we landed on. Sending the PDF now. It's four pages, the third one is the only one that matters.",
    },
    {
      externalId: "C-002",
      from: "client",
      at: "2026-04-19T14:32:00+08:00",
      text: "Reading it now. Page 3 assumes I save RM2,800 a month — is that after the EPF contribution or including it? Because RM2,800 on top of EPF is going to hurt.",
    },
    {
      externalId: "C-003",
      from: "advisor",
      at: "2026-04-19T14:50:00+08:00",
      text: "Including. Your EPF is about RM1,150 a month, so it's RM1,650 of actual cash from you. Should have made that clearer on the page.",
    },
    {
      externalId: "C-004",
      from: "client",
      at: "2026-04-19T15:08:00+08:00",
      text: "Oh that's completely different, that's doable. Can we model it at RM1,900 cash instead and see how much earlier the condo happens? I'd rather stretch now while I don't have kids.",
    },
    {
      externalId: "C-005",
      from: "advisor",
      at: "2026-04-19T15:35:00+08:00",
      text: "At RM1,900 the deposit lands 8 months earlier — mid 2028 rather than early 2029. I'll redo the page and send it tomorrow.",
    },

    {
      externalId: "C-006",
      from: "client",
      at: "2026-04-23T10:15:00+08:00",
      text: "Got the new version, thank you. Two questions. Why is the emergency fund 6 months and not 3? And is the ASB portion there because it's good or because everyone has ASB?",
    },
    {
      externalId: "C-007",
      from: "advisor",
      at: "2026-04-23T10:44:00+08:00",
      text: "Fair challenge on both. Six months because you're the only income in your household and design roles are the first cut in a bad quarter — three months is fine for a dual-income couple. ASB is there because 4.5% guaranteed with no volatility is genuinely hard to beat for the safe portion, not because it's traditional.",
    },
    {
      externalId: "C-008",
      from: "client",
      at: "2026-04-23T11:02:00+08:00",
      text: "Okay, I'll accept both of those. I was half expecting you to say 'that's just what we do'.",
    },
    {
      externalId: "C-009",
      from: "advisor",
      at: "2026-04-23T11:20:00+08:00",
      text: "If I ever say that, push back harder.",
    },

    {
      externalId: "C-010",
      from: "client",
      at: "2026-04-28T20:40:00+08:00",
      text: "Hi Wei Han, slightly awkward question — how do you get paid on my plan? I couldn't work it out from the documents and I'd rather just know.",
    },
    {
      externalId: "C-011",
      from: "advisor",
      at: "2026-04-28T21:05:00+08:00",
      text: "Not awkward, it's the right question. On the unit trust portion I get a trailing commission from the fund house, about 0.5% a year of what you hold — you don't pay it separately, it comes out of the fund's fee. On the insurance there's an upfront commission in year one, roughly 40% of the first year premium, tapering after. Nothing you pay me directly.",
    },
    {
      externalId: "C-012",
      from: "client",
      at: "2026-04-28T21:22:00+08:00",
      text: "Thanks for answering it straight. So you earn more if I buy insurance than if I don't — which is fine, I just want to be aware of it when you recommend something.",
    },
    {
      externalId: "C-013",
      from: "advisor",
      at: "2026-04-28T21:40:00+08:00",
      text: "Correct, and you should hold me to it. If I recommend insurance I'll tell you what problem it solves and what happens if you skip it.",
    },

    // ── May — still engaged, still pushing back ──────────────────────
    {
      externalId: "C-014",
      from: "advisor",
      at: "2026-05-03T11:00:00+08:00",
      text: "Two accounts are open: money market for the emergency fund, and the global equity fund for the condo pot. First RM1,900 debit is the 28th. There's a third thing I want to raise but it's the insurance conversation, so I'll flag it rather than pitch it — you have no income protection at all.",
    },
    {
      externalId: "C-015",
      from: "client",
      at: "2026-05-03T11:26:00+08:00",
      text: "Go on then, flag it properly. What happens today if I get hit by a car and can't work for a year?",
    },
    {
      externalId: "C-016",
      from: "advisor",
      at: "2026-05-03T11:52:00+08:00",
      text: "Your company pays 2 months sick leave. After that, nothing — you'd be eating the emergency fund, and at 6 months of expenses that gets you to about month 8. SOCSO helps a little but not at your salary level. That's the actual gap.",
    },
    {
      externalId: "C-017",
      from: "client",
      at: "2026-05-03T12:15:00+08:00",
      text: "That's a real hole, I hadn't thought past the sick leave. Send me options but keep the premium under RM250 a month, I don't want this eating the condo plan.",
    },

    {
      externalId: "C-018",
      from: "client",
      at: "2026-05-09T09:30:00+08:00",
      text: "Looked at the three options. The middle one has a 90 day deferred period and the cheap one has 180 — how likely am I actually going to be off for more than 90 days? Feels like I'm paying extra for a scenario that basically doesn't happen.",
    },
    {
      externalId: "C-019",
      from: "advisor",
      at: "2026-05-09T09:58:00+08:00",
      text: "The 90-day version isn't paying for a more likely scenario, it's paying to start 3 months earlier in the same scenario. Claims data on people your age is mostly mental health and back injuries, and both of those run long — 6 to 18 months when they happen. If it happens, 90 days matters a lot.",
    },
    {
      externalId: "C-020",
      from: "client",
      at: "2026-05-09T10:20:00+08:00",
      text: "That's a much better answer than I expected, and slightly alarming. Middle option, the RM215 one. What do you need from me?",
    },
    {
      externalId: "C-021",
      from: "advisor",
      at: "2026-05-09T10:40:00+08:00",
      text: "Application form plus a health questionnaire. Be honest on the questionnaire even about the physio in 2024 — undeclared beats declared only until you claim.",
    },
    {
      externalId: "C-022",
      from: "client",
      at: "2026-05-09T11:05:00+08:00",
      text: "Declaring the physio. Sending both back tonight.",
    },

    {
      externalId: "C-023",
      from: "advisor",
      at: "2026-05-15T15:20:00+08:00",
      text: "Insurer came back — they've accepted you but with a back exclusion for 24 months because of the physio. That's the trade for declaring it. You can accept, or I can try one other insurer who's usually softer on musculoskeletal.",
    },
    {
      externalId: "C-024",
      from: "client",
      at: "2026-05-15T15:44:00+08:00",
      text: "Try the other one. If they also exclude it I'll accept, but it's worth one attempt given backs are apparently half the claims.",
    },
    {
      externalId: "C-025",
      from: "advisor",
      at: "2026-05-15T16:00:00+08:00",
      text: "Agreed, that's the right call. Two weeks for a decision.",
    },
    {
      externalId: "C-026",
      from: "client",
      at: "2026-05-15T16:18:00+08:00",
      text: "Noted. Also the first RM1,900 went out on the 28th as planned, saw it.",
    },

    {
      externalId: "C-027",
      from: "client",
      at: "2026-05-21T19:50:00+08:00",
      text: "Wei Han, I got offered a Singapore role today. Remote-ish, SGD salary, but I'd lose the EPF contribution. Does that break the whole plan or just change the numbers?",
    },
    {
      externalId: "C-028",
      from: "advisor",
      at: "2026-05-21T20:15:00+08:00",
      text: "Changes the numbers, doesn't break anything — but losing employer EPF is a real pay cut you won't see on the offer letter. Roughly RM1,150 a month of it. If the SGD salary doesn't beat your current package by more than that, it's a downgrade dressed as a promotion.",
    },
    {
      externalId: "C-029",
      from: "client",
      at: "2026-05-21T20:38:00+08:00",
      text: "It beats it by about RM2,600 equivalent, so still ahead. Can you redo the plan both ways so I can see it side by side before I answer them next week?",
    },
    {
      externalId: "C-030",
      from: "advisor",
      at: "2026-05-21T21:00:00+08:00",
      text: "Yes. Both versions by Monday.",
    },

    {
      externalId: "C-031",
      from: "advisor",
      at: "2026-05-26T10:30:00+08:00",
      text: "Both versions attached. Short answer: the Singapore version gets you the condo 5 months earlier but leaves you with no EPF cushion at all, so I'd want the emergency fund at 8 months instead of 6 in that world.",
    },
    {
      externalId: "C-032",
      from: "client",
      at: "2026-05-26T10:55:00+08:00",
      text: "Makes sense. Why 8 and not just keep 6 and take the condo earlier? Genuinely asking, not arguing.",
    },
    {
      externalId: "C-033",
      from: "advisor",
      at: "2026-05-26T11:20:00+08:00",
      text: "Because a foreign contract with no EPF and no local employment protection is a thinner safety net, and the condo being 5 months later is a much smaller problem than being 3 months from empty if the role ends.",
    },

    {
      externalId: "C-034",
      from: "client",
      at: "2026-06-02T09:15:00+08:00",
      text: "I turned the Singapore role down in the end. Not the money, just didn't want the travel. Sticking with the original plan — anything you need to change?",
    },
    {
      externalId: "C-035",
      from: "advisor",
      at: "2026-06-02T09:40:00+08:00",
      text: "Nothing to change, the original plan stands as written. And the second insurer came back — same back exclusion, so it was worth asking and the answer's no. Shall I accept the first offer?",
    },
    {
      externalId: "C-036",
      from: "client",
      at: "2026-06-02T10:02:00+08:00",
      text: "Yes accept it. 24 months of exclusion and then I'm covered properly, I can live with that.",
    },
    {
      externalId: "C-037",
      from: "advisor",
      at: "2026-06-02T10:20:00+08:00",
      text: "Accepting today. Policy should be in force from 15 June.",
    },

    // ── from here on: fast, warm, and completely one-directional ─────
    {
      externalId: "C-038",
      from: "advisor",
      at: "2026-06-09T11:00:00+08:00",
      text: "Income protection is in force from 15 June, RM215 a month, first debit on the 20th. Policy document is in your email. That's everything from the original plan now in place — emergency fund, condo pot, income protection.",
    },
    {
      externalId: "C-039",
      from: "client",
      at: "2026-06-09T11:24:00+08:00",
      text: "Noted, thanks Wei Han. Appreciate you sorting all of that out.",
    },

    {
      externalId: "C-040",
      from: "advisor",
      at: "2026-06-16T10:15:00+08:00",
      text: "Mid-June check: money market at RM11,400, global fund at RM6,180 and up 2.1% since you started. You're 4 months into a 36 month condo plan and slightly ahead. Nothing needed from you.",
    },
    {
      externalId: "C-041",
      from: "client",
      at: "2026-06-16T10:38:00+08:00",
      text: "That's good to hear. Thanks for the update 🙏",
    },

    {
      externalId: "C-042",
      from: "advisor",
      at: "2026-06-23T14:30:00+08:00",
      text: "One thing worth your input: your global fund is 100% developed markets. Adding 10% Asia ex-Japan would fit your horizon and you're young enough for the volatility. Not urgent, and I'm happy either way — but it's your call, not mine.",
    },
    {
      externalId: "C-043",
      from: "client",
      at: "2026-06-23T14:52:00+08:00",
      text: "Let me have a think about that one and get back to you.",
    },

    {
      externalId: "C-044",
      from: "advisor",
      at: "2026-07-01T09:45:00+08:00",
      text: "June statement is out, all three accounts on track. No action needed. Still happy to talk through the Asia allocation whenever you've had a chance to think about it.",
    },
    {
      externalId: "C-045",
      from: "client",
      at: "2026-07-01T10:10:00+08:00",
      text: "Thanks for the statement. Sounds all good.",
    },

    {
      externalId: "C-046",
      from: "advisor",
      at: "2026-07-09T11:20:00+08:00",
      text: "Small admin thing — the insurer wants an updated address for the policy, they've still got your old Puchong one. Just reply with the current address and I'll handle the rest.",
    },
    {
      externalId: "C-047",
      from: "client",
      at: "2026-07-09T11:41:00+08:00",
      text: "Sure — B-12-03, Residensi Aria, Jalan Kerinchi, 59200 KL. Thanks for handling it.",
    },

    {
      externalId: "C-048",
      from: "advisor",
      at: "2026-07-16T15:00:00+08:00",
      text: "Address updated. While I had them on the phone I checked your claims process — it's an online form plus a doctor's letter, much simpler than it used to be. Worth knowing before you ever need it.",
    },
    {
      externalId: "C-049",
      from: "client",
      at: "2026-07-16T15:26:00+08:00",
      text: "Good to know, thanks Wei Han.",
    },

    // ── the most recent 30 days start here (18 July) ──────────────────
    {
      externalId: "C-050",
      from: "advisor",
      at: "2026-07-23T10:30:00+08:00",
      text: "Quarterly review is due — normally we'd do 45 minutes on a call. I've got slots next week Tuesday or Thursday afternoon. Or if you'd rather I just send a written summary this time, say so and that's fine.",
    },
    {
      externalId: "C-051",
      from: "client",
      at: "2026-07-23T10:52:00+08:00",
      text: "A written summary is fine for now, thanks. No need for a call this quarter.",
    },

    {
      externalId: "C-052",
      from: "advisor",
      at: "2026-07-30T11:15:00+08:00",
      text: "Written review attached. Headlines: condo pot RM9,400 and 3 months ahead of schedule, emergency fund at 4.2 months of expenses, income protection active. The one open item is still the Asia allocation question from June.",
    },
    {
      externalId: "C-053",
      from: "client",
      at: "2026-07-30T11:37:00+08:00",
      text: "Read through it and everything looks fine to me. Thanks for putting it together, appreciate it.",
    },

    // ── August ───────────────────────────────────────────────────────
    {
      externalId: "C-054",
      from: "advisor",
      at: "2026-08-06T09:50:00+08:00",
      text: "The Asia ex-Japan question — I'll take the silence as a no, which is a perfectly good answer. Leaving the fund as it is unless you tell me otherwise.",
    },
    {
      externalId: "C-055",
      from: "client",
      at: "2026-08-06T10:14:00+08:00",
      text: "Yes, let's leave it as it is for now. Thanks for checking with me first.",
    },

    {
      externalId: "C-056",
      from: "advisor",
      at: "2026-08-11T14:20:00+08:00",
      text: "Your income protection has a 5% inflation-linked increase option that expires on the first policy anniversary in June next year. Nothing to do now, I just want it on your radar because it can't be added later.",
    },
    {
      externalId: "C-057",
      from: "client",
      at: "2026-08-11T14:39:00+08:00",
      text: "Understood, noted. I'll keep that in mind for next June, thanks for flagging it.",
    },

    {
      externalId: "C-058",
      from: "advisor",
      at: "2026-08-15T10:00:00+08:00",
      text: "August debit went out as normal and the global fund is up 3.4% since inception. Also — you mentioned in April wanting to look at the condo areas seriously by the end of this year. Still the plan, or has that shifted?",
    },
    {
      externalId: "C-059",
      from: "client",
      at: "2026-08-15T10:21:00+08:00",
      text: "Still the plan I think, nothing's changed on my end. Thanks Wei Han, appreciate the update.",
    },
  ],
};
