---
title: Principios do Core Brain
topic: principios centrais de decisao
category: CORE_BRAIN
sourceIds: [SRC-CMT-001, SRC-CFA-001, SRC-BOOK-DOUGLAS-001, SRC-BOOK-THARP-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.9
status: CORE_BRAIN
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION, TRANSITION, CHAOTIC]
setups: [TREND_PULLBACK, BREAKOUT_CONTINUATION, BREAKOUT_RETEST, FAILED_BREAKOUT, RANGE_REVERSAL, MOMENTUM_CONTINUATION, REJECTION, COMPRESSION_EXPANSION, REVERSAL_ATTEMPT]
indicators: [RSI14, ADX14, ATR14, DI_SPREAD, DONCHIAN]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [principios, risco, disciplina, processo]
---

# Principios do Core Brain

## Objetivo
- Consolidar regras de decisao validas em qualquer regime ou setup.
- Atuar como camada de redundancia: nenhum sinal e executado se violar um principio.

## Principios
- Preservacao de capital antes de retorno: risco da decisao definido antes da entrada.
- Regime primeiro: classificar TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION, TRANSITION ou CHAOTIC antes de escolher setup.
- Uma hipotese por trade: entrada, invalidacao e expiracao declaradas em conjunto.
- Candle fechado: features usam apenas candles concluidos; sem repintagem intra-candle.
- Evidencia sobre opiniao: toda afirmacao rastreavel a fonte registrada em 99 - Sources.
- Consistencia supera intensidade: processo repetivel vale mais que conviccao pontual.
- Point-in-time: apenas conhecimento disponivel na data da decisao e consultado.

## Aplicacao no TraceCom
- O disco de conhecimento alimenta o retriever deterministico no momento da decisao.
- Cada nota carrega sourceIds, confidence e applicability auditaveis.
- As regras sao metodologia de pesquisa; nao constituem recomendacao financeira nem codigo executavel.

## Limitacoes
- Principios gerais exigem calibracao para opcoes binarias de 1 minuto.
- Nao ha validacao empirica propria incluida nesta nota.
- Nao substitui os controles tecnicos de risco do motor.
