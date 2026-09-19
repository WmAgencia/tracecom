# V1 — RSI_REVERSAL_STRICT_V1 / RSI_EXTREME_PULLBACK_V1

Primeira geração (agentes 5x5, famílias STRICT e PULLBACK). Pausada; não executa.
Código: `relay/rsi-reversal.mjs`, `relay/rsi-variants.mjs`, `relay/rsi-agents-5x5.mjs`.

- STRICT: reversão com confirmação dupla (RSI fora do extremo + Bollinger + DMI coerentes).
- PULLBACK: entrada em pullback após extremo, com confirmação de banda.
- Limitações conhecidas: seleção por mercado, sem memória de episódio; cobertura assimétrica.
- Substituída pela V2 (50/50 NORMAL+OTC) e depois V3 (estratégia única).
- Números exatos: ver `relay/rsi-reversal.mjs` (RSI_REVERSAL_POLICY) e o freeze em
  `docs/research/data/rsi-agents-freeze.json`.
