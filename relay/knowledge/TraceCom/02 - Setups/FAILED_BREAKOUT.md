---
title: Setup FAILED_BREAKOUT
topic: rompimento falho e retorno a faixa
category: SETUP
sourceIds: [SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-WILDER-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.8
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [RANGE, TRANSITION, EXPANSION, COMPRESSION]
setups: [FAILED_BREAKOUT]
indicators: [DONCHIAN, ADX14, RSI14, ATR14, DI_SPREAD]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [falso-rompimento, falha, reversao, faixa]
---

# Setup FAILED_BREAKOUT

## Definicao
- Rompimento que nao sustenta: o preco chega a operar alem do nivel, mas fecha de volta ao interior da faixa.
- Padrao classico de armadilha em RANGE e em transicoes de regime.

## Condicoes de Contexto
- Nivel de referencia visivel (borda de Donchian, suporte/resistencia anterior).
- ATR14 sem expansao sustentada no sentido do rompimento.
- ADX14 sem confirmacao direcional; DI spread sem dominancia persistente.

## Gatilho
- Fechamento de candle de volta ao lado original do nivel apos a excursao.
- Rejeicao evidenciada por pavio alem do nivel com fechamento interno.
- Confirmacao adicional: perda do extremo local criado durante o rompimento.

## Invalidacao
- Novo fechamento decisivo fora da faixa, com ADX14 e DI spread confirmando a direcao.
- Expansao de ATR14 na direcao do rompimento original.

## Gestao
- Preferir operar na direcao do retorno a faixa, nao contra impulsos de noticia.
- Reduzir stake em TRANSITION; priorizar RANGE consolidado.

## Limitacoes
- Identificacao depende de fechamento; reacao intra-candle nao e capturada.
- Em M1, wicks curtos podem gerar sinais ambiguos.
- Sem dados de fluxo para confirmar absorcao no nivel rompido.
