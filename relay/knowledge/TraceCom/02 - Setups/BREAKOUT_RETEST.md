---
title: Setup BREAKOUT_RETEST
topic: reteste do nivel rompido
category: SETUP
sourceIds: [SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-SCHWAGER-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.8
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TREND_UP, TREND_DOWN, EXPANSION, TRANSITION]
setups: [BREAKOUT_RETEST]
indicators: [DONCHIAN, ADX14, RSI14, ATR14]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [reteste, rompimento, pullback, confirmacao]
---

# Setup BREAKOUT_RETEST

## Definicao
- Apos o rompimento, o preco retorna ao nivel rompido e o respeita, confirmando a mudanca de papel (resistencia vira suporte, ou o inverso).
- Variante conservadora de BREAKOUT_CONTINUATION; troca parte da extensao por melhor definicao de risco.

## Condicoes de Contexto
- Rompimento previo identificado por fechamento alem de extremo ou borda de faixa.
- Nivel rompido claramente definido; sem ambiguidade de referencia.
- ATR14 sem colapso apos o rompimento (capacidade de retomada preservada).

## Gatilho
- Retorno ao nivel com recusa evidenciada por fechamento de candle de retomada.
- RSI14 sem nova excursao extrema contra a direcao do rompimento.
- Confirmacao adicional: ADX14 estavel ou em alta e DI spread favoravel.

## Invalidacao
- Fechamento de volta ao lado antigo do nivel, caracterizando FAILED_BREAKOUT.
- Perda do extremo de referencia do reteste com continuidade contra a posicao.

## Gestao
- Atraso deliberado: nao antecipar o reteste; esperar candle fechado de recusa.
- Expiracao coerente com o tempo de retorno ao nivel observado no ativo.

## Limitacoes
- Reteste pode nunca ocorrer; setup deixa de existir sem prejuizo.
- Distinguir reteste valido de nova consolidacao exige julgamento de estrutura.
- Nao ha granularidade de ticks para medir reacao exata no nivel.
