# TRACECON — Roadmap de desenvolvimento

> Documento vivo. Cada etapa é concluída apenas após testes, typecheck, build
> e verificação de integração. Nenhum dado é inventado; nenhuma feature é
> adicionada por "parecer interessante".

Lenda: ✅ concluída · 🔵 em andamento · ⚪ planejada · ⏸ pausada

---

## Resumo do estado

| # | Etapa | Status | Entrega principal |
|---|-------|--------|-------------------|
| 1 | Core + Agente (Groq) | ✅ | Fundação, tool registry, auditoria |
| 2 | Real Market Data Engine | ✅ | Binance REST+WS, pipeline, qualidade, integridade |
| 3 | Quantitative Engine | ✅ | Indicadores, regime, estrutura, regime detection |
| 4 | Backtest + Probabilidade Empírica | ✅ | Histórico amplo, similaridade, prob. observada, OOS, cold store |
| 5 | Fusão de Evidências + Contraponto | ✅ | Conflitos, risco, fusão → BUY/SELL/WAIT |
| 6 | Notícias / Web / Macro | ✅ | Fonte verificada, cache, viés léxico, conflito entre fontes |
| 7 | Serviço HTTP + API web | ✅ | Backend HTTP para extensão/web |
| 8 | UI web (app) | ✅ | Gerenciamento, histórico, métricas, planos |
| 9 | Extensão de navegador (Side Panel) | ✅ | Identificar plataforma/ativo/timeframe |
| 10 | Persistência + Validação estatística | ✅ | Cold store, aprendizado estatístico, calibração |

---

## Detalhe por etapa

### Etapa 1 — Core + Agente (Groq) ✅
- Estrutura modular TS, domínio, config segura de secrets, observabilidade.
- `MarketDataProvider` (interface/registry, `DATA_UNAVAILABLE`), `ToolRegistry`
  tipado (zod → JSON Schema), `GroqClient` (tool calling), `AgentEngine`
  (loop + safety/no-loop + auditoria), `Analysis` model, SQLite (`node:sqlite`).
- Regras: nunca inventar dados; WAIT é decisão válida; IA é orquestradora.

### Etapa 2 — Real Market Data Engine ✅
- Modelo canônico (`MarketCandle` c/ provenance), `CandleAggregator`
  (buckets UTC, dedup, **imutabilidade**), `DataQualityEngine`, `history`
  (paginação/retry/gaps), WebSocket com reconexão backoff+jitter,
  `MarketPipeline` (uma conexão → múltiplos consumidores), `MarketState`
  (fresh/stale/delayed), provider Binance (REST+WS, verificado real), serviço
  interno, `MarketContext`, catálogo de ativos, UI mínima.
- Docs de provedores: `docs/market-data/providers.md`.

### Etapa 3 — Quantitative Engine ✅
- Indicadores determinísticos: SMA/EMA/RSI/MACD/ADX/ATR/Bollinger/VWAP,
  momentum, ROC, volatilidade histórica, suporte/resistência (pivots),
  market structure (HH/HL/LH/LL), **regime detection**.
- `QuantEngine` fachada; `technicalScore` derivado de dados; enriquece
  `MarketContext`; tools Groq (`calculate_indicators/volatility/regime`);
  backfill de ~300 candles no pipeline.
- Testado: valores conhecidos, determinismo, **sem look-ahead**, sem NaN.

### Etapa 4 — Backtest + Probabilidade Empírica ✅
- **Similarity Engine** (`src/backtest/similarity.ts`): caracteriza setups com
  features causais (RSI, %SMA, slope, ATR%, volatilidade, MACD) e mede
  similaridade ponderada. `findSimilar` sem look-ahead (ou walk-forward p/ OOS).
- **Probabilidade empírica** (`probability.ts`): `prob = favoráveis/amostra`,
  CI Wilson e Agresti-Coull, baseline, metodologia, limitações. NUNCA
  inventada — se não há amostra, retorna null.
- **Backtester** (`backtest.ts`): varre histórico, splits in-sample/OOS,
  métricas (win rate, retorno, profit factor, max drawdown).
- **Tools Groq**: `find_similar_market_setups`, `calculate_empirical_probability`,
  `run_backtest`.
