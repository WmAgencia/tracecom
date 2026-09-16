/* strategy-console.js — Area Operacional, selecao MANUAL/AUTO, banca, historico e treinamento.
 * Consome apenas endpoints reais (/api/strategies/*). Nenhuma execucao de corretora. */
const LIMIT_PCT = 5.0; // limite por operacao = 5% da banca (sem martingale; nao aumenta apos LOSS)
const REFRESH_MS = 15_000;
const formatBRL = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const state = { control: null, stats: null, page: "operational", historyFilter: { family: "", result: "" } };
const $id = (id) => document.getElementById(id);
const setText = (id, value) => { const node = $id(id); if (node) node.textContent = value; };
async function jget(path) { const response = await fetch(path, { headers: { accept: "application/json" } }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`); return body; }
async function jput(path, payload) { const response = await fetch(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`); return body; }
const pct = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : `${Number(value).toFixed(1)}%`);

function navigate(page) {
  state.page = page;
  document.querySelectorAll(".page").forEach((node) => { node.hidden = node.id !== `page-${page}`; });
  document.querySelectorAll(".nav-item[data-page]").forEach((node) => node.classList.toggle("active", node.dataset.page === page));
  if (page === "history") void loadHistory();
  if (page === "training") void loadStats();
  if (page === "operational" || page === "settings") void loadStats();
}

function bankroll() {
  const stored = Number(localStorage.getItem("tracecom:bankroll") || "500");
  return Number.isFinite(stored) && stored > 0 ? stored : 500;
}
function renderBankroll() {
  const total = bankroll();
  const limit = (total * LIMIT_PCT) / 100;
  setText("bankrollLimit", formatBRL(limit));
  const input = $id("bankrollTotal"); if (input && String(input.value) !== String(total)) input.value = String(total);
  const legacy = $id("sessionBudget"); if (legacy && String(legacy.value) !== String(total)) legacy.value = String(total);
}

