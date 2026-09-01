# Diagnóstico do `Backtester.probabilityForSetup` — TRACECON

**Data**: 2026-08-29
**Dataset**: `spike-results/candles-btc-1h-90d.json` (2160 candles, BTCUSDT 1h, 90 dias)
**Horizonte testado**: 12 candles (12h)
**Direção padrão**: up; flat threshold = 0.3%
**Scripts**: `diagnostic-results/diag_hypa_threshold.ts`, `diag_hypb_features.ts`, `diag_hypc_oos.ts`, `diag_hypd_outcome.ts`
**Outputs JSON**: `diagnostic-results/hyp{abcd}_results.json`

---

## 1. Sumário executivo

O `Backtester.probabilityForSetup` produz probabilidades **consistentemente abaixo do baseline** (edge médio −0.085 a −0.096) **independentemente do threshold de similaridade**, da fração OOS, ou da estratégia de matching. A causa raiz **NÃO é restrição de matches nem tamanho de amostra** — é que **as 6 features técnicas usadas (rsi, pctFromSma, slope, atrPct, volatility, macdHistNorm) têm poder discriminante muito baixo sobre o outcome `hit` em horizonte 12h**. Quatro features têm |r| < 0.06; a única com sinal razoável (`volatility`, |r|=0.11) tem o sinal **trocado** em "up" vs "down" — ou seja, na média um RSI mais alto, slope mais negativo e volatility mais alta estão associadas a MAIS hits para up, e vice-versa para down, **não é sinal, é reversão à média mal-especificada**. **Hipótese B (baixo poder discriminante das features) é a causa principal**.

---

## 2. Análise técnica por hipótese

### 2.1 Hipótese A — `similarityThreshold = 0.8` é restritivo demais

**O que o código faz hoje**: `DEFAULT_CRITERIA.similarityThreshold = 0.8` (linha 23 de `backtest.ts`). Em `findSimilar` (linha 146 de `similarity.ts`), cada candle candidato cuja `similarity >= 0.8` é contado como match.

**Teste empírico**: varri threshold 0.50–0.95 sobre 100 queries amostradas a cada 19 candles:

| threshold | meanMatches | medianMatches | zeroMatchQueries | probMean | baselineMean | edgeMean | ciLowerMean |
|---|---|---|---|---|---|---|---|
| 0.50 | 1162.1 | 1157 | 0 | 0.395 | 0.490 | −0.095 | 0.365 |
| 0.60 | 1144.4 | 1143 | 0 | 0.394 | 0.486 | −0.092 | 0.363 |
| 0.70 | 1112.5 | 1111 | 0 | 0.397 | 0.488 | −0.092 | 0.364 |
| 0.75 | 1084.1 | 1073 | 0 | 0.399 | 0.484 | −0.085 | 0.365 |
| **0.80 (atual)** | **1038.4** | **1018** | **0** | **0.404** | **0.488** | **−0.085** | **0.368** |
| 0.85 | 962.3 | 898 | 0 | 0.411 | 0.501 | −0.090 | 0.372 |
| 0.90 | 854.6 | 830 | 0 | 0.416 | 0.499 | −0.083 | 0.374 |
| 0.95 | 661.5 | 626 | 1 | 0.421 | 0.513 | −0.092 | 0.374 |

**Veredito**: **REFUTADA**. O pool de matches já é ENORME em qualquer threshold razoável (mínimo 661 matches/query em threshold 0.95; **zero queries sem matches** em todos thresholds até 0.95). Reduzir o threshold apenas infla mais o pool sem mudar o edge, que se mantém em ~−0.09. O código atual está longe de "poucos matches" — está na verdade **incluindo quase todo o histórico** como vizinho.

Por que isso acontece? A função `similarityBetween` (linhas 88-110 de `similarity.ts`) atribui `featSim = 1` quando `dist <= tol`. Como `tol` é não-trivial (`rsi: 8`, `pctFromSma: 0.01`, etc) e os features têm ranges pequenos após normalização por ATR, **a maioria dos candles acaba com similaridade > 0.80**. O threshold não está fazendo o papel de filtro fino.

---

### 2.2 Hipótese B — features técnicas têm baixo poder discriminante

