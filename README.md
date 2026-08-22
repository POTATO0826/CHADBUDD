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
it will never do that on top of the open dashboard, because you're already
looking.

The five numbers in the peek card are doors — click one and it opens the page
that can clear it:

- **tasks left** — things you said you'd do today
- **unreplied** — clients whose last message was theirs
- **calls to return** — missed calls with nobody called back
- **meetings left** — what's still ahead today
- **auto-replied** — messages the agent sent on your behalf today *(only appears
  when the backend is connected; see "What is automatic" below)*

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

The desk reads top to bottom, and each band answers a different question.

### 1. Maturing soon
Plans ending inside 60 days. A maturity is a conversation with a deadline on it —
if you miss it, the money leaves quietly. Urgent ones are marked in gold.

### 2. Churn radar
Every client on one line, worst first, with the reason spelled out:

> **Michelle Tan** · SILENT · *Replies in 22m, and hasn't asked a single question in 30 days*

Read that carefully, because it's the whole product. Michelle replies fast and is
perfectly polite. Every ordinary dashboard says she's fine. She has stopped
*asking* anything and stopped *starting* conversations — she has already decided
to leave and hasn't told you. That's **silent churn**, and it's scored against
*her own* baseline, not a global threshold. A client who was always slow is not
flagged for being slow again.

Click any line to open that client.

### 3. Market watch
Today's headlines, sorted by how much of *your book* they touch.

Each row shows the lean (**pressure** / **relief** / **watch**), the headline, the
outlet and age, and either `3 clients · RM 424,300` or, dimmed,
`no exposure on the book`.

> **Stories that touch nobody stay on the list.** That's deliberate. A feed that
> only ever shows hits looks handpicked; you can only trust the hits if you can
> see the misses.

Click a headline to open it. Inside you get the summary, a link to the real
article, and then **one row per client the story touches**, each carrying:

- a **tier** — `action`, `watch`, or `steady`
- the **reason** for that tier, in the client's own terms
- `↩ owed an answer` if their last message asked something nobody replied to
- `demo data · no chat` if there's no real Telegram chat behind them

The tier is computed, never guessed by a model. It comes from crossing the
story's lean with the client's own dated commitments. A bond rout is an emergency
for someone who told you they need cash in March, and noise for someone who
didn't — same story, two different tiers, and the reason is printed on the row.

Rows are ordered: **reachable first, then owed an answer, then tier, then money.**
An urgent client with no chat behind them is a dead end however large the
holding, so they sort below someone you can actually write to.

Underneath, the story names who it *doesn't* touch:

> Not touched by this: Adrian — no exposure to these classes.

That line matters. Without it the desk reads as an alarm generator, and alarm
generators get ignored.

### 4. Click a client → the draft
You get a written message, ready to send, built from the news *and* that person's
own words. **Edit it** — what's on screen is what goes out. Then:

- **Send Telegram** — goes out through the bridge, as you
- **Send Email** — needs an email on file
- **Snooze 7d** / **Dismiss** — it stops appearing

You'll be asked to confirm before anything leaves. Nothing in this product sends
on one click.

### 5. Quiet holdings
Anything nobody has updated the client on in 90 days. Low urgency, high goodwill.

---

## Flow 2 — one client, in full

**Use this when:** you're about to talk to someone and want the whole picture.

Go to **clients** and pick a card, or click any name anywhere in the app. The
page has three columns.

### Left — who they are
Reads top to bottom, and nothing renders if there's nothing to say:

1. **Their name**
2. **A status line** — `Steady · 3 days quiet`, or `Cooling`, or `Going cold`, or
   `Present, not asking`
3. **The decay meter** — five ticks, one per week, height = how many days that
   week carried a message. A relationship winding down draws its own staircase.
4. **Facts** — first message, phone, channel, message counts, email
5. **Wants** — what they're asking for, and what you owe them
6. **Noted** — facts the agent mined from the thread
7. **A footnote** — how much history this is built on. Under 14 days it says
   `too new to score decay`, because it is.

### Middle — what was actually said
The whole thread. **Your messages carry a fill; theirs carry an outline.** Under
each message is one quiet line: `18:42 · A-012` — the time and the message's
citation id.

Exactly one message in the thread gets an extra note, in amber:

> `14:05 · A-031 · asked 3×, unanswered`

That's the obligation that has been open longest, sitting on the message that
created it. Only one, on purpose — a thread where every line wears four badges is
a thread nobody reads.

Filter with **all / theirs / flagged**, or search the thread by text, id or
timestamp.

At the bottom is the reply box. Pick **Telegram** or **Email**, type, send. Your
message appears in the thread immediately, dimmed, marked `sending…`, and turns
into a real message when it lands. If it hasn't arrived after twenty seconds it
says so — that almost always means the bridge isn't running.

### Right — what to do about it
One raised panel. It opens already holding an opinion:

- a small **kicker** — `where it turned · 12 Mar`
- the **moment the relationship turned**, quoted large
- **one or two sentences** of diagnosis
- **Draft the reply** — the button that acts on it
- the **evidence id** — click it to jump to that message in the thread

At the very bottom is a single input: ask the agent anything about this person.

---

## Flow 3 — asking the agent

Type a question in the box at the bottom of the right panel, or press **Draft the
reply**. The agent reads *this thread only* — not the internet, not your other
clients — and answers with the message ids it built the answer from.

Click any id (`A-069 →`) and the thread jumps to that message, highlighted.

If the answer is something you could send, a control appears under it:

1. **Send this to Priya…** — opens the exact outgoing text in an editable box
2. Read it, change it if you want
3. **Send** — it goes out and appears in her thread

Two steps, deliberately. And if the answer failed the citation gate, there is no
send button at all — a guess doesn't earn one.

