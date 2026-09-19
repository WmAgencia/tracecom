# EFFICACY v3 â€” medicao corrigida (read-only)

- Gerado: 2026-09-19T13:05:25.165Z. Cobertura pareada: {"v4Rows":988,"v4WithV3":988,"v4WithoutV3":0,"shadowJoinWas":577}
- Causa das perdas no v2: observacao V4 ocorre na CRIACAO do candidato; shadow-lab somente no FINAL ENTRY (candidatos cancelados antes nao geram linha shadow); janelas diferentes (shadow desde 2026-09-18T22:55Z; V4 desde 2026-09-19T10:38Z); consequencia: 474 linhas shadow settled sem par V4 e ~181 V4 settled sem linha shadow

## 1. G2 vs V4 pareado (V4 x V3-creation)
| coorte | decididos | W/L/D | WR | CI95 |
|---|---|---|---|---|
| A mesma direcao | 196 | 97/99/1 | 49.5% | 42.6-56.4% |
| B direcao oposta (V4) | 23 | 15/8/0 | 65.2% | 44.9-81.2% |
| B G2 pareado | 23 | 8/15/0 | 34.8% | 18.8-55.1% |
| C V4 WAIT (contrafactual G2) | 694 | 354/340/4 | 51.0% | 47.3-54.7% |
- Teste: delta 0.13 pp; p=0.972635

## 2. Late price audit

- mensurabilidade: {"deadlinePriceCaptured":38,"wouldBePresent":38,"wouldBeEqualsCurrent":0,"verdict":"MEASURABLE","note":"precos reais existem em late_policy.evaluations[].price; a igualdade anterior era comparacao de campos equivalentes, nao ausencia de preco."}
- late vs current: {"better":18,"worse":20,"equal":0}
- deadline vs candidate: {"measured":35,"better":13,"worse":22}
- outcome LATE_ACCEPT: {"n":38,"decided":38,"wins":18,"losses":20,"draws":0,"wr":0.4737,"ci95":{"low":0.3248,"high":0.6274},"lowN":false}

## 3. Location condicional (Scenario x Direction)
| veredito | decididos | W/L/D | WR | CI95 |
|---|---|---|---|---|
| NEUTRAL | 111 | 54/57/0 | 48.6% | 39.6-57.8% |
| FAVORABLE | 63 | 30/33/0 | 47.6% | 35.8-59.7% |
| UNFAVORABLE | 45 | 28/17/1 | 62.2% | 47.6-74.9% |

## 4. Structural vs short-horizon impulse

- N=219
| Structural alinhado | 61 | 33/28/0 | 54.1% | 41.7-66.0% |
| Structural NAO alinhado | 38 | 17/21/0 | 44.7% | 30.1-60.3% |
| Impulse alinhado | 189 | 96/93/0 | 50.8% | 43.7-57.8% |
| Impulse NAO alinhado | 30 | 16/14/0 | 53.3% | 36.1-69.8% |
- outcomeDirection: {"structuralMatchesOutcome":54,"impulseMatchesOutcome":110,"n":219}

## 5. Red Team stratification (sem veto)
| veredito | decididos | W/L/D | WR | CI95 |
|---|---|---|---|---|
| CHALLENGED_RESOLVED | 134 | 62/72/0 | 46.3% | 38.0-54.7% |
| CONFIRMED_UNCHALLENGED | 85 | 50/35/1 | 58.8% | 48.2-68.7% |
- vetos: 0

## 6. Componentes inertes

- MICROSTRUCTURE_AGENT: dominante 45%, estados 3, MI {"mi":0.003958,"n":219} (ESTADOS_VARIAM)
- VOLATILITY_AGENT: dominante 100%, estados 2, MI {"mi":0.006164,"n":219} (STATE_QUASE_CONSTANTE)
- LOCATION_AGENT: dominante 71%, estados 5, MI {"mi":0.003031,"n":219} (ESTADOS_VARIAM)
- PRICE_ACTION_AGENT: dominante 34%, estados 3, MI {"mi":0.003543,"n":219} (ESTADOS_VARIAM)
- MOMENTUM_AGENT: dominante 48%, estados 5, MI {"mi":0.007404,"n":219} (ESTADOS_VARIAM)

## 7. Funil por playbook
| cenario | detected | valid_ctx | trigger | synth_trade | final_trade | settled |
|---|---|---|---|---|---|---|
| TREND_CONTINUATION | 149 | 149 | 115 | 115 | 115 | 111 |
| TREND_PULLBACK | 588 | 588 | 77 | 77 | 77 | 72 |
| BREAKOUT | 52 | 52 | 25 | 25 | 25 | 25 |
| FAILED_BREAKOUT | 6 | 6 | 0 | 0 | 0 | 0 |
| RANGE_MEAN_REVERSION | 0 | 0 | 0 | 0 | 0 | 0 |
| REVERSAL | 130 | 130 | 13 | 13 | 13 | 12 |
| COMPRESSION_EXPANSION | 0 | 0 | 0 | 0 | 0 | 0 |
| TRANSITION_NO_TRADE | 63 | 63 | 0 | 0 | 0 | 0 |

## 8. Payout
- {"settledDirectional":220,"payoutPresent":220,"payoutCoverage":1,"avgPayout":83.4091,"breakEvenWr":0.5452,"observedWr":0.5114,"expectancy":-0.0617,"normalizedEv":-0.0617,"policy":{"noImputation":true,"payoutFromObservationOnly":true}}

## 9. Politica
- {"readOnly":true,"noTuning":true,"noAgentChange":true,"zeroReal":true}
