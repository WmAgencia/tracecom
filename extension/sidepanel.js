/* TRACECON side panel — interface principal ao lado da corretora real.
 * NÃO executa ordens. Lê a API local e mostra análise. Nada é inventado. */

const $ = (id) => document.getElementById(id);
const state = { symbol: "BTCUSDT", timeframe: "1h", direction: "up", horizon: 12 };

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(res);
    });
  });
}

const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 }));

function setConn(ok, text) {
  $("connDot").className = "dot " + (ok ? "ok" : "err");
  $("connText").textContent = text;
}

async function health() {
  const r = await send({ type: "TRACECON_HEALTH" });
  if (r.ok) setConn(true, "API conectada");
  else setConn(false, "API offline (" + (r.error || "sem resposta") + ")");
  return r.ok;
}

async function loadMarket() {
  const r = await send({ type: "TRACECON_CONTEXT", symbol: state.symbol, timeframe: state.timeframe });
  if (!r.ok) { $("price").textContent = "—"; $("noData").style.display = "block"; return; }
  const ctx = r.data;
  $("price").textContent = fmt(ctx.currentPrice);
  $("marketSub").innerHTML = [
    `Qualidade <b>${ctx.dataQuality}</b> · Frescor <b>${ctx.freshness}</b>`,
    `Último fechado <b>${fmt(ctx.latestClosedCandle?.close)}</b>`,
    `Volume <b>${fmt(ctx.volume)}</b>`,
    `Fonte <b>${ctx.provider}</b>`,
  ].join("<br>");
  $("noData").style.display = ctx.available ? "none" : "block";

  if (ctx.quant) {
    $("quantBody").innerHTML = [
      `Score <b>${ctx.quant.technicalScore.toFixed(3)}</b>`,
      `RSI <b>${ctx.quant.rsi != null ? ctx.quant.rsi.toFixed(1) : "—"}</b>`,
      `Regime <b>${ctx.quant.marketRegime || "—"}</b>`,
      `Estrutura <b>${ctx.quant.structureTrend || "—"}</b>`,
      `ATR% <b>${ctx.quant.atrPct != null ? ctx.quant.atrPct.toFixed(3) + "%" : "—"}</b>`,
    ].join("<br>");
  } else {
    $("quantBody").textContent = "Dados insuficientes para features.";
  }
}

async function loadNews() {
  const r = await send({ type: "TRACECON_NEWS", symbol: state.symbol });
  if (!r.ok || !r.data || !r.data.available) { $("newsBody").textContent = "Notícias indisponíveis."; return; }
  const bias = r.data.bias || "neutral";
  $("newsBody").innerHTML =
    `<div>Viés léxico: <span class="badge ${bias === "neutral" ? "wait" : bias}">${bias}</span></div>` +
    (r.data.items || []).slice(0, 5).map((n) => `<li><span class="sub">[${new Date(n.publishedAt).toLocaleTimeString()}]</span> ${n.title}</li>`).join("");
}

async function analyze() {
  $("analyze").disabled = true;
  try {
    const r = await send({ type: "TRACECON_ANALYZE", symbol: state.symbol, timeframe: state.timeframe, direction: state.direction, horizon: state.horizon });
    if (!r.ok) { $("decisionOut").textContent = "—"; $("rationale").textContent = "Erro: " + (r.error || "?"); return; }
    const d = r.data;
    const badge = d.decision === "BUY" ? "up" : d.decision === "SELL" ? "down" : "wait";
    $("decisionOut").innerHTML = `<span class="badge ${badge}">${d.decision}</span>`;
    $("rationale").textContent = d.rationale || "";
    $("fav").innerHTML = (d.factors?.favorable || []).map((f) => `<li>${f.text}</li>`).join("") || "<li class='sub'>nenhum</li>";
    $("con").innerHTML = (d.factors?.counter || []).map((f) => `<li>${f.text}</li>`).join("") || "<li class='sub'>nenhum</li>";
    $("inv").innerHTML = (d.factors?.invalidators || []).map((f) => `<li>${f.text}</li>`).join("") || "<li class='sub'>nenhum</li>";
  } catch (e) {
    $("rationale").textContent = "Erro: " + e.message;
  } finally { $("analyze").disabled = false; }
}

async function detect() {
  // tenta obter o contexto da aba ativa (plataforma/ativo/timeframe).
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "TRACECON_DETECT" });
      if (res && res.symbol) { $("symbol").value = res.symbol; state.symbol = res.symbol; }
      if (res && res.timeframe) { $("timeframe").value = res.timeframe; state.timeframe = res.timeframe; }
      if (res && res.platform) setConn(true, res.platform);
    } catch (e) {
      // nada detectado (página não suportada) — usuário ajusta manualmente
    }
  }
}

$("analyze").addEventListener("click", analyze);
$("detect").addEventListener("click", detect);
$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("symbol").addEventListener("input", (e) => { state.symbol = e.target.value.toUpperCase(); });
$("timeframe").addEventListener("change", (e) => { state.timeframe = e.target.value; });
$("direction").addEventListener("change", (e) => { state.direction = e.target.value; });
$("horizon").addEventListener("input", (e) => { state.horizon = Number(e.target.value) || 12; });

(async () => {
  await health();
  await detect();
  await loadMarket();
  await loadNews();
})();
