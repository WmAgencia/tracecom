import fs from "node:fs";
import { AssetPipeline, PipelineRegistry, HYDRATION_READY, HYDRATION_PARTIAL, HYDRATION_FAILED, HYDRATION_PENDING } from "file:///D:/tracecom/repo/relay/intelligence/asset-pipeline.mjs";
import { deepFreeze, stableStringify } from "file:///D:/tracecom/repo/relay/intelligence/features.mjs";
let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const norm = (c) => {
  if (Array.isArray(c)) return { at: Number(c[0]), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]) };
  const value = (key) => Number(c[key]);
  const at = c.at ?? c.time ?? c.ts ?? c.timestamp ?? c.t;
  return { at: Number(at), open: value("open") || value("o"), high: value("high") || value("h"), low: value("low") || value("l"), close: value("close") || value("c") };
};
const fixAt = (c) => ({ ...c, at: c.at < 1_000_000_000_000 ? c.at * 1000 : c.at });
const loadReal = () => {
  const raw = JSON.parse(fs.readFileSync("D:/tracecom/repo/data/real/usdcad-1m-7d.json", "utf8"));
  const list = Array.isArray(raw) ? raw : (raw.candles ?? raw.data ?? raw.rows ?? []);
  return list.map(norm).filter((c) => Number.isFinite(c.at) && Number.isFinite(c.close) && Number.isFinite(c.high)).map(fixAt);
};
const real = loadReal();
console.log(`FIXTURE real candles=${real.length} first=${real[0]?.at} last=${real[real.length - 1]?.at}`);

const p1 = new AssetPipeline({ marketKey: "USDCAD-OTC" });
ok("estado inicial PENDING nao-READY", p1.hydration === HYDRATION_PENDING && p1.ready === false && p1.onCandle(real[0]) === null);
ok("hydrate vazio -> FAILED fail-closed", p1.hydrate([]) === HYDRATION_FAILED && p1.ready === false && p1.status().hydrationReason === "NO_HISTORY");

const short = new AssetPipeline({ marketKey: "USDCAD-OTC" });
ok("historico insuficiente -> FAILED (WARMING_UP interno)", short.hydrate(real.slice(0, 10)) === HYDRATION_FAILED && short.ready === false && short.status().hydrationReason === "INSUFFICIENT_HISTORY" && short.evaluate() === null);

const partial = new AssetPipeline({ marketKey: "USDCAD-OTC" });
ok("historico parcial -> PARTIAL e pronto", partial.hydrate(real.slice(0, 300)) === HYDRATION_PARTIAL && partial.ready === true && partial.features !== null && partial.specialists.length === 5);

const full = new AssetPipeline({ marketKey: "USDCAD-OTC" });
ok("historico completo -> READY com ring 2160", full.hydrate(real.slice(0, 2300)) === HYDRATION_READY && full.ctx.candles.length === 2160 && full.ready === true);

const replayA = new AssetPipeline({ marketKey: "USDCAD-OTC" });
const replayB = new AssetPipeline({ marketKey: "USDCAD-OTC" });
replayA.hydrate(real.slice(0, 1200));
replayB.hydrate(real.slice(0, 1200));
ok("replay deterministico (mesmo hash/features)", stableStringify(replayA.features) === stableStringify(replayB.features) && (replayA.lastSnapshot?.id ?? null) === (replayB.lastSnapshot?.id ?? null));
const replayC = new AssetPipeline({ marketKey: "USDCAD-OTC" });
replayC.hydrate(real.slice(0, 1200));
ok("replay repetido identico (3a execucao)", stableStringify(replayC.features) === stableStringify(replayA.features));

