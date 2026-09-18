/**
 * OFFICE V3 — FINAL UX + AGENT VALIDATION (T13, browser REAL).
 *
 * Static server + deterministic fixture (`/api/iq/office`, `/api/iq/events`,
 * `/api/iq/status`, `/api/iq/disconnect`) + real Chrome/Edge via Playwright.
 *
 * Validates with REAL screenshots and pixel measurements:
 *   T1 centering (content centered; margins measured in pixels from the shot)
 *   T3 global LOGS · T4 sector labels in front · T5/T6 agents + subtle motion
 *   T7 WIN/LOSS/DRAW badge (12s window) · T8/T9 simplified panel + activity
 *   T12 rapid market switching isolation
 *   T13 pan/scroll/zoom/space-drag/focus/MESAS/IQ OPTION/resize
 *
 * PRACTICE only. ZERO REAL. Sends no orders. Writes screenshots to
 * docs/office-v3/screenshots/ and a JSON report to docs/office-v3/final-ux.report.json.
 */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PUBLIC_DIR = resolve(ROOT, "src/http/public");
const OUT_DIR = resolve(ROOT, "docs/office-v3/screenshots");
const REPORT_JSON = resolve(ROOT, "docs/office-v3/final-ux.report.json");
const TEMP_KIT = join(tmpdir(), "opencode", "browser-kit");
const CANVAS_PATH = "C:/Users/junin/AppData/Local/Temp/opencode/render-kit/node_modules/@napi-rs/canvas";

let createCanvas = null;
try {
  ({ createCanvas } = require(CANVAS_PATH));
} catch {
  try {
    ({ createCanvas } = require("@napi-rs/canvas"));
  } catch {
    createCanvas = null;
  }
}

const args = process.argv.slice(2);
const argValue = (name) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const EXTERNAL_URL = argValue("url");

/* ------------------------------------------------------------------ *
 * fixture — 55 real-universe-shaped markets; deterministic states
 * ------------------------------------------------------------------ */

const UNIVERSE = [
  "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD", "EUR/GBP", "EUR/JPY", "GBP/JPY",
  "AUD/JPY", "AUD/CAD", "AUD/CHF", "CAD/JPY", "CHF/JPY", "EUR/CAD", "EUR/CHF", "EUR/AUD", "GBP/AUD", "GBP/CHF",
  "EUR/USD OTC", "GBP/USD OTC", "USD/JPY OTC", "EUR/GBP OTC", "GBP/JPY OTC", "AUD/USD OTC", "USD/CAD OTC", "USD/CHF OTC", "EUR/JPY OTC", "AUD/JPY OTC",
  "BTC/USD OTC", "ETH/USD OTC", "LTC/USD OTC", "XRP/USD OTC", "ADA/USD OTC",
  "US30", "US100", "US500", "US2000", "GER30", "UK100", "JP225", "AUS200", "EU50", "HK33",
  "GOLD", "SILVER", "WTI", "BRENT", "NATGAS", "APPLE", "TESLA", "AMAZON", "GOOGLE", "META",
];

