/**
 * SCENARIO OBSERVATION DATA QUALITY — marcacao de observacao INVALIDA (RESEARCH/SHADOW ONLY).
 *
 * Camada OBSERVACIONAL derivada e pura: NAO altera o motor V3, o shadow, a interseccao, o Brain G2,
 * a estrategia, a stake, o JIT, o threshold 75 nem o Execution Gate. Nao envia ordem.
 *
 * Regra: uma observacao com feed stale, T0 ausente, clock inconsistente, marketKey ambiguo,
 * NORMAL/OTC mismatch, settlement incerto, restart sem associacao ou feature critica indisponivel e
 * marcada `valid=false` e NAO entra nas metricas principais — mas CONTINUA PERSISTIDA e e contada como
 * descartada (nunca apagada, nunca reescrita).
 *
 * Determinismo: mesma entrada -> mesma marcacao. Sem IO, sem relogio, sem aleatoriedade.
 */
import { parseMarketKey } from "./shadow-lab.mjs";
import { SETTLEMENT_BASES } from "./scenario-shadow.mjs";

export const OBSERVATION_QUALITY_VERSION = "scenario-observation-quality-v1";

export const INVALID_REASONS = Object.freeze([
  "FEED_STALE",
  "T0_MISSING",
  "CLOCK_INCONSISTENT",
  "MARKET_KEY_AMBIGUOUS",
  "NORMAL_OTC_MISMATCH",
  "SETTLEMENT_UNCERTAIN",
  "RESTART_WITHOUT_ASSOCIATION",
  "FEATURE_CRITICAL_UNAVAILABLE",
]);

/** Mesmo limiar de stale usado pelo runtime no JIT (15 s). */
export const FEED_STALE_TICK_AGE_MS = 15_000;
/** Tolerancia de drift entre `createdAt` e `decisionAt` antes de marcar clock inconsistente. */
export const CLOCK_DRIFT_TOLERANCE_MS = 3_600_000;
/** Feature estrutural exigida por TODOS os 8 playbooks. */
export const CRITICAL_FEATURES = Object.freeze(["structureLabel"]);
/** Grupos em que a ausencia TOTAL (volatilidade E momentum) invalida a observacao. */
export const CRITICAL_FEATURE_GROUPS = Object.freeze({
  volatility: Object.freeze(["atr", "atrRatio"]),
  momentum: Object.freeze(["rsi14", "velocity", "acceleration"]),
});
export const DECIDED_RESULTS = Object.freeze(["WIN", "LOSS", "DRAW"]);

export const OBSERVATION_QUALITY_POLICY = Object.freeze({
  version: OBSERVATION_QUALITY_VERSION,
  mode: "DERIVED_MARKING_READ_ONLY",
  invalidExcludedFromMainMetrics: true,
  invalidStillPersisted: true,
  invalidCountedAsDiscarded: true,
  mutatesObservation: false,
  affectsClassification: false,
  affectsExecution: false,
  note: "Qualidade e derivada na leitura; nunca reescreve a observacao persistida nem a classificacao.",
});

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const first = (...values) => { for (const value of values) if (value !== undefined && value !== null) return value; return null; };
const asArray = (value) => (Array.isArray(value) ? value : []);

/** Normaliza observacao de runtime (camelCase) ou linha do DB (snake_case) para a vista de qualidade. */
export function normalizeQualityView(observation = {}) {
  const source = observation ?? {};
  const trader = source.traderScenario ?? source.trader_scenario ?? null;
  return {
    id: source.id ?? source.observationId ?? source.observation_id ?? null,
    provenance: source.provenance ?? null,
    marketKey: source.marketKey ?? source.market_key ?? null,
    marketType: source.marketType ?? source.market_type ?? null,
    direction: source.direction ?? null,
    candidateId: source.candidateId ?? source.candidate_id ?? null,
    correlationId: source.correlationId ?? source.correlation_id ?? null,
    executionId: source.executionId ?? source.execution_id ?? null,
    tradeId: source.tradeId ?? source.trade_id ?? null,
    persistState: source.persistState ?? null,
    createdAt: first(source.createdAt, source.created_at),
    candidateAt: first(source.candidateAt, source.candidate_at),
    decisionAt: first(source.decisionAt, source.decision_at),
    jitAt: first(source.jitAt, source.jit_at),
    finalEntryAt: first(source.finalEntryAt, source.final_entry_at),
    targetEntryAt: first(source.targetEntryAt, source.target_entry_at),
    targetExpiryAt: first(source.targetExpiryAt, source.target_expiry_at),
    t0: source.t0 ?? null,
    t0Integrity: source.t0Integrity ?? source.t0_integrity ?? null,
    outcome: source.outcome ?? null,
    settlementBasis: source.settlementBasis ?? source.settlement_basis ?? null,
    brokerResult: source.brokerResult ?? source.broker_result ?? null,
    featuresUsed: first(
      Array.isArray(source.featuresUsed) ? source.featuresUsed : null,
      Array.isArray(trader?.featuresUsed) ? trader.featuresUsed : null,
      [],
    ),
    invalidationReasons: [
      ...asArray(trader?.invalidationReasons),
      ...asArray(source.reasonsForWait ?? source.reasons_for_wait),
    ].map(String),
    scenarioEvidenceAgainst: asArray(trader?.scenarioEvidenceAgainst).map(String),
  };
}

