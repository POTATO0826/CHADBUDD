# ChadBuddy

Retention for independent financial advisors. Advisors don't lose clients to bad
advice, they lose them to dropped threads — a broken promise, an unanswered
question, a relationship that goes quiet while staying polite.

ChadBuddy reads the Telegram history the advisor already has, finds the
relationships that are decaying, explains why against actual messages, and says
what to do about it.

**Every claim in the UI is traceable to a source message. If it can't be traced,
it isn't shown.** That isn't a guideline here, it's a function
(`findVerbatim` in `src/ledger.ts`) that discards anything unquotable.

---

# Getting it running

There are three separate things to set up, and they are genuinely independent —
you can stop after step 1 and have a working app. Do them in order.

| Step | What it gives you | Skippable? |
|---|---|---|
| 1 · **The app** | the whole interface, on seeded demo data | no |
| 2 · **Convex** | the backend: your real data, live updates, sending | yes — seed still works |
| 3 · **The agent** | model-written drafts and answers | yes — templates still work |

Nothing degrades silently. Without Convex the app runs on the seed and says so;
without the agent every draft is a template and the label above it says
`template — the model is off`.

## Step 1 — the app

```bash
bun install
bun run dev
```

That's it for the browser. `bun run dev` starts everything it can and prefixes
each process's output so you can tell who said what, and one Ctrl+C stops all of
them.

```bash
bun run dev --web          # a browser tab instead of the desktop window
bun run dev --no-bridge    # any part can be dropped
bun run dev --preflight-only   # just tell me what is and isn't armed
```

Or run pieces yourself:

```bash
bun run web          # just the page — http://localhost:4321
bun run check        # tsc --noEmit
bun run verify:ui    # every citation in the UI resolves to a real message
bun run verify:seed  # the four decay signals, month by month
```

### Seeing a specific screen quickly

The page reads the URL, which beats clicking through:

```
http://localhost:4321/                              the idle pill
http://localhost:4321/?state=peek                   the book-at-a-glance card
http://localhost:4321/?open                         the dashboard
http://localhost:4321/?open&page=desk               straight to the desk
http://localhost:4321/?open&page=clients&client=A   straight to one client
http://localhost:4321/?open&tags=1                  show the classifier labels
http://localhost:4321/?open&live                    force live data in a browser
http://localhost:4321/?open&seed                    force seed data, even in the app
```

## Step 2 — opening the desktop app (Tauri)

The browser is fine for development. **The product is the desktop window** — a
transparent, always-on-top overlay that floats above whatever you're actually
working in, which is the entire point of a pill that watches your book.

### What you need first

