/* Trace/Com Vision: user-initiated capture; local crops; virtual-only training. */
const $ = (id) => document.getElementById(id);
const CANDLE_SECONDS = 5, EXPIRATION_SECONDS = 60, VISIBLE_WINDOW_SECONDS = 300, ANALYSIS_DELAY_MS = 500;
const state = { stream: null, crop: null, selecting: false, start: null, frames: [], observations: [], priceObservations: [], priceTimer: null, priceAnalyzing: false, timer: null, countdownTimer: null, analyzing: false, history: loadHistory(), lastAnalysis: null, training: null, lastContext: null, manualPosition: { state: "NO_POSITION", direction: "UNKNOWN", confidence: 0, evidence: [] }, stage: "IDLE", session: 0, liveSessionId: null, liveSequence: 0, failures: 0, nextRetryAt: 0, circuitOpen: false, entryUntil: 0, reanalysisAt: 0, decisionId: null, decisionTimestamp: 0, expirationSeconds: EXPIRATION_SECONDS, lastSubmittedHash: null, lastSubmittedAt: 0, lastCandleId: null, requestCount: 0, hasSuccessfulAnalysis: false };

const api = async (path, options = {}) => {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
};
const text = (id, value) => { $(id).textContent = value; };
const led = (id, stateName) => { $(id).className = stateName || ""; };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function loadHistory() {
  try { const rows = JSON.parse(localStorage.getItem("tracecom:vision-history") || "[]"); return Array.isArray(rows) ? rows.slice(-30) : []; } catch { return []; }
}
function saveHistory() { localStorage.setItem("tracecom:vision-history", JSON.stringify(state.history.slice(-30))); }

function setCapture(status, label) { led("captureLed", status); text("captureText", label); text("visionBadge", status === "live" ? "VISION OBSERVANDO" : label); }
function setFable(label) { text("fableState", label); $("fableState").classList.toggle("online", label === "ONLINE"); }
function updatePipeline() { text("pipelineState", state.stream && state.crop ? "OBSERVANDO" : "AGUARDANDO"); text("healthCrop", state.crop ? "CROPS SANITIZADOS" : "CROP LOCAL"); }
function setStage(stage, detail = "") { state.stage = stage; text("cropText", detail ? `${stage} · ${detail}` : stage); console.info(`[VISION] ${stage}`, detail); }
async function liveEmit(type, payload = {}, keepalive = false) {
  if (!state.liveSessionId) return;
  const event = { sessionId: state.liveSessionId, type, sequenceId: `${state.liveSessionId}:${++state.liveSequence}`, payload, session: { source: "VISION_WEB", shadowOnly: true } };
  try { await fetch("/api/live/browser/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event), keepalive }); } catch { /* telemetry must never block analysis */ }
}
async function liveFrame(frame, hash) {
  if (!state.liveSessionId) return;
  const payload = { captureType: "crop", data: frame.dataUrl, mime: "image/jpeg", byteLength: frame.byteLength, width: frame.width, height: frame.height, timestamp: new Date().toISOString(), chartRegion: state.crop, frameHash: hash, imageHash: frame.imageHash };
  try { await api("/api/live/browser/frame", { method: "PUT", body: JSON.stringify({ sessionId: state.liveSessionId, frameId: frame.frameId, payload }) }); } catch { /* best-effort, crop-only */ }
}

async function checkBackend() {
  try { await api("/health"); led("connectionLed", "good"); text("connectionText", "FABLE GATE ONLINE"); }
  catch { led("connectionLed", "bad"); text("connectionText", "BACKEND INDISPONÍVEL"); }
}
function priceCrop() { const video = $("screenVideo"); if (!video.videoWidth) return null; return makeCrop({ x: .83, y: .35, width: .09, height: .50 }, 180); }
async function trackPrice() { if (state.priceAnalyzing || !state.stream) return; const crop = priceCrop(); if (!crop) return; state.priceAnalyzing = true; const frameId = `price_${Date.now()}`; try { const result = await api("/api/vision/price", { method: "POST", body: JSON.stringify({ frameId, dataUrl: crop.dataUrl, mimeType: "image/jpeg", width: crop.width, height: crop.height }) }); const observation = result.priceObservation; if (Number.isFinite(Number(observation?.value)) && Number(observation?.confidence) >= .6) { const row = { value: Number(observation.value), confidence: Number(observation.confidence), source: observation.source || "IQ_OPTION_CURRENT_PRICE_LABEL", timestamp: Number(observation.timestamp) || Date.now(), frameId, hash: observation.imageHash || null }; state.priceObservations = [...state.priceObservations, row].slice(-120); text("currentPriceValue", row.value.toString()); console.info("PRICE_OBSERVATION", JSON.stringify({ price: row.value, confidence: row.confidence, source: row.source, timestamp: row.timestamp, frameId: row.frameId })); } } catch (error) { console.info("PRICE_OBSERVATION_UNAVAILABLE", JSON.stringify({ frameId, reason: String(error?.message || error).slice(0, 120) })); } finally { state.priceAnalyzing = false; } }
function startPriceTracking() { if (state.priceTimer) clearInterval(state.priceTimer); void trackPrice(); state.priceTimer = setInterval(trackPrice, 2_000); }
function latestCausalPrice(timestamp) { return state.priceObservations.slice().reverse().find((item) => item.timestamp <= timestamp && timestamp - item.timestamp <= 3_000) || null; }

// Geometry-only detector. It never claims it read pixels or broker internals;
// it chooses the chart-safe center of a conventional trading window and exposes
// manual adjustment when that assumption has low confidence.
function detectChartRegion(video) {
  const ratio = video.videoWidth / Math.max(1, video.videoHeight);
  const crop = { x: .045, y: .13, width: .74, height: .70 };
  const confidence = ratio >= 1.2 && ratio <= 2.4 ? .68 : .42;
  return { crop, confidence, source: "LAYOUT_GEOMETRY_V1" };
}

async function shareScreen() {
  stopScreen();
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 12, max: 20 } }, audio: false });
    state.stream = stream; state.frames = []; state.observations = []; state.priceObservations = []; state.lastCandleId = null; state.lastAnalysis = null; state.hasSuccessfulAnalysis = false;
    state.liveSessionId = `vision_${crypto.randomUUID()}`; state.liveSequence = 0; void liveEmit("SESSION_STARTED", { startedAt: new Date().toISOString() });
    const video = $("screenVideo"); video.srcObject = stream; video.hidden = false; $("previewEmpty").hidden = true;
    $("shareButton").textContent = "RECOMPARTILHAR"; $("stopShareButton").hidden = false; $("startTrainingButton").disabled = false;
    stream.getVideoTracks()[0]?.addEventListener("ended", stopScreen, { once: true });
    await video.play();
    const ready = () => {
      if (!video.videoWidth || !video.videoHeight) { setStage("FRAME_INVALID", "dimensões indisponíveis"); return; }
      setStage("SCREEN_FRAME_CAPTURED", `${video.videoWidth}x${video.videoHeight}`);
      const detected = detectChartRegion(video); state.crop = detected.crop;
      setStage("CHART_REGION_DETECTED", `${Math.round(detected.confidence * 100)}%`);
      text("cropText", `ChartRegionDetector ${Math.round(detected.confidence * 100)}% · ${detected.source}`);
      $("recropButton").hidden = detected.confidence >= .6;
      if (detected.confidence < .6) $("recropButton").hidden = false;
       setCapture("live", "CAPTURA AO VIVO"); updatePipeline(); startPriceTracking(); startObservation();
    };
    if (video.videoWidth) ready(); else video.addEventListener("loadedmetadata", ready, { once: true });
  } catch (error) { if (error?.name !== "NotAllowedError") setCapture("bad", "ERRO DE CAPTURA"); text("decisionSummary", error?.name === "NotAllowedError" ? "O compartilhamento foi cancelado." : String(error?.message || error)); }
}

