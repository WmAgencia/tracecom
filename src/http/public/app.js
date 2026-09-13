/* Trace/Com Vision: user-initiated capture; local crops; virtual-only training. */
const $ = (id) => document.getElementById(id);
const CANDLE_SECONDS = 5, EXPIRATION_SECONDS = 60, VISIBLE_WINDOW_SECONDS = 300, ANALYSIS_DELAY_MS = 500, ANALYSIS_STALE_MS = 30_000, DEEP_INTERVAL_MS = 30_000, FAST_DEADLINE_MS = 5_000;
const PROFILE_LABELS = { CONSERVATIVE: "Conservador", BALANCED: "Balanceado", AGGRESSIVE: "Agressivo" };
const state = { stream: null, crop: null, selecting: false, start: null, frames: [], observations: [], priceObservations: [], priceOutlierCandidates: [], priceTimer: null, priceAnalyzing: false, timer: null, countdownTimer: null, analyzing: false, history: loadHistory(), lastAnalysis: null, training: null, lastContext: null, manualPosition: { state: "NO_POSITION", direction: "UNKNOWN", confidence: 0, evidence: [] }, metrics: { analysisStarted: 0, analysisCompleted: 0, analysisStale: 0, analysisSkippedBusy: 0, priceObservationsValid: 0, priceObservationsRejected: 0 }, stage: "IDLE", session: 0, liveSessionId: null, liveSequence: 0, failures: 0, nextRetryAt: 0, circuitOpen: false, entryUntil: 0, reanalysisAt: 0, decisionId: null, decisionSource: null, deepRequested: false, deepExecuted: false, decisionTimestamp: 0, expirationSeconds: EXPIRATION_SECONDS, lastSubmittedHash: null, lastSubmittedAt: 0, lastCandleId: null, requestCount: 0, hasSuccessfulAnalysis: false };
state.metrics.fastStarted = 0; state.metrics.fastTimeouts = 0; state.metrics.fastLatencies = [];
state.profile = localStorage.getItem("tracecom:profile") || "BALANCED";
state.deepContext = { version: 0, at: 0, observation: null, trend: null, momentum: null, regime: null, latencyMs: null };
state.deepTimer = null; state.deepRunning = false;
window.tracecomMetrics = state.metrics;
function applyProfile(value) { const profile = ["CONSERVATIVE", "BALANCED", "AGGRESSIVE"].includes(value) ? value : "BALANCED"; state.profile = profile; localStorage.setItem("tracecom:profile", profile); const select = $("profileSelect"); if (select) select.value = profile; if ($("profileLine")) $("profileLine").textContent = `Perfil: ${PROFILE_LABELS[profile]} · Horizonte: 60s`; console.info("PROFILE_SELECTED", JSON.stringify({ profile })); channelProfileSwitch(); }

