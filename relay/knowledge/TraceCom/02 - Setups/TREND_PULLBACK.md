---
title: Setup TREND_PULLBACK
topic: entrada em correcao dentro de tendencia
category: SETUP
sourceIds: [SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-WILDER-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.85
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TREND_UP, TREND_DOWN]
setups: [TREND_PULLBACK]
indicators: [RSI14, ADX14, ATR14, DI_SPREAD, DONCHIAN]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [pullback, correcao, tendencia, continuacao]
---

# Setup TREND_PULLBACK

## Definicao
- Entrada na correcao contra a tendencia vigente, buscando continuacao na direcao dominante.
- Premissa classica: tendencia segue ate evidencia de enfraquecimento estrutural.

## Condicoes de Contexto
- Regime TREND_UP ou TREND_DOWN confirmado por estrutura e ADX14.
- DI spread apontando para o lado dominante sem cruzamento recente relevante.
- Correcao sem quebra do ultimo fundo (alta) ou topo (baixa) relevante.

## Gatilho
- Fechamento de candle de retomada na direcao da tendencia apos a correcao.
- RSI14 recuando em direcao a faixa central sem romper nivel de sobrevenda/sobrecompra extremo.
- Preco respeitando referencia de valor (faixa media, fundo anterior, extremo Donchian anterior).

## Invalidacao
- Fechamento que rompe o ultimo fundo/topo estrutural relevante.
- ADX14 caindo com DI dominante perdendo forca; transicao para TRANSITION ou RANGE.

## Gestao
- Stake conforme POSITION_SIZING; expiracao alinhada ao horizonte do setup.
- Evitar perseguir preco: sem entrada tardia apos impulso ja esticado.

## Limitacoes
- Em M1, correcoes e reversoes podem ser indistinguiveis antes do fechamento.
- Pullbacks profundos podem sinalizar mudanca de regime, nao continuacao.
- Aplicacao precisa de mapeamento para expiracao fixa de opcoes binarias.