---

## How to trust what you see

This is the part worth understanding, because it's the reason the product exists.

**Every quote is verified.** A quote is only shown if it is an *exact substring*
of the message it cites, after whitespace normalisation. The check runs on the
server, after the model has spoken. A model can't fabricate evidence here; it can
still fabricate *reasoning*, so treat the gate as a floor, not a ceiling.

**No number is ever written by a model.** Figures come from the holdings table.
The server refuses any draft containing a figure that isn't in the facts it was
given. A model allowed to write numbers will eventually write one wrong by
RM 40,000.

**Every draft has a label saying where it came from** —
`drafted by chadbuddy · model, figures table-checked` versus
`template — the model is off`. If the model is unavailable or its draft is
refused, a deterministic template built from the same facts shows instead. You
always get *something*, and you always know which you're looking at.

**Risk tiers are computed, then handed to the model as fact.** The model is never
asked how urgent something is. A model that grades its own urgency grades
everything urgent.

**Nothing sends without you.** Every send path ends at a confirmation.

---

## What is automatic, and what is not

Automatic, without asking:

- reading new messages as they arrive
- mining facts and key points from threads
- the hourly market sweep
- scoring decay
- capturing an email address a client states in their own message — judged twice
  (does the address resemble their name? is the sentence really *"email me at…"*
  and not *"my wife's email is…"*?) and gated against the verbatim message

**Never automatic by default: sending.** Autonomous replies are off unless
`AUTO_SEND=1` is set on the deployment, and even then only for a rank-1
recommendation whose intent is *send*, once per client per cooldown. When it is
on, the **auto-replied** counter in the peek card tells you how many went out
today, and its tooltip shows the running total and anything stuck in the queue.

If that counter shows messages stuck as `queued`, the bridge isn't running.

---

# Running it

```bash
bun install

bun run dev          # everything — convex watch, the bridge, the Tauri window
```

Three processes have to run together and there's no reason for three terminals.
`dev` starts `convex dev`, the Telegram bridge and the Tauri shell, prefixes their
output so you can tell who said what, and stops all of them on one Ctrl+C. The
web server is not in that list — `tauri dev` starts it itself via
`beforeDevCommand`, and a second one would fight it for port 4321.

```bash
bun run dev --web          # a browser tab instead of the Tauri window
bun run dev --no-bridge    # any part can be dropped
```

Or run the pieces yourself:

```bash
bun run web          # just the page — http://localhost:4321   (add ?open for the dashboard)
bun run bridge       # Telegram in, Convex out
bun run convex:dev   # push convex/ on save
bun run emotion      # the emotion pass, once over every tracked client
bun run agent:check  # is the model reachable, and does it honour the schema
bun run verify:seed  # the four signals, month by month
bun run verify:ui    # every citation in the UI resolves to a real message
bun run check        # tsc --noEmit

bun run tauri:dev    # the real thing: transparent overlay on the desktop
```

### Seeing a specific screen quickly

The page reads the URL, which is faster than clicking through:

```
http://localhost:4321/                          the idle pill
http://localhost:4321/?state=peek               the book-at-a-glance card
http://localhost:4321/?open                     the dashboard
http://localhost:4321/?open&page=desk           straight to the desk
http://localhost:4321/?open&page=clients&client=A   straight to one client
http://localhost:4321/?open&tags=1              show the per-message classifier labels
```

In a browser the Tauri-only bits do nothing — the ☏ Call button is hidden, and
transparency, always-on-top and screen-capture protection don't apply. Sending,
the agent and the live subscriptions all work exactly as they do in the app.

### Setup that isn't automatic

- **The agent** needs `OPENAI_API_KEY` on your Convex deployment
  (`bunx convex env set OPENAI_API_KEY …`). Without it the app still runs and
  every draft is a template.
- **Telegram** is per-person: `bun run tg:spike` once (your phone, your code),
  then the bridge uses your session.
- **Google Calendar** is optional — see [convex/CALENDAR.md](convex/CALENDAR.md).
  Without it the app runs on the seeded day; `src/daysource.ts` is the one seam
  that decides which.

Working on this with someone? Read [TEAMWORK.md](TEAMWORK.md) first — it is the
answer to "I pulled main and nothing changed": git carries the code, not the
deployment it talks to, and the Tauri window has no hot reload.

---

# For developers

## Where the stages stand

| Stage | State |
|---|---|
| 1 · Seed data | **done** — 4 hand-written threads, 222 messages, Apr–Aug 2026 |
| 2 · Decay engine | **provisional** — `src/score.ts` measures real signals, but its weights are a first guess |
| 3 · Ledger extraction | **partly live** — `convex/agent.ts` extracts and gates; `data/ledger-seed.ts` is still the seed |
| 4 · Dashboard | **built** against both seed and live data |
| — · Backend | **live** — Convex: schema, agent passes, outbox, calendar, email |
| — · Tauri shell | **done** — fullscreen transparent overlay with click-through |

### The two honest placeholders

The dashboard says this on screen too, in the status tooltip:

- **`src/score.ts`** — severities and the composite. It consumes *measured*
  signals, each scored against that client's own baseline, but the weights and
  knees are a first guess.
- **`data/ledger-seed.ts`** — the seed ledger entries are written by hand. They
  pass the same verbatim gate the live extraction passes, so the traceability is
  real even where the extraction isn't running.

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

The window has no titlebar and is skipped in the taskbar, so the dashboard grows
its own `quit` button when it detects the shell.

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
bridge/
  telegram/           reads your Telegram, writes to Convex, sends the outbox
scripts/
  verify-seed.ts      signal proof, descriptive only
  verify-ui.ts        every citation resolves
src-tauri/            the overlay window
```

Telegram data only. No social media anywhere in this build.
