/**
 * DATA QUALITY AGENT — saude dos dados em HEALTHY / DEGRADED / UNSAFE.
 *
 * UNSAFE significa: os dados NAO sustentam nenhuma decisao. O Agent System V4 responde
 * NO_TRADE (nunca WAIT "neutro") quando este agente marca UNSAFE.
 *
 * Analisa: feed freshness, ticks ausentes, candles ausentes, duplicados, clock drift,
 * gaps de sequencia, mapeamento de mercado, consistencia NORMAL/OTC, estado do broker
 * e freshness de features. Nao decide direcao e nao altera nada.
 */
import { provenanceEntry } from "./feature-provenance.mjs";

export const DATA_QUALITY_AGENT_VERSION = "data-quality-agent-v1";
export const DATA_QUALITY_STATES = Object.freeze(["HEALTHY", "DEGRADED", "UNSAFE"]);

export const DATA_QUALITY_THRESHOLDS = Object.freeze({
  feedStaleMs: 15_000,
  clockDriftMs: 5_000,
  featureStaleMs: 30_000,
  minCandles: 32,
  criticalMissingBuckets: 3,
  criticalSequenceGaps: 3,
  minTicks: 3,
});

function check(id, ok, severity, detail) { return { id, ok: ok === true, severity, detail: detail ?? null }; }

export function assessDataQuality({
  marketKey = null,
  marketType = null,
  accountContext = null,
  now = Date.now(),
  feed = {},
  candles = {},
  clock = {},
  marketMapping = {},
  consistency = {},
  broker = {},
  feature = {},
  sequenceGaps = 0,
  thresholds = {},
} = {}) {
  const limits = { ...DATA_QUALITY_THRESHOLDS, ...thresholds };
  const checks = [];
  const tickAgeMs = Number.isFinite(Number(feed.tickAgeMs)) ? Number(feed.tickAgeMs) : null;

  checks.push(check("FEED_CONNECTED", feed.connected === true, "CRITICAL", feed.connected === true ? null : "WS_DISCONNECTED"));
  checks.push(check("FEED_FRESH", tickAgeMs !== null && tickAgeMs <= limits.feedStaleMs, "CRITICAL", tickAgeMs === null ? "TICK_AGE_UNAVAILABLE" : `tickAgeMs=${tickAgeMs}`));

  const gaps = Number(sequenceGaps) || 0;
  checks.push(check("SEQUENCE_CONTINUOUS", gaps === 0, gaps >= limits.criticalSequenceGaps ? "CRITICAL" : "DEGRADED", gaps ? `sequenceGaps=${gaps}` : null));
  const duplicates = Number(candles.duplicates) || 0;
  checks.push(check("NO_DUPLICATES", duplicates === 0, "DEGRADED", duplicates ? `duplicates=${duplicates}` : null));
  const reorder = Number(candles.reorder) || 0;
  checks.push(check("NO_REORDER", reorder === 0, "DEGRADED", reorder ? `reorder=${reorder}` : null));

  const missingBuckets = Number(candles.missingBuckets) || 0;
  checks.push(check("CANDLES_PRESENT", Number(candles.count) >= limits.minCandles, "DEGRADED", `count=${Number(candles.count) || 0}`));
  checks.push(check("CANDLE_GAPS_OK", missingBuckets < limits.criticalMissingBuckets, "CRITICAL", missingBuckets ? `missingBuckets=${missingBuckets}` : null));

  const skewMs = Number.isFinite(Number(clock.skewMs)) ? Math.abs(Number(clock.skewMs)) : null;
  checks.push(check("CLOCK_VALID", clock.timeValid === true, "CRITICAL", clock.timeValid === true ? null : "TIME_INVALID"));
  if (skewMs !== null) checks.push(check("CLOCK_DRIFT_OK", skewMs <= limits.clockDriftMs, "CRITICAL", `skewMs=${skewMs}`));

  checks.push(check("MARKET_MAPPED", marketMapping.activeId !== null && marketMapping.activeId !== undefined && marketMapping.resolved !== false, "CRITICAL", `activeId=${String(marketMapping.activeId ?? "null")} resolved=${String(marketMapping.resolved ?? "unknown")}`));
  const suffix = marketKey && String(marketKey).includes(":") ? String(marketKey).slice(String(marketKey).lastIndexOf(":") + 1).toUpperCase() : null;
  const typeConsistent = !suffix || !marketType || suffix === String(marketType).toUpperCase();
  checks.push(check("NORMAL_OTC_CONSISTENT", typeConsistent, "CRITICAL", typeConsistent ? null : `keySuffix=${suffix} marketType=${marketType}`));

  const featureAge = Number.isFinite(Number(feature.ageMs)) ? Number(feature.ageMs) : null;
  checks.push(check("FEATURE_FRESH", feature.fresh === true || (featureAge !== null && featureAge <= limits.featureStaleMs), "CRITICAL", feature.fresh === true ? null : `${feature.reason ?? "NO_FEATURE"} ageMs=${String(featureAge)}`));

  if (broker.evaluated === true) {
    checks.push(check("BROKER_STATE_OK", broker.connected === true, "DEGRADED", broker.connected === true ? null : "BROKER_DISCONNECTED"));
    const contextMatches = !accountContext || !broker.accountType || String(broker.accountType).toUpperCase() === String(accountContext).toUpperCase();
    checks.push(check("ACCOUNT_CONTEXT_CONSISTENT", contextMatches, "CRITICAL", contextMatches ? null : `accountType=${broker.accountType} accountContext=${accountContext}`));
  }

  const critical = checks.filter((row) => !row.ok && row.severity === "CRITICAL");
  const degraded = checks.filter((row) => !row.ok && row.severity === "DEGRADED");
  const state = critical.length ? "UNSAFE" : degraded.length ? "DEGRADED" : "HEALTHY";
  const availableAt = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  return {
    schema: "data-quality-assessment-v1",
    agentId: "DATA_QUALITY_AGENT",
    agentVersion: DATA_QUALITY_AGENT_VERSION,
    marketKey, marketType, accountContext,
    state,
    noTrade: state === "UNSAFE",
    assessment: state === "HEALTHY" ? "dados_consistentes" : state === "DEGRADED" ? "dados_degradados" : "dados_inseguros_para_decisao",
    checks,
    unsafeReasons: critical.map((row) => row.id),
    degradedReasons: degraded.map((row) => row.id),
    thresholds: limits,
    provenance: {
      evaluatedAt: availableAt,
      "dataQuality.state": provenanceEntry({ value: state, source: "DETERMINISTIC_CALCULATION", producer: "data-quality-agent-v1", formulaVersion: DATA_QUALITY_AGENT_VERSION, calculatedAt: availableAt, availableAt }),
    },
    availableAt,
    createdAt: availableAt,
  };
}

