# TRACECON — AUDITORIA FOREX-FIRST COMPLETA

**Data**: 2026-09-10
**Modo**: autônomo + Gauntlet Loop
**Status do baseline**: 314 testes passando, typecheck limpo, build limpo, commit `b3a3127` (P-T FIXED)

---

## 1. CURRENT ARCHITECTURE — REAL

### 1.1 Stack técnica
| Camada | Tecnologia | Evidência |
|---|---|---|
| Runtime | Node 22+, TypeScript strict, ESM | `package.json` |
| Persistência | SQLite via `node:sqlite` nativo | `src/store/db.ts` |
| HTTP | Node http nativo (sem framework) | `src/http/api.ts` |
| WebSocket | `ws` package | `src/market/providers/binance/stream.ts` |
| AI | Anthropic Messages API (via nexxus-pro gateway) | `src/ai/anthropic.ts` |
| News | `cryptocurrency.cv` REST (keyless) | `src/context/provider.ts` |
| Frontend | HTML/CSS/JS puro | `src/http/public/` |
| Extensão | Chrome MV3 (downbar roxa) | `extension/` |
| Deploy | Vercel (serverless) + Railway (long-running) | `vercel.json` + `railway.json` |

### 1.2 Módulos atuais
- `src/market/` — Binance REST + WS + L2 book + ticks (cripro only). Sem Forex.
- `src/quant/` — 12 indicadores técnicos (SMA, EMA, RSI, MACD, ATR, BB, ADX, VWAP, momentum, ROC, volatility) + regime + structure + levels. **Sem candle patterns, sem BOS, sem CHoCH.**
- `src/backtest/` — Wilson CI + Agresti-Coull + similarity k-NN. **Sem walk-forward genuíno.**
- `src/fusion/` — 3 camadas (guards, confluence 15m/1h/4h, calibration adaptativa).
- `src/analytics/` — DecisionRecord + ShadowTrade + OutcomeScheduler (P-R FIXED) + costPct/netReturn (P-T FIXED).
- `src/context/` — News léxico (cryptocurrency.cv). **Sem ForexFactory, sem CPI/NFP/FOMC estruturados.**
- `src/ai/` — Só Anthropic. **Sem multi-key, sem fallback OpenAI, sem circuit breaker.**
- `src/tools/` — Tool registry com Zod.
- `src/store/` — 9 tabelas SQLite + 5 repositories.
- `extension/` — Manifest MV3, content.js, downbar.css. **Suporta TradingView, Binance, IQ Option (recém-adicionado), Exodus.**

### 1.3 Fluxo de dados atual
```
MarketPipeline (Binance REST/WS)
   ↓
QualityEngine (stale, gaps, NaN)
   ↓
MarketCandle[] (1m/15m/1h/4h)
   ↓
QuantEngine (12 indicadores)
   ↓
Backtester (similarity k-NN, Wilson CI)
   ↓
FusionService (3 camadas: guards/confluence/calibration)
   ↓
AnalyticsService (recordDecision + evaluatePending)
   ↓
OutcomeScheduler (tick 30s)
   ↓
SQLite (DecisionRecord + ShadowTrade)
   ↓
HTTP /api/analytics/* (Brier, ECE, drawdown)
```

### 1.4 Pontos robustos
- ✅ P-R (scheduler de outcomes): idempotência, snapshots provider/model, sem lookahead.
- ✅ P-T (custos): gross/net/cost separados, descontados em produção.
- ✅ Quality engine: stale, NaN, gaps detectados.
- ✅ 12 indicadores com testes.
- ✅ Binance real-time (REST + WS + L2).
- ✅ Vercel + Railway (flexibilidade deploy).