function buildFixture() {
  const now = Date.now();
  const markets = UNIVERSE.map((display, index) => {
    const canonicalBase = display.replace(/\s*OTC$/, "").replace(/[^A-Z0-9]/g, "");
    const isOtc = display.includes("OTC");
    const marketKey = `${canonicalBase}:${isOtc ? "OTC" : "NORMAL"}`;
    const base = {
      marketKey,
      canonical: canonicalBase,
      symbol: display,
      display,
      marketType: isOtc ? "OTC" : "NORMAL",
      enabled: true,
      paused: false,
      availability: "OPEN",
      activeId: 10_000 + index,
      payout: 78 + (index % 15),
      maxStake: 100,
      configuredStake: null,
      positionState: { status: "IDLE", direction: null, stake: null },
      candles5s: 40 + (index % 11),
      lastTick: { ageMs: 200 + (index % 9) * 31, price: Number((1.05 + index * 0.013).toFixed(4)), at: now - 210 },
      featureState: { fresh: true, freshnessReason: "OK", rsi14: 40 + (index % 40), adx14: 18 + (index % 20), atr14: 0.001 },
      agents: {
        at: now - 500,
        correlationId: `corr-${index}-${now}`,
        trader: { action: index % 3 === 0 ? "BUY" : index % 3 === 1 ? "SELL" : "WAIT", confidence: 0.5 + (index % 20) / 100, regime: `REGIME_${index % 4}`, setup: `SETUP_${index % 6}`, primaryRisk: "NONE", supporting: [], contradicting: [], latencyMs: 40 + index },
        critic: { independentAction: index % 3 === 0 ? "BUY" : "WAIT", verdict: index % 5 === 0 ? "CONTEST" : "CONFIRM", contradictions: [], riskFlags: [], finalRecommendation: index % 3 === 0 ? "BUY" : "WAIT", latencyMs: 55 + index },
        consensus: { action: index % 3 === 0 ? "BUY" : "WAIT", status: index % 5 === 0 ? "CONTESTED" : "CONFIRMED", reason: `CONSENSUS_REASON_${index}`, rules: [], confidence: 0.5 + (index % 20) / 100, latencyMs: 60 + index },
      },
      decisionState: { action: index % 3 === 0 ? "BUY" : "WAIT", reason: index % 3 === 0 ? "CONSENSUS_CONFIRMED" : `WAIT_${index % 3}`, confidence: 0.5 + (index % 20) / 100, setup: `SETUP_${index % 6}`, regime: `REGIME_${index % 4}`, trigger: `TRIGGER_${index % 4}`, waitReason: index % 3 === 0 ? null : "LOW_EDGE", qualityScore: null },
      entryTiming: null,
      settlementState: {},
    };
    if (marketKey === "EURUSD:NORMAL") {
      base.configuredStake = 25;
      base.settlementState = { lastResult: "WIN", lastProfit: 8.5, lastAt: now - 1200, daily: { wins: 4, losses: 1, draws: 0, settledPnl: 21.5, trades: 5 } };
      base.entryTiming = { candidateId: `cand-eurusd-${now}`, action: "BUY", status: "CONFIRMED", stage: "REVALIDANDO", secondsToRevalidation: 2, secondsToEntry: 4, candidateChangedBeforeEntry: false };
    } else if (marketKey === "GBPJPY:OTC") {
      base.settlementState = { lastResult: "LOSS", lastProfit: -4.2, lastAt: now - 1500, daily: { wins: 1, losses: 3, draws: 0, settledPnl: -9.6, trades: 4 } };
    } else if (marketKey === "GOLD:NORMAL") {
      base.settlementState = { lastResult: "DRAW", lastProfit: 0, lastAt: now - 1800, daily: { wins: 0, losses: 0, draws: 2, settledPnl: 0, trades: 2 } };
    } else if (marketKey === "USDJPY:NORMAL") {
      base.settlementState = { lastResult: "WIN", lastProfit: 3.1, lastAt: now - 30_000, daily: { wins: 2, losses: 0, draws: 0, settledPnl: 6.2, trades: 2 } };
    } else if (marketKey === "GBPUSD:NORMAL") {
      base.lastTick = { ageMs: 61_000, price: 1.27, at: now - 61_000 };
      base.featureState = { fresh: false, freshnessReason: "STALE_ANALYSIS" };
    } else if (marketKey === "AUDCAD:NORMAL") {
      base.availability = "CLOSED";
      base.enabled = false;
      base.activeId = null;
      base.payout = null;
    }
    return base;
  });
  const working = markets.filter((market) => market.availability === "OPEN" && market.enabled !== false && market.featureState.fresh === true).length;
  return {
    version: "office-v3-final-check",
    at: now,
    mode: "PRACTICE",
    connection: { connected: true, healthy: true, host: "iqoption.com", reconnects: 2 },
    config: { defaultStake: 10, globalMaxStake: 100, hardCap: 100, autoExecute: false, brainGeneration: 2, jitEnabled: true, entryLeadMs: 1500, qualityGateEnabled: true, minTradeQualityScore: 0.55 },
    activeCount: working,
    activeLimit: UNIVERSE.length,
    aux: {
      compliance: {
        armState: { state: "DISARMED", armed: false },
        killSwitch: { executionEnabled: true },
        realMode: { realModeEnabled: false },
      },
      executionGate: { state: "DISARMED", armed: false, pendingOrders: 0 },
    },
    portfolio: {
      settled: { wins: 7, losses: 3, draws: 2, pnl: 123.45, trades: 12 },
      equityCurve: [{ value: 0 }, { value: 40 }, { value: 90 }, { value: 123.45 }],
    },
    legacy: {
      account: { verified: true, type: "PRACTICE", currency: "BRL", balance: 10_000.5, hasReal: false, checkedAt: now },
      marketData: { connected: true, healthy: true, host: "iqoption.com" },
    },
    markets,
  };
}

/* ------------------------------------------------------------------ *
 * static server + fixture API (incl. incremental real event stream)
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
  let eventSeq = 120;
  let pollCount = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const json = (payload, status = 200) => {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify(payload));
    };
    if (url.pathname === "/api/iq/office") return json(fixture);
    if (url.pathname === "/api/iq/events") {
      const after = Number(url.searchParams.get("after")) || 0;
      const limit = Number(url.searchParams.get("limit")) || 100;
      if (after === 0 && limit === 1) return json({ events: [], cursor: eventSeq, markets: fixture.markets.map((market) => market.marketKey) });
      pollCount += 1;
      const types = [
        { type: "agent.trader", marketKey: "EURUSD:NORMAL", action: "BUY", confidence: 0.62 },
        { type: "agent.critic", marketKey: "EURUSD:NORMAL", verdict: "CONFIRM" },
        { type: "agent.consensus", marketKey: "EURUSD:NORMAL", status: "CONFIRMED", action: "BUY" },
        { type: "market.decision", marketKey: "EURUSD:NORMAL", action: "BUY", reason: "CONSENSUS_CONFIRMED", setup: "TREND_PULLBACK", regime: "TREND_UP" },
        { type: "market.feature", marketKey: "GBPJPY:OTC", rsi14: 55.2, fresh: true },
        { type: "agent.trader", marketKey: "GOLD:NORMAL", action: "WAIT", confidence: 0.51 },
        { type: "market.wait", marketKey: "USDJPY:NORMAL", reason: "LOW_EDGE", setup: "RANGE_FADE", consensus: "CONTESTED" },
        { type: "candidate.confirmed", marketKey: "EURUSD:NORMAL", action: "BUY", secondsToEntry: 4 },
        { type: "position.settled", marketKey: "EURUSD:NORMAL", result: "WIN", profit: 8.5 },
      ];
      const events = [];
      const count = 2 + (pollCount % 2);
      for (let index = 0; index < count; index += 1) {
        const template = types[(pollCount + index) % types.length];
        eventSeq += 1;
        events.push({ ...template, seq: eventSeq, at: Date.now() });
      }
      return json({ events: events.filter((event) => event.seq > after), cursor: eventSeq, markets: fixture.markets.map((market) => market.marketKey) });
    }
    if (url.pathname === "/api/iq/status") {
      return json({
        state: "CONNECTED_READ_ONLY",
        email: "t***@tracecom.test",
        twoFactorRequired: false,
        hasSession: true,
        practiceOnly: true,
        mode: "PRACTICE",
        account: { verified: true, type: "PRACTICE", currency: "BRL", balance: 10_000.5, hasReal: false },
        marketData: { connected: true, healthy: true, host: "iqoption.com" },
      });
    }
    if (url.pathname === "/api/iq/disconnect") {
      eventSeq += 1;
      return json({ state: "DISCONNECTED", hasSession: false, disconnected: true });
    }
    if (url.pathname === "/api/iq/connect" || url.pathname === "/api/iq/verify-2fa") return json({ error: "credentials_server_side_only" }, 400);
    if (url.pathname.startsWith("/api/")) return json({ ok: true, practiceOnly: true });
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    if (pathname.startsWith("/classic")) pathname = "/classic.html";
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
 * browser + assertion helpers
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
      /* next */
    }
  }
  return null;
}

