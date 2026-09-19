# DIAGNÓSTICO CAUSAL — "V3 100% WAIT" (N≈3.063)

- **Escopo:** Fase 28 — observabilidade e diagnóstico. **Nenhuma linha da V3 foi alterada**; o motor congelado
  (`SCENARIO_ENGINE_V3_FROZEN`, hashes em `docs/research/data/scenario-engine-freeze.json`) foi apenas **executado
  offline** sobre os T0 persistidos. PRACTICE ONLY, ZERO REAL.
- **Data:** 2026-09-19T08:58Z. **Fonte:** `iq_scenario_shadow_observations` (Postgres, somente leitura) +
  `iq_scenario_timing_intersections`.
- **Ferramenta de reprodução:** `scripts/v3-wait-diagnosis.mjs` (`--replay`), read-only.

## 1. Snapshot dos dados (FACT)

| Métrica | Valor |
|---|---|
| Observações | **3.063** (100% `PROSPECTIVE`, 100% `market_type=OTC`) |
| Janela | 2026-09-19T01:45:47Z → 08:58:36Z |
| G2 (`current_decision`) | **3.063/3.063 BUY/SELL** (1.528 BUY / 1.535 SELL) — 0 WAIT |
| V3 (`final_action`) | **3.063/3.063 WAIT** — 0 entradas |
| `traderScenario.playbook.entryEligible` | **false em 100%** |
| `engine_info.mode` | `SCENARIO_ENGINE` em 100%; `engineError`/`degradedToFallback` = **0** |
| Divergência Trader×Critic | `SAME` em 100% (sem conflito CALL×PUT, sem adoção de Critic) |
| `criticScenario.action` | WAIT em 100% (mesma causa do Trader, ver §3) |

Não é fail-safe, não é erro de engine, não é conflito de direção: é o **próprio classificador** que nunca sai de
`TRANSITION`/`RANGE` e, por desenho, esses caminhos terminam em WAIT.

## 2. Replay offline com o motor congelado (FACT)

400 observações mais antigas foram reprocessadas com `analyzeScenarioSnapshot({ snapshot: t0, direction })`
(motor real importado, sem alteração):

| Comparação replay × persistido | Taxa |
|---|---|
| Ação idêntica | **400/400 (100%)** |
| `primaryScenario` idêntico | **400/400 (100%)** |
| `marketRegime` idêntico | **400/400 (100%)** |

Conclusão: a V3 é determinística e **totalmente reprodutível a partir do T0 persistido**; o 100% WAIT não é
aleatoriedade nem dependência de estado — é consequência estrutural dos inputs.

## 3. Cadeia causal (FACT, com números)

```
T0 persistido (rico: structure.label/detail/swings, RSI, ADX/DI, location, momentum.velocity/acceleration, freshness)
   │  buildScenarioFeatures()  ← relay/scenario-shadow.mjs:519
   ▼
features flat {rsi14, adx14, plusDI, minusDI, bodyRatio, wicks, donchian, canais, atr, atrRatio, fresh, tickAgeMs, structureLabel}
   │  • velocity/acceleration EXISTEM no T0.momentum mas NÃO são copiados        → ctx.velocity = null
   │  • candles/ticks NÃO existem no T0 (whitelist shadow-lab.mjs:340)           → HH/HL, BOS, range calculado = null
   │  • multiTimeframe/Htf NÃO existem no T0                                     → trendMajor/trendRecent = null
   ▼
classifyRegime()  ← relay/scenario-engine.mjs:930
   │  pontuação máxima possível para TENDÊNCIA:
   │    structureLabel UP/DOWN = 2,00 + ADX>=20 com DI alinhado = 0,75 → MÁXIMO 2,75 < LIMITE 3,00 (linha 1007)
   │    (trendMajor 1,5 + trendRecent 1,0 + HH/HL 0,75 + BOS 0,75 + velocity 0,5 + acceleration 0,25 = indisponíveis)
   ▼
Regime observado em 3.063 rows:  TRANSITION 2.061 (67,3%) · RANGE 1.002 (32,7%)
   · TREND_UP/TREND_DOWN/EXPANSION/COMPRESSION/UNCERTAIN = 0 (ZERO — nunca alcançados)
   ▼
computeSelection()  ← relay/scenario-engine.mjs:1450
   │  governance TRANSITION  → primary := TRANSITION_NO_TRADE (sempre WAIT por desenho)
   │  RANGE + cenário direcional → playbook inválido para o regime (WAIT)
   │  gap entre competidores <= 1 → ambiguous = true (WAIT)
   ▼
evaluatePlaybook() → action = entryEligible ? direção : "WAIT"  (100% WAIT)
```

