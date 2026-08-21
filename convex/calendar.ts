/**
 * Google Calendar, on Convex.
 *
 * ── why this needs no bridge ─────────────────────────────────────────
 * Telegram got a separate long-running process because it holds a socket and
 * Convex actions time out at ten minutes. Calendar has no socket: it is REST for
 * reads and writes, and a webhook for change notifications. So the whole thing
 * lives here — actions call Google, an httpAction receives the callback and the
 * push, and a cron covers the case where a push is missed. One less process to
 * run, and the tokens never leave the server.
 *
 * ── the tokens never reach the client ────────────────────────────────
 * The OAuth redirect goes to a Convex HTTP endpoint rather than back into the
 * app, so the authorization code is exchanged here and the refresh token is
 * written straight to `calendarAuth`. The dashboard asks for events and has no
 * idea Google is involved — which is also what lets the seed calendar and the
 * live one answer the same query.
 *
 * ── incremental by default, full when Google says so ─────────────────
 * `syncToken` is Google's cursor. Google expires it on its own schedule and
 * answers a stale one with 410; the correct response is a full resync, not an
 * error, and `pull` treats it that way. Anything else means the mirror silently
 * stops updating.
 */

import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";

const CAL = "https://www.googleapis.com/calendar/v3";
const OAUTH = "https://oauth2.googleapis.com/token";
const CONSENT = "https://accounts.google.com/o/oauth2/v2/auth";

/** Read and write events, and nothing else. */
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

const clientId = () => process.env["GOOGLE_CLIENT_ID"] ?? "";
const clientSecret = () => process.env["GOOGLE_CLIENT_SECRET"] ?? "";

/**
 * Where Google sends the user back.
 *
 * Must match a redirect URI registered in the Google Cloud console exactly,
 * including scheme and trailing slash. On a Convex deployment this is the
 * `.convex.site` origin; self-hosted it is the HTTP actions port, which is not
 * the same port the client connects on.
 */
const redirectUri = () => `${process.env["CONVEX_SITE_URL"] ?? ""}/google/callback`;

/** The one account. Multi-account would key this differently. */
const ACCOUNT = "primary";

/**
 * How much of the calendar is mirrored.
 *
 * Asymmetric on purpose. The past is only wanted for the month the advisor is
 * standing in and the one behind it — a calendar is a record of what is coming,
 * and history lives in the ledger. Ahead is longer because a maturity date or a
 * renewal review is booked months out, and a month grid that can be stepped
 * forward has to have something to show when it is.
 */
const PAST_DAYS = 60;
const AHEAD_DAYS = 180;

/* ── auth ─────────────────────────────────────────────────────────── */

export const authUrl = action({
  args: {},
  handler: async (): Promise<string> => {
    const p = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: SCOPE,
      // Both are required to be handed a refresh token at all: without
      // `offline` Google returns only a short-lived access token, and without
      // `consent` it declines to re-issue a refresh token to an account that
      // has already granted access — so a reinstall would silently have no way
      // to refresh.
      access_type: "offline",
      prompt: "consent",
      // Echoed back to /google/callback, where it is the only evidence the
      // callback belongs to a flow this deployment started.
      state: process.env["CALENDAR_STATE_SECRET"] ?? "",
    });
    return `${CONSENT}?${p.toString()}`;
  },
});

export const saveAuth = internalMutation({
  args: {
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    scope: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("calendarAuth")
      .withIndex("by_account", (q) => q.eq("account", ACCOUNT))
      .unique();

    const row = { account: ACCOUNT, ...args, updatedAt: Date.now() };
    if (existing) {
      // A refresh response omits the refresh token; keeping the stored one is
      // the difference between staying connected and silently logging out.
      await ctx.db.patch(existing._id, {
        ...row,
        refreshToken: args.refreshToken || existing.refreshToken,
      });
      return;
    }
    await ctx.db.insert("calendarAuth", row);
  },
});

export const auth = internalQuery({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("calendarAuth")
      .withIndex("by_account", (q) => q.eq("account", ACCOUNT))
      .unique(),
});

