# RELATÓRIO — V7 (ATR+Fib ∩/∪ V1+Fib) e V8 (ATR+Fib cobertura máxima)

Base: os mesmos 6.878 trades guardados → 2.592 snapshots avaliados. Outcomes T+45/T+60 das observações reais. Decisões causais, congeladas.

## Resultados

| Estratégia | BUY | SELL | WAIT | Cobertura | T+45 W/L/D · WR | **T+60 W/L/D · WR** | Wilson T+60 |
|---|---|---|---|---|---|---|---|
| **V7-AND** (ATR+Fib **E** V1+Fib) | 19 | 0 | 2573 | 0,7% | 10/2/5 · 83,3% | **13/0/5 · 100%** | **0,772–1** (n=13) |
| **V7-OR** (ATR+Fib **OU** V1+Fib) | 61 | 35 | 2496 | **3,7%** | 48/26/15 · 64,9% | **57/21/13 · 73,1%** | **0,623–0,817** (n=78) |
| **V8** (ATR+Fib relaxado: dev≥1×ATR) | 98 | 66 | 2428 | 6,3% | 71/59/17 · 54,6% | **89/49/13 · 64,5%** | 0,562–0,720 (n=138) |
| V8-all (TODOS os candles: contra-SMA20) | 1434 | 1054 | 104 | 96,0% | 1099/1084/106 · 50,3% | 1087/1100/80 · 49,7% | 0,476–0,518 |

## Leitura

1. **V7-OR é a melhor versão prática**: junção das duas famílias mais fortes dá **73,1% em T+60 com n=78** (Wilson inf 62,3%) — mais que o dobro da amostra de cada pai isolado, mantendo precisão alta (V1+Fib 75% n=28 · ATR+Fib 77,8% n=63).
2. **V7-AND é o núcleo ultra-seletivo**: quando as DUAS famílias concordam → **13W/0L/5D (100% dos decididos, 72% incluindo empates)** — raríssimo (13 eventos em 2.592), promissor com N insuficiente.
3. **V8 (mais cobertura)**: relaxar o ATR de 3× para 1× faz a cobertura subir de 3% → 6,3% e o WR cair de 77,8% → 64,5% (ainda com Wilson inf 56,2%). Trade-off claro: cobertura × precisão.
4. **V8-all (cobertura 96%)**: forçar entrada em todos os candles = 49,7% — **o edge mora nos filtros** (Fibonacci + desvio), não na previsão direcional bruta.

## Definições
- **V7** = combinação ATR+Fib × V1+Fib (testada nas duas álgebras: interseção e união). Recomendação: **V7-OR** (padrão), V7-AND como sinal de máxima convicção.
- **V8** = ATR+Fib com cobertura máxima (limiar de desvio relaxado para 1×ATR; variante extrema: todo candle).

Arquivos: `consolidado-v7v8.json` · `scripts/consolidado-v7v8.cjs`.
