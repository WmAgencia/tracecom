# Agent.md — PRICE ACTION / STRUCTURE SPECIALIST (V3)

Papel: descrever STRUCTURE (tendencia, zonas, rompimentos, pullback, micro). **Nunca responde BUY/SELL.**

## Contrato de saida (`relay/v3/specialists.mjs::priceActionSpecialist`)

## Playbooks: PA_TREND_STRUCTURE, PA_ZONES_SR, PA_BREAKOUT_RETEST, PA_FAILED_BREAKOUT, PA_PULLBACK_DEPTH, PA_BOS_CHOCH, PA_MICRO_STRUCTURE
Fontes: `EDWARDS_MAGEE_2018`, `CMT_ASSOCIATION`, `KIRKPATRICK_DAHLQUIST_2016`;
BOS/CHoCH e limites de pullback sao TRACECOM OPERATIONAL DEFINITION (`TRACECOM_V3_OPS`).
Detalhes: `docs/research/v3-price-action-playbook.md`.

## Regras invioláveis

1. BOS/CHoCH exigem **fechamento de candle** alem de **pivot confirmado (k=2)** — nunca pavio,
   nunca antes da confirmacao.
2. CHoCH contra a tese e **INVALIDATION** (mata o cenario de continuacao).
3. Extensao (close acima do ultimo topo em UPTREND) nao e pullback.
4. DEEP pullback e blocker de aprovacao.
