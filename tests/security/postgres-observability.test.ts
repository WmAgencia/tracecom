/**
 * A04/A05/A06/A12 — PROVA EM POSTGRES REAL (PGlite, sem mock de pool).
 *
 * O pool falso dos testes de script nao valida bindings: aqui o SQL roda de verdade.
 * No commit auditado, `strategyObservability` enviava 3 parametros para queries com 2
 * placeholders -> erro de bind no servidor -> engolido pelo catch -> N=0 "ok" (falso).
 * Este teste falha no commit auditado e passa com o filtro canonico + bindings exatos.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");
const { IqMultiRuntime } = runtimeModule as unknown as Record<string, any>;

const V2 = "PULLBACK_4060_300_AGENTIC_V2";
const HASH = "sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0";

const DDL = `
CREATE TABLE iq_executions (
  id serial PRIMARY KEY,
  execution_id text NOT NULL UNIQUE,
  idempotency_key text UNIQUE,
  decision_id text,
  connection_id text,
  account_type text NOT NULL DEFAULT 'PRACTICE',
  broker_order_id text,
  symbol text NOT NULL,
  active_id integer,
  direction text NOT NULL,
  stake numeric NOT NULL,
  currency text,
  state text NOT NULL,
  request_id text,
  expiration_at timestamptz,
  entry_price numeric,
  broker_result text,
  causal_result text,
  settlement_mismatch boolean NOT NULL DEFAULT false,
  profit numeric,
  error text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  acked_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  market_key text,
  mode text,
  payout numeric,
  option_kind text,
  account_context text NOT NULL DEFAULT 'PRACTICE',
  strategy_version text,
  strategy_hash text,
  stats_epoch timestamptz,
  snapshot_hash text,
  decision_snapshot jsonb,
  test_only boolean NOT NULL DEFAULT false,
  excluded_from_stats boolean NOT NULL DEFAULT false
);
CREATE TABLE iq_strategy_daily_aggregates (
  strategy_version text NOT NULL,
  strategy_hash text NOT NULL DEFAULT '',
  day date NOT NULL,
  direction text NOT NULL DEFAULT '',
  n integer NOT NULL DEFAULT 0,
  w integer NOT NULL DEFAULT 0,
  l integer NOT NULL DEFAULT 0,
  d integer NOT NULL DEFAULT 0,
  pnl numeric NOT NULL DEFAULT 0,
  stake_sum numeric NOT NULL DEFAULT 0,
  payout_sum numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (strategy_version, strategy_hash, day, direction)
);`;

const ASSETS = ["EURUSD:OTC", "GBPUSD:OTC", "USDJPY:OTC", "AUDUSD:OTC", "USDCAD:OTC"];
const NOW = Math.floor(Date.now() / 300_000) * 300_000;

const makeRow = (index: number, patch: Record<string, unknown> = {}) => ({
  executionId: `exec-${index}`,
  decisionId: `dec-${index}`,
  marketKey: ASSETS[index % 5] as string,
  direction: index % 2 === 0 ? "CALL" : "PUT",
  state: "SETTLED",
  brokerResult: index % 5 === 0 ? "DRAW" : index % 3 === 0 ? "LOSS" : "WIN",
  profit: index % 5 === 0 ? 0 : index % 3 === 0 ? -2 : 1.64,
  stake: 2,
  payout: 82,
  strategyVersion: V2,
  strategyHash: HASH,
  testOnly: false,
  excludedFromStats: false,
  accountContext: "PRACTICE",
  accountType: "PRACTICE",
  mode: "PRACTICE",
  requestedAt: new Date(NOW - ((index % 300) + 1) * 300_000).toISOString(),
  expirationAt: new Date(NOW - ((index % 300) + 1) * 300_000 + 300_000).toISOString(),
  decisionSnapshot: { id: `snap-${index}`, features: { regime: index % 2 === 0 ? "UPTREND" : "DOWNTREND", structure: index % 2 === 0 ? "UPTREND" : "DOWNTREND", priceAction: { pullback: { depth: index % 3 === 0 ? "DEEP" : "NORMAL" } } } },
  ...patch,
});

const COLUMNS = ["execution_id", "decision_id", "market_key", "symbol", "direction", "state", "broker_result", "profit", "stake", "payout", "strategy_version", "strategy_hash", "test_only", "excluded_from_stats", "account_context", "account_type", "mode", "requested_at", "expiration_at", "decision_snapshot"] as const;
const valuesOf = (row: Record<string, unknown>) => [row.executionId, row.decisionId, row.marketKey, String(row.marketKey).split(":")[0], row.direction, row.state, row.brokerResult, row.profit, row.stake, row.payout, row.strategyVersion, row.strategyHash, row.testOnly, row.excludedFromStats, row.accountContext, row.accountType, row.mode, row.requestedAt, row.expirationAt, row.decisionSnapshot ? JSON.stringify(row.decisionSnapshot) : null];

let db: PGlite;
let adapter: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }> };

const insertRows = async (rows: Array<Record<string, unknown>>) => {
  const batchSize = 50;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const placeholders = batch.map((_, rowIndex) => `(${COLUMNS.map((__, columnIndex) => `$${rowIndex * COLUMNS.length + columnIndex + 1}`).join(",")})`).join(",");
    await db.query(`INSERT INTO iq_executions(${COLUMNS.join(",")}) VALUES ${placeholders}`, batch.flatMap(valuesOf));
  }
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(DDL);
  adapter = { query: async (sql, params = []) => { const result = await db.query(sql, params); return { rows: result.rows as any[], rowCount: result.affectedRows ?? (result.rows as any[]).length }; } };
  await insertRows(Array.from({ length: 350 }, (_, index) => makeRow(index)));
  await insertRows([
    makeRow(9001, { testOnly: true }),
    makeRow(9002, { excludedFromStats: true }),
    makeRow(9003, { accountContext: "REAL", accountType: "REAL" }),
    makeRow(9004, { strategyHash: "sha256:outro" }),
    makeRow(9005, { decisionSnapshot: null }),
    makeRow(9006, { expirationAt: new Date(NOW - 299_000).toISOString() }),
    makeRow(9007, { marketKey: "EURUSD:NORMAL" }),
    makeRow(9008, { decisionId: "dec-0" }),
    makeRow(9009, { requestedAt: new Date(NOW - 45 * 24 * 3_600_000).toISOString(), expirationAt: new Date(NOW - 45 * 24 * 3_600_000 + 300_000).toISOString() }),
  ]);
}, 60_000);

afterAll(async () => { await db?.close(); });

describe("A04/A06 — observabilidade e stats em Postgres real", () => {
  it("bindings exatos: 350 validas contam de verdade (no commit auditado daria N=0)", async () => {
    const runtime = new IqMultiRuntime({ pool: adapter, log: () => {}, now: () => NOW }) as any;
    const report = await runtime.strategyObservability(V2, { days: 30, strategyHash: HASH });
    expect(report.available).toBe(true);
    expect(report.error).toBeNull();
    expect(report.integrity.verified).toBe(true);
    expect(report.sample.n).toBe(354);
    expect(report.buy.n + report.sell.n).toBe(354);
    expect(report.sample.avgStake).toBe(2);
    expect(report.sample.avgPayout).toBe(82);
    expect(report.byAsset.length).toBe(6);
    expect(report.byHour.length).toBeGreaterThan(0);
    expect(report.byRegime.length).toBe(3);
    expect(report.byPullback.map((row: any) => row.key).sort().join(",")).toBe("DEEP,NORMAL,UNKNOWN");
    expect(report.rolling.r20.n).toBe(20);
    expect(report.rolling.r100.n).toBe(100);
  });

  it("A06: stats e observability leem o MESMO universo canonico", async () => {
    const runtime = new IqMultiRuntime({ pool: adapter, log: () => {}, now: () => NOW }) as any;
    const report = await runtime.strategyObservability(V2, { days: 30, strategyHash: HASH });
    const stats = await runtime.strategyStats(V2, { days: 30, strategyHash: HASH });
    expect(stats.available).toBe(true);
    expect(stats.operations).toBe(report.sample.n);
    expect(stats.wins).toBe(report.sample.w);
    expect(stats.losses).toBe(report.sample.l);
    expect(stats.draws).toBe(report.sample.d);
    expect(stats.pnl).toBe(report.sample.pnl);
  });

  it("integridade real: test_only/excluded/REAL/hash/snapshot/expiry/non-OTC contados", async () => {
    const runtime = new IqMultiRuntime({ pool: adapter, log: () => {}, now: () => NOW }) as any;
    const report = await runtime.strategyObservability(V2, { days: 30, strategyHash: HASH });
    expect(report.available).toBe(true);
    expect(report.sample.n).toBe(354);
    expect(report.integrity.counts.testOnlyRows).toBe(1);
    expect(report.integrity.counts.excludedRows).toBe(1);
    expect(report.integrity.counts.realRows).toBe(1);
    expect(report.integrity.counts.hashMismatch).toBe(1);
    expect(report.integrity.counts.snapshotMissing).toBe(1);
    expect(report.integrity.counts.expiryNot300).toBe(1);
    expect(report.integrity.counts.nonOtc).toBe(1);
    expect(report.integrity.counts.duplicateDecisionId).toBe(1);
    expect(report.integrity.ok).toBe(false);
  });

  it("A10: poda de 35 dias move para agregado duravel e a serie cumulativa nao encolhe", async () => {
    const oldAt = (index: number) => NOW - (40 * 24 * 3_600_000) - index * 300_000;
    const oldRows = Array.from({ length: 12 }, (_, index) => makeRow(7000 + index, {
      requestedAt: new Date(oldAt(index)).toISOString(),
      expirationAt: new Date(oldAt(index) + 300_000).toISOString(),
    }));
    await insertRows(oldRows);
    const runtime = new IqMultiRuntime({ pool: adapter, log: () => {}, now: () => NOW }) as any;
    const before = await runtime.strategyObservability(V2, { days: 365, strategyHash: HASH });
    expect(before.sample.n).toBe(354 + 13);
    const maintenance = await runtime.runDbMaintenance();
    expect(maintenance.executions).toBeGreaterThanOrEqual(13);
    const aggregates = await db.query("SELECT strategy_version, strategy_hash, direction, n, pnl FROM iq_strategy_daily_aggregates");
    expect((aggregates.rows as any[]).length).toBeGreaterThan(0);
    const after = await runtime.strategyObservability(V2, { days: 365, strategyHash: HASH });
    expect(after.available).toBe(true);
    expect(after.archived.included).toBe(true);
    expect(after.archived.n).toBe(13);
    expect(after.sample.n).toBe(before.sample.n);
    expect(after.sample.pnl).toBe(before.sample.pnl);
    expect(after.sample.w).toBe(before.sample.w);
    expect(after.sample.l).toBe(before.sample.l);
    const stats = await runtime.strategyStats(V2, { days: 365, strategyHash: HASH });
    expect(stats.operations).toBe(after.sample.n);
    expect(stats.archived.n).toBe(13);
    const remaining = await db.query("SELECT count(*)::int AS n FROM iq_executions WHERE requested_at < now() - interval '35 days'");
    expect((remaining.rows as any[])[0].n).toBe(0);
  });

  it("A05: DB indisponivel => available=false, UNVERIFIED (nunca N=0 ok)", async () => {
    const runtime = new IqMultiRuntime({ pool: { query: async () => { throw new Error("connection terminated unexpectedly"); } }, log: () => {}, now: () => NOW }) as any;
    const report = await runtime.strategyObservability(V2, { days: 30, strategyHash: HASH });
    expect(report.available).toBe(false);
    expect(report.integrity.verified).toBe(false);
    expect(report.integrity.ok).toBeNull();
    expect(report.integrity.counts).toBeNull();
    expect(report.error?.code).toBe("OBS_DB_ERROR");
    const stats = await runtime.strategyStats(V2, { days: 30, strategyHash: HASH });
    expect(stats.available).toBe(false);
    expect(stats.error).toBe("STATS_DB_ERROR");
  });
});
