/**
 * OFFICE V3 — PRODUCTION SMOKE (real deployed page, real data).
 *
 * Opens https://tracecom-consecom.vercel.app (or --url=), drives the real
 * browser and validates the deployed Office V3 against the live snapshot:
 *   GET / 200 · 54 mercados · painel superior real · IQ OPTION · logs reais
 *   painel simplificado no marketKey · screenshots.
 *
 * Read-only. PRACTICE only. ZERO REAL. No orders, no config writes.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT_DIR = resolve(ROOT, "docs/office-v3/screenshots");
const REPORT_JSON = resolve(ROOT, "docs/office-v3/prod-smoke.report.json");
const TEMP_KIT = join(tmpdir(), "opencode", "browser-kit");

const args = process.argv.slice(2);
const argValue = (name) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const BASE_URL = (argValue("url") ?? "https://tracecom-consecom.vercel.app").replace(/\/$/, "");

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

const results = [];
function assert(name, pass, evidence, detail) {
  results.push({ assertion: name, pass: pass === true, evidence: evidence ?? null, detail: detail ?? null });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` · ${JSON.stringify(detail)}` : ""}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  let playwright = await importPlaywright();
  if (!playwright && existsSync(TEMP_KIT)) {
    spawnSync("npm", ["install", "playwright@1.63.0", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: TEMP_KIT, shell: true, stdio: "ignore", timeout: 300_000 });
    playwright = await importPlaywright();
  }
  if (!playwright) {
    console.error("[prod-smoke] playwright indisponível");
    process.exitCode = 1;
    return;
  }
  const browser = await playwright.chromium.launch({ headless: true, channel: "chrome" }).catch(() => playwright.chromium.launch({ headless: true }));
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on("pageerror", (error) => console.log(`  [pageerror] ${error.message}`));
  try {
    const rootResponse = await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    assert("GET / = 200 (Office V3 na raiz)", rootResponse?.status() === 200, "final-prod-boot.png", { status: rootResponse?.status() });
    await page.waitForFunction(() => window.__tracecomOffice && window.__tracecomOffice.worldState(), null, { timeout: 60_000 });
    await page.waitForTimeout(2500);
    const boot = await page.evaluate(() => {
      const api = window.__tracecomOffice;
      const state = api.worldState();
      const office = api.officeJson();
      const derived = state.stations.map((station) => station.derived);
      const resultsEl = document.querySelector("#office-results");
      return {
        title: document.title,
        stations: state.stations.length,
        working: derived.filter((entry) => entry.agentsWorking === true).length,
        open: derived.filter((entry) => entry.state !== "CLOSED" && entry.state !== "DISABLED" && entry.state !== "NOT_OFFERED" && entry.state !== "SUSPENDED").length,
        settledPnl: office?.portfolio?.settled?.pnl ?? null,
        pnlText: state.board?.pnlText ?? null,
        logs: api.logs().length,
        mode: office?.mode ?? null,
        connected: office?.connection?.connected === true,
        results: {
          present: Boolean(resultsEl && resultsEl.hidden === false),
          text: resultsEl ? resultsEl.textContent.slice(0, 600) : null,
          model: api.resultsModel ? { day: api.resultsModel()?.day?.pnlText ?? null, week: api.resultsModel()?.week?.pnlText ?? null, month: api.resultsModel()?.month?.pnlText ?? null } : null,
        },
        canvasLogsBox: typeof api.worldModule().drawLogsBox === "function",
        rsiV2: office?.aux?.rsiAgentsV2 ?? null,
        strategyOrder: state.stations.map((station) => station.rsiAgent?.strategyId ?? null),
        desksWithTag: state.stations.filter((station) => Boolean(station.rsiAgent?.strategyId)).length,
      };
    });
    assert("mundo real com 54 mercados", boot.stations === 54, "final-prod-boot.png", { stations: boot.stations });
    assert("painel superior com dados reais do GET /api/iq/office", typeof boot.pnlText === "string" && boot.pnlText.length > 0, "final-prod-boot.png", { pnlText: boot.pnlText, settledPnl: boot.settledPnl });
    assert("RESULTS DO DIA/SEMANA/MES legivel e sem NaN/undefined", boot.results.present === true && /RESULTADO DO DIA/.test(boot.results.text ?? "") && !/NaN|undefined/.test(boot.results.text ?? ""), "final-prod-boot.png", boot.results);
    assert("box de LOGS do canvas removido (somente overlay DOM)", boot.canvasLogsBox === false, null, { canvasLogsBox: boot.canvasLogsBox });
    const firstPullback = boot.strategyOrder.findIndex((strategy) => strategy === "RSI_EXTREME_PULLBACK_V2");
    const lastStrict = boot.strategyOrder.reduce((last, strategy, index) => (strategy === "RSI_REVERSAL_STRICT_V2" ? index : last), -1);
    assert("RSI V2 50/50 no Office (superior STRICT V2 / inferior PULLBACK V2)", Boolean(boot.rsiV2) && boot.rsiV2.migration?.complete === true && boot.rsiV2.split.strict > 0 && boot.rsiV2.split.pullback > 0 && Math.abs(boot.rsiV2.split.strict - boot.rsiV2.split.pullback) <= 1 && firstPullback > lastStrict && boot.desksWithTag === boot.rsiV2.split.strict + boot.rsiV2.split.pullback, "final-prod-boot.png", { split: boot.rsiV2?.split, migration: boot.rsiV2?.migration?.state, desksWithTag: boot.desksWithTag, firstPullback, lastStrict });
    await page.screenshot({ path: join(OUT_DIR, "final-prod-boot.png") });

    await page.click("#logs-toggle");
    await page.waitForSelector("#logs-panel:not([hidden])", { timeout: 10_000 });
    await page.waitForTimeout(700);
    const logsPanel = await page.evaluate(() => ({
      columns: document.querySelectorAll("#logs-panel .tc-logs-columns span").length,
      rows: document.querySelectorAll("#logs-list .tc-logs-row").length,
      hasHeader: /HORA/.test(document.querySelector("#logs-panel .tc-logs-columns")?.textContent ?? ""),
      text: (document.querySelector("#logs-panel")?.textContent ?? "").slice(0, 400),
    }));
    assert("LOGS abre overlay DOM legivel (9 colunas, sem pixel-art)", logsPanel.columns === 9 && logsPanel.hasHeader === true, "final-prod-logs.png", { columns: logsPanel.columns, rows: logsPanel.rows });
    await page.screenshot({ path: join(OUT_DIR, "final-prod-logs.png") });
    await page.click("#logs-close");
    const logsClosed = await page.evaluate(() => document.querySelector("#logs-panel")?.hidden === true);
    assert("LOGS fecha e volta ao escritorio", logsClosed === true, null, { closed: logsClosed });


    await page.click('[data-tb="iq"]');
    await page.waitForSelector(".tc-iq-modal:not([hidden])", { timeout: 10_000 });
    await page.waitForTimeout(1200);
    const iq = await page.evaluate(() => {
      const rows = {};
      for (const row of document.querySelectorAll(".tc-iq-modal:not([hidden]) .tc-iq-row")) rows[row.querySelector(".tc-iq-label")?.textContent ?? ""] = row.querySelector(".tc-iq-value")?.textContent ?? "";
      return { rows, inputs: document.querySelectorAll(".tc-iq-modal:not([hidden]) input").length };
    });
    assert("IQ OPTION mostra status real e zero input de credencial", iq.inputs === 0 && typeof iq.rows["CONEXÃO"] === "string" && typeof iq.rows["WS"] === "string", "final-prod-iq.png", iq.rows);
    await page.screenshot({ path: join(OUT_DIR, "final-prod-iq.png") });
    await page.click(".tc-iq-close");

    const firstKey = await page.evaluate(() => {
      const api = window.__tracecomOffice;
      const working = api.worldState().stations.find((station) => station.derived?.agentsWorking === true);
      return working?.marketKey ?? api.worldState().stations[0]?.marketKey ?? null;
    });
    if (firstKey) {
      await page.evaluate((key) => window.__tracecomOffice.selectMarket(key), firstKey);
      await page.waitForTimeout(1500);
      const panel = await page.evaluate(() => ({
        marketKey: document.querySelector("#office-detail-root .tc-v3-detail")?.dataset.marketKey ?? null,
        blocks: [...document.querySelectorAll("#office-detail-root .tc-v3-detail-section")].map((node) => node.dataset.block),
        tabs: document.querySelectorAll("#office-detail-root .tc-v3-tab").length,
        technical: Boolean(document.querySelector('#office-detail-root [data-block="technical"], #office-detail-root [data-block="journal"]')),
      }));
      assert("painel direito simplificado no marketKey WORKING real", panel.marketKey === firstKey && panel.blocks.join(",") === "estado,performance,atividade" && panel.tabs === 0 && panel.technical === false, "final-prod-panel.png", panel);
      await page.screenshot({ path: join(OUT_DIR, "final-prod-panel.png") });
    }

    const rollback = await page.request.get(`${BASE_URL}/classic.html`);
    assert("rollback /classic.html responde 200", rollback.status() === 200, null, { status: rollback.status() });
  } catch (error) {
    assert("smoke de produção executou sem exceção", false, null, { error: String(error?.message ?? error) });
  } finally {
    await browser.close();
  }
  const failed = results.filter((entry) => !entry.pass);
  const report = { at: new Date().toISOString(), baseUrl: BASE_URL, total: results.length, passed: results.length - failed.length, failed: failed.length, results };
  await writeFile(REPORT_JSON, JSON.stringify(report, null, 2));
  console.log(`\n[prod-smoke] ${report.passed}/${report.total} asserts PASS — ${BASE_URL}`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error("[prod-smoke] falhou", error);
  process.exitCode = 1;
});
