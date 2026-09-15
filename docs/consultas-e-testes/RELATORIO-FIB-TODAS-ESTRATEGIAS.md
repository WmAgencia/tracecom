# Relatório — Fibonacci aplicado em TODAS as estratégias (rodadas 1, 2 e motor)

Data: 2026-09-15 · Método: mesmo motor causal offline (8.327 observações reais). Para cada estratégia: versão base vs versão com **filtro Fibonacci** (preço na zona dourada 38,2–61,8% do swing de 24 candles + contexto de direção: BUY só em swing de alta, SELL só em swing de baixa). Últimos 100 sinais por variante.

## Resultado (T+60s; Δ = ganho do filtro Fibonacci)

| Estratégia | Base (n · WR) | +Fibonacci (n · WR) | Δ | Confiável? |
|---|---|---|---|---|
| reversion-v2 | 100 · 48,0% | **83 · 65,4%** | **+17,4** | ✅ n alto |
| reversion-v1 | 100 · 58,0% | **35 · 73,3%** | **+15,3** | ⚠️ n médio |
| williams-v1 | 100 · 46,0% | 45 · 59,5% | +13,5 | ⚠️ n médio |
| reversion-v3 | 100 · 54,4% | **60 · 66,7%** | **+12,3** | ✅ |
| snapback-v1 | 100 · 59,6% | **100 · 67,7%** | **+8,1** | ✅ n=100 |
| momentum-v1 | 100 · 42,0% | 100 · 49,5% | +7,5 | ✅ (mas ainda fraco) |
| macd-rsi-v1 | 100 · 52,6% | 19 · 57,9% | +5,3 | ⚠️ n baixo |
| dual-rsi-v1 | 100 · 55,0% | 100 · 58,6% | +3,6 | ✅ |
| reversion-v5 | 100 · 40,0% | 5 · 80,0% | +40 | ❌ n=5 (ruído) |
| bollinger-rsi-v1 | 100 · 56,5% | 1 · 100% | +43,5 | ❌ n=1 (ruído) |
| turtle-soup-v1 | 100 · 51,0% | 3 · 100% | +49 | ❌ n=3 (ruído) |
| trend-v1 | 100 · 55,0% | 100 · 48,0% | −7,0 | ❌ piora |
| cci-trend-v1 | 100 · 46,5% | 26 · 44,0% | −2,5 | ❌ piora |
| rsi-div-v1 | 100 · 47,0% | 37 · 45,9% | −1,1 | ❌ piora |
| stoch-trend-v1 | 100 · 51,0% | 34 · 45,5% | −5,5 | ❌ piora |
| ema-cross-v1 | 100 · 45,8% | 23 · 31,8% | −14,0 | ❌ muito pior |
| stochrsi-v1 | 100 · 64,0% | 26 · 42,3% | **−21,7** | ❌ fib DESTRÓI o StochRSI |
| pullback-v1 | 30 · 60,7% | 8 · 37,5% | −23,2 | ❌ piora |
| pinbar-v1 | 20 · 60,0% | 1 · 0% | −60 | ❌ n=1 |
| engulfing-v1 | 25 · 44,0% | 1 · 0% | −44 | ❌ n=1 |
| bb-squeeze-v1 | 63 · 44,4% | 0 | — | sem sinais com fib |

T+45s segue o mesmo padrão (v1 +3,1 · v2 +6,0 · v3 +3,6 · snapback +7,4 · dual-rsi +8,1 · stochrsi −6,2).

## Conclusões

1. **Fibonacci é um filtro de REVERSÃO, não universal.** Ele melhora significativamente a família de reversão RSI (v1, v2, v3, snapback) e o Williams %R — e **piora** tudo que é momentum/breakout (trend, ema-cross, pullback, stoch-trend) e destrói o StochRSI.
2. **Combos com evidência sólida (n≥50)**:
   - `snapback-v1 + fib`: **67,7% em 100 trades (T+60)** — melhor resultado com amostra cheia de todo o projeto.
   - `reversion-v3 + fib`: **66,7% (n=60)**.
   - `reversion-v2 + fib`: **65,4% (n=83)** — e o maior ganho sobre a base (+17,4 p.p.).
3. **Recomendação de portfólio de pesquisa**: `snapback-v1+fib`, `reversion-v2+fib`, `reversion-v3+fib` (todos T+60). Se validarem forward, são os primeiros candidatos com piso estatístico próximo de 55%.
4. **Regra geral descoberta**: a confluência Fibonacci só agrega quando o sinal já é contra-tendência de curtíssimo prazo (reversão); para sinais de continuação ela remove os melhores trades.

## Arquivos

- `exports/research-fib-all/fib-all-summary.json` — números completos base vs fib (T+45 e T+60).
- `scripts/research-fib-all.js` — motor de avaliação.
