---
title: Frescor e Obsolescencia de Dados
topic: freshness gate e dados obsoletos
category: MICROSTRUCTURE
sourceIds: [SRC-BIS-001, SRC-CME-001, SRC-ECB-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.85
status: SOURCE_KNOWLEDGE
tracecomApplicability: DIRECT
regimes: [TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION, TRANSITION, CHAOTIC]
setups: [TREND_PULLBACK, BREAKOUT_CONTINUATION, BREAKOUT_RETEST, FAILED_BREAKOUT, RANGE_REVERSAL, MOMENTUM_CONTINUATION, REJECTION, COMPRESSION_EXPANSION, REVERSAL_ATTEMPT]
indicators: [ATR14, ADX14, RSI14]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [freshness, staleness, dados, qualidade]
---

# Frescor e Obsolescencia de Dados

## Definicao
- Frescor (freshness) e a idade do dado em relacao ao instante da decisao; obsolescencia e o estado em que o dado nao representa mais o mercado.
- Mercados OTC nao possuem feed centralizado; cada provedor tem seu relogio e sua ultima atualizacao.

## Riscos de Dado Obsoleto
- Preco congelado durante janelas de baixa liquidez gera falsos sinais de calma (compressao artificial).
- Atraso de feed faz o motor decidir com preco que nao existe mais.
- Desalinhamento de fuso e horario de verao desloca janelas de candle e sessoes.

## Controles Recomendados
- Comparar timestamp do ultimo candle com o relogio da decisao; rejeitar atraso acima do limite do timeframes.
- Gate deterministico de frescor implementado no motor: sem dado fresco, sem decisao.
- Registrar idade do dado na auditoria de cada decisao.

## Uso no TraceCom
- Freshness gate implementado deterministicamente; rejeita features velhas antes do hot path.

## Limitacoes
- Sem dados de tick e sem fonte oficial OTC para comparacao cruzada de precos.
- Limiares de frescor variam com o timeframes e com a janela de liquidez.
- Feriados e eventos podem invalidar premissas de atualizacao continua.
