# RELATORIO DE AUDITORIA — PROFESSIONAL BRAIN G2

> Versao do auditor: g2-audit-v1 · gerado em 2026-09-17T05:22:04.175Z · base: producao (Postgres Railway)
> **AINDA NAO HA EVIDENCIA SUFICIENTE PARA ATRIBUIR CAUSA DOMINANTE (N=15 < 30).**

## 1. Resumo executivo

- Periodo: 2026-09-17T05:07:00.149Z a 2026-09-17T05:16:00.565Z
- Trades G2 auditados: **15** · W/L/D: **6/9/0** · WR observado: **40.0%**
- PnL PRACTICE realizado: **161.60** · stake medio: 52.00 · payout medio: 84.93
- Amostra: INSUFICIENTE (minimo 30 para conclusao) — recortes de 20/50/100 nao existem · Legacy V1/V2/V3/V8 excluido
- Qualidade x resultado: UNCLEAR_DECISION_QUALITY+LOSS=9, UNCLEAR_DECISION_QUALITY+WIN=6
- Conclusao principal: os losses observados sao compativeis com variacao estatistica; NAO ha causa dominante comprovada. A atribuicao de causa t0 esta bloqueada nesta amostra historica (sem snapshot T0_DECISION_SNAPSHOT) — ver 1.1.

### 1.1 Integridade dos dados (limitacao da amostra historica)

- Trades com snapshot T0_DECISION_SNAPSHOT: **0** de 15 (cobertura 0.0%)
- Trades com fallback de settlement (regime/setup/trigger podem refletir avaliacao POSTERIOR ao t0): 15
- Consequencia: causas baseadas em regime/timing/RSI/ADX por trade ficam marcadas como INSUFFICIENT_CONTEXT; a analise de OUTCOME (W/L, preco, latencia, payout, mercado, hora, counterfactual) permanece valida.
- Bugs de observabilidade encontrados e corrigidos nesta fase (nao alteram trading): meta de execucao era sobrescrita no settlement; snapshot t0 nao era persistido; processLog nao entrava no journal. A coleta a partir de agora e t0-completa.

## 2. Os losses foram normais ou existem problemas?

- LOSS estatisticos (t0 sem fator observavel): 0
- LOSS com contexto t0 insuficiente (amostra historica): 9
- LOSS com fator de decisao observavel (timing/regime/trigger t0): 0
- LOSS com problema de execucao (stale/latencia): 0
- LOSS com problema de dado (quality): 0
- LOSS nao classificados: 0

## 3. Top causas dos losses

| causa | losses | % dos losses | mercados | setups | exemplos |
|---|---:|---:|---|---|---|
| INSUFFICIENT_CONTEXT | 9 | 100.0% | EURUSD:OTC, GBPUSD:OTC, GBPJPY:OTC, EURGBP:OTC | TREND_PULLBACK, NO_VALID_SETUP, REJECTION | exec_1789621551099_gukgca, exec_1789621579100_kk2gjz, exec_1789621573076_0o8hqz |

> Causas sao fatores observaveis no t0; varios podem coexistir no mesmo trade. Nenhuma e atribuida como dominante sem amostra.

## 4. Performance por mercado

| chave | N | W | L | D | WR | PnL | PnL/trade | payout medio | amostra |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| EURUSD:OTC | 7 | 4 | 3 | 0 | 57.1% | 310.00 | 44.29 | 85.00 | INSUFFICIENT_SAMPLE |
| GBPUSD:OTC | 2 | 0 | 2 | 0 | 0.0% | -110.00 | -55.00 | 86.00 | INSUFFICIENT_SAMPLE |
| GBPJPY:OTC | 3 | 1 | 2 | 0 | 33.3% | -101.40 | -33.80 | 86.00 | INSUFFICIENT_SAMPLE |
| EURGBP:OTC | 3 | 1 | 2 | 0 | 33.3% | 63.00 | 21.00 | 83.00 | INSUFFICIENT_SAMPLE |

