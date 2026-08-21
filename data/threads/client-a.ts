/**
 * Client A — Priya Ramasamy. HEALTHY.
 *
 * Steady reply latency (mostly 40–90 min, all the way through), asks real
 * questions every couple of weeks, and starts roughly half the conversations
 * herself. Nothing to flag. This is the control.
 */

import type { SeedThread } from "../types.ts";

export const clientA: SeedThread = {
  key: "A",
  clientName: "Priya Ramasamy",
  handle: "+60 12-388 ••41",
  messages: [
    // ── April ────────────────────────────────────────────────────────
    {
      externalId: "A-001",
      from: "advisor",
      at: "2026-04-21T10:04:00+08:00",
      text: "Morning Priya. Your Q1 statement came through — PRS is up 4.1% for the quarter, ASB portion flat as expected. Want the PDF, or shall I walk you through it on a call?",
    },
    {
      externalId: "A-002",
      from: "client",
      at: "2026-04-21T11:12:00+08:00",
      text: "PDF first please, I'll read it over lunch. If I have questions can we do a quick call Thursday evening? After 8pm is easier, I'm on late shift till then.",
    },
    {
      externalId: "A-003",
      from: "advisor",
      at: "2026-04-21T11:29:00+08:00",
      text: "Sent. Thursday 8.30pm works, I'll keep it to 20 minutes.",
    },
    {
      externalId: "A-004",
      from: "client",
      at: "2026-04-21T13:50:00+08:00",
      text: "Read it. Two things — why did the PRS fee line go from 1.5 to 1.8, and is it worth topping up before the RM3k relief cutoff or should I spread it out?",
    },
    {
      externalId: "A-005",
      from: "advisor",
      at: "2026-04-21T14:22:00+08:00",
      text: "Fee change is the fund house, effective March, applies to everyone in that fund — not something you did. On the top-up: spread it. December is when everyone piles in. RM500 a month from May gets you to the cap without the year-end scramble.",
    },
    {
      externalId: "A-006",
      from: "client",
      at: "2026-04-21T15:05:00+08:00",
      text: "Okay let's do RM500 a month. From the Maybank account please, not the CIMB one.",
    },

    {
      externalId: "A-007",
      from: "client",
      at: "2026-04-24T08:11:00+08:00",
      text: "Signed the standing instruction form and emailed it back. Also my sister asked who I use and I gave her your number, hope that's alright.",
    },
    {
      externalId: "A-008",
      from: "advisor",
      at: "2026-04-24T09:02:00+08:00",
      text: "More than alright, thank you. Form received.",
    },
    {
      externalId: "A-009",
      from: "client",
      at: "2026-04-24T09:48:00+08:00",
      text: "👍",
    },

    {
      externalId: "A-010",
      from: "client",
      at: "2026-04-28T19:44:00+08:00",
      text: "Random one — the hospital is switching group insurance provider next month. Does that affect the medical card I have with you at all?",
    },
    {
      externalId: "A-011",
      from: "advisor",
      at: "2026-04-28T20:15:00+08:00",
      text: "No, yours is an individual policy, it doesn't touch the group plan. But send me the new group brochure when you get it. If the group cover improves we might drop your rider a tier and save you a few hundred a year.",
    },
    {
      externalId: "A-012",
      from: "client",
      at: "2026-04-28T21:02:00+08:00",
      text: "Will do. HR said they're sending it out first week of May.",
    },

    {
      externalId: "A-013",
      from: "advisor",
      at: "2026-04-30T10:20:00+08:00",
      text: "Month-end note: first RM500 PRS debit is set for 10 May. You'll see it on the May statement.",
    },
    {
      externalId: "A-014",
      from: "client",
      at: "2026-04-30T11:35:00+08:00",
      text: "Noted. Is the debit date fixed or can I move it to the 25th? Salary lands on the 24th.",
    },

    // ── May ──────────────────────────────────────────────────────────
    {
      externalId: "A-015",
      from: "client",
      at: "2026-05-06T13:22:00+08:00",
      text: "Brochure attached. Looks like the new group plan covers outpatient specialist, which the old one didn't.",
    },
    {
      externalId: "A-016",
      from: "advisor",
      at: "2026-05-06T15:40:00+08:00",
      text: "Good spot, that does overlap with your rider. Let me check the exact limits — if the group covers up to RM8k outpatient I'd trim your rider at the September renewal. Give me till Friday.",
    },
    {
      externalId: "A-017",
      from: "client",
      at: "2026-05-06T16:31:00+08:00",
      text: "No rush. Roughly how much would that save?",
    },

    {
      externalId: "A-018",
      from: "advisor",
      at: "2026-05-08T11:12:00+08:00",
      text: "Checked. Group covers RM8k outpatient, so trimming your rider saves about RM480 a year. Not huge, but you're currently paying twice for the same limit.",
    },
    {
      externalId: "A-019",
      from: "client",
      at: "2026-05-08T12:44:00+08:00",
      text: "Then yes, do it. I'd rather the RM480 went into the PRS than to two companies for one thing.",
    },
    {
      externalId: "A-020",
      from: "advisor",
      at: "2026-05-08T13:05:00+08:00",
      text: "Agreed. It has to happen at renewal, not now — I'll queue it for September and remind you when the signature is needed.",
    },
    {
      externalId: "A-021",
      from: "client",
      at: "2026-05-08T14:20:00+08:00",
      text: "Perfect. Put a reminder on your side, I will absolutely forget.",
    },

    {
      externalId: "A-022",
      from: "advisor",
      at: "2026-05-12T09:30:00+08:00",
      text: "Standing instruction is live and the debit date moved to the 25th as you asked. First one goes out 25 May.",
    },
    {
      externalId: "A-023",
      from: "client",
      at: "2026-05-12T10:26:00+08:00",
      text: "Thanks for sorting the date, that's much easier.",
    },

    {
      externalId: "A-024",
      from: "client",
      at: "2026-05-19T21:33:00+08:00",
      text: "Something different. My husband's company is offering him an ESOS, three year vest. He doesn't understand it and neither do I. Is that something you'd look at or is it outside your scope?",
    },
    {
      externalId: "A-025",
      from: "advisor",
      at: "2026-05-19T22:04:00+08:00",
      text: "I can look at it. Send the offer document and the vesting schedule. Two things matter: the strike price versus what a share is actually worth now, and whether he can afford to exercise when the time comes without selling something else.",
    },
    {
      externalId: "A-026",
      from: "client",
      at: "2026-05-20T07:48:00+08:00",
      text: "Both attached. He's convinced it's a polite way of paying him less cash. Is he being cynical?",
    },
    {
      externalId: "A-027",
      from: "advisor",
      at: "2026-05-20T12:30:00+08:00",
      text: "Sometimes it is exactly that. Reading it properly now — I'll give you a straight answer by Friday.",
    },

    {
      externalId: "A-028",
      from: "advisor",
      at: "2026-05-22T16:10:00+08:00",
      text: "Read it. Strike RM2.10, last internal valuation RM2.65, so there's real value on paper. But there's no secondary market — it's worth nothing spendable until the company lists or gets bought. My read: treat it as a bonus that might never arrive, and don't let it change how much he saves in cash.",
    },
    {
      externalId: "A-029",
      from: "client",
      at: "2026-05-22T17:26:00+08:00",
      text: "That's roughly what he suspected but he wanted someone who wasn't him to say it. Thanks for actually reading the thing.",
    },

    {
      externalId: "A-030",
      from: "client",
      at: "2026-05-28T12:14:00+08:00",
      text: "Damage report: I overspent about RM1,800 across raya and two weddings. Should I skip a PRS month to catch up or just eat it?",
    },
    {
      externalId: "A-031",
      from: "advisor",
      at: "2026-05-28T13:02:00+08:00",
      text: "Eat it. RM1,800 spread over the next few months is noise, and a standing instruction you stop once tends to stay stopped. If it's genuinely tight, skip the June emergency-fund top-up instead — that one's already at five months of expenses.",
    },
    {
      externalId: "A-032",
      from: "client",
      at: "2026-05-28T13:41:00+08:00",
      text: "Eating it then 😅 skipping June on the emergency fund.",
    },

    // ── June ─────────────────────────────────────────────────────────
    {
      externalId: "A-033",
      from: "advisor",
      at: "2026-06-03T10:20:00+08:00",
      text: "Mid-year position: EPF declared 5.9% and it's credited. Your combined portfolio is up 3.8% year to date, ahead of the 3% the plan assumes. Nothing needs changing, just so you know where you stand.",
    },
    {
      externalId: "A-034",
      from: "client",
      at: "2026-06-03T11:58:00+08:00",
      text: "Good to hear. Is 3% still the right planning number or are we being too conservative?",
    },
    {
      externalId: "A-035",
      from: "advisor",
      at: "2026-06-03T12:24:00+08:00",
      text: "I'd keep 3%. If reality beats it you retire earlier, which is a much nicer surprise than the other direction.",
    },
    {
      externalId: "A-036",
      from: "client",
      at: "2026-06-03T13:15:00+08:00",
      text: "Fair enough. Leave it at 3%.",
    },

    {
      externalId: "A-037",
      from: "client",
      at: "2026-06-11T20:10:00+08:00",
      text: "Hi Wei Han, my father in law is 68 and has no medical card. Two insurers rejected him for diabetes. Is there anything at all for someone in that position or is it simply too late?",
    },
    {
      externalId: "A-038",
      from: "advisor",
      at: "2026-06-11T21:02:00+08:00",
      text: "Honest answer: standard medical cards, no. What's left is a guaranteed-acceptance plan with a two year waiting period and low limits, or self-funding. If the family can put RM500 a month into a separate account, that is usually better value than anything I could sell him. I'd rather tell you that than write a policy.",
    },
    {
      externalId: "A-039",
      from: "client",
      at: "2026-06-11T21:40:00+08:00",
      text: "I appreciate you saying that instead of selling us something. We'll do the separate account.",
    },

    {
      externalId: "A-040",
      from: "advisor",
      at: "2026-06-18T11:40:00+08:00",
      text: "Rider trim is queued with the insurer for the September renewal. I'll need one signature in late August — I'll chase you for it.",
    },
    {
      externalId: "A-041",
      from: "client",
      at: "2026-06-18T12:31:00+08:00",
      text: "Noted, thanks. Late August is fine, I'm not travelling.",
    },

    {
      externalId: "A-042",
      from: "client",
      at: "2026-06-25T08:33:00+08:00",
      text: "Is now a bad time to buy into the tech fund? Everyone at work is talking about it and I don't trust that feeling at all.",
    },
    {
      externalId: "A-043",
      from: "advisor",
      at: "2026-06-25T09:47:00+08:00",
      text: "That instinct is correct. You already hold tech through the global fund, about 22% of it. A sector fund on top would put roughly 35% of your portfolio in one theme. If you want more risk I'd rather lift the whole global allocation 5% than concentrate it.",
    },
    {
      externalId: "A-044",
      from: "client",
      at: "2026-06-25T10:39:00+08:00",
      text: "Let's do the 5% then. Boring is fine, I've made the exciting mistake before.",
    },

    // ── July ─────────────────────────────────────────────────────────
    {
      externalId: "A-045",
      from: "advisor",
      at: "2026-07-02T10:12:00+08:00",
      text: "5% shift done — global fund 40 to 45, bond portion down to 25. Confirmation is in your email.",
    },
    {
      externalId: "A-046",
      from: "client",
      at: "2026-07-02T11:30:00+08:00",
      text: "Got the confirmation, thanks.",
    },

    {
      externalId: "A-047",
      from: "advisor",
      at: "2026-07-04T17:20:00+08:00",
      text: "Heads up, I'm on leave 6–13 July. Sarah in the office covers anything urgent, and I'll still see Telegram in the evenings.",
    },
    {
      externalId: "A-048",
      from: "client",
      at: "2026-07-04T18:35:00+08:00",
      text: "Enjoy it. Nothing urgent from me — where are you off to?",
    },

    {
      externalId: "A-049",
      from: "client",
      at: "2026-07-15T19:22:00+08:00",
      text: "Half-year statement question: the bond fund is down 0.9% while everything else is up. Is that meant to happen or should I be worried?",
    },
    {
      externalId: "A-050",
      from: "advisor",
      at: "2026-07-15T20:15:00+08:00",
      text: "Meant to happen. Rates moved and bond prices fall when they do. It's doing its job — it's the part that doesn't drop 20% when equities do. If it always moved in the same direction as the equity fund it wouldn't be diversification, it'd be decoration.",
    },
    {
      externalId: "A-051",
      from: "client",
      at: "2026-07-15T20:58:00+08:00",
      text: "Decoration, ha. Okay, leaving it alone.",
    },

    // ── the most recent 30 days start here (18 July) ──────────────────
    {
      externalId: "A-052",
      from: "advisor",
      at: "2026-07-21T09:05:00+08:00",
      text: "Two things. Your PRS hits the RM3k relief cap with the September debit, so I'll pause the standing instruction after that and restart it in January. Second, the September rider trim is confirmed with the insurer.",
    },
    {
      externalId: "A-053",
      from: "client",
      at: "2026-07-21T10:11:00+08:00",
      text: "Both fine. If I pause in September, does the January restart still count for next year's relief or do I lose a month?",
    },
    {
      externalId: "A-054",
      from: "advisor",
      at: "2026-07-21T10:20:00+08:00",
      text: "Still counts, the relief runs on the calendar year. January to September at RM500 hits the cap again with room to spare.",
    },
    {
      externalId: "A-055",
      from: "client",
      at: "2026-07-21T11:02:00+08:00",
      text: "Good, do that. Pause September, restart January.",
    },

    {
      externalId: "A-056",
      from: "client",
      at: "2026-07-28T10:40:00+08:00",
      text: "Bit of news — my hospital contract is being converted to permanent, salary up RM900 a month from September. Where should that go?",
    },
    {
      externalId: "A-057",
      from: "advisor",
      at: "2026-07-28T12:15:00+08:00",
      text: "Congratulations, that's overdue. Split it: RM400 to the emergency fund until it's six months, RM300 to the global fund, and genuinely spend the last RM200. A plan you resent doesn't survive contact with a bad week.",
    },
    {
      externalId: "A-058",
      from: "client",
      at: "2026-07-28T13:04:00+08:00",
      text: "Spending RM200 guilt-free, I like this plan. Start it from the September payslip.",
    },

    // ── August ───────────────────────────────────────────────────────
    {
      externalId: "A-059",
      from: "client",
      at: "2026-08-05T09:18:00+08:00",
      text: "Just realised the policy still lists only my husband as nominee. Is it worth naming both kids now, or wait until the younger one isn't a toddler?",
    },
    {
      externalId: "A-060",
      from: "advisor",
      at: "2026-08-05T10:40:00+08:00",
      text: "Name them now. A minor nominee needs a trustee named alongside them, which is one extra line on the form, and it means the money isn't stuck in probate if something happens this year. Waiting buys you nothing.",
    },
    {
      externalId: "A-061",
      from: "client",
      at: "2026-08-05T11:52:00+08:00",
      text: "Do it. My sister as trustee — she's the sensible one.",
    },

    {
      externalId: "A-062",
      from: "advisor",
      at: "2026-08-12T09:30:00+08:00",
      text: "Nomination form and the renewal signature both need doing this week. Sending them together now — one signature each, and the rider trim takes effect at the September renewal.",
    },
    {
      externalId: "A-063",
      from: "client",
      at: "2026-08-12T10:35:00+08:00",
      text: "Both signed and sent back. Does the trim change my premium immediately or from September?",
    },
    {
      externalId: "A-064",
      from: "advisor",
      at: "2026-08-12T11:02:00+08:00",
      text: "From September, and the lower premium shows on the October debit. Got both forms, thank you.",
    },
    {
      externalId: "A-065",
      from: "client",
      at: "2026-08-12T11:44:00+08:00",
      text: "Understood. September it is.",
    },

    {
      externalId: "A-066",
      from: "client",
      at: "2026-08-14T18:03:00+08:00",
      text: "One more. A colleague said I should be putting money in gold because of everything going on. I assume you'll tell me no, but I'd rather ask than quietly do something stupid.",
    },
    {
      externalId: "A-067",
      from: "advisor",
      at: "2026-08-14T19:10:00+08:00",
      text: "Not a flat no, but a small one. If it helps you sleep, 5% and no more, and buy it as a fund rather than physical so you're not storing bars in a wardrobe. It pays nothing while you hold it — that's the trade.",
    },
    {
      externalId: "A-068",
      from: "client",
      at: "2026-08-14T19:52:00+08:00",
      text: "5% as a fund then. Thanks for not being sniffy about the question.",
    },
  ],
};
