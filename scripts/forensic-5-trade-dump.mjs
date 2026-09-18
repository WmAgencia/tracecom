/**
 * FORENSIC 5-TRADE DUMP (read-only) — evidencia congelada das 5 operacoes PRACTICE liquidadas.
 *
 * Uso:
 *   railway run --service tracecom-live-relay --environment production -- node scripts/forensic-5-trade-dump.mjs
 *   (ou DATABASE_URL=... node scripts/forensic-5-trade-dump.mjs)
 *
 * Saida: docs/research/data/forensic-5-trades.json
 * - journal + executions + audit trail das 5 operacoes (fonte de verdade de producao)
 * - funil de candidatos (CREATED/REVALIDATION/CANCELLED/SHADOW_ARMS) dos 5 mercados na janela
 * - SHADOW_ARMS de 2026-09-17..18 (distribuicao do Quality Score)
 * - conjuntos EXCLUIDOS (execucoes sem settlement, mismatches) para prova de selecao
 *
 * Nao altera nada; nao imprime segredos. Campos de conexao vem de DATABASE_URL.
 */
import { Pool } from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const WINDOW = { from: "2026-09-18T19:55:00Z", to: "2026-09-18T22:10:00Z" };
const TRADE_IDS = [
  "exec_1789761733551_9531r8",
  "exec_1789764899007_b4khil",
  "exec_1789765738953_12798x",
  "exec_1789766458670_rofxu6",
  "exec_1789768678656_s8qvm6",
];
const CORRELATION_IDS = ["corr_356988", "corr_450528", "corr_475015", "corr_495995", "corr_560702"];
const MARKET_KEYS = ["AUDCHF:OTC", "CADCHF:OTC", "EURAUD:OTC", "GBPNZD:OTC", "EURUSD:OTC"];
const LIFECYCLE_STAGES = ["CANDIDATE_CREATED", "FINAL_REVALIDATION", "CANDIDATE_CANCELLED", "SHADOW_ARMS", "ORDER_SENT", "BROKER_ACK", "SETTLEMENT", "PROFESSOR_REVIEW", "AGENTS"];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const out = {
  meta: {
    schema: "forensic-5-trades-v1",
    generatedAt: new Date().toISOString(),
    source: "Supabase Postgres (Railway DATABASE_URL)",
    window: WINDOW,
    tradeIds: TRADE_IDS,
    correlationIds: CORRELATION_IDS,
    marketKeys: MARKET_KEYS,
    note: "Dump read-only. Nenhum segredo incluido. Regeravel por scripts/forensic-5-trade-dump.mjs.",
  },
  errors: [],
};

try {
  out.selection = {
    journalByDay: (await pool.query("SELECT to_char(created_at,'YYYY-MM-DD') AS d, count(*)::int AS n FROM iq_trade_journal GROUP BY 1 ORDER BY 1")).rows,
    executionsSep18: (await pool.query("SELECT execution_id, market_key, direction, stake, state, broker_result, profit, requested_at, decision_id FROM iq_executions WHERE requested_at >= '2026-09-18T00:00:00Z' ORDER BY requested_at")).rows,
    nonSettled: (await pool.query("SELECT execution_id, market_key, direction, stake, state, error, requested_at, decision_id, meta->>'source' source FROM iq_executions WHERE state <> 'SETTLED' ORDER BY requested_at")).rows,
    mismatches: (await pool.query("SELECT execution_id, market_key, broker_result, causal_result, profit, requested_at FROM iq_executions WHERE settlement_mismatch = true ORDER BY requested_at")).rows,
  };

  out.trades = [];
  for (const tradeId of TRADE_IDS) {
    const journal = (await pool.query("SELECT * FROM iq_trade_journal WHERE trade_id=$1", [tradeId])).rows[0] ?? null;
    const execution = (await pool.query("SELECT * FROM iq_executions WHERE execution_id=$1", [tradeId])).rows[0] ?? null;
    const correlationId = journal?.correlation_id ?? execution?.meta?.correlationId ?? null;
    const marketKey = journal?.market_key ?? execution?.market_key ?? null;
    const audit = (await pool.query("SELECT id, correlation_id, market_key, stage, detail, created_at FROM iq_audit_trail WHERE correlation_id=$1 ORDER BY id", [correlationId])).rows;
    const funnel = (await pool.query(
      "SELECT id, correlation_id, market_key, stage, detail, created_at FROM iq_audit_trail WHERE market_key=$1 AND created_at >= $2 AND created_at <= $3 AND stage = ANY($4::text[]) ORDER BY id",
      [marketKey, WINDOW.from, WINDOW.to, LIFECYCLE_STAGES])).rows;
    out.trades.push({ tradeId, correlationId, marketKey, journal, execution, audit, funnel });
  }

  out.shadowArms = (await pool.query(
    "SELECT market_key, created_at, detail->>'candidateId' candidate_id, (detail->>'qualityScore')::int quality_score, detail->'arms' arms, detail->'entryLocation' entry_location, detail->'microVeto' micro_veto FROM iq_audit_trail WHERE stage='SHADOW_ARMS' AND created_at >= '2026-09-17T00:00:00Z' AND created_at <= '2026-09-18T23:59:59Z' ORDER BY id")).rows;

  out.markets = (await pool.query("SELECT market_key, active_id, canonical, display, market_type, enabled, paused, availability, configured_stake, max_stake, payout, payout_source, instrument_types, revision FROM iq_markets WHERE market_key = ANY($1::text[]) ORDER BY market_key", [MARKET_KEYS])).rows;
  out.runtimeConfig = (await pool.query("SELECT brain_generation, jit_enabled, entry_lead_ms, entry_window_max_drift_ms, quality_gate_enabled, min_trade_quality_score FROM iq_runtime_config")).rows;
} catch (error) {
  out.errors.push(String(error?.stack ?? error?.message ?? error).slice(0, 1200));
}

const outPath = path.join("docs", "research", "data", "forensic-5-trades.json");
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, JSON.stringify(out, null, 1), "utf8");
const size = (await fs.stat(outPath)).size;
console.log(JSON.stringify({ ok: out.errors.length === 0, errors: out.errors, outPath, bytes: size, trades: out.trades?.length, shadowArms: out.shadowArms?.length, nonSettled: out.selection?.nonSettled?.length }, null, 2));
await pool.end();
