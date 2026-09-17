---
title: Regime TREND_DOWN
topic: tendencia de baixa
category: REGIME
sourceIds: [SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-WILDER-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.85
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TREND_DOWN]
setups: [TREND_PULLBACK, BREAKOUT_CONTINUATION, BREAKOUT_RETEST, MOMENTUM_CONTINUATION]
indicators: [ADX14, RSI14, ATR14, DONCHIAN, DI_SPREAD]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [tendencia, baixa, continuacao, estrutura]
---

# Regime TREND_DOWN

## Definicao
- Sequencia de topos e fundos descendentes (lower highs e lower lows) em candles fechados.
- Preco sustentado abaixo da faixa media recente; rompimentos de minimos anteriores.

## Como Reconhecer
- ADX14 acima da zona de lateralidade com -DI consistentemente acima de +DI.
- Donchian: rompimentos do extremo inferior mais frequentes que do extremo superior.
- ATR14 estavel ou em expansao; repiques tendem a ser curtos em relacao aos impulsos.

## Comportamento Tipico
- Repiques de alta tendem a encontrar oferta proxima a topos anteriores ou a faixa media.
- Continuacoes apos rompimento de minimo sao o padrao classico descrito na literatura.
- Excesso de sobrevenda de RSI14 pode persistir; nao e sinal isolado de reversao.

## Setups Compativeis
- TREND_PULLBACK: entrada no repique contra a tendencia de baixa.
- BREAKOUT_CONTINUATION: continuacao apos fechamento abaixo de extremo.
- BREAKOUT_RETEST: retorno ao nivel rompido com rejeicao.
- MOMENTUM_CONTINUATION: impulsos de baixa sucessivos com DI spread amplo.

## Invalidacao do Regime
- Recuperacao de topo relevante com fechamento, seguida de falha em perder o minimo.
- ADX14 em queda persistente e -DI perdendo para +DI de forma sustentada.

## Limitacoes
- Assimetria de volatilidade entre pares pode alterar a leitura do regime.
- Nao ha dados de fluxo de ordens para confirmar pressao vendedora real.
- Aplicacao em opcoes binarias de 1 minuto exige mapeamento de expiracao.