export const setSyncToken = internalMutation({
  args: { syncToken: v.optional(v.string()) },
  handler: async (ctx, { syncToken }) => {
    const row = await ctx.db
      .query("calendarAuth")
      .withIndex("by_account", (q) => q.eq("account", ACCOUNT))
      .unique();
    if (row) await ctx.db.patch(row._id, { syncToken, updatedAt: Date.now() });
  },
});

/** Exchange a code, or refresh an expiring token. Both are the same endpoint. */
export const exchange = internalAction({
  args: { code: v.optional(v.string()) },
  handler: async (ctx, { code }): Promise<void> => {
    const stored = await ctx.runQuery(internal.calendar.auth, {});

    const body: Record<string, string> = code
      ? {
          code,
          client_id: clientId(),
          client_secret: clientSecret(),
          redirect_uri: redirectUri(),
          grant_type: "authorization_code",
        }
      : {
          refresh_token: stored?.refreshToken ?? "",
          client_id: clientId(),
          client_secret: clientSecret(),
          grant_type: "refresh_token",
        };

    const res = await fetch(OAUTH, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });

    if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);

    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    await ctx.runMutation(internal.calendar.saveAuth, {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? "",
      // A minute early. A token that expires mid-request is a request that
      // fails for no reason the user can act on.
      expiresAt: Date.now() + (json.expires_in - 60) * 1000,
      scope: json.scope,
    });
  },
});

/** A valid access token, refreshing first if it is close to expiring. */
async function token(ctx: { runQuery: any; runAction: any }): Promise<string> {
  let stored = await ctx.runQuery(internal.calendar.auth, {});
  if (!stored) throw new Error("Google Calendar is not connected");

  if (stored.expiresAt <= Date.now()) {
    await ctx.runAction(internal.calendar.exchange, {});
    stored = await ctx.runQuery(internal.calendar.auth, {});
  }
  return stored!.accessToken;
}

/* ── the mirror ───────────────────────────────────────────────────── */

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  hangoutLink?: string;
  /** Google's own classification. "focusTime" and "outOfOffice" are exact. */
  eventType?: string;
  /** "transparent" means the advisor marked it Free — not a commitment. */
  transparency?: string;
  attendees?: Array<{ email?: string; self?: boolean; responseStatus?: string }>;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

/**
 * What kind of block this is, when nobody told us.
 *
 * This used to default everything without our private property to "meeting",
 * on the reasoning that a meeting is treated most carefully downstream. A real
 * calendar showed that to be exactly backwards: a diary of recurring "Focus
 * time" and "Lunch" blocks came back as five hours of client-facing load every
 * weekday, so the density map shaded a whole month identically and said
 * nothing. A wrong label does not fail safe here — it drowns the signal.
 *
 * Google carries enough to do better. `eventType` is authoritative for focus
 * and out-of-office; an attendee who is not the advisor is what actually makes
 * something a meeting; and an event the advisor marked Free is, by their own
 * declaration, not a commitment. Own time is the default now, because most of
 * a calendar is.
 */
function inferKind(e: GoogleEvent): string {
  if (e.eventType === "focusTime") return "focus";
  if (e.eventType === "outOfOffice") return "break";

  /* Word boundaries matter more than they look. Without them "rest" matches
     "Restructuring review" and a client meeting is filed as a break — which
     then drops out of the load count entirely, so the day reads free. */
  const title = (e.summary ?? "").toLowerCase();
  if (/\blunch\b|\bbreak\b|\bdinner\b|\bgym\b|\brest\b/.test(title)) return "break";
  if (/\bflight\b|\bdrive\b|\btravel\b|\btrain\b|\btransit\b/.test(title)) return "travel";

  // Someone else is expected to be there. That is what a meeting is.
  const others = (e.attendees ?? []).filter((a) => a.self !== true);
  if (others.length > 0) return e.hangoutLink ? "call" : "meeting";

  // A conferencing link with nobody invited is usually a standing personal
  // room, not a call anyone is waiting in.
  if (e.transparency === "transparent") return "admin";

  return /\bfocus\b|\bdeep work\b|\bprep\b|\bwrite\b/.test(title) ? "focus" : "admin";
}

