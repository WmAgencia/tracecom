# OFFICE V3 — INTEGRATION

`src/http/public/office-v3/office-v3.js` is the page shell that binds the frozen
V3 modules (assets / world / life / camera / dashboard / market-detail) into one
canvas. Rendering only — **PRACTICE, ZERO REAL, no orders, no execution, no stake.**

## How to open

```powershell
npm run serve          # dev:  http://127.0.0.1:8788
```

- Page: `http://127.0.0.1:8788/office-v3/office-v3.html`
- Snapshot: `GET /api/iq/office` (the **only** network call this module makes).
- `npm run build` copies `src/http/public` to `dist/` (Vercel serves `dist`), so the
  same URL path works in production: `/office-v3/office-v3.html`.
- Offline static preview (no API): `node serve-dist.cjs` → `http://127.0.0.1:8099/office-v3/office-v3.html`.
  `/api/*` returns 404 there, so the page renders the demo fixture and shows the error banner.
- Env: no new variables. `HOST` / `HTTP_PORT` (or `PORT`) are the existing server knobs.

## Module graph

```
office-v3.html
  └─ office-v3.js  (page shell / integration)
       ├─ assets.js        PALETTE_V3, drawTile/drawSprite/drawCharacter
       ├─ world.js         buildWorldState, drawWorld, hitTestStation, STATION_LAYOUT
       ├─ life.js          createLifeSystem, updateLife, drawAgents, getAgentStates, setPresence
       │                     └─ bindAssets(assets.js), bindWorld(world.js)
       ├─ camera.js        createCamera, updateCamera, zoomToDesk, handleWheel/Drag*/Click/Hover,
       │                     applyCamera, clampToBounds, bindWorld(world.js)
       ├─ dashboard.js     mountDashboard(side panel)  ── emits `tracecom:market-select`
       └─ market-detail.js mountMarketDetail / closeMarketDetail
```

Every import is dynamic and guarded: a missing module logs a warning and the page
keeps rendering with the fallback (world draws its static duo, simple detail panel).

## Data + render flow

1. `init()` → load modules → `createCamera()` (zoom 1, **no auto-FIT**).
2. `fetchOfficeJson()` → `GET /api/iq/office` (accept JSON, `cache: no-store`).
   - success → `buildWorldState(json)`, attach world to the camera (`setWorldState`,
     `hitTestStation`, `bounds = 0,0 → 2560,2048`), create/sync the life system,
     `mountDashboard(dashboardEl, json)`.
   - failure → demo fixture + red banner, then the poll keeps retrying.
3. Poll loop: base `2000 ms`, exponential backoff up to `30000 ms`, reset on success.
   A structural change of the market list rebuilds the life system; otherwise only
   `setPresence(station.id, station.active)` is applied, so agents are **not** teleported.
4. `renderFrame()` order on the single canvas: clear → `drawWorld(ctx, world, camera, { agents: !life })`
   → `applyCamera` → `drawAgents(ctx, life, camera)` → HUD zoom label.
5. `resize()` keeps the canvas at the window size (`imageSmoothingEnabled = false`).

## Event flow

| Source | Event | Reaction |
| --- | --- | --- |
| Canvas drag | `handleDragStart/Move/End` | pan (clamped to world bounds) |
| Canvas wheel | `handleWheel` | zoom at pointer, clamped `[0.25, 4]` |
| Canvas click on a desk | `handleClick` → `world.hitTestStation` | `zoomToDesk(station)` + `mountMarketDetail` |
| Dashboard market row | `tracecom:market-select` (`{ detail: { marketKey } }`) | `selectMarket` → `zoomToDesk` + `mountMarketDetail` |
| Dashboard fallback | `globalThis.__tracecomSelectMarket(key)` | same as above |
| `Escape` / detail close | — | `closeMarketDetail()` |

A click is suppressed after a drag (> 4 px) so panning never opens a panel.

## Failure behavior

- `GET /api/iq/office` down → error banner + demo snapshot, canvas keeps animating.
- Any module missing → warning + fallback; `world.js` missing → status screen, no throw.
- `drawWorld` / `drawAgents` errors are caught per-frame and never break the loop.

## Rollback

`src/http/public/office-v2.js` (and `office-v2.html`) are **untouched**. The V3 page
is additive under `office-v3/` and references no v2 file, so reverting is simply not
linking to `office-v3.html`.

## Tests + screenshots

- `npx vitest run tests/ai/office-v3-scenarios.test.ts` — presence scenarios
  (55/37/10/0 OPEN, reopen), non-blank renders, single GET `/api/iq/office`, no order endpoint.
- `npx vitest run tests/ai/office-v3-assets-world.test.ts tests/ai/office-v3-life-camera.test.ts tests/ai/office-v3-dashboard.test.ts`
- `npx vitest run tests/ai/office-v2.test.ts` — must stay 22 (rollback guard).
- `node scripts/render-office-v3.mjs` — writes `docs/office-v3/screenshots/`
  (`implementation-v3`, `contact-sheet-v3`, `overview-v3`, `zoom-desk-v3`,
  `scenario-{55,37,10,0}open`, `viewport-{desktop,laptop,tablet,mobile}`).
