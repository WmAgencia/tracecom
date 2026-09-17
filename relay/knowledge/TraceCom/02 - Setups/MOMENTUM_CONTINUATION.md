---
title: Setup MOMENTUM_CONTINUATION
topic: continuacao de impulso
category: SETUP
sourceIds: [SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-WILDER-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.78
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TREND_UP, TREND_DOWN, EXPANSION]
setups: [MOMENTUM_CONTINUATION]
indicators: [ADX14, DI_SPREAD, ATR14, RSI14, DONCHIAN]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [momentum, impulso, continuacao, forca]
---

# Setup MOMENTUM_CONTINUATION

## Definicao
- Entrada na continuacao de um impulso forte ja em andamento, com alinhamento de forca.
- Depende de confirmacao multipla: tendencia, DI spread amplo e ADX14 elevado.

## Condicoes de Contexto
- Sequencia de candles de corpo relevante na mesma direcao.
- ADX14 acima da zona de lateralidade e em elevacao.
- DI spread amplo, sem cruzamento recente contra a direcao.

## Gatilho
- Fechamento de candle que renova extremo recente sem correcao profunda entre impulsos.
- Correcoes intermediarias curtas, respeitando a faixa de valor da tendencia.
- RSI14 forte, sem divergencia evidente com o preco.

## Invalidacao
- Perda do ultimo fundo/topo de impulso com fechamento.
- Estreitamento do DI spread e queda de ADX14: momentum perdendo forca.

## Gestao
- Evitar entrada apos extensao ja grande em relacao ao ATR14 (risco de exaustao).
- Consistencia de stake; sem dobrar tamanho em sequencia de vitorias.

## Limitacoes
- Momentum pode reverter abruptamente em EXPANSION sem direcao (CHAOTIC).
- Sem dados de volume, a leitura de forca e apenas de preco.
- Nao ha medicao de slippage real em opcoes binarias OTC.
