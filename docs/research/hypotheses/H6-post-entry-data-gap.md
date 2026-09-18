# H6 — Sem persistência de candles/ticks T0 e pós-entrada, autópsias são inconclusivas

- **status:** FACT (lacuna de dados; requer instrumentação — não é mudança de decisão)
- **origem:** `docs/research/5-trade-forensic-audit.md` §5.5/§5.6 e Task 10
- **evidência observada:** `EVENT_BUFFER=2000` (eventos só em memória); `CANDIDATE_UPDATED` no audit trail só grava quando muda a cardinalidade dos campos alterados; `market_observations`/`price_observations` terminam em 2026-09-16; o snapshot T0 usado pelo gate (`candidate.initialFull`) chega `null` no journal (`initialSnapshot`). Consequência: T+5/10/…/60 s **UNKNOWN** para as 5 operações, e o score de produção não é reproduzível byte a byte.
- **mecanismo proposto:** persistir (a) o snapshot T0 do candidato completo, (b) o snapshot final na revalidação, (c) candles 5 s por trade na janela [entrada−90 s, expiry+15 s] em tabela dedicada (ex.: `iq_trade_candles`), (d) contradições completas do Critic por avaliação.
- **trades afetados:** todos.
- **counterexample:** as informações de settlement (causal/broker) e as 5 reconstruções T0 do journal já bastaram para provar os mappings desta auditoria — a lacuna limita a autópsia causal, não a liquidação.
- **como testar:** implementar a persistência (read-only para decisão, sem alterar Brain/Gate), rodar 30+ trades PRACTICE e refazer a autópsia de excursão MFE/MAE.
- **risco de overfit:** N/A (instrumentação); risco de custo de storage/ruído, mitigado por retenção.
- **dados adicionais:** candles históricos do provedor (IQ) e timestamp oficial de abertura do broker.
