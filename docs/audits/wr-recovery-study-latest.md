# WR RECOVERY — ESTUDO DE QUALIDADE (Fase 6.3)

> Somente trades com T0_DECISION_SNAPSHOT + FinalEntrySnapshot. Resultado nunca usado como feature.
> Amostra: **N=37 decididos** (17W/20L, WR 46.0%) · PnL normalizado -5.62 · expectancy/trade -0.1519 · payout medio 84.68 · break-even WR 0.5415

## 1. Amostra e cobertura
- candidates: 252 · cancelamentos: 248 · executadas com t0: 37

## 2. WIN vs LOSS por feature (effect size = diferenca de medias / desvio combinado)
| feature | media WIN | media LOSS | N W/L | effect size |
|---|---:|---:|---|---:|
| RSI | 49.4538 | 51.9475 | 17/20 | -0.44 |
| RSI slope | — | — | 0/0 | — |
| ADX | 27.1436 | 27.1614 | 17/20 | -0.002 |
| ADX slope | — | — | 0/0 | — |
| DI spread | 8.9091 | 8.4349 | 17/20 | 0.105 |
| DI spread slope | — | — | 0/0 | — |
| ATR ratio | 1.003 | 0.9973 | 17/20 | 0.041 |
| ATR slope | — | — | 0/0 | — |
| Donchian position | 0.5076 | 0.5152 | 17/20 | -0.042 |
| Dist. topo (ATR) | 1.9088 | 2.0754 | 17/20 | -0.221 |
| Dist. fundo (ATR) | 1.9749 | 2.2115 | 17/20 | -0.312 |
| Corpo do candle | — | — | 0/0 | — |
| Pavio superior | — | — | 0/0 | — |
| Pavio inferior | — | — | 0/0 | — |
| Velocidade | — | — | 0/0 | — |
| Aceleração | — | — | 0/0 | — |
| Streak micro | -0.5882 | 0 | 17/20 | -0.298 |
| Confiança trader | — | — | 0/0 | — |
| Evidências | 0 | 0 | 17/20 | — |
| Contraevidências | 0 | 0 | 17/20 | — |
| Mudanças de direção | 0 | 0 | 17/20 | — |
| Displacement entrada (ATR) | — | — | 0/0 | — |
| Payout | 84.5882 | 84.75 | 17/20 | -0.111 |

**Top 10 fatores (por |effect size|, N>=5 por lado):** RSI (-0.44), Dist. fundo (ATR) (-0.312), Streak micro (-0.298), Dist. topo (ATR) (-0.221), Payout (-0.111), DI spread (0.105), Donchian position (-0.042), ATR ratio (0.041), ADX (-0.002)
**Sem poder discriminativo (|d|<0.2):** ADX, DI spread, ATR ratio, Donchian position, Payout

## 3. Split temporal (sem embaralhar; gap 120s)
- discovery 18 · validation 8 · future 10
- modelo logistico (research) em discovery: AUC=0.7662 n=18
- pesos: rsi=-1.0692, adx=-0.1885, atrRatio=0.3796, donchianPosition=0.3282, bodyRatio=0, acceleration=0, directionChanges=0, entryDisplacementATR=0, traderConfidence=0, evidenceCount=0, contradictionCount=0

## 4. Curva seletiva (score do modelo aplicado fora do treino)
| threshold | accepted | coverage | W | L | WR | PnL norm |
|---:|---:|---:|---:|---:|---:|---:|
| >=40 | 5 | 62.5% | 3 | 2 | 60.0% | 0.54 |
| >=45 | 5 | 62.5% | 3 | 2 | 60.0% | 0.54 |
| >=50 | 4 | 50.0% | 2 | 2 | 50.0% | -0.32 |
| >=55 | 3 | 37.5% | 1 | 2 | 33.3% | -1.15 |
| >=60 | 1 | 12.5% | 0 | 1 | 0.0% | -1 |
| >=65 | 0 | 0.0% | 0 | 0 | — | 0 |
| >=70 | 0 | 0.0% | 0 | 0 | — | 0 |
| >=75 | 0 | 0.0% | 0 | 0 | — | 0 |
| >=80 | 0 | 0.0% | 0 | 0 | — | 0 |
| >=85 | 0 | 0.0% | 0 | 0 | — | 0 |
| >=90 | 0 | 0.0% | 0 | 0 | — | 0 |

## 5. Bracos SHADOW (mesma oportunidade causal; regras congeladas por hipotese)
| braco | accepted | coverage | W | L | WR | PnL norm | expectancy |
|---|---:|---:|---:|---:|---:|---:|---:|
| A_G2_JIT | 37 | 100.0% | 17 | 20 | 46.0% | -5.62 | -0.1519 |
| B_QUALITY_GATE | 29 | 78.4% | 14 | 15 | 48.3% | -3.19 | -0.11 |
| C_STABILITY | 19 | 51.3% | 8 | 11 | 42.1% | -4.22 | -0.2221 |
| D_CRITIC | 20 | 54.0% | 8 | 12 | 40.0% | -5.22 | -0.261 |
| E_MICROSTRUCTURE | 12 | 32.4% | 6 | 6 | 50.0% | -0.91 | -0.0758 |
| F_COMBINED | 3 | 8.1% | 2 | 1 | 66.7% | 0.66 | 0.22 |

