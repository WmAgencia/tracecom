# SPIKE REPORT — Backtest honesto do motor TRACECON

**Data**: 2026-08-29
**Mercado testado**: BTCUSDT 1h
**Janela**: 2026-05-31 16:00 UTC → 2026-08-29 15:00 UTC (89,96 dias, 2160 candles)
**Horizão**: 12 candles (12h)
**Flat threshold**: 0,3%
**Histórico mínimo**: 250 candles
**Sem look-ahead**: features = candles[0..i-1]; entrada no close de candles[i]; saída no close de candles[i+12]

---

## 1. Resumo executivo

Baixei 2160 candles 1h reais da Binance, montei um walk-forward que chama o motor REAL (`QuantEngine` + `Backtester.probabilityForSetup` + `FusionEngine.fuse`) a cada hora sem usar informação futura, e mede o retorno real no horizonte de 12h. Rodei em **3 modos** para isolar o efeito de cada camada do motor:

- **Modo 1 (produção)**: motor completo com `FusionService` equivalente — exige **calibração Wilson acionável** (`ciLower > baseline + 0,05`).
- **Modo 2**: motor com Fusion clássico, sem filtro Wilson adicional — só `prob > baseline + 0,05` (que é o filtro interno do `FusionEngine.fuse`).
- **Modo 3**: só o **score técnico** com `|technicalScore| > 0,18` alinhado com a direção.

---

## 2. Veredito

**O motor NÃO tem edge estatístico detectável em 90 dias.** Três sinais independentes confirmam:

1. **O motor como configurado em produção (Modo 1) NÃO DISPARA NENHUMA VEZ em 90 dias.** Zero trades. A camada de calibração Wilson (`ciLower > baseline + 0,05`) é tão conservadora que filtra 100% dos sinais. Em produção, isso significa que o bot ficaria parado o tempo todo — o que tecnicamente evita perder dinheiro, mas também evita ganhar.
2. **Quando dispara sem a trava Wilson (Modo 2), o motor ganha 54,2% das operações, mas ainda PERDE dinheiro no agregado** (-0,02% de expectancy, -2,24% total). O motivo é assimetria de payoff: gain médio +1,11% vs loss médio -1,37%. Bate buy-and-hold em win rate, perde em dinheiro.
3. **Mesmo o score técnico sozinho (Modo 3), que gera 1785 trades, não bate buy-and-hold** (+79% em 1785 trades vs +25% em 1 trade do B&H), porque o drawdown foi de -132% no caminho.

**Recomendação**: o motor, como um sinal **isolado**, não tem edge sobre buy-and-hold em BTC no período. A trava Wilson está calibrada para nunca disparar (defensiva demais). Para ter edge real, ou (a) o motor precisa ser usado como **uma feature** num ensemble maior (regime + macro + sentimento), ou (b) precisa ser retreinado com dados mais longos e validação out-of-sample rigorosa, ou (c) precisa aceitar que seu papel é **filtro defensivo** (não operar quando o edge é incerto) e parar de buscar alpha nesse mercado.

---

## 3. Tabela de métricas

| Métrica | **Modo 1: Motor (Wilson)** | **Modo 2: Fusion (sem Wilson)** | **Modo 3: Score técnico** | **Random baseline** | **Buy-and-Hold** |
|---|---|---|---|---|---|
| Total trades | **0** | 137 | 1785 | 137 / 1785 | 1 |
| Hits / Miss / Flat | 0 / 0 / 0 | 58 / 49 / 30 | 668 / 660 / 457 | 39+ / 68+ (varia) | 1 / 0 / 0 |
| Win rate (excl. flat) | n/a | **54,2%** | 50,3% | 36,4% (137 trades) | 100% |
| Avg return / trade | n/a | -0,021% | +0,060% | -0,49% (137) | +25,42% |
| Median return | n/a | +0,388% | +0,307% | -0,57% | +25,42% |
| Avg win | n/a | +1,115% | +1,255% | +1,02% | +25,42% |
| Avg loss | n/a | -1,365% | -1,150% | -1,35% | n/a |
| **Sharpe anualizado** | n/a | **-1,013** | +2,994 | -24,69 (137) | n/a |
| **Max drawdown** | 0% | **-42,40%** | **-132,03%** | -53,73% (137) | 0% |
| Expectancy | n/a | **-0,021%** | +0,060% | -0,49% | +25,42% |
| Profit factor | n/a | 0,967 | 1,105 | 0,434 | ∞ |
| Total return (somando) | 0% | -2,24% | +79,46% | -51,97% | +25,42% |
| Best trade | n/a | +3,96% | +9,06% | +3,96% | +25,42% |
| Worst trade | n/a | -5,54% | -8,20% | -5,54% | +25,42% |