## 5. Performance por setup

| chave | N | W | L | D | WR | PnL | PnL/trade | payout medio | amostra |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| TREND_PULLBACK | 3 | 1 | 2 | 0 | 33.3% | -11.40 | -3.80 | 84.67 | INSUFFICIENT_SAMPLE |
| NO_VALID_SETUP | 9 | 3 | 6 | 0 | 33.3% | 105.00 | 11.67 | 85.11 | INSUFFICIENT_SAMPLE |
| MOMENTUM_CONTINUATION | 2 | 2 | 0 | 0 | 100.0% | 168.00 | 84.00 | 84.00 | INSUFFICIENT_SAMPLE |
| REJECTION | 1 | 0 | 1 | 0 | 0.0% | -100.00 | -100.00 | 86.00 | INSUFFICIENT_SAMPLE |

## 6. Performance por regime

| chave | N | W | L | D | WR | PnL | PnL/trade | payout medio | amostra |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| TREND_DOWN | 3 | 2 | 1 | 0 | 66.7% | 81.60 | 27.20 | 84.67 | INSUFFICIENT_SAMPLE |
| RANGE | 1 | 0 | 1 | 0 | 0.0% | -10.00 | -10.00 | 86.00 | INSUFFICIENT_SAMPLE |
| UNCLEAR | 3 | 2 | 1 | 0 | 66.7% | 160.00 | 53.33 | 85.33 | INSUFFICIENT_SAMPLE |
| TRANSITION | 6 | 1 | 5 | 0 | 16.7% | -145.00 | -24.17 | 85.00 | INSUFFICIENT_SAMPLE |
| TREND_UP | 2 | 1 | 1 | 0 | 50.0% | 75.00 | 37.50 | 84.00 | INSUFFICIENT_SAMPLE |

## 7. Performance por horario local

| chave | N | W | L | D | WR | PnL | PnL/trade | payout medio | amostra |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 2 | 15 | 6 | 9 | 0 | 40.0% | 161.60 | 10.77 | 84.93 | OK |

## 8. BUY vs SELL

| chave | N | W | L | D | WR | PnL | PnL/trade | payout medio | amostra |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| BUY | 5 | 3 | 2 | 0 | 60.0% | 235.00 | 47.00 | 84.60 | INSUFFICIENT_SAMPLE |
| SELL | 10 | 3 | 7 | 0 | 30.0% | -73.40 | -7.34 | 85.10 | OK |

## 9. Indicadores — distribuicao WIN vs LOSS

> Cobertura t0: 0/15 trades com snapshot de decisao. Sem snapshot, indicadores ficam indisponiveis (nao inventados).

| indicador | WIN (media/mediana/N) | LOSS (media/mediana/N) |
|---|---|---|
| rsi | — / — / 0 | — / — / 0 |
| adx | — / — / 0 | — / — / 0 |
| atrRatio | — / — / 0 | — / — / 0 |
| confidence | — / — / 0 | — / — / 0 |
| payout | 84.83 / 85.00 / 6 | 85.00 / 85.00 / 9 |
| entryHour | 2.00 / 2.00 / 6 | 2.00 / 2.00 / 9 |

## 10. Trader vs Critic

- Verdicts: CONFIRM=3, VETO=3, CONTEST=9
- Concordancia Trader/Critic: —
- Critic confirmou LOSS: 3 · CONFIRM sem contraevidencia: 3
> Limite: verdict t0 so existe com snapshot de decisao; em trades historicos o verdicto persistido e o do settlement (nao usar como prova).

## 11. Consensus

- Execucoes fora de CONFIRMED (coluna de settlement): exec_1789621579100_kk2gjz, exec_1789621573076_0o8hqz, exec_1789621621039_724eba, exec_1789621617310_wmb4lx, exec_1789621664084_6gjuiq, exec_1789621715615_1gd0r7, exec_1789621749055_corkys, exec_1789621837117_gr7oyr, exec_1789621896310_5gg3w0, exec_1789621991315_wu5i83, exec_1789622041413_ol6ccv, exec_1789622062806_8pb7ab, exec_1789622028812_43h5xo, exec_1789622117034_hphl7z
- Nota: por construcao do runtime, TODA ordem automatica exige consensus CONFIRMED no t0 (handleSignal so recebe BUY/SELL do consensus); divergencias persistidas sao do snapshot de settlement.