/**
 * Google's shape, in ours.
 *
 * `kind` and the client key are carried in Google's private extended
 * properties, so a meeting this app created still knows who it is with after a
 * round trip — and an event created in Google's own UI simply arrives without
 * them, which is why both are optional rather than defaulted to something
 * untrue.
 */
function shape(e: GoogleEvent, calendarId: string) {
  const startIso = e.start?.dateTime ?? e.start?.date;
  const endIso = e.end?.dateTime ?? e.end?.date;
  const startsAt = startIso ? Date.parse(startIso) : NaN;
  const ends = endIso ? Date.parse(endIso) : NaN;
  const priv = e.extendedProperties?.private ?? {};

  return {
    googleId: e.id,
    calendarId,
    title: e.summary ?? "(no title)",
    startsAt,
    minutes: Number.isFinite(ends) && Number.isFinite(startsAt)
      ? Math.max(5, Math.round((ends - startsAt) / 60_000))
      : 30,
    kind: priv["chadbuddyKind"] ?? inferKind(e),
    where: e.location ?? (e.hangoutLink ? "Online" : ""),
    booking:
      e.status === "cancelled"
        ? ("cancelled" as const)
        : e.status === "tentative"
          ? ("tentative" as const)
          : ("confirmed" as const),
    ...(priv["chadbuddyClient"] ? { clientKey: priv["chadbuddyClient"] } : {}),
    ...(e.hangoutLink ? { conferenceUrl: e.hangoutLink } : {}),
    updatedAt: Date.now(),
  };
}

export const upsertEvents = internalMutation({
  args: { events: v.array(v.any()) },
  handler: async (ctx, { events }) => {
    for (const e of events) {
      if (!Number.isFinite(e.startsAt)) continue;

      const existing = await ctx.db
        .query("events")
        .withIndex("by_google", (q) => q.eq("googleId", e.googleId))
        .unique();

      // A cancelled event is removed rather than stored as a tombstone: every
      // consumer filters it out anyway, and a mirror full of them makes the
      // day query slower for no one's benefit.
      if (e.booking === "cancelled") {
        if (existing) await ctx.db.delete(existing._id);
        continue;
      }

      if (existing) await ctx.db.patch(existing._id, e);
      else await ctx.db.insert("events", e);
    }
  },
});

/**
 * Pull changes from Google.
 *
 * Incremental when a sync token is held, full otherwise. A 410 means the token
 * has expired — Google's documented way of saying "start again" — so it is
 * caught and retried as a full sync rather than surfaced as a failure.
 */
export const pull = action({
  args: { calendarId: v.optional(v.string()) },
  handler: async (ctx, { calendarId }): Promise<{ count: number; full: boolean }> => {
    const cal = calendarId ?? "primary";
    const access = await token(ctx);
    const stored = await ctx.runQuery(internal.calendar.auth, {});

    const fetchPage = async (sync?: string, full = false, pageToken?: string) => {
      const p = new URLSearchParams({ singleEvents: "true", maxResults: "250" });
      if (pageToken) p.set("pageToken", pageToken);
      if (sync && !full) p.set("syncToken", sync);
      else {
        /* The window has to cover every month the calendar page can be
           stepped to, or a month the advisor scrolls into comes back empty and
           reads as a free month rather than as one nobody fetched. A fortnight
           either side was enough for the day page alone and is not enough for
           a month grid with arrows on it. */
        p.set("timeMin", new Date(Date.now() - PAST_DAYS * 86_400_000).toISOString());
        p.set("timeMax", new Date(Date.now() + AHEAD_DAYS * 86_400_000).toISOString());
        p.set("orderBy", "startTime");
      }
      return fetch(`${CAL}/calendars/${encodeURIComponent(cal)}/events?${p}`, {
        headers: { authorization: `Bearer ${access}` },
      });
    };

    let full = !stored?.syncToken;
    let res = await fetchPage(stored?.syncToken, full);

    if (res.status === 410) {
      full = true;
      await ctx.runMutation(internal.calendar.setSyncToken, { syncToken: undefined });
      res = await fetchPage(undefined, true);
    }
    if (!res.ok) throw new Error(`Calendar list failed: ${res.status} ${await res.text()}`);

    /* Pages have to be followed to the end, and not only for completeness:
       Google withholds nextSyncToken until the last page, so stopping early
       would leave no cursor and turn every subsequent sync into a full one. */
    let count = 0;
    let syncToken: string | undefined;
    let page: string | undefined;

    for (;;) {
      const json = (await res.json()) as {
        items?: GoogleEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      };
      const items = (json.items ?? []).map((e) => shape(e, cal));
      await ctx.runMutation(internal.calendar.upsertEvents, { events: items });
      count += items.length;

      syncToken = json.nextSyncToken;
      page = json.nextPageToken;
      if (!page) break;

      res = await fetchPage(stored?.syncToken, full, page);
      if (!res.ok) throw new Error(`Calendar list failed: ${res.status} ${await res.text()}`);
    }

    await ctx.runMutation(internal.calendar.setSyncToken, { syncToken });

    return { count, full };
  },
});

