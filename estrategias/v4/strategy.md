# V4 — strategy.md

Fonte de verdade: `relay/rsi-v4.mjs` (decisão) e `relay/rsi-agents-v4.mjs` (execução/watch).

## 1. DETECT (RSI Wilder 14 — único detector)
- BUY candidate: RSI <= 30.
- SELL candidate: RSI >= 70.
- RSI sozinho NUNCA autoriza ordem.

## 2. WATCH (episódio mínimo — sem máquina de freshness)
- Episódio guarda: direction, candidateAt/Rsi/Price, extremos (min/max) e se houve toque na banda.
- Continuidade lógica: normalizou completamente (RSI cruzou 45/55 e preço cruzou a média) => **CANCEL**;
  novo extremo oposto => **NOVO episódio**; idade > 8 min => expira.
- Scheduler: ACTIVE_CANDIDATE (1 avaliação/candle 5s, dedupe por bucket) e PRIORITY_FINAL_WATCH
  (garante a última avaliação causal antes do cutoff) — herdados da V3.1 e preservados integralmente.

## 3. CONFIRM
**Bollinger 20/2 — localização + rejeição ATUAL**
- Esticou: toque/fora da banda (ou zona extrema da posição) no episódio.
- Rejeição/reentrada: preço de volta PARA DENTRO da banda e/ou rejeição no candle atual, e já saiu da zona extrema.
- Band riding contra a reversão => BLOCK. Strong continuation contra => BLOCK.

**DMI/ADX — força e troca de controle**
- ADX NÃO tem direção; ADX caindo é apenas enfraquecimento do movimento antigo (não confirma nada).
- Exige: pressão antiga enfraquecendo (slope do DI antigo < 0) E DI novo reagindo (slope > 0 ou dominância).
- DI cross é evidência forte, nunca obrigatória.
- ADX subindo com DI antigo ainda dominante => BLOCK (ADX_SUPPORTING_OLD_DIRECTION).
- Novo DI dominante + ADX estável/subindo => confirmação forte.

## 4. CUSHION (FRAGILE / NORMAL / STRONG)
- Métrica: deslocamento esperado no horizonte ÷ ruído (ATR×√candles) — sem probabilidade falsa.
- FRAGILE (< 0.25) => WAIT. NORMAL/STRONG liberam.

## 5. COUNTER-EVIDENCE (explícita, no instante da ordem)
- HARD (bloqueia): OLD_DI_STILL_DOMINANT, ADX_SUPPORTING_OLD_DIRECTION, BAND_RIDING,
  STRONG_OPPOSITE_CANDLE, MOMENTUM_AGAINST, PRICE_STRUCTURE_INVALIDATED, CUSHION_TOO_SMALL.
- SOFT (registra): RSI_REACCELERATING_AGAINST, OPPOSITE_DI_ACCELERATING, ADX_FALLING_CONTEXT_ONLY,
  VELOCITY_AGAINST, REJECTION_FAILED.

## 6. REVALIDATE + ENTER
- BINARY: reavaliação no último candle causal antes do safe cutoff (nunca depois; MISSED é fail-closed).
- BLITZ_45S: entra imediatamente quando a confirmação existir (não espera minuto cheio).
- `payload.entrySnapshot` é IMUTÁVEL: nenhum tick posterior altera o estado que autorizou a ordem.

## 7. Instrumentos e seleção
- Universo vem do registry MESAS (`iq_rsi_instruments`): ligar/desligar por instrumento, filtros e bulk.
- Desabilitado => sem novos candidates; candidate vivo é cancelado com MARKET_DISABLED_BY_USER (auditável).