## 12. Latencia / execucao

- decisao→entrada (t0): media —ms · mediana —ms · N=0
- sinal→ordem (t0): media —ms · ACK (requested→acked, sempre valido): media 173.87ms · mediana 168.00ms · max 218.00ms
- Decisoes stale (>15s): 0
- Mudancas de stake na janela (confound de PnL): 10→100
- Settlements exatamente no preco de entrada: 0
- Contrafactual (COUNTERFACTUAL_ONLY, apenas analitico): de 9 LOSS, inverter teria vencido 8 e perdido 1; WAIT teria evitado o loss em todos (PnL 0).

## 13. Segundo Cerebro / RAG

- retrievalHitRate: 80.0% · relevanceRate: 80.0%
- versoes de conhecimento: kb_de55f9c39857
- notas usadas: TraceCom/00 - Core Brain/Principles, TraceCom/01 - Regimes/TREND_DOWN, TraceCom/02 - Setups/TREND_PULLBACK, TraceCom/13 - Books/BOOK_REGISTRY, TraceCom/00 - Core Brain/Process, TraceCom/01 - Regimes/RANGE, TraceCom/02 - Setups/FAILED_BREAKOUT, TraceCom/02 - Setups/RANGE_REVERSAL, TraceCom/03 - Indicators/ADX14, TraceCom/01 - Regimes/TRANSITION, TraceCom/04 - Risk/POSITION_SIZING, TraceCom/01 - Regimes/TREND_UP

## 14. Professor

- GOOD_DECISION+LOSS (efetivo): 0 · BAD_DECISION+WIN (efetivo): 0
- Ratings brutos invalidados pelo drift de settlement: 15 de 15 (professor avaliou snapshot posterior ao t0; corrigido nesta fase).
- licoes genericas: 15 · hindsight flags: 0
- criticas mais recorrentes: nenhuma

## 15. Sequencias de losses

- streak 1 (5): EURUSD:OTC/TREND_PULLBACK/TREND_DOWN → GBPUSD:OTC/NO_VALID_SETUP/RANGE → GBPJPY:OTC/NO_VALID_SETUP/UNCLEAR → EURUSD:OTC/NO_VALID_SETUP/TRANSITION → EURGBP:OTC/TREND_PULLBACK/TREND_UP
- streak 2 (2): EURGBP:OTC/NO_VALID_SETUP/TRANSITION → EURUSD:OTC/NO_VALID_SETUP/TRANSITION

## 16. Casos completos

### LOSS mais instrutivos

- **exec_1789621551099_gukgca** EURUSD:OTC BUY @ 1.160365 → 1.160225 (LOSS) · regime TREND_DOWN · setup TREND_PULLBACK · trigger pullback_com_estrutura_mantida
  - t0: RSI — · ADX — · ATRratio — · local — · timing UNKNOWN · causas INSUFFICIENT_CONTEXT
  - Critic: CONFIRM (independente SELL) · Consensus CONFIRMED · qualidade (efetiva) UNCLEAR_DECISION_QUALITY (raw do settlement: GOOD_DECISION, invalido)
  - counterfactual (COUNTERFACTUAL_ONLY): WAIT WAIT · INVERT SELL WIN
- **exec_1789621579100_kk2gjz** GBPUSD:OTC SELL @ 1.335495 → 1.335635 (LOSS) · regime RANGE · setup NO_VALID_SETUP · trigger —
  - t0: RSI — · ADX — · ATRratio — · local — · timing UNKNOWN · causas INSUFFICIENT_CONTEXT
  - Critic: CONFIRM (independente WAIT) · Consensus NO_CONSENSUS · qualidade (efetiva) UNCLEAR_DECISION_QUALITY (raw do settlement: GOOD_DECISION, invalido)
  - counterfactual (COUNTERFACTUAL_ONLY): WAIT WAIT · INVERT BUY WIN
