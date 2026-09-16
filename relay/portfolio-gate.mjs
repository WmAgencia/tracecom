/**
 * PORTFOLIO EXECUTION GATE — gate global acima dos mercados (NORMAL + OTC).
 * Cada checagem e auditavel (nome + ok + detalhe). Fail-closed: qualquer falha bloqueia.
 * Nao substitui o gate PRACTICE congelado (iqoption-connector.executionGate); e aplicado ANTES dele.
 */
import { HARD_CAP_STAKE, MAX_ACTIVE_MARKETS, MAX_OPEN_POSITIONS_PER_MARKET, entryForKey, concentrationExposure } from "./market-universe.mjs";

export const GATE_VERSION = "portfolio-execution-gate-v1";

/**
 * Resolve o valor da proxima operacao.
 * configuredStake (valor escolhido pelo operador) e o stakeRequested; ele NAO e apenas teto.
 * O valor final passa por: teto do mercado, teto global e hard cap (nunca silencioso: devolve motivo).
 */
export function resolveFinalStake({ configuredStake, calculatedBankrollStake, marketConfiguredStake, marketMaxStake, globalMaxStake, hardCap = HARD_CAP_STAKE, requestedStake } = {}) {
  const requested = [requestedStake, marketConfiguredStake, configuredStake, calculatedBankrollStake]
    .map(Number).find((value) => Number.isFinite(value) && value > 0) ?? null;
  if (requested === null) return { finalStake: null, requestedStake: null, reason: "NO_STAKE_CONFIGURED", adjustment: null, source: "NONE" };
  const source = Number.isFinite(Number(requestedStake)) && Number(requestedStake) > 0 ? "MANUAL_OVERRIDE"
    : Number.isFinite(Number(marketConfiguredStake)) && Number(marketConfiguredStake) > 0 ? "MARKET_CONFIGURED"
    : Number.isFinite(Number(configuredStake)) && Number(configuredStake) > 0 ? "GLOBAL_CONFIGURED"
    : "FALLBACK_CALCULATED";
  const caps = [
    { name: "MARKET_MAX", value: Number(marketMaxStake) },
    { name: "GLOBAL_MAX", value: Number(globalMaxStake) },
    { name: "HARD_CAP", value: Number(hardCap) },
  ].filter((cap) => Number.isFinite(cap.value) && cap.value > 0);
  const binding = caps.filter((cap) => cap.value < requested).sort((a, b) => a.value - b.value)[0] ?? null;
  const finalStake = binding ? binding.value : requested;
  return {
    finalStake,
    requestedStake: requested,
    source,
    cappedBy: binding ? binding.name : "REQUESTED",
    reason: binding ? `STAKE_ADJUSTED_BY_${binding.name}` : "STAKE_AS_CONFIGURED",
    adjustment: binding ? { applied: true, reason: binding.name, from: requested, to: binding.value } : { applied: false, reason: null, from: requested, to: requested },
    hardCap,
  };
}

export class PortfolioExecutionGate {
  constructor({ hardCap = HARD_CAP_STAKE, maxActiveMarkets = MAX_ACTIVE_MARKETS, maxOpenPerMarket = MAX_OPEN_POSITIONS_PER_MARKET, maxGlobalOpenPositions = MAX_ACTIVE_MARKETS, correlationLimit = 3 } = {}) {
    this.hardCap = hardCap; this.maxActiveMarkets = maxActiveMarkets; this.maxOpenPerMarket = maxOpenPerMarket; this.maxGlobalOpenPositions = maxGlobalOpenPositions; this.correlationLimit = correlationLimit;
  }

