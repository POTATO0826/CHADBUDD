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

import { DAY, WANTED_DAYS, type BridgeCall, type BridgeChat, type BridgeMessage, type BridgeVoice, type Source } from "../types.ts";

const SESSION_FILE = ".tg/session.txt";

/**
 * Telegram's own service account. It behaves like a chatty DM — login codes,
 * announcements — and would otherwise look like a well-established client.
 */
const TELEGRAM_SERVICE_ID = "777000";

/** Ceiling per history call so one busy chat can't stall the whole backfill. */
const MAX_HISTORY = 5_000;

/**
 * Ceiling when counting a chat's density for the picker. Lower than
 * MAX_HISTORY on purpose: the picker only needs to know whether a chat is
 * alive, and "at least 400 messages" answers that as well as an exact count.
 */
const COUNT_SCAN = 400;

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

  /**
   * `windowDays` is not decoration — see the msgCount comment below.
   */
  async listChats(limit: number, windowDays = WANTED_DAYS): Promise<BridgeChat[]> {
    const client = this.#need();
    const dialogs = await client.getDialogs({ limit });
    const now = Date.now();
    const cutoff = now - windowDays * DAY;
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

      /**
       * Text messages inside the scoring window — and the reason this method
       * is slower than a dialog list has any right to be.
       *
       * `spanDays` says when a chat *started*, not whether it is *alive*. A
       * conversation that opened two years ago and went quiet has a superb
       * span and nothing to measure: picking two such chats produced 1 message
       * and 0 messages respectively, both reported as scorable beforehand.
       *
       * Density and span are independent, and a picker that reports one while
       * implying the other is worse than a picker that reports neither.
       */
      let msgCount = 0;
      let scanned = 0;
      for await (const m of client.iterMessages(d.entity, { limit: COUNT_SCAN, waitTime: 1 })) {
        if (++scanned > COUNT_SCAN) break;
        if (m.date * 1000 < cutoff) break;
        if (typeof m.message === "string" && m.message.trim() !== "") msgCount++;
      }

      out.push({
        sourceId: String(d.id ?? ent?.id?.toString() ?? ""),
        name: d.title ?? "(untitled)",
        handle: ent?.username ? `@${ent.username}` : (ent?.phone ?? ""),
        isGroup: d.isGroup === true || d.isChannel === true,
        isBot: ent?.bot === true || ent?.id?.toString() === TELEGRAM_SERVICE_ID,
        lastTs: (d.message?.date ?? 0) * 1000,
        msgCount,
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

  /**
   * The ring, as it happens. UpdatePhoneCall carries PhoneCallRequested
   * while the phone is ringing (adminId is the caller) and PhoneCallDiscarded
   * or an accepted state when it stops — the end variants do not name a
   * peer, so the end event simply says "stopped".
   */
  onRinging(cb: (evt: { sourceId: string; ringing: boolean }) => void): void {
    const client = this.#need();
    client.addEventHandler((update: {
      className?: string;
      phoneCall?: { className?: string; adminId?: { toString(): string } };
    }) => {
      if (update.className !== "UpdatePhoneCall") return;
      const call = update.phoneCall;
      if (!call) return;
      if (call.className === "PhoneCallRequested") {
        const who = call.adminId?.toString();
        if (who) cb({ sourceId: who, ringing: true });
      } else if (
        call.className === "PhoneCallDiscarded" ||
        call.className === "PhoneCall" ||
        call.className === "PhoneCallAccepted"
      ) {
        cb({ sourceId: "", ringing: false });
      }
    });
  }

  /**
   * Voice notes: a document whose audio attribute says voice. Downloaded
   * here — the backend cannot reach Telegram — and capped, because a
   * fifteen-minute ramble is an upload nobody asked for.
   */
  onVoice(cb: (chatId: string, voice: BridgeVoice) => void): void {
    const client = this.#need();
    client.addEventHandler((event: NewMessageEvent) => {
      const msg = event.message;
      if (msg.out === true) return; // the advisor's own notes are not client input
      const media = msg.media as
        | {
            document?: {
              mimeType?: string;
              attributes?: Array<{ className?: string; voice?: boolean; duration?: number }>;
            };
          }
        | undefined;
      const doc = media?.document;
      const audio = doc?.attributes?.find((x) => x.className === "DocumentAttributeAudio");
      if (!audio || audio.voice !== true) return;
      const chatId = msg.chatId?.toString();
      if (!chatId) return;
      void (async () => {
        try {
          const buf = (await this.#need().downloadMedia(msg)) as Buffer | undefined;
          if (!buf || buf.length === 0 || buf.length > 15_000_000) return;
          cb(chatId, {
            sourceId: String(msg.id),
            ts: msg.date * 1000,
            durationSec: audio.duration ?? 0,
            mime: doc?.mimeType ?? "audio/ogg",
            bytes: new Uint8Array(buf),
          });
        } catch (err) {
          console.error("[voice] download failed:", err instanceof Error ? err.message : String(err));
        }
      })();
    }, new NewMessage({}));
  }

  /**
   * Calls surface as service messages carrying MessageActionPhoneCall.
   *
   * A raw handler rather than NewMessage, because event builders filter for
   * content messages and a service message is exactly not one. The reason
   * field is how Telegram says what happened: Missed and Busy are a call
   * that never connected; anything else ended after connecting and carries
   * a duration.
   */
  onCall(cb: (chatId: string, call: BridgeCall) => void): void {
    const client = this.#need();
    client.addEventHandler((update: {
      className?: string;
      message?: {
        action?: { className?: string; duration?: number; reason?: { className?: string } };
        out?: boolean;
        date?: number;
        peerId?: { userId?: { toString(): string } };
      };
    }) => {
      if (update.className !== "UpdateNewMessage") return;
      const msg = update.message;
      const action = msg?.action;
      if (action?.className !== "MessageActionPhoneCall") return;

      const chatId = msg?.peerId?.userId?.toString();
      if (!chatId) return;

      const reason = action.reason?.className ?? "";
      cb(chatId, {
        outgoing: msg?.out === true,
        missed: reason.includes("Missed") || reason.includes("Busy"),
        durationSec: action.duration ?? 0,
        ts: (msg?.date ?? Math.floor(Date.now() / 1000)) * 1000,
      });
    });
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === "") throw new Error("Refusing to send an empty message.");
    await this.#need().sendMessage(chatId, { message: trimmed });
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
