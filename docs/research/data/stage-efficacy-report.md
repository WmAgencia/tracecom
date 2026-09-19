# EFICÁCIA POR ETAPA — relatório prospectivo (real, read-only)

- Gerado: 2026-09-19T12:32:10.378Z. Fonte: PROSPECTIVE_SHADOW. Contagens: {"shadow":561,"v4":741,"v3":4419,"timing":5000,"intersections":4419}.
- Todas as métricas com N e CI95; N<30 sinalizado. WAIT nunca entra no denominador do WR.

## G2 baseline (mesma oportunidade)
| conjunto | N | WR | CI95 | baixa precisão |
|---|---|---|---|---|
| G2 causal (contrafactual) | 547 | 48.4% | 44.3–52.6% | não |
| G2 broker executado | 0 | — | — | SIM |

## V4 seleção vs G2
| conjunto | N | WR | CI95 | baixa precisão |
|---|---|---|---|---|
| V4 aceitos (BUY/SELL) | 160 | 52.5% | 44.8–60.1% | não |
| V4 WAIT (contrafactual G2) | 56 | 46.4% | 34.0–59.3% | não |
| V4 NO_TRADE (contrafactual G2) | 0 | — | — | SIM |

- Delta de seleção (aceitos − evitados): **6.07 pp**

## V3 congelada

- Ações: {"WAIT":4419}
| V3 direcionais | 0 | — | — | SIM |
| V3 WAIT (contrafactual G2) | 431 | 47.8% | 43.1–52.5% | não |

## Especialistas (alinhamento vs resultado em trades aceitos)
| agente | N alinhado | WR alinhado | N oposto | WR oposto | delta pp |
|---|---|---|---|---|---|
| MARKET_REGIME_AGENT | 147 | 49.7% | 12 | 83.3% | -33.67 |
| MARKET_STRUCTURE_AGENT | 146 | 50.0% | 7 | 71.4% | -21.43 |
| TREND_AGENT | 148 | 50.0% | 9 | 77.8% | -27.78 |
| PRICE_ACTION_AGENT | 90 | 56.7% | 19 | 47.4% | 9.3 |
| MICROSTRUCTURE_AGENT | 57 | 52.6% | 40 | 55.0% | -2.37 |
| LOCATION_AGENT | 0 | — | 9 | 44.4% | — |

## Cenários / regimes / trigger / red team / DQ (aceitos com WR; evitados com contrafactual)

### Por cenário
| chave | N aceitos | WR aceitos | N evitados | WR evitados (G2) |
|---|---|---|---|---|
| TREND_CONTINUATION | 81 | 50.6% | 0 | — |
| TREND_PULLBACK | 53 | 49.1% | 0 | — |
| BREAKOUT | 18 | 61.1% | 0 | — |
| REVERSAL | 8 | 75.0% | 0 | — |
| TRANSITION_NO_TRADE | 0 | — | 0 | — |
| FAILED_BREAKOUT | 0 | — | 0 | — |

### Por regime
| chave | N aceitos | WR aceitos | N evitados | WR evitados (G2) |
|---|---|---|---|---|
| TREND_UP | 92 | 51.1% | 0 | — |
| TREND_DOWN | 67 | 53.7% | 0 | — |
| TRANSITION | 1 | 100.0% | 0 | — |
| UNCERTAIN | 0 | — | 0 | — |

### Por trigger de síntese
| chave | N aceitos | WR aceitos | N evitados | WR evitados (G2) |
|---|---|---|---|---|
| TRIGGERED | 160 | 52.5% | 0 | — |
| CONTEXT_OK_NO_TRIGGER | 0 | — | 0 | — |
| AMBIGUOUS_COMPETING_SCENARIOS | 0 | — | 0 | — |
| SCENARIO_COMPONENT_MISSING | 0 | — | 0 | — |
| REGIME_TRANSITION | 0 | — | 0 | — |
| DATA_UNSAFE | 0 | — | 0 | — |

### Por veredito do Red Team
| chave | N aceitos | WR aceitos | N evitados | WR evitados (G2) |
|---|---|---|---|---|
| CHALLENGED_RESOLVED | 96 | 47.9% | 0 | — |
| CONFIRMED_UNCHALLENGED | 64 | 59.4% | 0 | — |

### Por data quality
| chave | N aceitos | WR aceitos | N evitados | WR evitados (G2) |
|---|---|---|---|---|
| HEALTHY | 155 | 52.3% | 0 | — |
| DEGRADED | 5 | 60.0% | 0 | — |
| UNSAFE | 0 | — | 0 | — |

## LATE WINDOW (CURRENT vs LATE, observações pareadas)

- pares liquidados: 0 de 5000; decisões divergentes: 0
| CURRENT | 0 | — | — | SIM |
| LATE_WINDOW_V2 | 0 | — | — | SIM |
- delta LATE−CURRENT: **— pp**; late venceu current em 0; current venceu late em 0

## Interseção cenário×timing

- verdicts: {"INSUFFICIENT_DATA":4416,"BOTH_WAIT":3}
- late verdicts: {"CANCEL_CANDIDATE_LOGIC_CHANGED_TO_WAIT":3920,"CANCEL_QUALITY_SCORE_BELOW_THRESHOLD":95,"CANCEL_VALID_SETUP_BUT_BAD_ENTRY_PRICE":233,"ACCEPT":115,"CANCEL_CANDIDATE_SETUP_INVALIDATED":23,"CANCEL_CANDIDATE_LOGIC_CHANGED_DIRECTION":27,"CANCEL_CANDIDATE_REGIME_CHANGED":6}
| sobreviventes até o cutoff (G2 causal) | 110 | 46.4% | 37.3–55.6% | não |

## Caveats
- N prospectivo pequeno: toda metrica carrega N e CI95; nada e headline de performance.
- G2 baseline causal usa iq_shadow_observations (CAUSAL_COUNTERFACTUAL) para comparar na MESMA oportunidade; BROKER_EXECUTED e mostrado separado e nunca somado.
- V4/V3 WAIT nao tem settlement proprio; o resultado contrafactual vem do G2 causal da mesma oportunidade (mesmo T0/candles).
- PROSPECTIVE_SHADOW nao e PRACTICE nem REAL; nenhuma ordem foi executada pelo V4/V3.


### Detalhe complementar do Late Window (consulta extra 2026-09-19)

- Braco LATE_WINDOW_V2 liquidado (late_policy.result): WIN 17 / LOSS 19 -> WR 47,2% (N=36, CI95 amplo).
- Braco CURRENT com resultado preenchido: apenas 3 (2 LOSS, 1 DRAW) — insuficiente para comparacao pareada.
- G2 causal por veredito do late window (mesma oportunidade):
  - LATE ACCEPT: N=110, WR 46,4% (CI95 37,3–55,6%)
  - LATE CANCEL (VALID_SETUP_BUT_BAD_ENTRY_PRICE): N=229, WR 49,3% (CI95 42,9–55,8%)
  - LATE CANCEL (QUALITY_SCORE_BELOW_THRESHOLD): N=92, WR 45,7% (CI95 35,9–55,8%)
- Leitura: os tres grupos tem CI95 sobrepostos — sem evidencia ainda de que o LATE_WINDOW_V2 melhore a qualidade das entradas que sobrevivem ao cutoff. O comportamento dominante e CANCEL por mudanca logica (CANDIDATE_LOGIC_CHANGED_TO_WAIT, 3920): o contrafactual G2 desses casos e o proximo alvo de medicao.
