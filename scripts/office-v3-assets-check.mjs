/**
 * OFFICE V3 — PIXEL-ART ASSETS BROWSER CHECK (real Playwright + Chrome).
 *
 * Drives the real page and proves, with the real DOM/canvas:
 *   1. exactly 1 AgentSprite Trader + 1 AgentSprite Critic per WORKING marketKey
 *      (new pixel pack), 0 agents for every non-WORKING state;
 *   2. the same counts with `?assets=off` (procedural fallback) — before/after;
 *   3. no duplication, no marketKey contamination;
 *   4. camera / panel / MESAS quick regression;
 *   5. the four reconciled agent numbers (registered / possible / working /
 *      rendered in the current frame).
 *
 * Screenshots -> docs/office-v3/screenshots/ ; report -> docs/office-v3/assets-check.report.json
 * PRACTICE only. ZERO REAL. Read-only w.r.t. the app.
 *
 * Usage: node scripts/office-v3-assets-check.mjs [--url=https://host/] [--shots=assets]
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
const REPORT_JSON = resolve(ROOT, "docs/office-v3/assets-check.report.json");
const TEMP_KIT = join(tmpdir(), "opencode", "browser-kit");

const args = process.argv.slice(2);
const argValue = (name) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const EXTERNAL_URL = argValue("url");
const SHOT_PREFIX = argValue("shots") ?? "assets";

/* ------------------------------------------------------------------ *
 * fixture (only used for the local server, mirrors the real universe)
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
      return { ...base, lastTick: { ageMs: 61_000 }, featureState: { fresh: false, freshnessReason: "STALE_ANALYSIS" } };
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
    return base;
  });
  const working = markets.filter((market) => market.availability === "OPEN" && market.enabled !== false && market.featureState.fresh === true).length;
  return {
    version: "office-v3-assets-check",
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
    portfolio: {
      settled: { wins: 7, losses: 3, draws: 1, pnl: 123.45, trades: 11 },
      equityCurve: [{ value: 0 }, { value: 40 }, { value: 90 }, { value: 123.45 }],
    },
    markets,
  };
}

/* ------------------------------------------------------------------ *
 * local static server (+ fixture) — ignored when --url is provided
 * ------------------------------------------------------------------ */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
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
 * browser resolution (playwright installed or temp kit + system Chrome)
 * ------------------------------------------------------------------ */

