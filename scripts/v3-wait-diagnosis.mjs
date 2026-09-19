/**
 * v3-wait-diagnosis (READ-ONLY, diagnostico)
 *
 * Consulta iq_scenario_shadow_observations + iq_scenario_timing_intersections no
 * Postgres (DATABASE_URL) e decompoe POR QUE o SCENARIO_ENGINE_V3_SHADOW termina em WAIT
 * enquanto o G2 (CURRENT_G2) tem acao TRADE. NAO altera nada, NAO envia ordem, NAO toca a V3.
 *
 * Uso:
 *   DATABASE_URL=... node scripts/v3-wait-diagnosis.mjs [--since ISO] [--out caminho] [--samples N]
 */
import pg from "pg";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const { Pool } = pg;

function arg(name, fallback = null) {
  const hit = process.argv.find((item) => item === name || item.startsWith(`${name}=`));
  if (!hit) return fallback;
  if (hit.startsWith(`${name}=`)) return hit.slice(name.length + 1);
  const idx = process.argv.indexOf(hit);
  return process.argv[idx + 1] ?? fallback;
}
const flag = (name) => process.argv.includes(name);

function bump(map, key) {
  const k = key ?? "NULL";
  map[k] = (map[k] ?? 0) + 1;
}
function top(map, n = 25) {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count }));
}
function arr(text) {
  if (Array.isArray(text)) return text.map(String);
  if (typeof text === "string" && text.trim()) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {}
    return [text];
  }
  return [];
}
function arr2(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return [];
}
const asObj = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const asBool = (value) => (typeof value === "boolean" ? value : null);
const asStr = (value) => (value == null ? null : String(value));
const asNum = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const asFinite = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

const G2_TRADE = new Set(["BUY", "SELL", "CALL", "PUT", "TRADE"]);
const isTrade = (action) => G2_TRADE.has(String(action ?? "").toUpperCase());
const isWaitAction = (action) => String(action ?? "").toUpperCase() === "WAIT";

