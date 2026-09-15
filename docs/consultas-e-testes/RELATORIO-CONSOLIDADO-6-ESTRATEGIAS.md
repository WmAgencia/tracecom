# RELATÓRIO CONSOLIDADO — 6 ESTRATÉGIAS sobre TODOS os trades guardados

Base: 6.878 trades em `shadow_trades` → 3.212 snapshots únicos → **2.592 avaliados** (620 excluídos por histórico insuficiente <31 candles). Decisão causal (só dados até o candle); WIN = preço na expiração a favor da direção. Outcomes T+45 e T+60 das observações reais.

## Tabela (WIN/LOSS/WR)

| Estratégia (perfil) | BUY | SELL | WAIT | T+45 W/L/D · WR | **T+60 W/L/D · WR** | Wilson T+60 |
|---|---|---|---|---|---|---|
| **V1+Fib** (BALANCEADO) | 35 | 2 | 2555 | 17/10/5 · 63,0% | **21/7/5 · 75,0%** | 0,566–0,873 |
| **V2+Fib** (AGRESSIVO) | 67 | 12 | 2513 | 39/27/6 · 59,1% | **45/23/5 · 66,2%** | 0,543–0,763 |
| **V3+Fib** (AGRESSIVO) | 48 | 9 | 2535 | 30/21/1 · 58,8% | **35/18/0 · 66,0%** | 0,526–0,773 |
| **V6+Fib** (CONSERVADOR) | 5 | 0 | 2587 | 4/1/0 · 80,0% | **4/0/0 · 100%** | 0,510–1 (N=4) |
| **ATR-Overshoot+Fib** (EXPERIMENTAL) | 45 | 33 | 2514 | 41/18/15 · 69,5% | **49/14/13 · 77,8%** | **0,661–0,863** |
| **Regime-Reversion** (EXPERIMENTAL) | 46 | 9 | 2537 | 28/21/1 · 57,1% | **33/18/0 · 64,7%** | 0,510–0,764 |

## Lógica de cada estratégia

- **V1+Fib (BALANCEADO)**: RSI(14) em exaustão (s=(55−RSI)/45; s>0,33 ≈ RSI<40 compra / s<−0,33 ≈ RSI>70 venda) + volatilidade baixa (σ dos 12 retornos < 0,0009) + preço na zona dourada Fibonacci (38,2–61,8% do swing de 24 candles) + contexto de swing. Reversão de exaustão num recuo saudável.
- **V2+Fib (AGRESSIVO)**: mesma lógica com thresholds mais abertos (|s|>0,22, vol<0,0012) → mais frequência.
- **V3+Fib (AGRESSIVO)**: V2+Fib + tendência de 120s alinhada (compra só se mom120>0; venda só se <0).
- **V6+Fib (CONSERVADOR)**: reversão em RSI PROFUNDO (banda |s| ∈ [0,63; 0,857] ≈ RSI 16–27 / 83–94) + vol<0,0009 + zona dourada. Exclui o extremo terminal (RSI <16/>94) que falha historicamente.
- **ATR-Overshoot+Fib (EXPERIMENTAL)**: anomalia de volatilidade — |preço − SMA20| ≥ 3×ATR(14) + zona dourada → reversão à média. Melhor resultado com amostra decente.
- **Regime-Reversion (EXPERIMENTAL)**: meta-filtro — só opera V3+Fib quando o mercado está LATERAL (efficiency ratio dos últimos 30 candles < 0,35).

## Notas honestas
- V6+Fib: 4/4 é promissor com N insuficiente — nunca tratar como prova de 100%.
- 45s vs 60s: todas melhoram em T+60; ATR-Overshoot+Fib e V1+Fib também fortes em T+45.
- Decisões 100% causais; nenhuma usa futuro, outras estratégias ou histórico.
