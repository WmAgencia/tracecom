/**
 * SIGNAL LATENCY PROBE — mede latencia real do sinal em 3 trechos:
 *  A) identificacao de cenario (SCENARIO_AGENT V4 + V3 congelada)
 *  B) a "conta" (especialistas + synthesis + red team, V4 completo)
 *  C) envio (caminho de producao: candidato -> JIT -> send -> ACK, lido dos endpoints reais)
 *
 * Usa 5 T0 REAIS por versao (payload persistido), com repeticao para warm-up. Read-only.
 * Uso: DATABASE_URL=... node scripts/signal-latency-probe.mjs
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.TRACECOM_BASE ?? "https://tracecom.consecom.com.br";
const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, "relay", "package.json"));
const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, ssl: { rejectUnauthorized: false } });

const v4 = await import(new URL("../relay/agents-v4/index.mjs", import.meta.url));
const shadow = await import(new URL("../relay/scenario-shadow.mjs", import.meta.url));

const now = () => Number(process.hrtime.bigint()) / 1e6;
const ms = (value) => Number(value.toFixed(3));
const summary = (values) => {
  const list = [...values].sort((a, b) => a - b);
  const mean = list.reduce((a, b) => a + b, 0) / list.length;
  return { mean: ms(mean), min: ms(list[0]), max: ms(list[list.length - 1]), p50: ms(list[Math.floor(list.length / 2)]) };
};

async function loadT0s() {
  const v4Rows = await pool.query(`SELECT observation_id, market_key, payload->'t0' AS t0 FROM iq_agents_v4_observations WHERE payload ? 't0' ORDER BY created_at DESC LIMIT 5`);
  const v3Rows = await pool.query(`SELECT candidate_id, t0 FROM iq_scenario_shadow_observations WHERE t0 IS NOT NULL ORDER BY created_at DESC LIMIT 5`);
  return { v4: v4Rows.rows.filter((row) => row.t0), v3: v3Rows.rows.filter((row) => row.t0) };
}

async function measureV4(t0s) {
  const engine = new v4.AgentsV4Engine();
  const runs = [];
  for (const row of t0s) {
    for (let repetition = 0; repetition < 1; repetition += 1) {
      const started = now();
      const result = engine.analyze({ t0: row.t0 });
      const totalMs = now() - started;
      runs.push({
        marketKey: row.market_key, observationId: row.observation_id,
        scenarioMs: result.latency.scenarioMs, specialistsMs: result.latency.specialistsMs,
        synthesisMs: result.latency.synthesisMs, redTeamMs: result.latency.redTeamMs,
        totalMs: ms(totalMs), scenario: result.scenario.primary, action: result.finalAction,
      });
    }
  }
  // repeticao do primeiro T0 (5x) para exemplos e efeito de warm-up
  const repeat = [];
  if (t0s[0]) {
    const engine2 = new v4.AgentsV4Engine();
    for (let index = 0; index < 5; index += 1) {
      const started = now();
      const result = engine2.analyze({ t0: t0s[0].t0 });
      repeat.push({ run: index + 1, scenarioMs: result.latency.scenarioMs, totalMs: ms(now() - started), scenario: result.scenario.primary });
    }
  }
  return { runs, repeat };
}

async function measureV3(t0s) {
  const runs = [];
  for (const row of t0s) {
    const started = now();
    const analysis = shadow.analyzeScenarioSnapshot({ snapshot: row.t0, direction: row.t0?.direction ?? null });
    runs.push({ candidateId: row.candidate_id, identifyMs: ms(now() - started), scenario: analysis.primaryScenario, regime: analysis.marketRegime, action: analysis.action });
  }
  return runs;
}

async function productionSendLatency() {
  const out = {};
  for (const [key, endpoint] of [["entry", "/api/iq/entry"], ["agentsV4", "/api/iq/research/agents-v4"], ["executions", "/api/iq/executions?limit=5"]]) {
    try {
      const response = await fetch(`${BASE}${endpoint}`, { signal: AbortSignal.timeout(40_000) });
      const body = await response.json();
      out[key] = key === "executions" ? (body.executions ?? []).map((row) => ({ executionId: row.execution_id ?? row.executionId, meta: row.meta ?? null, state: row.state, ackAt: row.acked_at ?? row.ackAt ?? null })) : body;
    } catch (error) { out[key] = { error: String(error?.message ?? error).slice(0, 120) }; }
  }
  return out;
}

try {
  const { v4: v4T0s, v3: v3T0s } = await loadT0s();
  const v4Latency = await measureV4(v4T0s);
  const v3Latency = await measureV3(v3T0s);
  const production = await productionSendLatency();
  const report = {
    schema: "signal-latency-probe-v1", generatedAtUtc: new Date().toISOString(),
    counts: { v4T0s: v4T0s.length, v3T0s: v3T0s.length },
    v4: { runs: v4Latency.runs, repeat: v4Latency.repeat, summary: { scenario: summary(v4Latency.runs.map((r) => r.scenarioMs)), specialists: summary(v4Latency.runs.map((r) => r.specialistsMs)), synthesis: summary(v4Latency.runs.map((r) => r.synthesisMs)), redTeam: summary(v4Latency.runs.map((r) => r.redTeamMs)), total: summary(v4Latency.runs.map((r) => r.totalMs)) } },
    v3: { runs: v3Latency, summary: summary(v3Latency.map((r) => r.identifyMs)) },
    productionSend: {
      entryStatus: production.entry?.latency ?? production.entry?.latencySummary ?? production.entry,
      agentsV4Latency: production.agentsV4?.latencyMs ?? null,
      recentExecutions: production.executions,
    },
    researchOnly: true, controlsExecution: false,
  };
  const outPath = path.join(ROOT, "docs/research/data/signal-latency-probe.json");
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 1)}\n`);
  console.log("V4 por snapshot (ms):");
  for (const run of v4Latency.runs) console.log(` ${run.marketKey} cenario=${run.scenarioMs} especialistas=${run.specialistsMs} sintese=${run.synthesisMs} redteam=${run.redTeamMs} total=${run.totalMs} -> ${run.action} (${run.scenario})`);
  console.log("V4 repeticao 5x (mesmo T0):", JSON.stringify(v4Latency.repeat));
  console.log("V4 resumo:", JSON.stringify(report.v4.summary));
  console.log("V3 por snapshot:", v3Latency.map((r) => `${r.identifyMs}ms ${r.scenario}`).join(" | "));
  console.log("V3 resumo:", JSON.stringify(report.v3.summary));
  console.log("PRODUCAO entry latency:", JSON.stringify(report.productionSend.entryStatus).slice(0, 400));
  console.log("PRODUCAO v4 latency:", JSON.stringify(report.productionSend.agentsV4Latency).slice(0, 300));
  console.log("WROTE", outPath);
} catch (error) {
  console.error("SIGNAL_LATENCY_FAILED", String(error?.message ?? error).slice(0, 300));
  process.exitCode = 1;
} finally {
  await pool?.end?.().catch(() => undefined);
}
