import { CandleStore } from "../relay/intelligence/candle-store.mjs";
import { RuntimeIntelligence } from "../relay/intelligence/runtime-adapter.mjs";
import { AssetPipeline, HYDRATION_READY, HYDRATION_PARTIAL, HYDRATION_FAILED } from "../relay/intelligence/asset-pipeline.mjs";
import { stableStringify } from "../relay/intelligence/features.mjs";

let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const NOW = 1_800_000_000_000;
const mk5s = (n, startAt, stepMs = 5000) => Array.from({ length: n }, (_, i) => {
  const base = 1.3500 + Math.sin(i / 50) * 0.0020 + i * 0.000001;
  return { at: startAt + i * stepMs, open: base, high: base + 0.0004, low: base - 0.0004, close: base + Math.sin(i / 17) * 0.0002 };
});
const series = mk5s(2161, NOW - 10_800_000);
const ACTIVE = Object.freeze({ version: "PULLBACK_4060_300_AGENTIC_V2", status: "ACTIVE", executable: true, strategyHash: "sha256:v2-test" });

class FakePool {
  constructor() { this.rows = new Map(); this.queries = []; this.failNext = false; }
  async query(text, params = []) {
    this.queries.push(text.slice(0, 40));
    if (this.failNext) { this.failNext = false; throw new Error("FAKE_DB_DOWN"); }
    if (text.startsWith("INSERT INTO iq_candles_5s")) {
      let inserted = 0;
      for (let i = 0; i < params.length; i += 7) {
        const [marketKey, intervalMs, at, open, high, low, close] = params.slice(i, i + 7);
        const key = `${marketKey}|${intervalMs}|${at}`;
        if (!this.rows.has(key)) { this.rows.set(key, { market_key: marketKey, interval_ms: intervalMs, at, open, high, low, close }); inserted += 1; }
      }
      return { rowCount: inserted };
    }
    if (text.startsWith("SELECT at, open")) {
      const [marketKey, intervalMs, since, limit] = params;
      const rows = [...this.rows.values()].filter((r) => r.market_key === marketKey && r.interval_ms === intervalMs && r.at >= since).sort((a, b) => a.at - b.at).slice(0, limit);
      return { rows };
    }
    if (text.startsWith("DELETE FROM iq_candles_5s")) {
      const [cutoff] = params;
      let removed = 0;
      for (const [key, row] of this.rows) { if (row.at < cutoff) { this.rows.delete(key); removed += 1; } }
      return { rowCount: removed };
    }
    throw new Error(`UNEXPECTED_QUERY ${text.slice(0, 60)}`);
  }
}

/* 1) persistencia canonica: unique asset+interval+at, OHLC, flush */
{
  const pool = new FakePool();
  const store = new CandleStore({ pool, now: () => NOW, maxBuffer: 10_000 });
  ok("CandleStore ready com pool canonico", store.ready === true && store.status().intervalMs === 5000);
  for (const candle of series) store.record("EURUSD:OTC", candle);
  store.record("EURUSD:OTC", series[0]);
  const inserted = await store.flush();
  ok("flush grava candles 5s (duplicata ON CONFLICT nao duplica)", inserted === series.length && pool.rows.size === series.length);
  const loaded = await store.loadRecent("EURUSD:OTC");
  ok("loadRecent devolve serie ordenada (OHLC integro)", loaded.length === series.length && loaded[0].at === series[0].at && loaded[0].close === series[0].close && loaded[loaded.length - 1].at === series[series.length - 1].at);
  const pruned = await store.prune();
  ok("prune nao remove dentro da retencao", pruned === 0 && pool.rows.size === series.length);
  const old = mk5s(1, NOW - 5 * 60 * 60 * 1000)[0];
  store.record("EURUSD:OTC", old);
  await store.flush();
  const prunedOld = await store.prune();
  const afterPrune = await store.loadRecent("EURUSD:OTC");
  ok("prune remove alem da retencao (4h+)", prunedOld === 1 && !afterPrune.some((c) => c.at === old.at));
  ok("loadRecent nao devolve candles fora da janela de 3h+intervalo", !afterPrune.some((c) => c.at < NOW - 10_800_000 - 5000));
}

