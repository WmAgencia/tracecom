/**
 * IQOPTION CONNECTOR — nucleo deterministico e fail-closed (adapter isolado, NAO altera o pipeline atual).
 * Execucao permitida: SOMENTE PRACTICE. REAL => REAL_ACCOUNT_EXECUTION_FORBIDDEN (server-side, imutavel).
 * Sem credenciais aqui (SSID vive em secret storage do servidor). Sem automacao REAL em nenhuma hipotese.
 */
export const EXECUTION_ACCOUNT = "PRACTICE";
export const PRACTICE_ONLY = true; // invariante desta implementacao
export const DEFAULT_STAKE_CAP = 1.0; // limite adicional de validacao (stake minimo do ambiente PRACTICE)
export const MAX_PRACTICE_STAKE_BRL = 100; // HARD CAP — backend rejeita acima disso mesmo com payload adulterado
export const ORDER_STATES = ["REQUESTED", "ACKNOWLEDGED", "OPEN", "SETTLED", "REJECTED", "UNKNOWN"];

export class ConnectorError extends Error { constructor(code, detail = "") { super(detail ? `${code}: ${detail}` : code); this.code = code; } }

/** Enforcamento soberano de conta. Nenhum prompt/LLM/UI/payload pode contornar. */
export function assertPracticeAccount(accountType) {
  const normalized = typeof accountType === "string" ? accountType.trim().toUpperCase() : "";
  if (normalized !== "PRACTICE" && normalized !== "DEMO") throw new ConnectorError("REAL_ACCOUNT_EXECUTION_FORBIDDEN", `accountType=${normalized || "UNKNOWN"} (practiceOnly=${PRACTICE_ONLY})`);
  return "PRACTICE";
}

export class KillSwitch { constructor(enabled = true) { this.enabled = enabled; } engage() { this.enabled = false; } release() { this.enabled = true; } status() { return { executionEnabled: this.enabled, practiceOnly: PRACTICE_ONLY }; } }

export class IdempotencyStore {
  constructor() { this.byKey = new Map(); }
  /** Uma decisao -> no maximo UMA ordem. Duplicata retorna a ordem existente (nunca reenvia). */
  register(idempotencyKey, payload) {
    const key = String(idempotencyKey ?? "").trim();
    if (!key) throw new ConnectorError("IDEMPOTENCY_KEY_REQUIRED");
    if (this.byKey.has(key)) return { duplicate: true, record: this.byKey.get(key) };
    const record = { idempotencyKey: key, executionId: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, brokerOrderId: null, state: "REQUESTED", payload, createdAt: Date.now() };
    this.byKey.set(key, record);
    return { duplicate: false, record };
  }
  acknowledge(key, brokerOrderId) { const record = this.byKey.get(key); if (!record) throw new ConnectorError("UNKNOWN_IDEMPOTENCY_KEY"); record.brokerOrderId = brokerOrderId ?? record.brokerOrderId; record.state = record.brokerOrderId ? "ACKNOWLEDGED" : "UNKNOWN"; return record; }
  settle(key, result) { const record = this.byKey.get(key); if (!record) throw new ConnectorError("UNKNOWN_IDEMPOTENCY_KEY"); record.state = "SETTLED"; record.result = result; return record; }
  get(key) { return this.byKey.get(key) ?? null; }
}

/** Normalizacao causal de ticks/candles 5s. Nunca mistura ativos, nunca aceita futuro, deduplica e ordena. */
export function normalizeTick(tick, { asset, expectedAsset, serverTime }) {
  if (typeof asset !== "string" || !asset) throw new ConnectorError("ASSET_REQUIRED");
  if (expectedAsset && asset !== expectedAsset) throw new ConnectorError("CROSS_ASSET_REJECTED", `${asset} != ${expectedAsset}`);
  const price = Number(tick?.price ?? tick?.value ?? NaN);
  const ts = Number(tick?.timestamp ?? NaN);
  if (!Number.isFinite(price) || !Number.isFinite(ts)) throw new ConnectorError("INVALID_TICK");
  if (Number.isFinite(serverTime) && ts > serverTime + 5_000) throw new ConnectorError("FUTURE_TICK_REJECTED");
  return { asset, timestamp: ts, price, ask: Number.isFinite(Number(tick?.ask)) ? Number(tick.ask) : null, bid: Number.isFinite(Number(tick?.bid)) ? Number(tick.bid) : null, bucketStart: Math.floor(ts / 5_000) * 5_000, source: "IQ_OPTION_WS" };
}

