/**
 * Client B — Faizal Rahman. OBVIOUS DECAY.
 *
 * Reply latency climbs across the whole period: ~40 min in April, hours by
 * May, half a day by June, a full day by July, two-plus days by August.
 * Replies shorten in step — paragraphs to sentences to "ok". He stops starting
 * conversations after mid-June, and there are two meeting reschedules in the
 * last fortnight. Nothing subtle here; this one should be visible from orbit.
 */

import type { SeedThread } from "../types.ts";

export const clientB: SeedThread = {
  key: "B",
  clientName: "Faizal Rahman",
  handle: "+60 19-274 ••08",
  messages: [
    // ── April — engaged, fast, long replies ──────────────────────────
    {
      externalId: "B-001",
      from: "advisor",
      at: "2026-04-19T10:15:00+08:00",
      text: "Faizal, the business insurance quotes are in — three insurers for the keyman cover on you and Hafiz. Cheapest isn't the one I'd pick, so let me talk you through the difference before you look at the numbers.",
    },
    {
      externalId: "B-002",
      from: "client",
      at: "2026-04-19T10:50:00+08:00",
      text: "Go ahead. I've been thinking about this since the machine broke down in Feb — if I'm out for three months the shop stops, and Hafiz can't sign for the bank on his own. That's the bit that keeps me up.",
    },
    {
      externalId: "B-003",
      from: "advisor",
      at: "2026-04-19T11:20:00+08:00",
      text: "Then the cheapest quote is out — it excludes anything the doctor can call pre-existing, and you had the back surgery in 2023. Second quote is RM180 a month more and covers it after 12 months. That's the one.",
    },
    {
      externalId: "B-004",
      from: "client",
      at: "2026-04-19T12:02:00+08:00",
      text: "RM180 more for actually being covered is not a hard decision. Let's take the second one. Send me whatever needs signing and I'll do it tonight after closing.",
    },

    {
      externalId: "B-005",
      from: "client",
      at: "2026-04-22T09:05:00+08:00",
      text: "Wei Han, question before I sign. If I claim on this, does the payout go to me or to the company account? Tax treatment is different, right? My accountant will ask and I'd rather have the answer first.",
    },
    {
      externalId: "B-006",
      from: "advisor",
      at: "2026-04-22T10:12:00+08:00",
      text: "Company, because the company pays the premium and is the beneficiary. Payout is a trading receipt, so it's taxable — but the premium is deductible. Your accountant will know the shape of it, tell her it's keyman on a company-owned policy.",
    },
    {
      externalId: "B-007",
      from: "client",
      at: "2026-04-22T11:00:00+08:00",
      text: "Perfect, that's exactly what she needed. Signing tonight.",
    },

    {
      externalId: "B-008",
      from: "client",
      at: "2026-04-29T18:40:00+08:00",
      text: "Different topic. Two of my staff have been with me six years now and I've got nothing set up for them beyond EPF. Is there something small I can do that actually means something to them? I don't want a scheme that costs me RM2k a month.",
    },
    {
      externalId: "B-009",
      from: "advisor",
      at: "2026-04-29T19:25:00+08:00",
      text: "Group medical card for the two of them is roughly RM95 each a month and it's the one they'll actually feel — it's what they'd otherwise pay out of pocket at the clinic. A group PRS looks generous on paper but they won't see it for 30 years.",
    },
    {
      externalId: "B-010",
      from: "client",
      at: "2026-04-29T20:15:00+08:00",
      text: "RM190 total I can do. Do it for both of them. And can you write me one page I can hand them explaining what it covers? In Malay if possible, Rosli reads English but slowly.",
    },
    {
      externalId: "B-011",
      from: "advisor",
      at: "2026-04-29T20:44:00+08:00",
      text: "I'll get you a one-pager in both. Give me till next week.",
    },

    // ── May — latency in hours now, still substantial replies ────────
    {
      externalId: "B-012",
      from: "advisor",
      at: "2026-05-06T11:30:00+08:00",
      text: "Keyman policy is in force from 1 May, and here's the staff one-pager in English and Malay. Group medical for Rosli and Aida starts 15 May.",
    },
    {
      externalId: "B-013",
      from: "client",
      at: "2026-05-06T13:40:00+08:00",
      text: "Got it, thanks. Gave them the sheet this morning, Aida was genuinely pleased. Good move.",
    },
    {
      externalId: "B-014",
      from: "advisor",
      at: "2026-05-06T14:05:00+08:00",
      text: "Glad it landed. Next thing when you have time: you've got RM68k sitting in the current account doing nothing. Worth talking about.",
    },

    {
      externalId: "B-015",
      from: "client",
      at: "2026-05-13T15:20:00+08:00",
      text: "About the RM68k. Half of that is for the new cutter in Q4, so I can't lock it up. What can I do with money I might need in six months?",
    },
    {
      externalId: "B-016",
      from: "advisor",
      at: "2026-05-13T16:10:00+08:00",
      text: "Money market fund. Roughly 3.4% at the moment, no lock-in, two working days to get it out. Not exciting, but it's a lot better than 0.25% in the current account — about RM1,100 a year on RM34k for a form you sign once.",
    },
    {
      externalId: "B-017",
      from: "client",
      at: "2026-05-13T19:50:00+08:00",
      text: "Do it with RM34k, keep the rest liquid for the cutter deposit. Send the form.",
    },

    {
      externalId: "B-018",
      from: "advisor",
      at: "2026-05-21T10:00:00+08:00",
      text: "Money market form attached. Also — you mentioned wanting to sort out what happens to your share of the business if something happens to you. Worth a proper sit-down, an hour, not WhatsApp.",
    },
    {
      externalId: "B-019",
      from: "client",
      at: "2026-05-21T14:35:00+08:00",
      text: "Form signed, sent to your email. The business succession thing yes, I know I keep putting it off. After Raya rush maybe, June?",
    },
    {
      externalId: "B-020",
      from: "advisor",
      at: "2026-05-21T15:00:00+08:00",
      text: "June works. I'll suggest some dates closer to the time.",
    },
    {
      externalId: "B-021",
      from: "client",
      at: "2026-05-21T18:20:00+08:00",
      text: "Ok good.",
    },

    {
      externalId: "B-022",
      from: "client",
      at: "2026-05-27T12:15:00+08:00",
      text: "Quick one — got a letter from LHDN about the 2024 filing. Is that something you look at or do I go to my accountant? Not sure who owns this.",
    },
    {
      externalId: "B-023",
      from: "advisor",
      at: "2026-05-27T16:05:00+08:00",
      text: "Accountant, that's hers. Send me a copy anyway so I know what's going on if it affects cash flow.",
    },

    // ── June — half a day to reply, replies getting shorter ──────────
    {
      externalId: "B-024",
      from: "advisor",
      at: "2026-06-03T10:30:00+08:00",
      text: "Money market is funded, RM34k in as of 29 May. First distribution shows end of June. Also holding you to that succession conversation — I've got the 12th or the 19th free.",
    },
    {
      externalId: "B-025",
      from: "client",
      at: "2026-06-03T19:40:00+08:00",
      text: "Saw the confirmation. Let me check with Hafiz about the dates, he should be in the room for that one.",
    },
    {
      externalId: "B-026",
      from: "advisor",
      at: "2026-06-03T20:10:00+08:00",
      text: "Agreed, he should. Let me know either way.",
    },

    {
      externalId: "B-027",
      from: "client",
      at: "2026-06-10T09:10:00+08:00",
      text: "Hafiz says 19th is better. Also the cutter deposit is due earlier than I thought, end of July not Q4. Does that change what I should do with the rest?",
    },
    {
      externalId: "B-028",
      from: "advisor",
      at: "2026-06-10T10:25:00+08:00",
      text: "Not really — the other RM34k is still in the current account precisely for this, so it's there. Don't touch the money market for the deposit, leave that running. 19th booked, 3pm at your office?",
    },
    {
      externalId: "B-029",
      from: "client",
      at: "2026-06-10T20:15:00+08:00",
      text: "3pm on the 19th, ok.",
    },

    {
      externalId: "B-030",
      from: "advisor",
      at: "2026-06-17T11:00:00+08:00",
      text: "Confirming Thursday 3pm. I'll bring a draft of how a buy-sell agreement between you and Hafiz would work, plus what it'd cost to fund it.",
    },
    {
      externalId: "B-031",
      from: "client",
      at: "2026-06-18T00:20:00+08:00",
      text: "Ok see you thursday.",
    },

    {
      externalId: "B-032",
      from: "advisor",
      at: "2026-06-24T10:15:00+08:00",
      text: "Good session last week. As promised, the buy-sell draft is attached — cross-option, funded by a policy on each of you, about RM310 a month each at the RM400k valuation we discussed. Read it when you get a chance and mark anything you don't like.",
    },
    {
      externalId: "B-033",
      from: "client",
      at: "2026-06-25T00:40:00+08:00",
      text: "Received. Will read.",
    },

    // ── July — a day or more, one line answers ──────────────────────
    {
      externalId: "B-034",
      from: "advisor",
      at: "2026-07-01T10:20:00+08:00",
      text: "Any thoughts on the buy-sell draft? No rush on signing, but if the RM400k valuation feels wrong that's the part worth arguing about now rather than later.",
    },
    {
      externalId: "B-035",
      from: "client",
      at: "2026-07-02T12:30:00+08:00",
      text: "Not read it properly yet. Busy month.",
    },

    {
      externalId: "B-036",
      from: "advisor",
      at: "2026-07-08T09:45:00+08:00",
      text: "Understood. Two things that don't need the draft: money market paid RM291 for June, and the cutter deposit — do you want me to move the RM34k to the current account so it's ready?",
    },
    {
      externalId: "B-037",
      from: "client",
      at: "2026-07-09T16:20:00+08:00",
      text: "Yes move it. Thanks.",
    },

    {
      externalId: "B-038",
      from: "advisor",
      at: "2026-07-14T10:00:00+08:00",
      text: "Moved, it's in the current account. That leaves the buy-sell as the only thing open between us. Want me to just call you and walk through it in ten minutes instead of you reading it?",
    },
    {
      externalId: "B-039",
      from: "client",
      at: "2026-07-15T18:05:00+08:00",
      text: "Maybe next week.",
    },

    // ── the most recent 30 days start here (18 July) ──────────────────
    {
      externalId: "B-040",
      from: "advisor",
      at: "2026-07-20T09:30:00+08:00",
      text: "Following up on that call. I've got Wednesday or Friday afternoon this week — either works, ten minutes on the phone and the buy-sell is done.",
    },
    {
      externalId: "B-041",
      from: "client",
      at: "2026-07-22T06:10:00+08:00",
      text: "This week hard. Next week better.",
    },

    {
      externalId: "B-042",
      from: "advisor",
      at: "2026-07-29T09:15:00+08:00",
      text: "It's next week — shall I call you Thursday 4pm? Also your keyman premium renews 1 September, no change to the amount, nothing you need to do.",
    },
    {
      externalId: "B-043",
      from: "client",
      at: "2026-07-31T13:40:00+08:00",
      text: "Noted on the renewal.",
    },

    {
      externalId: "B-044",
      from: "advisor",
      at: "2026-08-03T10:00:00+08:00",
      text: "I'll stop chasing the call and just put a meeting in — Wednesday 5 August, 3pm at your office, same as last time. Half an hour and we close this off.",
    },
    {
      externalId: "B-045",
      from: "client",
      at: "2026-08-04T12:10:00+08:00",
      text: "Sorry Wei Han, Wednesday no good. Push it.",
    },
    {
      externalId: "B-046",
      from: "advisor",
      at: "2026-08-04T12:35:00+08:00",
      text: "No problem. Monday 10 August, 3pm?",
    },

    {
      externalId: "B-047",
      from: "advisor",
      at: "2026-08-10T08:30:00+08:00",
      text: "Confirming this afternoon, 3pm at yours.",
    },
    {
      externalId: "B-048",
      from: "client",
      at: "2026-08-10T14:05:00+08:00",
      text: "Cannot today. Something came up at the shop.",
    },
    {
      externalId: "B-049",
      from: "advisor",
      at: "2026-08-10T14:20:00+08:00",
      text: "Alright. Tell me a week that works and I'll fit around you.",
    },

    {
      externalId: "B-050",
      from: "advisor",
      at: "2026-08-13T09:40:00+08:00",
      text: "Faizal — I don't want to keep pushing a meeting you don't have room for. Is the buy-sell still something you want to do this year, or should I park it and leave you alone until you're ready? Either answer is fine, I'd just rather know.",
    },
    {
      externalId: "B-051",
      from: "client",
      at: "2026-08-15T22:50:00+08:00",
      text: "Park it for now.",
    },
  ],
};
