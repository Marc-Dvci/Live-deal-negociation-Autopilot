const state = {
  demo: null,
  startedAt: 0,
  pausedAt: 0,
  elapsed: 0,
  playing: false,
  fired: new Set(),
  transcript: [],
  activeAiRequest: null,
  raceStartedAt: 0,
  latestCard: null,
  clientVideoReady: false,
  runId: 0
};

const elements = {};

const agents = [
  ["objection", "Objection"],
  ["pricing", "Pricing"],
  ["legal", "Legal"],
  ["response", "Next line"]
];

const stages = [
  [0, "Ready", "One click starts the 60-second judged demo."],
  [1, "Deal room opens", "Live renewal context loads before the buyer speaks."],
  [5, "Docs scanned", "CRM, pricing, security, and legal redline are in view."],
  [15, "Buyer objects", "Procurement anchors on discount and legal redlines renewal uplift."],
  [24.75, "Cerebras whispers", "Gemma returns a private next move inside the reply window."],
  [27.2, "Seller counters", "The seller protects margin by reframing price as rollout risk."],
  [36.8, "Speed proof", "Cerebras is ready while the 50 tok/s baseline is still drafting."],
  [42.0, "Real blocker", "Security risk, not price, is the buyer's actual concern."],
  [47.6, "Legal catch", "Multimodal redline review flags the renewal uplift risk."],
  [53.6, "Outcome", "Margin preserved, legal risk blocked, close probability up."]
];

const clientVideoPath = "assets/client-call.mp4";

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  state.demo = await fetch("data/deal-room-demo.json").then((response) => response.json());
  renderDocs();
  renderAgents("idle");
  renderMoveTable("baseline");
  const redlineDataUri = buildRedlineImage();
  elements.redlineImage.src = redlineDataUri;
  elements.startButton.addEventListener("click", startAutoplay);
  prepareClientVideo();
  resetDemo(false);
});

