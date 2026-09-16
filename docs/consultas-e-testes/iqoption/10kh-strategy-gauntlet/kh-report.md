# 10.000H GRAND STRATEGY GAUNTLET — RELATÓRIO FINAL (honesto)

> **Resposta final: GAUNTLET_COMPLETE_NO_70_PERCENT_EDGE.** Nenhuma das 17 abordagens atingiu ≥70% em TRAIN, VAL, HOLDOUT ou FINAL BLIND. O melhor resultado cego: `fib_v7relaxed` (OTC) 54,04% com n=449 (indep 28/42,86%) — longe do quality bar.
> **REQUESTED_HOURS = 10000 · ACQUIRED_HOURS = 167,18h por instrumento (334,36h totais)** — o endpoint oficial público retém exatamente 7 dias (única fonte legítima pública; nenhum outro recurso oficial/público da IQ Option oferece histórico maior — verificado por sondagem em 1/2/3/5/6,8/6,95 dias). Nada foi inventado; o experimento continuou com o máximo real.

## DATASET (provenance A — IQ_OPTION_OFFICIAL)
| | BINARY (active_id=1) | OTC (active_id=76) |
|---|---|---|
| Horas | **167,18h** | **167,18h** |
| Período | 2026-09-08 23:56 → 09-15 23:07Z | idem |
| Ticks | 1.453.512 | 2.368.670 |
| Candles 5s | 120.368 | 120.368 |
| Gaps >5s | 0 | 0 |
| Duplicatas | 0 | 0 |
| Páginas raw | 408 (sha256/page) | 667 (sha256/page) |
| Persistência | candles+ticks no Supabase (`*_7D`) | candles no Supabase; ticks raw completos em disco (2,37M; 250k no Supabase por orçamento de tempo) |
| Observação | **fim de semana fechado (48h flatline) cai exatamente no split VAL** | 24/7 |

**Splits cronológicos** (embargo 24 candles): TRAIN 60.164 · VAL 24.041 · HOLD 18.025 · BLIND 18.026 (por instrumento).
**Paridade do novo motor de features (kh) com o engine v2 congelado: 0 mismatches (96 amostras, 6 chaves das Fib).**

## AS 17 ABORDAGENS (K=70 hipóteses congeladas ANTES de avaliar — `kh-freeze.json`)
| FAMILY | BEST (por família, critério pré-registrado) | MARKET | N train | INDEP (blind) | SIG/H (blind) | TRAIN WR | VAL WR | HOLD WR | BLIND WR |
|---|---|---|---|---|---|---|---|---|---|
| F01 z-score MR | z_z240_2.5_lowVol | OTC | 3.033 | 56 | 43 | 53,75% | 44,89% | 47,17% | 48,89% |
| F02 momentum exhaustion | ex_rsi_0.33 | OTC | 24.661 | 401 | 293 | 51,09% | 50,05% | 49,71% | 51,17% |
| F03 change-point | cp_mean_0.5 | OTC | 35.056 | 598 | 424 | 50,15% | 50,16% | 51,10% | 50,52% |
| F04 autocorr/runs | ac_fade_0.25 | OTC | 1.843 | 37 | 28 | 52,66% | 46,26% | 54,32% | 47,29% |
| F05 Markov | sem finalista (critério de seleção) | — | — | — | — | — | — | — | — |
| F06 tick microstructure | mi_imb_0.1 | OTC | 41.750 | 694 | 501 | 50,12% | 49,91% | 50,07% | 49,76% |
| F07 entropy | en_perm_0.8 | OTC | 20.069 | 334 | 232 | 50,29% | 48,41% | 48,05% | 51,47% |
| F08 Hurst | hu_mr | OTC | 6.931 | 133 | 88 | 51,68% | 49,45% | 48,79% | 51,08% |
| F09 pattern mining | sem finalista | — | — | — | — | — | — | — | — |
| F10 regime clustering | sem finalista | — | — | — | — | — | — | — | — |
| F11 supervised ML (logit+GBDT stumps; sem XGBoost/LightGBM/CatBoost nativos — documentado) | sem finalista | — | — | — | — | — | — | — | — |
| F12 ensemble multifamília | ens_vote | OTC | 26.465 | 456 | 319 | 50,82% | 49,59% | 49,11% | 50,76% |
| F13 Fib Dual Exhaustion (V7-AND) | sem finalista | — | — | — | — | — | — | — | — |
| F14 Fib Deep Exhaustion (V6) | sem finalista | — | — | — | — | — | — | — | — |
| F15 Fib RSI Reversal (V1) | sem finalista | — | — | — | — | — | — | — | — |
| F16 Fib Trend Reversal (V3) | sem finalista | — | — | — | — | — | — | — | — |
| F17 Fib Adaptive Reversal (V7-Relaxado) | **fib_v7relaxed** | OTC | 1.518 | 28 | **18** | 50,64% | **55,52%** | 50,00% | **54,04%** |

