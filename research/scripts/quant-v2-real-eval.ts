import { mkdir, writeFile } from "node:fs/promises";
import { buildFeatureSnapshot } from "../../src/quant-v2/feature-engine";
import { classifyRegime } from "../../src/quant-v2/regime-engine";
import { quantShadowDecision } from "../../src/quant-v2/quant-fusion";
import { findSimilarPatterns, type HistoricalPattern } from "../../src/quant-v2/similar-pattern";
import { purgedWalkForward } from "../../src/quant-v2/walk-forward";
import { calibratePlatt, calibrateIsotonic } from "../../src/quant-v2/calibration";
import type { MarketCandle, Timeframe } from "../../src/market/model";

const relay = process.env.TRACECOM_LIVE_RELAY_URL || "https://tracecom-live-relay-production.up.railway.app";
const admin = process.env.TRACE_RELAY_ADMIN;
const sessions = (process.env.TRACECOM_QUANT_SESSIONS || "vision_81225f7f-0743-4b61-8d42-72f48247a36e,vision_1b452642-272b-4fc5-af12-d00eb0189054").split(",").filter(Boolean);
if (!admin) throw new Error("TRACE_RELAY_ADMIN is required; do not print it");
const get = async (path: string) => { const r = await fetch(`${relay}${path}`, { headers: { "x-relay-admin": admin } }); if (!r.ok) throw new Error(`${path}:${r.status}`); return r.json() as Promise<any>; };

type Sample = { sampleId: string; groundTruthId: string; marketEventId: string | null; decisionTimestamp: number; entryTimestamp: number; settlementTimestamp: number; entryPrice: number; settlementPrice: number; target: "UP" | "DOWN" | "DRAW"; candles: MarketCandle[]; featureSnapshot: ReturnType<typeof buildFeatureSnapshot>; regime: ReturnType<typeof classifyRegime>; };
const target = (entry: number, exit: number): Sample["target"] => exit > entry ? "UP" : exit < entry ? "DOWN" : "DRAW";
const metrics = (rows: Array<{ prediction: string; target: string }>) => { const w = rows.filter(x => x.prediction === x.target && x.target !== "DRAW").length; const l = rows.filter(x => x.prediction !== x.target && x.target !== "DRAW" && x.prediction !== "DRAW").length; const d = rows.filter(x => x.target === "DRAW").length; return { N: rows.length, W: w, L: l, D: d, WR: w + l ? w / (w + l) : null, coverage: rows.length }; };

