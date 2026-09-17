---
title: Indicador ADX14
topic: average directional index de Wilder
category: INDICATOR
sourceIds: [SRC-BOOK-WILDER-001, SRC-CMT-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.95
status: SOURCE_KNOWLEDGE
tracecomApplicability: DIRECT
regimes: [TREND_UP, TREND_DOWN, RANGE, COMPRESSION, TRANSITION]
setups: [TREND_PULLBACK, MOMENTUM_CONTINUATION, BREAKOUT_CONTINUATION]
indicators: [ADX14, DI_SPREAD]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [adx, tendencia, forca, wilder]
---

# Indicador ADX14

## Definicao
- Average Directional Index (Wilder, 1978): medida da forca da tendencia, sem direcao.
- Derivado de +DI e -DI, que representam movimento direcional positivo e negativo suavizados.

## Formula (resumo)
- Movimento direcional (DM) por candle; +DM e -DM conforme maxima/minima em relacao ao candle anterior.
- TR (true range) usado para normalizar: +DI = 100 * media(+DM) / media(TR); -DI analogo.
- DX = 100 * |+DI - -DI| / (+DI + -DI); ADX = media suavizada de DX em 14 periodos.

## Leitura Classica
- Valores baixos sugerem mercado lateral; valores altos sugerem tendencia forte.
- ADX em elevacao indica fortalecimento do movimento; em queda, enfraquecimento.
- ADX nao indica lado: combinacao com DI spread e necessaria para direcao.

## Uso no TraceCom
- Implementado deterministicamente no motor sobre candles fechados.
- Serve a classificacao de regime e ao filtro de setups de continuacao.

## Cuidados
- ADX e atrasado por construcao; responde apos o movimento.
- Limiares numericos variam por ativo e janela; evitar valores universais.

## Limitacoes
- Nao distingue tendencia saudavel de exaustao por si so.
- Em M1, alterna com frequencia e exige leitura combinada.
- Nao ha integracao de volume ou fluxo nesta base.