## 6. Critic — losses confirmados e evidencias t0 nao capturadas
- losses confirmados: 20
- categorias: LATE_ENTRY=14, OVEREXTENSION=14, MICROSTRUCTURE_REVERSAL=14, REGIME_UNCERTAIN=2, WEAK_TRIGGER=5, DI_CONFLICT=3, LOCATION_BAD=4

## 7. Direcao / estabilidade
| bucket | N | W | L | WR | PnL norm |
|---|---:|---:|---:|---:|---:|
| STABLE | 19 | 8 | 11 | 42.1% | -4.22 |
| CHANGED_ONCE | 18 | 9 | 9 | 50.0% | -1.4 |

## 8. Price chase (displacement candidato→entrada em ATR)
- NEGATIVE: N=0 W=0 L=0 WR=— PnL=0
- SMALL: N=0 W=0 L=0 WR=— PnL=0
- MODERATE: N=0 W=0 L=0 WR=— PnL=0
- LARGE: N=0 W=0 L=0 WR=— PnL=0

## 9. Matriz setup x regime (top)
| setup x regime | N | W | L | WR | PnL norm |
|---|---:|---:|---:|---:|---:|
| TREND_PULLBACK x TREND_UP | 16 | 6 | 10 | 37.5% | -4.96 |
| TREND_PULLBACK x TREND_DOWN | 15 | 8 | 7 | 53.3% | -0.23 |
| REJECTION x TRANSITION | 2 | 1 | 1 | 50.0% | -0.14 |
| NO_VALID_SETUP x TRANSITION | 2 | 1 | 1 | 50.0% | -0.14 |
| RANGE_REVERSAL x RANGE | 1 | 1 | 0 | 100.0% | 0.85 |
| FAILED_BREAKOUT x RANGE | 1 | 0 | 1 | 0.0% | -1 |

## 10. Por mercado / direcao / regime
### Mercado
| chave | N | W | L | WR | PnL norm |
|---|---:|---:|---:|---:|---:|
| EURUSD:OTC | 16 | 6 | 10 | 37.5% | -4.96 |
| GBPUSD:OTC | 8 | 4 | 4 | 50.0% | -0.56 |
| GBPJPY:OTC | 8 | 3 | 5 | 37.5% | -2.42 |
| EURGBP:OTC | 5 | 4 | 1 | 80.0% | 2.32 |

### Direcao
| chave | N | W | L | WR | PnL norm |
|---|---:|---:|---:|---:|---:|
| SELL | 19 | 10 | 9 | 52.6% | -0.52 |
| BUY | 18 | 7 | 11 | 38.9% | -5.1 |

### Regime
| chave | N | W | L | WR | PnL norm |
|---|---:|---:|---:|---:|---:|
| TREND_UP | 16 | 6 | 10 | 37.5% | -4.96 |
| TREND_DOWN | 15 | 8 | 7 | 53.3% | -0.23 |
| TRANSITION | 4 | 2 | 2 | 50.0% | -0.28 |
| RANGE | 2 | 1 | 1 | 50.0% | -0.15 |

## 11. Saude / monitor
- status: OK · razoes: — · max sequencia de losses: 3

## 12. Respostas explicitas
1. **Por que o WR esta baixo?** WR observado 46.0% abaixo do break-even 54.1% do payout medio 84.68. Fatores: RSI (d=-0.44), Dist. fundo (ATR) (d=-0.312), Streak micro (d=-0.298).
2. **O que realmente diferencia WIN/LOSS?** RSI, Dist. fundo (ATR), Streak micro, Dist. topo (ATR), Payout, DI spread, Donchian position, ATR ratio, ADX
3. **O que NAO diferencia?** ADX, DI spread, ATR ratio, Donchian position, Payout
4. **Estamos operando demais?** cobertura JIT = 14.7% dos candidates; nao; o filtro JIT ja e restritivo.
5. **Qual % dos candidates deveria virar WAIT?** braços abstenham 91.9% (F) — valor SHADOW, nao operacional.
6. **O Critic permite entradas que deveria vetar?** losses confirmados com risco t0: 20 (categorias: LATE_ENTRY, OVEREXTENSION, MICROSTRUCTURE_REVERSAL, REGIME_UNCERTAIN, WEAK_TRIGGER, DI_CONFLICT, LOCATION_BAD).
7. **Instabilidade direcional preve LOSS?** STABLE WR=42.1% vs CHANGED CHANGED_ONCE WR=50.0%.
8. **Entramos depois do movimento?** buckets de displacement: NEGATIVE WR=—; SMALL WR=—; MODERATE WR=—; LARGE WR=—
9. **Microestrutura do ultimo segundo evitaria losses?** braço E: {"arm":"E_MICROSTRUCTURE","accepted":12,"coverage":0.3243,"wins":6,"losses":6,"wr":0.5,"normalizedPnl":-0.91,"expectancy":-0.0758} — SHADOW.
10. **Melhor configuracao em dados FUTUROS?** Sem dados futuros reais de braços ainda: as decisoes SHADOW passaram a ser registradas nesta fase; a cauda final desta amostra e apenas in-sample.
11. **Existe evidencia prospectiva de ganho?** **NAO HA EVIDENCIA PROSPECTIVA AINDA.** Os bracos B–F foram congelados agora; o ganho aparente (E: WR 0.5, F: N=3) e in-sample e NAO deve ser promovido.

## 13. Multiple testing
- hipoteses testadas: 23 features + 6 bracos. Interpretar com correcao (Bonferroni ~ p*23); nenhum resultado e conclusivo com N=37.
