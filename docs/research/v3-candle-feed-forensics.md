# V3 — P0 Candle Feed Forensics + Permanent Recovery

Data: 2026-09-23 (UTC) · Missão: investigar o desaparecimento de candles antes da auditoria live V3 e corrigir de forma permanente.
Resultado: **causa raiz comprovada** (bug no cliente de auditoria, não no feed) + **lacuna real corrigida** (sem backfill no boot/reconnect)
+ observabilidade por camadas + fail-closed com motivos. `READY_FOR_LIVE_AUDIT = YES`. Nenhuma ordem; 0 provider calls.

- V3 hash final: `sha256:04a7936741e12b7e9d1c7e940149d5fce5a9dcaacd541da532c602354dfcec9d`
  (linhagem: `a5a81fcc…` [pré-forense] → `7b066cd0…` [health+guard+backfill] → `04a79367…` [consistency patch 0.1/0.2])
- V2 frozen intocado: `sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0`
- Commits: `e0eadf8` (health+guard+shape), `cba8335` (backfill get-candles v2), `ecb6084` (predicate real/OTC/background), `07ae63f`/`9eefe49` (retry), `00086eb` (doc), + commit do consistency patch (0.1/0.2)
- Flags: `V3_AGENTS_ENABLED=false` · `V3_ENABLED=true` (OBSERVE_ONLY) · `AUTO_ARM_PRACTICE=false` · 0 ordens · 0 PATH_TEST

## 1. Caminho completo do candle (mapeado)

| Etapa | Arquivo / função |
|---|---|
| WS broker | `relay/iqoption-ws.mjs` — `IqWsClient.connect()` / subscribers (`candle-generated`, `candles-generated`) |
| Roteamento | `relay/iq-multi-runtime.mjs` — `#wire()` → `ingestEvent()` → `#onCandleEvent()` (match `enabled` + `activeId`) |
| Normalização | `relay/iqoption-ws.mjs` — `normalizeCandle()` (bucketStart/bucketEnd/OHLC/causalidade) |
| Store (RAM) | `relay/iq-multi-runtime.mjs` — `#ingestCandle()` → `ctx.candles` (Map por `bucketStart`, cap `MAX_CANDLE_BUFFER=600`) |
| Store (DB) | `relay/intelligence/candle-store.mjs` — `iq_candles_5s` (OTC, via `#pipeClosedCandle`) |
| API | `relay/server.mjs:452` → `wsRuntime.candlesBatch()` (`relay/iq-multi-runtime.mjs:1573`) |
| V3 | `#ingestCandle` → `v3.onClosedCandle({ candles: #candleList(ctx) })` → `measureAll` |

**`/api/iq/candles` lê o processo que recebe o WS (store em RAM, mesma instância).** Resposta: `{ rows: { [marketKey]: candle[] | null }, at, requested, found, unknown }`.

## 2. Causa raiz comprovada

### 2.1 O bloqueio reportado (count=0) era bug do CLIENTE de auditoria

O runner temporário da auditoria lia `payload[marketKey]`. A resposta real do endpoint é `payload.rows[marketKey]`
(`relay/iq-multi-runtime.mjs:1582`). Resultado: **null → `[]` → count=0 para todos os mercados**, sempre.
O feed nunca parou de servir os mercados habilitados.

Provas:
- 19:09:21Z — probe lendo `.rows`: `EURUSD:OTC = 120 candles`.
- 20:05:51Z — verificação com `.rows`: 3 mercados × 120 candles, ascending, step 5s, sem duplicatas, OHLC válido, age 1.5s.
- Mercados NORMAL e OTC com `candles5s=600` (buffer cheio) em `marketsSummary` durante todo o período "suspeito".
- O store só fica vazio para mercados **desabilitados** (linha `#onCandleEvent`: `market.enabled && activeId`), por desenho.

Sequência exata que produzia count=0: `fetch('/api/iq/candles?keys=X')` → `body.rows["X"] = [...]` → código lia `body["X"] = undefined` → `count=0`.

### 2.2 Lacuna REAL encontrada (e corrigida): sem backfill no boot/reconnect

Com o diagnóstico correto, o teste de restart controlado expôs que após restart a RAM zera e **não havia repopulação**:
- Boot 20:20:57Z: 96s depois, 19 candles/mercado (live-only). `candlesReceivedTotal=12178` vs `candlesStoredTotal=899`.
- V3 ficava ~200s em `INSUFFICIENT_CANDLES` (mínimo 40 candles), todo restart.

## 3. Camadas provadas separadamente (A/B/C/D)

| Camada | Métrica | Valor observado |
|---|---|---|
| A. WS CONNECTED | `candleFeed.wsConnected`, `connectionId` | true · `d1a3117d-f7f1-4969-ae12-fad257e6ef63` |
| B. SUBSCRIBED | `candleFeed.subscriptionCount` / `subscriptionState` por mercado | **53/53** mercados SUBSCRIBED |
| C. RECEIVING | `lastMarketMessageAt`, `lastCandleAt`, `ageMs` | fresco (~0.3–4.9s) |
| D. STORING | `storedCandles`, `candlesStoredTotal`, `historyLoadedTotal` | 120–331/mercado; total crescendo |

