## Professional TRACE_1M research wave (2026-09-11)

| item | iter | verdict | evidence | next action |
| --- | --- | --- | --- | --- |
| Trader/quant contract | 2 | PASS | `src/research/professional-1m.ts` creates point-in-time OHLC context, A-E phase contract and signature statistics | Integrate only after provider preflight passes |
| Causal target | 2 | PASS | Entry is candle-close time; expiry is exactly +60s; WIN requires positive return after cost | Preserve economic dead-zone |
| News/macro audit | 1 | FAIL_PROVIDER | Forex has no historical point-in-time news or official release archive; crypto news is now disabled for Forex and invalid dates are rejected | Add versioned FX as-of provider |
| Microstructure audit | 1 | FAIL_PROVIDER | Yahoo/IQ historical data has no spread/ticks/L1 sizes/L2; fields are `NOT_AVAILABLE` | Collect append-only quotes prospectively |
| 3,600 experiment | 1 | BLOCKED | `diagnostic-results/professional-1m/status.md` records 0 evaluated instead of fabricating mandatory context | Start Phase A only after data contract is satisfied |

## TRACE_1M repository and extension wave (2026-09-11)

| item | iter | verdict | evidence | next action |
| --- | --- | --- | --- | --- |
| GitHub research | 1 | PASS | `research/github-quant-research.md` audits eight relevant repositories with license and leakage boundaries | Revisit provider choices only with verified quote/tick access |
| TRACE_1M contract | 1 | PASS | Active research is 60 seconds; extension fixes backend calls, shadow records and expiry to `1m` / one candle | Keep older artifacts historical only |
| Gate and leakage | 1 | PASS | Production 70 gate remains fail-closed; current 1m Yahoo holdout has negative EV | WAIT until genuinely sufficient OOS evidence exists |
| Extension usability | 1 | PASS | v0.3.0 shows asset, 1 MIN, decision, calibrated confidence and WAIT countdown reset | Browser E2E on live chart is external |
| Release gates | 1 | PASS | typecheck, full 496-pass suite, extension checks, build and ZIP passed; independent agents unavailable due quota | Commit, push, publish asset and read back |

# TRACECON — Gauntlet Ledger

**Modo**: autônomo
**Fronteira**: 6h de sessão; máximo 4 iterações por parte
**Gate humano**: deploys, schema changes, payment
**Barra**: código auditado + features validadas contra evidência real

## Alvo
Entregar FASE 85 (Documento de Entrega) + FASE 0 (Auditoria) + correções via Gauntlet Loop.

## ✅ FIXED (4 rounds concluídos)

| ID | Round | Commit | Validado |
|---|---|---|---|
| P-AN | app/index.ts usava registry LEGADO → trocado para registryV2 | a190c1b | typecheck + 292 testes + smoke |
| P-AE | engine.ts:53 chamava smaFn() para campo ema | a190c1b | typecheck + 292 testes |
| P-R | OutcomeScheduler + idempotência + snapshots | 94fe794 | 304 testes + 11 P-R + smoke |
| P-T | Custos descontados em produção + gross/net/cost | b3a3127 | 314 testes + 10 P-T |

### P-R preservado — comportamento
- `pending` = horizonte não chegou
- `stalled` = scheduler tentou avaliar, dados indisponíveis
- `error` = erro operacional
- `hit/miss/flat` = resultados válidos para calibração
- Apenas `hit/miss/flat` entram em calibração

### P-T preservado — comportamento
- `grossReturnPct` salvo (bruto)
- `costPct = ROUND_TRIP_COST_PP` (0.3 PP)
- `returnPct` salvo (líquido = gross - cost)
- Custos aplicados em DecisionRecord E ShadowTrade

## ⚠️ Gaps abertos (rounds 1-4)

P-I a P-W, P-X a P-AM

## ROADMAP FOREX-FIRST (definido em 2026-09-10)

**Auditoria forex-first consolidada** (commit `297b2c9`):

