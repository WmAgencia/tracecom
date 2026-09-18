# OFFICE V3 — Performance

Headless harness: `scripts/office-v3-perf.mjs` (@napi-rs/canvas, Node v24.19.0).
Full office: **55 desks / 110 agents + 1 supervisor**, viewport 1536x1024,
world 2560x2048, camera (512, 0) @ zoom 1.

> Frontend/rendering only. PRACTICE only. ZERO REAL. No trading dependency.

## Budget

| Target            | Frame budget | Verdict |
| ----------------- | ------------ | ------- |
| Smooth 60 FPS     | < 16.70 ms   | PASS (p95 7.07 ms) |
| Degraded >= 30 FPS| < 33.33 ms   | PASS (p95 7.07 ms) |

## Before / after (same harness)

| Pass                | immediate mode p50 | immediate mode p95 | cached p50 | cached p95 |
| ------------------- | ------------------ | ------------------ | ---------- | ---------- |
| drawWorld (static)  | 70.81 | 85.11 | 4.21 | 6.39 |
| combined full frame | 72.53 | 91.35 | 4.05 | 7.29 |

Immediate mode = no offscreen cache (floor + sprites redrawn with fillRect every frame).
Cached mode = ground layer + sprite/character/tile cache. Both share viewport culling.

## Isolated draw costs (ms, 90 iterations)

| Pass                     | p50   | p95   | max   | mean  |
| ------------------------ | ----- | ----- | ----- | ----- |
| drawWorld (static)       | 4.21 | 6.39 | 9.75 | 4.60 |
| drawAgents (110 + boss)  | 0.24 | 0.50 | 1.15 | 0.29 |
| combined full frame      | 4.05 | 7.29 | 9.19 | 4.64 |

## Simulated frame loop (240 frames)

| Metric              | Value |
| ------------------- | ----- |
| effective FPS       | 225.26 |
| wall-clock FPS      | 225.08 |
| frame-time p50      | 3.86 ms |
| frame-time p95      | 7.07 ms |
| frame-time max      | 10.88 ms |
| long frames (>16.7) | 0 / 240 |
| degraded (>33.3)    | 0 / 240 |

## Memory

| Metric                         | Value |
| ------------------------------ | ----- |
| RSS before                     | 514.19 MB |
| RSS after 1000 updates         | 514.11 MB |
| RSS delta                      | -0.07 MB |
| heap growth over 1000 updates  | -0.00 MB |
| agents retained                | 110 |
| occupancy spots                | 14 |
| max reservations per spot      | 0 |
| max path length                | 0 |
| grid cells                     | 20480 |

## Per-agent cost

| Metric                       | Value |
| ---------------------------- | ----- |
| updateLife per call          | 0.01 ms |
| per-agent update cost        | 0.07 us |

## Cache effectiveness (single warm frame)

| Metric            | Value |
| ----------------- | ----- |
| cold cache created | 105 |
| cold cache misses  | 0 |
| warm sprite cache hits | 244 |
| warm sprite cache misses | 0 |
| warm hit ratio    | 100.0% |
| cache entries live | 201 |
| stations drawn    | 27 |
| stations culled   | 28 |
| amenities drawn   | 50 |
| amenities culled  | 45 |
| tiles drawn       | 0 |
| tiles culled      | 0 |

## Optimizations applied

- **Ground-layer cache** in `world.js`: floor, walls, back-wall board, band ribbons and
  rug/carpet tiles are rasterized once to a world-sized offscreen canvas
  (`createCacheCanvas`) and only the visible sub-rect is blitted per frame.
- **Sprite/tile cache** in `assets.js`: static furniture sprites and small tiles are
  rasterized once at the origin and blitted at their world position
  (`configureSpriteCache` injects the canvas factory; browsers auto-detect
  `OffscreenCanvas`). Large tiles (>120k px) bypass the cache to bound memory.
- **Character pose cache** in `assets.js`: every pose/appearance combination is baked to a
  24x46 cell and blitted, so 110 agents cost a fraction of a millisecond.
- **Off-screen culling** in `world.js`: amenities, stations and light pools outside the
  camera viewport are skipped.
- **Object pooling** of the painter's-algorithm draw list in `world.js` (no per-frame
  object churn).
- **Per-agent viewport culling** already in `life.js` `drawAgents` (kept).

## No trading dependency

Scanned assets.js, world.js, life.js, camera.js for relay imports and order calls:

- `assets.js`: clean
- `world.js`: clean
- `life.js`: clean
- `camera.js`: clean

Renderer is **clean** — no imports from `relay/**`, no order calls, no stake/trading rules.
