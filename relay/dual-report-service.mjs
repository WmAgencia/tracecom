/** DUAL REPORT SERVICE — carrega as observacoes persistidas e produz o relatorio observacional. */
import { buildDualReport } from "./dual-reasoning-report.mjs";

export class DualReportService {
  constructor({ pool = null, limit = 4000 } = {}) { this.pool = pool; this.limit = limit; }

  async build() {
    if (!this.pool?.query) return buildDualReport({});
    const capped = Math.max(1, Math.min(20_000, Number(this.limit) || 4000));
    const [dual, v3, v4] = await Promise.all([
      this.pool.query(`SELECT id, candidate_id, market_key, market_type, direction, final_action, thesis_survival, payout, payload, theoretical_result, created_at FROM iq_dual_reasoning_observations ORDER BY created_at ASC LIMIT $1`, [capped]).then((r) => r.rows).catch(() => []),
      this.pool.query(`SELECT DISTINCT ON (candidate_id) candidate_id, direction, theoretical_result FROM iq_scenario_shadow_observations WHERE candidate_id IS NOT NULL ORDER BY candidate_id, created_at DESC`).then((r) => r.rows).catch(() => []),
      this.pool.query(`SELECT DISTINCT ON (candidate_id) candidate_id, direction, final_action, theoretical_result FROM iq_agents_v4_observations WHERE candidate_id IS NOT NULL ORDER BY candidate_id, created_at DESC`).then((r) => r.rows).catch(() => []),
    ]);
    const g2ByCandidate = new Map(v3.map((row) => [row.candidate_id, { direction: row.direction, result: row.theoretical_result }]));
    const v4ByCandidate = new Map(v4.map((row) => [row.candidate_id, { direction: row.direction, action: row.final_action, result: row.theoretical_result }]));
    return buildDualReport({ rows: dual, g2ByCandidate, v4ByCandidate });
  }
}
