import fs from "node:fs";
import { AssetPipeline, PipelineRegistry, productState, HYDRATION_READY, HYDRATION_PARTIAL, HYDRATION_FAILED, HYDRATION_PENDING } from "file:///D:/tracecom/repo/relay/intelligence/asset-pipeline.mjs";
import { MAX_CONTEXT_AGE_MS, OPERATIONAL_CANDLE_INTERVAL_MS } from "file:///D:/tracecom/repo/relay/intelligence/asset-context.mjs";
import { deepFreeze, stableStringify } from "file:///D:/tracecom/repo/relay/intelligence/features.mjs";
let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const NOW = 1_800_000_000_000;
const mk5s = (n, startAt, stepMs = 5000) => Array.from({ length: n }, (_, i) => {
  const base = 1.3500 + Math.sin(i / 50) * 0.0020 + i * 0.000001;
  return { at: startAt + i * stepMs, open: base, high: base + 0.0004, low: base - 0.0004, close: base + Math.sin(i / 17) * 0.0002 };
});
const mkPipeline = (key) => new AssetPipeline({ marketKey: key, now: () => NOW });

const readSeries = mk5s(2161, NOW - 10_800_000);
const p8 = mkPipeline("FIVE-5S");
const h8 = p8.hydrate(readSeries, { expectedIntervalMs: 5000 });
console.log(`FIVE_5S hydration=${h8} coverageMs=${p8.ctx.coverageMs()} intervalMs=${p8.ctx.intervalMs} candles=${p8.ctx.candles.length}`);
ok("5s cobertura 3h-1 intervalo -> READY (tolerancia de 1 intervalo)", h8 === HYDRATION_READY && p8.ready === true && p8.ctx.coverageMs() + p8.ctx.intervalMs >= MAX_CONTEXT_AGE_MS);
ok("features computadas apos READY (1x)", p8.features !== null && p8.featuresComputed >= 1 && p8.specialists.length === 5 && p8.analysisState() !== null);

const p2160 = mkPipeline("T-2160");
ok("2160 candles 5s (3h-5s, tolerancia 1 intervalo) -> READY", p2160.hydrate(mk5s(2160, NOW - 10_795_000), { expectedIntervalMs: 5000 }) === HYDRATION_READY);

const boundary = mkPipeline("BOUNDARY");
const hb = boundary.hydrate(mk5s(2000, NOW - 9_995_000), { expectedIntervalMs: 5000 });
ok("cobertura < 3h -> PARTIAL/COVERAGE_INSUFFICIENT", hb === HYDRATION_PARTIAL && boundary.hydrationDetail.reason === "COVERAGE_INSUFFICIENT" && boundary.ready === false);
ok("PARTIAL nao e executavel (onCandle/evaluate/actionable)", boundary.onCandle(mk5s(1, NOW)[0]) === null && boundary.evaluate() === null && boundary.observable === true);

const pruned = mkPipeline("PRUNED");
pruned.hydrate(mk5s(3000, NOW - 15_000_000), { expectedIntervalMs: 5000 });
ok("pruning por TEMPO (>3h descartado) mantendo bound de memoria", pruned.ctx.coverageMs() <= MAX_CONTEXT_AGE_MS + 5000 && pruned.ctx.candles.length <= 2162 && pruned.ctx.candles.length < 3000);

const gapSeries = mk5s(2161, NOW - 10_800_000).filter((_, i) => i < 1000 || i >= 1120);
const gapPipe = mkPipeline("GAP");
const hg = gapPipe.hydrate(gapSeries, { expectedIntervalMs: 5000 });
ok("gap de 10min em 5s -> PARTIAL/GAP_TOO_LARGE (sem inventar candles)", hg === HYDRATION_PARTIAL && gapPipe.hydrationDetail.reason === "GAP_TOO_LARGE" && gapPipe.hydrationDetail.gapRatio < 0.02);

const dirty = mkPipeline("DIRTY");
const dirtyList = [...readSeries, readSeries[10], { at: "x", open: 1, high: 1, low: 1, close: 1 }];
const hd = dirty.hydrate(dirtyList, { expectedIntervalMs: 5000 });
ok("duplicata e fora-de-ordem contabilizados (nao engolidos)", hd === HYDRATION_READY && dirty.hydrationDetail.rejected >= 1 && dirty.ctx.counts.outOfOrder >= 1 && dirty.ctx.counts.invalid >= 1);

const incompatible = mkPipeline("INCOMPAT");
const hi = incompatible.hydrate(readSeries, { expectedIntervalMs: 60_000 });
ok("intervalo 5s com expectativa 60s -> PARTIAL/INTERVAL_INCOMPATIBLE (sem conversao silenciosa)", hi === HYDRATION_PARTIAL && incompatible.hydrationDetail.reason === "INTERVAL_INCOMPATIBLE");