function renderControl() {
  const control = state.control ?? {};
  const selection = control.selection ?? null;
  const stats = state.stats ?? {};
  const variants = Array.isArray(stats.variants) ? stats.variants : [];
  const mode = selection?.mode === "AUTO" ? "AUTOMÁTICO" : "MANUAL";
  setText("strategyModeBadge", mode);
  setText("sidebarSelection", selection ? `${selection.variantId} · ${mode}` : "Sem seleção");
  const compatibility = control.compatibility;
  const warning = $id("horizonWarning");
  if (warning) {
    if (compatibility && compatibility.compatible === false && compatibility.reason === "HORIZON_INCOMPATIBLE") { warning.hidden = false; warning.textContent = `HORIZONTE INCOMPATÍVEL — selecionada ${selection?.horizonSeconds}s; broker detectado ${compatibility.brokerHorizonSeconds ?? "?"}s. Operação bloqueada até compatibilizar (shadow continua).`; }
    else { warning.hidden = true; }
  }
  const list = $id("strategyList"); if (!list) return;
  const families = ["V3", "V8", "V2", "V1"];
  const labels = { V3: "V3 + Fibonacci", V8: "V8 Structure + Fibonacci", V2: "V2 + Fibonacci", V1: "V1 + Fibonacci" };
  const rows = [];
  const autoSelected = selection?.mode === "AUTO";
  rows.push(`<button type="button" class="strategy-row auto ${autoSelected ? "selected" : ""}" data-auto="1"><b>◉ AUTOMÁTICO</b><span class="fine">O agente seleciona automaticamente entre as estratégias elegíveis (N mínimo, WR e Wilson lower; conservador — mantém a atual se nada elegível).</span></button>`);
  for (const family of families) {
    const familyVariants = variants.filter((variant) => variant.family === family);
    const horizons = [45, 60, 120, 180, 300].filter((h) => familyVariants.some((v) => v.horizonSeconds === h));
    if (!horizons.length) { const def = { V3: [45, 60, 120, 180, 300], V8: [45, 60], V2: [60, 120], V1: [300] }[family] ?? []; horizons.push(...def); }
    const header = `<div class="strategy-family"><b>${labels[family]}</b><span class="fine">${horizons.length} horizonte${horizons.length > 1 ? "s" : ""} · WR e N reais do shadow engine</span></div>`;
    const buttons = horizons.map((horizon) => {
      const variant = familyVariants.find((v) => v.horizonSeconds === horizon) ?? null;
      const wr = variant ? pct(variant.wr) : "—";
      const n = variant ? variant.independentN : 0;
      const selected = selection && selection.family === family && selection.horizonSeconds === horizon && !autoSelected;
      const warn = variant && variant.independentN < 30 ? " sample-badge" : "";
      return `<button type="button" class="strategy-horizon ${selected ? "selected" : ""}" data-family="${family}" data-horizon="${horizon}" title="N=${n} (independentes)"><span>${horizon < 60 ? `${horizon}s` : `${horizon / 60}min`}</span><b>${wr}</b><em class="fine${warn}">n ${n}</em></button>`;
    }).join("");
    rows.push(`<div class="strategy-variant">${header}<div class="strategy-horizons">${buttons}</div></div>`);
  }
  list.innerHTML = rows.join("");
  list.querySelectorAll(".strategy-horizon").forEach((button) => button.addEventListener("click", () => void selectVariant(button.dataset.family, Number(button.dataset.horizon))));
  const autoButton = list.querySelector("[data-auto]"); if (autoButton) autoButton.addEventListener("click", () => void selectVariant(selection?.family ?? "V3", selection?.horizonSeconds ?? 60, "AUTO"));
  const notice = $id("selectionNotice");
  if (notice && !notice.dataset.sticky) { const selectedVariant = selection?.variantId ?? "—"; notice.hidden = false; notice.textContent = `Selecionada: ${selectedVariant} · aplicada a partir do próximo sinal se houver operação ativa.`; }
  // Provenance de confianca (metrica real: Wilson lower da variante selecionada).
  const provenance = $id("confidenceProvenance");
  if (provenance) {
    if (autoSelected) provenance.textContent = "CONFIANÇA: modo automático — calibração por variante selecionada.";
    else if (!selection) provenance.textContent = "CALIBRANDO — sem seleção.";
    else {
      const variant = familyVariantStats(selection);
      if (!variant || variant.independentN < 30) { provenance.textContent = `CALIBRANDO — n=${variant?.independentN ?? 0} (mínimo 30)`; setText("confidenceValue", "CALIBRANDO"); const bar = $id("confidenceBar"); if (bar) bar.style.transform = "scaleX(0)"; }
      else { provenance.textContent = `CALIBRADA — Wilson lower ${pct(variant.wilsonLower)} · n=${variant.independentN}`; const bar = $id("confidenceBar"); if (bar) bar.style.transform = `scaleX(${Math.min(1, Math.max(0, Number(variant.wilsonLower) || 0))})`; setText("confidenceValue", pct(variant.wilsonLower)); }
    }
  }
}
function familyVariantStats(selection) {
  const variants = state.stats?.variants;
  if (!Array.isArray(variants)) return null;
  const variant = variants.find((entry) => entry.family === selection.family && entry.horizonSeconds === selection.horizonSeconds);
  if (!variant) return null;
  const decided = (variant.independentWins ?? 0) + (variant.independentLosses ?? 0);
  const wr = decided > 0 ? (variant.independentWins / decided) * 100 : null;
  return { ...variant, wr: wr === null ? null : +wr.toFixed(2) };
}

async function selectVariant(family, horizonSeconds, mode = "MANUAL") {
  const notice = $id("selectionNotice");
  try {
    const result = await jput("/api/strategies/selection", { family, horizonSeconds, mode, reason: `ui:${mode}`, actor: "ui" });
    if (notice) { notice.hidden = false; notice.dataset.sticky = "1"; notice.textContent = `${result.selection?.variantId ?? `${family}-${horizonSeconds}`} selecionada · ${mode === "AUTO" ? "modo automático ativo" : "aplicada a partir do próximo sinal"}.`; }
    await loadStats();
  } catch (error) {
    if (notice) { notice.hidden = false; notice.textContent = `Falha ao selecionar: ${String(error?.message || error)}`; }
  }
}