### 3.1 Decomposição por condição de WAIT (persistido em `traderScenario.invalidationReasons`)

| Condição | N | % de 3.063 | Papel |
|---|---|---|---|
| `AMBIGUOUS_COMPETING_SCENARIOS` | **2.197** | 71,7% | **Amplificador** — forçado sempre que há governance; também gap ≤ 1 |
| `GOVERNANCE_REGIME_TRANSITION` | **2.061** | 67,3% | **Causa dominante #1** — regime TRANSITION sem hard trigger → `TRANSITION_NO_TRADE` |
| `REGIME_NOT_VALID_FOR_PLAYBOOK_RANGE` | **865** | 28,2% | **Causa dominante #2** — cenário direcional (TREND_PULLBACK etc.) sob regime RANGE |
| `GOVERNANCE_INSUFFICIENT_STRUCTURAL_EVIDENCE` | 217 | 7,1% | score do top < 3 e sem hard trigger |
| `STRUCTURE_NOT_RANGE` | 78 | 2,5% | RANGE_MEAN_REVERSION sem estrutura de range |
| `MID_LOCATION` | 14 | 0,5% | preço no meio do canal (fade inválido) |
| `BREAKOUT_RISK_ADX_DI` | 7 | 0,2% | risco de rompimento |
| `EXPANSION_WITHOUT_DIRECTION` | 5 | 0,2% | expansão sem direção |
| `REGIME_NOT_VALID_FOR_PLAYBOOK_TRANSITION` | 5 | 0,2% | playbook direcional sob TRANSITION |

`primaryScenario`: TRANSITION_NO_TRADE 2.070 (67,6%) · TREND_PULLBACK 790 (25,8%) · RANGE_MEAN_REVERSION 123
(4,0%) · TREND_CONTINUATION 75 (2,4%) · COMPRESSION_EXPANSION 5 (0,2%). `triggerState`: NONE 74,2% /
PARTIAL 25,8%. `momentumState`: **UNKNOWN em 100%** (prova de que `velocity` foi descartada).

### 3.2 Papel do Critic

O Critic (fase 1, congelado antes do Trader) apresenta a **mesma distribuição de regime** (TRANSITION 2.061 /
RANGE 1.002) e `action=WAIT` em 100%; a divergência persistida é `SAME` em 100%. Portanto **não existe conflito
Trader×Critic** e o Critic **não é a causa**; `CRITIC_WAIT` só aparece no `reasons_for_wait` residual (282
ocorrências, §4).

### 3.3 Condição dominante (resposta direta)

**A condição que mais gera WAIT é o regime nunca alcançar TREND** — o pipeline T0→features descarta os inputs que
levantariam a pontuação de tendência acima do limiar (`maxTrend >= 3`), resultando em `GOVERNANCE_REGIME_TRANSITION`
(2.061) e, no restante, `REGIME_NOT_VALID_FOR_PLAYBOOK_RANGE` (865). Somadas, essas duas explicam **~95%** das
observações. `AMBIGUOUS_COMPETING_SCENARIOS` é o rótulo mais frequente, porém é amplificador secundário do
caminho de governance — não a causa-raiz.

### 3.4 Prova contrafactual diagnóstica (FACT — nenhuma alteração de arquivo)

Reenviando **apenas** `velocity` e `acceleration` já presentes no T0 (400 amostras, motor congelado):