/* 2) hydration cross-restart: novo RuntimeIntelligence reconstroi READY do mesmo store */
{
  const pool = new FakePool();
  const store = new CandleStore({ pool, now: () => NOW, maxBuffer: 10_000 });
  for (const candle of series) store.record("EURUSD:OTC", candle);
  await store.flush();
  const bootA = new RuntimeIntelligence({ now: () => NOW, strategy: ACTIVE, loader: (key) => store.loadRecent(key) });
  const reportA = await bootA.start(["EURUSD:OTC"]);
  const pipeA = bootA.registry.get("EURUSD:OTC");
  const bootB = new RuntimeIntelligence({ now: () => NOW, strategy: ACTIVE, loader: (key) => store.loadRecent(key) });
  const reportB = await bootB.start(["EURUSD:OTC"]);
  const pipeB = bootB.registry.get("EURUSD:OTC");
  ok("cross-restart: boot A hidrata READY com 3h de candles 5s", reportA.ready === 1 && pipeA.hydration === HYDRATION_READY && pipeA.ctx.intervalMs === 5000 && pipeA.ctx.coverageMs() >= 10_795_000);
  ok("cross-restart: boot B (restart) reconstroi estado identico", reportB.ready === 1 && pipeB.hydration === HYDRATION_READY && stableStringify(pipeA.ctx.snapshot()) === stableStringify(pipeB.ctx.snapshot()));
  ok("cross-restart: FeatureEngine reconstruido (mesma featuresVersion/at)", pipeA.features?.version === pipeB.features?.version && pipeA.features?.at === pipeB.features?.at && pipeB.featuresComputed === 1);
  ok("health apos restart: READY/intelligenceReady com intervalo observado 5000", bootB.health().state === "READY" && bootB.health().observedIntervalMs === 5000 && bootB.health().intelligenceReady === true);
}

/* 3) loader falhando no boot -> FAILED por ativo, sem excecao (fail-closed) */
{
  const store = new CandleStore({ pool: { query: async () => { throw new Error("DB_DOWN"); } }, now: () => NOW });
  const intel = new RuntimeIntelligence({ now: () => NOW, strategy: ACTIVE, loader: (key) => store.loadRecent(key) });
  const report = await intel.start(["EURUSD:OTC"]);
  ok("DB indisponivel no boot -> FAILED por ativo e execucao DENY", report.failed === 1 && intel.allowsExecution("EURUSD:OTC").allowed === false && intel.health().state === "DEGRADED");
}

/* 4) acumulacao ao vivo recupera READY (FAILED NO_HISTORY -> 3h de candles 5s) */
{
  const pipeline = new AssetPipeline({ marketKey: "EURUSD:OTC", now: () => NOW });
  const h0 = pipeline.hydrate([]);
  const reasonAfterHydrate = pipeline.hydrationDetail.reason;
  let readyAt = null;
  const live = mk5s(2161, NOW - 10_800_000);
  for (const candle of live) { pipeline.onCandle(candle); if (readyAt === null && pipeline.hydration === HYDRATION_READY) readyAt = pipeline.ctx.candles.length; }
  ok("hydrate vazio -> FAILED (NO_HISTORY) e nunca operavel", h0 === HYDRATION_FAILED && reasonAfterHydrate === "NO_HISTORY");
  ok("acumulacao ao vivo recupera READY somente com 3h time-based", pipeline.hydration === HYDRATION_READY && readyAt !== null && readyAt >= 2160 && pipeline.ctx.coverageMs() >= 10_795_000);
}

/* 5) INTERVAL_INCOMPATIBLE nunca e promovido silenciosamente por candles 5s ao vivo */
{
  const pipeline = new AssetPipeline({ marketKey: "EURUSD:OTC", now: () => NOW });
  const oneMinute = mk5s(200, NOW - 12_000_000, 60_000);
  const h = pipeline.hydrate(oneMinute);
  for (const candle of mk5s(60, NOW - 300_000)) pipeline.onCandle(candle);
  ok("historico 1m + live 5s permanece PARTIAL/INTERVAL_INCOMPATIBLE (sem mistura)", h === HYDRATION_PARTIAL && pipeline.intervalIncompatible === true && pipeline.hydration === HYDRATION_PARTIAL);
}

/* 6) recusa de candles futuros no store/pipeline (nunca inventa candle) */
{
  const pool = new FakePool();
  const store = new CandleStore({ pool, now: () => NOW });
  const future = mk5s(2161, NOW + 600_000);
  const intel = new RuntimeIntelligence({ now: () => NOW, strategy: ACTIVE, loader: async () => future });
  const report = await intel.start(["EURUSD:OTC"]);
  ok("fixture futura -> FAILED/FUTURE_CANDLES e DENY", report.failed === 1 && intel.registry.get("EURUSD:OTC").hydrationDetail.reason === "FUTURE_CANDLES" && intel.allowsExecution("EURUSD:OTC").allowed === false);
  store.record("EURUSD:OTC", future[0]);
  await store.flush();
  const loaded = await store.loadRecent("EURUSD:OTC", { sinceMs: 0 });
  ok("store nao filtra por futuro (dado bruto preservado) mas pipeline recusa", loaded.length === 1);
}

console.log(fail === 0 ? `HYDRATION_TESTS ALL_PASS (${pass}/${pass})` : `HYDRATION_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
