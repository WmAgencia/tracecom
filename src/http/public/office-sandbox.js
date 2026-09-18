/* TRACE/COM · Sandbox visual dos assets do escritório.
 * Lista agentes, móveis e composições; testa escala, âncoras, z-order e fontes.
 * Consome apenas OfficeAssets (office-assets.js) — mesmo pipeline do office.js.
 */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const status = $("status");
  const state = {
    scale: 2, anchors: false, grid: true, bg: true,
    agentState: "sit", agentDir: "front", flip: false,
    stationState: "active", walker: true, symbol: "EUR/USD", stationType: "OTC",
  };
  const scenes = [];
  let client = null;

  const iso = (gx, gy, gz = 0) => ({ x: (gx - gy) * 42, y: (gx + gy) * 19 - gz * 26 });

  function makeScene(canvas, width, height, draw) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const scene = { canvas, ctx, width, height, draw: (now) => draw(ctx, now, width, height), section: canvas.closest("section")?.id ?? null };
    scenes.push(scene);
    return scene;
  }

  function checker(ctx, width, height) {
    if (!state.bg) return;
    const size = 12;
    for (let y = 0; y < height; y += size) {
      for (let x = 0; x < width; x += size) {
        ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? "#0d1424" : "#0a101c";
        ctx.fillRect(x, y, size, size);
      }
    }
  }

  function crosshair(ctx, x, y, color = "#ffd76a") {
    if (!state.anchors) return;
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y);
    ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7);
    ctx.stroke();
    ctx.strokeStyle = "#000a"; ctx.strokeRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
  }

  function isoGrid(ctx, P) {
    if (!state.grid) return;
    ctx.strokeStyle = "#1d2a4633"; ctx.lineWidth = 1;
    for (let i = -6; i <= 6; i += 1) {
      const a = P(i, -6), b = P(i, 6);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const c = P(-6, i), d = P(6, i);
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
    }
  }

  function drawSorted(drawables) {
    drawables.sort((a, b) => a.depth - b.depth);
    for (const item of drawables) item.draw();
  }

  function stageCamera(width, height, centerGx, centerGy) {
    const scale = state.scale;
    const c = iso(centerGx, centerGy, 0);
    return { scale, x: width / 2 - c.x * scale, y: height / 2 - c.y * scale };
  }

  /* ------------------------------------------------------------------ */
  /* AGENTES                                                             */
  /* ------------------------------------------------------------------ */

  function renderAgentControls() {
    const states = ["idle", "sit", "walk", "work", "observe"];
    $("agentStates").innerHTML = states.map((name) => `<button data-agent-state="${name}" class="${state.agentState === name ? "on" : ""}">${name.toUpperCase()}</button>`).join(" ");
    const dirs = ["front", "side", "back"];
    $("agentDirs").innerHTML = dirs.map((name) => `<button data-agent-dir="${name}" class="${state.agentDir === name ? "on" : ""}">${name.toUpperCase()}</button>`).join(" ");
    $("agentFlip").classList.toggle("on", state.flip);
  }

  function buildAgents() {
    renderAgentControls();
    const grid = $("agentsGrid");
    grid.innerHTML = "";
    for (const manifest of client.agentVariants) {
      const cell = 44 * state.scale;
      const card = document.createElement("div");
      card.className = "card";
      const canvas = document.createElement("canvas");
      card.appendChild(canvas);
      const palette = manifest.palette ?? {};
      card.insertAdjacentHTML("beforeend", `
        <h3>${manifest.id}</h3>
        <p>${manifest.name} · papel <b>${manifest.role}</b> · ${manifest.frameWidth}x${manifest.frameHeight} ·
        animações: ${Object.keys(manifest.animations).join(", ")}</p>
        <div class="swatches"><i style="background:${palette.shirt ?? "#888"}"></i><i style="background:${palette.pants ?? "#444"}"></i><i style="background:${palette.hair ?? "#222"}"></i><i style="background:${palette.skin ?? "#ccc"}"></i></div>`);
      grid.appendChild(card);
      const agent = client.agent(manifest.id);
      makeScene(canvas, Math.max(150, cell + 60), Math.max(170, cell + 120), (ctx, now, w, h) => {
        ctx.clearRect(0, 0, w, h);
        checker(ctx, w, h);
        const scale = state.scale;
        const x = w / 2, y = h - 34;
        if (state.grid) {
          ctx.strokeStyle = "#1d2a4655";
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
        agent.draw(ctx, { x, y, scale, state: state.agentState, dir: state.agentDir, flip: state.flip, now });
        crosshair(ctx, x, y);
        ctx.fillStyle = "#7f93b8"; ctx.font = "10px 'Courier New', monospace"; ctx.textAlign = "center";
        ctx.fillText(`${state.agentState} · ${state.agentDir}${state.flip ? " · flip" : ""}`, w / 2, h - 10);
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* MÓVEIS                                                              */
  /* ------------------------------------------------------------------ */

  function buildFurniture() {
    const grid = $("furnitureGrid");
    grid.innerHTML = "";
    const order = { furniture: 0, props: 1, decor: 2, floors: 3, walls: 4, ui: 5 };
    const items = client.list().filter((m) => m.category !== "agents").sort((a, b) => (order[a.category] - order[b.category]) || a.id.localeCompare(b.id));
    for (const manifest of items) {
      const scale = state.scale;
      const pad = 24;
      const width = Math.max(180, Math.round(manifest.width * scale) + pad * 2);
      const height = Math.max(140, Math.round(manifest.height * scale) + pad * 2);
      const card = document.createElement("div");
      card.className = "card";
      const canvas = document.createElement("canvas");
      card.appendChild(canvas);
      const footprint = manifest.footprint ? `${manifest.footprint.w}x${manifest.footprint.d}` : "—";
      card.insertAdjacentHTML("beforeend", `
        <h3>${manifest.id} <span class="badge">${manifest.category}</span></h3>
        <p>${manifest.name} · ${manifest.width}x${manifest.height}px · anchor (${manifest.anchor.x}, ${manifest.anchor.y})</p>
        <p>footprint ${footprint} tiles · altura z ${manifest.heightZ ?? 0} · licença ${manifest.license} · fonte ${manifest.source}</p>`);
      grid.appendChild(card);
      makeScene(canvas, width, height, (ctx) => {
        const w = width, h = height;
        ctx.clearRect(0, 0, w, h);
        checker(ctx, w, h);
        const x = w / 2, y = h / 2 + manifest.anchor.y * scale * 0.35;
        client.draw(ctx, manifest.id, { x, y, scale });
        crosshair(ctx, x, y);
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* ESTAÇÃO                                                             */
  /* ------------------------------------------------------------------ */

  function renderStationControls() {
    const options = [["active", "ATIVO (TRABALHANDO)"], ["idle", "AGUARDANDO"], ["paused", "PAUSADO"], ["closed", "SEM AGENTES"]];
    $("stationStates").innerHTML = options.map(([value, label]) => `<button data-station-state="${value}" class="${state.stationState === value ? "on" : ""}">${label}</button>`).join(" ");
    $("stationType").textContent = state.stationType;
    $("stationType").classList.toggle("on", state.stationType === "OTC");
    $("stationWalker").classList.toggle("on", state.walker);
  }

  function buildStation() {
    const canvas = $("stationCanvas");
    const meta = $("stationMeta");
    const width = 1100, height = 560;
    const station = new OfficeAssets.StationSet(client, { traderId: "agent_trader_amber" });
    const walker = client.agent("agent_trader_teal");
    meta.textContent = "desk_trading + 2x chair_office + agent_trader_amber + agent_critic + station_plate + prop_monitor + prop_mug (via StationSet + StationPlate)";
    makeScene(canvas, width, height, (ctx, now) => {
      ctx.clearRect(0, 0, width, height);
      checker(ctx, width, height);
      const cam = stageCamera(width, height, 1.1, 0.9);
      const P = (gx, gy, gz) => { const p = iso(gx, gy, gz); return { x: cam.x + p.x * cam.scale, y: cam.y + p.y * cam.scale }; };
      const scale = cam.scale;
      for (let gx = -3; gx <= 6; gx += 1) for (let gy = -3; gy <= 6; gy += 1) {
        const p = P(gx + 0.5, gy + 0.5, 0);
        client.sprite((gx + gy) % 2 === 0 ? "floor_office_a" : "floor_office_b").draw(ctx, { x: p.x, y: p.y, scale });
      }
      isoGrid(ctx, P);
      const drawables = [];
      const seat = state.stationState;
      const traderState = seat === "active" ? "work" : seat === "idle" ? "sit" : "observe";
      const criticState = seat === "active" ? "work" : seat === "idle" ? "sit" : "observe";
      const traderPos = P(0.72, -0.14), criticPos = P(1.28, -0.14);
      const deskPos = P(0, 0);
      if (seat !== "closed") {
        const drop = traderState === "observe" ? 0 : 8;
        drawables.push({ depth: -1.1, draw: () => station.drawActors(ctx, { traderPos, criticPos, scale: scale * 1.2, traderState, criticState, drop, now }) });
      }
      drawables.push({ depth: 0, draw: () => station.drawDesk(ctx, { x: deskPos.x, y: deskPos.y, scale, monitorPos: P(0.3, 0.38, 0.66), mugPos: P(1.66, 0.42, 0.66) }) });
      const plateTop = P(1, 2, 0.62);
      drawables.push({ depth: 0.05, draw: () => {
        station.drawPlate(ctx, {
          x: plateTop.x, y: plateTop.y, scale,
          symbol: state.symbol.toUpperCase(), symbolColor: "#eef4ff",
          info: `${state.stationType} 85% R$ 10,00`,
          setup: "TREND_PULLBACK",
          infoColor: state.stationType === "OTC" ? "#ffd08a" : "#9fc6ff",
        });
      } });
      if (state.walker) {
        const gx = -1.6 + ((now / 1400) % 4.6);
        const gy = 2.5;
        const pos = P(gx, gy);
        drawables.push({ depth: gx + gy + 0.1, draw: () => walker.draw(ctx, { x: pos.x, y: pos.y, scale, state: "walk", dir: "side", flip: false, now }) });
        crosshair(ctx, pos.x, pos.y, "#8ce4a0");
      }
      drawSorted(drawables);
      ctx.fillStyle = "#7f93b8"; ctx.font = "11px 'Courier New', monospace"; ctx.textAlign = "left";
      ctx.fillText(`escala ${state.scale}x · z-order por profundidade (gx+gy) · placa reutilizável`, 14, 20);
    });
  }

  /* ------------------------------------------------------------------ */
  /* LOUNGE / COPA / REUNIÃO                                             */
  /* ------------------------------------------------------------------ */

  function drawFloorArea(ctx, P, scale, tileId, gx0, gy0, gx1, gy1) {
    const tile = client.sprite(tileId);
    for (let gx = gx0; gx <= gx1; gx += 1) for (let gy = gy0; gy <= gy1; gy += 1) {
      const p = P(gx + 0.5, gy + 0.5, 0);
      tile.draw(ctx, { x: p.x, y: p.y, scale });
    }
  }

  function buildLounge() {
    const canvas = $("loungeCanvas");
    const width = 1100, height = 620;
    $("loungeMeta").textContent = "rug_lounge + sofa + coffee_table + armchair + pool_table + plant + plant_tall + floor_lamp + agentes sociais";
    makeScene(canvas, width, height, (ctx, now) => {
      ctx.clearRect(0, 0, width, height);
      checker(ctx, width, height);
      const cam = stageCamera(width, height, -3.2, 3.4);
      const P = (gx, gy, gz) => { const p = iso(gx, gy, gz); return { x: cam.x + p.x * cam.scale, y: cam.y + p.y * cam.scale }; };
      const scale = cam.scale;
      drawFloorArea(ctx, P, scale, "floor_lounge_wood", -7, 0, 1, 7);
      isoGrid(ctx, P);
      const drawables = [];
      const furniture = [
        ["rug_lounge", -5.2, 1.1], ["sofa", -5.0, 1.7], ["coffee_table", -4.4, 3.2],
        ["armchair", -2.6, 2.1], ["pool_table", -5.4, 4.9], ["floor_lamp", -1.7, 1.3],
        ["plant_tall", -5.3, 0.1], ["plant", -1.2, 4.7],
      ];
      for (const [id, gx, gy] of furniture) {
        const p = P(gx, gy);
        drawables.push({ depth: gx + gy, draw: () => client.draw(ctx, id, { x: p.x, y: p.y, scale }) });
      }
      const sitting = client.agent("agent_social_green");
      const sitter = P(-2.3, 2.4);
      drawables.push({ depth: -2.3 + 2.4 - 0.9, draw: () => sitting.draw(ctx, { x: sitter.x, y: sitter.y, scale, state: "sit", dir: "front", now }) });
      const strolling = client.agent("agent_social_orange");
      const walkX = -3.2 + Math.sin(now / 3000) * 1.6;
      const walkerPos = P(walkX, 4.4);
      drawables.push({ depth: walkX + 4.4, draw: () => strolling.draw(ctx, { x: walkerPos.x, y: walkerPos.y, scale, state: "walk", dir: "side", flip: Math.cos(now / 3000) < 0, now }) });
      drawSorted(drawables);
    });
  }

  function buildKitchen() {
    const canvas = $("kitchenCanvas");
    const width = 1100, height = 560;
    $("kitchenMeta").textContent = "counter + sink + fridge + water_cooler + piso de copa";
    makeScene(canvas, width, height, (ctx, now) => {
      ctx.clearRect(0, 0, width, height);
      checker(ctx, width, height);
      const cam = stageCamera(width, height, 1, 1);
      const P = (gx, gy, gz) => { const p = iso(gx, gy, gz); return { x: cam.x + p.x * cam.scale, y: cam.y + p.y * cam.scale }; };
      const scale = cam.scale;
      drawFloorArea(ctx, P, scale, "floor_kitchen_tile", -3, -3, 5, 5);
      isoGrid(ctx, P);
      const drawables = [];
      for (const [id, gx, gy] of [["counter", 0, 0], ["sink", 2.1, 0], ["fridge", 2.3, 1.5], ["water_cooler", 0, 2.2]]) {
        const p = P(gx, gy);
        drawables.push({ depth: gx + gy, draw: () => client.draw(ctx, id, { x: p.x, y: p.y, scale }) });
      }
      const agent = client.agent("agent_social_orange");
      const pos = P(1.1, 2.6);
      drawables.push({ depth: 1.1 + 2.6, draw: () => agent.draw(ctx, { x: pos.x, y: pos.y, scale, state: now % 2600 < 1300 ? "observe" : "idle", dir: "front", now }) });
      drawSorted(drawables);
    });
  }

  function buildMeeting() {
    const canvas = $("meetingCanvas");
    const width = 1100, height = 600;
    $("meetingMeta").textContent = "meeting_table + whiteboard + chair_office + agentes sociais sentados";
    makeScene(canvas, width, height, (ctx, now) => {
      ctx.clearRect(0, 0, width, height);
      checker(ctx, width, height);
      const cam = stageCamera(width, height, 1.4, 1.2);
      const P = (gx, gy, gz) => { const p = iso(gx, gy, gz); return { x: cam.x + p.x * cam.scale, y: cam.y + p.y * cam.scale }; };
      const scale = cam.scale;
      drawFloorArea(ctx, P, scale, "floor_office_b", -3, -3, 6, 6);
      isoGrid(ctx, P);
      const drawables = [];
      const backChairs = [[0.2, -0.6], [1.5, -0.6], [2.6, -0.2]];
      const frontChairs = [[2.6, 1.4], [1.4, 2.4], [0.2, 2.0]];
      const chair = client.sprite("chair_office");
      for (const [gx, gy] of backChairs) {
        const p = P(gx, gy);
        drawables.push({ depth: -1, draw: () => chair.draw(ctx, { x: p.x, y: p.y + 4 * scale, scale }) });
      }
      for (const [gx, gy] of frontChairs) {
        const p = P(gx, gy);
        drawables.push({ depth: 4 + gx + gy, draw: () => chair.draw(ctx, { x: p.x, y: p.y + 4 * scale, scale }) });
      }
      const agents = [
        ["agent_social_orange", 0.62, 0.14, "front", -0.8],
        ["agent_social_green", 1.92, 0.14, "front", -0.8],
        ["agent_supervisor", 1.2, 2.35, "back", 6],
      ];
      for (const [id, gx, gy, dir, depth] of agents) {
        const agent = client.agent(id);
        const p = P(gx, gy);
        drawables.push({ depth, draw: () => agent.draw(ctx, { x: p.x, y: p.y + 8 * scale, scale, state: "sit", dir, now }) });
      }
      const tablePos = P(0, 0);
      drawables.push({ depth: 1.2, draw: () => client.draw(ctx, "meeting_table", { x: tablePos.x, y: tablePos.y, scale }) });
      const boardPos = P(3.4, 0.1);
      drawables.push({ depth: -3, draw: () => client.draw(ctx, "whiteboard", { x: boardPos.x, y: boardPos.y, scale }) });
      drawSorted(drawables);
    });
  }

  /* ------------------------------------------------------------------ */
  /* FONTE                                                               */
  /* ------------------------------------------------------------------ */

  function buildFont() {
    const canvas = $("fontCanvas");
    const width = 1100, height = 420;
    const font = client.font;
    $("fontMeta").textContent = font ? `${font.width}x${font.height}px · célula ${font.cell.w}x${font.cell.h} · ${Object.keys(font.glyphs).length} glifos · escala inteira` : "fonte indisponível";
    makeScene(canvas, width, height, (ctx) => {
      ctx.clearRect(0, 0, width, height);
      checker(ctx, width, height);
      if (!font) return;
      const chars = Object.keys(font.glyphs).join("");
      ctx.fillStyle = "#0d1424"; ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = false;
      if (client.fontImage) ctx.drawImage(client.fontImage, 20, 20);
      const samples = [
        [1, "EUR/USD OTC - PAYOUT 85 - R$ 10,00"],
        [2, "ESTACAO 07 - TRADER + CRITICO"],
        [3, "RESULTADO DO DIA +R$ 6,42"],
      ];
      let y = 90;
      for (const [scale, text] of samples) {
        client.text.draw(ctx, text, { x: 20, y, scale, color: "#eaf2ff", align: "left" });
        y += 22 + 8 * scale;
      }
      ctx.fillStyle = "#7f93b8"; ctx.font = "11px 'Courier New', monospace";
      ctx.fillText(`glifos: ${chars}`, 20, height - 18);
    });
  }

  /* ------------------------------------------------------------------ */
  /* CONTROLES                                                           */
  /* ------------------------------------------------------------------ */

  function bindControls() {
    $("scale").addEventListener("input", (event) => {
      state.scale = Number(event.target.value);
      $("scaleValue").textContent = `${state.scale}x`;
      buildAgents();
      buildFurniture();
    });
    $("toggleAnchors").addEventListener("click", (event) => { state.anchors = !state.anchors; event.target.classList.toggle("on", state.anchors); });
    $("toggleGrid").addEventListener("click", (event) => { state.grid = !state.grid; event.target.classList.toggle("on", state.grid); });
    $("toggleBg").addEventListener("click", (event) => { state.bg = !state.bg; event.target.classList.toggle("on", state.bg); });
    $("agentFlip").addEventListener("click", (event) => { state.flip = !state.flip; event.target.classList.toggle("on", state.flip); });
    $("linkOffice").addEventListener("click", () => window.open("/office-fixture.html", "_self"));
    document.querySelectorAll(".tabs button").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".tabs button").forEach((other) => other.classList.toggle("on", other === button));
        document.querySelectorAll("main section").forEach((section) => section.classList.toggle("on", section.id === `tab-${button.dataset.tab}`));
      });
    });
    document.addEventListener("click", (event) => {
      const agentState = event.target.closest("[data-agent-state]");
      if (agentState) { state.agentState = agentState.dataset.agentState; renderAgentControls(); }
      const agentDir = event.target.closest("[data-agent-dir]");
      if (agentDir) { state.agentDir = agentDir.dataset.agentDir; renderAgentControls(); }
      const stationState = event.target.closest("[data-station-state]");
      if (stationState) { state.stationState = stationState.dataset.stationState; renderStationControls(); }
    });
    $("stationSymbol").addEventListener("input", (event) => { state.symbol = event.target.value || "EUR/USD"; });
    $("stationType").addEventListener("click", (event) => { state.stationType = state.stationType === "OTC" ? "NORMAL" : "OTC"; event.target.textContent = state.stationType; renderStationControls(); });
    $("stationWalker").addEventListener("click", (event) => { state.walker = !state.walker; event.target.classList.toggle("on", state.walker); });
    const initial = String(location.hash || "").replace("#", "");
    if (initial) document.querySelector(`.tabs button[data-tab="${initial}"]`)?.click();
  }

  /* ------------------------------------------------------------------ */
  /* LOOP                                                                */
  /* ------------------------------------------------------------------ */

  function frame(now) {
    for (const scene of scenes) {
      const section = scene.section ? document.getElementById(scene.section) : null;
      if (!section || !section.classList.contains("on")) continue;
      scene.ctx.imageSmoothingEnabled = false;
      scene.draw(now);
    }
    requestAnimationFrame(frame);
  }

  (async () => {
    try {
      client = await window.OfficeAssets.load();
      status.textContent = `${client.list().length} assets carregados`;
      bindControls();
      buildAgents();
      buildFurniture();
      buildStation();
      buildLounge();
      buildKitchen();
      buildMeeting();
      buildFont();
      renderStationControls();
      requestAnimationFrame(frame);
    } catch (error) {
      status.textContent = `erro ao carregar assets: ${error.message}`;
      console.error(error);
    }
  })();
})();
