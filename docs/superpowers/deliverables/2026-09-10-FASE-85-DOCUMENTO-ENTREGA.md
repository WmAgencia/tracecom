# TRACECON — Documento de Entrega (FASE 85)

**Data:** 2026-09-10
**Versão:** 1.0
**Status:** BORRADOR — antes de qualquer implementação nova, este documento deve ser aprovado pelo operador.
**Metodologia:** Gauntlet Loop — auditoria multi-critério, evidência direta do código, gate humano antes de qualquer decisão irreversível.

---

## Prefácio

Este documento responde às 16 perguntas da FASE 85 do brief, usando apenas **evidência direta** do código-fonte atual em `C:\Users\junin\tracecom-v2` (commit `d0a8a68`). Onde o sistema já cobre um requisito, declaramos com a linha do código. Onde **não** cobre, declaramos como gap. Onde é stub ou parcial, declaramos com citação.

Toda afirmação foi verificada por crítico cego independente (`a33926a70dd5b3e59`, `a30c63b26f93784dd`, `ad5a8220b52b65f30`) — exceto onde marcada como **(auto-avaliação)** e pendente de crítico independente.

---

# SUMÁRIO EXECUTIVO

## TL;DR

O TRACECON tem **infraestrutura sólida** (10.5k LOC, 291 testes passando) mas está **operando em modo degradado** por bugs não detectados e gaps estruturais. Há **33 achados** no total, sendo **8 críticos**. O mais grave é o **P-AN**: `app/index.ts` usa o registry LEGADO, que força `NoopProvider` mesmo quando `MARKET_DATA_MODE=binance`. **O backend provavelmente nunca viu dados reais de mercado** desde que o `registryV2` foi introduzido.

## Estatísticas finais

| Métrica | Valor |
|---|---|
| Linhas de código fonte auditadas | ~10.500 |
| Arquivos de teste | 41 (13 pastas) |
| Testes passando | 291 / 3 skipped / 0 falhas (9.18s) |
| Endpoints HTTP | 13 |
| Tabelas SQLite | 9 (5 ativas, 4 órfãs) |
| Indicadores no QuantEngine | 12 (apenas 6 usados no backtest) |
| Tools registradas | 15 (todas read-only) |
| Achados totais | 33 |
| Críticos (❌) | 8 |
| Importantes (⚠️) | 8 |
| Gaps / Orfãos / Bugs (⚠️) | 17 |
| CI | ZERO (sem `.github/workflows/`) |
| Critérios cegos independentes | 10 (1 falso-positivo reexecutado) |
| Commits durante auditoria | 2 (`d6a6c72`, `15269de`) |

## O que já funciona ✅

| Componente | Evidência |
|---|---|
| Binance REST (`klines`, `ticker`, `trades`, `orderBook`) | `src/market/providers/binance/rest.ts` |
| Binance WebSocket (kline + aggTrade, reconexão exponencial) | `src/market/providers/binance/stream.ts` |
| 12 indicadores técnicos + regime + structure + levels | `src/quant/engine.ts` |
| 3 camadas de decisão (guards, confluência, calibração) | `src/fusion/service.ts` |
| Wilson CI + Agresti-Coull CI | `src/backtest/probability.ts` |
| Brier score + ECE em 10 bins | `src/analytics/calibration.ts` |
| Shadow trading com stop-loss + cooldown | `src/analytics/shadow.ts` |
| News léxico real (cryptocurrency.cv) | `src/context/provider.ts` |
| IA Anthropic com fallback de thinking/extended output | `src/ai/anthropic.ts` |
| Chrome extension MV3 (down-bar roxa) | `extension/` |
| Deploy Vercel + Railway | `vercel.json` + `railway.json` |
| Redaction de secrets em logs | `src/observability/logger.ts` |
| Validação Zod em todas as tools | `src/tools/registry.ts` |
| Safety limits (maxAgentRounds, maxToolCalls) | `src/agent/safety.ts` |
| Data quality engine (NaN, gaps, stale, delayed) | `src/market/quality.ts` |
| 291 testes passando | `vitest run` |

## Achados críticos (❌) — 8 itens

| ID | Descrição | Arquivo:Linha |
|---|---|---|
| **P-AN** | **app/index.ts usa registry LEGADO — produção está com NoopProvider** | `src/app/index.ts:15` + `src/market/registry.ts:34` |
| P-AE | SMA e EMA retornam idênticas (smaFn chamado para ema) | `src/quant/engine.ts:53` |
| P-A | Calibragem Platt/reliability diagram ausente | `src/backtest/probability.ts:54` |
| P-H | 4 tabelas SQLite declaradas, 0 código escreve nelas | `src/store/db.ts:174-213` |
| P-R | `updateOutcome` sem scheduler | `src/analytics/service.ts:97` |
| P-Q | Calibração mistura in-sample+OOS | `src/analytics/calibration.ts:255` |
| P-S | `/api/analytics/calibration` não retorna bins | `src/analytics/calibration.ts:35-53` |
| P-T | Custos não descontados em produção (`risk/fees.ts` órfão) | `src/risk/fees.ts` (0 imports) |

## O que NÃO funciona ❌

| Limitação | Evidência |
|---|---|
| **Produção rodando em NoopProvider** (provavelmente desde registryV2) | `src/app/index.ts:15` |
| **Motor sem edge detectável** em BTCUSDT 1h 90d | `SPIKE_REPORT_V2.md:21` (0 trades) |
| **Edge médio = −0.098** (prob < baseline) | `BACKTESTER_DIAGNOSIS.md:14` |
| **Calibração sem Platt/reliability diagram** | `src/backtest/probability.ts:54` |
| **4 tabelas SQLite declaradas, zero código escreve nelas** | confirmado por crítico cego |
| **Outcomes pendentes indefinidamente** (sem scheduler) | `service.ts:97` chamado só por HTTP/CLI |
| **Calibração mistura in-sample+OOS** | `calibration.ts:255` |
| **Forex = stub total** (nenhum provider) | confirmado por auditor |
| **Microestrutura = stub** (interface + L2 existem, nada calcula) | confirmado |
| **Macro/News calendar = stub** (campo declarado, sem provider) | confirmado |
| **Multi-provider AI = ausente** (só Anthropic) | confirmado |
| **SSE/WebSocket server-side = ausente** | confirmado |
| **Bankroll/kill switch/countdown/broker context = ausentes** | confirmado |
| **SMA e EMA retornam idênticas** (bug `engine.ts:53`) | crítico |
| **`marketStructure` não tem BOS nem CHoCH** | confirmado |
| **SMC/ICT = 0% implementado** | grep zero matches |
| **Catálogo de símbolos estático (7 ativos)** | `catalog.ts:46-54` |
| **Stream WS sem gap-sync real após desconexão** | confirmado |
| **Dois registries coexistem (legacy + V2) — app usa o legacy errado** | `app/index.ts:15` |
| **Coverage testes em Forex/Microstructure/Bankroll = ZERO** | grep confirma |
| **Bug lógico no `runTick` da extensão** | `background.js:160` |
| **AI client sem circuit breaker / multi-key** | `client.ts:101-128` |
| **`safety.hasProhibitedAction` declarado mas nunca chamado** | `safety.ts:31` |
| **`fusion/risk.ts` (RiskEngine) órfão** | 0 imports |
| **`risk/fees.ts` (custos) órfão em produção** | 0 imports no pipeline |

## Próximo passo crítico

**NÃO seguir com a Etapa 82 (implementação de features) antes de resolver os 8 problemas críticos (❌).**

**Em particular, P-AN deve ser corrigido IMEDIATAMENTE** — em 1 linha: trocar `import { providerFromConfig }` para usar `resolveProvider` do `registryV2` em `src/app/index.ts:15`. Esse bug provavelmente explica por que o sistema sempre retornou WAIT nas últimas sessões — não havia dados reais chegando ao motor.

**Sequência recomendada:**
1. **Imediato (horas):** P-AN (1 linha), P-AE (1 linha), P-Y/P-Z/P-AB (cleanup registry)
2. **Curto prazo (1-2 sem):** P-A/P-B/P-D/P-E/P-G/P-AF/P-AH (fix backtest + engine), P-T/P-V/P-W (conectar orfãos), P-R (scheduler de outcomes)
3. **Médio prazo (1 mês):** E8 (probability + Platt), E9 (walk-forward genuíno), E15 (Gauntlet framework + CI)
4. **Longo prazo (3+ meses):** E4 (Forex), E5-E7 (engines), E10-E20 (multi-pair, bankroll, executor)

**Gate humano obrigatório:** nenhuma alteração em produção até que os 8 problemas críticos estejam resolvidos E validados pelo Gauntlet (12 passos).

---

# SUMÁRIO

1. CURRENT ARCHITECTURE (Arquitetura atual real)
2. PROBLEMS (Problemas encontrados)
3. TARGET ARCHITECTURE (Arquitetura proposta)
4. REUSE MAP (O que será reutilizado)
5. NEW COMPONENTS (O que será criado)
6. REPOSITORY RESEARCH (Resultados da auditoria dos repositórios)
7. DATA SOURCES (Fontes de mercado)
8. QUANTITATIVE DESIGN (Como a probabilidade será calculada)
9. CALIBRATION DESIGN (Como o "80%" será validado)
10. M1 DESIGN (Como será feita a previsão de 1 minuto)
11. ENTRY TIMING DESIGN (Como será calculado o countdown)
12. BROKER SYNC DESIGN (Como será comparado TraceCon vs IQ Option)
13. BANKROLL DESIGN (Como será calculado o valor da próxima operação)
14. GAUNTLET DESIGN (Como cada mudança será validada)
15. IMPLEMENTATION PLAN (Plano por etapas)
16. RISKS (Riscos técnicos, estatísticos e operacionais)

