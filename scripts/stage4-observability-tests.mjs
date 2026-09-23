import { IqMultiRuntime } from "../relay/iq-multi-runtime.mjs";

let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const V2 = "PULLBACK_4060_300_AGENTIC_V2";
const HASH = "sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0";
const NOW = 1_800_000_000_000;

const makeRow = (index, patch = {}) => ({
  executionId: `e${index}`,
  decisionId: `d${index}`,
  marketKey: `EUR${String(index % 5)}:OTC`.replace("EUR0", "EURUSD").replace("EUR1", "GBPUSD").replace("EUR2", "USDJPY").replace("EUR3", "AUDUSD").replace("EUR4", "USDCAD"),
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
  requestedAt: new Date(NOW - (index + 1) * 300_000).toISOString(),
  expirationAt: new Date(NOW - (index + 1) * 300_000 + 300_000).toISOString(),
  settledAt: new Date(NOW - (index + 1) * 300_000 + 300_500).toISOString(),
  decisionSnapshot: { id: `s${index}`, features: { regime: index % 2 === 0 ? "UPTREND" : "DOWNTREND", structure: index % 2 === 0 ? "UPTREND" : "DOWNTREND", priceAction: { pullback: { depth: index % 3 === 0 ? "DEEP" : "NORMAL" } } } },
  ...patch,
});

class ObsPool {
  constructor(rows) { this.rows = rows; this.queries = []; this.calls = []; this.failAll = false; }
  async query(sql, params) {
    this.queries.push(sql);
    this.calls.push({ sql, params: Array.isArray(params) ? [...params] : [] });
    if (this.failAll) throw new Error("connection terminated unexpectedly");
    const [version, , hash] = params;
    const operational = this.rows.filter((r) => r.strategyVersion === version && r.testOnly !== true && r.excludedFromStats !== true && r.accountContext === "PRACTICE" && r.state === "SETTLED" && ["WIN", "LOSS", "DRAW"].includes(r.brokerResult));
    const agg = (list) => ({
      n: list.length,
      w: list.filter((r) => r.brokerResult === "WIN").length,
      l: list.filter((r) => r.brokerResult === "LOSS").length,
      d: list.filter((r) => r.brokerResult === "DRAW").length,
      pnl: list.reduce((acc, r) => acc + Number(r.profit ?? 0), 0),
      avg_stake: list.length ? list.reduce((acc, r) => acc + Number(r.stake ?? 0), 0) / list.length : null,
      avg_payout: list.length ? list.reduce((acc, r) => acc + Number(r.payout ?? 0), 0) / list.length : null,
    });
    const group = (keyOf) => {
      const map = new Map();
      for (const row of operational) { const k = keyOf(row); if (k === null || k === undefined) continue; if (!map.has(k)) map.set(k, []); map.get(k).push(row); }
      return [...map.entries()].map(([k, list]) => ({ k, ...agg(list) }));
    };
    if (sql.includes("obs:sample-direction")) {
      const call = operational.filter((r) => ["CALL", "BUY"].includes(r.direction));
      const put = operational.filter((r) => ["PUT", "SELL"].includes(r.direction));
      return { rows: [...(call.length ? [{ direction: "CALL", ...agg(call) }] : []), ...(put.length ? [{ direction: "PUT", ...agg(put) }] : [])] };
    }
    if (sql.includes("obs:by-asset")) return { rows: group((r) => r.marketKey) };
    if (sql.includes("obs:by-hour")) return { rows: group((r) => new Date(r.requestedAt).getUTCHours()) };
    if (sql.includes("obs:by-regime")) return { rows: group((r) => r.decisionSnapshot?.features?.regime ?? "UNKNOWN") };
    if (sql.includes("obs:by-structure")) return { rows: group((r) => r.decisionSnapshot?.features?.structure ?? "UNKNOWN") };
    if (sql.includes("obs:by-pullback")) return { rows: group((r) => r.decisionSnapshot?.features?.priceAction?.pullback?.depth ?? "UNKNOWN") };
    if (sql.includes("obs:rolling")) {
      return { rows: [...operational].sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt)).slice(0, 100).map((r) => ({ broker_result: r.brokerResult, profit: r.profit })) };
    }
    if (sql.includes("SELECT broker_result, profit") && !sql.includes("obs:")) {
      return { rows: operational.map((r) => ({ broker_result: r.brokerResult, profit: r.profit })) };
    }
    if (sql.includes("obs:integrity")) {
      const scoped = this.rows.filter((r) => r.strategyVersion === version);
      const ids = scoped.map((r) => r.decisionId).filter(Boolean);
      return { rows: [{
        hash_mismatch: scoped.filter((r) => hash && r.strategyHash && r.strategyHash !== hash).length,
        snapshot_missing: scoped.filter((r) => !r.decisionSnapshot).length,
        duplicate_decision_id: ids.length - new Set(ids).size,
        test_only_rows: scoped.filter((r) => r.testOnly === true).length,
        excluded_rows: scoped.filter((r) => r.excludedFromStats === true).length,
        real_rows: scoped.filter((r) => r.accountContext === "REAL" || r.accountType === "REAL").length,
        expiry_not_300: scoped.filter((r) => r.expirationAt && Math.round(new Date(r.expirationAt).getTime() / 1000) % 300 !== 0).length,
        non_otc: scoped.filter((r) => !String(r.marketKey).endsWith(":OTC")).length,
      }] };
    }
    return { rows: [] };
  }
}