- **exec_1789621573076_0o8hqz** GBPJPY:OTC SELL @ 208.378575 → 208.383595 (LOSS) · regime UNCLEAR · setup NO_VALID_SETUP · trigger —
  - t0: RSI — · ADX — · ATRratio — · local — · timing UNKNOWN · causas INSUFFICIENT_CONTEXT
  - Critic: VETO (independente WAIT) · Consensus VETOED · qualidade (efetiva) UNCLEAR_DECISION_QUALITY (raw do settlement: GOOD_DECISION, invalido)
  - counterfactual (COUNTERFACTUAL_ONLY): WAIT WAIT · INVERT BUY WIN
- **exec_1789621621039_724eba** EURUSD:OTC SELL @ 1.160255 → 1.160225 (LOSS) · regime TRANSITION · setup NO_VALID_SETUP · trigger —
  - t0: RSI — · ADX — · ATRratio — · local — · timing UNKNOWN · causas INSUFFICIENT_CONTEXT
  - Critic: CONTEST (independente WAIT) · Consensus NO_CONSENSUS · qualidade (efetiva) UNCLEAR_DECISION_QUALITY (raw do settlement: GOOD_DECISION, invalido)
  - counterfactual (COUNTERFACTUAL_ONLY): WAIT WAIT · INVERT BUY LOSS
- **exec_1789621617310_wmb4lx** EURGBP:OTC SELL @ 0.848565 → 0.848815 (LOSS) · regime TREND_UP · setup TREND_PULLBACK · trigger pullback_com_estrutura_mantida
  - t0: RSI — · ADX — · ATRratio — · local — · timing UNKNOWN · causas INSUFFICIENT_CONTEXT
  - Critic: CONTEST (independente WAIT) · Consensus NO_CONSENSUS · qualidade (efetiva) UNCLEAR_DECISION_QUALITY (raw do settlement: GOOD_DECISION, invalido)
  - counterfactual (COUNTERFACTUAL_ONLY): WAIT WAIT · INVERT BUY WIN

### WIN mais instrutivos

- **exec_1789621664084_6gjuiq** GBPJPY:OTC SELL @ 208.350685 → 208.267465 (WIN) · regime TREND_DOWN · setup TREND_PULLBACK · trigger pullback_com_estrutura_mantida
  - t0: RSI — · ADX — · ATRratio — · local — · timing UNKNOWN · causas INSUFFICIENT_CONTEXT
  - Critic: CONTEST (independente WAIT) · Consensus NO_CONSENSUS · qualidade (efetiva) UNCLEAR_DECISION_QUALITY (raw do settlement: GOOD_DECISION, invalido)
  - counterfactual (COUNTERFACTUAL_ONLY): WAIT WAIT · INVERT BUY LOSS
- **exec_1789621837117_gr7oyr** EURUSD:OTC BUY @ 1.159835 → 1.160955 (WIN) · regime TREND_UP · setup MOMENTUM_CONTINUATION · trigger aceleracao_a_favor
  - t0: RSI — · ADX — · ATRratio — · local — · timing UNKNOWN · causas INSUFFICIENT_CONTEXT
  - Critic: CONTEST (independente WAIT) · Consensus NO_CONSENSUS · qualidade (efetiva) UNCLEAR_DECISION_QUALITY (raw do settlement: GOOD_DECISION, invalido)
  - counterfactual (COUNTERFACTUAL_ONLY): WAIT WAIT · INVERT SELL LOSS