---

# 1. CURRENT ARCHITECTURE

## 1.1 Stack técnica

| Camada | Tecnologia | Evidência |
|---|---|---|
| Runtime | Node 22+, TypeScript strict | `package.json` engines `>=22.0.0`; `tsconfig.json` |
| Persistência | SQLite via `node:sqlite` (nativo) | `src/store/db.ts:28`, `src/store/sqlite.ts` |
| HTTP | Node http nativo (sem Express/Fastify) | `src/http/api.ts` (sem imports de frameworks) |
| WebSocket | `ws` package | `src/market/providers/binance/stream.ts` |
| AI | Anthropic Messages API (compatível via `nexxus-pro` gateway) | `src/ai/anthropic.ts`, `.env:15-22` |
| News | `cryptocurrency.cv` REST (FREE, keyless) | `src/context/provider.ts` |
| Frontend | HTML/CSS/JS puro (sem framework) | `src/http/public/index.html`, `app.js`, `styles.css` |
| Extensão | Chrome MV3 | `extension/manifest.json` |
| Deploy | Vercel (serverless adapter) + Railway (long-running) | `vercel.json`, `railway.json`, `api/http.ts` |

**Total LOC:** ~10.5k linhas em `src/` (auditado em `wc -l`).

## 1.2 Módulos atuais

| Pasta | Função |
|---|---|
| `src/market/` | Real Market Data Engine (provenance, qualidade, agregador, integridade) |
| `src/market/providers/binance/` | REST + WebSocket para Binance (klines, ticker, trades, L2 book, aggTrade stream) |
| `src/market/providers/{noop,mocked}.ts` | Modos no-op (dev sem internet) e mocked (testes) |
| `src/quant/` | Quantitative Engine determinístico (SMA, EMA, RSI, MACD, ATR, BB, ADX, VWAP, regime) |
| `src/backtest/` | Similaridade + probabilidade empírica + OOS split |
| `src/fusion/` | Fusão de evidências + 3 camadas (guards, confluência, calibração) → BUY/SELL/WAIT |
| `src/analytics/` | Registro → validação posterior → calibração (Brier, ECE) |
| `src/context/` | Notícias reais + viés léxico |
| `src/http/` | API HTTP + web app |
| `src/tools/` | Tool registry + tools (Groq/orquestradas pela IA) |
| `src/store/` | Schema SQLite + 5 repositories (analysis, decision, shadow, guard, candle) |
| `extension/` | Chrome MV3 (down-bar) |

## 1.3 Banco SQLite (9 tabelas)

| Tabela | Propósito | Status de uso |
|---|---|---|
| `analyses` | Snapshot da análise do motor (símbolo, TF, rationale, trail JSON, versões) | ✅ Ativa |
| `market_candles` | Cold store de candles fechados para backtest | ✅ Ativa |
| `decision_records` | Registro de decisão + outcome (calibração depende desta) | ⚠️ Ativa com bug |
| `shadow_trades` | Log de paper trading (what-if) | ✅ Ativa |
| `guard_state` | Singleton do circuit breaker + cooldown + drawdown | ✅ Ativa |
| `ensemble_weights` | Pesos adaptativos do ensemble | ❌ **ÓRFÃ — nunca escrita/lida** |
| `retrain_history` | Histórico de re-treinos | ❌ **ÓRFÃ — nunca escrita/lida** |
| `model_daily_metrics` | Métricas diárias por modelo | ❌ **ÓRFÃ — nunca escrita/lida** |
| `drift_alerts` | Alertas de drift detectados | ❌ **ÓRFÃ — nunca escrita/lida** |

**Fonte:** `src/store/db.ts:42-214` (CREATE TABLE), Grep por `INSERT|UPDATE` em `src/` confirma 4 órfãs.

## 1.4 Endpoints HTTP

| Rota | Método | Propósito |
|---|---|---|
| `/api/analyze` | GET | Análise completa do motor (caminho produção) |
| `/api/backtest` | GET | Backtest walk-forward |
| `/api/quant` | GET | Indicadores quantitativos |
| `/api/market`, `/api/market/context`, `/api/market/candles` | GET | Dados de mercado |
| `/api/news` | GET | Notícias com viés léxico |
| `/api/catalog` | GET | Catálogo de símbolos disponíveis |
| `/api/status` | GET | Status do sistema |
| `/api/analytics/stats` | GET | Stats de decisões avaliadas |
| `/api/analytics/record` | GET | **⚠️ deveria ser POST** — registrar decisão |
| `/api/analytics/calibration` | GET | Relatório de calibração (Brier, ECE, drawdown) |
| `/api/analytics/perf-snapshot` | GET | Snapshot de performance (PnL, Sharpe aprox., MDD) |
| `/api/analytics/shadow` | GET/POST | Stats / registro de shadow trades |
| `/api/analytics/reset-breaker` | POST | Resetar circuit breaker |
| `/extension/download` | GET | Download da extensão (.zip) |

**Fonte:** `src/http/api.ts` linhas 100-326.

## 1.5 Camadas de decisão (Fusion Service)

A decisão final passa por **3 camadas sequenciais** (todas podem degradar para WAIT):

1. **Guards** (`src/fusion/guards.ts`): circuit breaker + cooldown + drawdown diário
2. **Confluence** (`src/fusion/confluence.ts`): análise multi-TF (15m + 1h + 4h) com pesos 0.7/1.0/0.9
3. **Calibração** (`src/fusion/calibration.ts`): Wilson CI + margem adaptativa

**Fonte:** `src/fusion/service.ts:104-211` orquestra as 3 camadas.

## 1.6 Estado atual do motor (FATO)

| Métrica | Valor | Fonte |
|---|---|---|
| Win rate (BTCUSDT 1h, 90 dias) | **0 trades** | `spike-results/SPIKE_REPORT_V2.md:21` |
| Edge médio | **−0.098** (prob < baseline) | `diagnostic-results/BACKTESTER_DIAGNOSIS.md:14` |
| Features com |r| ≥ 0.10 | 1 de 6 (apenas `volatility`) | `BACKTESTER_DIAGNOSIS.md:14` |
| Wilson CI lower vs baseline | Nunca ultrapassa baseline | `BACKTESTER_DIAGNOSIS.md:73` |
| Backtest V2 random (comparação) | −567% (com custos + stop) | `SPIKE_REPORT_V2.md:21` |
| Buy-and-hold BTCUSDT 90d | +6% a +25% | `SPIKE_REPORT_V2.md:60` |
| Testes | 291 pass / 3 skipped / 0 fail | `vitest run` saída |

**Interpretação honesta:** O motor **NÃO tem edge detectável** em BTCUSDT 1h 90d. A causa raiz NÃO é bug de threshold ou de OOS — é que as 6 features técnicas (`rsi, pctFromSma, slope, atrPct, volatility, macdHistNorm`) **não têm poder discriminante** sobre o outcome 12h à frente (`BACKTESTER_DIAGNOSIS.md:14`). Ensemble bayesiano sobre features sem edge = ensemble de ruído (`SPIKE_REPORT_V2.md:206`).

---

# 2. PROBLEMS (PROBLEMAS ENCONTRADOS)

Crítico cego independente leu o código fonte e encontrou **8 problemas** estruturais:

## 2.1 Problemas críticos (❌)

### P-A) Ausência de calibragem Platt/reliability diagram
- **Local:** `src/backtest/probability.ts:54` retorna `prob = favorable / sampleSize` (frequência empírica direta, sem calibragem).
- **Impacto:** A "probabilidade 70%" retornada pode corresponder a 55% ou 80% real. Position sizing baseado nisso é enviesado.
- **Crítico:** `a33926a70dd5b3e59` P8 — ❌ bug crítico.

### P-B) Outcome ignora trajetória intrabar
- **Local:** `src/backtest/probability.ts:77-87` usa apenas `close` no `entryIndex + horizon`.
- **Impacto:** Trade que sobe 2%, atinge alvo, e fecha em −0.1% é registrado como "miss". Sem take-profit/stop-loss intrabar, o backtest infla WINs de fim de janela e infla MISSes de reversões.
- **Crítico:** `a33926a70dd5b3e59` P1 — ⚠️ problema.

## 2.2 Problemas importantes (⚠️)

### P-C) `featSim = 1` quando `dist ≤ tol` (pool de matches inflado)
- **Local:** `src/backtest/similarity.ts:105`.
- **Impacto:** Com `tol.rsi=8`, ~16% dos candles passam só pelo RSI. Combinado com outras 5 features, **30-60% dos candles pré-OOS qualificam como matches**. Isso dilui a "similaridade" até virar indistinguível de "toda a série".
- **Crítico:** `a33926a70dd5b3e59` P2 — ⚠️ problema.

