---
title: Regime COMPRESSION
topic: compressao de volatilidade
category: REGIME
sourceIds: [SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-WILDER-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.8
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [COMPRESSION]
setups: [COMPRESSION_EXPANSION, BREAKOUT_CONTINUATION]
indicators: [ATR14, DONCHIAN, ADX14]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [compressao, volatilidade, squeeze, expansao]
---

# Regime COMPRESSION

## Definicao
- Contracao mensuravel da volatilidade: ATR14 em queda e amplitude de Donchian encolhendo.
- Fase de acumulacao de energia; antecede expansao direcional, sem direcao definida por si so.

## Como Reconhecer
- ATR14 caindo por sequencia de periodos, atingindo faixa inferior recente (volatilidade relativa baixa).
- Largura do canal Donchian diminuindo periodo a periodo.
- ADX14 baixo ou em declinio; candles pequenos e sobrepostos.
- Sequencia de fechamentos proximos, com poucas excursoes relevantes.

## Comportamento Tipico
- Compressao nao indica direcao; apenas sugere maior chance de expansao subsequente.
- Rompimentos apos compressao costumam apresentar movimento inicial mais rapido.
- Falsos rompimentos tambem ocorrem; esperar fechamento e aceitavel como filtro.

## Setups Compativeis
- COMPRESSION_EXPANSION: transicao de volatilidade com rompimento confirmado.
- BREAKOUT_CONTINUATION: continuacao apos fechamento alem do extremo comprimido.

## Invalidacao do Regime
- ATR14 volta a subir sem rompimento claro: compressao se desfaz como ruido.
- Expansao confirmada migra o regime para EXPANSION ou para tendencia direcional.

## Limitacoes
- Limiares quantitativos de contracao exigem calibracao por par e por sessao.
- Nao ha volume centralizado para validar a tese de acumulacao.
- Em M1, compressoes curtas podem refletir apenas pausa de liquidez.
