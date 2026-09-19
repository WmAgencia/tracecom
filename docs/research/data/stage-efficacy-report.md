# EFICÃCIA POR ETAPA â€” v2 (coortes pareadas, testes, FDR)

- Gerado: 2026-09-19T12:48:17.247Z. Fonte: PROSPECTIVE_SHADOW_READ_ONLY. Contagens: {"g2Settled":566,"v4":866,"v3":4544,"timing":5147,"intersections":4545}.
- READ-ONLY. N pequeno sinalizado. WAIT fora do denominador. PROSPECTIVE â‰  PRACTICE â‰  REAL.

## 1. Coortes pareadas (mesma oportunidade)
| coorte | decididos | W/L/D | WR | CI95 |
|---|---|---|---|---|
| A G2 trade + V4 trade MESMA direÃ§Ã£o (V4) | 23 | 7/16/0 | 30.4% | 15.6â€“50.9% |
| B V4 direÃ§Ã£o DIFERENTE do G2 (V4) | 2 | 2/0/0 | 100.0% | 34.2â€“100.0% |
| B G2 na mesma oportunidade | 2 | 0/2/0 | 0.0% | 0.0â€“65.8% |
| C G2 trade + V4 WAIT (contrafactual G2) | 67 | 33/34/0 | 49.3% | 37.6â€“60.9% |

- B: McNemar b=0 c=2 p=0.4795
- D (G2 WAIT Ã— V4 TRADE): 0 (nÃ£o observado no fluxo atual)

## 2/3. Delta de seleÃ§Ã£o e teste pareado

| V4 aceitos | 25 | 9/16/0 | 36.0% | 20.3â€“55.5% |
| V4 evitados (contrafactual G2) | 67 | 33/34/0 | 49.3% | 37.6â€“60.9% |

- Delta: **-13.25 pp**; bootstrap CI95 [-0.357, 0.0824]; p=0.256229
- Estratificado (peso min decididos): **-13.39 pp** em 22 estratos com ambos braÃ§os; sinal invertido em estrato: SIM (checar Simpson)
  - market:USDCAD:OTC: delta -33.33 pp (A 0/4 vs B 1/3) p=0.212317
  - type:OTC: delta -13.25 pp (A 9/25 vs B 33/67) p=0.256229
  - regime:TREND_DOWN: delta -25.57 pp (A 2/11 vs B 14/32) p=0.130169
  - scenario:TREND_CONTINUATION: delta 30.77 pp (A 4/13 vs B 0/2) p=0.359637
  - market:EURGBP:OTC: delta -100 pp (A 0/1 vs B 1/1) p=0.157299
  - regime:TREND_UP: delta -2.94 pp (A 7/14 vs B 18/34) p=0.852915
  - scenario:TREND_PULLBACK: delta -11.59 pp (A 3/8 vs B 27/55) p=0.539656
  - market:USDCHF:OTC: delta -50 pp (A 0/1 vs B 2/4) p=0.36131
  - scenario:BREAKOUT: delta -66.67 pp (A 1/3 vs B 1/1) p=0.248213
  - market:USDJPY:OTC: delta 100 pp (A 1/1 vs B 0/1) p=0.157299
  - market:USDTRY:OTC: delta 0 pp (A 1/2 vs B 1/2) p=1
  - market:USDZAR:OTC: delta -66.67 pp (A 0/2 vs B 2/3) p=0.136037

## 4. Red Team â€” valor incremental

| Pass (Synthesis TRADE â†’ final TRADE) | 193 | 98/94/1 | 51.0% | 44.0â€“58.0% |
| Vetados (Synthesis TRADE â†’ WAIT, contrafactual) | 0 | 0/0/0 | â€” | â€” |

- Delta passâˆ’veto: **â€” pp**; bootstrap [null, null]; p=â€”
- Synthesis WAIT â†’ WAIT: 663; outros estados: 0

