# GAUNTLET LOOP — DESCOBERTA EXAUSTIVA DE ESTRATÉGIAS (RELATÓRIO FINAL)

> Pesquisa shadow/offline. **Nenhuma estratégia foi implementada em produção; nenhum sinal operacional foi alterado.**
> Todos os números foram executados nos dados reais (Supabase produção, SELECT-only). Artefatos reproduzíveis em `docs/consultas-e-testes/gauntlet/` (16 obrigatórios).

## STOP CONDITION: GAUNTLET_PASS
- Auditoria executada sobre fontes reais; splits temporais com embargo; HOLD congelado antes da pesquisa; holdout executado **exatamente 1x** após o freeze (hash `2a49fb3e2b80ee87331fb2edf318d0d2`).
- 977 estratégias testadas e registradas; busca sistemática (não brute force cego); baselines incluídos; FDR + permutação de rótulos (time-shift circular) para selection bias.
- Crítico A (candidatos) → **PASS** (nenhum contraexemplo; apontou bug de unidades no FW inicial — corrigido e documentado). Crítico B (integração, reprodução do zero) → **PASS com limitações** (ver §Limitações).

## 1) FASE 0 — DATASET MANIFEST (auditado)
- Fonte: `shadow_trades` — **6.878 trades** (trade_id único 6878; 15 sessões; 3 ativos OTC: EUR/USD 3057, EUR/NZD 2935, NZD/USD 886; período 14/09 10:15Z → 15/09 14:27Z). Labels de sistema: WIN 2892 / LOSS 2947 / DRAW 510 / UNKNOWN 529.
- Snapshots únicos (session|segment|bucket5s): **3.212**. Elegíveis (≥31 candles 5s causais): **2.592** (620 descartados por warm-up). Duplicatas: 0 trade_ids duplicados; snapshots com múltiplos trades agregados (não contados como independentes).
- **Ground truth usado**: liquidação causal T+60 = 1ª observação real em [t0+60s, t0+90s] do mesmo session+segmento (fallback ativo+OTC+VALID). Cross-check com `settlement_price` do sistema: **2854 concordam / 18 divergem** (0,6%). Trades/replays derivados: nenhum tratado como trade independente. Amostras altamente correlacionadas (janelas de label sobrepostas) controladas por subset **independente** (1 snapshot por janela de 90s por grupo): **267 linhas** (DISC 151 / VAL 49 / HOLD 65).
- Labels T+60: up 1270 / down 1395 / draw 207 / missing 340 (draws e missing fora da acurácia).
- Splits temporais por quantis de t0 (60/20/20) com **embargo de 90s**: **DISC 1555 · VAL 513 · HOLD 517** (+7 no embargo). HOLD **não foi lido por nenhum builder**; único leitor: `gauntlet-holdout.cjs` (+ breakdown pós-hoc declarado).
- Causalidade: features construídas **somente** de observações com t < bucketEnd(t0); spot-checks bit-exact (Crítico C/A); regressão de mutação de futuro já PASS em fases anteriores do projeto; verificação independente via DB no Critic B.

## 2) FASE 2 — FEATURE UNIVERSE (causal, ~100 features)
Preço-ação (retornos 1/3/6/12/24/60, aceleração, body/wicks ratios, streaks, doji, candle grande, breakout, false breakout, compressão/expansão, HH/HL/LH/LL, pivôs fractal-2, distância a pivôs/máx-mín 24); Tendência (SMA10/20/50, EMA9/21, distância normalizada, slopes); Momentum (RSI7/14, s=(55−RSI14)/45, ROC multi-janela, MACD(12,26,9) line/signal/hist, Stochastic %K/%D, divergência bull/bear causal); Volatilidade (ATR14/50, vol12/24/60, ratio, Bollinger %B/largura, expansão de range); Fibonacci (swing 24 causais, 0.236–0.786, zona dourada, contexto upSwing, posição, distância a níveis, extensão 0.272); Temporal (hora UTC, minuto de sessão); Compostas (ER30/ER60, gates de regime chop/trend, gates de vol, gates fibOk). Catálogo: `feature-catalog.md`.

## 3) FASES 3-4 — STRATEGY FACTORY (busca em estágios, TUDO registrado)
| Etapa | Famílias | Testadas |
|---|---|---|
| 1 | Átomos (RSI, vol, momentum, ATR-overshoot, MACD, stoch, Bollinger, ER/regime, streaks, big candle, wick/S-R, breakout/falseBO, estrutura, Fibonacci, divergência, expansão) + baselines + produção | 81 |
| 2 | Pares AND e UNIÃO (top 20 átomos) | 380 |
| 3 | Trios AND e VOTO-3 (top 10) | 240 |
| 4 | Gates condicionais (top 12 × 18 condições: vol, regime, expansão, hora, sessão, fibOk) | 228 |
| 5 | Refinamento de vizinhos de parâmetro (±step) | 18 |
| 6 | Ensembles ponderados (top 6, subconjuntos de 4, 2 thresholds) | 30 |
| **Total** | | **977 (K teste n≥20: 732)** |

