# Google Calendar

The schedule the dashboard shows, coming from the advisor's real calendar
instead of `data/schedule.ts`.

## Why there is no bridge here

Telegram needed a separate process because it holds a socket and a Convex action
gets ten minutes. Calendar holds nothing — it is REST for reads and writes, and a
webhook for change notifications. So all of it lives in Convex:

| Piece | File | Job |
|---|---|---|
| API calls | `convex/calendar.ts` | OAuth, sync, create/move/settle |
| OAuth callback + push receiver | `convex/http.ts` | the two URLs Google calls |
| Fallback poll | `convex/crons.ts` | every 5 minutes, whether or not a push arrives |
| The interface's view | `src/convexCalendar.ts` | a `CalendarSource` reading the mirror |

## What you have to set up

Four environment variables on the Convex deployment
(`bunx convex env set NAME value`, or the dashboard's Settings → Environment
Variables):

| Name | Where it comes from |
|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud console → Credentials → OAuth 2.0 Client ID (type: Web application) |
| `GOOGLE_CLIENT_SECRET` | same credential |
| `CALENDAR_STATE_SECRET` | any long random string you invent |
| `GOOGLE_PUSH_TOKEN` | any long random string you invent |

Then, in the Google Cloud console:

1. Enable the **Google Calendar API** for the project.
2. On the OAuth client, add an **Authorised redirect URI** of
   `https://<deployment>.convex.site/google/callback` — it must match
   `CONVEX_SITE_URL + /google/callback` exactly, including the scheme and with no
   trailing slash. `CONVEX_SITE_URL` is set by Convex itself; you do not set it.
3. While the consent screen is in Testing, add the advisor's Google account under
   **Test users**, or Google will refuse the sign-in with `access_denied`.

The scope requested is `calendar.events` — read and write events, and nothing
else. Not `calendar`, which would also allow deleting whole calendars.

## Connecting

`api.calendar.authUrl` returns the consent URL; open it, sign in, and the
callback does the rest — exchange, first sync, and registering the push channel.
`api.calendar.connected` reports whether an account is attached.

The tokens never reach the client. The redirect lands on a Convex HTTP endpoint
rather than in the app, so the authorization code is exchanged server-side and
the refresh token — a permanent key to the calendar — is written straight to the
`calendarAuth` table.

## Localhost

Google will not send a push to a non-HTTPS address, so on a self-hosted
deployment `watch` returns without registering a channel and the cron carries the
whole load. Everything works; changes surface within five minutes instead of
within seconds. This is deliberate rather than a limitation to work around — the
cron is the correct path and the push is a latency improvement on top of it,
which is what makes a dropped notification survivable.

## The two sync paths

`pull` is incremental when it holds a sync token and full when it does not.
Google expires sync tokens on its own schedule and answers a stale one with
**410**; that is not an error, it is Google saying "start again", and `pull`
catches it and re-runs as a full sync. Anything else and the mirror silently
stops updating.

A full sync covers a fortnight either side of now. The day page and the maturity
view between them cannot show more than that, and an unbounded window is a lot of
rows nobody reads.

## What a Google event does not carry

`purpose`, `cites` and `prep` come back empty for anything created outside this
app, and they stay empty. The seeded day has a traceable reason for every meeting
because a person wrote one; an event dragged into Google Calendar on a phone has
a title and nothing else. Inventing a purpose for it would put unattributed prose
in the one place this product promises is always traceable.

What does survive a round trip is `kind` and the client key, carried in Google's
private extended properties — so a meeting this app booked still knows who it is
with after Google has stored and returned it.

## Tentative is the safety property

When the assistant reads "Thursday 4pm works" in a thread and books it, it is
guessing. `createEvent` writes `status: "tentative"` unless the caller says a
person confirmed it, because a wrong guess is then a block the advisor deletes
rather than an appointment somebody was told about. The line this must not cross
is a *confirmed* event nobody agreed to, or a message to the client saying it is
booked — see `src/presence.ts` for where that sits.
