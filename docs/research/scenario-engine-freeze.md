# SCENARIO_ENGINE_V3_FROZEN — manifesto de congelamento

> **Designacao congelada:** `scenarioEngineVersion = SCENARIO_ENGINE_V3_FROZEN`
> **Constante de runtime:** `SCENARIO_ENGINE_V3` (inalterada para nao partir a serie prospectiva ja persistida).
> **Regra:** qualquer mudanca de logica (playbooks, thresholds, classificacao de regime/cenario, disputa,
> Trader/Critic, `EXPERIMENTAL_V1`, features, pesos, regras de WAIT, Brain G2/estrategia/stake/JIT/Execution
> Gate) exige **NOVA VERSAO** — nunca editar a V3 congelada.
> **Escopo:** SHADOW / RESEARCH ONLY · **PRACTICE ONLY, ZERO REAL** · sem martingale e sem loss recovery.

## 1. Identidade do freeze

| Campo | Valor |
|---|---|
| `scenarioEngineVersion` | `SCENARIO_ENGINE_V3_FROZEN` |
| `engineVersionConstant` | `SCENARIO_ENGINE_V3` |
| Congelado em (UTC) | `2026-09-19T08:21:48Z` |
| Commit-base | `87688267aa2145ab9af22551f26b1bb169eeb715` |
| Manifesto JSON | `docs/research/data/scenario-engine-freeze.json` |
| Teste verificador | `tests/research/scenario-engine-freeze.test.ts` |

O commit-base e o HEAD no instante do congelamento; o commit que adiciona este manifesto e o
imediatamente seguinte (o teste **nao** depende de git, apenas dos sha256 e da configuracao).

## 2. Arquivos congelados (sha256 verificado em teste)

| Arquivo | sha256 | Papel |
|---|---|---|
| `relay/scenario-engine.mjs` | `54c68f07b45e64ac2da61ebf816619ccd5dd9dab3a65b83e4235ab31460f385d` | motor puro V3 (regimes, cenarios, 8 playbooks) |
| `relay/scenario-shadow.mjs` | `8216fb18826dc18137bf50376a699b714850c406d80cf3a6bd4b50754db096dc` | hook SHADOW + Critic independente 2 fases + persistencia observacional |
| `relay/scenario-timing-intersection.mjs` | `a493cd4b9fbf6fa837b7d5cbf642905fc71292ab16b888869ef8e1a204d87f74` | camada observacional somente-leitura V3 x LATE_WINDOW_V2 |

O teste `tests/research/scenario-engine-freeze.test.ts` recalcula os tres sha256 e falha se qualquer um
divergir. Tambem confere `SCENARIO_ENGINE_VERSION`, os 8 cenarios/playbooks, `FEATURE_COMPONENTS` e
`OTC_UNAVAILABLE_FEATURES` contra o manifesto.

## 3. Configuracao vigente no congelamento

### 3.1 Motor (`relay/scenario-engine.mjs`)

- `scenarioEngineVersion = SCENARIO_ENGINE_V3`; modo `SHADOW_OBSERVATIONAL`;
  `execution: SHADOW_ONLY`; `controlsExecution: false`; `sendsOrders: false`;
  `practiceOnly: true`; `realMoney: false`; `deterministic: true`; `io: NONE`.
- Politica OTC: `OBSERVABLE_ONLY_NO_SYNTHETIC_VOLUME_OR_ORDER_BOOK`.
- Politica de tuning: `NO_TUNING_ON_WIN_LOSS`.

### 3.2 Shadow (`relay/scenario-shadow.mjs`)

- `scenarioShadowVersion = scenario-shadow-v2`; `contractVersion = scenario-engine-contract-v1`.
- Series separadas: `SCENARIO_ENGINE_V3_SHADOW` (policy) + `CURRENT_G2` (decisao real, intocada) +
  `timingPolicyVersion` opaca; `timingCoupling: NONE`.
- Critic `INDEPENDENT_TWO_PHASE` (fase 1 congelada antes de ver o Trader, hash+timestamp).
- Divergencia `EXPERIMENTAL_V1`, modo `INVESTIGATION_NEVER_VOTING`; direcao do Critic nunca adotada;
  conflito CALL x PUT = WAIT/CONFLICT_UNRESOLVED.
- `MIN_RESOLUTION_EVIDENCE = 4`; `MIN_OPPOSITE_DIRECTION_EVIDENCE = 5`.
- Ablation `RESEARCH_ONLY` sem pesos aprendidos; default todos ligados
  (`rsi`, `adx`, `microstructure`, `location`, `volatility`).

### 3.3 Interseccao (`relay/scenario-timing-intersection.mjs`)