- **exec_1789621991315_wu5i83** EURUSD:OTC BUY @ 1.160885 → 1.160955 (WIN) · regime UNCLEAR · setup NO_VALID_SETUP · trigger —
  - t0: RSI — · ADX — · ATRratio — · local — · timing UNKNOWN · causas INSUFFICIENT_CONTEXT
  - Critic: VETO (independente WAIT) · Consensus VETOED · qualidade (efetiva) UNCLEAR_DECISION_QUALITY (raw do settlement: GOOD_DECISION, invalido)
  - counterfactual (COUNTERFACTUAL_ONLY): WAIT WAIT · INVERT SELL LOSS
- **exec_1789622041413_ol6ccv** EURGBP:OTC SELL @ 0.848285 → 0.847945 (WIN) · regime TREND_DOWN · setup MOMENTUM_CONTINUATION · trigger aceleracao_a_favor
  - t0: RSI — · ADX — · ATRratio — · local — · timing UNKNOWN · causas INSUFFICIENT_CONTEXT
  - Critic: CONTEST (independente WAIT) · Consensus NO_CONSENSUS · qualidade (efetiva) UNCLEAR_DECISION_QUALITY (raw do settlement: GOOD_DECISION, invalido)
  - counterfactual (COUNTERFACTUAL_ONLY): WAIT WAIT · INVERT BUY LOSS
- **exec_1789622062806_8pb7ab** EURUSD:OTC SELL @ 1.161015 → 1.160615 (WIN) · regime TRANSITION · setup NO_VALID_SETUP · trigger —
  - t0: RSI — · ADX — · ATRratio — · local — · timing UNKNOWN · causas INSUFFICIENT_CONTEXT
  - Critic: CONTEST (independente WAIT) · Consensus NO_CONSENSUS · qualidade (efetiva) UNCLEAR_DECISION_QUALITY (raw do settlement: GOOD_DECISION, invalido)
  - counterfactual (COUNTERFACTUAL_ONLY): WAIT WAIT · INVERT BUY LOSS

## 17. Problemas comprovados

- Observabilidade (CORRIGIDO): 15 de 15 trades sem snapshot t0 persistido; regime/setup/trigger do journal refletem o settlement, nao a decisao.
- Observabilidade (CORRIGIDO): meta de iq_executions era substituida no settlement (setup/timing do pedido se perdiam); agora e mesclada.
- Observabilidade (CORRIGIDO): processLog (RSI/ADX/ATR/estrutura por estagio) nao era persistido no journal; agora faz parte do decisionSnapshot.
- Execucao com NO_VALID_SETUP persistido: 9 trade(s) — atribuivel ao fallback de settlement (acima), nao a uma violacao de gate.

## 18. Suspeitas (sem amostra suficiente)

- Dominancia de LATE_ENTRY/OVEREXTENSION: nao observado — tratar como SUSPEITA ate N>=30.
- Baixa diversidade adversarial (Critic quase sempre CONFIRM): aguardando amostra prospectiva.

## 19. Recomendacoes

- DO NOTHING / NEED MORE DATA: nao alterar Brain/Critic/Consensus com base nesta amostra (regra 28).
- RESEARCH REQUIRED: coletar N>=30 prospectivo com o decisionSnapshot completo (ja instrumentado) e reexecutar esta auditoria.
- BUG FIX (observabilidade, sem tocar trading): persistir snapshot t0 completo no journal (feito) e AGENTS acionavel no audit (feito).

## 20. Proximo experimento recomendado

- Rodar esta auditoria automaticamente a cada 20 trades G2 e comparar WIN vs LOSS em dados novos (mesma instrumentacao, sem mudar regras).

## GATE DE CRITICA (fresh critics)

