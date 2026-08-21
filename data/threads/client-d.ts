/**
 * Client D — Adrian Lim. ADVISOR-CAUSED DECAY.
 *
 * Warm and engaged for two months. Two things happen on the advisor's side:
 *
 *   1. D-012 (5 May) — the advisor promises a side-by-side fund comparison
 *      "this week". Adrian chases once on 20 May, gets a second promise
 *      (D-014), and it is never delivered. It's still open on 17 August.
 *
 *   2. 23–27 June — three unsolicited product pitches inside five days.
 *      Adrian's engagement drops immediately and doesn't recover: latency goes
 *      from under an hour to over a day, replies collapse to a few words, he
 *      stops asking anything and never starts a conversation again.
 *
 * The decay is real but the cause is on the advisor's side of the thread.
 */

import type { SeedThread } from "../types.ts";

export const clientD: SeedThread = {
  key: "D",
  clientName: "Adrian Lim",
  handle: "+60 17-556 ••23",
  messages: [
    // ── April — engaged, replies inside the hour ──────────────────────
    {
      externalId: "D-001",
      from: "advisor",
      at: "2026-04-22T09:30:00+08:00",
      text: "Adrian, education fund review as promised. Both kids' pots are on track for local university, but not for the overseas option you mentioned in January. Want me to show you what the gap looks like?",
    },
    {
      externalId: "D-002",
      from: "client",
      at: "2026-04-22T10:05:00+08:00",
      text: "Yes please. Overseas is probably wishful thinking for both, but if Ee Xuan keeps up the way she is I'd hate to be the reason she can't go. What's the actual number?",
    },
    {
      externalId: "D-003",
      from: "advisor",
      at: "2026-04-22T10:35:00+08:00",
      text: "For one child, UK, three years, starting 2035: about RM620k in 2035 money. You're on track for RM310k across both. So overseas for one is roughly a RM450 a month increase starting now, or RM800 if you leave it three years.",
    },
    {
      externalId: "D-004",
      from: "client",
      at: "2026-04-22T11:22:00+08:00",
      text: "RM450 now versus RM800 later is a good argument for now. Let me talk to Su Yin this weekend, I think we can find RM450 if we stop pretending we need two cars.",
    },

    {
      externalId: "D-005",
      from: "client",
      at: "2026-04-28T20:15:00+08:00",
      text: "Spoke to Su Yin. We can do RM450, starting next month. She asked a good question I couldn't answer — if Ee Xuan ends up not going overseas, is the money stuck in something education-specific or can we just use it?",
    },
    {
      externalId: "D-006",
      from: "advisor",
      at: "2026-04-28T20:48:00+08:00",
      text: "Not stuck. I'd put it in an ordinary unit trust in your name rather than an education-labelled product — same growth, none of the restrictions, and if she stays local you use it for whatever you like. The education-branded ones mostly buy you a brochure.",
    },
    {
      externalId: "D-007",
      from: "client",
      at: "2026-04-28T21:20:00+08:00",
      text: "Ordinary unit trust it is. Tell Su Yin the brochure line, she'll enjoy that.",
    },

    // ── May — the promise ────────────────────────────────────────────
    {
      externalId: "D-008",
      from: "advisor",
      at: "2026-05-05T10:00:00+08:00",
      text: "Two funds would suit this: Principal Global Titans and Kenanga Growth. Both fine, different shapes — Titans is bigger and steadier, Kenanga has better five year numbers and a rougher ride.",
    },
    {
      externalId: "D-009",
      from: "client",
      at: "2026-05-05T10:40:00+08:00",
      text: "How different is the rougher ride in practice? I'm not going to panic-sell but I also don't want to open the app in 2028 and see half of it gone.",
    },
    {
      externalId: "D-010",
      from: "advisor",
      at: "2026-05-05T11:05:00+08:00",
      text: "In 2022 Titans was down about 18% and Kenanga about 27%. Both recovered, Kenanga faster. Over ten years the extra volatility has paid for itself, but only if you genuinely don't touch it.",
    },
    {
      externalId: "D-011",
      from: "client",
      at: "2026-05-05T11:52:00+08:00",
      text: "Can I see the two side by side properly? Fees, returns, the bad years. I'd rather decide from a table than from a description, no offence.",
    },
    {
      externalId: "D-012",
      from: "advisor",
      at: "2026-05-05T12:10:00+08:00",
      text: "No offence taken, that's the right way to decide. I'll pull together a proper side-by-side of the two — fees, five year returns, worst drawdown — and get it to you this week.",
    },

    {
      externalId: "D-013",
      from: "client",
      at: "2026-05-20T09:20:00+08:00",
      text: "Morning Wei Han. Did you manage to put that fund comparison together? Happy to wait if you're busy, just don't want the RM450 sitting in the current account doing nothing for another month.",
    },
    {
      externalId: "D-014",
      from: "advisor",
      at: "2026-05-20T10:15:00+08:00",
      text: "Sorry Adrian, it's on my list and I haven't got to it. End of this week, I promise. In the meantime start the RM450 into Titans — it's the safer of the two and we can move it later if the table changes your mind.",
    },
    {
      externalId: "D-015",
      from: "client",
      at: "2026-05-20T11:00:00+08:00",
      text: "Okay, start it in Titans then and I'll look at the comparison when it comes. Send me the form.",
    },

    // ── June — normal, then three pitches in five days ────────────────
    {
      externalId: "D-016",
      from: "advisor",
      at: "2026-06-02T11:30:00+08:00",
      text: "Form processed, first RM450 into Titans went out on 28 May. Education pot is now RM450 a month on top of the existing RM300, so RM750 total across both kids.",
    },
    {
      externalId: "D-017",
      from: "client",
      at: "2026-06-02T12:15:00+08:00",
      text: "Saw the debit. That feels good actually — Su Yin and I have been meaning to sort this since Ee Xuan was born. Does the RM750 get reviewed every year or do we just leave it?",
    },
    {
      externalId: "D-018",
      from: "advisor",
      at: "2026-06-02T12:45:00+08:00",
      text: "Review it once a year against fees at the universities you're actually looking at. Fees rise about 5% a year, so the number will need to move — but not more often than annually, otherwise you're just fiddling.",
    },

    {
      externalId: "D-019",
      from: "client",
      at: "2026-06-10T19:40:00+08:00",
      text: "Question from the plant. A few of us got told our shift allowance is being restructured, could be RM400 a month less from August. If that happens do I cut the RM450 or find it elsewhere?",
    },
    {
      externalId: "D-020",
      from: "advisor",
      at: "2026-06-10T20:22:00+08:00",
      text: "Find it elsewhere if you can, and if you can't, cut the RM300 old one before the RM450 — the new money is doing the heavy lifting on the overseas gap. Tell me when you know for certain and we'll do it properly rather than guessing.",
    },
    {
      externalId: "D-021",
      from: "client",
      at: "2026-06-10T21:05:00+08:00",
      text: "Makes sense. Should know by early July, I'll tell you either way.",
    },

    {
      externalId: "D-022",
      from: "advisor",
      at: "2026-06-18T10:20:00+08:00",
      text: "Titans is up 1.8% since you started, which means nothing over six weeks but at least it's not down. Nothing needed from you.",
    },
    {
      externalId: "D-023",
      from: "client",
      at: "2026-06-18T11:02:00+08:00",
      text: "Ha, I'll take not-down. Thanks for checking in.",
    },

    // pitch 1
    {
      externalId: "D-024",
      from: "advisor",
      at: "2026-06-23T09:15:00+08:00",
      text: "Adrian, something you should look at. We've got a limited tranche of a structured investment-linked plan closing at the end of the month — 8% projected, capital protected at maturity. Minimum RM30k. It's the kind of thing that doesn't come round often and I'd hate for you to miss it. Can I send you the brochure?",
    },
    {
      externalId: "D-025",
      from: "client",
      at: "2026-06-23T12:30:00+08:00",
      text: "Send it I suppose, but RM30k is more or less our entire emergency fund so I doubt it. We only just started the RM450.",
    },

    // pitch 2
    {
      externalId: "D-026",
      from: "advisor",
      at: "2026-06-26T09:00:00+08:00",
      text: "Following up on the tranche — I can do it at RM20k minimum if you commit before Friday, I spoke to the product team. Also worth mentioning while we're here: your medical card has a critical illness rider available at your age band that gets materially more expensive after 37. You're 36 in October. Worth adding both together?",
    },
    {
      externalId: "D-027",
      from: "client",
      at: "2026-06-26T18:20:00+08:00",
      text: "Not doing RM20k either. I'll think about the CI rider.",
    },

    // pitch 3
    {
      externalId: "D-028",
      from: "advisor",
      at: "2026-06-27T10:30:00+08:00",
      text: "Understood on the tranche. On the CI rider — last day of the current rates is 30 June, so if you want it at the RM148 band rather than RM196 I'd need the form back today or tomorrow. I've attached it pre-filled, you just need to sign page 2. Sorry to push, it's genuinely a rate deadline and not a sales one.",
    },
    {
      externalId: "D-029",
      from: "client",
      at: "2026-06-28T08:40:00+08:00",
      text: "Let me think about it.",
    },

    // ── July — engagement gone ───────────────────────────────────────
    {
      externalId: "D-030",
      from: "advisor",
      at: "2026-07-03T10:00:00+08:00",
      text: "No pressure on the rider, the deadline's passed and RM196 is still reasonable if you want it later. Separately — did the shift allowance change come through?",
    },
    {
      externalId: "D-031",
      from: "client",
      at: "2026-07-04T13:10:00+08:00",
      text: "Still not confirmed.",
    },

    {
      externalId: "D-032",
      from: "advisor",
      at: "2026-07-10T09:30:00+08:00",
      text: "June statement is out — education pot RM1,830 across both, Titans up 2.4%. Let me know about the allowance when you hear and we'll adjust the RM450 if we need to.",
    },
    {
      externalId: "D-033",
      from: "client",
      at: "2026-07-11T16:45:00+08:00",
      text: "Ok noted.",
    },

    {
      externalId: "D-034",
      from: "advisor",
      at: "2026-07-16T11:00:00+08:00",
      text: "Adrian, one thing I want to check — are you happy with how this is going? I pushed hard on a couple of products in June and I'm conscious it may have been more than you wanted. If so I'd rather you tell me.",
    },
    {
      externalId: "D-035",
      from: "client",
      at: "2026-07-17T20:30:00+08:00",
      text: "It's fine, no issue.",
    },

    // ── the most recent 30 days start here (18 July) ──────────────────
    {
      externalId: "D-036",
      from: "advisor",
      at: "2026-07-22T09:45:00+08:00",
      text: "Mid-year education review is due in September. Nothing to prepare, but I'll need 30 minutes with you and Su Yin — easier if I know now whether weekends or weekday evenings work better for her.",
    },
    {
      externalId: "D-037",
      from: "client",
      at: "2026-07-23T14:50:00+08:00",
      text: "Weekends better I think.",
    },

    {
      externalId: "D-038",
      from: "advisor",
      at: "2026-07-29T10:15:00+08:00",
      text: "Noted, weekends. Also the RM300 older contribution is going into a fund that's changed its mandate — it's more conservative now than when we picked it, which doesn't suit a 12 year horizon. I'd move it. Happy to just do it, but it's your money so I'd rather you said yes.",
    },
    {
      externalId: "D-039",
      from: "client",
      at: "2026-07-31T08:20:00+08:00",
      text: "Yes ok, move it.",
    },

    // ── August ───────────────────────────────────────────────────────
    {
      externalId: "D-040",
      from: "advisor",
      at: "2026-08-04T09:30:00+08:00",
      text: "Moved. Both contributions now sit in funds that match the horizon. Did the shift allowance land in the end? August payslip should show it either way.",
    },
    {
      externalId: "D-041",
      from: "client",
      at: "2026-08-05T11:40:00+08:00",
      text: "Yes it dropped. RM380 less.",
    },

    {
      externalId: "D-042",
      from: "advisor",
      at: "2026-08-10T09:00:00+08:00",
      text: "Right — so we're RM380 a month tighter. My suggestion: drop the old RM300 to RM100 and keep the RM450 untouched. That protects the overseas plan and gives you RM200 back. Shall I do that?",
    },
    {
      externalId: "D-043",
      from: "client",
      at: "2026-08-11T18:15:00+08:00",
      text: "Ok do that.",
    },

    {
      externalId: "D-044",
      from: "advisor",
      at: "2026-08-14T10:20:00+08:00",
      text: "Done, effective from the September debit. Adrian, separately — I still owe you that fund comparison from May and I never sent it. I'm going to get it to you this week, properly this time. Apologies, that one's on me.",
    },
  ],
};
