# RELATÓRIO — 6 Novas Técnicas (com/sem Fibonacci) + Âncoras Reversão

Amostra: os mesmos 2.592 snapshots históricos (eventos dos 6.878 trades guardados). 620 snapshots excluídos por histórico insuficiente. Outcome = preço na expiração registrado (proxy T+60). WR = W/(W+L); Wilson 95%.

## Tabela consolidada

| Variante | BUY | SELL | WAIT | W | L | D | U | Dir.N | WR | Wilson 95% |
|---|---|---|---|---|---|---|---|---|---|---|
| V1 | 833 | 463 | 1296 | 515 | 554 | 119 | 108 | 1069 | 48,2% | 0,452–0,512 |
| **V1+fib** | 35 | 2 | 2555 | 22 | 7 | 5 | 3 | 29 | **75,9%** | 0,579–0,878 |
| V2 | 1106 | 618 | 868 | 697 | 768 | 128 | 131 | 1465 | 47,6% | 0,450–0,501 |
| **V2+fib** | 67 | 12 | 2513 | 44 | 25 | 5 | 5 | 69 | **63,8%** | 0,520–0,741 |
| V3 | 168 | 70 | 2354 | 99 | 112 | 15 | 12 | 211 | 46,9% | 0,403–0,536 |
| **V3+fib** | 48 | 9 | 2535 | 35 | 19 | 0 | 3 | 54 | **64,8%** | 0,515–0,762 |
| V6 | 190 | 42 | 2360 | 111 | 105 | 1 | 15 | 216 | 51,4% | 0,448–0,580 |
| V6+fib | 5 | 0 | 2587 | 5 | 0 | 0 | 0 | 5 | 100%* | 0,566–1 |
| **Bollinger %B + RSI** | 14 | 20 | 2558 | 16 | 18 | 0 | 0 | 34 | 47,1% | 0,315–0,633 |
| Bollinger %B+RSI + fib | 0 | 0 | 2592 | — | — | — | — | 0 | sem sinais | — |
| **Bollinger Z-Score** | 145 | 135 | 2312 | 135 | 117 | 7 | 21 | 252 | **53,6%** | 0,474–0,596 |
| Bollinger Z + fib | 2 | 0 | 2590 | 2 | 0 | 0 | 0 | 2 | 100%* | 0,342–1 |
| **RSI(2) Connors + tendência** | 137 | 316 | 2139 | 139 | 191 | 89 | 34 | 330 | 42,1% | 0,369–0,475 |
| RSI(2) Connors + fib | 14 | 30 | 2548 | 19 | 23 | 0 | 2 | 42 | 45,2% | 0,312–0,601 |
| **Turtle Soup / Failed Breakout** | 41 | 27 | 2524 | 31 | 35 | 0 | 2 | 66 | 47,0% | 0,354–0,588 |
| Turtle Soup + fib | 3 | 0 | 2589 | 1 | 2 | 0 | 0 | 3 | 33,3% | 0,061–0,792 |
| **Liquidity Sweep / False Break** | 36 | 26 | 2530 | 29 | 31 | 0 | 2 | 60 | 48,3% | 0,362–0,607 |
| Liquidity Sweep + fib | 0 | 0 | 2592 | — | — | — | — | 0 | sem sinais | — |
| **EMA Pullback + Rejection** | 145 | 149 | 2298 | 149 | 123 | 3 | 19 | 272 | **54,8%** | 0,488–0,606 |
| EMA Pullback + fib | 15 | 21 | 2556 | 18 | 18 | 0 | 0 | 36 | 50,0% | 0,345–0,655 |

\* N≤5 = inconclusivo.

## Conclusões

1. **Nenhuma das 6 novas supera a família reversão+Fibonacci**: melhor pura = EMA-Pullback (54,8%, n=272) e Bollinger-Z (53,6%, n=252) — ambas com IC95 cruzando 50% (sem significância).
2. **Fibonacci NÃO combina com as novas estruturas**: RSI2 42→45 (marginal), Turtle 47→33, EMA 55→50, e %B/Sweep viram ZERO sinais com a zona dourada. O ganho Fibonacci é específico da família de reversão RSI extrema (V1/V2/V3/V6).
3. **Âncoras confirmadas de novo**: V3+fib 64,8% (IC inv 51,5%) e V2+fib 63,8% (IC inv 52,0%) — os dois melhores equilíbrios amostra+evidência do projeto; V1+fib 75,9% (n=29) mantém o maior teto.
4. **RSI(2) Connors decepcionou** (42,1%) — o filtro de tendência clássico não segurou nesta base; o RSI profundo da família V é superior.
5. Bollinger Z-Score é o achado novo mais digno de forward (53,6% com n=252 — único com amostra robusta), mas longe dos 65%+.

Arquivos: `redo-6novas.json` · `scripts/redo-6novas.cjs`.
