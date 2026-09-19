# V3.1 — RSI_REVERSAL_PULLBACK_V3 (V1_1)

Substituída pela V4 (motivo: complexidade acumulada). Código congelado em `relay/rsi-v3.mjs` +
`relay/rsi-agents-v3.mjs` (desligada no runtime; rota `/api/iq/research/rsi-agents-v3` responde
`controlsExecution=false`).

## O que a V3.1 tinha
- Detector RSI extremo + candidato com continuidade e memória de episódio.
- Memória causal com validade ancorada no horizonte: rejeição Bollinger (base 45s × volatilidade,
  clamp 20–90s) e DI cross (base 54s, clamp 25–120s).
- firstSight V3.1 (V3_1_EPISODE_EVENT_STATE): evidência histórica do MESMO episódio + estado atual.
- Stage1 (ADX caindo = enfraquecimento) e Stage2 (DI novo reagindo), cushion >= 0.25.
- Janela final: última avaliação causal antes do safe cutoff (grid de candles 5s).
- ACTIVE_CANDIDATE_WATCH + PRIORITY_FINAL_WATCH (1 avaliação por candle, dedupe por bucket).
- `payload.entrySnapshot` imutável.

## Fatos operacionais (auditoria)
- Scheduler pós-correção: p50 4,9s / p99 6,4s / máx 6,8s; 0 gaps > 7,5s (antes: 139 > 7,5s, máx 11,3s).
- 4/19 candidates perdiam a janela final por skip de throttle antes da correção.
- 12 trades PRACTICE executados (5W/7L bruto); nenhuma LOSS por informação contraditória
  não processada — o scheduler perdia entradas (fail-closed), nunca gerava entradas ruins.
- Decisão central herdada pela V4: estado atual manda; memória só contextualiza.
