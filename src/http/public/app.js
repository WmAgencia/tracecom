/* TRACECON web app — cliente vanilla que consome /api/*.
 * Sem segredos; apenas lê e renderiza. Nenhum dado é inventado. */

const $ = (id) => document.getElementById(id);

const state = {
  symbol: "BTCUSDT",
  timeframe: "1h",
  direction: "up",
  horizon: 12,
  history: [],
  currentPrice: null,
};

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ---------- formatação ---------- */
function fmt(n, dp = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (typeof n === "string") return n;
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(dp) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(dp) + "M";
  if (Math.abs(n) >= 1e3) return n.toLocaleString("en-US", { maximumFractionDigits: dp });
  return Number(n).toFixed(dp);
}
function pct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}
function sign(n) {
  if (n > 0) return "+";
  if (n < 0) return "−";
  return "";
}

/* ---------- conexão ---------- */
async function connect() {
  try {
    const s = await api("/api/status");
    const ok = s.state === "connected";
    const cls = ok ? "ok" : s.state === "error" ? "err" : "warn";
    $("connDot").className = "dot " + cls;
    $("connText").textContent = `${s.provider ?? "—"} · ${ok ? "conectado" : s.state ?? "—"}`;
    return s;
  } catch {
    $("connDot").className = "dot err";
    $("connText").textContent = "offline";
    return null;
  }
}

/* ---------- mercado ---------- */
async function loadMarket() {
  try {
    const q = `symbol=${state.symbol}&timeframe=${state.timeframe}`;
    const md = await api(`/api/market?${q}`);
    state.currentPrice = md.currentPrice;
    $("price").textContent = md.currentPrice != null ? fmt(md.currentPrice) : "—";
    $("quality").textContent = md.quality ?? "—";
    $("freshness").textContent = md.freshness ?? "—";
    $("lastClose").textContent = md.latestClosedCandle ? fmt(md.latestClosedCandle.close) : "—";
    $("volume").textContent = md.volume != null ? fmt(md.volume) : "—";
    $("source").textContent = md.provider ?? "—";
    $("noData").hidden = !!md.available;
    if (md.available) $("noData").textContent = "Sem dados no momento. O motor só fala quando há fonte.";
    updateTape(md);
    return md;
  } catch (e) {
    $("price").textContent = "—";
    $("noData").hidden = false;
    $("noData").textContent = "Sem conexão com a API: " + e.message;
    return null;
  }
}

function updateTape(md) {
  const candles = md.recentCandles || (md.latestClosedCandle ? [md.latestClosedCandle] : []);
  if (candles.length >= 2) {
    const bars = candles.slice(-20).map((c) => {
      const range = Math.max(1e-9, c.high - c.low);
      const pos = (c.close - c.low) / range;
      return "▁▂▃▄▅▆▇█"[Math.min(7, Math.max(0, Math.floor(pos * 8)))];
    }).join("");
    $("tapeBars").textContent = bars || "▁▂▃";
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const delta = prev && prev.close ? ((last.close - prev.close) / prev.close) * 100 : 0;
    $("tapeDelta").textContent = `${sign(delta)}${delta.toFixed(2)}%`;
    $("tapeDelta").style.color = delta >= 0 ? "var(--ok)" : "var(--bad)";
  }
  $("tapePrice").textContent = md.currentPrice != null ? fmt(md.currentPrice) : "—";
  $("tapeVol").textContent = md.volume != null ? `vol ${fmt(md.volume)}` : "vol —";
  $("tapeMeta").textContent = `${md.quality ?? "—"} · ${md.freshness ?? "—"}`;
}

/* ---------- técnico ---------- */
async function loadQuant() {
  try {
    const q = `symbol=${state.symbol}&timeframe=${state.timeframe}`;
    const ctx = await api(`/api/quant?${q}`);
    const q2 = ctx.quant ?? {};
    $("rsi").textContent = q2.rsi != null ? q2.rsi.toFixed(1) : "—";
    $("macdHist").textContent = q2.macdHistogram != null ? q2.macdHistogram.toFixed(3) : "—";
    $("atrPct").textContent = q2.atrPct != null ? q2.atrPct.toFixed(4) : "—";
    $("volAnn").textContent = q2.volatilityAnnualized != null ? q2.volatilityAnnualized.toFixed(2) + "%" : "—";
    $("regime").textContent = q2.marketRegime ?? "—";
    $("structure").textContent = q2.structureTrend ?? "—";
    $("supports").textContent = (q2.supports ?? []).slice(0, 5).map((s) => fmt(s, 0)).join(" · ") || "—";
    $("resistances").textContent = (q2.resistances ?? []).slice(0, 5).map((s) => fmt(s, 0)).join(" · ") || "—";
    return ctx;
  } catch {
    return null;
  }
}