### 1.5 Pontos frágeis (sem Forex, sem SMC/ICT, sem multi-pair scanner, sem execution validator, sem kill switch)
- ❌ Forex: zero provider (dukascopy/oanda/polygon). Só Binance cripto.
- ❌ Candle patterns: zero. Só indicadores clássicos.
- ❌ MarketStructure: HH/HL/LH/LL existe, mas BOS/CHoCH/MSS/liquidity sweep não.
- ❌ Multi-pair scanner: só BTCUSDT/ETHUSDT hardcoded.
- ❌ Macro calendar: campo `macroBias` declarado mas nunca populado.
- ❌ Bankroll/PositionSizing: zero. Risco só tem drawdown diário.
- ❌ Kill switch: só daily drawdown, não tem global nem por consecutive losses.
- ❌ Execution validator: zero. `safety.hasProhibitedAction` declarado mas nunca chamado.
- ❌ AI multi-key/router: só Anthropic. Sem fallback OpenAI.
- ❌ SSE/WebSocket server-side: zero. Só polling HTTP.
- ❌ Multi-tab context isolation: content.js cria uma downbar por tab mas não tem brokerContextId.
- ❌ Candle Vision (analisar imagem do gráfico): zero.
- ❌ Watchdog com auto-recovery: zero.
- ❌ Reliability diagram exposto via API: zero (ECE é interno, bins não retornam).
- ❌ Platt Scaling: zero (probabilidade é frequencia empírica crua).
- ❌ InSUFFICIENT_SAMPLE / PROVISIONAL / CALIBRATED / ROBUST enum: zero.
- ❌ Backtest walk-forward genuíno: zero (single query com split fixo).
- ❌ Backtest com custos+slippage+spread+latência+news: zero.

### 1.6 Dívida técnica
- Catálogo de símbolos estático (7 ativos hardcoded).
- Macro bias é stub puro.
- `safety.hasProhibitedAction` é dead code.
- `fusion/risk.ts` (RiskEngine) órfão.
- Falta anti-overfitting controls (bootstrap, permutation, deflated Sharpe).
- Walk-forward inexistente — só single-query com OOS split.

---

## 2. COMPLETED ROUNDS

| ID | Round | Commit | Status |
|---|---|---|---|
| P-AN | app/index.ts usava registry LEGADO (forçava NoopProvider) | a190c1b | ✅ FIXED |
| P-AE | engine.ts:53 chamava smaFn() para campo ema | a190c1b | ✅ FIXED |
| P-R | OutcomeScheduler + idempotência + snapshots | 94fe794 | ✅ FIXED |
| P-T | Custos descontados em produção + gross/net separados | b3a3127 | ✅ FIXED |

---

## 3. REMAINING GAPS — Mapeamento direto contra o brief

### FASE 4 — CalibrationEngine (P-A)
- ❌ Platt Scaling não implementado.
- ❌ Isotonic regression não implementada.
- ❌ Reliability diagram NÃO exposto via API (`/api/analytics/calibration` retorna apenas `ece`, `brierScore`, sem bins).
- ❌ INSUFFICIENT_SAMPLE / PROVISIONAL / CALIBRATED / ROBUST não existem.
- ❌ Calibration por par/timeframe/regime/sessão não separada.
- ❌ Calibration slope/intercept não calculados.

### FASE 5 — Forex Data Layer
- ❌ Dukascopy adapter: zero.
- ❌ OANDA adapter: zero.
- ❌ Polygon adapter: zero.
- ❌ `Instrument` / `CurrencyPair` / `Bid` / `Ask` / `Spread` / `Pip` / `Tick` / `Lot` não modelados.
- ❌ Forex sessions (Asia/London/NY) não modeladas.

### FASE 6 — CandlePatternEngine
- ❌ Engulfing, pin bar, hammer, shooting star, doji, inside bar, outside bar não reconhecidos.
- ❌ Body/wick ratio não calculado.
- ❌ ATR-relative range não calculado.
- ❌ Close location (close vs range) não calculado.

### FASE 7 — MarketStructureEngine
- ⚠️ HH/HL/LH/LL existe em `quant/structure.ts:marketStructure()`.
- ❌ BOS (Break of Structure) não implementado.
- ❌ CHoCH/MSS não implementado.
- ❌ Liquidity sweep não implementado.
- ❌ False breakout não implementado.

### FASE 8 — MultiTimeframeEngine
- ⚠️ Multi-TF confluence existe em `fusion/confluence.ts` (15m, 1h, 4h).
- ❌ Conflict detection (M1 BUY vs M5 SELL) não implementado.
- ❌ M1 + M5 + M15 + H1 + H4 conjunto não suportado.

### FASE 9 — VolatilityEngine
- ⚠️ ATR existe.
- ❌ ATR percentile não calculado.
- ❌ Range expansion/compression não detectado.
- ❌ Spread relativo não calculado.

### FASE 10 — MarketRegimeEngine
- ⚠️ `quant/regime.ts:detectRegime()` classifica 7 regimes (incluindo `low_volatility` no tipo mas nunca emitido).
- ❌ Regime-specific modeling (modelo diferente por regime) não existe.
- ❌ Regimes `BREAKOUT`, `CHOPPY`, `NEWS_RISK` não estão no enum.