Search log completo: `search-log.jsonl` (toda tentativa, incluindo ruins). Eliminadas com motivo: `eliminated-strategies.json`.

## 4) FASE 5/8 — ABSTENTION + BASELINES
- WAIT permitido: coverage das melhores = 4-19% (seletivas por construção).
- Curvas coverage×acuração por consenso (100/75/50/25/10/5/1%): `coverage-accuracy.json`. Topo ~80-100% em buckets 1-5% (n=2-15 → **não interpretável**).
- Baselines (DISC / VAL): always_sell 50.4%/…; sempre BUY/SELL ~50%; random42 ~49%; last_candle ~48%; mom_follow val **41%**; produção: v7relaxed 58.2%/69.2%, v1fib 70.6%/85.7% (n=17/7), v3fib 53.8%/100% (n=39/8), v6fib n=0/n=3, v7and 100% (n=5/5). Candidatos batem baselines no DISC e VAL (Critic A §G).

## 5) FASE 6/7/9 — CRÍTICOS, ROBUSTEZ, SIGNIFICÂNCIA
- FDR (BH) q≤0,10: 322 "significantes" — **anti-conservador** com rótulos autocorrelacionados → decisão por **permutação circular (1000 shifts)**: melhor candidato `gate(struct_f|bullDiv)` p_perm individual 0,012; **family-wise (max-stat) p = 0,076** (borderline, não cruza 5%). Candidato grande `and(struct_f,macd_r)` p_perm 0,023.
- Walk-forward (4 folds DISC): `and(struct_f,macd_r)` 56/55/69/73; `and(fib_ctx,stoch_r_30)` 65/67/63/59 (estáveis); `gate(struct_f|bullDiv)` 57/61/91/78 (instável — depende de 1 fold); `gate(struct_f|expansion>1.3)` 46/50/57/81.
- Ablação: em `and(struct_f,macd_r)`: struct_f 56/53, macd_r 49/54 → combo 62/63 (ambos adicionam). Em `and(fib_ctx,stoch_r_30)`: fib_ctx 58/49, stoch 49/57 → combo 64/68. Em gates de struct_f: gate agrega no VAL.
- Fragmentação por ativo/regime: edges concentram-se em **chop (ER30<0.35)**; NZD/USD fraco para struct (49,3%); top candidatos consistentes em 2-3 ativos no DISC/VAL.

## 6) FASES 10-11 — FREEZE + BLIND HOLDOUT (executado 1x)
Finalistas congelados (hash `2a49fb3e…`): `and(struct_f,macd_r)`, `and(fib_ctx,stoch_r_30)`, `gate(struct_f|bullDiv)`, `gate(struct_f|expansion>1.3)` (+18 referências: produção, baselines, componentes).

| Finalista | DISC | VAL | **HOLD (blind)** | indep HOLD | **HOLD condicionado à direção** |
|---|---|---|---|---|---|
| and(struct_f,macd_r) | 62,2% n=222 | 63,2% n=68 | **75,3% n=85** (cov 19,1%) | 6/50% | SELL 84,7% n=59 (base 59%) · BUY 53,8% n=26 (base 41%) |
| and(fib_ctx,stoch_r_30) | 63,7% n=80 | 67,9% n=28 | **81,0% n=21** (cov 4,6%) | 3/33% | SELL 83,3% n=12 · BUY 77,8% n=9 |
| gate(struct_f\|expansion>1.3) | 59,4% n=239 | 62,5% n=64 | **72,9% n=70** (cov 15,9%) | 6/33% | SELL 81,6% n=38 · BUY 62,5% n=32 |
| gate(struct_f\|bullDiv) | 70,7% n=92 | 65,6% n=32 | **67,5% n=40** (cov 9,1%) | 5/80% | SELL 68,8% n=32 · BUY 62,5% n=8 |

Baselines no HOLD: always_sell 59,0% / always_buy 41,0% / random 48,0% / mom_follow 58,2% / v7relaxed 80,0% (n=20). O HOLD é **100% EUR/NZD** e com viés direcional de baixa — por isso a análise condicional por direção (acima): **todos os 4 batem a base direcional nos DOIS lados** (o viés sozinho não explica o resultado).