async function main() {
  const since = arg("--since", "2026-09-01T00:00:00Z");
  const outPath = arg("--out", null);
  const sampleN = Number(arg("--samples", "0")) || 0;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(JSON.stringify({ error: "DATABASE_URL missing" }));
    process.exit(2);
  }
  const pool = new Pool({ connectionString: databaseUrl, ssl: /sslmode=require/i.test(databaseUrl) ? { rejectUnauthorized: false } : undefined });
  const report = { schema: "v3-wait-diagnosis-v1", generatedAt: new Date().toISOString(), since, readOnly: true, errors: [] };
  try {
    const cols = (await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='iq_scenario_shadow_observations' ORDER BY ordinal_position`,
    )).rows.map((row) => row.column_name);
    report.columns = cols;

    const totals = (await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE settlement_basis IS NULL)::int AS basis_null,
              count(*) FILTER (WHERE outcome IS NULL)::int AS outcome_null,
              count(*) FILTER (WHERE final_action='WAIT')::int AS wait_rows,
              count(*) FILTER (WHERE provenance='PROSPECTIVE')::int AS prospective,
              min(created_at) AS min_created, max(created_at) AS max_created
         FROM iq_scenario_shadow_observations WHERE created_at >= $1`,
      [since],
    )).rows[0];
    report.totals = totals;

    const rows = (await pool.query(
      `SELECT observation_id, created_at, provenance, settlement_basis, final_action, direction,
              current_decision, scenario_decision, trader_scenario, critic_scenario, critic_freeze,
              comparison, divergence, persistence, ablation, stages, transitions,
              scenario_at_candidate, scenario_at_revalidation1, scenario_at_revalidation2, scenario_at_final_entry,
              scenario_changed, scenario_change_count, playbook_at_candidate, playbook_at_entry,
              reasons_for_wait, t0, engine_info, outcome, broker_result, broker_profit, theoretical_result, theoretical_pnl,
              market_key, market_type, target_entry_at, target_expiry_at, candidate_at, correlation_id, candidate_id
         FROM iq_scenario_shadow_observations WHERE created_at >= $1 ORDER BY created_at`,
      [since],
    )).rows;

    const intersections = (await pool.query(
      `SELECT verdict, late_outcome, late_verdict, intersection_codes, scenario_final_action, created_at, candidate_id
         FROM iq_scenario_timing_intersections WHERE created_at >= $1`,
      [since],
    )).rows;

    const g2Trade = rows.filter((row) => isTrade(asObj(row.current_decision).action ?? row.direction));
    const g2TradeV3Wait = g2Trade.filter((row) => isWaitAction(row.final_action));

    report.crosstab = {
      observations: rows.length,
      g2Trade: g2Trade.length,
      g2TradeV3Wait: g2TradeV3Wait.length,
      g2TradeV3Entry: g2Trade.length - g2TradeV3Wait.length,
      byProvenance: Object.fromEntries(top(rows.reduce((m, r) => { bump(m, r.provenance); return m; }, {}), 10).map((e) => [e.key, e.count])),
      byBasis: Object.fromEntries(top(rows.reduce((m, r) => { bump(m, r.settlement_basis); return m; }, {}), 10).map((e) => [e.key, e.count])),
      byFinalAction: Object.fromEntries(top(rows.reduce((m, r) => { bump(m, r.final_action); return m; }, {}), 10).map((e) => [e.key, e.count])),
      byG2Action: Object.fromEntries(top(rows.reduce((m, r) => { const d = asObj(r.current_decision); bump(m, d.action ?? "NULL"); return m; }, {}), 10).map((e) => [e.key, e.count])),
    };

    const decomposition = {
      finalAction: top(rows.reduce((m, r) => { bump(m, r.final_action); return m; }, {})),
      waitReasons: top(rows.reduce((m, r) => { for (const reason of arr(r.reasons_for_wait)) bump(m, reason); return m; }, {}), 40),
      waitReasonsG2Trade: top(g2TradeV3Wait.reduce((m, r) => { for (const reason of arr(r.reasons_for_wait)) bump(m, reason); return m; }, {}), 40),
      scenarioAtCandidate: top(rows.reduce((m, r) => { bump(m, r.scenario_at_candidate); return m; }, {}), 30),
      scenarioAtCandidateG2TradeWait: top(g2TradeV3Wait.reduce((m, r) => { bump(m, r.scenario_at_candidate); return m; }, {}), 30),
      scenarioAtFinalEntry: top(rows.reduce((m, r) => { bump(m, r.scenario_at_final_entry); return m; }, {}), 30),
      scenarioChanged: top(rows.reduce((m, r) => { bump(m, r.scenario_changed); return m; }, {}), 5),
      divergenceLabels: top(rows.reduce((m, r) => { const d = asObj(r.divergence); bump(m, d.divergence ?? d.label ?? "NULL"); return m; }, {}), 20),
      divergenceG2TradeWait: top(g2TradeV3Wait.reduce((m, r) => { const d = asObj(r.divergence); bump(m, d.divergence ?? d.label ?? "NULL"); return m; }, {}), 20),
      criticAction: top(rows.reduce((m, r) => { const c = asObj(r.critic_scenario); bump(m, c.action ?? asObj(c.scenario).action ?? "NULL"); return m; }, {}), 10),
      criticActionG2TradeWait: top(g2TradeV3Wait.reduce((m, r) => { const c = asObj(r.critic_scenario); bump(m, c.action ?? asObj(c.scenario).action ?? "NULL"); return m; }, {}), 10),
      traderActionG2TradeWait: top(g2TradeV3Wait.reduce((m, r) => { const t = asObj(r.trader_scenario); bump(m, t.action ?? asObj(t.scenario).action ?? "NULL"); return m; }, {}), 10),
      engineMode: top(rows.reduce((m, r) => { const e = asObj(r.engine_info); bump(m, e.mode ?? "NULL"); return m; }, {}), 5),
      engineFallback: top(rows.reduce((m, r) => { const e = asObj(r.engine_info); const f = asObj(e.engineFallback ?? e.fallback); bump(m, f.active ?? "NULL"); return m; }, {}), 5),
      direction: top(rows.reduce((m, r) => { bump(m, r.direction); return m; }, {}), 5),
      marketType: top(rows.reduce((m, r) => { bump(m, r.market_type); return m; }, {}), 5),
      finalActionByMarketType: top(g2TradeV3Wait.reduce((m, r) => { bump(m, `${r.market_type}:${r.final_action}`); return m; }, {}), 10),
      comparisonAgreement: top(g2TradeV3Wait.reduce((m, r) => { bump(m, r.comparison?.agreement ?? "NULL"); return m; }, {}), 5),
      comparisonPoints: top(g2TradeV3Wait.reduce((m, r) => {
        const pts = asObj(r.comparison).points;
        if (pts && typeof pts === "object" && !Array.isArray(pts)) for (const [k, v] of Object.entries(pts)) bump(m, `${k}=${asObj(v).state ?? v}`);
        return m;
      }, {}), 40),
      missingFeatures: top(g2TradeV3Wait.reduce((m, r) => {
        const pts = asObj(r.comparison).points;
        if (pts && typeof pts === "object" && !Array.isArray(pts)) for (const [k, v] of Object.entries(pts)) if (asObj(v).state === "UNKNOWN" || asObj(v).value === null) bump(m, k);
        return m;
      }, {}), 20),
    };

    report.decomposition = decomposition;

    // Decompose scenario_decision (V3) structure
    const scenarioKeys = {};
    for (const row of rows.slice(0, 200)) {
      const sd = asObj(row.scenario_decision);
      for (const [k, v] of Object.entries(sd)) {
        if (!(k in scenarioKeys)) scenarioKeys[k] = typeof v;
      }
    }
    report.scenarioDecisionKeys = scenarioKeys;
    const traderKeys = {};
    for (const row of rows.slice(0, 200)) {
      const td = asObj(row.trader_scenario);
      for (const [k, v] of Object.entries(td)) if (!(k in traderKeys)) traderKeys[k] = typeof v;
    }
    report.traderScenarioKeys = traderKeys;
    const criticKeys = {};
    for (const row of rows.slice(0, 200)) {
      const cd = asObj(row.critic_scenario);
      for (const [k, v] of Object.entries(cd)) if (!(k in criticKeys)) criticKeys[k] = typeof v;
    }
    report.criticScenarioKeys = criticKeys;

    // reason decomposition by (scenarioAtCandidate, finalAction) for G2 trade
    const reasonMatrix = {};
    for (const row of g2TradeV3Wait) {
      const key = `${row.scenario_at_candidate}|${row.final_action}`;
      reasonMatrix[key] = reasonMatrix[key] ?? {};
      for (const reason of arr(row.reasons_for_wait)) bump(reasonMatrix[key], reason);
    }
    report.reasonMatrixG2Trade = Object.fromEntries(Object.entries(reasonMatrix).map(([k, v]) => [k, top(v, 15)]));

    report.intersections = {
      total: intersections.length,
      byVerdict: top(intersections.reduce((m, r) => { bump(m, r.verdict); return m; }, {}), 10),
      byLateOutcome: top(intersections.reduce((m, r) => { bump(m, r.late_outcome); return m; }, {}), 10),
      codes: top(intersections.reduce((m, r) => { for (const c of arr(r.intersection_codes)) bump(m, c); return m; }, {}), 30),
      scenarioFinalAction: top(intersections.reduce((m, r) => { bump(m, r.scenario_final_action); return m; }, {}), 10),
    };

    // ------------------------------------------------------------------ diagnosis (persisted, no replay)
    const diagnosis = {
      note: "Causa decomposta a partir do traderScenario/criticScenario persistidos + estagios; FACT no relatorio.",
      traderEntryEligible: top(rows.reduce((m, r) => { const t = asObj(r.trader_scenario); const p = asObj(t.playbook); bump(m, p.entryEligible ?? t.entryEligible ?? "NULL"); return m; }, {}), 5),
      traderAction: top(rows.reduce((m, r) => { bump(m, asObj(r.trader_scenario).action); return m; }, {}), 5),
      traderPlaybookAction: top(rows.reduce((m, r) => { bump(m, asObj(asObj(r.trader_scenario).playbook).action); return m; }, {}), 5),
      traderPrimaryScenario: top(rows.reduce((m, r) => { bump(m, asObj(r.trader_scenario).primaryScenario); return m; }, {}), 10),
      traderSecondaryScenario: top(rows.reduce((m, r) => { bump(m, asObj(r.trader_scenario).secondaryScenario); return m; }, {}), 10),
      traderAmbiguous: top(rows.reduce((m, r) => { bump(m, asObj(r.trader_scenario).ambiguous); return m; }, {}), 5),
      traderRegime: top(rows.reduce((m, r) => { bump(m, asObj(r.trader_scenario).marketRegime); return m; }, {}), 10),
      criticPrimaryScenario: top(rows.reduce((m, r) => { bump(m, asObj(r.critic_scenario).primaryScenario); return m; }, {}), 10),
      criticAction: top(rows.reduce((m, r) => { bump(m, asObj(r.critic_scenario).action); return m; }, {}), 5),
      criticRegime: top(rows.reduce((m, r) => { bump(m, asObj(r.critic_scenario).marketRegime); return m; }, {}), 10),
      traderInvalidations: top(rows.reduce((m, r) => { for (const reason of arr(asObj(r.trader_scenario).invalidationReasons)) bump(m, reason); return m; }, {}), 40),
      traderPlaybookInvalidations: top(rows.reduce((m, r) => { for (const reason of arr(asObj(asObj(r.trader_scenario).playbook).invalidations)) bump(m, reason); return m; }, {}), 40),
      traderGovernanceFor: top(rows.reduce((m, r) => { for (const reason of arr(asObj(r.trader_scenario).scenarioEvidenceFor)) if (String(reason).startsWith("GOVERNANCE_") || String(reason).startsWith("AMBIGUOUS") || String(reason).startsWith("AMBIGUOUS_")) bump(m, reason); return m; }, {}), 20),
      traderEvidenceAgainstTags: top(rows.reduce((m, r) => { for (const reason of arr(asObj(r.trader_scenario).scenarioEvidenceAgainst)) bump(m, reason); return m; }, {}), 40),
      traderTriggerState: top(rows.reduce((m, r) => { bump(m, asObj(r.trader_scenario).triggerState); return m; }, {}), 15),
      traderLocationState: top(rows.reduce((m, r) => { bump(m, asObj(r.trader_scenario).locationState); return m; }, {}), 15),
      traderMomentumState: top(rows.reduce((m, r) => { bump(m, asObj(r.trader_scenario).momentumState); return m; }, {}), 10),
      traderStructureState: top(rows.reduce((m, r) => { bump(m, asObj(r.trader_scenario).structureState); return m; }, {}), 10),
      traderVolatilityState: top(rows.reduce((m, r) => { bump(m, asObj(r.trader_scenario).volatilityState); return m; }, {}), 10),
      traderMicrostructureState: top(rows.reduce((m, r) => { bump(m, asObj(r.trader_scenario).microstructureState); return m; }, {}), 10),
      traderTrendState: top(rows.reduce((m, r) => { bump(m, asObj(r.trader_scenario).trendState); return m; }, {}), 10),
      traderUnavailable: top(rows.reduce((m, r) => { for (const feature of arr(asObj(r.trader_scenario).unavailable)) bump(m, feature); return m; }, {}), 30),
      traderEngineError: rows.filter((row) => asObj(row.trader_scenario).engineError != null).length,
      traderDegradedToFallback: rows.filter((row) => asObj(row.trader_scenario).degradedToFallback === true).length,
      emptyReasonsForWait: rows.filter((row) => arr(row.reasons_for_wait).length === 0).length,
      nonEmptyReasonsForWait: rows.filter((row) => arr(row.reasons_for_wait).length > 0).length,
      emptyReasonsByStageCount: top(rows.filter((row) => arr(row.reasons_for_wait).length === 0).reduce((m, r) => { const stages = arr2(r.stages); bump(m, stages.length); return m; }, {}), 6),
      directionFlipAttempts: rows.filter((row) => asObj(row.scenario_decision).directionFlipAttempted === true).length,
      cancelled: rows.filter((row) => asObj(row.scenario_decision).cancelled === true).length,
      cancelReasons: top(rows.reduce((m, r) => { bump(m, asObj(r.scenario_decision).cancelReason); return m; }, {}), 10),
      divergenceFromColumn: top(rows.reduce((m, r) => { const d = asObj(r.divergence); bump(m, d.divergence ?? "NULL"); return m; }, {}), 10),
      conflictFromColumn: top(rows.reduce((m, r) => { const d = asObj(r.divergence); bump(m, d.conflict ?? "NULL"); return m; }, {}), 10),
      stagesByAction: top(rows.reduce((m, r) => { for (const stage of arr2(r.stages)) bump(m, `${asObj(stage).stage}:${asObj(stage).action}:${asObj(stage).scenario}`); return m; }, {}), 30),
      scenarioChangedByStage: top(rows.reduce((m, r) => { for (const stage of arr2(r.stages)) if (asObj(stage).changedFromPrevious != null) bump(m, `${asObj(stage).stage}:changed=${asObj(stage).changedFromPrevious}`); return m; }, {}), 10),
    };
    report.diagnosis = diagnosis;

    if (flag("--replay")) {
      const replay = {
        attempted: 0, matchedAction: 0, matchedScenario: 0, matchedRegime: 0, mismatches: [], sampleSize: 0,
        note: "Replay offline do MOTOR REAL congelado sobre o t0 persistido (analyzeScenarioSnapshot + engine real). Prova reprodutibilidade; o motor nao e alterado.",
        counterfactual: { note: "What-if DIAGNOSTICO: reenvia velocity/acceleration (existentes no t0, mas descartados por buildScenarioFeatures) e conta mudanca de regime/acao. Nao altera arquivos.", attempted: 0 },
      };
      try {
        const shadowModule = await import("../relay/scenario-shadow.mjs");
        const engineModule = await import("../relay/scenario-engine.mjs");
        const analyze = shadowModule.analyzeScenarioSnapshot;
        const buildScenarioFeatures = shadowModule.buildScenarioFeatures;
        const engine = engineModule;
        const limit = flag("--replay-all") ? Infinity : 400;
        for (const row of rows) {
          if (replay.attempted >= limit) break;
          replay.attempted += 1;
          try {
            const direction = row.direction;
            const t0 = asObj(row.t0);
            const analysis = analyze({ snapshot: t0, direction, engine });
            const persisted = asObj(row.trader_scenario);
            if (analysis.action === persisted.action) replay.matchedAction += 1;
            if (analysis.primaryScenario === persisted.primaryScenario) replay.matchedScenario += 1;
            if (analysis.marketRegime === persisted.marketRegime) replay.matchedRegime += 1;
            if ((analysis.action !== persisted.action || analysis.primaryScenario !== persisted.primaryScenario) && replay.mismatches.length < 10) {
              replay.mismatches.push({
                observationId: row.observation_id,
                replayAction: analysis.action, persistedAction: persisted.action,
                replayScenario: analysis.primaryScenario, persistedScenario: persisted.primaryScenario,
              });
            }
            const built = buildScenarioFeatures(t0, { direction });
            const momentum = asObj(t0.momentum);
            const velocity = asFinite(momentum.velocity);
            const acceleration = asFinite(momentum.acceleration);
            if (velocity !== null || acceleration !== null) {
              replay.counterfactual.attempted += 1;
              const enriched = { ...built.features };
              if (velocity !== null) enriched.velocity = velocity;
              if (acceleration !== null) enriched.acceleration = acceleration;
              const cfContext = engine.extractContext({ snapshot: t0, direction, features: enriched });
              const cfRegime = engine.classifyRegime(cfContext);
              const cfAnalysis = engine.analyzeScenario({ snapshot: t0, direction, features: enriched });
              replay.counterfactual.regimeChanged = (replay.counterfactual.regimeChanged ?? 0) + (cfRegime.regime !== analysis.marketRegime ? 1 : 0);
              replay.counterfactual.regimeCounts = replay.counterfactual.regimeCounts ?? {};
              bump(replay.counterfactual.regimeCounts, cfRegime.regime);
              replay.counterfactual.actionChanged = (replay.counterfactual.actionChanged ?? 0) + (cfAnalysis.action !== analysis.action ? 1 : 0);
              replay.counterfactual.actionCounts = replay.counterfactual.actionCounts ?? {};
              bump(replay.counterfactual.actionCounts, cfAnalysis.action);
            }
          } catch (error) {
            if (replay.mismatches.length < 10) replay.mismatches.push({ observationId: row.observation_id, error: String(error?.message ?? error) });
          }
        }
        replay.sampleSize = replay.attempted;
        replay.actionMatchRate = replay.attempted ? +(replay.matchedAction / replay.attempted).toFixed(4) : null;
        replay.scenarioMatchRate = replay.attempted ? +(replay.matchedScenario / replay.attempted).toFixed(4) : null;
        replay.regimeMatchRate = replay.attempted ? +(replay.matchedRegime / replay.attempted).toFixed(4) : null;
      } catch (error) {
        replay.error = String(error?.message ?? error);
      }
      report.replay = replay;
    }

    report.settlement = {
      basisNull: rows.filter((row) => row.settlement_basis == null).length,
      outcomeNull: rows.filter((row) => row.outcome == null).length,
      outcomePresent: rows.filter((row) => row.outcome != null).length,
      theoreticalResult: top(rows.reduce((m, r) => { bump(m, r.theoretical_result); return m; }, {}), 10),
      brokerResult: top(rows.reduce((m, r) => { bump(m, r.broker_result); return m; }, {}), 10),
      settledWithTargetExpiry: rows.filter((row) => row.outcome != null && row.target_expiry_at != null).length,
      unsettledWithTargetExpiry: rows.filter((row) => row.outcome == null && row.target_expiry_at != null).length,
      unsettledPastExpiry: rows.filter((row) => row.outcome == null && row.target_expiry_at != null && new Date(row.target_expiry_at).getTime() < Date.now()).length,
    };

    // Lifecycle: which stages present
    report.stages = {
      byStage: top(rows.reduce((m, r) => { for (const s of arr(r.stages).length ? r.stages : []) bump(m, asObj(s).stage ?? asObj(s).status ?? "NULL"); return m; }, {}), 10),
      persistenceKeys: Object.fromEntries(Object.entries(asObj(rows[0]?.persistence)).map(([k, v]) => [k, typeof v])),
    };

    const stats = {};
    for (const row of rows) {
      const sd = asObj(row.scenario_decision);
      for (const [k, v] of Object.entries(sd)) {
        if (typeof v === "string" && (k === "action" || k.endsWith("Reason") || k.endsWith("reason") || k.endsWith("Scenario") || k.endsWith("Regime"))) bump(stats[k] ??= {}, v);
      }
    }
    report.scenarioDecisionStringFields = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, top(v, 15)]));

    if (sampleN > 0) {
      report.samples = g2TradeV3Wait.slice(0, sampleN).map((row) => ({
        observationId: row.observation_id,
        createdAt: row.created_at,
        direction: row.direction,
        finalAction: row.final_action,
        scenarioAtCandidate: row.scenario_at_candidate,
        scenarioAtFinalEntry: row.scenario_at_final_entry,
        reasonsForWait: arr(row.reasons_for_wait),
        currentDecision: row.current_decision,
        scenarioDecision: row.scenario_decision,
        traderScenario: row.trader_scenario,
        criticScenario: row.critic_scenario,
        divergence: row.divergence,
        comparison: row.comparison,
        engineInfo: row.engine_info,
        persistence: row.persistence,
        targetExpiryAt: row.target_expiry_at,
      }));
    }
  } catch (error) {
    report.errors.push(String(error?.message ?? error));
  } finally {
    await pool.end().catch(() => {});
  }
  const text = JSON.stringify(report, null, 2);
  if (outPath) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, text);
    console.log(JSON.stringify({ ok: report.errors.length === 0, out: outPath }));
  } else {
    console.log(text);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: String(error?.message ?? error) }));
  process.exit(1);
});
