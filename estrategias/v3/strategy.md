# V3 — strategy.md (fiel ao código)

## Workflow
DETECT (RSI <=30 BUY / >=70 SELL) → CANDIDATE (extremo + continuidade) → WATCH (rotação normal de 29 ativos)
→ REVALIDAÇÃO no T-5 (janela de 5s antes do cutoff de turb) → ENTER/CANCEL.

## Regras principais
- Episódio: touched/outside/reentry de Bollinger, DI antigo enfraquecendo, spread contraindo.
- STAGE 1 (ADX caindo, slope <= 0): apenas contexto — tendência antiga perdendo força.
- STAGE 2: DI novo reagindo (slope > 0 ou inversão de dominância); sem isso, WAIT.
- Bollinger: exige rejeição/reentrada ATUAL (`rejectionUpperNow/LowerNow`) — este critério causou o choke
  documentado na auditoria (0 passes em 45 candidates antes da V3.1).
- Cushion: projeção determinística ~60s (ATR/impulso/velocidade), FRAGILE (<0,25) => WAIT.
- Override: RSI <=15/>=85 com >=55s de lead (restritíssimo).

## Instrumentos
BINARY (NORMAL/OTC). Di cross opcional. Stake R$10. PRACTICE only.

## Status
Arquivada; desligada no runtime desde a V4. Histórico no banco (`iq_rsi_*_v3`).
