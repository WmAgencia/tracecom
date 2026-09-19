# V3.1 — strategy.md (resumo fiel ao código)

## Workflow
DETECT (RSI <=30/>=70) → CANDIDATE com continuidade → WATCH (episódio) → T-5 final (última avaliação
causal antes do cutoff) → REVALIDAÇÃO completa (memória do episódio + estado atual) → ENTER/CANCEL.

## Episódio (memória causal)
- Rejeição Bollinger persistida: bollingerRejectionAt/Price/Direction, ReentryConfirmed, Extreme.
- DI cross persistido: diCrossAt/Direction, newDirectionConfirmedAt.
- Validades ancoradas no horizonte de 60s (0,75× e 0,9×horizonte × volatilidade; clamps 20–90s / 25–120s).
- Evento ≠ estado: a memória prova como a oportunidade nasceu; o estado atual decide se ela ainda existe.

## Regras (herdadas de V3 + correções V3.1)
- Stage 1: ADX caindo = tendência antiga enfraquecendo (NÃO é confirmação da nova direção).
- Stage 2: exige reação do DI novo (slope > 0 ou dominância); DI cross forte mas não obrigatório.
- Bollinger: rejeição do MESMO episódio com validade; invalidação por preço/band riding/continuation.
- Cushion >= 0,25 (FRAGILE => WAIT).
- Nunca entra atrás do cutoff; MISSED é fail-closed.
- Watch: 1 avaliação por candle (dedupe por bucket); PRIORITY_FINAL_WATCH garante o candle final.

## Instrumentos
Somente BINARY (OTC/NORMAL) — BLITZ era produto não suportado nesta versão.

## Problemas conhecidos
- Complexidade de decisão alta (7 estados, muitos reason codes, validades interligadas).
- Comportamento de entrada dependia de janela curta (1,8s) + jitter; exigiu o scheduler watch.
- Payload original de opportunity podia ser sobrescrito pós-entrada (corrigido com entrySnapshot).
