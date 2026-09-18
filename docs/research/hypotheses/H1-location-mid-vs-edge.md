# H1 — Entrada em zona MID / localização sem folga discrimina perdas

- **status:** HYPOTHESIS (não testada; nenhuma mudança de produção autorizada)
- **origem:** `docs/research/5-trade-forensic-audit.md` (Task 4/5/11)
- **evidência observada:** 3 dos 4 LOSS autônomos tinham Donchian em MID no T0 do candidato (CADCHF 0.45, EURAUD 0.54, GBPNZD MID→UPPER_HALF na janela). O único WIN entrou em UPPER_HALF (0.7368) com 1.04 ATR de folga do topo e 2.90 ATR de espaço. O check `location_not_mid` da rubrica falhou para CADCHF e EURAUD no snapshot do ACK. N=5 (WIN N=1) → nível OBSERVACIONAL.
- **mecanismo proposto:** entrada no meio do canal não tem assimetria de payoff num binário de 60 s; a borda dá espaço para o pullback da tendência sem stop (não há stop), mas a probabilidade de fechamento a favor é ~50%. A hipótese é que localização na borda com folga aumente levemente a taxa de sucesso de TREND_PULLBACK.
- **trades afetados:** #3 CADCHF, #4 EURAUD, #5 GBPNZD.
- **counterexample:** #1 EURUSD (manual) tinha LOWER_HALF e perdeu; #2 WIN não prova nada (N=1); existem candidatos rejeitados com `OVEREXTENDED_FROM_CHANNEL` e score alto (81) cujo resultado é desconhecido.
- **como testar:** offline, braço B existente (`evaluateShadowArms.B_QUALITY_GATE` aceita MID) — comparar resultado de candidatos MID vs borda no dataset prospectivo dos `SHADOW_ARMS` (com settled). Depois `temporalSplit` com gap e holdout.
- **risco de overfit:** ALTO — 3 observações, limiar de zona 0.15 já existente; qualquer corte novo em cima de N=5 é overfit.
- **dados adicionais:** settlement dos candidatos que hoje só têm `SHADOW_ARMS` (não executados) e candles T0 persistidos (D4/D5).
