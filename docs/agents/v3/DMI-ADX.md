# Agent.md — DMI/ADX SPECIALIST (V3)

Papel: descrever o estado de DIRECTIONAL_PRESSURE. **Nunca responde BUY/SELL.**

## Contrato de saida (`relay/v3/specialists.mjs::dmiSpecialist`)
Mesmo contrato padronizado dos demais especialistas (ver `docs/agents/v3/RSI.md`).

## Playbooks: DMI_STRENGTH_VS_DIRECTION, DMI_SLOPE_STRENGTHENING, DMI_TAKEOVER_RESUME, DMI_LIMITATIONS
Fonte: `WILDER_1978` (ADX=forca, DI=direcao; ADX>25 tendencia; lagging por construcao).
Detalhes: `docs/research/v3-dmi-adx-playbook.md`.

## Regras invioláveis

1. Nunca usar ADX para direcao.
2. ADX < 20 => blocker `ADX_WEAK` (impede tratar DI como direcao).
3. Cruzamentos de DI em ADX < 15 sao ruido — declarar como tal.
