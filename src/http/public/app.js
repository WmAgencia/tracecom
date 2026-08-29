/* TRACECON landing — cliente vanilla. Sem segredos; só UI. */

const $ = (id) => document.getElementById(id);

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadExtensionInfo() {
  const els = document.querySelectorAll("#extInfo");
  if (!els.length) return;
  try {
    const info = await api("/extension/info");
    const text = info.available && info.sizeBytes
      ? `${(info.sizeBytes / 1024).toFixed(1)} KB · pronta para baixar`
      : "disponível — clique para baixar";
    els.forEach((el) => { el.textContent = text; });
  } catch {
    els.forEach((el) => { el.textContent = "disponível — clique para baixar"; });
  }
}

/* ===================== CALIBRAÇÃO ===================== */

const MIN_DECISIONS_FOR_REPORT = 50;

function pct(n, digits = 1) {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function num(n, digits = 1) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function formatTimestamp(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
}

function renderCalibration(report) {
  const statusEl = $("calibStatus");
  const winRateEl = $("calibWinRate");
  const winRateSubEl = $("calibWinRateSub");
  const totalEl = $("calibTotal");
  const totalSubEl = $("calibTotalSub");
  const drawdownEl = $("calibDrawdown");
  const drawdownSubEl = $("calibDrawdownSub");
  const circuitEl = $("calibCircuit");
  const circuitSubEl = $("calibCircuitSub");
  const snapshotEl = $("calibSnapshot");

  if (!statusEl) return;

  const total = report?.totalDecisions ?? 0;
  const wins = report?.wins ?? 0;
  const misses = report?.misses ?? 0;
  const winRate = report?.winRate ?? 0;
  const drawdown = report?.drawdownObserved ?? 0;
  const drawdownMax = report?.drawdownMax ?? 5;
  const guard = report?.guardStatus ?? { circuitBreaker: "ok", dailyLossPct: 0, lastLossAt: null };

  // Reset status classes
  statusEl.classList.remove("is-calibrating", "is-ready", "is-error");

  if (total < MIN_DECISIONS_FOR_REPORT) {
    statusEl.classList.add("is-calibrating");
    statusEl.textContent = `calibrando · ${total}/${MIN_DECISIONS_FOR_REPORT} decisões — aguarde mais dados`;
  } else {
    statusEl.classList.add("is-ready");
    statusEl.textContent = `pronto · ${total} decisões avaliadas`;
  }

  // Win rate
  winRateEl.classList.remove("is-good", "is-bad", "is-warn");
  winRateEl.textContent = total > 0 ? pct(winRate, 1) : "—";
  if (total >= MIN_DECISIONS_FOR_REPORT) {
    if (winRate >= 0.55) winRateEl.classList.add("is-good");
    else if (winRate < 0.45) winRateEl.classList.add("is-bad");
    else winRateEl.classList.add("is-warn");
  }
  winRateSubEl.textContent = total > 0 ? `${wins} acertos · ${misses} erros` : "aguardando dados";

  // Total
  totalEl.textContent = String(total);
  totalEl.classList.remove("is-good", "is-bad", "is-warn");
  totalSubEl.textContent = total > 0 ? "horizonte já decorrido" : "nenhuma decisão avaliada ainda";

  // Drawdown
  drawdownEl.textContent = num(drawdown, 2) + "%";
  drawdownEl.classList.remove("is-good", "is-bad", "is-warn");
  if (drawdown > drawdownMax) {
    drawdownEl.classList.add("is-bad");
    drawdownSubEl.textContent = `acima do limite (${drawdownMax}%)`;
  } else if (drawdown > drawdownMax * 0.6) {
    drawdownEl.classList.add("is-warn");
    drawdownSubEl.textContent = `limite ${drawdownMax}% · próximo`;
  } else {
    drawdownEl.classList.add("is-good");
    drawdownSubEl.textContent = `limite ${drawdownMax}%`;
  }

  // Circuit breaker
  const tripped = guard.circuitBreaker === "tripped";
  circuitEl.textContent = tripped ? "tripped" : "ok";
  circuitEl.classList.remove("is-good", "is-bad", "is-warn");
  circuitEl.classList.add(tripped ? "is-bad" : "is-good");
  circuitSubEl.textContent = tripped
    ? `drawdown diário ${num(guard.dailyLossPct, 2)}%`
    : `perda diária ${num(guard.dailyLossPct, 2)}%`;

  // Snapshot timestamp
  snapshotEl.textContent = report?.snapshotAt ? `snapshot: ${formatTimestamp(report.snapshotAt)}` : "";
}

function renderCalibrationError() {
  const statusEl = $("calibStatus");
  if (!statusEl) return;
  statusEl.classList.remove("is-calibrating", "is-ready");
  statusEl.classList.add("is-error");
  statusEl.textContent = "endpoint /api/analytics/calibration ainda não está disponível";
  const snapshotEl = $("calibSnapshot");
  if (snapshotEl) snapshotEl.textContent = "";
}

async function loadCalibration() {
  const panel = $("calibrationPanel");
  if (!panel) return;
  try {
    const report = await api("/api/analytics/calibration");
    renderCalibration(report);
  } catch {
    renderCalibrationError();
  }
}

loadExtensionInfo();
loadCalibration();
setInterval(loadCalibration, 60_000);