const futurePipe = mkPipeline("FUTURE");
const hf = futurePipe.hydrate(mk5s(2161, NOW + 60_000), { expectedIntervalMs: 5000 });
ok("candles futuros -> FAILED/FUTURE_CANDLES", hf === HYDRATION_FAILED && futurePipe.hydrationDetail.reason === "FUTURE_CANDLES" && futurePipe.ready === false);

const raw = JSON.parse(fs.readFileSync("D:/tracecom/repo/data/real/usdcad-1m-7d.json", "utf8"));
const rows = (Array.isArray(raw) ? raw : (raw.candles ?? raw.data ?? raw.rows ?? [])).map((c) => {
  if (Array.isArray(c)) return { at: Number(c[0]), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]) };
  const v = (k) => Number(c[k]);
  const at = Number(c.at ?? c.time ?? c.ts ?? c.timestamp ?? c.t);
  return { at: at < 1_000_000_000_000 ? at * 1000 : at, open: v("open") || v("o"), high: v("high") || v("h"), low: v("low") || v("l"), close: v("close") || v("c") };
}).filter((c) => Number.isFinite(c.at) && Number.isFinite(c.close) && Number.isFinite(c.high));
console.log(`CAUSALITY_AND_DETERMINISM_FIXTURE candles=${rows.length} intervalo=1m (NAO valida 3h/5s operacional)`);

const oneM = mkPipeline("CAUSALITY-1M");
const h1 = oneM.hydrate(rows.slice(0, 1200), { expectedIntervalMs: 60_000 });
ok("fixture 1m com expectativa 60s: hidrata (READY/PARTIAL), nunca FAILED por intervalo", [HYDRATION_READY, HYDRATION_PARTIAL].includes(h1) && oneM.ctx.intervalMs === 60_000 && oneM.hydrationDetail.reason !== "INTERVAL_INCOMPATIBLE");
const oneM5 = mkPipeline("CAUSALITY-1M-5S");
const h15 = oneM5.hydrate(rows.slice(0, 1200), { expectedIntervalMs: 5000 });
ok("fixture 1m NUNCA e tratado como 5s (INTERVAL_INCOMPATIBLE)", h15 === HYDRATION_PARTIAL && oneM5.hydrationDetail.reason === "INTERVAL_INCOMPATIBLE");

const detA = mkPipeline("DET"); detA.hydrate(readSeries, { expectedIntervalMs: 5000 });
const detB = mkPipeline("DET"); detB.hydrate(readSeries, { expectedIntervalMs: 5000 });
const detC = mkPipeline("DET"); detC.hydrate(readSeries, { expectedIntervalMs: 5000 });
ok("replay deterministico (3 execucoes identicas)", stableStringify(detA.features) === stableStringify(detB.features) && stableStringify(detB.features) === stableStringify(detC.features) && (detA.lastSnapshot?.id ?? null) === (detC.lastSnapshot?.id ?? null));

const longSeries = mk5s(3000, NOW - 15_000_000);
const streamPipe = mkPipeline("CAUSAL");
streamPipe.hydrate(longSeries.slice(0, 2161), { expectedIntervalMs: 5000 });
const stateAtT = { features: stableStringify(streamPipe.features), ctx: JSON.stringify(streamPipe.ctx.snapshot()), events: stableStringify(streamPipe.ctx.events), pivots: stableStringify(streamPipe.ctx.pivots) };
for (const candle of longSeries.slice(2161)) streamPipe.onCandle(candle);
const freshPipe = mkPipeline("CAUSAL");
freshPipe.hydrate(longSeries.slice(0, 2161), { expectedIntervalMs: 5000 });
ok("full-runtime causalidade: estado em T nao muda com candles >T", stableStringify(freshPipe.features) === stateAtT.features && JSON.stringify(freshPipe.ctx.snapshot()) === stateAtT.ctx && stableStringify(freshPipe.ctx.events) === stateAtT.events && stableStringify(freshPipe.ctx.pivots) === stateAtT.pivots);
const tLimit = longSeries[2160].at;
ok("eventos/pivos nunca alem de T no estado truncado", freshPipe.ctx.events.every((e) => e.at <= tLimit && e.confirmedAt <= tLimit) && freshPipe.ctx.pivots.every((p) => p.at <= tLimit && p.confirmedAt <= tLimit));