## 4. Correções implementadas (permanentes)

1. **Shape explícito no endpoint** (`candlesBatch`): `{ rows, at, requested, found, unknown }` — impossível confundir metadados com marketKeys.
2. **Health observável** (`relay/intelligence/candle-feed-health.mjs`): `wsConnected/authenticated/subscriptionCount/marketsExpected/marketsSubscribed/marketsWithCandles/lastMarketMessageAt/lastCandleAt/oldestCandleAt/ageMs/candlesReceivedTotal/candlesStoredTotal/historyLoadedTotal/reconnectCount/lastReconnectAt/lastSubscriptionAt/lastError/feedReady` + por mercado (`storedCandles/lastCandleAt/ageMs/subscriptionState/feedReady/reasons`), exposto em `GET /api/iq/status` (`candleFeed`, `marketsSummary`).
3. **Fail-closed com motivos** (`relay/v3/feed-guard.mjs` + `relay/v3/runtime.mjs`): `NO_CANDLE_HISTORY`, `INSUFFICIENT_CANDLES`, `CANDLE_FEED_STALE`, `CANDLE_FEED_DISCONNECTED`, `MARKET_NOT_SUBSCRIBED`; counters `candleFeedBlocked`/`feedBlockedReasons` em `v3/status.candleFeed`; **nenhum agente LLM é chamado** com feed inválido.
4. **Backfill real no boot/reconnect** (`relay/iqoption-ws.mjs#getCandlesHistory` via `get-candles` v2 + `relay/intelligence/candle-history.mjs`): só candles fechados, dedupe por `bucketStart`, buffer limitado, sem fabricar; OTC-only; em background (não bloqueia subscribe); retry a cada 60s por mercado com <40 candles.
5. **subscriptionState / lastSubscriptionAt / lastReconnectAt / lastError** — auditoria de reconnect/resubscribe no mesmo lugar.

## 5. Teste de restart controlado (obrigatório)

Redeploy do relay (`railway deployment redeploy`) em 2026-09-23 ~20:39Z:
- `startedAt` mudou: `1790195699350` → `1790195952314`; `connectionId` mudou `97712fa2…` → `d1a3117d…` → processo realmente reiniciado.
- 20:39:24 boot; 20:39:47 **subscriptions restauradas (53)**; 20:39:47–20:40:04 live enchendo (1→5);
- 20:40:10 **backfill concluído: 3/3 mercados representativos com 120 candles**; `feedReady=true` (~46s pós-boot);
- `historyLoadedTotal=6490`, `historyMarketsTotal=22` (OTC), `found=3/3` no endpoint, `unknown=[]`, `ageMs≈2.4s`, ascending/5s/OHLC ok/sem duplicatas.
- Antes da correção: 19 candles/mercado e ~200s de bloqueio. Depois: 120–330 candles imediatos.

## 6. Limitação comprovada do broker (não fabricada)

8 ativos OTC legados não retornam histórico em `get-candles` (resposta vazia/timeouts):
`EURUSD:OTC, GBPUSD:OTC, USDJPY:OTC, EURGBP:OTC, GBPJPY:OTC, AUDUSD:OTC, USDCAD:OTC, USDCHF:OTC`.
Eles **recuperam automaticamente pelo stream live** (~200s para 40 candles) e o retry de 60s continua tentando o histórico.
Os outros 22 mercados OTC (incl. pares cruzados, exóticos e BTCUSD) repopulam ~300 candles no boot.
V3 permanece fail-closed (`INSUFFICIENT_CANDLES`) nesses 8 durante o warm-up — sem chamar LLM, sem decidir.

## 7. Testes / build

- `tests/v3` + `tests/observability`: **100/100** (novos: `feed-fail-closed.test.ts`, `candle-feed-health.test.ts`, `candle-history.test.ts`).
- `v3-smoke`: 14/14 · `run-all-tests`: 25/25 · `npm run build`: OK.
- Regressão pega pelo teste: guard `Number(null)===0` aceitava candle com `close:null` — corrigido com checagem explícita de null.

## 8. Estado final

`V3_AGENTS_ENABLED=false` · `agentMode=DETERMINISTIC_OBSERVE` · `executionMode=OBSERVE_ONLY` · `executable=false` · PRACTICE auto OFF · REAL DISARMED ·
0 ordens · 0 PATH_TEST · Supabase `ROTATION_PENDING_EXTERNAL` intacto · V2 frozen intacto · V3 hash `7b066cd0…`.
`v3/status.candleFeed.blocked` com motivos explícitos (ex.: 3380 × `INSUFFICIENT_CANDLES` em mercados em warm-up), `agentCycles=0`.

## 9. READY_FOR_LIVE_AUDIT

**YES** — opportunities reais existem (429+/24h), feed real READY (22 OTC com histórico + 53 subscriptions), `/api/iq/candles` retorna candles reais,
restart/reconnect testado (recuperação automática em ~46s), V3 produz measurements reais sem fixture, runner da auditoria corrigido (`.rows`).
A auditoria dos 2 ciclos LLM **não foi executada** nesta missão (por instrução; 0 das 14 calls gastas).