const runtimeFor = (rows) => new IqMultiRuntime({ pool: new ObsPool(rows), log: () => {}, now: () => NOW });

/* 1) N>200 cumulativo: 350 validas + PATH_TEST/excluded/REAL fora da amostra */
{
  const valid = Array.from({ length: 350 }, (_, i) => makeRow(i));
  const pathTest = Array.from({ length: 50 }, (_, i) => makeRow(1000 + i, { testOnly: true }));
  const excluded = Array.from({ length: 50 }, (_, i) => makeRow(2000 + i, { excludedFromStats: true }));
  const real = Array.from({ length: 10 }, (_, i) => makeRow(3000 + i, { accountContext: "REAL", accountType: "REAL" }));
  const rt = runtimeFor([...valid, ...pathTest, ...excluded, ...real]);
  const report = await rt.strategyObservability(V2, { days: 30, strategyHash: HASH });
  ok("N>200: amostra cumulativa = 350 (nunca limitada a 200)", report.sample.n === 350 && report.buy.n + report.sell.n === 350);
  ok("label 'mais informativa' e alcancavel (N=350)", report.sample.label === "mais informativa");
  ok("WR = W/(W+L) com DRAW separado e PnL/stake/payout medios", report.sample.d > 0 && report.sample.wr === Math.round((100 * report.sample.w) / (report.sample.w + report.sample.l) * 10) / 10 && typeof report.sample.pnl === "number" && report.sample.avgStake === 2 && report.sample.avgPayout === 82);
  ok("BUY e SELL completos (N/W/L/D/WR/PnL) somando 350", report.buy.n > 0 && report.sell.n > 0 && report.buy.n + report.sell.n === 350 && report.buy.wr !== null && report.sell.wr !== null);
  ok("por ativo sem esconder (todos os ativos presentes)", report.byAsset.length === 5 && report.byAsset.every((a) => a.n > 0 && typeof a.pnl === "number"));
  ok("por hora (0-23 UTC) e por estado (regime/structure/pullback, UNKNOWN se ausente)", report.byHour.length > 0 && report.byHour.every((h) => Number.isInteger(h.key) && h.key >= 0 && h.key <= 23) && report.byRegime.length === 2 && report.byStructure.length === 2 && report.byPullback.map((p) => p.key).sort().join(",") === "DEEP,NORMAL");
  ok("integridade conta PATH_TEST/excluded/REAL sem 'corrigir' silenciosamente", report.integrity.counts.testOnlyRows === 50 && report.integrity.counts.excludedRows === 50 && report.integrity.counts.realRows === 10 && report.integrity.ok === false);
  ok("SQL sem LIMIT 200 na amostra e filtros canonicos presentes", rt.pool.queries.some((sql) => sql.includes("obs:sample-direction")) && !rt.pool.queries.some((sql) => /limit\s+200/i.test(sql)) && rt.pool.queries.every((sql) => /obs:/.test(sql) ? sql.includes("strategy_version=$1") : true) && rt.pool.queries.some((sql) => sql.includes("test_only=false") && sql.includes("excluded_from_stats=false") && sql.includes("account_context='PRACTICE'") && sql.includes("broker_result IN ('WIN','LOSS','DRAW')")));
}

