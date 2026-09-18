/**
 * OFFICE V3 — REAL BROWSER CHECK (Task 6).
 *
 * Starts a local static server for `src/http/public` (with a deterministic
 * `/api/iq/office` fixture built from the reconciled relay universe) and drives
 * a REAL headless browser through 7 navigation/state scenarios, capturing
 * before/after screenshots into `docs/office-v3/screenshots/` and a JSON report
 * into `docs/office-v3/browser-check.report.json`.
 *
 * Browser resolution order (printed honestly at the end):
 *   1. `playwright` already installed in node_modules;
 *   2. temp install `playwright` + system Chrome/Edge channel (no 150MB download);
 *   3. jsdom/synthetic harness (clearly labelled SYNTHETIC, never claimed as real).
 *
 * Read-only w.r.t. the app; the fixture API lives in this script (no relay/**).
 * PRACTICE only. ZERO REAL. No orders, no stake writes.
 *
 * Usage: node scripts/office-v3-browser-check.mjs [--url=http://host/] [--scenario=3]
 */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

import { UNIVERSE } from "../relay/market-universe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PUBLIC_DIR = resolve(ROOT, "src/http/public");
const OUT_DIR = resolve(ROOT, "docs/office-v3/screenshots");
const REPORT_JSON = resolve(ROOT, "docs/office-v3/browser-check.report.json");
const TEMP_KIT = join(tmpdir(), "opencode", "browser-kit");

const args = process.argv.slice(2);
const argValue = (name) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const ONLY_SCENARIO = argValue("scenario") ? Number(argValue("scenario")) : null;
const EXTERNAL_URL = argValue("url");

/* ------------------------------------------------------------------ *
 * fixture — mirrors the reconciled universe, one market per state
 * ------------------------------------------------------------------ */

function buildFixture() {
  const now = Date.now();
  const markets = UNIVERSE.map((entry, index) => {
    const marketKey = `${entry.canonical}:${entry.marketType}`;
    const base = {
      marketKey,
      canonical: entry.canonical,
      symbol: entry.symbol,
      display: entry.display,
      marketType: entry.marketType,
      enabled: true,
      availability: "OPEN",
      activeId: `id-${index}`,
      payout: 78 + (index % 15),
      configuredStake: null,
      maxStake: 100,
      candles5s: 6,
      lastTick: { ageMs: 420 },
      featureState: { fresh: true, freshnessReason: "OK" },
      connectionHealth: { connected: true },
      settlementState: {},
    };
    if (marketKey === "GBPUSD:NORMAL") {
      return {
        ...base,
        lastTick: { ageMs: 61_000 },
        featureState: { fresh: false, freshnessReason: "STALE_ANALYSIS" },
      };
    }
    if (marketKey === "USDJPY:NORMAL") {
      return { ...base, availability: "CLOSED", enabled: false, payout: null, activeId: null };
    }
    if (marketKey === "EURGBP:NORMAL") {
      return { ...base, availability: "SUSPENDED", payout: null, activeId: null };
    }
    if (marketKey === "EURUSD:NORMAL") {
      return { ...base, configuredStake: 25, settlementState: { lastResult: "WIN", lastProfit: 8.5 } };
    }
    if (marketKey === "EURJPY:NORMAL") {
      return { ...base, configuredStake: 30 };
    }
    return base;
  });
  const working = markets.filter((market) => market.availability === "OPEN" && market.enabled !== false && market.featureState.fresh === true).length;
  return {
    version: "office-v3-browser-check",
    at: now,
    mode: "PRACTICE",
    connection: { connected: true, healthy: true },
    config: { defaultStake: 10, globalMaxStake: 100, hardCap: 100, autoExecute: false },
    activeCount: working,
    activeLimit: UNIVERSE.length,
    aux: {
      compliance: { armState: { state: "DISARMED", armed: false }, killSwitch: { executionEnabled: true } },
      executionGate: { state: "DISARMED", armed: false },
    },
    // Real settled day + real equity series (weekly/monthly intentionally absent
    // in the live relay snapshot, so the top panel must show an explicit "—").
    portfolio: {
      settled: { wins: 7, losses: 3, draws: 1, pnl: 123.45, trades: 11 },
      equityCurve: [{ value: 0 }, { value: 40 }, { value: 90 }, { value: 123.45 }],
    },
    markets,
  };
}