async function launchRealBrowser() {
  let playwright = await importPlaywright();
  if (!playwright) {
    if (!existsSync(TEMP_KIT)) return null;
    spawnSync("npm", ["install", "playwright@1.63.0", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: TEMP_KIT, shell: true, stdio: "ignore", timeout: 300_000 });
    playwright = await importPlaywright();
  }
  if (!playwright) return null;
  for (const options of [{ channel: "chrome" }, { channel: "msedge" }, {}]) {
    try {
      const browser = await playwright.chromium.launch({ headless: true, ...options });
      return { engine: "playwright", browser, label: options.channel ? `playwright+${options.channel}` : "playwright+chromium-bundled" };
    } catch {
      /* next channel */
    }
  }
  return null;
}

const results = [];
function assert(scenario, name, pass, evidence, detail) {
  results.push({ scenario, assertion: name, pass: pass === true, evidence: evidence ?? null, detail: detail ?? null });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${scenario} · ${name}${detail ? ` · ${JSON.stringify(detail)}` : ""}`);
}

const shots = [];
async function shot(page, name) {
  await page.screenshot({ path: join(OUT_DIR, name) });
  shots.push(name);
  return name;
}

/** Pixel probe: returns {r,g,b} at viewport coords from the last screenshot buffer. */
async function loadScreenshot(buffer) {
  if (!createCanvas) return null;
  const mod = require(CANVAS_PATH);
  const img = await mod.loadImage(buffer);
  const canvas = mod.createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  return {
    width: img.width,
    height: img.height,
    at(x, y) {
      const px = Math.max(0, Math.min(img.width - 1, Math.round(x)));
      const py = Math.max(0, Math.min(img.height - 1, Math.round(y)));
      const index = (py * img.width + px) * 4;
      return { r: data[index], g: data[index + 1], b: data[index + 2], a: data[index + 3] };
    },
  };
}

function pixelsFrom(buffer) {
  return loadScreenshot(buffer);
}

function colorDistance(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/** Pixels changed between two PNG buffers (same dimensions). */
async function diffPixels(bufferA, bufferB) {
  if (!createCanvas) return null;
  const mod = require(CANVAS_PATH);
  const imageA = await mod.loadImage(bufferA);
  const imageB = await mod.loadImage(bufferB);
  const canvasA = mod.createCanvas(imageA.width, imageA.height);
  const canvasB = mod.createCanvas(imageB.width, imageB.height);
  canvasA.getContext("2d").drawImage(imageA, 0, 0);
  canvasB.getContext("2d").drawImage(imageB, 0, 0);
  const dataA = canvasA.getContext("2d").getImageData(0, 0, imageA.width, imageA.height).data;
  const dataB = canvasB.getContext("2d").getImageData(0, 0, imageB.width, imageB.height).data;
  let changed = 0;
  for (let index = 0; index < dataA.length; index += 4) {
    if (Math.abs(dataA[index] - dataB[index]) + Math.abs(dataA[index + 1] - dataB[index + 1]) + Math.abs(dataA[index + 2] - dataB[index + 2]) > 24) changed += 1;
  }
  return changed;
}

async function ensurePage(page, baseUrl) {
  if (page.url() === "about:blank") await page.goto(baseUrl + "/", { waitUntil: "load" });
  await page.waitForFunction(() => window.__tracecomOffice && window.__tracecomOffice.worldState(), null, { timeout: 30_000 });
  await page.waitForTimeout(700);
}

async function readCamera(page) {
  return page.evaluate(() => {
    const api = window.__tracecomOffice;
    const camera = api.camera();
    const module = api.cameraModule();
    const range = module.getClampRange(camera);
    const content = api.worldState()?.contentBounds ?? null;
    const center = { x: camera.x + camera.viewport.width / (2 * camera.zoom), y: camera.y + camera.viewport.height / (2 * camera.zoom) };
    return {
      x: camera.x,
      y: camera.y,
      zoom: camera.zoom,
      minZoom: camera.minZoom,
      maxZoom: camera.maxZoom,
      viewport: camera.viewport,
      bounds: camera.bounds,
      content,
      range: range ? { minX: range.minX, maxX: range.maxX, minY: range.minY, maxY: range.maxY, centeredX: range.centeredX, centeredY: range.centeredY } : null,
      center,
      margins: content ? {
        left: module.worldToScreen(camera, content.minX, content.minY).x,
        top: module.worldToScreen(camera, content.minX, content.minY).y,
        right: camera.viewport.width - module.worldToScreen(camera, content.maxX, content.maxY).x,
        bottom: camera.viewport.height - module.worldToScreen(camera, content.maxX, content.maxY).y,
      } : null,
    };
  });
}

async function worldToScreen(page, worldX, worldY) {
  return page.evaluate(([x, y]) => {
    const api = window.__tracecomOffice;
    return api.cameraModule().worldToScreen(api.camera(), x, y);
  }, [worldX, worldY]);
}

/* ------------------------------------------------------------------ *
 * scenarios
 * ------------------------------------------------------------------ */

async function scenarioFinal(page, baseUrl) {
  console.log("\n[final] T1/T3/T4/T5/T6/T7 — boot, centering, labels, agents, badge, logs");
  await ensurePage(page, baseUrl);
  const boot = await readCamera(page);
  const state = await page.evaluate(() => {
    const api = window.__tracecomOffice;
    const state = api.worldState();
    const derived = state.stations.map((station) => station.derived);
    return {
      stations: state.stations.length,
      allStations: state.allStations.length,
      working: derived.filter((entry) => entry.agentsWorking === true).length,
      openButOffline: derived.filter((entry) => entry.state === "OPEN_BUT_FEED_OFFLINE").length,
      closed: derived.filter((entry) => entry.state === "CLOSED").length,
      cameraBoundsIsContent: Boolean(api.camera().bounds && state.contentBounds && api.camera().bounds.minX === state.contentBounds.minX && api.camera().bounds.maxX === state.contentBounds.maxX),
      lifeAgents: (() => {
        const agents = api.lifeModule().getAgentStates(api.life());
        return {
          total: agents.length,
          working: agents.filter((agent) => agent.working === true).length,
          atDesk: agents.filter((agent) => agent.atDesk === true).length,
          hidden: agents.filter((agent) => agent.hidden === true).length,
          locations: [...new Set(agents.map((agent) => agent.location))],
        };
      })(),
      supervisorDrawn: (() => {
        try {
          return api.lifeModule().getSupervisorState(api.life()) !== null;
        } catch {
          return null;
        }
      })(),
      logs: api.logs(),
      logsInState: Array.isArray(state.logs) ? state.logs.length : 0,
    };
  });

  assert("T1", "bounds navegáveis = content bounds (não mundo vazio)", boot.content && boot.bounds.minX === boot.content.minX && boot.bounds.maxX === boot.content.maxX && boot.bounds.minY === boot.content.minY && boot.bounds.maxY === boot.content.maxY, "final-boot-centered.png", { bounds: boot.bounds, content: boot.content });
  const margins = boot.margins ?? {};
  const centered = Math.abs(boot.center.x - (boot.content.minX + boot.content.maxX) / 2) < 1.5 && Math.abs(boot.center.y - (boot.content.minY + boot.content.maxY) / 2) < 1.5;
  assert("T1", "conteúdo centrado horizontal e verticalmente", centered, "final-boot-centered.png", { center: boot.center, margins });
  assert("T1", "folgas presentes nos 4 lados e opostas equilibradas", margins.left >= 8 && margins.right >= 8 && margins.top >= 8 && margins.bottom >= 8 && Math.abs(margins.left - margins.right) < 4 && Math.abs(margins.top - margins.bottom) < 4, "final-boot-centered.png", margins);

  await shot(page, "final-boot-centered.png");

  // Pixel measurement of the REAL screenshot at the content edges.
  if (createCanvas) {
    const buffer = await page.screenshot();
    const pixels = await pixelsFrom(buffer);
    const content = boot.content;
    const probe = (worldX, worldY) => {
      const screen = { x: (worldX - boot.x) * boot.zoom, y: (worldY - boot.y) * boot.zoom };
      return { screen, inside: pixels.at(screen.x, screen.y) };
    };
    const topInside = probe((content.minX + content.maxX) / 2, 12);
    const topOutside = probe((content.minX + content.maxX) / 2, -10);
    const bottomInside = probe((content.minX + content.maxX) / 2, 1014);
    const bottomOutside = probe((content.minX + content.maxX) / 2, content.maxY + 12);
    const leftInside = probe(content.minX + 8, 906);
    const leftOutside = probe(content.minX - 10, 906);
    const rightInside = probe(content.maxX - 8, 906);
    const rightOutside = probe(content.maxX + 10, 906);
    const diffs = {
      top: colorDistance(topInside.inside, topOutside.inside),
      bottom: colorDistance(bottomInside.inside, bottomOutside.inside),
      left: colorDistance(leftInside.inside, leftOutside.inside),
      right: colorDistance(rightInside.inside, rightOutside.inside),
    };
    assert("T1", "bordas do conteúdo medidas em PIXELS na screenshot (dentro ≠ fora)", Math.min(diffs.top, diffs.bottom, diffs.left, diffs.right) > 12, "final-boot-centered.png", { diffs, samples: { topInside: topInside.inside, topOutside: topOutside.inside, bottomInside: bottomInside.inside, bottomOutside: bottomOutside.inside, leftInside: leftInside.inside, leftOutside: leftOutside.inside } });
  } else {
    assert("T1", "medição de pixels disponível (@napi-rs/canvas)", false, null, { reason: "canvas não encontrado" });
  }

  // T4 — sector labels in front: probe the FOREX MAJORS ribbon against the floor above it.
  const ribbonPoint = await worldToScreen(page, 1280, 312);
  const floorPoint = await worldToScreen(page, 1280, 260);
  if (createCanvas) {
    const pixels = await pixelsFrom((await page.screenshot()));
    const ribbon = pixels.at(ribbonPoint.x, ribbonPoint.y);
    const floor = pixels.at(floorPoint.x, floorPoint.y);
    const blueish = ribbon.b > floor.b + 18 && ribbon.b > ribbon.r + 20;
    assert("T4", "faixa FOREX MAJORS visível NA FRENTE (azul sobre o piso)", blueish, "final-boot-centered.png", { ribbon, floor });
  }

  assert("T5/T6", "agentes apenas nos mercados WORKING (1 trader + 1 critic por mesa)", state.lifeAgents.working === state.working * 2 && state.lifeAgents.atDesk === state.working * 2 && state.lifeAgents.hidden === state.lifeAgents.total - state.working * 2 && state.lifeAgents.locations.every((location) => location === "desk" || location === "hidden"), "final-boot-centered.png", { ...state.lifeAgents, workingMarkets: state.working });

  // T6 — subtle animation: two frames of the same static camera differ slightly.
  const frameA = await page.screenshot();
  await page.waitForTimeout(900);
  const frameB = await page.screenshot();
  if (createCanvas) {
    const changed = await diffPixels(frameA, frameB);
    assert("T6", "animação sutil (pixels mudam entre frames, sem texto/badge novo)", changed !== null && changed > 30 && changed < 200_000, "final-boot-centered.png", { changedPixels: changed });
  }

  // T7 — real settlement badge within 12s window (EURUSD WIN).
  const badge = await page.evaluate(() => {
    const api = window.__tracecomOffice;
    const state = api.worldState();
    const station = state.stations.find((candidate) => candidate.marketKey === "EURUSD:NORMAL");
    const visibleNow = api.worldModule().settlementBadgeVisible(station, Date.now());
    const visibleAfter = api.worldModule().settlementBadgeVisible(station, Date.now() + 12_001);
    return { badge: station.badge, visibleNow, visibleAfter };
  });
  assert("T7", "badge WIN real visível na janela de 12s e expirado depois", badge.badge.visible === true && badge.badge.text === "+R$ 8,50" && badge.visibleNow === true && badge.visibleAfter === false, "final-boot-centered.png", badge);

  // T3 — global LOGS: real stream polled, bounded, rendered on canvas.
  await page.waitForFunction(() => window.__tracecomOffice.logs().length > 0, null, { timeout: 15_000 });
  await page.waitForTimeout(400);
  const logs = await page.evaluate(() => ({ logs: window.__tracecomOffice.logs(), stateLogs: window.__tracecomOffice.worldState().logs?.length ?? 0 }));
  const logOk = logs.logs.length > 0 && logs.stateLogs <= 12 && logs.logs.every((entry) => /^\d{2}:\d{2}:\d{2}$/.test(entry.time) && entry.asset && entry.text);
  assert("T3", "LOGS globais com eventos reais HH:MM:SS ATIVO — evento (lista limitada)", logOk, "final-logs.png", { count: logs.logs.length, first: logs.logs[logs.logs.length - 1] ?? null, stateLogs: logs.stateLogs });
  await shot(page, "final-logs.png");

  assert("boot", "54 estações + reservas e estados derivados coerentes", state.allStations === 55 && state.working >= 50 && state.openButOffline >= 1 && state.closed >= 1, "final-boot-centered.png", { stations: state.stations, working: state.working, openButOffline: state.openButOffline, closed: state.closed, cameraBoundsIsContent: state.cameraBoundsIsContent });
  void state.supervisorDrawn;
}

async function scenarioNavigation(page) {
  console.log("\n[final] T13 — wheel/Shift+wheel/Ctrl+zoom/Space+drag/focus");
  // zoom in so vertical pan has room
  await page.mouse.move(760, 420);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await page.waitForTimeout(120);
  const beforeScroll = await readCamera(page);
  await page.mouse.move(760, 420);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(80);
  const afterScroll = await readCamera(page);
  assert("T13", "wheel = scroll vertical (sem zoom)", Math.abs(afterScroll.zoom - beforeScroll.zoom) < 1e-9 && Math.abs(afterScroll.y - beforeScroll.y) > 1, "final-nav-scroll.png", { from: beforeScroll.y, to: afterScroll.y });

  const beforeShift = await readCamera(page);
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 200);
  await page.keyboard.up("Shift");
  await page.waitForTimeout(80);
  const afterShift = await readCamera(page);
  assert("T13", "Shift+wheel = scroll horizontal", Math.abs(afterShift.x - beforeShift.x) > 1 && Math.abs(afterShift.zoom - beforeShift.zoom) < 1e-9, "final-nav-scroll.png", { from: beforeShift.x, to: afterShift.x });

  const anchor = { x: 700, y: 380 };
  const worldBefore = await page.evaluate(([sx, sy]) => {
    const api = window.__tracecomOffice;
    return api.cameraModule().screenToWorld(api.camera(), sx, sy);
  }, [anchor.x, anchor.y]);
  const zoomBefore = (await readCamera(page)).zoom;
  await page.mouse.move(anchor.x, anchor.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await page.waitForTimeout(80);
  const worldAfter = await page.evaluate(([sx, sy]) => {
    const api = window.__tracecomOffice;
    return api.cameraModule().screenToWorld(api.camera(), sx, sy);
  }, [anchor.x, anchor.y]);
  const zoomAfter = (await readCamera(page)).zoom;
  const drift = Math.hypot(worldAfter.x - worldBefore.x, worldAfter.y - worldBefore.y);
  assert("T13", "Ctrl+wheel = zoom no cursor (ponto do mundo fixo)", zoomAfter > zoomBefore && drift < 1, "final-nav-zoom.png", { zoomBefore, zoomAfter, drift: Number(drift.toFixed(4)) });

  // SPACE + drag pan
  const panBefore = await readCamera(page);
  await page.mouse.move(700, 400);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(480, 300, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await page.waitForTimeout(100);
  const panAfter = await readCamera(page);
  assert("T13", "Space+drag = pan real (sem abrir painel)", Math.abs(panAfter.x - panBefore.x) > 10 && Math.abs(panAfter.y - panBefore.y) > 5, "final-nav-pan.png", { from: { x: panBefore.x, y: panBefore.y }, to: { x: panAfter.x, y: panAfter.y } });

  // focus-to-desk via real click on a visible desk (camera re-framed first)
  await page.evaluate(() => {
    const api = window.__tracecomOffice;
    const camera = api.camera();
    const content = api.worldState().contentBounds;
    camera.target = null;
    camera.zoom = 0.9;
    camera.x = (content.minX + content.maxX) / 2 - camera.viewport.width / (2 * camera.zoom);
    camera.y = (content.minY + content.maxY) / 2 - camera.viewport.height / (2 * camera.zoom);
    api.cameraModule().clampToBounds(camera);
  });
  await page.waitForTimeout(120);
  const point = await page.evaluate(() => {
    const api = window.__tracecomOffice;
    const camera = api.camera();
    const module = api.cameraModule();
    const state = api.worldState();
    const station = state.stations.find((candidate) => candidate.marketKey === "EURUSD:NORMAL");
    return module.worldToScreen(camera, station.desk.x + station.desk.w / 2, station.desk.y + station.desk.h / 2);
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(650);
  const focus = await page.evaluate(() => ({
    selected: window.__tracecomOffice.selectedMarketKey(),
    focus: window.__tracecomOffice.camera().focusStationId,
    panels: document.querySelectorAll(".tc-v3-detail").length,
  }));
  assert("T13", "clique na mesa = zoom/foco + painel do marketKey", focus.selected === "EURUSD:NORMAL" && focus.focus === "EURUSD:NORMAL" && focus.panels === 1, "final-nav-focus.png", focus);
}

async function scenarioPanelIsolation(page) {
  console.log("\n[final] T8/T9/T12 — painel simplificado, logs individuais, troca rápida");
  await page.evaluate(() => window.__tracecomOffice.selectMarket("EURUSD:NORMAL"));
  await page.waitForTimeout(300);
  const panel = await page.evaluate(() => {
    const root = document.querySelector("#office-detail-root [data-market-key]");
    const blocks = [...document.querySelectorAll("#office-detail-root .tc-v3-detail-section")].map((node) => node.dataset.block);
    const rows = {};
    for (const row of root?.querySelectorAll(".tc-v3-row") ?? []) {
      rows[row.querySelector(".tc-v3-row-label")?.textContent ?? ""] = row.querySelector(".tc-v3-row-value")?.textContent ?? "";
    }
    return {
      marketKey: root?.getAttribute("data-market-key") ?? null,
      title: document.querySelector(".tc-v3-detail-title")?.textContent ?? null,
      blocks,
      tabs: document.querySelectorAll("#office-detail-root .tc-v3-tab").length,
      technical: Boolean(document.querySelector('#office-detail-root [data-block="technical"], #office-detail-root [data-block="journal"]')),
      stake: document.querySelector('.tc-stake-config input[data-stake="input"]')?.value ?? null,
      stakeScope: document.querySelector(".tc-stake-config-source")?.textContent ?? null,
      rows,
      activityKeys: [...document.querySelectorAll("#office-detail-root .tc-v3-activity-line")].map((node) => node.dataset.marketKey),
      activityText: document.querySelector("#office-detail-root .tc-v3-activity")?.textContent ?? "",
    };
  });
  assert("T8", "painel só com ESTADO/PERFORMANCE/ATIVIDADE + stake individual", panel.marketKey === "EURUSD:NORMAL" && panel.blocks.join(",") === "estado,performance,atividade" && panel.tabs === 0 && panel.technical === false, "final-panel-eurusd.png", { blocks: panel.blocks, tabs: panel.tabs });
  assert("T8", "estado e performance do dia reais (EURUSD: 5/4/1/WR)", panel.rows["Estado"] === "MERCADO ABERTO · OPERANDO" && panel.rows["OPERAÇÕES"] === "5" && panel.rows["WINS"] === "4" && panel.rows["LOSSES"] === "1" && panel.rows["WR"] === "80,0%", "final-panel-eurusd.png", panel.rows);
  assert("T8", "stake individual marcado como OVERRIDE INDIVIDUAL (valor 25)", panel.stake === "25" && /OVERRIDE INDIVIDUAL/.test(panel.stakeScope ?? ""), "final-panel-eurusd.png", { stake: panel.stake, scope: panel.stakeScope });
  assert("T9", "ATIVIDADE EM TEMPO REAL isolada no marketKey (EURUSD)", panel.activityKeys.length > 0 && panel.activityKeys.every((key) => key === "EURUSD:NORMAL") && /TRADER|CRITIC|CONSENSO|DECISÃO|AGUARDAR|CANDIDATO|RESULTADO|SINAL/.test(panel.activityText), "final-panel-eurusd.png", { lines: panel.activityKeys.length, sample: panel.activityText.slice(0, 120) });
  await shot(page, "final-panel-eurusd.png");

  // T12 — rapid switch EURUSD → GBPJPY:OTC → GOLD → USDJPY → EURUSD
  const sequence = ["EURUSD:NORMAL", "GBPJPY:OTC", "GOLD:NORMAL", "USDJPY:NORMAL", "EURUSD:NORMAL"];
  const observations = [];
  for (const key of sequence) {
    await page.evaluate((marketKey) => window.__tracecomOffice.selectMarket(marketKey), key);
    await page.waitForTimeout(180);
    const current = await page.evaluate((marketKey) => {
      const api = window.__tracecomOffice;
      const root = document.querySelector("#office-detail-root [data-market-key]");
      return {
        marketKey: root?.getAttribute("data-market-key") ?? null,
        title: document.querySelector(".tc-v3-detail-title")?.textContent ?? null,
        stake: document.querySelector('.tc-stake-config input[data-stake="input"]')?.value ?? null,
        state: document.querySelector('#office-detail-root [data-field="state"] b')?.textContent ?? null,
        activityKeys: [...new Set([...document.querySelectorAll("#office-detail-root .tc-v3-activity-line")].map((node) => node.dataset.marketKey))],
        text: root?.textContent ?? "",
        officeHasKey: (api.officeJson()?.markets ?? []).some((market) => market.marketKey === marketKey),
        officeSample: (api.officeJson()?.markets ?? []).map((market) => market.marketKey).filter((key) => key.includes("GBPJPY")),
      };
    }, key);
    observations.push(current);
    assert("T12", `troca rápida → ${key} (painel/stake/log isolados)`, current.marketKey === key && current.officeHasKey === true && !/Mercado não encontrado/.test(current.text) && current.activityKeys.every((entry) => entry === key), "final-panel-switch.png", current);
  }
  const last = observations[observations.length - 1];
  assert("T12", "sem contaminação do ativo anterior no último painel", last.marketKey === "EURUSD:NORMAL" && !/GBP\/JPY OTC ·/.test(last.text) && !/GOLD ·/.test(last.text), "final-panel-switch.png", { title: last.title, activity: last.activityKeys });
  await shot(page, "final-panel-switch.png");
}

async function scenarioIqOption(page, baseUrl) {
  console.log("\n[final] T2 — IQ OPTION modal (sem credenciais)");
  await page.click('[data-tb="iq"]');
  await page.waitForSelector(".tc-iq-modal:not([hidden])", { timeout: 5000 });
  await page.waitForTimeout(400);
  const modal = await page.evaluate(() => {
    const root = document.querySelector(".tc-iq-modal");
    const rows = {};
    for (const row of root?.querySelectorAll(".tc-iq-row") ?? []) rows[row.querySelector(".tc-iq-label")?.textContent ?? ""] = row.querySelector(".tc-iq-value")?.textContent ?? "";
    const inputs = [...root.querySelectorAll("input")].map((input) => input.type);
    return { text: root?.textContent ?? "", rows, inputs, passwordInputs: inputs.filter((type) => type === "password").length, reconnectDisabled: document.querySelector('[data-iq="reconnect"]')?.disabled === true };
  });
  assert("T2", "modal abre com CONECTADO/PRACTICE/SALDO/WS/MCP reais", /CONECTADO/.test(modal.rows["CONEXÃO"] ?? "") && /PRACTICE/.test(modal.rows["MODO"] ?? "") && /BRL 10000.50/.test(modal.rows["SALDO"] ?? "") && /ONLINE/.test(modal.rows["WS"] ?? ""), "final-iq-option.png", modal.rows);
  assert("T2", "REAL bloqueado, conta única e zero campos de credencial no DOM", /BLOQUEADO/.test(modal.rows["REAL"] ?? "") && modal.passwordInputs === 0 && modal.inputs.length === 0 && modal.reconnectDisabled === true, "final-iq-option.png", { inputs: modal.inputs, reconnectDisabled: modal.reconnectDisabled });
  const forbidden = ["password", "ssid", "cookie", "secret", "token", "apikey"];
  const rowText = Object.values(modal.rows).join(" ");
  assert("T2", "valores exibidos não contêm senha/token/ssid/cookie/secret", !forbidden.some((word) => rowText.toLowerCase().includes(word)), "final-iq-option.png", {});
  await shot(page, "final-iq-option.png");
  await page.click('[data-iq="disconnect"]');
  await page.waitForTimeout(500);
  const afterDisconnect = await page.evaluate(() => document.querySelector('.tc-iq-row[data-iq-row="connection"] .tc-iq-value')?.textContent ?? null);
  assert("T2", "DESCONECTAR usa o endpoint real e atualiza o estado", afterDisconnect === "DESCONECTADO", "final-iq-option-after.png", { afterDisconnect });
  await shot(page, "final-iq-option-after.png");
  await page.click(".tc-iq-close");
  await page.waitForTimeout(150);
  assert("T2", "modal fecha e não deixa overlay preso", await page.evaluate(() => document.querySelector(".tc-iq-modal")?.hidden === true), null, {});
  void baseUrl;
}

async function scenarioMesasAndResize(page) {
  console.log("\n[final] T13 — MESAS popup + resize");
  await page.click("#mesas-toggle");
  await page.waitForFunction(() => document.getElementById("mesas-panel").hidden === false, null, { timeout: 5000 });
  await page.fill("#mesas-search", "gold");
  await page.waitForTimeout(120);
  await shot(page, "final-mesas-popup.png");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  const selected = await page.evaluate(() => ({
    selected: window.__tracecomOffice.selectedMarketKey(),
    title: document.querySelector(".tc-v3-detail-title")?.textContent ?? null,
    activity: [...new Set([...document.querySelectorAll("#office-detail-root .tc-v3-activity-line")].map((node) => node.dataset.marketKey))],
  }));
  assert("T13", "MESAS busca + Enter seleciona a mesa correta (GOLD)", selected.selected === "GOLD:NORMAL" && selected.title === "GOLD" && selected.activity.every((key) => key === "GOLD:NORMAL"), "final-mesas-popup.png", selected);

  await page.setViewportSize({ width: 1024, height: 640 });
  await page.waitForTimeout(500);
  const resized = await page.evaluate(() => {
    const api = window.__tracecomOffice;
    const camera = api.camera();
    const module = api.cameraModule();
    const state = api.worldState();
    const clampHolds = (() => {
      const range = module.getClampRange(camera);
      return Boolean(range) && camera.x >= range.minX - 0.5 && camera.x <= range.maxX + 0.5 && camera.y >= range.minY - 0.5 && camera.y <= range.maxY + 0.5;
    })();
    module.fitContent(camera, state);
    const range = module.getClampRange(camera);
    const content = state.contentBounds;
    return {
      viewport: camera.viewport,
      clampHolds,
      centered: range.centeredX === true && range.centeredY === true,
      margins: {
        left: module.worldToScreen(camera, content.minX, content.minY).x,
        top: module.worldToScreen(camera, content.minX, content.minY).y,
        right: camera.viewport.width - module.worldToScreen(camera, content.maxX, content.maxY).x,
        bottom: camera.viewport.height - module.worldToScreen(camera, content.maxX, content.maxY).y,
      },
    };
  });
  const resizeOk = resized.viewport.width === 1024 && resized.viewport.height === 640 && resized.clampHolds === true && resized.centered === true && Math.min(resized.margins.left, resized.margins.top, resized.margins.right, resized.margins.bottom) >= 8;
  assert("T13", "resize mantém clamp vivo e conteúdo re-enquadrável no centro", resizeOk, "final-resize.png", resized);
  await shot(page, "final-resize.png");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  let serverHandle = null;
  let browserHandle = null;
  const baseUrl = EXTERNAL_URL ?? null;
  try {
    if (!baseUrl) {
      serverHandle = await startServer();
      console.log(`[final] static server ${serverHandle.origin} → ${PUBLIC_DIR}`);
    }
    browserHandle = await launchRealBrowser();
    if (!browserHandle) {
      console.log("[final] NENHUM NAVEGADOR REAL DISPONÍVEL — abortando sem rotular como real.");
      process.exitCode = 1;
      return;
    }
    const origin = baseUrl ?? serverHandle.origin;
    const context = await browserHandle.browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log(`  [pageerror] ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") console.log(`  [console.error] ${message.text()}`);
    });
    console.log(`[final] navegador REAL: ${browserHandle.label} (${browserHandle.browser.version()})`);
    for (const scenario of [scenarioFinal, scenarioNavigation, scenarioPanelIsolation, scenarioIqOption, scenarioMesasAndResize]) {
      try {
        await scenario(page, origin);
      } catch (error) {
        assert(scenario.name, "cenário executou sem exceção", false, null, { error: String(error?.message ?? error) });
      }
    }
    await context.close();
    await browserHandle.browser.close();

    const failed = results.filter((entry) => !entry.pass);
    const report = {
      at: new Date().toISOString(),
      engine: browserHandle.label,
      realBrowser: true,
      baseUrl: origin,
      screenshots: shots,
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      results,
    };
    await writeFile(REPORT_JSON, JSON.stringify(report, null, 2));
    console.log(`\n[final] ${report.passed}/${report.total} asserts PASS — engine=${report.engine}`);
    if (failed.length) for (const entry of failed) console.log(`  - ${entry.scenario} ${entry.assertion} ${JSON.stringify(entry.detail)}`);
    console.log(`[final] report ${REPORT_JSON}`);
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    if (browserHandle?.browser) await browserHandle.browser.close().catch(() => {});
    if (serverHandle?.server) await new Promise((resolvePromise) => serverHandle.server.close(resolvePromise));
  }
}

main().catch((error) => {
  console.error("[final] falhou", error);
  process.exitCode = 1;
});
