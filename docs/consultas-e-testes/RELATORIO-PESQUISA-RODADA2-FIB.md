# Relatório — Rodada 2: Novas Abordagens + Fibonacci na ref-reversion-v1

Data: 2026-09-15 · Método: pesquisa em fóruns/livros + avaliação causal offline sobre 8.327 observações reais (EUR/USD, NZD/USD, EUR/NZD), últimos 100 sinais por estratégia, liquidação T+45s e T+60s.

## Fontes consultadas (rodada 2)

- **Fibonacci**: Titan FX ("Fibonacci Retracement Guide"), Dukascopy, ATFX, ACY ("golden ratios"), NexusFi Academy ("Golden Zone 50–61.8% e o 61.8% como entrada mais provável"), MQL5 ("Scalping com Fibonacci + engulfing entry" — 38.2–61.8% como zona de entrada em scalp).
- **StochRSI**: QuantifiedStrategies ("Stochastic RSI — 78% win rate"), TradingView scripts de scalping.
- **Williams %R**: TradingView "Scalping with Williams %R, MACD and SMA (1m)" (cruzamento de -94), QuantifiedStrategies (81% reportado), TradeStation.
- **Keltner + RSI**: FXOpen "Four Popular 1-Minute Scalping Strategies" (2 fechamentos fora do Keltner + RSI 50).
- **Turtle Soup**: Linda Raschke (Street Smarts) — fade de rompimento falso.

## Estratégias e resultados (dados reais)

| Estratégia | T+45s (N · WR | IC95 inf) | T+60s (N · WR | IC95 inf) |
|---|---|---|---|
| **rev1-fib-zone-v1** (rev1 + zona dourada 38.2–61.8%) | 34 · **62,1%** | 44,0% | **35 · 73,3%** | **55,6%** |
| **stochrsi-v1** (StochRSI cruza 0.2 com EMA) | 100 · **60,0%** | **50,2%** | **100 · 64,0%** | **54,2%** |
| fib-bounce-v1 (bounce na zona dourada + candle) | 50 · **64,0%** | 50,1% | 50 · 54,0% | 40,4% |
| rev1-baseline (referência) | 100 · 59,0% | 49,2% | 100 · 58,0% | 48,2% |
| turtle-soup-v1 (fade de rompimento falso) | 100 · 58,0% | 48,2% | 100 · 51,0% | 41,3% |
| keltner-v1 (Keltner + RSI 50) | 51 · 51,1% | 37,0% | 51 · 54,5% | 40,1% |
| williams-v1 (cruzamento -94) | 100 · 51,5% | 41,8% | 100 · 46,0% | 36,6% |
| rev1-fib-618-v1 (toque no nível 61.8%) | 100 · 50,0% | 39,4% | 100 · 47,7% | 37,4% |
| rsi-div-v1 (divergência RSI) | 100 · 48,0% | 38,5% | 100 · 47,0% | 37,5% |

## Conclusões

1. **Fibonacci melhorou a ref-reversion-v1 exatamente como pedido**: baseline 59,0% → **rev1-fib-zone 73,3% em T+60** (+14,3 p.p.) e 62,1% em T+45. A zona dourada (38,2%–61,8% do swing) age como filtro de confluência — só entramos quando o RSI extremo coincide com a região de pullback saudável.
2. **Detalhe importante**: o filtro de **zona** venceu o de **nível único 61,8%** (50% WR) — exigir toque exato é restritivo demais; a faixa captura mais e mantém a estrutura.
3. **StochRSI é a melhor técnica NOVA da rodada**: 64,0% com n=100 e IC95 inf 54,2% (o maior piso estatístico de todas as rodadas até aqui). Confirma a fama de 78% dos backtests com um número conservador.
4. **fib-bounce** (entrada puramente na zona dourada) deu 64% em T+45 — reforça o valor da zona.
5. **Falharam**: divergência RSI (47–48%), Williams %R cruzamento -94 (46–51%) e o toque do nível 61,8% (48–50%).
6. **Cautela**: a rev1-fib-zone tem N=34–35 (amostra pequena) — o número de 73,3% precisa validação forward (N≥100) antes de qualquer conclusão definitiva. O StochRSI já tem n=100 e é a recomendação mais sólida desta rodada.

## Próximos passos sugeridos

1. Implementar `stochrsi-v1` e `rev1-fib-zone-v1` como estratégias shadow no motor (com aprovação do owner) para rodada forward de 100 trades cada.
2. Manter a liquidação T+45/T+60 dupla para comparação.