## 5/7/8. Especialistas
| agente | N alin | W/L alin | WR alin | N opos | WR opos | delta pp | p | status |
|---|---|---|---|---|---|---|---|---|
| MARKET_REGIME_AGENT | 174 | 85/89 | 48.9% | 16 | 75.0% | -26.15 | 0.045244 | INSUFFICIENT |
| VOLATILITY_AGENT | 106 | 55/51 | 51.9% | 84 | 48.8% | 3.08 | 0.673505 | EXPLORATORY |
| MOMENTUM_AGENT | 96 | 45/51 | 46.9% | 92 | 53.3% | -6.38 | 0.381363 | PROMISING |
| TREND_AGENT | 176 | 86/90 | 48.9% | 11 | 72.7% | -23.87 | 0.124613 | INSUFFICIENT |
| MARKET_STRUCTURE_AGENT | 174 | 85/89 | 48.9% | 9 | 66.7% | -17.82 | 0.297243 | INSUFFICIENT |
| PRICE_ACTION_AGENT | 109 | 61/48 | 56.0% | 22 | 45.5% | 10.51 | 0.366836 | EXPLORATORY |
| MICROSTRUCTURE_AGENT | 66 | 34/32 | 51.5% | 47 | 53.2% | -1.67 | 0.860426 | EXPLORATORY |
| LOCATION_AGENT | 0 | 0/0 | â€” | 10 | 40.0% | â€” | â€” | INSUFFICIENT |

## 9. Playbooks (scenario Ã— regime Ã— direction Ã— tipo)
| chave | N obs | cobertura | decididos | WR | CI95 | contrafactual evitado WR | status |
|---|---|---|---|---|---|---|---|
| TREND_CONTINUATION | TREND_UP | BUY | OTC | 52 | 0.9615 | 50 | 52.0% | 38.5â€“65.2% | â€” | EXPLORATORY |
| TREND_CONTINUATION | TREND_DOWN | SELL | OTC | 48 | 0.9583 | 46 | 45.6% | 32.1â€“59.8% | â€” | EXPLORATORY |
| TREND_PULLBACK | TREND_UP | BUY | OTC | 40 | 0.925 | 37 | 51.3% | 35.9â€“66.5% | â€” | EXPLORATORY |
| TREND_PULLBACK | TREND_DOWN | SELL | OTC | 28 | 0.9286 | 26 | 42.3% | 25.5â€“61.1% | â€” | EXPLORATORY |
| BREAKOUT | TREND_UP | BUY | OTC | 12 | 1 | 11 | 45.5% | 21.3â€“72.0% | â€” | INSUFFICIENT |
| REVERSAL | TREND_UP | SELL | OTC | 6 | 1 | 6 | 66.7% | 30.0â€“90.3% | â€” | INSUFFICIENT |
| BREAKOUT | TREND_DOWN | BUY | OTC | 4 | 1 | 4 | 75.0% | 30.1â€“95.4% | â€” | INSUFFICIENT |
| REVERSAL | TREND_DOWN | BUY | OTC | 5 | 0.8 | 4 | 75.0% | 30.1â€“95.4% | â€” | INSUFFICIENT |
| BREAKOUT | TREND_DOWN | SELL | OTC | 4 | 1 | 4 | 75.0% | 30.1â€“95.4% | â€” | INSUFFICIENT |
| BREAKOUT | TREND_UP | SELL | OTC | 2 | 1 | 2 | 100.0% | 34.2â€“100.0% | â€” | INSUFFICIENT |
| TREND_CONTINUATION | TRANSITION | BUY | OTC | 1 | 1 | 1 | 0.0% | 0.0â€“79.3% | â€” | INSUFFICIENT |
| TREND_CONTINUATION | TRANSITION | SELL | OTC | 1 | 1 | 1 | 100.0% | 20.6â€“100.0% | â€” | INSUFFICIENT |
| TREND_PULLBACK | TREND_DOWN | WAIT | OTC | 215 | 0 | 0 | â€” | â€” | â€” | INSUFFICIENT |
| REVERSAL | TREND_DOWN | WAIT | OTC | 52 | 0 | 0 | â€” | â€” | â€” | INSUFFICIENT |
| TREND_PULLBACK | TREND_UP | WAIT | OTC | 233 | 0 | 0 | â€” | â€” | â€” | INSUFFICIENT |
| TRANSITION_NO_TRADE | TRANSITION | WAIT | OTC | 38 | 0 | 0 | â€” | â€” | â€” | INSUFFICIENT |
| TREND_CONTINUATION | TREND_DOWN | WAIT | OTC | 16 | 0 | 0 | â€” | â€” | â€” | INSUFFICIENT |
| BREAKOUT | TREND_DOWN | WAIT | OTC | 12 | 0 | 0 | â€” | â€” | â€” | INSUFFICIENT |
| REVERSAL | TREND_UP | WAIT | OTC | 51 | 0 | 0 | â€” | â€” | â€” | INSUFFICIENT |
| TREND_CONTINUATION | TREND_UP | WAIT | OTC | 14 | 0 | 0 | â€” | â€” | â€” | INSUFFICIENT |
| TRANSITION_NO_TRADE | TREND_DOWN | WAIT | OTC | 9 | 0 | 0 | â€” | â€” | â€” | INSUFFICIENT |
| BREAKOUT | TREND_UP | WAIT | OTC | 7 | 0 | 0 | â€” | â€” | â€” | INSUFFICIENT |
| FAILED_BREAKOUT | TREND_DOWN | WAIT | OTC | 3 | 0 | 0 | â€” | â€” | â€” | INSUFFICIENT |
| BREAKOUT | TRANSITION | WAIT | OTC | 4 | 0 | 0 | â€” | â€” | â€” | INSUFFICIENT |
| TRANSITION_NO_TRADE | TREND_UP | WAIT | OTC | 5 | 0 | 0 | â€” | â€” | â€” | INSUFFICIENT |

