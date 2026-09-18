# OFFICE V3 — Visual Gauntlet (adversarial review)

Seven independent critic passes over the current implementation, each finding in
`REGION | PROBLEM | CAUSE | FIX | SEVERITY | STATUS`. Findings are adversarial:
every confirmed **HIGH/CRITICAL** issue was fixed in `assets.js` / `world.js` /
`life.js` / `camera.js`, with one regression test per fix. The legacy similarity
metric is deliberately out of scope — the goal is real perceptual improvement.

- Before: `docs/office-v3/screenshots/critic-input.png`
- After: `docs/office-v3/screenshots/critic-after.png`
- Renderer: throwaway `render-office-v3-tmp.mjs` (temp dir) calling `drawWorld` +
  `drawAgents` directly; the repo's `render-office-v3.mjs` was left untouched (owned by V3-D).
- Fixture: 55 desks (49 open), life agents enabled, camera (512, 0) @ zoom 1, 1536x1024.

---

## 1. ART DIRECTOR — composition, focal point, colour harmony, identity

| REGION | PROBLEM | CAUSE | FIX | SEVERITY | STATUS |
| --- | --- | --- | --- | --- | --- |
| Whole office | 110 agents look like clones; identity is lost | `life.drawAgents` never passed a per-agent seed/id to `drawCharacter`, so every agent hashed the literal `"agent"` | pass `id`/`seed` per entity in `life.js` | HIGH | FIXED |
| Supervisor | The supervisor is indistinguishable from a trader | `characterSpec` treated every non-critic role as `traderNavy` | give `role === "supervisor"` the amber `screenWarn` shirt + `goldDark` shirt2 | HIGH | FIXED |
| Desks (all bands) | 55 identical brown crates; the eye has nowhere to rest | single desk sprite, no band tinting | documented (would need band accent tokens; out of the four-file fix set) | MEDIUM | DOCUMENTED |
| Lounge (top-left) | Sparse, low focal pull; armchair reads as a blob | 3 objects on a 430x150 rug | documented | MEDIUM | DOCUMENTED |
| Board (top) | Dominant focal point is strong and correct | large scale-8 PnL on a bordered panel | keep | — | OK |
| Palette | Warm amber vs cool navy reads as one coherent identity | shared `PALETTE_V3` | keep | — | OK |

## 2. PIXEL ART CRITIC — edges, palette, dithering, silhouette, gradients

| REGION | PROBLEM | CAUSE | FIX | SEVERITY | STATUS |
| --- | --- | --- | --- | --- | --- |
| Desk front | Large flat face; drawer seams nearly invisible | seams at `rgba(0,0,0,0.32)` on `woodDark` | documented (detail pass, not a correctness bug) | MEDIUM | DOCUMENTED |
| Agents (walk) | No leg/arm phase change → static mannequins | `drawCharacter` ignored `frame` | 4-frame walk cycle (legs + arms) in `assets.js` | HIGH | FIXED |
| Global map panel | Six blue rectangles read as placeholders | `blob()` uses hard rectangles | documented | LOW | DOCUMENTED |
| Light pools | Only permitted smooth gradients; edges elsewhere are hard | all sprites use `fillRect`/`fillPoly` | keep | — | OK |
| Silhouettes | Desks/chairs/plants read at 1:1 | consistent 1px highlights/shadows | keep | — | OK |

## 3. UX CRITIC — hierarchy, legibility, overload, states

