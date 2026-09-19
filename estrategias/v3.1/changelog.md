# V3.1 — changelog

- V3.1 (V1_1): memória causal de episódio (rejeição e DI cross com validade ancorada no horizonte).
- firstSight V3.1: evidência histórica do mesmo episódio + checagens de estado atual (substitui
  `SEM_REJEICAO_ATUAL`, que exigia a rejeição no candle exato).
- Janela final: passa a executar na última avaliação causal antes do safe cutoff (grid de candles),
  nunca depois; MISSED permanece fail-closed.
- Observabilidade: events sem `created_at`, COALESCE de revalidation/submit, snapshot de universo atômico.
- Scheduler: throttle 4,5s → ACTIVE_CANDIDATE_WATCH/PRIORITY (1 avaliação por candle, dedupe por bucket).
  Medido em produção: p50 4,9s, máx 6,8s, 0 gaps > 7,5s (antes 139).
- entrySnapshot imutável: ticks posteriores não sobrescrevem a evidência da ordem.
- Substituída pela V4 (simplificação): nenhuma alteração retroativa feita aqui.
