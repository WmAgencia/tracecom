/**
 * OFFICE V3 — ALL-AGENTS DIAGNOSTIC (T10) + OPEN × ENABLED × WORKING (T11).
 *
 * Reads the REAL `GET /api/iq/office` snapshot and validates, for EVERY market:
 *   marketKey, availability, enabled, feedFresh, candles5s, lastTick,
 *   Trader state, Critic state, Brain action, regime, structure, setup, trigger,
 *   Consensus, Quality Score, JIT state and Execution eligibility.
 *
 * Proves each agent receives its own feed, analyzes its own asset and runs
 * Feature Engine → Brain G2 → Critic → Consensus → JIT without cross-market
 * contamination. WAIT is a valid outcome. Nothing is invented: absent fields
 * are reported as ABSENT (never fabricated).
 *
 * Frontend/analysis only. PRACTICE only. ZERO REAL. Sends no orders.
 *
 * Usage:
 *   node scripts/office-v3-agents-diagnostic.mjs [--url=https://host] [--out=docs/office-v3]
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const args = process.argv.slice(2);
const argValue = (name) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const BASE_URL = (argValue("url") ?? process.env.TRACECOM_OFFICE_URL ?? "https://tracecom-consecom.vercel.app").replace(/\/$/, "");
const OUT_DIR = resolve(ROOT, argValue("out") ?? "docs/office-v3");

// @ts-expect-error - ESM visual sem tipografia; módulo puro, sem DOM
const stateModel = await import(pathToFileURL(resolve(ROOT, "src/http/public/office-v3/state-model.js")).href);

function present(value) {
  return value !== null && value !== undefined && value !== "";
}

function check(label, value, validator) {
  const status = validator(value) ? "PASS" : present(value) ? "FAIL" : "ABSENT";
  return { label, value: value === undefined ? null : value, status };
}

function allPass(checks) {
  return checks.every((entry) => entry.status === "PASS" || entry.status === "ABSENT" || entry.status === "N/A");
}

async function fetchOffice() {
  const response = await fetch(`${BASE_URL}/api/iq/office`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GET /api/iq/office → HTTP ${response.status}`);
  const json = await response.json();
  if (!json || !Array.isArray(json.markets)) throw new Error("snapshot sem lista de mercados");
  return json;
}

function analyzeMarket(market, office) {
  const derived = stateModel.deriveMarketState(market, null, office.connection ?? null);
  const entry = market.entryTiming ?? null;
  const agents = market.agents ?? null;
  const decision = market.decisionState ?? null;
  const checks = [
    check("marketKey", market.marketKey, (v) => typeof v === "string" && v.includes(":")),
    check("availability", market.availability, (v) => typeof v === "string" && v.length > 0),
    check("enabled", market.enabled, (v) => typeof v === "boolean"),
    check("feedFresh", derived.fresh, (v) => typeof v === "boolean"),
    check("candles5s", market.candles5s, (v) => Number.isFinite(Number(v)) && Number(v) >= 0),
    check("lastTick", market.lastTick?.ageMs, (v) => Number.isFinite(Number(v))),
    check("Trader state", agents?.trader?.action, (v) => typeof v === "string"),
    check("Critic state", agents?.critic?.verdict, (v) => typeof v === "string"),
    check("Brain action", decision?.action, (v) => typeof v === "string"),
    check("regime", decision?.regime, (v) => typeof v === "string"),
    check("structure", decision?.structure ?? market.structure ?? null, (v) => typeof v === "string" && v.length > 0),
    check("setup", decision?.setup, (v) => typeof v === "string"),
    check("trigger", decision?.trigger, (v) => typeof v === "string"),
    check("Consensus", agents?.consensus?.status, (v) => typeof v === "string"),
    check("Quality Score", decision?.qualityScore ?? market.lastSignal?.qualityScore ?? null, (v) => Number.isFinite(Number(v))),
    check("JIT state", entry?.stage ?? null, (v) => typeof v === "string"),
    check("Execution eligibility", market.enabled !== false && derived.state === "WORKING", (v) => v === true),
  ];
  return {
    marketKey: market.marketKey,
    availability: market.availability ?? null,
    enabled: market.enabled !== false,
    derivedState: derived.state,
    derivedReason: derived.reason,
    feedStatus: derived.feedStatus,
    feedReason: derived.feedReason,
    candles5s: market.candles5s ?? null,
    lastTickAgeMs: market.lastTick?.ageMs ?? null,
    lastTickPrice: market.lastTick?.price ?? null,
    activeId: market.activeId ?? null,
    positionStatus: market.positionState?.status ?? null,
    trader: agents?.trader ? { action: agents.trader.action ?? null, confidence: agents.trader.confidence ?? null, regime: agents.trader.regime ?? null } : null,
    critic: agents?.critic ? { verdict: agents.critic.verdict ?? null, finalRecommendation: agents.critic.finalRecommendation ?? null } : null,
    consensus: agents?.consensus ? { status: agents.consensus.status ?? null, action: agents.consensus.action ?? null } : null,
    correlationId: agents?.correlationId ?? null,
    brain: decision ? { action: decision.action ?? null, regime: decision.regime ?? null, setup: decision.setup ?? null, trigger: decision.trigger ?? null, waitReason: decision.waitReason ?? null } : null,
    jit: entry ? { stage: entry.stage ?? null, status: entry.status ?? null, candidateId: entry.candidateId ?? null } : null,
    checks,
    ok: allPass(checks.filter((entry) => entry.status !== "ABSENT")),
    working: derived.state === "WORKING",
  };
}

function contaminationChecks(markets) {
  const findings = [];
  const byKey = new Map();
  for (const market of markets) {
    if (byKey.has(market.marketKey)) findings.push({ code: "DUPLICATE_MARKET_KEY", marketKey: market.marketKey });
    byKey.set(market.marketKey, market);
  }
  const activeIds = new Map();
  const correlationIds = new Map();
  for (const market of markets) {
    if (market.activeId !== null && market.activeId !== undefined) {
      const list = activeIds.get(String(market.activeId)) ?? [];
      list.push(market.marketKey);
      activeIds.set(String(market.activeId), list);
    }
    const correlation = market.correlationId;
    if (correlation) {
      const list = correlationIds.get(correlation) ?? [];
      list.push(market.marketKey);
      correlationIds.set(correlation, list);
    }
  }
  for (const [activeId, keys] of activeIds) {
    if (keys.length > 1) findings.push({ code: "ACTIVE_ID_SHARED", activeId, marketKeys: keys });
  }
  for (const [correlationId, keys] of correlationIds) {
    if (keys.length > 1) findings.push({ code: "CORRELATION_ID_SHARED", correlationId, marketKeys: keys });
  }
  return { ok: findings.length === 0, findings, distinctActiveIds: activeIds.size, distinctCorrelationIds: correlationIds.size };
}

function mdTable(rows, headers) {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  return [head, sep, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const office = await fetchOffice();
  const markets = office.markets;
  const analyses = markets.map((market) => analyzeMarket(market, office));
  const working = analyses.filter((entry) => entry.working);
  const open = analyses.filter((entry) => String(entry.availability ?? "").toUpperCase() === "OPEN");
  const enabled = analyses.filter((entry) => entry.enabled === true);
  const openNotWorking = open.filter((entry) => !entry.working);
  const contamination = contaminationChecks(analyses.map((entry) => ({ ...entry, correlationId: entry.correlationId })));

  const exceptions = openNotWorking.map((entry) => ({
    marketKey: entry.marketKey,
    derivedState: entry.derivedState,
    reason: entry.derivedReason,
    feedStatus: entry.feedStatus,
    feedReason: entry.feedReason,
    enabled: entry.enabled,
    lastTickAgeMs: entry.lastTickAgeMs,
    candles5s: entry.candles5s,
    positionStatus: entry.positionStatus,
    trader: entry.trader?.action ?? null,
    critic: entry.critic?.verdict ?? null,
    consensus: entry.consensus?.status ?? null,
    agentState: entry.brain?.action ?? null,
  }));

  const report = {
    at: new Date().toISOString(),
    baseUrl: BASE_URL,
    mode: office.mode ?? null,
    connection: office.connection ?? null,
    config: {
      jitEnabled: office.config?.jitEnabled === true,
      qualityGateEnabled: office.config?.qualityGateEnabled === true,
      minTradeQualityScore: office.config?.minTradeQualityScore ?? null,
      entryLeadMs: office.config?.entryLeadMs ?? null,
      brainGeneration: office.config?.brainGeneration ?? office.brain?.generation ?? null,
    },
    totals: {
      markets: analyses.length,
      availabilityOpen: open.length,
      enabled: enabled.length,
      working: working.length,
      openButNotWorking: openNotWorking.length,
      workingWithPair: working.filter((entry) => entry.trader && entry.critic).length,
      waitDecisions: working.filter((entry) => entry.brain?.action === "WAIT").length,
    },
    contamination,
    exceptions,
    markets: analyses,
    conclusion: {
      allWorkingPass: working.every((entry) => entry.ok),
      noContamination: contamination.ok,
      everyWorkingHasOwnFeed: working.every((entry) => entry.checks.find((check) => check.label === "feedFresh")?.status === "PASS"),
      everyWorkingHasPair: working.every((entry) => entry.trader && entry.critic),
    },
  };

  const jsonPath = resolve(OUT_DIR, "all-agents-diagnostic.json");
  await writeFile(jsonPath, JSON.stringify(report, null, 2));

  const lines = [];
  lines.push("# OFFICE V3 — ALL-AGENTS DIAGNOSTIC (T10/T11)");
  lines.push("");
  lines.push(`- Fonte real: \`${BASE_URL}/api/iq/office\` em ${report.at}`);
  lines.push(`- Modo: ${report.mode} · conexão: ${office.connection?.connected === true ? "CONECTADO" : "DESCONECTADO"} · brainGeneration=${report.config.brainGeneration ?? "—"}`);
  lines.push(`- JIT=${report.config.jitEnabled} · QualityGate=${report.config.qualityGateEnabled} · minScore=${report.config.minTradeQualityScore ?? "—"} · leadMs=${report.config.entryLeadMs ?? "—"}`);
  lines.push("");
  lines.push("## Contagens");
  lines.push("");
  lines.push(mdTable(
    [
      ["TOTAL", report.totals.markets],
      ["OPEN (broker)", report.totals.availabilityOpen],
      ["ENABLED", report.totals.enabled],
      ["WORKING (OPEN+ENABLED+FEED FRESH)", report.totals.working],
      ["OPEN mas NÃO WORKING", report.totals.openButNotWorking],
      ["WORKING com par trader+critic", report.totals.workingWithPair],
      ["Decisões WAIT (válidas)", report.totals.waitDecisions],
    ],
    ["métrica", "valor"],
  ));
  lines.push("");
  lines.push("## Isolamento");
  lines.push("");
  lines.push(`- ActiveIds distintos: ${contamination.distinctActiveIds} · correlationIds distintos: ${contamination.distinctCorrelationIds}`);
  lines.push(`- Contaminação cruzada: ${contamination.ok ? "NENHUMA" : JSON.stringify(contamination.findings)}`);
  lines.push("");
  lines.push("## OPEN que NÃO está WORKING (T11)");
  lines.push("");
  if (!exceptions.length) {
    lines.push("Nenhum: todo OPEN habilitado com feed fresco está WORKING.");
  } else {
    lines.push(mdTable(
      exceptions.map((entry) => [entry.marketKey, entry.derivedState, entry.reason, entry.feedStatus, entry.feedReason ?? "—", entry.enabled ? "SIM" : "NÃO", `${entry.lastTickAgeMs ?? "—"}ms`, entry.positionStatus ?? "—"]),
      ["marketKey", "estado derivado", "motivo", "feed", "feed reason", "enabled", "lastTick", "posição"],
    ));
  }
  lines.push("");
  lines.push("## WORKING — validação por agente");
  lines.push("");
  const workingRows = working.map((entry) => [
    entry.marketKey,
    entry.trader?.action ?? "—",
    entry.critic?.verdict ?? "—",
    entry.brain?.action ?? "—",
    entry.brain?.regime ?? "—",
    entry.brain?.setup ?? "—",
    entry.brain?.trigger ?? "—",
    entry.consensus?.status ?? "—",
    entry.jit?.stage ?? "—",
    entry.checks.filter((check) => check.status === "FAIL").map((check) => check.label).join(",") || "OK",
  ]);
  lines.push(mdTable(
    workingRows,
    ["marketKey", "Trader", "Critic", "Brain", "regime", "setup", "trigger", "Consensus", "JIT", "falhas"],
  ));
  lines.push("");
  lines.push("## Conclusão");
  lines.push("");
  lines.push(`- Todos os WORKING com par Trader+Critic: ${report.conclusion.everyWorkingHasPair}`);
  lines.push(`- Todos os WORKING com feed próprio fresco: ${report.conclusion.everyWorkingHasOwnFeed}`);
  lines.push(`- Sem contaminação cruzada: ${report.conclusion.noContamination}`);
  lines.push(`- WORKING 100% PASS: ${report.conclusion.allWorkingPass}`);
  const mdPath = resolve(OUT_DIR, "all-agents-diagnostic.md");
  await writeFile(mdPath, lines.join("\n"));
  console.log(`[agents-diagnostic] ${JSON.stringify(report.totals)}`);
  console.log(`[agents-diagnostic] exceções: ${exceptions.length} · contaminação: ${contamination.ok ? "NENHUMA" : "SIM"}`);
  console.log(`[agents-diagnostic] wrote ${jsonPath}`);
  console.log(`[agents-diagnostic] wrote ${mdPath}`);
  if (!contamination.ok || !report.conclusion.everyWorkingHasPair) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[agents-diagnostic] falhou: ${String(error?.message ?? error)}`);
  process.exitCode = 1;
});