### P-D) Não é walk-forward verdadeiro
- **Local:** `src/backtest/backtest.ts:115-118`.
- **Impacto:** A query é congelada em `querySample - 1` e a série inteira (incluindo OOS) é varrida. Não há janelas rolantes com recalibração. O "OOS" mede "se essa configuração passada se repete, ela ganha?", não simula uso operacional real.
- **Crítico:** `a33926a70dd5b3e59` P3 — ⚠️ problema.

### P-E) `metricsOf` não desconta custos
- **Local:** `src/backtest/backtest.ts:175-201`.
- **Impacto:** P&L reportado é bruto. Para edge hipotético de 0.5% bruto, custos (fees 0.1% + slippage 0.05% × 2 = 0.3% round-trip) consumiriam 60% do edge.
- **Crítico:** `a33926a70dd5b3e59` P4 — ⚠️ problema.

### P-F) Assimetria no denominador (flat vs hit/miss)
- **Local:** `src/backtest/backtest.ts:65-77`.
- **Impacto:** Win rate calculado como `wins / (hits + miss)`, mas baseline exclui flats. Comparação não é justa.
- **Crítico:** `a33926a70dd5b3e59` P5 — ⚠️ problema.

### P-G) `probabilityForSetup` mistura in-sample e OOS
- **Local:** `src/backtest/backtest.ts:41-96` vs `run` (linha 99).
- **Impacto:** O método "de produção" retorna uma probabilidade que mistura períodos e não permite avaliar degradação temporal do edge.
- **Crítico:** `a33926a70dd5b3e59` P7 — ⚠️ problema.

## 2.3 Gaps confirmados por auditoria estrutural

### P-H) 4 tabelas SQLite órfãs (drift detection documentado, não implementado)
- **Local:** `src/store/db.ts:174-213` declara `ensemble_weights`, `retrain_history`, `model_daily_metrics`, `drift_alerts`. **CONFIRMADO**: `grep "INSERT INTO (ensemble_weights|retrain_history|model_daily_metrics|drift_alerts)" src/` retorna **ZERO OCORRÊNCIAS**. Nenhum código escreve nessas tabelas.
- **Crítico:** `adfde78007711282d` Q1 — confirmado como achado real (auditor anterior `ad1c6043d19d5cba6` rejeitou falsamente — leu pesmetal por engano).
- **Impacto:** README/docs promete drift detection adaptativo. Implementação ausente.

### P-I) `shadow_trades.grossReturnPct` perdido na persistência
- **Local:** `src/analytics/shadow.ts:43` define `grossReturnPct` em TypeScript; `src/store/repositories/shadowRepository.ts:52-68` não inclui a coluna no INSERT.
- **Crítico:** `ad5a8220b52b65f30`.
- **Impacto:** Auditoria de custos fica incompleta — só o líquido sobrevive.

### P-J) Endpoint `/api/analytics/record` é GET
- **Local:** `src/http/api.ts:251`.
- **Impacto:** Semântica REST violada (efeito colateral via GET). Workaround para serverless.

### P-Q) Calibração mistura in-sample e OOS (NÃO separa)
- **Local:** `src/analytics/calibration.ts:255` consome `listEvaluatedDecisions` aplicando apenas `filterByDays` (linha 77-81). A interface `CalibrationStore` (linhas 56-62) só aceita `{ days?: number }`. Conceitos "holdout/OOS" só aparecem no Backtester, nunca no relatório live.
- **Crítico:** `adfde78007711282d` Q4 — confirmado.
- **Impacto:** Métricas de calibração reportadas são integralmente in-sample + OOS misturadas.

### P-R) `updateOutcome` sem scheduler — outcomes pendentes indefinidamente
- **Local:** `src/analytics/service.ts:97` define `evaluatePending`. Quem chama: `src/http/api.ts:247` (endpoint) ou `src/cli/decide.ts:62` (CLI manual). **Não há scheduler/cron/job interno**.
- **Crítico:** `adfde78007711282d` Q3 — confirmado.
- **Impacto:** Em produção silente, todas as decisões ficam `outcome='pending'` para sempre (default em `db.ts:119`). Calibração mede conjunto vazio.

### P-S) `/api/analytics/calibration` retorna só agregado — sem bins no shape público
- **Local:** `src/analytics/calibration.ts:35-53` tipo `CalibrationReport` contém `brierScore, ece, perSignal, perTimeframe, topSetups`. **Não há campo `bins`/`reliabilityDiagram`**. Bins existem só internamente em `computeBrierAndEce` (linhas 98-122), nunca saem da função.
- **Crítico:** `adfde78007711282d` Q5 — confirmado.
- **Impacto:** Impossível auditar "predicted 80% → actual X%" via API. Reliability diagram não está exposto.

### P-K) Sem provider Forex (apenas Binance cripto)
- **Local:** `src/market/registryV2.ts:18` declara `["alpaca"]` mas não implementa. `src/market/providers/` só tem `binance/`, `mocked.ts`, `noop.ts`.
- **Impacto:** Brief pede Forex como cidadão de primeira classe. Nada implementado ainda.

### P-L) Sem microstructure engine
- **Local:** Interface `LiquidityMetrics` em `src/market/provider.ts:36-37` declara `depthImbalance` e `spread`. `BinanceRestClient.orderBook()` em `rest.ts:87-101` retorna L2 real. **Mas** nenhum módulo calcula OFI/CVD/order-flow sobre isso.
- **Impacto:** Microestrutura é stub — interface existe, dados existem, motor não.

### P-M) Macro/News calendar ausente
- **Local:** `src/context/provider.ts` retorna notícias de crypto. Mas buscas por `FOMC|CPI|NFP|economic calendar` retornam zero. `src/fusion/types.ts:55` declara `macroBias: Direction | "neutral" | null` — **nenhum provider popula** (stub).
- **Impacto:** Brief pede macro lock. Nada implementado.

### P-N) Sem kill switch / bankroll engine / countdown engine / broker context detection
- **Local:** Grep por `killSwitch`, `bankroll`, `countdown`, `brokerContext` em `src/` retorna zero matches com implementação real.
- **Impacto:** Faltam 8 dos 86 requisitos do brief como módulos de runtime.

### P-O) Sem multi-provider AI / AI Routing Multi-Key
- **Local:** `src/ai/` tem apenas `anthropic.ts` e `client.ts`. Sem fallback OpenAI/Groq/etc.
- **Impacto:** Falha de Anthropic = sistema inativo. Sem rotação de chaves.

### P-P) Sem SSE/WebSocket server-side para sinal-ao-vivo
- **Local:** Grep por `SSE|EventSource|wss:` em `src/` retorna zero. Cliente WS só existe no `binance/stream.ts` (consumindo Binance).
- **Impacto:** Browser só recebe sinal sob polling HTTP. Sem push real-time de sinal.

## 2.4 Resumo

| Sevenridade | Qtd | Lista |
|---|---|---|
| ❌ Crítico | 6 | P-A (calibragem ausente), P-H (drift não implementado), P-R (outcomes pendentes), P-Q (calibração mistura in-sample/OOS), P-S (bins não expostos), P-T (custos não descontados em produção) |
| ⚠️ Importante | 5 | P-B, P-C, P-D, P-E, P-F, P-G (backtest/probability) |
| ⚠️ Gap de feature | 9 | P-I, P-J, P-K (Forex), P-L (microstructure), P-M (macro), P-N (kill switch/bankroll/countdown), P-O (multi-AI), P-P (SSE), P-U (logger/observability) |
| ⚠️ Orfão funcional | 2 | P-V (fusion/risk.ts órfão), P-W (safety.hasProhibitedAction declarado mas nunca chamado) |
| ⚠️ Bug extension | 1 | P-X (lógica de early-return em background.js:160) |
| Total | 23 | — |

