/**
 * The two things Google needs to reach.
 *
 * ── /google/callback ─────────────────────────────────────────────────
 * Where the consent screen sends the user back. It lands here rather than in
 * the app on purpose: the authorization code is exchanged for tokens on the
 * server, so the refresh token — which is a permanent key to the advisor's
 * calendar — is written to the database without ever existing in a page
 * anybody can open devtools on.
 *
 * ── /google/push ─────────────────────────────────────────────────────
 * Google's change notification. It carries no event data at all, only "the
 * calendar you are watching changed" — which is exactly enough, because the
 * response is to run the incremental sync that would have run anyway. The
 * webhook is a latency improvement over the cron, not a separate path, and
 * that is what makes a missed push survivable.
 *
 * ── why the token check is not optional ──────────────────────────────
 * The push URL is public and unauthenticated by construction; Google will not
 * send credentials. The channel token is the only thing distinguishing a real
 * notification from anyone who guesses the URL, and without it a stranger can
 * make this deployment call Google in a loop.
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

const http = httpRouter();

const page = (title: string, body: string, ok: boolean) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#232136;
       color:#e0def4;font:15px/1.6 ui-sans-serif,system-ui,sans-serif}
  div{text-align:center;max-width:34ch}
  h1{margin:0 0 .4em;font-size:17px;font-weight:600;color:${ok ? "#9ccfd8" : "#eb6f92"}}
  p{margin:0;color:#908caa}
</style>
<div><h1>${title}</h1><p>${body}</p></div>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );

http.route({
  path: "/google/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const state = url.searchParams.get("state");

    // The user pressed Cancel, or Google refused. Not an error worth a stack
    // trace — say so plainly and let them close the tab.
    if (error) return page("Not connected", `Google returned: ${error}`, false);
    if (!code) return page("Not connected", "Google sent no authorization code.", false);

    // Anyone can hit this URL with a code of their own. The state value is what
    // ties this callback to a consent flow this deployment actually started.
    const expected = process.env["CALENDAR_STATE_SECRET"] ?? "";
    if (expected && state !== expected) {
      return page("Not connected", "That sign-in did not start here.", false);
    }

    try {
      await ctx.runAction(internal.calendar.exchange, { code });
      // First sync immediately, so the dashboard has a day before the advisor
      // has finished switching windows back to it.
      await ctx.runAction(api.calendar.pull, {});
      await ctx.runAction(api.calendar.watch, {});
    } catch (e) {
      return page("Not connected", String(e instanceof Error ? e.message : e), false);
    }

    return page("Calendar connected", "You can close this tab and go back to ChadBuddy.", true);
  }),
});

http.route({
  path: "/google/push",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = request.headers.get("x-goog-channel-token");
    const expected = process.env["GOOGLE_PUSH_TOKEN"] ?? "";
    // 200 rather than 401 on a bad token: a non-2xx teaches Google to retry,
    // and retrying a request that will never be accepted is noise on both ends.
    if (expected && token !== expected) return new Response(null, { status: 200 });

    // The handshake Google sends when a channel opens. There is nothing to
    // sync yet, and pulling on it would waste a call on every renewal.
    if (request.headers.get("x-goog-resource-state") === "sync") {
      return new Response(null, { status: 200 });
    }

    // Failing loudly here would make Google retry with backoff, which is the
    // right behaviour: a sync that failed should be attempted again.
    await ctx.runAction(api.calendar.pull, {});
    return new Response(null, { status: 200 });
  }),
});

/**
 * The phone's call log, arriving.
 *
 * A desktop app cannot see missed calls; the phone can, and automation apps
 * (MacroDroid, Tasker) can POST on every call ended or missed. This is the
 * receiver: token-checked, matched to a client by the last eight digits —
 * enough to survive +60 vs 0 prefix differences — and stored either way.
 *
 * The token rule is the same as the Google push route: the URL is public by
 * construction, so the shared secret is the entire difference between the
 * advisor's phone and anyone who guesses the address.
 */
http.route({
  path: "/phone/call",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).searchParams.get("token") ?? request.headers.get("x-phone-token") ?? "";
    const expected = process.env["PHONE_WEBHOOK_TOKEN"] ?? "";
    if (expected === "" || token !== expected) return new Response("no", { status: 401 });

    let body: { number?: string; direction?: string; durationSec?: number; ts?: number };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return new Response("bad json", { status: 400 });
    }

    const number = String(body.number ?? "").trim();
    const direction =
      body.direction === "outgoing" ? "outgoing" : body.direction === "missed" ? "missed" : "incoming";
    if (number === "") return new Response("no number", { status: 400 });

    await ctx.runMutation(internal.calls.record, {
      number,
      direction,
      durationSec: Math.max(0, Math.round(Number(body.durationSec ?? 0))),
      ts: Number.isFinite(body.ts) ? Number(body.ts) : Date.now(),
    });

    return new Response("ok", { status: 200 });
  }),
});

export default http;
