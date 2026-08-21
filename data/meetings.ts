/**
 * Meetings, and what was said in them.
 *
 * The thing an advisor forgets is never in the chat export. It is the sentence
 * a client said forty minutes into a Zoom call — the daughter starting
 * university in Melbourne, the brother who got burned on a property deal, the
 * reason they will not touch anything with a lock-in. That is the material
 * personalised retention is actually made of, and today it lives in nobody's
 * notes.
 *
 * ── consent is a field, not a footnote ───────────────────────────────
 * Recording a client without their agreement is a PDPA problem in Malaysia and
 * a trust problem everywhere, so consent is part of the record rather than a
 * policy someone is expected to remember. Three states, and the difference
 * between the last two matters:
 *
 *   granted     they said yes; notes exist
 *   declined    they said no; the meeting happened and there are no notes
 *   not-asked   nobody asked, so there are no notes and that is a gap in
 *               process rather than a decision the client made
 *
 * The UI shows all three. A meeting with no notes because someone declined is
 * a fact about the relationship; one with no notes because nobody asked is a
 * fact about the advisor. Collapsing them into "no notes" would hide the second.
 *
 * ── every point carries its moment ───────────────────────────────────
 * `at` on a point is when it was said, not when the meeting started. "Forty
 * minutes in" is what makes a note findable again in a recording, and the block
 * this feeds is a timeline rather than a summary.
 *
 * Ids are `G-nnn`, their own namespace, so a point can be cited alongside a
 * message without the two colliding.
 */

import type { ClientKey } from "./types.ts";

export type Consent = "granted" | "declined" | "not-asked";
export type MeetingKind = "zoom" | "in-person" | "phone";

/** What a note is about, which is what makes it findable later. */
export type PointKind = "personal" | "concern" | "goal" | "promise" | "fact";

export interface KeyPoint {
  id: string;
  /** When it was said. ISO 8601, +08:00. */
  at: string;
  kind: PointKind;
  text: string;
}

export interface Meeting {
  id: string;
  client: ClientKey;
  at: string;
  kind: MeetingKind;
  /** Where it happened, or what it was on. */
  where: string;
  minutes: number;
  consent: Consent;
  /** Empty unless consent was granted. Enforced in src/keypoints.ts. */
  points: KeyPoint[];
}

export const meetings: Meeting[] = [
  {
    id: "M-001",
    client: "A",
    at: "2026-05-14T10:00:00+08:00",
    kind: "zoom",
    where: "Zoom · portfolio review",
    minutes: 42,
    consent: "granted",
    points: [
      { id: "G-001", at: "2026-05-14T10:09:00+08:00", kind: "goal", text: "Wants the medical rider trimmed at renewal, not mid-term — dislikes paying twice for the same cover." },
      { id: "G-002", at: "2026-05-14T10:23:00+08:00", kind: "personal", text: "Daughter starts at Monash Malaysia in 2028. Fees are already provisioned; she does not want them touched." },
      { id: "G-003", at: "2026-05-14T10:38:00+08:00", kind: "fact", text: "Employer group cover went up to RM8k outpatient in April. She checked the booklet herself." },
    ],
  },
  {
    id: "M-002",
    client: "C",
    at: "2026-06-02T14:00:00+08:00",
    kind: "in-person",
    where: "Her office, Mid Valley",
    minutes: 55,
    consent: "granted",
    points: [
      { id: "G-010", at: "2026-06-02T14:11:00+08:00", kind: "personal", text: "Turned the Singapore role down. Not the money — she did not want the travel." },
      { id: "G-011", at: "2026-06-02T14:26:00+08:00", kind: "concern", text: "Brother lost money on a Johor property in 2019. She will not touch anything with a lock-in longer than five years." },
      { id: "G-012", at: "2026-06-02T14:41:00+08:00", kind: "goal", text: "Condo deposit is still the plan, but she has quietly moved the target from 2029 to mid-2028." },
      { id: "G-013", at: "2026-06-02T14:52:00+08:00", kind: "personal", text: "Prefers being asked direct questions. Says she agrees with things to end conversations she finds tiring." },
    ],
  },
  {
    id: "M-003",
    client: "D",
    at: "2026-05-05T11:00:00+08:00",
    kind: "in-person",
    where: "His office, Bangsar",
    minutes: 38,
    // He said no. The meeting still happened and still counts; there are simply
    // no notes, and the product must not pretend otherwise.
    consent: "declined",
    points: [],
  },
  {
    id: "M-004",
    client: "B",
    at: "2026-04-28T11:15:00+08:00",
    kind: "phone",
    where: "Phone · keyman review",
    minutes: 22,
    // Nobody asked. A gap in process, not a decision he made.
    consent: "not-asked",
    points: [],
  },
];