  evaluate(input = {}) {
    const {
      market = null, marketKey = null, requestedMode = "PRACTICE", realAuthorized = false,
      connection = {}, serverTime = {}, freshness = {}, decision = {}, strategy = {}, price = null,
      stake = null, globalMaxStake = null, calculatedBankrollStake = null,
      openPositions = [], pendingOrderKeys = [], usedIdempotencyKeys = [], activeMarketKeys = [],
      killSwitch = {}, idempotencyKey = null, horizonSeconds = null,
    } = input;
    const checks = [];
    const add = (name, ok, detail = null) => checks.push({ name, ok: ok === true, detail });
    const entry = marketKey ? entryForKey(marketKey) : null;

    add("market_configured", Boolean(market && entry), market ? market.marketKey : null);
    add("market_enabled", market?.enabled === true, market ? { enabled: market.enabled === true, paused: market.paused === true } : null);
    add("market_not_paused", market?.paused !== true, market ? { paused: market.paused === true } : null);
    add("market_available", market?.availability === "OPEN" && market?.activeId !== null && market?.activeId !== undefined, market ? { availability: market.availability, activeId: market.activeId ?? null } : null);
    add("market_type_correct", Boolean(entry) && entry.marketType === market?.marketType, entry && market ? { expected: entry.marketType, actual: market.marketType } : null);
    add("active_id_valid", Number.isFinite(Number(market?.activeId)) && Number(market.activeId) > 0, market?.activeId ?? null);
    add("mode_valid", requestedMode === "PRACTICE" || (requestedMode === "REAL" && realAuthorized === true), { requestedMode, realAuthorized: realAuthorized === true });
    add("connection_healthy", connection.connected === true && connection.timeValid === true, { connected: connection.connected === true, timeValid: connection.timeValid === true, host: connection.host ?? null });
    add("server_time_valid", Number.isFinite(Number(serverTime.ms)) && Math.abs(Number(serverTime.skewMs ?? 0)) <= 2_000, { ms: serverTime.ms ?? null, skewMs: serverTime.skewMs ?? null });
    add("freshness_valid", freshness.fresh === true && Number(freshness.tickAgeMs) <= 15_000, { fresh: freshness.fresh === true, tickAgeMs: freshness.tickAgeMs ?? null, reason: freshness.reason ?? null });
    add("decision_valid", decision.action === "BUY" || decision.action === "SELL", { action: decision.action ?? null, reason: decision.reason ?? null });
    add("decision_not_stale", Number(decision.ageMs ?? 0) <= 50_000, { ageMs: decision.ageMs ?? null });
    add("horizon_valid", Number(horizonSeconds ?? decision.horizonSeconds ?? 0) > 0, horizonSeconds ?? decision.horizonSeconds ?? null);
    add("strategy_valid", strategy.valid === true, { variantId: strategy.variantId ?? null, reason: strategy.reason ?? null });
    add("price_valid", Number.isFinite(Number(price)) && Number(price) > 0, price ?? null);
    add("payout_valid", Number.isFinite(Number(market?.payout)) && Number(market.payout) > 0, market?.payout ?? null);
    add("no_conflicting_position", (openPositions.filter((position) => position.marketKey === market?.marketKey)).length < this.maxOpenPerMarket, { openInMarket: openPositions.filter((position) => position.marketKey === market?.marketKey).length, limit: this.maxOpenPerMarket });
    add("no_inflight_order", !pendingOrderKeys.includes(market?.marketKey), { pending: pendingOrderKeys.filter((key) => key === market?.marketKey).length });
    add("idempotency_key_fresh", Boolean(idempotencyKey) && !usedIdempotencyKeys.includes(idempotencyKey), idempotencyKey ? { duplicate: usedIdempotencyKeys.includes(idempotencyKey) } : null);
    add("kill_switch_off", killSwitch.executionEnabled === true, { executionEnabled: killSwitch.executionEnabled === true });
    add("global_positions_respected", openPositions.length < this.maxGlobalOpenPositions, { open: openPositions.length, limit: this.maxGlobalOpenPositions });
    add("active_markets_respected", new Set(activeMarketKeys).size <= this.maxActiveMarkets, { active: new Set(activeMarketKeys).size, limit: this.maxActiveMarkets });

    const resolved = resolveFinalStake({ requestedStake: Number.isFinite(Number(stake)) && Number(stake) > 0 ? Number(stake) : undefined, marketConfiguredStake: Number(market?.configuredStake), configuredStake: Number(input.configuredStake), calculatedBankrollStake: Number(calculatedBankrollStake), marketMaxStake: Number(market?.maxStake), globalMaxStake: Number(globalMaxStake), hardCap: this.hardCap });
    const stakeValue = Number.isFinite(Number(stake)) && Number(stake) > 0 ? Number(stake) : resolved.finalStake;
    add("market_stake_respected", Number.isFinite(stakeValue) && stakeValue > 0 && stakeValue <= Number(market?.maxStake ?? Infinity), { stake: Number.isFinite(stakeValue) ? stakeValue : null, marketMaxStake: market?.maxStake ?? null });
    add("global_stake_respected", Number.isFinite(stakeValue) && stakeValue <= Number(globalMaxStake ?? Infinity), { stake: Number.isFinite(stakeValue) ? stakeValue : null, globalMaxStake: globalMaxStake ?? null });
    add("hard_cap_respected", Number.isFinite(stakeValue) && stakeValue <= this.hardCap, { stake: Number.isFinite(stakeValue) ? stakeValue : null, hardCap: this.hardCap });

    const concentration = concentrationExposure(openPositions);
    const concentrationViolation = concentration.exposures.some((row) => Math.max(row.longCount, row.shortCount) >= this.correlationLimit);
    add("correlation_within_limit", !concentrationViolation, { limit: this.correlationLimit, warnings: concentration.warnings });

    const failed = checks.filter((check) => !check.ok);
    return { allowed: failed.length === 0, version: GATE_VERSION, code: failed[0]?.name?.toUpperCase() ?? "OK", reasons: failed.map((check) => check.name), checks, finalStake: resolved.finalStake, cappedBy: resolved.cappedBy, concentration };
  }
}