const timestampFields = ["candidateAt", "decisionAt", "jitAt", "finalEntryAt", "targetEntryAt", "targetExpiryAt"];
const isMs = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

function clockConsistency(view) {
  const present = timestampFields.filter((field) => isMs(view[field]));
  const inverted = [];
  for (let index = 1; index < present.length; index += 1) {
    if (Number(view[present[index]]) < Number(view[present[index - 1]])) inverted.push(`${present[index]}<${present[index - 1]}`);
  }
  if (isMs(view.targetEntryAt) && isMs(view.targetExpiryAt) && Number(view.targetExpiryAt) <= Number(view.targetEntryAt)) inverted.push("targetExpiryAt<=targetEntryAt");
  const driftMs = isMs(view.createdAt) && isMs(view.decisionAt) ? Math.abs(Number(view.createdAt) - Number(view.decisionAt)) : null;
  const driftExceeded = driftMs !== null && driftMs > CLOCK_DRIFT_TOLERANCE_MS;
  return { consistent: inverted.length === 0 && !driftExceeded, inverted, driftMs, driftExceeded };
}

function featureAvailability(view) {
  const used = new Set(view.featuresUsed.map(String));
  const missingCritical = CRITICAL_FEATURES.filter((feature) => !used.has(feature));
  const groups = Object.entries(CRITICAL_FEATURE_GROUPS);
  const missingGroups = groups.filter(([, members]) => members.every((member) => !used.has(member))).map(([group]) => group);
  const empty = used.size === 0;
  return { available: !empty && missingCritical.length === 0 && missingGroups.length !== groups.length, empty, missingCritical, missingGroups, featuresUsed: [...used] };
}

/**
 * Avalia UMA observacao. Retorna `valid` + `invalidReasons` (ordem estavel de INVALID_REASONS) + checks.
 * Nunca muta a entrada.
 */