function bindElements() {
  [
    "startButton",
    "stageLabel",
    "stageDetail",
    "demoAudio",
    "docList",
    "redlineImage",
    "visionStatus",
    "subtitle",
    "transcript",
    "clientMood",
    "clientVideo",
    "speakerWave",
    "agentRow",
    "aiCard",
    "cardSource",
    "latencyBadge",
    "moveTable",
    "moveStatus",
    "raceStatus",
    "cerebrasProgress",
    "baselineProgress",
    "cerebrasRaceText",
    "baselineRaceText",
    "marginOutcome",
    "legalOutcome",
    "closeOutcome",
    "impactRow"
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function startAutoplay() {
  resetDemo(true);
}

function restartDemo() {
  resetDemo(true);
}

function resetDemo(shouldPlay) {
  state.runId += 1;
  stopDemoAudio();
  state.startedAt = shouldPlay ? performance.now() : 0;
  state.pausedAt = 0;
  state.elapsed = 0;
  state.playing = shouldPlay;
  state.fired = new Set();
  state.transcript = [];
  state.activeAiRequest = null;
  state.raceStartedAt = 0;
  state.latestCard = null;
  document.body.classList.toggle("demo-running", shouldPlay);
  elements.startButton.textContent = "Start autoplay";
  elements.stageLabel.textContent = shouldPlay ? "Deal room opens" : "Ready";
  elements.stageDetail.textContent = shouldPlay
    ? "Live renewal context loads before the buyer speaks."
    : "One click starts the 60-second judged demo.";
  elements.subtitle.textContent = shouldPlay
    ? "The app autolaunches and loads the negotiation room."
    : "Ready. Click Start autoplay once when screen recording begins.";
  elements.clientMood.textContent = "waiting for QBR handoff";
  elements.transcript.innerHTML = "";
  elements.latencyBadge.textContent = "ready";
  elements.visionStatus.textContent = "queued for vision pass";
  elements.raceStatus.textContent = "starts at 38s";
  elements.cerebrasProgress.style.width = "0%";
  elements.baselineProgress.style.width = "0%";
  elements.cerebrasRaceText.textContent = "Actionable card ready inside the reply window.";
  elements.baselineRaceText.textContent = "Waiting for serial agents.";
  elements.marginOutcome.textContent = "$0 protected";
  elements.legalOutcome.textContent = "monitoring";
  elements.closeOutcome.textContent = "61%";
  clearDocHighlights();
  renderAgents("idle");
  renderMoveTable("baseline");
  renderIdleCard();
  stopClientVideo();
  setSpeaker("idle");
  if (shouldPlay) {
    playDemoAudio();
    requestAnimationFrame(tick);
  }
}

function togglePause() {
  state.playing = !state.playing;
  if (state.playing) {
    state.startedAt = performance.now() - state.elapsed * 1000;
    elements.demoAudio.play().catch(() => {});
    requestAnimationFrame(tick);
  } else {
    state.pausedAt = performance.now();
    elements.demoAudio.pause();
  }
}

function tick() {
  if (!state.playing) return;
  state.elapsed = Math.min((performance.now() - state.startedAt) / 1000, 60);
  updateStage();
  runTimeline();
  updateRace();

  if (state.elapsed < 60) {
    requestAnimationFrame(tick);
  } else {
    state.playing = false;
    setSpeaker("idle");
  }
}

function updateStage() {
  let active = stages[0];
  for (const stage of stages) {
    if (state.elapsed >= stage[0]) active = stage;
  }
  elements.stageLabel.textContent = active[1];
  elements.stageDetail.textContent = active[2];
}

function runTimeline() {
  const events = [
    [1.0, "open", () => pulsePanel(".call-panel")],
    [5.0, "docs", showDocs],
    [15.0, "client-video", startClientVideo],
    [15.0, "line1", () => addClientLine(0, "price concern")],
    [19.65, "line2", () => addClientLine(1, "legal pushed a redline")],
    [24.75, "ai-objection", () => requestAICard("objection", false)],
    [27.2, "seller1", () => addSellerLine("Before discounting, what happens if Salesforce misses Q3? I can offer quarterly terms and implementation credit instead.")],
    [36.8, "race", startRace],
    [42.0, "line3", () => addClientLine(2, "security risk exposed")],
    [47.6, "ai-legal", () => requestAICard("legal", true)],
    [47.9, "seller2", () => addSellerLine("We can reduce rollout risk, but not accept that redline. I will send capped uplift language with sixty-day notice.")],
    [53.6, "outcome", showOutcome]
  ];

  for (const [time, key, handler] of events) {
    if (state.elapsed >= time && !state.fired.has(key)) {
      state.fired.add(key);
      handler();
    }
  }
}

function prepareClientVideo() {
  const video = elements.clientVideo;
  if (!video) return;
  fetch(clientVideoPath, { method: "HEAD", cache: "no-store" })
    .then((response) => {
      if (!response.ok) return;
      video.src = clientVideoPath;
      video.load();
    })
    .catch(() => {
      state.clientVideoReady = false;
    });
  video.addEventListener("loadedmetadata", () => {
    state.clientVideoReady = true;
  });
  video.addEventListener("error", () => {
    state.clientVideoReady = false;
    video.closest(".video-frame")?.classList.remove("has-video");
  });
}

function startClientVideo() {
  const video = elements.clientVideo;
  if (!video || !state.clientVideoReady) return;
  video.currentTime = 0;
  video.muted = true;
  video.closest(".video-frame")?.classList.add("has-video");
  video.play().catch(() => {
    video.closest(".video-frame")?.classList.remove("has-video");
  });
}

function stopClientVideo() {
  const video = elements.clientVideo;
  if (!video) return;
  video.pause();
  video.currentTime = 0;
  video.closest(".video-frame")?.classList.remove("has-video");
}

function playDemoAudio() {
  const audio = elements.demoAudio;
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
  audio.playbackRate = 1;
  audio.volume = 1;
  audio.play().catch(() => {
    elements.stageLabel.textContent = "Audio blocked";
    elements.stageDetail.textContent = "Click Start autoplay again to unlock browser audio.";
  });
}

function stopDemoAudio() {
  const audio = elements.demoAudio;
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
}

function setSpeaker(kind) {
  document.body.dataset.speaker = kind || "idle";
}

function renderDocs() {
  elements.docList.innerHTML = state.demo.documents
    .map((doc) => `
      <article class="doc-card ${doc.tone}" data-doc="${doc.id}">
        <h3>${escapeHtml(doc.title)} <span>${escapeHtml(doc.label)}</span></h3>
        <p>${escapeHtml(doc.summary)}</p>
      </article>
    `)
    .join("");
}

function showDocs() {
  pulsePanel(".docs-panel");
  const sequence = ["crm", "pricing", "redline", "security"];
  sequence.forEach((id, index) => {
    setTimeout(() => highlightDoc(id), index * 850);
  });
}

function highlightDoc(id) {
  const card = document.querySelector(`[data-doc="${id}"]`);
  if (!card) return;
  card.classList.add("active", "pulse");
  setTimeout(() => card.classList.remove("pulse"), 850);
}

function clearDocHighlights() {
  document.querySelectorAll(".doc-card").forEach((card) => card.classList.remove("active", "pulse"));
}

function addClientLine(index, mood) {
  const line = state.demo.clientLines[index];
  elements.subtitle.textContent = line;
  elements.clientMood.textContent = mood;
  setSpeaker("client");
  pulsePanel(".call-panel");
  addTranscriptTurn("client", "Marina Vale", line);
  if (index === 1) highlightDoc("redline");
  if (index === 2) highlightDoc("security");
}

function addSellerLine(text) {
  elements.subtitle.textContent = text;
  setSpeaker("seller");
  pulsePanel(".console-panel");
  addTranscriptTurn("seller", "Seller", text);
  renderMoveTable("recommended");
  elements.moveStatus.textContent = "seller follows AI";
}

function addTranscriptTurn(type, speaker, text) {
  state.transcript.push({ speaker, text });
  elements.transcript.querySelectorAll(".turn.latest").forEach((item) => item.classList.remove("latest"));
  const turn = document.createElement("article");
  turn.className = `turn ${type} latest`;
  turn.innerHTML = `<span class="speaker">${escapeHtml(speaker)}</span><p>${escapeHtml(text)}</p>`;
  elements.transcript.appendChild(turn);
  while (elements.transcript.children.length > 2) {
    elements.transcript.removeChild(elements.transcript.firstElementChild);
  }
  elements.transcript.scrollTop = elements.transcript.scrollHeight;
}

async function requestAICard(cardType, includeImage) {
  const runId = state.runId;
  setSpeaker("voiceover");
  pulsePanel(".console-panel");
  renderThinkingCard(cardType);
  renderAgents("running");
  elements.latencyBadge.textContent = "calling Cerebras";
  elements.visionStatus.textContent = includeImage ? "Gemma vision pass running" : "text context running";
  const redlineDataUri = includeImage ? elements.redlineImage.src : "";
  const fallbackDelay = includeImage ? 720 : 560;
  const timeout = includeImage ? 2600 : 2200;

  const payload = {
    cardType,
    currentLine: state.transcript.at(-1)?.text || "",
    transcript: state.transcript,
    context: state.demo.context,
    imageDataUri: redlineDataUri
  };

  try {
    const response = await fetchWithTimeout("/api/cerebras", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }, timeout);
    const result = await response.json();
    await wait(Math.max(0, fallbackDelay - Number(result.card?.latency_ms || 0)));
    if (runId !== state.runId) return;
    showAiResult(cardType, result);
  } catch (error) {
    await wait(fallbackDelay);
    if (runId !== state.runId) return;
    showAiResult(cardType, {
      source: "cache",
      reason: "Browser fallback used to keep recording deterministic.",
      model: "gemma-4-31b",
      card: state.demo.fallbackCards[cardType],
      time_info: { simulated: true, total_ms: fallbackDelay }
    });
  }
}

function renderThinkingCard(cardType) {
  elements.aiCard.className = "ai-card thinking";
  elements.aiCard.innerHTML = `
    <div class="card-topline">
      <span class="urgency">running</span>
      <span>parallel agents racing</span>
    </div>
    <h3>${cardType === "legal" ? "Reading redline image" : "Diagnosing buyer objection"}</h3>
    <div class="quote-line">Generating private whisper...</div>
    <p>Objection, pricing, legal, and next-line agents are running in parallel.</p>
  `;
}

function showAiResult(cardType, result) {
  const card = normalizeCard(result.card, state.demo.fallbackCards[cardType]);
  state.latestCard = card;
  const isLive = result.source === "cerebras";
  const latency = Math.round(Number(card.latency_ms || 620));
  elements.latencyBadge.textContent = `${latency} ms ${isLive ? "live" : "fallback"}`;
  elements.cardSource.textContent = isLive ? "Cerebras live" : "recording fallback";
  elements.visionStatus.textContent = cardType === "legal" ? "redline image analyzed" : "text context analyzed";
  renderAgents("done");
  pulsePanel(".console-panel");
  elements.aiCard.className = `ai-card ${cardType === "legal" ? "legal" : "active"} pulse`;
  elements.aiCard.innerHTML = `
    <div class="card-topline">
      <span class="urgency">${escapeHtml(card.urgency)}</span>
      <span>${isLive ? "live Cerebras timing" : "cached fallback timing"}</span>
    </div>
    <div class="recommendation-block">
      <span>Say now</span>
      <div class="quote-line">${escapeHtml(card.recommended_line)}</div>
    </div>
    <div class="ai-card-grid">
      <section>
        <span>Diagnosis</span>
        <p>${escapeHtml(card.diagnosis)}</p>
      </section>
      <section>
        <span>Business impact</span>
        <p>${escapeHtml(card.business_impact)}</p>
      </section>
    </div>
    <p class="avoid-line">Do not say: ${escapeHtml(card.do_not_say)}</p>
    <div class="evidence-list">${card.evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
  `;
  setTimeout(() => elements.aiCard.classList.remove("pulse"), 850);

  if (cardType === "objection") {
    renderMoveTable("ai");
    elements.marginOutcome.textContent = "$140k discount avoided";
    elements.closeOutcome.textContent = "69%";
    elements.moveStatus.textContent = "AI recommendation live";
  }

  if (cardType === "legal") {
    elements.legalOutcome.textContent = "uplift redline blocked";
    elements.closeOutcome.textContent = "74%";
  }
}

function renderIdleCard() {
  elements.aiCard.className = "ai-card idle";
  elements.aiCard.innerHTML = `
    <div class="card-topline">
      <span class="urgency">ready</span>
      <span id="cardSource">cached fallback armed</span>
    </div>
    <div class="recommendation-block">
      <span>Private whisper</span>
      <div class="quote-line">Waiting for the first buyer signal.</div>
    </div>
    <p>When the buyer objects, the console returns the exact next line before the seller has to respond.</p>
  `;
}

function renderAgents(mode) {
  elements.agentRow.innerHTML = agents
    .map(([id, label], index) => {
      const className = mode === "running" ? "running" : mode === "done" ? "done" : "";
      const status = mode === "running"
        ? `${140 + index * 80} ms`
        : mode === "done"
          ? "complete"
          : "idle";
      return `<div class="agent-chip ${className}" data-agent="${id}"><strong>${label}</strong>${status}</div>`;
    })
    .join("");
}

function renderMoveTable(stage) {
  const rows = state.demo.moves.map((move) => {
    let className = "";
    if ((stage === "ai" || stage === "recommended") && move.recommended) className = "best";
    if ((stage === "ai" || stage === "recommended") && move.bad) className = "bad";
    return `
      <tr class="${className}">
        <td>${escapeHtml(move.move)}</td>
        <td>${escapeHtml(move.close)}</td>
        <td>${escapeHtml(move.margin)}</td>
        <td>${escapeHtml(move.risk)}</td>
      </tr>
    `;
  });
  elements.moveTable.innerHTML = rows.join("");
}

function startRace() {
  state.raceStartedAt = performance.now();
  setSpeaker("voiceover");
  pulsePanel(".speed-race");
  elements.raceStatus.textContent = "reply window open";
  elements.cerebrasProgress.style.width = "100%";
  elements.cerebrasRaceText.textContent = "Ready before the seller answers.";
  elements.baselineRaceText.textContent = "Still drafting after the buyer pauses.";
}

function updateRace() {
  if (!state.raceStartedAt) return;
  const elapsed = (performance.now() - state.raceStartedAt) / 1000;
  const totalBaselineSeconds = 18;
  const progress = Math.min(100, (elapsed / totalBaselineSeconds) * 100);
  elements.baselineProgress.style.width = `${progress}%`;

  if (elapsed > 2.5 && elapsed < 5.5) {
    elements.baselineRaceText.textContent = "Pricing agent has not reached legal risk yet.";
  } else if (elapsed >= 5.5 && elapsed < 10.5) {
    elements.baselineRaceText.textContent = "Still assembling the useful line after the seller needed to speak.";
  } else if (elapsed >= 10.5) {
    elements.baselineRaceText.textContent = "Useful only after the negotiation moment has passed.";
  }
}

function showOutcome() {
  elements.marginOutcome.textContent = "$140k preserved";
  elements.legalOutcome.textContent = "risky clause replaced";
  elements.closeOutcome.textContent = "74% and rising";
  pulsePanel(".impact-row");
  elements.subtitle.textContent = "Margin preserved. Legal risk blocked. Close probability up. This only works at Cerebras speed.";
}

function buildRedlineImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 600;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#101417";
  ctx.font = "700 32px Arial";
  ctx.fillText("Renewal Order Form - Redline", 50, 62);

  ctx.fillStyle = "#68727f";
  ctx.font = "22px Arial";
  ctx.fillText("Section 4.2 Renewal Uplift", 50, 122);

  ctx.fillStyle = "#111417";
  ctx.font = "24px Georgia";
  wrapText(ctx, "Annual renewal pricing increases by 5% unless mutually agreed in writing.", 50, 172, 820, 34);

  ctx.strokeStyle = "#bc3a3a";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(52, 167);
  ctx.lineTo(790, 167);
  ctx.stroke();

  ctx.fillStyle = "rgba(188, 58, 58, 0.1)";
  ctx.fillRect(42, 208, 850, 120);
  ctx.fillStyle = "#bc3a3a";
  ctx.font = "700 22px Arial";
  ctx.fillText("Buyer insertion:", 58, 242);
  ctx.font = "24px Georgia";
  wrapText(ctx, "Customer may renew at the same fees with no automatic uplift.", 58, 282, 790, 34);

  ctx.fillStyle = "rgba(12, 122, 93, 0.1)";
  ctx.fillRect(42, 370, 850, 132);
  ctx.fillStyle = "#0c7a5d";
  ctx.font = "700 22px Arial";
  ctx.fillText("Safer counter language:", 58, 406);
  ctx.font = "24px Georgia";
  wrapText(ctx, "Renewal uplift capped at 5%, with 60-day notice and volume-tier review.", 58, 446, 790, 34);

  ctx.strokeStyle = "#d9e0e7";
  ctx.lineWidth = 2;
  ctx.strokeRect(28, 28, 904, 540);

  return canvas.toDataURL("image/png");
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const testLine = `${line}${word} `;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = `${word} `;
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, y);
}

function pulsePanel(selector) {
  const panel = document.querySelector(selector);
  if (!panel) return;
  panel.classList.add("pulse");
  setTimeout(() => panel.classList.remove("pulse"), 900);
}

function normalizeCard(card, fallback) {
  const source = card && typeof card === "object" ? card : fallback;
  const evidence = Array.isArray(source.evidence) && source.evidence.length
    ? source.evidence.slice(0, 5)
    : fallback.evidence;
  return {
    urgency: ["low", "medium", "high", "critical"].includes(source.urgency) ? source.urgency : fallback.urgency,
    diagnosis: stringOr(source.diagnosis, fallback.diagnosis),
    recommended_line: stringOr(source.recommended_line, fallback.recommended_line),
    do_not_say: stringOr(source.do_not_say, fallback.do_not_say),
    business_impact: stringOr(source.business_impact, fallback.business_impact),
    evidence,
    latency_ms: Number.isFinite(Number(source.latency_ms)) ? Number(source.latency_ms) : fallback.latency_ms
  };
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
