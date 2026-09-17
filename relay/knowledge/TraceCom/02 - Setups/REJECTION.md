---
title: Setup REJECTION
topic: rejeicao em nivel relevante
category: SETUP
sourceIds: [SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-WILDER-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.78
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [RANGE, TRANSITION, TREND_UP, TREND_DOWN]
setups: [REJECTION]
indicators: [RSI14, DONCHIAN, ATR14, ADX14]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [rejeicao, pavio, pin-bar, recusa]
---

# Setup REJECTION

## Definicao
- Recusa de preco em nivel relevante, evidenciada por pavio e fechamento de volta para o lado de origem.
- Familiar ao conceito de pin bar / candle de rejeicao da analise tecnica classica.

## Condicoes de Contexto
- Nivel de referencia claro: extremo de Donchian, borda de faixa, topo/fundo anterior.
- ATR14 suficiente para que pavios sejam informativos (mercado sem compressao extrema).

## Gatilho
- Candle fechado com pavio proeminente no nivel testado e corpo do lado oposto.
- Fechamento preferencialmente alem da faixa de valor do candle anterior.
- Confirmacao adicional com RSI14 saindo de zona extrema ou perdendo momento.

## Invalidacao
- Fechamento seguinte alem do nivel rejeitado, anulando a leitura.
- Sucessao de candles pequenos apoiados no nivel (absorcao) sem recuo.

## Gestao
- Definir invalidacao no extremo do pavio; risco mensuravel e objetivo.
- Adequar expiracao ao tempo tipico de recuo apos rejeicao no ativo.

## Limitacoes
- Wicks podem ser ruido em M1; contexto de nivel e essencial.
- Sem book de ofertas, nao se confirma pressao compradora/vendedora real.
- Nao ha estatistica propria de sucesso do padrao nesta base.