## 7) RESPOSTAS DIRETAS (1-15)
1. **Melhor simples**: `rsi_band_0.63_0.857` (núcleo do V6, sem Fib) 60,4%/54,5% n=96/44; para amostra grande, `struct_f` 55,7%/52,5% n=766/198. (`streak_r_3` 60,9% DISC → 40% VAL: morreu.)
2. **Melhor combinação**: `and(struct_f,macd_r)` 62,2%/63,2% (n=222/68) → 75,3% HOLD. Maior DISC absoluto: `and(er_f_0.35,exp_f)` 68,4% (VAL n=6).
3. **Melhor com Fibonacci**: `and(fib_ctx,stoch_r_30)` 63,7%/67,9% → 81,0% HOLD n=21 (1 ativo).
4. **Melhor sem Fibonacci**: `and(struct_f,macd_r)`.
5. **Fibonacci adicionou valor?** Parcial: sozinho não (fib_ctx 57,7% DISC/49,4% VAL); como **filtro estrutural de combos de reversão** sim — stoich sozinho 49,5%/56,5% → com fib_ctx 63,7%/67,9%, e ablação mostra ambas as pernas contribuindo. Com thresholds de produção o gate fibOk colapsa cobertura (prod_v6fib n=0 no DISC). **Não validado como edge universal.**
6. **Regime mais previsível**: chop (ER30<0,35) — concentração de todo o edge; regime de tendência gerou quase nenhum sinal.
7. **Maior acurácia**: `gate(struct_f|bullDiv)` 70,7% DISC / 65,6% VAL / 67,5% HOLD (fold 91% num único fold = instável).
8. **Melhor robustez**: `and(struct_f,macd_r)` (folds estáveis, n grande, edge direcional +21,8pp com IC bootstrap excluindo 0 no HOLD).
9. **Melhor coverage×accuracy**: `and(struct_f,macd_r)` (19% de cobertura com 62-75%).
10. **Estratégia ultra-seletiva com acurácia muito maior?** Só em buckets ridículos (top 1-5% por consenso: 80-100% com n=2-15) → **não defensável**; o honesto: `and(fib_ctx,stoch_r_30)` ~5% cobertura, 64-81%.
11. **Features que carregam sinal**: estrutura de swing (HH/HL), fade de MACD histogram, extremos de Stochastic, contexto Fibonacci (filtro), regime chop (ER), bullDiv/bearDiv e expansão (gates).
12. **Inúteis/enganosas**: momentum-follow puro (val 41%), breakout-follow (val 32%), Bollinger breakout (val 22%), stoch-follow, RSI bruto sem contexto, ER-trend sozinho (val 40,5%).
13. **Ótimas no discovery, mortas OOS**: `and(struct_f,er_f_0.35)` 63,7%→18,8%; `bb_break` 48,1%→22,2%; `and(streak_r_3,macd_r)` 60,5%→36,7%; `gate(streak_r_3|expansion>1.3)` 72,7%→52,6%; ensemble `vote3(...)` 75%→47,8%.
14. **Limite estatisticamente defensável**: +10 a +22pp sobre a base direcional para os 4 finalistas; FW p≈0,076 (não cruza 5%); com apenas 267 janelas independentes e holdout mono-ativo, **qualquer acurácia >75% neste dataset não é defensável**.
15. **Evidência para novo experimento shadow?** **Sim** — como hipóteses pré-registradas (não produção): os 4 finalistas, com monitoramento prospectivo multi-ativo e métricas por direção. Integração com `fwd_profiles` fica para a próxima etapa (não executada aqui).

## 8) CRÍTICOS (independentes)
- **Critic A (candidatos)**: PASS — 7 ataques, nenhum falso-positivo encontrado; reproduziu FW p=0,067 vs 0,076 (MC); apontou o bug de unidades do FW inicial (corrigido; documentado em `multiple-testing.json`).
- **Critic B (integração)**: PASS com limitações — reproduziu tudo do zero (contagens DB 6878/3212/2592, tA/tB, splits, 977 estratégias, hash do freeze, holdout recomputado); reportou: HOLD é de 1 ativo/janela de ~10h; janelas independentes escassas (3-6 por finalista); FW p 0,067-0,118 conforme convenção; lado SELL 84,7% é condicionado à direção (ajuste +21,8pp, cluster-bootstrap IC [+7,3; +29,3]pp).

## 9) LIMITAÇÕES (declaradas)
Overlap de rótulos (mitigado por subset independente, mas com n pequeno); HOLD mono-ativo/EUR-NZD + viés direcional (mitigado pela análise condicional); múltiplas comparações (correção por permutação max-stat, FW 0,076 — borderline); selection bias residual possível; sem validação prospectiva multi-ativo.

## 10) ARTEFATOS (16)
dataset-manifest.json · feature-catalog.md · strategy-registry.json (977) · search-log.jsonl · eliminated-strategies.json · candidate-strategies.json · ablation-results.json · walk-forward-results.json · coverage-accuracy.json · parameter-stability.json · multiple-testing.json · finalists-manifest.json (hash 2a49fb3e…) · blind-holdout-results.json (+holdout-sidebreakdown.json) · critic-report-candidates.md + integration-critic-report.md · reproduce.cjs (+scripts/) · FINAL-RESEARCH-REPORT.md (este).
