# ChadBuddy backend — Telegram ingest on Convex

The dashboard reads 222 hand-written seed messages measured against a frozen clock. This is the other half: a real Telegram account, persisted into a self-hosted Convex, shaped so the existing pipeline can consume it without changing.

**Nothing in `src/`, `index.html`, `data/` or `scripts/` is touched.** `bun run check` staying clean is the proof, and it's in the verification list below for that reason.

## Running it

```bash
docker compose up -d                                   # Convex, ports 3210 / 6791
docker compose exec backend ./generate_admin_key.sh    # prints the admin key
```

Into `.env.local` (gitignored), alongside the Telegram credentials:

```
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
CONVEX_SELF_HOSTED_ADMIN_KEY=<what that command printed>
TELEGRAM_API_ID=…            # my.telegram.org → API development tools
TELEGRAM_API_HASH=…
OPENAI_API_KEY=…             # or AGENT_BASE_URL/AGENT_API_KEY for Hermes
```

```bash
bun run convex:dev     # generates convex/_generated, pushes the schema
bun run tg:spike       # one-time login: phone number + code. Needs a terminal.
bun run bridge         # publishes chats, backfills history, listens
```

`bun run tg:check` validates the Telegram credentials server-side without spending a login code.

## The contract

Four reactive queries. Subscribe with the vanilla client — no React, which suits a renderer that swaps `innerHTML`:

```ts
import { ConvexClient } from "convex/browser";
const client = new ConvexClient(CONVEX_URL);
client.onUpdate(api.threads.list, {}, (threads) => { rebuild(threads); render(); });
```

| query | returns |
|---|---|
| `threads.list` | **`SeedThread[]`** — the exact `data/types.ts` shape. Windowed to 120 days. No reshaping needed. |
| `threads.ideas` | agent recommendations shaped like `Idea` (`src/copy.ts:33`); every `cites` entry already passed the gate |
| `threads.rejections` | how often the agent fabricated a citation, by reason |
| `chats.recent` | picker rows — `isBot`, `isGroup`, `spanDays`, `scorable`, `reason` |
| `chats.pairing` | connection state; `qr` is a PNG data URL when the QR path is used |
| `chats.tracked` | promoted clients with message counts |

Mutations: `ingest.pickClients({sourceIds})`, `ingest.upsertChats`, `ingest.ingestBatch`, `ingest.setPairing`.

## Three things the frontend has to change

1. **`ClientKey` widens to `string`.** `data/types.ts:22` is the union `"A"|"B"|"C"|"D"`; live keys are assigned in pick order and go past D. Everything keyed by it (`Record<ClientKey, …>` in `copy.ts`) becomes partial under `noUncheckedIndexedAccess` — route reads through an `ideasFor(key)` helper returning `[]`.
2. **The clock goes live.** `data/clock.ts` `NOW` is frozen at 2026-08-17. Exported `let` + a `setNow()` works without touching call sites — ES live bindings mean importers see the reassignment.
3. **`src/copy.ts` has no authored copy for live clients.** `threads.ideas` fills it once the agent runs; before that the honest render is the existing hatch idiom, not an empty list.

**Pairing is not a QR by default.** Telegram auth is phone number → code → optional 2FA password. GramJS does expose `signInUserWithQrCode` (present in v2.26.22), so the QR path can be restored — but test it before building a screen around it.

## Design notes worth knowing

**`externalId` is minted in the database, never in the bridge.** It's the citation key the whole UI points at, so it must be unique, stable and never reused. Minting needs read-assign-write on a counter, which is only safe inside a transaction — and Convex mutations are transactional. Ingest is idempotent via `by_client_source`, so re-running a full backfill inserts nothing and, critically, **burns no ids**.

**Ids are not chronological.** Backfill can deliver older messages after newer ones. Nothing reads them as ordered — `data/threads/index.ts:21` checks the *array* is chronological, not the ids.

**Text only, never a placeholder.** Stickers, calls and captionless media are dropped rather than stored as `"[image]"`. The gate matches quotes against message text; a synthetic string is a quote surface no human wrote, and a model will eventually quote it.

**Batches are capped at 200.** Convex mutations get one second of user code and a history pull returns thousands of messages. The bridge chunks; `ingestBatch` throws if it doesn't.

**The bridge exists only because Convex can't hold a socket.** Node actions time out at 10 minutes. Everything else — scoring, the agent, citation minting — lives in Convex on purpose.

## The verbatim gate, and what it does not do

`convex/verbatim.ts` mirrors `findVerbatim` at `src/ledger.ts:50`: whitespace normalised, **every other character must match, including case**. It's reimplemented rather than imported so the backend doesn't reach across into frontend files. One deliberate divergence: empty quotes are rejected, because `"anything".includes("")` is `true` and that's the cheapest way for a model to manufacture a citation.

**It proves the quote is real. It does not prove the quote supports the claim.** Measured directly: asked a question a thread couldn't answer, `gpt-4o-mini` answered anyway — *"the client's stated timeline is indefinite"* — citing a real, exactly-quoted message that says nothing of the kind. It passed cleanly. `gpt-5.6-terra` declined the same question.

So the gate is a floor, not a guarantee. `bridge/agent/verbatim.test.ts` asserts this limitation explicitly — if that test ever fails, the gate has grown judgement it was never designed to have and these comments need rewriting.

## Verification

```bash
bun run check          # frontend — MUST stay clean; proves the boundary held
bun run check:backend  # bridge typecheck
bun test bridge/       # 15 gate tests
bun run verify:seed && bun run verify:ui   # seed path still intact
```

Then, against a running stack: restart the bridge and confirm the row count in the dashboard doesn't move and no `externalId` is reused. That's the idempotency property everything else rests on.

## Known unknowns

- **Chat id format across `listChats` and `onMessage` is unverified.** `listChats` uses the dialog id, live events use `message.chatId`. They should agree; group and channel ids have sign conventions that may not. First thing to check once Convex is up.
- **This account has no usable client chats.** Profiling found 0: three of five DMs are bots, and the deepest human DM spans 96 days with no text in the window. Ingest can be proven on this data; the decay model cannot. Demo the dashboard on the seed threads.
