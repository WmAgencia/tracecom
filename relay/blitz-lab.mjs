/**
 * BLITZ LAB — ordens OTC Blitz (expiração configurável, entrada imediata) via MCP oficial.
 *
 * Aditivo: NAO altera a estratégia dos binários. Usa a MESMA análise/consenso/segurança
 * (o runtime passa o mesmo snapshot) e envia via endpoint MCP `blitz` com expiration_size.
 * Liquida pelo trade history do MCP e registra a execução (mesmo formato do binário),
 * para o LabRunner atribuir o resultado ao trade.
 */
import { IqMcpClient, IQ_MCP_ENDPOINTS } from "./iq-mcp-client.mjs";

export const BLITZ_LAB_VERSION = "blitz-lab-v1";
export const BLITZ_EXPIRATION_SECONDS = 45;

export class BlitzLab {
  constructor({ runtime, pool, log = () => {}, now = () => Date.now(), expirationSeconds = BLITZ_EXPIRATION_SECONDS } = {}) {
    this.runtime = runtime;
    this.pool = pool;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.now = now;
    this.expirationSeconds = Math.max(5, Math.min(300, Number(expirationSeconds) || BLITZ_EXPIRATION_SECONDS));
    this.balanceId = null;
    this.stats = { submits: 0, settled: 0, errors: 0, lastError: null, lastOrderAt: null };
    this.pausedUntil = 0;
    this.client = new IqMcpClient({ endpoint: IQ_MCP_ENDPOINTS.blitz, log: this.log, now: this.now });
  }

  setToken(token) { return this.client.setToken(token); }
  get paused() { return this.now() < Number(this.pausedUntil ?? 0); }
  get enabled() { return this.client.enabled; }

