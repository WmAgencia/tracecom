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
    this.client = new IqMcpClient({ endpoint: IQ_MCP_ENDPOINTS.blitz, log: this.log, now: this.now });
  }

  setToken(token) { return this.client.setToken(token); }
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
    // Persist-first: registra a execucao antes do envio (mesmo padrao do binario).
    if (this.pool?.query) {
      await this.pool.query(
        "INSERT INTO iq_executions (execution_id, decision_id, market_key, symbol, mode, account_type, account_context, direction, stake, currency, state, payout, requested_at, expiration_at, meta) VALUES ($1,$2,$3,$3,'PRACTICE','PRACTICE','PRACTICE',$4,$5,'USD','REQUESTED',$6,now(),$7,$8::jsonb) ON CONFLICT (execution_id) DO NOTHING",
        [executionId, strategyTradeId ?? null, marketKey, String(direction).toUpperCase() === "SELL" ? "PUT" : "CALL", amount, profitPercent, expirationAt.toISOString(), JSON.stringify({ blitz: true, expirationSeconds: this.expirationSeconds, strategyId: strategyId ?? null })]
      ).catch(() => undefined);
    }
    let result = null;
    try {
      result = await this.client.placeTrade({ balanceId, assetId, direction, amount, profitPercent: profitPercent ?? 80, expirationSize: this.expirationSeconds });
    } catch (error) {
      this.stats.errors += 1; this.stats.lastError = String(error?.code ?? error?.message ?? error).slice(0, 140);
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

  /** Liquida as execucoes Blitz pendentes pelo trade history do MCP. */
  async pollSettlements() {
    if (!this.enabled || !this.pool?.query) return null;
    if (this.now() - (this.lastPollAt ?? 0) < 20_000) return null;
    this.lastPollAt = this.now();
    try {
      const history = await this.#mcpWithRetry(() => this.client.getTradeHistory({ limit: 50 }));
      for (const trade of Array.isArray(history) ? history : []) {
        const raw = String(trade?.result ?? "").toLowerCase();
        const mapped = raw === "win" ? "WIN" : raw === "loose" || raw === "loss" ? "LOSS" : raw === "equal" || raw === "draw" ? "DRAW" : null;
        if (!mapped) continue;
        const positionId = String(trade?.position_id ?? trade?.id ?? "");
        if (!positionId) continue;
        const row = (await this.pool.query("SELECT execution_id, market_key, stake, direction FROM iq_executions WHERE broker_order_id=$1 AND broker_result IS NULL LIMIT 1", [positionId]).catch(() => ({ rows: [] }))).rows?.[0] ?? null;
        if (!row) continue;
        const profit = Number(trade?.pnl ?? trade?.profit ?? 0) || (mapped === "WIN" ? Number(row.stake) * 0.82 : mapped === "LOSS" ? -Number(row.stake) : 0);
        await this.pool.query("UPDATE iq_executions SET state='SETTLED', broker_result=$2, profit=$3, settled_at=now(), causal_result=$2 WHERE execution_id=$1", [row.execution_id, mapped, profit]).catch(() => undefined);
        try {
          this.runtime?.openPositions?.delete?.(row.market_key);
          const ctx = this.runtime?.markets?.get?.(row.market_key) ?? null;
          if (ctx) ctx.positionState = { ...ctx.positionState, status: "SETTLED", settledAt: this.now(), result: mapped, profit };
        } catch { /* noop */ }
        this.stats.settled += 1;
        this.log("BLITZ_SETTLED", JSON.stringify({ marketKey: row.market_key, result: mapped, profit, positionId }));
      }
      return this.stats.settled;
    } catch (error) {
      this.stats.errors += 1; this.stats.lastError = String(error?.code ?? error?.message ?? error).slice(0, 140);
      this.log("BLITZ_SETTLE_FAIL", this.stats.lastError);
      return null;
    }
  }

  status() {
    return { version: BLITZ_LAB_VERSION, enabled: this.enabled, expirationSeconds: this.expirationSeconds, balanceId: this.balanceId, stats: { ...this.stats } };
  }
}