## 10. Funil FAILED_BREAKOUT / RANGE
| cenÃ¡rio | synthesis primary | competing/secondary | aceitos | triggerStates | redTeam |
|---|---|---|---|---|---|
| FAILED_BREAKOUT | 6 | 1 | 0 | {"SCENARIO_COMPONENT_MISSING":4,"AMBIGUOUS_COMPETING_SCENARIOS":2} | {"CONFIRMED_UNCHALLENGED":6} |
| RANGE_MEAN_REVERSION | 0 | 0 | 0 | {} | {} |

## 11/12. Trigger e Data Quality
| grupo | decididos | W/L | WR | CI95 |
|---|---|---|---|---|
| trigger:TRIGGERED | 193 | 98/94/1 | 51.0% | 44.0â€“58.0% |
| trigger:AMBIGUOUS_COMPETING_SCENARIOS | 44 | 25/19/0 | 56.8% | 42.2â€“70.3% |
| trigger:CONTEXT_OK_NO_TRIGGER | 16 | 6/10/0 | 37.5% | 18.5â€“61.4% |
| trigger:SCENARIO_COMPONENT_MISSING | 6 | 3/3/0 | 50.0% | 18.8â€“81.2% |
| trigger:REGIME_TRANSITION | 1 | 0/1/0 | 0.0% | 0.0â€“79.3% |
| trigger:DATA_UNSAFE | 0 | 0/0/0 | â€” | â€” |

| dq:HEALTHY | 254 | 129/124/1 | 51.0% | 44.9â€“57.1% |
| dq:DEGRADED | 6 | 3/3/0 | 50.0% | 18.8â€“81.2% |
| dq:UNSAFE | 0 | 0/0/0 | â€” | â€” |