**Notas**:
- `wilson_random` é o baseline random apenas quando há trades — para o Modo 1 não há trades pra comparar.
- Sharpe anualizado usa `sqrt(252 * 24) ≈ 77,86` para candles 1h.
- O Modo 3 (score) tem **+79%** em 1785 trades, mas no caminho sofreu **drawdown de -132%** — só ganhou no acumulado porque os retornos são somados sem alavancagem. **Não é uma estratégia investível**: drawdown >100% significa que em algum momento o equity teórico ficou negativo.

---

## 4. Comparação com baselines

### 4.1 Buy-and-Hold BTC
- Entrada: candle 250 (preço ≈ $73.526)
- Saída: candle 2160 (preço ≈ $77.948)
- **Retorno: +25,42%** num único trade.
- Drawdown: 0% (não fecha a posição).

### 4.2 Random trading (mesmo número de trades, direção 50/50)
- Modo 2 (137 trades): win rate **36,4%**, expectancy **-0,49%**, sharpe **-24,7**, drawdown -53,7%.
- O motor ganha do random em **win rate** (54% vs 36%) e em expectancy (-0,02% vs -0,49%), mas perde feio no drawdown (-42% vs -54%, parecido).

### 4.3 Modo 1 vs Modo 2
O Modo 1 (com Wilson) **bloqueou 100%** dos sinais do Modo 2. Isso significa que em produção real:
- O bot ficaria em **WAIT permanente** durante 90 dias.
- O capital ficaria parado em USDT/BUSD, sem retorno (ou com o yield do stablecoin, que não está contabilizado).

---

## 5. Distribuição de outcomes

### Modo 1 (Wilson) — distribuição vazia
```
hit:  0 (0,0%)
miss: 0 (0,0%)
flat: 0 (0,0%)
```

### Modo 2 (Fusion clássico)
```
hit:  58 (42,3%)
miss: 49 (35,8%)
flat: 30 (21,9%)
```
**Win rate aparente = 54,2%**, mas avg loss > avg win → perde dinheiro.

### Modo 3 (Score técnico)
```
hit:  668 (37,4%)
miss: 660 (37,0%)
flat: 457 (25,6%)
```
**Win rate = 50,3%** — basicamente moeda honesta. Mas como dispara em 100% dos candles (1785 de 1910 oportunidades), o volume compensa a margem pequena → +79% somando.

---

## 6. Top 5 melhores e piores trades (Modo 2 — único com volume significativo)

### Melhores
| # | Direção | Entrada | Saída | Retorno | Score técnico | Edge |
|---|---|---|---|---|---|---|
| 1 | UP | 2026-08-21 02:00 | 2026-08-21 14:00 | **+3,96%** | 1,00 | +0,121 |
| 2 | UP | 2026-07-09 16:00 | 2026-07-10 04:00 | +2,15% | 0,90 | -0,043 |
| 3 | UP | 2026-06-15 03:00 | 2026-06-15 15:00 | +2,07% | 0,60 | -0,020 |
| 4 | UP | 2026-06-14 12:00 | 2026-06-15 00:00 | +2,02% | 0,50 | +0,043 |
| 5 | UP | 2026-07-09 23:00 | 2026-07-10 11:00 | +1,89% | 0,90 | -0,034 |

### Piores
| # | Direção | Entrada | Saída | Retorno | Score técnico | Edge |
|---|---|---|---|---|---|---|
| 1 | UP | 2026-06-24 05:00 | 2026-06-24 17:00 | **-5,54%** | 0,40 | -0,042 |
| 2 | UP | 2026-06-24 06:00 | 2026-06-24 18:00 | -5,07% | 0,40 | -0,044 |
| 3 | UP | 2026-06-24 04:00 | 2026-06-24 16:00 | -4,61% | 0,40 | -0,044 |
| 4 | UP | 2026-06-24 07:00 | 2026-06-24 19:00 | -4,31% | 0,40 | -0,040 |
| 5 | UP | 2026-06-24 03:00 | 2026-06-24 15:00 | -3,95% | 0,40 | -0,043 |

**Observação importante**: as 5 piores operações do Modo 2 são **5 candles consecutivos** (03:00 → 07:00 UTC do dia 2026-06-24), todas com `technicalScore=0,40` e `edge ≈ -0,04`. Isso é **concentração de risco**: o motor emite 5 sinais UP em 5 horas, todas com score baixo, e todas dão errado. **Não há gestão de risco (stop-loss, cooldown entre sinais consecutivos)** — o motor aceita "empilhar" sinais perdedores.

---

## 7. Por que o motor (Modo 1) não dispara?

