# DATAHUB / EVENT BUS — TRILHA A (implementacao propria, clean-room)

- **Escopo:** infraestrutura de eventos e T0 enriquecido para o `PROFESSIONAL_AGENT_SYSTEM_V4` (SHADOW).
- **Principio:** nenhum codigo de terceiros foi copiado. A arquitetura foi inspirada conceitualmente em
  event bus/data hub (auditoria em `docs/research/vibe-fincept-audit.md`); a implementacao e original.
- **Nao decide, nao envia ordem, nao altera G2/V3/Late Window/Quality Gate/JIT/Execution Gate/stake.**
- **Modulos:** `relay/datahub/` (`event-schema`, `event-bus`, `metrics`, `feature-provenance`,
  `t0-enriched`, `data-quality-agent`, `coverage`).

## 1. Envelope canonico (`datahub-event-v1`)

Todo evento carrega:

| Campo | Descricao |
|---|---|
| `eventId` | identidade estavel (dedupe) |
| `eventType` | tipo do evento (lista fechada) |
| `schemaVersion` | `datahub-event-v1` |
| `marketKey` / `marketType` / `activeId` | isolamento por mercado (NORMAL/OTC nunca se misturam) |
| `serverTime` / `localTime` / `receivedAt` / `availableAt` | point-in-time; `availableAt >= receivedAt` e obrigatorio |
| `producer` / `source` / `provenance` | procedencia auditavel |
| `accountContext` | PRACTICE/REAL (isolamento de conta) |
| `sequence` / `version` | sequencia monotona por mercado/producer |

Eventos relevantes: `MARKET_TICK`, `CANDLE_5S`, `CANDLE_1M`, `CANDLE_CONTEXT`, `FEATURE_SNAPSHOT`,
`STRUCTURE_UPDATE`, `REGIME_UPDATE`, `SCENARIO_UPDATE`, `AGENT_ANALYSIS`, `CANDIDATE`,
`JIT_REVALIDATION`, `EXECUTION_STATE`, `BROKER_ACK`, `SETTLEMENT`, `DATA_QUALITY_UPDATE` e os eventos
do Agent Event Bus (`AGENT_STARTED`…`ERROR`).

Validacoes: tipo/versao, mercado↔sufixo do key, tempos finitos, `availableAt >= receivedAt`,
`serverTime` plausivel e **bloqueio de chaves sensiveis** (`ssid`/`password`/`token`/`api_key`…).

## 2. Barramento nao bloqueante (`datahub-event-bus-v1`)

- `publish()` valida, atribui sequencia e apenas **enfileira** por subscriber (O(1)): nunca executa handler
  no caminho do feed.
- Fila por subscriber com `maxQueue`; ao encher, **descarta o mais antigo** e contabiliza (`dropped`).
- `ingest()` valida/deduplica por `eventId` e **registra gap de sequencia** (nunca “corrige” em silencio).
- `restart()` incrementa epoch, limpa filas/dedupe/sequencias e nao contamina mercados.
- Filtros exatos: `eventTypes`, `marketKey`, `marketType`, `accountContext`, `producer`.
- Metricas: `eventsPerSecond`, latencia de entrega p50/p95/p99, high-water, drops, erros por subscriber,
  CPU/RAM via `processSnapshot()`.

**Prova de nao bloqueio (benchmark, `docs/research/data/agents-v4-performance.json`):**
20.000 eventos publicados em ~222 ms (~**90k eventos/s**) com um subscriber lento de 1ms/evento;
o subscriber lento perdeu ~19,8k eventos (fila limitada) **sem atrasar o publisher**.

## 3. T0 enriquecido (`t0-enriched-v1`)

Snapshot canonico por `marketKey`, point-in-time (`availableAt <= decisionAt`). Corrige o gargalo
diagnosticado do V3 (`docs/research/v3-wait-diagnosis.md`): **velocity/acceleration nao sao mais
descartados**, e estrutura/BOS/multi-timeframe/ticks passam a existir.

