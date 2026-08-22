# /// script
# requires-python = ">=3.11"
# dependencies = ["langextract[openai]"]
# ///
"""The emotion pass: client messages in, grounded emotion spans out.

    bun run emotion            every tracked client
    bun run emotion E          just Max

Runs LangExtract (github.com/google/langextract) over each client's side of
the thread and writes what it finds to Convex. Python, because LangExtract is
Python — so this is a sidecar like the Telegram bridge, run through `bun run`
so .env.local reaches it, via `uv run` so its dependencies never touch the
Bun toolchain.

Why LangExtract rather than another prompt in convex/agent.ts: it grounds.
Every extraction comes back with the exact character span of the input it was
read from, and ungrounded extractions are identifiable (char_interval is None)
and dropped here. That is this codebase's own rule — a claim that cannot show
its message is not shown — enforced by the extraction library itself. The
server still re-checks every span against its own copy of the message text
(convex/emotions.ts), because grounding claimed by a client process is a
claim, not a check.

Only the client's messages are read. The dashboard watches how the *client*
feels about the relationship; the advisor's own frustration is not a signal it
scores, and mixing the two would let an exasperated advisor message colour a
healthy client's read.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

import langextract as lx
from langextract.factory import ModelConfig

# ── Environment ─────────────────────────────────────────────────────────────
# Bun loads .env.local for its own process but not for package-script
# children, so this sidecar reads the file itself. Values already in the
# environment win — same behaviour as every dotenv loader.

_ENV_FILE = Path(__file__).resolve().parents[2] / ".env.local"
if _ENV_FILE.is_file():
    for line in _ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, val = line.partition("=")
        os.environ.setdefault(k.strip(), val.split(" #")[0].strip())

# Same resolution order as scripts/convex-url.ts convexUrl(): this process
# WRITES, so a self-hosted deployment wins when one is configured.

CONVEX_URL = (
    os.environ.get("CONVEX_SELF_HOSTED_URL") or os.environ.get("CONVEX_URL") or ""
).rstrip("/")

if not CONVEX_URL:
    sys.exit("No Convex deployment configured — set CONVEX_URL in .env.local.")


def convex(kind: str, path: str, args: dict) -> object:
    req = urllib.request.Request(
        f"{CONVEX_URL}/api/{kind}",
        data=json.dumps({"path": path, "args": args, "format": "json"}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        body = json.load(res)
    if body.get("status") != "success":
        sys.exit(f"Convex {path} failed: {body.get('errorMessage', body)}")
    return body["value"]


# ── The extraction task ─────────────────────────────────────────────────────
# Labels are the model's own words, not an enum: "curt" and "disengaged" are
# different facts about a client and flattening them to "negative" would
# discard the distinction. The gate downstream cares about the span, not the
# vocabulary.

PROMPT = """\
Extract two things from the client's messages, always as exact text spans —
never paraphrase extraction_text.

1. emotion — spans expressing the client's emotional state. Attributes:
   label (e.g. frustrated, anxious, appreciative, trusting, curt, disengaged,
   apologetic, enthusiastic) and intensity (low, medium or high). Only spans
   that genuinely carry emotion; plain factual sentences are not emotions.

2. key_point — spans where the client states a fact an advisor would need to
   re-find before replying: a budget or amount, a goal, a product they asked
   about, a constraint or refusal, a deadline, an instruction, a life event.
   Attributes: kind (budget, goal, product, constraint, deadline, instruction,
   life_event, question) and point (the fact restated in at most ten words).

