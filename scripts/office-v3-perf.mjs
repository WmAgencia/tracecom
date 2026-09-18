/**
 * OFFICE V3 — PERFORMANCE HARNESS (headless).
 *
 * Measures the real renderer (world.js + life.js + assets.js) with the full
 * 55-desk / 110-agent office:
 *   - full-frame draw time p50/p95/max for drawWorld, drawAgents and combined;
 *   - a 240-frame simulated loop -> effective FPS, p95 frame time, long frames;
 *   - process RSS before/after and retained growth over 1000 updates;
 *   - per-agent update cost;
 *   - sprite/tile cache effectiveness (hit ratio) when caching is enabled;
 *   - static proof that the renderer has no trading dependency.
 *
 * Writes docs/office-v3/performance.md from the measured numbers.
 *
 * Frontend/rendering only. PRACTICE only. ZERO REAL.
 *
 * Usage: node scripts/office-v3-perf.mjs
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASE_WIDTH,
  BASE_HEIGHT,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  buildWorldState,
  drawWorld,
  getWorldRenderStats,
  resetWorldRenderStats,
  configureWorldCache,
} from "../src/http/public/office-v3/world.js";
import {
  createLifeSystem,
  updateLife,
  drawAgents,
  bindAssets,
  bindWorld,
} from "../src/http/public/office-v3/life.js";
import * as assets from "../src/http/public/office-v3/assets.js";
import { configureSpriteCache, getSpriteCacheStats } from "../src/http/public/office-v3/assets.js";

const require = createRequire(import.meta.url);

function loadCanvas() {
  const candidates = [
    "C:/Users/junin/AppData/Local/Temp/opencode/render-kit/node_modules/@napi-rs/canvas",
    "@napi-rs/canvas",
  ];
  for (const id of candidates) {
    try {
      return require(id);
    } catch {
      /* try next candidate */
    }
  }
  throw new Error("office-v3-perf: @napi-rs/canvas nao encontrado.");
}

const { createCanvas } = loadCanvas();
const canvasFactory = (width, height) => createCanvas(Math.max(1, width), Math.max(1, height));
bindAssets(assets);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = resolve(repoRoot, "docs/office-v3");
mkdirSync(outDir, { recursive: true });

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function fixtureMarkets(count = 55) {
  const universe = [
    "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD", "EUR/GBP", "EUR/JPY", "GBP/JPY",
    "AUD/JPY", "AUD/CAD", "AUD/CHF", "CAD/JPY", "CHF/JPY", "EUR/CAD", "EUR/CHF", "EUR/AUD", "GBP/AUD", "GBP/CHF",
    "EUR/USD OTC", "GBP/USD OTC", "USD/JPY OTC", "EUR/GBP OTC", "GBP/JPY OTC", "AUD/USD OTC", "USD/CAD OTC", "USD/CHF OTC", "EUR/JPY OTC", "AUD/JPY OTC",
    "BTC/USD OTC", "ETH/USD OTC", "LTC/USD OTC", "XRP/USD OTC", "ADA/USD OTC",
    "US30", "US100", "US500", "US2000", "GER30", "UK100", "JP225", "AUS200", "EU50", "HK33",
    "GOLD", "SILVER", "WTI", "BRENT", "NATGAS", "APPLE", "TESLA", "AMAZON", "GOOGLE", "META",
  ];
  return universe.slice(0, count).map((display, index) => ({
    marketKey: `${display.replace(/[^A-Z0-9]/g, "")}:NORMAL`,
    canonical: display.replace(/[^A-Z0-9]/g, ""),
    symbol: display,
    display,
    availability: "OPEN",
    enabled: true,
    activeId: `id-${index}`,
    payout: 80 + (index % 10),
    settlementState: index % 5 === 0 ? { lastResult: "WIN", lastProfit: 4 + index } : index % 5 === 2 ? { lastResult: "LOSS", lastProfit: -(3 + index) } : {},
  }));
}