const T = 1000;
let stateAtT = null;
const stream = new AssetPipeline({ marketKey: "USDCAD-OTC" });
for (const candle of real.slice(0, T)) stream.hydrate([candle]);
stateAtT = { features: stableStringify(stream.features), ctx: JSON.stringify(stream.ctx.snapshot()), events: stream.ctx.events.length, pivots: JSON.stringify(stream.ctx.pivots) };
const fresh = new AssetPipeline({ marketKey: "USDCAD-OTC" });
const truncated = real.slice(0, T);
for (const candle of truncated) fresh.hydrate([candle]);
ok("causalidade por truncamento (estado em T identico)", stableStringify(fresh.features) === stateAtT.features && JSON.stringify(fresh.ctx.snapshot()) === stateAtT.ctx && fresh.ctx.events.length === stateAtT.events);
ok("nenhum evento/pivo com at > T (sem lookahead)", fresh.ctx.events.every((e) => e.at <= truncated[truncated.length - 1].at && e.confirmedAt <= truncated[truncated.length - 1].at) && fresh.ctx.pivots.every((p) => p.at <= truncated[truncated.length - 1].at));
const lastAt = real[real.length - 1].at;
const fullStream = new AssetPipeline({ marketKey: "USDCAD-OTC" });
fullStream.hydrate(real.slice(0, 1200));
ok("estado avancado com futuro difere do estado em T (prova de que T truncado importa)", stableStringify(fullStream.features) !== stateAtT.features && lastAt > truncated[truncated.length - 1].at);

const buyFeatures = deepFreeze({
  marketKey: "USDCAD-OTC", version: 99, at: 1_700_000_000_000, candles: 300, structure: "UPTREND", regime: "UPTREND", close: 1.3500, atr: 0.0010, volRatio: 1.1,
  rsi: { value: 33.2, zone: "LOW" },
  dmi: { adx: 28, plusDi: 33, minusDi: 17, trending: true },
  bollinger: { bandwidth: 0.0013, percentB: 0.42, expanding: true },
  priceAction: { bodyRatio: 0.45, closeInRange: 0.6, direction: "UP", pullback: { active: true, direction: "UP_TREND_PULLBACK", depth: "NORMAL", distanceAtr: 0.7 }, nearestZone: null, lastBOS: null, lastCHoCH: null },
});
const actionablePipeline = new AssetPipeline({ marketKey: "USDCAD-OTC" });
const evaluation = actionablePipeline.evaluate(buyFeatures);
ok("evaluate(BUY) cria snapshot imutavel", evaluation.snapshot !== null && Object.isFrozen(evaluation.snapshot) && evaluation.consensus.side === "BUY");
ok("dedup por snapshotId", actionablePipeline.isDuplicate(evaluation.snapshot.id) === false && actionablePipeline.markSubmitted(evaluation.snapshot.id) === true && actionablePipeline.isDuplicate(evaluation.snapshot.id) === true && actionablePipeline.markSubmitted(evaluation.snapshot.id) === false);
ok("WAIT nunca vira snapshot executavel", (() => { const p = new AssetPipeline({ marketKey: "X" }); p.evaluate(deepFreeze({ ...buyFeatures, structure: "RANGE", rsi: { value: 50, zone: "NEUTRAL" }, dmi: { adx: 12, plusDi: 20, minusDi: 20, trending: false }, priceAction: { ...buyFeatures.priceAction, pullback: { active: false, direction: null, depth: null, distanceAtr: null } } })); return p.consensus.side === "WAIT" && p.lastSnapshot === null; })());

const registry = new PipelineRegistry({ loader: async (key) => (key === "A-OTC" ? real.slice(0, 2300) : key === "B-OTC" ? real.slice(0, 300) : []) });
const report = await registry.hydrateAll(["A-OTC", "B-OTC", "C-OTC"]);
ok("registry hidrata por ativo com estados fail-closed", report.ready === 1 && report.partial === 1 && report.failed === 1 && report.assets.every((a) => typeof a.candles === "number"));
ok("registry actionable so com READY+BUY+dedup", Array.isArray(registry.actionable()) && registry.actionable().every((a) => a.snapshot && a.consensus.side !== "WAIT"));

const intelFiles = ["asset-context", "features", "specialists", "consensus", "decision-snapshot", "asset-pipeline"].map((n) => ({ n, s: fs.readFileSync(`D:/tracecom/repo/relay/intelligence/${n}.mjs`, "utf8") }));
const forbidden = /requestOrder|placeTrade|broker|realArmed|ACCOUNT_PRACTICE|ACCOUNT_REAL|\bPRACTICE\b|\bREAL\b|iqoption|wsRuntime|submitOrder|accountRouter|executionGate/;
const violations = intelFiles.flatMap(({ n, s }) => forbidden.test(s) ? [n] : []);
ok("inteligencia sem acesso a broker/conta (prova estatica)", violations.length === 0);

console.log(fail === 0 ? `STAGE3_WIRING_TESTS ALL_PASS (${pass}/${pass})` : `STAGE3_WIRING_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
