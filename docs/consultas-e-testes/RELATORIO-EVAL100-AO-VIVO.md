# Avaliação AO VIVO — 4 estratégias no MESMO pool (EUR/NZD, 4.452 observações)

Método: para cada candle (5s) elegível, as 4 estratégias fazem a predição usando SOMENTE dados até o candle (causal). Em seguida confere-se o preço real na expiração T+45s e T+60s. Mesmo pool de entradas para todas; cada estratégia dispara conforme sua regra congelada (hash caf85c034eb58192).

## Resultados

| | A (v1+fib) | B (v3+fib) | C (v2+fib) | D (stochrsi) |
|---|---|---|---|---|
| Sinais totais | 32 | 41 | 69 | 164 |
| T+45s WR | 53,6% (n=31) | 61,5% (n=40) | 49,2% (n=63) | 49,5% (n=100) |
| T+60s WR | 55,6% (n=30) | **70,3% (n=37)** | 56,1% (n=60) | 49,5% (n=100) |
| IC95 T+60 | 37,3–72,4 | 54,2–82,5 | 43,3–68,2 | 39,9–59,2 |
| BUY T+60 | 60,0% (28) | **73,5% (34)** | 60,8% (54) | 37,9% (30) |
| SELL T+60 | 0% (2) | 33,3% (3) | 16,7% (6) | 54,3% (70) |

## Notas

- **B (v3+fib)** confirma na janela fresca o melhor resultado histórico (66,7%): 70,3% em 1min com IC95 inf 54,2%.
- **A** caiu vs histórico (73,3%→55,6%) — amostra pequena (n=30).
- **C** consistente (histórico 65,4% → fresco 56,1%).
- **D (stochrsi)** ficou abaixo do histórico nesta janela (49,5% vs 62,4% no histórico da rodada anterior); BUY fraco (37,9%), SELL positivo (54,3%).
- A assimetria de lados persiste: Fibonacci forte em BUY; stochrsi melhor em SELL.
- A/B/C ainda não têm 100 sinais no EUR/NZD (o executor forward congelado continua acumulando 24/7).
- Sem ajustes, sem reinício, LOSS não descartado — regra de integridade mantida. Tudo SHADOW.

Arquivos: `eval100.json` (detalhes por horizonte/lado) · `scripts/eval100.mjs` (reprodutível).
