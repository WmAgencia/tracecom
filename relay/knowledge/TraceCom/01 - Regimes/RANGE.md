---
title: Regime RANGE
topic: mercado lateral
category: REGIME
sourceIds: [SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-WILDER-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.85
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [RANGE]
setups: [RANGE_REVERSAL, REJECTION, FAILED_BREAKOUT]
indicators: [ADX14, RSI14, DONCHIAN, ATR14]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [lateral, range, reversao, extremos]
---

# Regime RANGE

## Definicao
- Preco oscilando entre suporte e resistencia bem definidos, sem progresso direcional claro.
- Topos e fundos sem sequencia clara; rompimentos tendem a falhar e retornar a faixa.

## Como Reconhecer
- ADX14 em nivel baixo por periodo prolongado, com +DI e -DI se alternando proximos.
- Donchian relativamente estreito; toques frequentes nas bordas sem fechamento alem delas.
- RSI14 oscilando entre faixas de sobrecompra e sobrevenda sem persistir em extremos.
- ATR14 tipicamente comprimido em relacao a fases de tendencia.

## Comportamento Tipico
- Extremos da faixa funcionam como areas de reversao enquanto nao houver rompimento com fechamento.
- Regiao central tende a concentrar ruido e menor relacao risco/retorno esperada.
- Falsos rompimentos sao comuns e alimentam o padrao de retorno a faixa.

## Setups Compativeis
- RANGE_REVERSAL: fade nos extremos com confirmacao de rejeicao.
- REJECTION: pavio/recusa em nivel relevante com fechamento de volta na faixa.
- FAILED_BREAKOUT: rompimento sem sustentacao e retorno ao interior.

## Invalidacao do Regime
- Fechamentos sucessivos fora da faixa com expansao de ATR14 e ADX14 em alta.
- Donchian passando a marcar extremos progressivamente mais altos ou mais baixos.

## Limitacoes
- Definicao exata das bordas depende do metodo de projecao adotado.
- Em M1, ruido pode simular toques em extremos inexistentes.
- Nao ha dados de profundidade de mercado para medir liquidez nas bordas.
