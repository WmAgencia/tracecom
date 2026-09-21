/**
 * LAB STORE — persistencia, capacidade (20 settlements com reserva de slot) e recuperacao pos-restart.
 * EntrySnapshot e imutavel: trades nunca tem colunas de entry reescritas apos o settlement.
 */
export const LAB_STORE_VERSION = "lab-store-v1";
export const LAB_SETTLEMENT_CAP = 20;

export class LabStore {
  constructor({ pool, runId, specsHash, stake, expiryPolicy = {}, cap = LAB_SETTLEMENT_CAP, sourceRunId = null, sourceStrategy = null } = {}) {
    this.pool = pool; this.runId = runId; this.specsHash = specsHash; this.stake = stake; this.expiryPolicy = expiryPolicy;
    this.cap = Number.isFinite(Number(cap)) && Number(cap) > 0 ? Number(cap) : LAB_SETTLEMENT_CAP;
    this.sourceRunId = sourceRunId; this.sourceStrategy = sourceStrategy;
  }

  async ensureRun(strategyIds = []) {
    if (!this.pool?.query) return;
    await this.pool.query(
      "INSERT INTO iq_lab_runs(run_id, specs_hash, stake, expiry_policy, status, account_context, source_run_id, source_strategy) VALUES($1,$2,$3,$4::jsonb,'RUNNING','PRACTICE',$5,$6) ON CONFLICT (run_id) DO NOTHING",
      [this.runId, this.specsHash, this.stake, JSON.stringify(this.expiryPolicy), this.sourceRunId, this.sourceStrategy],
    );
    if (Array.isArray(strategyIds) && strategyIds.length) {
      const values = strategyIds.map((_, index) => "($1, $" + (index + 2) + ")").join(", ");
      await this.pool.query(
        "INSERT INTO iq_lab_strategy_state(run_id, strategy_id) VALUES " + values + " ON CONFLICT (run_id, strategy_id) DO NOTHING",
        [this.runId, ...strategyIds],
      );
    }
  }

  async reserveSlot(strategyId) {
    if (!this.pool?.query) return null;
    const row = (await this.pool.query(
      `UPDATE iq_lab_strategy_state SET open_count = open_count + 1, updated_at = now()
       WHERE run_id=$1 AND strategy_id=$2 AND complete = false AND settled_count + open_count < $3
       RETURNING settled_count, open_count`,
      [this.runId, strategyId, this.cap],
    )).rows?.[0] ?? null;
    return row;
  }

  /** RESERVA + TRADE ROW ATOMICO: toda reserva tem trade (sem fantasma). Estado inicial SUBMITTED. */
  async reserveSlotWithTrade(trade) {
    if (!this.pool?.query) return null;
    const row = (await this.pool.query(
      `WITH slot AS (
         UPDATE iq_lab_strategy_state SET open_count = open_count + 1, updated_at = now()
         WHERE run_id=$1 AND strategy_id=$2 AND complete = false AND settled_count + open_count < $3
         RETURNING 1
       )
       INSERT INTO iq_lab_trades(strategy_trade_id, run_id, strategy_id, strategy_version, episode_id, snapshot_id, decision_id, market_key, direction, stake, payout,
         requested_expiry, expiry_at, candidate_at, entry_at, decision, reason, evidence_strength, entry_quality, supporting, counter, specialist_outputs, entry_snapshot, state)
       SELECT $4,$1,$2,$5,$6,$7,$4,$8,$9,$10,$11,$12,$13,$14,now(),$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb,'SUBMITTED' FROM slot
       ON CONFLICT (strategy_trade_id) DO NOTHING
       RETURNING strategy_trade_id`,
      [this.runId, trade.strategyId, this.cap, trade.strategyTradeId, trade.strategyVersion, trade.episodeId ?? null, trade.snapshotId ?? null, trade.marketKey, trade.direction, trade.stake, trade.payout ?? null, trade.requestedExpiry ?? null, trade.expiryAt ?? null, trade.candidateAt ?? null, trade.decision, String(trade.reason ?? "").slice(0, 500), trade.evidenceStrength ?? null, trade.entryQuality ?? null, JSON.stringify(trade.supporting ?? []), JSON.stringify(trade.counter ?? []), JSON.stringify(trade.specialistOutputs ?? {}), JSON.stringify(trade.entrySnapshot ?? {})],
    )).rows?.[0] ?? null;
    if (row) return row;
    const existing = (await this.pool.query("SELECT strategy_trade_id FROM iq_lab_trades WHERE strategy_trade_id=$1", [trade.strategyTradeId])).rows?.[0] ?? null;
    if (existing) await this.releaseReservation(trade.strategyId).catch(() => undefined);
    return null;
  }

