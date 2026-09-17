---
title: Fechamento de Candle e Liquidacao
topic: settlement por candle fechado
category: MICROSTRUCTURE
sourceIds: [SRC-CME-001, SRC-CFTC-001, SRC-CMT-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.85
status: SOURCE_KNOWLEDGE
tracecomApplicability: DIRECT
regimes: [TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION, TRANSITION, CHAOTIC]
setups: [MOMENTUM_CONTINUATION, BREAKOUT_CONTINUATION, REJECTION, RANGE_REVERSAL]
indicators: [ATR14, DONCHIAN]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [candle, fechamento, liquidacao, expiracao]
---

# Fechamento de Candle e Liquidacao

## Definicao
- Contratos com expiracao fixa sao liquidados pelo preco de referencia no instante de vencimento.
- O candle fechado e a unidade minima confiavel de informacao: so ele possui OHLC definitivo.

## Implicacoes para Decisao
- Features calculadas intra-candle podem mudar ate o fechamento; sinais nao devem ser tratados como finais.
- Decisoes baseadas em candle fechado evitam repintagem e mantem determinismo.
- O resultado de uma entrada depende do preco no vencimento, nao do caminho intermediario.

## Cuidados Operacionais
- Evitar entrada nos ultimos instantes antes da expiracao: latencia e microestrutura OTC degradam o preenchimento.
- Alinhar a expiracao ao horizonte do padrao observado; expiracao longa demais dilui a tese.
- O horario do candle e o relogio da plataforma devem ser consistentes.

## Uso no TraceCom
- Regra de settle por candle fechado implementada deterministicamente no motor.
- Todas as features do motor sao derivadas de candles concluidos.

## Limitacoes
- Nao ha preco oficial de liquidacao em mercado OTC; a referencia e do provedor.
- Sem dados de tick, nao se mede o caminho intra-candle nem spikes de vencimento.
- Feriados e mudancas de horario podem deslocar janelas de candle.
