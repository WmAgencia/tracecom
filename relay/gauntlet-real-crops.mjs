/** gauntlet-real-crops.mjs — runtime real sobre crops REAIS de IQ Option (sessao anterior).
 * Mede Vision (latencia+extracao factual) e Decision Agent com contexto deterministico de producao.
 * NUNCA imprime a key. Salva resultados em JSON local (sem imagens). */
import fs from "node:fs";
import pg from "pg";
import { runVisionProvider, runDecisionAgent } from "./opencode-go.mjs";
import { buildFeatureContext, freshnessGate } from "./feature-engine.mjs";
import { activeObservations } from "./frozen-strategies.mjs";
import { buildCandles } from "./experiment.mjs";

const CROP_DIR = "C:/Users/junin/AppData/Local/Temp/opencode/crops";
const FILES = ["prod_pill.png", "prod_right.png", "prod_side.png", "prod_bottom.png", "local_side.png"].filter((name) => fs.existsSync(`${CROP_DIR}/${name}`));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const results = { generatedAt: new Date().toISOString(), vision: [], decision: null, productionCandles: 0, source: "real IQ Option crops (previous live session) via production relay" };
const percentile = (values, p) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]; };
try {
  for (const file of FILES) {
    const imageDataUrl = `data:image/png;base64,${fs.readFileSync(`${CROP_DIR}/${file}`).toString("base64")}`;
    const startedAt = Date.now();
    const vision = await runVisionProvider(pool, { imageDataUrl, frameId: file, requestId: `gauntlet-${file}`, sessionContext: { sessionId: "gauntlet", segmentId: "seg-real-crops" } });
    results.vision.push({ file, status: vision?.provenance?.status, latencyMs: Date.now() - startedAt, availability: vision?.availability, symbol: vision?.symbol, marketType: vision?.marketType, price: vision?.price, ask: vision?.ask, bid: vision?.bid, investmentValue: vision?.investmentValue, expirationDisplayed: vision?.expirationDisplayed, candles: Array.isArray(vision?.candles) ? vision.candles.length : 0, hasDecisionField: Object.prototype.hasOwnProperty.call(vision ?? {}, "decision"), notes: vision?.notes, sessionId: vision?.provenance?.sessionId });
    console.log("VISION_CROP", JSON.stringify(results.vision[results.vision.length - 1]));
  }
  const active = await activeObservations(pool);
  const candleList = buildCandles(active.observations).map((c) => ({ start: c.start, open: c.open, high: c.high, low: c.low, close: c.close }));
  results.productionCandles = candleList.length;
  const context = buildFeatureContext({ candles: candleList, now: Date.now(), frameCapturedAt: Date.now() - 2_000, vision: null, provenanceExtra: { gauntlet: "real-crops" } });
  const fresh = freshnessGate(context);
  const decisionStarted = Date.now();
  const decision = await runDecisionAgent(pool, { context, requestId: "gauntlet-decision", sessionContext: { sessionId: "gauntlet" } });
  results.decision = { status: decision.status, latencyMs: Date.now() - decisionStarted, action: decision.decision?.action, confidence: decision.decision?.analysisConfidence, estimatedWinProbability: decision.decision?.estimatedWinProbability, referencePrice: decision.decision?.referencePrice, waitReason: decision.decision?.waitReason, freshness: fresh, indicators: Object.fromEntries(Object.entries(context.deterministicIndicators).map(([key, entry]) => [key, entry?.value ?? null])), candles: candleList.length, model: decision.model };
  console.log("DECISION", JSON.stringify(results.decision));
  const latencies = results.vision.map((row) => row.latencyMs);
  console.log("LATENCY", JSON.stringify({ visionP50: percentile(latencies, 0.5), visionP95: percentile(latencies, 0.95), visionMax: latencies.length ? Math.max(...latencies) : null, decisionMs: results.decision.latencyMs, samples: latencies.length }));
} finally { fs.writeFileSync("C:/Users/junin/AppData/Local/Temp/opencode/gauntlet-real-crops.json", JSON.stringify(results, null, 1)); await pool.end(); }