export function buildCausalCandles(ticks, { asset, expectedAsset, serverTime, bucketMs = 5_000 } = {}) {
  const byBucket = new Map();
  for (const tick of ticks) {
    const normalized = normalizeTick(tick, { asset: tick.asset ?? asset, expectedAsset: expectedAsset ?? asset, serverTime });
    const key = normalized.bucketStart;
    const existing = byBucket.get(key);
    if (!existing) byBucket.set(key, { asset: normalized.asset, bucketStart: key, bucketEnd: key + bucketMs, open: normalized.price, high: normalized.price, low: normalized.price, close: normalized.price, tickCount: 1, source: "IQ_OPTION_WS" });
    else { existing.high = Math.max(existing.high, normalized.price); existing.low = Math.min(existing.low, normalized.price); existing.close = normalized.price; existing.tickCount += 1; }
  }
  return [...byBucket.values()].sort((a, b) => a.bucketStart - b.bucketStart);
}

/** Validacao final antes de enviar ordem PRACTICE (server-side; payload adulterado nao passa). */
export function validatePracticeOrder(request, { now = Date.now(), killSwitch, idempotency, stakeCap = DEFAULT_STAKE_CAP, accountType, expectedAsset } = {}) {
  assertPracticeAccount(accountType);
  if (killSwitch && killSwitch.status().executionEnabled !== true) throw new ConnectorError("KILL_SWITCH_ACTIVE");
  const direction = request?.direction === "BUY" ? "CALL" : request?.direction === "SELL" ? "PUT" : null;
  if (!direction) throw new ConnectorError("INVALID_DIRECTION");
  if (!request?.decisionId) throw new ConnectorError("DECISION_ID_REQUIRED");
  const stake = Number(request?.stake);
  if (!Number.isFinite(stake) || stake <= 0) throw new ConnectorError("INVALID_STAKE");
  if (stake > stakeCap) throw new ConnectorError("STAKE_CAP_EXCEEDED", `${stake} > ${stakeCap}`);
  if (expectedAsset && request?.asset !== expectedAsset) throw new ConnectorError("ASSET_MISMATCH");
  const age = Number.isFinite(Number(request?.decisionAgeMs)) ? Number(request.decisionAgeMs) : Infinity;
  if (age > 50_000) throw new ConnectorError("STALE_DECISION");
  const horizonSeconds = Number(request?.horizonSeconds);
  if (!Number.isFinite(horizonSeconds) || horizonSeconds <= 0) throw new ConnectorError("INVALID_HORIZON");
  if (!request?.marketOpen) throw new ConnectorError("MARKET_CLOSED");
  const registered = idempotency.register(request.idempotencyKey, { direction, stake, asset: request.asset, horizonSeconds, decisionId: request.decisionId });
  return { direction, stake, asset: request.asset, horizonSeconds, ...registered };
}

/** Confirmacao real da corretora: sem ACK/brokerOrderId nao existe operacao executada. */
export function applyBrokerAcknowledgement(record, response) {
  if (!record) throw new ConnectorError("UNKNOWN_RECORD");
  const brokerOrderId = response?.orderId ?? response?.id ?? null;
  if (response?.error) { record.state = "REJECTED"; record.rejection = String(response.error).slice(0, 160); return record; }
  if (!brokerOrderId) { record.state = "UNKNOWN"; return record; }
  record.state = "ACKNOWLEDGED";
  record.brokerOrderId = String(brokerOrderId);
  return record;
}

/** Settlement: resultado real da IQ vs causal TraceCom; divergencia vira SETTLEMENT_MISMATCH (nunca ocultada). */
export function compareSettlement(brokerResult, causalResult) {
  const normalize = (value) => (value === "WIN" || value === "LOSS" || value === "DRAW" ? value : "UNKNOWN");
  const broker = normalize(brokerResult), causal = normalize(causalResult);
  if (broker === "UNKNOWN" || causal === "UNKNOWN") return { broker, causal, mismatch: false, reason: "INSUFFICIENT_EVIDENCE" };
  if (broker !== causal) return { broker, causal, mismatch: true, reason: "SETTLEMENT_MISMATCH" };
  return { broker, causal, mismatch: false, reason: "MATCH" };
}

