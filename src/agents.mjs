// Real-Time Deal Room — multi-agent negotiation engine.
//
// Four specialist agents run on Gemma 4 31B (Cerebras). Three diagnostic agents
// run in parallel, then a synthesizer fuses their findings into the single
// private "whisper" card the seller can say out loud before the buyer speaks
// again. Each agent is a constrained Gemma call with its own system prompt and
// strict JSON schema; the legal agent is multimodal and reads the redline image.
//
// This module is the brain shared by the HTTP server and the CLI runner.

import { buildUserContent } from "./cerebras.mjs";

// Throughput of a typical GPU-hosted inference provider, tokens/second. Used to
// estimate what the same pipeline would cost on a GPU baseline — the side-by-side
// latency comparison the hackathon recommends. Grounded in real token counts, so
// it is an estimate of a slower provider, not a vanity number. Override with
// BASELINE_TOK_PER_S to model a faster/slower baseline.
export const BASELINE_TOK_PER_S = Number(process.env.BASELINE_TOK_PER_S) || 50;

// ---------------------------------------------------------------------------
// Final whisper card — the schema the UI renders. Kept identical to the
// original demo contract so the recorded frontend keeps working unchanged.
// ---------------------------------------------------------------------------
export const cardSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "urgency",
    "diagnosis",
    "recommended_line",
    "do_not_say",
    "business_impact",
    "evidence",
    "latency_ms"
  ],
  properties: {
    urgency: { type: "string", enum: ["low", "medium", "high", "critical"] },
    diagnosis: { type: "string" },
    recommended_line: { type: "string" },
    do_not_say: { type: "string" },
    business_impact: { type: "string" },
    evidence: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
    latency_ms: { type: "number" }
  }
};

// ---------------------------------------------------------------------------
// Specialist agents. Each has a focused job, schema, and a message builder.
// ---------------------------------------------------------------------------
export const SPECIALISTS = {
  objection: {
    label: "Objection diagnosis",
    schemaName: "objection_finding",
    maxTokens: 280,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["hidden_objection", "is_price_real", "confidence", "signals"],
      properties: {
        hidden_objection: { type: "string" },
        is_price_real: { type: "boolean" },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        signals: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } }
      }
    },
    system:
      "You are the Objection Diagnosis agent in a live B2B negotiation. Decide whether the buyer's stated objection is the real one. Often price is a proxy for rollout risk, approval friction, or timing. Use the stakeholder map and transcript. Return only valid JSON for the schema. Be terse and decisive.",
    buildMessages(input) {
      return [
        { role: "system", content: this.system },
        {
          role: "user",
          content: [
            `Latest buyer line: ${input.currentLine}`,
            "",
            "Stakeholders:",
            (input.context.buyerStakeholders || []).map((s) => `- ${s}`).join("\n"),
            "",
            "Transcript so far:",
            renderTranscript(input.transcript),
            renderDocuments(input.context),
            "",
            "Question: what is the buyer's true underlying objection, and is price the real blocker?"
          ].join("\n")
        }
      ];
    },
    fallback: {
      hidden_objection: "The stated price objection is likely a proxy for delivery, timing, or approval risk.",
      is_price_real: false,
      confidence: "medium",
      signals: [
        "Objection raised before technical or rollout concerns were resolved",
        "Non-commercial stakeholders (security, legal, ops) are in the room",
        "No competing quote was cited"
      ]
    }
  },

  pricing: {
    label: "Pricing strategy",
    schemaName: "pricing_play",
    maxTokens: 280,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["recommended_concession", "avoid_move", "margin_note", "max_safe_discount_pct"],
      properties: {
        recommended_concession: { type: "string" },
        avoid_move: { type: "string" },
        margin_note: { type: "string" },
        max_safe_discount_pct: { type: "number" }
      }
    },
    system:
      "You are the Pricing Strategy agent. Protect margin. Prefer non-price concessions (payment timing, services credits, phased rollout) over discount. Respect the commercial policy floor and never recommend exceeding it without flagging approval. Return only valid JSON for the schema.",
    buildMessages(input) {
      return [
        { role: "system", content: this.system },
        {
          role: "user",
          content: [
            `Latest buyer line: ${input.currentLine}`,
            economicsLine(input.context),
            "",
            "Commercial policy:",
            JSON.stringify(input.context.commercialPolicy || {}, null, 2),
            renderDocuments(input.context),
            "",
            "Task: choose the concession that protects margin while moving the deal forward, and name the move to avoid. Reuse the computed dollar figures above; do not invent numbers."
          ].join("\n")
        }
      ];
    },
    fallback: {
      recommended_concession: "Lead with non-price levers: payment timing, ramped pricing, or a services credit.",
      avoid_move: "Leading with a list-price discount before the real blocker is known.",
      margin_note: "Discounting erodes gross margin directly; structure and timing protect it. Reuse the computed economics figures.",
      max_safe_discount_pct: 10
    }
  },

  legal: {
    label: "Legal redline (vision)",
    schemaName: "legal_finding",
    maxTokens: 280,
    multimodal: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["risk_level", "redline_finding", "safe_counter"],
      properties: {
        risk_level: { type: "string", enum: ["none", "low", "medium", "high", "critical"] },
        redline_finding: { type: "string" },
        safe_counter: { type: "string" }
      }
    },
    system:
      "You are the Legal Redline agent. You can read a contract redline image. Identify clause changes that quietly damage revenue or renewal economics (e.g. removing renewal uplift). Propose policy-safe counter language. Return only valid JSON for the schema.",
    buildMessages(input) {
      const text = [
        "Review the attached contract redline image (if present) and the policy below.",
        "",
        "Legal policy:",
        JSON.stringify(input.context.legalPolicy || {}, null, 2),
        renderDocuments(input.context),
        "",
        "Task: state the risk level, what the redline actually does, and safe counter language. If no image is attached, reason from the policy and documents."
      ].join("\n");
      return [
        { role: "system", content: this.system },
        { role: "user", content: buildUserContent(text, input.imageDataUri) }
      ];
    },
    fallback: {
      risk_level: "medium",
      redline_finding: "Scrutinize any clause that alters renewal uplift, term length, liability, or termination rights.",
      safe_counter: "Counter with capped annual uplift, advance notice, and standard mutual liability and termination terms."
    }
  }
};