const OP_ENTRY_MS = 10_000, OP_CONFIRM_MS = 20_000, OP_COOLDOWN_MS = 5_000, OP_HORIZON_MS = 60_000;
const OP_LOCKED_STATES = ["ENTRY_COUNTDOWN", "WAITING_ENTRY_CONFIRMATION", "POSITION_CONFIRMED", "IN_POSITION", "WAITING_SETTLEMENT"];
function emptyChannel() { return { state: "READY", signal: null, countdownEndsAt: 0, confirmationDeadline: 0, manualEntry: null, settlementAt: 0, settlement: null, cooldownUntil: 0, researchDecisions: 0, midTradeFlips: 0, metrics: { operationalSignals: 0, entryConfirmed: 0, entryNotConfirmed: 0, preEntryInvalidations: 0, manualTradesSettled: 0, manualWins: 0, manualLosses: 0, manualDraws: 0, manualUnknown: 0, midTradeDirectionFlips: 0, withTrendSignals: 0, counterTrendSignals: 0 } }; }
state.channel = emptyChannel();
function channelLog(name, detail) { console.info(name, JSON.stringify(detail || {})); }
function channelRelease(channel, stateName) { const from = channel.state; channel.state = stateName; channel.signal = null; channel.manualEntry = null; channel.settlementAt = 0; channelLog("OPERATION_CHANNEL_RELEASED", { to: stateName }); diagTransition("OperationalChannel", from, stateName, "channel_released", { traceId: state.currentTraceId }); }
function channelProfileSwitch() { const channel = state.channel; if (OP_LOCKED_STATES.includes(channel.state)) channelLog("PROFILE_SWITCH_DURING_OPERATION_IGNORED", { activeProfile: channel.signal?.profile, nextProfile: state.profile }); else channelLog("PROFILE_SWITCH_ARMED_FOR_NEXT_OPERATION", { profile: state.profile }); }
function renderOperational() {
  const channel = state.channel; if (!$("opStateValue")) return;
  text("opStateValue", channel.state);
  if (channel.signal && (channel.state === "ENTRY_COUNTDOWN" || channel.state === "WAITING_ENTRY_CONFIRMATION")) text("opDirectionValue", `${channel.signal.direction} · ${PROFILE_LABELS[channel.signal.profile] || channel.signal.profile} · ${channel.signal.regime || "UNCERTAIN"}`);
  else if (channel.manualEntry && channel.signal) text("opDirectionValue", `${channel.signal.direction} · entrada ${channel.manualEntry.price}`);
  else if (channel.settlement) text("opDirectionValue", `${channel.settlement.result}`);
  else text("opDirectionValue", "Sem operação ativa");
  text("opEntryValue", channel.manualEntry ? String(channel.manualEntry.price) : "—");
  const now = Date.now();
  if (channel.state === "ENTRY_COUNTDOWN") text("opCountdownValue", `${Math.max(0, Math.ceil((channel.countdownEndsAt - now) / 1000))}s`);
  else if (channel.state === "WAITING_ENTRY_CONFIRMATION") text("opCountdownValue", `confirmação até ${Math.max(0, Math.ceil((channel.confirmationDeadline - now) / 1000))}s`);
  else if (channel.state === "IN_POSITION") text("opCountdownValue", `${Math.max(0, Math.ceil((channel.settlementAt - now) / 1000))}s`);
  else text("opCountdownValue", "—");
  if ($("opResultValue")) text("opResultValue", channel.settlement ? channel.settlement.result : "—");
}
function channelCandidate(fast, candleId, frameId) {
  const channel = state.channel; const direction = fast.decision; const now = Date.now();
  const opposite = (direction === "BUY" || direction === "SELL") && channel.signal && direction !== channel.signal.direction && (fast.rawConfidence || 0) >= .7 && (fast.reversalEvidence?.length || 0) >= 1;
  if ((channel.state === "ENTRY_COUNTDOWN" || channel.state === "WAITING_ENTRY_CONFIRMATION") && opposite) { channel.metrics.preEntryInvalidations += 1; channel.cooldownUntil = now + OP_COOLDOWN_MS; channelLog("SIGNAL_INVALIDATED_BEFORE_ENTRY", { signalId: channel.signal.signalId, reason: "opposite_confident_reversal", oppositeDirection: direction, rawConfidence: fast.rawConfidence }); channelRelease(channel, "COOLDOWN"); renderOperational(); return; }
  if (OP_LOCKED_STATES.includes(channel.state)) { channel.researchDecisions += 1; if (channel.state === "IN_POSITION" && channel.signal && (direction === "BUY" || direction === "SELL") && direction !== channel.signal.direction) { channel.midTradeFlips += 1; channel.metrics.midTradeDirectionFlips += 1; channelLog("MID_TRADE_DIRECTION_FLIP", { signalId: channel.signal.signalId, from: channel.signal.direction, to: direction, rawConfidence: fast.rawConfidence }); } renderOperational(); return; }
  if (channel.state === "COOLDOWN") { if (now < channel.cooldownUntil) { channel.researchDecisions += 1; return; } channelRelease(channel, "READY"); }
  const decisive = direction === "BUY" || direction === "SELL"; const counterOk = !fast.counterTrend || (fast.reversalEvidence?.length || 0) >= 1;
  if (!decisive || !counterOk) { channel.researchDecisions += 1; if (!counterOk) channelLog("COUNTER_TREND_SIGNAL_BLOCKED", { direction, macroTrend: fast.macroTrend, reversalEvidence: fast.reversalEvidence || [] }); renderOperational(); return; }
  channel.signal = { signalId: `op_${now}_${Math.random().toString(36).slice(2, 8)}`, direction, profile: fast.selectedProfile, rawConfidence: fast.rawConfidence, regime: fast.regime, macroTrend: fast.macroTrend, microTrend: fast.microTrend, trendAlignment: fast.trendAlignment, counterTrend: fast.counterTrend, createdAt: now, entryWindowMs: OP_ENTRY_MS, predictionHorizonSeconds: 60, contextVersion: fast.deepContextVersion, candleId, frameId, status: "ACTIVE" };
  channel.state = "ENTRY_COUNTDOWN"; channel.countdownEndsAt = now + OP_ENTRY_MS; channel.metrics.operationalSignals += 1; if (fast.counterTrend) channel.metrics.counterTrendSignals += 1; else channel.metrics.withTrendSignals += 1;
  channelLog("OPERATIONAL_SIGNAL_CREATED", { signalId: channel.signal.signalId, direction, profile: fast.selectedProfile, rawConfidence: fast.rawConfidence, regime: fast.regime, macroTrend: fast.macroTrend, microTrend: fast.microTrend, trendAlignment: fast.trendAlignment, counterTrend: fast.counterTrend, reversalEvidence: fast.reversalEvidence || [], candleId, frameId });
  channelLog("OPERATIONAL_SIGNAL_LOCKED", { signalId: channel.signal.signalId });
  channelLog("ENTRY_COUNTDOWN_STARTED", { signalId: channel.signal.signalId, countdownEndsAt: channel.countdownEndsAt });
  diagTransition("OperationalChannel", "READY", "ENTRY_COUNTDOWN", "signal_locked", { signalId: channel.signal.signalId, traceId: state.currentTraceId, marketEventId: candleId });
  const operationalDecisionId = state.decisionId && String(state.decisionId).startsWith("op_") ? `decision_${state.decisionId}` : (state.decisionId || `decision_${candleId}`);
  void liveEmit("OPERATIONAL_SIGNAL_CREATED", { signalId: channel.signal.signalId, decisionId: operationalDecisionId, marketEventId: candleId, frameId, candleId, direction, profile: fast.selectedProfile, rawConfidence: fast.rawConfidence, regime: fast.regime, macroTrend: fast.macroTrend, microTrend: fast.microTrend, trendAlignment: fast.trendAlignment, issuedAt: now, countdownEndsAt: channel.countdownEndsAt, traceId: state.currentTraceId });
  void liveEmit("OPERATIONAL_SIGNAL_LOCKED", { signalId: channel.signal.signalId, decisionId: operationalDecisionId, marketEventId: candleId, frameId, candleId, direction, profile: fast.selectedProfile, rawConfidence: fast.rawConfidence, calibratedConfidence: fast.calibratedConfidence ?? null, issuedAt: now, countdownEndsAt: channel.countdownEndsAt, macroTrend: fast.macroTrend, microTrend: fast.microTrend, regime: fast.regime, trendAlignment: fast.trendAlignment, traceId: state.currentTraceId });
  void liveEmit("ENTRY_COUNTDOWN_STARTED", { signalId: channel.signal.signalId, countdownEndsAt: channel.countdownEndsAt, traceId: state.currentTraceId });
  channel.signal.decisionId = operationalDecisionId;
  renderOperational();
}
async function settleManualOperation(priceRow) {
  const channel = state.channel, signal = channel.signal, entry = channel.manualEntry; if (!signal || !entry) return;
  try {
    const body = { direction: signal.direction, entryPrice: entry.price, exitPrice: priceRow ? priceRow.value : null, entryTimestamp: entry.timestamp, exitTimestamp: Date.now(), dueTimestamp: channel.settlementAt };
    if (!priceRow || !priceRow.priceObservationId) { console.warn("SETTLEMENT_PRICE_UNAVAILABLE", JSON.stringify({ signalId: signal.signalId, reason: "no_causal_observation_with_id" })); }
    const result = await api("/api/settlement", { method: "POST", body: JSON.stringify(body) });
    channel.state = "SETTLED"; channel.settlement = { ...body, result: result.outcome }; if (signal) signal.status = "SETTLED";
    channel.metrics.manualTradesSettled += 1; if (result.outcome === "WIN") channel.metrics.manualWins += 1; else if (result.outcome === "LOSS") channel.metrics.manualLosses += 1; else if (result.outcome === "DRAW") channel.metrics.manualDraws += 1; else channel.metrics.manualUnknown += 1;
    channel.cooldownUntil = Date.now() + OP_COOLDOWN_MS;
    channelLog("SETTLEMENT_PRICE_LOCKED", { signalId: signal.signalId, exitPrice: priceRow ? priceRow.value : null, source: priceRow ? priceRow.source : "UNAVAILABLE", confidence: priceRow ? priceRow.confidence : 0, settlementPriceObservationId: priceRow ? priceRow.priceObservationId : null });
    channelLog("TRADE_SETTLED", { signalId: signal.signalId, result: result.outcome, reason: result.reason });
    diagTransition("Settlement", "IN_POSITION", "SETTLED", `result_${result.outcome}`, { signalId: signal.signalId, traceId: state.currentTraceId });
    const groundTruth = { groundTruthId: `gt_${signal.signalId}`, decisionId: signal.decisionId || null, signalId: signal.signalId, operationId: `operation_${signal.signalId}`, marketEventId: signal.candleId || null, entryPriceObservationId: entry.priceObservationId || null, settlementPriceObservationId: priceRow ? priceRow.priceObservationId : null, entryPrice: entry.price, settlementPrice: priceRow ? priceRow.value : null, result: result.outcome, traceId: state.currentTraceId || null };
    postDiag("/api/live/browser/ground-truth", { groundTruth });
    void liveEmit("SETTLEMENT_PRICE_LOCKED", { signalId: signal.signalId, settlementPrice: priceRow ? priceRow.value : null, settlementPriceObservationId: priceRow ? priceRow.priceObservationId : null, traceId: state.currentTraceId });
    void liveEmit("TRADE_SETTLED", { signalId: signal.signalId, decisionId: signal.decisionId || null, operationId: `operation_${signal.signalId}`, result: result.outcome, groundTruthId: groundTruth.groundTruthId, traceId: state.currentTraceId });
    diagProvenance({ decisionId: signal.decisionId || state.decisionId || signal.signalId, marketEventId: signal.candleId, candleId: signal.candleId, frameId: signal.frameId, profile: signal.profile, decision: signal.direction, directionalLean: signal.direction, rawScores: { rawConfidence: signal.rawConfidence }, why: { primaryReasons: [`settlement_${result.outcome}`], supportingEvidence: [`entryPrice=${entry.price}`, `source=${entry.source}`], opposingEvidence: [], rejectedAlternatives: [], uncertaintyFactors: result.outcome === "UNKNOWN" ? ["missing_settlement_price"] : [], riskFactors: [] }, warnings: result.outcome === "UNKNOWN" ? ["SETTLEMENT_UNKNOWN"] : [], traceId: state.currentTraceId });
    void liveEmit("SETTLEMENT", { decisionId: signal.signalId, direction: signal.direction, result: result.outcome, entryPrice: entry.price, settlementPrice: priceRow ? priceRow.value : null, manual: true, synthetic: false });
  } catch (error) { channelLog("SETTLEMENT_WAITING", { reason: String(error?.message || error).slice(0, 120) }); }
  renderOperational();
}
function channelManualPosition(manual) {
  const channel = state.channel; if (channel.state !== "ENTRY_COUNTDOWN" && channel.state !== "WAITING_ENTRY_CONFIRMATION" && channel.state !== "POSITION_DETECTION_UNCERTAIN") return;
  if (manual.state === "POSSIBLE_POSITION") { channel.state = channel.state === "POSITION_DETECTION_UNCERTAIN" ? "WAITING_ENTRY_CONFIRMATION" : channel.state; channel.confirmationDeadline = Math.max(channel.confirmationDeadline || 0, Date.now() + 8000); console.info("MANUAL_POSITION_POSSIBLE", JSON.stringify({ signalId: channel.signal?.signalId, evidence: manual.evidence, confirmationDeadline: channel.confirmationDeadline })); renderOperational(); return; }
  if (manual.state !== "POSITION_CONFIRMED" && manual.state !== "WAITING_SETTLEMENT" && manual.state !== "SETTLED") return;
  const signal = channel.signal; if (!signal) return;
  if (manual.direction !== "UNKNOWN" && manual.direction !== signal.direction) { channelLog("POSITION_DIRECTION_MISMATCH", { expected: signal.direction, detected: manual.direction }); return; }
  const now = Date.now(); const priceRow = latestCausalPrice(now);
  if (!priceRow) { channel.state = "POSITION_DETECTION_UNCERTAIN"; channelLog("MANUAL_ENTRY_PRICE_UNAVAILABLE", { signalId: signal.signalId }); renderOperational(); return; }
  channel.state = "IN_POSITION"; channel.manualEntry = { price: priceRow.value, confidence: priceRow.confidence, source: priceRow.source, timestamp: now, signalId: signal.signalId, priceObservationId: priceRow.priceObservationId || null, frameId: priceRow.frameId || null, observedAt: priceRow.timestamp }; channel.settlementAt = now + OP_HORIZON_MS; channel.metrics.entryConfirmed += 1;
  void liveEmit("POSITION_CONFIRMED", { signalId: signal.signalId, direction: manual.direction, confidence: manual.confidence, evidence: manual.evidence, traceId: state.currentTraceId });
  void liveEmit("MANUAL_ENTRY_PRICE_LOCKED", { signalId: signal.signalId, price: priceRow.value, entryPriceObservationId: priceRow.priceObservationId || null, entryFrameId: priceRow.frameId || null, entryObservedAt: priceRow.timestamp, entrySource: priceRow.source, entryConfidence: priceRow.confidence, entryPriceAgeMs: now - priceRow.timestamp, traceId: state.currentTraceId });
  channelLog("POSITION_CONFIRMED", { signalId: signal.signalId, direction: manual.direction, confidence: manual.confidence, evidence: manual.evidence });
  channelLog("MANUAL_ENTRY_PRICE_LOCKED", { price: priceRow.value, source: priceRow.source, confidence: priceRow.confidence, timestamp: now, signalId: signal.signalId });
  channelLog("OPERATION_IN_PROGRESS", { signalId: signal.signalId, settlementAt: channel.settlementAt });
  diagTransition("ManualPosition", channel.confirmationDeadline ? "WAITING_ENTRY_CONFIRMATION" : "ENTRY_COUNTDOWN", "IN_POSITION", "visual_position_confirmed", { signalId: signal.signalId, traceId: state.currentTraceId });
  renderOperational();
}
setInterval(() => {
  const channel = state.channel, now = Date.now();
  if (channel.state === "ENTRY_COUNTDOWN" && now >= channel.countdownEndsAt) { channel.state = "WAITING_ENTRY_CONFIRMATION"; channel.confirmationDeadline = channel.countdownEndsAt + OP_CONFIRM_MS; channelLog("ENTRY_CONFIRMATION_WAITING", { signalId: channel.signal?.signalId }); }
  else if (channel.state === "WAITING_ENTRY_CONFIRMATION" && now >= channel.confirmationDeadline) { channel.metrics.entryNotConfirmed += 1; channelLog("ENTRY_NOT_CONFIRMED", { signalId: channel.signal?.signalId }); channel.cooldownUntil = now + OP_COOLDOWN_MS; channelRelease(channel, "COOLDOWN"); }
  else if (channel.state === "IN_POSITION" && now >= channel.settlementAt) { void settleManualOperation(latestCausalPrice(now)); }
  else if (channel.state === "COOLDOWN" && now >= channel.cooldownUntil) channelRelease(channel, "READY");
  else if (channel.state === "SETTLED" && now >= channel.cooldownUntil) channelRelease(channel, "READY");
  renderOperational();
}, 1000);

