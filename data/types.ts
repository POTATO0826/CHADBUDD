/**
 * Seed data shapes.
 *
 * These are plain TypeScript for now — no backend yet. When Convex goes in,
 * the `messages` table mirrors SeedMessage one-for-one:
 *
 *   messages: defineTable({
 *     clientId:   v.id("clients"),
 *     externalId: v.string(),                                  // "D-012"
 *     sender:     v.union(v.literal("advisor"), v.literal("client")),
 *     ts:         v.number(),                                  // epoch ms
 *     text:       v.string(),
 *   }).index("by_client_ts", ["clientId", "ts"])
 *
 * `externalId` is the citation key. Every ledger entry, evidence link and
 * scroll-to-source target in the UI refers to a message by externalId, so the
 * ids stay stable across reseeds and survive the move into Convex.
 */

export type Sender = "advisor" | "client";

/**
 * Was the union "A"|"B"|"C"|"D" while the seed was the only source of clients.
 *
 * Live clients are assigned keys in the order the advisor picks them and run
 * past D, so the union became a lie the moment real chats could be tracked.
 * The `<KEY>-<NNN>` citation format is unchanged — only the alphabet grew.
 */
export type ClientKey = string;

export interface SeedMessage {
  /** Stable citation key, e.g. "D-012". Unique across the whole seed set. */
  externalId: string;
  from: Sender;
  /** ISO 8601 with the +08:00 offset these conversations actually happened in. */
  at: string;
  text: string;
}

export interface SeedThread {
  key: ClientKey;
  clientName: string;
  /** WhatsApp handle, masked the way the advisor's phone would show it. */
  handle: string;
  messages: SeedMessage[];
}

/** Epoch ms for a seed message. */
export function tsOf(m: SeedMessage): number {
  const ms = Date.parse(m.at);
  if (Number.isNaN(ms)) throw new Error(`Unparseable timestamp on ${m.externalId}: ${m.at}`);
  return ms;
}