export function assessScenarioObservationQuality(observation = {}) {
  const view = normalizeQualityView(observation);
  const t0 = view.t0 && typeof view.t0 === "object" ? view.t0 : null;
  const t0Present = Boolean(t0 && Object.keys(t0).length > 0 && (view.marketKey ?? t0.marketKey) && (t0.candidateAt !== undefined || view.candidateAt !== null));
  const freshness = t0?.freshness ?? {};
  const tickAgeMs = num(freshness.tickAgeMs);
  const feedSignals = [...view.invalidationReasons, ...view.scenarioEvidenceAgainst];
  const feedStale = freshness.fresh === false || (tickAgeMs !== null && tickAgeMs > FEED_STALE_TICK_AGE_MS) || feedSignals.some((reason) => reason.includes("FEED_STALE"));
  const clock = clockConsistency(view);
  const parsed = parseMarketKey(view.marketKey);
  const marketKeyAmbiguous = parsed.valid !== true;
  const normalOtcMismatch = parsed.valid === true && (view.marketType === "NORMAL" || view.marketType === "OTC") && parsed.marketType !== view.marketType;
  const outcome = view.outcome && typeof view.outcome === "object" ? view.outcome : null;
  const outcomeResult = outcome?.result ?? null;
  const settlementBasis = view.settlementBasis ?? outcome?.settlementBasis ?? null;
  const settlementUncertain = Boolean(outcome) && (
    !DECIDED_RESULTS.includes(outcomeResult)
    || !SETTLEMENT_BASES.includes(settlementBasis)
    || (settlementBasis === "BROKER_EXECUTED" && !DECIDED_RESULTS.includes(view.brokerResult))
  );
  const restartWithoutAssociation = (
    view.persistState === "LOADED" && !view.candidateId && !view.correlationId && !view.executionId && !view.tradeId
  ) || (Boolean(outcome) && !view.candidateId && !view.executionId && !view.tradeId);
  const features = featureAvailability(view);

  const checks = {
    T0_PRESENT: { ok: t0Present, detail: { hasT0: Boolean(t0), marketKey: view.marketKey ?? null, candidateAt: view.candidateAt ?? null } },
    FEED_FRESH: { ok: !feedStale, detail: { fresh: freshness.fresh ?? null, tickAgeMs, thresholdMs: FEED_STALE_TICK_AGE_MS, signals: feedSignals.filter((reason) => reason.includes("FEED_STALE")) } },
    CLOCK_CONSISTENT: { ok: clock.consistent, detail: { inverted: clock.inverted, driftMs: clock.driftMs, toleranceMs: CLOCK_DRIFT_TOLERANCE_MS } },
    MARKET_KEY_UNAMBIGUOUS: { ok: !marketKeyAmbiguous, detail: { marketKey: view.marketKey, parsed: { canonical: parsed.canonical, marketType: parsed.marketType, valid: parsed.valid } } },
    NORMAL_OTC_MATCH: { ok: !normalOtcMismatch, detail: { marketType: view.marketType, parsedMarketType: parsed.marketType } },
    SETTLEMENT_CERTAIN: { ok: !settlementUncertain, detail: { result: outcomeResult, settlementBasis, brokerResult: view.brokerResult } },
    ASSOCIATION_PRESENT: { ok: !restartWithoutAssociation, detail: { candidateId: view.candidateId, correlationId: view.correlationId, executionId: view.executionId, tradeId: view.tradeId, persistState: view.persistState } },
    FEATURES_CRITICAL_AVAILABLE: { ok: features.available, detail: { featuresUsed: features.featuresUsed, empty: features.empty, missingCritical: features.missingCritical, missingGroups: features.missingGroups } },
  };

  const invalidReasons = [];
  if (feedStale) invalidReasons.push("FEED_STALE");
  if (!t0Present) invalidReasons.push("T0_MISSING");
  if (!clock.consistent) invalidReasons.push("CLOCK_INCONSISTENT");
  if (marketKeyAmbiguous) invalidReasons.push("MARKET_KEY_AMBIGUOUS");
  if (normalOtcMismatch) invalidReasons.push("NORMAL_OTC_MISMATCH");
  if (settlementUncertain) invalidReasons.push("SETTLEMENT_UNCERTAIN");
  if (restartWithoutAssociation) invalidReasons.push("RESTART_WITHOUT_ASSOCIATION");
  if (!features.available) invalidReasons.push("FEATURE_CRITICAL_UNAVAILABLE");
  const ordered = INVALID_REASONS.filter((reason) => invalidReasons.includes(reason));

  return Object.freeze({
    version: OBSERVATION_QUALITY_VERSION,
    observationId: view.id,
    valid: ordered.length === 0,
    invalidReasons: ordered,
    discarded: ordered.length > 0,
    checks,
    policy: OBSERVATION_QUALITY_POLICY,
    note: ordered.length ? "Observacao INVALIDA: continua persistida e e contada como descartada." : "Observacao valida para as metricas principais.",
  });
}

/** Separa observacoes validas/invalidas (nunca apaga nada; invalid = descartada). */
export function partitionObservationsByQuality(observations = []) {
  const rows = asArray(observations);
  const valid = [];
  const invalid = [];
  for (const row of rows) {
    const assessment = assessScenarioObservationQuality(row);
    if (assessment.valid) valid.push(row);
    else invalid.push({ observation: row, assessment });
  }
  return {
    version: OBSERVATION_QUALITY_VERSION,
    total: rows.length,
    valid,
    invalid,
    discarded: invalid.length,
    invalidReasons: invalid.reduce((acc, entry) => {
      for (const reason of entry.assessment.invalidReasons) acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {}),
    policy: OBSERVATION_QUALITY_POLICY,
  };
}

/** Contagem agregada de motivos de invalidacao (para o relatorio/checkpoint). */
export function summarizeInvalidReasons(observations = []) {
  const partition = partitionObservationsByQuality(observations);
  return { version: OBSERVATION_QUALITY_VERSION, total: partition.total, discarded: partition.discarded, reasons: partition.invalidReasons };
}