- `scenario-timing-intersection-v1`; `READ_ONLY_COMPARISON`; `mutatesNeither: true`;
  `controlsExecution: false`; verdicts `BOTH_ENTRY / SCENARIO_ENTRY_LATE_CANCEL /
  SCENARIO_WAIT_LATE_ACCEPT / BOTH_WAIT / INSUFFICIENT_DATA`.

### 3.4 Flags do hook de runtime

- `scenarioShadowEnabled = true` e `scenarioTimingIntersectionEnabled = true` (defaults do construtor
  `IqMultiRuntime`; **nao ha env var de gate** para nenhum dos dois).
- Hook em `relay/iq-multi-runtime.mjs`: `#beginScenarioShadow` (CANDIDATE),
  `#observeScenarioShadow` (REVALIDATION_1/2), `#finalizeScenarioShadow` (FINAL_ENTRY),
  `#observeScenarioTimingIntersection` (candidate/ACK/cancel/settle) e `recordOutcome(BROKER_EXECUTED)`.
- `brokerAutomation: NONE`; SHADOW nunca envia ordem; Execution Gate nunca e chamado.

## 4. Features usadas

Componentes de ablation (iguais no motor e no shadow): `rsi14/adx14/plusDI/minusDI` -> componentes
`rsi`/`adx`; `streak/bodyRatio/upperWick/lowerWick` -> `microstructure`;
`donchianPosition/distanceToUpperATR/distanceToLowerATR/channelHigh/channelLow` -> `location`;
`atr/atrRatio` -> `volatility`.

`featuresUsed` por playbook:

| Playbook | featuresUsed |
|---|---|
| `PB_TREND_CONTINUATION` | structureLabel, donchianPosition, velocity, acceleration, adx14, plusDI, minusDI, rsi14, atrRatio, bodyRatio, ticks |
| `PB_TREND_PULLBACK` | structureLabel, donchianPosition, velocity, acceleration, rsi14, atrRatio, bodyRatio, upperWick, lowerWick |
| `PB_BREAKOUT` | structureLabel, donchianPosition, channelHigh, channelLow, distanceToUpperATR, distanceToLowerATR, atrRatio, bodyRatio, upperWick, lowerWick, velocity, ticks |
| `PB_FAILED_BREAKOUT` | structureLabel, donchianPosition, distanceToUpperATR, distanceToLowerATR, bodyRatio, upperWick, lowerWick, velocity, atrRatio, ticks |
| `PB_RANGE_MEAN_REVERSION` | structureLabel, donchianPosition, channelHigh, channelLow, atrRatio, adx14, plusDI, minusDI, rsi14, bodyRatio, upperWick, lowerWick, ticks, candles |
| `PB_REVERSAL` | structureLabel, donchianPosition, velocity, acceleration, rsi14, atrRatio, bodyRatio, upperWick, lowerWick, ticks |
| `PB_COMPRESSION_EXPANSION` | atrRatio, atr, structureLabel, donchianPosition, channelHigh, channelLow, bodyRatio, velocity, ticks, candles |
| `PB_TRANSITION_NO_TRADE` | structureLabel, velocity, acceleration, adx14, atrRatio, rsi14, ticks, candles |

**OTC (`unavailable`, nunca inventado):** `volume:OTC_NOT_OBSERVABLE`,
`orderBook:OTC_NOT_OBSERVABLE`, `marketDepth:OTC_NOT_OBSERVABLE`. Sem candles, o motor tambem marca
`realizedVolatility/bbw/donchianWidth/atrTrajectory:UNAVAILABLE` e `ticks:NOT_PROVIDED`; nada disso e
sintetizado.

## 5. Os 8 playbooks congelados

1. `PB_TREND_CONTINUATION` (TREND_CONTINUATION)
2. `PB_TREND_PULLBACK` (TREND_PULLBACK)
3. `PB_BREAKOUT` (BREAKOUT)
4. `PB_FAILED_BREAKOUT` (FAILED_BREAKOUT)
5. `PB_RANGE_MEAN_REVERSION` (RANGE_MEAN_REVERSION)
6. `PB_REVERSAL` (REVERSAL)
7. `PB_COMPRESSION_EXPANSION` (COMPRESSION_EXPANSION)
8. `PB_TRANSITION_NO_TRADE` (TRANSITION_NO_TRADE)

## 6. O que este freeze NAO autoriza

- Otimizar qualquer coisa olhando WIN/LOSS.
- Forcar distribuicao entre playbooks, gerar trades para aumentar N ou reduzir criterios.
- Alterar threshold 75, pesos do Quality Gate, Brain G2, stake, JIT ou Execution Gate.
- Promover o motor a controle de execucao (segue `controlsExecution: false`).

## 7. Verificacao

```powershell
npx vitest run tests/research/scenario-engine-freeze.test.ts
```

Se o teste passar, a V3 permaneceu byte a byte congelada nos tres artefatos listados na secao 2.