- **Estamos confundindo resultado com qualidade?** Qualidade e resultado sao registrados em campos distintos; sem rating suficiente para afirmar.
- **Estamos fazendo cherry-picking de exemplos?** O relatorio usa TODOS os 15 trades G2; exemplos sao os primeiros de cada causa, nao selecionados por conveniencia.
- **A amostra e pequena?** SIM: N=15 < 30. Nenhuma conclusao causal dominante deve ser aceita.
- **Algum padrao desaparece quando separado por mercado?** nenhum subgrupo de markets atinge N>=10; impossivel separar de ruido.
- **Algum padrao e causado por horario?** 1 subgrupo(s) com N>=10; padroes devem persistir neles para nao serem ruido.
- **Algum padrao e apenas consequencia do payout?** buckets presentes: 85-89(N=12,WR=0.4167), 80-84(N=3,WR=0.3333); comparar WR e PnL separadamente.
- **Usamos informacao futura?** Nao: todos os campos sao do snapshot t0; counterfactual e rotulado COUNTERFACTUAL_ONLY e nao alimenta nenhuma decisao.
- **Explicamos LOSS olhando apenas depois do resultado?** As causas usam apenas regime/setup/trigger/RSI/ADX/ATR/latencia do t0; o resultado aparece somente na secao de outcome.
- **Wins mostram o mesmo fenomeno?** Comparacao WIN vs LOSS incluida (RSI/ADX/ATR/confianca/payout/hora). Semamostra suficiente, diferencas sao descritivas.
- **Ha multiplas comparacoes?** SIM: 19 subgrupos analisados. Com N=15, multiplas comparacoes podem produzir padroes falsos; tratar tudo como SUSPEITA.

**Integridade do relatorio:** INSUFFICIENT_SAMPLE · N=15 · comparacoes=19

## Anexo — dataset completo

