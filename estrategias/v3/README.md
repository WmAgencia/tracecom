# V3 — RSI_REVERSAL_PULLBACK_V3

Primeira versão "single strategy" em todo o universo. Arquivada sem alterações.
Código: `relay/rsi-v3.mjs`, `relay/rsi-agents-v3.mjs` (congelado; não executa).

## Ideia
- Candidate nasce no extremo de RSI; a entrada exige continuidade real até o T-5.
- ADX caindo = STAGE 1 (enfraquecimento da tendência antiga), NÃO confirmação da nova.
- STAGE 2: reação do DI novo (cross forte é evidência, não obrigação).
- Projeção ~60s com EXPECTED_EXPIRY_CUSHION (0,25 mínimo; FRAGILE => WAIT).
- Override de reversão extrema MUITO restritivo (RSI <=15/>=85 com lead de 55s).

## O que a auditoria revelou (levou à V3.1 e depois à V4)
1. `SEM_REJEICAO_ATUAL` exigia a rejeição no tick exato → 0 passes em 45 candidates num dia de auditoria.
2. DI cross válido era ignorado por slope <= 0 no tick.
3. Cadência real (~10,8s média histórica; throttle 5s) pulava a janela final de 1,8s.
4. LOSSes observadas não vinham de informação não processada; vinham de tese válida que virou depois.

Ver `estrategias/v3.1/` para as correções e `estrategias/v4/` para a simplificação final.
