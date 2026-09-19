/**
 * RESEARCH LAB API — endpoints do laboratorio (GET/POST), somente leitura de dados e jobs de pesquisa.
 * Nao controla execucao; REAL allowlist intocado.
 */
import { RESEARCH_POLICY, assertResearchOnly } from "./contracts.mjs";
import { factorRegistry, factorCatalogManifest, evaluateFactor } from "./factors/index.mjs";
import { buildFactorRegistry } from "./factors/index.mjs";
import { benchmarkSummary } from "./bench.mjs";
import { auditFeatureCoverage } from "./coverage-audit.mjs";
import { runBinaryBacktest, untouchedHoldout, purgedKFold, walkForward, cpcv, bootstrapValidation, VALIDATION_POLICY } from "./backtest.mjs";
import { buildStrategyRegimeDatabase, ResearchRegistries, EVIDENCE_POLICY } from "./registries.mjs";
import { journalIntelligence, driftReport, reliabilityBins, mlLabStatus, CALIBRATION_VERSION } from "./intelligence.mjs";
import { runResearchDag, RESEARCH_AGENT_IDS } from "./agents.mjs";
import { ResearchJobQueue, DEFAULT_RESOURCE_LIMITS } from "./jobs.mjs";
import { v4DirectionalCheckpoints, CHECKPOINT_LEVELS } from "./checkpoints.mjs";
import { buildSnapshotMeta } from "./snapshot.mjs";
import { ablationMatrix, ABLATION_COMPONENTS } from "./ablation.mjs";

export const RESEARCH_API_VERSION = "research-lab-api-v1";

export class ResearchLab {
  constructor({ pool = null, runtime = null, now = () => Date.now(), log = () => {} } = {}) {
    this.pool = pool; this.runtime = runtime; this.now = now; this.log = log;
    this.registries = new ResearchRegistries({ pool, now });
    this.jobs = new ResearchJobQueue({ pool, now, concurrency: DEFAULT_RESOURCE_LIMITS.concurrency, timeoutMs: DEFAULT_RESOURCE_LIMITS.timeoutMs, log });
  }

  /** Linhas de observacao prospectiva com T0 + settlement. */
  async observations(limit = 500) {
    if (!this.pool?.query) return [];
    try {
      const rows = await this.pool.query(
        `SELECT observation_id, market_key, market_type, account_context, direction, final_action, data_quality, regime, scenario,
                payload->'t0' AS t0, payload->'router' AS router, payload->'redTeam' AS red_team,
                theoretical_result, settlement_basis, payload->'synthesis'->>'triggerState' AS trigger_state, created_at, target_expiry_at, updated_at
           FROM iq_agents_v4_observations ORDER BY created_at DESC LIMIT $1`,
        [Math.max(1, Math.min(2000, Number(limit) || 500))],
      );
      return rows.rows.map((row) => ({
        observationId: row.observation_id, id: row.observation_id, marketKey: row.market_key, marketType: row.market_type,
        accountContext: row.account_context, direction: row.direction, finalAction: row.final_action, dataQuality: row.data_quality,
        regime: row.regime, scenario: row.scenario, t0: row.t0, router: row.router, redTeam: row.red_team,
        theoreticalResult: row.theoretical_result, result: row.theoretical_result, settlementBasis: row.settlement_basis,
        triggerState: row.trigger_state, createdAt: new Date(row.created_at).getTime(), targetExpiryAt: Number(row.target_expiry_at),
        provenance: row.settlement_basis === "CAUSAL_COUNTERFACTUAL" ? "PROSPECTIVE_SHADOW" : "PROSPECTIVE",
      }));
    } catch { return []; }
  }

  snapshotMetaOf(rows, source) {
    const times = rows.map((row) => Number(row.createdAt)).filter(Number.isFinite).sort((a, b) => a - b);
    return buildSnapshotMeta({ asOf: times.at(-1) ?? this.now(), windowStart: times[0] ?? null, windowEnd: times.at(-1) ?? null, n: rows.length, source, datasetVersion: `prospective-${rows.length}` });
  }