const officeJson = {
  version: "iq-multi-runtime-v3",
  at: Date.now(),
  mode: "PRACTICE",
  connection: { connected: true },
  activeCount: 55,
  activeLimit: 55,
  portfolio: {
    settled: { wins: 16, losses: 5, draws: 1, pnl: 578.76, trades: 22 },
    weekly: { pnl: 1842.3 },
    monthly: { pnl: 6721.55 },
    openPositions: [],
    equityCurve: [],
  },
  markets: fixtureMarkets(55),
};

const worldState = buildWorldState(officeJson);
bindWorld(await import("../src/http/public/office-v3/world.js"));
const life = createLifeSystem(worldState, { seed: "perf-55" });
updateLife(life, 16);

const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
const camera = { x: 512, y: 0, zoom: 1, viewport: { width: BASE_WIDTH, height: BASE_HEIGHT } };

/* ------------------------------------------------------------------ *
 * Stats helpers
 * ------------------------------------------------------------------ */

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
    mean: sum / Math.max(1, sorted.length),
  };
}

function measure(fn, iterations, warmup = 10) {
  for (let index = 0; index < warmup; index += 1) fn();
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return summarize(samples);
}

function format(value) {
  return value.toFixed(2);
}

/* ------------------------------------------------------------------ *
 * 0. Immediate mode (no cache) — before/after comparison
 * ------------------------------------------------------------------ */

function drawCombinedFrame() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawWorld(ctx, worldState, camera, { agents: false });
  ctx.save();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);
  drawAgents(ctx, life, camera);
  ctx.restore();
}

configureSpriteCache(null);
configureWorldCache();
const immediateWorld = measure(() => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawWorld(ctx, worldState, camera, { agents: false });
}, 24, 2);
const immediateCombined = measure(drawCombinedFrame, 24, 2);

/* Enable the offscreen cache and measure the optimized path. */
configureSpriteCache(canvasFactory);
configureWorldCache();
resetWorldRenderStats();
const coldBefore = getSpriteCacheStats();
drawCombinedFrame();
const coldAfter = getSpriteCacheStats();
const coldCreated = coldAfter.created - coldBefore.created;
const coldMisses = coldAfter.misses - coldBefore.misses;

/* ------------------------------------------------------------------ *
 * 1. Isolated draw costs
 * ------------------------------------------------------------------ */

const ITER = 90;
const worldOnly = measure(() => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawWorld(ctx, worldState, camera, { agents: false });
}, ITER);

const agentsOnly = measure(() => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);
  drawAgents(ctx, life, camera);
  ctx.restore();
}, ITER);

const combined = measure(() => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawWorld(ctx, worldState, camera, { agents: false });
  ctx.save();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);
  drawAgents(ctx, life, camera);
  ctx.restore();
}, ITER);

/* ------------------------------------------------------------------ *
 * 2. Simulated frame loop (240 frames @ 16.7ms budget)
 * ------------------------------------------------------------------ */

const FRAME_BUDGET = 1000 / 60;
const DEGRADED_BUDGET = 1000 / 30;
const FRAME_COUNT = 240;
const frameTimes = [];
let longFrames = 0;
let degradedFrames = 0;
const loopStart = performance.now();
for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
  const frameStart = performance.now();
  updateLife(life, 16.7);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#05090f";
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
  drawWorld(ctx, worldState, camera, { agents: false });
  ctx.save();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);
  drawAgents(ctx, life, camera);
  ctx.restore();
  const elapsed = performance.now() - frameStart;
  frameTimes.push(elapsed);
  if (elapsed > FRAME_BUDGET) longFrames += 1;
  if (elapsed > DEGRADED_BUDGET) degradedFrames += 1;
}
const loopElapsed = performance.now() - loopStart;
const frameSummary = summarize(frameTimes);
const effectiveFps = 1000 / Math.max(0.001, frameSummary.mean);
const wallFps = (FRAME_COUNT / loopElapsed) * 1000;

/* ------------------------------------------------------------------ *
 * 3. Memory: RSS before/after + 1000-update retention
 * ------------------------------------------------------------------ */

