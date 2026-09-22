import fs from "node:fs";
import { CANDLE_SIZE_SECONDS } from "file:///D:/tracecom/repo/relay/iqoption-ws.mjs";
import { OPERATIONAL_CANDLE_INTERVAL_MS, MAX_CONTEXT_AGE_MS } from "file:///D:/tracecom/repo/relay/intelligence/asset-context.mjs";
import { RuntimeIntelligence } from "file:///D:/tracecom/repo/relay/intelligence/runtime-adapter.mjs";
let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

ok("fonte nativa da IQ = 5s (CANDLE_SIZE_SECONDS === 5)", CANDLE_SIZE_SECONDS === 5);
ok("5s nativo == granularidade operacional (5000ms)", CANDLE_SIZE_SECONDS * 1000 === OPERATIONAL_CANDLE_INTERVAL_MS);

const ws = fs.readFileSync("D:/tracecom/repo/relay/iqoption-ws.mjs", "utf8");
ok("WS assina candle-generated com o size canonico", /subscribeCandles\(activeId, size = CANDLE_SIZE_SECONDS\)/.test(ws) && /name: "candle-generated"/.test(ws));
ok("WS NAO tem stream de tick/quote (sem agregador necessario)", !/subscribeQuotes|"quote"|'quote'|price-stream/.test(ws));

const rt = fs.readFileSync("D:/tracecom/repo/relay/iq-multi-runtime.mjs", "utf8");
ok("runtime filtra eventos por size === CANDLE_SIZE_SECONDS", /Number\(event\.msg\?\.size\) === CANDLE_SIZE_SECONDS/.test(rt));
ok("runtime assina candles por ativo com CANDLE_SIZE_SECONDS", /subscribeCandles\(ctx\.activeId, CANDLE_SIZE_SECONDS\)/.test(rt));
ok("feed chega ao AssetPipeline via #pipeClosedCandle no #ingestCandle", /#ingestCandle\(ctx, raw, \{ receivedAt, serverTimestamp, connectionId, batch = false \}\) \{\n\s+this\.#pipeClosedCandle\(ctx, raw\);/.test(rt.replace(/\r\n/g, "\n")));

const NOW = 1_800_000_000_000;
const mk5s = (n, startAt) => Array.from({ length: n }, (_, i) => {
  const base = 1.3500 + Math.sin(i / 50) * 0.0020 + i * 0.000001;
  return { at: startAt + i * 5000, open: base, high: base + 0.0004, low: base - 0.0004, close: base + Math.sin(i / 17) * 0.0002 };
});
const intel = new RuntimeIntelligence({ now: () => NOW, strategy: { version: "PULLBACK_4060_300_AGENTIC_V2", status: "PENDING_IMPLEMENTATION", executable: false, strategyHash: null } });
await intel.start(["A-OTC"]);
const candles = mk5s(2161, NOW - 10_800_000);
intel.registry.get("A-OTC").hydrate(candles, { expectedIntervalMs: CANDLE_SIZE_SECONDS * 1000 });
intel.onClosedCandle("A-OTC", mk5s(1, NOW)[0]);
const status = intel.assetStatus("A-OTC");
console.log(`EVIDENCIA raw_source=candle-generated(5s nativo) observed_intervalMs=${status.intervalMs} candles=${status.candles} coverageMs=${status.coverageMs} hydration=${status.hydration}`);
ok("pipeline observa intervalMs=5000 do feed 5s nativo", status.intervalMs === 5000);
ok("cobertura 3h time-based com 2161 candles de 5s", status.coverageMs + status.intervalMs >= MAX_CONTEXT_AGE_MS);
ok("asset READY com feed 5s nativo valido", status.hydration === "HYDRATION_READY" && intel.health().state === "READY" && intel.health().intelligenceReady === true && intel.health().observedIntervalMs === 5000);
ok("execucao segue DENY (V2 PENDING_IMPLEMENTATION)", intel.allowsExecution("A-OTC").allowed === false && intel.allowsExecution("A-OTC").reason === "STRATEGY_NOT_ACTIVE");

console.log(fail === 0 ? `FEED_GRANULARITY_TESTS ALL_PASS (${pass}/${pass})` : `FEED_GRANULARITY_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