async function loadStats() {
  try {
    const [control, stats] = await Promise.all([jget("/api/strategies/selection"), jget("/api/strategies/stats")]);
    state.control = control; state.stats = stats;
    renderControl();
    renderPromotion();
  } catch (error) {
    const list = $id("strategyList"); if (list) list.innerHTML = `<p class="fine">Shadow engine indisponível no momento. As variantes aparecem aqui automaticamente quando a conexão estiver ativa.</p>`;
  }
}

async function loadAiStatus() {
  try {
    const body = await jget("/api/ai/provider");
    setText("aiStatus", body.status === "CONFIGURED" ? `CONECTADO · ${body.provider ?? "openCodeGo"}${body.model ? ` · ${body.model}` : ""}` : "NÃO CONFIGURADO");
    setText("aiMasked", body.maskedKey ? `Chave armazenada (${body.maskedKey}) — nunca exibida por inteiro.` : "");
  } catch { setText("aiStatus", "ERRO"); }
}
async function saveAiKey() {
  const input = $id("aiApiKey"); if (!input) return;
  const value = String(input.value || "").trim();
  if (!value) return;
  try {
    await jput("/api/ai/provider", { apiKey: value });
    input.value = "";
    await loadAiStatus();
  } catch (error) { setText("aiStatus", `ERRO · ${String(error?.message || error).slice(0, 60)}`); }
}
function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
function formatExpiry(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < 60) return `${value}s`;
  if (value % 60 === 0) return `${value / 60}min`;
  return `${value}s`;
}
function renderSessionMetrics() {
  const snapshot = window.tracecomOperationalSnapshot?.();
  if (!snapshot) return;
  const captured = Boolean(snapshot.captured);
  setText("metricFrames", captured ? `${snapshot.frames}/${snapshot.framesTotal}` : "—");
  setText("metricTime", captured && snapshot.sessionAnalyzedMs > 0 ? formatDuration(snapshot.sessionAnalyzedMs) : "—");
  setText("metricCandles", captured ? String(snapshot.sessionValidCandles) : "—");
  const bias = captured ? snapshot.bias : null;
  setText("metricBias", !captured ? "—" : bias === "ALTA" ? "↑ ALTA" : bias === "BAIXA" ? "↓ BAIXA" : "→ NEUTRO");
  const asset = snapshot.asset ? `${snapshot.asset}${snapshot.assetMarketType === "OTC" ? " OTC" : ""}` : null;
  setText("configAsset", asset || (captured ? "IDENTIFICANDO…" : "—"));
  setText("configValue", snapshot.detectedAmount ? formatBRL(snapshot.detectedAmount) : (captured ? "IDENTIFICANDO…" : "—"));
  const expiry = formatExpiry(snapshot.detectedExpirationSeconds) || formatExpiry(snapshot.brokerExpirationSeconds);
  setText("configExpiry", expiry || (captured ? "IDENTIFICANDO…" : "—"));
}
async function loadHistory() {
  const body = $id("historyTableBody"); if (!body) return;
  try {
    const result = await jget("/api/strategies/history?limit=200");
    const rows = (result.history ?? []).filter((row) => (!state.historyFilter.family || `${row.family}` === state.historyFilter.family) && (!state.historyFilter.result || row.settled_outcome === state.historyFilter.result));
    setText("historyPageCount", String(rows.length));
    body.innerHTML = rows.map((row) => `<tr><td>${new Date(Number(row.signal_bucket)).toLocaleString("pt-BR")}</td><td>${row.family}</td><td>${row.horizon_seconds}s</td><td>${row.direction}</td><td>${Number(row.entry_price).toFixed(5)}</td><td>${row.settlement_price === null ? "—" : Number(row.settlement_price).toFixed(5)}</td><td class="result-${String(row.settled_outcome || "PENDING").toLowerCase()}">${row.settled_outcome ?? "PENDING"}</td><td class="fine">${String(row.strategy_hash).slice(0, 8)}</td></tr>`).join("") || `<tr><td colspan="8" class="fine">Sem sinais shadow ainda.</td></tr>`;
  } catch (error) { body.innerHTML = `<tr><td colspan="8" class="fine">Histórico indisponível: ${String(error?.message || error)}</td></tr>`; }
}

