# Real-Time Deal Room

**A live B2B negotiation autopilot.** While a deal call is happening, a team of
specialist AI agents reads the deal context and the buyer's last line and
whispers the seller's exact next move — fast enough to use *before the next
sentence is spoken*. Built for the Cerebras + Google DeepMind Gemma 4 31B
hackathon.

> Powered by **Gemma 4 31B on Cerebras**. Multi-agent, multimodal, and only
> possible because inference is fast enough to land inside the reply window.

---

## The idea in one minute

Enterprises leak value in live negotiations: they discount too early, accept bad
contract redlines, and miss the buyer's *real* objection. The expensive moment
isn't after the call — it's the two-second window before the seller speaks.

Real-Time Deal Room runs four agents on Gemma 4 31B:

1. **Objection diagnosis** — is "price" the real blocker, or a proxy for risk?
2. **Pricing strategy** — protect margin; prefer non-price concessions.
3. **Legal redline (multimodal)** — *reads the contract redline image* and flags
   clauses that quietly damage renewal economics.
4. **Whisper synthesizer** — fuses all three into one line the seller can say now.

The three diagnostic agents run **in parallel**, then the synthesizer fuses
them. At Cerebras speed the whole thing finishes inside the conversational reply
window. At ~50 tok/s the answer arrives after the seller already had to respond —
which is the whole point of the speed comparison in the demo.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

---

## Quick start

No dependencies to install — it's plain Node (>= 18) and a static frontend.

```bash
# 1. Run the multi-agent engine in your terminal (works with no API key)
npm run agents

# 2. Run the web demo
npm start
# open the URL it prints, e.g. http://127.0.0.1:5173
```

### Or run it with Docker (no Node needed)

```bash
docker compose up
# open http://127.0.0.1:5173
```

The image is tiny (zero dependencies, no build step) and runs in deterministic
fallback mode out of the box. To enable live Cerebras inference, put
`CEREBRAS_API_KEY=...` in a `.env` file (compose reads it automatically) before
running, or `docker run -e CEREBRAS_API_KEY=... -p 5173:5173 real-time-deal-room`.

### Enable live Cerebras inference

Copy the example env file and add your key:

```bash
cp .env.example .env
# then edit .env:
#   CEREBRAS_API_KEY=your_key_here
#   CEREBRAS_MODEL=gemma-4-31b
```

The key is read **only** by the local Node proxy and is never exposed to the
browser. With no key, the app and CLI run in deterministic fallback mode so the
project is runnable out of the box.

---

## Try the terminal demo

`npm run agents` runs the full pipeline and prints each specialist's finding, the
synthesized whisper, and a parallel-vs-serial latency report:

```text
  Real-Time Deal Room — multi-agent negotiation engine
  Account: Northstar Retail  |  Deal: $1.2M annual SaaS renewal
  Mode: LIVE Cerebras (gemma-4-31b)

  ▸ Objection diagnosis  [pricing is a proxy for rollout risk]
  ▸ Pricing strategy     [quarterly terms + credit, avoid 18% discount]
  ▸ Legal redline (vision) [renewal uplift removed -> cap at 5%]

  ── Whisper to seller ─────────────────────────────────
  SAY NOW: Before we touch price, what happens if Salesforce misses Q3? ...
  DO NOT : I can take 18% off if that closes it today.
  ──────────────────────────────────────────────────────

  Latency report
    3 specialists in parallel : ...
    total (multi-agent)       : ...
    parallel speedup          : ...x
    GPU baseline (50 tok/s)   : ~... ms for the same ... tokens
    vs Cerebras               : ...x faster
    ✓ Inside the conversational reply window.
```

The **GPU baseline** is grounded in the real token counts Gemma generated: the
same parallel pipeline at 50 tok/s is estimated from
`(slowest specialist + synthesizer) completion tokens ÷ 50`. It's the
side-by-side latency comparison the hackathon recommends — an estimate of a
slower provider, not a vanity number (override with `BASELINE_TOK_PER_S`).

Options:

```bash
node run-agents.mjs                         # full multi-agent pipeline
node run-agents.mjs --card objection        # single-card (legacy) path
node run-agents.mjs --card legal --image path/to/redline.png   # multimodal (point at any redline screenshot)
```

---

## Run it on your own deal

No code changes — drop your documents in a folder and point the engine at it:

```bash
npm run agents -- --deal deals/example-acme-renewal
```

