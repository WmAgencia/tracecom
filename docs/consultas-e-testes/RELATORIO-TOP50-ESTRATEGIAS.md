# AS 50 MELHORES ESTRATÉGIAS — Compilado e Avaliado (113 trades cada)

Data: 2026-09-15 · Compilação das técnicas mais citadas em livros/fóruns profissionais (Connors, Wilder, Raschke, Ichimoku, Fibonacci, VWAP, MQL5/ForexFactory/IG/Admiral/FXCM/CMC/QuantifiedStrategies/TradingView) + estratégias do próprio motor do experimento. Todas avaliadas com o mesmo motor causal sobre 8.327 observações reais (EUR/USD, NZD/USD, EUR/NZD), últimos 113 sinais por estratégia, WR = W/(W+L).

## Ranking completo (T+60s)

| # | Estratégia | Família | N | Wins | Loss | Draws | **WR** | WR T+45 |
|---|---|---|---|---|---|---|---|---|
| 1 | **reversion-v1-fib** | Reversão + Fibonacci | 35 | 22 | 8 | 5 | **73,3%** | 62,1% |
| 2 | **reversion-v3-fib** | Reversão + Fibonacci | 60 | 40 | 20 | 0 | **66,7%** | 59,0% |
| 3 | **reversion-v2-fib** | Reversão + Fibonacci | 83 | 51 | 27 | 5 | **65,4%** | 57,0% |
| 4 | reversion-v1-vwap* | Reversão + VWAP | 113 | 32 | 17 | 64 | 65,3%* | 61,4% |
| 5 | **stochrsi-v1** | Oscilador (StochRSI) | 113 | 68 | 41 | 4 | **62,4%** | 58,7% |
| 6 | pinbar-rejection | Price action | 20 | 12 | 8 | 0 | 60,0% | 52,4% |
| 7 | cci-extreme-200 | Oscilador (CCI) | 113 | 64 | 45 | 4 | 58,7% | 53,8% |
| 8 | snapback-v1 | Reversão RSI curto | 113 | 64 | 48 | 1 | 57,1% | 51,4% |
| 9 | rsi2-connors | Reversão (Connors) | 113 | 64 | 49 | 0 | 56,6% | 56,8% |
| 10 | bollinger-rsi-v1* | Bollinger + RSI | 113 | 26 | 20 | 67 | 56,5%* | 65,1% |
| 11 | macd-rsi-v1 | MACD + RSI | 113 | 62 | 48 | 3 | 56,4% | 59,6% |
| 12 | keltner-reversal | Keltner | 113 | 63 | 50 | 0 | 55,8% | 53,1% |
| 13 | dual-rsi-v1 | RSI duplo | 113 | 63 | 50 | 0 | 55,8% | 49,5% |
| 14 | triple-ema-9-21-50 | Médias móveis | 113 | 62 | 51 | 0 | 54,9% | 56,6% |
| 15 | vwap-trend | VWAP | 113 | 62 | 51 | 0 | 54,9% | 56,6% |
| 16 | reversion-v3 | Reversão RSI + tendência | 113 | 55 | 46 | 12 | 54,5% | 56,4% |
| 17 | reversion-v1 | Reversão RSI simples | 113 | 61 | 52 | 0 | 54,0% | 57,5% |
| 18 | fib-golden-bounce | Fibonacci puro | 50 | 27 | 23 | 0 | 54,0% | 64,0% |
| 19 | stoch-trend-40-60 | Stochastic + EMA | 113 | 59 | 52 | 2 | 53,2% | 56,8% |
| 20 | donchian-break-20 | Rompimento | 113 | 58 | 54 | 1 | 51,8% | 48,2% |
| 21 | turtle-soup | Raschke (fade) | 113 | 57 | 56 | 0 | 50,4% | 58,4% |
| 22 | williams-94 | Williams %R | 113 | 56 | 57 | 0 | 49,6% | 53,6% |
| 23 | soldiers-crows | Padrões 3 candles | 41 | 20 | 21 | 0 | 48,8% | 51,2% |
| 24 | trend-v1 | Tendência EMA | 113 | 55 | 58 | 0 | 48,7% | 50,0% |
| 25 | inside-bar-breakout | Rompimento | 113 | 54 | 58 | 1 | 48,2% | 48,2% |
| 26 | morning-evening-star | Padrões 3 candles | 113 | 54 | 58 | 1 | 48,2% | 42,2% |
| 27 | reversion-v2 | Reversão RSI | 113 | 54 | 59 | 0 | 47,8% | 50,4% |
| 28 | round-number-bounce | Nível psicológico | 113 | 54 | 59 | 0 | 47,8% | 50,9% |
| 29 | cci-trend-reclaim | CCI + tendência | 113 | 53 | 59 | 1 | 47,3% | 48,2% |
| 30 | bb-lower-bounce | Bollinger bounce | 112 | 51 | 59 | 2 | 46,4% | 49,1% |
| 31 | reversion-band-v5 | Banda RSI profunda | 113 | 51 | 62 | 0 | 45,1% | 45,1% |
| 32 | reversion-band-v6 (T+45) | Banda RSI profunda | 113 | 51 | 62 | 0 | 45,1% | 45,1% |
| 33 | bb-squeeze-breakout | Volatilidade | 63 | 28 | 35 | 0 | 44,4% | 45,9% |
| 34 | pivot-bounce | Pivot points | 9 | 4 | 5 | 0 | 44,4% | 44,4% |
| 35 | williams-50-cross | Williams %R | 113 | 50 | 63 | 0 | 44,2% | 44,6% |
| 36 | rsi-divergence | Divergência RSI | 113 | 50 | 63 | 0 | 44,2% | 44,2% |
| 37 | engulfing-reversal | Price action | 25 | 11 | 14 | 0 | 44,0% | 48,1% |
| 38 | kijun-bounce | Ichimoku | 113 | 48 | 65 | 0 | 42,5% | 44,6% |
| 39 | macd-hist-zero | MACD | 61 | 24 | 33 | 4 | 42,1% | 41,0% |
| 40 | ema-cross-9-21 | Médias móveis | 113 | 46 | 65 | 2 | 41,4% | 39,4% |
| 41 | psar-flip | Parabolic SAR | 113 | 46 | 66 | 1 | 41,1% | 46,4% |
| 42 | momentum-v1 | Momento | 113 | 46 | 67 | 0 | 40,7% | 43,8% |
| 43 | heikin-ashi-trend | Heikin-Ashi | 113 | 46 | 67 | 0 | 40,7% | 44,2% |
| 44 | aroon-14 | Aroon | 113 | 45 | 68 | 0 | 39,8% | 48,2% |
| 45 | adx-di-14 | ADX/DI | 113 | 43 | 70 | 0 | 38,1% | 39,8% |
| 46 | supertrend-flip | Supertrend | 113 | 40 | 69 | 4 | 36,7% | 43,0% |
| 47 | reversion-v4 | Reversão RSI | 69 | 24 | 43 | 2 | 35,8% | 40,0% |
| 48 | ema-cross-5-13 | Médias móveis | 113 | 40 | 72 | 1 | 35,7% | 37,6% |
| 49 | swing-rejection | Estrutura | 94 | 30 | 64 | 0 | 31,9% | 28,4% |
| 50 | keltner-breakout | Keltner | 113 | 33 | 80 | 0 | 29,2% | 31,0% |

