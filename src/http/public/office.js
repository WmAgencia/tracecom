/* Pixel Trading Office — escritorio isometrico em pixel art ligado 100% aos estados reais do backend.
 * Backend e a fonte da verdade; aqui apenas representamos (nenhuma animacao cria estado).
 * Arte original desenhada por codigo (sem assets de terceiros). */
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
  const signed = (value) => (Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}` : "—");
  const timeOf = (ms) => (Number.isFinite(Number(ms)) ? new Date(Number(ms)).toLocaleTimeString("pt-BR") : "—");
  const agentLabel = { OFFLINE: "OFFLINE", UNAVAILABLE: "INDISPONÍVEL", WAIT: "WAIT", ANALYZING: "ANALISANDO", SIGNAL: "SINAL", ORDERING: "ENVIANDO", IN_POSITION: "EM POSIÇÃO", SETTLING: "LIQUIDANDO", WIN: "WIN", LOSS: "LOSS", DRAW: "DRAW", ERROR: "ERRO" };

  const TILE_W = 72, TILE_H = 34, TILE_Z = 22;
  const state = {
    office: null, eventsCursor: 0, selectedMarket: null, drawer: null,
    camera: { x: 0, y: 0, zoom: 1 },
    defaultCamera: null, hover: null, dragging: false, dragMoved: false, lastPointer: { x: 0, y: 0 },
    flashes: new Map(), ticker: [], lastEventPoll: 0, initialized: false, renderQueued: false,
  };
  let canvas = null, ctx = null, overlay = null;

  /* ------------------------------ projection ------------------------------ */
  function iso(gx, gy, gz = 0) { return { x: (gx - gy) * TILE_W / 2, y: (gx + gy) * TILE_H / 2 - gz * TILE_Z }; }
  function project(gx, gy, gz = 0) { const point = iso(gx, gy, gz); return { x: state.camera.x + point.x * state.camera.zoom, y: state.camera.y + point.y * state.camera.zoom }; }
  const DESKS = [
    { gx: 0, gy: 0 }, { gx: 2, gy: 0 }, { gx: 4, gy: 0 }, { gx: 6, gy: 0 }, { gx: 8, gy: 0 },
    { gx: 0, gy: 4 }, { gx: 2, gy: 4 }, { gx: 4, gy: 4 }, { gx: 6, gy: 4 }, { gx: 8, gy: 4 },
  ];

  /* ------------------------------ sprites ------------------------------ */
  function block(g, x, y, w, h, color) { g.fillStyle = color; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function drawAgent(g, x, y, pixel, colors, pose, frame) {
    const p = pixel, bounce = pose === "typing" ? (frame % 2 === 0 ? 0 : p) : 0;
    block(g, x - 3.5 * p, y + 6 * p, 7 * p, p, "#05070d40");
    // legs
    block(g, x - 2.5 * p, y + 3 * p + bounce, 2 * p, 3 * p, colors.pants);
    block(g, x + 0.5 * p, y + 3 * p + bounce, 2 * p, 3 * p, colors.pants);
    // torso
    block(g, x - 3 * p, y + 0.2 * p + bounce, 6 * p, 3 * p, colors.shirt);
    block(g, x - 3 * p, y + 0.2 * p + bounce, 6 * p, p, colors.shirtLight);
    // head
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
  function marketPalette(market) {
    const base = market.marketType === "OTC"
      ? { shirt: "#c98a2e", shirtLight: "#e8ad4d", pants: "#2c3448", skin: "#f0c39a", hair: "#3a2a1c" }
      : { shirt: "#3f6fd8", shirtLight: "#5b8cf0", pants: "#232c42", skin: "#f0c39a", hair: "#2b2b33" };
    return base;
  }
  function poseFor(market, frame) {
    const agent = market.agentState;
    const flash = state.flashes.get(market.marketKey);
    if (flash === "WIN" || flash === "LOSS") return flash === "WIN" ? "win" : "loss";
    if (agent === "OFFLINE" || agent === "UNAVAILABLE") return "offline";
    if (agent === "ERROR") return "error";
    if (agent === "IN_POSITION") return market.indicative?.state === "UNFAVORABLE" ? "loss" : "typing";
    if (agent === "ORDERING") return "order";
    if (agent === "SIGNAL" || agent === "ANALYZING") return "typing";
    if (agent === "WIN") return "win";
    if (agent === "LOSS") return "loss";
    return frame % 8 < 5 ? "typing" : "think";
  }
  function bubbleFor(market) {
    const flash = state.flashes.get(market.marketKey);
    if (flash === "WIN" || flash === "LOSS") { const profit = market.lastTrade?.profit; return { text: `${flash} ${profit === null || profit === undefined ? "" : signed(profit)}`.trim(), kind: flash }; }
    if (market.agentState === "IN_POSITION" || market.positionState?.status === "OPEN") {
      const value = market.indicative?.indicativePnl;
      if (market.indicative?.state === "FAVORABLE") return { text: `+${money(value)}`, kind: "FAVORABLE" };
      if (market.indicative?.state === "UNFAVORABLE") return { text: money(value), kind: "UNFAVORABLE" };
      return { text: "OPERAÇÃO", kind: "NEUTRAL" };
    }
    if (market.agentState === "ORDERING") return { text: "ENVIANDO", kind: "ORDERING" };
    if (market.agentState === "SIGNAL") return { text: market.lastSignal?.action ?? "SINAL", kind: "SIGNAL" };
    if (market.agentState === "ANALYZING") return { text: "ANALISANDO", kind: "ANALYZING" };
    if (market.agentState === "OFFLINE") return { text: "OFFLINE", kind: "OFFLINE" };
    if (market.agentState === "UNAVAILABLE") return { text: market.availability === "SUSPENDED" ? "SUSPENSO" : "INDISP.", kind: "OFFLINE" };
    if (market.agentState === "ERROR") return { text: "ERRO", kind: "ERROR" };
    return { text: market.decisionState?.action === "WAIT" ? "WAIT" : (market.decisionState?.action ?? "WAIT"), kind: "WAIT" };
  }

  /* ------------------------------ rendering ------------------------------ */
  function diamond(g, cx, cy, w, h, fill, stroke) {
    g.beginPath(); g.moveTo(cx, cy - h / 2); g.lineTo(cx + w / 2, cy); g.lineTo(cx, cy + h / 2); g.lineTo(cx - w / 2, cy); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.stroke(); }
  }
  const zoom = () => state.camera.zoom;
  function deskScreenRect(desk) {
    const base = project(desk.gx + 1, desk.gy + 1, 0);
    const w = TILE_W * 1.5 * zoom(), h = TILE_H * 1.5 * zoom();
    return { x: base.x - w / 2, y: base.y - h, w, h };
  }
  function drawDesk(g, market, desk, index, frame, targets) {
    const z = zoom();
    const cx = desk.gx + 1, cy = desk.gy + 1;
    const top = project(cx, cy, 0.55);
    const w = TILE_W * 1.7 * z, h = TILE_H * 1.7 * z, depth = 18 * z;
    const palette = marketPalette(market);
    // desk cube
    diamond(g, top.x, top.y, w, h, "#16213a", "#2a3d63");
    g.fillStyle = "#0f1830";
    g.beginPath(); g.moveTo(top.x - w / 2, top.y); g.lineTo(top.x, top.y + h / 2); g.lineTo(top.x, top.y + h / 2 + depth); g.lineTo(top.x - w / 2, top.y + depth); g.closePath(); g.fill();
    g.fillStyle = "#0b1226";
    g.beginPath(); g.moveTo(top.x + w / 2, top.y); g.lineTo(top.x, top.y + h / 2); g.lineTo(top.x, top.y + h / 2 + depth); g.lineTo(top.x + w / 2, top.y + depth); g.closePath(); g.fill();
    // monitor
    const m = project(cx - 0.35, cy - 0.35, 0.55);
    const mw = 30 * z, mh = 20 * z;
    block(g, m.x - mw / 2, m.y - mh - 6 * z, mw, mh, "#050a14");
    const glow = market.agentState === "IN_POSITION" ? (market.indicative?.state === "FAVORABLE" ? "#37d67a" : market.indicative?.state === "UNFAVORABLE" ? "#ff5d5d" : "#f2c14e") : market.agentState === "ERROR" ? "#ff5d5d" : market.agentState === "OFFLINE" ? "#31405e" : "#4da3ff";
    block(g, m.x - mw / 2 + 2 * z, m.y - mh - 4 * z, mw - 4 * z, mh - 4 * z, glow);
    block(g, m.x - mw / 2 + 2 * z, m.y - mh - 4 * z, mw - 4 * z, 4 * z, "#0a1830");
    // name plate on front face
    const plate = project(cx + 0.55, cy + 1.15, 0.2);
    const pw = 74 * z, ph = 16 * z;
    block(g, plate.x - pw / 2, plate.y, pw, ph, "#0b1226");
    g.strokeStyle = market.marketType === "OTC" ? "#96702c" : "#3b5da8"; g.lineWidth = Math.max(1, z); g.strokeRect(Math.round(plate.x - pw / 2), Math.round(plate.y), Math.round(pw), Math.round(ph));
    g.fillStyle = "#dbe6ff"; g.font = `${Math.max(8, Math.round(9 * z))}px "Courier New", monospace`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(market.display.slice(0, 12), plate.x, plate.y + ph / 2 - 2 * z);
    g.fillStyle = market.marketType === "OTC" ? "#ffd08a" : "#9fc6ff"; g.font = `${Math.max(7, Math.round(7 * z))}px "Courier New", monospace`;
    g.fillText(`${market.marketType} · ${market.activeId ?? "—"}`, plate.x, plate.y + ph + 7 * z);
    // connection led
    block(g, plate.x + pw / 2 + 3 * z, plate.y + 4 * z, 4 * z, 4 * z, market.connectionHealth?.connected ? "#37d67a" : "#ff5d5d");
    // agent
    const agentPos = project(cx + 0.15, cy + 0.95, 0.02);
    const pixel = Math.max(1.4, 2.1 * z);
    drawAgent(g, agentPos.x, agentPos.y, pixel, palette, poseFor(market, frame), frame);
    // bubble
    const bubble = bubbleFor(market);
    const bx = agentPos.x, by = agentPos.y - 42 * z;
    const bw = Math.max(46 * z, bubble.text.length * 7 * z + 12 * z), bh = 15 * z;
    const color = bubble.kind === "FAVORABLE" || bubble.kind === "WIN" ? "#8ce4a0" : bubble.kind === "UNFAVORABLE" || bubble.kind === "LOSS" ? "#ff9d9d" : bubble.kind === "ERROR" ? "#ff5d5d" : bubble.kind === "SIGNAL" ? "#f2c14e" : bubble.kind === "OFFLINE" ? "#7f93b8" : "#cfe0ff";
    block(g, bx - bw / 2, by - bh, bw, bh, "#060b16e6");
    g.strokeStyle = color; g.lineWidth = Math.max(1, z); g.strokeRect(Math.round(bx - bw / 2), Math.round(by - bh), Math.round(bw), Math.round(bh));
    g.fillStyle = color; g.font = `bold ${Math.max(8, Math.round(8.5 * z))}px "Courier New", monospace`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(bubble.text, bx, by - bh / 2);
    // tiny payout/stake line
    g.fillStyle = "#7f93b8"; g.font = `${Math.max(7, Math.round(7.2 * z))}px "Courier New", monospace`;
    g.fillText(`payout ${market.payout ?? "—"} · max ${money(market.maxStake)}`, plate.x, plate.y + ph + 17 * z);
    targets.push({ ...deskScreenRect(desk), type: "desk", key: market.marketKey });
  }
  function drawFloor(g, frame) {
    const z = zoom();
    for (let gx = -4; gx <= 12; gx += 2) for (let gy = -6; gy <= 10; gy += 2) {
      const p = project(gx, gy, -0.02);
      diamond(g, p.x, p.y, TILE_W * 2 * z, TILE_H * 2 * z, ((gx + gy) / 2) % 2 === 0 ? "#0a1120" : "#0c1424", "#101a30");
    }
  }
  function drawBackWall(g) {
    const z = zoom();
    const left = project(-3.5, -5.5, 0), right = project(12.5, -5.5, 0);
    const height = 190 * z;
    g.fillStyle = "#0b1322";
    g.beginPath(); g.moveTo(left.x, left.y); g.lineTo(right.x, right.y); g.lineTo(right.x, right.y - height); g.lineTo(left.x, left.y - height); g.closePath(); g.fill();
    g.strokeStyle = "#1c2a48"; g.lineWidth = Math.max(1, z); g.stroke();
    const market = state.office;
    const panel = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 - height + 12 * z, w: Math.abs(right.x - left.x) * 0.78, h: height - 26 * z };
    // big screen
    block(g, panel.x - panel.w / 2, panel.y - panel.h, panel.w, panel.h, "#081120");
    g.strokeStyle = "#2a3d63"; g.strokeRect(Math.round(panel.x - panel.w / 2), Math.round(panel.y - panel.h), Math.round(panel.w), Math.round(panel.h));
    g.textAlign = "center"; g.textBaseline = "top";
    const settled = market?.portfolio?.settled ?? { pnl: 0, wins: 0, losses: 0, draws: 0, trades: 0 };
    g.fillStyle = "#7f93b8"; g.font = `bold ${Math.round(9 * z)}px "Courier New", monospace`;
    g.fillText("RESULTADO DO DIA · SETTLED", panel.x, panel.y - panel.h + 8 * z);
    g.fillStyle = settled.pnl > 0 ? "#8ce4a0" : settled.pnl < 0 ? "#ff9d9d" : "#cfe0ff";
    g.font = `bold ${Math.round(30 * z)}px "Courier New", monospace`;
    g.fillText(signed(settled.pnl), panel.x, panel.y - panel.h + 24 * z);
    g.fillStyle = "#7f93b8"; g.font = `${Math.round(9 * z)}px "Courier New", monospace`;
    const balance = market?.mode === "REAL" ? market?.modeState?.real?.balance : market?.modeState?.practice?.balance;
    g.fillText(`PATRIMÔNIO ${money(balance, market?.modeState?.practice?.currency ?? "")} · OPS ${settled.trades} · W ${settled.wins} / L ${settled.losses} / D ${settled.draws}`, panel.x, panel.y - panel.h + 62 * z);
    g.fillText(`ATIVOS ${market?.activeCount ?? 0}/${market?.activeLimit ?? 10} · POSIÇÕES ${market?.portfolio?.openPositions?.length ?? 0} · AGENTES ONLINE ${market?.aux?.portfolioControl?.agentsOnline ?? 0}`, panel.x, panel.y - panel.h + 76 * z);
    // equity curve
    const curve = market?.portfolio?.equityCurve ?? [];
    const chart = { x: panel.x - panel.w / 2 + 14 * z, y: panel.y - panel.h + 92 * z, w: panel.w - 28 * z, h: panel.h - 108 * z };
    g.strokeStyle = "#16213a"; g.strokeRect(Math.round(chart.x), Math.round(chart.y), Math.round(chart.w), Math.round(chart.h));
    if (curve.length > 1) {
      const values = curve.map((point) => Number(point.cumulative) || 0);
      const min = Math.min(0, ...values), max = Math.max(0, ...values);
      const span = Math.max(0.0001, max - min);
      g.strokeStyle = values[values.length - 1] >= 0 ? "#37d67a" : "#ff5d5d"; g.lineWidth = Math.max(1.4, 2 * z); g.beginPath();
      values.forEach((value, index) => { const px = chart.x + (chart.w * (index / (values.length - 1))); const py = chart.y + chart.h - ((value - min) / span) * chart.h; if (index === 0) g.moveTo(px, py); else g.lineTo(px, py); });
      g.stroke();
    } else { g.fillStyle = "#42506b"; g.textAlign = "center"; g.font = `${Math.round(9 * z)}px "Courier New", monospace`; g.fillText("sem settlements hoje", chart.x + chart.w / 2, chart.y + chart.h / 2); }
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
    const targets = [];
    drawFloor(ctx, frame);
    drawBackWall(ctx);
    const markets = state.office?.markets ?? [];
    const desks = DESKS.map((desk, index) => ({ desk, market: markets[index] })).filter((row) => row.market);
    desks.sort((a, b) => (a.desk.gx + a.desk.gy) - (b.desk.gx + b.desk.gy));
    for (const row of desks) drawDesk(ctx, row.market, row.desk, desks.indexOf(row), frame, targets);
    canvas.__targets = targets;
    // subtle "vida" particles
    ctx.fillStyle = "#4da3ff22";
    for (let index = 0; index < 24; index += 1) { const px = ((index * 97 + frame * 3) % width); const py = ((index * 53 + Math.sin(index + frame / 6) * 12 + height * 0.3) % height); ctx.fillRect(Math.round(px), Math.round(py), 2, 2); }
    requestAnimationFrame(render);
  }
  function computeDefaultCamera() {
    if (!canvas) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const center = iso(4, 2, 0);
    const zoom = Math.min(1.25, Math.max(0.62, Math.min(width / 1180, height / 760)));
    state.defaultCamera = { zoom, x: width / 2 - center.x * zoom, y: height * 0.30 - center.y * zoom };
    state.camera = { ...state.defaultCamera };
  }
  function centerOn(gx, gy, zoomValue = null) {
    if (!canvas) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const z = zoomValue ?? state.camera.zoom;
    const point = iso(gx, gy, 0);
    state.camera.x = width / 2 - point.x * z;
    state.camera.y = height * 0.55 - point.y * z;
    state.camera.zoom = z;
  }

  /* ------------------------------ drawers ------------------------------ */
  function closeDrawers() { if (overlay) overlay.innerHTML = ""; state.drawer = null; state.selectedMarket = null; }
  function drawerShell(title, subtitle, extra = "") {
    return `<div class="office-drawer"><button class="office-btn ghost close" data-close="1">FECHAR</button><span class="office-badge ${subtitle.kind ?? ""}">${subtitle.text}</span><h3>${title}</h3>${extra}</div>`;
  }
  function marketDrawer(marketKey) {
    const market = state.office?.markets?.find((row) => row.marketKey === marketKey);
    if (!market || !overlay) return;
    const decision = market.decisionState ?? {};
    const position = market.positionState ?? {};
    const daily = market.settlementState?.daily ?? {};
    const latency = market.latency ?? {};
    const trade = market.lastTrade;
    const feature = market.featureState ?? {};
    const selection = state.office?.config?.selection ?? { family: "V3" };
    overlay.innerHTML = drawerShell(market.display, { text: market.marketType, kind: market.marketType === "OTC" ? "otc" : "normal" }, `
      <div class="office-kv">
        <div><span>MARKET KEY</span><b>${market.marketKey}</b></div>
        <div><span>ACTIVE ID</span><b>${market.activeId ?? "—"} · ${(market.instrumentTypes ?? []).join("/") || "—"}</b></div>
        <div><span>STATUS</span><b>${agentLabel[market.agentState] ?? market.agentState}</b></div>
        <div><span>CONEXÃO</span><b>${market.connectionHealth?.connected ? "ONLINE" : "OFFLINE"} · ${market.availability}</b></div>
        <div><span>PAYOUT</span><b>${market.payout ?? "—"}</b></div>
        <div><span>PREÇO ATUAL</span><b>${money(market.lastTick?.price)}</b></div>
        <div><span>ENTRADA</span><b>${money(position.entryPrice)}</b></div>
        <div><span>DIREÇÃO</span><b>${position.direction ?? "—"}</b></div>
        <div><span>STAKE ATUAL</span><b>${money(position.stake)}</b></div>
        <div><span>STAKE MÁXIMO</span><b>${money(market.maxStake)}</b></div>
        <div><span>ESTRATÉGIA</span><b>${market.strategy ?? selection.family}</b></div>
        <div><span>ÚLTIMA DECISÃO</span><b>${decision.action ?? "—"} (${decision.reason ?? "—"})</b></div>
        <div><span>CONFIANÇA</span><b>${decision.confidence ?? "—"}</b></div>
        <div><span>TRIGGER</span><b>${decision.trigger ? `RSI ${Number(decision.trigger.rsi14 ?? 0).toFixed(1)} · s ${Number(decision.trigger.s ?? 0).toFixed(2)}` : "—"}</b></div>
        <div><span>FRESHNESS</span><b>${feature.fresh ? "OK" : feature.freshnessReason ?? "—"} · idade ${market.lastTick?.ageMs ?? "—"}ms</b></div>
        <div><span>LATÊNCIA p50/p95</span><b>${latency.serverToReceived?.p50 ?? "—"} / ${latency.serverToReceived?.p95 ?? "—"} ms</b></div>
        <div><span>CANDLES 5s</span><b>${market.candles5s ?? 0}</b></div>
        <div><span>ÚLTIMO SETTLEMENT</span><b>${trade ? `${trade.result} ${signed(trade.profit)} (${trade.causalResult}${trade.mismatch ? " · MISMATCH" : ""})` : "—"}</b></div>
        <div><span>DIA W/L/D</span><b>${daily.wins ?? 0} / ${daily.losses ?? 0} / ${daily.draws ?? 0}</b></div>
        <div><span>PNL DIA</span><b>${signed(daily.settledPnl ?? 0)}</b></div>
      </div>
      <div class="office-actions">
        <button class="office-btn ${market.enabled ? "warn" : "primary"}" data-market-toggle="${market.marketKey}">${market.enabled ? "DESABILITAR" : "HABILITAR"}</button>
        <button class="office-btn ${market.paused ? "primary" : "ghost"}" data-market-pause="${market.marketKey}">${market.paused ? "RETOMAR" : "PAUSAR ENTRADAS"}</button>
      </div>
      <div class="office-actions">
        <label class="office-field">STAKE MÁX. <input type="number" min="1" max="100" step="1" value="${Number(market.maxStake) || 1}" data-market-stake-input="${market.marketKey}" /></label>
        <button class="office-btn" data-market-stake="${market.marketKey}">SALVAR STAKE</button>
        <label class="office-field">ESTRATÉGIA
          <select data-market-strategy="${market.marketKey}">
            ${["V1", "V2", "V3", "V8"].map((family) => `<option value="${family}" ${String(market.strategy) === family ? "selected" : ""}>${family}</option>`).join("")}
          </select>
        </label>
        <button class="office-btn" data-market-strategy-save="${market.marketKey}">SALVAR ESTRATÉGIA</button>
      </div>
      <p class="fine">Mudanças de stake/estratégia valem para a PRÓXIMA operação; a operação ativa mantém o snapshot original.</p>`);
  }
  function auxDrawer(kind) {
    const office = state.office; if (!office || !overlay) return;
    const content = kind === "risk" ? `<div class="office-kv"><div><span>POSIÇÕES ABERTAS</span><b>${office.aux.risk.openPositions}</b></div><div><span>STAKE EM RISCO</span><b>${money(office.aux.risk.stakeAtRisk)}</b></div><div><span>LIMITE ATIVOS</span><b>${office.aux.risk.limits.maxOpenPerMarket} por mercado · ${office.aux.risk.limits.maxActiveMarkets} mercados</b></div><div><span>HARD CAP</span><b>${office.aux.risk.limits.hardCap}</b></div></div><div class="office-list">${(office.aux.risk.exposure ?? []).map((row) => `<div class="office-list-row"><div><b>${row.currency}</b><small>net ${signed(row.net)} · stake ${money(row.stake)}</small></div><div class="right"><span class="office-badge ${Math.max(row.longCount, row.shortCount) >= 3 ? "bad" : "good"}">${row.longCount}L/${row.shortCount}S</span></div></div>`).join("") || "<p class='fine'>Sem exposição aberta.</p>"}</div>`
      : kind === "compliance" ? `<div class="office-kv"><div><span>MODO</span><b>${office.mode}</b></div><div><span>ARM</span><b>${office.aux.compliance.armState?.armed ? "ARMADA" : "DISARMED"}</b></div><div><span>KILL SWITCH</span><b>${office.aux.compliance.killSwitch?.executionEnabled ? "LIVRE" : "ACIONADO"}</b></div><div><span>HARD CAP</span><b>${office.aux.compliance.hardCap}</b></div><div><span>REAL MODE</span><b>${office.aux.compliance.realMode?.realModeEnabled ? "AUTORIZADO" : "BLOQUEADO"}</b></div><div><span>INVARIANTES</span><b>NORMAL≠OTC · 1 ordem/decisão · 1 posição/mercado</b></div></div>`
      : kind === "executionGate" ? `<div class="office-kv"><div><span>ESTADO</span><b>${office.aux.executionGate.state}</b></div><div><span>ORDENS PENDENTES</span><b>${office.aux.executionGate.pendingOrders}</b></div><div><span>MERCADOS PERMITIDOS</span><b>${(office.aux.executionGate.allowedMarkets ?? []).length}</b></div><div><span>MERCADOS BLOQUEADOS</span><b>${(office.aux.executionGate.blockedMarkets ?? []).length}</b></div><div><span>MOTIVOS</span><b>${(office.aux.executionGate.reasons ?? []).join(", ") || "—"}</b></div></div>`
      : kind === "portfolioControl" ? `<div class="office-kv"><div><span>ATIVOS</span><b>${office.activeCount}/${office.activeLimit}</b></div><div><span>POSIÇÕES</span><b>${office.portfolio.openPositions.length}</b></div><div><span>PNL SETTLED</span><b>${signed(office.portfolio.settled.pnl)}</b></div><div><span>W/L/D</span><b>${office.portfolio.settled.wins}/${office.portfolio.settled.losses}/${office.portfolio.settled.draws}</b></div><div><span>AGENTES ONLINE</span><b>${office.aux.portfolioControl.agentsOnline}</b></div></div>`
      : kind === "macro" ? `<p class="fine">${office.aux.macro.note ?? "contexto macro não conectado nesta fase"}</p><div class="office-kv"><div><span>STATUS</span><b>${office.aux.macro.status}</b></div></div>`
      : `<p class="fine">${office.aux.news.note ?? "interface pronta; nenhum evento inventado"}</p><div class="office-kv"><div><span>STATUS</span><b>${office.aux.news.status}</b></div></div>`;
    const titles = { risk: "RISK", compliance: "COMPLIANCE", executionGate: "EXECUTION GATE", portfolioControl: "PORTFOLIO CONTROL", macro: "MACRO", news: "NEWS" };
    overlay.innerHTML = drawerShell(titles[kind] ?? kind.toUpperCase(), { text: "MÓDULO AUXILIAR", kind: kind === "executionGate" && office.aux.executionGate.state === "ARMED" ? "good" : "" }, content);
  }
  function marketManagerDrawer() {
    const office = state.office; if (!office || !overlay) return;
    const rows = (office.markets ?? []).map((market) => `
      <div class="office-list-row">
        <div><b>${market.display} <span class="office-badge ${market.marketType === "OTC" ? "otc" : "normal"}">${market.marketType}</span></b>
        <small>id ${market.activeId ?? "—"} · ${market.availability} · payout ${market.payout ?? "—"} · ${market.candles5s ?? 0} candles</small></div>
        <div class="right">
          <label class="office-field">R$ <input type="number" min="1" max="100" step="1" value="${Number(market.maxStake) || 1}" data-manager-stake="${market.marketKey}" /></label>
          <button class="office-btn ${market.enabled ? "warn" : "primary"}" data-manager-toggle="${market.marketKey}" ${!market.enabled && office.activeCount >= office.activeLimit ? "disabled" : ""}>${market.enabled ? "DESLIGAR" : "ATIVAR"}</button>
        </div>
      </div>`).join("");
    overlay.innerHTML = drawerShell("GERENCIAR ATIVOS", { text: `${office.activeCount} / ${office.activeLimit} ATIVOS`, kind: office.activeCount >= office.activeLimit ? "warn" : "good" }, `<p class="fine">15 mercados configurados (10 NORMAL + 5 OTC). Máximo de ${office.activeLimit} ativos simultâneos. OTC nunca substitui NORMAL automaticamente.</p><div class="office-list">${rows}</div>`);
  }
  function realModal() {
    const office = state.office; if (!office || !overlay) return;
    const realState = office.modeState?.real ?? {};
    const realMode = office.aux?.compliance?.realMode ?? {};
    overlay.innerHTML = `<div class="office-modal"><div class="office-modal-card">
      <h3>ATIVAR MODO REAL</h3>
      <p><b>Saldo REAL disponível:</b> ${money(realState.balance, realState.currency)}</p>
      <p><b>Aviso:</b> operações em modo REAL usam dinheiro real. O TraceCom pode enviar ordens reais na sua conta IQ Option após todos os gates.</p>
      <label class="office-field">STAKE MÁXIMO REAL (hard cap ${office.config.hardCap}) <input id="officeRealStake" type="number" min="1" max="${office.config.hardCap}" step="1" value="${Number(realMode.maxStake) || 1}" /></label>
      <div class="row"><input id="officeRealAck" type="checkbox" /><label for="officeRealAck">Confirmo que li o aviso e aceito operar dinheiro real.</label></div>
      <p>Digite <b>${realMode.phraseRequired ?? "OPERAR CONTA REAL"}</b> para confirmar:</p>
      <input id="officeRealPhrase" type="text" autocomplete="off" placeholder="OPERAR CONTA REAL" />
      <div class="office-actions">
        <button class="office-btn danger" id="officeRealConfirm">CONFIRMAR MODO REAL</button>
        <button class="office-btn ghost" data-close="1">CANCELAR</button>
        ${realMode.realModeEnabled ? '<button class="office-btn warn" id="officeRealRevoke">REVOGAR REAL</button>' : ""}
      </div>
      <p class="fine">REAL volta a ficar bloqueado após reload, restart, deploy, erro de socket, ACK desconhecido ou troca de modo.</p>
    </div></div>`;
  }

  /* ------------------------------ data ------------------------------ */
  async function refreshOffice() {
    try {
      const office = await get("/api/iq/office");
      state.office = office;
      if (!state.initialized) { computeDefaultCamera(); state.initialized = true; }
      renderTopbar(); renderAux(); renderTicker();
      if (state.selectedMarket) marketDrawer(state.selectedMarket);
    } catch {
      const chip = $("officeConnection");
      if (chip) { chip.textContent = "RELAY OFFLINE"; chip.className = "office-chip bad"; }
    }
  }
  function renderTopbar() {
    const office = state.office; if (!office) return;
    const practice = $("officePractice"), real = $("officeReal");
    if (practice) practice.classList.toggle("active", office.mode !== "REAL");
    if (real) { real.classList.toggle("active", office.mode === "REAL"); real.classList.toggle("blocked", !office.aux?.compliance?.realMode?.realModeEnabled); }
    const armed = office.aux?.compliance?.armState?.armed === true;
    const killed = office.aux?.compliance?.killSwitch?.executionEnabled !== true;
    const armButton = $("officeArm"); if (armButton) { armButton.disabled = armed || killed; armButton.textContent = armed ? "ARMADA" : "ARM"; armButton.classList.toggle("primary", !armed); }
    const killButton = $("officeKill"); if (killButton) { killButton.textContent = killed ? "REATIVAR" : "KILL SWITCH"; killButton.classList.toggle("danger", !killed); killButton.classList.toggle("warn", killed); }
    const activeChip = $("officeActiveCount"); if (activeChip) { activeChip.textContent = `ATIVOS ${office.activeCount}/${office.activeLimit}`; activeChip.className = `office-chip ${office.activeCount >= office.activeLimit ? "warn" : "on"}`; }
    const positionsChip = $("officeOpenPositions"); if (positionsChip) { positionsChip.textContent = `POSIÇÕES ${office.portfolio?.openPositions?.length ?? 0}`; positionsChip.className = `office-chip ${office.portfolio?.openPositions?.length ? "on" : ""}`; }
    const connectionChip = $("officeConnection"); if (connectionChip) { const healthy = office.connection?.healthy === true; connectionChip.textContent = healthy ? `WS ${office.connection?.host ?? "OK"}` : "WS DEGRADADO"; connectionChip.className = `office-chip ${healthy ? "on" : "bad"}`; }
    const globalStake = $("officeGlobalStake"); if (globalStake && document.activeElement !== globalStake) globalStake.value = String(office.config?.globalMaxStake ?? 2);
    const autoButton = $("officeAutoExec"); if (autoButton) { const auto = office.config?.autoExecute === true; autoButton.textContent = `AUTO: ${auto ? "ON" : "OFF"}`; autoButton.classList.toggle("warn", auto); }
  }
  function renderAux() {
    const office = state.office; if (!office) return;
    const aux = office.aux ?? {};
    const tiles = [
      { kind: "risk", label: "RISK", value: `${aux.risk?.openPositions ?? 0} pos · em risco ${money(aux.risk?.stakeAtRisk)}`, state: (aux.risk?.concentrationWarnings?.length ?? 0) > 0 ? "warn" : "" },
      { kind: "compliance", label: "COMPLIANCE", value: `${office.mode} · ${aux.compliance?.armState?.armed ? "ARMADA" : "DISARMED"} · ${aux.compliance?.killSwitch?.executionEnabled ? "KS off" : "KS ON"}`, state: aux.compliance?.killSwitch?.executionEnabled ? "good" : "bad" },
      { kind: "macro", label: "MACRO", value: aux.macro?.status ?? "NO_FEED", state: "" },
      { kind: "news", label: "NEWS", value: aux.news?.status ?? "NO_FEED", state: "" },
      { kind: "executionGate", label: "EXECUTION GATE", value: `${aux.executionGate?.state ?? "—"} · ${aux.executionGate?.allowedMarkets?.length ?? 0} mercados`, state: aux.executionGate?.state === "ARMED" ? "good" : aux.executionGate?.state === "BLOCKED" ? "bad" : "" },
      { kind: "portfolioControl", label: "PORTFOLIO CONTROL", value: `${office.activeCount}/${office.activeLimit} ativos · PnL ${signed(office.portfolio?.settled?.pnl ?? 0)}`, state: (office.portfolio?.settled?.pnl ?? 0) >= 0 ? "good" : "bad" },
    ];
    const container = $("officeAux"); if (!container) return;
    container.innerHTML = tiles.map((tile) => `<button class="office-aux-tile ${tile.state}" data-aux="${tile.kind}"><span>${tile.label}</span><b>${tile.value}</b></button>`).join("");
  }
  function renderTicker() {
    const container = $("officeTicker"); if (!container) return;
    container.innerHTML = state.ticker.slice(0, 40).map((line) => `<div>${line}</div>`).join("") || "<div class='fine'>Aguardando eventos do backend…</div>";
  }
  function pushTicker(text) { state.ticker = [`<b>${new Date().toLocaleTimeString("pt-BR")}</b> ${text}`, ...state.ticker].slice(0, 60); }
  async function pollEvents() {
    try {
      const result = await get(`/api/iq/events?after=${state.eventsCursor}&limit=200`);
      state.eventsCursor = result.cursor ?? state.eventsCursor;
      for (const event of result.events ?? []) handleEvent(event);
      if ((result.events ?? []).length) renderTicker();
    } catch { /* proximo ciclo */ }
  }
  function handleEvent(event) {
    const market = state.office?.markets?.find((row) => row.marketKey === event.marketKey);
    const name = market?.display ?? event.marketKey ?? "";
    if (event.type === "position.settled") {
      state.flashes.set(event.marketKey, event.brokerResult === "WIN" ? "WIN" : event.brokerResult === "LOSS" ? "LOSS" : "DRAW");
      setTimeout(() => state.flashes.delete(event.marketKey), 6_000);
      pushTicker(`${name} settlement <b>${event.brokerResult}</b> ${event.profit !== null && event.profit !== undefined ? signed(event.profit) : ""}${event.mismatch ? " · SETTLEMENT_MISMATCH" : ""}`);
    } else if (event.type === "order.ack") pushTicker(`${name} ordem <b>${event.brokerOrderId}</b> confirmada em ${event.ackMs}ms`);
    else if (event.type === "order.pending") pushTicker(`${name} enviando ${event.direction} stake ${money(event.stake)} (${event.mode})`);
    else if (event.type === "order.rejected") pushTicker(`${name} ordem rejeitada: ${event.reason}`);
    else if (event.type === "market.signal") pushTicker(`${name} sinal <b>${event.action}</b>`);
    else if (event.type === "connection.disconnected") pushTicker(`conexão WS caiu · auto-disarm · retry em ${event.nextAttemptInMs}ms`);
    else if (event.type === "connection.ready") pushTicker(`WS conectado em ${event.host} (skew ${event.clockSkewMs}ms)`);
    else if (event.type === "mode.changed") pushTicker(`modo alterado para <b>${event.mode}</b> · DISARM obrigatório`);
    else if (event.type === "kill_switch") pushTicker(`kill switch ${event.executionEnabled ? "liberado" : "ACIONADO"}`);
    else if (event.type === "markets.default_selection") pushTicker(`seleção padrão: ${(event.selected ?? []).join(", ")}`);
  }

  /* ------------------------------ interactions ------------------------------ */
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
      if (state.dragging && !state.dragMoved) { const target = hitTest(event.clientX, event.clientY); if (target?.type === "desk") { state.selectedMarket = target.key; const market = state.office?.markets?.find((row) => row.marketKey === target.key); const desk = DESKS[(state.office?.markets ?? []).findIndex((row) => row.marketKey === target.key)]; if (desk) centerOn(desk.gx + 1, desk.gy + 1); marketDrawer(target.key); closeIfManager(); } }
      state.dragging = false; canvas.classList.remove("dragging");
    });
    window.addEventListener("pointermove", (event) => {
      if (!state.dragging) return;
      const dx = event.clientX - state.lastPointer.x, dy = event.clientY - state.lastPointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) state.dragMoved = true;
      state.camera.x += dx; state.camera.y += dy; state.lastPointer = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener("wheel", (event) => { event.preventDefault(); const rect = canvas.getBoundingClientRect(); const px = event.clientX - rect.left, py = event.clientY - rect.top; const factor = event.deltaY < 0 ? 1.1 : 0.9; const zoomValue = Math.min(1.8, Math.max(0.5, state.camera.zoom * factor)); const ratio = zoomValue / state.camera.zoom; state.camera.x = px - (px - state.camera.x) * ratio; state.camera.y = py - (py - state.camera.y) * ratio; state.camera.zoom = zoomValue; }, { passive: false });
    canvas.addEventListener("dblclick", () => { if (state.defaultCamera) state.camera = { ...state.defaultCamera }; });
  }
  const closeIfManager = () => { /* reservado: fecha gerenciador ao abrir agente */ };
  function bindButtons() {
    document.addEventListener("click", async (event) => {
      const target = event.target.closest("[data-close],[data-aux],[data-manager-toggle],[data-manager-stake],[data-market-toggle],[data-market-pause],[data-market-stake],[data-market-stake-input],[data-market-strategy-save],#officeRealConfirm,#officeRealRevoke,#officeManage,#officePractice,#officeReal,#officeArm,#officeDisarm,#officeKill,#officeApplyAll,#officeReset,#officeFocus,#officeZoomIn,#officeZoomOut,#officeAutoExec");
      if (!target) return;
      try {
        if (target.dataset.close) return closeDrawers();
        if (target.dataset.aux) return auxDrawer(target.dataset.aux);
        if (target.id === "officeManage") return marketManagerDrawer();
        if (target.id === "officePractice") { await post("/api/iq/mode", { mode: "PRACTICE" }); pushTicker("modo PRACTICE (REAL revogado)"); return refreshOffice(); }
        if (target.id === "officeReal") return realModal();
        if (target.id === "officeArm") { const limit = Number($("officeGlobalStake")?.value) || state.office?.config?.globalMaxStake || 2; if (!window.confirm(`ARMAR execução no modo ${state.office?.mode}? Limite global ${money(limit)}.`)) return; await post("/api/iq/arm", { limitBrl: Math.min(100, limit), confirmation: "ARM_PRACTICE" }); return refreshOffice(); }
        if (target.id === "officeDisarm") { await post("/api/iq/disarm", {}); return refreshOffice(); }
        if (target.id === "officeKill") { await post("/api/iq/kill-switch", { engaged: state.office?.aux?.compliance?.killSwitch?.executionEnabled !== false }); return refreshOffice(); }
        if (target.id === "officeApplyAll") { const value = Number($("officeGlobalStake")?.value) || 2; await post("/api/iq/config/global-stake", { value }); pushTicker(`stake global ${money(value)} aplicado a todos os mercados`); return refreshOffice(); }
        if (target.id === "officeReset") { if (state.defaultCamera) state.camera = { ...state.defaultCamera }; return; }
        if (target.id === "officeFocus") { const market = state.office?.markets?.find((row) => row.marketKey === state.selectedMarket) ?? state.office?.markets?.find((row) => row.enabled); const desk = DESKS[(state.office?.markets ?? []).findIndex((row) => row.marketKey === market?.marketKey)]; if (desk) centerOn(desk.gx + 1, desk.gy + 1, 1.25); return; }
        if (target.id === "officeZoomIn") { state.camera.zoom = Math.min(1.8, state.camera.zoom * 1.15); return; }
        if (target.id === "officeZoomOut") { state.camera.zoom = Math.max(0.5, state.camera.zoom * 0.87); return; }
        if (target.id === "officeAutoExec") { await post("/api/iq/config/auto-execute", { enabled: state.office?.config?.autoExecute !== true }); return refreshOffice(); }
        if (target.id === "officeRealConfirm") { const maxStake = Number($("officeRealStake")?.value) || 1; const phrase = String($("officeRealPhrase")?.value ?? ""); const acknowledgeRisk = $("officeRealAck")?.checked === true; await post("/api/iq/real/confirm", { maxStake, phrase, acknowledgeRisk }); pushTicker("modo REAL confirmado no servidor (stake ≤ " + money(maxStake) + ")"); closeDrawers(); return refreshOffice(); }
        if (target.id === "officeRealRevoke") { await post("/api/iq/real/revoke", {}); pushTicker("modo REAL revogado"); closeDrawers(); return refreshOffice(); }
        if (target.dataset.managerToggle) { const market = (state.office?.markets ?? []).find((row) => row.marketKey === target.dataset.managerToggle); await put("/api/iq/market", { marketKey: target.dataset.managerToggle, enabled: market?.enabled !== true }); return refreshOffice().then(() => marketManagerDrawer()); }
        if (target.dataset.managerStake) { const value = Number(document.querySelector(`[data-manager-stake="${CSS.escape(target.dataset.managerStake)}"]`)?.value); await put("/api/iq/market", { marketKey: target.dataset.managerStake, maxStake: value }); pushTicker(`stake individual ${target.dataset.managerStake} = ${money(value)}`); return refreshOffice().then(() => marketManagerDrawer()); }
        if (target.dataset.marketToggle) { const market = (state.office?.markets ?? []).find((row) => row.marketKey === target.dataset.marketToggle); await put("/api/iq/market", { marketKey: target.dataset.marketToggle, enabled: market?.enabled !== true }); return refreshOffice(); }
        if (target.dataset.marketPause) { const market = (state.office?.markets ?? []).find((row) => row.marketKey === target.dataset.marketPause); await put("/api/iq/market", { marketKey: target.dataset.marketPause, paused: market?.paused !== true }); return refreshOffice(); }
        if (target.dataset.marketStake) { const value = Number(document.querySelector(`[data-market-stake-input="${CSS.escape(target.dataset.marketStake)}"]`)?.value); await put("/api/iq/market", { marketKey: target.dataset.marketStake, maxStake: value }); pushTicker(`stake ${target.dataset.marketStake} = ${money(value)}`); return refreshOffice(); }
        if (target.dataset.marketStrategySave) { const value = document.querySelector(`[data-market-strategy="${CSS.escape(target.dataset.marketStrategySave)}"]`)?.value; await put("/api/iq/market", { marketKey: target.dataset.marketStrategySave, strategy: value }); pushTicker(`estratégia ${target.dataset.marketStrategySave} = ${value}`); return refreshOffice(); }
      } catch (error) { pushTicker(`falha: ${String(error?.message || error).slice(0, 90)}`); renderTicker(); }
    });
  }
  function bindNavDefault() {
    const navButton = document.querySelector('.nav-item[data-page="office"]');
    if (navButton) navButton.click();
  }

  /* ------------------------------ boot ------------------------------ */
  function init() {
    canvas = $("officeCanvas"); overlay = $("officeOverlay");
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    bindInteractions(); bindButtons(); bindNavDefault();
    window.addEventListener("resize", () => { if (!state.initialized) computeDefaultCamera(); else if (state.defaultCamera) { /* mantem camera do usuario */ } });
    requestAnimationFrame(render);
    void refreshOffice();
    setInterval(() => { const page = $("page-office"); if (page && !page.hidden) void refreshOffice(); }, 2_000);
    setInterval(() => { const page = $("page-office"); if (page && !page.hidden) void pollEvents(); }, 1_000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  return { refresh: refreshOffice };
})();
