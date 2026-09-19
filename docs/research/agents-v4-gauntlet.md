# GAUNTLET V4 — criticas independentes, contraexemplos e correcoes

- **Escopo:** auditoria da rodada DataHub + `PROFESSIONAL_AGENT_SYSTEM_V4` (SHADOW).
- **Metodo:** o mesmo agente que construiu nao assina a auditoria. As quatro criticas abaixo foram
  executadas como lentes separadas (arquitetura, logica de trading, leakage, performance) com
  contraexemplos em teste; todo achado recebeu correcao e reteste.
- **Data:** 2026-09-19. **Resultado do reteste:** suite completa com 1 falha pre-existente de ambiente
  (`office-v3-perf` sob carga da maquina; passa isolado) e zero regressao funcional.

## 1. FRESH ARCHITECTURE CRITIC

| # | Achado | Severidade | Correcao | Prova |
|---|---|---|---|---|
| A1 | Risco de 12 agentes recalcularem indicadores | alta | bundle unico `buildAgentFeatures(t0)` consumido por todos | testes dos especialistas usam o bundle; engine mede tempo por agente |
| A2 | Ambiguidade de cenario disparava com competidores de MESMA direcao (travava TREND_CONTINUATION×TREND_PULLBACK) | alta | ambiguidade apenas com direcoes opostas | `agents-v4-specialists.test.ts` (ambiguidade=false para mesma direcao) |
| A3 | `validateEvent` rejeitava evento sem sequencia (sequencia `null` virava `0 <= 0`) | media | validacao null-safe | `datahub-event-bus.test.ts` (dedupe entrega 1x) |
| A4 | Observacao em memoria sem `payload` (auditoria quebrada) | media | payload anexado na observacao e no persist | `agents-v4-engine.test.ts` (policy/comites no payload) |
| A5 | Eventos do Agent Bus nao estavam no schema do DataHub | baixa | tipos `AGENT_STARTED`…`ERROR` adicionados | publicacao real no engine + bus valida |
| A6 | `ROUTER_POLICY` sem `sendsOrders` | baixa | campo adicionado | teste shadow-never-executes |
| A7 | Falha de runner V3 nao podia derrubar o router | alta | `try/catch` por runner; erro vira `action=ERROR` | teste de independencia (V3 lanca, G2/V4 intactos) |
| A8 | Hook no hot path poderia lancar | critica | `#safe` + `enabled` + fail-safe em todos os hooks | runtime hook test; engine nunca propaga erro |

## 2. TRADING LOGIC CRITIC

| # | Achado | Severidade | Correcao/decisao | Prova |
|---|---|---|---|---|
| T1 | Causa-raiz do “V3 100% WAIT”: velocity/acceleration descartados no plumbing | critica | T0 enriquecido expoe velocity/acceleration + regime com limiar alcancavel | regime TREND_UP/TREND_DOWN alcancaveis em teste |
| T2 | Votacao burra (7 bullish ⇒ BUY) | critica | gating por componente fundamental do cenario | 9 agentes bullish com MOMENTUM STABLE ⇒ WAIT |
| T3 | Entrada por contexto sem gatilho | alta | `triggerState=CONTEXT_OK_NO_TRIGGER` ⇒ WAIT | teste dedicado |
| T4 | RANGE_MEAN_REVERSION sem rejeicao | alta | exige `rejectionUp/Down` + extremo | teste sem/com rejeicao |
| T5 | BREAKOUT sem qualidade de candle | media | exige `bosUp/Down` (nao “pavio”) + price action | cenario BREAKOUT com bodyRatio |
| T6 | Red team poderia “inverter” a direcao | critica | conflito material ⇒ WAIT; `neverInvertsDirection` | testes BREAKOUT×FAILED e PULLBACK×REVERSAL |
| T7 | REAL por engano | critica | `RISK_CONTEXT_AGENT` bloqueia `accountContext=REAL`; comites repetem; allowlist intocado | testes de risco e allowlist |
| T8 | Direcao sensivel ao instante do T0 (fim de janela apos pullback) | observacao | comportamento correto: trigger e do instante; testes escolhem o ponto de decisao e documentam | fixtures de tendencia com ponto de continuacao |

## 3. LEAKAGE CRITIC

| # | Achado | Severidade | Correcao | Prova |
|---|---|---|---|---|
| L1 | Candle em formacao poderia entrar como fechado | critica | `splitClosedCandles` + `forming.closed=false` | testes T0 |
| L2 | 1m/5m com futuro | critica | agregacao so de buckets com `bucketEnd <= decisionAt` | teste multi-TF |
| L3 | Features com timestamp posterior | critica | `findFutureReferences(t0, decisionAt) == []` | teste |
| L4 | `availableAt` irreal | alta | `availableAt = max(insumos reais)`; validacao `availableAt >= receivedAt` | testes de evento e T0 |
| L5 | Outcome realimentando classificacao | critica | settlement `feedableToClassification:false`, `outcomeUsedInClassification:false` | teste de settlement |
| L6 | V3 congelada alterada por engano | critica | cross-check sha256 contra `scenario-engine-freeze.json` | `agents-v4-hotpath-freeze.test.ts` |

## 4. PERFORMANCE CRITIC

| # | Achado | Severidade | Correcao | Prova |
|---|---|---|---|---|
| P1 | Subscriber lento bloquear feed | critica | fila por subscriber + drop-oldest + microtask drain | benchmark: 90k eventos/s com subscriber lento |
| P2 | Analise cara no hook | alta | determinismo puro, sem I/O; persistencia fire-and-forget | p95 0,43 ms; CPU 0,26 ms/analise |
| P3 | Duplicacao de eventos | media | dedupe por `eventId` com TTL | teste de duplicata |
| P4 | Crescimento sem limite | media | janelas limitadas (observacoes/mercado, snapshots, filas) | revisao de codigo + testes de status |
| P5 | Impacto no JIT | alta | hook sincrono curto, nunca awaited na decisao; 2 chamadas/oportunidade | `docs/research/data/agents-v4-performance.json` |

## 5. Contraexemplos executados (tentativas de quebrar)

1. 9 bullish + componente fundamental ausente ⇒ **WAIT** (nao BUY).
2. Contexto perfeito sem trigger ⇒ **WAIT**.
3. Conflito breakout×falha sem prova ⇒ **WAIT** (e direcao preservada).
4. `DATA_QUALITY UNSAFE` ⇒ **NO_TRADE**.
5. `accountContext REAL` ⇒ **BLOCK**.
6. Observacao WAIT/NO_TRADE nao liquida; BUY/SELL liquida **CAUSAL_COUNTERFACTUAL**.
7. Liquidacao repetida nao reescreve outcome (idempotencia).
8. Gap de sequencia e duplicata sao reportados, nao silenciados.
9. `setAgentsV4Enabled(false)` desliga apenas a observacao V4.
10. Payload com `ssid` e rejeitado pelo schema.

## 6. Riscos residuais e pendencias honestas

- Coverage atual e `FIXTURE_REFERENCE`; coleta prospectiva comeca apos o deploy
  (`scripts/agents-v4-coverage.mjs --from-db`).
- Limiares de cenario sao heuristicas documentadas (sem tuning em WIN/LOSS; proibido tuning no V3).
- `CANDLE_1M` e derivado de candles 5s; nao existe feed 1m proprio no caminho atual.
- Multi-timeframe usa 5s/1m/5m derivados; timeframe maior que 5m depende de historico de candle do
  proprio feed (sem backfill externo no T0).
- `office-v3-perf` falha sob carga desta maquina (pre-existente ao V4; passa isolado).
