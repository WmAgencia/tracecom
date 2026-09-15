# BENCHMARK COMPLETO — IQ OPTION 10h (BINARY + OTC)

> Engine: **run-all.cjs v2 causal** (GitHub, extraída sem modificação; truncamento PASS 50/50 em ambos datasets). Dados: `iqopt_candles_5s` (Supabase).
> **Nada foi otimizado.** 972 specs únicos congelados com hash ANTES da avaliação (benchmark-freeze.json). Resultados ruins permanecem.

## TOTAIS
- Estratégias no inventário: **972** (G1 produção: 6, G2 pré-existentes do Gauntlet: 962, G0 baselines: 4)
- Testadas (por dataset): **968** · inválidas: **0**
- Hipóteses exploratórias novas (G3, pares mecânicos de 63 átomos ativos): **3906** (freeze separado ANTES da avaliação; BH-FDR por dataset)
- TraceCon 1M (extension/local-engine.js): INCOMPATIVEL: local-engine.js sem função de decisão pura exportável (realtime/page-bound).

## IQOPTION_EURUSD_BINARY_10H
Base rate (up): 53.07% · candles: 7201 · linhas: 7171 · independentes(90s): 399 · draws 295 · unknown 12

### TOP 15 por z-score (n≥50) — G0/G1/G2
| Strategy | sig | W | L | WR% | BUY WR% | SELL WR% | base% | edge pp | z | indep n/WR% | maxW/maxL |
|---|---|---|---|---|---|---|---|---|---|---|---|
| refine(mom_r_0.0001|t/1.5) | 3312 | 1696 | 1495 | 53.15 | 58.43 | 48.57 | 49.77 | 3.38 | 3.82 | 174/50.00 | 47/43 |
| gate(mom_f_0.0002|h12-17) | 220 | 129 | 83 | 60.85 | 60.56 | 60.99 | 49.11 | 11.74 | 3.42 | 15/60.00 | 35/9 |
| mom_r_0.0001 | 1834 | 956 | 819 | 53.86 | 58.77 | 49.23 | 49.90 | 3.96 | 3.34 | 88/52.27 | 33/44 |
| atr_2 | 2996 | 1510 | 1349 | 52.82 | 52.55 | 53.07 | 49.87 | 2.95 | 3.15 | 163/53.99 | 32/37 |
| gate(prod_v7relaxed|upSwing) | 176 | 109 | 60 | 64.50 | 64.50 | - | 53.07 | 11.42 | 2.98 | 8/62.50 | 21/7 |
| atr_1 | 4943 | 2457 | 2279 | 51.88 | 54.24 | 49.84 | 49.75 | 2.13 | 2.93 | 257/51.36 | 35/42 |
| atr_1.5 | 3884 | 1939 | 1783 | 52.10 | 53.07 | 51.25 | 49.74 | 2.35 | 2.87 | 208/53.37 | 39/41 |
| refine(atr_1.5|m0.25) | 3419 | 1709 | 1560 | 52.28 | 52.70 | 51.91 | 49.78 | 2.50 | 2.85 | 179/53.07 | 43/40 |
| vote3(fib_ctx;mom_f_0.0004;mom_f_0.0001) | 59 | 39 | 18 | 68.42 | 70.97 | 65.38 | 50.16 | 18.26 | 2.76 | 3/66.67 | 11/4 |
| sr_r | 3795 | 1881 | 1740 | 51.95 | 52.75 | 51.21 | 49.82 | 2.13 | 2.56 | 202/50.99 | 30/29 |
| refine(atr_1.5|m-0.25) | 4418 | 2188 | 2045 | 51.69 | 53.61 | 50.04 | 49.73 | 1.96 | 2.55 | 237/51.05 | 31/42 |
| rsi_s_0.33 | 3442 | 1743 | 1548 | 52.96 | 54.00 | 51.22 | 50.75 | 2.22 | 2.54 | 184/53.26 | 41/44 |
| rsi_vol_0.33_0.0009 | 3442 | 1743 | 1548 | 52.96 | 54.00 | 51.22 | 50.75 | 2.22 | 2.54 | 184/53.26 | 41/44 |
| rsi_vol_0.33_0.0006 | 3442 | 1743 | 1548 | 52.96 | 54.00 | 51.22 | 50.75 | 2.22 | 2.54 | 184/53.26 | 41/44 |
| gate(struct_f|inZone) | 545 | 292 | 234 | 55.51 | 64.23 | 46.03 | 50.10 | 5.42 | 2.48 | 33/69.70 | 31/11 |

