---
title: Setup COMPRESSION_EXPANSION
topic: transicao de compressao para expansao
category: SETUP
sourceIds: [SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-SCHWAGER-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.75
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [COMPRESSION, EXPANSION]
setups: [COMPRESSION_EXPANSION]
indicators: [ATR14, DONCHIAN, ADX14, DI_SPREAD]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [compressao, expansao, volatilidade, rompimento]
---

# Setup COMPRESSION_EXPANSION

## Definicao
- Operar a transicao de volatilidade comprimida para expandida, capturando a saida de faixa estreita.
- Nao preve direcao; reage ao primeiro sinal confirmado de expansao.

## Condicoes de Contexto
- ATR14 em faixa comprimida e largura de Donchian encolhendo por sequencia de periodos.
- Candles pequenos e sobrepostos antes do gatilho.

## Gatilho
- Fechamento alem do extremo do canal comprimido com corpo maior que o tipico da compressao.
- ATR14 deixando de cair; ADX14 iniciando elevacao; DI spread inclinando para um lado.
- Alternativa conservadora: aguardar reteste do extremo rompido (ver BREAKOUT_RETEST).

## Invalidacao
- Ausencia de expansao apos o rompimento; retorno ao interior com ATR14 estagnado.
- Rompimentos simetricos consecutivos sem progresso (ruido de compressao).

## Gestao
- Compressoes longas tendem a produzir expansoes maiores; ajustar ambicao a estatistica observada.
- Stake conservador ate confirmacao de expansao sustentada.

## Limitacoes
- Duracao da compressao nao determina tamanho nem direcao da expansao.
- Limiares de ATR14 relativo exigem calibracao por par e janela.
- Sem dados de volume para distinguir acumulacao de mera pausa.
