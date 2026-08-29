/* TRACECON web app — cliente vanilla que consome /api/* (Etapa 8).
 * Não contém segredos; apenas lê a API e renderiza. A complexidade do motor
 * é traduzida em informação simples. Nada é inventado no cliente. */
const $ = (id) => document.getElementById(id);

const state = { symbol: "BTCUSDT", timeframe: "1h", direction: "up", horizon: 12, history: [] };

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function connect() {
  try {
    const s = await api("/api/status");
    const ok = s.state === "connected";
    $("connDot").className = "dot " + (ok ? "ok" : s.state === "error" ? "err" : "");
    $("connText").textContent = `${s.provider} · ${ok ? "conectado" : s.state}`;
  } catch {
    $("connDot").className = "dot err";
    $("connText").textContent = "offline";
  }
}

async function loadMarket() {
  try {
    const q = `symbol=${state.symbol}&timeframe=${state.timeframe}`;
    const md = await api(`/api/market?${q}`);
    $("price").textContent = md.currentPrice != null ? fmt(md.currentPrice) : "—";
    $("quality").textContent = md.quality || "—";
    $("freshness").textContent = md.freshness || "—";
    $("lastClose").textContent = md.latestClosedCandle ? fmt(md.latestClosedCandle.close) : "—";
    $("volume").textContent = md.volume != null ? fmt(md.volume) : "—";
    $("source").textContent = md.provider || "—";
    $("noData").style.display = md.available ? "none" : "block";
  } catch (e) {
    $("price").textContent = "—";
    $("noData").style.display = "block";
    $("noData").textContent = "Sem conexão com a API: " + e.message;
  }
}

async function loadQuant() {
  try {
    const q = `symbol=${state.symbol}&timeframe=${state.timeframe}`;
    const ctx = await api(`/api/market/context?${q}`);
    const qt = ctx.quant;
    if (!qt) { $("quantBody").textContent = "Dados insuficientes para features."; return; }
    $("quantBody").innerHTML = [
      `Score técnico: <b>${qt.technicalScore.toFixed(3)}</b>`,
      `RSI: <b>${qt.rsi != null ? qt.rsi.toFixed(1) : "—"}</b>`,
      `Regime: <b>${qt.marketRegime || "—"}</b>`,
      `Estrutura: <b>${qt.structureTrend || "—"}</b>`,
      `ATR%: <b>${qt.atrPct != null ? qt.atrPct.toFixed(3) + "%" : "—"}</b>`,
      `Vol. anualizada: <b>${qt.volatilityAnnualized != null ? qt.volatilityAnnualized.toFixed(1) + "%" : "—"}</b>`,
      `Suportes: <b>${qt.supports.slice(0,3).map(fmt).join(" · ")}</b>`,
      `Resistências: <b>${qt.resistances.slice(0,3).map(fmt).join(" · ")}</b>`,
    ].join("<br>");
  } catch { $("quantBody").textContent = "indisponível"; }
}

async function loadNews() {
  try {
    const r = await api(`/api/news?asset=${state.symbol.replace("USDT", "")}`);
    if (!r.available) { $("newsBody").textContent = "Notícias indisponíveis (" + (r.note || "sem fonte") + ")."; return; }
    const bias = r.bias || "neutral";
    $("newsBody").innerHTML =
      `<div>Viés léxico: <b class="badge ${bias === "neutral" ? "wait" : bias}">${bias}</b></div><br>` +
      r.items.slice(0, 5).map(n => `<li><span class="dim">[${new Date(n.publishedAt).toLocaleTimeString()}]</span> ${n.title}</li>`).join("");
  } catch { $("newsBody").textContent = "indisponível"; }
}

async function analyze() {
  $("analyze").disabled = true;
  try {
    const q = `symbol=${state.symbol}&timeframe=${state.timeframe}&direction=${state.direction}&horizon=${state.horizon}`;
    const r = await api(`/api/analyze?${q}`);
    const badge = r.decision === "BUY" ? "up" : r.decision === "SELL" ? "down" : "wait";
    $("decision").innerHTML = `<span class="badge ${badge}">${r.decision}</span>`;
    $("rationale").textContent = r.rationale || "";
    $("decisionNote").style.display = r.dataSufficient ? "none" : "block";
    $("decisionNote").textContent = r.dataSufficient ? "" : "Dados insuficientes — aguardar é uma decisão válida.";

    $("fav").innerHTML = r.factors.favorable.map(f2 => `<li>${f2.text}</li>`).join("") || "<li class='dim'>nenhum</li>";
    $("con").innerHTML = r.factors.counter.map(f2 => `<li>${f2.text}</li>`).join("") || "<li class='dim'>nenhum</li>";
    $("inv").innerHTML = r.factors.invalidators.map(f2 => `<li>${f2.text}</li>`).join("") || "<li class='dim'>nenhum</li>";

    state.history.unshift({ decision: r.decision, ts: Date.now(), rationale: r.rationale });
    renderHistory();
  } catch (e) {
    $("decision").textContent = "—";
    $("decisionNote").style.display = "block";
    $("decisionNote").textContent = "Erro: " + e.message;
  } finally { $("analyze").disabled = false; }
}

function renderHistory() {
  $("historyBody").innerHTML = state.history.slice(0, 8).map(h =>
    `<div><span class="dim">${new Date(h.ts).toLocaleTimeString()}</span> <b>${h.decision}</b> — ${h.rationale}</div>`
  ).join("") || "—";
}

function fmt(n) {
  return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

async function refreshAll() { await connect(); await loadMarket(); await loadQuant(); await loadNews(); }

async function loadExtensionInfo() {
  const el = $("extInfo");
  if (!el) return;
  try {
    const info = await api("/extension/info");
    if (info.available && info.sizeBytes) {
      const kb = (info.sizeBytes / 1024).toFixed(1);
      el.textContent = `(${kb} KB · pronta pra baixar)`;
    } else {
      el.textContent = "(zip não gerado ainda — veja README para build)";
    }
  } catch {
    el.textContent = "(não foi possível checar)";
  }
}

function bind() {
  $("analyze").addEventListener("click", analyze);
  $("refresh").addEventListener("click", refreshAll);
  $("symbol").addEventListener("change", (e) => { state.symbol = e.target.value; refreshAll(); });
  $("timeframe").addEventListener("change", (e) => { state.timeframe = e.target.value; refreshAll(); });
  $("direction").addEventListener("change", (e) => { state.direction = e.target.value; });
  $("horizon").addEventListener("input", (e) => { state.horizon = Number(e.target.value) || 12; });
}

bind();
loadExtensionInfo();
refreshAll().then(() => analyze());
setInterval(() => { loadMarket(); }, 10000);