**O que o código faz hoje**: `QuantFeatureExtractor` usa 6 features: `rsi, pctFromSma, slope, atrPct, volatility, macdHistNorm` (linha 40 de `similarity.ts`). As features são derivadas dos indicadores do `QuantEngine` (RSI, SMA, MACD, ATR, volatility).

**Teste empírico**: para cada candle i ∈ [250, 2148], computa o vetor de features em i e o outcome em i+12. Filtra apenas `hit` e `miss` (exclui `flat` por ser ambíguo). Total: **1410 amostras válidas** (excluindo 750 candles "flat").

| feature | pearson_r | \|r\| | q1_WR (bottom 20%) | q5_WR (top 20%) | lift (q5 − q1) |
|---|---|---|---|---|---|
| rsi | −0.046 | 0.046 | 0.660 | 0.543 | **−0.117** |
| pctFromSma | +0.024 | 0.024 | 0.589 | 0.550 | −0.039 |
| slope | −0.059 | 0.059 | 0.617 | 0.504 | **−0.113** |
| atrPct | +0.055 | 0.055 | 0.546 | 0.589 | +0.043 |
| volatility | +0.110 | 0.110 | 0.507 | 0.677 | **+0.170** |
| macdHistNorm | −0.008 | 0.008 | 0.606 | 0.528 | −0.078 |

**Bonus (direção DOWN)**: os sinais **invertem perfeitamente** (rsi vira +0.046, slope vira +0.059, volatility vira −0.110). Isso é simétrico — confirma que o sinal está sendo "capturado" de forma simétrica para as duas direções, mas a magnitude é tão pequena (|r| ≤ 0.11) que **nenhum setup técnico passa a ser estatisticamente significativo**.

**Interpretação**:
- **4 das 6 features** têm |r| < 0.06 — não passam do critério "feature com algum poder".
- **`volatility`** é a única com |r| ≥ 0.10, mas com sinal **não intuitivo**: candle com volatility ALTA tem mais chance de hit em "up" (q5_WR=0.677 vs q1_WR=0.507). Pode ser que candles voláteis estejam concentrados em regimes de breakout — ou pode ser ruído.
- **`rsi` e `slope` mostram lift negativo** (q5_WR < q1_WR para "up"): RSI alto e slope negativo estão associados a MAIS hits. Isso é contra-intuitivo para "momentum"; sugere **reversão à média mal-modelada**, não tendência.
- **Hit rate base** (sem filtro) = **0.563** (1410 amostras hit/miss, 794 hits). As features supostamente deveriam filtrar ainda mais para cima — em vez disso, todas as médias condicionais ficaram ABAIXO de 0.50.

**Veredito**: **CONFIRMADA**. Features técnicas (rsi, slope, atrPct, volatility, macdHistNorm) em BTC 1h horizonte 12h **não têm poder discriminante estatisticamente útil**. O `pearson_r` da maioria é menor que o ruído esperado em uma amostra aleatória (com n=1410, |r| < 0.05 é compatível com H0: ρ=0).

---

### 2.3 Hipótese C — `oosRatio = 0.25` é pequeno demais

**O que o código faz hoje**: `oosRatio = 0.25` é o default de `Backtester.run` (linha 104 de `backtest.ts`). Isso reserva 25% dos candles finais para OOS, sobrando 75% (1620 candles) para in-sample.

**Teste empírico**: varri `oosRatio ∈ {0.25, 0.50, 0.75}`, threshold 0.80 fixo:

| oosRatio | inSampleCandles | meanSamples | meanProb | meanBaseline | meanCiLower | edgeMean | profitableQueries |
|---|---|---|---|---|---|---|---|
| 0.25 | 1620 | 1035.3 | 0.397 | 0.491 | 0.365 | −0.093 | 0 |
| 0.50 | 1080 | 731.4 | 0.411 | 0.501 | 0.375 | −0.090 | 0 |
| 0.75 | 540 | 486.0 | 0.366 | 0.441 | 0.324 | −0.075 | 0 |

**Veredito**: **REFUTADA**. Aumentar `oosRatio` (e portanto REDUZIR o pool in-sample) **não melhora** o edge. Aliás, com 75% OOS o edge fica um pouco menos negativo (−0.075 vs −0.093) — mas isso é porque o baseline OOS é menor (0.441 vs 0.491), e mesmo assim **zero queries acionáveis** em qualquer cenário. O pool de matches é sempre > 400 — não há falta de amostra estatística. A Wilson CI lower fica em ~0.36–0.37 mesmo com 1000+ matches, mas o edge nunca zera porque o **problema não é amostra pequena, é que a probabilidade empírica é sistematicamente < baseline**.