| Efeito | Resultado |
|---|---|
| Regime mudou | **178/400 (44,5%)** → TREND_DOWN 98 · TREND_UP 80 · RANGE 55 · TRANSITION 167 |
| Ação mudou | **175/400 (43,8%)** → SELL 95 · BUY 80 · WAIT 225 |

Ou seja: o limite de 3,0 é atingível assim que os dois campos de momentum passam a chegar ao motor. Isso **não é
recomendação de trade**; é prova de que o gargalo é de *plumbing* de features, não de julgamento do playbook.

## 4. Defeito de observabilidade encontrado (FACT)

`revalidateFinal` grava `reasonsForWait = []` no ramo não-cancelado
(`relay/scenario-shadow.mjs:1259-1262`). Resultado: **2.781/3.063 (90,8%)** observações terminam com
`reasons_for_wait` vazio e `final_action=WAIT`, embora `traderScenario.invalidationReasons` contenha a causa.
As 282 com reasons são, quase todas, as 269 canceladas em `SCENARIO_INVALIDATED_AT_FINAL_REVALIDATION`.
**Consequência:** qualquer dashboard/relatório que use `reasons_for_wait` como fonte vê "WAIT sem motivo".
A correção exige **nova versão** (não é possível alterar o arquivo congelado).

## 5. FACT × HYPOTHESIS

**FACT (verificado nos dados/código):** tudo em §1–§4, incluindo: replay 100%; regime só TRANSITION/RANGE;
`momentumState=UNKNOWN` 100%; contagens de invalidação; reasons apagados em 90,8%; contrafactual com velocity
muda regime em 44,5%.

**HYPOTHESIS (não testada até o fim):**
1. Mesmo com regime TREND classificado, a taxa de entrada da V3 seria baixa por causa de outras checagens
   (location/trigger/critic) e pela política de divergência EXPERIMENTAL_V1 (`<4/6 = WAIT`). O contrafactual
   mostra 175/400 ações não-WAIT na camada de análise, mas o pipeline completo (divergência + revalidação final)
   não foi simulado.
2. A janela de 5s do OTC 60s produz `velocity`/`acceleration` ruidosos (último tick), o que reduziria o ganho
   real; o contrafactual mede apenas a capacidade de classificação.
3. `RANGE` subiu a 32,7% porque o eixo de tendência capado (2,75) cai no ramo range; parte desses casos pode ser
   tendência fraca real.

## 6. Requisitos para a futura V4 (não implementados aqui)

1. **Nova versão explícita** (`SCENARIO_ENGINE_V4`) com série separada; V3 congelada permanece como série histórica.
2. **Enriquecer o contrato T0→features de forma causal**: expor `velocity`/`acceleration`, BOOS/HH-HL derivados de
   swings já presentes no T0 (`structure.swings`), e opcionalmente `multiTimeframe` (nunca candles futuros).
3. **Recalibrar o limiar de tendência** (ou a escala de pontos) com validação walk-forward; documentar no freeze
   como decisão, não tuning.
4. **Nunca apagar motivos**: `reasons_for_wait` append-only (união, nunca reset), com reason em toda transição para WAIT.
5. **Fail-loud de features**: se inputs obrigatórios de regime estiverem ausentes, registrar `DATA_INSUFFICIENTE`
   como reason explícita (hoje vira silenciosamente `TRANSITION`/`RANGE`).
6. Repetir este diagnóstico a cada checkpoint (N=30/60/100/+100) usando `scripts/v3-wait-diagnosis.mjs` como
   ferramenta read-only.

## 7. Reprodução

```powershell
$env:DATABASE_URL = "<railway production>"
node scripts/v3-wait-diagnosis.mjs --replay --out docs/research/data/v3-wait-diagnosis.json
```

O script é somente-leitura: consulta `iq_scenario_shadow_observations`/`iq_scenario_timing_intersections`,
reprocessa o T0 com o motor congelado e emite o JSON com crosstab, decomposição, replay e contrafactual.