async function importPlaywright() {
  for (const candidate of [() => import("playwright"), () => import(pathToFileURL(join(TEMP_KIT, "node_modules/playwright/index.mjs")).href)]) {
    try {
      const module = await candidate();
      if (module?.chromium) return module;
    } catch {
      /* next */
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
    installPlaywrightInTemp();
    playwright = await importPlaywright();
  }
  if (!playwright) return null;
  for (const options of [{ channel: "chrome" }, { channel: "msedge" }, {}]) {
    try {
      const browser = await playwright.chromium.launch({ headless: true, ...options });
      return { browser, label: options.channel ? `playwright+${options.channel}` : "playwright+chromium-bundled" };
    } catch {
      /* next channel */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * assertions + screenshots
 * ------------------------------------------------------------------ */

const results = [];
function assert(scenario, name, pass, detail, evidence = null) {
  results.push({ scenario, assertion: name, pass: pass === true, evidence, detail: detail ?? null });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` · ${JSON.stringify(detail)}` : ""}`);
}

const shots = [];
async function shot(page, name) {
  const file = `${SHOT_PREFIX}-${name}.png`;
  await page.screenshot({ path: join(OUT_DIR, file) });
  shots.push(file);
  return file;
}

async function waitForOffice(page, url) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.__tracecomOffice && window.__tracecomOffice.worldState(), null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__tracecomOffice.baseMode && window.__tracecomOffice.baseMode() === "procedural", null, { timeout: 30_000 });
}

async function waitForPixelPack(page, timeout = 30_000) {
  await page.waitForFunction(
    () => {
      const api = window.__tracecomOffice;
      const pack = api.pixelAssets && api.pixelAssets();
      return Boolean(pack && pack.ready === true && api.pixelAssetsActive && api.pixelAssetsActive());
    },
    null,
    { timeout },
  );
  await page.waitForTimeout(450);
}

async function readAudit(page) {
  return page.evaluate(() => {
    const api = window.__tracecomOffice;
    const audit = api.agentAudit();
    const pack = api.pixelAssets();
    const canvas = document.getElementById("office-canvas");
    const ctx = canvas.getContext("2d");
    const sample = ctx.getImageData(0, 0, Math.min(canvas.width, 480), Math.min(canvas.height, 270));
    const colors = new Set();
    for (let y = 0; y < sample.height; y += 12) {
      for (let x = 0; x < sample.width; x += 12) {
        const index = (y * sample.width + x) * 4;
        colors.add(`${sample.data[index]},${sample.data[index + 1]},${sample.data[index + 2]}`);
      }
    }
    return {
      audit,
      pixelActive: api.pixelAssetsActive(),
      packCounts: pack ? pack.counts : null,
      packAgents: pack ? pack.list("agents").map((manifest) => ({ id: manifest.id, role: manifest.role, frames: manifest.columns, rows: manifest.rows })) : [],
      distinctColors: colors.size,
      camera: { x: api.camera().x, y: api.camera().y, zoom: api.camera().zoom },
      detailPanels: document.querySelectorAll(".tc-v3-detail").length,
    };
  });
}

function auditAssertions(scenario, label, snapshot, expectedPixelActive = true) {
  const audit = snapshot.audit;
  const renderedKeys = Object.keys(audit.renderedByMarket);
  const pairs = renderedKeys.map((key) => audit.renderedByMarket[key]);
  const exactPairs = pairs.every((entry) => entry.trader === 1 && entry.critic === 1 && entry.total === 2);
  const overTwo = pairs.filter((entry) => entry.total > 2).length;
  assert(scenario, `${label}: pack pixel ${expectedPixelActive ? "ativo" : "desativado (fallback procedural)"}`, snapshot.pixelActive === expectedPixelActive, { pixelActive: snapshot.pixelActive, packCounts: snapshot.packCounts });
  assert(scenario, `${label}: registered = 2 x mercados do registry`, audit.registered === audit.possible && audit.registered === audit.markets * 2, { registered: audit.registered, markets: audit.markets, possible: audit.possible });
  assert(scenario, `${label}: rendered = 2 x WORKING (1 trader + 1 critic por mesa)`, audit.rendered === audit.working && audit.working === audit.workingMarkets * 2, { rendered: audit.rendered, working: audit.working, workingMarkets: audit.workingMarkets });
  assert(scenario, `${label}: todos os renderizados formam par exato trader+critic`, exactPairs && renderedKeys.length === audit.workingMarkets, { renderedMarkets: renderedKeys.length, exactPairs });
  assert(scenario, `${label}: zero duplicacao no frame`, audit.duplicates === 0 && audit.renderedUnique === audit.rendered, { duplicates: audit.duplicates, unique: audit.renderedUnique, rendered: audit.rendered });
  assert(scenario, `${label}: nenhum mercado com >2 agentes`, overTwo === 0, { overTwo });
  assert(scenario, `${label}: canvas renderizado`, snapshot.distinctColors > 24, { distinctColors: snapshot.distinctColors });
  return { audit, exactPairs, overTwo };
}

/* ------------------------------------------------------------------ *
 * scenarios
 * ------------------------------------------------------------------ */

async function scenarioPack(page, baseUrl) {
  console.log("\n[assets] pack ON (default)");
  await waitForOffice(page, `${baseUrl}/`);
  await waitForPixelPack(page);
  const snapshot = await readAudit(page);
  const { audit, exactPairs } = auditAssertions(1, "pack", snapshot);
  await shot(page, "pack-boot");
  assert(1, "pack: 7 agent sprites carregados (trader x3 + critic + supervisor + social x2)", snapshot.packAgents.length === 7, { agents: snapshot.packAgents });

  // every WORKING market has its own pair, no contamination
  const workingKeys = await page.evaluate(() =>
    window.__tracecomOffice
      .worldState()
      .stations.filter((station) => window.__tracecomOffice.derivedFor(station.marketKey)?.agentsWorking === true)
      .map((station) => station.marketKey),
  );
  const contaminated = workingKeys.filter((key) => {
    const entry = audit.renderedByMarket[key];
    return !entry || entry.trader !== 1 || entry.critic !== 1;
  });
  const nonWorkingRendered = Object.keys(audit.renderedByMarket).filter((key) => !workingKeys.includes(key));
  assert(1, "pack: cada marketKey WORKING tem 1 sprite trader + 1 sprite critic", contaminated.length === 0 && exactPairs, { workingKeys: workingKeys.length, contaminated });
  assert(1, "pack: nenhum marketKey nao-WORKING renderizado (CLOSED/SUSPENDED/DISABLED/UNKNOWN/FEED_OFFLINE)", nonWorkingRendered.length === 0, { nonWorkingRendered });

  // focus a WORKING desk (zoom + panel) and re-check isolation
  const workingKey = workingKeys[0] ?? null;
  if (workingKey) await page.evaluate((key) => window.__tracecomOffice.selectMarket(key), workingKey);
  await page.waitForTimeout(700);
  const focused = await readAudit(page);
  await shot(page, "pack-desk-focus");
  const focusedEntry = workingKey ? focused.audit.renderedByMarket[workingKey] ?? { trader: 0, critic: 0, total: 0 } : null;
  const focusedOk = focusedEntry ? focusedEntry.trader === 1 && focusedEntry.critic === 1 : focused.audit.working === 0;
  assert(1, "pack: zoom na mesa WORKING mantem exatamente o par do marketKey", focused.audit.duplicates === 0 && focusedOk, { workingKey, focusedEntry, duplicates: focused.audit.duplicates });
  assert(1, "pack: painel direito abre com o snapshot (sem regressao)", focused.detailPanels >= 1, { detailPanels: focused.detailPanels });

  // non-WORKING stations: pick real samples from THIS snapshot and prove 0 agents
  const nonWorking = await page.evaluate(() => {
    const api = window.__tracecomOffice;
    const stations = api.worldState().stations.filter((station) => station.derived && station.derived.agentsWorking !== true);
    const pick = (state) => stations.find((station) => station.derived.state === state)?.marketKey ?? null;
    return {
      feedOffline: pick("OPEN_BUT_FEED_OFFLINE"),
      closed: pick("CLOSED"),
      suspended: pick("SUSPENDED"),
      disabled: pick("DISABLED"),
      unknown: pick("UNKNOWN") ?? pick("NOT_OFFERED"),
    };
  });
  const samples = Object.entries(nonWorking).filter(([, key]) => Boolean(key));
  if (!samples.length) {
    assert(1, "pack: snapshot sem mesa nao-WORKING para amostrar (derivados 100% WORKING)", true, { nonWorking });
  }
  for (const [state, key] of samples) {
    await page.evaluate((marketKey) => window.__tracecomOffice.selectMarket(marketKey), key);
    await page.waitForTimeout(350);
    const probe = await page.evaluate((marketKey) => {
      const audit = window.__tracecomOffice.agentAudit();
      return { entry: audit.renderedByMarket[marketKey] ?? null, derived: window.__tracecomOffice.derivedFor(marketKey)?.state ?? null };
    }, key);
    assert(1, `pack: ${state} (${key}) nao renderiza agentes`, probe.entry === null, probe);
  }
  await page.evaluate(() => window.__tracecomOffice.closeDetail());
  await shot(page, "pack-nonworking-empty");

  // quick camera regression (Ctrl+wheel zoom + Space+drag pan)
  const before = await page.evaluate(() => ({ ...window.__tracecomOffice.camera() }));
  await page.mouse.move(640, 360);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await page.waitForTimeout(250);
  const zoomed = await page.evaluate(() => ({ zoom: window.__tracecomOffice.camera().zoom }));
  assert(1, "regressao: Ctrl+wheel continua dando zoom", zoomed.zoom > before.zoom, { before: before.zoom, after: zoomed.zoom });
  await page.keyboard.down("Space");
  await page.mouse.move(640, 360);
  await page.mouse.down();
  await page.mouse.move(520, 300, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await page.waitForTimeout(200);
  const panned = await page.evaluate(() => ({ x: window.__tracecomOffice.camera().x, y: window.__tracecomOffice.camera().y }));
  assert(1, "regressao: Space+drag continua movendo a camera", panned.x !== before.x || panned.y !== before.y, { panned, before: { x: before.x, y: before.y } });
}

async function scenarioFallback(page, baseUrl) {
  console.log("\n[assets] pack OFF (?assets=off) — fallback procedural");
  await waitForOffice(page, `${baseUrl}/?assets=off`);
  await page.waitForTimeout(600);
  const snapshot = await readAudit(page);
  const { audit } = auditAssertions(2, "fallback", snapshot, false);
  assert(2, "fallback: assets=off desativa o pack", snapshot.pixelActive === false, { pixelActive: snapshot.pixelActive });
  assert(2, "fallback: mesmos numeros de agentes (nada some)", audit.rendered === audit.working, { rendered: audit.rendered, working: audit.working });
  await shot(page, "procedural-before");
  assert(2, "fallback: canvas procedural continua renderizando", snapshot.distinctColors > 24, { distinctColors: snapshot.distinctColors });
}

async function scenarioSandbox(page, baseUrl) {
  console.log("\n[assets] sandbox visual copiado do gerador");
  await page.goto(`${baseUrl}/office-sandbox.html`, { waitUntil: "load" });
  await page.waitForFunction(() => /assets carregados/i.test(document.getElementById("status")?.textContent ?? ""), null, { timeout: 25_000 });
  const status = await page.evaluate(() => document.getElementById("status")?.textContent ?? "");
  await page.waitForTimeout(300);
  await shot(page, "sandbox");
  assert(3, "sandbox /office-sandbox.html carrega o pacote completo (49 assets)", /\b49 assets carregados\b/.test(status), { status });
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  let serverHandle = null;
  let browserHandle = null;
  let baseUrl = EXTERNAL_URL;
  try {
    if (!baseUrl) {
      serverHandle = await startServer();
      baseUrl = serverHandle.origin;
      console.log(`[assets-check] static server ${baseUrl} · ${PUBLIC_DIR}`);
    } else {
      console.log(`[assets-check] URL externa ${baseUrl}`);
    }
    browserHandle = await launchRealBrowser();
    if (!browserHandle || !browserHandle.browser) {
      throw new Error("nenhum navegador REAL disponivel (playwright + chrome/msedge) — abortando sem inventar resultado");
    }
    console.log(`[assets-check] navegador REAL: ${browserHandle.label} (${browserHandle.browser.version()})`);
    const context = await browserHandle.browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log(`  [pageerror] ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") console.log(`  [console.error] ${message.text()}`);
    });
    try {
      await scenarioPack(page, baseUrl);
    } catch (error) {
      assert(1, "cenario pack executou sem excecao", false, { error: String(error?.message ?? error) });
    }
    const fallbackPage = await context.newPage();
    fallbackPage.on("pageerror", (error) => console.log(`  [pageerror/off] ${error.message}`));
    try {
      await scenarioFallback(fallbackPage, baseUrl);
    } catch (error) {
      assert(2, "cenario fallback executou sem excecao", false, { error: String(error?.message ?? error) });
    }
    if (!EXTERNAL_URL) {
      try {
        await scenarioSandbox(fallbackPage, baseUrl);
      } catch (error) {
        assert(3, "cenario sandbox executou sem excecao", false, { error: String(error?.message ?? error) });
      }
    }
    await context.close();
    await browserHandle.browser.close();

    const failed = results.filter((entry) => !entry.pass);
    const report = {
      at: new Date().toISOString(),
      engine: browserHandle.label,
      realBrowser: true,
      baseUrl,
      screenshots: shots,
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      results,
    };
    await writeFile(REPORT_JSON, JSON.stringify(report, null, 2));
    console.log(`\n[assets-check] ${report.passed}/${report.total} asserts PASS · engine=${report.engine}`);
    if (failed.length) for (const entry of failed) console.log(`  - ${entry.assertion} ${JSON.stringify(entry.detail)}`);
    console.log(`[assets-check] report ${REPORT_JSON}`);
    process.exitCode = failed.length ? 1 : 0;
  } catch (error) {
    console.error("[assets-check] falhou", error);
    process.exitCode = 1;
  } finally {
    if (browserHandle?.browser) await browserHandle.browser.close().catch(() => {});
    if (serverHandle?.server) await new Promise((resolvePromise) => serverHandle.server.close(resolvePromise));
  }
}

main().catch((error) => {
  console.error("[assets-check] falhou", error);
  process.exitCode = 1;
});
