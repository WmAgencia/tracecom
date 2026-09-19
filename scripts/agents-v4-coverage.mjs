/**
 * AGENTS V4 FEATURE COVERAGE — relatorio available%/missing%/stale% por feature, NORMAL/OTC.
 *
 * Uso:
 *   node scripts/agents-v4-coverage.mjs                 # fixture reference (sem DB)
 *   DATABASE_URL=... node scripts/agents-v4-coverage.mjs --from-db --limit 500
 *
 * Read-only: nao decide, nao altera nada. Saida padrao: docs/research/data/agents-v4-feature-coverage.json
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "docs/research/data/agents-v4-feature-coverage.json");

const hub = await import(new URL("../relay/datahub/index.mjs", import.meta.url));
const featureEngine = await import(new URL("../relay/feature-engine.mjs", import.meta.url));
const priceStructure = await import(new URL("../relay/price-structure.mjs", import.meta.url));

const BASE_MS = 1_800_000_000_000;
const CANDLE_MS = 5_000;

function zigzag({ dir = "UP", steps = 88, start = 1.1, amp = 0.0006, step = 0.00012, baseMs = BASE_MS } = {}) {
  const candles = [];
  let price = start;
  for (let index = 0; index < steps; index += 1) {
    const open = price;
    const drift = dir === "UP" ? step : dir === "DOWN" ? -step : 0;
    const phase = index % 5;
    const wave = dir === "DOWN" ? (phase < 2 ? amp : -amp) : phase < 3 ? amp : -amp;
    const close = open + drift + wave;
    const upWick = close >= open ? amp * 0.4 : amp * 0.15;
    const downWick = close <= open ? amp * 0.4 : amp * 0.15;
    candles.push({ bucketStart: baseMs + index * CANDLE_MS, bucketEnd: baseMs + index * CANDLE_MS + CANDLE_MS, open, high: Math.max(open, close) + upWick, low: Math.min(open, close) - downWick, close, receivedAt: baseMs + index * CANDLE_MS + CANDLE_MS, serverTimestamp: baseMs + index * CANDLE_MS });
    price = close;
  }
  return candles;
}

function buildFixtureT0(candles, marketKey, marketType, activeId) {
  const decisionAt = candles[candles.length - 1].bucketStart + CANDLE_MS;
  const featureContext = featureEngine.buildFeatureContext({ candles, now: decisionAt, frameCapturedAt: decisionAt, timeframeSeconds: 5 });
  const structureFeatures = priceStructure.computeStructureFeatures(candles, candles.length - 1, { atr: featureContext.deterministicIndicators.atr14.value });
  const ticks = [];
  for (let index = 0; index < 30; index += 1) ticks.push({ price: candles[candles.length - 1].close + index * 0.000002, at: decisionAt - (30 - index) * 400, receivedAt: decisionAt - (30 - index) * 400 });
  return hub.buildT0Enriched({
    marketKey, marketType, activeId, accountContext: "PRACTICE", decisionAt,
    price: candles[candles.length - 1].close, candles5s: candles, ticks, featureContext, structureFeatures,
    trajectory: { rsiSlope: 0.1, adxSlope: 0.05, diSpreadSlope: 0.02, atrSlope: 0.01, donchianDelta: 0.01, samples: 10 },
  });
}

function fixtureSnapshots() {
  const snapshots = [];
  for (const market of [["EURUSD:OTC", "OTC", 76], ["EURUSD:NORMAL", "NORMAL", 1]]) {
    snapshots.push(buildFixtureT0(zigzag({ dir: "UP" }), ...market));
    snapshots.push(buildFixtureT0(zigzag({ dir: "DOWN", steps: 88 }), ...market));
    snapshots.push(buildFixtureT0(zigzag({ dir: "FLAT", amp: 0.0004, steps: 86 }), ...market));
  }
  return snapshots;
}

async function fromDatabase(limit) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString, max: 2, ssl: /sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : undefined });
  try {
    const rows = await pool.query(
      `SELECT payload->'t0' AS t0 FROM iq_agents_v4_observations WHERE payload ? 't0' ORDER BY created_at DESC LIMIT $1`,
      [Math.max(1, Math.min(2000, Number(limit) || 500))],
    );
    return rows.rows.map((row) => row.t0).filter(Boolean);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const fromDb = process.argv.includes("--from-db");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : 500;
let snapshots = null;
let source = "FIXTURE_REFERENCE";
if (fromDb) {
  snapshots = await fromDatabase(limit);
  if (snapshots && snapshots.length) source = "DATABASE_PROSPECTIVE";
  else console.warn("AGENTS_V4_COVERAGE_NO_DB_DATA: usando fixture reference");
}
if (!snapshots || !snapshots.length) snapshots = fixtureSnapshots();
const coverage = hub.computeFeatureCoverage(snapshots);
const report = { ...coverage, source, generatedAtUtc: new Date().toISOString(), limit: source === "DATABASE_PROSPECTIVE" ? limit : null };
fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`AGENTS_V4_COVERAGE_WRITTEN ${OUT} source=${source} snapshots=${coverage.snapshots} features=${coverage.rows.length}`);
for (const row of coverage.rows.slice(0, 12)) console.log(`  ${row.feature.padEnd(34)} available=${row.availablePct}% missing=${row.missingPct}% stale=${row.stalePct}%`);
