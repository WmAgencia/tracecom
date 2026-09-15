# RELATÓRIO — 10 Técnicas Estruturais/Exaustão (puras vs +Fibonacci)

Base: mesmos 2.592 snapshots históricos (eventos dos 6.878 trades). Outcomes T+45/T+60 calculados das observações reais. WR = W/(W+L); Wilson 95% (T+60).

## Tabela completa

| Variante | BUY | SELL | WAIT | T+45 WR (n) | **T+60 WR (n)** | Wilson 95% T+60 |
|---|---|---|---|---|---|---|
| WR-Failure | 105 | 74 | 2413 | 48,5% (165) | 49,4% (162) | 0,418–0,570 |
| CCI-Divergence | 153 | 110 | 2329 | 52,7% (239) | **53,1% (241)** | 0,468–0,593 |
| Keltner-Reentry | 140 | 113 | 2339 | 48,3% (234) | 46,2% (225) | 0,398–0,527 |
| Round-Reject | 12 | 13 | 2567 | 50,0% (24) | 37,5% (24) | 0,212–0,573 |
| Swing-Failure | 34 | 24 | 2534 | 55,4% (56) | 50,0% (54) | 0,371–0,629 |
| Double-Exhaustion | 88 | 51 | 2453 | 39,2% (130) | 39,5% (129) | 0,315–0,482 ❌ |
| Velocity-Decel | 63 | 36 | 2493 | 52,3% (88) | 49,4% (87) | 0,392–0,597 |
| Accel-Exhaustion | 0 | 2 | 2590 | 100% (1) | 100% (1) | n=1 (quase não dispara) |
| ATR-Overshoot | 1017 | 714 | 861 | 49,8% (1428) | 49,1% (1428) | 0,465–0,517 |
| **Regime-Reversion** | 46 | 9 | 2537 | 57,1% (49) | **64,7% (51)** | **0,510–0,764** |
| WR-Failure+fib | 9 | 9 | 2574 | 61,1% (18) | **72,2% (18)** | 0,491–0,875 |
| CCI-Divergence+fib | 3 | 0 | 2589 | 33,3% (3) | 66,7% (3) | n=3 |
| Keltner-Reentry+fib | 14 | 14 | 2564 | 46,2% (26) | 52,0% (25) | 0,335–0,700 |
| Round-Reject+fib | 0 | 2 | 2590 | 0% (2) | 0% (2) | n=2 |
| Swing-Failure+fib | 0 | 0 | 2592 | — | — | sem sinais |
| Double-Exhaustion+fib | 1 | 0 | 2591 | 100% (1) | 100% (1) | n=1 |
| Velocity-Decel+fib | 10 | 7 | 2575 | 78,6% (14) | **80,0% (15)** | 0,548–0,930 |
| Accel-Exhaustion+fib | 0 | 0 | 2592 | — | — | sem sinais |
| **ATR-Overshoot+fib** | 45 | 33 | 2514 | 69,5% (59) | **77,8% (63)** | **0,661–0,863** ⭐ |
| Regime-Reversion+fib | 46 | 9 | 2537 | 57,1% (49) | 64,7% (51) | 0,510–0,764 |

## Destaques

1. **ATR-Overshoot+fib = 77,8% (n=63 · Wilson inf 66,1%)** — o resultado mais forte do projeto com amostra decente: exceder o canal de 3×ATR da SMA20 E voltar para a zona dourada.
2. **Regime-Reversion = 64,7% (n=51 · Wilson inf 51,0%)**: o meta-filtro de regime (eficiência < 0,35 = mercado lateral) sobre o V3+fib funcionou — será pré-requisito de estudo para os próximos passos.
3. Velocity-Decel+fib 80% (n=15) e WR-Failure+fib 72,2% (n=18) — promissores, amostras pequenas.
4. Puras: só CCI-Divergence (53,1%) e Regime-Reversion (64,7%) passam de 50%; Double-Exhaustion falhou (39,5%).
5. **Fibonacci continuou seletivo por família**: eleva as reversões/exaustões estruturais (+28 p.p. no ATR-Overshoot) mas zera estruturas puras como Swing-Failure (0 sinais) e Rounded-Reject.
6. Accel-Exhaustion e Round-Reject quase não disparam nesta base (baixa cobertura por design do choque 3σ).

Arquivos: `redo-10novas.json` · `scripts/redo-10novas.cjs`.
