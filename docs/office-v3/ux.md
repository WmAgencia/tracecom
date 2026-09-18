# OFFICE V3 — Dashboard UX + Market Detail

Frontend/UX only. New files live under `src/http/public/office-v3/`:

- `dashboard.js` — `mountDashboard(rootEl, officeJson)` + pure `buildDashboardModel(office)`.
- `market-detail.js` — `mountMarketDetail(rootEl, officeJson, marketKey)` + `closeMarketDetail()`.
- `styles-v3.css` — dependency-free design system (no fonts, no CDNs).

Data source is exclusively the real snapshot `GET /api/iq/office` (or the office JSON passed in).
Nothing is invented: absent fields render `—`, and missing detail fields add the explicit
`não disponível` hint.

## 1. Hierarchy decisions

1. **`RESULTADO DO DIA` is the dominant element.** It is the largest type on screen
   (`--tc-v3-text-hero`, fluid `clamp(52px, 9vw, 104px)`), centered, monospaced and tabular so the
   digits never jump. It is the real settled daily P&L (`portfolio.settled.pnl`) and is colored
   green/red/neutral by sign.
2. **Summary before detail.** Right below the hero comes a compact card grid:
   WIN, LOSS, DRAW, WR, Operações, Mercados (open/closed/total) and Estado do sistema
   (mode, broker automation, connection health, stake).
3. **Progressive disclosure.** Weekly/monthly results, best WIN/LOSS and active/limit counts are
   hidden behind a single `Detalhes do dia` toggle. The market desk list is collapsed by default
   and only expanded on demand.
4. **Advanced technical data lives only in the market detail panel**, never over the desks. The
   dashboard shows identity/status only; indicators, agents, JIT and settlement are one click away.

## 2. Typography and tokens

- Type scale: `--tc-v3-text-xs` (10) → `--tc-v3-text-sm` (12) → `--tc-v3-text-md` (14) →
  `--tc-v3-text-lg` (18) → `--tc-v3-text-xl` (26) → `--tc-v3-text-hero`.
- Space scale: `--tc-v3-space-1..8` (4 → 64px). Cards and sections only use these steps.
- Radius: `sm 6 / md 10 / lg 16 / pill`.
- Shadow: `shadow-1` (cards), `shadow-2` (detail), `shadow-hero` (amber glow).
- Color identity: dark navy surfaces, warm amber `--tc-v3-amber`, gold `--tc-v3-gold`,
  financial green `--tc-v3-positive` / red `--tc-v3-negative`.
- Light theme is opt-in via `[data-theme="light"]` and only remaps tokens (no layout forks).

## 3. Breakpoints (responsive)

| Breakpoint | Target  | Behavior                                                        |
| ---------- | ------- | --------------------------------------------------------------- |
| ≥ 1281px   | Desktop | Auto-fit card grid, roomy spacing (space-5/6).                  |
| ≤ 1280px   | Laptop  | Tighter spacing, min card width 140px.                          |
| ≤ 1024px   | Tablet  | System card stops spanning 2 columns; market list min 180px.    |
| ≤ 768px    | Tablet  | 2-column cards, stacked header.                                 |
| ≤ 480px    | Mobile  | 1-column cards and market list, rows stack, hero tracking tight.|

`prefers-reduced-motion` disables transitions/animations.

## 4. States

- **Loading** — `officeJson === null` → `data-state="loading"`, spinner in the title.
- **Empty** — no markets and no settled result → `data-state="empty"` with explicit copy.
- **Error** — `{ error }` (or unknown `marketKey`) → `data-state="error"` with the real message.
- **Ready** — `data-state="ready"` with the full panel set.
- **Chart empty** — when `portfolio.equityCurve` has fewer than 2 valid points, an explicit
  `Sem série de resultado disponível` placeholder replaces the SVG.

## 5. Micro-interactions

Cards lift on hover and settle on active; market rows highlight with amber; disclosure toggles
flip `aria-expanded` and the `+`/`−` glyph; the detail panel animates in and tabs switch with
`aria-selected`. All interactions are CSS-driven except the disclosure/tab/select wiring.

## 6. Accessibility

- `aria-expanded` on toggles, `role="tablist"`/`role="tab"`/`aria-selected` on detail tabs.
- `title` tooltips on metrics; `role="img"` + `aria-label` on the chart.
- Focus-visible outlines use `--tc-v3-focus`.

## 7. Intentionally deferred

- No routing/URL state: the panel is mounted by the host page, not by a router.
- No websocket wiring or polling loop inside these modules (host passes the snapshot).
- No broker/order controls, no stake editing, no mode switching — read-only presentation.
- No local persistence, theming switcher or i18n layer yet.
- No per-market historical sparkline (only the portfolio equity series is plotted).