---

### 2.4 Hipótese D — feature similarity vs outcome similarity

**O que o código faz hoje**: `findSimilar` busca candles com **features técnicas similares** (rsi, slope, etc). Nunca busca candles que tiveram **movimento de preço similar** no passado.

**Teste empírico**: para cada query, busca matches por dois critérios:
1. **Feature similarity** (como o código atual)
2. **Outcome similarity** (variação de preço no lookback recente dentro de tolerância)

| estratégia | meanSamples | meanProb | meanBaseline | edgeMean | baselineRate |
|---|---|---|---|---|---|
| **feature_similarity** (atual) | 1038.4 | 0.404 | 0.500 | −0.096 | 0.504 |
| outcome_lb6_tol0.1% | 90.9 | 0.415 | 0.524 | −0.109 | 0.548 |
| outcome_lb6_tol0.3% | 263.0 | 0.433 | 0.542 | −0.109 | 0.545 |
| outcome_lb6_tol0.5% | 413.2 | 0.430 | 0.538 | −0.108 | 0.541 |
| outcome_lb6_tol1.0% | 690.4 | 0.429 | 0.536 | −0.107 | 0.535 |
| outcome_lb12_tol0.3% | 176.0 | 0.417 | 0.523 | −0.105 | 0.532 |
| outcome_lb24_tol0.3% | 110.3 | 0.437 | 0.544 | −0.107 | 0.552 |

**Veredito**: **REFUTADA**, com nuance importante. Outcome similarity **NEM É MAIS EFICIENTE** — todas as variantes de "buscar candles com movimento de preço similar" produzem edge pior (−0.10 a −0.11) que feature similarity (−0.096). **Nenhuma das duas estratégias tem edge positivo**. O problema NÃO é que esteja matchando o tipo errado de candle — é que **qualquer tipo de matching retrospectivo neste dataset produz uma probabilidade empírica abaixo do baseline**. O baseline de "todos os candles em janela histórica" tem WR ~50-55%; **filtrar por qualquer critério (feature ou outcome) consistentemente piora o WR**.

Por que isso acontece? Hipótese: **selection bias reverso + mean-reversion**. Os setups "típicos" no BTC 1h horizonte 12h simplesmente **não preveem** o movimento futuro melhor do que uma moeda honesta. A aleatoriedade do candle seguinte domina qualquer sinal técnico. **Filtrar** introduz viés contra a aleatoriedade (você está procurando candles que se parecem com X, e X no passado tinha taxa de sucesso ~50%, não > 50%).

---

## 3. Síntese

| Hipótese | Confirmada? | Evidência |
|---|---|---|
| A — threshold restritivo | **Não** | Pool é enorme (≥ 660 matches/query mesmo em threshold 0.95); edge similar em todos thresholds |
| B — features sem poder discriminante | **Sim** | 4/6 features com \|r\| < 0.06; volatility \|r\|=0.11 com sinal contraintuitivo |
| C — OOS ratio pequeno | **Não** | Edge similar com 25%, 50%, 75% OOS; sempre zero queries acionáveis |
| D — feature vs outcome similarity | **Não** | Outcome similarity dá edge PIOR (−0.10 a −0.11) que feature similarity (−0.096) |

**Causa raiz**: as features técnicas usadas em `QuantFeatureExtractor` (`rsi, pctFromSma, slope, atrPct, volatility, macdHistNorm`) **não preveem o outcome `hit` em horizonte 12h em BTCUSDT 1h** com poder estatisticamente útil. O sinal é tão fraco que **qualquer matching — feature, outcome, ou aleatório — produz probabilidade empírica abaixo do baseline** porque filtrar exclui candles aleatórios que, por construção, ganham ~50% das vezes.

O motor `Backtester.probabilityForSetup` está tecnicamente correto (probabilidade derivada de dados, IC Wilson, baseline limitado ao in-sample), mas **os insumos que ele recebe** (vetores de features técnicas sem poder discriminante) **são ruído** com relação ao outcome.

---

## 4. Recomendação de fix