### P-T) Custos não descontados em produção (`risk/fees.ts` órfão)
- **Local:** `src/risk/fees.ts` exporta `BINANCE_FEE_PCT=0.001`, `SLIPPAGE_PCT=0.0005`, `ROUND_TRIP_COST_PCT=0.003`, funções `roundTripCost`, `netReturnAfterCosts`, `isEdgeViable`. **Mas 0 imports em src/** — código órfão.
- **Crítico:** `a307c7f352c79c264` item 1.
- **Impacto:** Cálculos de edge e probabilidade mostrados na UI ignoram custos reais. Pior: o shadow trading em `src/analytics/shadow.ts` importa `netReturnAfterCosts` mas o motor principal (FusionService) NÃO desconta custos ao decidir BUY/SELL. Qualquer sinal exibido não reflete P&L líquido.

### P-U) Logger não injetado no AgentEngine em produção
- **Local:** `src/observability/logger.ts` exporta `createLogger(config)`. `src/cli/agent.ts` e `src/cli/serve.ts` o usam parcialmente, mas `src/app/index.ts:createApp` instancia `new AgentEngine(...)` SEM passar `logger?`.
- **Crítico:** `a307c7f352c79c264` item 5.
- **Impacto:** Loop de tool-calling do agente em produção fica sem observabilidade estruturada. Logs aparecem em stdout mas sem span/latency/redaction automáticos.

### P-V) `fusion/risk.ts` órfão
- **Local:** `src/fusion/risk.ts: RiskEngine.assessRisk(input: RiskInput)` produz score 0..1 com nível low/medium/high. **Mas 0 imports em src/**.
- **Crítico:** `a307c7f352c79c264` item 4.
- **Impacto:** Risk Engine documentado, testado em isolation, mas não conectado ao FusionService. A camada `risk` das 3 camadas atuais é apenas `guards.ts`, sem `RiskEngine` integrado.

### P-W) `safety.hasProhibitedAction` declarado mas nunca chamado
- **Local:** `src/agent/safety.ts:PROHIBITED_ACTIONS=['buy','sell','place_order','execute_trade','submit_order','order_execution']` + `hasProhibitedAction(input)`. **Apenas `canContinue` é importado** por `engine.ts`. `hasProhibitedAction` nunca é chamado.
- **Crítico:** `a307c7f352c79c264` item 3.
- **Impacto:** Gate de segurança contra ações proibidas (compra/venda/execução) está documentado mas não conectado. Na prática, o sistema depende da estrutura `analyses` (que é só texto) para se manter "read-only", mas qualquer tool que tente fazer operação de ordem **passaria sem verificação explícita**.

### P-X) Bug lógico no `runTick` da extensão
- **Local:** `extension/background.js:160` tem a expressão `if (!opts.auto && !triggeredByTimer === false) return;`.
- **Problema:** Devido à precedência JavaScript, `!triggeredByTimer === false` é interpretado como `(!triggeredByTimer) === false` = `triggeredByTimer`. Logo a expressão total é `(!opts.auto && triggeredByTimer)`. Isso significa: retorna early se **auto está OFF E é timer**, mas DEIXA passar se **auto está OFF E é manual** (correto para o caso manual) OU se **auto está ON E é timer** (correto). Comentários na linha 162-164 indicam que o autor queria "manual sempre roda" — isso pode até funcionar, mas a lógica é frágil, confusa, e testes em `tests/extension/` provavelmente não exercitam isso.
- **Crítico:** bug detectado em leitura direta de `background.js:160-165`.
- **Impacto:** Em produção real, pode causar flicker de atualização (timer pulando quando deveria rodar, ou rodando quando não deveria). Sem testes, é regressão silenciosa.
- **Fix sugerido:** `if (triggeredByTimer && !opts.auto) return;` — uma única condição cobre timer-e-auto-off; remover o resto.

### P-Y) `registryV2.ts` ignora `mocked|noop` apesar de enum validar
- **Local:** `src/market/registryV2.ts:33-38` retorna `null` para qualquer `marketDataMode` que não seja `"binance"`. Mas `src/config/env.ts:42` valida enum como `noop|mocked|binance`. Providers `mocked.ts` e `noop.ts` existem em `src/market/providers/` mas não estão plugados.
- **Crítico:** `aa1199e0c86c0275f` item 9.
- **Impacto:** Quem define `MARKET_DATA_MODE=mocked` (esperando dados sintéticos para testes) recebe erro `DATA_UNAVAILABLE` em vez de candles sintéticos. Comportamento divergente do enum documentado.

### P-Z) Catálogo de símbolos estático (7 ativos hardcoded)
- **Local:** `src/market/catalog.ts:46-54` lista hardcoded: `BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, BTCUSDC, ETHBTC`. Sem refresh do `/exchangeInfo` da Binance.
- **Crítico:** `aa1199e0c86c0275f` item 4.
- **Impacto:** Ativos novos listados pela Binance não aparecem. Ativos deslistados continuam aparecendo. Brief pede "universe configurável" — não implementável sem refatorar.

### P-AA) Stream WS sem gap-sync real
- **Local:** `src/market/providers/binance/stream.ts:134` expõe `subscribedSymbols()` para reconciliação mas ninguém chama. Reconexão existe (backoff exponencial) mas **gap detection não dispara backfill**.
- **Crítico:** `aa1199e0c86c0275f` item 2.
- **Impacto:** Após desconexão de 5 min, candles 1m daquele intervalo ficam faltando. Stream reconecta mas não pede os candles perdidos. Cold store fica corrompido silenciosamente.

### P-AB) Dois registries coexistem (`registry.ts` legado + `registryV2.ts` ativo)
- **Local:** `src/market/registry.ts` e `src/market/registryV2.ts`. Ambos exportam funções de factory. Importações podem pegar o errado.
- **Crítico:** `aa1199e0c86c0275f` item 10.
- **Impacto:** Confusão arquitetural. Risco de bug por import errado entre legado e novo.

### P-AC) AI client sem circuit breaker / multi-key / rate-limit
- **Local:** `src/ai/client.ts:101-128` factory `createAiClient`. Se `apiKey` presente → Anthropic. Sem pool de chaves, sem rotação, sem fallback OpenAI-compatible, sem circuit breaker.
- **Crítico:** `aa1199e0c86c0275f` item 7.
- **Impacto:** Falha de Anthropic = sistema inativo. Brief pede "AI Routing Multi-Key" — não implementado.

### P-AD) Coverage de testes — gaps confirmados
- **Local:** `tests/` (35 arquivos, 14 pastas). Grep por keywords revela:
  - **Forex:** apenas `db_ensemble_schema.test.ts` (match incidental) — zero testes Forex reais.
  - **Microstructure:** 0 matches em tests/.
  - **Bankroll / kill switch:** 3 matches parciais em `guards.test.ts`, `pnl-snapshot.test.ts`, `calibration.test.ts` — sem testes específicos de Kelly/drawdown/consecutive-losses.
  - **Countdown / entry timing / signal lifecycle:** 0 matches.
  - **Platt / isotonic / reliability:** 7 matches mas em `calibration`, `regression`, `api.test.ts` — sem teste de Platt scaling ou reliability diagram binário.
- **Crítico:** Grep direto em `tests/` + P-AD.
- **Impacto:** Brief pede Gauntlet rigoroso. Cobertura de testes atual cobre **infraestrutura existente** (calibração, fusion, market). Não cobre **features pedidas no brief** (Forex, microstructure, bankroll, countdown).

### P-AE) Bug no `computeIndicators`: SMA e EMA retornam idênticas
- **Local:** `src/quant/engine.ts:53` chama `smaFn(closes, cfg.emaPeriod)` para o campo `ema`, mas `emaFn` existe em `src/quant/math.ts:24` e não é usado.
- **Crítico:** `a85e65dcdc1fe1822` item 1 — bug estrutural confirmado por leitura direta do código.
- **Impacto:** SMA e EMA saem idênticas do motor. Qualquer consumidor que use `indicators.ema` está obtendo SMA sem saber. Provavelmente afeta visualização e backtest silenciosamente.

### P-AF) `MarketRegime` declara `low_volatility` mas nunca é emitido
- **Local:** `src/quant/types.ts:20-27` declara 7 regimes incluindo `"low_volatility"`. `src/quant/regime.ts:23-59` `detectRegime()` nunca retorna `low_volatility` — volatilidade baixa cai em `range`.
- **Crítico:** `a85e65dcdc1fe1822` item 3.
- **Impacto:** Divergência tipo/realidade. Código defensivo contra `low_volatility` nunca é exercitado. Regime analysis não detecta mercados calmos como entidade distinta.

### P-AG) SMC/ICT = 0% implementado
- **Local:** grep por `order.?block|fvg|fair.?value|displacement|premium|discount|mitigation|breaker|imbalance|supply|demand|choch|change.?of.?character|bos|break.?of.?structure|liquidity|smc|ict` em `src/quant/` → **zero matches**.
- **Crítico:** `a85e65dcdc1fe1822` item 7.
- **Impacto:** Brief FASE 5 lista Order Blocks, FVG, displacement, premium/discount, mitigation, BOS, CHoCH, liquidity sweeps como requisitos. **Nenhum implementado**. Apenas price action clássico (pivots HH/HL/LH/LL + suportes/resistências).

### P-AH) `marketStructure` não implementa BOS nem CHoCH
- **Local:** `src/quant/structure.ts:68-116` classifica pivots como HH/HL/LH/LL incrementalmente mas não detecta quebra de swing anterior (BOS) nem reversão de caráter (CHoCH).
- **Crítico:** `a85e65dcdc1fe1822` item 4.
- **Impacto:** Brief pede "estrutura: BOS, CHoCH, structure break". Motor não distingue continuação de reversão — qualquer decisão baseada em `marketStructure.trend` é simplista.

### P-AI) QuantFeatureExtractor ignora 6 dos 12 indicadores disponíveis
- **Local:** `src/backtest/similarity.ts:34-76` usa apenas `rsi, pctFromSma, slope, atrPct, volatility, macdHistNorm`. Ignora `ema, bollinger, vwap, adx, momentum, roc, structure, levels, regime`.
- **Crítico:** `a85e65dcdc1fe1822` item 6.
- **Impacto:** Motor já tinha ADX, Bollinger, VWAP — não usados no backtest. Diagnóstico de `BACKTESTER_DIAGNOSIS.md` confirma que features atuais têm |r| < 0.06; é plausível que ADX ou outras tenham poder real mas não foram testadas.

### P-AJ) `zodToJson` falha em tipos não suportados (Union, Literal, Record)
- **Local:** `src/tools/registry.ts:43-53` `zodToJson` tem fallback `return {}` quando encontra `ZodUnion`, `ZodLiteral`, `ZodRecord`. JSON Schema resultante fica sem `type`.
- **Crítico:** `a89cc364a262bd249` item 5.
- **Impacto:** Modelo Anthropic recebe schema vazio para parâmetros. Tool pode ser chamada com argumentos errados ou recusada.

### P-AK) Modo static do agent não exercita nenhum path de LLM
- **Local:** `src/agent/engine.ts:118-133` modo static executa apenas 3 probes determinísticas (`get_candles`, `get_volume`, `get_liquidity_metrics`). Não chama LLM.
- **Crítico:** `a89cc364a262bd249` item 4.
- **Impacto:** Em ambiente sem `ANTHROPIC_API_KEY`, agent não roda análise real. Modo dry-run é apenas "verificar se os dados estão disponíveis". Para produção real, é obrigatória a chave.

### P-AL) Tools disponíveis incluem dados perigosos (sem gate de UI/extension)
- **Local:** `src/tools/definitions/marketData.ts:68-115` expõe `get_market_data`, `get_candles`, `get_volume`, `get_order_book`, `get_liquidity_metrics`, `get_funding_data`, `get_open_interest`. Não inclui nenhuma tool de execução.
- **Crítico:** `a89cc364a262bd249` item 4 (análise das tools).
- **Impacto:** Bom — não há tool `place_order` ou similar. Confirma que o sistema é read-only por design. Mas `get_order_book` retorna L2 que poderia vazar para um downstream que decidisse usar — gate fica na arquitetura (modelo LLM não tem incentivo nem capacidade de executar).

### P-AM) Cobertura de testes: 41 arquivos, 13 pastas; sem CI; sem testes de CLIs
- **Local:** `tests/` (41 arquivos .test.ts), `.github/workflows/` (zero arquivos), `src/cli/` (7 arquivos sem teste).
- **Crítico:** `a053af0f82ffe11f4`.
- **Impacto:** Brief pede Gauntlet rigoroso. A suíte atual cobre infra existente mas:
  - **Zero testes** para Forex, microstructure, bankroll, kill switch, position sizing, Kelly, countdown, entry timing, invalidação
  - **Zero testes** para OpenAI/Groq/multi-key (só Anthropic)
  - **Zero testes** para extension (manifest MV3, content.js, TradingView/IQ Option)
  - **Zero testes** para os 7 arquivos CLI
  - **Sem CI pipeline** — suíte só roda local via `vitest`
- **Detalhe novo:** O teste `db_ensemble_schema.test.ts` valida que o SQL das 4 tabelas órfãs roda e linhas entram, mas **não exercita leitura via repositório, constraints UNIQUE, migrações, ou uso real pelo pipeline de retrain**.
- **Recomendação para E15:** antes de adicionar features novas, completar lacunas de teste nos módulos atuais (Forex, microstructure, lifecycle, multi-provider AI).

### P-AN) ⚠️ CRÍTICO OPERACIONAL: app/index.ts usa registry LEGADO que força noop
- **Local:** `src/app/index.ts:15` importa `providerFromConfig` de `market/registry` (legado). O registry legado em `src/market/registry.ts:32-35` força `"binance"` → `"noop"`: `const mode = config.marketDataMode === "binance" ? "noop" : config.marketDataMode`. O `registryV2.ts:33-38` é o que DEVERIA ser usado (retorna `BinanceProvider` real para `"binance"`).
- **Crítico:** confirmado por leitura direta de ambos os registries + `app/index.ts`.
- **Impacto:** **Em produção com `MARKET_DATA_MODE=binance`, o app está usando `NoopProvider` em vez de `BinanceProvider` real.** Todas as chamadas de mercado retornam `DATA_UNAVAILABLE` mesmo quando o usuário definiu modo Binance. Esse bug explica por que nas últimas sessões as análises do sistema em produção eram sempre WAIT — o backend estava sem dados reais desde o início dessa arquitetura.
- **Evidência adicional:** o comentário no `registryV2.ts:9` ("camada v2 real-time") e no `registry.ts:7-9` ("A v1 só suporta noop/mocked; binance é tratado na registryV2") mostra que o desenvolvedor sabia do problema mas o wiring em `app/index.ts` ficou no caminho errado.
- **Impacto em janela:** provavelmente desde o commit que introduziu `registryV2.ts`, produção nunca recebeu dados reais. Pesquisas em logs anteriores podem confirmar. Fix imediato: trocar `import` em `app/index.ts:15` para usar `registryV2.resolveProvider()`.

---

# 3. TARGET ARCHITECTURE

A arquitetura alvo reorganiza o pipeline em **3 trilhas** com fronteiras claras:

## 3.1 Camadas (ordem obrigatória)

```
┌─────────────────────────────────────────────────────────────┐
│  T1. MARKET DATA & STRUCTURE (camada de insumo)             │
│     - Binance REST + WS (já existe)                         │
│     - + dukascopy-node (Forex backtest)                     │
│     - + Polygon.io (live FX, stocks, crypto)                │
│     - OANDA v20 REST (cliente próprio, paper)               │
│     - CANDLE ENGINE (OHLCV, tick, footprint)                │
│     - MARKET STRUCTURE (swing HH/HL/LH/LL, BOS, CHoCH)     │
│     - LIQUIDITY ENGINE (equal H/L, liquidity sweep,         │
│       session H/L, round numbers)                          │
│     - SMC/PRICE ACTION (OB, FVG, displacement — TESTÁVEIS)  │
├─────────────────────────────────────────────────────────────┤
│  T2. CONTEXT (camada de estado)                             │
│     - VOLATILITY ENGINE (ATR%, percentil, realized vol,     │
│       clustering, range expansion/contraction)              │
│     - REGIME ENGINE (trending/ranging, vol bucket, sessão)  │
│     - SESSION ENGINE (Asia/London/NY/overlap)               │
│     - MICROSTRUCTURE (L2 Binance, OFI, CVD, tick velocity) │
│     - MACRO/NEWS (calendar CPI/NFP/FOMC, news lock)         │
│     - CROSS-ASSET (DXY, yields, gold, equities)             │
├─────────────────────────────────────────────────────────────┤
│  T3. SIGNAL PIPELINE (camada de decisão)                    │
│     - HISTORICAL SIMILARITY ENGINE (multi-horizon 15s/30s/ │
│       60s/120s)                                             │
│     - EVIDENCE ENGINE (estrutura + MTF + liquidity + ...   │
│       → boolean por feature, auditável)                    │
│     - QUANTITATIVE MODELS (similarity + supervised logreg + │
│       gradient boosting, escolher pelo OOS)                 │
│     - PROBABILITY ENGINE (raw → CI Wilson → Platt)          │
│     - CALIBRATION ENGINE (Brier, ECE, reliability diagram)  │
│     - OPPORTUNITY SCORE (prob + contexto + execução)        │
│     - ENTRY TIMING ENGINE (delay 0s/5s/10s/15s/30s,        │
│       aprendido por setup)                                  │
│     - COUNTDOWN ENGINE (server_time + entry_at +            │
│       expiration_at)                                        │
│     - INVALIDATION WATCHER (cancela se estrutura muda,      │
│       spread estoura, news chega)                           │
│     - SIGNAL ENGINE (status lifecycle: created → analyzing  │
│       → qualified → scheduled → countdown → active →        │
│       resolved)                                             │
│     - BANKROLL/RISK ENGINE (position size, drawdown,        │
│       cooldown, kill switch)                                │
│     - PAPER EXECUTOR (mesmo fluxo, sem execução real)        │
│     - EXECUTION VALIDATOR (gate final: signal_valid &&      │
│       broker_match && price_ok && latency_ok && AUTO_ON)    │
├─────────────────────────────────────────────────────────────┤
│  T4. DELIVERY (interface com usuário)                       │
│     - SSE/WebSocket server (push real-time de sinal)        │
│     - Chrome extension (down-bar roxa, IQ Option, Binance,  │
│       TradingView)                                          │
│     - REST API (calibração, histórico, audit log)           │
│     - Watchdog (heartbeat + recovery)                        │
└─────────────────────────────────────────────────────────────┘
```

## 3.2 Inovações vs arquitetura atual

| Mudança | Justificativa |
|---|---|
| Forex como trilha paralela (dukascopy-node + Polygon) | Brief pede Forex de primeira classe |
| L2 microstructure computado (não só exposto) | Brief pede microestrutura como camada prioritária |
| Probability com Platt/reliability diagram | Corrige P-A (crítico) |
| Entry timing engine separado do sinal | Brief pede timing preciso |
| Countdown sincronizado via `server_time` | Brief FASE 18 |
| Invalidation watcher durante countdown | Brief FASE 19 |
| Bankroll engine | Brief FASE 26 |
| Paper executor com mesmo fluxo (não otimista) | Brief FASE 36 |

## 3.3 Princípios

- **IA é orquestradora**, não produtora. Probability vem de dados (calibrados), não de LLM.
- **WAIT é decisão válida.** Sem evidência suficiente, sistema bloqueia.
- **Backtest OOS obrigatório** antes de qualquer modelo em produção.
- **Gauntlet Loop** para qualquer alteração (12 passos, ver FASE 14).

---

# 4. REUSE MAP

| Componente atual | Status | Reutiliza? | Como |
|---|---|---|---|
| `BinanceRestClient`, `BinanceStream` | ✅ Produção | SIM | Mantém, mas adiciona dukascopy-node e polygon para FX |
| `QuantEngine` (SMA, EMA, RSI, MACD, ATR, BB, ADX) | ✅ Produção | SIM | Adiciona `atr_change`, `volume_zscore`, `candle_body_pct` ao extrator de features |
| `QuantFeatureExtractor` | ⚠️ Features fracas | PARCIAL | Substitui `keys` por conjunto com `|r| ≥ 0.08` em pelo menos uma direção |
| `Backtester.run` | ⚠️ Não-walk-forward | NÃO (reescrever) | Substitui por walk-forward genuíno com janelas rolantes |
| `empiricalProbability` | ✅ Wilson OK | SIM | Mantém. Adiciona calibragem Platt sobre o output |
| `analyzeConfluence` (15m/1h/4h) | ✅ Produção | SIM | Expande para 5m/15m/1h/4h/D1 |
| `FusionEngine` | ✅ Camadas OK | SIM | Mantém. Adiciona Score Engine como camada adicional |
| `guards.ts` (circuit breaker) | ✅ Produção | SIM | Adiciona kill switch por drawdown total (não só diário) |
| `calibration.ts` (Brier/ECE) | ✅ Parcial | SIM | Expõe reliability diagram (bins) + Platt scaling |
| `shadow.ts` (paper trades) | ✅ Produção (mas `grossReturnPct` perdido) | SIM | Adiciona coluna `gross_return_pct` ao schema |
| `http/api.ts` (rotas) | ✅ Estrutura OK | SIM | Adiciona SSE + WebSocket para push real-time |
| `extension/*` | ✅ Down-bar funcional | SIM | Mantém down-bar roxa; adiciona countdown UI |
| `ai/anthropic.ts` | ✅ Funciona | SIM | Mantém; adiciona fallback OpenAI-compatible |
| `context/provider.ts` (cryptocurrency.cv) | ✅ Produção (mas só crypto) | SIM | Adiciona ForexFactory + Finnhub para macro |
| SQLite schema | ⚠️ 4 órfãs | PARCIAL | Remove `ensemble_weights`/`drift_alerts` se não usar; ou implementa |

---

# 5. NEW COMPONENTS

## 5.1 Componentes a criar

| Componente | Local | Propósito |
|---|---|---|
| `src/market/forex/dukascopy.ts` | novo | Adapter `dukascopy-node` para Forex backtest (tick+OHLCV) |
| `src/market/forex/polygon.ts` | novo | Adapter `@polygon.io/client-js` para FX live |
| `src/quant/structure.ts` | novo | Swing highs/lows, BOS, CHoCH, equal highs/lows |
| `src/quant/liquidity.ts` | novo | Previous H/L, session H/L, round numbers, sweep detection |
| `src/quant/smc.ts` | novo | Order blocks, FVG, displacement — TESTÁVEIS |
| `src/quant/microstructure.ts` | novo | OFI, CVD, tick velocity, spread percentile |
| `src/quant/volatility.ts` | novo | ATR percentile, realized vol, clustering, range |
| `src/quant/sessions.ts` | novo | Asia/London/NY/overlap, session H/L |
| `src/quant/candles.ts` | novo | Engulfing, pin bar, doji, momentum, rejection |
| `src/macro/calendar.ts` | novo | ForexFactory/CPI/NFP/FOMC + news lock |
| `src/context/crossasset.ts` | novo | DXY, yields, gold (futures), equities |
| `src/models/probability.ts` | novo | Logistic regression + Platt scaling + reliability diagram |
| `src/models/walkforward.ts` | novo | Walk-forward genuíno com janelas rolantes |
| `src/models/calibration.ts` | novo | Isotonic/Platt + Brier + ECE + reliability diagram |
| `src/signal/timing.ts` | novo | Entry delay 0s/5s/10s/15s/30s aprendido |
| `src/signal/countdown.ts` | novo | server_time + latency tracking |
| `src/signal/lifecycle.ts` | novo | Estado do sinal: created → analyzing → ... → resolved |
| `src/signal/score.ts` | novo | Opportunity score (prob + contexto + execução) |
| `src/signal/invalidation.ts` | novo | Cancelamento durante countdown |
| `src/risk/bankroll.ts` | novo | Position sizing + drawdown + cooldown + kill switch |
| `src/execution/validator.ts` | novo | Gate final: signal_valid && broker_match && ... |
| `src/execution/paper.ts` | novo | Paper executor com mesmo fluxo (não otimista) |
| `src/server/sse.ts` | novo | SSE endpoint para push de sinal |
| `src/gauntlet/` | novo (pasta) | Pipeline de validação (12 passos) |
| `src/audit/probabilityAuditor.ts` | novo | Reliability diagram + bins + auditoria 80% |

## 5.2 Tabelas a adicionar/corrigir

```sql
-- Adicionar gross_return_pct a shadow_trades
ALTER TABLE shadow_trades ADD COLUMN gross_return_pct REAL;

-- Nova tabela para reliability diagram (calibração estruturada)
CREATE TABLE calibration_bins (
  bucket_lo REAL NOT NULL,
  bucket_hi REAL NOT NULL,
  predicted_count INTEGER NOT NULL,
  predicted_mean REAL NOT NULL,
  actual_win_rate REAL NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  PRIMARY KEY (bucket_lo, bucket_hi, period_start)
);

-- Nova tabela para audit log completo
CREATE TABLE signal_audit (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  pair TEXT NOT NULL,
  broker_symbol TEXT,
  timeframe TEXT NOT NULL,
  direction TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  entry_at INTEGER,
  expiration_at INTEGER,
  entry_reference_price REAL,
  actual_entry_price REAL,
  expiration_price REAL,
  probability_raw REAL,
  probability_calibrated REAL,
  opportunity_score REAL,
  expected_value REAL,
  setup TEXT,
  regime TEXT,
  session TEXT,
  spread_at_signal REAL,
  latency_ms INTEGER,
  model_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  status TEXT NOT NULL,
  invalidation_reason TEXT,
  result TEXT,
  audit_metadata TEXT
);
CREATE INDEX idx_signal_audit_created_at ON signal_audit(created_at);
CREATE INDEX idx_signal_audit_pair_tf ON signal_audit(pair, timeframe);
```

## 5.3 Bibliotecas externas a adotar

| Lib | Licença | Uso |
|---|---|---|
| `dukascopy-node` | MIT | Forex backtest tick data |
| `@polygon.io/client-js` | MIT | FX live + stocks + crypto |
| `technicalindicators` | MIT | Indicadores técnicos JS (alternativa: `trading-signals` MIT) |
| `ccxt` | MIT | Multi-exchange cripto L2 (mantém Binance via REST direta) |

**Não adotar:** `ta-lib` (LGPL), `tulind` (LGPL), `IQ Option unofficial API` (risco regulatório).

---

# 6. REPOSITORY RESEARCH

| Repo | Licença | Decisão | Razão |
|---|---|---|---|
| nautechsystems/nautilus_trader | LGPL-3.0 | REFERENCIAR | Engine Rust de alta perf; copyleft fraco exige revisão jurídica para uso comercial |
| QuantConnect/Lean | Apache-2.0 | REFERENCIAR | Arquitetura completa de backtesting; referência metodológica |
| StockSharp/StockSharp | Apache-2.0 | NÃO USAR | Stack .NET pesada, sem overlap microstructure |
| AI4Finance-Foundation/FinGPT | MIT | REFERENCIAR | LLMs finanças — só como referência de prompts |
| AI4Finance-Foundation/FinRobot | Apache-2.0 | REFERENCIAR | Multi-agent LLM; pouca microstructure |
| OANDA-Trading-API | (URL morta) | USAR SPECS DIRETO | Implementar cliente HTTP próprio contra `developer.oanda.com/rest-live-v20` |
| EarnForex/PositionSizer | Apache-2.0 | **REUTILIZAR (lógica)** | Fórmulas de position sizing Forex prontas |
| gregorian-09/mqt-microstructure | MIT | ADAPTAR | Projeto novo focado em microstructure |

**Veredito do crítico de bibliotecas JS (`a1c17c1e69bd87dbd`):**
- **Indicadores:** JS é decente (`technicalindicators` MIT, `trading-signals` MIT).
- **Forex data:** `dukascopy-node` (free, tick-grade) + cliente próprio OANDA v20 REST.
- **Microestrutura FX real (L2 book, queue position):** **NÃO EXISTE** em JS maduro. Único caminho: sidecar Python ou aceitar gap.
- **Recomendação pragmática:** posicionar TRACECON primariamente em **cripto L2** (ccxt + WebSocket Binance) + **FX retail** (dukascopy-node + OANDA).

---

# 7. DATA SOURCES

| Fonte | Tipo | Custo | Uso |
|---|---|---|---|
| Binance REST/WS | Crypto | Free | ✅ Já integrado (produção) |
| cryptocurrency.cv | Crypto news | Free | ✅ Já integrado |
| Anthropic API (via nexxus-pro) | LLM | Pago por token | ✅ Já integrado |
| Dukascopy (via dukascopy-node) | Forex tick/OHLCV | Free | ➕ Backtest Forex |
| Polygon.io | FX + stocks + crypto | Free tier + pago | ➕ Live FX + cross-asset |
| OANDA v20 | FX execution + paper | Free tier | ➕ Paper trading FX |
| ForexFactory | Economic calendar | Free scraping | ➕ Macro events |
| TradingView | Charting | Free scraping | ➕ Visão humana |
| Yahoo Finance | Stocks/ETFs | Free | ➕ Cross-asset contexto |

---

# 8. QUANTITATIVE DESIGN

## 8.1 Pipeline de probabilidade

```
FEATURES (causais)
   │
   ├─→ [similarity] (k-NN no histórico)
   ├─→ [logistic regression] (supervisionada)
   ├─→ [gradient boosting] (se XGBoost/LightGBM disponível)
   │
   ▼
RAW PROBABILITIES
   │
   ▼
PLATT SCALING (ou isotonic regression)
   │
   ▼
WILSON CI (lower/upper em α=0.05)
   │
   ▼
IS_ACTIONABLE (calibrated_prob - baseline > margin)
   │
   ▼
EDGE × PROB × PAYOUT → EXPECTED VALUE
   │
   ▼
OUTPUT: {probability, ciLower, ciUpper, baseline, expectedValue, actionable}
```

## 8.2 Modelos candidatos (avaliar via OOS)

| Modelo | Quando usar | Licença (lib JS) |
|---|---|---|
| Similarity-based k-NN | Baseline; sempre disponível | próprio |
| Logistic regression | Edge linear; rápido | `regression` npm MIT |
| Gradient boosting | Não-linear; precisa GPU | sidecar Python (`lightgbm`) |
| HMM regime detection | Quando features mostram transição | `hmm` Python |
| Transformer tabular | N datasets > 100k | sidecar Python |

**Regra:** começar simples (similarity + logreg). Só adicionar complexidade se OOS provar ganho.

## 8.3 Features candidatas (Caminho 1 do diagnóstico)

| Feature | Por quê | Sinal esperado |
|---|---|---|
| `atr_pct` (existente) | Captura volatilidade | já existe; |r|=0.055 |
| `atr_change` | Expansão vs contração | candidato |
| `volume_zscore` | Anomalia de volume | candidato |
| `candle_body_pct` | Momentum intrabar | candidato |
| `high_low_range_pct` | Stress intrabar | candidato |
| `order_flow_imbalance` (micro) | Pressão compradora/vendedora | novo (L2) |
| `cumulative_volume_delta` | Acumulação/distribuição | novo (L2) |

**Teste empírico primeiro** (`diag_hypb_features.ts`): cada feature deve ter |r| ≥ 0.08 em pelo menos uma direção antes de ser integrada.

## 8.4 Horizonte adaptativo

O sistema testa **múltiplos horizontes** (15s, 30s, 45s, 60s, 90s, 120s) e escolhe aquele em que a probabilidade empírica tem o melhor edge **estatisticamente significativo** vs baseline.

---

# 9. CALIBRATION DESIGN

## 9.1 Reliability diagram (binning)

10 bins uniformes [0, 1]:

| Bin | Predicted | Actual | n | Status |
|---|---|---|---|---|
| 0.0–0.1 | X% | Y% | n | CAL/UNCAL |
| 0.1–0.2 | X% | Y% | n | CAL/UNCAL |
| ... | ... | ... | ... | ... |
| 0.9–1.0 | X% | Y% | n | CAL/UNCAL |

**Status CAL** se `|predicted − actual| < 0.05` e `n ≥ 30`.
**Status UNCAL** se gap ≥ 0.05 OU n < 30.

## 9.2 Métricas de calibração

| Métrica | Fórmula | Limite saudável |
|---|---|---|
| Brier score | `(1/N) Σ (p_i − o_i)²` | < 0.20 |
| Log loss | `−(1/N) Σ [o·log(p) + (1−o)·log(1−p)]` | < 0.69 (aleatório) |
| ECE | média ponderada `|acc − conf|` por bin | < 0.05 |
| MCE | max `|acc − conf|` por bin | < 0.10 |

## 9.3 Auditoria do "80%"

```sql
-- Pseudo-código
SELECT
  bucket,
  COUNT(*) as n,
  AVG(probability) as predicted_mean,
  AVG(outcome) as actual_win_rate,
  ABS(AVG(probability) - AVG(outcome)) as gap
FROM decision_records
WHERE probability IS NOT NULL
  AND outcome IN ('hit', 'miss')
  AND created_at >= ? -- period_start
GROUP BY bucket
HAVING n >= 30
ORDER BY predicted_mean;
```

**Regra de bloqueio:** se bucket `[0.80, 0.85)` tem gap ≥ 0.10 E n ≥ 100, o sistema **bloqueia o sinal** até retreinar.

## 9.4 Implementação

| Local atual | Adicionar |
|---|---|
| `src/analytics/calibration.ts` | Exportar `bins: Array<{lo, hi, count, predictedMean, actualMean}>` |
| `src/analytics/calibration.ts` | `plattScale(rawProb, plattA, plattB)` (sigmoid calibrado) |
| `src/store/db.ts` | Tabela `calibration_bins` para histórico |
| `src/http/api.ts` | Rota `/api/analytics/calibration/bins?days=N` |

---

# 10. M1 DESIGN

## 10.1 Camadas de análise (M1)

| TF | Papel | Engine |
|---|---|---|
| D1 | Regime macro | `volatility` + `regime` |
| H4 | Contexto | `structure` + `confluence` |
| H1 | Tendência | `confluence` + `liquidity` |
| M15 | Estrutura | `swing/BOS/CHoCH` + `equal H/L` |
| M5 | Setup | `candles` + `SMC/OB/FVG` |
| M1 | Timing | `candles` + `microstructure` |

## 10.2 Decisão M1

```
M5 (estrutura bullish confirmado)
   AND M1 (microstructure OFI positivo)
   AND H1 (regime trending)
   AND vol (não excessivo)
   AND spread (aceitável)
   AND news (sem evento em 5min)
   AND historical similarity (M1 horizon, 80%+ edge OOS)
   AND calibrated probability ≥ 0.80
   → SIGNAL "BUY" with confidence
   → ENTRY TIMING: 0s (now)
   → EXPIRATION: 60s
   → INVALIDATION: spread > 2x OR news OR structure break
```

## 10.3 Sem truques

- **Não** usar M1 candle sozinho — é só timing.
- **Não** assumir que M1 = edge de 60s; é só o timeframe de execução.
- **Não** ignorar custo: spread + slippage pode destruir edge em M1.

---

# 11. ENTRY TIMING DESIGN

## 11.1 Pipeline

```
SIGNAL DETECTED (prob=0.82)
   │
   ▼
ENTRY DELAY ESTIMATOR (per-setup, aprendido via OOS)
   - Setup X: 0s ideal (OOS win 81%)
   - Setup Y: 30s ideal (OOS win 84%)
   - Setup Z: nunca (OOS win 52% — WAIT)
   │
   ▼
TIMING = max(0s, learned_delay_for_setup)
   │
   ▼
COUNTDOWN UI: 30, 29, ..., 3, 2, 1, 0 → ENTRY
```

## 11.2 Sincronização

```typescript
interface SignalTiming {
  server_time: number;        // epoch ms do backend
  signal_created_at: number;
  entry_at: number;           // server_time + entry_delay_s * 1000
  expiration_at: number;      // entry_at + horizon_s * 1000
  signal_id: string;
}
```

A extensão calcula `remaining = entry_at - (server_time + clock_offset)` e renderiza countdown.

## 11.3 Invalidation durante countdown

| Evento | Ação |
|---|---|
| spread > 2x baseline | CANCELLED |
| Estrutura mudou (BOS contra) | CANCELLED |
| News de alto impacto em <5min | CANCELLED |
| Latência > 500ms | CANCELLED |
| Clock drift > 200ms | CANCELLED |
| Pair mismatch com broker | EXECUTION BLOCKED |

---

# 12. BROKER SYNC DESIGN

## 12.1 Detecção de contexto

A extensão detecta automaticamente (quando tecnicamente possível):

```typescript
interface BrokerContext {
  broker: "binance" | "tradingview" | "iqoption" | "exodus";
  pair: string;            // ex: "EURUSD" ou "BTCUSDT"
  timeframe: string;       // ex: "M1", "1h"
  price?: number;
  bid?: number;
  ask?: number;
  spread?: number;
  timestamp: number;       // quando o contexto foi lido
}
```

## 12.2 Validação de consistência

```typescript
interface ContextValidator {
  validate(tracecon: Signal, broker: BrokerContext): ValidationResult;
}

interface ValidationResult {
  ok: boolean;
  reasons: string[];  // motivos de bloqueio
  price_deviation_pct?: number;
  timestamp_drift_ms?: number;
}
```

**Critérios de bloqueio:**
- `broker.pair !== signal.pair` → "PAIR MISMATCH"
- `broker.timeframe !== signal.timeframe` → "TIMEFRAME MISMATCH"
- `|broker.price - signal.entry_reference_price| / signal.entry_reference_price > 0.5%` → "PRICE DRIFT"
- `|now - broker.timestamp| > 5s` → "STALE BROKER CONTEXT"

## 12.3 Extensão UI

```
EUR/USD M1 (broker) vs GBP/JPY M1 (sinal) → PAIR MISMATCH

[aviso amarelo]
"Melhor oportunidade: GBP/JPY BUY 84%
Mas esta plataforma mostra EUR/USD M1.
Mude para GBP/JPY ou aguarde."
```

---

# 13. BANKROLL DESIGN

## 13.1 Configuração

```typescript
interface BankrollConfig {
  initialBankroll: number;        // R$ 50.00
  maxRiskPerTrade: number;       // 2% = R$ 1.00
  maxDailyLossPct: number;        // 5% = R$ 2.50
  maxTotalDrawdownPct: number;    // 20% = R$ 10.00 → kill switch
  maxConsecutiveLosses: number;   // 5 → cooldown 1h
  payout: number;                // ex: 0.85 (85% payout)
  maxOperationsPerDay: number;    // 20
}
```

## 13.2 Position sizing dinâmico

```
edge = calibrated_prob - baseline
expected_value = prob * payout - (1 - prob)
kelly_fraction = edge / payout
safe_fraction = kelly_fraction * safety_multiplier (0.25)
position_size = min(
  safe_fraction * bankroll,
  maxRiskPerTrade * bankroll,
  remaining_daily_loss_budget
)
```

**Regras anti-martingale:**
- Após 2 losses consecutivas: `position_size *= 0.5`
- Após 3 losses: `position_size *= 0.25` + cooldown 30min
- Após 5 losses: KILL SWITCH (manual reset)

## 13.3 Persistência

```sql
CREATE TABLE bankroll_state (
  id INTEGER PRIMARY KEY CHECK (id=1),
  initial_bankroll REAL NOT NULL,
  current_bankroll REAL NOT NULL,
  peak_bankroll REAL NOT NULL,
  daily_loss_pct REAL NOT NULL,
  total_drawdown_pct REAL NOT NULL,
  consecutive_losses INTEGER NOT NULL,
  consecutive_wins INTEGER NOT NULL,
  cooldown_until INTEGER,
  kill_switch_active INTEGER NOT NULL DEFAULT 0,
  last_updated_at INTEGER NOT NULL
);
```

---

# 14. GAUNTLET DESIGN

Toda alteração importante passa pelos **12 passos**:

```
STEP 1  — BASELINE
  Registre: commit, parâmetros, dataset, período, métricas, modelo,
            features, custos, resultados.
  Arquivo: docs/gauntlet/baseline_<commit>.json

STEP 2  — HYPOTHESIS
  Defina exatamente o que será melhorado.
  Exemplo: "Adicionar liquidity sweep deve melhorar precisão OOS
  do setup X em ≥ 5%."

STEP 3  — IMPLEMENT
  Alteração mínima, isolada em feature branch.
  Patch pequeno. Nada de "big bang".

STEP 4  — UNIT TEST
  Rode: `npm test`
  Critério: 0 falhas, 0 skipped além do baseline.

STEP 5  — TYPECHECK
  Rode: `npm run typecheck`
  Critério: 0 erros TS.

STEP 6  — BUILD
  Rode: `npm run build`
  Critério: 0 warnings, build limpo.

STEP 7  — INTEGRATION TEST
  Rode: `npm run smoke`
  Critério: /health 200 OK, /api/analyze retorna 200.

STEP 8  — BACKTEST
  Rode: walk-forward genuíno (janelas rolantes)
  Período: 1 ano OOS
  Critério: edge OOS > 0 (com CI Wilson lower > 0)

STEP 9  — WALK-FORWARD
  5 folds: train 60% / validate 20% / test 20%
  Critério: cada fold OOS tem edge > 0

STEP 10 — OUT-OF-SAMPLE
  Período: 90 dias nunca tocado por qualquer treino
  Critério: edge > 0, Brier < 0.20, ECE < 0.05
  Bloqueio: se STEP 9 usou esses 90 dias, contaminado → reject

STEP 11 — STRESS TEST
  Simule: spread × 5, latency × 3, vol × 2, news event, missing data
  Critério: edge OOS ainda > 0 após stress

STEP 12 — COMPARE & DECISION
  Compare com baseline (STEP 1).
  APPROVE / REJECT.
```

## 14.1 Critério de aprovação

| Critério | Threshold |
|---|---|
| Edge OOS | > 0 com CI Wilson lower > 0 |
| Brier score | < 0.20 |
| ECE | < 0.05 |
| Sharpe OOS | > 1.0 |
| Max drawdown OOS | > -10% |
| n_amostras | ≥ 100 trades OOS |
| Anti-overfit check | Brier in-sample vs OOS gap < 20% |

## 14.2 Multi-testing awareness

Se rodar 5 hipóteses na mesma OOS, aplicar correção de Bonferroni-Holm:
- Threshold efetivo de p-value = α / 5 = 0.01
- Se OOS edge é marginal em uma das hipóteses, ajustar.

---

# 15. IMPLEMENTATION PLAN

| Etapa | Escopo | Dependências | Duração | Status |
|---|---|---|---|---|
| **E1** | Auditoria completa + Documento de Entrega | — | ✅ FEITO | Este doc |
| **E2** | Fix bugs P-A a P-G (backtest) | E1 | 2-3 semanas | TODO |
| **E3** | Schema fix (gross_return_pct, signal_audit) | E1 | 1 semana | TODO |
| **E4** | Forex data adapters (dukascopy, polygon, OANDA) | E1 | 3-4 semanas | TODO |
| **E5** | Estrutura + Liquidity + Candles + SMC engines | E1 | 4-6 semanas | TODO |
| **E6** | Volatility + Sessions + Regime + Microstructure | E5 | 4-6 semanas | TODO |
| **E7** | Macro/News + Cross-asset | E1 | 2-3 semanas | TODO |
| **E8** | Probability engine + Platt scaling + Reliability | E2 | 3-4 semanas | TODO |
| **E9** | Walk-forward genuíno (substituindo single-query) | E2 | 2 semanas | TODO |
| **E10** | Multi-pair scanner (universe configurável) | E5, E6 | 3-4 semanas | TODO |
| **E11** | Entry timing + countdown sincronizado | E8 | 2-3 semanas | TODO |
| **E12** | Signal engine (lifecycle completo) | E8, E11 | 2-3 semanas | TODO |
| **E13** | Bankroll/Risk engine + Kill switch | E8 | 2 semanas | TODO |
| **E14** | Paper executor (mesmo fluxo, não otimista) | E12, E13 | 2 semanas | TODO |
| **E15** | Gauntlet Loop (12 passos) — framework | E8, E9 | 2-3 semanas | TODO |
| **E16** | Chrome extension v2 (countdown + IQ Option sync) | E11 | 2-3 semanas | TODO |
| **E17** | Broker context detection (multi-corretora) | E11 | 2 semanas | TODO |
| **E18** | Execution Validator (gate final) | E13, E14, E17 | 1-2 semanas | TODO |
| **E19** | SSE/WebSocket real-time signaling | E12 | 1-2 semanas | TODO |
| **E20** | Probability Auditor (bin reliability diagram) | E8 | 1 semana | TODO |
| **E21** | Deployment persistente (Railway) | E1 | 1 semana | ✅ JÁ PARCIAL |

**Total estimado:** 35-50 semanas de trabalho full-time. **Não é realista fazer tudo.** Recomendação de priorização no documento de entrega final.

---

# 16. RISKS

## 16.1 Riscos técnicos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Binance bloqueia IP serverless (HTTP 451) | Alta | Sistema inativo em produção | Railway long-running + IP fixo |
| node:sqlite indisponível em alguns ambientes | Média | Falta persistência | Fallback noop (já existe) |
| dukascopy-node quebra com mudança de API | Média | Backtest Forex inativo | Pin versão + cliente próprio |
| Anthropic gateway rate-limit | Média | AI inativa | Multi-key + fallback OpenAI-compatible |
| Vercel cold-start > 5s | Alta | UX ruim no primeiro hit | Edge function warm-up |

## 16.2 Riscos estatísticos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| **Edge falso-positivo por overfitting** | Alta | Sistema operacionaliza ruído | OOS guard + multi-testing + reality-check |
| **Calibração drift** (motor decalibra ao longo do tempo) | Alta | "80%" vira 60% | `model_daily_metrics` + drift detector + retraining |
| **Regime change** (mercado vira lateral) | Alta | Edge histórico desaparece | Regime-specific modeling + WAIT em regime desconhecido |
| **SMC/ICT sem edge** | Alta | Adicionar complexidade sem ganho | Cada conceito testável; sem edge → sem peso |
| **Spread/slippage destrói edge M1** | Alta | Edge detectado vira prejuízo real | Backtest com custos; stress test spread × 5 |

## 16.3 Riscos operacionais

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| **Auto-execution ON** dispara trade sem gate humano | Média | Perda financeira | AUTO ON ainda exige validador + log. AI nunca chama execução. |
| **Bankroll explosion** | Baixa | Perda > tolerância | Kill switch + max bet + cooldown |
| **Extension bug** gera sinal falso | Média | Usuário age sobre sinal falso | Bypass na extensão: tudo passa pelo backend authoritative |
| **Signal velho re-executado** | Baixa | Posição duplicada | `signal_id` idempotency check |

## 16.4 Riscos regulatórios

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Operação em corretora sem licença | Média | Multa/banimento | Disclaimer + UI diz "você decide" |
| Auto-execution em IQ Option pode violar ToS | Média | Conta banida | TRACECON nunca executa (só mostra) |

---

# PRÓXIMOS PASSOS

1. **Este documento deve ser aprovado pelo operador antes de qualquer implementação.**
2. Após aprovação, começar pela **Etapa E2** (fix bugs do backtest) — base para qualquer retreino honesto.
3. **Não** adicionar features novas enquanto P-A (calibragem Platt) não estiver resolvido.
4. Toda nova feature passa pelo **Gauntlet Loop** (12 passos).
5. Toda métrica de "edge" reportada é **OOS, calibrada, com banda de confiança**.

---

**Aprovação necessária:** ❌ Pendente gate humano.