/* 2) 300 validas + 50 PATH_TEST => 300 */
{
  const rt = runtimeFor([...Array.from({ length: 300 }, (_, i) => makeRow(i)), ...Array.from({ length: 50 }, (_, i) => makeRow(1000 + i, { strategyVersion: "PATH_TEST", testOnly: true, excludedFromStats: true }))]);
  const report = await rt.strategyObservability(V2, { days: 30, strategyHash: HASH });
  ok("300 validas + 50 PATH_TEST -> N=300", report.sample.n === 300 && report.sample.label === "mais informativa");
}

/* 3) 300 validas + 50 excluded => 300 */
{
  const rt = runtimeFor([...Array.from({ length: 300 }, (_, i) => makeRow(i)), ...Array.from({ length: 50 }, (_, i) => makeRow(2000 + i, { excludedFromStats: true }))]);
  const report = await rt.strategyObservability(V2, { days: 30, strategyHash: HASH });
  ok("300 validas + 50 excluded -> N=300", report.sample.n === 300);
}

/* 4) 300 validas + REAL => amostra PRACTICE continua 300 + integridade sinaliza REAL */
{
  const rt = runtimeFor([...Array.from({ length: 300 }, (_, i) => makeRow(i)), ...Array.from({ length: 20 }, (_, i) => makeRow(4000 + i, { accountContext: "REAL", accountType: "REAL" }))]);
  const report = await rt.strategyObservability(V2, { days: 30, strategyHash: HASH });
  ok("REAL fora da amostra PRACTICE (N=300) e contabilizado na integridade", report.sample.n === 300 && report.integrity.counts.realRows === 20);
}

/* 5) rolling 20/50/100 com N total > 1000 */
{
  const rows = Array.from({ length: 1200 }, (_, i) => makeRow(i));
  const rt = runtimeFor(rows);
  const report = await rt.strategyObservability(V2, { days: 30, strategyHash: HASH });
  const last = (take) => rows.slice(0, take);
  const expect = (take) => ({ n: take, pnl: Math.round(last(take).reduce((acc, r) => acc + Number(r.profit), 0) * 100) / 100 });
  ok("rolling 20/50/100 = ultimas N (mesmo com N total 1200)", report.sample.n === 1200 && report.rolling.r20.n === 20 && report.rolling.r50.n === 50 && report.rolling.r100.n === 100 && report.rolling.r20.pnl === expect(20).pnl && report.rolling.r100.pnl === expect(100).pnl);
  ok("rolling limitado a 100 linhas no SQL", rt.pool.queries.some((sql) => sql.includes("obs:rolling") && /limit\s+100/i.test(sql)));
}

/* 6) N=0 funciona sem erro */
{
  const rt = runtimeFor([]);
  const report = await rt.strategyObservability(V2, { days: 30, strategyHash: HASH });
  ok("N=0 -> wr null, pnl 0, label muito pequena, sem erro", report.sample.n === 0 && report.sample.wr === null && report.sample.pnl === 0 && report.sample.label === "amostra muito pequena" && report.integrity.ok === true);
  ok("N=0 legitimo: available=true e integrity verificada", report.available === true && report.integrity.verified === true && report.error === null);
}