/* ---------- decisão ---------- */
async function analyze() {
  const tag = $("decisionTag");
  const dec = $("decision");
  dec.textContent = "—";
  tag.className = "decision-tag";
  $("rationale").textContent = "Analisando…";
  try {
    const q = `symbol=${state.symbol}&timeframe=${state.timeframe}&direction=${state.direction}&horizon=${state.horizon}`;
    const r = await api(`/api/analyze?${q}`);
    const decision = (r.decision ?? "WAIT").toUpperCase();
    dec.textContent = decision;
    tag.className = "decision-tag is-" + (decision === "BUY" ? "buy" : decision === "SELL" ? "sell" : "wait");
    $("dScore").textContent = r.score != null ? r.score.toFixed(3) : "—";
    $("dConf").textContent = r.confidence != null ? pct(r.confidence) : "—";
    $("dProb").textContent = r.probability?.probability != null ? pct(r.probability.probability) : "—";
    $("rationale").textContent = r.rationale ?? "—";
    const fav = r.factors?.favorable ?? [];
    const con = r.factors?.counter ?? [];
    const inv = r.factors?.invalidators ?? [];
    $("fav").innerHTML = fav.length ? fav.map((x) => `<li>${escapeHtml(x.text ?? x)}</li>`).join("") : `<li class="muted">nenhum</li>`;
    $("con").innerHTML = con.length ? con.map((x) => `<li>${escapeHtml(x.text ?? x)}</li>`).join("") : `<li class="muted">nenhum</li>`;
    $("inv").innerHTML = inv.length ? inv.map((x) => `<li>${escapeHtml(x.text ?? x)}</li>`).join("") : `<li class="muted">nenhum</li>`;
    pushHistory({
      ts: Date.now(),
      symbol: state.symbol,
      timeframe: state.timeframe,
      decision,
      score: r.score,
      confidence: r.confidence,
    });
    return r;
  } catch (e) {
    $("rationale").textContent = "Falha na análise: " + e.message;
    return null;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- histórico (sessão) ---------- */
function pushHistory(entry) {
  state.history.unshift(entry);
  if (state.history.length > 20) state.history.length = 20;
  renderHistory();
}
function renderHistory() {
  const el = $("historyBody");
  if (!state.history.length) {
    el.className = "history-empty";
    el.textContent = "Sem análises anteriores nesta sessão.";
    return;
  }
  el.className = "";
  el.innerHTML = `
    <table class="history">
      <thead><tr>
        <th>quando</th><th>ativo</th><th>tf</th><th>decisão</th><th>score</th><th>conf.</th>
      </tr></thead>
      <tbody>
        ${state.history.map((h) => `
          <tr>
            <td>${new Date(h.ts).toLocaleTimeString("pt-BR")}</td>
            <td>${h.symbol}</td>
            <td>${h.timeframe}</td>
            <td class="d-${h.decision.toLowerCase()}">${h.decision}</td>
            <td>${h.score != null ? h.score.toFixed(2) : "—"}</td>
            <td>${h.confidence != null ? pct(h.confidence) : "—"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

/* ---------- sparkline ---------- */
async function loadSpark() {
  try {
    const q = `symbol=${state.symbol}&timeframe=${state.timeframe}&limit=120`;
    const data = await api(`/api/market/candles?symbol=${state.symbol}&timeframe=${state.timeframe}`);
    const candles = data.candles ?? [];
    $("sparkMeta").textContent = candles.length ? `${candles.length} candles` : "sem candles";
    drawSpark(candles);
  } catch {
    $("sparkMeta").textContent = "indisponível";
  }
}

function drawSpark(candles) {
  const canvas = $("spark");
  if (!canvas || !candles.length) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const pad = 8;
  const w = rect.width - pad * 2;
  const h = rect.height - pad * 2;
  const closes = candles.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  // grid hairlines
  ctx.strokeStyle = "rgba(168, 177, 192, 0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = pad + (h * i) / 3;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(pad + w, y);
    ctx.stroke();
  }

  // area
  const grad = ctx.createLinearGradient(0, pad, 0, pad + h);
  grad.addColorStop(0, "rgba(94, 230, 255, 0.18)");
  grad.addColorStop(1, "rgba(94, 230, 255, 0)");
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(pad, pad + h);
  candles.forEach((c, i) => {
    const x = pad + (w * i) / (candles.length - 1);
    const y = pad + h - ((c.close - min) / range) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(pad + w, pad + h);
  ctx.closePath();
  ctx.fill();

  // line
  ctx.strokeStyle = "#5EE6FF";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  candles.forEach((c, i) => {
    const x = pad + (w * i) / (candles.length - 1);
    const y = pad + h - ((c.close - min) / range) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // last dot
  const last = candles[candles.length - 1];
  const lx = pad + w;
  const ly = pad + h - ((last.close - min) / range) * h;
  ctx.fillStyle = "#5EE6FF";
  ctx.beginPath();
  ctx.arc(lx, ly, 3, 0, Math.PI * 2);
  ctx.fill();
}

/* ---------- extensão info ---------- */
async function loadExtensionInfo() {
  const el = $("extInfo");
  if (!el) return;
  try {
    const info = await api("/extension/info");
    if (info.available && info.sizeBytes) {
      const kb = (info.sizeBytes / 1024).toFixed(1);
      el.textContent = `${kb} KB · pronta pra baixar`;
    } else {
      el.textContent = "zip não gerado no serverless — baixe via release do GitHub";
    }
  } catch {
    el.textContent = "não foi possível checar";
  }
}

/* ---------- footer ---------- */
function setFooter() {
  $("footerMeta").textContent = `${state.symbol} · ${state.timeframe} · ${new Date().getFullYear()}`;
}

/* ---------- bind ---------- */
async function refreshAll() {
  setFooter();
  await Promise.all([connect(), loadMarket(), loadQuant(), loadSpark()]);
}

function bind() {
  $("analyze").addEventListener("click", analyze);
  $("refresh").addEventListener("click", refreshAll);
  $("symbol").addEventListener("change", (e) => { state.symbol = e.target.value; refreshAll(); });
  $("timeframe").addEventListener("change", (e) => { state.timeframe = e.target.value; refreshAll(); });
  $("direction").addEventListener("change", (e) => { state.direction = e.target.value; });
  $("horizon").addEventListener("input", (e) => { state.horizon = Number(e.target.value) || 12; });
  window.addEventListener("resize", () => loadSpark());
}

bind();
loadExtensionInfo();
refreshAll().then(() => analyze());
setInterval(() => { loadMarket(); loadSpark(); }, 15000);