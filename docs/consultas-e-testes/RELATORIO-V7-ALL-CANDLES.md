# RELATÓRIO — V7 (ATR+Fib ∪ V1+Fib) EM TODO O ESPECTRO DE COBERTURA

Base: mesmos 6.878 trades → 2.592 snapshots. Outcomes T+45/T+60 das observações reais.

## Resultados

| Variante | Cobertura | T+45 W/L/D · WR | **T+60 W/L/D · WR** | Wilson T+60 |
|---|---|---|---|---|
| **V7-relaxado** (ATR+Fib dev≥1×ATR **OU** V1+Fib) | **6,4%** | 71/60/17 · 54,2% | **89/50/13 · 64,0%** | **0,558–0,715** (n=139) |
| V7-all-AGREE (todos; ATR e V1 concordam, conflito=WAIT) | 82,1% | 923/946/84 · 49,4% | 913/958/61 · 48,8% | 0,465–0,511 |
| V7-all-ATR (todos; contra-SMA20) | 96,0% | 1099/1084/106 · 50,3% | 1087/1100/80 · 49,7% | 0,476–0,518 |
| V7-all-V1 (todos; contra-RSI) | 100% | 1061/1128/190 · 48,5% | 1055/1139/162 · 48,1% | 0,460–0,502 |
| V7-all (todos; ATR com fib de contexto) | 100% | 1099/1090/190 · 50,2% | 1087/1107/162 · 49,5% | 0,475–0,516 |

## Conclusões

1. **A resposta do experimento: forçar o V7 em todos os candles destrói o edge.** Todas as variantes "sempre-entra" ficaram em 48–50% (moeda justa), inclusive a de concordância ATR∩V1 (82% de cobertura → 48,8%).
2. **O ponto ótimo de cobertura do V7 é o relaxado (6,4%)**: manter o filtro de desvio ≥1×ATR + Fibonacci e aceitar mais eventos dá **64,0% em T+60 (n=139, Wilson inf 55,8%)** — praticamente o topo de cobertura antes do edge desaparecer.
3. **Confirmado de novo: o edge mora nos filtros** (desvio estatístico + zona dourada + exaustão), não na previsão direcional bruta. Prever tudo = moeda justa; selecionar = 64–73%.

## Escala final do V7 (para uso)
- **V7-OR (filtros completos)**: 73,1% · n=78 · Wilson inf 62,3% — máxima precisão prática
- **V7-relaxado (dev≥1×ATR)**: 64,0% · n=139 · Wilson inf 55,8% — máxima cobertura com edge
- **V7-AND**: 100% · n=13 — núcleo de convicção (N insuficiente)
- Todos-candles: ~49% — NÃO usar sem filtros

Arquivos: `v7-all.json` · `scripts/v7-all.cjs`.
