---
title: Regime TREND_UP
topic: tendencia de alta
category: REGIME
sourceIds: [SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-WILDER-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.85
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TREND_UP]
setups: [TREND_PULLBACK, BREAKOUT_CONTINUATION, BREAKOUT_RETEST, MOMENTUM_CONTINUATION]
indicators: [ADX14, RSI14, ATR14, DONCHIAN, DI_SPREAD]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [tendencia, alta, continuacao, estrutura]
---

# Regime TREND_UP

## Definicao
- Sequencia de topos e fundos ascendentes (higher highs e higher lows) em candles fechados.
- Preco sustentado acima da faixa media recente; rompimentos de maxima anteriores.

## Como Reconhecer
- ADX14 acima da zona de lateralidade com +DI consistentemente acima de -DI.
- Donchian: rompimentos do extremo superior com frequencia maior que do extremo inferior.
- ATR14 estavel ou em leve expansao; correcoes tendem a ser mais curtas que os impulsos.

## Comportamento Tipico
- Pullbacks tendem a encontrar demanda proxima a fundos anteriores ou a faixa media.
- Continuacoes apos rompimento de maxima sao o padrao classico descrito na literatura.
- Excesso de sobrecompra de RSI14 pode persistir; nao e sinal isolado de reversao.

## Setups Compativeis
- TREND_PULLBACK: entrada na correcao contra a tendencia.
- BREAKOUT_CONTINUATION: continuacao apos fechamento acima de extremo.
- BREAKOUT_RETEST: retorno ao nivel rompido com sustentacao.
- MOMENTUM_CONTINUATION: impulsos sucessivos com DI spread amplo.

## Invalidacao do Regime
- Perda de fundo relevante com fechamento, seguida de falha em retomar a maxima.
- ADX14 em queda persistente e +DI perdendo para -DI de forma sustentada.

## Limitacoes
- A classificacao vintage do regime nao esta disponivel sem reconstrucao historica.
- Sinais de sobrecompra de RSI nao invalidam tendencia por si so.
- Aplicacao em opcoes binarias de 1 minuto exige mapeamento de expiracao.
