/**
 * QUANT / RESEARCH PLATFORM — contratos e enums.
 *
 * Tudo aqui e RESEARCH: nao decide, nao executa, nao altera G2/V3/V4/Late Window/Quality Gate/JIT/
 * Execution Gate/stake/allowlist REAL. Nenhum status muda sozinho (sem promocao automatica).
 */
export const RESEARCH_PLATFORM_VERSION = "quant-research-platform-v1";
export const RESEARCH_MODE = "RESEARCH_ONLY";

export const RESEARCH_POLICY = Object.freeze({
  version: RESEARCH_PLATFORM_VERSION,
  mode: RESEARCH_MODE,
  controlsExecution: false,
  sendsOrders: false,
  changesStake: false,
  promotesFactorAutomatically: false,
  promotesModelAutomatically: false,
  realAllowlistUntouched: true,
  hotPathIsolated: true,
  journalCreatesHypothesisOnly: true,
  note: "Research nao e hot path; jobs pesados rodam fora do relay com limites de recurso.",
});

export const FACTOR_CATEGORIES = Object.freeze([
  "TREND", "MOMENTUM", "VOLATILITY", "STRUCTURE", "PRICE_ACTION", "MICROSTRUCTURE",
  "VOLUME", "ORDER_FLOW", "CROSS_ASSET", "MACRO", "FUNDAMENTAL", "OTHER",
]);

export const FACTOR_STATUSES = Object.freeze([
  "DISCOVERED", "VALIDATED", "RESEARCH", "REJECTED", "SHADOW_CANDIDATE", "PROMOTED", "RETIRED",
]);

export const FACTOR_COMPATIBILITY = Object.freeze(["NATIVE", "DERIVED", "IMPORTED"]);

export const NATIVE_OR_DERIVED = Object.freeze(["NATIVE", "DERIVED"]);

export const FEATURE_STATES = Object.freeze([
  "VALID", "DERIVED_VALID", "STALE", "MISSING", "UNAVAILABLE", "DEFAULTED", "INVALID",
]);

export const EVIDENCE_QUALITY = Object.freeze([
  "INSUFFICIENT", "EXPLORATORY", "VALIDATED_HISTORICAL", "VALIDATED_HOLDOUT", "PROSPECTIVE_SHADOW", "PRACTICE_VALIDATED",
]);

export const VALIDATION_MODES = Object.freeze([
  "POINT_IN_TIME_REPLAY", "WALK_FORWARD", "PURGED_KFOLD", "EMBARGO", "CPCV", "UNTOUCHED_HOLDOUT", "BOOTSTRAP", "MONTE_CARLO_SEQUENCE",
]);

export const JOB_STATES = Object.freeze(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);

export const MODEL_STATUSES = Object.freeze([
  "RESEARCH", "BACKTESTED", "HOLDOUT", "SHADOW", "PRACTICE_CANDIDATE", "PRACTICE", "RETIRED",
]);

export const MODEL_TYPES = Object.freeze(["LOGISTIC", "XGBOOST", "CATBOOST", "CALIBRATED_WRAPPER", "BASELINE"]);

export const OTC_UNAVAILABLE_DATA = Object.freeze([
  "TRUE_VOLUME", "ORDER_BOOK", "MARKET_DEPTH", "INSTITUTIONAL_FLOW", "FUNDAMENTAL", "SECTOR",
]);

export function assertResearchOnly(component = "unknown") {
  return { component, mode: RESEARCH_MODE, controlsExecution: false, sendsOrders: false };
}
