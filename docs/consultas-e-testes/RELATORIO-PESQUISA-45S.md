# Relatório — Pesquisa de Abordagens para Expiração 45s / 1min (Forex OTC)

Data: 2026-09-15 · Método: revisão bibliográfica em fóruns/livros/portais profissionais + avaliação causal offline sobre 8.327 observações reais de preço (EUR/USD, NZD/USD, EUR/NZD) com liquidação T+45s e T+60s.

## Fontes consultadas (fóruns e material profissional)

- **ForexFactory** — threads: "Free Binary Options Strategy" (RSI7 + ADX<20 + volume decrescente), "The Best Price Action Strategies in Binary Options" (Pin Bar, Inside Bar, Engulfing, S/R), "Simple 30 minutes Binary Options Strategy" (EMA6), "Forex scalping in 1 min time frame".
- **MQL5** — thread clássica "1M Timeframe Traders and 60 Second Binary Options" (Heikin-Ashi + RSI + Stochastic + S/R + Bandas de Bollinger + recuperação); blog "A Simple CCI Strategy for Scalpers" (CCI reclaim +200EMA).
- **IG / Admiral Markets / FOREX.com / FXCM / CMC / ACY** — guias de scalping 1 min: Stochastic (5,3,3) + EMA50/100, cruzamentos de EMAs, Bollinger squeeze breakout, RSI reversão.
- **Dukascopy** — "Top 5 indicadores para binárias": RSI, Bollinger, Stochastic, MACD.
- **IQ Option Blog** — "5 candlesticks": fechamento fora das Bandas + RSI >80/<20 + confirmação no 2º candle.
- **binaryoptions.co.uk / binaryoptions.net / Benzinga / Pocket Option** — três médias móveis (1–5 min), breakout 1 min, padrões de candle.

## Abordagens implementadas (6 novas + 2 referências)

| # | Estratégia | Regra (condensada) | Fonte principal |
|---|---|---|---|
| 1 | `stoch-trend-v1` | %K(5) cruza acima de %D(3) em zona <25 com EMA9>EMA21 (compra); espelhado venda | IG/Admiral/Forex.com |
| 2 | `pinbar-v1` | Pavio ≥2× corpo na mínima de 10 candles = compra; espelhado venda | ForexFactory/binaryoptions.com |
| 3 | `engulfing-v1` | Engolfo de alta após mom60<0 = compra; espelhado venda | Price action clássico |
| 4 | `cci-trend-v1` | CCI14 recupera de -100 com mom120>0 = compra; espelhado venda | MQL5 scalpers |
| 5 | `bb-squeeze-v1` | Largura BB <80% da média + rompimento da banda = direção do rompimento | IG/FXCM |
| 6 | `ema-cross-v1` | EMA5 cruza EMA13 com mom60>0 = compra; espelhado venda | binaryoptions.co.uk/IG |
| R1 | `ref-reversion-v1` | Reversão RSI extremo + vol<0,0009 (referência do experimento) | Connors |
| R2 | `ref-band-v6` | Banda RSI profundo + vol<0,0009 (referência do v6 ao vivo) | análise interna |

## Resultados (últimos 100 sinais por estratégia, dados reais)

| Estratégia | T+45s N | WR | IC95 inf | T+60s N | WR | IC95 inf |
|---|---|---|---|---|---|---|
| pinbar-v1 | 21 | 52,4% | 32,4% | 20 | **60,0%** | 38,7% |
| **ref-reversion-v1** | **100** | **59,0%** | **49,2%** | 100 | 58,0% | 48,2% |
| **stoch-trend-v1** | 68 | **55,9%** | 44,1% | 69 | 52,2% | 40,6% |
| cci-trend-v1 | 100 | 48,5% | 38,9% | 100 | 46,5% | 37,0% |
| engulfing-v1 | 27 | 48,1% | 30,7% | 25 | 44,0% | 26,7% |
| bb-squeeze-v1 | 63 | 45,9% | 34,0% | 63 | 44,4% | 32,8% |
| ref-band-v6 | 100 | 42,0% | 32,8% | 100 | 40,0% | 30,9% |
| ema-cross-v1 | 100 | 38,4% | 29,4% | 100 | 35,4% | 26,6% |

## Conclusões

1. **A técnica mais bem colocada da pesquisa é o Stochastic com filtro de tendência (`stoch-trend-v1`, 55,9% em T+45, n=68)** — mas ainda abaixo da família de reversão RSI.
2. **`ref-reversion-v1` continua a melhor com amostra cheia** (59% em 100 trades) — coerente com o experimento ao vivo (62,6% nos últimos 113 do ativo EUR/NZD).
3. **As técnicas mais "vendidas" foram as piores**: cruzamento de EMAs (35–38%) e BB squeeze (44–46%) — anti-edge no dado real; CCI ficou neutro.
4. **Pin Bar** mostra 60% em T+60, porém com N=20 (inconclusivo — precisa ≥100).
5. **Conflito relevante**: a banda do v6 (com filtro de vol) rendeu apenas 42% no conjunto histórico completo de sinais, divergindo do teste ao vivo (66,7% em 60 trades no EUR/NZD). Divergência provável = amostragem/timing (o engine não captura todos os candles; o offline avalia todos). **Veredito: banda do v6 NÃO confirmada** até o teste ao vivo fechar 100.
6. **45s vs 60s**: no agregado das abordagens, o T+45 não trouxe vantagem clara (2 levemente melhores, 2 piores, empate no resto). A vantagem do T+45 vista antes estava concentrada na banda profunda — não generaliza.

## Arquivos

- CSVs por estratégia/horizonte em `exports/research-45s/`
- Resumo bruto em `exports/research-45s/research-45s-summary.json`
