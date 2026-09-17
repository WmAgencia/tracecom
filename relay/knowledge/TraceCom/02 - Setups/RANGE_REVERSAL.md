---
title: Setup RANGE_REVERSAL
topic: reversao nos extremos da faixa
category: SETUP
sourceIds: [SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-WILDER-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.78
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [RANGE]
setups: [RANGE_REVERSAL]
indicators: [RSI14, DONCHIAN, ADX14, ATR14]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [range, reversao, extremos, fade]
---

# Setup RANGE_REVERSAL

## Definicao
- Operar a reversao a partir dos extremos de uma faixa lateral consolidada.
- Logica de fade: extremos funcionam como areas de oferta/demanda enquanto nao houver rompimento.

## Condicoes de Contexto
- RANGE identificado: ADX14 baixo, Donchian estavel, extremos testados multiplas vezes.
- ATR14 sem expansao recente; ausencia de catalisador macro conhecido na janela.

## Gatilho
- Toque no extremo superior/inferior da faixa com recusa em candle fechado.
- RSI14 em zona de sobrecompra/sobrevenda tipica, perdendo forca na direcao do extremo.
- Confirmacao adicional: fechamento de volta para dentro da faixa.

## Invalidacao
- Fechamento alem do extremo com ADX14 subindo: risca transicao para rompimento.
- Expansao de ATR14 acompanhando o teste: compressao virando expansao direcional.

## Gestao
- Distancia ate o extremo oposto orienta o horizonte; expiracao nao deve exceder esse tempo tipico.
- Evitar entradas na regiao central da faixa, onde a relacao risco/retorno e pior.

## Limitacoes
- Faixas podem romper sem aviso; falsos toques de extremo sao comuns em M1.
- Sem volume centralizado, nao se mede conviccao nos extremos.
- Resultado depende do rigor na definicao das bordas.
