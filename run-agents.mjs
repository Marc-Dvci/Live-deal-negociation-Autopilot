// Real-Time Deal Room — terminal runner.
//
// Runs the full multi-agent negotiation pipeline against Cerebras Gemma 4 31B
// and prints the specialist findings, the synthesized whisper, and a
// parallel-vs-serial latency report. Works with no API key (deterministic
// fallback) so the repo is runnable out of the box.
//
//   node run-agents.mjs                  full multi-agent pipeline
//   node run-agents.mjs --card objection single-card (legacy) path
//   node run-agents.mjs --card legal --image assets/redline.png
//
// Set CEREBRAS_API_KEY (env or .env) to see real Cerebras latency.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCerebrasClient } from "./src/cerebras.mjs";
import { runDealRoom, runAgentCard } from "./src/agents.mjs";
import { loadDeal } from "./src/deal-loader.mjs";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));

const env = await loadEnv(path.join(rootDir, ".env"));
const model = env.CEREBRAS_MODEL || process.env.CEREBRAS_MODEL || "gemma-4-31b";
const apiKey = env.CEREBRAS_API_KEY || process.env.CEREBRAS_API_KEY || "";
const apiBase = env.CEREBRAS_API_BASE || process.env.CEREBRAS_API_BASE || "https://api.cerebras.ai/v1";

const client = createCerebrasClient({ apiKey, apiBase, model });
const c = makeColors();

// Default to the bundled demo deal; --deal points at any folder or .json file.
const dealPath = args.deal || path.join(rootDir, "data", "deal-room-demo.json");
const input = await loadDeal(dealPath);
if (args.image) input.imageDataUri = await loadImageArg(args.image);
if (args.line) {
  input.transcript = [...input.transcript, { speaker: "Buyer", text: args.line }];
  input.currentLine = args.line;
}

console.log("");
console.log(c.bold(c.cyan("  Real-Time Deal Room — multi-agent negotiation engine")));
console.log(c.dim(`  Account: ${input.context.account}  |  Deal: ${input.context.deal}`));
console.log(
  client.hasKey
    ? c.green(`  Mode: LIVE Cerebras (${model})`)
    : c.yellow("  Mode: deterministic fallback (set CEREBRAS_API_KEY for live latency)")
);
if (input.context.economics?.summary) {
  console.log(c.dim(`  Economics: ${input.context.economics.summary}`));
}
const docCount = input.context.documents?.length || 0;
if (docCount) {
  console.log(c.dim(`  Documents: ${docCount} (${input.context.documents.map((d) => d.title).join(", ")})`));
}
if (input.imageDataUri) console.log(c.dim("  Redline image: attached (multimodal vision agent)"));
console.log("");

console.log(c.dim("  Buyer is saying:"));
for (const turn of input.transcript) console.log(c.dim(`    “${turn.text}”`));
if (!input.transcript.length && input.currentLine) console.log(c.dim(`    “${input.currentLine}”`));
console.log("");

if (args.card) {
  await runSingleCard(args.card, input);
} else {
  await runFull(input);
}

async function runFull(dealInput) {
  const result = await runDealRoom(dealInput, { client });

  printAgent("Objection diagnosis", result.agents.objection, (o) => [
    `hidden objection : ${o.hidden_objection}`,
    `price is real    : ${o.is_price_real}  (confidence: ${o.confidence})`,
    `signals          : ${(o.signals || []).join("; ")}`
  ]);
  printAgent("Pricing strategy", result.agents.pricing, (o) => [
    `concession       : ${o.recommended_concession}`,
    `avoid            : ${o.avoid_move}`,
    `margin note      : ${o.margin_note}`,
    `max safe discount: ${o.max_safe_discount_pct}%`
  ]);
  printAgent("Legal redline (vision)", result.agents.legal, (o) => [
    `risk level       : ${o.risk_level}`,
    `finding          : ${o.redline_finding}`,
    `safe counter     : ${o.safe_counter}`
  ]);

  printCard(result.card);
  printTiming(result.timing, result.source);
}

async function runSingleCard(cardType, dealInput) {
  const result = await runAgentCard(cardType, dealInput, { client });
  console.log(c.dim(`  Single-card path: ${cardType}  (source: ${result.source})`));
  printCard(result.card);
  console.log(c.dim(`  card latency: ${result.card.latency_ms} ms  |  wall: ${result.elapsed_ms} ms`));
  console.log("");
}