/** ARM/DISARM — conectar NAO e operar. Pre-condicoes server-side + auto-disarm. */
export class ExecutionArmState {
  constructor() { this.state = "DISCONNECTED"; this.armed = false; this.connectedAccountType = null; this.marketDataHealthy = false; }
  onConnected(accountType) { this.connectedAccountType = assertPracticeAccount(accountType); this.state = "CONNECTED_PRACTICE"; this.armed = false; return this.snapshot(); }
  onMarketData(healthy) { this.marketDataHealthy = healthy === true; if (!this.marketDataHealthy) this.disarm("MARKET_DATA_UNHEALTHY"); return this.snapshot(); }
  arm(userLimitBrl, { explicitConfirmation } = {}) {
    // Re-ARM idempotente: se ja esta armado, atualiza apenas o limite (nunca falha por precondicao enganosa).
    if (this.state === "ARMED" && this.armed === true) {
      if (explicitConfirmation !== true) throw new ConnectorError("EXPLICIT_CONFIRMATION_REQUIRED");
      const rearmLimit = resolveStakeLimit(userLimitBrl, { brokerCurrency: "BRL" });
      return { ...this.snapshot(), limit: rearmLimit, rearm: true };
    }
    if (this.state !== "CONNECTED_PRACTICE" || !this.marketDataHealthy) throw new ConnectorError("ARM_PRECONDITIONS_NOT_MET");
    if (explicitConfirmation !== true) throw new ConnectorError("EXPLICIT_CONFIRMATION_REQUIRED");
    const limit = resolveStakeLimit(userLimitBrl, { brokerCurrency: "BRL" });
    this.armed = true; this.state = "ARMED";
    return { ...this.snapshot(), limit };
  }
  disarm(reason = "MANUAL") { this.armed = false; this.lastDisarmReason = reason; this.state = this.connectedAccountType ? "CONNECTED_PRACTICE" : "DISCONNECTED"; return { ...this.snapshot(), disarmReason: reason }; }
  onDisconnected() { this.connectedAccountType = null; this.marketDataHealthy = false; this.armed = false; this.lastDisarmReason = "DISCONNECTED"; this.state = "DISCONNECTED"; return this.snapshot(); }
  snapshot() { return { state: this.state, armed: this.armed, connectedAccountType: this.connectedAccountType, marketDataHealthy: this.marketDataHealthy, practiceOnly: PRACTICE_ONLY, maxPracticeStakeBrl: MAX_PRACTICE_STAKE_BRL, disarmReason: this.lastDisarmReason ?? null }; }
}

/** Limite configuravel (BRL) com hard cap; moeda estrangeira exige FX explicito ou CURRENCY_LIMIT_UNRESOLVED. */
export function resolveStakeLimit(userLimitBrl, { fxToBrokerCurrency = null, brokerCurrency = "BRL" } = {}) {
  const user = Number(userLimitBrl);
  if (!Number.isFinite(user) || user <= 0) throw new ConnectorError("INVALID_USER_LIMIT");
  const capped = Math.min(user, MAX_PRACTICE_STAKE_BRL);
  if (brokerCurrency === "BRL") return { brokerCurrency, userLimitBrl: capped, effective: capped, rate: 1, hardCapBrl: MAX_PRACTICE_STAKE_BRL };
  const rate = Number(fxToBrokerCurrency);
  if (!Number.isFinite(rate) || rate <= 0) throw new ConnectorError("CURRENCY_LIMIT_UNRESOLVED", `${brokerCurrency} sem FX confiavel`);
  return { brokerCurrency, userLimitBrl: capped, effective: capped * rate, rate, hardCapBrl: MAX_PRACTICE_STAKE_BRL };
}

/** Gate final: Decision -> Execution. WAIT/UNAVAILABLE/STALE NUNCA geram ordem. */
export function executionGate(request, runtime) {
  if (!runtime?.armState || runtime.armState.armed !== true) throw new ConnectorError("EXECUTION_NOT_ARMED");
  if (runtime.armState.connectedAccountType !== "PRACTICE") throw new ConnectorError("REAL_ACCOUNT_EXECUTION_FORBIDDEN");
  if (request?.action === "WAIT") throw new ConnectorError("WAIT_NEVER_EXECUTES");
  if (request?.action === "UNAVAILABLE" || request?.action === "STALE") throw new ConnectorError("DECISION_NOT_EXECUTABLE");
  if (request?.action !== "BUY" && request?.action !== "SELL") throw new ConnectorError("INVALID_DIRECTION");
  const limit = resolveStakeLimit(runtime.userLimitBrl, { fxToBrokerCurrency: runtime.fxRate ?? null, brokerCurrency: runtime.brokerCurrency ?? "BRL" });
  const stake = Number(request?.stake);
  if (!Number.isFinite(stake) || stake <= 0) throw new ConnectorError("INVALID_STAKE");
  if (stake > limit.effective) throw new ConnectorError("USER_LIMIT_EXCEEDED", `${stake} > ${limit.effective} ${limit.brokerCurrency}`);
  return { ...validatePracticeOrder({ ...request, direction: request.action, stake }, { now: runtime.now, killSwitch: runtime.killSwitch, idempotency: runtime.idempotency, stakeCap: MAX_PRACTICE_STAKE_BRL, accountType: runtime.accountType ?? "PRACTICE", expectedAsset: runtime.expectedAsset }), currency: limit };
}