function stopScreen() {
  if (state.liveSessionId) void liveEmit("SESSION_ENDED", { endedAt: new Date().toISOString() }, true);
  state.session += 1; state.failures = 0; state.nextRetryAt = 0; state.circuitOpen = false;
  state.entryUntil = 0; state.reanalysisAt = 0; state.decisionId = null; state.decisionTimestamp = 0;
  state.lastSubmittedHash = null; state.lastSubmittedAt = 0; state.requestCount = 0;
  if (state.countdownTimer) { clearTimeout(state.countdownTimer); state.countdownTimer = null; }
  if (state.timer) clearTimeout(state.timer); state.timer = null; if (state.priceTimer) clearInterval(state.priceTimer); state.priceTimer = null;
  if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null; state.crop = null; state.frames = []; state.observations = []; state.priceObservations = []; state.lastCandleId = null; state.hasSuccessfulAnalysis = false; state.liveSessionId = null;
  const video = $("screenVideo"); video.pause(); video.srcObject = null; video.hidden = true;
  $("previewEmpty").hidden = false; $("shareButton").textContent = "COMPARTILHAR TELA"; $("stopShareButton").hidden = true; $("startTrainingButton").disabled = true;
  setCapture("", "NÃO COMPARTILHADO"); updatePipeline();
}

