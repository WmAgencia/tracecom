# PROFESSIONAL_AGENT_SYSTEM_V4 (SHADOW ONLY)

- **Modo:** `SHADOW_ONLY` — `controlsExecution:false`, `sendsOrders:false`, `changesStake:false`,
  nao mexe em G2/V3/Late Window/Quality Gate/JIT/Execution Gate e **nao entra no allowlist REAL**.
- **Modulos:** `relay/agents-v4/` (+ DataHub em `relay/datahub/`).
- **Contrato de agente:** `agentId, agentVersion, marketKey, snapshotId, state, assessment,
  bullishEvidence[], bearishEvidence[], neutralEvidence[], riskFlags[], featuresUsed[],
  confidenceClass (LOW/MEDIUM/HIGH — NAO e probabilidade), dataQuality, reasoningSummary, availableAt`.

## 1. Fluxo

```
T0 enriquecido (datahub)
→ DATA_QUALITY_AGENT (UNSAFE => NO_TRADE)
→ 8 especialistas de mercado (bundle unico de features; ninguem recalcula indicador)
→ SCENARIO_AGENT (8 cenarios; primary/secondary/competing + ambiguity)
→ EXECUTION_TIMING_AGENT + RISK_CONTEXT_AGENT
→ SYNTHESIS_AGENT (gating por cenario; contexto bom sem trigger => WAIT)
→ RED_TEAM (fase 1 cega + fase 2 adversarial; conflito material => WAIT)
→ COMITES (technical/risk/execution; nenhum executa)
→ finalAction BUY/SELL/WAIT/NO_TRADE
```

## 2. Especialistas

| Agente | Estados |
|---|---|
| MARKET_REGIME_AGENT | TREND_UP / TREND_DOWN / RANGE / COMPRESSION / EXPANSION / TRANSITION / UNCERTAIN |
| MARKET_STRUCTURE_AGENT | BULLISH_STRUCTURE / BEARISH_STRUCTURE / RANGE_STRUCTURE / TRANSITION_STRUCTURE / UNKNOWN |
| TREND_AGENT | BULLISH / BEARISH / NEUTRAL / UNCERTAIN (+strength/persistence/weakening/maturity) |
| LOCATION_AGENT | EDGE_UPPER / EDGE_LOWER / OVEREXTENDED_UPPER / OVEREXTENDED_LOWER / MID / UPPER_HALF / LOWER_HALF / UNKNOWN |
| MOMENTUM_AGENT | STRONG / BUILDING / STABLE / WEAKENING / REVERSING |
| VOLATILITY_AGENT | COMPRESSED / NORMAL / EXPANDING / EXPANDED / VOLATILE_SPIKE / UNKNOWN (nunca escolhe direcao) |
| PRICE_ACTION_AGENT | BULLISH / BEARISH / NEUTRAL / UNCERTAIN |
| MICROSTRUCTURE_AGENT | BUY_PRESSURE / SELL_PRESSURE / BALANCED / INSUFFICIENT (somente ticks reais) |
| SCENARIO_AGENT | 8 cenarios do TraceCom |
| EXECUTION_TIMING_AGENT | TOO_EARLY / OBSERVE / READY_WINDOW / TOO_LATE / UNSAFE (Late Window V2 intocado) |
| RISK_CONTEXT_AGENT | ELIGIBLE / CAUTION / BLOCK (REAL => BLOCK; stake inalterado) |
| DATA_QUALITY_AGENT | HEALTHY / DEGRADED / UNSAFE |

**Regime — correcao do erro V3:** o score de tendencia usa estrutura 5s/1m, contexto 5m, ADX+DI,
**velocity/acceleration** e BOS; maximo ~7,75 com limiar 3,0. Testes provam TREND_UP e TREND_DOWN
alcancaveis (o V3 congelado nunca saia de TRANSITION/RANGE por plumbing de features).

## 3. Synthesis — gating por cenario (sem votacao burra)

| Cenario | Componentes fundamentais |
|---|---|
| TREND_CONTINUATION | TREND + STRUCTURE + MOMENTUM a favor |
| TREND_PULLBACK | TREND + LOCATION (zona de pullback) + MOMENTUM (nao REVERSING) |
| BREAKOUT | STRUCTURE (rompimento) + VOLATILITY (nao comprimida) + PRICE_ACTION |
| FAILED_BREAKOUT | STRUCTURE (falha) + PRICE_ACTION + LOCATION no extremo |
| RANGE_MEAN_REVERSION | STRUCTURE range + LOCATION extremo + PRICE_ACTION (rejeicao) |
| REVERSAL | TREND (weakening/mature) + MOMENTUM (REVERSING/WEAKENING) + PRICE_ACTION |
| COMPRESSION_EXPANSION | VOLATILITY + PRICE_ACTION |
| TRANSITION_NO_TRADE | sempre WAIT |