  async updateTradeState({ strategyTradeId, state, executionId = null, brokerOrderId = null, actualExpiry = null }) {
    if (!this.pool?.query) return;
    await this.pool.query("UPDATE iq_lab_trades SET state=$2, execution_id=COALESCE($3, execution_id), broker_order_id=COALESCE($4, broker_order_id), actual_expiry=COALESCE($5, actual_expiry), updated_at=now() WHERE strategy_trade_id=$1", [strategyTradeId, state, executionId, brokerOrderId, actualExpiry]);
  }

  async releaseSlot(strategyId, { result = null } = {}) {
    if (!this.pool?.query) return null;
    const win = result === "WIN" ? 1 : 0; const loss = result === "LOSS" ? 1 : 0; const draw = result === "DRAW" ? 1 : 0;
    const row = (await this.pool.query(
      `UPDATE iq_lab_strategy_state SET
         open_count = GREATEST(0, open_count - 1),
         settled_count = settled_count + 1,
         wins = wins + $3, losses = losses + $4, draws = draws + $5,
         complete = (settled_count + 1 >= $6),
         updated_at = now()
       WHERE run_id=$1 AND strategy_id=$2
       RETURNING settled_count, open_count, wins, losses, draws, complete`,
      [this.runId, strategyId, win, loss, draw, this.cap],
    )).rows?.[0] ?? null;
    return row;
  }

  async releaseReservation(strategyId) {
    if (!this.pool?.query) return;
    await this.pool.query("UPDATE iq_lab_strategy_state SET open_count = GREATEST(0, open_count - 1), updated_at = now() WHERE run_id=$1 AND strategy_id=$2", [this.runId, strategyId]);
  }

  /** Fonte de verdade: open_count = trades REQUESTED/ACKNOWLEDGED sem resultado. Auto-cura de reservas fantasma. */
  async reconcileOpenCounts() {
    if (!this.pool?.query) return;
    await this.pool.query(
      "UPDATE iq_lab_strategy_state s SET open_count = (SELECT count(*)::int FROM iq_lab_trades t WHERE t.run_id = s.run_id AND t.strategy_id = s.strategy_id AND t.state IN ('SUBMITTED','PENDING_ACK','UNKNOWN','REQUESTED','ACKNOWLEDGED') AND t.result IS NULL AND t.excluded = false), updated_at = now() WHERE s.run_id = $1",
      [this.runId],
    );
  }

  async markTradeSettled({ strategyTradeId, settlementAt = null, entryPrice = null, settlementPrice = null, result, pnl }) {
    if (!this.pool?.query) return;
    await this.pool.query(
      `UPDATE iq_lab_trades SET state='SETTLED', settlement_at=COALESCE($2, now()), entry_price=COALESCE($3, entry_price), settlement_price=COALESCE($4, settlement_price), result=$5, pnl=$6, updated_at=now()
       WHERE strategy_trade_id=$1 AND result IS NULL`,
      [strategyTradeId, settlementAt, entryPrice, settlementPrice, result, pnl],
    );
  }

  async persistDecision(row) {
    if (!this.pool?.query) return;
    await this.pool.query(
      `INSERT INTO iq_lab_decisions(run_id, strategy_id, market_key, snapshot_id, decision, side, reason, evidence_strength, counter, payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)`,
      [this.runId, row.strategyId, row.marketKey, row.snapshotId ?? null, row.decision, row.side ?? null, String(row.reason ?? "").slice(0, 400), row.evidenceStrength ?? null, JSON.stringify(row.counter ?? []), JSON.stringify(row.payload ?? {})],
    );
  }

  async loadState(strategyIds = []) {
    if (!this.pool?.query) return { strategies: [], openTrades: [] };
    const strategies = (await this.pool.query("SELECT * FROM iq_lab_strategy_state WHERE run_id=$1", [this.runId])).rows ?? [];
    const openTrades = (await this.pool.query("SELECT * FROM iq_lab_trades WHERE run_id=$1 AND state IN ('REQUESTED','ACKNOWLEDGED') AND result IS NULL", [this.runId])).rows ?? [];
    return { strategies, openTrades };
  }

  async strategyStates() {
    if (!this.pool?.query) return [];
    return (await this.pool.query("SELECT * FROM iq_lab_strategy_state WHERE run_id=$1 ORDER BY strategy_id", [this.runId])).rows ?? [];
  }

  async runStatus() {
    if (!this.pool?.query) return null;
    return (await this.pool.query("SELECT * FROM iq_lab_runs WHERE run_id=$1", [this.runId])).rows?.[0] ?? null;
  }

  async finishRun() {
    if (!this.pool?.query) return;
    await this.pool.query("UPDATE iq_lab_runs SET status='COMPLETE', finished_at=now() WHERE run_id=$1 AND status <> 'COMPLETE'", [this.runId]);
  }
}