function contentBox() {
  const frame = $("previewFrame").getBoundingClientRect(), video = $("screenVideo").getBoundingClientRect();
  const scale = Math.min(video.width / Math.max(1, $("screenVideo").videoWidth), video.height / Math.max(1, $("screenVideo").videoHeight));
  const width = $("screenVideo").videoWidth * scale, height = $("screenVideo").videoHeight * scale;
  return { left: (frame.width - width) / 2, top: (frame.height - height) / 2, width, height, frame };
}
function point(event) { const box = contentBox(), frame = $("previewFrame").getBoundingClientRect(); return { x: clamp(event.clientX - frame.left, box.left, box.left + box.width), y: clamp(event.clientY - frame.top, box.top, box.top + box.height), box }; }
function showGuide(x, y, width, height) { const guide = $("cropGuide"); guide.style.display = "block"; Object.assign(guide.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` }); }
function openManualCrop() { $("cropLayer").hidden = false; $("cropGuide").style.display = "none"; text("cropText", "Ajuste a região do gráfico; nada fora dela será enviado."); }
function bindManualCrop() {
  const layer = $("cropLayer");
  layer.addEventListener("pointerdown", (event) => { state.selecting = true; state.start = point(event); layer.setPointerCapture(event.pointerId); });
  layer.addEventListener("pointermove", (event) => { if (!state.selecting) return; const end = point(event), x = Math.min(state.start.x, end.x), y = Math.min(state.start.y, end.y); showGuide(x, y, Math.abs(end.x - state.start.x), Math.abs(end.y - state.start.y)); });
  layer.addEventListener("pointerup", (event) => { if (!state.selecting) return; state.selecting = false; const end = point(event), x = Math.min(state.start.x, end.x), y = Math.min(state.start.y, end.y), w = Math.abs(end.x - state.start.x), h = Math.abs(end.y - state.start.y); if (w > 120 && h > 90) { state.crop = { x: (x - end.box.left) / end.box.width, y: (y - end.box.top) / end.box.height, width: w / end.box.width, height: h / end.box.height }; layer.hidden = true; $("recropButton").hidden = false; text("cropText", "Região ajustada manualmente · enviada somente como crop sanitizado"); updatePipeline(); } });
}

function makeCrop(crop, maxWidth = 1120) {
  const video = $("screenVideo"); if (!video.videoWidth || !crop) return null;
  const sx = Math.round(crop.x * video.videoWidth), sy = Math.round(crop.y * video.videoHeight), sw = Math.round(crop.width * video.videoWidth), sh = Math.round(crop.height * video.videoHeight);
  const scale = Math.min(1, maxWidth / Math.max(1, sw)), canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(sw * scale)); canvas.height = Math.max(1, Math.round(sh * scale));
  canvas.getContext("2d", { alpha: false })?.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/jpeg", .76), width: canvas.width, height: canvas.height };
}
function dataUrlBytes(dataUrl) { const base64 = String(dataUrl).split(",", 2)[1] || ""; return Math.max(0, Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0)); }
async function cropHash(dataUrl) { const base64 = String(dataUrl).split(",", 2)[1] || ""; const raw = atob(base64); const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0)); const digest = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 16); }
function metrics(image, previous) {
  const mini = document.createElement("canvas"); mini.width = 48; mini.height = 27; const ctx = mini.getContext("2d", { willReadFrequently: true }); if (!ctx) return { availability: "UNAVAILABLE" };
  const source = new Image(); source.src = image.dataUrl; // Captured data URL is used only for hash-like local motion, after synchronous canvas source below.
  const video = $("screenVideo"); const crop = state.crop; ctx.drawImage(video, Math.round(crop.x * video.videoWidth), Math.round(crop.y * video.videoHeight), Math.round(crop.width * video.videoWidth), Math.round(crop.height * video.videoHeight), 0, 0, 48, 27);
  const bytes = ctx.getImageData(0, 0, 48, 27).data, sample = []; let luma = 0;
  for (let i = 0; i < bytes.length; i += 4) { const v = Math.round((bytes[i] * .21 + bytes[i + 1] * .72 + bytes[i + 2] * .07) / 8); sample.push(v); luma += v; }
  const diff = previous?.length === sample.length ? sample.reduce((sum, value, index) => sum + Math.abs(value - previous[index]), 0) / sample.length / 32 : null;
  return { availability: "SCREEN_MOTION_ONLY", averageLuma: +(luma / sample.length / 32).toFixed(3), frameDifference: diff == null ? null : +diff.toFixed(3), sample };
}
function headerCrop() { return makeCrop({ x: .04, y: .04, width: .60, height: .12 }, 800); }
function frameHash(stats) { return stats.sample ? stats.sample.slice(0, 96).join("") : null; }

function scheduleNextCandle() { if (state.timer) clearTimeout(state.timer); const now = Date.now(); const nextClose = (Math.floor(now / (CANDLE_SECONDS * 1000)) + 1) * CANDLE_SECONDS * 1000; state.timer = setTimeout(() => { void observe(); scheduleNextCandle(); }, Math.max(50, nextClose + ANALYSIS_DELAY_MS - now)); }
function startObservation() { if (state.timer) clearTimeout(state.timer); state.failures = 0; state.nextRetryAt = 0; state.circuitOpen = false; scheduleNextCandle(); }
async function observe() {
  if (state.analyzing || !state.stream || !state.crop || Date.now() < state.nextRetryAt) return;
  if (state.circuitOpen) { state.circuitOpen = false; state.failures = 0; setStage("CIRCUIT_HALF_OPEN"); }
  const session = state.session, stream = state.stream, candleCloseTimestamp = Math.floor(Date.now() / (CANDLE_SECONDS * 1000)) * CANDLE_SECONDS * 1000, candleId = `candle_${candleCloseTimestamp}`;
  if (state.lastCandleId === candleId) return;
  console.info("CANDLE_CLOSED", JSON.stringify({ candleId, candleOpenTimestamp: candleCloseTimestamp - CANDLE_SECONDS * 1000, candleCloseTimestamp, candleSeconds: CANDLE_SECONDS }));
  setStage("CHART_CROP_GENERATING"); if (!state.hasSuccessfulAnalysis) setFable("LOADING"); else setFable("ONLINE"); text("pipelineState", "CAPTURANDO"); const chart = makeCrop(state.crop); if (!chart) { setStage("CROP_GENERATION_FAILED"); setFable("ERROR"); return; }
  setStage("SANITIZED_CROP_CREATED", `${chart.width}x${chart.height}`);
  const frameId = `frame_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const imageHash = await cropHash(chart.dataUrl); const byteLength = dataUrlBytes(chart.dataUrl);
  console.info("VISION_CROP_READY", JSON.stringify({ frameId, mimeType: "image/jpeg", byteLength, width: chart.width, height: chart.height, hash: imageHash }));
  const stat = metrics(chart, state.frames.at(-1)?.stats?.sample); const frame = { ...chart, frameId, imageHash, byteLength, stats: stat, capturedAt: Date.now() };
  state.frames.push(frame); state.frames = state.frames.slice(-4); state.analyzing = true; updateEntryCountdown();
  const currentHash = frameHash(stat);
  // A stationary screen is not a new market observation. Keep the temporal
  // buffer, but do not repeatedly submit identical pixels to the provider.
  // Re-sample at most once per 30 seconds so a stalled feed remains visible
  // without creating a request storm.
  if (currentHash && currentHash === state.lastSubmittedHash && Date.now() - state.lastSubmittedAt < 30_000) {
    state.analyzing = false;
    setStage("FRAME_DUPLICATE_SUPPRESSED", "aguardando mudança observável");
    return;
  }
  state.lastSubmittedHash = currentHash; state.lastSubmittedAt = Date.now(); state.requestCount += 1;
  void liveFrame(frame, imageHash);
  void liveEmit("VISION_MARKET_SAMPLE", { frameId, asset: state.lastContext?.symbol || null, marketType: state.lastContext?.marketType || null, timeframe: state.lastContext?.visualTimeframe || null, expirationSeconds: 60, detectedPrice: null, detectedPriceConfidence: null, observation: { motion: stat.frameDifference, averageLuma: stat.averageLuma }, frameHash: imageHash, chartRegion: state.crop });
  text("fpsText", "1 frame/s local · Fable /5s"); text("frameText", `${state.frames.length}/4 frames temporais · ${new Date().toLocaleTimeString()}`);
  const temporal = state.frames.slice().reverse().map((item, index) => ({ label: index ? `T-${index * 5}s` : "T0", frameId: item.frameId, dataUrl: item.dataUrl, mimeType: "image/jpeg", byteLength: item.byteLength, width: item.width, height: item.height, imageHash: item.imageHash }));
  const requestId = `vision_request_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const snapshot = { analysisId: `vision_${Date.now()}`, requestId, candleId, candleOpenTimestamp: candleCloseTimestamp - CANDLE_SECONDS * 1000, candleCloseTimestamp, candleSeconds: CANDLE_SECONDS, visibleWindowSeconds: VISIBLE_WINDOW_SECONDS, timestamp: new Date().toISOString(), timestampMs: Date.now(), symbol: state.lastContext?.symbol || "UNAVAILABLE", assetResolution: { visionAsset: null, uiAsset: state.lastContext?.symbol || null, sessionAsset: null, status: state.lastContext?.symbol ? "SESSION_CONFIRMED" : "UNKNOWN" }, horizonSeconds: EXPIRATION_SECONDS, chartFrame: { frameId, crop: state.crop, width: chart.width, height: chart.height, capturedAt: Date.now(), mimeType: "image/jpeg", byteLength, imageHash }, temporalContext: state.observations.slice(-60), quantitativeFeatures: { availability: "SCREEN_MOTION_ONLY", frames: state.frames.map((item) => ({ ...item.stats, sample: undefined })) } };
  state.lastCandleId = candleId;
  try {
    setStage("PIPELINE_REQUEST_STARTED"); console.info("VISION_REQUEST_PREPARED", JSON.stringify({ requestId, frameId, hasImage: true, bytes: byteLength, hash: imageHash, width: chart.width, height: chart.height })); const started = Date.now(); const result = await api("/api/fable/trade", { method: "POST", body: JSON.stringify({ snapshot, chartImages: temporal, contextImage: headerCrop()?.dataUrl || null }) });
    if (session !== state.session || stream !== state.stream || state.lastCandleId !== candleId) { console.info("STALE_DECISION", JSON.stringify({ requestId, candleId, currentCandleId: state.lastCandleId })); return; }
    const latency = Date.now() - started; state.failures = 0; state.nextRetryAt = 0; state.lastAnalysis = result.analysis; state.observations = [...state.observations, { candleId, frameId, candleCloseTimestamp, timestamp: Date.now(), visionObservation: result.analysis?.visionObservation || null, directionalLean: result.analysis?.directionalLean || "NONE", pBuy: result.analysis?.pBuy ?? null, pSell: result.analysis?.pSell ?? null, pWait: result.analysis?.pWait ?? null }].slice(-60); console.info("ARBITER_DECISION", JSON.stringify({ candleId, frameId, decision: result.analysis?.decision || "WAIT", directionalLean: result.analysis?.directionalLean || "NONE", latencyMs: latency })); state.hasSuccessfulAnalysis = true; renderAnalysis(result.analysis || {}, latency); await persistDecision(snapshot, result.analysis || {}); await trainIfActive(snapshot, result.analysis || {}, stat, latency);
    if (result.analysis?.decision === "WAIT" && ["BUY", "SELL"].includes(result.analysis?.directionalLean)) { console.info("SHADOW_LEAN_CREATED", JSON.stringify({ candleId, frameId, direction: result.analysis.directionalLean, leanConfidence: result.analysis.leanConfidence ?? null })); void liveEmit("SHADOW_UPDATE", { candleId, frameId, direction: result.analysis.directionalLean, leanConfidence: result.analysis.leanConfidence ?? null, pBuy: result.analysis?.pBuy ?? null, pSell: result.analysis?.pSell ?? null, pWait: result.analysis?.pWait ?? null, counterfactual: true }); }
    void liveEmit("DECISION", { decisionId: state.decisionId, candleId, direction: result.analysis?.decision || "WAIT", confidence: result.analysis?.confidence ?? null, probabilitySource: result.analysis?.probabilitySource || "FABLE_5_1", pBuy: result.analysis?.pBuy ?? null, pSell: result.analysis?.pSell ?? null, pWait: result.analysis?.pWait ?? null, directionalLean: result.analysis?.directionalLean || "NONE", multiAgent: result.analysis?.multiAgent || null, latencyMetrics: result.analysis?.latencyMetrics || null });
  } catch (error) {
    if (session !== state.session || stream !== state.stream) return;
    const message = String(error.message || error);
    state.failures += 1; const delay = Math.min(60_000, 5_000 * (2 ** Math.min(state.failures - 1, 3))); state.circuitOpen = state.failures >= 4; state.nextRetryAt = Date.now() + (state.circuitOpen ? 60_000 : delay);
    setFable("ERROR");
    setStage(state.circuitOpen ? "CIRCUIT_OPEN" : "ANALYSIS_ERROR", message); text("decisionSummary", state.circuitOpen ? "Análise pausada temporariamente após falhas consecutivas. Nenhum WAIT foi gerado." : (message.includes("FABLE_VISION_UNSUPPORTED") ? "O gateway Fable atual não aceitou o crop de imagem. Nenhum sinal visual será emitido." : `Erro de análise: ${message}`));
    void liveEmit("PIPELINE_ERROR", { stage: state.stage, code: message.slice(0, 160) });
  }
  finally { state.analyzing = false; }
}

async function persistDecision(snapshot, analysis) {
  try {
    await api("/api/analytics/record", { method: "POST", body: JSON.stringify({
      symbol: snapshot.symbol || "UNAVAILABLE", timeframe: `${snapshot.candleSeconds || CANDLE_SECONDS}s`, direction: analysis.decision === "SELL" ? "down" : "up", decision: analysis.decision || "WAIT", horizon: EXPIRATION_SECONDS, candleId: snapshot.candleId, directionalLean: analysis.directionalLean, leanConfidence: analysis.leanConfidence,
      entryTime: snapshot.timestampMs || Date.now(), entryPrice: null, score: 0, confidence: Number(analysis.confidence) || 0, probability: Number.isFinite(Number(analysis.confidence)) ? Number(analysis.confidence) : null,
      pBuy: analysis.pBuy, pSell: analysis.pSell, pWait: analysis.pWait, sampleSize: 0, regime: analysis.regime || null, rationale: analysis.summary || analysis.rationale || "Vision analysis",
      providerId: "vision-web", modelVersion: "FABLE_TRADER_V1", featureVersion: "screen-motion-v1",
    }) });
  } catch { /* serverless/remote can be read-only; browser history remains immutable */ }
}

function suggestedStake(analysis) {
  const budget = Math.max(0, Number($("sessionBudget").value) || 0), confidence = Number(analysis.confidence) || 0, quality = Number(analysis.dataQuality) || 0;
  if (!budget || analysis.decision === "WAIT" || confidence < .55 || quality < .45) return { amount: 0, reason: "Sem sugestão: qualidade, confiança ou capital insuficientes." };
  const risk = Math.min(.01, .003 + confidence * quality * .007); return { amount: Math.max(0, Math.floor(budget * risk * 100) / 100), reason: `Risco fixo ${(risk * 100).toFixed(1)}%; sem martingale.` };
}
function probabilityText(value) { return Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : "N/A"; }
function updateManualPosition(observation, analysis) { const raw = observation?.manualPosition; if (!raw || !["POSSIBLE_POSITION", "POSITION_CONFIRMED", "WAITING_SETTLEMENT", "SETTLED"].includes(raw.state)) return; const direction = ["BUY", "SELL"].includes(raw.direction) ? raw.direction : "UNKNOWN"; state.manualPosition = { state: raw.state, direction, confidence: Number(raw.confidence) || 0, evidence: Array.isArray(raw.evidence) ? raw.evidence.slice(0, 4) : [] }; text("manualPositionValue", `${state.manualPosition.state} · ${state.manualPosition.direction}`); text("manualPositionMeta", `${Math.round(state.manualPosition.confidence * 100)}% · ${state.manualPosition.evidence.join(" · ") || "evidência visual"}`); void liveEmit("SHADOW_UPDATE", { manualPosition: state.manualPosition, decisionId: analysis?.analysisId || null, directionalLean: analysis?.directionalLean || "NONE" }); }
function renderAnalysis(analysis, latency) {
  const decision = ["BUY", "SELL", "WAIT"].includes(analysis.decision) ? analysis.decision : "WAIT", confidence = Number(analysis.confidence) || 0;
  $("decisionBox").className = `decision-box state-${decision.toLowerCase()}`; text("decisionValue", decision); text("decisionSummary", analysis.summary || analysis.rationale || "Sem conclusão verificável."); text("confidenceValue", `${Math.round(confidence * 100)}%`); $("confidenceBar").style.transform = `scaleX(${clamp(confidence, 0, 1)})`;
  text("pBuyValue", probabilityText(analysis.pBuy)); text("pSellValue", probabilityText(analysis.pSell)); text("pWaitValue", probabilityText(analysis.pWait));
  text("dataQualityValue", Number.isFinite(Number(analysis.dataQuality)) ? `${Math.round(Number(analysis.dataQuality) * 100)}%` : "N/A"); text("confluenceValue", Number.isFinite(Number(analysis.confluence)) ? `${Math.round(Number(analysis.confluence) * 100)}%` : "N/A"); text("regimeValue", analysis.regime || "N/A"); text("trendValue", analysis.trend || "N/A"); text("momentumValue", analysis.momentum || "N/A"); text("visionValue", analysis.imageUsed ? "CROP PASS" : "SEM IMAGEM"); text("visionStatusValue", analysis.visionObservation?.availability || analysis.imageStatus || "UNAVAILABLE"); text("parseStatusValue", analysis.visionObservation?.parseMode || "—"); text("assetStatusValue", analysis.assetResolution?.status || "UNKNOWN"); text("candleStatusValue", `${analysis.candleSeconds || 5}s / ${analysis.expirationSeconds || 60}s`); text("directionalLeanValue", analysis.directionalLean || "NONE"); text("leanText", analysis.directionalLean && analysis.directionalLean !== "NONE" ? `Lean ${analysis.directionalLean} · ${probabilityText(analysis.leanConfidence)} · não operacional` : "Sem direção dominante no WAIT."); updateManualPosition(analysis.visionObservation, analysis); text("latencyValue", `${(latency / 1000).toFixed(1)}s`); text("analysisAge", `Análise ${new Date().toLocaleTimeString()} · ${latency}ms`); text("chartViewQuality", Number.isFinite(Number(analysis.chartView?.score)) ? `${Math.round(Number(analysis.chartView.score))}/100` : "N/A"); setFable("ONLINE");
  const guidance = $("agentGuidance"); const wantsAdjustment = ["REQUEST_ZOOM_OUT", "REQUEST_ZOOM_IN"].includes(analysis.agentAction);
  guidance.hidden = !wantsAdjustment; if (wantsAdjustment) { text("guidanceText", analysis.guidanceMessage || (analysis.agentAction === "REQUEST_ZOOM_OUT" ? "Preciso de mais contexto histórico. Abra um pouco mais o gráfico." : "Preciso enxergar melhor os candles recentes. Aproxime o gráfico.")); text("guidanceReason", `Contexto ${analysis.chartView?.historicalContext ?? "N/A"}/100 · detalhe recente ${analysis.chartView?.recentDetail ?? "N/A"}/100`); }
  const context = analysis.marketContext || {}; state.lastContext = context.symbol !== "UNAVAILABLE" && Number(context.confidence) >= .6 ? context : state.lastContext; const shown = state.lastContext || context;
  text("contextAsset", shown.symbol && shown.symbol !== "UNAVAILABLE" ? `${shown.symbol}${shown.marketType && shown.marketType !== "UNAVAILABLE" ? ` ${shown.marketType}` : ""}` : "Ativo não confirmado"); text("contextMeta", (shown.sources || []).join(" · ") || "Confirme manualmente somente se a visão não provar o ativo."); text("contextTimeframe", shown.visualTimeframe || "—"); text("contextStake", shown.displayedStake ?? "—"); text("contextConfidence", shown.confidence ? `${Math.round(shown.confidence * 100)}%` : "—"); text("statusAsset", shown.symbol || "—"); text("marketLabel", shown.symbol || "Gráfico compartilhado");
  const sizing = suggestedStake(analysis); text("suggestedStake", sizing.amount ? `R$ ${sizing.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "R$ —"); text("sizingNote", sizing.reason);
  const now = Date.now(); state.decisionId = analysis.analysisId || `local-${now}`; state.decisionTimestamp = now; state.expirationSeconds = Number(analysis.expirationSeconds) > 0 ? Number(analysis.expirationSeconds) : 60;
  state.entryUntil = decision === "BUY" || decision === "SELL" ? now + 10_000 : 0;
  state.reanalysisAt = decision === "WAIT" ? now + 5_000 : 0;
  updateEntryCountdown();
  const notes = [...(analysis.observations || []), ...(analysis.supportingFactors || [])].slice(0, 5); $("observationsList").innerHTML = (notes.length ? notes : ["Sem observação verificável."]).map((note) => `<li>${escape(note)}</li>`).join("");
  state.history.push({ analysisId: analysis.analysisId || `local-${Date.now()}`, decision, confidence, pBuy: analysis.pBuy ?? null, pSell: analysis.pSell ?? null, pWait: analysis.pWait ?? null, dataQuality: analysis.dataQuality ?? null, at: Date.now() }); state.history = state.history.slice(-30); saveHistory(); $("historyCount").textContent = String(state.history.length); $("historyList").innerHTML = state.history.slice().reverse().map((item) => `<p><b class="${item.decision.toLowerCase()}">${item.decision}</b><span>${probabilityText(item.confidence)} · B ${probabilityText(item.pBuy)} / S ${probabilityText(item.pSell)} / W ${probabilityText(item.pWait)} · ${new Date(item.at).toLocaleTimeString()}</span></p>`).join("");
  updateRunStats();
  updatePipeline();
}
function updateEntryCountdown() {
  if (state.countdownTimer) { clearTimeout(state.countdownTimer); state.countdownTimer = null; }
  const clock = $("operationClock");
  const now = Date.now();
  if (state.entryUntil) {
    const left = Math.max(0, state.entryUntil - now);
    if (clock) { text("clockValue", String(Math.ceil(left / 1000)).padStart(2, "0")); text("clockState", left ? "ENTRADA EM" : "EXPIRADO"); text("clockText", left ? `Janela recomendada de entrada em ${Math.ceil(left / 1000)} segundos.` : "A janela de entrada expirou; aguardando nova decisão."); }
    text("decisionSummary", left ? `${state.lastAnalysis?.summary || state.lastAnalysis?.rationale || "Sinal shadow"} · entrada em ${Math.ceil(left / 1000)}s` : (state.lastAnalysis?.summary || state.lastAnalysis?.rationale || "Sinal shadow"));
    if (left) state.countdownTimer = window.setTimeout(updateEntryCountdown, 250);
    return;
  }
  if (state.reanalysisAt) {
    const left = Math.max(0, state.reanalysisAt - now);
    if (clock) { text("clockValue", left ? String(Math.ceil(left / 1000)).padStart(2, "0") : "—"); text("clockState", left ? "REAVALIANDO EM" : "AGUARDANDO"); text("clockText", left ? `Nova análise prevista em ${Math.ceil(left / 1000)} segundos.` : "Nova análise será iniciada automaticamente."); }
    if (left) state.countdownTimer = window.setTimeout(updateEntryCountdown, 250); else state.reanalysisAt = 0;
    return;
  }
  if (clock) { text("clockValue", "—"); text("clockState", state.analyzing ? "ANALYZING" : "AGUARDANDO"); text("clockText", state.analyzing ? "Processando nova observação." : "A próxima análise será iniciada automaticamente."); }
}

function updateRunStats() {
  const directional = state.history.filter((item) => item.decision === "BUY" || item.decision === "SELL");
  text("trainingAnalyses", String(state.history.length)); text("trainingWins", "N/A"); text("trainingEvaluated", "0"); text("trainingWr", "N/A");
  text("trainingTitle", state.training ? "Treinamento ativo" : "Treino inativo"); text("trainingState", state.training ? "ATIVO" : "PRONTO");
  if (directional.length && state.training) text("trainingNote", `${directional.length} sinais direcionais · avaliações aguardam preço de liquidação estruturado.`);
}

async function startTraining() {
  const session = await api("/api/training/sessions", { method: "POST", body: JSON.stringify({ symbol: state.lastContext?.symbol || null, marketType: state.lastContext?.marketType || null, horizonSeconds: 60, maxEvaluatedTrades: 100, agentVersion: "FABLE_TRADER_V1", promptVersion: "vision-v1", featureVersion: "screen-motion-v1", visionVersion: "sanitized-crop-v1" }) });
  state.training = session; localStorage.setItem("tracecom:training-session", session.id); $("startTrainingButton").hidden = true; $("stopTrainingButton").hidden = false; text("trainingTitle", "Treinamento ativo"); text("trainingState", "ATIVO"); text("trainingNote", "Somente operações virtuais. Sem clique, stake ou ordem na IQ Option."); renderTraining(session);
}
function stopTraining() { state.training = null; localStorage.removeItem("tracecom:training-session"); $("startTrainingButton").hidden = false; $("stopTrainingButton").hidden = true; text("trainingTitle", "Treino pausado"); text("trainingState", "PAUSADO"); }
async function trainIfActive(snapshot, analysis, stat) {
  if (!state.training) return; const sizing = suggestedStake(analysis); const causalPrice = latestCausalPrice(snapshot.timestampMs); const visualPrice = Number(analysis.visionObservation?.price); const priceConfidence = Number(analysis.visionObservation?.priceConfidence) || 0; const referencePrice = causalPrice?.value ?? (Number.isFinite(visualPrice) && priceConfidence >= .6 ? visualPrice : null); const referencePriceSource = referencePrice === null ? "UNAVAILABLE" : (causalPrice?.source || analysis.visionObservation?.priceSource || "VISION_PRICE_LABEL"); const referencePriceConfidence = causalPrice?.confidence ?? priceConfidence; if (referencePrice !== null && (analysis.decision === "BUY" || analysis.decision === "SELL" || ["BUY", "SELL"].includes(analysis.directionalLean))) console.info("ENTRY_PRICE_LOCKED", JSON.stringify({ price: referencePrice, timestamp: causalPrice?.timestamp || snapshot.timestampMs, ageMs: causalPrice ? snapshot.timestampMs - causalPrice.timestamp : 0, confidence: referencePriceConfidence, source: referencePriceSource, candleId: snapshot.candleId })); const result = await api("/api/training/analyze", { method: "POST", body: JSON.stringify({ trainingSessionId: state.training.id, snapshot: { ...snapshot, symbol: state.lastContext?.symbol || "UNAVAILABLE", referencePrice, referencePriceSource, priceConfidence: referencePriceConfidence, framesHash: frameHash(stat), features: { motion: stat } }, analysis, suggestedStake: sizing.amount || null }) }); state.training = result; renderTraining(result);
}
function renderTraining(session) {
  const analyses = Number(session.analyses || 0);
  const evaluated = Number(session.evaluatedTrades || 0);
  const wins = Number(session.WIN || 0);
  const losses = Number(session.LOSS || 0);
  const draws = Number(session.DRAW || 0);
  const unknown = Number(session.UNKNOWN || 0);
  const pending = Number(session.openVirtualTrades || 0);
  text("trainingAnalyses", String(analyses));
  text("trainingEvaluated", String(evaluated));
  text("trainingWins", `${wins} / ${losses}`);
  text("trainingDrawUnknown", `${draws} / ${unknown}`);
  text("trainingPending", String(pending));
  text("trainingWr", session.WR == null ? "—" : `${Math.round(Number(session.WR) * 100)}%`);
  const note = $("trainingNote");
  if (note && session.persistence) note.textContent = `Persistência: ${session.persistence}. ${pending} operação(ões) aguardando o horizonte causal; WAIT directional lean: ${session.directionalLeanEvaluated || 0} avaliados, WR ${session.directionalLeanWR == null ? "—" : `${Math.round(Number(session.directionalLeanWR) * 100)}%`}.`;
}
async function restoreTraining() { const id = localStorage.getItem("tracecom:training-session"); if (!id) return; try { const session = await api(`/api/training/sessions/${encodeURIComponent(id)}`); state.training = session; $("startTrainingButton").hidden = true; $("stopTrainingButton").hidden = false; renderTraining(session); } catch { localStorage.removeItem("tracecom:training-session"); } }
async function refreshTraining() { if (!state.training) return; try { const session = await api(`/api/training/sessions/${encodeURIComponent(state.training.id)}`); state.training = session; renderTraining(session); } catch { /* best-effort training refresh */ } }
function liveStatus(label, note) { text("liveAccessStatus", label); if (note) text("liveAccessNote", note); }
async function generateLiveKey() { const adminKey = window.prompt("Chave administrativa da interface (não será armazenada):"); if (!adminKey) return; liveStatus("LOADING", "Gerando chave…"); try { const result = await api("/api/live/admin/keys", { method: "POST", headers: { "x-live-admin-key": adminKey }, body: JSON.stringify({ name: "Codex Live Access" }) }); const output = $("liveKeyOutput"); output.hidden = false; output.textContent = result.key; output.dataset.keyId = result.id; output.dataset.adminKey = adminKey; $("liveRevokeKey").hidden = false; liveStatus("READY", "Chave exibida uma única vez. Copie-a com segurança."); } catch (error) { liveStatus("ERROR", error.message); } }
async function revokeLiveKey() { const output = $("liveKeyOutput"), id = output?.dataset.keyId, adminKey = output?.dataset.adminKey; if (!id || !adminKey) return; liveStatus("LOADING", "Revogando…"); try { await api(`/api/live/admin/keys/${encodeURIComponent(id)}/revoke`, { method: "POST", headers: { "x-live-admin-key": adminKey }, body: "{}" }); output.textContent = "Chave revogada"; delete output.dataset.adminKey; $("liveRevokeKey").hidden = true; liveStatus("REVOKED", "A chave foi revogada."); } catch (error) { liveStatus("ERROR", error.message); } }
async function refreshLiveStatus() { try { const value = await api("/api/live/admin/status"); text("liveAccessMeta", `${value.relayStatus || "ONLINE"} / ${value.db ? "READY" : "OFFLINE"} / ${state.liveSessionId || "—"}`); liveStatus(value.relayStatus === "ONLINE" ? "READY" : "OFFLINE"); } catch { liveStatus("OFFLINE", "Relay indisponível."); } }
async function copyLiveInstructions() { try { await navigator.clipboard.writeText("TraceCon Live Access (read-only)\nEnvie somente frames crop-only e telemetria para /api/live/session/frame/latest. Nunca envie credenciais, cookies, tokens, saldo ou imagens integrais."); liveStatus("READY", "Instruções copiadas."); } catch { liveStatus("ERROR", "Não foi possível copiar as instruções."); } }
function escape(value) { return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

$("shareButton").addEventListener("click", shareScreen); $("stopShareButton").addEventListener("click", stopScreen); $("recropButton").addEventListener("click", openManualCrop); $("startTrainingButton").addEventListener("click", () => startTraining().catch((error) => text("trainingNote", error.message))); $("stopTrainingButton").addEventListener("click", stopTraining); $("liveGenerateKey")?.addEventListener("click", generateLiveKey); $("liveRevokeKey")?.addEventListener("click", revokeLiveKey); $("liveCopyInstructions")?.addEventListener("click", copyLiveInstructions); bindManualCrop(); checkBackend(); updatePipeline(); restoreTraining(); refreshLiveStatus(); setInterval(refreshLiveStatus, 30000); setInterval(refreshTraining, 5000); window.addEventListener("beforeunload", stopScreen);