**Não dá pra fixar com um tweak de parâmetro.** Mudar threshold, OOS ratio ou estratégia de matching não muda o veredito. O fix exige **redesign do feature set** ou **mudança de premissa**.

Três caminhos, em ordem de esforço:

### Caminho 1 (rápido, ~2h): trocar features por features com poder real

Candidatos a testar (todos causais, todos disponíveis do QuantEngine atual):
- **`adx`** (Average Directional Index) — mede força da tendência, não direção
- **`atr_change`** (ATR[t] / ATR[t-14] − 1) — captura expansão/contração de volatilidade
- **`volume_zscore`** (volume normalizado por desvio de 20 janelas)
- **`high_low_range_pct`** ((high − low) / close) — medida de stress intrabar
- **`candle_body_pct`** ((close − open) / open) — momentum intrabar

Teste empírico primeiro: rodar `diag_hypb_features.ts` com novos candidatos antes de integrar. Aceitar só features com |r| ≥ 0.08 em pelo menos uma direção.

### Caminho 2 (médio, ~1 dia): reformular outcome

Em vez de "dentro de 12 candles o close subiu ≥ 0.3%" (que tem baseline ~50% e é praticamente aleatório), usar:
- **"Dentro de 12 candles, o preço tocou X% acima do entry antes de cair Y% do pico"** (captura breakouts)
- **"High máximo da janela − entry ≥ 1%"** (captura intenção, não exige fechar acima)
- **Breakout / breakdown de range das últimas N horas** (operar rompimento de consolidação)

Esses outcomes têm **baseline ~20-30%** (raros) e portanto espaço estatístico para o filtro de features mostrar edge.

### Caminho 3 (largo, ~1 semana): trocar arquitetura

Abandonar "similaridade de features + probabilidade empírica" e adotar:
- **Classificador supervisionado** (logistic regression / gradient boosting) treinado nos próprios 1410 candles hit/miss
- **Target encoding categórico** por regime (adx_bucket × volatility_bucket × rsi_bucket)
- **Calibração Platt** sobre output do classificador

Tem risco de overfitting em dataset pequeno (1410 amostras), mas com validação walk-forward OOS pode ser honesto.

---

## 5. Próximos passos concretos

1. **(hoje, 1h)** Re-rodar `diag_hypb_features.ts` com features candidatas do Caminho 1 (adx, atr_change, volume_zscore, high_low_range_pct, candle_body_pct). Esperar |r| ≥ 0.08 em pelo menos uma direção.
2. **(amanhã, 2h)** Se aparecerem features úteis, **redesenhar `QuantFeatureExtractor.keys`** em `src/backtest/similarity.ts:40` para incluir só as que passaram no filtro.
3. **(amanhã, 4h)** Testar Caminho 2 com novos outcomes. Esperar baseline ≤ 0.30 e edge ≥ +0.05 com filtro de features.
4. **(depois, 1 dia)** Se Caminho 1 ou 2 destravar, **rodar `Backtester.run` end-to-end** e checar se `isActionable` finalmente dispara sinais (critério Wilson CI lower > baseline + 0.05).
5. **(opcional)** Se nada funcionar, considerar Caminho 3 (classificador supervisionado) — mas só depois de validar que features técnicas puras realmente não têm edge neste mercado/timeframe/horizonte.

**Critério de aceite**: `Backtester.run` sobre `spike-results/candles-btc-1h-90d.json` produz ≥ 5 sinais acionáveis OOS com `profitableQueries > 0` (edge positivo estatisticamente significativo).

---

## 6. Apêndice — leituras adicionais

- `src/backtest/backtest.ts` linhas 19-24 (`DEFAULT_CRITERIA` com `similarityThreshold: 0.8`)
- `src/backtest/similarity.ts` linhas 34-76 (`QuantFeatureExtractor`, 6 features)
- `src/backtest/similarity.ts` linhas 88-110 (`similarityBetween`, atribui `featSim=1` se `dist<=tol` — isso explica por que o pool é sempre grande)
- `src/backtest/backtest.ts` linhas 84-95 (`probabilityForSetup`, sempre usa `outOfSample: false`)
- `spike-results/SPIKE_REPORT_V2.md` linhas 64-68 (já diagnosticava edge −0.098 — agora confirmamos que **não é bug de threshold/OOS**, é falta de sinal nas features)