- **Rust** — install from [rustup.rs](https://rustup.rs). This is the only extra
  toolchain; everything else is Bun.
- **Windows:** Visual Studio Build Tools with the *Desktop development with C++*
  workload, and WebView2 (already present on Windows 11).
- **macOS:** Xcode Command Line Tools — `xcode-select --install`.
- **Linux:** `webkit2gtk` and `libayatana-appindicator` via your package manager.

### Opening it

```bash
bun run tauri:dev
```

or, to get Convex and the Telegram bridge alongside it in one terminal:

```bash
bun run dev
```

**The first run compiles Rust and takes several minutes.** Every run after that
is seconds. Nothing is wrong — it is building `src-tauri/`.

> **Do not run `bun run web` at the same time.** Tauri starts the web server
> itself through `beforeDevCommand`, and a second one fights it for port 4321.
> This is why `bun run dev` deliberately leaves the web server out of its list.

### What you'll see, and how to close it

The window is **maximised, transparent, undecorated, always on top, and skipped
in the taskbar**. Your desktop shows through it; only the pill is painted. It
does not steal focus when it appears.

Because there's no titlebar and nothing in the taskbar, **the way out is the ⏻
button in the dashboard header** — it only renders when the app detects the Tauri
shell, so you'll never see it in a browser. Click the pill to open the dashboard,
then ⏻.

The window covers the whole screen but ignores your cursor everywhere except
over the pill itself, so clicks meant for your desktop still land there. When the
dashboard is open the whole viewport becomes clickable, which is what makes
"click away to close" work.

### Live by default, and how to override it

In the desktop app **live mode is on** — it assumes a real advisor wants their
real book. In a browser it's off unless you ask. Either way you can force it:

```bash
# in the app, to demo on the seed instead of real clients
http://localhost:4321/?open&seed
```

### Building an installer

```bash
bun run tauri:build
```

Produces an NSIS installer on Windows, a `.dmg`/`.app` on macOS. It runs
`bun run build` first, so the bundle it ships is the same static build Vercel
serves.

## Step 3 — Convex, the backend

Convex holds the schema, the agent passes, the outbox, the calendar mirror and
email. Without it the app runs entirely on the seeded threads in `data/`.

### First time, once

```bash
bunx convex dev
```

This opens a browser to log in and **creates your own deployment**, then writes
`CONVEX_DEPLOYMENT` into `.env.local`. Ctrl+C once it says it's ready — you only
need this the first time.

After that:

```bash
bun run convex:dev      # watch convex/ and push on every save
bun run convex:deploy   # push once and exit
bun run convex:codegen  # regenerate convex/_generated
```

`bun run dev` runs the watcher for you, so day to day you won't type these.

### One deployment per person

**Never point `convex dev` at a teammate's deployment.** Two watchers pushing
different local code at one backend overwrite each other on every save. Git
carries the code; it does not carry the deployment the code talks to — which is
the answer to "I pulled main and nothing changed". See
[TEAMWORK.md](TEAMWORK.md).

### What runs on its own once Convex is up

| Job | Every | What it does |
|---|---|---|
| `agent pass` | 15 min | reads threads, mines key points, scores |
| `market news` | 1 hour | sweeps the wire, classifies against the book |
| `calendar sync` | 5 min | pulls Google Calendar, if connected |
| `email ingest` | 10 min | pulls inbound mail, if configured |
| `task suggestions` | 30 min | proposes tasks from what was said |
| `presence status` | 1 min | auto-replies during busy blocks |

Google Calendar is optional and set up separately — see
[convex/CALENDAR.md](convex/CALENDAR.md). Without it the app runs on the seeded
day; `src/daysource.ts` is the one seam that decides which.

### Telegram

Per person, and one command:

```bash
bun run tg:spike     # your phone, your code, once
bun run bridge       # Telegram in, Convex out
```

Your session lives in `.tg/` and is gitignored — it is a full account login in
plaintext, so it never leaves your machine. `bun run dev` skips the bridge with
instructions if no session exists yet.

## Step 4 — linking the agent

The model writes drafts and answers questions. Everything it produces is gated:
quotes must be verbatim, figures must come from the holdings table, and a
template stands in whenever it can't deliver.

### The one gotcha worth reading

**There are two places a key can live, and they are not the same place.**

| Where | Who reads it | Set it with |
|---|---|---|
| `.env.local` | scripts on *your machine* — `bun run agent:check` | edit the file |
| the Convex deployment | the *backend* — every draft, answer and cron | `bunx convex env set` |

The app's drafts come from the backend. **A key in `.env.local` alone does
nothing for them.** A stale key on the deployment fails quietly as a 401 while
your local check passes happily — which is exactly the shape this failure takes.

### Setting it

```bash
bunx convex env set OPENAI_API_KEY sk-...     # the one that matters
bunx convex env list                          # confirm what the backend holds
```

And to test the provider from your machine:

```bash
bun run agent:check
```

That prints the base URL, the key's length (never the key), the models the
provider offers, and whether structured output and the verbatim gate both
survive a real call.

### Using a different provider

The client is OpenAI-compatible, so Hermes, OpenRouter, vLLM or Ollama all work
by changing two variables and nothing else:

```bash
bunx convex env set AGENT_BASE_URL https://openrouter.ai/api/v1
bunx convex env set AGENT_API_KEY  sk-or-...
bunx convex env set AGENT_MODEL    some-model-name
```

`AGENT_API_KEY` wins over `OPENAI_API_KEY` when both are set. `AGENT_MODEL`
defaults to `gpt-5.5`.

### Autonomous sending is off

Set `AUTO_SEND=1` on the deployment and the agent may send a rank-1
recommendation whose intent is *send*, once per client per cooldown. It is off by
default and should stay off until you have watched the rejection rate on real
threads. When it is on, the **auto-replied** counter in the peek card tells you
how many went out today.

---

# Using ChadBuddy

*This section assumes you have never seen the app. Read it top to bottom and you
will know what every screen is for and what to do on it.*

## The idea in one paragraph

You have a few hundred clients and a chat history with each of them. Somewhere in
that history are the three things that lose you a client: a question you never
answered, a promise you never kept, and a person who quietly stopped talking to
you. Those are invisible in an inbox, because an inbox is sorted by *newest* and
these problems are all made of *absence*. ChadBuddy reads the whole history, sorts
by **who is slipping away**, and shows you the exact message that proves it.

## The pill on your screen

ChadBuddy is not a window you open. It's a small pill that floats above
everything else, and it has three sizes:

| What you do | What you get |
|---|---|
| nothing | **Idle** — a one-line pill: the single most urgent thing right now |
| hover over it | **Peek** — a card of five numbers: your book at a glance |
| click it | **Open** — the full dashboard |

Click anywhere outside the dashboard to close it again. If a client messages you
while the pill is idle, it grows on its own for a few seconds to show you — and
never on top of the open dashboard, because you're already looking.

The five numbers in the peek card are doors — click one and it opens the page
that can clear it:

- **tasks left** — things you said you'd do today
- **unreplied** — clients whose last message was theirs
- **calls to return** — missed calls with nobody called back
- **meetings left** — what's still ahead today
- **auto-replied** — messages the agent sent on your behalf today *(only appears
  once Convex is connected)*

## The six pages

Along the top of the open dashboard:

| Page | What it answers |
|---|---|
| **overview** | how is the whole book, right now |
| **day** | what does today look like, hour by hour |
| **calendar** | what's booked, what's owed, what's overdue |
| **desk** | *what should I do about the market today* |
| **clients** | one person, in full |
| **calls** | who rang, who needs ringing back |

The two you'll live in are **desk** and **clients**. The rest support them.

---

## Flow 1 — the morning pass (the desk)

**Use this when:** you sit down and want to know who to contact today.

### 1. Maturing soon
Plans ending inside 60 days. A maturity is a conversation with a deadline on it —
miss it and the money leaves quietly. Urgent ones are marked in gold.

### 2. Churn radar
Every client on one line, worst first, with the reason spelled out:

> **Michelle Tan** · SILENT · *Replies in 22m, and hasn't asked a single question in 30 days*

Read that carefully, because it's the whole product. Michelle replies fast and is
perfectly polite. Every ordinary dashboard says she's fine. She has stopped
*asking* anything and stopped *starting* conversations — she has already decided
to leave and hasn't told you. That's **silent churn**, scored against *her own*
baseline, not a global threshold. A client who was always slow is not flagged for
being slow again.

Click any line to open that client.

### 3. Market watch
Today's headlines, sorted by how much of *your book* they touch. Each row shows
the lean (**pressure** / **relief** / **watch**), the headline, the outlet and
age, and either `3 clients · RM 424,300` or, dimmed, `no exposure on the book`.

> **Stories that touch nobody stay on the list.** A feed that only ever shows hits
> looks handpicked; you can only trust the hits if you can see the misses.

Open a headline and you get the summary, a link to the real article, and **one row
per client the story touches**, each carrying:

- a **tier** — `action`, `watch`, or `steady`
- the **reason** for that tier, in the client's own terms
- `↩ owed an answer` if their last message asked something nobody replied to
- `demo data · no chat` if there's no real Telegram chat behind them

The tier is computed, never guessed by a model. It comes from crossing the story's
lean with the client's own dated commitments. A bond rout is an emergency for
someone who told you they need cash in March, and noise for someone who didn't —
same story, two tiers, and the reason is printed on the row.

Rows order as **reachable first, then owed an answer, then tier, then money.** An
urgent client with no chat behind them is a dead end however large the holding.

Underneath, the story names who it *doesn't* touch:

> Not touched by this: Adrian — no exposure to these classes.

Without that line the desk reads as an alarm generator, and alarm generators get
ignored.

### 4. Click a client → the draft
A written message, ready to send, built from the news *and* that person's own
words. **Edit it** — what's on screen is what goes out. Then **Send Telegram**,
**Send Email**, **Snooze 7d** or **Dismiss**. You'll be asked to confirm. Nothing
here sends on one click.

### 5. Quiet holdings
Anything nobody has updated the client on in 90 days. Low urgency, high goodwill.

---

## Flow 2 — one client, in full

**Use this when:** you're about to talk to someone and want the whole picture.

Go to **clients** and pick a card, or click any name anywhere in the app.

### Left — who they are

1. **Their name**
2. **A status line** — `Steady · 3 days quiet`, or `Cooling`, `Going cold`,
   `Present, not asking`
3. **The decay meter** — five ticks, one per week, height = days that week
   carrying a message. A relationship winding down draws its own staircase.
4. **Facts** — first message, phone, channel, counts, email
5. **Wants** — what they're asking for, and what you owe them
6. **Noted** — facts the agent mined from the thread
7. **A footnote** — how much history this is built on. Under 14 days it says
   `too new to score decay`, because it is.

Nothing renders if there's nothing to say.

### Middle — what was actually said
The whole thread. **Your messages carry a fill; theirs carry an outline.** Under
each is one quiet line — `18:42 · A-012` — the time and the citation id.

Exactly one message gets an extra note, in amber:

> `14:05 · A-031 · asked 3×, unanswered`

That's the obligation open longest, on the message that created it. Only one, on
purpose — a thread where every line wears four badges is a thread nobody reads.

Filter with **all / theirs / flagged**, or search by text, id or timestamp.

At the bottom is the reply box. Pick **Telegram** or **Email**, type, send. Your
message appears in the thread immediately, dimmed, marked `sending…`, and becomes
real when it lands. If nothing arrives within twenty seconds it says so — that
almost always means the bridge isn't running.

### Right — what to do about it
One raised panel, open already holding an opinion: a small kicker
(`where it turned · 12 Mar`), the moment the relationship turned quoted large, a
sentence or two of diagnosis, **Draft the reply**, and the evidence id — click it
to jump to that message. At the very bottom, one input to ask about this person.

---

## Flow 3 — asking the agent

Type in the box at the bottom of the right panel, or press **Draft the reply**.
The agent reads *this thread only* — not the internet, not your other clients —
and answers with the message ids it built the answer from. Click any id
(`A-069 →`) and the thread jumps there, highlighted.

If the answer is something you could send, a control appears under it:

1. **Send this to Priya…** — opens the exact outgoing text in an editable box
2. Read it, change it if you want
3. **Send** — it goes out and appears in her thread

Two steps, deliberately. If the answer failed the citation gate there is no send
button at all — a guess doesn't earn one.

---

## How to trust what you see

**Every quote is verified.** A quote is shown only if it is an *exact substring*
of the message it cites, after whitespace normalisation. The check runs on the
server, after the model has spoken. A model can't fabricate evidence here; it can
still fabricate *reasoning*, so treat the gate as a floor.

**No number is ever written by a model.** Figures come from the holdings table,
and the server refuses any draft containing a figure not in the facts it was
given. A model allowed to write numbers will eventually write one wrong by
RM 40,000.

**Every draft says where it came from** — `drafted by chadbuddy · model, figures
table-checked` versus `template — the model is off`.

**Risk tiers are computed, then handed to the model as fact.** A model that grades
its own urgency grades everything urgent.

**Nothing sends without you.** Every send path ends at a confirmation.

---

# For developers

## Where the stages stand

| Stage | State |
|---|---|
| 1 · Seed data | **done** — 4 hand-written threads, 222 messages, Apr–Aug 2026 |
| 2 · Decay engine | **provisional** — `src/score.ts` measures real signals, weights are a first guess |
| 3 · Ledger extraction | **partly live** — `convex/agent.ts` extracts and gates; `data/ledger-seed.ts` is still the seed |
| 4 · Dashboard | **built** against both seed and live data |
| — · Backend | **live** — Convex: schema, agent passes, outbox, calendar, email |
| — · Tauri shell | **done** — fullscreen transparent overlay with click-through |

### The two honest placeholders

- **`src/score.ts`** — severities and the composite. It consumes *measured*
  signals, each scored against that client's own baseline, but the weights and
  knees are a first guess.
- **`data/ledger-seed.ts`** — the seed ledger entries are hand-written. They pass
  the same verbatim gate the live extraction passes, so the traceability is real
  even where the extraction isn't running.

Numbers that are *displayed* (latencies, ratios, counts, quotes, dates) are
measured or quoted, never invented.

## The seed data

Four threads between one advisor and four clients, roughly four months each,
written by hand so the decay is present in the data rather than asserted in a
comment. `bun run verify:seed` measures it:

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
never sours, and nothing is owed in either direction. She simply stopped asking
anything and stopped starting conversations. A composite score alone rates her
mild; only the silent-churn override catches her.

**Client D is decay the advisor caused**: three product pitches inside five days
(D-024, D-026, D-028), and a fund comparison promised at D-012 on 5 May,
re-promised at D-014, still unsent 104 days later.

`data/fixtures.ts` holds what each thread is *supposed* to show. It's the test
oracle, kept out of `data/threads/` so none of it can leak into the engine — the
engine only ever sees messages.

## How the Tauri shell works

One transparent, undecorated, always-on-top window over the work area. The island
grows entirely in CSS, so the morph never fights an OS window resize.

The only Rust logic is click-through. A window that covers the screen would
swallow every click meant for the desktop, so it ignores the cursor by default —
but then it can't be told when the cursor is over it either, and the hover that
expands the island would never arrive. So the page reports the island's current
rectangle (`src/shell.ts`) and a polling thread compares the OS cursor position
against it, flipping `set_ignore_cursor_events` at the boundary
(`src-tauri/src/lib.rs`).

Idle and peek report the island's own bounds. **Open reports the whole viewport**,
so clicking away actually closes the dashboard.

No Mica or acrylic: on a window this size a native backdrop would blur the entire
desktop rather than the area behind the island. The desktop shows through sharp
and the island's translucent fill does the separating.

## Deploying the web build

`vercel.json` points Vercel at `bun run build` and serves `dist/`. There is no
server component — three static files, and the page talks to Convex from the
browser.

**The Convex URL is baked in at build time**, because a browser cannot read a
`.env`. Set `CONVEX_URL` in the host's environment, and remember that changing it
requires a redeploy — editing the variable alone won't move the deployed bundle.

> **Before sharing a public link:** the deployed page defaults to seed data, but
> `?live` on the same URL connects to whatever `CONVEX_URL` was baked in, and the
> Convex queries have no auth in front of them. Point a public build at a demo
> deployment, or add auth, before handing the link out.

## Layout

```
data/
  clock.ts            one fixed NOW; every window measures from it
  types.ts            seed shapes + the Convex tables they mirror
  threads/            the four hand-written threads
  fixtures.ts         test oracle — never read by the engine or the UI
  ledger-seed.ts      hand-written ledger entries
  holdings.ts         the book: what each client holds
  market.ts           seeded headlines, when the live sweep has none
src/
  signals.ts          the four signals, measured. no scoring.
  ledger.ts           the verbatim gate + open/settled bookkeeping
  score.ts            provisional severities and composite
  derive.ts           every view model the UI renders
  desk.ts             the desk: maturing, market impact, quiet holdings
  live.ts             Convex subscriptions; the seam between seed and live
  shell.ts            click-through region reporting for the Tauri shell
  main.ts             the island, the dashboard, every page
convex/
  schema.ts           the tables
  agent.ts            extraction, ask, briefs — with the verbatim + digit gates
  news.ts             the hourly market sweep
  outbox.ts           the only path to a client's chat
  crons.ts            everything that runs on its own
bridge/
  telegram/           reads your Telegram, writes to Convex, sends the outbox
scripts/
  dev.ts              starts convex, the bridge and Tauri as one process group
  verify-seed.ts      signal proof, descriptive only
  verify-ui.ts        every citation resolves
src-tauri/            the overlay window
```

Telegram data only. No social media anywhere in this build.
