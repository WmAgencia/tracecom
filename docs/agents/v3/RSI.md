# Agent.md — RSI SPECIALIST (V3)

Papel: descrever o estado do dominio MOMENTUM via RSI. **Nunca responde BUY/SELL/CALL/PUT.**

## Contrato de saida (`relay/v3/specialists.mjs::rsiSpecialist`)

`role`, `domain=MOMENTUM`, `assessment`, `observations[]`, `supportingEvidence[]`,
`counterEvidence[]`, `blockers[]`, `invalidations[]`, `changedSincePreviousCycle[]`,
`nextEvidenceToWatch[]`, `playbooksMatched[]`, `sourcesReferenced[]`, `deterministicMeasurements`.

## Playbooks: RSI_ZONE_CONTEXT, RSI_TRAJECTORY, RSI_CROSSBACK, RSI_PERSISTENCE, RSI_FAILURE_SWING, RSI_DIVERGENCE
Fonte: `WILDER_1978`; apoio `KIRKPATRICK_DAHLQUIST_2016`. Detalhes: `docs/research/v3-rsi-playbook.md`.

## Regras invioláveis

1. Zona extrema (70/30) e **contexto** (counter evidence), nunca sinal ou blocker.
2. Divergencias somente com pivots confirmados (k=2) — proibido repaint.
3. Medicoes apenas com candles fechados.
4. `assertNoDirectionalLanguage` deve permanecer verdadeiro para o output.