| Round | Status | Próxima ação |
|---|---|---|
| **5. P-A CalibrationEngine** | ✅ FIXED em **`21e9199`** | Platt + Isotonic fallback + reliability diagram exposto via `/api/analytics/calibration/bins?symbol=X&timeframe=Y&regime=Z&days=N` + status enum (INSUFFICIENT_SAMPLE/PROVISIONAL/CALIBRATED/ROBUST) + separação por chave |
| 6. Forex Data Layer | ❌ aberto | Dukascopy + OANDA + Polygon |
| 7. CandlePatternEngine | ❌ aberto | engulfing, pin bar, hammer, doji |
| 8. MarketStructureEngine | ❌ aberto | BOS, CHoCH/MSS, liquidity sweep |
| 9. Volatility + Regime estendido | ❌ aberto | ATR%, spread%, regimes BREAKOUT/CHOPPY/NEWS_RISK |
| 10. MultiTimeframeEngine | ❌ aberto | M1+M5+M15+H1+H4 com conflict detection |
| 11. EvidenceEngine | ❌ aberto | `Evidence { code, value, direction, weight, source, ts, quality }` |
| 12. Forex Market Scanner | ❌ aberto | loop contínuo + ranking |
| 13. Probability + Platt | ❌ aberto | Platt Scaling A→B |
| 14. SignalEngine + Bankroll + PositionSizing | ❌ aberto | Signal entity + Kelly fracionado |
| 15. Execution Validator | ❌ aberto | 14 checks |
| 16-17. Downbar Redesign + Multi-tab | ❌ aberto | glassmorphism + tabContextId |
| 18. IQ Option Context Detection | ❌ aberto | payout, valor, direção |
| 19. Timed Entry | ❌ aberto | countdown separado + drift cancel |
| 20. Backtest + Walk-Forward + Anti-overfitting | ❌ aberto | bootstrap CI, deflated Sharpe |
| 21. SSE/WebSocket server-side | ❌ aberto | push real-time |
| 22. Watchdog + Recovery | ❌ aberto | HEALTHY/DEGRADED/PAUSED/ERROR |
| 23. Paper Trading 24h soak | ❌ aberto | rodar 24h + análise |

**Detalhes completos**: `docs/superpowers/deliverables/2026-09-10-FASE-FOREX-AUDITORIA-INICIAL.md`

**Estatísticas atuais**: 314 testes passando, 39 test files, typecheck limpo, build limpo.

**Status**: Aguardando gate humano para definir qual round abrir.
# Finalization Gauntlet (2026-09-11)

| item | iter | verdict | evidence | next action |
| --- | --- | --- | --- | --- |
| Local recovery | 1 | IN PROGRESS | 14 local commits and uncommitted Forex, macro, calibration, microstructure and CI work located | Resolve integration errors before merge |
| Functional gates | 1 | FAIL | Initial suite: 10 failing tests; TypeScript: 16 diagnostics | Fix implementation and type contracts |
| Safety and provenance | 1 | IN PROGRESS | Forex fallback implementation found producing synthetic prices | Remove any production synthetic fallback; unavailable must be explicit |
| Final integration | 0 | PENDING | Not yet reviewed by independent critic | Run full gates, inspect diff, then merge into clone |

## Finalization Gauntlet — 2026-09-11

| item | iter | verdict | evidence | next action |
| --- | --- | --- | --- | --- |
| Local recovery | 1 | PASS | 14 local commits plus all local modules consolidated in this working tree | Merge this branch into requested clone |
| Functional gates | 2 | PASS | `npm test`: 462 passed, 3 externally-live skipped; `npm run typecheck`: PASS; `npm run build`: PASS | Repeat after merge |
| Forex provenance | 2 | PASS | OANDA v20 requires server-only key + account id; `/api/forex/scan` returns 503 without them; fallback source now reports unavailable instead of generated market candles | Supply real OANDA practice credentials to enable live scan |
| Calibration safety | 2 | PASS | Null raw probabilities never enter calibration; isotonic groups tied inputs and clamps output away from false 0/1 certainty | Monitor OOS performance after live data exists |
| CI | 1 | PASS | GitHub workflow runs install, typecheck, tests and build on Node 20/22 | Push only with user authorization |
| Independent critics | 1 | BLOCKED | Both clean-context critic agents were unavailable due host usage limit | Self-audit completed against source, tests, typecheck, build and diff check |
| Dependency security | 1 | PASS | Vitest upgraded to 5.0.0; `npm audit --json` reports 0 total vulnerabilities | Keep Dependabot enabled and CI green |

## Finalization Gauntlet — lifecycle and operational safety wave (2026-09-11)

