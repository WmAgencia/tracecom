# H2 — Deslocamento adverso candidato→entrada acima de 0.35 ATR piora o resultado

- **status:** HYPOTHESIS (não testada; nenhuma mudança de produção autorizada)
- **origem:** `docs/research/5-trade-forensic-audit.md` (Task 3/9/11)
- **evidência observada:** o único WIN teve deslocamento **favorável** (−0.207 ATR). Entre os LOSS mensuráveis, GBPNZD teve o pior deslocamento adverso (+0.455 ATR) e o maior movimento contra (−4.92 ATR); EURAUD +0.254 ATR (perdeu por 1.14 ATR); CADCHF não registrou mudança de preço. O check `entry_displacement` (>0.35) já existe na rubrica e falhou para GBPNZD no snapshot do ACK. Nível OBSERVACIONAL.
- **mecanismo proposto:** comprar depois que o preço já andou na direção da tese (chase) reduz o retorno esperado de um binário porque o ponto de referência (entrada) já incorpora parte do movimento.
- **trades afetados:** #5 GBPNZD (principal), #4 EURAUD (secundário).
- **counterexample:** #4 com +0.254 ATR perdeu por pouco (poderia ser ruído); o próprio gate já rejeitou candidatos com `ENTRY_DISPLACEMENT_CHASED` (score 63) e `ENTRY_DISPLACEMENT_ADVERSE` (67), mostrando que o filtro já atua — os 4 executados passaram no T0.
- **como testar:** agrupar candidatos settled por `entryDisplacementATR` (buckets NEGATIVE/SMALL/MODERATE/LARGE) usando `priceChaseStudy` já existente no módulo de pesquisa, com N≥300; validar temporalmente.
- **risco de overfit:** MÉDIO — mecanismo plausível e filtro já existente; o risco é escolher o limiar olhando os 4 LOSS.
- **dados adicionais:** settlements de candidatos rejeitados e o preço de entrada real do broker (hoje usa-se o último close no submit).