Regras: componente faltando ⇒ `WAIT/SCENARIO_COMPONENT_MISSING`; contexto bom sem trigger ⇒
`WAIT/CONTEXT_OK_NO_TRIGGER`; concorrentes de **direcoes opostas** proximos ⇒
`WAIT/AMBIGUOUS_COMPETING_SCENARIOS`; `whyNow` obrigatorio; `invalidation` sempre preenchida.

## 4. Red Team (duas fases)

- **Fase 1 (cega):** recebe apenas features do T0 (nao ve Synthesis/especialistas), produz
  regime/estrutura/cenario/direcao/risco/acao e **congela sha256**.
- **Fase 2:** tenta destruir a tese. Conflitos: PULLBACK_VS_REVERSAL, BREAKOUT_VS_FAILED_BREAKOUT,
  RANGE_VS_EXPANSION, CONTINUATION_VS_EXHAUSTION, TREND_VS_TRANSITION. Conflito **material nao
  resolvido ⇒ WAIT**; a direcao nunca e invertida automaticamente (`neverInvertsDirection:true`).

## 5. Comites

TECHNICAL_COMMITTEE (agrega especialistas + red team), RISK_COMMITTEE (risco + DQ + conta),
EXECUTION_COMMITTEE (timing + idempotencia/Execution Gate read-only). Nenhum envia ordem; todos
carregam `sendsOrders:false` e `sendsOrders:false` no policy.

## 6. Version Router e Benchmark

`runVersionRouter()` executa G2_CURRENT / SCENARIO_ENGINE_V3_FROZEN / PROFESSIONAL_AGENT_SYSTEM_V4 na
MESMA oportunidade, isolados (try/catch por runner, zero chamadas cruzadas). O benchmark agrega
distribuicoes de acao, regimes, cenarios, conflitos, DQ e agreement. O settlement e comum e
observacional: `CAUSAL_COUNTERFACTUAL`/`PROSPECTIVE_SHADOW` (nunca `BROKER_EXECUTED`); apenas
observacoes com direcao BUY/SELL sao liquidadas; idempotente; `feedableToClassification:false`.

## 7. Persistencia e endpoint

- Migration `034_agents_v4_shadow.sql` cria `iq_agents_v4_observations` (payload jsonb com T0 quando
  <=64KB, settlement idempotente). Aplicada automaticamente no boot do relay (runner existente).
- `GET /api/iq/research/agents-v4` (proxy Vercel incluido): status por mercado (agentes, estado,
  assessment, cenario, opiniao, latencia, lastUpdate), distribuicoes, benchmark, coverage, DataHub
  stats, settlement e flags de isolamento.

## 8. Config e testes

- `agentsV4Enabled`/`dataHubEnabled` (default true); `setAgentsV4Enabled()` liga/desliga apenas a
  observacao. Falha do hook nunca sobe para o hot path (`#safe`).
- Testes: `tests/ai/datahub-*.test.ts`, `tests/ai/agents-v4-*.test.ts`,
  `tests/research/agents-v4-hotpath-freeze.test.ts` (13 arquivos do hot path com sha256 + cross-check
  do freeze V3).

## 9. Performance (medida em 2026-09-19)

| Metrica | Valor |
|---|---|
| analyze p50/p95/p99 | 0,12 / 0,43 / 0,84 ms (max 16,6 ms warm-up) |
| CPU/analise | ~0,26 ms |
| DataHub | ~90k eventos/s (subscriber lento nao bloqueia) |
| Hook/oportunidade | 2 chamadas sincronas fail-safe; budget de pesquisa p95 < 50 ms |

`docs/research/data/agents-v4-performance.json` e `agents-v4-feature-coverage.json` sao regeneraveis.

## 10. Pendencias reais

1. Coleta prospectiva V4 comeca apos o deploy (nenhuma ordem V4; `BROKER_EXECUTED` continua exclusivo
   do G2 real broker).
2. Coverage atual e `FIXTURE_REFERENCE`; rodar `scripts/agents-v4-coverage.mjs --from-db` apos o deploy.
3. `CANDLE_1M` e derivado de candles 5s (nao ha feed 1m proprio do broker no caminho atual).
4. V4 continua fora do allowlist REAL e nao ha plano de promocao nesta rodada.