Secoes: `market`, `times`, `price`, `ticks` (microestrutura real do feed), `candles5s` (anatomia,
sequencia, eventos, candle em formacao separado), `timeframes` (entry 5s, structure 1m, context 5m —
derivados de candles 5s fechados), `indicators` (RSI/ATR/ADX/DI/Donchian/slopes/realizedVol/Bollinger),
`structure` (HH/HL/LH/LL, swings, BOS, S/R, range, retest, falha), `compression`, `location`,
`momentum` (RSI+slope, velocity, acceleration, DI spread, persistencia), `featureProvenance`, `flags`.

Regras inviolaveis:
1. candle nao fechado **nunca** aparece como fechado (`forming.closed=false`);
2. 1m/5m apenas de candles 5s **fechados**;
3. `availableAt` do snapshot = max(timestamps reais dos insumos);
4. `findFutureReferences(t0, decisionAt)` deve retornar `[]` (testado);
5. OTC nao inventa order book/volume institucional — microestrutura usa somente ticks reais.

## 4. Feature provenance

Cada feature importante expoe `value/status/source/producer/formulaVersion/calculatedAt/availableAt`.
Exemplos: `indicators.rsi14` (producer `feature-engine-v1`), `structure.label` (`price-structure-v1`),
`timeframes.structure1m` (source `CANDLE_5S_DERIVED`, producer `t0-enriched-v1`),
`ticks.microstructure` (source `TICK_RING`).

## 5. Data Quality Agent (`data-quality-agent-v1`)

Saidas: **HEALTHY / DEGRADED / UNSAFE**. Analisa feed freshness, missing ticks/candles, duplicatas,
clock drift, gaps de sequencia, mapeamento de mercado, consistencia NORMAL/OTC, estado do broker e
freshness de features. `UNSAFE` ⇒ o V4 responde **NO_TRADE** (testado).

## 6. Coverage

`computeFeatureCoverage()` produz `feature × {available%, missing%, stale%} × {NORMAL, OTC, UNKNOWN}`.
- relatorio offline: `node scripts/agents-v4-coverage.mjs [--from-db --limit N]`
  → `docs/research/data/agents-v4-feature-coverage.json` (fonte atual: `FIXTURE_REFERENCE`;
  `--from-db` usa `iq_agents_v4_observations.payload->'t0'` prospectivo);
- coverage ao vivo: exposta em `GET /api/iq/research/agents-v4` (janela em memoria de snapshots).

## 7. Integracao no runtime (somente observacao)

`IqMultiRuntime` instancia `EventBus`, `AgentsV4Engine`, `AgentsV4Persistence` e `AgentsV4Settlement`
(`agentsV4Enabled`/`dataHubEnabled`, default `true`). Publicacoes: `CANDLE_5S`/`MARKET_TICK` no ingest,
`FEATURE_SNAPSHOT`/`AGENT_ANALYSIS`/`REGIME_UPDATE`/`STRUCTURE_UPDATE`/`SCENARIO_UPDATE`/
`DATA_QUALITY_UPDATE`/`CANDLE_1M`/`CANDLE_CONTEXT` no hook de estado (throttle 15s),
`CANDIDATE`/`FINAL_SYNTHESIS`/`RED_TEAM_REVIEW`/`CONFLICT`/`WAITING`/`JIT_REVALIDATION` no fluxo de
candidato, `EXECUTION_STATE`/`BROKER_ACK`/`SETTLEMENT` nos pontos reais de execucao/liquidacao do G2
(com `basis: BROKER_EXECUTED` separado da liquidacao causal V4 `CAUSAL_COUNTERFACTUAL`).

## 8. Performance (medida)

| Metrica | Valor |
|---|---|
| analyze V4 p50/p95/p99 | 0,12 / 0,43 / 0,84 ms (max 16,6 ms no warm-up) |
| CPU por analise | ~0,26 ms |
| DataHub | ~90k eventos/s; p95 entrega do subscriber rapido ~196 ms sob subscriber lento de 1ms |
| Hook por oportunidade | 2 chamadas sincronas fail-safe (nunca awaited no caminho de decisao) |

## 9. Reproducao

```powershell
node scripts/agents-v4-benchmark.mjs
node scripts/agents-v4-coverage.mjs
npm test -- tests/ai/datahub-event-bus.test.ts tests/ai/datahub-t0-enriched.test.ts tests/ai/datahub-data-quality.test.ts
```