/* 6b) A04: bindings exatos — cada query recebe EXATAMENTE os parametros que referencia */
{
  const rt = runtimeFor(Array.from({ length: 30 }, (_, i) => makeRow(i)));
  await rt.strategyObservability(V2, { days: 30, strategyHash: HASH });
  const bound = rt.pool.calls.filter((call) => /obs:/.test(call.sql));
  const referenced = (sql) => Math.max(0, ...(sql.match(/\$(\d+)/g) ?? ["$0"]).map((token) => Number(token.slice(1))));
  ok("A04: toda query obs recebe N params = maior placeholder $N referenciado", bound.length >= 8 && bound.every((call) => referenced(call.sql) === call.params.length));
  await rt.strategyObservability(V2, { days: 30 });
  const withoutHash = rt.pool.calls.slice(-8).filter((call) => /obs:/.test(call.sql));
  ok("A04: sem hash as queries continuam com bindings exatos (2 params na amostra, 3 na integridade)", withoutHash.length >= 8 && withoutHash.every((call) => referenced(call.sql) === call.params.length) && withoutHash.some((call) => call.params.length === 2));
}

/* 6c) A05: erro de leitura => available=false, integridade UNVERIFIED (nunca N=0 ok) */
{
  const rt = runtimeFor(Array.from({ length: 10 }, (_, i) => makeRow(i)));
  rt.pool.failAll = true;
  const report = await rt.strategyObservability(V2, { days: 30, strategyHash: HASH });
  ok("A05: erro de DB => available=false, integrity.verified=false, ok=null, alerta UNVERIFIED", report.available === false && report.integrity.verified === false && report.integrity.ok === null && report.integrity.counts === null && report.integrity.alerts.some((alert) => alert.code === "UNVERIFIED") && report.error?.code === "OBS_DB_ERROR");
  ok("A05: erro nunca vira 'N=0 ok' (label indisponivel)", report.sample.label.includes("indisponivel"));
  const stats = await runtimeFor([makeRow(1)]).strategyStats(V2, { days: 30, strategyHash: HASH });
  const statsPoolRuntime = runtimeFor([makeRow(1)]);
  statsPoolRuntime.pool.failAll = true;
  const statsFailed = await statsPoolRuntime.strategyStats(V2, { days: 30, strategyHash: HASH });
  ok("A05: stats com DB ausente => available=false com error", stats.available === true && statsFailed.available === false && Boolean(statsFailed.error));
}

/* 6d) A06: stats e observability leem o MESMO universo canonico */
{
  const rows = [...Array.from({ length: 40 }, (_, i) => makeRow(i)), makeRow(9001, { testOnly: true }), makeRow(9002, { excludedFromStats: true }), makeRow(9003, { accountContext: "REAL", accountType: "REAL" })];
  const rt = runtimeFor(rows);
  const obs = await rt.strategyObservability(V2, { days: 30, strategyHash: HASH });
  const stats = await rt.strategyStats(V2, { days: 30, strategyHash: HASH });
  ok("A06: stats.operations === observability.sample.n (mesmo filtro canonico)", stats.operations === obs.sample.n && stats.operations === 40);
  ok("A06: filtro canonico compartilhado presente em ambos os SQL", rt.pool.queries.some((sql) => sql.includes("SELECT broker_result, profit") && sql.includes("test_only=false") && sql.includes("account_context='PRACTICE'")));
}

/* 7) policy de expiracao/instrumento na integridade */
{
  const bad = [makeRow(1, { expirationAt: new Date(NOW - 299_000).toISOString() }), makeRow(2, { marketKey: "EURUSD:NORMAL" }), makeRow(3, { decisionSnapshot: null })];
  const rt = runtimeFor([...bad, ...Array.from({ length: 10 }, (_, i) => makeRow(100 + i))]);
  const report = await rt.strategyObservability(V2, { days: 30, strategyHash: HASH });
  ok("integridade sinaliza expiry!=300, instrumento nao-OTC e snapshot ausente", report.integrity.counts.expiryNot300 === 1 && report.integrity.counts.nonOtc === 1 && report.integrity.counts.snapshotMissing === 1 && report.integrity.ok === false);
}

console.log(fail === 0 ? `OBSERVABILITY_TESTS ALL_PASS (${pass}/${pass})` : `OBSERVABILITY_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
