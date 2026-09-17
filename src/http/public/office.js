/* Escritório de Agentes — 15 estações (NORMAL + OTC), produto simples, backend é a fonte da verdade.
 * Arte original por código. Configuração visível = configuração real (revisões evitam stale polling). */
const OfficeUI = (() => {
  const $ = (id) => document.getElementById(id);
  const api = async (path, options) => {
    const response = await fetch(path, { headers: { accept: "application/json", ...(options?.body ? { "content-type": "application/json" } : {}) }, ...options, body: options?.body ? JSON.stringify(options.body) : undefined });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(body.reason || body.error || `HTTP ${response.status}`); error.code = body.error || null; error.reason = body.reason || null; error.details = body.details || null; error.status = response.status; throw error; }
    return body;
  };
  const get = (path) => api(path);
  const post = (path, body) => api(path, { method: "POST", body: body ?? {} });
  const put = (path, body) => api(path, { method: "PUT", body: body ?? {} });
  const brl = (value) => (Number.isFinite(Number(value)) ? `R$ ${Number(value).toFixed(2)}` : "R$ —");
  const signed = (value) => (Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? "+" : "−"}R$ ${Math.abs(Number(value)).toFixed(2)}` : "—");
  const money = (value, currency = "") => (Number.isFinite(Number(value)) ? `${currency ? currency + " " : ""}${Number(value).toFixed(2)}` : "—");
  const timeOf = (ms) => (Number.isFinite(Number(ms)) ? new Date(Number(ms)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "--:--");


  const TILE_W = 84, TILE_H = 38, TILE_Z = 26;
  const SLOTS = [
    { gx: 0, gy: 0 }, { gx: 3.6, gy: 0 }, { gx: 7.2, gy: 0 }, { gx: 10.8, gy: 0 }, { gx: 14.4, gy: 0 },
    { gx: 0, gy: 7.6 }, { gx: 3.6, gy: 7.6 }, { gx: 7.2, gy: 7.6 }, { gx: 10.8, gy: 7.6 }, { gx: 14.4, gy: 7.6 },
    { gx: 0, gy: 16.6 }, { gx: 3.6, gy: 16.6 }, { gx: 7.2, gy: 16.6 }, { gx: 10.8, gy: 16.6 }, { gx: 14.4, gy: 16.6 },
  ];
  const state = {
    office: null, eventsCursor: 0, selectedMarket: null, activity: [], activitySeeded: false, techLog: [],
    camera: { x: 0, y: 0, zoom: 1 }, defaultCamera: null, dragging: false, dragMoved: false, lastPointer: { x: 0, y: 0 },
    flashes: new Map(), deskAnim: new Map(), initialized: false, showTechActivity: false,
    pinned: new Map(), drawerDirty: false, toast: null,
    supervisor: { gx: 7.2, gy: 8, slotIndex: 2, state: "OBSERVANDO", label: null, until: 0, lastWander: 0 },
  };
  let canvas = null, ctx = null, overlay = null;

  function iso(gx, gy, gz = 0) { return { x: (gx - gy) * TILE_W / 2, y: (gx + gy) * TILE_H / 2 - gz * TILE_Z }; }
  function project(gx, gy, gz = 0) { const p = iso(gx, gy, gz); return { x: state.camera.x + p.x * state.camera.zoom, y: state.camera.y + p.y * state.camera.zoom }; }
  const zoom = () => state.camera.zoom;
  function block(g, x, y, w, h, color) { g.fillStyle = color; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function text(g, value, x, y, { size = 10, color = "#dbe6ff", align = "center", bold = false } = {}) {
    g.fillStyle = color; g.font = `${bold ? "bold " : ""}${Math.max(7, Math.round(size * zoom()))}px "Courier New", monospace`; g.textAlign = align; g.textBaseline = "middle"; g.fillText(String(value), x, y);
  }

  const AVAILABILITY_TEXT = {
    OPEN: "MERCADO ABERTO",
    SUSPENDED: "SUSPENSO PELA IQ (BROKER)",
    NOT_OFFERED: "NAO OFERECIDO PELA IQ",
    DISABLED: "DESABILITADO PELA IQ",
    UNKNOWN: "AGUARDANDO BROKER",
    NOT_FOUND: "NAO ENCONTRADO NO BROKER",
  };
  const availabilityLabel = (value) => AVAILABILITY_TEXT[String(value ?? "UNKNOWN")] ?? String(value ?? "DESCONHECIDO");
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
    MARKET_AVAILABLE: "mercado indisponível na IQ Option neste momento",
    MARKET_ENABLED: "agente desativado pelo operador",
    CANDIDATE_LOGIC_CHANGED_TO_WAIT: "a leitura virou WAIT antes da janela",
    CANDIDATE_LOGIC_CHANGED_DIRECTION: "a direção mudou antes da janela",
    CANDIDATE_REGIME_CHANGED: "regime mudou antes da entrada",
    CANDIDATE_SETUP_INVALIDATED: "setup deixou de ser válido",
    CANDIDATE_TRIGGER_GONE: "trigger desapareceu",
    CANDIDATE_CRITIC_VETO: "crítico vetou na revalidação final",
    CANDIDATE_CONSENSUS_LOST: "consenso não confirmou na revalidação",
    CANDIDATE_DATA_STALE: "dados não estavam frescos na revalidação",
    ENTRY_WINDOW_MISSED: "janela de entrada perdida (não persegue preço)",
    ENTRY_EXPIRATION_MISMATCH: "expiração do broker diferente da janela alvo",
  };
  const reasonText = (reason) => {
    if (!reason) return "motivo não informado";
    if (REASON_TEXT[reason]) return REASON_TEXT[reason];
    if (String(reason).startsWith("GATE_")) return `bloqueado pelo gate (${String(reason).slice(5)})`;
    if (String(reason).endsWith("_EXPIRADO")) return `${reasonText(String(reason).replace("_EXPIRADO", ""))} — oportunidade expirou`;
    return String(reason).toLowerCase().replaceAll("_", " ");
  };
  const stakeAdjustmentText = (signal) => {
    const adjustment = signal?.stakeAdjustment;
    if (!adjustment?.applied) return "";
    return ` (valor configurado ${brl(signal.stakeRequested ?? signal.stakeConfigured)}, executado ${brl(adjustment.to)}: limite ${adjustment.reason.toLowerCase().replaceAll("_", " ")})`;
  };

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
    else if (pose === "sleep") { block(g, x - 4.6 * p, armY + p, 2.6 * p, p, colors.skin); block(g, x - 1.6 * p, armY + 2 * p, 3.2 * p, p, colors.pants); }
    else if (pose === "offline") { block(g, x - 4.2 * p, armY + p, p + 1.2 * p, p, colors.skin); block(g, x + 2 * p, armY + p, p + 1.2 * p, p, colors.skin); }
    else { block(g, x - 4.2 * p, armY, p + 1.2 * p, p, colors.skin); block(g, x + 2 * p, armY, p + 1.2 * p, p, colors.skin); }
    if (pose === "error") { block(g, x - 0.4 * p, headY - 3.4 * p, 1.2 * p, 2.2 * p, "#ff5d5d"); block(g, x - 0.4 * p, headY - 1 * p, 1.2 * p, 1.2 * p, "#ff5d5d"); }
  }
  const paletteFor = (market) => market.marketType === "OTC"
    ? { shirt: "#c98a2e", shirtLight: "#e8ad4d", pants: "#2c3448", skin: "#f0c39a", hair: "#3a2a1c" }
    : { shirt: "#3f6fd8", shirtLight: "#5b8cf0", pants: "#232c42", skin: "#f0c39a", hair: "#2b2b33" };
  const isClosed = (market) => market?.availability !== "OPEN";
  const isPaused = (market) => market?.paused === true;
  const isDisabled = (market) => market && market.availability === "OPEN" && market.enabled !== true;
  function bubbleInfo(market) {
    if (isClosed(market)) return { text: availabilityLabel(market.availability), kind: "SLEEP" };
    if (isDisabled(market)) return { text: "DESATIVADO", kind: "DISABLED" };
    if (isPaused(market)) return { text: "PAUSADO", kind: "PAUSED" };
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
  const bubbleColor = (kind) => kind === "FAVORABLE" || kind === "WIN" ? "#8ce4a0" : kind === "UNFAVORABLE" || kind === "LOSS" ? "#ff8f8f" : kind === "ERROR" ? "#ff5d5d" : kind === "SIGNAL" ? "#ffd76a" : kind === "SLEEP" ? "#7f93b8" : kind === "DISABLED" || kind === "PAUSED" ? "#9fb2d6" : kind === "ORDERING" ? "#7fc4ff" : "#d7e4ff";
  const poseFor = (market, frame) => {
    if (isClosed(market)) return "sleep";
    if (isDisabled(market) || isPaused(market)) return "think";
    if (market.agentState === "ERROR") return "error";
    if (market.agentState === "IN_POSITION") return market.indicative?.state === "UNFAVORABLE" ? "loss" : "typing";
    if (market.agentState === "ORDERING") return "order";
    if (market.agentState === "SIGNAL" || market.agentState === "ANALYZING") return "typing";
    if (market.agentState === "WIN") return "win";
    if (market.agentState === "LOSS") return "loss";
    return frame % 8 < 5 ? "typing" : "think";
  };

  function diamond(g, cx, cy, w, h, fill, stroke) {
    g.beginPath(); g.moveTo(cx, cy - h / 2); g.lineTo(cx + w / 2, cy); g.lineTo(cx, cy + h / 2); g.lineTo(cx - w / 2, cy); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = Math.max(1, zoom()); g.stroke(); }
  }
  function drawFloor(g) {
    const z = zoom();
    for (let gx = -5; gx <= 20; gx += 2) for (let gy = -7; gy <= 24; gy += 2) {
      const p = project(gx, gy, -0.02);
      const zone = gy < 12 ? "#0a1120" : "#0d1018";
      diamond(g, p.x, p.y, TILE_W * 2 * z, TILE_H * 2 * z, ((gx + gy) / 2) % 2 === 0 ? zone : "#0c1424", "#101a30");
    }
    const normalLabel = project(7.2, -2.4, 0.05), otcLabel = project(7.2, 13.6, 0.05);
    text(g, "MERCADO NORMAL", normalLabel.x, normalLabel.y, { size: 13, color: "#5f78a8", bold: true });
    text(g, "MERCADO OTC", otcLabel.x, otcLabel.y, { size: 13, color: "#8a6f34", bold: true });
  }
  function drawBackWall(g) {
    const z = zoom();
    const left = project(-4, -7, 0), right = project(18.4, -7, 0);
    const height = 200 * z;
    g.fillStyle = "#0b1322";
    g.beginPath(); g.moveTo(left.x, left.y); g.lineTo(right.x, right.y); g.lineTo(right.x, right.y - height); g.lineTo(left.x, left.y - height); g.closePath(); g.fill();
    g.strokeStyle = "#1c2a48"; g.lineWidth = Math.max(1, z); g.stroke();
    const office = state.office;
    const panel = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 - height + 12 * z, w: Math.abs(right.x - left.x) * 0.66, h: height - 26 * z };
    block(g, panel.x - panel.w / 2, panel.y - panel.h, panel.w, panel.h, "#081120");
    g.strokeStyle = "#2a3d63"; g.strokeRect(Math.round(panel.x - panel.w / 2), Math.round(panel.y - panel.h), Math.round(panel.w), Math.round(panel.h));
    const settled = office?.portfolio?.settled ?? { pnl: 0, wins: 0, losses: 0, draws: 0, trades: 0 };
    text(g, "RESULTADO DO DIA", panel.x, panel.y - panel.h + 12 * z, { size: 10, color: "#7f93b8", bold: true });
    text(g, signed(settled.pnl), panel.x, panel.y - panel.h + 34 * z, { size: 32, color: settled.pnl > 0 ? "#8ce4a0" : settled.pnl < 0 ? "#ff9d9d" : "#cfe0ff", bold: true });
    text(g, `operações ${settled.trades} · ${settled.wins} ganhos · ${settled.losses} perdas · ${settled.draws} empates`, panel.x, panel.y - panel.h + 56 * z, { size: 10, color: "#9fb2d6" });
    text(g, `${office?.activeCount ?? 0} mercados ativos · ${office?.portfolio?.openPositions?.length ?? 0} em operação · saldo ${office?.portfolio?.practiceBalance !== null ? money(office?.portfolio?.practiceBalance) : "—"}`, panel.x, panel.y - panel.h + 72 * z, { size: 10, color: "#7f93b8" });
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
  function drawZzz(g, x, y, frame) {
    const z = zoom();
    for (let index = 0; index < 3; index += 1) {
      const phase = ((frame + index * 4) % 12) / 12;
      const size = (7 + index * 2.5) * z;
      g.fillStyle = `rgba(159,178,214,${0.25 + phase * 0.6})`;
      g.font = `bold ${size}px "Courier New", monospace`; g.textAlign = "left"; g.textBaseline = "middle";
      g.fillText("Z", x + index * 7 * z, y - phase * 16 * z - index * 3 * z);
    }
  }
  function drawSlotPlate(g, slotIndex, market) {
    const z = zoom();
    const center = SLOTS[slotIndex];
    if (!center) return;
    const p = project(center.gx + 1.8, center.gy + 1.8, 0.02);
    const w = 96 * z, h = 20 * z;
    block(g, p.x - w / 2, p.y, w, h, "#0d1830cc");
    g.strokeStyle = "#2a3d63"; g.lineWidth = Math.max(1, z); g.strokeRect(Math.round(p.x - w / 2), Math.round(p.y), Math.round(w), Math.round(h));
    text(g, `MESA ${String(slotIndex + 1).padStart(2, "0")}`, p.x, p.y + h / 2, { size: 9, color: "#9fb2d6", bold: true });
  }
  function drawDesk(g, market, slotIndex, targets, bubbles, frame) {
    const z = zoom();
    const anim = state.deskAnim.get(market.marketKey) ?? { gx: SLOTS[slotIndex]?.gx ?? 0, gy: SLOTS[slotIndex]?.gy ?? 0, alpha: 1 };
    const cx = anim.gx + 1.8, cy = anim.gy + 1.8;
    const dim = isClosed(market) ? 0.5 : isDisabled(market) || isPaused(market) ? 0.72 : 1;
    g.globalAlpha = Math.min(1, Math.max(0, anim.alpha)) * dim;
    const top = project(cx, cy, 0.6);
    const w = TILE_W * 1.95 * z, h = TILE_H * 1.95 * z, depth = 20 * z;
    diamond(g, top.x, top.y, w, h, "#16213a", "#2a3d63");
    g.fillStyle = "#0f1830";
    g.beginPath(); g.moveTo(top.x - w / 2, top.y); g.lineTo(top.x, top.y + h / 2); g.lineTo(top.x, top.y + h / 2 + depth); g.lineTo(top.x - w / 2, top.y + depth); g.closePath(); g.fill();
    g.fillStyle = "#0b1226";
    g.beginPath(); g.moveTo(top.x + w / 2, top.y); g.lineTo(top.x, top.y + h / 2); g.lineTo(top.x, top.y + h / 2 + depth); g.lineTo(top.x + w / 2, top.y + depth); g.closePath(); g.fill();
    const m = project(cx - 0.4, cy - 0.4, 0.6);
    const mw = 32 * z, mh = 21 * z;
    block(g, m.x - mw / 2, m.y - mh - 6 * z, mw, mh, "#050a14");
    const powered = !isClosed(market) && !isDisabled(market);
    const glow = !powered ? "#1b2536" : market.agentState === "ERROR" ? "#ff5d5d" : isPaused(market) ? "#f2c14e" : market.positionState?.status === "OPEN" ? (market.indicative?.state === "FAVORABLE" ? "#37d67a" : market.indicative?.state === "UNFAVORABLE" ? "#ff5d5d" : "#f2c14e") : "#4da3ff";
    block(g, m.x - mw / 2 + 2 * z, m.y - mh - 4 * z, mw - 4 * z, mh - 4 * z, glow);
    const plate = project(cx + 0.7, cy + 1.6, 0.35);
    const pw = 128 * z, ph = 46 * z;
    block(g, plate.x - pw / 2, plate.y, pw, ph, "#0b1226");
    g.strokeStyle = market.marketType === "OTC" ? "#96702c" : "#3b5da8"; g.lineWidth = Math.max(1.4, 1.6 * z); g.strokeRect(Math.round(plate.x - pw / 2), Math.round(plate.y), Math.round(pw), Math.round(ph));
    text(g, market.symbol, plate.x, plate.y + 13 * z, { size: 14, color: "#eef4ff", bold: true });
    const badgeW = 62 * z, badgeH = 15 * z;
    block(g, plate.x - badgeW / 2, plate.y + 24 * z, badgeW, badgeH, market.marketType === "OTC" ? "#3a2a10" : "#16264a");
    g.strokeStyle = market.marketType === "OTC" ? "#96702c" : "#3b5da8"; g.strokeRect(Math.round(plate.x - badgeW / 2), Math.round(plate.y + 24 * z), Math.round(badgeW), Math.round(badgeH));
    text(g, market.marketType, plate.x, plate.y + 24 * z + badgeH / 2, { size: 10, color: market.marketType === "OTC" ? "#ffd08a" : "#9fc6ff", bold: true });
    text(g, `payout ${market.payout ?? "-"}  -  ${brl(market.configuredStake)}  -  ${market.setup ?? market.regime ?? "-"}`, plate.x, plate.y + ph + 9 * z, { size: 9, color: "#7f93b8" });
    block(g, plate.x + pw / 2 - 8 * z, plate.y + 5 * z, 5 * z, 5 * z, market.connectionHealth?.connected ? "#37d67a" : "#ff5d5d");
    const agentPos = project(cx + 0.15, cy + 1.05, 0.04);
    const traderPos = project(cx - 0.2, cy + 1.05, 0.04);
    const criticPos = project(cx + 0.72, cy + 1.05, 0.04);
    const pixel = Math.max(1.4, 2.0 * z);
    drawAgent(g, traderPos.x, traderPos.y, pixel, paletteFor(market), poseFor(market, frame), frame);
    drawAgent(g, criticPos.x, criticPos.y, pixel * 0.9, { shirt: "#5b4a8f", shirtLight: "#7f6cc0", pants: "#241f3a", skin: "#f0c39a", hair: "#1d1a2b" }, market.agents && market.agents.trader.action !== "WAIT" ? "think" : (frame % 8 < 5 ? "typing" : "think"), frame + 3);
    text(g, "TRADER", traderPos.x, traderPos.y + 14 * z, { size: 7, color: "#7f93b8" });
    text(g, "CRÍTICO", criticPos.x, criticPos.y + 14 * z, { size: 7, color: "#9384c9" });
    const verdict = market.agents?.critic?.verdict;
    if (verdict && market.agents.at && state.office && Date.now() - market.agents.at < 15_000) {
      const map = { CONFIRM: { text: "✓", color: "#8ce4a0" }, CONTEST: { text: "✗", color: "#ffd76a" }, VETO: { text: "⛔", color: "#ff8f8f" } };
      const badge = map[verdict] ?? null;
      if (badge) text(g, badge.text, criticPos.x, criticPos.y - 22 * z, { size: 12, color: badge.color, bold: true });
    }
    const consensus = consensusBadge(market);
    if (consensus) {
      const badgePos = project(cx + 1.5, cy + 0.35, 0.35);
      const bw = 78 * z, bh = 15 * z;
      block(g, badgePos.x - bw / 2, badgePos.y - bh, bw, bh, "#07101ff2");
      g.strokeStyle = consensus.color; g.lineWidth = Math.max(1.2, 1.3 * z); g.strokeRect(Math.round(badgePos.x - bw / 2), Math.round(badgePos.y - bh), Math.round(bw), Math.round(bh));
      text(g, consensus.text, badgePos.x, badgePos.y - bh / 2, { size: 8.5, color: consensus.color, bold: true });
    }
    const entryBadge = entryStageBadge(market);
    if (entryBadge) {
      const badgePos = project(cx + 1.5, cy + 1.15, 0.35);
      const bw = 118 * z, bh = 15 * z;
      block(g, badgePos.x - bw / 2, badgePos.y - bh, bw, bh, "#07101ff2");
      g.strokeStyle = entryBadge.color; g.lineWidth = Math.max(1.2, 1.3 * z); g.strokeRect(Math.round(badgePos.x - bw / 2), Math.round(badgePos.y - bh), Math.round(bw), Math.round(bh));
      text(g, entryBadge.text, badgePos.x, badgePos.y - bh / 2, { size: 8, color: entryBadge.color, bold: true });
    }
    if (isClosed(market)) drawZzz(g, agentPos.x + 8 * z, agentPos.y - 26 * z, frame);
    targets.push({ x: top.x - w / 2, y: top.y - 30 * z, w, h: h + depth + 70 * z, type: "desk", key: market.marketKey });
    bubbles.push({ x: (traderPos.x + criticPos.x) / 2, y: agentPos.y - 46 * z, ...bubbleInfo(market) });
    g.globalAlpha = 1;
  }
  const APPRENTICE_SLOT = { gx: 20.2, gy: 3.6 };
  function drawApprenticeDesk(g, frame, targets, bubbles) {
    const apprentice = state.office?.apprentice;
    if (!apprentice) return;
    const z = zoom();
    const cx = APPRENTICE_SLOT.gx + 1.8, cy = APPRENTICE_SLOT.gy + 1.8;
    const top = project(cx, cy, 0.6);
    const w = TILE_W * 2.4 * z, h = TILE_H * 2.4 * z, depth = 20 * z;
    diamond(g, top.x, top.y, w, h, "#1a1430", "#5b4a8f");
    g.fillStyle = "#140f24";
    g.beginPath(); g.moveTo(top.x - w / 2, top.y); g.lineTo(top.x, top.y + h / 2); g.lineTo(top.x, top.y + h / 2 + depth); g.lineTo(top.x - w / 2, top.y + depth); g.closePath(); g.fill();
    g.fillStyle = "#100c1c";
    g.beginPath(); g.moveTo(top.x + w / 2, top.y); g.lineTo(top.x, top.y + h / 2); g.lineTo(top.x, top.y + h / 2 + depth); g.lineTo(top.x + w / 2, top.y + depth); g.closePath(); g.fill();
    const monitor = project(cx - 0.5, cy - 0.5, 0.6);
    block(g, monitor.x - 22 * z, monitor.y - 20 * z, 44 * z, 26 * z, "#050a14");
    block(g, monitor.x - 19 * z, monitor.y - 17 * z, 38 * z, 21 * z, "#6a4fd0");
    const plate = project(cx + 0.9, cy + 1.9, 0.35);
    const pw = 150 * z, ph = 40 * z;
    block(g, plate.x - pw / 2, plate.y, pw, ph, "#140f24");
    g.strokeStyle = "#7a5fd0"; g.lineWidth = Math.max(1.4, 1.6 * z); g.strokeRect(Math.round(plate.x - pw / 2), Math.round(plate.y), Math.round(pw), Math.round(ph));
    text(g, "MESA APRENDIZ", plate.x, plate.y + 11 * z, { size: 10, color: "#c9b6ff", bold: true });
    text(g, `TÉCNICA ATUAL: ${apprentice.currentTechniqueId ?? "—"}`, plate.x, plate.y + 23 * z, { size: 8, color: "#9f8fd0" });
    text(g, "LABORATÓRIO · SOMENTE SHADOW (sem ordens)", plate.x, plate.y + ph + 8 * z, { size: 7.5, color: "#7f93b8" });
    const mentorPos = project(cx - 0.35, cy + 1.15, 0.04);
    const learnerPos = project(cx + 0.75, cy + 1.15, 0.04);
    const pixel = Math.max(1.5, 2.1 * z);
    const sinceLesson = apprentice.lessons?.[0] ? Date.now() - Number(apprentice.lessons[0].at) : Infinity;
    const sincePromotion = apprentice.promotions?.[0] ? Date.now() - Number(apprentice.promotions[0].at) : Infinity;
    drawAgent(g, mentorPos.x, mentorPos.y, pixel, { shirt: "#6a4fd0", shirtLight: "#8f74e8", pants: "#241f3a", skin: "#f0c39a", hair: "#1d1a2b" }, sinceLesson < 15_000 ? "think" : "typing", frame);
    drawAgent(g, learnerPos.x, learnerPos.y, pixel, { shirt: "#3fa06a", shirtLight: "#5fc98a", pants: "#1d2f26", skin: "#f0c39a", hair: "#2b2b33" }, sincePromotion < 15_000 ? "win" : "typing", frame + 2);
    text(g, "MENTOR", mentorPos.x, mentorPos.y + 14 * z, { size: 7.5, color: "#a08fe0", bold: true });
    text(g, "APRENDIZ", learnerPos.x, learnerPos.y + 14 * z, { size: 7.5, color: "#7fd0a0", bold: true });
    const mentorBubble = sincePromotion < 15_000
      ? { text: "PASSOU NOVA TÉCNICA", kind: "WIN" }
      : sinceLesson < 15_000 ? { text: "AVALIANDO LOSS", kind: "ANALYZING" } : { text: "PESQUISANDO", kind: "SIGNAL" };
    const learnerBubble = sincePromotion < 15_000
      ? { text: "NOVA TÉCNICA!", kind: "WIN" }
      : { text: `TESTANDO ${String(apprentice.currentTechniqueId ?? "").slice(0, 12)}`, kind: "WAIT" };
    bubbles.push({ x: mentorPos.x, y: mentorPos.y - 46 * z, ...mentorBubble });
    bubbles.push({ x: learnerPos.x, y: learnerPos.y - 46 * z, ...learnerBubble });
    targets.push({ x: top.x - w / 2, y: top.y - 30 * z, w, h: h + depth + 70 * z, type: "apprentice", key: "apprentice" });
  }
  function drawIntelligenceCentral(g, frame, targets) {
    const z = zoom();
    const office = state.office;
    const intel = office?.intelligence ?? {};
    const research = office?.research ?? {};
    const feedSync = office?.feeds?.state ?? {};
    const domains = [
      { key: "MACRO", label: "MACRO", value: intel.MACRO?.status === "OK" ? "EVENTO VIGENTE" : feedSync.MACRO?.status === "OK" ? "CALENDÁRIO OK · SEM EVENTO AGORA" : "SEM FONTE", ok: intel.MACRO?.status === "OK" || feedSync.MACRO?.status === "OK" },
      { key: "NEWS", label: "NOTÍCIAS", value: intel.NEWS?.status === "OK" ? "MANCHETE VIGENTE" : feedSync.NEWS?.status === "OK" ? "FEED OK · SEM MANCHETE AGORA" : "SEM FONTE", ok: intel.NEWS?.status === "OK" || feedSync.NEWS?.status === "OK" },
      { key: "MARKET", label: "MERCADO", value: intel.MARKET?.status === "OK" ? `${office.activeCount} mercados · vol ${Number(intel.MARKET.payload?.avgAtrNormalized ?? 0).toFixed(4)}` : "SEM DADOS", ok: intel.MARKET?.status === "OK" },
      { key: "RISK", label: "RISCO", value: intel.RISK?.status === "OK" ? `${office.portfolio?.openPositions?.length ?? 0} em risco · ${brl(office.aux?.risk?.stakeAtRisk ?? 0)}` : "SEM DADOS", ok: intel.RISK?.status === "OK" },
      { key: "SECURITY", label: "SEGURANÇA", value: intel.SECURITY?.status === "OK" ? "DADOS ÍNTEGROS" : "DADOS PARCIAIS", ok: intel.SECURITY?.status === "OK" },
      { key: "RESEARCH", label: "PESQUISA", value: `${Object.keys(research.setups ?? {}).length} mesas  -  ${office?.brain?.setups ?? 0} setups G2`, ok: intel.RESEARCH?.status === "OK" },
    ];
    text(g, "CENTRAL DE INTELIGÊNCIA", project(7.2, -6.2, 0.6).x, project(7.2, -6.2, 0.6).y, { size: 12, color: "#7fb0ff", bold: true });
    domains.forEach((domain, index) => {
      const gx = index * 2.88, gy = -5.2;
      const top = project(gx + 1.2, gy + 1.2, 0.9);
      const w = TILE_W * 1.5 * z, h = TILE_H * 1.5 * z;
      diamond(g, top.x, top.y, w, h, "#101a2e", domain.ok ? "#2f5d8f" : "#33405e");
      const monitor = project(gx + 0.7, gy + 0.7, 1.5);
      block(g, monitor.x - 20 * z, monitor.y - 16 * z, 40 * z, 26 * z, "#050a14");
      block(g, monitor.x - 18 * z, monitor.y - 14 * z, 36 * z, 22 * z, domain.ok ? "#2f6fd0" : "#1b2536");
      drawAgent(g, monitor.x + 26 * z, monitor.y + 4 * z, Math.max(1.2, 1.8 * z), { shirt: "#4a5f8f", shirtLight: "#6f86bd", pants: "#1d2436", skin: "#f0c39a", hair: "#2b2b33" }, frame % 8 < 5 ? "typing" : "think", frame);
      text(g, domain.label, top.x, top.y + 12 * z, { size: 9.5, color: domain.ok ? "#9fc6ff" : "#8fa3c8", bold: true });
      text(g, String(domain.value).slice(0, 26), top.x, top.y + 24 * z, { size: 8, color: domain.ok ? "#8ce4a0" : "#7f93b8" });
      targets.push({ x: top.x - w / 2, y: top.y - 20 * z, w, h: h + 34 * z, type: "intel", key: domain.key.toLowerCase() });
    });
  }
  function consensusBadge(market) {
    const consensus = market?.agents?.consensus;
    if (!consensus) return null;
    if (consensus.status === "CONFIRMED") return { text: `${consensus.action === "BUY" ? "COMPRA" : "VENDA"} ✓`, color: "#8ce4a0" };
    if (consensus.status === "VETOED") return { text: "VETADO", color: "#ff8f8f" };
    if (consensus.status === "STALE") return { text: "AGUARDANDO", color: "#9fb2d6" };
    return { text: "SEM CONSENSO", color: "#ffd76a" };
  }
  function entryStageBadge(market) {
    const entry = market?.entryTiming;
    if (!entry || !entry.stage) return null;
    const stage = String(entry.stage);
    if (stage === "AGUARDANDO JANELA") return { text: `AGUARDANDO JANELA · ${entry.secondsToRevalidation ?? 0}s`, color: "#9fc6ff" };
    if (stage === "REVALIDANDO") return { text: "REVALIDANDO...", color: "#ffd76a" };
    if (stage === "ENVIANDO ORDEM") return { text: "ENVIANDO ORDEM", color: "#8ce4a0" };
    if (stage === "OPORTUNIDADE CANCELADA") return { text: `CANCELADO · ${String(entry.cancelReason ?? "").replaceAll("_", " ").slice(0, 22)}`, color: "#ff8f8f" };
    if (stage === "OPORTUNIDADE PERDIDA") return { text: "JANELA PERDIDA", color: "#ff8f8f" };
    return { text: "OPORTUNIDADE EM OBSERVAÇÃO", color: "#b794ff" };
  }
  function entryCountdown(entry) {
    if (!entry || entry.secondsToRevalidation === null || entry.secondsToRevalidation === undefined) return null;
    if (entry.stage === "REVALIDANDO" || entry.stage === "ENVIANDO ORDEM") return "Revalidando...";
    if (entry.secondsToRevalidation <= 0) return "Entrada agora";
    return `Revalidação em ${entry.secondsToRevalidation}s`;
  }
  function drawSupervisor(g, frame) {
    const supervisor = state.supervisor;
    const slot = SLOTS[supervisor.slotIndex] ?? SLOTS[0];
    supervisor.gx += (slot.gx + 1.2 - supervisor.gx) * 0.06;
    supervisor.gy += (slot.gy + 2.6 - supervisor.gy) * 0.06;
    const position = project(supervisor.gx, supervisor.gy, 0.04);
    drawAgent(g, position.x, position.y, Math.max(1.6, 2.4 * zoom()), { shirt: "#7a3fd0", shirtLight: "#a06ef0", pants: "#241a3a", skin: "#f0c39a", hair: "#171223" }, supervisor.state === "REVISANDO" ? "think" : "typing", frame);
    const color = supervisor.state === "REVISANDO" ? "#ffd76a" : "#b794ff";
    const label = supervisor.label ?? supervisor.state;
    const z = zoom();
    g.font = `bold ${Math.max(8, Math.round(9.5 * z))}px "Courier New", monospace`;
    const width = Math.max(120 * z, g.measureText(label).width + 20 * z), height = 20 * z;
    const x = Math.min(Math.max(position.x, width / 2 + 6), (canvas?.clientWidth ?? 1000) - width / 2 - 6);
    const y = Math.max(position.y - 40 * z, height + 8);
    block(g, x - width / 2, y - height, width, height, "#0d0718f2");
    g.strokeStyle = color; g.lineWidth = Math.max(1.2, 1.4 * z); g.strokeRect(Math.round(x - width / 2), Math.round(y - height), Math.round(width), Math.round(height));
    g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(`SUPERVISOR ·  ${label}`, x, y - height / 2 + z);
  }
  function drawBubble(g, bubble) {
    const z = zoom();
    const color = bubbleColor(bubble.kind);
    const size = Math.max(9, Math.round(10.5 * z));
    g.font = `bold ${size}px "Courier New", monospace`;
    const width = Math.max(76 * z, g.measureText(bubble.text).width + 22 * z);
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
    if (Date.now() > state.supervisor.until) {
      state.supervisor.state = "OBSERVANDO"; state.supervisor.label = null;
      if (Date.now() - state.supervisor.lastWander > 15_000) {
        state.supervisor.lastWander = Date.now();
        const enabled = (state.office?.markets ?? []).map((market, index) => ({ market, index })).filter((row) => row.market.enabled);
        if (enabled.length) state.supervisor.slotIndex = enabled[Math.floor(Math.random() * enabled.length)]?.index ?? state.supervisor.slotIndex;
      }
    }
    const targets = [], bubbles = [];
    drawFloor(ctx);
    drawBackWall(ctx);
    drawIntelligenceCentral(ctx, frame, targets);
    const markets = state.office?.markets ?? [];
    const byKey = new Map(markets.map((market, index) => [market.marketKey, index]));
    for (const [key] of [...state.deskAnim.entries()]) if (!byKey.has(key)) state.deskAnim.delete(key);
    markets.forEach((market, index) => {
      const target = SLOTS[index] ?? SLOTS[0];
      let anim = state.deskAnim.get(market.marketKey);
      if (!anim) { anim = { gx: target.gx, gy: target.gy - 5, alpha: 0 }; state.deskAnim.set(market.marketKey, anim); }
      anim.targetGx = target.gx; anim.targetGy = target.gy;
      anim.gx += (anim.targetGx - anim.gx) * 0.12;
      anim.gy += (anim.targetGy - anim.gy) * 0.12;
      anim.alpha = Math.min(1, anim.alpha + 0.08);
    });
    for (const [index, market] of markets.entries()) { drawSlotPlate(ctx, index, market); drawDesk(ctx, market, index, targets, bubbles, frame); }
    drawApprenticeDesk(ctx, frame, targets, bubbles);
    for (const bubble of bubbles) drawBubble(ctx, bubble);
    drawSupervisor(ctx, frame);
    canvas.__targets = targets;
    ctx.fillStyle = "#4da3ff22";
    for (let index = 0; index < 20; index += 1) { const px = ((index * 97 + frame * 3) % width); const py = ((index * 53 + Math.sin(index + frame / 6) * 12 + height * 0.3) % height); ctx.fillRect(Math.round(px), Math.round(py), 2, 2); }
    requestAnimationFrame(render);
  }
  function computeDefaultCamera() {
    if (!canvas) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const center = iso(9, 8.2, 0);
    const z = Math.min(0.92, Math.max(0.4, Math.min(width / 1900, height / 1080)));
    state.defaultCamera = { zoom: z, x: width / 2 - center.x * z, y: height * 0.18 - center.y * z };
    state.camera = { ...state.defaultCamera };
  }
  function centerOn(gx, gy, z = null) {
    if (!canvas) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const value = z ?? Math.max(state.camera.zoom, 0.9);
    const p = iso(gx, gy, 0);
    state.camera.x = width / 2 - p.x * value;
    state.camera.y = height * 0.5 - p.y * value;
    state.camera.zoom = value;
  }

  async function refreshOffice() {
    try {
      const incoming = window.__OFFICE_FIXTURE__?.office ?? await get("/api/iq/office");
      state.office = mergePinned(incoming);
      if (!state.initialized) { computeDefaultCamera(); state.initialized = true; }
      if (!state.activitySeeded) { seedActivity(); state.activitySeeded = true; }
      renderTopbar(); renderAux(); renderActivity();
      for (const [key, pinned] of [...state.pinned.entries()]) {
        const market = state.office?.markets?.find((row) => row.marketKey === key);
        if (market && Number(market.revision) >= Number(pinned.market.revision)) state.pinned.delete(key);
      }
      if (state.selectedMarket && !state.drawerDirty) marketDrawer(state.selectedMarket, true);
    } catch {
      const chip = $("officeChipIq");
      if (chip) { chip.textContent = "Servidor offline"; chip.className = "office-chip bad"; }
    }
  }
  /** Revisao anti-race: resposta de polling mais antiga que um save confirmado nao sobrescreve a UI. */
  function mergePinned(incoming) {
    if (!state.pinned.size || !Array.isArray(incoming?.markets)) return incoming;
    const markets = incoming.markets.map((market) => {
      const pinned = state.pinned.get(market.marketKey);
      if (!pinned) return market;
      return Number(market.revision) >= Number(pinned.market.revision) ? market : { ...market, ...pinned.market };
    });
    return { ...incoming, markets };
  }
  function pinMarket(market) { if (market?.marketKey) state.pinned.set(market.marketKey, { market, at: Date.now() }); }

  function seedActivity() {
    const signals = (state.office?.signals ?? []).slice(0, 12).reverse();
    for (const signal of signals) activityLine(signalLine(signal), signal.disposition === "EXECUTED" ? "" : "blocked", signal.at);
  }
  function signalLine(signal) {
    const direction = signal.action === "BUY" ? "compra" : "venda";
    if (signal.disposition === "EXECUTED") return `${signal.display} iniciou operação de ${brl(signal.stakeFinal)} (${direction})${stakeAdjustmentText(signal)}.`;
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
    }     else if (event.type === "order.ack") activityLine(`${name} ordem confirmada pela IQ Option (nº ${event.brokerOrderId})${Number.isFinite(Number(event.entryDriftMs)) && event.entryDriftMs !== null ? ` - entrada ${event.entryDriftMs >= 0 ? "+" : ""}${event.entryDriftMs}ms vs janela` : ""}.`, "", event.at);
    else if (event.type === "candidate.created") activityLine(`<b>OPORTUNIDADE EM OBSERVAÇÃO</b> ${name} ${event.action} - janela ${timeOf(event.targetEntryAt)} (lead ${event.entryLeadMs}ms). Nenhuma ordem enviada.`, "", event.at);
    else if (event.type === "candidate.updated") activityLine(`<b>OPORTUNIDADE EM OBSERVAÇÃO</b> ${name} contexto mudou: ${(event.changed ?? []).join(", ")}.`, "", event.at);
    else if (event.type === "candidate.confirmed") activityLine(`<b>REVALIDAÇÃO FINAL</b> ${name} confirmou ${event.action}; enviando na janela (~${event.secondsToEntry}s).`, "", event.at);
    else if (event.type === "candidate.cancelled") activityLine(`<b>OPORTUNIDADE CANCELADA</b> ${name}: ${reasonText(event.reason)}.`, "blocked", event.at);
    else if (event.type === "order.rejected") activityLine(`${name} ordem recusada: ${reasonText(event.reason)}.`, "blocked", event.at);
    else if (event.type === "connection.disconnected") activityLine("IQ Option desconectada — sistema pausado automaticamente.", "blocked", event.at);
    else if (event.type === "connection.ready") activityLine("IQ Option conectada.", "", event.at);
    else if (event.type === "mode.changed") activityLine(`Conta alterada para ${event.mode === "REAL" ? "real" : "de teste"} — sistema parado por segurança.`, "", event.at);
    else if (event.type === "supervisor.review") {
      const index = (state.office?.markets ?? []).findIndex((row) => row.marketKey === event.marketKey);
      if (index >= 0) state.supervisor.slotIndex = index;
      const escalated = (event.reasons ?? []).length > 0;
      state.supervisor.state = escalated ? "REVISANDO" : "OBSERVANDO";
      state.supervisor.label = escalated ? `REVIEW_REQUIRED ${event.marketKey}` : `MONITORANDO ${event.marketKey}`;
      state.supervisor.until = Date.now() + 12_000;
      activityLine(`<b>SUPERVISOR</b> ${escalated ? `pediu revisao de ${event.marketKey}: ${(event.reasons ?? []).map((reason) => reasonText(reason)).join(", ")}` : `monitorou ${event.marketKey} sem alertas`}. Metodologia intacta.`, escalated ? "blocked" : "", event.at);
    }
    else if (event.type === "apprentice.lesson") {
      const market = state.office?.markets?.find((row) => row.marketKey === event.marketKey);
      activityLine(`<b>MENTOR</b> avaliou o LOSS de ${market?.display ?? event.marketKey}: ${(event.reasons ?? []).join(", ")}${event.candidateId ? ` — nova técnica candidata ${event.candidateId}` : ""}.`, "blocked", event.at);
    } else if (event.type === "apprentice.promotion") {
      const to = String(event.to ?? "");
      activityLine(`<b>MENTOR</b> passou uma nova técnica ao APRENDIZ: ${event.from ?? "—"} → ${to} (vantagem ${event.delta ?? "—"}, ${event.candidateTrades ?? 0} trades).`, "", event.at);
    }
    else if (event.type === "market.config") activityLine(`${name || event.marketKey} configuração atualizada (revisão ${event.revision ?? "—"}).`, "", event.at);
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
    const limitInput = $("officeLimitInput"); if (limitInput && document.activeElement !== limitInput) limitInput.value = String(office.config?.defaultStake ?? 2);
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

  function closeDrawers() { if (overlay) overlay.innerHTML = ""; state.selectedMarket = null; state.drawerDirty = false; state.toast = null; }
  function drawerShell(title, subtitle, subtitleKind, extra = "") {
    return `<div class="office-drawer"><button class="office-btn ghost close small" data-close="1">FECHAR</button>
      <div class="office-hero"><span class="office-badge ${subtitleKind}">${subtitle}</span><h3>${title}</h3></div>${extra}</div>`;
  }
  const toastHtml = () => (state.toast ? `<p class="office-toast ${state.toast.kind}">${state.toast.text}</p>` : "");
  function marketDrawer(marketKey, silent = false) {
    const market = state.office?.markets?.find((row) => row.marketKey === marketKey);
    if (!market || !overlay) return;
    if (!silent) { state.selectedMarket = marketKey; state.drawerDirty = false; }
    if (state.selectedMarket !== marketKey) return;
    const position = market.positionState ?? {};
    const daily = market.settlementState?.daily ?? {};
    const latency = market.latency ?? {};
    const feature = market.featureState ?? {};
    const decision = market.decisionState ?? {};
    const closed = isClosed(market);
    const disabled = isDisabled(market);
    const status = closed ? availabilityLabel(market.availability) : disabled ? "Desativado" : market.paused ? "Pausado" : market.positionState?.status === "OPEN" ? "Em operação" : market.agentState === "SIGNAL" ? "Oportunidade encontrada" : "Aguardando";
    const limitReached = state.office.activeCount >= state.office.activeLimit;
    overlay.innerHTML = drawerShell(`${market.symbol}`, market.marketType, market.marketType === "OTC" ? "otc" : "normal", `
      ${toastHtml()}
      <div class="office-kv">
        <div><span>STATUS</span><b>${status}</b></div>
        <div><span>PAYOUT</span><b>${market.payout ?? "—"}%</b></div>
        <div><span>VALOR POR OPERAÇÃO</span><b>${brl(market.configuredStake ?? state.office.config.defaultStake)}</b></div>
        <div><span>SETUP / REGIME</span><b>${market.setup ?? "-"}  -  ${market.regime ?? "-"}</b></div>
        <div><span>ENTRADA (JIT)</span><b>${entryCountdown(market.entryTiming) ?? market.entryTiming?.stage ?? "-"}</b></div>
        <div><span>JANELA / LEAD</span><b>${market.entryTiming?.targetEntryAt ? timeOf(market.entryTiming.targetEntryAt) : "-"} - ${market.entryTiming?.entryLeadMs ?? "-"}ms</b></div>
        <div><span>OPERAÇÕES HOJE</span><b>${daily.trades ?? 0}</b></div>
        <div><span>GANHOS / PERDAS</span><b>${daily.wins ?? 0} / ${daily.losses ?? 0}</b></div>
        <div><span>RESULTADO</span><b>${signed(daily.settledPnl ?? 0)}</b></div>
        <div><span>ÚLTIMA DECISÃO</span><b>${decision.action ?? "—"}</b></div>
      </div>
      ${closed ? `<p class="fine">Este mercado não está disponível na IQ Option neste momento.</p>` : ""}
      ${disabled && limitReached ? `<p class="fine">Limite de ${state.office.activeLimit} mercados ativos atingido. Desative outro mercado primeiro.</p>` : ""}
      <div class="office-actions">
        ${!closed ? `<button class="office-btn ${market.enabled ? "warn" : "primary"}" data-market-toggle="${market.marketKey}" ${!market.enabled && limitReached ? "disabled" : ""}>${market.enabled ? "DESATIVAR AGENTE" : "ATIVAR AGENTE"}</button>` : ""}
        ${market.enabled ? `<button class="office-btn ${market.paused ? "primary" : "ghost"}" data-market-pause="${market.marketKey}">${market.paused ? "RETOMAR AGENTE" : "PAUSAR AGENTE"}</button>` : ""}
      </div>
      <div class="office-actions">
        <label class="office-field">VALOR R$ <input type="number" min="1" max="100" step="1" value="${Number(market.configuredStake ?? state.office.config.defaultStake) || 1}" data-market-stake-input="${market.marketKey}" /></label>
        <button class="office-btn" data-market-stake="${market.marketKey}">SALVAR VALOR</button>
        <input type="hidden" data-noop="1" />
      </div>
      <p class="fine">Alterações valem para a próxima operação; uma operação em andamento mantém o valor combinado. Limite máximo de segurança: ${brl(state.office.config.hardCap)}.</p>
      <div class="office-section-title">AGENTES (TRADER + CRÍTICO + CONSENSO)</div>
      ${market.agents ? `<div class="office-kv">
        <div><span>TRADER</span><b>${market.agents.trader.action} · conf ${market.agents.trader.confidence}</b></div>
        <div><span>REGIME / VIÉS</span><b>${market.agents.trader.regime} · ${typeof market.agents.trader.bias === "object" ? `${market.agents.trader.bias.channelBias}/${market.agents.trader.bias.streakBias}` : market.agents.trader.bias}</b></div>
        <div><span>CRÍTICO (independente)</span><b>${market.agents.critic.independentAction} · ${market.agents.critic.verdict}</b></div>
        <div><span>CONSENSO</span><b>${market.agents.consensus.action} · ${market.agents.consensus.status}</b></div>
        <div><span>EVIDÊNCIAS</span><b>${(market.agents.trader.supporting ?? []).slice(0, 3).join(", ") || "—"}</b></div>
        <div><span>CONTRAPROVAS</span><b>${(market.agents.critic.contradictions ?? []).slice(0, 3).join(", ") || "—"}</b></div>
      </div><p class="fine">Motivo do consenso: ${reasonText(market.agents.consensus.reason)} · probabilidade estimada de acerto: NÃO CALIBRADA (null) — confiança de análise ≠ probabilidade.</p>` : `<p class='fine'>Aguardando primeira avaliação dos agentes.</p>`}
      <div class="office-section-title">INDICADORES (feature engine determinístico)</div>
      <div class="office-kv">
        <div><span>RSI / ADX</span><b>${Number.isFinite(feature.rsi14) ? feature.rsi14.toFixed(1) : "—"} / ${Number.isFinite(feature.adx14) ? feature.adx14.toFixed(1) : "—"}</b></div>
        <div><span>DI SPREAD / ATR</span><b>${Number.isFinite(feature.diSpread) ? feature.diSpread.toFixed(1) : (market.agents?.trader?.bias ? "—" : "—")} / ${Number.isFinite(feature.atr14) ? feature.atr14.toFixed(5) : "—"}</b></div>
        <div><span>DONCHIAN / MICRO</span><b>${Number.isFinite(feature.donchianPosition) ? feature.donchianPosition.toFixed(2) : "—"} / ${feature.microstructureStreak ?? "—"}</b></div>
        <div><span>TRIGGER</span><b>${decision.trigger ? `RSI ${Number(decision.trigger.rsi14 ?? 0).toFixed(1)} · s ${Number(decision.trigger.s ?? 0).toFixed(2)}` : "—"}</b></div>
      </div>
      <div class="office-section-title">INTELIGÊNCIA GLOBAL</div>
      <div class="office-kv">
        <div><span>MACRO</span><b>${state.office.intelligence?.MACRO?.status === "OK" ? `v${state.office.intelligence.MACRO.version}` : "SEM FONTE"}</b></div>
        <div><span>NOTÍCIAS</span><b>${state.office.intelligence?.NEWS?.status === "OK" ? `v${state.office.intelligence.NEWS.version}` : "SEM FONTE"}</b></div>
        <div><span>MERCADO / RISCO</span><b>${state.office.intelligence?.MARKET?.status ?? "—"} / ${state.office.intelligence?.RISK?.status ?? "—"}</b></div>
        <div><span>SEGURANÇA</span><b>${state.office.intelligence?.SECURITY?.payload?.dataQuality ?? "—"}</b></div>
      </div>
      <div class="office-section-title">ANALISE PROFISSIONAL (BRAIN G2)</div>
      ${(() => { const row = (state.office.research?.setups ?? {})[market.marketKey]; const opportunities = row ? Object.values(row.setups ?? {}).reduce((sum, item) => sum + (item.opportunities ?? 0), 0) : 0; return `<div class="office-kv">
        <div><span>GERACAO / SETUP</span><b>G${market.brainGeneration ?? state.office.brain?.generation ?? 2}  -  ${market.setup ?? "-"}</b></div>
        <div><span>REGIME</span><b>${market.regime ?? "-"}</b></div>
        <div><span>CONSENSO</span><b>${market.agents?.consensus?.status ?? "-"}  -  ${market.agents?.consensus?.action ?? "-"}</b></div>
        <div><span>OPORTUNIDADES (SHADOW)</span><b>${opportunities}</b></div>
        <div><span>ESPERAS REGISTRADAS</span><b>${row?.waits ?? 0}</b></div>
        <div><span>CONHECIMENTO USADO</span><b>${(decision.knowledge?.ids ?? []).length} notas  -  ${decision.knowledge?.version ?? "-"}</b></div>
      </div><p class="fine">Nenhuma variante antiga (V1/V2/V3/V8) participa da decisao; o placar e shadow por setup/regime.</p>`; })()}
      <button class="office-details-toggle" data-toggle-details="1">DETALHES AVANÇADOS</button>
      <div class="office-details" id="officeMarketDetails" hidden>
        <div class="office-kv">
          <div><span>MERCADO</span><b>${market.marketKey}</b></div>
          <div><span>ACTIVE ID</span><b>${market.activeId ?? "—"}</b></div>
          <div><span>REVISÃO CONFIG</span><b>${market.revision ?? 0}</b></div>
          <div><span>SEGMENTO</span><b>${market.lastTick?.segmentId ?? "—"}</b></div>
          <div><span>DADOS ATUAIS</span><b>${feature.fresh ? "saudáveis" : feature.freshnessReason ?? "—"} · ${market.lastTick?.ageMs ?? "—"}ms</b></div>
          <div><span>LATÊNCIA p50/p95</span><b>${latency.serverToReceived?.p50 ?? "—"} / ${latency.serverToReceived?.p95 ?? "—"} ms</b></div>
          <div><span>CANDLES 5s</span><b>${market.candles5s ?? 0}</b></div>
          <div><span>RSI / ATR / ADX</span><b>${Number.isFinite(feature.rsi14) ? feature.rsi14.toFixed(1) : "—"} / ${Number.isFinite(feature.atr14) ? feature.atr14.toFixed(5) : "—"} / ${Number.isFinite(feature.adx14) ? feature.adx14.toFixed(1) : "—"}</b></div>
          <div><span>TETO DO AGENTE</span><b>${brl(market.maxStake)}</b></div>
          <div><span>ENTRADA / DIREÇÃO</span><b>${position.entryPrice ?? "—"} · ${position.direction ?? "—"}</b></div>
        </div>
      </div>`);
  }
  function apprenticeDrawer() {
    const apprentice = state.office?.apprentice; if (!apprentice || !overlay) return;
    state.selectedMarket = null; state.drawerDirty = false;
    const lessonText = (lesson) => (lesson.reasons ?? []).map((reason) => `${reason.code}: ${reason.detail}`).join(" · ");
    overlay.innerHTML = drawerShell("MESA APRENDIZ", "LABORATÓRIO · SHADOW", "muted", `
      <div class="office-kv">
        <div><span>TÉCNICA ATUAL</span><b>${apprentice.currentTechniqueId ?? "—"}</b></div>
        <div><span>EXECUÇÃO</span><b>SOMENTE SHADOW (nunca ordem real)</b></div>
        <div><span>TÉCNICAS NA BIBLIOTECA</span><b>${(apprentice.techniques ?? []).length}</b></div>
        <div><span>LIÇÕES REGISTRADAS</span><b>${(apprentice.lessons ?? []).length}</b></div>
        <div><span>TROCAS DE TÉCNICA</span><b>${(apprentice.promotions ?? []).length}</b></div>
        <div><span>SETTLEMENTS DESDE A TROCA</span><b>${apprentice.settlementsSinceSwitch ?? "—"}</b></div>
      </div>
      <div class="office-section-title">PLACAR DAS TÉCNICAS (prospectivo, shadow)</div>
      <div class="office-list">${(apprentice.aggregate ?? []).map((row) => `<div class="office-list-row"><div><b>${row.techniqueId}${row.techniqueId === apprentice.currentTechniqueId ? " ★" : ""}</b><small>${row.trades} trades · WR ${row.winRate === null || row.winRate === undefined ? "—" : `${(row.winRate * 100).toFixed(1)}%`} · PnL/trade ${row.pnlPerTrade ?? "—"}</small></div><div class="right"><span class="office-badge ${row.pnl >= 0 ? "good" : "bad"}">${row.pnl}</span></div></div>`).join("") || "<p class='fine'>Sem trades shadow ainda.</p>"}</div>
      <div class="office-section-title">ÚLTIMAS LIÇÕES DO MENTOR (o que podia ter feito melhor)</div>
      <div class="office-list">${(apprentice.lessons ?? []).slice(0, 6).map((lesson) => `<div class="office-list-row"><div><b>${lesson.marketKey} · ${lesson.techniqueId}</b><small>${lessonText(lesson)}${lesson.candidateId ? ` → candidata ${lesson.candidateId}` : ""}</small></div><div class="right"><span class="office-badge bad">LOSS</span></div></div>`).join("") || "<p class='fine'>Nenhum LOSS para o mentor avaliar ainda.</p>"}</div>
      <div class="office-section-title">TÉCNICAS PASSADAS AO APRENDIZ</div>
      <div class="office-list">${(apprentice.promotions ?? []).slice(0, 5).map((promotion) => `<div class="office-list-row"><div><b>${promotion.from ?? "—"} → ${promotion.to}</b><small>vantagem ${promotion.delta ?? "—"} · ${new Date(Number(promotion.at)).toLocaleString("pt-BR")}</small></div><div class="right"><span class="office-badge good">APRENDIDA</span></div></div>`).join("") || "<p class='fine'>O mentor ainda não passou uma nova técnica (exige evidência prospectiva).</p>"}</div>
      <div class="office-actions">
        <label class="office-field">REVISAR A CADA <input type="number" min="5" max="200" step="1" id="officeApprenticeEvery" value="${apprentice.config?.reviewEverySettlements ?? 20}" /> settlements</label>
        <label class="office-field">AMOSTRA MÍNIMA <input type="number" min="5" max="200" step="1" id="officeApprenticeSamples" value="${apprentice.config?.minCandidateSamples ?? 20}" /></label>
        <button class="office-btn" id="officeApprenticeSave">SALVAR CONFIGURAÇÃO DO APRENDIZ</button>
      </div>
      <p class="fine">O aprendiz testa técnicas próprias apenas em shadow. O mentor só promove uma técnica após amostra, vantagem e cooldown (anti-overfitting/anti-flapping). Nada aqui envia ordens.</p>`);
  }
  function auxDrawer(kind) {
    const office = state.office; if (!office || !overlay) return;
    state.selectedMarket = null; state.drawerDirty = false;
    const titles = { risk: "RISCO", compliance: "SEGURANÇA", executionGate: "EXECUÇÃO", portfolioControl: "CARTEIRA", macro: "MACRO", news: "NOTÍCIAS", market: "MERCADO", security: "SEGURANÇA (DADOS)", research: "PESQUISA" };
    const status = office.intelligence?.[kind.toUpperCase()] ?? null;
    let content = "";
    if (kind === "risk") content = `<div class="office-kv"><div><span>EM OPERAÇÃO</span><b>${office.aux.risk.openPositions}</b></div><div><span>VALOR EM RISCO</span><b>${brl(office.aux.risk.stakeAtRisk)}</b></div><div><span>LIMITE POR MERCADO</span><b>1 operação</b></div><div><span>LIMITE DE MERCADOS</span><b>${office.aux.risk.limits.maxActiveMarkets}</b></div></div><div class="office-list">${(office.aux.risk.exposure ?? []).map((row) => `<div class="office-list-row"><div><b>${row.currency}</b><small>exposição ${signed(row.net)} · ${brl(row.stake)}</small></div><div class="right"><span class="office-badge ${Math.max(row.longCount, row.shortCount) >= 3 ? "bad" : "good"}">${row.longCount}C/${row.shortCount}V</span></div></div>`).join("") || "<p class='fine'>Nenhuma operação aberta.</p>"}</div>`;
    else if (kind === "compliance") content = `<div class="office-kv"><div><span>CONTA</span><b>${office.mode === "REAL" ? "Real" : "De teste"}</b></div><div><span>SISTEMA</span><b>${office.aux.compliance.armState?.armed ? "Operando" : "Parado"}</b></div><div><span>EXECUÇÃO AUTOMÁTICA</span><b>${office.config.autoExecute ? "Ligada" : "Desligada"}</b></div><div><span>PARADA DE EMERGÊNCIA</span><b>${office.aux.compliance.killSwitch?.executionEnabled ? "Livre" : "Acionada"}</b></div><div><span>LIMITE MÁXIMO</span><b>${brl(office.config.hardCap)}</b></div><div><span>CONTA REAL</span><b>${office.aux.compliance.realMode?.realModeEnabled ? "Autorizada" : "Bloqueada"}</b></div></div><p class="fine">Proteções permanentes: somente conta de teste por padrão; conta real exige confirmação explícita; uma ordem por decisão; uma operação por mercado; NORMAL nunca vira OTC automaticamente.</p>`;
    else if (kind === "executionGate") content = `<div class="office-kv"><div><span>SITUAÇÃO</span><b>${office.aux.executionGate.state === "ARMED" ? "Liberada" : office.aux.executionGate.state === "ORDERING" ? "Executando" : office.aux.executionGate.state === "BLOCKED" ? "Bloqueada" : "Parada"}</b></div><div><span>ORDENS EM ANDAMENTO</span><b>${office.aux.executionGate.pendingOrders}</b></div><div><span>MERCADOS LIBERADOS</span><b>${(office.aux.executionGate.allowedMarkets ?? []).length}</b></div><div><span>MERCADOS BLOQUEADOS</span><b>${(office.aux.executionGate.blockedMarkets ?? []).length}</b></div></div>`;
    else if (kind === "portfolioControl") content = `<div class="office-kv"><div><span>MERCADOS ATIVOS</span><b>${office.activeCount}/${office.activeLimit}</b></div><div><span>EM OPERAÇÃO</span><b>${office.portfolio.openPositions.length}</b></div><div><span>RESULTADO</span><b>${signed(office.portfolio.settled.pnl)}</b></div><div><span>GANHOS/PERDAS/EMPATES</span><b>${office.portfolio.settled.wins}/${office.portfolio.settled.losses}/${office.portfolio.settled.draws}</b></div></div>`;
    else if (kind === "macro" || kind === "news") {
      const syncState = office.feeds?.state?.[kind.toUpperCase()] ?? {};
      content = status && status.status === "OK"
        ? `<div class="office-kv"><div><span>STATUS</span><b>EVENTO/MANCHETE VIGENTE</b></div><div><span>FONTE</span><b>${status.source ?? "—"} (${status.sourceType ?? "—"})</b></div><div><span>VERSÃO</span><b>${status.version}</b></div><div><span>IDADE</span><b>${Math.round((status.ageMs ?? 0) / 1000)}s</b></div></div>`
        : syncState.status === "OK"
          ? `<p class="fine">Feed externo sincronizado (${syncState.items ?? 0} itens), mas nenhum evento/manchete vigente neste instante — nada é inventado. Próxima sincronização automática.</p>`
          : `<p class="fine">SEM FONTE — ${syncState.lastError ? `última falha: ${syncState.lastError}` : "nenhuma integração respondeu"}. Nada é inventado.</p>`;
    }
    else if (kind === "market") content = `<div class="office-kv"><div><span>MERCADOS ATIVOS</span><b>${office.intelligence?.MARKET?.payload?.activeMarkets ?? office.activeCount}</b></div><div><span>VOL. MÉDIA (ATR/PRECO)</span><b>${office.intelligence?.MARKET?.payload?.avgAtrNormalized ?? "—"}</b></div><div><span>ADX MÉDIO</span><b>${office.intelligence?.MARKET?.payload?.avgAdx ?? "—"}</b></div><div><span>VIÉS AGREGADO</span><b>${office.intelligence?.MARKET?.payload?.bullish ?? 0} compra · ${office.intelligence?.MARKET?.payload?.bearish ?? 0} venda</b></div></div><p class="fine">Sessões e relações entre mercados: dados internos do runtime.</p>`;
    else if (kind === "security") content = `<div class="office-kv"><div><span>CONEXÃO</span><b>${office.intelligence?.SECURITY?.payload?.connectionHealthy ? "saudável" : "degradada"}</b></div><div><span>SERVER TIME</span><b>${office.intelligence?.SECURITY?.payload?.timeValid ? "sincronizado" : "dessincronizado"}</b></div><div><span>CANDLES REJEITADOS</span><b>${office.intelligence?.SECURITY?.payload?.rejectedCandles ?? 0}</b></div><div><span>QUALIDADE</span><b>${office.intelligence?.SECURITY?.payload?.dataQuality ?? "—"}</b></div></div><p class="fine">NORMAL/OTC permanecem separados; freshness e provenance monitorados por mercado.</p>`;
    else if (kind === "research") {
      const setups = office.research?.setups ?? {};
      const ab = office.research?.ab?.arms ?? {};
      content = `<div class="office-kv"><div><span>MESAS COM SHADOW DE SETUP</span><b>${Object.keys(setups).length}</b></div><div><span>SETUPS NO BRAIN G2</span><b>${office.brain?.setups ?? 0}</b></div><div><span>SUPERVISOR</span><b>${office.supervisor?.reviews?.length ?? 0} revisoes</b></div><div><span>LATENCIA AGENTES p50/p95</span><b>${office.research?.agentLatency?.p50 ?? 0} / ${office.research?.agentLatency?.p95 ?? 0} ms</b></div></div>
      <div class="office-list">${Object.entries(setups).slice(0, 8).map(([key, board]) => `<div class="office-list-row"><div><b>${key}</b><small>${Object.values(board.setups ?? {}).reduce((sum, item) => sum + (item.opportunities ?? 0), 0)} oportunidades  -  ${board.waits ?? 0} esperas  -  ${board.trades ?? 0} liquidadas</small></div><div class="right"><span class="office-badge">shadow</span></div></div>`).join("") || "<p class='fine'>Sem mercados ativos.</p>"}</div>
      <div class="office-list"><div class="office-list-row"><div><b>A/B v2</b><small>A_TRADER ${ab.A_TRADER?.trades ?? 0}  -  B_TRADER_CRITIC ${ab.B_TRADER_CRITIC?.trades ?? 0}  -  C_PLUS_INTELLIGENCE ${ab.C_PLUS_INTELLIGENCE?.trades ?? 0}  -  D_APPRENTICE ${ab.D_APPRENTICE?.trades ?? 0}</small></div><div class="right"><span class="office-badge">mesmo snapshot causal</span></div></div></div>`;
    }
    else content = `<p class="fine">Ainda não configurado. Nenhuma informação é inventada enquanto o feed não existir.</p>`;
    overlay.innerHTML = drawerShell(titles[kind] ?? kind.toUpperCase(), "CENTRAL DE INTELIGÊNCIA", "muted", content);
  }
  function chooseMarketsModal() {
    const office = state.office; if (!office || !overlay) return;
    const row = (market) => {
      const closed = isClosed(market);
      const limitReached = office.activeCount >= office.activeLimit;
      return `<div class="office-market-row">
        <div><b>${market.display}</b><small>${closed ? availabilityLabel(market.availability).toLowerCase() : market.marketType === "OTC" ? `disponível · payout ${market.payout ?? "—"}% · ${brl(market.configuredStake ?? office.config.defaultStake)}/op` : `disponível · ${brl(market.configuredStake ?? office.config.defaultStake)}/op`}</small></div>
        <div class="right"><button class="office-btn ${market.enabled ? "warn" : "primary"}" data-choose-toggle="${market.marketKey}" ${!market.enabled && (limitReached || closed) ? "disabled" : ""}>${market.enabled ? "DESLIGAR" : closed ? "FECHADO" : "ATIVAR"}</button></div>
      </div>`;
    };
    const normal = office.markets.filter((market) => market.marketType === "NORMAL");
    const otc = office.markets.filter((market) => market.marketType === "OTC");
    overlay.innerHTML = `<div class="office-modal"><div class="office-modal-card">
      <button class="office-btn ghost close small" data-close="1" style="float:right">FECHAR</button>
      <h3>ESCOLHER MERCADOS</h3>
      <p><b>${office.activeCount} de ${office.activeLimit} mercados ativos.</b> Você pode ativar até ${office.activeLimit} mercados ao mesmo tempo (NORMAL + OTC). Mercados fechados continuam no escritório, mas não operam.</p>
      <div class="office-section-title">NORMAL (${normal.filter((market) => market.enabled).length} de ${normal.length} ativos)</div>
      ${normal.map(row).join("")}
      <div class="office-section-title">OTC (${otc.filter((market) => market.enabled).length} de ${otc.length} ativos)</div>
      ${otc.map(row).join("")}
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
      <label class="office-field">VALOR MÁXIMO REAL (teto ${brl(office.config.hardCap)}) <input id="officeRealStake" type="number" min="1" max="${office.config.hardCap}" step="1" value="${Number(realMode.maxStake) || 1}" /></label>
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
    state.selectedMarket = null; state.drawerDirty = false;
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
        <div><span>VALOR GLOBAL / TETO</span><b>${brl(office.config.defaultStake)} / ${brl(office.config.globalMaxStake)}</b></div>
        <div><span>REVISÃO CONFIG</span><b>${office.config.revision ?? 0}</b></div>
        <div><span>MENSAGENS / CANDLES</span><b>${metrics.messages ?? 0} / ${metrics.candles ?? 0}</b></div>
        <div><span>LATÊNCIA AGENTES p50/p95</span><b>${office.research?.agentLatency?.p50 ?? 0} / ${office.research?.agentLatency?.p95 ?? 0} ms</b></div>
      </div>
      <div class="office-section-title">SUPERVISOR DE DESEMPENHO</div>
      <div class="office-actions">
        <label class="office-field">AMOSTRA MIN <input type="number" min="10" max="500" step="1" id="officeSupervisorSamples" value="${office.supervisor?.config?.minSamples ?? 20}" /></label>
        <label class="office-field">DRAWDOWN MAX <input type="number" min="1" max="100" step="1" id="officeSupervisorDrawdown" value="${office.supervisor?.config?.maxDrawdown ?? 8}" /></label>
        <label class="office-field">PERDAS SEGUIDAS <input type="number" min="2" max="50" step="1" id="officeSupervisorLosses" value="${office.supervisor?.config?.maxConsecutiveLosses ?? 6}" /></label>
        <button class="office-btn" id="officeSupervisorSave">SALVAR SUPERVISOR</button>
      </div>
      <p class="fine">O supervisor apenas monitora e pede REVIEW_REQUIRED; ele NUNCA troca metodologia nem inventa estrategia. Nenhuma variante V1/V2/V3/V8 existe no runtime (brain G2).</p>
      <div class="office-section-title">SEGUNDO CEREBRO (OBSIDIAN)</div>
      <div class="office-kv">
        <div><span>MODO</span><b>${office.knowledge?.secondBrain?.mode ?? "OFFLINE"}</b></div>
        <div><span>ESCOPO</span><b>${office.knowledge?.secondBrain?.scope ?? "TraceCom/"}</b></div>
        <div><span>NOTAS INDEXADAS</span><b>${office.knowledge?.notes ?? 0}</b></div>
        <div><span>VERSAO DO CONHECIMENTO</span><b>${office.knowledge?.knowledgeVersion ?? "-"}</b></div>
        <div><span>JOURNAL / HIPOTESES</span><b>${office.journal?.trades ?? 0} trades  -  ${office.hypotheses ?? 0} hipoteses</b></div>
      </div>
      <div class="office-section-title">ULTIMAS REVISOES DO SUPERVISOR</div>
      <div class="office-list">${(office.supervisor?.reviews ?? []).slice(0, 6).map((review) => `<div class="office-list-row"><div><b>${review.marketKey} - ${review.status}</b><small>${(review.reasons ?? []).map((reason) => reasonText(reason)).join(", ") || "sem alertas"}</small></div><div class="right"><span class="office-badge">${review.status}</span></div></div>`).join("") || "<p class='fine'>Nenhuma revisao ainda.</p>"}</div>
      <div class="office-section-title">ENTRADA JUST-IN-TIME</div>
      <div class="office-actions">
        <label class="office-field">LEAD (ms) <input type="number" min="1000" max="2000" step="50" id="officeEntryLead" value="${office.config?.entryLeadMs ?? 1500}" /></label>
        <label class="office-field">DRIFT MAX (ms) <input type="number" min="0" max="10000" step="100" id="officeEntryDrift" value="${office.config?.entryWindowMaxDriftMs ?? 2500}" /></label>
        <label class="office-field"><input type="checkbox" id="officeEntryJit" ${office.config?.jitEnabled === true ? "checked" : ""} /> exigir revalidacao (JIT)</label>
        <button class="office-btn" id="officeEntrySave">SALVAR ENTRADA</button>
      </div>
      <p class="fine">A ordem sai ~1-2s antes da janela alvo (fronteira de 60s no server time da IQ) depois de revalidar Brain/Critico/Consenso. Mudou a leitura? cancela. Atrasou? nao entra.</p>
      <div class="office-actions">
        <button class="office-btn" id="officeStressRun">Rodar teste de estresse (1/3/5/10)</button>
        <button class="office-btn ghost" id="officeRawLog">${state.showTechActivity ? "Ver atividade amigável" : "Ver log técnico"}</button>
      </div>
      <p class="fine" id="officeStressReport">${office.stress?.report ? `Último teste: ${(office.stress.report.results ?? []).map((row) => `${row.stage}→${row.markets?.length ?? 0}`).join(" · ")}` : "Nenhum teste de estresse executado."}</p>
    </div>`;
  }

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
      if (state.dragging && !state.dragMoved) { const target = hitTest(event.clientX, event.clientY); if (target?.type === "desk") marketDrawer(target.key); else if (target?.type === "intel") auxDrawer(target.key); else if (target?.type === "apprentice") apprenticeDrawer(); }
      state.dragging = false; canvas.classList.remove("dragging");
    });
    window.addEventListener("pointermove", (event) => {
      if (!state.dragging) return;
      const dx = event.clientX - state.lastPointer.x, dy = event.clientY - state.lastPointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) state.dragMoved = true;
      state.camera.x += dx; state.camera.y += dy; state.lastPointer = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener("wheel", (event) => { event.preventDefault(); const rect = canvas.getBoundingClientRect(); const px = event.clientX - rect.left, py = event.clientY - rect.top; const factor = event.deltaY < 0 ? 1.1 : 0.9; const value = Math.min(1.8, Math.max(0.36, state.camera.zoom * factor)); const ratio = value / state.camera.zoom; state.camera.x = px - (px - state.camera.x) * ratio; state.camera.y = py - (py - state.camera.y) * ratio; state.camera.zoom = value; }, { passive: false });
    canvas.addEventListener("dblclick", () => { if (state.defaultCamera) state.camera = { ...state.defaultCamera }; });
    if (overlay) {
      overlay.addEventListener("input", (event) => { if (event.target.closest("[data-market-stake-input]")) state.drawerDirty = true; });
      overlay.addEventListener("change", (event) => { if (event.target.closest("[data-market-stake-input]")) state.drawerDirty = true; });
    }
  }
  async function startSystem() {
    const limit = Math.min(100, Math.max(1, Number($("officeLimitInput")?.value) || state.office?.config?.defaultStake || 2));
    try {
      await post("/api/iq/config/global-stake", { value: limit });
      await post("/api/iq/config/auto-execute", { enabled: true });
      const arm = await post("/api/iq/arm", { limitBrl: limit, confirmation: "ARM_PRACTICE" });
      if (arm?.warning === "NO_OPEN_MARKET_NOW") {
        const list = (arm.markets ?? []).map((market) => `${market.marketKey}=${availabilityLabel(market.availability)}`).join(", ");
        activityLine(`Sistema ARMADO, mas o broker não reporta mercado OPEN agora (${list}). O TraceCom entrará automaticamente quando a IQ reabrir (sem reiniciar).`, "blocked");
      } else {
        activityLine(`Sistema iniciado: operação automática ligada com valor de ${brl(limit)} por operação (${arm?.openMarkets ?? 0} mercado(s) OPEN).`, "");
      }
    } catch (error) {
      const code = error?.code ?? null;
      const reason = error?.reason ? reasonText(String(error.reason)) : reasonText(String(error?.message || error));
      const details = error?.details ?? null;
      const markets = details?.markets ? ` · mercados: ${details.markets.map((market) => `${market.marketKey}=${availabilityLabel(market.availability)}`).join(", ")}` : "";
      activityLine(`ARM recusado [${code ?? "ERRO"}]: ${reason}${markets}.`, "blocked");
    }
    return refreshOffice();
  }
  async function stopSystem() {
    try {
      await post("/api/iq/config/auto-execute", { enabled: false });
      await post("/api/iq/disarm", {});
      activityLine("Sistema parado: os agentes voltaram a apenas observar.", "");
    } catch (error) { activityLine(`Falha ao parar o sistema: ${String(error?.message || error).slice(0, 80)}`, "blocked"); }
    return refreshOffice();
  }
  function bindButtons() {
    document.addEventListener("click", async (event) => {
      const target = event.target.closest("[data-close],[data-aux],[data-choose-toggle],[data-toggle-details],[data-market-toggle],[data-market-pause],[data-market-stake],#officeAccountPractice,#officeAccountReal,#officeSystemStart,#officeSystemStop,#officeEmergency,#officeApplyLimit,#officeChooseMarkets,#officeAdvanced,#officeActivityTech,#officeRealConfirm,#officeRealRevoke,#officeStressRun,#officeRawLog,#officeZoomIn,#officeZoomOut,#officeCameraReset,#officeFocus,#officeSupervisorSave,#officeEntrySave,#officeApprenticeSave");
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
        if (id === "officeApplyLimit") {
          const value = Math.min(100, Math.max(1, Number($("officeLimitInput")?.value) || 2));
          await post("/api/iq/config/global-stake", { value });
          activityLine(`Valor por operação definido em ${brl(value)} para todos os agentes (teto de segurança ${brl(state.office?.config?.hardCap ?? 100)}).`, "");
          return refreshOffice();
        }
        if (id === "officeChooseMarkets") return chooseMarketsModal();
        if (id === "officeAdvanced") return advancedDrawer();
        if (id === "officeActivityTech") { state.showTechActivity = !state.showTechActivity; target.textContent = state.showTechActivity ? "ver atividade" : "ver log técnico"; return renderActivity(); }
        if (id === "officeRawLog") { state.showTechActivity = !state.showTechActivity; return advancedDrawer(); }
        if (id === "officeZoomIn") { state.camera.zoom = Math.min(1.8, state.camera.zoom * 1.15); return; }
        if (id === "officeZoomOut") { state.camera.zoom = Math.max(0.36, state.camera.zoom * 0.87); return; }
        if (id === "officeCameraReset") { if (state.defaultCamera) state.camera = { ...state.defaultCamera }; return; }
        if (id === "officeFocus") { const market = state.office?.markets?.find((row) => row.marketKey === state.selectedMarket) ?? state.office?.markets?.find((row) => row.enabled); const index = (state.office?.markets ?? []).findIndex((row) => row.marketKey === market?.marketKey); const slot = SLOTS[index]; if (slot) centerOn(slot.gx + 1.8, slot.gy + 1.8); return; }
        if (id === "officeStressRun") { await post("/api/iq/stress/run", { stages: [1, 3, 5, 10], secondsPerStage: 20 }); activityLine("Teste de estresse iniciado (1/3/5/10 mercados).", ""); return advancedDrawer(); }
        if (id === "officeSupervisorSave") {
          const minSamples = Math.max(10, Math.min(500, Number($("officeSupervisorSamples")?.value) || 20));
          const maxDrawdown = Math.max(1, Math.min(100, Number($("officeSupervisorDrawdown")?.value) || 8));
          const maxConsecutiveLosses = Math.max(2, Math.min(50, Number($("officeSupervisorLosses")?.value) || 6));
          const result = await put("/api/iq/supervisor/config", { minSamples, maxDrawdown, maxConsecutiveLosses });
          activityLine(`Supervisor: amostra minima ${result.config?.minSamples ?? minSamples}, drawdown maximo ${result.config?.maxDrawdown ?? maxDrawdown}, perdas seguidas ${result.config?.maxConsecutiveLosses ?? maxConsecutiveLosses}. Metodologia intacta.`, "");
          state.toast = { kind: "good", text: "Configuracao do supervisor salva." };
          return advancedDrawer();
        }
        if (id === "officeEntrySave") {
          const entryLeadMs = Math.max(1000, Math.min(2000, Number($("officeEntryLead")?.value) || 1500));
          const entryWindowMaxDriftMs = Math.max(0, Math.min(10000, Number($("officeEntryDrift")?.value) || 2500));
          const jitEnabled = $("officeEntryJit")?.checked === true;
          const result = await put("/api/iq/entry/config", { jitEnabled, entryLeadMs, entryWindowMaxDriftMs });
          activityLine(`Entrada JIT: lead ${result.config?.entryLeadMs ?? entryLeadMs}ms, drift max ${result.config?.entryWindowMaxDriftMs ?? entryWindowMaxDriftMs}ms, revalidacao ${result.config?.jitEnabled ? "obrigatoria" : "desligada"}.`, "");
          return advancedDrawer();
        }
        if (id === "officeApprenticeSave") {
          const reviewEverySettlements = Math.max(5, Math.min(200, Number($("officeApprenticeEvery")?.value) || 20));
          const minCandidateSamples = Math.max(5, Math.min(200, Number($("officeApprenticeSamples")?.value) || 20));
          const result = await put("/api/iq/apprentice/config", { reviewEverySettlements, minCandidateSamples });
          activityLine(`Aprendiz: revisão a cada ${result.config?.reviewEverySettlements} settlements, amostra mínima ${result.config?.minCandidateSamples}. Execução permanece SHADOW.`, "");
          return apprenticeDrawer();
        }
        if (id === "officeRealConfirm") { const maxStake = Number($("officeRealStake")?.value) || 1; const phrase = String($("officeRealPhrase")?.value ?? ""); const acknowledgeRisk = $("officeRealAck")?.checked === true; await post("/api/iq/real/confirm", { maxStake, phrase, acknowledgeRisk }); activityLine(`Conta real confirmada no servidor (limite ${brl(maxStake)}).`, ""); closeDrawers(); return refreshOffice(); }
        if (id === "officeRealRevoke") { await post("/api/iq/real/revoke", {}); activityLine("Conta real desativada.", ""); closeDrawers(); return refreshOffice(); }
        if (target.dataset.chooseToggle) { const market = state.office?.markets?.find((row) => row.marketKey === target.dataset.chooseToggle); await put("/api/iq/market", { marketKey: target.dataset.chooseToggle, enabled: market?.enabled !== true }); return refreshOffice().then(() => chooseMarketsModal()); }
        if (target.dataset.marketToggle) { const market = state.office?.markets?.find((row) => row.marketKey === target.dataset.marketToggle); await put("/api/iq/market", { marketKey: target.dataset.marketToggle, enabled: market?.enabled !== true }); state.toast = { kind: "good", text: market?.enabled ? "Agente desativado." : "Agente ativado." }; return refreshOffice(); }
        if (target.dataset.marketPause) { const market = state.office?.markets?.find((row) => row.marketKey === target.dataset.marketPause); await put("/api/iq/market", { marketKey: target.dataset.marketPause, paused: market?.paused !== true }); activityLine(`${market?.display ?? target.dataset.marketPause} ${market?.paused ? "retomado" : "pausado"}.`, ""); return refreshOffice(); }
        if (target.dataset.marketStake) {
          const key = target.dataset.marketStake;
          const value = Number(document.querySelector(`[data-market-stake-input="${CSS.escape(key)}"]`)?.value);
          const response = await put("/api/iq/market", { marketKey: key, configuredStake: value });
          pinMarket(response.market);
          state.drawerDirty = false;
          state.toast = { kind: "good", text: `Valor salvo: ${brl(response.market?.configuredStake ?? value)} por operação.` };
          activityLine(`${response.market?.display ?? key} valor por operação definido em ${brl(response.market?.configuredStake ?? value)}.`, "");
          return refreshOffice();
        }
      } catch (error) {
        const key = state.selectedMarket ?? target.dataset.marketStake;
        const effective = state.office?.markets?.find((row) => row.marketKey === key);
        state.drawerDirty = false;
        state.toast = { kind: "bad", text: `Não foi possível salvar. Configuração ativa: ${effective ? `${effective.setup ?? "—"} · ${brl(effective.configuredStake)}` : reasonText(String(error?.message || error))}` };
        activityLine(`Ação não concluída: ${reasonText(String(error?.message || error))}.`, "blocked");
        if (state.selectedMarket) marketDrawer(state.selectedMarket, true);
        renderActivity();
      }
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
