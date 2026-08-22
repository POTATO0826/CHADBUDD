"use node";

/**
 * Ears for voice notes.
 *
 * The bridge downloads a Telegram voice note and hands the audio here; this
 * transcribes it with the same key the agent already uses, drops the
 * transcript into the thread as the client's own words — which it is — and,
 * for anything long enough to need one, adds a one-paragraph advisor-only
 * digest. The transcript then rides every existing rail: the schedule
 * reader ("Thursday 4pm works" said aloud books the same tentative slot it
 * would typed), the notes pass, the citations.
 *
 * What this deliberately does NOT do: listen to calls. Telegram calls are
 * end-to-end encrypted peer-to-peer audio; no bridge can hear them, and a
 * feature that pretended to would be inventing a conversation. Calls get an
 * honest metadata line in the thread from convex/calls.ts instead.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

const BASE_URL = (process.env["AGENT_BASE_URL"] ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const API_KEY = process.env["AGENT_API_KEY"] ?? process.env["OPENAI_API_KEY"] ?? "";
/** whisper-1 is the compatibility default; gpt-4o-transcribe works where offered. */
const VOICE_MODEL = process.env["VOICE_MODEL"] ?? "whisper-1";
const MODEL = process.env["AGENT_MODEL"] ?? "gpt-5.5";

/** A digest is only worth its bubble when the note itself is a read. */
const DIGEST_MIN_SECONDS = 45;
const DIGEST_MIN_CHARS = 420;

async function summarise(transcript: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "Summarise this client voice note for their financial advisor in ONE short paragraph, at most 70 words. State only what the client said — requests, agreements, dates, concerns. No advice, no figures that are not in the transcript, no greeting.",
          },
          { role: "user", content: transcript },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    return text === "" ? null : text;
  } catch {
    return null; // the transcript stands on its own; the digest is a bonus
  }
}

export const ingest = action({
  args: {
    chatSourceId: v.string(),
    sourceId: v.string(),
    ts: v.number(),
    durationSec: v.number(),
    mime: v.string(),
    bytes: v.bytes(),
  },
  handler: async (ctx, a): Promise<{ ok: boolean; note: string }> => {
    if (API_KEY === "") return { ok: false, note: "agent off — no OPENAI_API_KEY" };

    const client = await ctx.runQuery(internal.ingest.clientForSource, {
      sourceId: a.chatSourceId,
    });
    if (!client) return { ok: false, note: "no client tracks this chat" };

    const form = new FormData();
    form.append("file", new Blob([a.bytes], { type: a.mime }), "voice.ogg");
    form.append("model", VOICE_MODEL);
    const res = await fetch(`${BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`transcription ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const transcript = ((await res.json()) as { text?: string }).text?.trim() ?? "";
    if (transcript === "") return { ok: false, note: "empty transcript" };

    const r = await ctx.runMutation(internal.ingest.ingestVoice, {
      clientId: client.clientId,
      sourceId: `voice:${a.sourceId}`,
      ts: a.ts,
      text: transcript,
    });

    if (
      r.inserted === 1 &&
      (a.durationSec >= DIGEST_MIN_SECONDS || transcript.length > DIGEST_MIN_CHARS)
    ) {
      const digest = await summarise(transcript);
      if (digest) {
        await ctx.runMutation(internal.ingest.noteInThread, {
          clientId: client.clientId,
          sourceId: `voicesum:${a.sourceId}`,
          ts: a.ts + 1,
          text: `Voice note, ${Math.round(a.durationSec)}s — ${digest}`,
        });
      }
    }
    return { ok: true, note: `transcribed ${transcript.length} chars` };
  },
});