### FASE 11 — Forex Market Scanner
- ❌ Scanner contínuo não existe.
- ❌ Ranking multi-par não existe.
- ❌ Universe configurável não existe.

### FASE 12 — EvidenceEngine
- ❌ Estrutura padronizada `Evidence { code, value, direction, weight, source, timestamp, quality }` não existe.
- ⚠️ `FusionResult` retorna `favorable/counter/invalidators` strings, mas não tem peso/qualidade formal.

### FASE 13 — AI Agent
- ⚠️ `AgentEngine` existe em `src/agent/engine.ts`.
- ❌ Output estruturado completo (decision, probability, entryWindow, horizon, reasonCodes, invalidations, dataQuality) — atual retorna `Analysis` com `direction/confidence` mas falta entryWindow/horizon/dataQuality.
- ⚠️ Safety limits existem (maxRounds, maxToolCalls, prohibitedActions).
- ❌ Multi-AI router com fallback: zero. Só Anthropic.

### FASE 14 — Probability + Calibration
- ❌ Probability calibrada: zero (calibration.ts tem ECE/Brier mas não Platt).
- ❌ Brier/log loss são exibidos mas Platt não aplica transformação.

### FASE 15 — SignalEngine
- ❌ SignalEngine dedicado não existe (FusionService faz essa função).
- ❌ SignalId, generatedAt, entryWindowStart/End, entryReferencePrice, expiresAt, evidence, reasonCodes, modelVersion, calibrationVersion não estruturados num Signal entity.

### FASE 16 — Bankroll/Risk Engine
- ❌ BankrollManager: zero.
- ❌ PositionSizingEngine: zero.
- ❌ RiskBudgetManager: zero.
- ❌ Cooldown entre losses consecutivas não implementado (só cooldown entre shadows).
- ❌ Kill switch global não existe (só drawdown diário).

### FASE 17 — Chrome Downbar glass
- ⚠️ Downbar existe em `extension/downbar.css` mas é **caixa sólida verde**, não glass.
- ⚠️ Layout atual: `[DB-signal | db-info | db-btn | db-min]` não segue ordem do brief.
- ❌ R$ valor, AUTO ON/OFF, countdown, signal quality — não exibidos.
- ❌ Glassmorphism (blur, transparência, bordas suaves) não aplicado.

### FASE 18 — IQ Option Context Detection
- ⚠️ Manifest aceita `*.iqoption.com` (adicionado em round anterior).
- ❌ Detecção de payout (binárias) não implementada.
- ❌ Detecção de valor selecionado não implementada.
- ❌ Detecção de direção (BUY/SELL) já clicada não implementada.

### FASE 19 — Multi-tab Context
- ❌ `tabContextId` não existe.
- ❌ Cada aba tem seu próprio signal — mas hoje o `background.js` compartilha `signalStore` global.

### FASE 20 — Timed Entry
- ❌ Countdown separado do outcome horizon não existe.
- ❌ Entry window 30s antes da operação não implementado.
- ❌ Cancelamento automático quando preço muda fora da tolerância não existe.

### FASE 21 — Execution Validator
- ❌ Validator não existe.
- ❌ 14 checks (signal/expirado/symbol/timeframe/preço/spread/risco/orçamento/contexto/aba/duplicidade/backend/extensão/broker) — zero implementados.

### FASE 22 — Paper Trading
- ⚠️ `shadow.ts` tem paper trading funcional mas com cooldowns fixos.
- ❌ Modo demo da IQ Option não integrado.

### FASE 23 — Demo (24h soak)
- ❌ Não existe.

### FASE 24 — Anti-Overfitting
- ❌ Bootstrap CI: zero.
- ❌ Permutation test: zero.
- ❌ Deflated Sharpe ratio: zero.
- ❌ Reality check (White, Hansen): zero.
- ❌ Walk-forward com janelas rolantes: zero.

### FASE 25 — Auditoria de sinais
- ⚠️ `analyses.trail` é JSON de auditoria por análise.
- ❌ `signal_audit` table não existe (P-T doc FASE 85 propôs mas não implementei).
- ❌ Snapshot completo: signal_id, symbol, timeframe, price, candles, indicators, patterns, structure, regime, news, evidence, provider, model, version, probability, decision, risk, signal, extension context, execution, outcome — campos individuais faltando.