  async handleGet(pathname, params) {
    const route = pathname.replace("/api/iq/research/lab", "") || "/overview";
    const limit = Number(params?.get?.("limit")) || 500;
    const rows = await this.observations(limit);
    switch (route) {
      case "/overview": {
        const settled = rows.filter((row) => row.settlementBasis);
        return { researchOnly: true, policy: RESEARCH_POLICY, version: RESEARCH_API_VERSION, snapshot: this.snapshotMetaOf(rows, "PROSPECTIVE_SHADOW"), counts: { observations: rows.length, settled: settled.length, directional: settled.filter((row) => row.direction === "BUY" || row.direction === "SELL").length, waits: rows.filter((row) => row.finalAction === "WAIT" || row.finalAction === "NO_TRADE").length }, factors: factorCatalogManifest().counts, jobs: this.jobs.status(), checkpointLevels: [...CHECKPOINT_LEVELS] };
      }
      case "/factors": return { researchOnly: true, snapshot: this.snapshotMetaOf(rows, "CATALOG"), manifest: factorCatalogManifest() };
      case "/alphas": {
        const registry = factorRegistry();
        const marketType = params?.get?.("marketType") ?? "OTC";
        const factors = registry.list().slice(0, Math.max(1, Math.min(120, Number(params?.get?.("factors")) || 40)));
        const bench = benchmarkSummary({ rows: rows.filter((row) => row.t0), factors, marketType, source: "PROSPECTIVE_SHADOW", datasetVersion: `prospective-${rows.length}` });
        return { researchOnly: true, bench };
      }
      case "/coverage": return { researchOnly: true, audit: auditFeatureCoverage(rows.map((row) => row.t0).filter(Boolean), { source: "PROSPECTIVE_SHADOW", datasetId: "agents-v4-observations" }) };
      case "/backtests": {
        const preview = runBinaryBacktest({ rows: rows.map(toBacktestRow).filter(Boolean), payoutOptions: { payout: Number(params?.get?.("payout")) || null }, executionOptions: { lateWindow: params?.get?.("lateWindow") === "1" } });
        const purged = purgedKFold(rows.map(toBacktestRow).filter(Boolean));
        const holdout = untouchedHoldout(rows.map(toBacktestRow).filter(Boolean));
        return { researchOnly: true, preview: { metrics: preview.metrics, meta: preview.meta }, validation: { purged, holdout, walkForward: walkForward(rows.map(toBacktestRow).filter(Boolean)), cpcv: cpcv(rows.map(toBacktestRow).filter(Boolean)), bootstrap: bootstrapValidation(preview.results), policy: VALIDATION_POLICY } };
      }
      case "/strategy-regime": return { researchOnly: true, snapshot: this.snapshotMetaOf(rows, "PROSPECTIVE_SHADOW"), evidencePolicy: EVIDENCE_POLICY, groups: buildStrategyRegimeDatabase(rows.map((row) => ({ ...row, result: row.theoreticalResult })).filter((row) => ["WIN", "LOSS", "DRAW"].includes(row.result))) };
      case "/journal-intelligence": return { researchOnly: true, snapshot: this.snapshotMetaOf(rows, "PROSPECTIVE_SHADOW"), journal: journalIntelligence(rows.map((row) => ({ ...row, result: row.theoreticalResult, timing: {}, location: row.t0?.location, redTeamVerdict: row.redTeam?.verdict }))) };
      case "/drift": {
        const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt);
        const mid = Math.floor(sorted.length / 2);
        return { researchOnly: true, drift: driftReport({ referenceSnapshots: sorted.slice(0, mid).map((row) => row.t0).filter(Boolean), currentSnapshots: sorted.slice(mid).map((row) => row.t0).filter(Boolean), referenceTrades: sorted.slice(0, mid), currentTrades: sorted.slice(mid) }) };
      }
      case "/models": return { researchOnly: true, models: await this.registries.models(), ml: await mlLabStatus(), calibrationVersion: CALIBRATION_VERSION, note: "estimatedWinProbability do sistema principal permanece NULL." };
      case "/experiments": return { researchOnly: true, experiments: await this.registries.experiments() };
      case "/hypotheses": return { researchOnly: true, hypotheses: await this.registries.hypotheses() };
      case "/datasets": return { researchOnly: true, datasets: await this.registries.datasets() };
      case "/checkpoints": return { researchOnly: true, checkpoints: v4DirectionalCheckpoints(rows, { source: "PROSPECTIVE_SHADOW" }) };
      case "/jobs": return { researchOnly: true, jobs: this.jobs.list(limit), status: this.jobs.status() };
      case "/agents": return { researchOnly: true, agents: RESEARCH_AGENT_IDS, comparison: comparison(rows), snapshot: this.snapshotMetaOf(rows, "PROSPECTIVE_SHADOW") };
      case "/comparison": return { researchOnly: true, comparison: comparison(rows), snapshot: this.snapshotMetaOf(rows, "PROSPECTIVE_SHADOW") };
      case "/ablation": {
        const t0 = rows.find((row) => row.t0)?.t0 ?? null;
        if (!t0) return { researchOnly: true, ablation: null, reason: "SEM_T0" };
        return { researchOnly: true, components: Object.keys(ABLATION_COMPONENTS), ablation: ablationMatrix({ t0 }) };
      }
      default: return { error: "NOT_FOUND", route };
    }
  }

  async handlePost(pathname, input = {}) {
    const route = pathname.replace("/api/iq/research/lab", "");
    if (route === "/jobs") {
      const allowed = ["SCAN_FACTORS", "BACKTEST_BINARY", "CHECKPOINTS", "COVERAGE_AUDIT", "DRIFT_REPORT", "TAG"];
      if (!allowed.includes(input.type)) return { error: "JOB_TYPE_INVALID" };
      return { researchOnly: true, ...(await this.jobs.enqueue({ type: input.type, payload: input.payload ?? {}, requestedBy: String(input.requestedBy ?? "api").slice(0, 60) })) };
    }
    if (route === "/jobs/cancel") return { researchOnly: true, ...this.jobs.cancel(String(input.jobId ?? "")) };
    if (route === "/datasets") return { researchOnly: true, dataset: await this.registries.registerDataset(input) };
    if (route === "/experiments") return { researchOnly: true, experiment: await this.registries.registerExperiment(input) };
    if (route === "/hypotheses") return { researchOnly: true, hypothesis: await this.registries.registerHypothesis(input) };
    if (route === "/models") return { researchOnly: true, model: await this.registries.registerModel(input) };
    if (route === "/dag") {
      const question = String(input.question ?? "sem pergunta").slice(0, 300);
      const rows = await this.observations(input.limit ?? 300);
      const registry = factorRegistry();
      const dag = await runResearchDag({
        question,
        loaders: {
          dataset: () => ({ snapshot: this.snapshotMetaOf(rows, "PROSPECTIVE_SHADOW"), rows: rows.length }),
          factors: () => factorCatalogManifest().counts,
          backtest: () => runBinaryBacktest({ rows: rows.map(toBacktestRow).filter(Boolean) }),
          validation: () => bootstrapValidation(rows.map(toBacktestRow).filter(Boolean)),
          bench: () => benchmarkSummary({ rows: rows.filter((row) => row.t0), factors: registry.list().slice(0, 30) }),
          journal: () => journalIntelligence(rows.map((row) => ({ ...row, result: row.theoreticalResult }))),
        },
      });
      return { researchOnly: true, dag };
    }
    return { error: "NOT_FOUND", route };
  }
}