const api = async (path, options = {}) => {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { diagCapture("browser", response.status >= 500 ? "error" : "warn", "HTTP_ERROR", `${response.status} ${path}`, { status: response.status, route: path }); throw new Error(body.error || `HTTP ${response.status}`); }
  return body;
};
const text = (id, value) => { $(id).textContent = value; };
const led = (id, stateName) => { $(id).className = stateName || ""; };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const diagQueue = [];
function diagCapture(component, level, event, message, structuredData) { try { diagQueue.push({ logId: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, component, level, event, message: String(message).slice(0, 300), structuredData: structuredData || {}, traceId: state.currentTraceId || `trace_${event}_${Date.now()}`, codeVersion: "web-v1" }); if (diagQueue.length >= 25) void flushDiagnostics(); } catch { /* diagnostics must never break the app */ } }
async function flushDiagnostics() { if (!state.liveSessionId || !diagQueue.length) return; const logs = diagQueue.splice(0, 50); try { await fetch("/api/live/browser/logs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: state.liveSessionId, logs }) }); } catch { /* best-effort */ } }
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => diagCapture("browser", "error", "UNCAUGHT_ERROR", event.message || "unknown", { source: event.filename, line: event.lineno }));
  window.addEventListener("unhandledrejection", (event) => diagCapture("browser", "error", "UNHANDLED_REJECTION", event.reason?.message || String(event.reason || "unknown")));
  for (const level of ["warn", "error"]) { const original = console[level].bind(console); console[level] = (...args) => { original(...args); try { diagCapture("browser", level, level === "error" ? "CONSOLE_ERROR" : "CONSOLE_WARN", args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" ").slice(0, 280)); } catch { /* never break logging */ } }; }
  setInterval(() => void flushDiagnostics(), 15_000);
}
function postDiag(route, payload) { if (!state.liveSessionId) return; void fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: state.liveSessionId, ...payload }) }).catch(() => {}); }
function diagSpan(component, operation, startedAt, completedAt, status, relatedIds) { if (!state.liveSessionId) return; postDiag("/api/live/browser/spans", { spans: [{ spanId: `span_${startedAt}_${Math.random().toString(36).slice(2, 6)}`, parentSpanId: state.currentSpanId || null, traceId: state.currentTraceId || null, component, operation, startedAt, completedAt, latencyMs: completedAt - startedAt, status, relatedIds: relatedIds || {} }] }); }
function diagTransition(machine, from, to, reason, related) { if (!state.liveSessionId) return; postDiag("/api/live/browser/state-transitions", { transitions: [{ machine, from, to, reason, ...(related || {}) }] }); }
function diagProvenance(provenance) { if (!state.liveSessionId) return; postDiag("/api/live/browser/provenance", { provenance }); }

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
  const event = { sessionId: state.liveSessionId, type, sequenceId: `${state.liveSessionId}:${++state.liveSequence}`, traceId: state.currentTraceId || `trace_${type}_${Date.now()}`, payload, session: { source: "VISION_WEB", shadowOnly: true } };
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
async function trackPrice() {
  if (state.priceAnalyzing || !state.stream) return; const crop = priceCrop(); if (!crop) return; state.priceAnalyzing = true; const capturedAt = Date.now(), frameId = `price_${capturedAt}`;
  try {
    const history = state.priceObservations.slice(-12).map((item) => ({ value: item.value, timestamp: item.timestamp }));
    const outlierCandidates = state.priceOutlierCandidates.slice(-6).map((item) => ({ value: item.value, timestamp: item.timestamp }));
    const result = await api("/api/vision/price", { method: "POST", body: JSON.stringify({ frameId, dataUrl: crop.dataUrl, mimeType: "image/jpeg", width: crop.width, height: crop.height, history, outlierCandidates }) });
    const observation = result.priceObservation, validation = result.validation || {};
    const value = Number(observation?.value), confidence = Number(observation?.confidence) || 0;
    const priceObservationId = `po_${capturedAt}_${Math.random().toString(36).slice(2, 6)}`;
    const common = { priceObservationId, marketEventId: state.lastCandleId || null, frameId, candleId: state.lastCandleId || null, observedAt: Number(observation?.timestamp) || Date.now(), receivedAt: Date.now(), source: observation?.source || "UNAVAILABLE", confidence, traceId: state.currentTraceId || null };
    if (Number.isFinite(value) && value > 0 && observation?.accepted !== false) {
      const row = { ...common, priceObservationId, value, timestamp: Number(observation.timestamp) || Date.now(), frameId, hash: observation.imageHash || null };
      state.priceObservations = [...state.priceObservations, row].slice(-120); state.metrics.priceObservationsValid += 1;
      if (validation.status === "REGIME_CHANGE_ACCEPTED") state.priceOutlierCandidates = [];
      text("currentPriceValue", value.toString());
      postDiag("/api/live/browser/prices", { prices: [{ ...common, value, status: "ACCEPTED", outlierStatus: validation.status || "ACCEPTED" }] });
      console.info("PRICE_OBSERVATION", JSON.stringify({ price: value, confidence, source: row.source, timestamp: row.timestamp, frameId, ageMs: row.timestamp - capturedAt, validation: validation.status, priceObservationId }));
    } else if (Number.isFinite(value) && value > 0) {
      state.priceOutlierCandidates = [...state.priceOutlierCandidates, { value, timestamp: Date.now() }].slice(-10); state.metrics.priceObservationsRejected += 1;
      postDiag("/api/live/browser/prices", { prices: [{ ...common, value, status: "REJECTED", rejectionReason: validation.reason || "UNKNOWN", outlierStatus: validation.status || "OUTLIER" }] });
      console.warn("PRICE_OBSERVATION_REJECTED", JSON.stringify({ reason: validation.reason || "UNKNOWN", rawPrice: value, previousPrice: validation.previousPrice ?? null, rollingMedian: validation.rollingMedian ?? null, relativeDeviation: validation.relativeDeviation ?? null, confidence, frameId, priceObservationId }));
    } else {
      postDiag("/api/live/browser/prices", { prices: [{ ...common, value: null, status: "UNAVAILABLE" }] });
      console.info("PRICE_OBSERVATION_UNAVAILABLE", JSON.stringify({ frameId, reason: "UNREADABLE" }));
    }
  } catch (error) { console.info("PRICE_OBSERVATION_UNAVAILABLE", JSON.stringify({ frameId, reason: String(error?.message || error).slice(0, 120) })); } finally { state.priceAnalyzing = false; }
}
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
  if (state.timer) clearTimeout(state.timer); state.timer = null; if (state.priceTimer) clearInterval(state.priceTimer); state.priceTimer = null; if (state.deepTimer) clearInterval(state.deepTimer); state.deepTimer = null; state.deepRunning = false;
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
function startObservation() { if (state.timer) clearTimeout(state.timer); state.failures = 0; state.nextRetryAt = 0; state.circuitOpen = false; scheduleNextCandle(); startDeepAnalysis(); }
async function observe() {
  if (state.analyzing) { state.metrics.analysisSkippedBusy += 1; const pending = Math.floor(Date.now() / (CANDLE_SECONDS * 1000)) * CANDLE_SECONDS * 1000; console.info("ANALYSIS_SKIPPED_BUSY", JSON.stringify({ candleId: `candle_${pending}`, metrics: state.metrics })); return; }
  if (!state.stream || !state.crop || Date.now() < state.nextRetryAt) return;
  if (state.circuitOpen) { state.circuitOpen = false; state.failures = 0; setStage("CIRCUIT_HALF_OPEN"); }
  const session = state.session, stream = state.stream, candleCloseTimestamp = Math.floor(Date.now() / (CANDLE_SECONDS * 1000)) * CANDLE_SECONDS * 1000, candleId = `candle_${candleCloseTimestamp}`;
  if (state.lastCandleId === candleId) return;
  state.decisionId = `decision_${candleCloseTimestamp}_${Math.random().toString(36).slice(2, 8)}`;
  state.decisionSource = "FAST_THEN_DEEP";
  state.deepRequested = true;
  state.deepExecuted = false;
  state.metrics.analysisStarted += 1;
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
  state.currentTraceId = `trace_${candleId}`;
  const snapshot = { analysisId: state.decisionId || `vision_${Date.now()}`, decisionId: state.decisionId || null, decisionSource: "FAST_THEN_DEEP", deepRequested: true, deepExecuted: false, requestId, sessionId: state.liveSessionId, traceId: state.currentTraceId, marketEventId: candleId, candleId, frameId, candleOpenTimestamp: candleCloseTimestamp - CANDLE_SECONDS * 1000, candleCloseTimestamp, candleSeconds: CANDLE_SECONDS, visibleWindowSeconds: VISIBLE_WINDOW_SECONDS, timestamp: new Date().toISOString(), timestampMs: Date.now(), symbol: state.lastContext?.symbol || "UNAVAILABLE", assetResolution: { visionAsset: null, uiAsset: state.lastContext?.symbol || null, sessionAsset: null, status: state.lastContext?.symbol ? "SESSION_CONFIRMED" : "UNKNOWN" }, horizonSeconds: EXPIRATION_SECONDS, chartFrame: { frameId, crop: state.crop, width: chart.width, height: chart.height, capturedAt: Date.now(), mimeType: "image/jpeg", byteLength, imageHash }, temporalContext: state.observations.slice(-60), quantitativeFeatures: { availability: "SCREEN_MOTION_ONLY", frames: state.frames.map((item) => ({ ...item.stats, sample: undefined })) } };
  state.lastCandleId = candleId;
  try {
    console.info("VISION_REQUEST_PREPARED", JSON.stringify({ requestId, frameId, hasImage: true, bytes: byteLength, hash: imageHash, width: chart.width, height: chart.height, route: "deep_background" }));
    const started = Date.now(); setStage("FAST_PATH_STARTED"); state.metrics.fastStarted += 1; state.currentTraceId = `trace_${candleId}`; const fastSpanStart = started;
    const fastResponse = await api("/api/fast/decision", { method: "POST", body: JSON.stringify({
      now: Date.now(), candleId, candleSeconds: CANDLE_SECONDS, predictionHorizonSeconds: EXPIRATION_SECONDS, profile: state.profile,
      prices: state.priceObservations.slice(-120).map((item) => ({ value: item.value, timestamp: item.timestamp })),
      frames: state.frames.map((item) => ({ capturedAt: item.capturedAt, frameDifference: item.stats?.frameDifference ?? null, averageLuma: item.stats?.averageLuma ?? null })),
      deepContext: state.deepContext.at ? { version: state.deepContext.version, at: state.deepContext.at, trend: state.deepContext.trend, momentum: state.deepContext.momentum, regime: state.deepContext.regime } : null,
      previousDecision: state.lastAnalysis?.decision || null, previousLean: state.lastAnalysis?.directionalLean || null,
      previousMacroState: state.macroState || null, decisionId: state.decisionId, sessionId: state.liveSessionId, traceId: state.currentTraceId, marketEventId: candleId, frameId, decisionSource: "FAST_THEN_DEEP", deepRequested: true, deepExecuted: false,
    }) });
    const fast = fastResponse.fast; const fastLatency = Date.now() - started; state.metrics.fastLatencies = [...state.metrics.fastLatencies, fastLatency].slice(-200);
    if (fast.fastPathStatus !== "FAST_PATH_COMPLETED" || fastLatency > FAST_DEADLINE_MS) { state.metrics.fastTimeouts += 1; setStage("FAST_PATH_TIMEOUT", `${fastLatency}ms`); console.warn("FAST_PATH_TIMEOUT", JSON.stringify({ candleId, status: fast.fastPathStatus, latencyMs: fastLatency, deadlineMs: FAST_DEADLINE_MS })); return; }
    if (!fast.operational) { setStage("FAST_PATH_NOT_OPERATIONAL", `${fastLatency}ms`); console.info("FAST_PATH_NOT_OPERATIONAL", JSON.stringify({ candleId, latencyMs: fastLatency, reason: "insufficient_causal_price_evidence", status: fast.fastPathStatus })); return; }
    console.info("FAST_PATH_COMPLETED", JSON.stringify({ candleId, decision: fast.decision, profile: fast.selectedProfile, regime: fast.regime, macroTrend: fast.macroTrend, microTrend: fast.microTrend, trendAlignment: fast.trendAlignment, deepFastAlignment: fast.deepFastAlignment, rawConfidence: fast.rawConfidence, latencyMs: fastLatency, timings: fast.timings }));
    diagSpan("fast-path", "FAST_PATH", fastSpanStart, Date.now(), "OK", { candleId });
    diagSpan("fast-path", "REGIME", fastSpanStart, Date.now(), "OK", { regime: fast.regime, macroTrend: fast.macroTrend, microTrend: fast.microTrend });
    state.macroState = fast.macroState || state.macroState;
    channelCandidate(fast, candleId, frameId);
    diagProvenance({
      decisionId: (typeof state.decisionId === "string" && state.decisionId.startsWith("decision_")) ? state.decisionId : (state.channel.signal ? state.channel.signal.signalId : `decision_${candleId}`), marketEventId: candleId, frameId, candleId, profile: fast.selectedProfile,
      agentRunIds: state.deepContext.agentRunIds || [], arbiterRunId: state.deepContext.arbiterRunId || null, fusionRunId: state.deepContext.fusionRunId || null, bullRunId: state.deepContext.bullRunId || null, bearRunId: state.deepContext.bearRunId || null,
      contextVersions: { deep: state.deepContext.version || 0 }, priceObservationIds: (() => { const row = latestCausalPrice(Date.now()); return row && row.frameId ? [row.frameId] : []; })(),
      decision: fast.decision, directionalLean: fast.directionalLean,
      rawScores: { bullScore: fast.bullScore, bearScore: fast.bearScore, rawConfidence: fast.rawConfidence }, calibratedScores: {},
      why: { primaryReasons: [fast.fastPathStatus, `regime=${fast.regime}`], supportingEvidence: [`macroTrend=${fast.macroTrend}`, `microTrend=${fast.microTrend}`, `trendAlignment=${fast.trendAlignment}`, ...((fast.reversalEvidence || []).slice(0, 4))], opposingEvidence: fast.counterTrend ? [`counter_trend_reason=${fast.counterTrendReason || "unknown"}`] : [], rejectedAlternatives: [], uncertaintyFactors: fast.conflictScore > .6 ? [`conflictScore=${fast.conflictScore.toFixed(2)}`] : [], riskFactors: fast.counterTrend ? ["counter_trend"] : [] },
      conflicts: fast.deepFastAlignment === "CONFLICT" ? ["deep_fast_conflict"] : [], warnings: [], traceId: state.currentTraceId,
    });
    const result = { analysis: { decision: fast.decision, confidence: fast.rawConfidence, rawConfidence: fast.rawConfidence, directionalLean: fast.directionalLean, leanConfidence: fast.leanConfidence, regime: fast.regime, regimeConfidence: fast.regimeConfidence, profiles: fast.profiles, selectedProfile: fast.selectedProfile, predictionHorizonSeconds: fast.predictionHorizonSeconds, candleSeconds: fast.candleSeconds, expirationSeconds: EXPIRATION_SECONDS, confidenceBuckets: null, fastTimings: fast.timings, visionObservation: state.deepContext.observation, imageUsed: Boolean(state.deepContext.observation), imageStatus: state.deepContext.observation ? "IMAGE_PROVIDED" : "IMAGE_NOT_PROVIDED", marketContext: state.lastContext || {} } };
    if (session !== state.session || stream !== state.stream || state.lastCandleId !== candleId) { console.info("STALE_DECISION", JSON.stringify({ requestId, candleId, currentCandleId: state.lastCandleId })); return; }
    const latency = Date.now() - started, candleAgeMs = Date.now() - candleCloseTimestamp, stale = candleAgeMs > ANALYSIS_STALE_MS;
    state.failures = 0; state.nextRetryAt = 0; state.metrics.analysisCompleted += 1; if (stale) state.metrics.analysisStale += 1;
    state.lastAnalysis = { ...result.analysis, stale }; state.observations = [...state.observations, { candleId, frameId, candleCloseTimestamp, timestamp: Date.now(), visionObservation: result.analysis?.visionObservation || null, directionalLean: result.analysis?.directionalLean || "NONE", pBuy: result.analysis?.pBuy ?? null, pSell: result.analysis?.pSell ?? null, pWait: result.analysis?.pWait ?? null, stale }].slice(-60);
    console.info("ARBITER_DECISION", JSON.stringify({ candleId, frameId, decision: result.analysis?.decision || "WAIT", directionalLean: result.analysis?.directionalLean || "NONE", latencyMs: latency, candleAgeMs, stale, timings: result.analysis?.timing || null }));
    state.hasSuccessfulAnalysis = true; renderAnalysis(state.lastAnalysis, latency); await persistDecision(snapshot, result.analysis || {});
    if (stale) console.warn("STALE_ANALYSIS", JSON.stringify({ candleId, frameId, candleAgeMs, thresholdMs: ANALYSIS_STALE_MS, decision: result.analysis?.decision || "WAIT", metrics: state.metrics }));
    else {
      await trainIfActive(snapshot, result.analysis || {}, stat, latency);
      if (result.analysis?.decision === "WAIT" && ["BUY", "SELL"].includes(result.analysis?.directionalLean)) { console.info("SHADOW_LEAN_CREATED", JSON.stringify({ candleId, frameId, direction: result.analysis.directionalLean, leanConfidence: result.analysis.leanConfidence ?? null })); void liveEmit("SHADOW_UPDATE", { candleId, frameId, direction: result.analysis.directionalLean, leanConfidence: result.analysis.leanConfidence ?? null, pBuy: result.analysis?.pBuy ?? null, pSell: result.analysis?.pSell ?? null, pWait: result.analysis?.pWait ?? null, counterfactual: true }); }
    }
     void liveEmit("DECISION", { decisionId: state.decisionId, sessionId: state.liveSessionId, traceId: state.currentTraceId, marketEventId: candleId, candleId, frameId, decisionSource: state.decisionSource || "FAST", deepRequested: state.deepRequested, deepExecuted: state.deepExecuted, direction: result.analysis?.decision || "WAIT", confidence: result.analysis?.confidence ?? null, probabilitySource: result.analysis?.probabilitySource || "FABLE_5_1", pBuy: result.analysis?.pBuy ?? null, pSell: result.analysis?.pSell ?? null, pWait: result.analysis?.pWait ?? null, directionalLean: result.analysis?.directionalLean || "NONE", multiAgent: result.analysis?.multiAgent || null, latencyMetrics: result.analysis?.latencyMetrics || null, stale, analysisMetrics: { ...state.metrics } });
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

async function deepAnalyze() {
  if (state.deepRunning || !state.stream || !state.crop) return;
  state.deepRunning = true; const started = Date.now(); const frameId = `deep_${started}`; const versionAtStart = state.deepContext.version;
  try {
    console.info("DEEP_ANALYSIS_STARTED", JSON.stringify({ frameId, contextVersion: versionAtStart }));
    const chart = makeCrop(state.crop); if (!chart) return;
    const temporal = state.frames.slice().reverse().map((item, index) => ({ label: index ? `T-${index * 5}s` : "T0", frameId: item.frameId, dataUrl: item.dataUrl, mimeType: "image/jpeg", byteLength: item.byteLength, width: item.width, height: item.height, imageHash: item.imageHash }));
    if (!temporal.length) temporal.push({ label: "T0", frameId, dataUrl: chart.dataUrl, mimeType: "image/jpeg", byteLength: dataUrlBytes(chart.dataUrl), width: chart.width, height: chart.height, imageHash: await cropHash(chart.dataUrl) });
    const canonicalCandleId = state.lastCandleId || `candle_${Math.floor(Date.now() / (CANDLE_SECONDS * 1000)) * CANDLE_SECONDS * 1000}`; state.lastCandleId = canonicalCandleId; state.currentTraceId = `trace_${canonicalCandleId}`; state.decisionId = (typeof state.decisionId === "string" && state.decisionId.startsWith("decision_")) ? state.decisionId : `decision_${started}_${Math.random().toString(36).slice(2, 8)}`; const snapshot = { analysisId: state.decisionId, decisionId: state.decisionId, decisionSource: "FAST_THEN_DEEP", deepRequested: true, deepExecuted: false, requestId: frameId, sessionId: state.liveSessionId, traceId: state.currentTraceId, marketEventId: canonicalCandleId, candleId: canonicalCandleId, frameId, candleSeconds: CANDLE_SECONDS, visibleWindowSeconds: VISIBLE_WINDOW_SECONDS, horizonSeconds: EXPIRATION_SECONDS, predictionHorizonSeconds: EXPIRATION_SECONDS, timestampMs: Date.now(), symbol: state.lastContext?.symbol || "UNAVAILABLE", chartFrame: { frameId }, quantitativeFeatures: { availability: "SCREEN_MOTION_ONLY", frames: state.frames.map((item) => ({ ...item.stats, sample: undefined })) } };
    const result = await api("/api/fable/trade", { method: "POST", body: JSON.stringify({ snapshot, chartImages: temporal, contextImage: headerCrop()?.dataUrl || null }) });
    if (state.deepContext.version !== versionAtStart) { console.info("DEEP_ANALYSIS_DISCARDED", JSON.stringify({ frameId, versionAtStart, currentVersion: state.deepContext.version })); return; }
    const analysis = result.analysis || {};
    state.deepExecuted = true; state.deepContext = { version: versionAtStart + 1, at: Date.now(), observation: analysis.visionObservation || null, trend: analysis.trend || null, momentum: analysis.momentum || null, regime: analysis.regime || null, latencyMs: Date.now() - started, agentRunIds: Array.isArray(analysis.agentRunIds) ? analysis.agentRunIds : [], arbiterRunId: analysis.arbiterRunId || null, fusionRunId: analysis.fusionRunId || null, bullRunId: analysis.bullRunId || null, bearRunId: analysis.bearRunId || null, specialistRunIds: Array.isArray(analysis.specialistRunIds) ? analysis.specialistRunIds : [] };
    console.info("DEEP_ANALYSIS_COMPLETED", JSON.stringify({ frameId, version: state.deepContext.version, latencyMs: state.deepContext.latencyMs, availability: analysis.visionObservation?.availability || "UNAVAILABLE" }));
    void liveEmit("SHADOW_UPDATE", { deepContextVersion: state.deepContext.version, deepLatencyMs: state.deepContext.latencyMs, regime: state.deepContext.regime });
    diagProvenance({ decisionId: state.decisionId, sessionId: state.liveSessionId, traceId: state.currentTraceId, marketEventId: state.lastCandleId, candleId: state.lastCandleId, frameId, decisionSource: "FAST_THEN_DEEP", deepRequested: true, deepExecuted: true, agentRunIds: analysis.agentRunIds || [], arbiterRunId: analysis.arbiterRunId || null, fusionRunId: analysis.fusionRunId || null, bullRunId: analysis.bullRunId || null, bearRunId: analysis.bearRunId || null, decision: analysis.decision || "WAIT", directionalLean: analysis.directionalLean || "NONE", profile: state.profile, contextVersions: { deep: versionAtStart + 1 }, rawScores: {}, calibratedScores: {}, conflicts: [], warnings: [] });
    void liveEmit("DECISION", { decisionId: state.decisionId, sessionId: state.liveSessionId, traceId: state.currentTraceId, marketEventId: state.lastCandleId, candleId: state.lastCandleId, frameId, decisionSource: "FAST_THEN_DEEP", deepRequested: true, deepExecuted: true, direction: analysis.decision || "WAIT", confidence: analysis.confidence ?? null, agentRunIds: analysis.agentRunIds || [] });
    await persistDecision(snapshot, analysis);
  } catch (error) { console.info("DEEP_ANALYSIS_FAILED", JSON.stringify({ frameId, reason: String(error?.message || error).slice(0, 140) })); }
  finally { state.deepRunning = false; }
}
function startDeepAnalysis() { if (state.deepTimer) clearInterval(state.deepTimer); state.deepTimer = setInterval(() => { void deepAnalyze(); }, DEEP_INTERVAL_MS); void deepAnalyze(); }

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
function updateManualPosition(observation, analysis) { const raw = observation?.manualPosition; if (!raw || !["POSSIBLE_POSITION", "POSITION_CONFIRMED", "WAITING_SETTLEMENT", "SETTLED"].includes(raw.state)) return; const evidence = Array.isArray(raw.evidence) ? raw.evidence.slice(0, 4) : []; const panelCue = evidence.some((item) => /panel|posi|card|open|opera|expir|opç|opc|acima|abaixo|stake|invest/i.test(String(item))); const direction = panelCue && ["BUY", "SELL"].includes(raw.direction) ? raw.direction : "UNKNOWN"; state.manualPosition = { state: raw.state, direction, hasOpenPosition: raw.hasOpenPosition === true || panelCue, confidence: Number(raw.confidence) || 0, evidence }; text("manualPositionValue", `${state.manualPosition.state} · ${state.manualPosition.direction}`); text("manualPositionMeta", `${Math.round(state.manualPosition.confidence * 100)}% · ${state.manualPosition.evidence.join(" · ") || "evidência visual"}`); void liveEmit("SHADOW_UPDATE", { manualPosition: state.manualPosition, decisionId: analysis?.analysisId || null, directionalLean: analysis?.directionalLean || "NONE" }); channelManualPosition(state.manualPosition); }
function renderAnalysis(analysis, latency) {
  const decision = ["BUY", "SELL", "WAIT"].includes(analysis.decision) ? analysis.decision : "WAIT", confidence = Number(analysis.confidence) || 0;
  $("decisionBox").className = `decision-box state-${decision.toLowerCase()}`; text("decisionValue", decision); text("decisionSummary", analysis.summary || analysis.rationale || "Sem conclusão verificável."); text("confidenceValue", `${Math.round(confidence * 100)}%`); $("confidenceBar").style.transform = `scaleX(${clamp(confidence, 0, 1)})`;
  text("pBuyValue", probabilityText(analysis.pBuy)); text("pSellValue", probabilityText(analysis.pSell)); text("pWaitValue", probabilityText(analysis.pWait));
  text("dataQualityValue", Number.isFinite(Number(analysis.dataQuality)) ? `${Math.round(Number(analysis.dataQuality) * 100)}%` : "N/A"); text("confluenceValue", Number.isFinite(Number(analysis.confluence)) ? `${Math.round(Number(analysis.confluence) * 100)}%` : "N/A"); text("regimeValue", analysis.regime || "N/A"); text("trendValue", analysis.trend || "N/A"); text("momentumValue", analysis.momentum || "N/A"); text("visionValue", analysis.imageUsed ? "CROP PASS" : "SEM IMAGEM"); if ($("profileLine")) text("profileLine", `Perfil: ${PROFILE_LABELS[state.profile] || state.profile} · Horizonte: ${analysis.predictionHorizonSeconds || EXPIRATION_SECONDS}s · Regime: ${analysis.regime || "UNCERTAIN"}`); if ($("calibrationValue")) text("calibrationValue", analysis.calibrationStatus ? `Calibration: ${analysis.calibrationStatus}` : "Calibration: INSUFFICIENT_SAMPLE"); text("visionStatusValue", analysis.visionObservation?.availability || analysis.imageStatus || "UNAVAILABLE"); text("parseStatusValue", analysis.visionObservation?.parseMode || "—"); text("assetStatusValue", analysis.assetResolution?.status || "UNKNOWN"); text("candleStatusValue", `${analysis.candleSeconds || 5}s / ${analysis.expirationSeconds || 60}s`); text("directionalLeanValue", analysis.directionalLean || "NONE"); text("leanText", analysis.directionalLean && analysis.directionalLean !== "NONE" ? `Lean ${analysis.directionalLean} · ${probabilityText(analysis.leanConfidence)} · não operacional` : "Sem direção dominante no WAIT."); updateManualPosition(analysis.visionObservation, analysis); text("latencyValue", `${(latency / 1000).toFixed(1)}s`); text("analysisAge", `Análise ${new Date().toLocaleTimeString()} · ${latency}ms`); text("chartViewQuality", Number.isFinite(Number(analysis.chartView?.score)) ? `${Math.round(Number(analysis.chartView.score))}/100` : "N/A"); setFable("ONLINE");
  const guidance = $("agentGuidance"); const wantsAdjustment = ["REQUEST_ZOOM_OUT", "REQUEST_ZOOM_IN"].includes(analysis.agentAction);
  guidance.hidden = !wantsAdjustment; if (wantsAdjustment) { text("guidanceText", analysis.guidanceMessage || (analysis.agentAction === "REQUEST_ZOOM_OUT" ? "Preciso de mais contexto histórico. Abra um pouco mais o gráfico." : "Preciso enxergar melhor os candles recentes. Aproxime o gráfico.")); text("guidanceReason", `Contexto ${analysis.chartView?.historicalContext ?? "N/A"}/100 · detalhe recente ${analysis.chartView?.recentDetail ?? "N/A"}/100`); }
  const context = analysis.marketContext || {}; state.lastContext = context.symbol !== "UNAVAILABLE" && Number(context.confidence) >= .6 ? context : state.lastContext; const shown = state.lastContext || context;
  text("contextAsset", shown.symbol && shown.symbol !== "UNAVAILABLE" ? `${shown.symbol}${shown.marketType && shown.marketType !== "UNAVAILABLE" ? ` ${shown.marketType}` : ""}` : "Ativo não confirmado"); text("contextMeta", (shown.sources || []).join(" · ") || "Confirme manualmente somente se a visão não provar o ativo."); text("contextTimeframe", shown.visualTimeframe || "—"); text("contextStake", shown.displayedStake ?? "—"); text("contextConfidence", shown.confidence ? `${Math.round(shown.confidence * 100)}%` : "—"); text("statusAsset", shown.symbol || "—"); text("marketLabel", shown.symbol || "Gráfico compartilhado");
  const sizing = suggestedStake(analysis); text("suggestedStake", sizing.amount ? `R$ ${sizing.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "R$ —"); text("sizingNote", sizing.reason);
  const now = Date.now(); const rawDecisionId = analysis.decisionId || (typeof state.decisionId === "string" && state.decisionId.startsWith("decision_") ? state.decisionId : analysis.analysisId); state.decisionId = (typeof rawDecisionId === "string" && rawDecisionId.length && ["decision_", "op_", "local-", "decision_candle_"].some((prefix) => rawDecisionId.startsWith(prefix))) ? rawDecisionId : `decision_${now}_${Math.random().toString(36).slice(2, 8)}`; state.decisionTimestamp = now; state.expirationSeconds = Number(analysis.expirationSeconds) > 0 ? Number(analysis.expirationSeconds) : 60;
  if (!OP_LOCKED_STATES.includes(state.channel.state)) { state.entryUntil = decision === "BUY" || decision === "SELL" ? now + 10_000 : 0; state.reanalysisAt = decision === "WAIT" ? now + 5_000 : 0; }
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
  const channel = state.channel;
  if (channel.signal && (channel.state === "ENTRY_COUNTDOWN" || channel.state === "WAITING_ENTRY_CONFIRMATION" || channel.state === "IN_POSITION")) {
    const reference = channel.state === "IN_POSITION" ? channel.settlementAt : channel.state === "ENTRY_COUNTDOWN" ? channel.countdownEndsAt : channel.confirmationDeadline;
    const left = Math.max(0, reference - now);
    if (clock) { text("clockValue", String(Math.ceil(left / 1000)).padStart(2, "0")); text("clockState", channel.state === "IN_POSITION" ? "OPERAÇÃO ATIVA" : channel.state === "ENTRY_COUNTDOWN" ? "ENTRADA EM" : "AGUARDANDO ENTRADA"); text("clockText", channel.state === "IN_POSITION" ? `Settlement do sinal ${channel.signal.signalId} em ${Math.ceil(left / 1000)}s.` : channel.state === "ENTRY_COUNTDOWN" ? `Sinal ${channel.signal.signalId} · janela de entrada em ${Math.ceil(left / 1000)}s.` : `Sinal ${channel.signal.signalId} aguardando confirmação visual da posição.`); }
    if (left) state.countdownTimer = window.setTimeout(updateEntryCountdown, 250);
    return;
  }
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

const TRAINING_CONFIG_KEY = "tracecom:training-config";
function trainingConfig() { return { symbol: state.lastContext?.symbol || null, marketType: state.lastContext?.marketType || null, horizonSeconds: 60, maxEvaluatedTrades: 100, agentVersion: "FABLE_TRADER_V1", promptVersion: "vision-v1", featureVersion: "screen-motion-v1", visionVersion: "sanitized-crop-v1" }; }
async function startTraining() {
  const config = trainingConfig();
  const session = await api("/api/training/sessions", { method: "POST", body: JSON.stringify(config) });
  state.training = session; localStorage.setItem("tracecom:training-session", session.id); localStorage.setItem(TRAINING_CONFIG_KEY, JSON.stringify(config)); $("startTrainingButton").hidden = true; $("stopTrainingButton").hidden = false; text("trainingTitle", "Treinamento ativo"); text("trainingState", "ATIVO"); text("trainingNote", `Somente operações virtuais (${session.persistence}). Sem clique, stake ou ordem na IQ Option.`); renderTraining(session);
}
async function recoverTraining() {
  const sessionId = state.training?.id; if (!sessionId) return;
  console.info("TRAINING_SESSION_RECOVERY_STARTED", JSON.stringify({ sessionId }));
  try {
    const config = JSON.parse(localStorage.getItem(TRAINING_CONFIG_KEY) || "{}");
    const session = await api("/api/training/sessions", { method: "POST", body: JSON.stringify({ ...config, sessionId }) });
    state.training = session; renderTraining(session); liveStatus("READY", "Sessão de treino recuperada.");
    console.info("TRAINING_SESSION_RECOVERED", JSON.stringify({ sessionId: session.id, persistence: session.persistence }));
  } catch (error) {
    console.error("TRAINING_SESSION_RECOVERY_FAILED", JSON.stringify({ sessionId, error: String(error?.message || error).slice(0, 160) }));
    state.training = null; localStorage.removeItem("tracecom:training-session"); localStorage.removeItem(TRAINING_CONFIG_KEY);
    $("startTrainingButton").hidden = false; $("stopTrainingButton").hidden = true; text("trainingTitle", "Treino interrompido"); text("trainingState", "ERRO"); text("trainingNote", "Sessão não pôde ser recuperada; polling encerrado para este ID.");
  }
}
async function stopTraining() { const id = state.training?.id; if (id) { try { await api(`/api/training/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: "{}" }); } catch { /* best-effort stop */ } } state.training = null; localStorage.removeItem("tracecom:training-session"); $("startTrainingButton").hidden = false; $("stopTrainingButton").hidden = true; text("trainingTitle", "Treino pausado"); text("trainingState", "PAUSADO"); }
async function trainIfActive(snapshot, analysis, stat) {
    if (!state.training) return; const sizing = suggestedStake(analysis); analysis.profiles = analysis.profiles || null; const causalPrice = latestCausalPrice(snapshot.timestampMs); const hasProvenance = Boolean(causalPrice && causalPrice.priceObservationId); const referencePrice = hasProvenance ? causalPrice.value : null; const referencePriceSource = hasProvenance ? causalPrice.source : "UNAVAILABLE"; const referencePriceConfidence = hasProvenance ? causalPrice.confidence : 0; if (!hasProvenance) console.warn("ENTRY_PRICE_UNAVAILABLE", JSON.stringify({ candleId: snapshot.candleId, reason: "no_causal_price_observation_with_id", decision: analysis.decision })); else if (analysis.decision === "BUY" || analysis.decision === "SELL" || ["BUY", "SELL"].includes(analysis.directionalLean)) console.info("ENTRY_PRICE_LOCKED", JSON.stringify({ price: referencePrice, entryPriceObservationId: causalPrice.priceObservationId, entryFrameId: causalPrice.frameId, entryObservedAt: causalPrice.timestamp, entrySource: referencePriceSource, entryConfidence: referencePriceConfidence, entryPriceAgeMs: snapshot.timestampMs - causalPrice.timestamp, lockTimestamp: Date.now(), candleId: snapshot.candleId })); const result = await api("/api/training/analyze", { method: "POST", body: JSON.stringify({ trainingSessionId: state.training.id, snapshot: { ...snapshot, symbol: state.lastContext?.symbol || "UNAVAILABLE", referencePrice, referencePriceSource, priceConfidence: referencePriceConfidence, framesHash: frameHash(stat), features: { motion: stat } }, analysis, suggestedStake: sizing.amount || null, profiles: analysis.profiles || null, selectedProfile: analysis.selectedProfile || state.profile, regime: analysis.regime || null, rawConfidence: analysis.rawConfidence ?? null, calibratedConfidence: analysis.calibratedConfidence ?? null, synthetic: false, payoutAtDecision: null, breakEvenWinRate: null }) }); state.training = result; renderTraining(result);
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
  if ($("profileStats")) { const profiles = session.profiles || {}; const fmt = (id) => { const item = profiles[id]; return item ? `${id.slice(0, 3)}: ${item.BUY || 0}/${item.SELL || 0}/${item.WAIT || 0} · SR ${item.signalRate == null ? "—" : `${Math.round(Number(item.signalRate) * 100)}%`} · WR ${item.WR == null ? "—" : `${Math.round(Number(item.WR) * 100)}%`}` : `${id.slice(0, 3)}: —`; }; text("profileStats", `${fmt("CONSERVATIVE")} | ${fmt("BALANCED")} | ${fmt("AGGRESSIVE")}`); }
  if ($("calibrationValue") && session.calibration) text("calibrationValue", `Calibration: ${session.calibration.status} · evaluadas ${session.calibration.evaluated} · sintéticas excluídas ${session.calibration.excludedSynthetic} · horizonte ${session.predictionHorizonSeconds || 60}s`);
  const note = $("trainingNote");
  if (note && session.persistence) note.textContent = `Persistência: ${session.persistence}. ${pending} operação(ões) aguardando o horizonte causal; WAIT directional lean: ${session.directionalLeanEvaluated || 0} avaliados, WR ${session.directionalLeanWR == null ? "—" : `${Math.round(Number(session.directionalLeanWR) * 100)}%`}.`;
}
async function restoreTraining() { const id = localStorage.getItem("tracecom:training-session"); if (!id) return; state.training = { id }; try { const session = await api(`/api/training/sessions/${encodeURIComponent(id)}`); state.training = session; $("startTrainingButton").hidden = true; $("stopTrainingButton").hidden = false; renderTraining(session); } catch (error) { if (String(error?.message || "").includes("training_session_not_found")) await recoverTraining(); else { state.training = null; localStorage.removeItem("tracecom:training-session"); } } }
async function refreshTraining() { if (!state.training) return; try { const session = await api(`/api/training/sessions/${encodeURIComponent(state.training.id)}`); state.training = session; renderTraining(session); } catch (error) { if (String(error?.message || "").includes("training_session_not_found")) await recoverTraining(); /* transient errors keep polling; 404 has explicit recovery */ } }
function liveStatus(label, note) { text("liveAccessStatus", label); if (note) text("liveAccessNote", note); }
async function ensureAdminSession() { try { const current = await api("/api/live/admin/session"); if (current.authenticated) return true; } catch { /* fall through to bootstrap */ } try { await api("/api/live/admin/bootstrap", { method: "POST", body: "{}" }); return true; } catch { return false; } }
function openAdminDialog() { const dialog = $("adminDialog"); if (!dialog) return; $("adminKeyBox").hidden = true; $("adminKeyValue").textContent = ""; delete $("adminKeyValue").dataset.keyId; dialog.showModal(); }
function closeAdminDialog() { const dialog = $("adminDialog"); $("adminKeyValue").textContent = ""; delete $("adminKeyValue").dataset.keyId; $("adminKeyBox").hidden = true; $("adminRevokeConfirm").hidden = true; if (dialog?.open) dialog.close(); }
async function generateLiveKey(rotate = false) {
  if (!(await ensureAdminSession())) { liveStatus("ERROR", "Painel não autorizado pelo servidor."); return; }
  liveStatus("LOADING", rotate ? "Rotacionando chave…" : "Gerando chave…");
  try {
    const dialog = $("adminDialog"); const keyBox = $("adminKeyValue"); const previousId = keyBox.dataset.keyId;
    const days = Number($("adminExpiration")?.value) || 0; const payload = { name: "OpenCode Live Access", preset: "OPENCODE_FULL_DIAGNOSTIC" };
    if (days > 0) payload.expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
    const result = await api("/api/live/admin/keys", { method: "POST", body: JSON.stringify(payload) });
    if (rotate && previousId) { try { await api(`/api/live/admin/keys/${encodeURIComponent(previousId)}/revoke`, { method: "POST", body: "{}" }); } catch { /* previous may be gone */ } }
    keyBox.dataset.keyId = result.id; keyBox.textContent = result.key; $("adminKeyBox").hidden = false; $("adminRevokeConfirm").hidden = false;
    if (!dialog?.open) dialog?.showModal();
    liveStatus("READY", "Chave exibida uma única vez. Copie-a com segurança.");
  } catch (error) { liveStatus("ERROR", error.message); }
}
async function rotateLiveKey() { return generateLiveKey(true); }
async function revokeLiveKey() { const keyBox = $("adminKeyValue"), id = keyBox?.dataset.keyId; if (!id) { liveStatus("ERROR", "Nenhuma chave ativa nesta sessão da UI."); return; } liveStatus("LOADING", "Revogando…"); try { await api(`/api/live/admin/keys/${encodeURIComponent(id)}/revoke`, { method: "POST", body: "{}" }); keyBox.textContent = "Chave revogada"; delete keyBox.dataset.keyId; $("adminRevokeConfirm").hidden = true; liveStatus("REVOKED", "A chave foi revogada."); } catch (error) { liveStatus("ERROR", error.message); } }
async function refreshAdminSession() { try { const value = await api("/api/live/admin/session"); liveStatus(value.authenticated ? "READY" : "OFFLINE", value.authenticated ? "Sessão administrativa ativa." : "Autorize para administrar chaves."); } catch { /* best-effort */ } }
async function copyOpenCodePrompt() { const text = [
  "Você possui FULL DIAGNOSTIC READ ACCESS ao TraceCom.",
  "Use TRACE_COM_API_KEY via env. NUNCA imprima a key. NUNCA acesse secrets. NUNCA clique ou envie ordem.",
  "1) Descubra a sessão live (GET /api/live/session).",
  "2) Conecte ao SSE (GET /api/live/stream) com Last-Event-ID.",
  "3) Leia debug-snapshot, timeline, logs e traces da sessão.",
  "4) Liste agent runs e abra arbiter/fusion/bull/bear/specialists por ID.",
  "5) Siga a DecisionProvenance até o frame original.",
  "6) Rode autopsy, audit, replay causal, shadow evaluations e compare variantes.",
  "7) Agrupe failures e gere relatório técnico.",
  "Prove cada conclusão com traceId, decisionId, agentRunId, marketEventId, frameId e groundTruthId. Não afirme bug sem evidência.",
].join("\n"); try { await navigator.clipboard.writeText(text); liveStatus("READY", "Prompt do OpenCode copiado (sem secrets)."); } catch { liveStatus("ERROR", "Não foi possível copiar o prompt."); } }
async function refreshLiveStatus() { try { const value = await api("/api/live/admin/status"); text("liveAccessMeta", `${value.relayStatus || "ONLINE"} / ${value.db ? "READY" : "OFFLINE"} / ${state.liveSessionId || "—"}`); liveStatus(value.relayStatus === "ONLINE" ? "READY" : "OFFLINE"); } catch { liveStatus("OFFLINE", "Relay indisponível."); } }
async function copyLiveInstructions() { try { await navigator.clipboard.writeText("TraceCon Live Access (read-only)\nEnvie somente frames crop-only e telemetria para /api/live/session/frame/latest. Nunca envie credenciais, cookies, tokens, saldo ou imagens integrais."); liveStatus("READY", "Instruções copiadas."); } catch { liveStatus("ERROR", "Não foi possível copiar as instruções."); } }
function escape(value) { return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

$("shareButton").addEventListener("click", shareScreen); $("stopShareButton").addEventListener("click", stopScreen); $("recropButton").addEventListener("click", openManualCrop); $("startTrainingButton").addEventListener("click", () => startTraining().catch((error) => text("trainingNote", error.message))); $("stopTrainingButton").addEventListener("click", stopTraining); $("liveGenerateKey")?.addEventListener("click", () => generateLiveKey(false)); $("liveRotateKey")?.addEventListener("click", () => generateLiveKey(true)); $("liveRevokeKey")?.addEventListener("click", revokeLiveKey); $("liveCopyInstructions")?.addEventListener("click", copyLiveInstructions); $("liveCopyPrompt")?.addEventListener("click", copyOpenCodePrompt);
$("adminGenerateConfirm")?.addEventListener("click", () => generateLiveKey(false)); $("adminRotateConfirm")?.addEventListener("click", () => generateLiveKey(true)); $("adminRevokeConfirm")?.addEventListener("click", revokeLiveKey); $("adminClose")?.addEventListener("click", closeAdminDialog); $("adminCopyKey")?.addEventListener("click", async () => { const value = $("adminKeyValue")?.textContent || ""; if (!value) return; try { await navigator.clipboard.writeText(value); liveStatus("READY", "Chave copiada. Guarde-a agora."); } catch { liveStatus("ERROR", "Não foi possível copiar."); } });
void ensureAdminSession(); bindManualCrop(); $("profileSelect")?.addEventListener("change", (event) => applyProfile(event.target.value)); applyProfile(state.profile); checkBackend(); updatePipeline(); restoreTraining(); refreshLiveStatus(); setInterval(refreshLiveStatus, 30000); setInterval(refreshTraining, 5000); window.addEventListener("beforeunload", stopScreen);