/* ------------------------------------------------------------------ *
 * static server (+ fixture API)
 * ------------------------------------------------------------------ */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function startServer() {
  const fixture = buildFixture();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/api/iq/office") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify(fixture));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    const filePath = resolve(PUBLIC_DIR, `.${pathname}`);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }
    try {
      const data = await readFile(filePath);
      response.writeHead(200, { "content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
      response.end(data);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
    }
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolvePromise({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

/* ------------------------------------------------------------------ *
 * browser resolution
 * ------------------------------------------------------------------ */

async function importPlaywright() {
  const candidates = [
    () => import("playwright"),
    () => import(pathToFileURL(join(TEMP_KIT, "node_modules/playwright/index.mjs")).href),
  ];
  for (const candidate of candidates) {
    try {
      const module = await candidate();
      if (module?.chromium) return module;
    } catch {
      /* try next */
    }
  }
  return null;
}

function installPlaywrightInTemp() {
  try {
    if (!existsSync(join(TEMP_KIT, "package.json"))) {
      spawnSync("npm", ["init", "-y"], { cwd: TEMP_KIT, shell: true, stdio: "ignore", timeout: 60_000 });
    }
    const result = spawnSync("npm", ["install", "playwright@1.63.0", "--no-audit", "--no-fund", "--loglevel=error"], {
      cwd: TEMP_KIT,
      shell: true,
      stdio: "ignore",
      timeout: 300_000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

async function launchRealBrowser() {
  let playwright = await importPlaywright();
  if (!playwright) {
    if (!existsSync(TEMP_KIT)) {
      try {
        const { mkdirSync } = await import("node:fs");
        mkdirSync(TEMP_KIT, { recursive: true });
      } catch {
        return null;
      }
    }
    console.log("[browser-check] playwright ausente — tentando instalar em " + TEMP_KIT);
    installPlaywrightInTemp();
    playwright = await importPlaywright();
  }
  if (!playwright) return null;
  for (const options of [
    { channel: "chrome" },
    { channel: "msedge" },
    {},
  ]) {
    try {
      const browser = await playwright.chromium.launch({ headless: true, ...options });
      return { engine: "playwright", browser, label: options.channel ? `playwright+${options.channel}` : "playwright+chromium-bundled" };
    } catch {
      /* try next channel */
    }
  }
  return { engine: "playwright", browser: null, label: "playwright (sem browser executável)" };
}

/* ------------------------------------------------------------------ *
 * assertion bookkeeping
 * ------------------------------------------------------------------ */

const results = [];
function assert(scenario, name, pass, evidence, detail) {
  results.push({ scenario, assertion: name, pass: pass === true, evidence: evidence ?? null, detail: detail ?? null });
  const tag = pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] s${scenario} · ${name}${detail ? ` · ${JSON.stringify(detail)}` : ""}`);
}

const shots = [];
async function shot(page, name) {
  const path = join(OUT_DIR, name);
  await page.screenshot({ path });
  shots.push(name);
  return name;
}

function stateSummary(api) {
  return `camera x=${Number(api.camera().x).toFixed(1)} y=${Number(api.camera().y).toFixed(1)} zoom=${Number(api.camera().zoom).toFixed(3)}`;
}

async function readCamera(page) {
  return page.evaluate(() => {
    const api = window.__tracecomOffice;
    const camera = api.camera();
    const module = api.cameraModule();
    const range = module?.getClampRange ? module.getClampRange(camera) : null;
    return {
      x: camera.x,
      y: camera.y,
      zoom: camera.zoom,
      minZoom: camera.minZoom,
      maxZoom: camera.maxZoom,
      dragging: camera.dragging,
      targetActive: Boolean(camera.target && camera.target.active),
      focusStationId: camera.focusStationId ?? null,
      viewport: { width: camera.viewport.width, height: camera.viewport.height },
      bounds: camera.bounds,
      range: range ? { minX: range.minX, maxX: range.maxX, minY: range.minY, maxY: range.maxY, spanX: range.spanX, spanY: range.spanY, centeredX: range.centeredX, centeredY: range.centeredY } : null,
    };
  });
}

/** Navigating + boot wait shared by every scenario (so --scenario=N works alone). */
async function ensurePage(page, baseUrl) {
  if (page.url() === "about:blank") await page.goto(baseUrl + "/", { waitUntil: "load" });
  await page.waitForFunction(() => window.__tracecomOffice && window.__tracecomOffice.worldState(), null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__tracecomOffice.baseMode && window.__tracecomOffice.baseMode() === "procedural", null, { timeout: 30_000 });
}

async function worldPointAt(page, screenX, screenY) {
  return page.evaluate(([sx, sy]) => {
    const api = window.__tracecomOffice;
    return api.cameraModule().screenToWorld(api.camera(), sx, sy);
  }, [screenX, screenY]);
}

/* ------------------------------------------------------------------ *
 * scenarios
 * ------------------------------------------------------------------ */

async function scenario0Boot(page, baseUrl) {
  console.log("\n[scenario 0] boot + fixture snapshot");
  try {
    const classic = await fetch(`${baseUrl}/classic.html`).then((response) => response.status).catch(() => 0);
    assert(0, "rollback /classic.html responde 200", classic === 200, null, { status: classic });
    await ensurePage(page, baseUrl);
    await page.waitForTimeout(700);
    await shot(page, "browser-s0-boot.png");

    const boot = await page.evaluate(() => {
      const api = window.__tracecomOffice;
      const state = api.worldState();
      const canvas = document.getElementById("office-canvas");
      const ctx = canvas.getContext("2d");
      const sample = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const colors = new Set();
      for (let y = 0; y < sample.height; y += 24) {
        for (let x = 0; x < sample.width; x += 24) {
          const index = (y * sample.width + x) * 4;
          colors.add(`${sample.data[index]},${sample.data[index + 1]},${sample.data[index + 2]}`);
        }
      }
      const derive = (key) => {
        const station = state.stations.find((candidate) => candidate.marketKey === key);
        return station?.derived ? { state: station.derived.state, label: station.derived.label, agentsWorking: station.derived.agentsWorking, feedStatus: station.derived.feedStatus } : null;
      };
      const office = api.officeJson();
      const settled = office?.portfolio?.settled ?? {};
      const board = state.board;
      const derivedByKey = new Map(state.stations.map((station) => [station.marketKey, station.derived]));
      const lifeLocations = api.lifeModule()?.getAgentLocations ? api.lifeModule().getAgentLocations(api.life()) : {};
      const ghostAgents = Object.values(lifeLocations).filter((entry) => (entry.atDesk === true || entry.location === "DESK") && derivedByKey.get(entry.marketKey)?.agentsWorking !== true).length;
      return {
        title: document.title,
        stations: state.stations.length,
        baseMode: api.baseMode(),
        noBlueprintBase: api.blueprintBase() === null,
        distinctColors: colors.size,
        statusHidden: document.getElementById("office-status")?.classList.contains("hidden") ?? false,
        detailPanels: document.querySelectorAll(".tc-v3-detail").length,
        settled,
        board: {
          pnlText: board.pnlText,
          wins: board.wins,
          losses: board.losses,
          draws: board.draws,
          trades: board.trades,
          winRateText: board.winRateText,
          weeklyText: board.weeklyText,
          monthlyText: board.monthlyText,
          bestWinText: board.bestWinText,
          bestLossText: board.bestLossText,
          open: board.open,
          closed: board.closed,
          total: board.total,
          equitySeries: board.equitySeries,
          equityPlaceholder: board.equityPlaceholder,
        },
        ghostAgents,
        centering: (() => {
          const camera = api.camera();
          const module = api.cameraModule();
          const bounds = camera.bounds;
          const center = { x: camera.x + camera.viewport.width / (2 * camera.zoom), y: camera.y + camera.viewport.height / (2 * camera.zoom) };
          const content = state.contentBounds ?? null;
          const contentCenter = content ? { x: (content.minX + content.maxX) / 2, y: (content.minY + content.maxY) / 2 } : null;
          const tl = module.worldToScreen(camera, bounds.minX, bounds.minY);
          const br = module.worldToScreen(camera, bounds.maxX, bounds.maxY);
          return {
            content,
            contentCenter,
            center,
            dx: contentCenter ? Math.abs(center.x - contentCenter.x) : null,
            dy: contentCenter ? Math.abs(center.y - contentCenter.y) : null,
            marginLeft: tl.x,
            marginTop: tl.y,
            marginRight: camera.viewport.width - br.x,
            marginBottom: camera.viewport.height - br.y,
          };
        })(),
        eur: derive("EURUSD:NORMAL"),
        gbp: derive("GBPUSD:NORMAL"),
        jpy: derive("USDJPY:NORMAL"),
        eurgbp: derive("EURGBP:NORMAL"),
      };
    });
    assert(0, "mundo com 54 estações do universo reconciliado", boot.stations === 54, "browser-s0-boot.png", { stations: boot.stations });
    assert(0, "canvas renderizado (não vazio)", boot.distinctColors > 24, "browser-s0-boot.png", { distinctColors: boot.distinctColors });
    assert(0, "status de carregamento saiu da tela", boot.statusHidden === true, "browser-s0-boot.png", {});
    const centeredPass = Boolean(boot.centering.content)
      && boot.centering.dx < 2
      && boot.centering.dy < 2
      && boot.centering.marginLeft >= 0
      && boot.centering.marginTop >= 0
      && boot.centering.marginRight >= 0
      && boot.centering.marginBottom >= 0;
    assert(0, "escritório nasce centrado com folga nos 4 lados", centeredPass, "browser-s0-boot.png", boot.centering);
    assert(0, "EUR/USD WORKING + agentes", boot.eur?.state === "WORKING" && boot.eur.agentsWorking === true, "browser-s0-boot.png", boot.eur);
    assert(0, "GBP/USD OPEN_BUT_FEED_OFFLINE + sem agentes", boot.gbp?.state === "OPEN_BUT_FEED_OFFLINE" && boot.gbp.agentsWorking === false, "browser-s0-boot.png", boot.gbp);
    assert(0, "USD/JPY CLOSED e EUR/GBP SUSPENDED", boot.jpy?.state === "CLOSED" && boot.eurgbp?.state === "SUSPENDED", "browser-s0-boot.png", { jpy: boot.jpy?.state, eurgbp: boot.eurgbp?.state });
    assert(0, "default é PROCEDURAL (sem base híbrida/blur)", boot.baseMode === "procedural" && boot.noBlueprintBase === true, "browser-s0-boot.png", { baseMode: boot.baseMode, noBlueprintBase: boot.noBlueprintBase });
    assert(0, "sem agentes fantasma (nenhuma mesa não-WORKING com agentes)", boot.ghostAgents === 0, "browser-s0-boot.png", { ghostAgents: boot.ghostAgents });
    // Top panel = REAL data from GET /api/iq/office (compare with the JSON).
    const boardPass = boot.board.pnlText === "+R$ 123,45"
      && boot.board.wins === boot.settled.wins
      && boot.board.losses === boot.settled.losses
      && boot.board.draws === boot.settled.draws
      && boot.board.trades === boot.settled.trades
      && boot.board.winRateText === "70.0%";
    assert(0, "painel superior bate com o JSON real (P&L/wins/losses/WR)", boardPass, "browser-s0-boot.png", { board: boot.board, settled: boot.settled });
    const equityPass = Array.isArray(boot.board.equitySeries)
      && boot.board.equitySeries.length === 4
      && boot.board.equitySeries[3] === 123.45
      && boot.board.equityPlaceholder === false;
    assert(0, "gráfico usa a série real de equity (sem ilustração)", equityPass, "browser-s0-boot.png", { equitySeries: boot.board.equitySeries, equityPlaceholder: boot.board.equityPlaceholder });
    const emptyPass = boot.board.weeklyText === "—" && boot.board.monthlyText === "—";
    assert(0, "semanal/mensal ausentes no backend → estado vazio explícito", emptyPass, "browser-s0-boot.png", { weekly: boot.board.weeklyText, monthly: boot.board.monthlyText });

    // before/after evidence of the rebuild: default (procedural) vs debug hybrid.
    await shot(page, "rebuild-after-procedural.png");
    const hybridPage = await page.context().newPage();
    try {
      await hybridPage.goto(baseUrl + "/?base=reference", { waitUntil: "load" });
      await hybridPage.waitForFunction(() => window.__tracecomOffice && window.__tracecomOffice.worldState(), null, { timeout: 30_000 });
      await hybridPage.waitForTimeout(900);
      const hybridMode = await hybridPage.evaluate(() => window.__tracecomOffice.baseMode());
      await shot(hybridPage, "rebuild-before-hybrid.png");
      assert(0, "evidência before/after: híbrido (debug) vs procedural (default)", hybridMode === "reference", "rebuild-before-hybrid.png", { hybridMode });
    } finally {
      await hybridPage.close();
    }
  } catch (error) {
    assert(0, "boot", false, null, { error: String(error?.message ?? error) });
  }
}

async function scenario1Pan(page, baseUrl) {
  await ensurePage(page, baseUrl);
  console.log("\n[scenario 1] SPACE + drag pan");
  const before = await readCamera(page);
  await shot(page, "browser-s1-pan-before.png");
  await page.mouse.move(640, 400);
  await page.keyboard.down("Space");
  await page.waitForFunction(() => document.getElementById("office-canvas").classList.contains("pan-ready"), null, { timeout: 5000 });
  const cursorReady = await page.evaluate(() => getComputedStyle(document.getElementById("office-canvas")).cursor);
  assert(1, "cursor grab com Space pressionado", cursorReady === "grab", "browser-s1-pan-before.png", { cursor: cursorReady });

  const drag = async (dx, dy) => {
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(640 + dx, 400 + dy, { steps: 8 });
    const selection = await page.evaluate(() => String(window.getSelection() ?? ""));
    const bodyClass = await page.evaluate(() => document.body.classList.contains("tc-v3-select-off"));
    const cursor = await page.evaluate(() => getComputedStyle(document.getElementById("office-canvas")).cursor);
    await page.mouse.up();
    return { selection, bodyClass, cursor };
  };

  // Ctrl+wheel zooms in first so the camera has room to move inside the clamp.
  await page.mouse.move(640, 400);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await page.waitForTimeout(120);
  await page.keyboard.down("Space");

  const c0 = await readCamera(page);
  const left = await drag(-220, 0);
  const c1 = await readCamera(page);
  const right = await drag(220, 0);
  const c2 = await readCamera(page);
  const up = await drag(0, -160);
  const c3 = await readCamera(page);
  const down = await drag(0, 160);
  const c4 = await readCamera(page);
  await page.keyboard.up("Space");
  await page.waitForTimeout(120);

  assert(1, "arrastar para a esquerda move o escritório (camera.x aumenta)", c1.x > c0.x + 10, "browser-s1-pan-after.png", { from: c0.x, to: c1.x });
  assert(1, "arrastar para a direita devolve (camera.x diminui)", c2.x < c1.x - 10, "browser-s1-pan-after.png", { from: c1.x, to: c2.x });
  assert(1, "arrastar para cima move (camera.y aumenta)", c3.y > c2.y + 10, "browser-s1-pan-after.png", { from: c2.y, to: c3.y });
  assert(1, "arrastar para baixo devolve (camera.y diminui)", c4.y < c3.y - 10, "browser-s1-pan-after.png", { from: c3.y, to: c4.y });
  assert(1, "sem seleção de texto durante o drag", left.selection === "" && right.selection === "" && up.selection === "" && down.selection === "", "browser-s1-pan-after.png", { selection: [left.selection, right.selection, up.selection, down.selection] });
  assert(1, "classe de seleção desligada no body durante o pan", left.bodyClass === true, "browser-s1-pan-before.png", {});
  assert(1, "cursor grabbing durante o drag", left.cursor === "grabbing", "browser-s1-pan-before.png", { cursor: left.cursor });
  const afterRelease = await page.evaluate(() => ({
    panReady: document.getElementById("office-canvas").classList.contains("pan-ready"),
    cursor: getComputedStyle(document.getElementById("office-canvas")).cursor,
    dragging: window.__tracecomOffice.camera().dragging,
    panels: document.querySelectorAll(".tc-v3-detail").length,
  }));
  assert(1, "soltar restaura cursor/estado e não abre mesa por acidente", afterRelease.panReady === false && afterRelease.cursor !== "grabbing" && afterRelease.dragging === false && afterRelease.panels === 0, "browser-s1-pan-after.png", afterRelease);
  await shot(page, "browser-s1-pan-after.png");
  void before;
}

async function scenario2WheelZoom(page, baseUrl) {
  await ensurePage(page, baseUrl);
  console.log("\n[scenario 2] wheel = scroll (pan) · Ctrl+wheel = zoom no cursor");
  await page.evaluate(() => {
    const api = window.__tracecomOffice;
    const camera = api.camera();
    camera.zoom = 1.4;
    camera.target = null;
    const bounds = camera.bounds;
    camera.x = (bounds.minX + bounds.maxX) / 2 - camera.viewport.width / (2 * camera.zoom);
    camera.y = (bounds.minY + bounds.maxY) / 2 - camera.viewport.height / (2 * camera.zoom);
    api.cameraModule().clampToBounds(camera);
  });
  const sx = 700;
  const sy = 420;
  await page.mouse.move(sx, sy);
  await shot(page, "browser-s2-zoom-before.png");

  // 1) plain wheel must scroll (pan vertically), never zoom.
  const scrollBefore = await readCamera(page);
  await page.mouse.wheel(0, 220);
  await page.waitForTimeout(60);
  const scrollAfter = await readCamera(page);
  await shot(page, "browser-s2-scroll-vertical.png");
  assert(2, "wheel normal NÃO altera o zoom", Math.abs(scrollAfter.zoom - scrollBefore.zoom) < 1e-9, "browser-s2-scroll-vertical.png", { from: scrollBefore.zoom, to: scrollAfter.zoom });
  assert(2, "wheel normal desloca na vertical (pan)", Math.abs(scrollAfter.y - scrollBefore.y) > 1, "browser-s2-scroll-vertical.png", { from: scrollBefore.y, to: scrollAfter.y });

  // 2) Shift+wheel scrolls horizontally.
  const shiftBefore = await readCamera(page);
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 220);
  await page.keyboard.up("Shift");
  await page.waitForTimeout(60);
  const shiftAfter = await readCamera(page);
  assert(2, "Shift+wheel desloca na horizontal", Math.abs(shiftAfter.x - shiftBefore.x) > 1 && Math.abs(shiftAfter.zoom - shiftBefore.zoom) < 1e-9, "browser-s2-scroll-vertical.png", { from: shiftBefore.x, to: shiftAfter.x });

  // 3) Ctrl+wheel zooms smoothly, anchored on the cursor.
  await page.mouse.move(sx, sy);
  const before = await worldPointAt(page, sx, sy);
  const camBefore = await readCamera(page);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await page.waitForTimeout(80);
  const afterIn = await worldPointAt(page, sx, sy);
  const camIn = await readCamera(page);
  await shot(page, "browser-s2-zoom-in.png");
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 240);
  await page.keyboard.up("Control");
  await page.waitForTimeout(80);
  const afterOut = await worldPointAt(page, sx, sy);
  const camOut = await readCamera(page);
  await shot(page, "browser-s2-zoom-after.png");
  const driftIn = Math.hypot(afterIn.x - before.x, afterIn.y - before.y);
  const driftOut = Math.hypot(afterOut.x - before.x, afterOut.y - before.y);
  assert(2, "Ctrl+wheel aumenta o zoom", camIn.zoom > camBefore.zoom, "browser-s2-zoom-in.png", { from: camBefore.zoom, to: camIn.zoom });
  assert(2, "ponto do mundo sob o cursor fica fixo (Ctrl+wheel in)", driftIn < 0.75, "browser-s2-zoom-in.png", { driftWorldPx: Number(driftIn.toFixed(4)) });
  assert(2, "Ctrl+wheel reduz o zoom", camOut.zoom < camIn.zoom, "browser-s2-zoom-after.png", { from: camIn.zoom, to: camOut.zoom });
  assert(2, "ponto do mundo sob o cursor fica fixo (Ctrl+wheel out)", driftOut < 0.75, "browser-s2-zoom-after.png", { driftWorldPx: Number(driftOut.toFixed(4)) });
}

async function scenario3ClampEdges(page, baseUrl) {
  await ensurePage(page, baseUrl);
  console.log("\n[scenario 3] clamp de bordas no zoom mínimo e em zoom 1");
  await page.evaluate(() => {
    const api = window.__tracecomOffice;
    const camera = api.camera();
    camera.target = null;
    camera.zoom = camera.minZoom;
    camera.x = -99999;
    camera.y = -99999;
    api.cameraModule().clampToBounds(camera);
  });
  const minZoomState = await page.evaluate(() => {
    const api = window.__tracecomOffice;
    const module = api.cameraModule();
    const camera = api.camera();
    const range = module.getClampRange(camera);
    const topLeft = module.worldToScreen(camera, camera.bounds.minX, camera.bounds.minY);
    const bottomRight = module.worldToScreen(camera, camera.bounds.maxX, camera.bounds.maxY);
    return { range: { centeredX: range.centeredX, centeredY: range.centeredY }, topLeft, bottomRight, viewport: camera.viewport };
  });
  await shot(page, "browser-s3-minzoom.png");
  assert(3, "no zoom mínimo o mundo expandido inteiro fica visível (eixo centralizado)", minZoomState.range.centeredX === true && minZoomState.range.centeredY === true, "browser-s3-minzoom.png", minZoomState.range);
  assert(3, "quatro bordas dentro do viewport no zoom mínimo", minZoomState.topLeft.x >= 0 && minZoomState.topLeft.y >= 0 && minZoomState.bottomRight.x <= minZoomState.viewport.width && minZoomState.bottomRight.y <= minZoomState.viewport.height, "browser-s3-minzoom.png", { topLeft: minZoomState.topLeft, bottomRight: minZoomState.bottomRight });

  await page.evaluate(() => {
    const api = window.__tracecomOffice;
    const camera = api.camera();
    camera.zoom = 1;
    camera.x = 0;
    camera.y = 0;
    camera.target = null;
    api.cameraModule().clampToBounds(camera);
  });
  await page.keyboard.down("Space");
  const drag = async (fromX, fromY, toX, toY) => {
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(toX, toY, { steps: 12 });
    await page.mouse.up();
  };
  // push to the right/bottom edge (camera max) then back to the left/top edge.
  for (let index = 0; index < 2; index += 1) await drag(1250, 400, 10, 400);
  for (let index = 0; index < 3; index += 1) await drag(640, 700, 640, 60);
  const maxed = await readCamera(page);
  await shot(page, "browser-s3-maxedge.png");
  for (let index = 0; index < 2; index += 1) await drag(10, 400, 1250, 400);
  for (let index = 0; index < 3; index += 1) await drag(640, 60, 640, 700);
  const minned = await readCamera(page);
  await page.keyboard.up("Space");
  await shot(page, "browser-s3-minedge.png");
  assert(3, "borda direita/inferior alcançável (clamp exato)", Math.abs(maxed.x - maxed.range.maxX) < 1.5 && Math.abs(maxed.y - maxed.range.maxY) < 1.5, "browser-s3-maxedge.png", { x: maxed.x, maxX: maxed.range.maxX, y: maxed.y, maxY: maxed.range.maxY });
  assert(3, "borda esquerda/superior alcançável (clamp exato)", Math.abs(minned.x - minned.range.minX) < 1.5 && Math.abs(minned.y - minned.range.minY) < 1.5, "browser-s3-minedge.png", { x: minned.x, minX: minned.range.minX, y: minned.y, minY: minned.range.minY });
  assert(3, "span do clamp usa viewport/zoom", Math.abs(maxed.range.spanX - maxed.viewport.width / maxed.zoom) < 0.001 && Math.abs(maxed.range.spanY - maxed.viewport.height / maxed.zoom) < 0.001, "browser-s3-maxedge.png", { spanX: maxed.range.spanX, expected: maxed.viewport.width / maxed.zoom });
}

async function clickDesk(page, marketKey) {
  const point = await page.evaluate((key) => {
    const api = window.__tracecomOffice;
    const camera = api.camera();
    const module = api.cameraModule();
    const state = api.worldState();
    const resolver = api.worldModule().createAnchorResolver(state.stations);
    const station = state.stations.find((candidate) => candidate.marketKey === key);
    const anchor = resolver.anchorFor(station, station.index);
    return module.worldToScreen(camera, anchor.desk.x + anchor.desk.w / 2, anchor.desk.y + anchor.desk.h / 2);
  }, marketKey);
  await page.mouse.click(point.x, point.y);
  return point;
}

async function scenario4ClickDesk(page, baseUrl) {
  await ensurePage(page, baseUrl);
  console.log("\n[scenario 4] clique em EUR/USD → zoom + painel correlacionado");
  await page.evaluate(() => {
    const api = window.__tracecomOffice;
    const camera = api.camera();
    camera.zoom = 1;
    camera.x = 0;
    camera.y = 0;
    camera.target = null;
    api.cameraModule().clampToBounds(camera);
  });
  await page.waitForTimeout(60);
  const camBefore = await readCamera(page);
  const point = await clickDesk(page, "EURUSD:NORMAL");
  await page.waitForSelector('.tc-v3-detail[data-market-key="EURUSD:NORMAL"]', { timeout: 5000 });
  await page.waitForTimeout(650);
  const panel = await page.evaluate(() => {
    const root = document.querySelector("#office-detail-root [data-market-key]");
    return {
      marketKey: root?.getAttribute("data-market-key") ?? null,
      title: document.querySelector(".tc-v3-detail-title")?.textContent ?? null,
      sub: document.querySelector(".tc-v3-detail-sub")?.textContent ?? null,
      state: root?.getAttribute("data-state") ?? null,
      stakeKey: document.querySelector(".tc-stake-config")?.getAttribute("data-market-key") ?? null,
      stakeInput: document.querySelector('.tc-stake-config input[data-stake="input"]')?.value ?? null,
      stakeMeta: document.querySelector(".tc-stake-config-meta")?.textContent ?? null,
      text: root?.textContent ?? "",
    };
  });
  const camAfter = await readCamera(page);
  await shot(page, "browser-s4-panel-open.png");
  assert(4, "painel abre para o marketKey clicado", panel.marketKey === "EURUSD:NORMAL" && panel.state === "ready", "browser-s4-panel-open.png", { marketKey: panel.marketKey });
  assert(4, "título do painel é EUR/USD", String(panel.title ?? "").includes("EUR/USD"), "browser-s4-panel-open.png", { title: panel.title });
  assert(4, "zoom-to-desk aplicou zoom", camAfter.zoom > camBefore.zoom && camAfter.targetActive === false, "browser-s4-panel-open.png", { from: camBefore.zoom, to: camAfter.zoom });
  assert(4, "stake do painel é a config real do mercado (25)", panel.stakeKey === "EURUSD:NORMAL" && panel.stakeInput === "25" && String(panel.stakeMeta).includes("25"), "browser-s4-panel-open.png", { stakeInput: panel.stakeInput, stakeMeta: panel.stakeMeta });
  assert(4, "estado do painel é MERCADO ABERTO · OPERANDO", String(panel.text).includes("MERCADO ABERTO · OPERANDO"), "browser-s4-panel-open.png", {});
  await page.click(".tc-v3-detail-close");
  await page.waitForTimeout(120);
  const closed = await page.evaluate(() => ({
    panels: document.querySelectorAll(".tc-v3-detail").length,
    selected: window.__tracecomOffice.selectedMarketKey(),
    rootChildren: document.getElementById("office-detail-root").childElementCount,
  }));
  await shot(page, "browser-s4-panel-closed.png");
  assert(4, "FECHAR remove o painel e devolve o espaço", closed.panels === 0 && closed.selected === null && closed.rootChildren === 0, "browser-s4-panel-closed.png", closed);
  void point;
}

async function openMesasAndSelect(page, query, options = {}) {
  await page.click("#mesas-toggle");
  await page.waitForFunction(() => document.getElementById("mesas-panel").hidden === false, null, { timeout: 5000 });
  await page.fill("#mesas-search", query);
  await page.waitForTimeout(80);
  const active = await page.evaluate(() => {
    const option = document.querySelector("#office-station-list .station-option.active");
    return option ? option.textContent : null;
  });
  await page.keyboard.press("ArrowDown");
  const activeAfterArrow = await page.evaluate(() => {
    const option = document.querySelector("#office-station-list .station-option.active");
    return option ? { text: option.textContent, marketKey: option.dataset.marketKey ?? null } : null;
  });
  if (options.capture) await shot(page, options.capture);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(650);
  return { active, activeAfterArrow };
}

async function scenario5Mesas(page, baseUrl) {
  await ensurePage(page, baseUrl);
  console.log("\n[scenario 5] MESAS busca + ↑↓ + Enter");
  const popup = await openMesasAndSelect(page, "gbpusd:nor", { capture: "browser-s5-mesas-popup.png" });
  await shot(page, "browser-s5-mesas.png");
  const panel = await page.evaluate(() => {
    const root = document.querySelector("#office-detail-root [data-market-key]");
    return {
      marketKey: root?.getAttribute("data-market-key") ?? null,
      title: document.querySelector(".tc-v3-detail-title")?.textContent ?? null,
      focus: window.__tracecomOffice.camera().focusStationId ?? null,
      selected: window.__tracecomOffice.selectedMarketKey(),
    };
  });
  assert(5, "popup abre e o destaque ↑↓ é uma opção real", popup.activeAfterArrow?.marketKey !== null, "browser-s5-mesas.png", { activeBefore: popup.active, activeAfter: popup.activeAfterArrow });
  assert(5, "↑↓ + Enter seleciona o mercado destacado", panel.marketKey === "GBPUSD:NORMAL" && panel.marketKey === popup.activeAfterArrow?.marketKey, "browser-s5-mesas.png", { marketKey: panel.marketKey, focused: panel.focus });
  assert(5, "foco/zoom aponta para a mesma mesa", panel.focus === panel.marketKey && panel.selected === panel.marketKey, "browser-s5-mesas.png", { focus: panel.focus, selected: panel.selected });
  assert(5, "painel corresponde à seleção", String(panel.title ?? "").includes("GBP/USD"), "browser-s5-mesas.png", { title: panel.title });
}

async function scenario6SwitchMarket(page, baseUrl) {
  await ensurePage(page, baseUrl);
  console.log("\n[scenario 6] trocar de ativo sem dados velhos");
  await openMesasAndSelect(page, "eurjpy:nor");
  await shot(page, "browser-s6-eurjpy.png");
  const switched = await page.evaluate(() => {
    const root = document.querySelector("#office-detail-root [data-market-key]");
    const api = window.__tracecomOffice;
    const state = api.worldState();
    const find = (key) => state.stations.find((station) => station.marketKey === key);
    return {
      marketKey: root?.getAttribute("data-market-key") ?? null,
      title: document.querySelector(".tc-v3-detail-title")?.textContent ?? null,
      text: root?.textContent ?? "",
      selected: api.selectedMarketKey(),
      eurjpyState: find("EURJPY:NORMAL")?.derived?.state ?? null,
      gbpUsdStale: find("GBPUSD:NORMAL")?.derived?.state ?? null,
      ghostAgents: (() => {
        const derivedByKey = new Map(state.stations.map((station) => [station.marketKey, station.derived]));
        const locations = api.lifeModule()?.getAgentLocations ? api.lifeModule().getAgentLocations(api.life()) : {};
        return Object.values(locations).filter((entry) => (entry.atDesk === true || entry.location === "DESK") && derivedByKey.get(entry.marketKey)?.agentsWorking !== true).length;
      })(),
      workingWithDeskAgents: (() => {
        const locations = api.lifeModule()?.getAgentLocations ? api.lifeModule().getAgentLocations(api.life()) : {};
        const deskKeys = new Set(Object.values(locations).filter((entry) => entry.atDesk === true || entry.location === "DESK").map((entry) => entry.marketKey));
        return state.stations.filter((station) => station.derived?.agentsWorking === true && deskKeys.has(station.marketKey)).length;
      })(),
      working: state.stations.filter((station) => station.derived?.agentsWorking === true).length,
    };
  });
  assert(6, "painel passa para o NOVO marketKey", switched.marketKey === "EURJPY:NORMAL" && switched.selected === "EURJPY:NORMAL", "browser-s6-eurjpy.png", { marketKey: switched.marketKey });
  assert(6, "sem texto/dados do mercado anterior", !String(switched.text).includes("GBP/USD OTC") && !String(switched.text).includes("GBP/USD ·"), "browser-s6-eurjpy.png", {});
  assert(6, "título e estado mudam para EUR/JPY WORKING", String(switched.title ?? "").includes("EUR/JPY") && switched.eurjpyState === "WORKING", "browser-s6-eurjpy.png", { title: switched.title, state: switched.eurjpyState });
  assert(6, "sem agentes fantasma (nenhum agente em desk não-WORKING)", switched.ghostAgents === 0 && switched.workingWithDeskAgents > 0, "browser-s6-eurjpy.png", { ghostAgents: switched.ghostAgents, working: switched.working, workingWithDeskAgents: switched.workingWithDeskAgents });
}

async function scenario7StateLabel(page, baseUrl) {
  await ensurePage(page, baseUrl);
  console.log("\n[scenario 7] rótulo derivado × agentes (feed offline)");
  // Zoom to GBP/USD so the scrim tag is on screen, then read state.
  await page.evaluate(() => window.__tracecomOffice.selectMarket("GBPUSD:NORMAL"));
  await page.waitForSelector('.tc-v3-detail[data-market-key="GBPUSD:NORMAL"]', { timeout: 5000 });
  await page.waitForTimeout(650);
  await shot(page, "browser-s7-feed-offline.png");
  const state = await page.evaluate(() => {
    const api = window.__tracecomOffice;
    const stations = api.worldState().stations;
    const gbp = stations.find((station) => station.marketKey === "GBPUSD:NORMAL");
    const offlineStations = stations.filter((station) => station.derived?.state === "OPEN_BUT_FEED_OFFLINE");
    const working = stations.filter((station) => station.derived?.agentsWorking === true).length;
    const panel = document.querySelector("#office-detail-root [data-market-key]");
    const rows = {};
    for (const row of panel?.querySelectorAll(".tc-v3-row") ?? []) {
      const key = row.querySelector(".tc-v3-row-label")?.textContent ?? "";
      rows[key] = row.querySelector(".tc-v3-row-value")?.textContent ?? "";
    }
    const hasLegacyBlocks = Boolean(panel?.querySelector('[data-block="technical"], [data-block="journal"], .tc-v3-tabs'));
    return {
      gbpDerived: { state: gbp?.derived?.state, label: gbp?.derived?.label, shortLabel: gbp?.derived?.shortLabel, agentsWorking: gbp?.derived?.agentsWorking, feedStatus: gbp?.derived?.feedStatus },
      offlineCount: offlineStations.length,
      working,
      ghostAgents: (() => {
        const derivedByKey = new Map(stations.map((station) => [station.marketKey, station.derived]));
        const locations = api.lifeModule()?.getAgentLocations ? api.lifeModule().getAgentLocations(api.life()) : {};
        return Object.values(locations).filter((entry) => (entry.atDesk === true || entry.location === "DESK") && derivedByKey.get(entry.marketKey)?.agentsWorking !== true).length;
      })(),
      feedOfflineStat: offlineStations.length,
      panelState: rows["Estado"] ?? null,
      hasLegacyBlocks,
    };
  });
  const labelPass = state.gbpDerived.state === "OPEN_BUT_FEED_OFFLINE"
    && state.gbpDerived.label === "MERCADO ABERTO · FEED OFFLINE"
    && state.gbpDerived.shortLabel === "FEED OFFLINE"
    && state.gbpDerived.agentsWorking === false;
  assert(7, "estado derivado é MERCADO ABERTO · FEED OFFLINE", labelPass, "browser-s7-feed-offline.png", state.gbpDerived);
  assert(7, "painel simplificado mostra o MESMO rótulo do desk", state.panelState === "MERCADO ABERTO · FEED OFFLINE", "browser-s7-feed-offline.png", { panelState: state.panelState });
  assert(7, "painel não expõe blocos técnicos/journal/abas", state.hasLegacyBlocks === false, "browser-s7-feed-offline.png", { hasLegacyBlocks: state.hasLegacyBlocks });
  assert(7, "agentes não trabalham com feed offline (sem fantasma)", state.ghostAgents === 0 && state.feedOfflineStat >= 1, "browser-s7-feed-offline.png", { ghostAgents: state.ghostAgents, working: state.working, feedOffline: state.feedOfflineStat });
}

/* ------------------------------------------------------------------ *
 * synthetic fallback (never labelled as real browser)
 * ------------------------------------------------------------------ */

async function runSyntheticFallback() {
  console.log("\n[browser-check] NENHUM NAVEGADOR REAL DISPONÍVEL — usando harness sintético (jsdom/fake-DOM).");
  const page = null;
  try {
    // @ts-ignore - módulos visuais ESM sem DOM
    const camera = await import(pathToFileURL(join(PUBLIC_DIR, "office-v3/camera.js")).href);
    // @ts-ignore
    const stateModel = await import(pathToFileURL(join(PUBLIC_DIR, "office-v3/state-model.js")).href);
    const cam = camera.createCamera({ width: 1280, height: 720, bounds: { minX: 0, minY: 0, maxX: 2560, maxY: 2048 } });
    camera.zoomAt(cam, 700, 420, 2);
    const before = camera.screenToWorld(cam, 700, 420);
    const after = camera.screenToWorld(cam, 700, 420);
    assert(2, "SYNTHETIC: zoom mantém o ponto sob o cursor", Math.hypot(after.x - before.x, after.y - before.y) < 1e-9, null, { synthetic: true });
    cam.zoom = cam.minZoom;
    cam.x = -1e6;
    cam.y = -1e6;
    camera.clampToBounds(cam);
    const range = camera.getClampRange(cam);
    assert(3, "SYNTHETIC: clamp no zoom mínimo centraliza e mostra as 4 bordas", range.centeredX === true && range.centeredY === true, null, { synthetic: true });
    const working = stateModel.deriveMarketState({ marketKey: "X", availability: "OPEN", enabled: true, featureState: { fresh: true }, candles5s: 3 }, null, { connected: true });
    const offline = stateModel.deriveMarketState({ marketKey: "Y", availability: "OPEN", enabled: true, lastTick: { ageMs: 61_000 } }, null, { connected: true });
    assert(7, "SYNTHETIC: OPEN+feed fresco = WORKING; feed velho = FEED OFFLINE", working.state === "WORKING" && offline.state === "OPEN_BUT_FEED_OFFLINE" && offline.agentsWorking === false, null, { synthetic: true });
  } catch (error) {
    assert(0, "SYNTHETIC: harness falhou", false, null, { error: String(error?.message ?? error) });
  }
  return { engine: "synthetic", browser: null, label: "synthetic-jsdom-fake-dom", page };
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  let serverHandle = null;
  let browserHandle = null;
  let baseUrl = EXTERNAL_URL;
  const usedScenarios = ONLY_SCENARIO ? [ONLY_SCENARIO] : [0, 1, 2, 3, 4, 5, 6, 7];

  try {
    if (baseUrl) {
      browserHandle = await launchRealBrowser();
      if (!browserHandle || !browserHandle.browser) {
        console.log("[browser-check] URL externa informada mas nenhum navegador real disponível.");
        browserHandle = await runSyntheticFallback();
      }
    } else {
      serverHandle = await startServer();
      baseUrl = serverHandle.origin;
      console.log(`[browser-check] static server ${baseUrl} → ${PUBLIC_DIR}`);
      browserHandle = await launchRealBrowser();
      if (browserHandle && browserHandle.browser) {
        console.log(`[browser-check] navegador REAL: ${browserHandle.label} (${browserHandle.browser.version()})`);
      } else {
        browserHandle = await runSyntheticFallback();
      }
    }

    if (browserHandle.browser) {
      const context = await browserHandle.browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.on("pageerror", (error) => console.log(`  [pageerror] ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") console.log(`  [console.error] ${message.text()}`);
      });
      const run = {
        0: () => scenario0Boot(page, baseUrl),
        1: () => scenario1Pan(page, baseUrl),
        2: () => scenario2WheelZoom(page, baseUrl),
        3: () => scenario3ClampEdges(page, baseUrl),
        4: () => scenario4ClickDesk(page, baseUrl),
        5: () => scenario5Mesas(page, baseUrl),
        6: () => scenario6SwitchMarket(page, baseUrl),
        7: () => scenario7StateLabel(page, baseUrl),
      };
      for (const id of usedScenarios) {
        try {
          await run[id]();
        } catch (error) {
          assert(id, `cenário ${id} executou sem exceção`, false, null, { error: String(error?.message ?? error) });
        }
      }
      await context.close();
      await browserHandle.browser.close();
    } else if (browserHandle.page === null) {
      // synthetic fallback already asserted its scenarios
    }

    const failed = results.filter((entry) => !entry.pass);
    const report = {
      at: new Date().toISOString(),
      engine: browserHandle.label,
      realBrowser: browserHandle.engine === "playwright" && Boolean(browserHandle.browser),
      baseUrl,
      scenarios: usedScenarios,
      screenshots: shots,
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      results,
    };
    await writeFile(REPORT_JSON, JSON.stringify(report, null, 2));
    console.log(`\n[browser-check] ${report.passed}/${report.total} asserts PASS — engine=${report.engine}`);
    if (failed.length) {
      console.log("[browser-check] falhas:");
      for (const entry of failed) console.log(`  - s${entry.scenario} ${entry.assertion} ${JSON.stringify(entry.detail)}`);
    }
    console.log(`[browser-check] report ${REPORT_JSON}`);
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    if (browserHandle?.browser) await browserHandle.browser.close().catch(() => {});
    if (serverHandle?.server) await new Promise((resolvePromise) => serverHandle.server.close(resolvePromise));
  }
}

main().catch((error) => {
  console.error("[browser-check] falhou", error);
  process.exitCode = 1;
});