/* ── writing back ─────────────────────────────────────────────────── */

/**
 * Put something on the calendar.
 *
 * Tentative unless a person confirmed it, which is the whole safety property
 * of booking from a message the assistant read: a wrong guess is a block the
 * advisor deletes, not an appointment somebody was told about.
 */
export const createEvent = action({
  args: {
    title: v.string(),
    startsAt: v.number(),
    minutes: v.number(),
    kind: v.string(),
    where: v.optional(v.string()),
    clientKey: v.optional(v.string()),
    tentative: v.optional(v.boolean()),
    inferredCite: v.optional(v.string()),
    calendarId: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<string> => {
    const cal = a.calendarId ?? "primary";
    const access = await token(ctx);

    const res = await fetch(`${CAL}/calendars/${encodeURIComponent(cal)}/events`, {
      method: "POST",
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary: a.title,
        location: a.where ?? "",
        status: a.tentative === false ? "confirmed" : "tentative",
        start: { dateTime: new Date(a.startsAt).toISOString() },
        end: { dateTime: new Date(a.startsAt + a.minutes * 60_000).toISOString() },
        // Carried on the event so a round trip does not lose who it is with.
        extendedProperties: {
          private: {
            chadbuddyKind: a.kind,
            ...(a.clientKey ? { chadbuddyClient: a.clientKey } : {}),
            ...(a.inferredCite ? { chadbuddyCite: a.inferredCite } : {}),
          },
        },
      }),
    });

    if (!res.ok) throw new Error(`Calendar insert failed: ${res.status} ${await res.text()}`);
    const made = (await res.json()) as GoogleEvent;

    await ctx.runMutation(internal.calendar.upsertEvents, { events: [shape(made, cal)] });
    return made.id;
  },
});

/** Move an event, and mirror the move. */
export const moveEvent = action({
  args: { googleId: v.string(), startsAt: v.number(), minutes: v.number(), calendarId: v.optional(v.string()) },
  handler: async (ctx, a): Promise<void> => {
    const cal = a.calendarId ?? "primary";
    const access = await token(ctx);

    const res = await fetch(`${CAL}/calendars/${encodeURIComponent(cal)}/events/${a.googleId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify({
        start: { dateTime: new Date(a.startsAt).toISOString() },
        end: { dateTime: new Date(a.startsAt + a.minutes * 60_000).toISOString() },
      }),
    });

    if (!res.ok) throw new Error(`Calendar patch failed: ${res.status} ${await res.text()}`);
    await ctx.runMutation(internal.calendar.upsertEvents, { events: [shape(await res.json(), cal)] });
  },
});

/** Promote a tentative booking, or drop it. */
export const settleEvent = action({
  args: { googleId: v.string(), booking: v.string(), calendarId: v.optional(v.string()) },
  handler: async (ctx, a): Promise<void> => {
    const cal = a.calendarId ?? "primary";
    const access = await token(ctx);

    const res = await fetch(`${CAL}/calendars/${encodeURIComponent(cal)}/events/${a.googleId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify({ status: a.booking }),
    });

    if (!res.ok) throw new Error(`Calendar patch failed: ${res.status} ${await res.text()}`);
    await ctx.runMutation(internal.calendar.upsertEvents, { events: [shape(await res.json(), cal)] });
  },
});

