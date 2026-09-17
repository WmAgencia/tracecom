---
title: Setup BREAKOUT_CONTINUATION
topic: rompimento com continuacao
category: SETUP
sourceIds: [SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-SCHWAGER-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.8
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TREND_UP, TREND_DOWN, EXPANSION, COMPRESSION]
setups: [BREAKOUT_CONTINUATION]
indicators: [DONCHIAN, ADX14, ATR14, DI_SPREAD]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [rompimento, breakout, continuacao, canal]
---

# Setup BREAKOUT_CONTINUATION

## Definicao
- Continuacao na direcao do rompimento apos fechamento de candle alem de extremo relevante.
- Extremos classicos: maxima/minima do canal de Donchian, topos/fundos anteriores da faixa.

## Condicoes de Contexto
- Faixa ou compressao identificavel antes do rompimento; energia acumulada.
- ADX14 em elevacao ou ja acima da zona de lateralidade.
- ATR14 indicando capacidade de movimento alem do nivel rompido.

## Gatilho
- Candle fechado alem do extremo, com corpo relevante em relacao ao ATR14.
- DI spread confirmando o lado do rompimento.
- Filtro de qualidade: preferir rompimentos em sessao de liquidez, evitando janelas mortas.

## Invalidacao
- Retorno do preco para dentro da faixa no candle seguinte (preludio de FAILED_BREAKOUT).
- Reducao de ATR14 apos o rompimento sem progresso direcional.

## Gestao
- Risco definido antes da entrada; sem aumento de stake apos perda.
- Se o objetivo e expiracao fixa, alinhar com o tempo tipico de desdobramento do rompimento.

## Limitacoes
- Nao ha dados de volume ou fluxo para confirmar rompimento.
- Falsos rompimentos sao frequentes em RANGE e TRANSITION.
- Sem simulacao propria de taxa de acerto nesta base de conhecimento.
