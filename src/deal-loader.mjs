// Bring-your-own-deal loader.
//
// Point the engine at a folder of plain files and it assembles a negotiation
// context — no schema gymnastics required. A deal folder can contain:
//
//   deal.json        (optional) account/deal/goal + economics + policies + stakeholders
//   *.md / *.txt     any number of context documents (CRM notes, pricing, security…)
//   transcript.txt   (optional) the call so far, lines like "Buyer: …" / "Seller: …"
//   redline.(png|jpg|jpeg|webp)  (optional) a contract redline image for the vision agent
//
// You can also pass a single .json file in the bundled demo shape. Either way
// this returns the exact input object runDealRoom/runAgentCard expect.

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { computeDealEconomics } from "./economics.mjs";

const TEXT_EXT = new Set([".md", ".txt", ".markdown", ".text"]);
const IMAGE_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

export async function loadDeal(targetPath) {
  const resolved = path.resolve(targetPath);
  const info = await stat(resolved);
  return info.isDirectory() ? loadDealFolder(resolved) : loadDealFile(resolved);
}

// A .json file: either the bundled demo shape ({ context, clientLines, … })
// or a flat custom shape ({ account, deal, economics, documents, … }).
async function loadDealFile(filePath) {
  const parsed = JSON.parse(await readFile(filePath, "utf8"));
  const dir = path.dirname(filePath);

  if (parsed.context && typeof parsed.context === "object") {
    const context = { ...parsed.context };
    context.economics = computeDealEconomics(parsed.economics || context.economics || {});
    if (!Array.isArray(context.documents)) {
      context.documents = Array.isArray(parsed.documents)
        ? parsed.documents.map((d) => ({ title: d.title || d.id || "Document", body: d.summary || d.body || "" }))
        : [];
    }
    const transcript = toTranscript(parsed.transcript || demoTranscript(parsed.clientLines, context));
    return finalize({
      context,
      transcript,
      currentLine: parsed.currentLine || transcript.at(-1)?.text || "",
      imageDataUri: await maybeImage(parsed.imagePath ? path.resolve(dir, parsed.imagePath) : "")
    });
  }

  return shapeFlat(parsed, dir, []);
}

async function loadDealFolder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  let dealMeta = {};
  const docs = [];
  let transcriptText = "";
  let imagePath = "";

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    const ext = path.extname(name).toLowerCase();
    const full = path.join(dir, name);

    if (name.toLowerCase() === "deal.json") {
      dealMeta = JSON.parse(await readFile(full, "utf8"));
    } else if (name.toLowerCase() === "transcript.txt") {
      transcriptText = await readFile(full, "utf8");
    } else if (IMAGE_MIME[ext] && !imagePath) {
      imagePath = full;
    } else if (TEXT_EXT.has(ext)) {
      docs.push({ title: titleFromFilename(name), body: (await readFile(full, "utf8")).trim() });
    }
  }

  return shapeFlat(dealMeta, dir, docs, { transcriptText, imagePath });
}

async function shapeFlat(meta, dir, docs, extra = {}) {
  const merged = Array.isArray(meta.documents)
    ? [...docs, ...meta.documents.map((d) => ({ title: d.title || "Document", body: d.body || d.summary || "" }))]
    : docs;

  const context = {
    account: meta.account || "Your account",
    deal: meta.deal || "B2B deal",
    sellerGoal: meta.sellerGoal || "Protect margin and contract terms while moving the deal forward.",
    buyerStakeholders: arr(meta.buyerStakeholders),
    commercialPolicy: meta.commercialPolicy || {},
    legalPolicy: meta.legalPolicy || {},
    documents: merged,
    economics: computeDealEconomics(meta.economics || {})
  };

  const transcriptText = extra.transcriptText || meta.transcript || "";
  const transcript = toTranscript(transcriptText);
  const imageResolved =
    extra.imagePath || (meta.imagePath ? path.resolve(dir, meta.imagePath) : "");

  return finalize({
    context,
    transcript,
    currentLine: meta.currentLine || transcript.at(-1)?.text || "",
    imageDataUri: await maybeImage(imageResolved)
  });
}

function finalize(input) {
  return input;
}

// "Buyer: line" / "Seller: line" text -> [{ speaker, text }]. Lines without a
// speaker prefix are attributed to the buyer (the side we're reading).
export function toTranscript(value) {
  if (Array.isArray(value)) {
    return value
      .map((t) => (typeof t === "string" ? { speaker: "Buyer", text: t } : { speaker: t.speaker || "Buyer", text: t.text || "" }))
      .filter((t) => t.text);
  }
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([A-Za-z .'-]{1,40}?):\s*(.+)$/);
      return match ? { speaker: match[1].trim(), text: match[2].trim() } : { speaker: "Buyer", text: line };
    });
}

function demoTranscript(clientLines, context) {
  if (!Array.isArray(clientLines)) return [];
  const speaker = (context.buyerStakeholders?.[0] || "Buyer").split(":")[0];
  return clientLines.slice(0, 3).map((text) => ({ speaker, text }));
}

async function maybeImage(imagePath) {
  if (!imagePath) return "";
  try {
    const ext = path.extname(imagePath).toLowerCase();
    const mime = IMAGE_MIME[ext] || "image/png";
    const buf = await readFile(imagePath);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

function titleFromFilename(name) {
  return path
    .basename(name, path.extname(name))
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}