## 13/14/15. Late Window
| outcome | N | contrafactual original (WR) | reasons |
|---|---|---|---|
| LATE_CANCEL | 5031 | 48.4% (N=498) | CANDIDATE_LOGIC_CHANGED_TO_WAIT, VALID_SETUP_BUT_BAD_ENTRY_PRICE, CANDIDATE_SETUP_INVALIDATED, CANDIDATE_LOGIC_CHANGED_DIRECTION |
| OBSERVING | 79 | â€” |  |
| LATE_ACCEPT | 37 | 35.3% (N=17) |  |

- LATE_ACCEPT liquidados: 37 (WR 48.6%)
- Ambos braÃ§os liquidados: N=0
- Entry quality (LATE_ACCEPT): N=37; preÃ§o melhor 0 / pior 0 / igual 37; avaliaÃ§Ãµes extras mÃ©dias 46
- Coverage: {"accept":37,"cancel":5031,"observing":79,"total":5147,"coverageRate":0.0072}

### Late verdict Ã— contrafactual original
| veredito | N | WR original |
|---|---|---|
| CANCEL_CANDIDATE_LOGIC_CHANGED_TO_WAIT | 4025 | â€” |
| CANCEL_VALID_SETUP_BUT_BAD_ENTRY_PRICE | 245 | 48.9% |
| ACCEPT | 122 | 47.0% |
| CANCEL_QUALITY_SCORE_BELOW_THRESHOLD | 97 | 45.7% |
| CANCEL_CANDIDATE_LOGIC_CHANGED_DIRECTION | 27 | â€” |
| CANCEL_CANDIDATE_SETUP_INVALIDATED | 23 | â€” |
| CANCEL_CANDIDATE_REGIME_CHANGED | 6 | â€” |

## 16. Tabela de contribuiÃ§Ã£o por componente
| componente | baseline | com | sem | delta pp | decididos | status | nota |
|---|---|---|---|---|---|---|---|
| Regime | â€” | 48.85% | 53.6% | -5.95 | 28 | EXPLORATORY | ablation single-removal: cobertura 17% vs 22%; 18 decisoes mudaram |
| Structure | â€” | â€” | 42.9% | 4.76 | 7 | INSUFFICIENT | ablation single-removal: cobertura 5% vs 22%; 38 decisoes mudaram |
| Trend | â€” | â€” | â€” | -23.87 | 176 | INSUFFICIENT | alinhamento vs oposto (checar inversao) |
| Location | â€” | â€” | 48.6% | -1.03 | 37 | BUG_BLOCKED | ablation single-removal: cobertura 23% vs 22%; 12 decisoes mudaram |
| Momentum | â€” | â€” | 45.2% | 2.38 | 42 | EXPLORATORY | ablation single-removal: cobertura 33% vs 22%; 29 decisoes mudaram |
| Volatility | â€” | â€” | 48.6% | -1.03 | 37 | EXPLORATORY | ablation single-removal: cobertura 19% vs 22%; 5 decisoes mudaram |
| PriceAction | â€” | â€” | 47.1% | 0.56 | 34 | EXPLORATORY | ablation single-removal: cobertura 20% vs 22%; 13 decisoes mudaram |
| Microstructure | â€” | â€” | 47.6% | 0 | 42 | EXPLORATORY | ablation single-removal: cobertura 22% vs 22%; 0 decisoes mudaram |
| SynthesisTrigger | 49.25% contexto vetado | 36% triggered | â€” | -13.25 | 25 | EXPLORATORY | triggered vs vetados |
| RedTeam | 0% vetados | 51.04% passou | â€” | â€” | 192 | INSUFFICIENT | pass vs veto |
| DataQuality | 50% (degraded) | 50.99% (healthy) | â€” | 0.99 | 253 | INSUFFICIENT | healthy vs degraded |
| LateWindow | checkpoint atual | 48.65% (LATE_ACCEPT) | 48.39% (CANCEL original) | â€” | 37 | EXPLORATORY | cancelamentos logicos ainda sem contrafactual proprio |