| item | iter | verdict | evidence | next action |
| --- | --- | --- | --- | --- |
| Macro provenance | 1 | PASS | Removed asset-ticker directional heuristic: an approximate schedule can only create a neutral risk gate, never a directional macro claim | Configure a verified economic-calendar feed before treating event dates as production-grade |
| Forex session clock | 1 | PASS | London, New York and Tokyo sessions now use IANA time zones via `Intl`, including DST; weekend phase is explicitly closed | Observe venue-specific holidays separately if a broker calendar is added |
| Multi-pair readiness ranking | 1 | PASS | Scanner returns spread, candle coverage, observed volatility/momentum/trend, session liquidity and a deterministic readiness rank; score is documented as non-predictive | Real scan needs OANDA server credentials |
| Bankroll guard | 1 | PASS | Fractional Kelly paper sizing requires calibrated probability and sample threshold; caps risk, daily loss and drawdown; blocks kill switch and concurrent positions | Persist account-level bankroll state before multi-user deployment |
| Paper signal lifecycle | 1 | PASS | Explicit `created -> scheduled -> countdown -> ready -> executed -> evaluated` state machine, expiry/invalidation/cancellation audit events, SQLite persistence and idempotent paper execution key | Run an extended real-data paper session once OANDA credentials are configured |
| Functional gates | 1 | PASS | `npm test`: 473 passed / 3 live integrations skipped; typecheck and build passed; `npm audit --json`: 0 vulnerabilities | No local blocker remains |
| HTTP smoke | 1 | PASS | Local server returned `health=true`, approved paper sizing, and persisted/listed a scheduled `EUR/USD` signal; server stopped cleanly | Credentials still required for live Forex scan |

## IQ Option-first Gauntlet wave (2026-09-11)

| item | iter | verdict | evidence | next action |
| --- | --- | --- | --- | --- |
| Protocol and security research | 1 | PASS | Independent review of public implementations: protocol is unofficial/mutable; adapter observes only normalized inbound `candle-generated` frames from an already-authenticated browser page | Live browser-session validation remains required |
| IQ Option provider | 1 | PASS | `IqOptionMarketProvider` implements the canonical V2 provider contract; it never authenticates, opens broker sessions or sends commands; it rejects invalid, duplicate and out-of-order frames | Feed remains unavailable until extension sees a supported page stream |
| OTC identity | 1 | PASS | `EURUSD` and `EURUSD-OTC` are different provider identities, preventing accidental reuse of Forex calibration | Add a separate OTC calibration dataset after live data accrues |
| Extension transport | 1 | PASS | MV3 bridge is restricted to IQ Option hosts and forwards only numeric inbound candle data; content/background validate origin/tab host and never read or persist session material | Install extension and open an authenticated IQ Option chart for live validation |
| Local ingest smoke | 1 | PASS | With `MARKET_DATA_MODE=iqoption`, POSTed normalized OTC fixture was accepted and reached `/api/market/candles` with `provider=iqoption` and browser-session provenance | Test against a real authenticated chart, not a fixture |
| Full gates | 1 | PASS | `npm test`: 476 passed / 3 live skipped; typecheck, build and `npm audit --json` pass | Commit after final diff review |

## Extension installability Gauntlet (2026-09-11)

| item | iter | verdict | evidence | next action |
| --- | --- | --- | --- | --- |
| MV3 popup and diagnostics | 2 | PASS | Popup exposes extension/backend/IQ/feed/symbol/timeframe status and open/test/downbar/diagnostic controls; background records only non-sensitive transport state | Validate in a browser once Chrome is exposed to this session |
| Least privilege and read-only boundary | 2 | PASS | Independent critic caught unused `scripting`; it was removed. Static test confirms no `<all_urls>` and the IQ bridge excludes cookies, storage, SSID, passwords and outbound WebSocket interception | Keep protocol allowlist narrow |
| Installable build | 2 | PASS | `npm run build:extension` regenerated `dist-extension` and validates MV3 JSON plus all script syntax | User loads unpacked folder in Chrome/Edge |
| Windows instructions | 2 | PASS | `INSTALL-TRACECON-EXTENSION.bat` builds, validates and opens the extensions page; README separates Chrome/Edge and now gives PowerShell and cmd commands | Run locally when browser is available |
| Independent critic | 2 | PASS | Critic found permission, documentation and PowerShell issues; all were corrected and revalidated by extension static checks | Browser E2E is blocked until Chrome is exposed to automation |
| Project gates | 2 | PASS | 476 passed / 3 skipped; typecheck, build, audit (0 vulnerabilities), `git diff --check`, extension static checks and provider ingest smoke pass | Commit local changes |

## Premium extension UI Gauntlet (2026-09-11)

