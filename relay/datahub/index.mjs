/**
 * DATAHUB — exports publicos (TRILHA A do PROFESSIONAL_AGENT_SYSTEM_V4).
 *
 * Implementacao propria (clean-room) inspirada conceitualmente em event bus/data hub de
 * arquiteturas de pesquisa; nenhum codigo de terceiros (AGPL ou outro) foi copiado.
 */
export { METRICS_VERSION, percentile, summarize, RollingWindow, RateCounter, processSnapshot } from "./metrics.mjs";
export { DATAHUB_SCHEMA_VERSION, DATAHUB_EVENT_SCHEMA, MARKET_TYPES, EVENT_TYPES, isEventType, marketTypeFromKey, makeEvent, validateEvent } from "./event-schema.mjs";
export { EVENT_BUS_VERSION, DataHubEventError, EventBus } from "./event-bus.mjs";
export { FEATURE_PROVENANCE_VERSION, FEATURE_SOURCES, FEATURE_STATUS, provenanceEntry, buildProvenanceMap, mergeProvenance, provenanceOf } from "./feature-provenance.mjs";
export {
  T0_ENRICHED_VERSION, T0_ENRICHED_SCHEMA, TIMEFRAMES, STRUCTURE_MIN_CANDLES, CONTEXT_MIN_CANDLES, STALE_FEATURE_MS,
  normalizeCandleList, splitClosedCandles, aggregateCandles, tickMicrostructure, swingStructure, breakOfStructure,
  nearestLevels, buildT0Enriched, collectFeatureStates, findFutureReferences,
} from "./t0-enriched.mjs";
export { DATA_QUALITY_AGENT_VERSION, DATA_QUALITY_STATES, DATA_QUALITY_THRESHOLDS, assessDataQuality, dataQualityInputFromRuntime } from "./data-quality-agent.mjs";
export { FEATURE_COVERAGE_VERSION, computeFeatureCoverage } from "./coverage.mjs";