## 17. Ablation / contribuiÃ§Ã£o marginal (single-removal; proxy, nÃ£o Shapley)

- amostra N=200; baseline V4 full: WR 47.6% cobertura 22%
| componente removido | decisÃµes mudadas | cobertura ablada | WR ablado | N ablado | delta WR (fullâˆ’ablado) | status |
|---|---|---|---|---|---|---|
| RSI | 29/200 (err 0) | 33% | 45.2% | 42 | 2.38 | EXPLORATORY |
| ADX | 18/200 (err 0) | 17% | 53.6% | 28 | -5.95 | EXPLORATORY |
| STRUCTURE | 38/200 (err 0) | 5% | 42.9% | 7 | 4.76 | INSUFFICIENT |
| LOCATION | 12/200 (err 0) | 23% | 48.6% | 37 | -1.03 | EXPLORATORY |
| MICROSTRUCTURE | 0/200 (err 0) | 22% | 47.6% | 42 | 0 | EXPLORATORY |
| HTF | 3/200 (err 0) | 20% | 51.3% | 39 | -3.66 | EXPLORATORY |
| VELOCITY | 21/200 (err 0) | 27% | 47.4% | 38 | 0.25 | EXPLORATORY |
| ACCELERATION | 1/200 (err 0) | 21% | 46.3% | 41 | 1.28 | EXPLORATORY |
| VOLATILITY | 5/200 (err 0) | 19% | 48.6% | 37 | -1.03 | EXPLORATORY |
| PRICE_ACTION | 13/200 (err 0) | 20% | 47.1% | 34 | 0.56 | EXPLORATORY |

## 18. Multiple testing (BH-FDR)
| teste | p | rank | q |
|---|---|---|---|
| stratum:regime:TREND_DOWN | 0.130169 | 1/20 | 0.516157 |
| stratum:market:USDZAR:OTC | 0.136037 | 2/20 | 0.516157 |
| stratum:market:EURGBP:OTC | 0.157299 | 3/20 | 0.516157 |
| stratum:market:USDJPY:OTC | 0.157299 | 4/20 | 0.516157 |
| stratum:market:USDCAD:OTC | 0.212317 | 5/20 | 0.516157 |
| stratum:market:NZDJPY:OTC | 0.220671 | 6/20 | 0.516157 |
| stratum:scenario:BREAKOUT | 0.248213 | 7/20 | 0.516157 |
| V4_selection_accepted_vs_avoided | 0.256229 | 8/20 | 0.516157 |
| stratum:type:OTC | 0.256229 | 9/20 | 0.516157 |
| stratum:market:EURJPY:OTC | 0.273322 | 10/20 | 0.516157 |
| stratum:scenario:REVERSAL | 0.342782 | 11/20 | 0.516157 |
| stratum:scenario:TREND_CONTINUATION | 0.359637 | 12/20 | 0.516157 |
| stratum:market:USDCHF:OTC | 0.36131 | 13/20 | 0.516157 |
| stratum:market:AUDCHF:OTC | 0.36131 | 14/20 | 0.516157 |
| stratum:market:EURNZD:OTC | 0.504985 | 15/20 | 0.631231 |
| stratum:market:GBPCAD:OTC | 0.504985 | 16/20 | 0.631231 |
| stratum:scenario:TREND_PULLBACK | 0.539656 | 17/20 | 0.634889 |
| stratum:market:EURCAD:OTC | 0.624206 | 18/20 | 0.693562 |
| stratum:regime:TREND_UP | 0.852915 | 19/20 | 0.897805 |
| stratum:market:USDTRY:OTC | 1 | 20/20 | 1 |

0 de 20 passam q<=0.10 (exploratÃ³rio).

## 19/20. Leitura

- Nenhuma conclusÃ£o definitiva com N pequeno; status por etapa na tabela acima.
- V4 nunca executou ordem; G2 broker executado = 0 nesta janela; a comparaÃ§Ã£o usa settlement causal da MESMA oportunidade.
