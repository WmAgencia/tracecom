/* Escritório de Agentes — visão operacional isométrica (produto simples, backend é a fonte da verdade).
 * Arte original desenhada por código. Controles técnicos ficam em "Detalhes avançados". */
const OfficeUI = (() => {
  const $ = (id) => document.getElementById(id);
  const api = async (path, options) => {
    const response = await fetch(path, { headers: { accept: "application/json", ...(options?.body ? { "content-type": "application/json" } : {}) }, ...options, body: options?.body ? JSON.stringify(options.body) : undefined });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  };
  const get = (path) => api(path);
  const post = (path, body) => api(path, { method: "POST", body: body ?? {} });
  const put = (path, body) => api(path, { method: "PUT", body: body ?? {} });
  const money = (value, currency = "") => (Number.isFinite(Number(value)) ? `${currency ? currency + " " : ""}${Number(value).toFixed(2)}` : "—");
  const brl = (value) => (Number.isFinite(Number(value)) ? `R$ ${Number(value).toFixed(2)}` : "R$ —");
  const signed = (value) => (Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? "+" : "−"}R$ ${Math.abs(Number(value)).toFixed(2)}` : "—");
  const timeOf = (ms) => (Number.isFinite(Number(ms)) ? new Date(Number(ms)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "--:--");

  const TILE_W = 84, TILE_H = 38, TILE_Z = 26;
  const SLOTS = [
    { gx: 0, gy: 0 }, { gx: 3.6, gy: 0 }, { gx: 7.2, gy: 0 }, { gx: 10.8, gy: 0 }, { gx: 14.4, gy: 0 },
    { gx: 0, gy: 7.4 }, { gx: 3.6, gy: 7.4 }, { gx: 7.2, gy: 7.4 }, { gx: 10.8, gy: 7.4 }, { gx: 14.4, gy: 7.4 },
  ];
  const state = {
    office: null, eventsCursor: 0, selectedMarket: null, activity: [], activitySeeded: false, techLog: [],
    camera: { x: 0, y: 0, zoom: 1 }, defaultCamera: null, dragging: false, dragMoved: false, lastPointer: { x: 0, y: 0 },
    flashes: new Map(), deskAnim: new Map(), initialized: false, showTechActivity: false,
  };
  let canvas = null, ctx = null, overlay = null;

  /* ------------------------------ projeção ------------------------------ */
  function iso(gx, gy, gz = 0) { return { x: (gx - gy) * TILE_W / 2, y: (gx + gy) * TILE_H / 2 - gz * TILE_Z }; }
  function project(gx, gy, gz = 0) { const p = iso(gx, gy, gz); return { x: state.camera.x + p.x * state.camera.zoom, y: state.camera.y + p.y * state.camera.zoom }; }
  const zoom = () => state.camera.zoom;
  function block(g, x, y, w, h, color) { g.fillStyle = color; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function text(g, value, x, y, { size = 10, color = "#dbe6ff", align = "center", bold = false } = {}) {
    g.fillStyle = color; g.font = `${bold ? "bold " : ""}${Math.max(7, Math.round(size * zoom()))}px "Courier New", monospace`; g.textAlign = align; g.textBaseline = "middle"; g.fillText(String(value), x, y);
  }

  /* ------------------------------ linguagem amigável ------------------------------ */
  const REASON_TEXT = {
    AUTO_DESLIGADO: "execução automática desligada",
    SISTEMA_DESARMADO: "sistema parado",
    PARADA_DE_EMERGENCIA: "parada de emergência acionada",
    POSICAO_JA_ABERTA: "já existe operação aberta neste mercado",
    ORDEM_EM_ANDAMENTO: "ordem anterior ainda em andamento",
    AGENTE_PAUSADO: "agente pausado",
    SEM_CONEXAO_IQ: "IQ Option desconectada",
    ACK_DESCONHECIDO: "ordem enviada sem confirmação da IQ Option (não será reenviada)",
    SINAL_JA_REGISTRADO: "sinal repetido ignorado",
    IDEMPOTENCIA: "sinal já executado (idempotência)",
    INSTRUMENT_NOT_AVAILABLE_FOR_HORIZON: "instrumento indisponível para este prazo",
  };
  const reasonText = (reason) => {
    if (!reason) return "motivo não informado";
    if (REASON_TEXT[reason]) return REASON_TEXT[reason];
    if (String(reason).startsWith("GATE_")) return `bloqueado pelo gate (${String(reason).slice(5)})`;
    if (String(reason).endsWith("_EXPIRADO")) return `${reasonText(String(reason).replace("_EXPIRADO", ""))} — oportunidade expirou`;
    return String(reason).toLowerCase().replaceAll("_", " ");
  };
  const agentLabel = { OFFLINE: "INDISPONÍVEL", UNAVAILABLE: "INDISPONÍVEL", WAIT: "AGUARDANDO", ANALYZING: "ANALISANDO", SIGNAL: "OPORTUNIDADE", ORDERING: "ENVIANDO ORDEM", IN_POSITION: "EM OPERAÇÃO", SETTLING: "FINALIZANDO", WIN: "WIN", LOSS: "LOSS", DRAW: "EMPATE", ERROR: "ERRO" };

  /* ------------------------------ sprites ------------------------------ */
  function drawAgent(g, x, y, pixel, colors, pose, frame) {
    const p = pixel, bounce = pose === "typing" ? (frame % 2 === 0 ? 0 : p) : 0;
    block(g, x - 3.5 * p, y + 6 * p, 7 * p, p, "#05070d40");
    block(g, x - 2.5 * p, y + 3 * p + bounce, 2 * p, 3 * p, colors.pants);
    block(g, x + 0.5 * p, y + 3 * p + bounce, 2 * p, 3 * p, colors.pants);
    block(g, x - 3 * p, y + 0.2 * p + bounce, 6 * p, 3 * p, colors.shirt);
    block(g, x - 3 * p, y + 0.2 * p + bounce, 6 * p, p, colors.shirtLight);
    const headY = y - 2.6 * p + bounce + (pose === "loss" ? p : 0);
    block(g, x - 1.8 * p, headY, 3.6 * p, 3 * p, colors.skin);
    block(g, x - 2 * p, headY - p, 4 * p, p + 0.4 * p, colors.hair);
    block(g, x - 1.2 * p, headY + p, 0.7 * p, 0.7 * p, "#1a2233");
    block(g, x + 0.5 * p, headY + p, 0.7 * p, 0.7 * p, "#1a2233");
    const armY = y + 0.8 * p + bounce;
    if (pose === "typing") { block(g, x - 4.2 * p, armY + (frame % 2 ? p : 0), p + 1.2 * p, p, colors.skin); block(g, x + 2.2 * p, armY + (frame % 2 ? 0 : p), p + 1.2 * p, p, colors.skin); }
    else if (pose === "win") { block(g, x - 4.6 * p, armY - 2.4 * p, p, 3 * p, colors.skin); block(g, x + 3.6 * p, armY - 2.4 * p, p, 3 * p, colors.skin); }
    else if (pose === "loss") { block(g, x - 4.2 * p, armY + p, p + 1.2 * p, p, colors.skin); block(g, x + 1.8 * p, armY + p + p, p + 1.2 * p, p, colors.skin); }
    else if (pose === "order") { block(g, x - 4.4 * p, armY - 1.4 * p, p + 1.4 * p, p, colors.skin); block(g, x + 2 * p, armY + p, p + 1.4 * p, p, colors.skin); }
    else if (pose === "think") { block(g, x - 4.2 * p, armY - 1.8 * p, p, 2.4 * p, colors.skin); block(g, x + 2.6 * p, armY + p, p + 1.2 * p, p, colors.skin); }
    else if (pose === "offline") { block(g, x - 4.2 * p, armY + p, p + 1.2 * p, p, colors.skin); block(g, x + 2 * p, armY + p, p + 1.2 * p, p, colors.skin); }
    else { block(g, x - 4.2 * p, armY, p + 1.2 * p, p, colors.skin); block(g, x + 2 * p, armY, p + 1.2 * p, p, colors.skin); }
    if (pose === "error") { block(g, x - 0.4 * p, headY - 3.4 * p, 1.2 * p, 2.2 * p, "#ff5d5d"); block(g, x - 0.4 * p, headY - 1 * p, 1.2 * p, 1.2 * p, "#ff5d5d"); }
    if (pose === "offline") { block(g, x + 3.4 * p, headY - 1.6 * p, 1.2 * p, 1.2 * p, "#5b6a86"); block(g, x + 4.8 * p, headY - 2.6 * p, 1.4 * p, 1.4 * p, "#42506b"); }
  }
  const paletteFor = (market) => market.marketType === "OTC"
    ? { shirt: "#c98a2e", shirtLight: "#e8ad4d", pants: "#2c3448", skin: "#f0c39a", hair: "#3a2a1c" }
    : { shirt: "#3f6fd8", shirtLight: "#5b8cf0", pants: "#232c42", skin: "#f0c39a", hair: "#2b2b33" };
  const isPaused = (market) => market?.paused === true;
  const isDown = (market) => market?.agentState === "OFFLINE" || market?.agentState === "UNAVAILABLE" || market?.availability !== "OPEN";
  function bubbleInfo(market) {
    if (isPaused(market)) return { text: "PAUSADO", kind: "PAUSED" };
    if (isDown(market)) return { text: market?.availability === "NOT_FOUND" ? "INDISPONÍVEL" : "SEM DADOS", kind: "OFFLINE" };
    if (market.agentState === "ERROR") return { text: "ERRO", kind: "ERROR" };
    const flash = state.flashes.get(market.marketKey);
    if (flash) return { text: flash.result === "WIN" ? `WIN ${signed(flash.profit)}` : flash.result === "LOSS" ? `LOSS ${signed(flash.profit)}` : "EMPATE", kind: flash.result === "WIN" ? "WIN" : flash.result === "LOSS" ? "LOSS" : "NEUTRAL" };
    if (market.positionState?.status === "OPEN" || market.agentState === "IN_POSITION") {
      if (market.indicative?.state === "FAVORABLE") return { text: signed(market.indicative.indicativePnl), kind: "FAVORABLE" };
      if (market.indicative?.state === "UNFAVORABLE") return { text: signed(market.indicative.indicativePnl), kind: "UNFAVORABLE" };
      return { text: market.positionState?.direction === "CALL" ? "EM COMPRA" : market.positionState?.direction === "PUT" ? "EM VENDA" : "EM OPERAÇÃO", kind: "POSITION" };
    }
    if (market.agentState === "ORDERING") return { text: "ENVIANDO ORDEM", kind: "ORDERING" };
    if (market.agentState === "SIGNAL") return { text: "OPORTUNIDADE", kind: "SIGNAL" };
    if (market.agentState === "ANALYZING") return { text: "ANALISANDO", kind: "ANALYZING" };
    if (market.agentState === "SETTLING") return { text: "FINALIZANDO", kind: "SETTLING" };
    return { text: "AGUARDANDO", kind: "WAIT" };
  }
  const bubbleColor = (kind) => kind === "FAVORABLE" || kind === "WIN" ? "#8ce4a0" : kind === "UNFAVORABLE" || kind === "LOSS" ? "#ff8f8f" : kind === "ERROR" ? "#ff5d5d" : kind === "SIGNAL" ? "#ffd76a" : kind === "OFFLINE" || kind === "PAUSED" ? "#9fb2d6" : kind === "ORDERING" ? "#7fc4ff" : "#d7e4ff";
  const poseFor = (market, frame) => {
    if (isPaused(market) || isDown(market)) return isPaused(market) ? "think" : "offline";
    if (market.agentState === "ERROR") return "error";
    if (market.agentState === "IN_POSITION") return market.indicative?.state === "UNFAVORABLE" ? "loss" : "typing";
    if (market.agentState === "ORDERING") return "order";
    if (market.agentState === "SIGNAL" || market.agentState === "ANALYZING") return "typing";
    if (market.agentState === "WIN") return "win";
    if (market.agentState === "LOSS") return "loss";
    return frame % 8 < 5 ? "typing" : "think";
  };

  /* ------------------------------ render ------------------------------ */
  function diamond(g, cx, cy, w, h, fill, stroke) {
    g.beginPath(); g.moveTo(cx, cy - h / 2); g.lineTo(cx + w / 2, cy); g.lineTo(cx, cy + h / 2); g.lineTo(cx - w / 2, cy); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = Math.max(1, zoom()); g.stroke(); }
  }
  function drawFloor(g) {
    const z = zoom();
    for (let gx = -5; gx <= 20; gx += 2) for (let gy = -7; gy <= 14; gy += 2) {
      const p = project(gx, gy, -0.02);
      diamond(g, p.x, p.y, TILE_W * 2 * z, TILE_H * 2 * z, ((gx + gy) / 2) % 2 === 0 ? "#0a1120" : "#0c1424", "#101a30");
    }
  }
  function drawBackWall(g) {
    const z = zoom();
    const left = project(-4, -7, 0), right = project(18.4, -7, 0);
    const height = 200 * z;
    g.fillStyle = "#0b1322";
    g.beginPath(); g.moveTo(left.x, left.y); g.lineTo(right.x, right.y); g.lineTo(right.x, right.y - height); g.lineTo(left.x, left.y - height); g.closePath(); g.fill();
    g.strokeStyle = "#1c2a48"; g.lineWidth = Math.max(1, z); g.stroke();
    const office = state.office;
    const panel = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 - height + 12 * z, w: Math.abs(right.x - left.x) * 0.72, h: height - 26 * z };
    block(g, panel.x - panel.w / 2, panel.y - panel.h, panel.w, panel.h, "#081120");
    g.strokeStyle = "#2a3d63"; g.strokeRect(Math.round(panel.x - panel.w / 2), Math.round(panel.y - panel.h), Math.round(panel.w), Math.round(panel.h));
    const settled = office?.portfolio?.settled ?? { pnl: 0, wins: 0, losses: 0, draws: 0, trades: 0 };
    text(g, "RESULTADO DO DIA", panel.x, panel.y - panel.h + 12 * z, { size: 10, color: "#7f93b8", bold: true });
    text(g, signed(settled.pnl), panel.x, panel.y - panel.h + 34 * z, { size: 32, color: settled.pnl > 0 ? "#8ce4a0" : settled.pnl < 0 ? "#ff9d9d" : "#cfe0ff", bold: true });
    text(g, `operações ${settled.trades} · ${settled.wins} ganhos · ${settled.losses} perdas · ${settled.draws} empates`, panel.x, panel.y - panel.h + 56 * z, { size: 10, color: "#9fb2d6" });
    text(g, `${office?.activeCount ?? 0} mercados ativos · ${office?.portfolio?.openPositions?.length ?? 0} em operação · ${office?.portfolio?.practiceBalance !== null ? brl(office?.portfolio?.practiceBalance) : "—"}`, panel.x, panel.y - panel.h + 72 * z, { size: 10, color: "#7f93b8" });
    const curve = office?.portfolio?.equityCurve ?? [];
    const chart = { x: panel.x - panel.w / 2 + 14 * z, y: panel.y - panel.h + 88 * z, w: panel.w - 28 * z, h: panel.h - 104 * z };
    g.strokeStyle = "#16213a"; g.strokeRect(Math.round(chart.x), Math.round(chart.y), Math.round(chart.w), Math.round(chart.h));
    if (curve.length > 1) {
      const values = curve.map((point) => Number(point.cumulative) || 0);
      const min = Math.min(0, ...values), max = Math.max(0, ...values), span = Math.max(0.0001, max - min);
      g.strokeStyle = values[values.length - 1] >= 0 ? "#37d67a" : "#ff5d5d"; g.lineWidth = Math.max(1.4, 2 * z); g.beginPath();
      values.forEach((value, index) => { const px = chart.x + chart.w * (index / (values.length - 1)); const py = chart.y + chart.h - ((value - min) / span) * chart.h; if (index === 0) g.moveTo(px, py); else g.lineTo(px, py); });
      g.stroke();
    } else text(g, "sem resultados hoje", chart.x + chart.w / 2, chart.y + chart.h / 2, { size: 10, color: "#42506b" });
  }
  function drawSlotPlate(g, slotIndex, market) {
    const z = zoom();
    const center = SLOTS[slotIndex];
    const p = project(center.gx + 1.8, center.gy + 1.8, 0.02);
    const w = 96 * z, h = 20 * z;
    block(g, p.x - w / 2, p.y, w, h, market ? "#0d1830" : "#0a1120cc");
    g.strokeStyle = market ? "#2a3d63" : "#1a2338"; g.lineWidth = Math.max(1, z); g.strokeRect(Math.round(p.x - w / 2), Math.round(p.y), Math.round(w), Math.round(h));
    text(g, `MESA ${String(slotIndex + 1).padStart(2, "0")}${market ? "" : " · LIVRE"}`, p.x, p.y + h / 2, { size: 9, color: market ? "#9fb2d6" : "#42506b", bold: true });
  }
  function drawDesk(g, market, slotIndex, targets, bubbles, frame) {
    const z = zoom();
    const anim = state.deskAnim.get(market.marketKey) ?? { gx: SLOTS[slotIndex].gx, gy: SLOTS[slotIndex].gy, alpha: 1 };
    const cx = anim.gx + 1.8, cy = anim.gy + 1.8;
    g.globalAlpha = Math.min(1, Math.max(0, anim.alpha));
    const top = project(cx, cy, 0.6);
    const w = TILE_W * 2.0 * z, h = TILE_H * 2.0 * z, depth = 20 * z;
    diamond(g, top.x, top.y, w, h, "#16213a", "#2a3d63");
    g.fillStyle = "#0f1830";
    g.beginPath(); g.moveTo(top.x - w / 2, top.y); g.lineTo(top.x, top.y + h / 2); g.lineTo(top.x, top.y + h / 2 + depth); g.lineTo(top.x - w / 2, top.y + depth); g.closePath(); g.fill();
    g.fillStyle = "#0b1226";
    g.beginPath(); g.moveTo(top.x + w / 2, top.y); g.lineTo(top.x, top.y + h / 2); g.lineTo(top.x, top.y + h / 2 + depth); g.lineTo(top.x + w / 2, top.y + depth); g.closePath(); g.fill();
    // monitor
    const m = project(cx - 0.4, cy - 0.4, 0.6);
    const mw = 34 * z, mh = 22 * z;
    block(g, m.x - mw / 2, m.y - mh - 6 * z, mw, mh, "#050a14");
    const glow = market.agentState === "ERROR" ? "#ff5d5d" : isPaused(market) ? "#f2c14e" : isDown(market) ? "#31405e" : market.positionState?.status === "OPEN" ? (market.indicative?.state === "FAVORABLE" ? "#37d67a" : market.indicative?.state === "UNFAVORABLE" ? "#ff5d5d" : "#f2c14e") : "#4da3ff";
    block(g, m.x - mw / 2 + 2 * z, m.y - mh - 4 * z, mw - 4 * z, mh - 4 * z, glow);
    // big ticker plate
    const plate = project(cx + 0.7, cy + 1.6, 0.35);
    const pw = 132 * z, ph = 46 * z;
    block(g, plate.x - pw / 2, plate.y, pw, ph, "#0b1226");
    g.strokeStyle = market.marketType === "OTC" ? "#96702c" : "#3b5da8"; g.lineWidth = Math.max(1.4, 1.6 * z); g.strokeRect(Math.round(plate.x - pw / 2), Math.round(plate.y), Math.round(pw), Math.round(ph));
    text(g, market.symbol, plate.x, plate.y + 13 * z, { size: 15, color: "#eef4ff", bold: true });
    const badgeW = 62 * z, badgeH = 15 * z;
    block(g, plate.x - badgeW / 2, plate.y + 24 * z, badgeW, badgeH, market.marketType === "OTC" ? "#3a2a10" : "#16264a");
    g.strokeStyle = market.marketType === "OTC" ? "#96702c" : "#3b5da8"; g.strokeRect(Math.round(plate.x - badgeW / 2), Math.round(plate.y + 24 * z), Math.round(badgeW), Math.round(badgeH));
    text(g, market.marketType, plate.x, plate.y + 24 * z + badgeH / 2, { size: 10, color: market.marketType === "OTC" ? "#ffd08a" : "#9fc6ff", bold: true });
    const stake = market.maxStake ?? null;
    text(g, `payout ${market.payout ?? "—"} · limite ${brl(stake)} · ${market.strategy ?? "—"}`, plate.x, plate.y + ph + 9 * z, { size: 9, color: "#7f93b8" });
    // led
    block(g, plate.x + pw / 2 - 8 * z, plate.y + 5 * z, 5 * z, 5 * z, market.connectionHealth?.connected ? "#37d67a" : "#ff5d5d");
    // agent
    const agentPos = project(cx + 0.15, cy + 1.05, 0.04);
    const pixel = Math.max(1.6, 2.4 * z);
    drawAgent(g, agentPos.x, agentPos.y, pixel, paletteFor(market), poseFor(market, frame), frame);
    targets.push({ x: top.x - w / 2, y: top.y - 30 * z, w, h: h + depth + 70 * z, type: "desk", key: market.marketKey });
    bubbles.push({ x: agentPos.x, y: agentPos.y - 46 * z, ...bubbleInfo(market) });
    g.globalAlpha = 1;
  }
  function drawBubble(g, bubble) {
    const z = zoom();
    const color = bubbleColor(bubble.kind);
    const size = Math.max(9, Math.round(10.5 * z));
    g.font = `bold ${size}px "Courier New", monospace`;
    const width = Math.max(72 * z, g.measureText(bubble.text).width + 22 * z);
    const height = 22 * z;
    const x = Math.min(Math.max(bubble.x, width / 2 + 6), (canvas?.clientWidth ?? 1000) - width / 2 - 6);
    const y = Math.max(bubble.y, height + 8);
    block(g, x - width / 2, y - height, width, height, "#04070ef2");
    g.strokeStyle = color; g.lineWidth = Math.max(1.4, 1.6 * z); g.strokeRect(Math.round(x - width / 2), Math.round(y - height), Math.round(width), Math.round(height));
    g.beginPath(); g.moveTo(x - 5 * z, y); g.lineTo(x + 5 * z, y); g.lineTo(x, y + 7 * z); g.closePath(); g.fillStyle = color; g.fill();
    g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(bubble.text, x, y - height / 2 + z);
  }
  function render(timestamp) {
    if (!ctx || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) { canvas.width = width * dpr; canvas.height = height * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = false;
    const frame = Math.floor(timestamp / 380);
    const targets = [], bubbles = [];
    drawFloor(ctx);
    drawBackWall(ctx);
    const active = (state.office?.markets ?? []).filter((market) => market.enabled);
    const byKey = new Map(active.map((market, index) => [market.marketKey, index]));
    for (const [key, entry] of [...state.deskAnim.entries()]) if (!byKey.has(key)) state.deskAnim.delete(key);
    active.forEach((market, index) => {
      const target = SLOTS[index] ?? SLOTS[0];
      let anim = state.deskAnim.get(market.marketKey);
      if (!anim) { anim = { gx: target.gx, gy: target.gy - 5, alpha: 0 }; state.deskAnim.set(market.marketKey, anim); }
      anim.targetGx = target.gx; anim.targetGy = target.gy;
      anim.gx += (anim.targetGx - anim.gx) * 0.12;
      anim.gy += (anim.targetGy - anim.gy) * 0.12;
      anim.alpha = Math.min(1, anim.alpha + 0.08);
    });
    const occupied = new Set(active.map((_, index) => index));
    for (let slot = 0; slot < SLOTS.length; slot += 1) if (!occupied.has(slot)) drawSlotPlate(ctx, slot, null);
    for (const [index, market] of active.entries()) { drawSlotPlate(ctx, index, market); drawDesk(ctx, market, index, targets, bubbles, frame); }
    for (const bubble of bubbles) drawBubble(ctx, bubble);
    canvas.__targets = targets;
    ctx.fillStyle = "#4da3ff22";
    for (let index = 0; index < 20; index += 1) { const px = ((index * 97 + frame * 3) % width); const py = ((index * 53 + Math.sin(index + frame / 6) * 12 + height * 0.3) % height); ctx.fillRect(Math.round(px), Math.round(py), 2, 2); }
    requestAnimationFrame(render);
  }
  function computeDefaultCamera() {
    if (!canvas) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const center = iso(9, 3.7, 0);
    const z = Math.min(1.1, Math.max(0.5, Math.min(width / 1500, height / 820)));
    state.defaultCamera = { zoom: z, x: width / 2 - center.x * z, y: height * 0.26 - center.y * z };
    state.camera = { ...state.defaultCamera };
  }
  function centerOn(gx, gy, z = null) {
    if (!canvas) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const value = z ?? state.camera.zoom;
    const p = iso(gx, gy, 0);
    state.camera.x = width / 2 - p.x * value;
    state.camera.y = height * 0.52 - p.y * value;
    state.camera.zoom = value;
  }

  /* ------------------------------ dados / atividade ------------------------------ */
  async function refreshOffice() {
    try {
      state.office = window.__OFFICE_FIXTURE__?.office ?? await get("/api/iq/office");
      if (!state.initialized) { computeDefaultCamera(); state.initialized = true; }
      if (!state.activitySeeded) { seedActivity(); state.activitySeeded = true; }
      renderTopbar(); renderAux(); renderActivity();
      if (state.selectedMarket) marketDrawer(state.selectedMarket, true);
    } catch {
      const chip = $("officeChipIq");
      if (chip) { chip.textContent = "Servidor offline"; chip.className = "office-chip bad"; }
    }
  }
  function seedActivity() {
    const signals = (state.office?.signals ?? []).slice(0, 12).reverse();
    for (const signal of signals) activityLine(signalLine(signal), signal.disposition === "EXECUTED" ? "" : "blocked", signal.at);
  }
  function signalLine(signal) {
    const direction = signal.action === "BUY" ? "compra" : "venda";
    if (signal.disposition === "EXECUTED") return `${signal.display} iniciou operação de ${brl(signal.stakeFinal)} (${direction}).`;
    if (signal.disposition === "DUPLICATE") return `${signal.display} ignorou sinal repetido (${direction}).`;
    if (signal.disposition === "EXPIRED") return `${signal.display} oportunidade de ${direction} expirou sem execução: ${reasonText(signal.reason)}.`;
    return `${signal.display} encontrou oportunidade de ${direction}, mas não executou: ${reasonText(signal.reason)}.`;
  }
  function activityLine(html, kind = "", at = Date.now()) {
    state.activity = [{ html, kind, at: Number(at) || Date.now() }, ...state.activity].slice(0, 60);
  }
  function renderActivity() {
    const container = $("officeActivity"); if (!container) return;
    if (state.showTechActivity) {
      container.innerHTML = state.techLog.slice(0, 60).map((line) => `<div><span class="time">${line.time}</span>${line.text}</div>`).join("") || "<p class='fine'>Sem eventos técnicos.</p>";
      return;
    }
    container.innerHTML = state.activity.slice(0, 30).map((row) => `<div class="${row.kind}"><span class="time">${timeOf(row.at)}</span>${row.html}</div>`).join("") || "<p class='fine'>Aguardando os agentes…</p>";
  }
  async function pollEvents() {
    try {
      if (window.__OFFICE_FIXTURE__?.events) { for (const event of window.__OFFICE_FIXTURE__.events) handleEvent(event); window.__OFFICE_FIXTURE__.events = []; renderActivity(); return; }
      const result = await get(`/api/iq/events?after=${state.eventsCursor}&limit=200`);
      state.eventsCursor = result.cursor ?? state.eventsCursor;
      for (const event of result.events ?? []) handleEvent(event);
      if ((result.events ?? []).length) renderActivity();
    } catch { /* próximo ciclo */ }
  }
  function handleEvent(event) {
    const market = state.office?.markets?.find((row) => row.marketKey === event.marketKey);
    const name = market?.display ?? event.marketKey ?? "";
    state.techLog = [{ time: timeOf(event.at), text: `${event.type} ${JSON.stringify(event).slice(0, 160)}` }, ...state.techLog].slice(0, 200);
    if (event.type === "signal.disposition" || event.type === "signal.disposition.final") {
      const direction = event.action === "BUY" ? "compra" : "venda";
      if (event.disposition === "EXECUTED") activityLine(`${name} iniciou operação de ${brl(event.stakeFinal)} (${direction}).`, "", event.at);
      else if (event.disposition === "DUPLICATE") activityLine(`${name} ignorou sinal repetido (${direction}).`, "blocked", event.at);
      else if (event.disposition === "EXPIRED") activityLine(`${name} oportunidade de ${direction} expirou sem execução: ${reasonText(event.reason)}.`, "blocked", event.at);
      else if (event.action) activityLine(`${name} encontrou oportunidade de ${direction}, mas não executou: ${reasonText(event.reason)}.`, "blocked", event.at);
    } else if (event.type === "position.settled") {
      const win = event.brokerResult === "WIN";
      activityLine(`${name} finalizou: ${event.brokerResult === "WIN" ? "WIN" : event.brokerResult === "LOSS" ? "LOSS" : "EMPATE"} ${signed(event.profit)}.`, win ? "" : "loss", event.at);
      state.flashes.set(event.marketKey, { result: event.brokerResult, profit: event.profit });
      setTimeout(() => state.flashes.delete(event.marketKey), 6_000);
    } else if (event.type === "order.ack") activityLine(`${name} ordem confirmada pela IQ Option (nº ${event.brokerOrderId}).`, "", event.at);
    else if (event.type === "order.rejected") activityLine(`${name} ordem recusada: ${reasonText(event.reason)}.`, "blocked", event.at);
    else if (event.type === "connection.disconnected") activityLine("IQ Option desconectada — sistema pausado automaticamente.", "blocked", event.at);
    else if (event.type === "connection.ready") activityLine("IQ Option conectada.", "", event.at);
    else if (event.type === "mode.changed") activityLine(`Conta alterada para ${event.mode === "REAL" ? "real" : "de teste"} — sistema parado por segurança.`, "", event.at);
  }
  function renderTopbar() {
    const office = state.office; if (!office) return;
    const practiceButton = $("officeAccountPractice"), realButton = $("officeAccountReal");
    if (practiceButton) practiceButton.classList.toggle("active", office.mode !== "REAL");
    if (realButton) { realButton.classList.toggle("active", office.mode === "REAL"); realButton.classList.toggle("blocked", !office.aux?.compliance?.realMode?.realModeEnabled); }
    const armed = office.aux?.compliance?.armState?.armed === true;
    const killActive = office.aux?.compliance?.killSwitch?.executionEnabled !== true;
    const connected = office.connection?.connected === true;
    const verified = office.modeState?.practice?.verified === true || office.mode === "REAL";
    const auto = office.config?.autoExecute === true;
    const operating = armed && auto && !killActive;
    const startButton = $("officeSystemStart"), stopButton = $("officeSystemStop"), stateLabel = $("officeSystemState");
    if (startButton) startButton.hidden = operating;
    if (stopButton) stopButton.hidden = !operating;
    if (stateLabel) {
      if (killActive) stateLabel.textContent = "Sistema parado pela PARADA DE EMERGÊNCIA.";
      else if (!connected) stateLabel.textContent = "Sistema pausado porque a conexão com a IQ Option foi perdida.";
      else if (!verified) stateLabel.textContent = "Sistema bloqueado: conta de teste ainda não verificada.";
      else if (!office.activeCount) stateLabel.textContent = "Sistema pronto, mas nenhum mercado está ativo.";
      else if (operating) stateLabel.textContent = "SISTEMA OPERANDO — os agentes executam automaticamente quando encontram oportunidade.";
      else if (armed && !auto) stateLabel.textContent = "Sistema pronto, mas a execução automática está desligada.";
      else stateLabel.textContent = "SISTEMA PARADO — os agentes apenas observam.";
    }
    const emergency = $("officeEmergency");
    if (emergency) { emergency.textContent = killActive ? "REATIVAR SISTEMA" : "PARADA DE EMERGÊNCIA"; emergency.classList.toggle("danger", !killActive); emergency.classList.toggle("warn", killActive); }
    const chipIq = $("officeChipIq"); if (chipIq) { chipIq.textContent = connected ? "IQ Option conectada" : "IQ Option desconectada"; chipIq.className = `office-chip ${connected ? "on" : "bad"}`; }
    const chipMarkets = $("officeChipMarkets"); if (chipMarkets) { chipMarkets.textContent = `${office.activeCount} de ${office.activeLimit} mercados`; chipMarkets.className = `office-chip ${office.activeCount >= office.activeLimit ? "warn" : "on"}`; }
    const positions = office.portfolio?.openPositions?.length ?? 0;
    const chipPositions = $("officeChipPositions"); if (chipPositions) { chipPositions.textContent = `${positions} em operação`; chipPositions.className = `office-chip ${positions ? "on" : ""}`; }
    const pnl = office.portfolio?.settled?.pnl ?? 0;
    const chipResult = $("officeChipResult"); if (chipResult) { chipResult.textContent = `Resultado do dia ${signed(pnl)}`; chipResult.className = `office-chip ${pnl > 0 ? "on" : pnl < 0 ? "bad" : ""}`; }
    const limitInput = $("officeLimitInput"); if (limitInput && document.activeElement !== limitInput) limitInput.value = String(office.config?.globalMaxStake ?? 2);
  }
  function renderAux() {
    const office = state.office; if (!office) return;
    const aux = office.aux ?? {};
    const tiles = [
      { kind: "risk", label: "RISCO", value: `${aux.risk?.openPositions ?? 0} em operação`, hint: `em risco ${brl(aux.risk?.stakeAtRisk)}`, state: (aux.risk?.concentrationWarnings?.length ?? 0) > 0 ? "warn" : "" },
      { kind: "compliance", label: "SEGURANÇA", value: office.mode === "REAL" ? "Conta real" : "Conta de teste", hint: aux.compliance?.killSwitch?.executionEnabled ? "proteções ativas" : "parada de emergência", state: aux.compliance?.killSwitch?.executionEnabled ? "good" : "bad" },
      { kind: "macro", label: "MERCADO", value: aux.macro?.status === "NO_FEED" ? "Ainda não configurado" : String(aux.macro?.status), hint: "contexto macro", state: "muted" },
      { kind: "news", label: "NOTÍCIAS", value: aux.news?.status === "NO_FEED" ? "Ainda não configurado" : String(aux.news?.status), hint: "sem feed conectado", state: "muted" },
      { kind: "executionGate", label: "EXECUÇÃO", value: aux.executionGate?.state === "ARMED" ? "Liberada" : aux.executionGate?.state === "ORDERING" ? "Executando" : aux.executionGate?.state === "BLOCKED" ? "Bloqueada" : "Parada", hint: `${aux.executionGate?.pendingOrders ?? 0} ordem(ns) em andamento`, state: aux.executionGate?.state === "ARMED" ? "good" : aux.executionGate?.state === "BLOCKED" ? "bad" : "" },
      { kind: "portfolioControl", label: "CARTEIRA", value: `Resultado ${signed(office.portfolio?.settled?.pnl ?? 0)}`, hint: `${office.portfolio?.settled?.wins ?? 0}W · ${office.portfolio?.settled?.losses ?? 0}L · ${office.portfolio?.settled?.draws ?? 0}E`, state: (office.portfolio?.settled?.pnl ?? 0) >= 0 ? "good" : "bad" },
    ];
    const container = $("officeAux"); if (!container) return;
    container.innerHTML = tiles.map((tile) => `<button class="office-aux-tile ${tile.state}" data-aux="${tile.kind}"><span>${tile.label}</span><b>${tile.value}</b><small>${tile.hint}</small></button>`).join("");
  }

  /* ------------------------------ drawers/modais ------------------------------ */
  function closeDrawers() { if (overlay) overlay.innerHTML = ""; state.selectedMarket = null; }
  function drawerShell(title, subtitle, subtitleKind, extra = "", extraClass = "") {
    return `<div class="office-drawer"><button class="office-btn ghost close small" data-close="1">FECHAR</button>
      <div class="office-hero"><span class="office-badge ${subtitleKind}">${subtitle}</span><h3>${title}</h3></div>${extra}</div>`.replace("<h3>", `<h3 class="${extraClass}">`);
  }
  function marketDrawer(marketKey, silent = false) {
    const market = state.office?.markets?.find((row) => row.marketKey === marketKey);
    if (!market || !overlay) return;
    if (!silent) state.selectedMarket = marketKey;
    const position = market.positionState ?? {};
    const daily = market.settlementState?.daily ?? {};
    const latency = market.latency ?? {};
    const feature = market.featureState ?? {};
    const decision = market.decisionState ?? {};
    const status = market.paused ? "Pausado" : isDown(market) ? (market.availability === "NOT_FOUND" ? "Indisponível" : "Sem dados") : market.positionState?.status === "OPEN" ? "Em operação" : market.agentState === "SIGNAL" ? "Oportunidade encontrada" : "Aguardando";
    overlay.innerHTML = drawerShell(`${market.symbol}`, market.marketType, market.marketType === "OTC" ? "otc" : "normal", `
      <div class="office-kv">
        <div><span>STATUS</span><b>${status}</b></div>
        <div><span>PAYOUT</span><b>${market.payout ?? "—"}%</b></div>
        <div><span>LIMITE POR OPERAÇÃO</span><b>${brl(market.maxStake)}</b></div>
        <div><span>ESTRATÉGIA</span><b>${market.strategy ?? "—"}</b></div>
        <div><span>OPERAÇÕES HOJE</span><b>${daily.trades ?? 0}</b></div>
        <div><span>GANHOS</span><b>${daily.wins ?? 0}</b></div>
        <div><span>PERDAS</span><b>${daily.losses ?? 0}</b></div>
        <div><span>RESULTADO</span><b>${signed(daily.settledPnl ?? 0)}</b></div>
        <div><span>ÚLTIMA DECISÃO</span><b>${decision.action ?? "—"}</b></div>
      </div>
      <div class="office-actions">
        <button class="office-btn ${market.paused ? "primary" : "warn"}" data-market-pause="${market.marketKey}">${market.paused ? "RETOMAR AGENTE" : "PAUSAR AGENTE"}</button>
        <label class="office-field">LIMITE R$ <input type="number" min="1" max="100" step="1" value="${Number(market.maxStake) || 1}" data-market-stake-input="${market.marketKey}" /></label>
        <button class="office-btn" data-market-stake="${market.marketKey}">SALVAR LIMITE</button>
        <label class="office-field">ESTRATÉGIA <select data-market-strategy="${market.marketKey}">${["V1", "V2", "V3", "V8"].map((family) => `<option ${String(market.strategy) === family ? "selected" : ""}>${family}</option>`).join("")}</select></label>
        <button class="office-btn" data-market-strategy-save="${market.marketKey}">SALVAR ESTRATÉGIA</button>
      </div>
      <p class="fine">Alterações valem para a próxima operação; uma operação em andamento mantém o valor combinado.</p>
      <button class="office-details-toggle" data-toggle-details="1">DETALHES AVANÇADOS</button>
      <div class="office-details" id="officeMarketDetails" hidden>
        <div class="office-kv">
          <div><span>MERCADO</span><b>${market.marketKey}</b></div>
          <div><span>ACTIVE ID</span><b>${market.activeId ?? "—"}</b></div>
          <div><span>SEGMENTO</span><b>${market.lastTick?.segmentId ?? "—"}</b></div>
          <div><span>DADOS ATUAIS</span><b>${feature.fresh ? "saudáveis" : feature.freshnessReason ?? "—"} · ${market.lastTick?.ageMs ?? "—"}ms</b></div>
          <div><span>LATÊNCIA p50/p95</span><b>${latency.serverToReceived?.p50 ?? "—"} / ${latency.serverToReceived?.p95 ?? "—"} ms</b></div>
          <div><span>CANDLES 5s</span><b>${market.candles5s ?? 0}</b></div>
          <div><span>RSI / ATR / ADX</span><b>${Number.isFinite(feature.rsi14) ? feature.rsi14.toFixed(1) : "—"} / ${Number.isFinite(feature.atr14) ? feature.atr14.toFixed(5) : "—"} / ${Number.isFinite(feature.adx14) ? feature.adx14.toFixed(1) : "—"}</b></div>
          <div><span>CONFIANÇA / TRIGGER</span><b>${decision.confidence ?? "—"} · ${decision.trigger ? `s ${Number(decision.trigger.s ?? 0).toFixed(2)}` : "—"}</b></div>
          <div><span>ENTRADA / DIREÇÃO</span><b>${position.entryPrice ?? "—"} · ${position.direction ?? "—"}</b></div>
          <div><span>PREÇO ATUAL</span><b>${market.lastTick?.price ?? "—"}</b></div>
        </div>
      </div>`);
  }
  function auxDrawer(kind) {
    const office = state.office; if (!office || !overlay) return;
    const titles = { risk: "RISCO", compliance: "SEGURANÇA", executionGate: "EXECUÇÃO", portfolioControl: "CARTEIRA", macro: "MERCADO", news: "NOTÍCIAS" };
    let content = "";
    if (kind === "risk") content = `<div class="office-kv"><div><span>EM OPERAÇÃO</span><b>${office.aux.risk.openPositions}</b></div><div><span>VALOR EM RISCO</span><b>${brl(office.aux.risk.stakeAtRisk)}</b></div><div><span>LIMITE POR MERCADO</span><b>1 operação</b></div><div><span>LIMITE DE MERCADOS</span><b>${office.aux.risk.limits.maxActiveMarkets}</b></div></div><div class="office-list">${(office.aux.risk.exposure ?? []).map((row) => `<div class="office-list-row"><div><b>${row.currency}</b><small>exposição ${signed(row.net)} · ${brl(row.stake)}</small></div><div class="right"><span class="office-badge ${Math.max(row.longCount, row.shortCount) >= 3 ? "bad" : "good"}">${row.longCount}C/${row.shortCount}V</span></div></div>`).join("") || "<p class='fine'>Nenhuma operação aberta.</p>"}</div>`;
    else if (kind === "compliance") content = `<div class="office-kv"><div><span>CONTA</span><b>${office.mode === "REAL" ? "Real" : "De teste"}</b></div><div><span>SISTEMA</span><b>${office.aux.compliance.armState?.armed ? "Operando" : "Parado"}</b></div><div><span>EXECUÇÃO AUTOMÁTICA</span><b>${office.config.autoExecute ? "Ligada" : "Desligada"}</b></div><div><span>PARADA DE EMERGÊNCIA</span><b>${office.aux.compliance.killSwitch?.executionEnabled ? "Livre" : "Acionada"}</b></div><div><span>LIMITE MÁXIMO</span><b>${brl(office.config.hardCap)}</b></div><div><span>CONTA REAL</span><b>${office.aux.compliance.realMode?.realModeEnabled ? "Autorizada" : "Bloqueada"}</b></div></div><p class="fine">Proteções permanentes: somente conta de teste por padrão; conta real exige confirmação explícita; uma ordem por decisão; uma operação por mercado; NORMAL nunca vira OTC automaticamente.</p>`;
    else if (kind === "executionGate") content = `<div class="office-kv"><div><span>SITUAÇÃO</span><b>${office.aux.executionGate.state === "ARMED" ? "Liberada" : office.aux.executionGate.state === "ORDERING" ? "Executando" : office.aux.executionGate.state === "BLOCKED" ? "Bloqueada" : "Parada"}</b></div><div><span>ORDENS EM ANDAMENTO</span><b>${office.aux.executionGate.pendingOrders}</b></div><div><span>MERCADOS LIBERADOS</span><b>${(office.aux.executionGate.allowedMarkets ?? []).length}</b></div><div><span>MERCADOS BLOQUEADOS</span><b>${(office.aux.executionGate.blockedMarkets ?? []).length}</b></div></div>`;
    else if (kind === "portfolioControl") content = `<div class="office-kv"><div><span>MERCADOS ATIVOS</span><b>${office.activeCount}/${office.activeLimit}</b></div><div><span>EM OPERAÇÃO</span><b>${office.portfolio.openPositions.length}</b></div><div><span>RESULTADO</span><b>${signed(office.portfolio.settled.pnl)}</b></div><div><span>GANHOS/PERDAS/EMPATES</span><b>${office.portfolio.settled.wins}/${office.portfolio.settled.losses}/${office.portfolio.settled.draws}</b></div></div>`;
    else content = `<p class="fine">Ainda não configurado. Nenhuma informação é inventada enquanto o feed não existir.</p>`;
    overlay.innerHTML = drawerShell(titles[kind] ?? kind, "PAINEL", "muted", content);
  }
  function chooseMarketsModal() {
    const office = state.office; if (!office || !overlay) return;
    const row = (market) => `<div class="office-market-row">
        <div><b>${market.display}</b><small>${market.availability === "OPEN" ? (market.marketType === "OTC" ? `disponível · payout ${market.payout ?? "—"}%` : "disponível") : market.availability === "SUSPENDED" ? "temporariamente suspenso" : "indisponível neste horário"}</small></div>
        <div class="right"><button class="office-btn ${market.enabled ? "warn" : "primary"}" data-choose-toggle="${market.marketKey}" ${!market.enabled && (office.activeCount >= office.activeLimit || market.availability !== "OPEN") ? "disabled" : ""}>${market.enabled ? "DESLIGAR" : "ATIVAR"}</button></div>
      </div>`;
    const normal = office.markets.filter((market) => market.marketType === "NORMAL");
    const otc = office.markets.filter((market) => market.marketType === "OTC");
    overlay.innerHTML = `<div class="office-modal"><div class="office-modal-card">
      <button class="office-btn ghost close small" data-close="1" style="float:right">FECHAR</button>
      <h3>ESCOLHER MERCADOS</h3>
      <p><b>${office.activeCount} de ${office.activeLimit} mercados ativos.</b> Você pode ativar até ${office.activeLimit} mercados ao mesmo tempo (NORMAL + OTC). OTC nunca substitui NORMAL automaticamente.</p>
      <div class="office-section-title">NORMAL (${normal.filter((market) => market.enabled).length} de ${normal.length} ativos)</div>
      ${normal.map(row).join("")}
      <div class="office-section-title">OTC (${otc.filter((market) => market.enabled).length} de ${otc.length} ativos)</div>
      ${otc.map(row).join("")}
      <p class="fine">As mesas se reorganizam automaticamente conforme os mercados escolhidos.</p>
    </div></div>`;
  }
  function realModal() {
    const office = state.office; if (!office || !overlay) return;
    const realState = office.modeState?.real ?? {};
    const realMode = office.aux?.compliance?.realMode ?? {};
    overlay.innerHTML = `<div class="office-modal"><div class="office-modal-card danger">
      <button class="office-btn ghost close small" data-close="1" style="float:right">FECHAR</button>
      <h3>ATIVAR CONTA REAL</h3>
      <p><b>Saldo real disponível:</b> ${money(realState.balance, realState.currency)}</p>
      <p><b>Aviso:</b> operações em conta real usam dinheiro real. O TraceCom pode enviar ordens reais na sua conta IQ Option após todos os gates de segurança.</p>
      <label class="office-field">LIMITE MÁXIMO REAL (teto ${brl(office.config.hardCap)}) <input id="officeRealStake" type="number" min="1" max="${office.config.hardCap}" step="1" value="${Number(realMode.maxStake) || 1}" /></label>
      <div class="row"><input id="officeRealAck" type="checkbox" /><label for="officeRealAck">Confirmo que li o aviso e aceito operar com dinheiro real.</label></div>
      <p>Digite <b>${realMode.phraseRequired ?? "OPERAR CONTA REAL"}</b> para confirmar:</p>
      <input id="officeRealPhrase" type="text" autocomplete="off" placeholder="OPERAR CONTA REAL" />
      <div class="office-actions">
        <button class="office-btn danger" id="officeRealConfirm">CONFIRMAR CONTA REAL</button>
        <button class="office-btn ghost" data-close="1">CANCELAR</button>
        ${realMode.realModeEnabled ? '<button class="office-btn warn" id="officeRealRevoke">DESATIVAR CONTA REAL</button>' : ""}
      </div>
      <p class="fine">A conta real volta a ficar bloqueada após recarregar a página, reinício, deploy, erro de conexão, confirmação desconhecida ou troca de conta.</p>
    </div></div>`;
  }
  function advancedDrawer() {
    const office = state.office; if (!office || !overlay) return;
    const metrics = office.metrics ?? {};
    const resolver = office.resolver ?? {};
    overlay.innerHTML = `<div class="office-drawer"><button class="office-btn ghost close small" data-close="1">FECHAR</button><h3>Detalhes avançados</h3>
      <p class="fine">Informação técnica para diagnóstico. O usuário comum não precisa desta área.</p>
      <div class="office-kv">
        <div><span>CONEXÃO</span><b>${office.connection?.host ?? "—"}</b></div>
        <div><span>SERVER TIME</span><b>${office.connection?.timeValid ? "sincronizado" : "dessincronizado"} (${office.connection?.clockSkewMs ?? "—"}ms)</b></div>
        <div><span>RECONEXÕES</span><b>${office.connection?.reconnects ?? 0}</b></div>
        <div><span>CONNECTION ID</span><b>${String(office.connection?.connectionId ?? "—").slice(0, 18)}</b></div>
        <div><span>RESOLVER</span><b>${resolver.resolvedCount ?? 0} mercados resolvidos</b></div>
        <div><span>RECONCILIAÇÃO</span><b>${office.reconcile?.error ? office.reconcile.error : "ok"} (${office.reconcile?.checked ?? 0})</b></div>
        <div><span>MEMÓRIA / UPTIME</span><b>${metrics.memoryMb ?? "—"}MB · ${Math.round((metrics.uptimeSec ?? 0) / 60)}min</b></div>
        <div><span>MENSAGENS / CANDLES</span><b>${metrics.messages ?? 0} / ${metrics.candles ?? 0}</b></div>
      </div>
      <div class="office-actions">
        <button class="office-btn" id="officeStressRun">Rodar teste de estresse (1/3/5/10)</button>
        <button class="office-btn ghost" id="officeCameraReset">Resetar câmera</button>
        <button class="office-btn ghost" id="officeRawLog">${state.showTechActivity ? "Ver atividade amigável" : "Ver log técnico"}</button>
      </div>
      <p class="fine" id="officeStressReport">${office.stress?.report ? `Último teste: ${(office.stress.report.results ?? []).map((row) => `${row.stage}→${row.markets?.length ?? 0}`).join(" · ")}` : "Nenhum teste de estresse executado."}</p>
    </div>`;
  }

  /* ------------------------------ interações ------------------------------ */
  function hitTest(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    const targets = canvas.__targets ?? [];
    for (let index = targets.length - 1; index >= 0; index -= 1) { const target = targets[index]; if (x >= target.x && x <= target.x + target.w && y >= target.y && y <= target.y + target.h) return target; }
    return null;
  }
  function bindInteractions() {
    if (!canvas) return;
    canvas.addEventListener("pointerdown", (event) => { state.dragging = true; state.dragMoved = false; state.lastPointer = { x: event.clientX, y: event.clientY }; canvas.classList.add("dragging"); });
    window.addEventListener("pointerup", (event) => {
      if (state.dragging && !state.dragMoved) { const target = hitTest(event.clientX, event.clientY); if (target?.type === "desk") marketDrawer(target.key); }
      state.dragging = false; canvas.classList.remove("dragging");
    });
    window.addEventListener("pointermove", (event) => {
      if (!state.dragging) return;
      const dx = event.clientX - state.lastPointer.x, dy = event.clientY - state.lastPointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) state.dragMoved = true;
      state.camera.x += dx; state.camera.y += dy; state.lastPointer = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener("wheel", (event) => { event.preventDefault(); const rect = canvas.getBoundingClientRect(); const px = event.clientX - rect.left, py = event.clientY - rect.top; const factor = event.deltaY < 0 ? 1.1 : 0.9; const value = Math.min(1.8, Math.max(0.42, state.camera.zoom * factor)); const ratio = value / state.camera.zoom; state.camera.x = px - (px - state.camera.x) * ratio; state.camera.y = py - (py - state.camera.y) * ratio; state.camera.zoom = value; }, { passive: false });
    canvas.addEventListener("dblclick", () => { if (state.defaultCamera) state.camera = { ...state.defaultCamera }; });
  }
  async function startSystem() {
    const limit = Math.min(100, Math.max(1, Number($("officeLimitInput")?.value) || state.office?.config?.globalMaxStake || 2));
    await post("/api/iq/config/global-stake", { value: limit });
    await post("/api/iq/config/auto-execute", { enabled: true });
    await post("/api/iq/arm", { limitBrl: limit, confirmation: "ARM_PRACTICE" });
    activityLine(`Sistema iniciado: operação automática ligada com limite de ${brl(limit)} por operação.`, "");
    return refreshOffice();
  }
  async function stopSystem() {
    await post("/api/iq/config/auto-execute", { enabled: false });
    await post("/api/iq/disarm", {});
    activityLine("Sistema parado: os agentes voltaram a apenas observar.", "");
    return refreshOffice();
  }
  function bindButtons() {
    document.addEventListener("click", async (event) => {
      const target = event.target.closest("[data-close],[data-aux],[data-choose-toggle],[data-toggle-details],[data-market-pause],[data-market-stake],[data-market-strategy-save],#officeAccountPractice,#officeAccountReal,#officeSystemStart,#officeSystemStop,#officeEmergency,#officeApplyLimit,#officeChooseMarkets,#officeAdvanced,#officeActivityTech,#officeRealConfirm,#officeRealRevoke,#officeStressRun,#officeCameraReset,#officeRawLog");
      if (!target) return;
      const id = target.id;
      try {
        if (target.dataset.close) return closeDrawers();
        if (target.dataset.aux) return auxDrawer(target.dataset.aux);
        if (target.dataset.toggleDetails) { const details = $("officeMarketDetails"); if (details) details.hidden = !details.hidden; return; }
        if (id === "officeAccountPractice") { await post("/api/iq/mode", { mode: "PRACTICE" }); activityLine("Conta de teste selecionada.", ""); return refreshOffice(); }
        if (id === "officeAccountReal") return realModal();
        if (id === "officeSystemStart") return startSystem();
        if (id === "officeSystemStop") return stopSystem();
        if (id === "officeEmergency") { const engaged = state.office?.aux?.compliance?.killSwitch?.executionEnabled !== false; await post("/api/iq/kill-switch", { engaged }); activityLine(engaged ? "PARADA DE EMERGÊNCIA acionada: nenhuma nova operação será enviada." : "Sistema reativado após parada de emergência.", engaged ? "blocked" : ""); return refreshOffice(); }
        if (id === "officeApplyLimit") { const value = Math.min(100, Math.max(1, Number($("officeLimitInput")?.value) || 2)); await post("/api/iq/config/global-stake", { value }); activityLine(`Limite por operação definido em ${brl(value)} para todos os agentes.`, ""); return refreshOffice(); }
        if (id === "officeChooseMarkets") return chooseMarketsModal();
        if (id === "officeAdvanced") return advancedDrawer();
        if (id === "officeActivityTech") { state.showTechActivity = !state.showTechActivity; target.textContent = state.showTechActivity ? "ver atividade" : "ver log técnico"; return renderActivity(); }
        if (id === "officeRawLog") { state.showTechActivity = !state.showTechActivity; return advancedDrawer(); }
        if (id === "officeCameraReset") { if (state.defaultCamera) state.camera = { ...state.defaultCamera }; return; }
        if (id === "officeStressRun") { await post("/api/iq/stress/run", { stages: [1, 3, 5, 10], secondsPerStage: 20 }); activityLine("Teste de estresse iniciado (1/3/5/10 mercados).", ""); return advancedDrawer(); }
        if (id === "officeRealConfirm") { const maxStake = Number($("officeRealStake")?.value) || 1; const phrase = String($("officeRealPhrase")?.value ?? ""); const acknowledgeRisk = $("officeRealAck")?.checked === true; await post("/api/iq/real/confirm", { maxStake, phrase, acknowledgeRisk }); activityLine(`Conta real confirmada no servidor (limite ${brl(maxStake)}).`, ""); closeDrawers(); return refreshOffice(); }
        if (id === "officeRealRevoke") { await post("/api/iq/real/revoke", {}); activityLine("Conta real desativada.", ""); closeDrawers(); return refreshOffice(); }
        if (target.dataset.chooseToggle) { const market = state.office?.markets?.find((row) => row.marketKey === target.dataset.chooseToggle); await put("/api/iq/market", { marketKey: target.dataset.chooseToggle, enabled: market?.enabled !== true }); return refreshOffice().then(() => chooseMarketsModal()); }
        if (target.dataset.marketPause) { const market = state.office?.markets?.find((row) => row.marketKey === target.dataset.marketPause); await put("/api/iq/market", { marketKey: target.dataset.marketPause, paused: market?.paused !== true }); activityLine(`${market?.display ?? target.dataset.marketPause} ${market?.paused ? "retomado" : "pausado"}.`, ""); return refreshOffice(); }
        if (target.dataset.marketStake) { const value = Number(document.querySelector(`[data-market-stake-input="${CSS.escape(target.dataset.marketStake)}"]`)?.value); await put("/api/iq/market", { marketKey: target.dataset.marketStake, maxStake: value }); activityLine(`Limite de ${target.dataset.marketStake} definido em ${brl(value)}.`, ""); return refreshOffice(); }
        if (target.dataset.marketStrategySave) { const value = document.querySelector(`[data-market-strategy="${CSS.escape(target.dataset.marketStrategySave)}"]`)?.value; await put("/api/iq/market", { marketKey: target.dataset.marketStrategySave, strategy: value }); activityLine(`Estratégia de ${target.dataset.marketStrategySave} alterada para ${value}.`, ""); return refreshOffice(); }
      } catch (error) { activityLine(`Ação não concluída: ${String(error?.message || error).slice(0, 90)}`, "blocked"); renderActivity(); }
    });
  }
  function bindNavDefault() {
    const navButton = document.querySelector('.nav-item[data-page="office"]');
    if (navButton) navButton.click();
  }
  async function enforceReloadReset() {
    if (window.__OFFICE_FIXTURE__) return;
    try {
      const office = await get("/api/iq/office");
      if (office.mode === "REAL" || office.modeState?.realMode?.realModeEnabled === true) {
        await post("/api/iq/mode", { mode: "PRACTICE" }).catch(() => undefined);
        activityLine("Recarregamento detectado: conta real desativada e conta de teste restaurada.", "blocked");
      }
    } catch { /* backend indisponível */ }
  }
  function init() {
    canvas = $("officeCanvas"); overlay = $("officeOverlay");
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    bindInteractions(); bindButtons(); bindNavDefault();
    window.addEventListener("resize", () => { if (!state.initialized) computeDefaultCamera(); });
    requestAnimationFrame(render);
    void enforceReloadReset().then(() => refreshOffice());
    setInterval(() => { const page = $("page-office"); if (page && !page.hidden) void refreshOffice(); }, 2_000);
    setInterval(() => { const page = $("page-office"); if (page && !page.hidden) void pollEvents(); }, 1_000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  return { refresh: refreshOffice };
})();
