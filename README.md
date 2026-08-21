# ChadBuddy

Retention for independent financial advisors. Advisors don't lose clients to bad
advice, they lose them to dropped threads — a broken promise, an unanswered
question, a relationship that goes quiet while staying polite.

ChadBuddy reads the WhatsApp history the advisor already has, finds the
relationships that are decaying, explains why against actual messages, and says
what to do about it.

**Every claim in the UI is traceable to a source message. If it can't be traced,
it isn't shown.** That isn't a guideline here, it's a function
(`findVerbatim` in `src/ledger.ts`) that discards anything unquotable.

## Who this is built for

The primary user is the **investment-led advisor** — a relationship manager or
financial analyst whose product is really the ongoing service on top of the
product: portfolio updates, maturity conversations, "here's why your fund moved
and what it means for you." That work is high-touch, per-client, and exactly
what drops first when the book grows — which makes it the thing worth building
an assistant for.

Insurance advisors fit too and nothing here excludes them, but the demo leans
investments deliberately: funds move, markets make news, and a tool that
connects *today's* bond rout to *this* client's holdings shows its value in one
glance, where a static policy cannot. Design decisions should assume a book in
the hundreds — ranked queues and counts, never one-row-per-client.

## Running it

```bash
bun install

bun run dev:all      # everything at once — convex watch, the bridge, the window
```

Three processes have to be running together and there is no reason for three
terminals. `dev:all` starts `convex dev`, the Telegram bridge and the Tauri
shell, prefixes their output so you can tell who said what, and stops all of
them on one Ctrl+C. The web server is not in that list — `tauri dev` starts it
itself via `beforeDevCommand`, and a second one would fight it for port 4321.

```bash
bun run dev:all --web          # a browser tab instead of the Tauri window
bun run dev:all --no-bridge    # any part can be dropped
```

Or run the pieces yourself:

```bash
bun run dev          # http://localhost:4321   (add ?open to land on the dashboard)
bun run bridge       # Telegram in, Convex out
bun run convex:dev   # push convex/ on save
bun run verify:seed  # Stage 1 proof — the four signals, month by month
bun run check        # tsc --noEmit

bun run tauri:dev    # the real thing: transparent overlay on the desktop
```

Google Calendar is optional and set up separately — see
[convex/CALENDAR.md](convex/CALENDAR.md). Without it the app runs on the seeded
day exactly as before; `src/daysource.ts` is the one seam that decides which.

## Where the stages stand

| Stage | State |
|---|---|
| 1 · Seed data | **done** — 4 hand-written threads, 222 messages, Apr–Aug 2026 |
| 2 · Decay engine | **not started** — `src/score.ts` is a provisional stand-in |
| 3 · Ledger extraction | **not started** — `data/ledger-seed.ts` is hand-written |
| 4 · Dashboard | **built ahead of 2 and 3**, against the seed data |
| — · Tauri shell | **done** — fullscreen transparent overlay with click-through |

### There is no backend yet

No Convex. `data/types.ts` documents the exact `messages` table the seed shape
mirrors, so moving it into Convex is a copy rather than a rewrite. Everything
runs from plain TypeScript modules in the meantime.

### The two honest placeholders

The dashboard footer says this on screen, and it's worth repeating:

- **`src/score.ts`** — severities and the composite score. It consumes *measured*
  signals, and each is scored against that client's own baseline, but the
  weights and knees are a first guess and there is no sentiment signal yet, so
  the silent-churn override leans on latency alone. Stage 2 deletes this file.
- **`data/ledger-seed.ts`** — the ledger entries are written by hand. They pass
  the same verbatim gate the Stage 3 extraction output will pass, so the
  traceability is real even though the extraction isn't.

Numbers that are *displayed* (latencies, ratios, counts, quotes, dates) are
measured or quoted, not invented.

## The seed data

Four threads between one advisor (Wei Han) and four clients, roughly four months
each, written by hand so the decay is present in the data rather than asserted
in a comment. `bun run verify:seed` measures it:

| | reply latency | conversations they start | questions/mo | avg length |
|---|---|---|---|---|
| **A** Priya Ramasamy — healthy | 56m → 49m | 0.47 → 0.60 | 4.3 → 4.0 | 90 → 93 ch |
| **B** Faizal Rahman — obvious decay | 9.5h → 44.7h | 0.38 → 0.00 | 2.3 → 0.0 | 94 → 31 ch |
| **C** Michelle Tan — silent churn | 23m → 22m | 0.33 → 0.00 | 3.7 → 0.0 | 113 → 83 ch |
| **D** Adrian Lim — advisor-caused | 47m → 31.2h | 0.23 → 0.00 | 2.3 → 0.0 | 105 → 20 ch |

*(90-day baseline → most recent 30 days, measured from a fixed `NOW` of
2026-08-17 in `data/clock.ts` — the threads don't move, so the windows can't
either.)*

**Client C is the case the product exists for.** Her latency is flat, her tone
never sours, and nothing is owed in either direction — there is no broken promise
to point at. She simply stopped asking anything and stopped starting
conversations. A composite score alone rates her mild; only the silent-churn
override catches her.

**Client D is decay the advisor caused**: three product pitches inside five days
(D-024, D-026, D-028), and a fund comparison promised at D-012 on 5 May,
re-promised at D-014, still unsent 104 days later.

`data/fixtures.ts` holds what each thread is *supposed* to show. It's the test
oracle and it is deliberately kept out of `data/threads/` so none of it can leak
into the engine — the engine only ever sees messages.

## The Tauri shell

One transparent, undecorated, always-on-top window over the work area. The
island grows entirely in CSS, so the morph never fights an OS window resize.

The only Rust logic is click-through. A window that covers the screen would
swallow every click meant for the desktop, so it ignores the cursor by default —
but then it can't be told when the cursor is over it either, and the hover that
expands the island would never arrive. So the page reports the island's current
rectangle (`src/shell.ts`) and a polling thread compares the OS cursor position
against it, flipping `set_ignore_cursor_events` at the boundary
(`src-tauri/src/lib.rs`).

Idle and peek report the island's own bounds. **Open reports the whole
viewport**, so clicking away actually closes the dashboard.

No Mica or acrylic: on a window this size a native backdrop would blur the
entire desktop rather than the area behind the island. The desktop shows through
sharp and the island's translucent fill does the separating. Real blur behind the
island would need a second, island-sized window.

The window has no titlebar and is skipped in the taskbar, so the dashboard grows
its own `quit` button when it detects the shell. Icons are Voltage's, as
placeholders.

## Layout

```
data/
  clock.ts            one fixed NOW; every window measures from it
  types.ts            seed shapes + the Convex table they mirror
  threads/            the four hand-written threads
  fixtures.ts         test oracle — never read by the engine or the UI
  ledger-seed.ts      hand-written ledger entries (Stage 3 replaces this)
src/
  signals.ts          the four signals, measured. no scoring.
  ledger.ts           the verbatim gate + open/settled bookkeeping
  score.ts            PROVISIONAL severities and composite (Stage 2 replaces)
  shell.ts            click-through region reporting for the Tauri shell
  main.ts             the island, the dashboard, the conversation pane
scripts/
  verify-seed.ts      Stage 1 proof, descriptive only
src-tauri/            the overlay window
```

No social media anywhere in this build. WhatsApp data only.
