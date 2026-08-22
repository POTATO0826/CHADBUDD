"use node";

/**
 * Email out of the dashboard, so replying never means leaving it.
 *
 * A Node action because nodemailer needs sockets and Node built-ins the
 * default Convex runtime does not have — the same reason the agent pass runs
 * under "use node".
 *
 * ── Gmail app password, not OAuth ────────────────────────────────────
 * The advisor's own Gmail sends the mail, authenticated by an app password in
 * the deployment environment (GMAIL_USER / GMAIL_APP_PASSWORD). An app
 * password is the honest trade here: two minutes of setup against a full
 * OAuth flow, revocable in one click from the Google account page, and it
 * never touches the repo or the browser. The failure mode is also honest —
 * no password set, no send, a plain error saying which variable is missing.
 *
 * ── what this deliberately does not do ───────────────────────────────
 * No auto-send. Every call here is a person pressing a button on a message
 * they read — email skips the outbox only because there is no bridge process
 * to relay through, not because it skips the human. And nothing is written
 * to the messages table: an email is not part of the citation record, because
 * externalIds are minted for messages the verbatim gate can quote, and mixing
 * channels would let an email "cite" a Telegram id.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import nodemailer from "nodemailer";

export const send = action({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, { to, subject, text, fileId, fileName }): Promise<{ sent: boolean; id: string }> => {
    const user = process.env["GMAIL_USER"] ?? "";
    const pass = process.env["GMAIL_APP_PASSWORD"] ?? "";
    if (user === "" || pass === "") {
      throw new Error(
        "Email is not connected: set GMAIL_USER and GMAIL_APP_PASSWORD on the deployment " +
          "(Google account → Security → 2-Step Verification → App passwords).",
      );
    }
    if (text.trim() === "" && fileId === undefined) throw new Error("Refusing to send an empty email.");

    let attachments: Array<{ filename: string; content: Buffer }> = [];
    if (fileId !== undefined) {
      const blob = await ctx.storage.get(fileId);
      if (!blob) throw new Error("The attached file is gone from storage.");
      attachments = [{ filename: fileName ?? "attachment", content: Buffer.from(await blob.arrayBuffer()) }];
    }

    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });

    const info = await transport.sendMail({
      from: user,
      to,
      subject,
      text,
    });

    return { sent: true, id: info.messageId };
  },
});
