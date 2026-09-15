# BREAKOUT & MARKET STRUCTURE RESEARCH GAUNTLET — RELATÓRIO FINAL

> **Resposta objetiva: NÃO existe evidência (nem prospectiva nem de descoberta) de estratégia ≥70% com frequência alta nestes dados.** Melhor OTC prospectivo: **56,17% com ~82 sinais/hora** (blinded). Nada foi fabricado; o quality bar de 70% NÃO foi atingido honestamente.

## PROTOCOLO (corretamente respeitado)
1. **DISCOVERY** = 10h existentes (IQOPTION_EURUSD_BINARY_10H + IQOPTION_EURUSD_OTC_10H, 07:01–17:01Z; BINARY e OTC **separados**, nunca misturados).
2. **Features BX causais** (`bx-lib.cjs`): swing highs/lows (fractal-2, confirmados com 2 candles de atraso), S/R por clustering de pivôs (touches/idade/tempo desde toque/distância ATR), trendlines por regressão linear em pivôs (slope/R²/dist/break/reject), Donchian N12/24/48/96, qualidade de rompimento (dist/ATR, body, CLV, wicks, momentum multi-janela 15s–15min), falso rompimento (profundidade/idade), retestes, BOS/CHOCH/sweep/reclaim, compressão (range24/96, ATRratio) e expansão, microestrutura de ticks (imbalance up/down, spread, burst via ticks oficiais). **Truncamento causal PASS 25/25 em ambos datasets (e 20/20 + perturbação de futuro pelo crítico A).**
3. **Grade pré-registrada**: 92 hipóteses (A_breakout 36 · B_falsebreak 2 · A_trendline 4 · C_structure 3 · D_compression 8 · B_retest 1 · F_combos 36 · G0 baselines 2) **congeladas com hash ANTES de avaliar** (`bx-freeze.json`). BH-FDR por dataset.
4. **FINALISTS FREEZE** (regra pré-registrada: top-3 por Wilson-LB com indepN≥25 e sinais≥100): `gate_fbDn_rsi`, `tlbrk_0.5`, `tlbrk_0.7` (BINARY) · `fb_0.25`, `tlbrk_0.5`, `tlbrk_0.7` (OTC) — congelados 23:23:33Z.
5. **PROSPECTIVE BLIND** = dados NOVOS (nunca usados): 17:01Z→22:48Z (5,79h) e depois estendidos até 23:01Z (6,00h) — coletados do endpoint oficial após o freeze, persistidos no Supabase (`*_PROSP`).
6. **BUGFIX durante verificação** (protocolo correto): crítico B encontrou typo no compilador (`brkNN24up`) que deixava 44/92 hipóteses mortas. Corrigido e **descoberta re-executada**; novo candidato resultante (`brk_96_0_none`) foi re-testado já marcado **POST-HOC** (janela já vista) — e **colapsou para 37,0%** no prospectivo, confirmando a necessidade da marcação.

## RESULTADO — FINALISTAS BLIND (congelados antes da janela)
| Strategy | Dataset | Signals | sig/h | WR desp. | BUY WR | SELL WR | indepN | indepWR | edge pp | Discovery WR | Prospectivo WR |
|---|---|---|---|---|---|---|---|---|---|---|---|
| tlbrk_0.7 | OTC | 493 | 82,2 | **56,17%** | 51,5% | 66,5% | 28 | 35,7% | **+7,96** | 54,96% | 56,17% |
| tlbrk_0.5 | OTC | 786 | 131,0 | 53,27% | 47,0% | 66,7% | 44 | 40,9% | +4,99 | 54,92% | 53,27% |
| fb_0.25 | OTC | 1.031 | 171,8 | 51,62% | 43,1% | 62,7% | 51 | 56,9% | +2,26 | 55,47% | 51,62% |
| gate_fbDn_rsi | BINARY | 275 | 45,8 | 51,05% | 51,1% | — | 14 | 50,0% | +1,78 | 53,92% | 51,05% |
| tlbrk_0.7 | BINARY | 604 | 100,7 | 50,82% | 45,0% | 67,6% | 33 | 54,5% | +1,19 | 53,82% | 50,82% |
| tlbrk_0.5 | BINARY | 965 | 160,8 | 49,13% | 46,5% | 54,2% | 53 | 52,8% | −0,63 | 50,72% | 49,13% |
| POST-HOC brk_96_0_none | BINARY | 219 | 36,5 | **37,00%** | 32,2% | 44,3% | 18 | 38,9% | −12,86 | 54,04% | 37,00% |

