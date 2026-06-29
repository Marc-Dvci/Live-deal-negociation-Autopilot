# Architecture

Real-Time Deal Room is a live B2B negotiation autopilot. While a deal call is
happening, a team of specialist agents reads the deal context and the buyer's
latest line, and a synthesizer fuses their findings into a single private
"whisper" the seller can say out loud — fast enough to land inside the
conversational reply window.

## Why latency is the product

Negotiation is a real-time game. The valuable moment is often a ~500 ms window:
a hesitation, a pause after a number, a reaction to a clause. If the assistant
needs 5–20 seconds, the seller has already answered and the moment is gone.
Cerebras' ultra-fast inference is what moves this from "AI prepares me for the
call" to "AI plays the call with me." The product is only possible at that speed.

## Multi-agent pipeline

```
                    deal context + transcript + redline image
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
┌────────────────┐         ┌────────────────┐         ┌────────────────────┐
│ Objection      │         │ Pricing        │         │ Legal redline      │
│ diagnosis      │         │ strategy       │         │ (MULTIMODAL: reads │
│ (text)         │         │ (text)         │         │  the redline image)│
└───────┬────────┘         └───────┬────────┘         └─────────┬──────────┘
        │   run in PARALLEL on Gemma 4 31B / Cerebras           │
        └────────────────────────────┬────────────────────────-┘
                                     ▼
                         ┌────────────────────────┐
                         │ Whisper synthesizer     │
                         │ fuses findings into one │
                         │ actionable seller card  │
                         └────────────┬───────────┘
                                     ▼
                    { urgency, recommended_line, do_not_say,
                      diagnosis, business_impact, evidence }
```

- **Objection diagnosis** — decides whether the stated objection (usually price)
  is the real one, or a proxy for rollout/approval/timing risk.
- **Pricing strategy** — protects margin; prefers non-price concessions and
  respects the discount-approval floor.
- **Legal redline (multimodal)** — reads the contract redline **image** with
  Gemma 4 31B vision and flags clause changes that quietly damage renewal
  economics, then proposes policy-safe counter language.
- **Whisper synthesizer** — combines the three findings into one card with the
  exact sentence the seller should say, plus the line to avoid.

The three diagnostic agents run concurrently (`Promise.all`), so end-to-end
latency is roughly `max(specialists) + synthesizer` rather than the serial sum.
The CLI prints both numbers and the resulting speedup.

## Components

| File | Responsibility |
| --- | --- |
| `src/cerebras.mjs` | OpenAI-compatible Cerebras client: structured outputs (strict JSON schema), multimodal `image_url` inputs, abort-timeout, per-request timing, key redaction. |
| `src/agents.mjs` | Agent definitions (prompts + schemas), `runDealRoom` orchestrator, `runAgentCard` (legacy single-card path), card/input normalization. |
| `src/economics.mjs` | Deterministic deal-economics engine: computes discount cost, margin impact, and approval-floor breach so dollar figures are grounded, not hallucinated. |
| `src/deal-loader.mjs` | Bring-your-own-deal ingestion: turns a folder of plain files (or a JSON file) into the engine's input context. |
| `server.mjs` | Zero-dependency Node HTTP server. Serves the UI and proxies Cerebras so the API key never reaches the browser. |
| `run-agents.mjs` | Terminal runner (`--deal`, `--line`, `--image`) for the full pipeline with a live latency report. |
| `app.js` / `index.html` / `styles.css` | The recorded demo frontend (deterministic 60s autoplay). |
| `data/deal-room-demo.json` | Synthetic deal: context, documents, buyer lines, move table, deterministic fallback cards. |

## HTTP endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | `{ ok, model, live, api_base }`. `live` is true when a key is configured. |
| `POST` | `/api/cerebras` | Single coaching card (`{ cardType }`). Used by the recorded frontend; backward-compatible response shape. |
| `POST` | `/api/deal-room` | Full multi-agent pipeline: final card + every specialist finding + parallel-vs-serial timing. |

## Numeric grounding

LLMs reason well and count badly. `src/economics.mjs` deterministically computes
every dollar figure (discount cost in ARR, gross-margin impact, approval-floor
breach) from the deal's structured `economics` block. That summary is injected
into the pricing and synthesizer prompts with an instruction to reuse the figures
verbatim, so the recommendation is numerically correct by construction.

## Bring your own deal

`src/deal-loader.mjs` ingests a deal from a folder of ordinary files — a
`deal.json` (account, goal, economics, policies), any number of `*.md`/`*.txt`
context documents, a `transcript.txt`, and an optional redline image — or from a
single JSON file in the bundled demo shape. Documents are folded into every
agent prompt (clipped to protect the latency budget), so onboarding a real
negotiation is "drop your files in a folder," not a schema exercise.

## Structured outputs

Every agent call uses Cerebras strict structured outputs
(`response_format: json_schema`, `strict: true`) so the UI never has to parse
free-form text. The final card schema is exported as `cardSchema` and enforced
again on the server and in the browser. `reasoning_effort` is set to `none` for
minimum latency on tactical guidance.

## Safety and resilience

- **Key isolation** — the Cerebras key is read only by the Node proxy; it never
  appears in browser JavaScript or in error payloads (see `redactApiKey`).
- **Deterministic fallback** — with no key, on timeout, or on a malformed
  response, each agent and the synthesizer degrade to a vetted fallback so the
  demo and CLI always produce a usable, on-message card.
- **Synthetic data only** — the bundled deal, client name, portrait, and redline
  are fictional; there is no real customer data in the repo.

## Production path

The mockup becomes a secure meeting sidecar: live transcription feeds the
transcript, CRM / contract repository / pricing policy / security signals feed
the context, screen-share frames and uploaded redlines feed the vision agent,
and approval workflows gate the recommendations. The human stays the negotiator;
the system provides fast, private, auditable guidance.