function toBacktestRow(row) {
  if (!row?.t0) return null;
  return { direction: row.direction, payout: null, targetEntryAt: row.t0?.times?.decisionAt ? row.t0.times.decisionAt - 2_000 : null, targetExpiryAt: row.targetExpiryAt ?? (row.t0?.times?.decisionAt ? row.t0.times.decisionAt + 58_000 : null), entryPrice: row.t0?.price?.last ?? null, theoreticalResult: row.theoreticalResult, settlementBasis: row.settlementBasis, candles: null, createdAt: row.createdAt };
}

function comparison(rows) {
  const actions = { g2: {}, v3: {}, v4: {} };
  let agree = 0;
  for (const row of rows) {
    const g2 = row.router?.versions?.G2_CURRENT?.action ?? "UNAVAILABLE";
    const v3 = row.router?.versions?.SCENARIO_ENGINE_V3_FROZEN?.action ?? "UNAVAILABLE";
    const v4 = row.finalAction ?? "UNAVAILABLE";
    actions.g2[g2] = (actions.g2[g2] ?? 0) + 1;
    actions.v3[v3] = (actions.v3[v3] ?? 0) + 1;
    actions.v4[v4] = (actions.v4[v4] ?? 0) + 1;
    if (g2 === v4) agree += 1;
  }
  return { n: rows.length, actions, g2V4AgreementPct: rows.length ? Number(((agree / rows.length) * 100).toFixed(2)) : null, note: "Mesmas oportunidades; WAIT nao entra em WR." };
}
