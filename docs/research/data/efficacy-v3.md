# EFFICACY v3 — medicao corrigida (read-only)

- Gerado: 2026-09-19T13:03:26.184Z. Cobertura pareada: {"v4Rows":969,"v4WithV3":969,"v4WithoutV3":0,"shadowJoinWas":573}
- Causa das perdas no v2: observacao V4 ocorre na CRIACAO do candidato; shadow-lab somente no FINAL ENTRY (candidatos cancelados antes nao geram linha shadow); janelas diferentes (shadow desde 2026-09-18T22:55Z; V4 desde 2026-09-19T10:38Z); consequencia: 474 linhas shadow settled sem par V4 e ~181 V4 settled sem linha shadow

## 1. G2 vs V4 pareado (V4 x V3-creation)
| coorte | decididos | W/L/D | WR | CI95 |
|---|---|---|---|---|
| A mesma direcao | 195 | 97/98/1 | 49.7% | 42.8-56.7% |
| B direcao oposta (V4) | 23 | 15/8/0 | 65.2% | 44.9-81.2% |
| B G2 pareado | 23 | 8/15/0 | 34.8% | 18.8-55.1% |
| C V4 WAIT (contrafactual G2) | 682 | 345/337/4 | 50.6% | 46.8-54.3% |
- Teste: delta 0.79 pp; p=0.83913

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
| UNFAVORABLE | 44 | 28/16/1 | 63.6% | 48.9-76.2% |

## 4. Structural vs short-horizon impulse

- N=218
| Structural alinhado | 61 | 33/28/0 | 54.1% | 41.7-66.0% |
| Structural NAO alinhado | 37 | 17/20/0 | 46.0% | 31.0-61.6% |
| Impulse alinhado | 188 | 96/92/0 | 51.1% | 44.0-58.1% |
| Impulse NAO alinhado | 30 | 16/14/0 | 53.3% | 36.1-69.8% |
- outcomeDirection: {"structuralMatchesOutcome":53,"impulseMatchesOutcome":110,"n":218}

## 5. Red Team stratification (sem veto)
| veredito | decididos | W/L/D | WR | CI95 |
|---|---|---|---|---|
| CHALLENGED_RESOLVED | 133 | 62/71/0 | 46.6% | 38.4-55.1% |
| CONFIRMED_UNCHALLENGED | 85 | 50/35/1 | 58.8% | 48.2-68.7% |
- vetos: 0

## 6. Componentes inertes

- MICROSTRUCTURE_AGENT: dominante 45%, estados 3, MI {"mi":0.003732,"n":218} (ESTADOS_VARIAM)
- VOLATILITY_AGENT: dominante 100%, estados 2, MI {"mi":0.00615,"n":218} (STATE_QUASE_CONSTANTE)
- LOCATION_AGENT: dominante 71%, estados 5, MI {"mi":0.002779,"n":218} (ESTADOS_VARIAM)
- PRICE_ACTION_AGENT: dominante 34%, estados 3, MI {"mi":0.003038,"n":218} (ESTADOS_VARIAM)
- MOMENTUM_AGENT: dominante 47%, estados 5, MI {"mi":0.008369,"n":218} (ESTADOS_VARIAM)

## 7. Funil por playbook
| cenario | detected | valid_ctx | trigger | synth_trade | final_trade | settled |
|---|---|---|---|---|---|---|
| TREND_CONTINUATION | 148 | 148 | 115 | 115 | 115 | 111 |
| TREND_PULLBACK | 575 | 575 | 76 | 76 | 76 | 71 |
| BREAKOUT | 51 | 51 | 25 | 25 | 25 | 25 |
| FAILED_BREAKOUT | 6 | 6 | 0 | 0 | 0 | 0 |
| RANGE_MEAN_REVERSION | 0 | 0 | 0 | 0 | 0 | 0 |
| REVERSAL | 129 | 129 | 13 | 13 | 13 | 12 |
| COMPRESSION_EXPANSION | 0 | 0 | 0 | 0 | 0 | 0 |
| TRANSITION_NO_TRADE | 60 | 60 | 0 | 0 | 0 | 0 |

## 8. Payout
- {"settledDirectional":219,"payoutPresent":0,"payoutCoverage":0,"avgPayout":null,"breakEvenWr":null,"observedWr":0.5138,"expectancy":"EXPECTANCY_UNKNOWN","normalizedEv":"EXPECTANCY_UNKNOWN","policy":{"noImputation":true,"payoutFromObservationOnly":true}}

## 9. Politica
- {"readOnly":true,"noTuning":true,"noAgentChange":true,"zeroReal":true}
