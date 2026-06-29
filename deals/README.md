# Bring your own deal

Drop your negotiation context here as plain files, then run the engine on it:

```bash
npm run agents -- --deal deals/example-acme-renewal
```

You'll get the same parallel multi-agent analysis the demo uses — objection
diagnosis, pricing strategy, multimodal legal redline review, and a synthesized
"say this now" whisper — grounded in *your* numbers and documents.

## What a deal folder can contain

Everything is optional except providing at least one document or a buyer line.

| File | Purpose |
| --- | --- |
| `deal.json` | Account, deal name, seller goal, **economics**, stakeholders, and policies. |
| `*.md` / `*.txt` | Any number of context documents — CRM notes, pricing policy, security signals, past emails. Each file becomes a labeled document the agents read. |
| `transcript.txt` | The call so far. One line per turn, e.g. `Buyer: ...` / `Seller: ...`. The last buyer line is treated as the current moment. |
| `redline.png` / `.jpg` | A contract redline screenshot. The legal agent reads it with Gemma 4 31B vision. |

## The economics block (grounds the money math)

The dollar figures the agents cite are computed deterministically from this
block, so they're never hallucinated:

```json
{
  "economics": {
    "currency": "USD",
    "arr": 480000,
    "grossMarginPct": 0.78,
    "discountAskedPct": 0.15,
    "discountFloorPct": 0.1,
    "termYears": 2
  }
}
```

Percentages accept either fractions (`0.15`) or whole numbers (`15`).

## Override the buyer's latest line on the fly

```bash
npm run agents -- --deal deals/example-acme-renewal --line "Can you do 20% if we sign today?"
```

See [`example-acme-renewal/`](example-acme-renewal/) for a complete, runnable example.
