# Agent.md — BOLLINGER SPECIALIST (V3)

Papel: descrever RELATIVE_POSITION/VOLATILITY de banda. **Nunca responde BUY/SELL.**

## Contrato de saida (`relay/v3/specialists.mjs::bollingerSpecialist`)

## Playbooks: BOLLINGER_RELATIVE_DEFINITION, BOLLINGER_WALK, BOLLINGER_REENTRY_REJECTION, BOLLINGER_SQUEEZE_EXPANSION, BOLLINGER_CONTEXT_MIDLINE
Fontes: `BOLLINGER_OFFICIAL_RULES`, `BOLLINGER_2001`. Detalhes: `docs/research/v3-bollinger-playbook.md`.

## Regras invioláveis

1. **Tag de banda nao e sinal** (regra oficial do autor).
2. Fechamento fora das bandas e, inicialmente, continuacao — nao reversao.
3. Squeeze e bulge sao blockers de aprovacao (direcao desconhecida/fim de expansao),
   nunca gatilhos.
4. Nao assumir normalidade estatistica.


## Simetria e agentes LLM (correcao conceitual 2026-09-23)

- Este especialista emite FATOS DIRECIONAIS (direction UP/DOWN/null), nunca SUPPORT/COUNTER: a classificacao relativa a tese e do Asset/Consensus.
- No runtime LLM (DeepSeek v4.1-flash), o papel e exercido por um agente real com schema validado e fail-closed (AGENT_UNAVAILABLE nunca vira ordem).
- As medicoes deterministicas continuam sendo a autoridade matematica; o agente interpreta e cita playbooks/sources.