function printAgent(title, agent, lines) {
  const tag = agent.source === "cerebras" ? c.green(`${agent.latencyMs} ms live`) : c.yellow("fallback");
  console.log(`  ${c.bold(c.blue("▸ " + title))}  ${c.dim("[" + tag + "]")}`);
  for (const line of lines(agent.output)) console.log("    " + c.dim(line));
  // A key is set but this agent fell back — surface why instead of failing silently
  // (e.g. a wrong model id, a 4xx from the endpoint, or a timeout).
  if (client.hasKey && agent.source !== "cerebras" && agent.error) {
    console.log("    " + c.red(`live call fell back: ${agent.error}`));
  }
  console.log("");
}

function printCard(card) {
  console.log(c.bold(c.magenta("  ── Whisper to seller ─────────────────────────────────")));
  console.log("  " + c.bold("URGENCY ") + urgencyColor(card.urgency));
  console.log("  " + c.bold("SAY NOW: ") + c.green(card.recommended_line));
  console.log("  " + c.bold("DO NOT : ") + c.red(card.do_not_say));
  console.log("  " + c.dim("diagnosis: " + card.diagnosis));
  console.log("  " + c.dim("impact   : " + card.business_impact));
  console.log("  " + c.dim("evidence : " + card.evidence.join(" • ")));
  console.log(c.bold(c.magenta("  ──────────────────────────────────────────────────────")));
  console.log("");
}

function printTiming(timing, source) {
  if (source !== "cerebras") {
    console.log(c.yellow("  Timing: fallback mode — set CEREBRAS_API_KEY to measure real Cerebras latency."));
    console.log("");
    return;
  }
  console.log(c.bold("  Latency report"));
  console.log(c.dim(`    3 specialists in parallel : ${timing.parallel_ms} ms`));
  console.log(c.dim(`    synthesis pass            : ${timing.synth_ms} ms`));
  console.log(c.green(`    total (multi-agent)       : ${timing.total_ms} ms`));
  console.log(c.dim(`    same agents run serially  : ${timing.serial_baseline_ms} ms`));
  console.log(c.cyan(`    parallel speedup          : ${timing.speedup_x}x`));
  if (timing.gpu_baseline_ms) {
    console.log(
      c.dim(
        `    GPU baseline (${timing.gpu_tok_per_s} tok/s) : ~${timing.gpu_baseline_ms} ms for the same ${timing.completion_tokens} tokens`
      )
    );
    console.log(c.cyan(`    vs Cerebras               : ${timing.gpu_speedup_x}x faster`));
  }
  const verdict =
    timing.total_ms < 2000
      ? c.green("    ✓ Inside the conversational reply window.")
      : c.yellow("    ! Slower than the reply window on this run.");
  console.log(verdict);
  console.log("");
}

function urgencyColor(urgency) {
  if (urgency === "critical" || urgency === "high") return c.red(urgency.toUpperCase());
  if (urgency === "medium") return c.yellow(urgency.toUpperCase());
  return c.dim(urgency.toUpperCase());
}

async function loadImageArg(imagePath) {
  if (!imagePath) return "";
  try {
    const buf = await readFile(path.resolve(rootDir, imagePath));
    const ext = path.extname(imagePath).slice(1).toLowerCase() || "png";
    const mime = ext === "jpg" ? "jpeg" : ext;
    return `data:image/${mime};base64,${buf.toString("base64")}`;
  } catch (error) {
    console.log(c.yellow(`  (could not read image ${imagePath}: ${error.message})`));
    return "";
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--card") out.card = argv[++i];
    else if (argv[i] === "--image") out.image = argv[++i];
    else if (argv[i] === "--deal") out.deal = argv[++i];
    else if (argv[i] === "--line") out.line = argv[++i];
  }
  return out;
}

async function loadEnv(filePath) {
  const loaded = {};
  try {
    const content = await readFile(filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      loaded[line.slice(0, eq).trim()] = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  } catch {
    return loaded;
  }
  return loaded;
}

function makeColors() {
  const on = process.stdout.isTTY && !process.env.NO_COLOR;
  const wrap = (code) => (s) => (on ? `[${code}m${s}[0m` : String(s));
  return {
    bold: wrap(1),
    dim: wrap(2),
    red: wrap(31),
    green: wrap(32),
    yellow: wrap(33),
    blue: wrap(34),
    magenta: wrap(35),
    cyan: wrap(36)
  };
}
