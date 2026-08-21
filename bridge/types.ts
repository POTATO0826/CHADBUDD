/**
 * The seam between "where messages come from" and "what ChadBuddy stores".
 *
 * The app measures relationships, not protocols. Nothing downstream of this
 * file — not the Convex schema, not the Hermes pass, not the dashboard — has
 * any business knowing whether a message arrived over WhatsApp or Telegram.
 * So each platform gets an adapter, and every adapter produces exactly these
 * shapes. Adding a third source should mean writing one file, not editing ten.
 *
 * This boundary is the reason a mid-project platform switch cost a directory
 * rather than a rewrite.
 *
 * Deliberately NOT here:
 *   · externalId — the "A-042" citation key. Minted by Convex inside the
 *     ingest transaction, because it has to be unique and monotonic per
 *     client, and an adapter has no way to guarantee either.
 *   · Any notion of who is a "client". Adapters report chats; the advisor
 *     decides which of them matter.
 */

export type Platform = "whatsapp" | "telegram";

/** Matches SeedMessage.from in data/types.ts — the dashboard's only distinction. */
export type Sender = "advisor" | "client";

export interface BridgeMessage {
  /**
   * The source platform's own id, stable across restarts and re-syncs.
   * Convex dedupes on (chat, sourceId), so re-reading history is idempotent
   * rather than duplicating a thread.
   */
  sourceId: string;
  from: Sender;
  /** Epoch ms. Every platform reports something else; adapters normalise here. */
  ts: number;
  /**
   * Plain text only, and never a placeholder.
   *
   * Stickers, calls, deleted messages and media without a caption are dropped
   * by the adapter rather than represented as "[image]". The ledger's verbatim
   * gate matches quotes against message text, and a synthetic string is a
   * quote surface that no human ever wrote.
   */
  text: string;
}

export interface BridgeChat {
  /** Platform-native chat id: a WhatsApp jid, a Telegram peer id. */
  sourceId: string;
  /** Display name, as the advisor's own phone would show it. */
  name: string;
  /** Handle shown in the UI — masked number, @username, whatever the platform gives. */
  handle: string;
  /** Group chats are offered but not tracked by default: a group is not a client. */
  isGroup: boolean;
  /**
   * Bots and platform service accounts.
   *
   * Not cosmetic. Profiling a real account, three of five DMs were bots —
   * BotFather, a service notifier, and Telegram itself — and the busiest of
   * them looked like an excellent client by message count alone. A bot is not
   * a relationship, and anything that scores relationships has to know that.
   * Surfaced rather than hidden, so the advisor can see what was excluded.
   */
  isBot: boolean;
  lastTs: number;
  msgCount: number;
  /**
   * Age in days of the chat's oldest message.
   *
   * The dashboard scores *change* — a 30-day recent window against a 90-day
   * baseline — so a chat that started three weeks ago cannot be scored, however
   * busy it is. Span is a first-class property of a chat for that reason.
   */
  spanDays: number;
}

/**
 * What every platform adapter implements.
 *
 * `history` is the one place the platforms genuinely differ in capability, and
 * the signature admits it: it takes a floor, not a promise. Telegram stores
 * history server-side and can page back arbitrarily far, so it returns
 * everything after `sinceTs`. WhatsApp returns whatever the initial sync
 * happened to deliver, which is not guaranteed to reach that floor. Callers
 * must treat the result as best-effort and check the span they actually got.
 */
export interface Source {
  readonly platform: Platform;

  /** Resolve credentials and open the connection. Throws if auth is needed. */
  connect(): Promise<void>;

  /** Recent conversations, newest first, for the advisor's chat picker. */
  listChats(limit: number): Promise<BridgeChat[]>;

  /** Best-effort history for one chat, oldest first, at or after `sinceTs`. */
  history(chatId: string, sinceTs: number): Promise<BridgeMessage[]>;

  /** Live arrivals. Called once; the adapter owns the subscription. */
  onMessage(cb: (chatId: string, message: BridgeMessage) => void): void;

  /**
   * Send a message as the account holder.
   *
   * The only write in this interface, and the only thing here with
   * consequences outside the machine. Everything else can be re-run; this
   * cannot be un-sent. The bridge is the sole holder of the socket, so this is
   * the one path from an approved draft to a real conversation.
   */
  sendMessage(chatId: string, text: string): Promise<void>;

  close(): Promise<void>;
}

/** ChadBuddy compares a 30-day recent window against a 90-day baseline. */
export const WANTED_DAYS = 120;
export const DAY = 86_400_000;