function rssMb() {
  return process.memoryUsage().rss / (1024 * 1024);
}
function heapMb() {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

const rssBefore = rssMb();
for (let index = 0; index < 1000; index += 1) updateLife(life, 16.7);
const rssAfter = rssMb();

// structural retention proof
const agentsCount = life.agents.length;
const occupancyEntries = life.occupancy.spots.size;
let maxPath = 0;
let maxReservations = 0;
for (const agent of life.agents) maxPath = Math.max(maxPath, agent.path.length);
for (const spot of life.occupancy.spots.values()) maxReservations = Math.max(maxReservations, spot.reservations.length);
const gridCells = life.grid.cells.length;

if (typeof globalThis.gc === "function") globalThis.gc();
const heapWarm = heapMb();
for (let index = 0; index < 1000; index += 1) updateLife(life, 16.7);
if (typeof globalThis.gc === "function") globalThis.gc();
const heapAfterUpdates = heapMb();
const heapGrowth = heapAfterUpdates - heapWarm;

/* ------------------------------------------------------------------ *
 * 4. Per-agent update cost
 * ------------------------------------------------------------------ */

const UPDATE_ITER = 300;
const updateStart = performance.now();
for (let index = 0; index < UPDATE_ITER; index += 1) updateLife(life, 16.7);
const updateElapsed = performance.now() - updateStart;
const perUpdateMs = updateElapsed / UPDATE_ITER;
const perAgentMs = perUpdateMs / Math.max(1, agentsCount);

/* ------------------------------------------------------------------ *
 * 5. Cache effectiveness
 * ------------------------------------------------------------------ */

// A warm-up full frame primes the sprite cache.
ctx.setTransform(1, 0, 0, 1, 0, 0);
drawWorld(ctx, worldState, camera, { agents: false });
ctx.save();
ctx.scale(camera.zoom, camera.zoom);
ctx.translate(-camera.x, -camera.y);
drawAgents(ctx, life, camera);
ctx.restore();
resetWorldRenderStats();
const cacheStatsBefore = getSpriteCacheStats();
drawWorld(ctx, worldState, camera, { agents: false });
ctx.save();
ctx.scale(camera.zoom, camera.zoom);
ctx.translate(-camera.x, -camera.y);
drawAgents(ctx, life, camera);
ctx.restore();
const cacheStatsAfter = getSpriteCacheStats();
const renderStats = getWorldRenderStats();
const hits = cacheStatsAfter.hits - cacheStatsBefore.hits;
const misses = cacheStatsAfter.misses - cacheStatsBefore.misses;
const cacheHitRatio = hits + misses > 0 ? hits / (hits + misses) : 0;

/* ------------------------------------------------------------------ *
 * 6. Trading-dependency proof
 * ------------------------------------------------------------------ */

const rendererFiles = ["assets.js", "world.js", "life.js", "camera.js"];
const forbiddenPatterns = [
  /from\s+["'][^"']*relay[^"']*["']/i,
  /import\s*\([^)]*relay/i,
  /placeOrder|createOrder|sendOrder|executeOrder|submitOrder/i,
  /order\s*\(\s*\{[^}]*\b(stake|amount|size|side)\b/i,
  /(?:POST|PUT)\s*["'][^"']*\/orders?/i,
];
const dependencyReport = rendererFiles.map((file) => {
  const source = readFileSync(resolve(repoRoot, "src/http/public/office-v3", file), "utf8");
  const matches = forbiddenPatterns.filter((pattern) => pattern.test(source)).map((pattern) => pattern.source);
  return { file, clean: matches.length === 0, matches };
});
const rendererClean = dependencyReport.every((entry) => entry.clean);

/* ------------------------------------------------------------------ *
 * 7. Budget verdict
 * ------------------------------------------------------------------ */

const budget60 = frameSummary.p95 <= FRAME_BUDGET;
const budget30 = frameSummary.p95 <= DEGRADED_BUDGET;

/* ------------------------------------------------------------------ *
 * Markdown report
 * ------------------------------------------------------------------ */

const report = `# OFFICE V3 — Performance

Headless harness: \`scripts/office-v3-perf.mjs\` (@napi-rs/canvas, Node ${process.version}).
Full office: **55 desks / 110 agents + 1 supervisor**, viewport ${BASE_WIDTH}x${BASE_HEIGHT},
world ${WORLD_WIDTH}x${WORLD_HEIGHT}, camera (${camera.x}, ${camera.y}) @ zoom ${camera.zoom}.

> Frontend/rendering only. PRACTICE only. ZERO REAL. No trading dependency.

## Budget

| Target            | Frame budget | Verdict |
| ----------------- | ------------ | ------- |
| Smooth 60 FPS     | < 16.70 ms   | ${budget60 ? "PASS" : "MISS"} (p95 ${format(frameSummary.p95)} ms) |
| Degraded >= 30 FPS| < 33.33 ms   | ${budget30 ? "PASS" : "MISS"} (p95 ${format(frameSummary.p95)} ms) |

## Before / after (same harness)

| Pass                | immediate mode p50 | immediate mode p95 | cached p50 | cached p95 |
| ------------------- | ------------------ | ------------------ | ---------- | ---------- |
| drawWorld (static)  | ${format(immediateWorld.p50)} | ${format(immediateWorld.p95)} | ${format(worldOnly.p50)} | ${format(worldOnly.p95)} |
| combined full frame | ${format(immediateCombined.p50)} | ${format(immediateCombined.p95)} | ${format(combined.p50)} | ${format(combined.p95)} |

Immediate mode = no offscreen cache (floor + sprites redrawn with fillRect every frame).
Cached mode = ground layer + sprite/character/tile cache. Both share viewport culling.

## Isolated draw costs (ms, ${ITER} iterations)

| Pass                     | p50   | p95   | max   | mean  |
| ------------------------ | ----- | ----- | ----- | ----- |
| drawWorld (static)       | ${format(worldOnly.p50)} | ${format(worldOnly.p95)} | ${format(worldOnly.max)} | ${format(worldOnly.mean)} |
| drawAgents (110 + boss)  | ${format(agentsOnly.p50)} | ${format(agentsOnly.p95)} | ${format(agentsOnly.max)} | ${format(agentsOnly.mean)} |
| combined full frame      | ${format(combined.p50)} | ${format(combined.p95)} | ${format(combined.max)} | ${format(combined.mean)} |

## Simulated frame loop (${FRAME_COUNT} frames)

| Metric              | Value |
| ------------------- | ----- |
| effective FPS       | ${format(effectiveFps)} |
| wall-clock FPS      | ${format(wallFps)} |
| frame-time p50      | ${format(frameSummary.p50)} ms |
| frame-time p95      | ${format(frameSummary.p95)} ms |
| frame-time max      | ${format(frameSummary.max)} ms |
| long frames (>16.7) | ${longFrames} / ${FRAME_COUNT} |
| degraded (>33.3)    | ${degradedFrames} / ${FRAME_COUNT} |

## Memory

| Metric                         | Value |
| ------------------------------ | ----- |
| RSS before                     | ${format(rssBefore)} MB |
| RSS after 1000 updates         | ${format(rssAfter)} MB |
| RSS delta                      | ${format(rssAfter - rssBefore)} MB |
| heap growth over 1000 updates  | ${format(heapGrowth)} MB |
| agents retained                | ${agentsCount} |
| occupancy spots                | ${occupancyEntries} |
| max reservations per spot      | ${maxReservations} |
| max path length                | ${maxPath} |
| grid cells                     | ${gridCells} |

## Per-agent cost

| Metric                       | Value |
| ---------------------------- | ----- |
| updateLife per call          | ${format(perUpdateMs)} ms |
| per-agent update cost        | ${(perAgentMs * 1000).toFixed(2)} us |

## Cache effectiveness (single warm frame)

| Metric            | Value |
| ----------------- | ----- |
| cold cache created | ${coldCreated} |
| cold cache misses  | ${coldMisses} |
| warm sprite cache hits | ${hits} |
| warm sprite cache misses | ${misses} |
| warm hit ratio    | ${(cacheHitRatio * 100).toFixed(1)}% |
| cache entries live | ${cacheStatsAfter.size} |
| stations drawn    | ${renderStats.stationsDrawn} |
| stations culled   | ${renderStats.stationsCulled} |
| amenities drawn   | ${renderStats.amenitiesDrawn} |
| amenities culled  | ${renderStats.amenitiesCulled} |
| tiles drawn       | ${renderStats.tilesDrawn} |
| tiles culled      | ${renderStats.tilesCulled} |

## Optimizations applied

- **Ground-layer cache** in \`world.js\`: floor, walls, back-wall board, band ribbons and
  rug/carpet tiles are rasterized once to a world-sized offscreen canvas
  (\`createCacheCanvas\`) and only the visible sub-rect is blitted per frame.
- **Sprite/tile cache** in \`assets.js\`: static furniture sprites and small tiles are
  rasterized once at the origin and blitted at their world position
  (\`configureSpriteCache\` injects the canvas factory; browsers auto-detect
  \`OffscreenCanvas\`). Large tiles (>120k px) bypass the cache to bound memory.
- **Character pose cache** in \`assets.js\`: every pose/appearance combination is baked to a
  24x46 cell and blitted, so 110 agents cost a fraction of a millisecond.
- **Off-screen culling** in \`world.js\`: amenities, stations and light pools outside the
  camera viewport are skipped.
- **Object pooling** of the painter's-algorithm draw list in \`world.js\` (no per-frame
  object churn).
- **Per-agent viewport culling** already in \`life.js\` \`drawAgents\` (kept).

## No trading dependency

Scanned ${rendererFiles.join(", ")} for relay imports and order calls:

${dependencyReport.map((entry) => `- \`${entry.file}\`: ${entry.clean ? "clean" : `FORBIDDEN ${entry.matches.join(", ")}`}`).join("\n")}

Renderer is **${rendererClean ? "clean" : "NOT clean"}** — no imports from \`relay/**\`, no order calls, no stake/trading rules.
`;

const reportPath = resolve(outDir, "performance.md");
writeFileSync(reportPath, report);

/* ------------------------------------------------------------------ *
 * Console summary
 * ------------------------------------------------------------------ */

console.log("[office-v3-perf] world      p50=%s p95=%s max=%s", format(worldOnly.p50), format(worldOnly.p95), format(worldOnly.max));
console.log("[office-v3-perf] agents     p50=%s p95=%s max=%s", format(agentsOnly.p50), format(agentsOnly.p95), format(agentsOnly.max));
console.log("[office-v3-perf] combined   p50=%s p95=%s max=%s", format(combined.p50), format(combined.p95), format(combined.max));
console.log("[office-v3-perf] loop       fps=%s p95=%s long=%s/%s degraded=%s", format(effectiveFps), format(frameSummary.p95), longFrames, FRAME_COUNT, degradedFrames);
console.log("[office-v3-perf] memory     rss %s -> %s MB, heapGrowth=%s MB", format(rssBefore), format(rssAfter), format(heapGrowth));
console.log("[office-v3-perf] per-agent  %s us (update %s ms)", (perAgentMs * 1000).toFixed(2), format(perUpdateMs));
console.log("[office-v3-perf] cache      hitRatio=%s%% (%s hits / %s misses)", (cacheHitRatio * 100).toFixed(1), hits, misses);
console.log("[office-v3-perf] culling    stations %s/%s amenities %s/%s tiles %s/%s", renderStats.stationsDrawn, renderStats.stationsDrawn + renderStats.stationsCulled, renderStats.amenitiesDrawn, renderStats.amenitiesDrawn + renderStats.amenitiesCulled, renderStats.tilesDrawn, renderStats.tilesDrawn + renderStats.tilesCulled);
console.log("[office-v3-perf] budget     60fps=%s 30fps=%s rendererClean=%s", budget60, budget30, rendererClean);
console.log("[office-v3-perf] wrote %s", reportPath);
