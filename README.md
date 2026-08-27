# TRACECON

Sistema de **inteligência e análise de mercado** — não é corretora. Não executa
ordens, não custodia dinheiro, não fabrica dados. Investiga um cenário antes de
concluir e pode responder **WAIT** quando não há evidências suficientes.

- **Dados reais** de mercado (Binance REST/WebSocket, verificados) — nunca inventados.
- **Motor quantitativo** determinístico (SMA/EMA/RSI/MACD/ATR/Bollinger/ADX/VWAP,
  volatilidade, suporte/resistência, market structure, regime detection).
- **Backtest + probabilidade empírica** (favoráveis/amostra, CI, out-of-sample,
  sem look-ahead — com testes de integridade).
- **Fusão de evidências + contraponto** → decisão analítica **BUY / SELL / WAIT**
  com fatores favoráveis, contrários e invalidadores.
- **Notícias reais** verificadas (com fonte, timestamp e credibilidade) + viés léxico.
- **Extensão de navegador** (Side Panel, MV3) ao lado da corretora real.
- **API HTTP** + **UI web** + **aprendizado estatístico** (registro → validação → calibração).

## Regras invariantes

1. Nunca inventar dados (preço, candle, volume, notícia, probabilidade, fonte).
2. "Aguardar" (WAIT) é decisão válida.
3. A IA é orquestradora de ferramentas; a matemática é do motor quantitativo.
4. Sem look-ahead: decisão histórica só usa dados da época.
5. Auditoria: cada análise é reconstruível (input → dados → indicadores → fontes →
   evidências → contraprovas → fusão → decisão).
6. Secrets só no servidor; nunca em browser/bundle/log.

## Requisitos

Node ≥ 20 (usa `node:sqlite`, `fetch` e `WebSocket` nativos — sem builds nativos).

## Rodar

```bash
npm install

# 1) Dados reais (Binance, sem chave) + API + web app:
#    configure o ambiente
copy .env.example .env

# defina MARKET_DATA_MODE=binance (dados reais) e, opcional, TRACECON_API_TOKEN
npm run build
npm run serve        # http://localhost:8788
```

### Sem dados reais?

Se `MARKET_DATA_MODE=noop`, a Tracecon retorna `DATA_UNAVAILABLE` /
`PROVIDER_NOT_CONFIGURED` e as decisões tendem a **WAIT** — exatamente o
comportamento correto quando não há fonte confiável. Nada é estimado.

## CLI

```
npm run market:ui      UI técnica do pipeline de dados
npm run quant          features quantitativas (indicadores/regime/estrutura)
npm run backtest       backtest + prob. empírica (split OOS)
npm run decide         fusão de evidências → decisão (registra + valida)
npm run news           notícias reais + viés léxico
npm run serve          API HTTP + web app (http://localhost:8788)
```

## Estrutura

```
src/market/     Real Market Data Engine (provenance, qualidade, agregador, integridade)
src/quant/      Quantitative Engine (determinístico, testável, sem look-ahead)
src/backtest/   Similaridade + probabilidade empírica + OOS
src/fusion/     Fusão de evidências + risco + contraponto → BUY/SELL/WAIT
src/context/    Notícias reais (cache, viés léxico)
src/analytics/  Registro → validação posterior → calibração estatística
src/http/       API HTTP + web app
src/tools/      Tool registry + tools Groq (orquestradas pela IA)
extension/      Extensão de navegador (Side Panel, MV3)
docs/           Roadmap e documentação de provedores
```

## Deploy

- **Railway** (recomendado para backend + WebSocket): processo long-running
  `npm run serve` (ver `railway.json`, `healthcheck /health`).
- **Vercel**: serverless API (`api/http.ts`) — sem WebSocket contínuo; use
  Railway para stream real-time.
- **Supabase**: Postgres gerenciado (adapter futuro; repo preparado p/ multi-tenancy).

> Defina no serviço as variáveis do `.env` (ex.: `MARKET_DATA_MODE`, `GROQ_API_KEY`,
> `TRACECON_API_TOKEN`, `HTTP_PORT`). Nunca suba o `.env` real.