| item | iter | verdict | evidence | next action |
| --- | --- | --- | --- | --- |
| Downbar visual language | 2 | PASS | Central floating liquid-glass island replaces the full-width toolbar; visual state uses restrained BUY/SELL/WAIT accents | Reload the unpacked extension in Chrome |
| Real-time clarity | 2 | PASS | Candle timestamp and timeframe now drive the visible countdown; no fabricated stake or countdown value is shown | Validate against a live IQ candle |
| Non-interference and accessibility | 2 | PASS | z-index reduced to 9999, width avoids side controls, responsive breakpoints added, and JS/CSS honor `prefers-reduced-motion` | Check at 80/100/125/150% zoom in Chrome |
| Popup coherence | 1 | PASS | Popup uses the same dark glass material, quiet status hierarchy and compact controls | Inspect in the installed extension popup |

## Final integration wave (2026-09-11)

| item | iter | verdict | evidence | next action |
| --- | --- | --- | --- | --- |
| Forex production path | 3 | PASS | Production Forex now requires OANDA credentials and uses the canonical adapter; no synthetic fallback; pip sizes corrected | Run live OANDA practice smoke with credentials |
| Provider/pipeline resilience | 2 | PASS | Pipeline marks started only after connect/backfill/subscribe succeed; failed starts can retry; OANDA emits normalized candles/ticks and reconnect status | Observe reconnect behavior against provider rate limits |
| Calibration and adaptive persistence | 3 | PASS | Empty OOS cannot certify calibration; historical evaluation window expanded; ensemble snapshots preserve multiple keys; retrain transition is read before upsert | Monitor calibration/drift with real sample volume |
| Costs and PnL | 3 | PASS | Costs are market-aware, round-trip breakdown is consistent, WAIT has no exposure cost, SELL and shadow returns are directionally signed | Add venue-specific fee overrides when broker terms are known |
| Intrabar outcome | 2 | PASS | Shadow stops use high/low when available, decision service forwards OHLC, and SELL outcome/return semantics are consistent | Validate ambiguous same-bar TP/SL ordering with tick data if available |
| SMC/ICT | 2 | PASS | Deterministic FVG, order block, BOS/CHoCH, displacement, liquidity pool and premium/discount analysis integrated into QuantEngine with tests | Expand multi-timeframe SMC evidence after live Forex history exists |
| Extension isolation/security | 3 | PASS | Symbol/timeframe filtering prevents cross-tab leakage; tab diagnostics clean on close; bridge preserves constructor semantics; API token configurable; ZIP generated in build | Browser E2E remains the only external validation gate |
| Final gates | 3 | PASS | npm test: 485 passed, 3 conditional live tests skipped; typecheck/build/extension checks pass; npm audit reports 0 vulnerabilities | No local code blocker found |

## Real shadow-validation and repository integration wave (2026-09-11)

| item | iter | verdict | evidence | next action |
| --- | --- | --- | --- | --- |
| Real historical shadow dataset | 1 | PASS | `npm run shadow-validation` fetched 882 closed candles-derived records from Binance public REST: 818 actionable, 818 evaluated, 0 synthetic, all `SHADOW_ONLY` | Re-run with OANDA credentials to obtain the requested Forex sample |
| No-lookahead contract | 1 | PASS | Causal momentum/volatility features use candles at or before analysis time; outcomes are resolved only at the five-candle expiry; report carries `noLookahead=true` and evaluation method | Add broker-specific spread snapshots when OANDA is enabled |
| Calibration report | 1 | PASS | JSON/Markdown report includes reliability bins, 80% Wilson intervals, Brier, ECE/MCE, slope/intercept, log loss, EV/net EV, profit factor, drawdown, streaks and grouped breakdowns | Treat Binance fallback metrics as crypto diagnostics, not Forex certification |
| Provider honesty | 1 | PASS | OANDA was attempted only when environment credentials exist; current run records `OANDA_API_KEY/OANDA_ACCOUNT_ID ausentes` and explicitly falls back to real Binance data | Configure OANDA practice credentials for Forex validation; no credentials were written to the repository |
| Upstream sync | 1 | PASS | Remote `origin/main` inspected at `d0a8a68`; local tree preserved all remote tracked files, added local improvements, and recorded remote as a merge parent without force overwrite | Push integrated `main` after final gates |
| Shadow artifacts | 1 | PASS | `diagnostic-results/shadow-validation-latest.json` and `.md` versioned; timestamped reruns ignored; report is reproducible through the npm script | Keep latest report refreshed after provider changes |
| GitHub publication gate | 2 | PASS_WITH_EXTERNAL_LIMIT | Published tree is live at `origin/main`; it contains the complete application, provider and reports. GitHub's OAuth scope restriction required omitting only `.github/workflows/ci.yml`; the workflow remains in local history for later publication after `workflow` authorization | Add the workflow in a later authenticated push |

