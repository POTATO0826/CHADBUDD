"use node";

/**
 * Email, coming in.
 *
 * The other half of convex/email.ts: an IMAP poll of the advisor's Gmail
 * every ten minutes, matching senders against the email each client has on
 * file and ingesting matches into the same message table Telegram feeds — so
 * the ledger, the agent pass, and the schedule reader all see email without
 * knowing it is email.
 *
 * ── polled, not pushed ───────────────────────────────────────────────
 * IMAP IDLE needs a socket held open, which is the bridge problem all over
 * again. A ten-minute poll needs nothing running anywhere and misses at most
 * ten minutes — and unlike chat, nobody expects an email answered inside ten
 * minutes.
 *
 * ── only people already on the book ──────────────────────────────────
 * A sender with no matching client email is skipped entirely, not queued for
 * promotion. Anyone can email anyone; auto-promoting inbound email would fill
 * the book with newsletters wearing human names. The advisor puts an address
 * on a client's card; that act is the consent to read.
 *
 * Activates by itself once GMAIL_USER and GMAIL_APP_PASSWORD exist — the same
 * two values sending already needs. No credentials, no-op, no error spam.
 */

import { ImapFlow } from "imapflow";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const pull = internalAction({
  args: {},
  handler: async (ctx): Promise<{ read: number; matched: number }> => {
    const user = process.env["GMAIL_USER"] ?? "";
    const pass = process.env["GMAIL_APP_PASSWORD"] ?? "";
    if (user === "" || pass === "") return { read: 0, matched: 0 };

    const clients = (await ctx.runQuery(internal.agentData.clientEmails, {})) as Array<{
      key: string;
      email: string;
    }>;
    if (clients.length === 0) return { read: 0, matched: 0 };
    const byEmail = new Map(clients.map((c) => [c.email.toLowerCase(), c.key]));

    const imap = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user, pass },
      logger: false,
    });

    let read = 0;
    let matched = 0;

    await imap.connect();
    try {
      const lock = await imap.getMailboxLock("INBOX");
      try {
        // Two days of lookback: generous against cron gaps, cheap against
        // dedupe — the ingest path drops anything already seen by sourceId.
        const since = new Date(Date.now() - 2 * 86_400_000);
        for await (const msg of imap.fetch(
          { since },
          { uid: true, envelope: true, bodyParts: ["text"] },
        )) {
          read++;
          const from = msg.envelope?.from?.[0]?.address?.toLowerCase() ?? "";
          const key = byEmail.get(from);
          if (!key) continue;

          const subject = msg.envelope?.subject ?? "";
          const body = (msg.bodyParts?.get("text")?.toString("utf8") ?? "")
            .replace(/\r\n/g, "\n")
            // Reply quoting: everything from the first quoted line down is the
            // advisor's own words coming back, not the client speaking.
            .split(/\nOn .{10,80}wrote:\n/)[0]!
            .split(/\n>/)[0]!
            .trim()
            .slice(0, 1500);

          const text = [subject, body].filter(Boolean).join("\n").trim();
          if (text === "") continue;

          await ctx.runMutation(internal.ingest.ingestEmail, {
            key,
            sourceId: `em:${msg.uid}`,
            ts: msg.envelope?.date ? new Date(msg.envelope.date).getTime() : Date.now(),
            text,
          });
          matched++;
        }
      } finally {
        lock.release();
      }
    } finally {
      await imap.logout().catch(() => {});
    }

    return { read, matched };
  },
});
