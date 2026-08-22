/**
 * An email address, spoken in chat, becomes the email on file — carefully.
 *
 * The bar to clear: the client stating THEIR OWN address, judged twice — a
 * name-similarity heuristic (does the local part resemble their name?) and
 * the model reading the sentence (is this "email me at…" or "my wife's
 * email is…"?), the model's claim verbatim-gated against the real message.
 * Anything short of both writes nothing; either way the advisor gets an
 * advisor-only receipt in the thread saying exactly what happened and why.
 *
 * A missed capture costs a manual paste. A wrong email misdirects a
 * client's finances. The asymmetry decides every tie.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { callModel } from "./agent";
import { gate } from "./verbatim";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** One-shot validator: /g regexes are stateful under .test(). */
const EMAIL_ONE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export const clientBrief = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const c = await ctx.db.get(clientId);
    return c ? { key: c.key, name: c.name, email: c.email ?? null } : null;
  },
});

/**
 * Lowercased on write: the IMAP matcher lowercases both sides when pairing
 * inbound mail to clients, so a mixed-case store is a latent mismatch.
 */
export const setEmailById = internalMutation({
  args: { clientId: v.id("clients"), email: v.string() },
  handler: async (ctx, { clientId, email }) => {
    await ctx.db.patch(clientId, { email: email.toLowerCase().trim() });
  },
});

/** Does the address's local part resemble the client's name at all? */
function nameSimilar(email: string, name: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase().replace(/[0-9._+-]+/g, "");
  const tokens = name.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  return tokens.some(
    (t) => local.includes(t) || t.includes(local) || (local.length >= 3 && t.startsWith(local.slice(0, 3))),
  );
}

const OWN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ownEmail", "email", "confident", "sourceId", "quote"],
  properties: {
    /** True only if the client is stating an address as their own. */
    ownEmail: { type: "boolean" },
    /** The address in question, exactly as written in the message. */
    email: { type: "string" },
    /** True only if a reasonable person would read it the same way. */
    confident: { type: "boolean" },
    sourceId: { type: "string" },
    quote: { type: "string" },
  },
} as const;

const SYSTEM_OWN = `A client's chat message contains an email address. Decide whether the
client is stating it as THEIR OWN address (for reaching them), or someone
else's (a spouse, a colleague, a company, a forward).

- ownEmail: true only when the client is giving their own address.
- email: the address, exactly as it appears in the message.
- quote: the decisive sentence, QUOTED VERBATIM, character for character.
- confident: true only if a reasonable person would read it the same way.

A missed capture costs a manual paste; a wrong email misdirects a client's
finances. When in doubt: not confident.`;

interface OwnRead {
  ownEmail: boolean;
  email: string;
  confident: boolean;
  sourceId: string;
  quote: string;
}

export const inspect = internalAction({
  args: { clientId: v.id("clients"), cite: v.string(), text: v.string(), ts: v.number() },
  handler: async (ctx, a): Promise<void> => {
    const found = a.text.match(EMAIL_RE);
    if (!found || found.length === 0) return;
    const candidate = found[0]!;

    const client = await ctx.runQuery(internal.emailCapture.clientBrief, { clientId: a.clientId });
    if (!client) return;
    if (client.email !== null && client.email.toLowerCase() === candidate.toLowerCase()) return;

    const similar = nameSimilar(candidate, client.name);

    let read: OwnRead;
    try {
      read = await callModel<OwnRead>(
        SYSTEM_OWN,
        `Client name: ${client.name}\n` +
          `Name-similarity heuristic on "${candidate}": ${similar ? "resembles their name" : "does NOT resemble their name"}\n\n` +
          `[${a.cite}] client: ${a.text}`,
        "ownEmail",
        OWN_SCHEMA,
      );
    } catch (err) {
      console.warn(`[email] read failed for ${client.key}: ${String(err)}`);
      return;
    }

    // The model's claim must survive the same gate as every other claim.
    const byId = new Map([[a.cite, a.text]]);
    const { kept } = gate([{ statement: "email statement", sourceId: read.sourceId, quote: read.quote }], byId);
    const proven = kept.length > 0 && read.confident;

    if (proven && read.ownEmail && EMAIL_ONE.test(read.email.trim())) {
      await ctx.runMutation(internal.emailCapture.setEmailById, {
        clientId: a.clientId,
        email: read.email,
      });
      await ctx.runMutation(internal.ingest.noteInThread, {
        clientId: a.clientId,
        sourceId: `emailset:${a.cite}`,
        ts: a.ts + 1,
        text: `Email on file updated to ${read.email.toLowerCase().trim()} — they stated it themselves${similar ? "" : " (name does not match the address — the sentence was decisive)"}.`,
      });
      console.log(`[email] ${client.key} → ${read.email.toLowerCase().trim()}`);
    } else {
      await ctx.runMutation(internal.ingest.noteInThread, {
        clientId: a.clientId,
        sourceId: `emailskip:${a.cite}`,
        ts: a.ts + 1,
        text: `Email mentioned (${candidate}) — ${
          proven && !read.ownEmail ? "reads as someone else's" : "could not be verified as theirs"
        }, not saved. Set it in Basic information if it should be.`,
      });
    }
  },
});