### FASE 26 — Model Versioning
- ⚠️ `modelVersion`, `featureVersion`, `promptVersion` existem em `analyses`.
- ❌ `calibrationVersion`, `strategyVersion` não estão no schema.

### FASE 27 — Watchdog
- ❌ Watchdog que detecta: market data offline, scheduler parado, AI timeout, DB error, extension disconnected, stale signals, stalled outcomes.
- ❌ Estados HEALTHY/DEGRADED/PAUSED/ERROR não existem.
- ❌ Auto-recovery sem duplicação de operações: zero.

### FASE 28 — Idempotência
- ⚠️ P-R garante idempotência no updateOutcome.
- ❌ Commands críticos não têm `idempotencyKey` explícito (signalId serve).

### FASE 29 — Vercel vs Railway
- ⚠️ Vercel já configurado para stateless API.
- ⚠️ Railway long-running já suportado via `railway.json`.
- ❌ Comunicação WebSocket server-side entre Vercel (UI) e Railway (runtime 24/7) não implementada.

### FASE 30 — SSE/WebSocket server-side
- ❌ Zero. Frontend usa polling.

### FASE 31 — Credenciais
- ⚠️ ANTHROPIC_API_KEY em .env (não commitado).
- ⚠️ `redact()` mascara tokens nos logs.
- ❌ Falta rotação/failover.

---

## 4. PROPOSED ARCHITECTURE (mantendo P-R + P-T intactos)

```
[ForexDataLayer]
├── DukascopyProvider (tick-grade histórico)
├── OandaV20Provider (live FX)
├── PolygonForexProvider (REST)
└── ForexSessionProvider (Asia/London/NY hours)

        ↓ normalized MarketCandle + Tick

[QualityEngine] (P-T preservado)
[MarketContext] (instruments, sessions, regime)

        ↓ candles por timeframe

[QuantEngine] (12 indicadores preservado + ATR percentile)
[CandlePatternEngine] ← NOVO (engulfing, pin, hammer, doji, body/wick ratio)
[MarketStructureEngine] ← NOVO (HH/HL/LH/LL + BOS + CHoCH)
[VolatilityEngine] ← NOVO (ATR%, spread %, regime vol)
[MarketRegimeEngine] ← ESTENDE detectRegime (BREAKOUT, CHOPPY, NEWS_RISK)
[MultiTimeframeEngine] ← ESTENDE confluence com conflict detection

        ↓ evidências estruturadas

[EvidenceEngine] ← NOVO (Evidence { code, value, direction, weight, source, ts, quality })

        ↓ por par e timeframe

[ForexMarketScanner] ← NOVO (loop contínuo, ranking)
[BacktestEngine] (preservado + walk-forward genuíno)

        ↓ para cada decisão

[FusedDecisionInput] → [FusionService] (preservado + inputs expandidos)

        ↓ registra em

[AnalyticsService.recordDecision] (P-R + P-T preservados)

        ↓

[ProbabilityEngine] ← NOVO (X = features, Y = outcome)
[CalibrationEngine] ← NOVO (Platt Scaling opcional + bins reliability + status)

        ↓ signal

[SignalEngine] ← NOVO (SignalId, entryWindow, expiresAt, evidence)
   │
   ├─→ [BankrollManager] (P-$50, R%, position size)
   ├─→ [RiskBudgetManager] (drawdown, cooldown, exposure)
   └─→ [ExecutionValidator] ← NOVO (14 checks)

        ↓

[ChromeExtension.Downbar] ← REDESIGN (glassmorphism verde escuro translúcido)

        ↓ se AUTO ON e valid

[IQOption.BrokerAdapter] (payout-aware, binárias)

        ↓ outcome após 60s

[AnalyticsService.evaluatePending] (P-R preservado)
   └─→ [OutcomeScheduler] (P-R preservado)
        ↓ persistido

[SQLite.DecisionRecord] (P-R + P-T preservados)

        ↓ alimenta

[CalibrationEngine.continuousFit] (Platt recalibrado)
```

---

## 5. REPOSITORY FINDINGS