\* Estratégias com muitos empates (Draws) — o WR considera só W/(W+L); leia com cautela (amostra efetiva menor).

## Conclusões do compilado

1. **Top-3 é 100% Fibonacci sobre reversão** — `v1+fib` (73,3%), `v3+fib` (66,7%), `v2+fib` (65,4%). Confirma o relatório anterior: Fibonacci é o melhor filtro de confluência para reversão.
2. **Melhor técnica "pura" da pesquisa: StochRSI (62,4%, n=113)** — o pilar dos osciladores de curtíssimo prazo.
3. **Reversão domina; momentum afunda**: todas as estratégias de tendência/rompimento/indicadores clássicos de momentum ficaram entre 29% e 55% (o fundo do ranking: keltner-breakout 29%, swing-rejection 32%, ema-cross 36%, supertrend 37%, ADX 38%).
4. **Padrões de candle** (pinbar, engulfing, morning star, soldiers) ficaram todos no meio/baixo — funcionam melhor como confluência do que isolados.
5. **Ferramentas estruturais** (pivot, kijun, redondos, swing) isoladas são fracas; como filtro de reversão (relatórios anteriores), agregam.

## Governança e ressalvas
- Avaliação 100% causal e retrospectiva; amostras de 9–113 sinais por estratégia.
- Risco de seleção múltipla: 50 estratégias testadas — os tops precisam de validação forward (N≥100).
- Nenhuma promoção automática; broker side effects 0.

## Arquivos
- `exports/research-top50/top50-summary.json` — números completos.
- `scripts/top50.js` — motor com as 50 estratégias (reprodutível).
