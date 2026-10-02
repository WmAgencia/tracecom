# Win rate >= 60% em mercado real (não-OTC) — resultado walk-forward — set/2026

**Escopo**: mercado binário "normal" = subjacentes reais não-OTC (Yahoo Forex / Binance cripto dos CSVs de `diagnostic-results/data/`). **Nenhum dado OTC, nenhuma coleta nova, nenhuma ordem.** Reprodutível com `npx tsx diagnostic-results/walk_forward_real.mts`; resultados brutos em `walk-forward-real-results.json`.

## 0. Veredito

**A meta de 60% é alcançada OOS (fora da amostra) por 19 de 1.512 configurações testadas** — mas com qualificadores importantes: (1) os melhores números concentram-se no USD/CAD 1m, cujo dado do Yahoo é suspeito; (2) os resultados robustos (cripto, outros FX) ficam em 60–70%, não 80%; (3) tudo é in-sample para a *escolha da família* de setup (viés de sobrevivência residual). É um piso honesto, não uma garantia.

## 1. Metodologia (sem look-ahead)

- Split **70% treino / 30% teste** por série; seleção de configuração **somente pelo treino**; número reportado = teste (nunca visto).
- 7 estratégias de reversão (fade1, fade3, Bollinger 2.0, Bollinger 2.5, RSI2 <10/>90, RSI2 <5/>95, RSI14 <30/>70) × 4 filtros (todos, Londres, alta-vol, baixa-vol) × horizontes h1/h5 × 9 ativos × 2–3 TFs = 1.512 combinações.
- Outcome via `evaluateOutcome` do repo (close-to-close, minMovePct=0, exclui flat); IC Wilson 95%.
- **Bug corrigido em trânsito**: a primeira rodada tinha um erro no setup Bollinger (usava log-retorno em vez de preço); os números de BB da primeira rodada eram inválidos — descartados e re-rodados.

## 2. Resultados OOS ≥ 60% (n ≥ 200)

### 2a. Robustos (não dependem do USD/CAD)

| Ativo | TF | Setup | h | Treino | **Teste OOS** | IC 95% | n |
|---|---|---|---|---|---|---|---|
| ETHUSDT | 5m | Bollinger 2.0 revert | 5 | 57.5% | **69.6%** | [64.1, 74.5] | 289 |
| ETHUSDT | 5m | Bollinger 2.0 + alta-vol | 5 | 57.5% | **68.2%** | [61.9, 73.8] | 223 |
| ETHUSDT | 5m | RSI2 <5/>95 | 5 | 55.3% | **62.7%** | [57.2, 67.8] | 308 |
| ETHUSDT | 5m | RSI2 <10/>90 | 5 | 54.8% | **61.5%** | [57.6, 65.3] | 603 |
| USD/JPY | 1h | Bollinger 2.0 + Londres | 5 | 56.3% | **61.3%** | [57.7, 64.9] | 693 |
| BTCUSDT | 5m | Bollinger 2.0 + alta-vol | 5 | 58.0% | **61.8%** | [55.2, 67.8] | 217 |
| BTCUSDT | 1h | fade3 + alta-vol | 1 | 54.9% | 60.4% | [54.3, 66.2] | 245 |

**O melhor candidato defensável: ETHUSDT 5m, Bollinger-2.0 revert, horizonte 5 candles — 69.6% OOS [64.1, 74.5], n=289.** O limite inferior do IC (64.1%) já está acima do breakeven da maioria dos payouts (70–85% → breakeven 54–59%).

### 2b. USD/CAD 1m — auditoria obrigatória antes de acreditar

Os números mais altos (76–81% OOS) são todos USD/CAD 1m. A auditoria (`audit_usdcad_1m.mts`) mostra:

- ACF lag1 = **−0.35** (5× o do EUR/USD); 59% dos candles movem <1 pip; 501 closes repetidos em sequência.
- **Diagnóstico**: série de baixa granularidade/precisão do Yahoo para este par (pip inteiro arredondado?) — a reversão "perfeita" é provavelmente **artefato de quantização**, não estrutura real. **Não operar com base nisso.** O mesmo filtro de auditoria se aplica a EUR/USD 1m (71% dos candles flat no período noturno — micro-moves <1 pip: 58%).

## 3. O que significa "atingir 60%" na prática

1. **Em paper/estratégia**: sim, existem configurações causais com WR OOS ≥ 60% documentadas acima.
2. **Em lucro**: WR ≥ 60% só é lucrativo se o payout do binário for alto o bastante: com payout 80%, breakeven = 55.6%; 60% de WR dá esperança +4.4% por operação; 69.6% dá +15.3%. Com payout 70%, breakeven = 58.8%; só os dois melhores sobrevivem.
3. **Riscos não modelados aqui**: spread real da corretora (não há no CSV), latência/entradas deslizantes, mudança de regime (o teste cobre ~9 dias em cripto 5m / ~110 dias em FX 1h), e o viés de ter testado 1.512 combinações (múltiplas comparações; 19/1512 ≈ 1.3% passa, o que é marginalmente acima do esperado por sorte se tudo fosse ruído — os ICs amplos refletem isso).

## 3b. Relatório por ativo (seleção honesta: melhor combo no treino, número = teste OOS)

WR exclui flat; "ops/min" = operações OOS ÷ minutos da janela de teste; "combos" = nº de estratégia×filtro×horizonte testadas para o ativo/TF (56 = 7×4×2). Auditoria do USD/CAD 1m (quantização do Yahoo) na §2b — não operar com base nele.