| Repo | Licença | Decisão | Motivo |
|---|---|---|---|
| nautechsystems/nautilus_trader | LGPL-3.0 | **REFERENCIAR** (estudo) | Engine event-driven de alta qualidade. Copyleft fraco. Usar como inspiração arquitetural. |
| QuantConnect/Lean | Apache-2.0 | **REFERENCIAR** | Melhor implementação de Forex backtest normalization + multi-broker. |
| StockSharp/StockSharp | Apache-2.0 | **REFERENCIAR** | Melhor abstração para MT4/MT5/cTrader/FIX. Não usar código direto. |
| theorycraft-trading/dukascopy | MIT (a confirmar) | **REFERENCIAR + possível reuso** | Útil para entender formato tick-grade do Dukascopy. |
| shner-elmo/TradingView-Screener | (verificar) | **REFERENCIAR** | Lógica de screening multi-par; pode informar design do nosso scanner. |
| OANDA-Trading-API | MIT | **ADAPTAR** | Para cliente HTTP REST v20. Escrever do zero (binding oficial morreu). |
| AI4Finance-Foundation/FinGPT | MIT | **REFERENCIAR** | LLMs finanças — só como referência de prompts. |
| AI4Finance-Foundation/FinRobot | Apache-2.0 | **REFERENCIAR** | Multi-agent — alinhamento conceitual. |
| EarnForex/PositionSizer | Apache-2.0 | **REFERENCIAR (lógica)** | Fórmulas de sizing Forex. Não copiar diretamente. |
| gregorian-09/mqt-microstructure | MIT (verificar) | **REFERENCIAR** | Microestrutura FX — informar design do microstructure engine. |

---

## 6. IMPLEMENTATION PLAN — Sequência por round (Gauntlet Loop em cada um)

### Round 5: P-A — CalibrationEngine
- **Escopo**: Platt Scaling opcional + reliability diagram (bins expostos via API) + INSUFFICIENT_SAMPLE/PROVISIONAL/CALIBRATED/ROBUST enum + separação por par/timeframe/regime.
- **Arquivos novos**: `src/analytics/calibration-engine.ts`, `src/analytics/platt-scaler.ts` (opcional).
- **Esforço**: 1-2 semanas.
- **Sem mudança de schema.**

### Round 6: Forex Data Layer
- **Escopo**: Dukascopy + OANDA v20 + Polygon. Abstrações Instrument/CurrencyPair/Bid/Ask/Spread/Pip/Tick/Lot.
- **Arquivos novos**: `src/market/forex/dukascopy.ts`, `src/market/forex/oanda.ts`, `src/market/forex/polygon.ts`, `src/market/forex/types.ts`.
- **Esforço**: 3-4 semanas.
- **Cuidado**: licenças de cada fonte, IP rate limits.

### Round 7: CandlePatternEngine
- **Escopo**: Detectar 10+ padrões + body/wick ratio + ATR-relative range + close location.
- **Arquivos novos**: `src/quant/candle-patterns.ts`.
- **Esforço**: 1-2 semanas.
- **Testes**: 10+ padrões × fixtures.

### Round 8: MarketStructureEngine
- **Escopo**: BOS + CHoCH/MSS + liquidity sweep + false breakout.
- **Arquivos novos**: `src/quant/structure-v2.ts`.
- **Esforço**: 2 semanas.

### Round 9: VolatilityEngine + MarketRegimeEngine (estendido)
- **Escopo**: ATR%, range expansion, spread %, regimes BREAKOUT/CHOPPY/NEWS_RISK.
- **Arquivos novos**: `src/quant/volatility.ts`, `src/quant/regime-extended.ts`.
- **Esforço**: 1-2 semanas.

### Round 10: MultiTimeframeEngine com conflict detection
- **Escopo**: M1+M5+M15+H1+H4; quando há conflito, reduzir confidence ou WAIT.
- **Arquivos novos**: `src/quant/mtf-engine.ts`.
- **Esforço**: 1-2 semanas.

### Round 11: EvidenceEngine
- **Escopo**: `Evidence { code, value, direction, weight, source, ts, quality }` padronizado.
- **Arquivos novos**: `src/fusion/evidence.ts`.
- **Esforço**: 1 semana.

### Round 12: Forex Market Scanner
- **Escopo**: Loop contínuo em universe configurável; ranking por opportunity score.
- **Arquivos novos**: `src/market/scanner.ts`.
- **Esforço**: 2 semanas.

### Round 13: ProbabilityEngine + CalibrationEngine Platt Scaling
- **Escopo**: Platt Scaling A→B; calibration bins persistidos.
- **Esforço**: 1-2 semanas.

### Round 14: SignalEngine + BankrollManager + PositionSizingEngine
- **Escopo**: Signal entity + Kelly fracionado + cooldown adaptativo.
- **Esforço**: 2-3 semanas.