Do not overlap spans within a class."""

EXAMPLES = [
    lx.data.ExampleData(
        text=(
            "Thanks so much for sorting the medical card out, really appreciate you "
            "chasing it. On the fund switch — honestly I'm a bit nervous about "
            "moving everything at once."
        ),
        extractions=[
            lx.data.Extraction(
                extraction_class="emotion",
                extraction_text="Thanks so much for sorting the medical card out, really appreciate you chasing it.",
                attributes={"label": "appreciative", "intensity": "medium"},
            ),
            lx.data.Extraction(
                extraction_class="emotion",
                extraction_text="honestly I'm a bit nervous about moving everything at once",
                attributes={"label": "anxious", "intensity": "low"},
            ),
            lx.data.Extraction(
                extraction_class="key_point",
                extraction_text="I'm a bit nervous about moving everything at once",
                attributes={"kind": "constraint", "point": "hesitant to switch all funds at once"},
            ),
        ],
    ),
    lx.data.ExampleData(
        text=(
            "Can we look at education savings for my daughter? She starts uni in "
            "2029 and I can put aside maybe RM800 a month."
        ),
        extractions=[
            lx.data.Extraction(
                extraction_class="key_point",
                extraction_text="education savings for my daughter",
                attributes={"kind": "goal", "point": "education savings for daughter"},
            ),
            lx.data.Extraction(
                extraction_class="key_point",
                extraction_text="She starts uni in 2029",
                attributes={"kind": "deadline", "point": "daughter starts university 2029"},
            ),
            lx.data.Extraction(
                extraction_class="key_point",
                extraction_text="I can put aside maybe RM800 a month",
                attributes={"kind": "budget", "point": "RM800/month available"},
            ),
        ],
    ),
    lx.data.ExampleData(
        text=(
            "I asked about this twice already. If it's not possible just say so.\n"
            "Fine.\n"
            "Ok noted."
        ),
        extractions=[
            lx.data.Extraction(
                extraction_class="emotion",
                extraction_text="I asked about this twice already. If it's not possible just say so.",
                attributes={"label": "frustrated", "intensity": "high"},
            ),
            lx.data.Extraction(
                extraction_class="emotion",
                extraction_text="Fine.",
                attributes={"label": "curt", "intensity": "medium"},
            ),
        ],
    ),
]

MODEL_ID = os.environ.get("AGENT_MODEL", "gpt-4o")
API_KEY = os.environ.get("AGENT_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
BASE_URL = (os.environ.get("AGENT_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
CONFIG = ModelConfig(
    model_id=MODEL_ID,
    provider="OpenAILanguageModel",
    provider_kwargs={"api_key": API_KEY, "base_url": BASE_URL},
)


def spans_for(messages: list[dict]) -> tuple[list[dict], list[dict]]:
    """One LangExtract pass over a client's messages, mapped back to ids.

    The document is the client's messages joined raw — no id prefixes, no
    speaker tags. Anything synthetic in the text can end up inside a grounded
    span, and a span that includes "[E-010] client:" is a quote the server
    gate will (correctly) refuse. The mapping back to messages is positional:
    each message owns a character range of the document, and a span cites the
    message whose range contains it. Spans that straddle two messages cite
    neither and are dropped.
    """
    client_msgs = [m for m in messages if m["from"] == "client"]
    if not client_msgs:
        return [], []

    ranges: list[tuple[int, int, str]] = []
    parts: list[str] = []
    pos = 0
    for m in client_msgs:
        text = m["text"]
        ranges.append((pos, pos + len(text), m["externalId"]))
        parts.append(text)
        pos += len(text) + 2  # the "\n\n" joiner below

    result = lx.extract(
        text_or_documents="\n\n".join(parts),
        prompt_description=PROMPT,
        examples=EXAMPLES,
        config=CONFIG,
    )

    rows: list[dict] = []
    points: list[dict] = []
    for ex in result.extractions or []:
        if ex.char_interval is None:
            continue  # ungrounded — LangExtract could not find the span
        attrs = ex.attributes or {}
        start = ex.char_interval.start_pos
        end = ex.char_interval.end_pos
        source = next((r[2] for r in ranges if r[0] <= start and end <= r[1]), None)
        if source is None:
            continue  # straddles a message boundary; cannot cite one message

        if ex.extraction_class == "key_point":
            points.append({
                "sourceId": source,
                "quote": ex.extraction_text,
                "kind": str(attrs.get("kind", "")).lower().replace(" ", "_") or "note",
                "point": str(attrs.get("point", "")).strip() or ex.extraction_text[:60],
            })
            continue

        intensity = str(attrs.get("intensity", "medium")).lower()
        if intensity not in ("low", "medium", "high"):
            intensity = "medium"
        rows.append({
            "sourceId": source,
            "quote": ex.extraction_text,
            "label": str(attrs.get("label", "")).lower() or "unlabelled",
            "intensity": intensity,
        })
    return rows, points


DIGEST_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["feel", "want", "cites"],
    "properties": {
        "feel": {"type": "string", "description": "One sentence: how the client currently feels, weighted to their most recent messages."},
        "want": {"type": "string", "description": "One sentence: what the client wants from their advisor right now."},
        "cites": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Message ids (e.g. E-008) of the spans these sentences rest on. Only ids present in the input.",
        },
    },
}


def digest_for(name: str, rows: list[dict], points: list[dict]) -> dict | None:
    """One reading of the client, from the grounded spans and nothing else.

    A second, plain chat call rather than more LangExtract: this is synthesis,
    not extraction — there is no span for "overall". It sees only spans that
    were grounded above, must cite the ids it drew from, and the server then
    refuses the whole digest if any cite names a span the gate rejected. The
    same one-call shape as convex/agent.ts, down to the strict schema.
    """
    if not rows and not points:
        return None

    lines = [f"[{r['sourceId']}] emotion/{r['label']} ({r['intensity']}): \"{r['quote']}\"" for r in rows]
    lines += [f"[{p['sourceId']}] {p['kind']}: {p['point']} — \"{p['quote']}\"" for p in points]

    body = json.dumps({
        "model": MODEL_ID,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You summarise a financial advisor's client from extracted, quoted spans "
                    "of that client's own messages. Write two sentences: how the client feels, "
                    "and what the client wants from the advisor. Weight recent spans over old "
                    "ones — the ids are in chronological order. Plain words, no hedging "
                    "boilerplate. Cite only ids from the input, and only in the cites field — "
                    "never write ids inside the sentences themselves."
                ),
            },
            {"role": "user", "content": f"Client: {name}\n\n" + "\n".join(lines)},
        ],
        "response_format": {"type": "json_schema", "json_schema": {"name": "digest", "strict": True, "schema": DIGEST_SCHEMA}},
    }).encode()

    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        out = json.load(res)
    raw = out.get("choices", [{}])[0].get("message", {}).get("content", "")
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        print(f"[emotion]   digest for {name} was not JSON; skipped")
        return None

    # Belt here, braces on the server: drop ids not in this run's spans.
    known = {r["sourceId"] for r in rows} | {p["sourceId"] for p in points}
    cites = [c for c in d.get("cites", []) if c in known]
    if not cites:
        return None
    return {"feel": d.get("feel", ""), "want": d.get("want", ""), "cites": cites}


def main() -> None:
    only = {k.upper() for k in sys.argv[1:]}
    threads = convex("query", "threads:list", {})

    for t in threads:
        if only and t["key"] not in only:
            continue
        rows, points = spans_for(t["messages"])
        if not rows and not points:
            print(f"[emotion] {t['key']} · {t['clientName']}: nothing extractable")
            continue
        digest = digest_for(t["clientName"], rows, points)
        res = convex("mutation", "emotions:record", {
            "key": t["key"],
            "model": MODEL_ID,
            "rows": rows,
            "points": points,
            **({"digest": digest} if digest else {}),
        })
        print(
            f"[emotion] {t['key']} · {t['clientName']}: "
            f"{res['kept']} emotions, {res.get('points', 0)} key points, "
            f"digest {'stored' if res.get('digest') else 'none'}, "
            f"{res['rejected']} rejected at the gate"
        )


if __name__ == "__main__":
    main()