const buyFeatures = deepFreeze({
  marketKey: "FIVE-5S", version: 5000, at: NOW, candles: 2161, structure: "UPTREND", regime: "UPTREND", close: 1.3500, atr: 0.0012, volRatio: 1.05,
  rsi: { value: 34.0, zone: "LOW" },
  dmi: { adx: 29, plusDi: 33, minusDi: 18, trending: true },
  bollinger: { bandwidth: 0.0014, percentB: 0.44, expanding: true },
  priceAction: { bodyRatio: 0.45, closeInRange: 0.6, direction: "UP", pullback: { active: true, direction: "UP_TREND_PULLBACK", depth: "NORMAL", distanceAtr: 0.7 }, nearestZone: null, lastBOS: null, lastCHoCH: null },
});
const execPipe = mkPipeline("FIVE-5S");
const ev = execPipe.evaluate(buyFeatures);
ok("BUY cria snapshot imutavel; dedup por snapshotId", ev.snapshot !== null && Object.isFrozen(ev.snapshot) && execPipe.isDuplicate(ev.snapshot.id) === false && execPipe.markSubmitted(ev.snapshot.id) === true && execPipe.markSubmitted(ev.snapshot.id) === false);
const waitPipe = mkPipeline("WAIT-ASSET");
waitPipe.evaluate(deepFreeze({ ...buyFeatures, structure: "RANGE", rsi: { value: 50, zone: "NEUTRAL" }, dmi: { adx: 12, plusDi: 20, minusDi: 20, trending: false }, priceAction: { ...buyFeatures.priceAction, pullback: { active: false, direction: null, depth: null, distanceAtr: null } } }));
ok("WAIT: zero snapshot executavel, apenas AnalysisState", waitPipe.lastSnapshot === null && waitPipe.analysisState().consensus === "WAIT" && waitPipe.analysisState().snapshotId === null && !("stake" in waitPipe.analysisState()));

ok("productState OFF", productState({ enabled: false }) === "OFF");
ok("productState SEM FEED", productState({ enabled: true, feedStatus: "STALE" }) === "SEM FEED");
ok("productState SEM COMPRA (feed ok, sem buyability)", productState({ enabled: true, feedStatus: "OK", purchaseStatus: "UNAVAILABLE", hydration: HYDRATION_READY }) === "SEM COMPRA");
ok("productState ASSISTINDO (hydration parcial)", productState({ enabled: true, feedStatus: "OK", purchaseStatus: "AVAILABLE", hydration: HYDRATION_PARTIAL }) === "ASSISTINDO");
ok("productState WAIT", productState({ enabled: true, feedStatus: "OK", purchaseStatus: "AVAILABLE", hydration: HYDRATION_READY, consensusSide: "WAIT" }) === "WAIT");
ok("productState BUY/SELL", productState({ enabled: true, feedStatus: "OK", purchaseStatus: "AVAILABLE", hydration: HYDRATION_READY, consensusSide: "BUY" }) === "BUY" && productState({ enabled: true, feedStatus: "OK", purchaseStatus: "AVAILABLE", hydration: HYDRATION_READY, consensusSide: "SELL" }) === "SELL");

const registry = new PipelineRegistry({ now: () => NOW, loader: async (key) => (key === "A-OTC" ? readSeries : key === "B-OTC" ? mk5s(2000, NOW - 9_995_000) : []) });
const report = await registry.hydrateAll(["A-OTC", "B-OTC", "C-OTC"]);
ok("registry: READY/PARTIAL/FAILED por ativo com cobertura/intervalo no report", report.ready === 1 && report.partial === 1 && report.failed === 1 && report.assets[0].coverageMs + report.assets[0].intervalMs >= MAX_CONTEXT_AGE_MS && report.assets[0].intervalMs === OPERATIONAL_CANDLE_INTERVAL_MS);
ok("registry actionable apenas READY", registry.actionable().every((a) => registry.get(a.marketKey).ready === true));

const intelFiles = ["asset-context", "features", "specialists", "consensus", "decision-snapshot", "asset-pipeline"].map((n) => ({ n, s: fs.readFileSync(`D:/tracecom/repo/relay/intelligence/${n}.mjs`, "utf8") }));
const forbidden = /requestOrder|placeTrade|broker|realArmed|ACCOUNT_PRACTICE|ACCOUNT_REAL|\bPRACTICE\b|\bREAL\b|iqoption|wsRuntime|submitOrder|accountRouter|executionGate/;
const violations = intelFiles.flatMap(({ n, s }) => forbidden.test(s) ? [n] : []);
ok("inteligencia sem acesso a broker/conta (prova estatica)", violations.length === 0);

console.log(fail === 0 ? `STAGE3_WIRING_TESTS ALL_PASS (${pass}/${pass})` : `STAGE3_WIRING_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