A deal folder can contain any mix of:

| File | Purpose |
| --- | --- |
| `deal.json` | account, deal name, seller goal, **economics**, stakeholders, policies |
| `*.md` / `*.txt` | any number of context docs (CRM notes, pricing policy, security signals, emails) |
| `transcript.txt` | the call so far — `Buyer: …` / `Seller: …` lines |
| `redline.png` / `.jpg` | a contract redline screenshot for the multimodal legal agent |

Override the live moment without editing files:

```bash
npm run agents -- --deal deals/example-acme-renewal --line "Can you do 20% if we sign today?"
```

The money figures the agents cite (discount cost, margin impact, approval-floor
breach) are computed deterministically from the `economics` block — the LLM
reuses them verbatim instead of inventing numbers. See
[`deals/README.md`](deals/README.md) for the full format.

---

## How it's built

State-of-the-art agent patterns, all on Gemma 4 31B / Cerebras:

- **Parallel multi-agent orchestration** — three specialists run concurrently,
  then a synthesizer fuses them; latency is `max(specialists) + synth`, not the
  serial sum (the CLI prints the speedup).
- **Strict structured outputs** — every call uses `response_format: json_schema`
  with `strict: true`, so the UI never parses free-form text.
- **Multimodal vision** — the legal agent reads contract redline *images*
  directly (`image_url` / base64 data URIs). A sample `assets/redline.png` ships
  and is attached automatically by the demo, the bundled deal, and the live
  legal endpoint, so the vision path is always exercised.
- **Deterministic numeric grounding** — a dedicated economics engine
  (`src/economics.mjs`) computes every dollar figure; the LLM does strategy, not
  arithmetic. A discount is treated as a 1:1 gross-margin loss, then netted
  against an expected-value model of the close-probability lift it buys, so the
  headline "net margin risk" is derived, not guessed.
- **Zero-config document ingestion** — heterogeneous files become a structured
  negotiation context with no schema work from the user.
- **Latency-first** — `reasoning_effort: none`, capped tokens, abort-timeouts,
  and per-request timing keep guidance inside the conversational reply window.
- **Safe by default** — server-side key isolation + redaction, and a
  deterministic fallback at every agent so nothing ever hard-fails.

---

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`  | `/api/health` | Model + whether live inference is configured. |
| `POST` | `/api/cerebras` | Single coaching card (`{ cardType }`). Powers the UI. |
| `POST` | `/api/deal-room` | Full multi-agent pipeline + per-agent findings + timing. |

```bash
curl -s http://127.0.0.1:5173/api/health
curl -s -X POST http://127.0.0.1:5173/api/deal-room \
  -H 'content-type: application/json' -d '{}' | node -e \
  'process.stdin.on("data",d=>console.log(JSON.parse(d).card.recommended_line))'
```

---

## Develop

```bash
npm run check         # syntax-check all modules
npm test              # node:test suite (engine + client, no network)
npm run validate:data # validate the demo dataset
```

---

## Recording / demo notes

- The web UI runs a deterministic 60-second autoplay; click **Start autoplay**
  once after recording begins (don't refresh).
- The recorded `Video Project 4.mp4` is **not** committed (it exceeds GitHub's
  100 MB limit) — it's attached on Discord/X per the hackathon rules.
- All deal data is synthetic; the client name, portrait, and redline are
  fictional. See [`VIDEO_SCRIPT.md`](VIDEO_SCRIPT.md) for the demo timeline.

---

## Project layout

```
server.mjs            zero-dep HTTP server + Cerebras proxy + static hosting
run-agents.mjs        terminal runner (--deal / --line) with live latency report
src/cerebras.mjs      Cerebras client (structured outputs, vision, timing)
src/agents.mjs        agent definitions + orchestrator (runDealRoom)
src/economics.mjs     deterministic deal-economics engine (grounds the numbers)
src/deal-loader.mjs   bring-your-own-deal ingestion (folder of files -> context)
deals/                sample deal + your own deal folders
app.js / index.html   recorded demo frontend (60s autoplay)
data/                 synthetic demo dataset + fallback cards
test/                 node:test suite (19 tests)
docs/ARCHITECTURE.md  design + diagrams
Dockerfile            container image (zero-dep, non-root, healthchecked)
docker-compose.yml    one-command run (`docker compose up`)
```

## License

MIT — see [`LICENSE`](LICENSE).
