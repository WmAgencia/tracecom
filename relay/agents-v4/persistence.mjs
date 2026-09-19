/**
 * AGENTS V4 PERSISTENCE — observacoes SHADOW em Postgres (migration 034).
 *
 * Fail-safe: erro de banco nunca derruba a analise; status sempre auditavel.
 */
export const AGENTS_V4_PERSISTENCE_VERSION = "agents-v4-persistence-v1";
export const AGENTS_V4_TABLE = "iq_agents_v4_observations";

export class AgentsV4Persistence {
  constructor({ pool = null, now = () => Date.now(), log = () => {} } = {}) {
    this.pool = pool;
    this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.stats = { attempts: 0, ok: 0, failures: 0, lastError: null, lastOkAt: null, settlementUpdates: 0 };
  }

  get enabled() { return Boolean(this.pool?.query); }

  async save(observation = {}) {
    if (!this.enabled || !observation?.id) return { ok: false, reason: "PERSISTENCE_DISABLED" };
    this.stats.attempts += 1;
    try {
      await this.pool.query(
        `INSERT INTO ${AGENTS_V4_TABLE}(
            observation_id, candidate_id, correlation_id, market_key, market_type, account_context, active_id,
            direction, final_action, data_quality, regime, scenario, target_entry_at, target_expiry_at, payload, created_at, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb, now(), now())
         ON CONFLICT(observation_id) DO UPDATE SET
            payload=$15::jsonb, direction=$8, final_action=$9, data_quality=$10, regime=$11, scenario=$12, updated_at=now()`,
        [
          observation.id,
          observation.candidateId ?? null,
          observation.correlationId ?? null,
          observation.marketKey ?? null,
          observation.marketType ?? null,
          observation.accountContext ?? null,
          Number.isFinite(Number(observation.activeId)) ? Number(observation.activeId) : null,
          observation.direction ?? null,
          observation.finalAction ?? null,
          observation.dataQuality ?? null,
          observation.regime ?? null,
          observation.scenario ?? null,
          Number.isFinite(Number(observation.targetEntryAt)) ? Number(observation.targetEntryAt) : null,
          Number.isFinite(Number(observation.targetExpiryAt)) ? Number(observation.targetExpiryAt) : null,
          JSON.stringify(observation.payload ?? {}),
        ],
      );
      this.stats.ok += 1;
      this.stats.lastOkAt = this.now();
      return { ok: true };
    } catch (error) {
      this.stats.failures += 1;
      this.stats.lastError = String(error?.message ?? error).slice(0, 200);
      this.log("AGENTS_V4_PERSIST_FAILED", JSON.stringify({ observationId: observation.id, error: this.stats.lastError }));
      return { ok: false, reason: "PERSIST_FAILED", error: this.stats.lastError };
    }
  }

  async markSettled(observation = {}) {
    if (!this.enabled || !observation?.id) return { ok: false, reason: "PERSISTENCE_DISABLED" };
    this.stats.attempts += 1;
    try {
      await this.pool.query(
        `UPDATE ${AGENTS_V4_TABLE}
            SET outcome=$2::jsonb, settlement_basis=$3, theoretical_result=$4, theoretical_pnl=$5, updated_at=now()
          WHERE observation_id=$1 AND (outcome IS NULL OR outcome = 'null'::jsonb) AND settlement_basis IS NULL`,
        [
          observation.id,
          JSON.stringify(observation.outcome ?? null),
          observation.settlementBasis ?? null,
          observation.theoreticalResult ?? null,
          Number.isFinite(Number(observation.theoreticalPnl)) ? Number(observation.theoreticalPnl) : null,
        ],
      );
      this.stats.ok += 1;
      this.stats.settlementUpdates += 1;
      this.stats.lastOkAt = this.now();
      return { ok: true };
    } catch (error) {
      this.stats.failures += 1;
      this.stats.lastError = String(error?.message ?? error).slice(0, 200);
      this.log("AGENTS_V4_SETTLE_PERSIST_FAILED", JSON.stringify({ observationId: observation.id, error: this.stats.lastError }));
      return { ok: false, reason: "PERSIST_FAILED", error: this.stats.lastError };
    }
  }

  async recent(limit = 100, marketKey = null) {
    if (!this.enabled) return [];
    try {
      const capped = Math.max(1, Math.min(500, Number(limit) || 100));
      const rows = marketKey
        ? await this.pool.query(`SELECT observation_id, payload, outcome, settlement_basis, theoretical_result FROM ${AGENTS_V4_TABLE} WHERE market_key=$1 ORDER BY created_at DESC LIMIT $2`, [marketKey, capped])
        : await this.pool.query(`SELECT observation_id, payload, outcome, settlement_basis, theoretical_result FROM ${AGENTS_V4_TABLE} ORDER BY created_at DESC LIMIT $1`, [capped]);
      return rows.rows ?? [];
    } catch {
      return [];
    }
  }

  status() {
    return { version: AGENTS_V4_PERSISTENCE_VERSION, mode: this.enabled ? "POSTGRES" : "MEMORY", table: AGENTS_V4_TABLE, ...this.stats };
  }
}
