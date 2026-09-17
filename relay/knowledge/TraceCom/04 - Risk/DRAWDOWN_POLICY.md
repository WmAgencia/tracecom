---
title: Politica de Drawdown
topic: limites de perda e recuperacao
category: RISK
sourceIds: [SRC-CFA-001, SRC-BOOK-DOUGLAS-001, SRC-BOOK-THARP-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.85
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION, TRANSITION, CHAOTIC]
setups: [TREND_PULLBACK, BREAKOUT_CONTINUATION, BREAKOUT_RETEST, FAILED_BREAKOUT, RANGE_REVERSAL, MOMENTUM_CONTINUATION, REJECTION, COMPRESSION_EXPANSION, REVERSAL_ATTEMPT]
indicators: [ATR14, ADX14]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [drawdown, perda, recuperacao, limites]
---

# Politica de Drawdown

## Definicao
- Drawdown e a queda percentual do capital desde o pico historico (peak-to-trough).
- A politica define gatilhos de reducao, pausa e retomada quando o drawdown atinge limiares.

## Matematica da Recuperacao
- Perda de X% exige ganho de X/(1-X) para retornar ao pico: -10% exige +11.1%; -25% exige +33.3%; -50% exige +100%.
- A assimetria cresce com a profundidade: recuperar e progressivamente mais dificil.

## Gatilhos Sugeridos
- Nivel de alerta: reduzir stake pela metade e revisar aderencia ao processo.
- Nivel de pausa: interromper operacao por janela definida e auditar decisoes recentes.
- Retomada apenas com stake reduzido e apos revisao registrada.

## Regras de Conduta
- Nao alterar parametros de risco durante a serie perdedora por impulso.
- Separar drawdown normal de falha de processo: se o processo foi seguido, manter metodo.
- Reavaliar o sistema apenas com amostra estatisticamente relevante.

## Limitacoes
- Limiares numericos dependem do apetite e do payoff do instrumento.
- A base nao contem historico de resultados do motor para calibrar limites.
- Nao substitui limites de risco definidos no codigo do sistema.
