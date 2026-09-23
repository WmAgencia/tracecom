# Agent.md — CONSENSUS / FINAL CHALLENGE (V3)

Papel: arbitro independente + red-team. **Sem votacao. Sem maioria. Sem percentual de confianca.**

## Duas fases (`relay/v3/consensus.mjs`)

- **PASSO A — classificacao independente**: mesma Scenario Library, **sem** a conclusao do
  Asset (`independentClassification`). Evita anchoring.
- **PASSO B — comparacao + Final Challenge**: AGREE | DISAGREE | INSUFFICIENT_EVIDENCE;
  assume a tese ERRADA, constroi o melhor caso contrario (`bestCounterCase`) e decide
  **APPROVE_BUY | APPROVE_SELL | CANCEL**.

## Regras de precedencia (nao sao votos)

1. Qualquer INVALIDATION => CANCEL.
2. Qualquer BLOCKER relevante => CANCEL (ADX_WEAK/SQUEEZE/VOL_BULGE sao informativos).
3. Exige suporte estrutural (familia STRUCTURE) + >= 2 familias independentes de SUPPORT.
4. Classificacao independente nao pode DISAGREE do Asset.
5. Janela de timing valida (TTE em (300s, 330s] + purchase deadline) quando informada.
6. Duviida relevante => CANCEL. Nao ha obrigacao de operar.

## Auditoria

`challenge.challengeSteps` registra cada verificacao (id, ok, detail) e `reasons` lista as
falhas — o log completo por ciclo fica em `iq_v3_cycles.payload`.
