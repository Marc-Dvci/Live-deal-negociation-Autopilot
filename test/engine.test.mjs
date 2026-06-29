import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createCerebrasClient,
  buildUserContent,
  extractTimingMs,
  redactApiKey
} from "../src/cerebras.mjs";
import {
  runDealRoom,
  runAgentCard,
  normalizeCard,
  normalizeInput,
  cardSchema
} from "../src/agents.mjs";

const DEAL_INPUT = {
  context: {
    account: "Northstar Retail",
    deal: "$1.2M annual SaaS renewal",
    sellerGoal: "Protect margin and renewal terms.",
    buyerStakeholders: ["VP Procurement", "Security Lead"],
    commercialPolicy: { discountFloor: "8%" },
    legalPolicy: { redFlag: "remove uplift" }
  },
  transcript: [{ speaker: "Marina Vale", text: "Procurement wants 18% off." }],
  currentLine: "Procurement wants 18% off.",
  imageDataUri: ""
};

// A fake Cerebras endpoint that returns schema-appropriate JSON. Routes on the
// json_schema name set by each agent so the orchestrator gets sensible output.
function mockFetch(overrides = {}) {
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const name = body.response_format?.json_schema?.name;
    const payloads = {
      objection_finding: {
        hidden_objection: "Rollout risk, not price.",
        is_price_real: false,
        confidence: "high",
        signals: ["security tickets"]
      },
      pricing_play: {
        recommended_concession: "Quarterly terms + credit.",
        avoid_move: "18% discount.",
        margin_note: "Protects margin.",
        max_safe_discount_pct: 8
      },
      legal_finding: {
        risk_level: "high",
        redline_finding: "Uplift removed.",
        safe_counter: "Cap at 5%."
      },
      deal_room_card: {
        urgency: "critical",
        diagnosis: "Price is a proxy for rollout risk.",
        recommended_line: "Ask about Q3 before discussing price.",
        do_not_say: "I can discount.",
        business_impact: "Protects $140k.",
        evidence: ["security tickets", "Q3 launch"],
        latency_ms: 123
      },
      ...overrides
    };
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(payloads[name]) } }],
          time_info: { total_ms: 42 },
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
        })
    };
  };
}

function liveClient(overrides) {
  return createCerebrasClient({
    apiKey: "test-key",
    model: "gemma-4-31b",
    fetchImpl: mockFetch(overrides)
  });
}

test("cerebras client refuses without an API key", async () => {
  const client = createCerebrasClient({ model: "gemma-4-31b" });
  assert.equal(client.hasKey, false);
  await assert.rejects(() => client.chat({ messages: [] }), /CEREBRAS_API_KEY/);
});

test("extractTimingMs normalizes seconds and milliseconds", () => {
  assert.equal(extractTimingMs({ total_ms: 350 }), 350);
  assert.equal(extractTimingMs({ total_time: 0.42 }), 420); // seconds -> ms
  assert.equal(extractTimingMs(null), 0);
  assert.equal(extractTimingMs({}), 0);
});

test("buildUserContent attaches image parts only for valid URIs", () => {
  assert.equal(typeof buildUserContent("hi", ""), "string");
  const multimodal = buildUserContent("hi", "data:image/png;base64,AAAA");
  assert.ok(Array.isArray(multimodal));
  assert.equal(multimodal[1].type, "image_url");
  assert.equal(multimodal[1].image_url.url, "data:image/png;base64,AAAA");
});

test("redactApiKey hides the key in error text", () => {
  const msg = redactApiKey(new Error("bad key sk-secret-123 used"), "sk-secret-123");
  assert.ok(!msg.includes("sk-secret-123"));
  assert.ok(msg.includes("[redacted]"));
});

test("normalizeCard clamps urgency and fills gaps from fallback", () => {
  const fallback = {
    urgency: "high",
    diagnosis: "d",
    recommended_line: "r",
    do_not_say: "n",
    business_impact: "b",
    evidence: ["e"],
    latency_ms: 620
  };
  const out = normalizeCard({ urgency: "banana", evidence: [] }, fallback);
  assert.equal(out.urgency, "high");
  assert.deepEqual(out.evidence, ["e"]);
  assert.equal(out.recommended_line, "r");
  assert.equal(out.latency_ms, 620);
});

test("normalizeInput derives currentLine from the transcript tail", () => {
  const out = normalizeInput({ transcript: [{ speaker: "x", text: "last line" }] });
  assert.equal(out.currentLine, "last line");
  assert.equal(out.imageDataUri, "");
});

test("runDealRoom falls back fully with no client", async () => {
  const result = await runDealRoom(DEAL_INPUT, {});
  assert.equal(result.source, "cache");
  assert.equal(result.agents.objection.source, "cache");
  assert.ok(result.card.recommended_line.length > 0);
  assert.equal(typeof result.timing.total_ms, "number");
});

test("runDealRoom runs specialists in parallel then synthesizes (live mock)", async () => {
  const result = await runDealRoom(DEAL_INPUT, { client: liveClient() });
  assert.equal(result.source, "cerebras");
  assert.equal(result.agents.objection.source, "cerebras");
  assert.equal(result.agents.pricing.output.max_safe_discount_pct, 8);
  assert.equal(result.agents.legal.output.risk_level, "high");
  assert.equal(result.card.recommended_line, "Ask about Q3 before discussing price.");
  // Parallel wall-clock should not exceed the serial sum of all four calls.
  assert.ok(result.timing.serial_baseline_ms >= result.timing.parallel_ms);
  assert.ok(result.timing.speedup_x >= 1);
  // GPU baseline is grounded in real token counts: 3 specialists + synth at
  // 20 completion tokens each → 80 tokens total, (slowest spec 20 + synth 20)/50 tok/s.
  assert.equal(result.timing.completion_tokens, 80);
  assert.equal(result.timing.gpu_tok_per_s, 50);
  assert.equal(result.timing.gpu_baseline_ms, 800);
  assert.ok(result.timing.gpu_speedup_x >= 1);
});

test("runAgentCard returns the legacy single-card response shape", async () => {
  const result = await runAgentCard("objection", DEAL_INPUT, { client: liveClient() });
  assert.equal(result.source, "cerebras");
  assert.ok(result.card.urgency);
  assert.ok(result.card.recommended_line);
  assert.equal(typeof result.card.latency_ms, "number");
  assert.ok("time_info" in result);
  assert.ok("usage" in result);
});

test("a malformed agent response degrades to that agent's fallback", async () => {
  const badClient = createCerebrasClient({
    apiKey: "test-key",
    model: "gemma-4-31b",
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "not json" })
  });
  const result = await runDealRoom(DEAL_INPUT, { client: badClient });
  // Calls "succeed" but content is unparseable, so each agent uses its fallback.
  assert.ok(result.card.recommended_line.length > 0);
  assert.equal(result.agents.objection.output.is_price_real, false);
});

test("cardSchema is strict and lists every required field", () => {
  assert.equal(cardSchema.additionalProperties, false);
  for (const key of [
    "urgency",
    "diagnosis",
    "recommended_line",
    "do_not_say",
    "business_impact",
    "evidence",
    "latency_ms"
  ]) {
    assert.ok(cardSchema.required.includes(key), `missing required: ${key}`);
  }
});