## Forex provider, causal OOS and edge-audit wave (2026-09-11)

| item | iter | verdict | evidence | next action |
| --- | --- | --- | --- | --- |
| Real Forex provider | 2 | PASS | `YahooForexProvider` consumes public Yahoo Chart OHLC for EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, USD/CHF and NZD/USD; missing schema/quotes fail closed; no synthetic or Binance fallback | Prefer OANDA/MT5 when credentials or a running terminal are actually available |
| Provider auto-selection | 1 | PASS | `MARKET_DATA_MODE=auto` tries configured OANDA, then Yahoo Forex; `AutoForexProvider` only cycles Forex providers and throws `PROVIDER_UNAVAILABLE` when none respond | Add MT5 bridge only when a real terminal/API is detected |
| Causal walk-forward | 2 | PASS | 980 one-minute signals across a 7-day real Forex window; candidates globally sorted; calibration labels released only after future candle close; no-lookahead field and test added | Keep TEST B frozen for future model changes |
| Edge diagnosis | 1 | PASS | 49.87% win rate, BUY 50.92%, SELL 48.83%, net EV -0.087535; session/regime/symbol/threshold CSVs and loss analysis generated | Do not claim a trading edge; investigate with a longer multi-window sample |
| Threshold/ablation audit | 1 | PASS | TRAIN/TEST threshold sweep found no threshold with >=30 TEST samples; 0.55/0.60 had too-small TEST coverage and are marked `OVERFIT_RISK`; measured gates plus unavailable-feature rows are explicit | No threshold promotion to the extension |
| EV safety gate | 1 | PASS | Fusion calibration requires positive binary EV in addition to statistical actionability; extension forces negative/non-positive EV directional payloads to WAIT; paper bankroll already returns zero stake for non-positive Kelly | Keep risk state SHADOW_ONLY until stable positive net EV exists |
| Regression gates | 1 | PASS | 64 test files passed / 3 conditional live tests skipped; 488 tests passed; typecheck, build, extension static checks and npm audit (0 vulnerabilities) pass | Keep CI workflow pending scope authorization |

## Published Forex evidence snapshot (2026-09-11)

| item | iter | verdict | evidence | next action |
| --- | --- | --- | --- | --- |
| Remote artifact | 1 | PASS | `git ls-remote origin main` verified after publication; remote report and provider files read back successfully | Keep remote tree immutable until next evidence window |
| Forex sample | 1 | PASS | Yahoo Forex real OHLC, seven liquid pairs, 2026-09-04 to 2026-09-11, 1m horizon 5 candles; 980 total / 849 actionable / 849 evaluated | Collect another disjoint TEST B before model changes |
| Honest result | 1 | PASS | Win rate 46.61%; BUY 46.09%; SELL 47.10%; net EV -0.144160; realized return -0.090284; profit factor 0.3021; drawdown 0.090284 | Verdict: NO STATISTICAL EDGE FOUND in this window |
| Calibration | 1 | PASS | Brier 0.255573; ECE 0.060932; MCE 0.299568; 0.75–0.85 band n=15, 95% CI 0.2321–0.7086; 0.78–0.82 band n=5 | Do not interpret small high-probability bands as certification |
| Thresholds and ablation | 1 | PASS | No threshold reached the minimum 30 TEST samples; all candidate threshold rows are `OVERFIT_RISK`; TEST_B ablations remain negative net EV | Leave extension on EV/WAIT gate |

## Autonomous continuation wave (2026-09-11)