**BINARY: nenhuma família produziu finalista.** Causa dupla (documentada pelo crítico): (a) nenhuma ≥70% no TRAIN; (b) o split VAL caiu no fim de semana fechado do instrumento (flatline de 48h) → métricas degeneradas no filtro de seleção. OTC concentrou os únicos resultados acima do ruído — fracos.

## TOP ACCURACY / FREQUENCY / PARETO
- **TOP ACCURACY (TRAIN)**: z_z240_2.5_lowVol OTC 53,75% (n=3.033) — **colapsou OOS** (44,9/47,2/48,9%) = artefato de seleção clássico.
- **TOP ACCURACY (BLIND)**: fib_v7relaxed OTC 54,04% (n=449; SELL 60,0%; edge +3,99pp; indep 28/42,9%) · en_perm 51,47% (5.807) · hu_mr 51,08% (2.192).
- **TOP FREQUENCY (blind)**: mi_imb 501/h @49,8% · cp_mean 424/h @50,5% · ens 319/h @50,8% — **frequência alta só aparece ~50%**.
- **PARETO**: a fronteira real é 50–54% × 18–500 sinais/h — nenhum ponto próximo de 70%. Não há trade-off a explorar acima de ~54% nesses dados.

## WALK-FORWARD (7 blocos diários, OTC)
`fib_v7relaxed`: 51,9 / 48,0 / 52,9 / 49,2 / 52,8 / 57,7 / 48,6 · `cp_mean`: 51,1/49,2/49,1/51,2/50,4/50,4/50,9 · demais 43–55% oscilando sem persistência. **Nenhuma estratégia "funciona em semanas específicas" de forma explorável.**

## CRÍTICOS (independente final — PASS em 7/7)
Reconstrução independente de **todas as 1.062 páginas raw → 240.736 candles exatos**; perturbação de futuro (5/5 idêntico); labels T+60 (18 amostras exatas; 240.656 reprodutíveis); freeze-antes-de-blind por código+timestamps; splits/embargo conferidos; **zero ocorrências ≥70% com n≥50 em qualquer split**; conclusão suportada. Achado relevante do crítico: flatline de fim de semana do BINARY (cai no VAL).

## RESPOSTAS OBJETIVAS
1. **Horas reais adquiridas**: 167,18h por instrumento (334,36h totais) — máximo público legítimo (limite oficial de 7 dias).
2. **≥70% no TRAIN?** NÃO (nenhuma com n≥50).
3. **≥70% no VALIDATION?** NÃO.
4. **≥70% no HOLDOUT?** NÃO.
5. **≥70% no FINAL BLIND?** NÃO.
6. **Frequência do melhor blind**: 18/h (fib_v7relaxed) até 501/h (mi_imb) — precisão cai para ~50% quando a frequência sobe.
7. **Independent N**: melhor indep entre finalistas = 694/52,31% (mi_imb) e 598/51,84% (cp_mean); o líder de WR tem apenas indep 28.
8. **Binary e/ou OTC?** Somente OTC apresentou algo (fraco); BINARY não produziu nenhum candidato.
9. **Existe evidência reproduzível de ≥70% com frequência alta?** **NÃO.**

## ARTEFATOS
GitHub `docs/consultas-e-testes/iqoption/10kh-strategy-gauntlet/`: dataset-manifest, kh-freeze (K=70), finalists-freeze, validation-results (train/val/hold/walk-forward), blind-results, scripts (kh-fetch/kh-features/kh-run), critic-kh-report, este relatório. Supabase: datasets `*_7D` READY + meta `kh-17fam-2026-09-15`. Raw bruto (~1GB, 1.062 páginas) permanece em disco local com sha256 por página (regenerável por 7 dias pelo endpoint); candles completos no Supabase.

**GAUNTLET_COMPLETE_NO_70_PERCENT_EDGE** — nenhum ajuste foi feito para fabricar 70%; o quality bar não foi atingido honestamente.