// ---------------------------------------------------------------------------
// Synthesizer — fuses specialist findings into the actionable whisper card.
// ---------------------------------------------------------------------------
export const SYNTHESIZER = {
  label: "Whisper synthesizer",
  schemaName: "deal_room_card",
  maxTokens: 360,
  schema: cardSchema,
  system:
    "You are Real-Time Deal Room's lead negotiation strategist. Fuse the specialist findings into ONE private coaching card. The recommended_line must be a single sentence the seller can say out loud right now. Be concise, tactical, and margin-aware. Return only valid JSON for the schema.",
  buildMessages(input, findings) {
    return [
      { role: "system", content: this.system },
      {
        role: "user",
        content: [
          `Deal: ${input.context.deal} with ${input.context.account}.`,
          `Seller goal: ${input.context.sellerGoal}`,
          `Latest buyer line: ${input.currentLine}`,
          economicsLine(input.context),
          "",
          "Objection agent:",
          JSON.stringify(findings.objection, null, 2),
          "",
          "Pricing agent:",
          JSON.stringify(findings.pricing, null, 2),
          "",
          "Legal agent:",
          JSON.stringify(findings.legal, null, 2),
          renderDocuments(input.context),
          "",
          "Produce the next private whisper card for the seller. Use the computed dollar figures verbatim in business_impact; never invent numbers."
        ].join("\n")
      }
    ];
  }
};

// Fallback final card if synthesis is unavailable; lets the demo/CLI run with
// no API key. Mirrors the deterministic objection card the UI already ships.
export const SYNTH_FALLBACK = {
  urgency: "high",
  diagnosis: "The stated price objection is likely a proxy for delivery, timing, or approval risk; concede on structure, not list price.",
  recommended_line:
    "Before we talk discount, what has to be true on delivery and timing for this to be an easy yes? I can protect your cash flow with payment terms and a ramp instead of cutting price.",
  do_not_say: "I can drop the price if that closes it today.",
  business_impact: "Protects gross margin by trading non-price levers for the discount, while surfacing the real blocker so the deal keeps moving.",
  evidence: [
    "Objection raised before the real blocker was resolved",
    "Non-commercial stakeholders are driving concern",
    "Discount likely exceeds the approval floor",
    "Structure and timing protect margin better than price cuts"
  ],
  latency_ms: 620
};

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