### G3 exploratórios — K=3906, sobreviventes q≤0.1 & n≥100: **1049**
| Strategy | q | sig | WR% | edge pp | z |
|---|---|---|---|---|---|
| and(rsi_s_0.22,mom_r_0.0001) | 0.0037 | 1448 | 56.42 | 6.12 | 4.58 |
| and(rsi_vol_0.22_0.0012,mom_r_0.0001) | 0.0037 | 1448 | 56.42 | 6.12 | 4.58 |
| union(mom_f_0.0002,mom_r_0.0001) | 0.0075 | 1529 | 55.37 | 5.65 | 4.35 |
| and(rsi_s_0.11,mom_r_0.0001) | 0.0086 | 1597 | 55.53 | 5.41 | 4.25 |
| and(rsi_s_0.33,mom_r_0.0001) | 0.0094 | 1263 | 56.35 | 5.83 | 4.07 |
| and(rsi_vol_0.33_0.0009,mom_r_0.0001) | 0.0094 | 1263 | 56.35 | 5.83 | 4.07 |
| and(rsi_vol_0.33_0.0006,mom_r_0.0001) | 0.0094 | 1263 | 56.35 | 5.83 | 4.07 |
| and(mom_r_0.0001,atr_1) | 0.0109 | 1561 | 55.05 | 5.15 | 4.01 |
| union(atr_2,struct_r) | 0.0134 | 3423 | 53.53 | 3.44 | 3.94 |
| union(mom_f_0.0002,atr_2) | 0.0189 | 2777 | 53.45 | 3.68 | 3.79 |

## IQOPTION_EURUSD_OTC_10H
Base rate (up): 48.91% · candles: 7201 · linhas: 7171 · independentes(90s): 399 · draws 115 · unknown 12

### TOP 15 por z-score (n≥50) — G0/G1/G2
| Strategy | sig | W | L | WR% | BUY WR% | SELL WR% | base% | edge pp | z | indep n/WR% | maxW/maxL |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gate(mom_f_0.0002|h12-17) | 2556 | 1348 | 1175 | 53.43 | 50.93 | 55.44 | 50.11 | 3.32 | 3.34 | 142/47.89 | 56/25 |
| gate(struct_f|sessMin<30) | 227 | 135 | 90 | 60.00 | 64.23 | 53.41 | 49.75 | 10.25 | 3.07 | 12/41.67 | 30/14 |
| gate(mom_f_0.0004|h12-17) | 1681 | 891 | 763 | 53.87 | 52.01 | 55.14 | 50.19 | 3.68 | 2.99 | 105/47.62 | 49/37 |
| and(macd_f,stoch_r_30) | 427 | 236 | 184 | 56.19 | 53.75 | 59.44 | 49.86 | 6.33 | 2.60 | 25/56.00 | 16/12 |
| gate(mom_f_0.00005|h12-17) | 3363 | 1732 | 1589 | 52.15 | 48.20 | 55.64 | 50.06 | 2.09 | 2.41 | 180/49.44 | 59/31 |
| vote3(rsi_band_0.63_0.857;streak_r_3;macd_f) | 568 | 308 | 255 | 54.71 | 54.97 | 54.30 | 49.77 | 4.94 | 2.34 | 34/41.18 | 11/11 |
| gate(mom_f_0.0001|h12-17) | 3076 | 1585 | 1453 | 52.17 | 48.59 | 55.30 | 50.07 | 2.10 | 2.32 | 163/49.08 | 58/29 |
| and(macd_f,stoch_r_25) | 308 | 171 | 132 | 56.44 | 55.31 | 58.06 | 49.82 | 6.62 | 2.30 | 19/47.37 | 15/9 |
| gate(mom_f_0.0004|bearDiv) | 474 | 254 | 214 | 54.27 | 55.07 | 44.12 | 49.06 | 5.21 | 2.25 | 29/48.28 | 16/12 |
| gate(macd_f|inZone) | 1396 | 734 | 650 | 53.03 | 53.46 | 52.67 | 50.09 | 2.94 | 2.19 | 73/50.68 | 24/18 |
| vote3(fib_ctx;rsi_band_0.63_0.857;macd_f) | 446 | 242 | 200 | 54.75 | 57.08 | 52.15 | 49.94 | 4.81 | 2.02 | 30/40.00 | 11/12 |
| refine(mom_r_0.0001|t/1.5) | 6455 | 3265 | 3102 | 51.28 | 50.32 | 52.19 | 50.04 | 1.24 | 1.98 | 339/56.64 | 38/59 |
| falsebo_r | 2878 | 1472 | 1368 | 51.83 | 49.62 | 54.10 | 49.99 | 1.84 | 1.96 | 148/59.46 | 28/28 |
| union(streak_r_3,stoch_f_10) | 2011 | 1031 | 948 | 52.10 | 48.88 | 55.28 | 50.00 | 2.09 | 1.86 | 114/44.74 | 17/14 |
| rsi_s_0.11 | 5673 | 2835 | 2732 | 50.93 | 49.79 | 53.01 | 49.69 | 1.24 | 1.84 | 304/56.58 | 32/63 |

