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
async function jpost(path, payload) { const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`); return body; }
const pct = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : `${Number(value).toFixed(1)}%`);

function navigate(page) {
  state.page = page;
  document.querySelectorAll(".page").forEach((node) => { node.hidden = node.id !== `page-${page}`; });
  document.querySelectorAll(".nav-item[data-page]").forEach((node) => node.classList.toggle("active", node.dataset.page === page));
  if (page === "history") { void loadHistory(); void loadIqSignals(); }
  if (page === "iq") { void loadIqStatus(); void loadIqExecutions(); }
  if (page === "training") { void loadStats(); void loadIqTraining(); void loadIqLab(); }
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

const IQ_STATE_LABELS = { DISCONNECTED: "DESCONECTADO", CONNECTING: "CONECTANDO", TWO_FACTOR_REQUIRED: "2FA NECESSÁRIO", CONNECTED_READ_ONLY: "CONECTADO — PRACTICE", ERROR: "ERRO" };
const formatClock = (value) => { const ms = Number(value); return Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleTimeString("pt-BR") : "—"; };
const formatMoney = (currency, value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : `${String(currency || "")} ${Number(value).toFixed(2)}`.trim());
const formatLatency = (summary) => (!summary || !summary.count ? "—" : `p50 ${summary.p50}ms / p95 ${summary.p95}ms`);
function renderIq(status) {
  const state = String(status?.state ?? "DISCONNECTED");
  setText("iqStateBadge", IQ_STATE_LABELS[state] ?? "ERRO");
  setText("iqStatus", IQ_STATE_LABELS[state] ?? "ERRO");
  const detail = status?.lastError ? String(status.lastError) : status?.email ? `${status.email}${status.connectedAt ? " · sessão ativa" : ""}` : "Nenhuma sessão ativa.";
  setText("iqStatusDetail", detail);
  const twoFactorRow = $id("iqTwoFactorRow"); if (twoFactorRow) twoFactorRow.hidden = state !== "TWO_FACTOR_REQUIRED";
  const disconnect = $id("iqDisconnect"); if (disconnect) disconnect.hidden = status?.hasSession !== true;
  renderIqMarket(status?.marketData ?? null, status);
  renderIqAccount(status?.account ?? null, status?.execution ?? null);
  renderIqExecution(status?.execution ?? null);
}
function renderIqMarket(market, status) {
  const badge = $id("iqMarketBadge");
  const online = market?.connected === true && market?.healthy === true;
  if (badge) { badge.textContent = online ? "ONLINE" : market?.connected ? "DEGRADADO" : "OFFLINE"; badge.classList.toggle("online", online); }
  setText("iqServerTime", market?.connected ? `${formatClock(market?.serverTimeMs)} · skew ${market?.clockSkewMs ?? "?"}ms` : "—");
  setText("iqActiveValue", market?.activeId ? `#${market.activeId}${market.activeOtc ? " OTC" : ""} (${market.activeExpectedVsActual ?? "?"})` : "RESOLVENDO…");
  const tick = market?.lastTick;
  setText("iqLastTick", tick ? `${Number(tick.price).toFixed(5)} · ${tick.ageMs}ms` : "—");
  setText("iqCandles5s", market ? String(market.candles5s ?? 0) : "—");
  const latency = market?.latencyMs;
  setText("iqLatency", latency ? `${formatLatency(latency.serverToReceived)} · feature ${formatLatency(latency.normalizedToFeature)}` : "—");
  const features = market?.features;
  const detail = [];
  detail.push(`host ${market?.host ?? "—"} (repo ${market?.hostExpectedFromRepo ?? "iqoption.com"})`);
  if (market) detail.push(market.healthy ? "dados saudáveis" : `bloqueios: ${(market.healthReasons ?? []).join(", ") || "—"}`);
  if (features) detail.push(`RSI ${features.rsi14 === null ? "—" : Number(features.rsi14).toFixed(1)} · ATR ${features.atr14 === null ? "—" : Number(features.atr14).toFixed(5)} · ADX ${features.adx14 === null ? "—" : Number(features.adx14).toFixed(1)} · fresh ${features.fresh ? "OK" : features.freshnessReason}`);
  if (status?.runtimeVersion) detail.push(status.runtimeVersion);
  setText("iqMarketDetail", detail.join(" · "));
}
function renderIqAccount(account, execution) {
  const badge = $id("iqAccountBadge");
  const verified = account?.verified === true;
  if (badge) { badge.textContent = verified ? "PRACTICE VERIFIED" : account?.type === "REAL" ? "REAL — EXECUÇÃO PROIBIDA" : "NÃO VERIFICADA"; badge.classList.toggle("online", verified); }
  setText("iqAccountType", account ? String(account.type ?? "UNKNOWN") : "—");
  setText("iqAccountCurrency", account?.currency ?? "—");
  setText("iqAccountBalance", formatMoney(account?.currency, account?.balance));
  const armed = execution?.armed === true;
  setText("iqExecutionMode", !verified ? "BLOQUEADA (CONTA)" : armed ? "ARMADA" : "BLOQUEADA (DISARMED)");
  const detail = [];
  if (account?.hasReal) detail.push("conta REAL detectada — execução REAL permanentemente proibida");
  if (account?.balanceFailure) detail.push(`falha get_balances: ${account.balanceFailure}`);
  if (!verified && account?.type === "UNKNOWN") detail.push("aguardando get_balances server-side");
  setText("iqAccountDetail", detail.join(" · ") || "Tipo e saldo verificados no servidor via get_balances.");
}
function renderIqExecution(execution) {
  const badge = $id("iqExecutionBadge");
  const armed = execution?.armed === true;
  const killActive = execution?.killSwitch?.executionEnabled !== true;
  if (badge) { badge.textContent = killActive ? "KILL SWITCH" : armed ? `ARMADA ≤ ${formatBRL(execution?.userLimitBrl ?? 0)}` : String(execution?.state ?? "DISARMED"); badge.classList.toggle("online", armed && !killActive); }
  const killButton = $id("iqKillRelease"); if (killButton) killButton.hidden = !killActive;
  const armButton = $id("iqArm"); if (armButton) armButton.disabled = armed;
  const disarmButton = $id("iqDisarm"); if (disarmButton) disarmButton.disabled = !armed && !killActive;
  const pending = execution?.pendingOrder;
  const last = execution?.lastExecution;
  const detail = [];
  if (pending) detail.push(`ordem em curso ${pending.direction} stake ${pending.stake} ${pending.acked ? "ACK" : "aguardando ACK"}`);
  if (last) detail.push(`última: ${last.state}${last.brokerOrderId ? ` · ordem ${last.brokerOrderId}` : ""}${last.mismatch ? " · SETTLEMENT_MISMATCH" : ""}${last.brokerResult ? ` · broker ${last.brokerResult}/causal ${last.causalResult}` : ""}`);
  if (execution?.disarmReason) detail.push(`motivo disarm: ${execution.disarmReason}`);
  setText("iqExecutionDetail", detail.join(" · ") || "ARM exige conta PRACTICE verificada e market data saudável. O primeiro teste executa UMA ordem de stake mínimo e desarma em seguida. Sem ACK = UNKNOWN (nunca reenvia).");
}
async function loadIqStatus() {
  try { renderIq(await jget("/api/iq/status")); } catch { renderIq({ state: "DISCONNECTED", lastError: "Serviço indisponível no momento." }); }
}
async function loadIqExecutions() {
  const body = $id("iqExecutionsBody"); if (!body) return;
  try {
    const result = await jget("/api/iq/executions?limit=50");
    const rows = Array.isArray(result.executions) ? result.executions : [];
    body.innerHTML = rows.map((row) => `<tr><td>${row.requestedAt ? new Date(row.requestedAt).toLocaleString("pt-BR") : "—"}</td><td>${row.direction ?? "—"}</td><td>${row.stake ?? "—"} ${row.currency ?? ""}</td><td class="fine">${row.brokerOrderId ?? row.state}</td><td class="result-${String(row.state || "unknown").toLowerCase()}">${row.state ?? "—"}</td><td>${row.brokerResult ?? "—"}</td><td>${row.causalResult ?? "—"}${row.settlementMismatch ? " ⚠" : ""}</td><td>${row.profit ?? "—"}</td></tr>`).join("") || `<tr><td colspan="8" class="fine">Sem execuções ainda.</td></tr>`;
  } catch (error) { body.innerHTML = `<tr><td colspan="8" class="fine">Histórico indisponível: ${String(error?.message || error)}</td></tr>`; }
}
const IQ_SIGNAL_REASONS = {
  AUTO_DESLIGADO: "execução automática desligada",
  SISTEMA_DESARMADO: "sistema parado",
  PARADA_DE_EMERGENCIA: "parada de emergência acionada",
  POSICAO_JA_ABERTA: "já existe operação aberta",
  ORDEM_EM_ANDAMENTO: "ordem anterior em andamento",
  AGENTE_PAUSADO: "agente pausado",
  SEM_CONEXAO_IQ: "IQ Option desconectada",
  ACK_DESCONHECIDO: "ordem sem confirmação (não reenvia)",
  SINAL_JA_REGISTRADO: "sinal repetido ignorado",
  IDEMPOTENCIA: "sinal já executado (idempotência)",
};
const iqReason = (reason) => !reason ? "—" : (IQ_SIGNAL_REASONS[reason] ?? (String(reason).startsWith("GATE_") ? `gate: ${String(reason).slice(5)}` : String(reason).replaceAll("_", " ").toLowerCase()));
async function loadIqSignals() {
  const body = $id("iqSignalsBody"); if (!body) return;
  try {
    const result = await jget("/api/iq/signals?limit=60");
    const rows = Array.isArray(result.signals) ? result.signals : [];
    setText("iqSignalsCount", String(result.total ?? rows.length));
    body.innerHTML = rows.map((row) => `<tr>
      <td>${new Date(Number(row.at)).toLocaleString("pt-BR")}</td>
      <td>${row.display ?? row.marketKey}</td>
      <td><span class="office-badge ${row.marketType === "OTC" ? "otc" : "normal"}">${row.marketType}</span></td>
      <td>${row.action ?? "—"}</td>
      <td class="result-${String(row.disposition || "blocked").toLowerCase()}">${row.disposition ?? "—"}</td>
      <td class="fine">${iqReason(row.reason)}</td>
      <td>${row.stakeFinal ?? "—"}${row.stakeAdjustment?.applied ? ` <span class="fine">(config ${row.stakeRequested ?? row.stakeConfigured} → ${row.stakeAdjustment.to}: ${String(row.stakeAdjustment.reason).toLowerCase()})</span>` : ""}</td>
      <td class="fine">${row.brokerOrderId ?? (row.result ? `${row.result}${row.profit !== null && row.profit !== undefined ? ` ${Number(row.profit) >= 0 ? "+" : ""}${Number(row.profit).toFixed(2)}` : ""}` : "—")}</td>
    </tr>`).join("") || `<tr><td colspan="8" class="fine">Sem sinais registrados ainda.</td></tr>`;
  } catch (error) { body.innerHTML = `<tr><td colspan="8" class="fine">Sinais indisponíveis: ${String(error?.message || error)}</td></tr>`; }
}
async function loadIqTraining() {
  const body = $id("iqTrainingMarketsBody"); if (!body) return;
  try {
    const office = await jget("/api/iq/office");
    const stats = office.signalStats ?? {};
    setText("iqTrainingUpdated", `ATUALIZADO ${new Date().toLocaleTimeString("pt-BR")}`);
    const row = (market) => {
      const signalStats = stats[market.marketKey] ?? {};
      const daily = market.settlementState?.daily ?? {};
      return `<tr>
        <td>${market.display}</td>
        <td><span class="office-badge ${market.marketType === "OTC" ? "otc" : "normal"}">${market.marketType}</span></td>
        <td>${market.strategyEffective ?? market.strategy ?? "—"}</td>
        <td>${market.payout ?? "—"}%</td>
        <td>${signalStats.total ?? 0}</td>
        <td>${signalStats.executed ?? 0}</td>
        <td>${signalStats.blocked ?? 0}</td>
        <td>${signalStats.expired ?? 0}</td>
        <td>${daily.wins ?? 0}/${daily.losses ?? 0}/${daily.draws ?? 0}</td>
        <td>${Number.isFinite(Number(daily.settledPnl)) ? `${Number(daily.settledPnl) >= 0 ? "+" : ""}${Number(daily.settledPnl).toFixed(2)}` : "—"}</td>
        <td>${market.enabled ? (market.availability === "OPEN" ? `R$ ${Number(market.configuredStake ?? office.config?.defaultStake ?? 0).toFixed(2)}/op` : "AGUARDANDO MERCADO") : "DESLIGADO"}</td>
      </tr>`;
    };
    body.innerHTML = office.markets.map(row).join("") || `<tr><td colspan="11" class="fine">Nenhum mercado configurado.</td></tr>`;
  } catch (error) { body.innerHTML = `<tr><td colspan="11" class="fine">Treinamento indisponível: ${String(error?.message || error)}</td></tr>`; }
}
const AB_ARM_LABELS = { A_FROZEN: "A · Estratégia congelada", B_TRADER: "B · Trader", C_TRADER_CRITIC: "C · Trader + Crítico", D_PLUS_INTELLIGENCE: "D · + Inteligência global", E_ADAPTIVE: "E · Gestor adaptativo" };
async function loadIqLab() {
  const body = $id("iqLabBody"), abBody = $id("iqAbBody"), techBody = $id("iqTechniquesBody"); if (!body && !abBody && !techBody) return;
  try {
    const [research, manager, apprentice] = await Promise.all([jget("/api/iq/research/scoreboard"), jget("/api/iq/manager"), jget("/api/iq/apprentice").catch(() => ({ aggregate: [], techniques: [] }))]);
    setText("iqLabUpdated", `GESTOR: ${manager.mode === "AUTO_STRATEGY_SWITCH" ? "TROCA AUTOMÁTICA" : "SOMENTE RECOMENDAÇÃO"}`);
    const markets = research.scoreboard?.markets ?? [];
    const pct = (value) => (value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(1)}%`);
    if (body) body.innerHTML = markets.filter((market) => {
      const perMarket = (research.perMarket ?? []).find((row) => row.marketKey === market.marketKey);
      return perMarket || (market.variants ?? []).some((row) => row.trades > 0);
    }).map((market) => {
      const perMarket = (research.perMarket ?? []).find((row) => row.marketKey === market.marketKey) ?? {};
      const champion = perMarket.champion ?? market.variants.find((row) => row.variantId === (perMarket.championVariantId ?? research.champions?.[market.marketKey]));
      const challenger = perMarket.challenger ?? null;
      const delta = champion && challenger ? Number((challenger.recent?.pnlPerTrade ?? 0) - (champion.recent?.pnlPerTrade ?? 0)).toFixed(4) : null;
      return `<tr>
        <td>${market.marketKey}</td><td>${market.marketKey.includes(":OTC") ? "OTC" : "NORMAL"}</td>
        <td>${perMarket.championVariantId ?? "—"}</td><td>${champion?.trades ?? 0}</td><td>${pct(champion?.winRate)}</td><td>${champion?.pnl ?? 0}</td>
        <td>${challenger?.variantId ?? "—"}</td><td>${challenger?.trades ?? 0}</td><td>${pct(challenger?.winRate)}</td><td>${delta ?? "—"}</td>
        <td>${perMarket.nextReviewIn ?? "—"}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="11" class="fine">Aguardando primeiros shadow trades (cada mercado acumula amostra antes de revisar).</td></tr>`;
    if (abBody) abBody.innerHTML = Object.entries(research.ab?.arms ?? {}).map(([arm, stats]) => `<tr>
      <td>${AB_ARM_LABELS[arm] ?? arm}</td><td>${stats.trades}</td><td>${stats.wins}/${stats.losses}/${stats.draws}</td><td>${pct(stats.winRate)}</td><td>${stats.pnl}</td><td>${stats.noTrade}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="fine">Aguardando oportunidades comparáveis…</td></tr>`;
    if (techBody) {
      const statsByTechnique = Object.fromEntries((apprentice.aggregate ?? []).map((row) => [row.techniqueId, row]));
      techBody.innerHTML = (apprentice.techniques ?? []).map((technique) => {
        const stats = statsByTechnique[technique.id] ?? {};
        return `<tr>
          <td>${technique.id}${technique.id === apprentice.currentTechniqueId ? " ★" : ""}</td>
          <td>${technique.status}</td><td>${technique.generation}</td><td>${stats.trades ?? 0}</td><td>${pct(stats.winRate)}</td><td>${stats.pnlPerTrade ?? "—"}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="6" class="fine">Aguardando trades do aprendiz…</td></tr>`;
    }
  } catch (error) {
    if (body) body.innerHTML = `<tr><td colspan="11" class="fine">Laboratório indisponível: ${String(error?.message || error)}</td></tr>`;
  }
}
async function connectIq() {
  const emailInput = $id("iqEmail"), passwordInput = $id("iqPassword");
  const email = String(emailInput?.value ?? "").trim();
  const password = String(passwordInput?.value ?? "");
  if (!email || !password) { renderIq({ state: "ERROR", lastError: "Informe e-mail e senha." }); return; }
  setText("iqStateBadge", "CONECTANDO"); setText("iqStatus", "CONECTANDO");
  try {
    const result = await jpost("/api/iq/connect", { email, password });
    if (passwordInput) passwordInput.value = "";
    renderIq(result);
  } catch (error) { renderIq({ state: "ERROR", lastError: String(error?.message || error).slice(0, 120) }); }
}
async function verifyIq() {
  const codeInput = $id("iqTwoFactorCode");
  const code = String(codeInput?.value ?? "").trim();
  if (!code) { renderIq({ state: "TWO_FACTOR_REQUIRED", lastError: "Informe o código 2FA." }); return; }
  try { const result = await jpost("/api/iq/verify-2fa", { code }); if (codeInput) codeInput.value = ""; renderIq(result); } catch (error) { renderIq({ state: "TWO_FACTOR_REQUIRED", lastError: String(error?.message || error).slice(0, 120) }); }
}
async function disconnectIq() { try { renderIq(await jpost("/api/iq/disconnect", {})); } catch { renderIq({ state: "DISCONNECTED" }); } }
async function armIq() {
  const limit = Math.max(1, Math.min(100, Number($id("iqLimit")?.value) || 1));
  const confirmed = window.confirm(`ARMAR execução PRACTICE?\n\nLimite máximo por ordem: ${formatBRL(limit)}\nConta PRACTICE verificada server-side, market data saudável.\nNenhuma ordem REAL é possível.`);
  if (!confirmed) return;
  try { await jpost("/api/iq/arm", { limitBrl: limit, confirmation: "ARM_PRACTICE" }); } catch (error) { setText("iqExecutionDetail", `Falha ao armar: ${String(error?.message || error).slice(0, 140)}`); }
  await loadIqStatus();
}
async function disarmIq() { try { await jpost("/api/iq/disarm", {}); } catch { /* status recarrega abaixo */ } await loadIqStatus(); }
async function releaseKillSwitch() { try { await jpost("/api/iq/kill-switch", { engaged: false }); } catch { /* status recarrega abaixo */ } await loadIqStatus(); }
async function testIqOrder(direction) {
  const stake = Math.max(1, Math.min(100, Number($id("iqTestStake")?.value) || 1));
  const confirmed = window.confirm(`ENVIAR ordem PRACTICE de teste?\n\n${direction === "BUY" ? "BUY (CALL)" : "SELL (PUT)"} · stake ${formatBRL(stake)}\nUMA ordem, depois AUTO-DISARM.\nSem ACK = UNKNOWN e nunca reenvia.`);
  if (!confirmed) return;
  setText("iqExecutionDetail", "Enviando ordem PRACTICE de teste (aguardando ACK real)…");
  try { const result = await jpost("/api/iq/test-order", { direction, stake, horizonSeconds: 60 }); setText("iqExecutionDetail", `Resultado: ${result.state}${result.brokerOrderId ? ` · ordem ${result.brokerOrderId}` : ""}${result.reason ? ` · ${result.reason}` : ""}`); } catch (error) { setText("iqExecutionDetail", `Falha no teste: ${String(error?.message || error).slice(0, 140)}`); }
  await loadIqStatus();
  await loadIqExecutions();
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
  const iqConnectButton = $id("iqConnect"); if (iqConnectButton) iqConnectButton.addEventListener("click", () => void connectIq());
  const iqVerifyButton = $id("iqVerify2fa"); if (iqVerifyButton) iqVerifyButton.addEventListener("click", () => void verifyIq());
  const iqDisconnectButton = $id("iqDisconnect"); if (iqDisconnectButton) iqDisconnectButton.addEventListener("click", () => void disconnectIq());
  const iqArmButton = $id("iqArm"); if (iqArmButton) iqArmButton.addEventListener("click", () => void armIq());
  const iqDisarmButton = $id("iqDisarm"); if (iqDisarmButton) iqDisarmButton.addEventListener("click", () => void disarmIq());
  const iqKillButton = $id("iqKillRelease"); if (iqKillButton) iqKillButton.addEventListener("click", () => void releaseKillSwitch());
  const iqTestBuyButton = $id("iqTestBuy"); if (iqTestBuyButton) iqTestBuyButton.addEventListener("click", () => void testIqOrder("BUY"));
  const iqTestSellButton = $id("iqTestSell"); if (iqTestSellButton) iqTestSellButton.addEventListener("click", () => void testIqOrder("SELL"));
  void loadIqStatus();
  void loadIqExecutions();
  renderBankroll();
  renderSessionMetrics();
  navigate("operational");
  void loadStats();
  void loadHistory();
  void loadAiStatus();
  setInterval(renderSessionMetrics, 3_000);
  setInterval(() => { if (state.page === "operational" || state.page === "training" || state.page === "settings") void loadStats(); }, REFRESH_MS);
  setInterval(() => { if (state.page === "history") void loadHistory(); }, 30_000);
  setInterval(() => { if (state.page === "iq") { void loadIqStatus(); void loadIqExecutions(); } }, 5_000);
  setInterval(() => { if (state.page === "history") void loadIqSignals(); }, 15_000);
  setInterval(() => { if (state.page === "training") { void loadIqTraining(); void loadIqLab(); } }, 20_000);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindUi); else bindUi();
