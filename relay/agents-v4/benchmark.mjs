/**
 * AGENTS V4 BENCHMARK — G2 vs SCENARIO_ENGINE_V3_FROZEN vs PROFESSIONAL_AGENT_SYSTEM_V4
 * na MESMA oportunidade, com settlement comum (CAUSAL_COUNTERFACTUAL quando houver desfecho).
 *
 * Nao usa datasets diferentes sem marcar coverage; nunca mistura PROSPECTIVE_SHADOW,
 * CAUSAL_COUNTERFACTUAL e BROKER_EXECUTED.
 */
export const BENCHMARK_VERSION = "agents-v4-benchmark-v1";

const ACTIONS = ["BUY", "SELL", "WAIT", "NO_TRADE", "ERROR", "UNAVAILABLE"];

function bump(target, key) {
  const normalized = key && ACTIONS.includes(key) ? key : "UNAVAILABLE";
  target[normalized] = (target[normalized] ?? 0) + 1;
}

export function buildBenchmarkRecord(observation = {}) {
  const router = observation.router ?? null;
  return {
    observationId: observation.id ?? null,
    candidateId: observation.candidateId ?? null,
    marketKey: observation.marketKey ?? null,
    marketType: observation.marketType ?? null,
    accountContext: observation.accountContext ?? null,
    atMs: observation.createdAt ?? null,
    g2Action: router?.versions?.G2_CURRENT?.action ?? observation.g2Action ?? "UNAVAILABLE",
    v3Action: router?.versions?.SCENARIO_ENGINE_V3_FROZEN?.action ?? observation.v3Action ?? "UNAVAILABLE",
    v4Action: observation.finalAction ?? router?.versions?.PROFESSIONAL_AGENT_SYSTEM_V4?.action ?? "UNAVAILABLE",
    v3Scenario: router?.versions?.SCENARIO_ENGINE_V3_FROZEN?.scenario ?? null,
    v4Scenario: observation.scenario ?? null,
    v4Regime: observation.regime ?? null,
    v4DataQuality: observation.dataQuality ?? null,
    conflicts: observation.conflicts ?? [],
    triggerState: observation.triggerState ?? null,
    timing: observation.timing ?? null,
    settlementBasis: observation.settlementBasis ?? null,
    theoreticalResult: observation.theoreticalResult ?? null,
    provenance: observation.provenance ?? "PROSPECTIVE",
  };
}

export function summarizeBenchmark(records = []) {
  const list = (Array.isArray(records) ? records : []).filter(Boolean);
  const g2 = {}, v3 = {}, v4 = {};
  const regimes = {}, scenarios = {}, dataQuality = {}, timing = {}, conflicts = {};
  let settled = 0, wins = 0, losses = 0, draws = 0;
  let agreeG2V3 = 0, agreeG2V4 = 0, agreeV3V4 = 0;
  let coverageMissingSettlement = 0;
  for (const row of list) {
    bump(g2, row.g2Action); bump(v3, row.v3Action); bump(v4, row.v4Action);
    regimes[row.v4Regime ?? "UNKNOWN"] = (regimes[row.v4Regime ?? "UNKNOWN"] ?? 0) + 1;
    scenarios[row.v4Scenario ?? "UNKNOWN"] = (scenarios[row.v4Scenario ?? "UNKNOWN"] ?? 0) + 1;
    dataQuality[row.v4DataQuality ?? "UNKNOWN"] = (dataQuality[row.v4DataQuality ?? "UNKNOWN"] ?? 0) + 1;
    timing[row.timing?.state ?? "UNKNOWN"] = (timing[row.timing?.state ?? "UNKNOWN"] ?? 0) + 1;
    for (const conflict of row.conflicts ?? []) conflicts[conflict.type ?? "UNKNOWN"] = (conflicts[conflict.type ?? "UNKNOWN"] ?? 0) + 1;
    if (row.g2Action === row.v3Action) agreeG2V3 += 1;
    if (row.g2Action === row.v4Action) agreeG2V4 += 1;
    if (row.v3Action === row.v4Action) agreeV3V4 += 1;
    if (row.settlementBasis) {
      settled += 1;
      if (row.theoreticalResult === "WIN") wins += 1;
      else if (row.theoreticalResult === "LOSS") losses += 1;
      else if (row.theoreticalResult === "DRAW") draws += 1;
    } else if (["BUY", "SELL"].includes(row.v4Action)) coverageMissingSettlement += 1;
  }
  const total = list.length || 1;
  return {
    version: BENCHMARK_VERSION,
    total: list.length,
    actions: { g2, v3, v4 },
    regimes, scenarios, dataQuality, timing, conflicts,
    agreement: {
      g2V3Pct: Number(((agreeG2V3 / total) * 100).toFixed(2)),
      g2V4Pct: Number(((agreeG2V4 / total) * 100).toFixed(2)),
      v3V4Pct: Number(((agreeV3V4 / total) * 100).toFixed(2)),
    },
    settlement: { settled, wins, losses, draws, coverageMissingSettlement, basis: "CAUSAL_COUNTERFACTUAL|PROSPECTIVE_SHADOW" },
    shadowOnly: true,
    controlsExecution: false,
    note: "Settlement comum observacional; nenhuma ordem e gerada por este modulo.",
  };
}

export function buildOpportunityMatrix(records = []) {
  return (Array.isArray(records) ? records : []).map((row) => ({
    observationId: row.observationId,
    marketKey: row.marketKey,
    atMs: row.atMs,
    G2: row.g2Action,
    V3: row.v3Action,
    V4: row.v4Action,
    v3Scenario: row.v3Scenario,
    v4Scenario: row.v4Scenario,
    v4Regime: row.v4Regime,
    dataQuality: row.v4DataQuality,
    triggerState: row.triggerState,
    result: row.theoreticalResult,
    settlementBasis: row.settlementBasis,
  }));
}
