/**
 * Telegram, behind the Source interface.
 *
 * Everything Telegram-specific stops here. Nothing downstream — not the ingest
 * mutations, not the Hermes pass, not the dashboard — knows this file exists.
 * That boundary is what made a mid-project platform switch cost a directory
 * instead of a rewrite, and it is worth keeping airtight.
 *
 * The session is a StringSession cached on disk. It is a full account
 * credential: anyone holding .tg/session.txt is signed in as the advisor.
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import type { NewMessageEvent } from "telegram/events/index.js";
import type { Api } from "telegram";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { DAY, type BridgeChat, type BridgeMessage, type Source } from "../types.ts";

const SESSION_FILE = ".tg/session.txt";

/**
 * Telegram's own service account. It behaves like a chatty DM — login codes,
 * announcements — and would otherwise look like a well-established client.
 */
const TELEGRAM_SERVICE_ID = "777000";

/** Ceiling per history call so one busy chat can't stall the whole backfill. */
const MAX_HISTORY = 5_000;

export class TelegramSource implements Source {
  readonly platform = "telegram" as const;

  #client: TelegramClient | undefined;

  constructor(
    private readonly apiId: number,
    private readonly apiHash: string,
  ) {}

  #need(): TelegramClient {
    if (!this.#client) throw new Error("TelegramSource.connect() has not been called");
    return this.#client;
  }

  async connect(): Promise<void> {
    const cached = existsSync(SESSION_FILE) ? readFileSync(SESSION_FILE, "utf8").trim() : "";
    if (cached === "") {
      throw new Error(
        "No cached Telegram session. Run `bun run tg:spike` once to log in — it needs a terminal for the phone code.",
      );
    }

    const session = new StringSession(cached);
    const client = new TelegramClient(session, this.apiId, this.apiHash, {
      connectionRetries: 3,
      // Telegram rate-limits reads rather than banning them, and GramJS sleeps
      // through a FLOOD_WAIT below this threshold instead of throwing. Backing
      // off is the whole discipline here — retrying into the wall is what cost
      // the WhatsApp account.
      floodSleepThreshold: 120,
    });

    await client.connect();
    if (!(await client.isUserAuthorized())) {
      throw new Error("Cached Telegram session is no longer authorised. Re-run `bun run tg:spike` to log in again.");
    }

    // The session string rotates as auth keys are refreshed; persisting it
    // after connect keeps the next start from falling back to a login prompt.
    mkdirSync(".tg", { recursive: true });
    writeFileSync(SESSION_FILE, session.save(), "utf8");

    this.#client = client;
  }

  async listChats(limit: number): Promise<BridgeChat[]> {
    const client = this.#need();
    const dialogs = await client.getDialogs({ limit });
    const now = Date.now();
    const out: BridgeChat[] = [];

    for (const d of dialogs) {
      const ent = d.entity as
        | { bot?: boolean; username?: string; phone?: string; id?: { toString(): string } }
        | undefined;

      // One request, no walking: reverse+limit:1 is the oldest message
      // Telegram still holds. Walking backwards and stopping at a window edge
      // cannot tell "chat is young" apart from "iterator gave up early".
      const first = (await client.getMessages(d.entity, { limit: 1, reverse: true }))[0];
      const spanDays = first ? Math.floor((now - first.date * 1000) / DAY) : 0;

      out.push({
        sourceId: String(d.id ?? ent?.id?.toString() ?? ""),
        name: d.title ?? "(untitled)",
        handle: ent?.username ? `@${ent.username}` : (ent?.phone ?? ""),
        isGroup: d.isGroup === true || d.isChannel === true,
        isBot: ent?.bot === true || ent?.id?.toString() === TELEGRAM_SERVICE_ID,
        lastTs: (d.message?.date ?? 0) * 1000,
        msgCount: 0,
        spanDays,
      });
    }

    return out;
  }

  async history(chatId: string, sinceTs: number): Promise<BridgeMessage[]> {
    const client = this.#need();
    const out: BridgeMessage[] = [];

    // iterMessages walks newest-first, so we collect until we cross the floor
    // and reverse at the end. Telegram serves history from its own storage,
    // so unlike WhatsApp this floor is a real request, not a hope.
    for await (const m of client.iterMessages(chatId, { limit: MAX_HISTORY, waitTime: 1 })) {
      const ts = m.date * 1000;
      if (ts < sinceTs) break;
      const message = toBridgeMessage(m);
      if (message) out.push(message);
    }

    return out.reverse();
  }

  onMessage(cb: (chatId: string, message: BridgeMessage) => void): void {
    const client = this.#need();
    client.addEventHandler((event: NewMessageEvent) => {
      const m = event.message;
      const message = toBridgeMessage(m);
      if (!message) return;
      const chatId = m.chatId?.toString();
      if (chatId) cb(chatId, message);
    }, new NewMessage({}));
  }

  async close(): Promise<void> {
    if (this.#client) {
      await this.#client.disconnect();
      this.#client = undefined;
    }
  }
}

/**
 * Text-only, and never a placeholder.
 *
 * Stickers, calls, media without a caption and service messages are dropped
 * rather than represented as "[image]". The verbatim gate matches quotes
 * against message text, so a synthetic string would be a quote surface no
 * human ever wrote — and a model that finds one will eventually quote it.
 */
function toBridgeMessage(m: Api.Message): BridgeMessage | null {
  const text = typeof m.message === "string" ? m.message.trim() : "";
  if (text === "") return null;
  return {
    sourceId: String(m.id),
    from: m.out === true ? "advisor" : "client",
    ts: m.date * 1000,
    text,
  };
}
