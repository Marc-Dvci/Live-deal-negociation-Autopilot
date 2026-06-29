import http from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCerebrasClient, redactApiKey } from "./src/cerebras.mjs";
import { runAgentCard, runDealRoom, normalizeCard } from "./src/agents.mjs";
import { computeDealEconomics } from "./src/economics.mjs";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const env = await loadEnv(path.join(rootDir, ".env"));
const model = env.CEREBRAS_MODEL || process.env.CEREBRAS_MODEL || "gemma-4-31b";
const apiKey = env.CEREBRAS_API_KEY || process.env.CEREBRAS_API_KEY || "";
const apiBase = env.CEREBRAS_API_BASE || process.env.CEREBRAS_API_BASE || "https://api.cerebras.ai/v1";
const demoData = JSON.parse(await readFile(path.join(rootDir, "data", "deal-room-demo.json"), "utf8"));

// Enrich the demo context once so the live agent path gets grounded economics
// and document text (the recorded fallback cards are unaffected).
demoData.context.economics = computeDealEconomics(demoData.economics || {});
if (!Array.isArray(demoData.context.documents)) {
  demoData.context.documents = (demoData.documents || []).map((d) => ({ title: d.title, body: d.summary }));
}

// Load the bundled contract redline as a base64 data URI so the live legal agent
// always has a real raster image to read — even when the caller (a curl request,
// or a browser whose <img> src isn't a data URI) doesn't supply one.
const demoRedlineDataUri = await loadRedline(path.join(rootDir, "assets", "redline.png"));

const client = createCerebrasClient({ apiKey, apiBase, model });

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".ico", "image/x-icon"]
]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, model, live: client.hasKey, api_base: apiBase });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/cerebras") {
      await handleCerebrasCard(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/deal-room") {
      await handleDealRoom(req, res);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    await serveStatic(url.pathname, req, res);
  } catch (error) {
    sendJson(res, 500, { error: "Server error", detail: redactApiKey(error, apiKey) });
  }
});

await listenOnAvailablePort(server);

// Backward-compatible single-card endpoint used by the recorded frontend.
// Live: runs the specialist + synthesizer pipeline. Fallback (no key / failure):
// returns the deterministic demo card so the app reproduces the recording.
async function handleCerebrasCard(req, res) {
  const body = await readJson(req);
  const cardType = typeof body.cardType === "string" ? body.cardType : "objection";
  const fallback = normalizeCard(
    demoData.fallbackCards?.[cardType] || demoData.fallbackCards?.objection,
    { ...DEFAULT_FALLBACK }
  );

  if (!client.hasKey) {
    sendJson(res, 200, {
      source: "cache",
      reason: "CEREBRAS_API_KEY is not set. Using deterministic recording fallback.",
      model,
      card: { ...fallback, latency_ms: fallback.latency_ms || 620 },
      time_info: { simulated: true, total_ms: fallback.latency_ms || 620 },
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });
    return;
  }

  // For the multimodal legal card, guarantee a real raster image: honor a
  // caller-supplied PNG/JPEG data URI, otherwise fall back to the bundled redline.
  const imageDataUri =
    cardType === "legal"
      ? rasterDataUri(body.imageDataUri) || demoRedlineDataUri
      : body.imageDataUri || "";

  try {
    const result = await runAgentCard(
      cardType,
      { ...body, imageDataUri, context: body.context || demoData.context },
      { client }
    );
    if (result.source !== "cerebras") {
      result.card = { ...fallback, latency_ms: result.card?.latency_ms || fallback.latency_ms || 620 };
    }
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 200, {
      source: "cache",
      reason: `Live call failed; using deterministic recording fallback. ${redactApiKey(error, apiKey)}`,
      model,
      card: { ...fallback, latency_ms: fallback.latency_ms || 620 },
      time_info: { simulated: true },
      usage: {}
    });
  }
}

// Full multi-agent pipeline: parallel specialists -> synthesizer. Returns the
// final card, every specialist finding, and a parallel-vs-serial timing report.
async function handleDealRoom(req, res) {
  const body = await readJson(req);
  const input = {
    context: body.context || demoData.context,
    transcript: body.transcript || [],
    currentLine: body.currentLine || "",
    imageDataUri: body.imageDataUri || ""
  };
  try {
    const result = await runDealRoom(input, { client });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 200, {
      source: "cache",
      reason: `Pipeline failed; using deterministic fallback. ${redactApiKey(error, apiKey)}`,
      model,
      card: { ...DEFAULT_FALLBACK }
    });
  }
}

const DEFAULT_FALLBACK = {
  urgency: "high",
  diagnosis: "Fallback card.",
  recommended_line: "Pause and ask one clarifying question before making a concession.",
  do_not_say: "I can discount that.",
  business_impact: "Protects margin while the team diagnoses the actual blocker.",
  evidence: ["Default safety fallback"],
  latency_ms: 620
};

// Only data URIs for raster images Gemma vision can read are accepted from the
// caller; anything else (empty, an SVG, or an unreachable localhost URL) is
// rejected so the server can substitute the bundled redline instead.
function rasterDataUri(value) {
  return typeof value === "string" && /^data:image\/(png|jpe?g|webp);base64,/i.test(value) ? value : "";
}

async function loadRedline(filePath) {
  try {
    const buf = await readFile(filePath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

async function serveStatic(pathname, req, res) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const relative = decodeURIComponent(requestedPath).replace(/^\/+/, "");
  const filePath = path.normalize(path.join(rootDir, relative));

  if (!filePath.startsWith(rootDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (!fileStat.isFile()) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": mimeTypes.get(ext) || "application/octet-stream",
    "cache-control": "no-store"
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

async function loadEnv(filePath) {
  const loaded = {};
  try {
    const content = await readFile(filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const equalsIndex = line.indexOf("=");
      if (equalsIndex === -1) continue;
      const key = line.slice(0, equalsIndex).trim();
      const value = line.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, "");
      loaded[key] = value;
    }
  } catch {
    return loaded;
  }
  return loaded;
}

async function listenOnAvailablePort(serverInstance) {
  const preferred = Number(process.env.PORT || env.PORT || 5173);
  const ports = [...new Set([preferred, 5174, 5175, 3000, 8080])];
  // Bind to loopback by default so the local recording stays private. In a
  // container set HOST=0.0.0.0 so the mapped port is reachable from the host.
  const host = process.env.HOST || env.HOST || "127.0.0.1";
  const displayHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;

  for (const port of ports) {
    const ok = await new Promise((resolve) => {
      const onError = (error) => {
        serverInstance.off("listening", onListening);
        resolve(error.code === "EADDRINUSE" ? false : Promise.reject(error));
      };
      const onListening = () => {
        serverInstance.off("error", onError);
        resolve(true);
      };
      serverInstance.once("error", onError);
      serverInstance.once("listening", onListening);
      serverInstance.listen(port, host);
    });

    if (ok === true) {
      const mode = client.hasKey ? "live Cerebras" : "deterministic fallback (no API key)";
      console.log(`Real-Time Deal Room running at http://${displayHost}:${port}  [${mode}]`);
      return;
    }
  }

  throw new Error("No available local port found.");
}