- **Cold store** (`store/repositories/candleRepository.ts`): tabela
  `market_candles` (dado real, dedup por PK, rejeita inválidos, detecta gaps);
  `run` persiste backfill no cold store; pronto p/ histórico amplo.
- **Observação estatística real (BTCUSDT 1h, 1000 candles)**: in-sample ~96% win
  vs OOS ~47% e prob. empírica 24.7% vs baseline 53.4% → indica **sem vantagem
  preditiva** no filtro genérico atual (overfitting). Sintoma correto/desejável:
  a Tracecon não finge vantagem; registra a amostra e alerta.
- Testado: prob. derivada, CI, determinismo, OOS, sem look-ahead, rejeição de
  dados inválidos, gap detection.

### Etapa 5 — Fusão de Evidências + Contraponto ✅
- `src/fusion/`: `RiskEngine` (score 0..1, unknown se sem dados) + `FusionEngine`
  (combina técnico + prob. empírica vs baseline + risco + contexto, SEMPRE
  buscando contrapontos) → BUY/SELL/WAIT c/ fatores favoráveis/contrários/
  invalidadores. `FusionService` orquestra quant+backtest+risco.
- Tool Groq `assess_market_decision`; CLI `npm run decide`.
- Validado ao vivo: BTCUSDT 1h → WAIT (prob 34% vs baseline) → contraprova bloqueia.

### Etapa 6 — Notícias / Web / Macro ✅
- Fonte verificado e keyless (`cryptocurrency.cv`): artigos reais c/ timestamps
  + credibilidade. `NewsService` com cache (TTL) + viés léxico auditável.
  Tool Groq `search_news`. Docs `docs/context/providers.md`. Notícias integradas
  à fusão (`getNewsBias`). Macro/calendário econômico = TODO (sem fonte verificada).

### Etapa 7 — Serviço HTTP + API web ✅
- `src/http/api.ts` (`TraceconHttpApi`): `/api/status|market|market/context|
  market/candles|quant|analyze|backtest|news|catalog|analytics/*`. Auth por
  bearer token (tempo-constante), token nunca exposto. CLI `npm run serve`.
- Verificado ao vivo (health/context/analyze/news).

### Etapa 8 — UI web (app) ✅
- `src/http/public/` (index.html + app.js + styles.css) servido como SPA
  vanilla → mercado, técnico, notícias, decisão e **fusão de evidências**.
  Roteamento estático seguro (bloqueia path traversal). Verificado ao vivo.

### Etapa 9 — Extensão (Side Panel) ✅
- `extension/` (Manifest V3): side panel + background SW (roteia → API local) +
  content script (deteção de plataforma/ativo/timeframe por marcadores
  verificáveis) + popup + options. Configurável (URL/token). Não executa ordens.
- Sintaxe dos JS validada; manifest OK. Integra com a API testada ao vivo.

### Etapa 10 — Persistência + Validação estatística ✅
- `analytics/service.ts` + `decisionRepository.ts`: registra decisão da fusão,
  valida outcome **posterior** (hit/miss/flat, tolerância mínima) e agregar
  win rate/retorno (calibração observada). Docs
  `docs/analytics/validação.md`. Endpoints `/api/analytics/*`.
- Causalidade garantida: validação só posterior; sem candle real → `pending`.
- `decide` registra + valida a cada execução; ciclo estatístico fechado.

---

## Princípios invariantes (aplicam-se a todas as etapas)
1. **Nunca inventar dados** — nada de preço/candle/volume/notícia/probabilidade fictícia.
2. **"Aguardar" é decisão válida** — não há obrigação de BUY/SELL.
3. **IA é orquestradora** — a matemática é do motor quantitativo (determinístico).
4. **Sem look-ahead** — decisão histórica só usa dados existentes à época.
5. **Auditoria** — cada análise reconstruível (input→dados→indicadores→fonte→evidência→fusão→decisão).
6. **Secrets só no servidor**; nunca em browser/bundle/log.
7. **Qualidade > velocidade** de implementação.
8. **Preparação para multi-tenancy** sem reescrever motores (interfaces de repositório, auth separada).