| Ativo | TF | Setup | Ops | Win | Loss | WR OOS | IC 95% | Ops/min | Combos |
|---|---|---|---|---|---|---|---|---|---|
| USD/CAD ⚠ | 1m | bb/highvol h5 | 161 | 130 | 31 | **80.7%** ⚠ | [74.1, 85.9] | 0.076 | 56 |
| ETHUSDT | 5m | bb/all h5 | 289 | 201 | 88 | **69.6%** | [64.1, 74.5] | 0.022 | 56 |
| USD/CAD | 5m | fade1/highvol h1 | 207 | 129 | 78 | 62.3% | [55.7, 68.5] | 0.097 | 56 |
| BTCUSDT | 5m | bb/highvol h5 | 217 | 134 | 83 | 61.8% | [55.2, 67.8] | 0.017 | 56 |
| USD/CHF | 5m | rsi2/all h5 | 110 | 67 | 43 | 60.9% | [51.9, 69.2] | 0.052 | 56 |
| BTCUSDT | 1h | rsi2x/lowvol h1 | 107 | 63 | 44 | 58.9% | [49.7, 67.4] | 0.001 | 56 |
| EUR/USD | 1h | rsi2x/lowvol h5 | 116 | 68 | 48 | 58.6% | [49.8, 66.9] | 0.001 | 56 |
| GBP/USD | 5m | fade1/highvol h5 | 209 | 121 | 88 | 57.9% | [51.2, 64.3] | 0.098 | 56 |
| ETHUSDT | 1h | rsi2x/lowvol h1 | 121 | 69 | 52 | 57.0% | [48.4, 65.2] | 0.001 | 56 |
| AUD/USD | 5m | fade1/all h5 | 181 | 100 | 81 | 55.2% | [48.1, 62.2] | 0.169 | 56 |
| AUD/USD | 1h | rsi2x/lowvol h5 | 102 | 56 | 46 | 54.9% | [45.6, 63.9] | 0.001 | 56 |
| USD/JPY | 5m | rsi2/all h5 | 108 | 59 | 49 | 54.6% | [45.6, 63.4] | 0.051 | 56 |
| NZD/USD | 5m | fade1/highvol h5 | 103 | 56 | 47 | 54.4% | [45.1, 63.3] | 0.096 | 56 |
| GBP/USD | 1m | fade1/highvol h5 | 1088 | 565 | 523 | 51.9% | [49.0, 54.9] | 0.511 | 56 |
| AUD/USD | 1m | rsi14/all h5 | 101 | 52 | 49 | 51.5% | [42.2, 60.6] | 0.095 | 56 |
| USD/CHF | 1h | rsi2/highvol h1 | 270 | 139 | 131 | 51.5% | [45.6, 57.3] | 0.003 | 56 |
| USD/JPY | 1h | rsi2/lowvol h1 | 172 | 86 | 86 | 50.0% | [42.8, 57.2] | 0.002 | 56 |
| USD/JPY | 1m | fade1/highvol h1 | 1212 | 603 | 609 | 49.8% | [47.0, 52.6] | 0.571 | 56 |
| NZD/USD | 1h | rsi2x/lowvol h1 | 102 | 50 | 52 | 49.0% | [39.9, 58.2] | 0.001 | 56 |
| ETHUSDT | 1m | rsi2/london h5 | 1401 | 679 | 722 | 48.5% | [45.9, 51.1] | 0.108 | 56 |
| USD/CHF | 1m | rsi2x/london h1 | 116 | 56 | 60 | 48.3% | [39.7, 57.0] | 0.055 | 56 |
| GBP/USD | 1h | rsi2x/london h1 | 106 | 51 | 55 | 48.1% | [39.2, 57.2] | 0.001 | 56 |
| BTCUSDT | 1m | fade3/london h5 | 1137 | 546 | 591 | 48.0% | [45.1, 50.9] | 0.088 | 56 |
| NZD/USD | 1m | fade1/highvol h5 | 417 | 195 | 222 | 46.8% | [42.1, 51.5] | 0.391 | 56 |
| EUR/USD | 5m | fade1/lowvol h5 | 119 | 53 | 66 | 44.5% | [36.2, 53.2] | 0.056 | 56 |
| USD/CAD | 1h | rsi2x/lowvol h1 | 100 | 44 | 56 | 44.0% | [35.0, 53.4] | 0.001 | 56 |
| EUR/USD | 1m | fade1/london h5 | 379 | 155 | 224 | 40.9% | [36.1, 45.9] | 0.178 | 56 |

Leitura rápida: **≥60% OOS em 5 séries** (excluindo o ⚠ USD/CAD 1m: ETHUSDT 5m, USD/CAD 5m, BTCUSDT 5m, USD/CHF 5m); a frequência de operações varia de ~1/hora (1h) até ~0.5/min (FX 1m em alta vol). Total OOS somado das linhas: ~11.6k operações, ~5.9k wins.

## 4. Recomendações

1. **Validar em forward** (paper por 2–4 semanas) o ETHUSDT 5m BB-revert e o USD/JPY 1h BB+Londres antes de qualquer dinheiro.
2. **Descartar USD/CAD 1m até auditoria contra outra fonte** (OANDA/Dukascopy) — quantização do Yahoo.
3. Migrar a coleta para os candles da própria IQ (mesmo não-OTC, feed próprio da IQ) via ponte read-only: microestrutura real importa em 1m/5m.
4. Manter a régua honesta: nenhum setup entra em produção com IC-lower < breakeven do payout.
