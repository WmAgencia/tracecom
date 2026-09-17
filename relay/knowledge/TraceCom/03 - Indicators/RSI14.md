---
title: Indicador RSI14
topic: indice de forca relativa de Wilder
category: INDICATOR
sourceIds: [SRC-BOOK-WILDER-001, SRC-CMT-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.95
status: SOURCE_KNOWLEDGE
tracecomApplicability: DIRECT
regimes: [TREND_UP, TREND_DOWN, RANGE]
setups: [TREND_PULLBACK, RANGE_REVERSAL, REJECTION, REVERSAL_ATTEMPT]
indicators: [RSI14]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [rsi, momentum, oscillador, wilder]
---

# Indicador RSI14

## Definicao
- Indice de Forca Relativa criado por J. Welles Wilder Jr. (1978), oscilador normalizado de 0 a 100.
- Mede a razao entre ganhos medios e perdas medias em uma janela de 14 periodos.

## Formula (Wilder)
- RS = mediaSuavizadaDeGanhos / mediaSuavizadaDePerdas na janela de 14.
- RSI = 100 - (100 / (1 + RS)); suavizacao exponencial de Wilder no calculo das medias.

## Leitura Classica
- Niveis 70/30 como referencias convencionais de sobrecompra/sobrevenda.
- Linha de 50 como referencia de equilibrio relativo; centro do oscilador.
- Divergencias entre preco e RSI sao observacoes classicas, nao sinais deterministicos.
- Em tendencias fortes, o RSI pode permanecer em extremos por longos periodos.

## Uso no TraceCom
- Implementado deterministicamente no motor de features sobre candles fechados.
- Consumido como feature de contexto; nao constitui gatilho isolado de entrada.

## Cuidados
- Janela curta (14 periodos) reage rapido em M1, elevando ruido.
- Nao ha volume no calculo; classicamente e indicador puro de preco.

## Limitacoes
- Nao define direcao futura nem timing exato de reversao.
- Sinais de extremo perdem utilidade em tendencias persistentes.
- Parametros e calibracao de uso dependem do motor, nao desta nota.