| trade | at | mkt | dir | stake | payout | entry | exit | result | pnl | regime | setup | rsi | adx | atrRatio | timing | quality | causes |
|---|---|---|---|---:|---:|---:|---:|---|---:|---|---|---:|---:|---:|---|---|---|
| exec_1789621551099_gukgca | 09-17 05:07 | EURUSD:OTC | BUY | 10.00 | 85 | 1.160365 | 1.160225 | LOSS | -10.00 | TREND_DOWN | TREND_PULLBACK | — | — | — | UNKNOWN | UNCLEAR_DECISION_QUALITY | INSUFFICIENT_CONTEXT |
| exec_1789621579100_kk2gjz | 09-17 05:07 | GBPUSD:OTC | SELL | 10.00 | 86 | 1.335495 | 1.335635 | LOSS | -10.00 | RANGE | NO_VALID_SETUP | — | — | — | UNKNOWN | UNCLEAR_DECISION_QUALITY | INSUFFICIENT_CONTEXT |
| exec_1789621573076_0o8hqz | 09-17 05:07 | GBPJPY:OTC | SELL | 10.00 | 86 | 208.378575 | 208.383595 | LOSS | -10.00 | UNCLEAR | NO_VALID_SETUP | — | — | — | UNKNOWN | UNCLEAR_DECISION_QUALITY | INSUFFICIENT_CONTEXT |
| exec_1789621621039_724eba | 09-17 05:08 | EURUSD:OTC | SELL | 10.00 | 85 | 1.160255 | 1.160225 | LOSS | -10.00 | TRANSITION | NO_VALID_SETUP | — | — | — | UNKNOWN | UNCLEAR_DECISION_QUALITY | INSUFFICIENT_CONTEXT |
| exec_1789621617310_wmb4lx | 09-17 05:08 | EURGBP:OTC | SELL | 10.00 | 83 | 0.848565 | 0.848815 | LOSS | -10.00 | TREND_UP | TREND_PULLBACK | — | — | — | UNKNOWN | UNCLEAR_DECISION_QUALITY | INSUFFICIENT_CONTEXT |
| exec_1789621664084_6gjuiq | 09-17 05:09 | GBPJPY:OTC | SELL | 10.00 | 86 | 208.350685 | 208.267465 | WIN | 8.60 | TREND_DOWN | TREND_PULLBACK | — | — | — | UNKNOWN | UNCLEAR_DECISION_QUALITY | INSUFFICIENT_CONTEXT |
| exec_1789621715615_1gd0r7 | 09-17 05:10 | EURGBP:OTC | BUY | 10.00 | 83 | 0.848805 | 0.848665 | LOSS | -10.00 | TRANSITION | NO_VALID_SETUP | — | — | — | UNKNOWN | UNCLEAR_DECISION_QUALITY | INSUFFICIENT_CONTEXT |
| exec_1789621749055_corkys | 09-17 05:10 | EURUSD:OTC | SELL | 10.00 | 85 | 1.159695 | 1.159845 | LOSS | -10.00 | TRANSITION | NO_VALID_SETUP | — | — | — | UNKNOWN | UNCLEAR_DECISION_QUALITY | INSUFFICIENT_CONTEXT |
| exec_1789621837117_gr7oyr | 09-17 05:12 | EURUSD:OTC | BUY | 100.00 | 85 | 1.159835 | 1.160955 | WIN | 85.00 | TREND_UP | MOMENTUM_CONTINUATION | — | — | — | UNKNOWN | UNCLEAR_DECISION_QUALITY | INSUFFICIENT_CONTEXT |
| exec_1789621896310_5gg3w0 | 09-17 05:13 | GBPJPY:OTC | SELL | 100.00 | 86 | 208.262035 | 208.283975 | LOSS | -100.00 | TRANSITION | REJECTION | — | — | — | UNKNOWN | UNCLEAR_DECISION_QUALITY | INSUFFICIENT_CONTEXT |
| exec_1789621991315_wu5i83 | 09-17 05:14 | EURUSD:OTC | BUY | 100.00 | 85 | 1.160885 | 1.160955 | WIN | 85.00 | UNCLEAR | NO_VALID_SETUP | — | — | — | UNKNOWN | UNCLEAR_DECISION_QUALITY | INSUFFICIENT_CONTEXT |
| exec_1789622041413_ol6ccv | 09-17 05:15 | EURGBP:OTC | SELL | 100.00 | 83 | 0.848285 | 0.847945 | WIN | 83.00 | TREND_DOWN | MOMENTUM_CONTINUATION | — | — | — | UNKNOWN | UNCLEAR_DECISION_QUALITY | INSUFFICIENT_CONTEXT |
| exec_1789622062806_8pb7ab | 09-17 05:15 | EURUSD:OTC | SELL | 100.00 | 85 | 1.161015 | 1.160615 | WIN | 85.00 | TRANSITION | NO_VALID_SETUP | — | — | — | UNKNOWN | UNCLEAR_DECISION_QUALITY | INSUFFICIENT_CONTEXT |
| exec_1789622028812_43h5xo | 09-17 05:15 | GBPUSD:OTC | SELL | 100.00 | 86 | 1.337465 | 1.337695 | LOSS | -100.00 | TRANSITION | NO_VALID_SETUP | — | — | — | UNKNOWN | UNCLEAR_DECISION_QUALITY | INSUFFICIENT_CONTEXT |
| exec_1789622117034_hphl7z | 09-17 05:16 | EURUSD:OTC | BUY | 100.00 | 85 | 1.160735 | 1.161075 | WIN | 85.00 | UNCLEAR | NO_VALID_SETUP | — | — | — | UNKNOWN | UNCLEAR_DECISION_QUALITY | INSUFFICIENT_CONTEXT |


---

## Anexo B — Verificacao pos-correcao (2026-09-17)

- Deploy com instrumentacao t0 verificado em producao: o trade `exec_1789623360540_8jjnw4` (GBPUSD:OTC, LOSS) registrou `snapshotSource=T0_DECISION_SNAPSHOT`, `processLog` com 12 estagios, `setup=TREND_PULLBACK`, `trigger=pullback_com_estrutura_mantida`, `rsi=52.0` e rating real (`ACCEPTABLE_DECISION`).
- O meta de execucao agora preserva `setup`, `strategySource`, `stakeSource` e `stakeRequested` apos o settlement (antes era sobrescrito).
- Consequencia: a proxima auditoria (N>=30) tera contexto t0 completo; nenhuma conclusao desta amostra historica deve ser tratada como definitiva.