// Full multi-agent pipeline: three specialists in parallel, then synthesis.
// Returns the final card plus every specialist output and a timing breakdown
// that contrasts the parallel wall-clock against a serial baseline.
export async function runDealRoom(input, { client } = {}) {
  const normalized = normalizeInput(input);
  const startedAt = performance.now();

  const specialistKeys = ["objection", "pricing", "legal"];
  const results = await Promise.all(
    specialistKeys.map((key) => runSpecialist(key, normalized, client))
  );
  const parallelMs = Math.round(performance.now() - startedAt);

  const findings = {};
  let anyLive = false;
  for (let i = 0; i < specialistKeys.length; i += 1) {
    findings[specialistKeys[i]] = results[i];
    if (results[i].source === "cerebras") anyLive = true;
  }

  const synthStart = performance.now();
  const synth = await runSynthesizer(normalized, findings, client);
  const synthMs = Math.round(performance.now() - synthStart);
  if (synth.source === "cerebras") anyLive = true;

  const totalMs = Math.round(performance.now() - startedAt);
  const serialBaselineMs =
    results.reduce((sum, r) => sum + (r.latencyMs || 0), 0) + (synth.latencyMs || 0);

  // GPU-baseline estimate: what the SAME parallel pipeline would take on a slow
  // provider, grounded in the actual tokens Gemma generated. Specialists run
  // concurrently, so the floor is the slowest specialist plus the synthesizer.
  const completionTokens = (r) => Number(r.usage?.completion_tokens) || 0;
  const specialistCompletion = results.map(completionTokens);
  const synthCompletion = completionTokens(synth);
  const totalCompletionTokens =
    specialistCompletion.reduce((sum, t) => sum + t, 0) + synthCompletion;
  const slowestSpecialistTokens = specialistCompletion.length ? Math.max(...specialistCompletion) : 0;
  const gpuBaselineMs = Math.round(
    ((slowestSpecialistTokens + synthCompletion) / BASELINE_TOK_PER_S) * 1000
  );

  const card = { ...synth.output, latency_ms: synth.latencyMs || synth.output.latency_ms };

  return {
    source: anyLive ? "cerebras" : "cache",
    model: client?.model,
    card,
    agents: findings,
    synthesizer: synth,
    timing: {
      total_ms: totalMs,
      parallel_ms: parallelMs,
      synth_ms: synthMs,
      serial_baseline_ms: serialBaselineMs,
      speedup_x: serialBaselineMs ? Number((serialBaselineMs / totalMs).toFixed(2)) : 1,
      completion_tokens: totalCompletionTokens,
      gpu_tok_per_s: BASELINE_TOK_PER_S,
      gpu_baseline_ms: gpuBaselineMs,
      gpu_speedup_x: totalMs && gpuBaselineMs ? Number((gpuBaselineMs / totalMs).toFixed(2)) : 1
    }
  };
}

// Backward-compatible single-card path used by the original frontend.
// cardType "legal" runs the multimodal legal specialist then synthesizes a card
// from it; any other type diagnoses the objection then synthesizes. The shape
// returned matches the original /api/cerebras contract.
export async function runAgentCard(cardType, input, { client } = {}) {
  const normalized = normalizeInput(input);
  const startedAt = performance.now();
  const primaryKey = cardType === "legal" ? "legal" : "objection";

  const primary = await runSpecialist(primaryKey, normalized, client);
  const findings = {
    objection: primaryKey === "objection" ? primary : SPECIALISTS.objection.fallback,
    pricing: SPECIALISTS.pricing.fallback,
    legal: primaryKey === "legal" ? primary : SPECIALISTS.legal.fallback
  };

  const synth = await runSynthesizer(normalized, findings, client);
  const totalMs = Math.round(performance.now() - startedAt);
  const live = primary.source === "cerebras" || synth.source === "cerebras";
  const latency = synth.latencyMs || synth.output.latency_ms || totalMs;

  return {
    source: live ? "cerebras" : "cache",
    model: client?.model,
    card: { ...synth.output, latency_ms: latency },
    time_info: synth.timeInfo || { total_ms: latency },
    usage: synth.usage || {},
    elapsed_ms: totalMs,
    reason: live ? undefined : "No live Cerebras response; using deterministic fallback."
  };
}

