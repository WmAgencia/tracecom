---
title: Indicador DI_SPREAD
topic: diferencial direcional +DI menos -DI
category: INDICATOR
sourceIds: [SRC-BOOK-WILDER-001, SRC-CMT-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.95
status: SOURCE_KNOWLEDGE
tracecomApplicability: DIRECT
regimes: [TREND_UP, TREND_DOWN, RANGE, TRANSITION]
setups: [MOMENTUM_CONTINUATION, TREND_PULLBACK, BREAKOUT_CONTINUATION]
indicators: [DI_SPREAD, ADX14]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [di, spread, direcao, wilder]
---

# Indicador DI_SPREAD

## Definicao
- Diferenca entre os indicadores direcionais de Wilder: +DI menos -DI.
- Fornece a direcao do movimento que o ADX14 mede em forca.

## Formula (resumo)
- +DI = 100 * media(+DM) / media(TR); -DI = 100 * media(-DM) / media(TR).
- DI spread = +DI - (-DI); positivo indica predominio de compradores, negativo de vendedores.

## Leitura Classica
- Cruzamento de +DI e -DI sugere mudanca de dominancia direcional.
- Amplitude do spread indica conviccao relativa do lado dominante.
- Spread amplo com ADX14 em alta: contexto classico de tendencia definida.

## Uso no TraceCom
- Implementado deterministicamente no motor sobre candles fechados.
- Combina com ADX14 na classificacao de regime e no filtro de continuacao.

## Cuidados
- Em RANGE, cruzamentos de DI ocorrem com frequencia e sem valor preditivo.
- Spread comprimido indica equilibrio, nao previsao de ruptura.

## Limitacoes
- Efeito atrasado por suavizacao de Wilder.
- Nao incorpora volume nem profundidade de mercado.
- Limiares de spread relevante variam por par e por volatilidade do periodo.
