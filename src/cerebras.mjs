// Thin, dependency-free client for the Cerebras Inference API.
//
// Cerebras exposes an OpenAI-compatible Chat Completions endpoint, so this is a
// single fetch wrapper that adds: per-request wall-clock timing, structured
// output (strict JSON schema) support, multimodal image inputs, an abort-based
// timeout, and an automatic fallback hook so a demo never breaks on a cold
// network path. The same client is used by the HTTP server and the CLI runner.

const TIMING_KEYS = [
  "total_ms",
  "total_latency_ms",
  "latency_ms",
  "total_time_ms",
  "total_time",
  "server_time",
  "completion_time"
];

export function createCerebrasClient({ apiKey, apiBase, model, fetchImpl = fetch } = {}) {
  const base = (apiBase || "https://api.cerebras.ai/v1").replace(/\/$/, "");
  const hasKey = Boolean(apiKey);

  async function chat({
    messages,
    schema,
    schemaName = "response",
    temperature = 0.15,
    maxTokens = 360,
    reasoningEffort = "none",
    timeoutMs = 8000
  }) {
    if (!hasKey) {
      const error = new Error("CEREBRAS_API_KEY is not set.");
      error.code = "NO_API_KEY";
      throw error;
    }

    const requestBody = {
      model,
      messages,
      temperature,
      max_completion_tokens: maxTokens,
      reasoning_effort: reasoningEffort
    };

    if (schema) {
      requestBody.response_format = {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema }
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();

    try {
      const upstream = await fetchImpl(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      const raw = await upstream.text();
      if (!upstream.ok) {
        throw new Error(`Cerebras API returned ${upstream.status}: ${raw.slice(0, 300)}`);
      }

      const data = JSON.parse(raw);
      const content = data.choices?.[0]?.message?.content ?? "";
      const elapsedMs = Math.round(performance.now() - startedAt);
      const measuredMs = extractTimingMs(data.time_info) || elapsedMs;

      return {
        source: "cerebras",
        model,
        content,
        parsed: schema ? safeParse(content) : undefined,
        timeInfo: data.time_info || { total_ms: measuredMs },
        usage: data.usage || {},
        latencyMs: measuredMs,
        elapsedMs
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { chat, hasKey, model, apiBase: base };
}

export function extractTimingMs(timeInfo) {
  if (!timeInfo || typeof timeInfo !== "object") return 0;
  for (const key of TIMING_KEYS) {
    const value = Number(timeInfo[key]);
    if (Number.isFinite(value) && value > 0) {
      // Cerebras reports seconds for some keys; normalize sub-100 values to ms.
      return value < 100 ? Math.round(value * 1000) : Math.round(value);
    }
  }
  return 0;
}

function safeParse(content) {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

// Build an OpenAI-style multimodal user message. A base64 data URI (or hosted
// image URL) is appended as an image_url part so Gemma 4 31B can read it.
export function buildUserContent(text, imageDataUri) {
  if (typeof imageDataUri === "string" && /^(data:image\/|https?:\/\/)/.test(imageDataUri)) {
    return [
      { type: "text", text },
      { type: "image_url", image_url: { url: imageDataUri } }
    ];
  }
  return text;
}

export function redactApiKey(message, apiKey) {
  const text = message instanceof Error ? message.message : String(message);
  return apiKey ? text.split(apiKey).join("[redacted]") : text;
}
