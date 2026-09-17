---
title: Indicador DONCHIAN
topic: canais de Donchian
category: INDICATOR
sourceIds: [SRC-CMT-001, SRC-BOOK-SCHWAGER-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.9
status: SOURCE_KNOWLEDGE
tracecomApplicability: DIRECT
regimes: [TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION]
setups: [BREAKOUT_CONTINUATION, BREAKOUT_RETEST, RANGE_REVERSAL, COMPRESSION_EXPANSION]
indicators: [DONCHIAN, ATR14]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [donchian, canal, maxima, minima, rompimento]
---

# Indicador DONCHIAN

## Definicao
- Canais de Donchian (associados a Richard Donchian): maxima mais alta e minima mais baixa de N periodos.
- Banda superior = maior maxima dos ultimos N candles; inferior = menor minima; linha media = media das bandas.

## Formula
- Superior(N) = max(high dos ultimos N candles).
- Inferior(N) = min(low dos ultimos N candles).
- Media(N) = (superior + inferior) / 2.

## Leitura Classica
- Fechamento acima da banda superior e referencia de rompimento de alta; abaixo da inferior, de baixa.
- Estreitamento das bandas indica compressao; alargamento indica expansao.
- Media do canal e referencia comum de equilíbrio em operacoes de tendencia.
- Sistemas historicos de seguimento de tendencia usam rompimentos de Donchian como gatilho.

## Uso no TraceCom
- Implementado deterministicamente no motor sobre candles fechados.
- Sustenta leitura de rompimento, compressao e extremos de faixa.

## Cuidados
- Janela N define sensibilidade; N curto em M1 gera mais rompimentos e mais ruido.
- Rompimento por maxima/minima pode usar pavio ou fechamento conforme o criterio adotado.

## Limitacoes
- Nao indica se o rompimento sustentara (falso rompimento e comum).
- Nao ha dados de volume para validar quebra de extremo.
- Parametro de janela deve ser fixado e auditado pelo motor.