async function runSpecialist(key, input, client) {
  const spec = SPECIALISTS[key];
  if (!client?.hasKey) {
    return { agent: key, source: "cache", output: spec.fallback, latencyMs: 0 };
  }
  try {
    const res = await client.chat({
      messages: spec.buildMessages(input),
      schema: spec.schema,
      schemaName: spec.schemaName,
      maxTokens: spec.maxTokens
    });
    return {
      agent: key,
      source: "cerebras",
      output: res.parsed && typeof res.parsed === "object" ? res.parsed : spec.fallback,
      latencyMs: res.latencyMs,
      timeInfo: res.timeInfo,
      usage: res.usage
    };
  } catch (error) {
    return { agent: key, source: "cache", output: spec.fallback, latencyMs: 0, error: String(error.message || error) };
  }
}

async function runSynthesizer(input, findings, client) {
  if (!client?.hasKey) {
    return { agent: "synthesizer", source: "cache", output: { ...SYNTH_FALLBACK }, latencyMs: 0 };
  }
  try {
    const res = await client.chat({
      messages: SYNTHESIZER.buildMessages(input, findings),
      schema: SYNTHESIZER.schema,
      schemaName: SYNTHESIZER.schemaName,
      maxTokens: SYNTHESIZER.maxTokens
    });
    return {
      agent: "synthesizer",
      source: "cerebras",
      output: normalizeCard(res.parsed, SYNTH_FALLBACK),
      latencyMs: res.latencyMs,
      timeInfo: res.timeInfo,
      usage: res.usage
    };
  } catch (error) {
    return {
      agent: "synthesizer",
      source: "cache",
      output: { ...SYNTH_FALLBACK },
      latencyMs: 0,
      error: String(error.message || error)
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function normalizeInput(input = {}) {
  const context = input.context && typeof input.context === "object" ? input.context : {};
  const transcript = Array.isArray(input.transcript) ? input.transcript : [];
  const currentLine = input.currentLine || transcript.at(-1)?.text || "";
  return {
    context,
    transcript,
    currentLine,
    imageDataUri: typeof input.imageDataUri === "string" ? input.imageDataUri : ""
  };
}

export function normalizeCard(candidate, fallback) {
  const card = candidate && typeof candidate === "object" ? candidate : fallback;
  const urgency = ["low", "medium", "high", "critical"].includes(card.urgency)
    ? card.urgency
    : fallback.urgency;
  return {
    urgency,
    diagnosis: stringOr(card.diagnosis, fallback.diagnosis),
    recommended_line: stringOr(card.recommended_line, fallback.recommended_line),
    do_not_say: stringOr(card.do_not_say, fallback.do_not_say),
    business_impact: stringOr(card.business_impact, fallback.business_impact),
    evidence:
      Array.isArray(card.evidence) && card.evidence.length
        ? card.evidence.slice(0, 5).map((item) => String(item))
        : fallback.evidence,
    latency_ms: Number.isFinite(Number(card.latency_ms))
      ? Number(card.latency_ms)
      : Number(fallback.latency_ms) || 620
  };
}

function renderTranscript(transcript) {
  if (!transcript.length) return "(none yet)";
  return transcript.map((line) => `${line.speaker}: ${line.text}`).join("\n");
}

// Fold the deal's documents into a prompt block. Bodies are clipped so a large
// document set can't blow the latency budget.
function renderDocuments(context) {
  const docs = Array.isArray(context?.documents) ? context.documents : [];
  if (!docs.length) return "";
  const rendered = docs
    .slice(0, 8)
    .map((doc) => `- ${doc.title || "Document"}: ${String(doc.body || doc.summary || "").slice(0, 700)}`)
    .join("\n");
  return `\nDeal documents:\n${rendered}`;
}

// One-line grounded economics summary the LLM is told to reuse verbatim.
function economicsLine(context) {
  const summary = context?.economics?.summary;
  return summary ? `Computed economics (use these exact figures): ${summary}` : "";
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