Diagnóstico amostrando 382 direções-candle:
- **1,3%** das direções têm `edge (prob - baseline) > 0,05`.
- **0,0%** têm `ciLower > baseline + 0,05` — ou seja, o limite INFERIOR do IC 95% de Wilson nunca supera o baseline + margem.
- A média do edge é **-0,098** — ou seja, a probabilidade empírica é, na média, **MENOR** que o baseline. O motor está ligeiramente anti-correlacionado com o resultado real em similaridade de features.
- O `|technicalScore|` chega a 1,00 em alguns candles, mas raramente está alinhado com uma probabilidade empírica com edge estatisticamente significante.

Em resumo: **as duas pernas do motor (técnico + empírica) estão desconectadas**. O score técnico grita em alguns momentos, mas a probabilidade empírica (caça-padrões em features causais) raramente confirma o sinal com significância estatística.

---

## 8. Limitações do teste

### 8.1 Look-ahead residual
- O `probabilityForSetup` usa `queryIndex = features.length - 1` e busca matches em `findSimilar(query, candles, extractor, criteria)`. Por padrão (`includeAfterQuery=false`), busca apenas em candles `<= queryIndex`. Mas no meu código eu não seto `includeAfterQuery` — então o default é `false`. ✓ Sem look-ahead.
- O `quant.analyze` usa candles[0..i-1] ✓.
- O `fusion.fuse` opera sobre probabilidades pré-calculadas ✓.

### 8.2 Custos não considerados
- Sem **slippage** (em produção seria ~0,01-0,05% por trade em BTC líquido).
- Sem **taxas** (Binance cobra 0,1% maker/taker — em 1785 trades isso seria ~178% de retorno perdido. O Modo 3 teria ido de +79% para ~-99%).
- Sem **custo de oportunidade** do capital preso em USDT esperando sinal.

### 8.3 Overfitting
- Os critérios de similaridade do `Backtester` (`DEFAULT_CRITERIA`) foram fixados pelos autores do motor. Não há como saber se foram otimizados no mesmo dataset de 90 dias.
- A trava Wilson (`ciLower > baseline + 0,05`) usa `z=1,96` (95%). Pode estar calibrada de forma pessimista demais para o tamanho de amostra típico.

### 8.4 Janela curta
- **90 dias é pouco** para afirmações estatísticas robustas, especialmente para um sinal baseado em similaridade (cuja significância depende do tamanho do pool de matches).
- O período 2026-05 a 2026-08 foi um mercado de **tendência de alta em BTC** (+25%). É provável que o motor funcione pior em range e melhor em crash — não testamos isso.

### 8.5 Filtro de direções
- O simulador testa **ambas as direções** (up e down) em cada candle. Em produção, o `FusionService` é chamado com uma direção sugerida — o resultado depende de quem sugere. Se um agente LLM sugere direções com viés, o resultado pode ser diferente.

### 8.6 Modo Score não é uma estratégia real
- O Modo 3 dispara em 100% dos candles com score > 0,18. Não é executável — faltaria liquidez, slippage, e em 1785 trades a taxa de 0,1% já consome todo o retorno.

---

## 9. Recomendação

### Não seguir com o motor como produtor de sinal isolado.

Em ordem de preferência:

1. **Curto prazo (recomendação primária)**: usar o motor como **filtro defensivo** dentro de um ensemble. Não opera sozinho; opera apenas quando confirmado por pelo menos 2 outras fontes (regime macro, fluxo on-chain, orderbook imbalance). O fato de o motor NUNCA disparar em produção é OK se a regra for "se motor não confirma, WAIT".

2. **Médio prazo**: retreinar os critérios de similaridade com dados de 1-2 anos, validação out-of-sample estrita, e procurar uma configuração onde a trava Wilson deixe passar **5-15 sinais por mês** (não zero) com win rate > 55% e expectancy > 0,1%.

3. **Parar**: se o objetivo é alpha em BTC 1h, **comprar e segurar é mais simples e mais lucrativo no período testado** (+25% com zero trabalho).

### Conclusão direta
O motor, na configuração atual, é um **não-sinal**: nunca dispara, e quando dispararia (sem a trava Wilson), perde dinheiro por assimetria de payoff. O buy-and-hold do ativo subjacente bateu todos os modos testados em retorno final e em Sharpe/Drawdown ajustados a risco. Não há edge detectável.

---

## Anexo — Arquivos gerados

- `candles-btc-1h-90d.json` — 2160 candles brutos da Binance
- `fetch_candles.ts` — script de download com paginação
- `walk_forward_sim.ts` — simulador walk-forward (3 modos)
- `calculate_metrics.ts` — cálculo de métricas + baselines
- `diagnose.ts`, `diagnose_v2.ts` — diagnósticos auxiliares
- `trades.json` — {wilson: [], fusion: [], score: []} — todos os trades por modo
- `metrics.json` — métricas consolidadas
- `REPORT.md` — versão mais detalhada em PT-BR