| REGION | PROBLEM | CAUSE | FIX | SEVERITY | STATUS |
| --- | --- | --- | --- | --- | --- |
| Board chart | An invented curve was labelled **“EQUITY · TEMPO REAL”** — fabricated data presented as real | hard-coded `points` array in `drawDailyBoard` | plot the real `portfolio.equityCurve`; when <2 valid points show **“SEM SÉRIE DE RESULTADO”** and relabel `EQUITY · SEM DADOS` | HIGH | FIXED |
| Global panel | Subtitle **“OPORTUNIDADES EM TEMPO REAL”** is an unbacked claim | static copy | relabel **“MAPA AGREGADO · DADOS REAIS”**; lighten to `#8fb4e0` | HIGH | FIXED |
| Markets box | `TOTAL` count coloured red (loss semantics) | `PALETTE_V3.red` literal | neutral `metalHi` | MEDIUM | FIXED |
| Board metrics | Labels low contrast / missing accents | `metal` on `#0b1728`; ASCII-only copy | keep `metal` (6.30:1); use `OPERAÇÕES`/`LÍQUIDO`/`LÍQUIDA` (font maps accents) | LOW | FIXED |
| Whole page | Hierarchy is clear: PnL hero → summaries → panels → desks | single dominant element | keep | — | OK |

## 4. ISOMETRIC / DEPTH CRITIC — perspective, painter order, shadows, scale

