# Working on this together

Two developers, one repo, **two Convex deployments** — and that last part is
what every "why don't I see your changes?" comes down to. Git carries the
code. It does not carry the backend: each deployment has its own database,
its own env vars, its own OAuth registrations. Pulling main gives you every
feature's source and none of its fuel.

## The model

| | Yours | Shared via git |
|---|---|---|
| Code, schema, functions | | ✅ everything |
| `.env.local` (which deployment you talk to) | ✅ gitignored | |
| Deployment env vars (keys, tokens) | ✅ set per deployment | |
| Data (clients, messages, holdings, tasks, events) | ✅ your database | |
| `.tg/` Telegram session, `data/import/holdings.csv` | ✅ gitignored | |

**One deployment per developer.** Never point `convex dev` at a teammate's
deployment — two watchers pushing different local code at one deployment
overwrite each other on every save. Day-to-day you develop against your own;
the demo runs on one designated deployment (currently `bright-civet-444`).

## Setting up a fresh side (Vince, or any new machine)

```bash
git checkout main && git pull
bunx convex dev        # ONCE: interactive login, creates your deployment. Ctrl+C after.
bun run dev            # everything else, every day after
```

`bun run dev` carries its own preflight now: it installs dependencies on a
first clone, tells you when you are behind origin (`--pull` acts on it,
fast-forward only), seeds an empty backend automatically, prints which
features your deployment is armed with, skips the bridge with instructions
when no Telegram session exists, and — under a demo override — refuses to
run anything that could write into a teammate's database. The only thing it
cannot do for you is the one-time interactive Convex login above.
`--preflight-only` shows the verdicts without starting anything.

Then arm your deployment. `bunx convex env set NAME value` for each:

| Var | What stops working without it | Shared or personal? |
|---|---|---|
| `OPENAI_API_KEY` | the agent: ideas, notes, ask, briefs, news | shared key — get it from a teammate privately, never via git |
| `AGENT_MODEL` | (defaults to gpt-5.5) | shared |
| `ADVISOR_NAME` | status replies say "He" | personal — your name |
| `AUTO_SEND` | autonomous rank-1 sends stay off | choice; `1` to enable |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | calendar | **personal** — your own Google Cloud OAuth client, with `https://<your-deployment>.convex.site/google/callback` as an authorised redirect URI |
| `CALENDAR_STATE_SECRET` / `GOOGLE_PUSH_TOKEN` | calendar OAuth + push | personal — any random strings you invent |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | email send + inbound poll | **personal** — your Gmail, your app password |
| `PHONE_WEBHOOK_TOKEN` | the phone-call webhook | personal — random string |

Everything degrades honestly when unset: the calendar shows the seed, email
buttons fail with a plain message, the agent cron logs the missing key. A
deployment with only `OPENAI_API_KEY` is already a working dev environment.

Telegram is per-person too: `bun run tg:spike` once (your phone, your code),
then the bridge uses your session. Your DMs auto-promote into **your**
database — which is the point of one-deployment-per-developer.

## Demo day: both machines, one backend

The designated demo deployment is the one with calendar + email armed. A
teammate's **page** can read it with one line in their `.env.local`:

```
CONVEX_URL=https://bright-civet-444.convex.cloud
```

Two rules that make this safe:

1. **Do not run the bridge with that override set.** Your Telegram account
   would pour into the demo database. The bridge now refuses to start in
   this configuration and says why; `BRIDGE_ALLOW_REMOTE=1` overrides it on
   the rare day a cross-write is intended.
2. **Remove the line after the demo** — while it is set, everything your
   page does lands on the shared deployment.

For real shared access (running `convex dev` against the demo deployment,
setting its env vars), the owner invites you to the Convex team:
dashboard.convex.dev → team settings → invite. Until then, the page-level
override is all a demo needs.

## Git workflow that keeps merges boring

- Branch per person or per feature. Commit early; push your branch daily.
- **Before starting work**: `git checkout main && git pull`, branch from
  there. Merging main into a long-lived branch daily beats one heroic merge.
- **Merging to main**: push your branch → merge `origin/main` into it →
  run the checks below → merge to main → push. Both sides survive by
  construction; the session history has two clean examples of even
  overlapping features (scheduling + proposals) composing.
- The checks: `bun run check`, `bun run check:backend`,
  `bunx tsc --noEmit -p convex/tsconfig.json`, `bun run verify:ui`,
  `bun run build`.

### Conflicts you will actually see, and their one-line fixes

| File | Fix |
|---|---|
| `convex/_generated/**` | take either side, then `bunx convex dev --once` regenerates the truth |
| `bun.lock` | `git checkout --theirs bun.lock && bun install` |
| `src-tauri/Cargo.lock` | `git checkout --theirs src-tauri/Cargo.lock && cargo check` |
| import blocks in `src/main.ts` | almost always a union — keep both sides' lines |

### After every pull

`bun run dev` restart — schema changes deploy to your deployment on the
watcher's first push, and **the Tauri window has no hot reload**: a running
window shows the old bundle until the stack restarts. "I pulled and nothing
changed" is this, roughly every time.