/** Entrada de qualidade a partir de um ctx de runtime — usada no hook observacional do V4. */
export function dataQualityInputFromRuntime(ctx = {}, { now = Date.now(), sequenceGaps = 0, duplicateWindow = null, reorderWindow = null, featureStaleMs = DATA_QUALITY_THRESHOLDS.featureStaleMs } = {}) {
  const lastTickAt = Number.isFinite(Number(ctx.lastTickAt)) ? Number(ctx.lastTickAt) : null;
  const featureBuiltAt = Number.isFinite(Number(ctx.featureState?.builtAt)) ? Number(ctx.featureState.builtAt) : null;
  return {
    marketKey: ctx.marketKey ?? null,
    marketType: ctx.marketType ?? null,
    accountContext: ctx.accountContext ?? null,
    now,
    feed: { connected: ctx.connectionHealth?.connected === true, lastTickAt, tickAgeMs: lastTickAt === null ? null : Math.max(0, now - lastTickAt) },
    candles: {
      count: ctx.candles?.size ?? 0,
      duplicates: Number.isFinite(Number(duplicateWindow)) ? Number(duplicateWindow) : (ctx.stats?.duplicates ?? 0),
      reorder: Number.isFinite(Number(reorderWindow)) ? Number(reorderWindow) : (ctx.stats?.reorder ?? 0),
      missingBuckets: Math.max(0, Number.isFinite(Number(sequenceGaps)) ? Number(sequenceGaps) : (ctx.stats?.gaps ?? 0)),
    },
    clock: { skewMs: ctx.clockSkewMs ?? null, timeValid: ctx.timeValid === true },
    marketMapping: { activeId: ctx.activeId ?? null, resolved: ctx.activeId !== null && ctx.activeId !== undefined },
    consistency: {},
    broker: { evaluated: true, connected: ctx.connectionHealth?.connected === true, accountType: ctx.accountType ?? null },
    feature: { fresh: ctx.featureState?.fresh === true, builtAt: featureBuiltAt, reason: ctx.featureState?.freshnessReason ?? null, ageMs: featureBuiltAt === null ? null : Math.max(0, now - featureBuiltAt) },
    sequenceGaps,
    thresholds: { featureStaleMs },
  };
}