### Round 15: Execution Validator
- **Escopo**: 14 checks antes da execução.
- **Esforço**: 1 semana.

### Round 16-17: Chrome Downbar Redesign + Multi-tab context
- **Escopo**: Glassmorphism verde escuro + tabContextId.
- **Esforço**: 2-3 semanas.

### Round 18: IQ Option Context Detection + Multi-tab
- **Escopo**: Detectar payout, valor, direção + isolamento de contexto por aba.
- **Esforço**: 2 semanas.

### Round 19: Timed Entry
- **Escopo**: Countdown separado do outcome horizon; cancelamento por drift.
- **Esforço**: 1-2 semanas.

### Round 20: Backtest + Walk-Forward genuíno + Anti-overfitting
- **Escopo**: Janelas rolantes + bootstrap CI + deflated Sharpe + reality check.
- **Esforço**: 3-4 semanas.

### Round 21: SSE/WebSocket server-side
- **Escopo**: Push real-time de sinais para extensão.
- **Esforço**: 1-2 semanas.

### Round 22: Watchdog + Recovery
- **Escopo**: HEALTHY/DEGRADED/PAUSED/ERROR; auto-recovery idempotente.
- **Esforço**: 1-2 semanas.

### Round 23: Paper Trading 24h soak test
- **Escopo**: Rodar o sistema 24h em paper; verificar sinais gerados vs operados.
- **Esforço**: 1 dia corrido + 1 semana de análise.

**TOTAL ESTIMADO**: 25-35 semanas.

---

## 7. TECHNICAL RISKS

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Forex providers (OANDA/Dukascopy) rate-limit | Alta | Médio | Cache agressivo, retry exponencial, fallback entre providers |
| Dukascopy-node quebrando com mudanças | Média | Alto | Pin versão + cliente próprio como fallback |
| Platt Scaling super-ajusta em poucos dados | Alta | Alto | Threshold INSUFFICIENT_SAMPLE < 30 amostras |
| Microestrutura FX sem fonte real (não há L2 FX gratuito) | Alta | Médio | Aceitar gap e documentar; focar em cripto L2 (Binance) |
| IQ Option mudar DOM e quebrar detection | Alta | Alto | Múltiplos métodos de detection + observer fallback |
| Candle Vision: gráfico pixelizado | Média | Médio | WAIT se baixa confiança no OCR |
| 80% hard-coded: viés de confirmation | Alta | Alto | Toda métrica de "acerto" reportada com CI Wilson |
| OOS leak em backtest por usar dados de hora errada | Média | Alto | Walk-forward genuíno com data de corte por timestamp |
| Auto-execution em AUTO ON sem validação humana | Média | Crítico | Bloqueado por Execution Validator (14 checks) |
| Vercel como runtime 24/7 | Alta | Médio | Manter Railway para long-running |
| Credenciais em frontend | Média | Alto | Manter no backend; rotação periódica |

---

## 8. TEST PLAN

| Camada | Testes |
|---|---|
| Market Data | stale data, missing data, bad timestamp, wrong symbol, duplicated tick |
| Candle | 10+ padrões × fixtures sintéticas, body/wick ratio, ATR-relative |
| Multi-TF | alignment, conflict, missing TF |
| Signal | WAIT, BUY, SELL, expiration, countdown, stale, duplicate |
| Calibration | insufficient sample, provisional, calibrated, robust, Platt, bins, reliability, Brier, ECE, leakage |
| Risk | budget, drawdown, consecutive losses, cooldown, exposure, blocked |
| Extension | asset detection, timeframe detection, price, context change, multi-tab, countdown, reconnect |
| Execution | wrong symbol, wrong timeframe, stale price, expired, duplicate, risk block, backend disconnect |
| Anti-overfitting | bootstrap CI, walk-forward rolling, deflated Sharpe, reality check |

Cada round do Gauntlet Loop **exige** testes novos + regressão completa antes de ser declarado FIXED.

---

## 9. NEXT STEP (gate humano)

**Nada de código novo até você revisar este documento.**

Sequência proposta para começar:
1. **Round 5 (P-A — CalibrationEngine)**: já tem dados limpos (P-R + P-T), sem mudança de schema, alto impacto.
2. **Round 6 (Forex Data Layer)**: habilita todos os outros rounds de Forex.
3. **Round 11 (EvidenceEngine)**: hub estrutural para Signal + Risk + Extension.

Qual round prefere? (gate humano)