const samples: Sample[] = [];
for (const sid of sessions) {
  const [gt, prices, timeline] = await Promise.all([get(`/api/live/sessions/${sid}/ground-truth`), get(`/api/live/sessions/${sid}/prices?status=ACCEPTED`), get(`/api/live/sessions/${sid}/timeline`)]);
  const accepted = (prices.prices ?? []).filter((p: any) => p.status === "ACCEPTED" && Number.isFinite(Number(p.value))).map((p: any) => ({ t: Date.parse(p.observedAt), v: Number(p.value) })).filter((p: any) => p.t > 0);
  const locks = (timeline.items ?? []).filter((i: any) => i.kind === "event" && i.type === "OPERATIONAL_SIGNAL_LOCKED").map((i: any) => ({ ...i.data, at: Date.parse(i.at) }));
  for (const row of (gt.groundTruths ?? [])) {
    if (row.status !== "COMPLETE" || !row.entryPriceObservationId || !row.settlementPriceObservationId || !Number.isFinite(Number(row.entryPrice)) || !Number.isFinite(Number(row.settlementPrice))) continue;
    const lock = locks.find((x: any) => x.signalId === row.signalId || x.signalId === row.decisionId); const decisionTimestamp = lock?.at ?? Date.parse(row.createdAt ?? ""); if (!decisionTimestamp) continue;
    const before = accepted.filter((p: any) => p.t <= decisionTimestamp); const candles = new Map<number, MarketCandle>();
    for (const p of before) { const bucket = Math.floor(p.t / 5000) * 5000; const old = candles.get(bucket); candles.set(bucket, old ? { ...old, high: Math.max(old.high, p.v), low: Math.min(old.low, p.v), close: p.v } : { provider: "relay", symbol: "USDCAD", timeframe: "1m" as Timeframe, open: p.v, high: p.v, low: p.v, close: p.v, volume: 0, timestamp: bucket, receivedAt: p.t, isClosed: true, source: "price_observations", quality: "high" }); }
    const series = [...candles.values()].sort((a, b) => a.timestamp - b.timestamp); if (series.length < 3) continue;
    const snapshot = buildFeatureSnapshot(series); samples.push({ sampleId: `${sid}:${row.groundTruthId}`, groundTruthId: row.groundTruthId, marketEventId: row.marketEventId ?? null, decisionTimestamp, entryTimestamp: decisionTimestamp, settlementTimestamp: Date.parse(row.settledAt ?? row.createdAt ?? "") || decisionTimestamp + 60000, entryPrice: Number(row.entryPrice), settlementPrice: Number(row.settlementPrice), target: target(Number(row.entryPrice), Number(row.settlementPrice)), candles: series, featureSnapshot: snapshot, regime: classifyRegime(snapshot.features) });
  }
}
samples.sort((a, b) => a.decisionTimestamp - b.decisionTimestamp);
const split = Math.max(1, Math.floor(samples.length * .6)), validationEnd = Math.max(split + 1, Math.floor(samples.length * .8));
const train = samples.slice(0, split), validation = samples.slice(split, validationEnd), holdout = samples.slice(validationEnd);
const labels = train.map(s => s.target === "UP" ? 1 : 0); const priorUp = (labels.filter(Boolean).length + 1) / (labels.length + 2);
const predictPrior = (s: Sample) => (priorUp >= .5 ? "UP" : "DOWN");
const historical: HistoricalPattern[] = [];
const quantRows = samples.map(s => { const q = quantShadowDecision({ snapshot: s.featureSnapshot, history: historical, labels }); historical.push({ groundTruthId: s.groundTruthId, timestamp: s.decisionTimestamp, features: s.featureSnapshot.features, direction: q.direction === "BUY" ? "UP" : q.direction === "SELL" ? "DOWN" : "DRAW", resultAtT60: s.target }); return { sampleId: s.sampleId, groundTruthId: s.groundTruthId, target: s.target, prediction: q.direction === "BUY" ? "UP" : q.direction === "SELL" ? "DOWN" : "DRAW", quant: q, regime: s.regime.regime }; });
const baselineRows = holdout.map(s => ({ prediction: predictPrior(s), target: s.target })); const quantHoldout = quantRows.slice(validationEnd).map(x => ({ prediction: x.prediction, target: x.target }));
const regimePerformance = Object.fromEntries([...new Set(samples.map(s => s.regime.regime))].map(regime => { const r = quantRows.filter(x => x.regime === regime); return [regime, metrics(r.map(x => ({ prediction: x.prediction, target: x.target })))] }));
const calibration = calibratePlatt(priorUp, validation.map(s => s.target === "UP" ? 1 : 0)); const isotonic = calibrateIsotonic(priorUp, validation.map(s => ({ probability: priorUp, label: s.target === "UP" ? 1 : 0 })));
const report = { generatedAt: new Date().toISOString(), source: "relay_postgresql", sessions, dataset: { rawGroundTruths: "queried", usable: samples.length, excluded: "unknown/invalid/incomplete provenance", UP: samples.filter(s => s.target === "UP").length, DOWN: samples.filter(s => s.target === "DOWN").length, DRAW: samples.filter(s => s.target === "DRAW").length }, split: { train: train.length, validation: validation.length, holdout: holdout.length }, models: { empiricalPrior: { ...metrics(baselineRows), priorUp }, quantFusionShadow: { ...metrics(quantHoldout), featureVersion: quantRows[0]?.quant.featureVersion ?? null, modelVersion: quantRows[0]?.quant.modelVersion ?? null } }, regimePerformance, calibration: { platt: calibration, isotonic }, walkForward: purgedWalkForward(samples.map(s => ({ timestamp: s.decisionTimestamp, sampleId: s.sampleId })), Math.max(1, Math.floor(samples.length * .5)), Math.max(1, Math.floor(samples.length * .2)), Math.max(1, Math.floor(samples.length * .2)), 60000).map(f => ({ train: f.train.length, validation: f.validation.length, holdout: f.holdout.length, embargoUntil: f.embargoUntil })), status: samples.length < 30 ? "INSUFFICIENT_SAMPLE" : "SHADOW_EVALUATED", strategyChanged: false, modelsPromoted: [] };
await mkdir("research/artifacts", { recursive: true }); await writeFile("research/artifacts/quant-v2-real-report.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
