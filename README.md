# TRACECON

## Operação reconstruída (2026-09-22) — Binary OTC 300s

A operação do relay foi reconstruída para **UM único caminho**:

- **BINARY OTC only** · **300 segundos only** (bucket de 5 min) · **candle nativo 5s da IQ** · **contexto de até 3h por ativo**.
- **Uma inteligência:** AssetContext → FeatureEngine (1x por atualização) → 5 especialistas (RSI, DMI/ADX, Bollinger, ATR, PriceAction) → Consensus **BUY/SELL/WAIT sem confidence** → DecisionSnapshot imutável.
- **Um caminho de execução:** DecisionSnapshot → Revalidation → Binary300Timing → ExecutionGate → AccountRouter (PRACTICE/REAL) → `requestOrder` (fronteira única de broker).
- **PRACTICE e REAL usam a mesma inteligência**; a conta é escolhida só no router. REAL é fail-closed e fica **desarmado após deploy**.
- **Sem Blitz**, sem runners antigos, sem auto-tuning. `PULLBACK_4060_300_AGENTIC_V2` (`sha256:3e9364e2...`, manifesto em `estrategias/strategy-versions/`) é a única estratégia operacional; baseline congelada em `archive/baseline/PULLBACK_4060_300_BASELINE/`.
- Testes/invariantes: `node scripts/run-all-tests.mjs` (suítes + invariantes + smoke). CI em `.github/workflows/ci.yml`.

Detalhes de estratégia/configuração: `docs/ESTRATEGIA-E-CONFIGURACAO.md`. Estado/handoff: `AGENTS.md`.

Sistema de **inteligência e análise de mercado** — não é corretora. Não executa
ordens, não custodia dinheiro, não fabrica dados. Investiga um cenário antes de
concluir e pode responder **WAIT** quando não há evidências suficientes.

- **Dados reais** de mercado (Forex auto via OANDA/Yahoo ou Binance para cripto) — nunca inventados.
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

Node ≥ 22 (usa `node:sqlite`, `fetch` e `WebSocket` nativos — sem builds nativos).

## Rodar

```bash
npm install

# 1) Dados reais (Forex auto ou Binance cripto, sem chave) + IA (Anthropic ou gateway
#    compatível, ex.: nexxus-pro) + API + web app:
copy .env.example .env

# Defina ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL + ANTHROPIC_MODEL
# (modelo default: claude-opus-5). Alternativas no gateway nexxus-pro:
#   claude-fable-5, claude-sonnet-5, claude-opus-4-8, claude-opus-4-7,
#   claude-sonnet-4-6, claude-haiku-4-5.
# Defina MARKET_DATA_MODE=auto para Forex real (OANDA se configurado, Yahoo Forex público como fallback) ou binance para cripto; opcionalmente TRACECON_API_TOKEN.
npm run build
npm run serve        # http://localhost:8788
```

### Sem chave de IA?

Sem `ANTHROPIC_API_KEY` o agente roda em modo estático (dry-run): exercita
o pipeline com ferramentas reais mas **não inventa dados** — em modo noop
as leituras voltam `DATA_UNAVAILABLE` e a conclusão tende a **WAIT**, que é
o comportamento correto quando não há fonte confiável.

### Gateways compatíveis

O cliente usa o protocolo Anthropic Messages API (`POST /v1/messages`),
via `fetch` nativo. Qualquer gateway que exponha esse contrato funciona —
basta apontar `ANTHROPIC_BASE_URL`. Os modelos do seu gateway podem ser
descobertos em `GET {ANTHROPIC_BASE_URL}/v1/models`.

## CLI

```
npm run market:ui      UI técnica do pipeline de dados
npm run quant          features quantitativas (indicadores/regime/estrutura)
npm run backtest       backtest + prob. empírica (split OOS)
npm run shadow-validation  validação shadow causal com dados reais (500–1.000 sinais)
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