/* ── what the dashboard reads ─────────────────────────────────────── */

export const day = query({
  args: { dayMs: v.number() },
  handler: async (ctx, { dayMs }) => {
    const start = new Date(dayMs);
    start.setHours(0, 0, 0, 0);
    const end = start.getTime() + 86_400_000;

    return ctx.db
      .query("events")
      .withIndex("by_start", (q) => q.gte("startsAt", start.getTime()).lt("startsAt", end))
      .collect();
  },
});

export const upcoming = query({
  args: { untilMs: v.number() },
  handler: async (ctx, { untilMs }) =>
    ctx.db
      .query("events")
      .withIndex("by_start", (q) => q.lte("startsAt", untilMs))
      .collect(),
});

/** Whether the advisor has connected an account at all. */
export const connected = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("calendarAuth")
      .withIndex("by_account", (q) => q.eq("account", ACCOUNT))
      .unique();
    return { connected: row !== null, since: row?.updatedAt ?? null };
  },
});

/** Drop the connection. The tokens go with it. */
export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("calendarAuth")
      .withIndex("by_account", (q) => q.eq("account", ACCOUNT))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

/* ── push channels ───────────────────────────────────── */

export const saveChannel = internalMutation({
  args: { channelId: v.string(), channelExpiresAt: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("calendarAuth")
      .withIndex("by_account", (q) => q.eq("account", ACCOUNT))
      .unique();
    if (row) await ctx.db.patch(row._id, { ...args, updatedAt: Date.now() });
  },
});

/**
 * Ask Google to tell us when the calendar changes.
 *
 * Channels expire — a week at most, and Google may end one sooner — so this is
 * not a one-time setup call. `tick` runs it again before the current one
 * lapses. If it never ran at all the app still works, just at cron latency
 * instead of seconds, which is the property that makes the push path safe to
 * depend on lightly.
 */
export const watch = action({
  args: { calendarId: v.optional(v.string()) },
  handler: async (ctx, { calendarId }): Promise<void> => {
    const site = process.env["CONVEX_SITE_URL"] ?? "";
    // Google refuses a non-HTTPS receiver, and a self-hosted deployment on
    // localhost has no public address to give it. Skipping is correct rather
    // than fatal: the cron already covers this case.
    if (!site.startsWith("https://")) return;

    const cal = calendarId ?? "primary";
    const access = await token(ctx);
    // Deterministic, so re-running this replaces the channel rather than
    // accumulating a new one on every deploy.
    const channelId = `chadbuddy-${cal}`;

    const res = await fetch(`${CAL}/calendars/${encodeURIComponent(cal)}/events/watch`, {
      method: "POST",
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: `${site}/google/push`,
        token: process.env["GOOGLE_PUSH_TOKEN"] ?? "",
      }),
    });

    if (!res.ok) throw new Error(`Calendar watch failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { id: string; expiration?: string };

    await ctx.runMutation(internal.calendar.saveChannel, {
      channelId: json.id,
      channelExpiresAt: Number(json.expiration ?? 0),
    });
  },
});

/**
 * The cron's job.
 *
 * Two things, in the order that matters. Pull first, because that is what keeps
 * the mirror correct whether or not a push ever arrives — the sync token makes
 * a no-change poll nearly free. Then renew the channel if it is close to
 * lapsing, so pushes keep arriving between polls.
 */
export const tick = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const stored = await ctx.runQuery(internal.calendar.auth, {});
    if (!stored) return;

    await ctx.runAction(api.calendar.pull, {});

    const expires = stored.channelExpiresAt ?? 0;
    // A day's margin. Renewing early costs one call; renewing late leaves a
    // window where changes only surface at cron latency.
    if (expires - Date.now() < 86_400_000) await ctx.runAction(api.calendar.watch, {});
  },
});
