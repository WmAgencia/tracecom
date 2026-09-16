/** probe-vision-real.mjs — testa a chamada Vision com uma imagem real (path via argv). Nunca imprime a key. */
import fs from "node:fs";
import pg from "pg";
import { runVisionProvider } from "./opencode-go.mjs";
const file = process.argv[2];
const mime = file.endsWith(".png") ? "image/png" : "image/jpeg";
const imageDataUrl = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const vision = await runVisionProvider(pool, { imageDataUrl, frameId: "probe-real", requestId: "probe-vision-real" });
  console.log("VISION_REAL", JSON.stringify({ status: vision?.provenance?.status, availability: vision?.availability, symbol: vision?.symbol, marketType: vision?.marketType, investmentValue: vision?.investmentValue, expirationSeconds: vision?.expirationSeconds, latencyMs: vision?.provenance?.latencyMs, notes: vision?.notes, analysis: vision?.analysis ? { regime: vision.analysis.regime, donchian: vision.analysis.donchian, rsi: vision.analysis.rsi, atr: vision.analysis.atr, adx: vision.analysis.adx, microstructure: vision.analysis.microstructure, decision: vision.analysis.decision } : null }));
} finally { await pool.end(); }
