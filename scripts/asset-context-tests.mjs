import { AssetContext, computeAtr, ASSET_CONTEXT_WINDOW_CANDLES } from "file:///D:/tracecom/repo/relay/intelligence/asset-context.mjs";
let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const BASE = 1_700_000_000_000;
const build = () => {
  let at = BASE; const out = [];
  const push = (price, width = 0.0005) => { out.push({ at, open: price, high: price + width, low: price - width, close: price }); at += 60_000; };
  const run = (n, from, step) => { let p = from; for (let i = 0; i < n; i += 1) { p += step; push(p); } };
  for (let i = 0; i < 4; i += 1) push(1.0000);
  run(6, 1.0000, 0.0010);
  run(5, 1.0060, -0.0010);
  run(8, 1.0010, 0.0010);
  run(4, 1.0090, -0.0010);
  run(10, 1.0050, 0.0010);
  run(6, 1.0150, -0.0010);
  return out;
};
const series = build();

const ctx = new AssetContext({ marketKey: "EURUSD-OTC" });
const ingested = ctx.ingestMany(series);
const snap = ctx.snapshot();
console.log(`RESUMO candles=${snap.candles} structure=${snap.structure} regime=${snap.regime} lastBOS=${snap.lastBOS?.type ?? null} lastCHoCH=${snap.lastCHoCH?.type ?? null} events=${snap.events} pullback=${JSON.stringify(snap.pullback)}`);

ok("ingere serie completa", ingested === series.length && snap.candles === series.length);
ok("estrutura UPTREND", snap.structure === "UPTREND" && snap.regime === "UPTREND");
ok("BOS_UP detectado", snap.lastBOS?.type === "BOS_UP" && snap.lastBOS.price > 0);
ok("pivos confirmados causalmente", ctx.pivots.every((p) => p.confirmedAt > p.at));
ok("eventos sem vazamento futuro", ctx.events.every((e) => e.confirmedAt <= snap.lastAt));
ok("pullback ativo no uptrend", snap.pullback.active === true && snap.pullback.distanceAtr > 0 && ["SHALLOW", "NORMAL", "DEEP", "STRUCTURE_THREATENING"].includes(snap.pullback.depth));
ok("zonas com kind e distanceAtr", snap.zones.length >= 2 && snap.zones.every((z) => ["MICRO", "LOCAL", "STRUCTURAL"].includes(z.kind) && Number.isFinite(z.distanceAtr)));
ok("ATR numerico", computeAtr(ctx.candles) > 0);

const dup = ctx.ingest(series[series.length - 1]);
const old = ctx.ingest({ ...series[0], at: series[0].at - 1 });
ok("duplicado e fora de ordem rejeitados", dup === false && old === false && ctx.candles.length === series.length);

const ctxB = new AssetContext({ marketKey: "EURUSD-OTC" });
ctxB.ingestMany(series);
ok("determinismo (mesma serie = mesmo snapshot)", JSON.stringify(ctxB.snapshot()) === JSON.stringify(snap));

const ring = new AssetContext({ marketKey: "X" });
let at = BASE; for (let i = 0; i < 2200; i += 1) { ring.ingest({ at, open: 1, high: 1.001, low: 0.999, close: 1 }); at += 5_000; }
ok("ring buffer limita a 2160 (5s) e cobertura temporal a 3h", ring.candles.length === ASSET_CONTEXT_WINDOW_CANDLES && ring.coverageMs() <= 3 * 60 * 60 * 1000 && ring.candles[0].at === BASE + 40 * 5_000);

const ctxC = new AssetContext({ marketKey: "EURUSD-OTC" });
const hyd = ctxC.hydrate(series);
ok("hydrate equivalente a ingestMany", hyd === series.length && ctxC.candles.length === series.length && ctxC.hydratedAt === series[series.length - 1].at);

const choch = new AssetContext({ marketKey: "Y" });
const up = build();
choch.ingestMany(up);
let breakoutAt = ctx.events.find((e) => e.type === "BOS_UP")?.at ?? null;
ok("BOS_UP ocorre durante a perna de alta (antes do fim)", breakoutAt !== null && breakoutAt < series[series.length - 1].at);
const down = [];
let price = 1.0200; let t = series[series.length - 1].at;
for (let i = 0; i < 12; i += 1) { price -= 0.0010; down.push({ at: t + (i + 1) * 60_000, open: price, high: price + 0.0005, low: price - 0.0005, close: price }); }
choch.ingestMany(down);
const lowsConfirmed = choch.pivots.filter((p) => p.type === "LOW");
console.log(`DEBUG_CHOCH lastLow=${lowsConfirmed.slice(-1)[0]?.price} minClose=${Math.min(...down.map((c) => c.close))} structure=${choch.structure} lastBOS=${choch.lastBOS?.type}`);
ok("CHOCH_DOWN ao perder o ultimo low confirmado no uptrend", choch.lastCHoCH?.type === "CHOCH_DOWN");
ok("estrutura permanece enum valido apos CHOCH", ["UPTREND", "DOWNTREND", "RANGE"].includes(choch.structure));
ok("CHOCH_DOWN exige close abaixo do low confirmado", choch.lastCHoCH ? Math.min(...down.map((c) => c.close)) < lowsConfirmed.slice(-1)[0].price || lowsConfirmed.length <= 1 : true);

console.log(fail === 0 ? `ASSET_CONTEXT_TESTS ALL_PASS (${pass}/${pass})` : `ASSET_CONTEXT_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
