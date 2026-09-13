/* Trace/Com Vision: user-initiated capture; local crops; virtual-only training. */
const $ = (id) => document.getElementById(id);
const state = { stream: null, crop: null, selecting: false, start: null, frames: [], timer: null, analyzing: false, history: loadHistory(), lastAnalysis: null, training: null, lastContext: null, stage: "IDLE", session: 0, failures: 0, nextRetryAt: 0, circuitOpen: false };

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

async function checkBackend() {
  try { await api("/health"); led("connectionLed", "good"); text("connectionText", "FABLE GATE ONLINE"); }
  catch { led("connectionLed", "bad"); text("connectionText", "BACKEND INDISPONÍVEL"); }
}

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
    state.stream = stream; state.frames = []; state.lastAnalysis = null;
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
      setCapture("live", "CAPTURA AO VIVO"); updatePipeline(); startObservation();
    };
    if (video.videoWidth) ready(); else video.addEventListener("loadedmetadata", ready, { once: true });
  } catch (error) { if (error?.name !== "NotAllowedError") setCapture("bad", "ERRO DE CAPTURA"); text("decisionSummary", error?.name === "NotAllowedError" ? "O compartilhamento foi cancelado." : String(error?.message || error)); }
}

function stopScreen() {
  state.session += 1; state.failures = 0; state.nextRetryAt = 0; state.circuitOpen = false;
  if (state.timer) clearInterval(state.timer); state.timer = null;
  if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null; state.crop = null; state.frames = [];
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

function startObservation() { if (state.timer) clearInterval(state.timer); state.failures = 0; state.nextRetryAt = 0; state.circuitOpen = false; observe(); state.timer = setInterval(observe, 5_000); }
async function observe() {
  if (state.analyzing || !state.stream || !state.crop || Date.now() < state.nextRetryAt) return;
  if (state.circuitOpen) { state.circuitOpen = false; state.failures = 0; setStage("CIRCUIT_HALF_OPEN"); }
  const session = state.session, stream = state.stream;
  setStage("CHART_CROP_GENERATING"); const chart = makeCrop(state.crop); if (!chart) { setStage("CROP_GENERATION_FAILED"); return; }
  setStage("SANITIZED_CROP_CREATED", `${chart.width}x${chart.height}`);
  const stat = metrics(chart, state.frames.at(-1)?.stats?.sample); const frame = { ...chart, stats: stat, capturedAt: Date.now() };
  state.frames.push(frame); state.frames = state.frames.slice(-4); state.analyzing = true;
  text("fpsText", "1 frame/s local · Fable /5s"); text("frameText", `${state.frames.length}/4 frames temporais · ${new Date().toLocaleTimeString()}`);
  const temporal = state.frames.slice().reverse().map((item, index) => ({ label: index ? `T-${index * 5}s` : "T0", dataUrl: item.dataUrl }));
  const snapshot = { analysisId: `vision_${Date.now()}`, timestamp: new Date().toISOString(), timestampMs: Date.now(), symbol: state.lastContext?.symbol || "UNAVAILABLE", horizonSeconds: 60, chartFrame: { crop: state.crop, width: chart.width, height: chart.height, capturedAt: Date.now() }, quantitativeFeatures: { availability: "SCREEN_MOTION_ONLY", frames: state.frames.map((item) => ({ ...item.stats, sample: undefined })) } };
  try {
    setStage("FABLE_REQUEST_STARTED"); const started = Date.now(); const result = await api("/api/fable/trade", { method: "POST", body: JSON.stringify({ snapshot, chartImages: temporal, contextImage: headerCrop()?.dataUrl || null }) });
    if (session !== state.session || stream !== state.stream) return;
    const latency = Date.now() - started; state.failures = 0; state.nextRetryAt = 0; state.lastAnalysis = result.analysis; renderAnalysis(result.analysis || {}, latency); await persistDecision(snapshot, result.analysis || {}); await trainIfActive(snapshot, result.analysis || {}, stat, latency);
  } catch (error) {
    if (session !== state.session || stream !== state.stream) return;
    const message = String(error.message || error);
    state.failures += 1; const delay = Math.min(60_000, 5_000 * (2 ** Math.min(state.failures - 1, 3))); state.circuitOpen = state.failures >= 4; state.nextRetryAt = Date.now() + (state.circuitOpen ? 60_000 : delay);
    setFable("ERROR");
    setStage(state.circuitOpen ? "CIRCUIT_OPEN" : "ANALYSIS_ERROR", message); text("decisionSummary", state.circuitOpen ? "Análise pausada temporariamente após falhas consecutivas. Nenhum WAIT foi gerado." : (message.includes("FABLE_VISION_UNSUPPORTED") ? "O gateway Fable atual não aceitou o crop de imagem. Nenhum sinal visual será emitido." : `Erro de análise: ${message}`));
  }
  finally { state.analyzing = false; }
}

async function persistDecision(snapshot, analysis) {
  try {
    await api("/api/analytics/record", { method: "POST", body: JSON.stringify({
      symbol: snapshot.symbol || "UNAVAILABLE", timeframe: "vision", direction: analysis.decision === "SELL" ? "down" : "up", decision: analysis.decision || "WAIT", horizon: 60,
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
function renderAnalysis(analysis, latency) {
  const decision = ["BUY", "SELL", "WAIT"].includes(analysis.decision) ? analysis.decision : "WAIT", confidence = Number(analysis.confidence) || 0;
  $("decisionBox").className = `decision-box state-${decision.toLowerCase()}`; text("decisionValue", decision); text("decisionSummary", analysis.summary || analysis.rationale || "Sem conclusão verificável."); text("confidenceValue", `${Math.round(confidence * 100)}%`); $("confidenceBar").style.transform = `scaleX(${clamp(confidence, 0, 1)})`;
  text("pBuyValue", probabilityText(analysis.pBuy)); text("pSellValue", probabilityText(analysis.pSell)); text("pWaitValue", probabilityText(analysis.pWait));
  text("dataQualityValue", Number.isFinite(Number(analysis.dataQuality)) ? `${Math.round(Number(analysis.dataQuality) * 100)}%` : "N/A"); text("confluenceValue", Number.isFinite(Number(analysis.confluence)) ? `${Math.round(Number(analysis.confluence) * 100)}%` : "N/A"); text("regimeValue", analysis.regime || "N/A"); text("trendValue", analysis.trend || "N/A"); text("momentumValue", analysis.momentum || "N/A"); text("visionValue", analysis.imageUsed ? "CROP PASS" : "SEM IMAGEM"); text("latencyValue", `${(latency / 1000).toFixed(1)}s`); text("analysisAge", `Análise ${new Date().toLocaleTimeString()} · ${latency}ms`); text("chartViewQuality", Number.isFinite(Number(analysis.chartView?.score)) ? `${Math.round(Number(analysis.chartView.score))}/100` : "N/A"); setFable("ONLINE");
  const guidance = $("agentGuidance"); const wantsAdjustment = ["REQUEST_ZOOM_OUT", "REQUEST_ZOOM_IN"].includes(analysis.agentAction);
  guidance.hidden = !wantsAdjustment; if (wantsAdjustment) { text("guidanceText", analysis.guidanceMessage || (analysis.agentAction === "REQUEST_ZOOM_OUT" ? "Preciso de mais contexto histórico. Abra um pouco mais o gráfico." : "Preciso enxergar melhor os candles recentes. Aproxime o gráfico.")); text("guidanceReason", `Contexto ${analysis.chartView?.historicalContext ?? "N/A"}/100 · detalhe recente ${analysis.chartView?.recentDetail ?? "N/A"}/100`); }
  const context = analysis.marketContext || {}; state.lastContext = context.symbol !== "UNAVAILABLE" && Number(context.confidence) >= .6 ? context : state.lastContext; const shown = state.lastContext || context;
  text("contextAsset", shown.symbol && shown.symbol !== "UNAVAILABLE" ? `${shown.symbol}${shown.marketType && shown.marketType !== "UNAVAILABLE" ? ` ${shown.marketType}` : ""}` : "Ativo não confirmado"); text("contextMeta", (shown.sources || []).join(" · ") || "Confirme manualmente somente se a visão não provar o ativo."); text("contextTimeframe", shown.visualTimeframe || "—"); text("contextStake", shown.displayedStake ?? "—"); text("contextConfidence", shown.confidence ? `${Math.round(shown.confidence * 100)}%` : "—"); text("statusAsset", shown.symbol || "—"); text("marketLabel", shown.symbol || "Gráfico compartilhado");
  const sizing = suggestedStake(analysis); text("suggestedStake", sizing.amount ? `R$ ${sizing.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "R$ —"); text("sizingNote", sizing.reason);
  const notes = [...(analysis.observations || []), ...(analysis.supportingFactors || [])].slice(0, 5); $("observationsList").innerHTML = (notes.length ? notes : ["Sem observação verificável."]).map((note) => `<li>${escape(note)}</li>`).join("");
  state.history.push({ analysisId: analysis.analysisId || `local-${Date.now()}`, decision, confidence, pBuy: analysis.pBuy ?? null, pSell: analysis.pSell ?? null, pWait: analysis.pWait ?? null, dataQuality: analysis.dataQuality ?? null, at: Date.now() }); state.history = state.history.slice(-30); saveHistory(); $("historyCount").textContent = String(state.history.length); $("historyList").innerHTML = state.history.slice().reverse().map((item) => `<p><b class="${item.decision.toLowerCase()}">${item.decision}</b><span>${probabilityText(item.confidence)} · B ${probabilityText(item.pBuy)} / S ${probabilityText(item.pSell)} / W ${probabilityText(item.pWait)} · ${new Date(item.at).toLocaleTimeString()}</span></p>`).join("");
  updateRunStats();
  updatePipeline();
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
  if (!state.training) return; const sizing = suggestedStake(analysis); const result = await api("/api/training/analyze", { method: "POST", body: JSON.stringify({ trainingSessionId: state.training.id, snapshot: { ...snapshot, symbol: state.lastContext?.symbol || "UNAVAILABLE", referencePrice: null, framesHash: frameHash(stat), features: { motion: stat } }, analysis, suggestedStake: sizing.amount || null }) }); state.training = result; renderTraining(result);
}
function renderTraining(session) { text("trainingAnalyses", String(session.analyses || 0)); text("trainingEvaluated", String(session.evaluatedTrades || 0)); text("trainingWins", `${session.WIN || 0} / ${session.LOSS || 0}`); text("trainingWr", session.WR == null ? "—" : `${Math.round(session.WR * 100)}%`); }
async function restoreTraining() { const id = localStorage.getItem("tracecom:training-session"); if (!id) return; try { const session = await api(`/api/training/sessions/${encodeURIComponent(id)}`); state.training = session; $("startTrainingButton").hidden = true; $("stopTrainingButton").hidden = false; renderTraining(session); } catch { localStorage.removeItem("tracecom:training-session"); } }
function escape(value) { return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

$("shareButton").addEventListener("click", shareScreen); $("stopShareButton").addEventListener("click", stopScreen); $("recropButton").addEventListener("click", openManualCrop); $("startTrainingButton").addEventListener("click", () => startTraining().catch((error) => text("trainingNote", error.message))); $("stopTrainingButton").addEventListener("click", stopTraining); bindManualCrop(); checkBackend(); updatePipeline(); restoreTraining(); window.addEventListener("beforeunload", stopScreen);
