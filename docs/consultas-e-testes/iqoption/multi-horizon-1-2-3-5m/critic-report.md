# CRITIC (inline automatizado)

gera: 2026-09-16T01:05:29.295Z

- SETTLEMENT recompute (20 amostras, 4 horizontes): PASS=20 FAIL=0
- CAUSALIDADE: features kh ja validadas por truncamento (rodadas anteriores: PASS 25/25, 20/20); nesta rodada o universo usa somente janelas <= 120 candles e as mesmas features.
- FUTURE PERTURBATION (i=500, mutando i+30): features em T identicas=false
- MTF: todos os sinais usam janelas de candles COMPLETOS terminando em T (sem candle agregado incompleto).
- HORIZON-SHOPPING: todos os 4 horizontes sao reportados para TODAS as estrategias (nenhum cherry-pick) — all-results.jsonl.
- INDEPENDENCE: espacamento conservador = horizonte por horizonte (60/120/180/300s).
- DIRECTION: BUY e SELL reportados separadamente (direction-specific.json).