| item | iter | verdict | evidence | next action |
| --- | --- | --- | --- | --- |
| Forex OOS refresh | 1 | PASS | Fresh Yahoo Forex run: 980 total, 848 actionable, 848 evaluated, 0 unknown; win rate 51.94%, BUY 53.76% / SELL 50.26%, net EV -0.089360, Brier 0.264917, ECE 0.097947; seven liquid pairs, 1m signal and five-candle horizon | Keep capital state `NOT_READY_SHADOW_ONLY` |
| MTF causal context | 1 | PASS | 5m/15m/1h context is derived only from complete 1m buckets closed before each signal; the MTF confirmation ablation is present in `forex-feature-ablation.csv` and is diagnostic-only | Do not promote MTF weights without a disjoint OOS window |
| Data integrity | 1 | PASS | Yahoo 3m/4h requests aggregate only contiguous real source candles; gaps are discarded; multiplex provider events are isolated per symbol; pipeline regression test added | Preserve fail-closed behavior |
| Honest verdict | 1 | PASS | Report now records `NO STATISTICAL EDGE FOUND`, explicit reason, and `NOT_READY_SHADOW_ONLY`; no orders or capital execution | Improve model only after new evidence |
| Regression gates | 1 | PASS | 64 test files passed / 1 skipped; 490 tests passed / 3 skipped; typecheck, build, extension static checks and npm audit (0 vulnerabilities) pass | Re-run before each publication |
| item | iter | veredito | evidência | próxima ação |
| --- | --- | --- | --- | --- |
| Wave 1 — literatura/metodologia | 1 | PASS | `research/literature/trading-research.md`; fontes primárias e limites explícitos | manter catálogo de trials |
| Wave 2/3 — resolução de feed | 1 | PASS | Yahoo só entrega OHLC 1m; 30s/45s bloqueados pelo motor | integrar quote/tick provider antes de reabrir |
| Wave 4/9 — prequential 60–300s | 1 | PASS | `runPrequentialExperiment`, versões por trade, holdout congelado | executar testes e auditoria final |
| Wave 6 — adversarial leak barrier | 1 | PASS | labels liberados após expiry e embargo por par igual ao horizonte | preservar nas próximas estratégias |

## Vision Web pivot (2026-09-12)

| item | iter | verdict | evidence | next action |
| --- | --- | --- | --- | --- |
| Product boundary | 1 | PASS | `PRODUCT.md` and `docs/VISION-WEB-ARCHITECTURE.md` define screen-share-first analysis; existing `extension/` remains legacy | keep broker internals out of the Vision path |
| Vision UI | 1 | PASS | `/` now serves a screen-share workstation with crop selection, preview, Fable decision and evidence panels; legacy landing is preserved as `legacy-landing.html` | validate in Chrome with an authenticated IQ Option window |
| Crop privacy | 1 | PASS | `getDisplayMedia` is user initiated; browser canvas sends only the selected crop as compressed image data | verify crop visually at desktop/mobile sizes |
| Fable 5.1 backend | 1 | PASS | `FableTraderClient` calls the configured Anthropic-compatible gateway with server-only key; real smoke returned model `Fable 5.1` and safe `WAIT` for non-informative frames | validate with a real chart crop |
| Structured decision | 1 | PASS | response normalization validates BUY/SELL/WAIT, confidence, visual evidence and risk flags; invalid/missing evidence becomes WAIT | keep V1 prompt frozen during Run A |
| Regression gates | 1 | PASS | 546 tests passed / 3 skipped; typecheck, build, extension checks and web syntax passed; npm audit reports 0 vulnerabilities | perform manual browser screen-share gate |
| Browser E2E | 1 | BLOCKED_EXTERNAL | Chrome's native share picker requires the user to select the IQ Option window; no browser automation surface is available in this session | user selects the source window and crop once |

## Vision analysis and UI V2 (2026-09-12)

| item | iter | verdict | evidence | next action |
| --- | --- | --- | --- | --- |
| Temporal bundle | 1 | PASS | Vision Web keeps current, minus5s, minus10s and minus20s crops and sends up to four labeled frames | validate with a real moving chart |
| Local screen metrics | 1 | PASS | Crop pipeline computes luma, edge activity and frame difference without claiming broker prices | add structured provider features only when a real feed exists |
| Fable structured output | 1 | PASS | Fable 5.1 response now separates confidence, data quality, visual/quant bias, confluence, risk flags, summary and frames used | freeze FABLE_TRADER_V1 for Run A |
| PT-BR decision surface | 1 | PASS | Signal, metrics, controls, health state and analysis drawer are rendered in Portuguese | browser visual review at 1366x768 and 1920x1080 |
| Live placeholder state | 1 | PASS | Placeholder is hidden after stream connection; crop selection is the only empty state | verify with a real screen-share session |
| Full gates | 1 | PASS | 546 tests passed / 3 skipped; typecheck, build, extension checks and web syntax passed; Fable 4-frame smoke returned safe WAIT with `framesUsed=4` | complete manual Chrome share/crop gate |
