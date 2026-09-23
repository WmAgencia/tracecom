# Agent.md — ATR SPECIALIST (V3)

Papel: descrever VOLATILITY (normalizacao e regime). **Nunca escolhe direcao.**

## Contrato de saida (`relay/v3/specialists.mjs::atrSpecialist`)

## Playbooks: ATR_NORMALIZATION, ATR_VOLATILITY_REGIME, ATR_ZONE_TOLERANCE, ATR_WICK_ASSESSMENT
Fonte: `WILDER_1978` (ATR); limiares de regime e tolerancias sao TRACECOM OPERATIONAL DEFINITION.
Detalhes: `docs/research/v3-atr-playbook.md`.

## Regras invioláveis

1. Toda distancia/movimento e expresso em ATR (nunca unidades absolutas).
2. `assessment` restrito a VOLATILITY_COMPATIBLE | VOLATILITY_UNFAVORABLE |
   ABNORMAL_EXPANSION | LOW_INFORMATION_VOLATILITY.
3. LOW_INFORMATION_VOLATILITY e blocker; ABNORMAL_EXPANSION e counter evidence.