| REGION | PROBLEM | CAUSE | FIX | SEVERITY | STATUS |
| --- | --- | --- | --- | --- | --- |
| Desks | Agents always paint over the desk (no occlusion) | the page draws the whole world, then `drawAgents` on top; seats sit at the desk front | documented (fixing needs interleaved agent/desk layers; architectural, touches V3-D's shell) | MEDIUM | DOCUMENTED |
| Computer tower | Tower floats above the desk top-left, reads as a second monitor | `desk.y - 30` anchor | documented | LOW | DOCUMENTED |
| Cast shadows | Uniform downward-right, coherent with the top-down camera | shared `drawCastShadow` | keep | — | OK |
| Scale | Desks, agents and furniture share one pixel scale | fixed desk/agent dimensions | keep | — | OK |
| Painter order | Amenities + stations sorted by `sortY` then `sortX`; correct | pooled sort list | keep | — | OK |

## 5. ANIMATION CRITIC — pose, walk cycle, sit/work, supervisor, no teleport

| REGION | PROBLEM | CAUSE | FIX | SEVERITY | STATUS |
| --- | --- | --- | --- | --- | --- |
| Walking agents | Walk cycle never changes; agents moonwalk sideways | `drawCharacter` ignored `frame` **and** `facing` | 4-frame leg/arm cycle + horizontal mirror from `facing` | CRITICAL | FIXED |
| Seated traders | “work” pose is frozen | seated arms static | 2-frame typing bob (`type` arm mode) | HIGH | FIXED |
| Agents (identity) | All walkers are visually identical | no per-agent seed passed (see §1) | per-agent `id`/`seed` in `life.drawAgents` | HIGH | FIXED |
| Supervisor | Patrols and observes correctly, no teleport | `findTilePath` + staged FSM | keep | — | OK |
| Desk return | Reopening a desk walks back along A*; no teleport (covered by tests) | `planDesk` → `walkTo` | keep | — | OK |

## 6. PERFORMANCE CRITIC — hot spots, overdraw, cache misses

| REGION | PROBLEM | CAUSE | FIX | SEVERITY | STATUS |
| --- | --- | --- | --- | --- | --- |
| Whole world | `drawWorld` p50 **70.8 ms** (immediate mode) → ~14 FPS | whole 2560x2048 floor redrawn every frame (~22.5k `fillRect`) + every sprite re-issued | world-sized ground layer + visible sub-rect blit | CRITICAL | FIXED |
| Sprites/agents | Desks, furniture and 110 characters re-drawn from primitives | no raster cache | origin-rasterized sprite/tile/character cache (`configureSpriteCache`) | HIGH | FIXED |
| Off-screen content | Off-camera amenities/stations/pools still drawn | no viewport test | viewport culling with generous margins | HIGH | FIXED |
| Draw list | Per-frame object + array churn | fresh `{sortY,…}` objects each frame | pooled drawable entries | MEDIUM | FIXED |
| Result | combined p50 **4.05 ms**, p95 **7.29 ms**, 225 FPS, 0/240 long frames | — | see `docs/office-v3/performance.md` | — | OK |

## 7. ACCESSIBILITY CRITIC — contrast, colour-blind, focus, keyboard, aria, motion

| REGION | PROBLEM | CAUSE | FIX | SEVERITY | STATUS |
| --- | --- | --- | --- | --- | --- |
| Desk plaques | Plate/ink contrast **2.90:1** (fails AA) | dark ink `#2c1806` on `woodMid #8a5a34` | lighter plate `#c99a63` → **6.68:1** | HIGH | FIXED |
| Win/Loss colour | Reliance on red/green | colour-only status | already has `+R$`/`−R$` signs and `GANHO/PERDA` words → not colour-only | MEDIUM | DOCUMENTED |
| Red small text | `#e04b3a` on `#0b1728` = **4.49:1** (borderline) | palette red | documented | LOW | DOCUMENTED |
| Canvas | No `role`, `aria-label`, `tabindex` or keyboard pan/zoom | `office-v3.html` / `office-v3.js` (owned by V3-D) | document: add `role="img"`, `aria-label`, `tabindex="0"`, arrow/± key handlers | HIGH | DOCUMENTED |
| Detail close | `×` is a clickable `<span>` (no keyboard, no role) | `office-v3.html` (V3-D) | document: use `<button aria-label="Fechar">` | MEDIUM | DOCUMENTED |
| Reduced motion | Canvas walk cycle ignores `prefers-reduced-motion` | `office-v3.js` (V3-D) | document: gate `frame`/`updateLife` cadence on the media query | MEDIUM | DOCUMENTED |
| Dashboard | `aria-expanded`, `role="img"`, `:focus-visible`, `prefers-reduced-motion` already present | `dashboard.js` / `styles-v3.css` | keep | — | OK |

---

## Fixes applied (code map)

| # | Finding | File | Regression test |
| --- | --- | --- | --- |
| 1 | Walk cycle + facing ignored (CRITICAL) | `assets.js` `drawLegs`/`drawArms`/`drawStanding`/`renderCharacterBody` | `office-v3-visual-gauntlet.test.ts` walk + facing |
| 2 | Seated “work” frozen (HIGH) | `assets.js` `drawSeated` + `type` arm mode | seated typing test |
| 3 | 110 agent clones (HIGH) | `life.js` `drawAgents` | 111 unique ids test |
| 4 | Supervisor identity (HIGH) | `assets.js` `characterSpec` | supervisor shirt test |
| 5 | Fabricated “realtime” equity (HIGH) | `world.js` `dailyBoardModel` + `drawDailyBoard` | equity series + source-scan tests |
| 6 | Unbacked “oportunidades em tempo real” (HIGH) | `world.js` `drawGlobalPanel` | source-scan test |
| 7 | Plaque contrast 2.90:1 (HIGH) | `assets.js` `spriteWoodDesk` | AA contrast test |
| 8 | `TOTAL` red + accent labels (MEDIUM/LOW) | `world.js` | accent coverage test |
| 9 | Frame cost 70.8 ms (CRITICAL) | `world.js` ground layer/culling/pooling + `assets.js` cache | `office-v3-perf.test.ts` |

## Documented only (not editable in this pass)

- Canvas semantics, keyboard navigation and reduced-motion live in `office-v3.html` /
  `office-v3.js`, which are owned by another agent (V3-D). Exact fixes are listed in §7.
- Agent/desk occlusion needs an interleaved layer; it touches the page shell.
- `styles-v3.css` already ships `:focus-visible` and `prefers-reduced-motion`; not touched.

## Re-render

`docs/office-v3/screenshots/critic-after.png` is produced from the fixed code
(55 desks, life agents). The `EQUITY · SEM DADOS` state is shown honestly because the
fixture carries an empty `portfolio.equityCurve`; real snapshots with a series render
`EQUITY · SÉRIE REAL` from the measured points only.
