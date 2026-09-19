# V4 — changelog

## v4 (esta versão)
- Decisão clean-room: DETECT → WATCH → CONFIRM → REVALIDATE → ENTER/CANCEL.
- Princípio: passado (episódio) apenas coloca sob observação; o snapshot CURRENT-STATE autoriza.
- `counterEvidenceAtEntry[]` com severidade SOFT/HARD (HARD = NO TRADE).
- Cushion simplificado em FRAGILE/NORMAL/STRONG (reusa métrica provada; sem probabilidade).
- Episódio mínimo: sem timers de validade ponderados, sem firstSight histórico mandando na decisão.
- Scheduler ACTIVE WATCH + PRIORITY_FINAL_WATCH preservado da V3.1 (provado: 0 gaps >7,5s em produção).
- Novos instrumentos: BINARY (64s→60s expiry sincronizado) e BLITZ_45S (entrada imediata; só executa
  com caminho de ordem verificado — BLITZ_ORDER_PATH_UNSUPPORTED caso contrário).
- MESAS: registry de instrumentos persistido, toggles/bulk/filtros, runtime respeita (cancel auditável).
- Export first-10 por instrumento com sanitização e secret scan (BLOCK_GITHUB_EXPORT_SECRET_DETECTED).
- Routing: RSI_V4_ONLY (`agent-v4:RSI_REVERSAL_V4`); V3/V2/V1/G2/manual/experimentos controlsExecution=false.
- Resultado auditado (12 trades V3, counterfactual causal): 12/12 SAME_ENTRY — V4 não bloqueia entradas
  que eram tecnicamente válidas no momento; ganho é impedir contradições atuais no futuro. Sem claim de edge.