  async #balance() {
    if (Number.isFinite(Number(this.balanceId))) return Number(this.balanceId);
    const balances = await this.client.listBalances();
    const practice = balances.find((b) => /practice|training/i.test(String(b.type ?? b.balance_type ?? "")) || b.is_practice === true) ?? balances[0] ?? null;
    const id = Number(practice?.balance_id ?? practice?.id);
    if (!Number.isFinite(id)) throw Object.assign(new Error("BLITZ_BALANCE_UNAVAILABLE"), { code: "BLITZ_BALANCE_UNAVAILABLE" });
    this.balanceId = id;
    return id;
  }

  /** Envia a ordem Blitz (entrada imediata, expiração fixa) e registra a execução. */
  async submit({ marketKey, direction, stake, strategyId, strategyTradeId, payout = null }) {
    if (!this.enabled) throw Object.assign(new Error("BLITZ_MCP_TOKEN_MISSING"), { code: "BLITZ_MCP_TOKEN_MISSING" });
    const ctx = this.runtime?.markets?.get?.(marketKey) ?? null;
    if (!ctx) throw Object.assign(new Error("BLITZ_UNKNOWN_MARKET"), { code: "BLITZ_UNKNOWN_MARKET" });
    const assetId = Number(ctx.activeId);
    if (!Number.isFinite(assetId)) throw Object.assign(new Error("BLITZ_ASSET_MISSING"), { code: "BLITZ_ASSET_MISSING" });
    const amount = Number(stake);
    if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error("BLITZ_STAKE_REQUIRED"), { code: "BLITZ_STAKE_REQUIRED" });
    const profitPercent = Number(payout ?? ctx.payout ?? 0) || null;
    const balanceId = await this.#balance();
    const expirationAt = new Date(this.now() + this.expirationSeconds * 1000);
    const executionId = `exec_blitz_${this.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let entryPrice = null;
    try { const batch = await this.runtime?.candlesBatch?.([marketKey], 2); const list = batch?.rows?.[marketKey] ?? []; entryPrice = list.length ? Number(list[list.length - 1].close) : null; } catch { /* noop */ }
    // Persist-first: registra a execucao antes do envio (mesmo padrao do binario).
    if (this.pool?.query) {
      await this.pool.query(
        "INSERT INTO iq_executions (execution_id, decision_id, market_key, symbol, mode, account_type, account_context, direction, stake, currency, state, payout, entry_price, requested_at, expiration_at, meta) VALUES ($1,$2,$3,$3,'PRACTICE','PRACTICE','PRACTICE',$4,$5,'USD','REQUESTED',$6,$7,now(),$8,$9::jsonb) ON CONFLICT (execution_id) DO NOTHING",
        [executionId, strategyTradeId ?? null, marketKey, String(direction).toUpperCase() === "SELL" ? "PUT" : "CALL", amount, profitPercent, Number.isFinite(entryPrice) ? entryPrice : null, expirationAt.toISOString(), JSON.stringify({ blitz: true, expirationSeconds: this.expirationSeconds, strategyId: strategyId ?? null })]
      ).catch(() => undefined);
    }
    let result = null;
    try {
      result = await this.client.placeTrade({ balanceId, assetId, direction, amount, profitPercent: profitPercent ?? 80, expirationSize: this.expirationSeconds });
    } catch (error) {
      this.stats.errors += 1; this.stats.lastError = String(error?.code ?? error?.message ?? error).slice(0, 140);
      if (String(this.stats.lastError).includes("IQ_MCP_BAD_RESPONSE") || String(this.stats.lastError).includes("IQ_MCP_BUSY") || String(this.stats.lastError).includes("RATE_LIMIT")) this.pausedUntil = this.now() + 300_000;
      if (this.pool?.query) await this.pool.query("UPDATE iq_executions SET state='REJECTED', error=$2, settled_at=now() WHERE execution_id=$1", [executionId, this.stats.lastError]).catch(() => undefined);
      throw error;
    }
    const positionId = String(result?.position_id ?? result?.id ?? result?.positionId ?? "");
    const brokerOrderId = positionId || null;
    if (this.pool?.query) {
      await this.pool.query("UPDATE iq_executions SET state='ACKNOWLEDGED', broker_order_id=$2, acked_at=now() WHERE execution_id=$1", [executionId, brokerOrderId]).catch(() => undefined);
    }
    this.stats.submits += 1;
    this.stats.lastOrderAt = this.now();
    try { this.runtime?.blitzLastEntryAt?.set?.(marketKey, this.now()); } catch { /* noop */ }
    try {
      if (this.runtime?.openPositions?.set) this.runtime.openPositions.set(marketKey, { marketKey, accountContext: "PRACTICE", stake: amount, direction, brokerOrderId, executionId, openedAt: this.now(), settledAt: null, result: null, profit: null });
      if (ctx) ctx.positionState = { ...ctx.positionState, status: "OPEN", direction: String(direction).toUpperCase() === "SELL" ? "PUT" : "CALL", stake: amount, brokerOrderId, executionId, openedAt: this.now(), settledAt: null, result: null, profit: null, expirationSec: this.expirationSeconds };
    } catch { /* noop */ }
    this.log("BLITZ_ORDER_SENT", JSON.stringify({ marketKey, direction, stake: amount, expirationSeconds: this.expirationSeconds, positionId: brokerOrderId, executionId }));
    return { state: "ACKNOWLEDGED", brokerOrderId, executionId, expirationAt: expirationAt.toISOString(), stake: amount, mode: "PRACTICE", blitz: true };
  }

  async #mcpWithRetry(fn, tries = 3) { let last = null; for (let i = 0; i < tries; i += 1) { try { return await fn(); } catch (error) { last = error; await new Promise((r) => setTimeout(r, 2000)); } } throw last ?? new Error("IQ_MCP_RETRY_FAILED"); }

  /** Liquida as execucoes Blitz pendentes pelo FEED (close no vencimento vs preco de entrada). */
  async pollSettlements() {
    if (!this.pool?.query) return null;
    if (this.now() - (this.lastPollAt ?? 0) < 15_000) return null;
    this.lastPollAt = this.now();
    const due = await this.pool.query("SELECT execution_id, market_key, direction, stake, payout, entry_price, expiration_at FROM iq_executions WHERE meta->>'blitz' = 'true' AND broker_result IS NULL AND state IN ('REQUESTED','ACKNOWLEDGED','SUBMITTED','PENDING_ACK','UNKNOWN') AND expiration_at <= now() ORDER BY expiration_at LIMIT 40").catch(() => ({ rows: [] }));
    for (const row of due.rows ?? []) {
      const batch = await this.runtime?.candlesBatch?.([row.market_key], 20).catch(() => null);
      const list = batch?.rows?.[row.market_key] ?? [];
      const expMs = new Date(row.expiration_at).getTime();
      const candle = [...list].reverse().find((c) => Number(c.bucketEnd) <= expMs + 3_000 && Number(c.bucketEnd) >= expMs - 12_000);
      if (!candle) continue;
      const close = Number(candle.close);
      const entry = Number(row.entry_price);
      if (!Number.isFinite(close) || !Number.isFinite(entry)) continue;
      const up = String(row.direction).toUpperCase() === "CALL" || String(row.direction).toUpperCase() === "BUY";
      const mapped = close === entry ? "DRAW" : (up ? close > entry : close < entry) ? "WIN" : "LOSS";
      const payout = Number(row.payout ?? 0);
      const stake = Number(row.stake ?? 0);
      const profit = mapped === "WIN" ? Number((stake * (payout > 0 ? payout : 82) / 100).toFixed(4)) : mapped === "LOSS" ? -stake : 0;
      await this.pool.query("UPDATE iq_executions SET state='SETTLED', broker_result=$2, profit=$3, close_price=$4, settled_at=now(), causal_result=$2 WHERE execution_id=$1", [row.execution_id, mapped, profit, close]).catch(() => undefined);
      try {
        this.runtime?.openPositions?.delete?.(row.market_key);
        const ctx = this.runtime?.markets?.get?.(row.market_key) ?? null;
        if (ctx) ctx.positionState = { ...ctx.positionState, status: "SETTLED", settledAt: this.now(), result: mapped, profit };
      } catch { /* noop */ }
      this.stats.settled += 1;
      this.log("BLITZ_SETTLED", JSON.stringify({ marketKey: row.market_key, result: mapped, profit, close }));
    }
    return this.stats.settled;
  }

  status() {
    return { version: BLITZ_LAB_VERSION, enabled: this.enabled, expirationSeconds: this.expirationSeconds, balanceId: this.balanceId, stats: { ...this.stats } };
  }
}