Baselines prospectivos: BINARY buy 49,26% / sell 50,74% · OTC buy 45,28% / sell 54,72%.

## TOP HIGH-FREQUENCY (descoberta, ambos datasets)
`fb_0.1` OTC 2.670 sinais (270/h) 53,2% · `tlbrk_0.5` OTC 1.596 (161/h) 54,9% · `fb_0.25` OTC 1.491 (151/h) 55,5% · `bos` BINARY 3.063 (308/h) 49,2% · `tlbrk_0.5` BIN 1.441 (145/h) 50,7%.

## TOP HIGH-ACCURACY (com n≥50, descoberta e prospectivo)
Descoberta: `fb_0.25` OTC 55,5% (n=1.491) · `tlbrk_0.7` OTC 55,0% (n=982, BUY 62,4%) · `brk_96_0_none` BIN 54,0% (morto OOS). Prospectivo: **`tlbrk_0.7` OTC 56,2%** (melhor, honesto). **Nenhum ≥70%.**

## PARETO (WR × sinais/h × amostra independente)
- Fronteira útil: região 53–56% × 80–170 sinais/h × indepN 28–51 (família tlbrk/fb no OTC).
- Alta frequência (>300/h) degrada para ~49–53%.
- 70% só apareceu em amostras minúsculas na descoberta (n<50) — explicitamente rejeitado pelo quality bar.

## CRÍTICOS INDEPENDENTES (2 subagentes, cobrindo os 7 papéis)
- **Critic A (causalidade/geometria/settlement)**: PASS 5/5 — truncamento 25/25, perturbação de futuro 5/5, níveis/linhas comprovadamente formados antes do rompimento (OLS com pivôs ≤ i−2), T+60 12 buckets exato (10/10 amostras), freeze-antes-de-avaliar confirmado, hashes íntegros.
- **Critic B (overfitting/frequência/regime/prospectivo)**: achou o **bug do compilador** (corrigido e re-executado, conforme protocolo), confirmou que os finalistas estão em **platôs** (não picos: OTC fb 0,05–0,5 → 52–59%; tlbrk 0,3–0,9 → 54–74%), BH aritmética OK, fórmulas de frequência exatas, recalculou o prospectivo de 2 finalistas bit-exact, e **atacou o regime: o edge OTC concentra-se 11–18Z (manhã 49,2–49,7%)** — dependência de regime declarada. Nenhum ≥70% em nenhum arquivo.

## LIMITAÇÕES (declaradas)
Janelas de 5s sobrepostas (indepN é a métrica honesta; prospectivo tem indepN 14–53 por ativo); 6h de prospectivo é curto; edge OTC dependente de sessão (11–18Z); BINARY sem qualquer versão acima do ruído; `brk_96` provou o perigo post-hoc.

## RESPOSTA FINAL
**EXISTE evidência prospectiva de estratégia ≥70% com frequência alta? → NO.**
O melhor achado honesto: **`tlbrk_0.7` (OTC) — 56,2% prospectivo, ~82 sinais/h, +7,96pp vs base direcional, indepN 28** — hipótese para investigação futura (não declarada lucrativa; payout de referência ~85% ⇒ break-even ≈ 54,1%; margem estreita e regime-dependente).

## ARTEFATOS & PERSISTÊNCIA
`bx-freeze.json` · `bx-discovery-results.json` (+v1-buggy para auditoria) · `bx-finalists-freeze-blind.json` · `bx-prospective-results-blind.json` · `bx-prospective-results-extended.json` · `bx-lib.cjs`/`bx-run.cjs`/`bx-prosp.cjs`/`bx-prosp2.cjs`/`bx-fix-hashes.cjs` · `critic-bx-a.md` · `critic-bx-b.md` (GitHub `docs/consultas-e-testes/iqoption/breakout/`). Supabase: datasets `*_PROSP` READY + meta `bx-breakout-2026-09-15`. Nada dependeu do D:.
