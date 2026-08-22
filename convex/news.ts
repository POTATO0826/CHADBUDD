/**
 * The market watch, actually live.
 *
 * The seeded events in data/market.ts were curated from real news by hand —
 * honest, but a snapshot. This is the feed: Google News RSS pulled hourly,
 * the model deciding which headlines matter to an investment advisor's book
 * and tagging them by asset class, results mirrored to `marketEvents`. The
 * desk prefers live rows and falls back to the seed when the table is empty
 * or the feed breaks — the demo can never be taken down by an RSS outage.
 *
 * ── what the model is trusted with here, and what it is not ──────────
 * Relevance, classification, and a one-line impact note — judgement calls a
 * filter is for. It is NOT trusted to write the headline (the outlet's own
 * headline is stored verbatim) or the link (Google's redirect URL is kept as
 * given), so every card in the UI still ends at a real article a judge can
 * open. A feed where the model paraphrases headlines is a feed that slowly
 * stops being checkable.
 */

import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

const MODEL = process.env["AGENT_MODEL"] ?? "gpt-5.5";
const BASE_URL = (process.env["AGENT_BASE_URL"] ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const API_KEY = process.env["AGENT_API_KEY"] ?? process.env["OPENAI_API_KEY"] ?? "";

/** The queries that cover this advisor's book. Coarse on purpose. */
const FEEDS = [
  "US treasury yields federal reserve",
  "bank of japan yen policy",
  "malaysia bursa KLCI ringgit",
  "global equity markets selloff rally",
];

const CLASSES = [
  "us-bonds",
  "global-bonds",
  "asia-equity",
  "malaysia-equity",
  "global-equity",
  "tech-equity",
  "money-market",
] as const;

interface Item {
  title: string;
  link: string;
  source: string;
  ts: number;
}

/** Minimal RSS item parse. Google News is regular enough for this. */
function parseRss(xml: string): Item[] {
  const out: Item[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1]!;
    const pick = (tag: string): string => {
      const hit = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(block);
      return (hit?.[1] ?? "")
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
    };
    const title = pick("title");
    const link = pick("link");
    const ts = Date.parse(pick("pubDate"));
    const source = pick("source") || "Google News";
    if (title && link && Number.isFinite(ts)) out.push({ title, link, source, ts });
  }
  return out;
}

const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["events"],
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["i", "relevant", "lean", "classes", "summary", "impactNote"],
        properties: {
          i: { type: "number" },
          relevant: { type: "boolean", description: "Would an investment advisor act on or mention this?" },
          lean: { type: "string", enum: ["pressure", "relief", "watch"] },
          classes: { type: "array", items: { type: "string", enum: [...CLASSES] } },
          summary: { type: "string", description: "Two factual sentences, no advice." },
          impactNote: {
            type: "string",
            description: "One line, phrased for a client message, about what this means for holders. No figures.",
          },
        },
      },
    },
  },
} as const;

const SYSTEM_CLASSIFY = `You filter market headlines for a Malaysian investment advisor whose
clients hold bond funds, Malaysian and global equity funds, and money market
funds. Mark relevant=true only for stories that plausibly move those
holdings or that a client would ask about. Duplicate stories: keep the one
from the bigger outlet, mark the rest irrelevant. Never invent figures — if
the headline has none, the summary has none.`;

export const refresh = action({
  args: {},
  handler: async (ctx): Promise<{ fetched: number; kept: number }> => {
    if (API_KEY === "") throw new Error("No AGENT_API_KEY or OPENAI_API_KEY set.");

    const items: Item[] = [];
    for (const q of FEEDS) {
      try {
        const res = await fetch(
          `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`,
          { headers: { "user-agent": "Mozilla/5.0" } },
        );
        if (res.ok) items.push(...parseRss(await res.text()));
      } catch {
        /* one dead feed must not kill the sweep */
      }
    }

    // Fresh, deduped by title, newest first, capped before the model sees it.
    const cutoff = Date.now() - 48 * 3_600_000;
    const seen = new Set<string>();
    const fresh = items
      .filter((x) => x.ts > cutoff)
      .filter((x) => (seen.has(x.title) ? false : (seen.add(x.title), true)))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 24);

    if (fresh.length === 0) return { fetched: 0, kept: 0 };

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_CLASSIFY },
          { role: "user", content: fresh.map((x, i) => `[${i}] ${x.title} (${x.source})`).join("\n") },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "classify", strict: true, schema: CLASSIFY_SCHEMA },
        },
      }),
    });
    if (!res.ok) throw new Error(`${MODEL} returned ${res.status}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as {
      events?: Array<{ i: number; relevant: boolean; lean: string; classes: string[]; summary: string; impactNote: string }>;
    };

    const kept = (parsed.events ?? [])
      .filter((e) => e.relevant && e.classes.length > 0)
      .map((e) => ({ e, item: fresh[e.i] }))
      .filter((x): x is { e: (typeof parsed.events extends Array<infer T> | undefined ? T : never); item: Item } => x.item !== undefined)
      .slice(0, 6)
      .map(({ e, item }) => ({
        ts: item.ts,
        // The outlet's headline, verbatim — the model never rewrites it.
        headline: item.title,
        summary: e.summary,
        lean: e.lean,
        classes: e.classes,
        sourceName: item.source,
        sourceUrl: item.link,
        impactNote: e.impactNote,
      }));

    await ctx.runMutation(internal.news.replace, { events: kept });
    return { fetched: fresh.length, kept: kept.length };
  },
});

export const replace = internalMutation({
  args: {
    events: v.array(
      v.object({
        ts: v.number(),
        headline: v.string(),
        summary: v.string(),
        lean: v.string(),
        classes: v.array(v.string()),
        sourceName: v.string(),
        sourceUrl: v.string(),
        impactNote: v.string(),
      }),
    ),
  },
  handler: async (ctx, { events }) => {
    // A sweep that found nothing keeps the previous crop rather than blanking
    // the desk — stale news beats an empty section that reads as broken.
    if (events.length === 0) return;
    for (const old of await ctx.db.query("marketEvents").collect()) await ctx.db.delete(old._id);
    const now = Date.now();
    for (const e of events) await ctx.db.insert("marketEvents", { ...e, fetchedAt: now });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("marketEvents").collect(),
});
