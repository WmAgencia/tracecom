---
title: Indicador ATR14
topic: average true range de Wilder
category: INDICATOR
sourceIds: [SRC-BOOK-WILDER-001, SRC-CMT-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.95
status: SOURCE_KNOWLEDGE
tracecomApplicability: DIRECT
regimes: [COMPRESSION, EXPANSION, TREND_UP, TREND_DOWN, CHAOTIC]
setups: [COMPRESSION_EXPANSION, BREAKOUT_CONTINUATION, TREND_PULLBACK]
indicators: [ATR14]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [atr, volatilidade, true-range, wilder]
---

# Indicador ATR14

## Definicao
- Average True Range (Wilder, 1978): medida da amplitude media de movimento, em unidades de preco.
- Nao indica direcao; quantifica volatilidade realizada na janela de 14 periodos.

## Formula (Wilder)
- TR = max(high - low, |high - closeAnterior|, |low - closeAnterior|) por candle.
- ATR14 = media suavizada de Wilder do TR na janela.

## Uso Classico
- Dimensionar expectativa de movimento e distancias de invalidacao.
- Detectar regimes: ATR em queda sugere compressao; em alta, expansao.
- Normalizar amplitudes: movimento relevante e medido em multiplos de ATR.

## Uso no TraceCom
- Implementado deterministicamente no motor (ATR14 e atrNormalized).
- atrNormalized serve de escala comum entre pares e janelas para filtros de contexto.

## Cuidados
- ATR nao antecipa movimentos; reage a volatilidade ja realizada.
- Saltos de noticia elevam ATR de forma abrupta e distorcem medias.

## Limitacoes
- Nao substitui analise de estrutura de preco.
- Calibracao de limiares (compressao versus expansao) depende do ativo e da sessao.
- Sem dados intra-tick, o TR captura apenas a amplitude do candle.