function renderPromotion() {
  const promotion = state.stats?.promotion;
  const stateRow = promotion?.state ?? null;
  setText("promoChampion", stateRow?.champion_variant ?? state.control?.selection?.variantId ?? "—");
  setText("promoCandidate", stateRow?.candidate_variant ?? "aguardando elegibilidade");
  setText("promoCandidateN", stateRow ? `${stateRow.candidate_training_n ?? 0} / 5000 trades novos` : "0 / 5000");
  setText("promoDecision", stateRow?.last_decision ?? "SEM_DECISAO");
  const reasons = stateRow?.last_decision_reason;
  setText("promoReason", reasons || "Gate congelado: 5000 trades OOS + Wilson lower + baseline + estabilidade.");
  setText("trainingPageState", "TRAINING 24H");
  const audit = promotion?.audit;
  const auditBody = $id("promotionAuditBody");
  if (auditBody && Array.isArray(audit)) auditBody.innerHTML = audit.map((row) => `<tr><td>${new Date(row.created_at).toLocaleString("pt-BR")}</td><td>${row.candidate_variant}</td><td>${row.champion_variant}</td><td>${row.decision}</td><td class="fine">${row.reason || (Array.isArray(row.reasons) ? row.reasons.join("; ") : "")}</td></tr>`).join("") || `<tr><td colspan="5" class="fine">Sem decisões de promoção ainda.</td></tr>`;
}

function bindUi() {
  document.querySelectorAll(".nav-item").forEach((node) => {
    node.addEventListener("click", () => {
      if (node.dataset.action === "share") { const share = $id("shareButton"); if (share) share.click(); navigate("operational"); return; }
      if (node.dataset.page) { navigate(node.dataset.page); const sidebar = $id("sidebar"); if (sidebar) sidebar.classList.remove("open"); }
    });
  });
  const navToggle = $id("navToggle");
  if (navToggle) navToggle.addEventListener("click", () => { const sidebar = $id("sidebar"); if (sidebar) sidebar.classList.toggle("open"); });
  const bankrollInput = $id("bankrollTotal");
  if (bankrollInput) bankrollInput.addEventListener("change", () => { const value = Math.max(0, Number(bankrollInput.value) || 0); localStorage.setItem("tracecom:bankroll", String(value)); renderBankroll(); });
  const historyStrategy = $id("historyFilterStrategy"); if (historyStrategy) historyStrategy.addEventListener("change", () => { state.historyFilter.family = historyStrategy.value; void loadHistory(); });
  const historyResult = $id("historyFilterResult"); if (historyResult) historyResult.addEventListener("change", () => { state.historyFilter.result = historyResult.value; void loadHistory(); });
  const refresh = $id("historyRefresh"); if (refresh) refresh.addEventListener("click", () => void loadHistory());
  const aiSave = $id("aiSaveKey"); if (aiSave) aiSave.addEventListener("click", () => void saveAiKey());
  renderBankroll();
  renderSessionMetrics();
  navigate("operational");
  void loadStats();
  void loadHistory();
  void loadAiStatus();
  setInterval(renderSessionMetrics, 3_000);
  setInterval(() => { if (state.page === "operational" || state.page === "training" || state.page === "settings") void loadStats(); }, REFRESH_MS);
  setInterval(() => { if (state.page === "history") void loadHistory(); }, 30_000);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindUi); else bindUi();
