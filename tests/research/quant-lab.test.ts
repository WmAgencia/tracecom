/**
 * QUANT / RESEARCH LAB — contratos, pureza anti-lookahead, backtest binario, checkpoints,
 * coverage audit, registries, journal (hipotese apenas) e limits de jobs.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const lab = await import("../../relay/research-lab/index.mjs");

function candles(count = 90) {
  const list: any[] = [];
  for (let index = 0; index < count; index += 1) {
    const open = 1.1 + index * 0.0002;
    const close = open + (index % 5 < 3 ? 0.0004 : -0.0004);
    list.push({ bucketStart: 1_800_000_000_000 + index * 5_000, bucketEnd: 1_800_000_000_000 + index * 5_000 + 5_000, open, high: Math.max(open, close) + 0.0001, low: Math.min(open, close) - 0.0001, close, receivedAt: 1_800_000_000_000 + index * 5_000 + 5_000 });
  }
  return list;
}

describe("Factor Registry / contracts", () => {
  it("registra nativos e importados com hash de formula e sem promocao automatica", () => {
    const registry = lab.factorRegistry();
    const manifest = registry.exportManifest();
    expect(manifest.counts.total).toBeGreaterThan(100);
    expect(manifest.counts.imported).toBeGreaterThan(70);
    for (const factor of manifest.factors.slice(0, 10)) expect(factor.formulaHash).toMatch(/^[0-9a-f]{64}$/);
    expect(registry.setStatus("tc_rsi14", "RESEARCH")).toBeTruthy();
    expect(registry.setStatus("tc_rsi14", "VALIDATED")).toBeTruthy();
    expect(() => registry.setStatus("tc_rsi14", "PROMOTED")).toThrowError(/TRANSITION_NOT_ALLOWED/);
    expect(() => registry.setStatus("tc_rsi14", "DISCOVERED")).toThrowError(/TRANSITION_NOT_ALLOWED/);
  });
  it("marca OTC incompativel quando depende de volume verdadeiro", () => {
    const factor = lab.buildFactorDefinition({ factorId: "x_vol", name: "vol", category: "VOLUME", formula: "x", requiredData: ["TRUE_VOLUME"], availableAtSemantics: "x", compute: () => null });
    expect(lab.compatibilityFor(factor, "OTC")).toBe("UNAVAILABLE_FOR_OTC");
  });
});

describe("Factor Purity (anti-lookahead)", () => {
  it("nenhum fator nativo/importado falha prefix-equality e future-perturbation", () => {
    const list = candles();
    const suite = lab.puritySuite(lab.factorRegistry().list({ imported: true }).slice(0, 40), { candles: list, index: list.length - 1 });
    expect(suite.failed).toBe(0);
    expect(suite.passed).toBeGreaterThan(30);
  });
  it("detecta formula com shift negativo declarada lookahead-safe", () => {
    const bad = { factorId: "bad", formula: "shift(x,-1)", lookaheadSafe: true, availableAtSemantics: "x", warmup: 1, compute: () => 1 };
    const report = lab.checkFactorPurity(bad, { candles: candles(20), index: 19 });
    expect(report.ok).toBe(false);
    expect(report.errors.some((error: string) => error.startsWith("FORBIDDEN_FORMULA_PATTERN"))).toBe(true);
  });
});

describe("Backtest Lab (binario)", () => {
  it("resolve WIN/LOSS/DRAW pela mecanica real e nunca inventa payout", () => {
    expect(lab.settleBinaryOutcome({ direction: "BUY", entryPrice: 1.1, expiryPrice: 1.2 })).toBe("WIN");
    expect(lab.settleBinaryOutcome({ direction: "BUY", entryPrice: 1.1, expiryPrice: 1.0 })).toBe("LOSS");
    expect(lab.settleBinaryOutcome({ direction: "SELL", entryPrice: 1.1, expiryPrice: 1.1 })).toBe("DRAW");
    expect(lab.resolvePayout({ payout: null }).payoutSource).toBe("UNKNOWN");
    expect(lab.resolvePayout({ payout: null, hypotheticalPayout: 0.8, allowHypothetical: true }).payoutSource).toBe("HYPOTHETICAL");
  });
  it("nao executa entrada impossivel (apos cutoff)", () => {
    const execution = lab.simulateExecution({ candidateAt: 0, targetEntryAt: 10_000, targetExpiryAt: 50_000, latencyMs: 45_000 });
    expect(execution.valid).toBe(false);
    expect(execution.reason).toBe("CUTOFF_WOULD_BE_VIOLATED");
  });
  it("roda backtest e valida metrica com CI95 e aviso de precisao", () => {
    const rows = [
      { direction: "BUY", payout: 0.87, targetEntryAt: 1_800_000_430_000, targetExpiryAt: 1_800_000_490_000, entryPrice: 1.1, expiryPrice: 1.1003 },
      { direction: "SELL", payout: 0.87, targetEntryAt: 1_800_000_430_000, targetExpiryAt: 1_800_000_490_000, entryPrice: 1.1, expiryPrice: 1.0998 },
    ];
    const run = lab.runBinaryBacktest({ rows });
    expect(run.metrics.n).toBe(2);
    expect(run.metrics.precisionWarning).toBeTruthy();
    expect(run.meta.coverage.unknownPayout).toBe(0);
    expect(run.meta.controlsExecution).toBe(false);
  });
  it("modos de validacao rodam sem reutilizar holdout", () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({ direction: index % 2 ? "BUY" : "SELL", result: index % 3 ? "WIN" : "LOSS", payout: 0.87, at: index * 1_000, targetExpiryAt: index * 1_000 + 60_000, theoreticalResult: index % 3 ? "WIN" : "LOSS", settlementBasis: "CAUSAL_COUNTERFACTUAL" }));
    expect(lab.purgedKFold(rows).folds.length).toBeGreaterThan(0);
    expect(lab.walkForward(rows).folds.length).toBeGreaterThan(0);
    expect(lab.cpcv(rows).paths.length).toBeGreaterThan(0);
    const holdout = lab.untouchedHoldout(rows);
    expect(holdout.holdout.n + holdout.development.n).toBe(60);
    expect(lab.bootstrapValidation(rows).wr.n).toBe(60);
  });
});

describe("Checkpoints V4", () => {
  it("WAIT/NO_TRADE ficam fora do denominador do WR e sao exibidos separados", () => {
    const rows = [
      { direction: "BUY", theoreticalResult: "WIN", payout: 0.87, createdAt: 1, finalAction: "BUY", provenance: "PROSPECTIVE_SHADOW" },
      { direction: "SELL", theoreticalResult: "LOSS", payout: 0.87, createdAt: 2, finalAction: "SELL", provenance: "PROSPECTIVE_SHADOW" },
      { direction: null, finalAction: "WAIT", createdAt: 3 },
      { direction: null, finalAction: "NO_TRADE", createdAt: 4 },
    ];
    const checkpoints = lab.v4DirectionalCheckpoints(rows, { levels: [30] });
    expect(checkpoints.directionalSettlements).toBe(2);
    expect(checkpoints.waitObservations).toBe(2);
    expect(checkpoints.coverage.coverageRate).toBe(0.5);
    expect(checkpoints.checkpoints[0].n).toBe(2);
  });
});

describe("Coverage audit", () => {
  it("classifica VALID/DERIVED_VALID/UNAVAILABLE/MISSING e nao conta defaulted", () => {
    const snapshot = {
      times: { decisionAt: 1_000_000 },
      featureProvenance: {
        "a.native": { value: 1, status: "OK", source: "FEATURE_ENGINE", availableAt: 990_000 },
        "b.derived": { value: 2, status: "OK", source: "CANDLE_5S_DERIVED", availableAt: 990_000 },
        "c.missing_data": { value: null, status: "INSUFFICIENT_DATA", source: "UNAVAILABLE", availableAt: null },
        "d.defaulted": { value: 0.5, status: "OK", source: "DETERMINISTIC_CALCULATION", defaulted: true, availableAt: 990_000 },
        "e.stale": { value: 3, status: "OK", source: "FEATURE_ENGINE", availableAt: 100_000 },
      },
    };
    const audit = lab.auditFeatureCoverage([snapshot], { source: "TEST", staleMs: 20_000 });
    const rows = Object.fromEntries(audit.rows.map((row: any) => [row.feature, row]));
    expect(rows["a.native"].VALID).toBe(1);
    expect(rows["b.derived"].DERIVED_VALID).toBe(1);
    expect(rows["c.missing_data"].UNAVAILABLE).toBe(1);
    expect(rows["d.defaulted"].DEFAULTED).toBe(1);
    expect(rows["e.stale"].STALE).toBe(1);
    expect(audit.snapshot.n).toBe(1);
  });
});

describe("Journal / Drift / Registries", () => {
  it("journal produz hipoteses pre-registradas e nunca regra de producao", () => {
    const trades = Array.from({ length: 12 }, (_, index) => ({ result: index % 2 ? "WIN" : "LOSS", timing: { candidateAgeMs: 1_000 }, payout: 0.7, latencyMs: 3_000 }));
    const journal = lab.journalIntelligence(trades);
    expect(journal.policy.journalCreatesHypothesisOnly).toBe(true);
    expect(journal.policy.neverCreatesProductionRule).toBe(true);
    expect(journal.patterns.length).toBeGreaterThan(0);
  });
  it("drift apenas alerta", () => {
    const ref = [{ featureProvenance: { f: { value: 1, status: "OK", source: "FEATURE_ENGINE", availableAt: 1 } } }];
    const cur = [{ featureProvenance: { f: { value: null, status: "INSUFFICIENT_DATA", source: "UNAVAILABLE", availableAt: null } } }];
    const drift = lab.driftReport({ referenceSnapshots: ref, currentSnapshots: cur });
    expect(drift.policy.alertOnly).toBe(true);
    expect(drift.policy.autoModelChange).toBe(false);
    expect(drift.feature.alerts.length).toBe(1);
  });
  it("strategy-regime deriva evidence quality sem REAL_VALIDATED automatico", () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({ strategyVersion: "V4", regime: "TREND_UP", scenario: "TREND_PULLBACK", marketType: "OTC", marketKey: "EURUSD:OTC", result: index % 3 ? "WIN" : "LOSS", payout: 0.87, provenance: "PROSPECTIVE" }));
    const groups = lab.buildStrategyRegimeDatabase(rows);
    expect(groups[0].evidenceQuality).toBe("PROSPECTIVE_SHADOW");
    expect(groups[0].ci95.low).toBeLessThan(groups[0].ci95.high);
    expect(lab.EVIDENCE_POLICY.realValidatedAutomatic).toBe(false);
  });
  it("snapshot meta sempre presente e comparacao explicita", () => {
    const meta = lab.buildSnapshotMeta({ asOf: 100, windowStart: 10, windowEnd: 100, n: 3, source: "TEST", datasetVersion: "v1" });
    expect(meta).toMatchObject({ asOf: 100, windowStart: 10, windowEnd: 100, n: 3, source: "TEST", datasetVersion: "v1" });
    expect(lab.assertComparableSnapshots(meta, meta).comparable).toBe(true);
    expect(lab.assertComparableSnapshots(meta, { ...meta, datasetVersion: "v2" }).comparable).toBe(false);
  });
});

describe("Job queue (limites)", () => {
  it("respeita rate limit e nao bloqueia o relay (child process)", async () => {
    const queue = new lab.ResearchJobQueue({ concurrency: 1, maxJobsPerHour: 1, timeoutMs: 20_000 });
    const first = await queue.enqueue({ type: "TAG", payload: { tag: "smoke" } });
    expect(first.ok).toBe(true);
    const second = await queue.enqueue({ type: "TAG" });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("RATE_LIMIT");
  });
});

describe("ML Lab / Calibration", () => {
  it("ml lab nao usa deep learning como default e sistema principal segue NULL", async () => {
    const status = await lab.mlLabStatus();
    expect(status.policy.deepLearningFirst).toBe(false);
    expect(status.policy.estimatedWinProbabilityInMainSystem).toBeNull();
    const bins = lab.reliabilityBins([{ probability: 0.9, outcome: "WIN" }, { probability: 0.1, outcome: "LOSS" }]);
    expect(bins.n).toBe(2);
    expect(lab.ML_TARGET).toContain("P(WIN");
  });
});