### G3 exploratórios — K=3906, sobreviventes q≤0.1 & n≥100: **2**
| Strategy | q | sig | WR% | edge pp | z |
|---|---|---|---|---|---|
| and(rsi_s_0.44,macd_f) | 0.0035 | 171 | 69.70 | 20.04 | 4.60 |
| and(rsi_vol_0.44_0.0009,macd_f) | 0.0035 | 171 | 69.70 | 20.04 | 4.60 |

## ESTRATÉGIAS QUE MERECEM NOVA VALIDAÇÃO (hipóteses, NÃO 'vencedoras')
Critério mecânico: WR≥52% com n≥50 nos G1/G2 + subamostra independente (90s) com n≥20 e WR≥52%; listadas com métricas dos DOIS datasets.
| Strategy | dataset | n | WR% | indep | z | edge pp |
|---|---|---|---|---|---|---|
| mom_r_0.0001 | IQOPTION_EURUSD_BINARY_10H | 1775 | 53.86 | 88/52.27 | 3.34 | 3.96 |
| atr_2 | IQOPTION_EURUSD_BINARY_10H | 2859 | 52.82 | 163/53.99 | 3.15 | 2.95 |
| atr_1.5 | IQOPTION_EURUSD_BINARY_10H | 3722 | 52.10 | 208/53.37 | 2.87 | 2.35 |
| refine(atr_1.5|m0.25) | IQOPTION_EURUSD_BINARY_10H | 3269 | 52.28 | 179/53.07 | 2.85 | 2.50 |
| and(macd_f,stoch_r_30) | IQOPTION_EURUSD_OTC_10H | 420 | 56.19 | 25/56.00 | 2.60 | 6.33 |
| rsi_s_0.33 | IQOPTION_EURUSD_BINARY_10H | 3291 | 52.96 | 184/53.26 | 2.54 | 2.22 |
| rsi_vol_0.33_0.0009 | IQOPTION_EURUSD_BINARY_10H | 3291 | 52.96 | 184/53.26 | 2.54 | 2.22 |
| rsi_vol_0.33_0.0006 | IQOPTION_EURUSD_BINARY_10H | 3291 | 52.96 | 184/53.26 | 2.54 | 2.22 |
| gate(struct_f|inZone) | IQOPTION_EURUSD_BINARY_10H | 526 | 55.51 | 33/69.70 | 2.48 | 5.42 |

**Aviso estatístico**: janelas de 5s são sobrepostas (pseudo-replicação); o z e o CI tratam-nas como independentes e SÃO OTIMISTAS. A subamostra independente (90s) e o q-value (G3) qualificam a leitura. Nenhuma estratégia deve ser declarada lucrativa com base nestas 10h; a próxima etapa é congelar candidatas e testar em dados NOVOS.