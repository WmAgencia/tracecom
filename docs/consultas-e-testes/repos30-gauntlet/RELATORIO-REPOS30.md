# Benchmark 30 Repositórios GitHub — Relatório Final (missão "aprox. 70% WR")

Data: 2026-09-16 · Mercados: IQOPTION EURUSD BINARY e OTC (10h, 5s, mesmo dataset canônico)
Protocolo: entrada close(T), liquidação close(T+60s) exato; WR = W/(W+L); empates D e WAIT U fora; payout 0.89 → breakeven 52.91%; sem tuning; causal.

## 1. Resultado principal (v2.2.0 — adapters auditados, fidelidade "EXATA" verificada por crítico independente rodada 3)

### BINARY (EURUSD, não-OTC)
| Candidato | Sinais | W | L | D | WR | BUY n/WR% | SELL n/WR% | Exp. | Status |
|---|---|---|---|---|---|---|---|---|---|
| qu1_revert3_min | 102 | 61 | 41 | 2 | 59.80% | 40/72.5 | 62/51.6 | +0.1303 | MELHOR N REAL |
| po1_priceaction_min | 156 | 82 | 74 | 12 | 52.56% | 74/52.7 | 82/52.4 | -0.0065 | sem edge |
| qu1_rsi_cross_min | 174 | 91 | 83 | 3 | 52.30% | 86/55.8 | 88/48.9 | -0.0116 | sem edge |
| pine_v6_st_macd_rsi_adx_5s | 148 | 75 | 73 | 9 | 50.68% | 84/52.4 | 64/48.4 | -0.0422 | sem edge |
| po2_ema_rsi_min | 91 | 45 | 46 | 4 | 49.45% | 47/55.3 | 44/43.2 | -0.0654 | sem edge |
| qt_dual_thrust | 1549 | 762 | 787 | 71 | 49.19% | 798/52.5 | 751/45.7 | -0.0703 | sem edge |
| qu1_sma_cross_min | 51 | 16 | 35 | 5 | 31.37% | 25/36.0 | 26/26.9 | -0.4071 | ruim |
| po1_levels_min | 2 | 2 | 0 | 0 | (100%) | | | | AMOSTRA NULA (n=2) |
| po1_multifactor_min | 2 | 2 | 0 | 0 | (100%) | | | | AMOSTRA NULA (n=2) |
| qu2_triple_confluence_5m | 0 | — | — | — | — | — | — | — | 0 sinais no período |

### OTC (EURUSD OTC)
| Candidato | Sinais | W | L | D | WR | BUY n/WR% | SELL n/WR% | Exp. | Status |
|---|---|---|---|---|---|---|---|---|---|
| qu1_revert3_min | 118 | 66 | 52 | 2 | 55.93% | 64/54.7 | 54/57.4 | +0.0571 | melhor OTC |
| qt_dual_thrust | 1882 | 930 | 952 | 18 | 49.42% | 942/48.9 | 940/49.9 | -0.0660 | sem edge |
| po1_levels_min | 99 | 49 | 50 | 0 | 49.49% | 65/52.3 | 34/44.1 | -0.0645 | sem edge |
| po1_multifactor_min | 119 | 58 | 61 | 0 | 48.74% | 79/51.9 | 40/42.5 | -0.0788 | sem edge |
| qu1_rsi_cross_min | 165 | 79 | 86 | 3 | 47.88% | 81/46.9 | 84/48.8 | -0.0951 | sem edge |
| po2_ema_rsi_min | 484 | 224 | 260 | 7 | 46.28% | 200/43.0 | 284/48.6 | -0.1253 | sem edge |
| po1_priceaction_min | 158 | 71 | 87 | 2 | 44.94% | 85/40.0 | 73/50.7 | -0.1507 | negativo |
| pine_v6_st_macd_rsi_adx_5s | 100 | 44 | 56 | 1 | 44.00% | 61/44.3 | 39/43.6 | -0.1684 | negativo |
| qu1_sma_cross_min | 36 | 12 | 24 | 0 | 33.33% | 18/27.8 | 18/38.9 | -0.3700 | ruim |
| qu2_triple_confluence_5m | 0 | — | — | — | — | — | — | — | 0 sinais |

### Histórico das versões
- v1 (adapters 5s iniciais, pré-crítico): po1_rsi35_65 55.31% n=2034 (BINARY) — **NÃO fiel ao código-fonte (RSI Cutler multi-fator rejeitado pelo crítico)**.
- v2.1.0 (correção parcial): po1 87.5% n=16 e po2 70% n=10 — **amostras pequenas demais; crítico reprovou fidelidade (tolerância/warm-up/cross≠estado)**.
- v2.2.0 (fiel, aprovada com ressalvas): tabelas acima. **Nenhum resultado ≥70% com N relevante.**
- Perturbação (causalidade): 0/80 mudanças em todas as rodadas.

## 2. Status por repositório (30 pesquisados, 27 clonados, 3 inacessíveis)

### Com estratégia testável (candidatos acima)
| # | Repo | Uso | Status |
|---|---|---|---|
| 1 | zuc1fer/quotex-bot (qu1) | revert3, rsi_cross, sma_cross | TESTADO — revert3 melhor do lote |
| 2 | carlosrod723/Quotex-Trading-Bot (qu2) | confluência tripla 5m | TESTADO — 0 sinais |
| 3 | artyomkap/PocketOptionBot (po1) | níveis+PA+RSI Cutler 1m | TESTADO — sem edge (OTC); n=2 (BINARY) |
| 4 | TopTrenDev/pocketoption-signal-bot (po2) | EMA20/50+RSI52/48+filtros 1m | TESTADO — sem edge |
| 5 | rajitha-yasas/Pine-Script-v6 (pine_v6) | ST+MACD+RSI+ADX | TESTADO — sem edge |
| 6 | je-suis-tm/quant-trading (qt) | Dual Thrust | TESTADO (aproximado, original daily) — sem edge |
| 7 | freqtrade/freqtrade-strategies (ft_strats) | estratégias de referência | REFERÊNCIA (GPL; sem variante <70% aplicável) |

### Frameworks/engines (não são estratégias — documentados)
backtrader, bt_fw, vectorbt, lean, nautilus, jesse, jesse_ex, pybroker, btpy, ft_tech (freqtrade core), iqnode, talib — NÃO_TESTÁVEL como estratégia.

### Dados/ML (não executáveis neste ambiente: sem Python/GPU/pesos)
finrl, ml4t, qlib, vol-trading, steve_fx, yfinance — NOT_READY/REFERENCE (sem fabricação).

### Inacessíveis (404 no clone)
ea31337, ping89, pandasta — URL indisponível (3/30).

## 3. Conclusão
- **Nenhum dos 30 repositórios entrega ≥70% WR com N relevante** nos 10h testados (nem no melhor caso BINARY/OTC).
- Melhor resultado com amostra relevante: **qu1_revert3_min — 59.80% BINARY (n=102, CI95 [50.1,68.8]) e 55.93% OTC (n=118)** — único acima do breakeven (52.91%) nos dois mercados, mas longe de 70%.
- po2 e po1 "70-100%" eram artefatos de adapter infiel/amostras n<20 — corrigidos e auditados (crítico rodada 3).
- Nenhuma promoção. Nada alterado em produção.
