# Laboratorio futuro — 6 estrategias independentes (PLANO, NAO IMPLEMENTAR)

> Status: planejamento. A validacao operacional do Consensus V1 (RSI Reversal) deve fechar antes.

## Como a arquitetura atual suporta o laboratorio sem duplicar infra
- `relay/consensus/snapshot.mjs` ja produz **UM MarketSnapshot imutavel/causal por avaliacao** (RSI/Bollinger/DMI/ADX/ATR + candles).
- Especialistas sao funcoes puras `(snapshot) -> analise estruturada` (sem I/O, sem estado global).
- O Decisor e uma sintese semantica por estrategia; o runner orquestra watch/revalidacao/safe cutoff/gate.
- Para N estrategias: **1 feed + 1 Feature Engine + N conjuntos de especialistas + N decisores**, cada um com seu proprio estado de oportunidade/watch e sua propria idempotencia.
- Nenhuma estrategia e obrigada a operar os mesmos trades: cada uma encontra SUAS oportunidades no MESMO snapshot.

## Estrategias (ordem de implementacao sugerida)
1. RSI Reversal (Consensus V1 atual — ja implementado)
2. MACD Momentum
3. EMA Pullback Trend
4. Bollinger Mean Reversion
5. Stochastic Reversal
6. RSI + Fibonacci Reversal

## Protocolo do experimento
- 20 settlements PRACTICE por estrategia x 6 estrategias = 120 strategy-trades.
- Ao atingir 20 settlements, a estrategia **congela** (nao abre novas).
- Quando todas atingirem 20: experimento encerra, dataset congela, relatorio comparativo.
- Relatorio por estrategia: WR, PnL, frequencia, latencia, WAITs por motivo, qualidade das entradas (entrySnapshot + counterEvidence), falsos sinais.
- REAL permanece intocada durante todo o laboratorio.

## Requisitos tecnicos ja satisfeitos / pendentes
- [x] Snapshot unico e causal (snapshotId + bucketEnd + closedCandles persistidos).
- [x] Funil instrumentado por etapa + WAITs agrupados por motivo.
- [x] Log humano + estruturado com coalescing.
- [x] Execucao serializada (1 ordem por vez) + teto de stake + guard de saldo.
- [ ] Registro por estrategia (tabela `iq_consensus_decisions` hoje nao tem coluna `strategy` — adicionar antes do laboratorio).
- [ ] Contador de settlements por estrategia com congelamento automatico.
- [ ] Relatorio comparativo multi-estrategia.
