---
title: Regime CHAOTIC
topic: mercado caotico e whipsaw
category: REGIME
sourceIds: [SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-CFA-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.7
status: SOURCE_KNOWLEDGE
tracecomApplicability: RESEARCH_ONLY
regimes: [CHAOTIC]
setups: [REJECTION, FAILED_BREAKOUT]
indicators: [ATR14, ADX14, RSI14]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [caos, whipsaw, noticia, risco, espera]
---

# Regime CHAOTIC

## Definicao
- Condicao de alta imprevisibilidade: movimentos amplos e alternados, sem estrutura aproveitavel.
- Frequentemente associado a noticias, aberturas de sessao e janelas de baixa liquidez.

## Como Reconhecer
- ATR14 elevado com candles alternando direcao e pavios grandes nos dois lados.
- ADX14 instavel, sem tendencia clara; cruzamentos repetidos de DI.
- RSI14 saltando entre extremos sem persistencia.
- Rompimentos que falham rapidamente, muitas vezes no mesmo candle.

## Comportamento Tipico
- A dispersao dos resultados aumenta; relacao risco/retorno esperada se deteriora.
- Qualquer regra direcional simples tende a sofrer com idas e vindas.
- A decisao mais consistente descrita na literatura e reduzir ou cessar atividade.

## Tratamento Recomendado
- Priorizar WAIT_DISCIPLINE e reduzir exposicao.
- Se operar, stake minimo e apenas com confirmacao dupla de fechamento.
- Evitar horarios de divulgacao macro conhecidos.

## Invalidacao do Regime
- Reducao de ATR14 e reaparecimento de estrutura (range ou tendencia).
- Estabilizacao apos a janela de noticia ou abertura de sessao.

## Limitacoes
- Nao ha classificador deterministico de caos implementado no motor.
- Sem dados de fluxo ou noticias em tempo real na base.
- Regra de parada depende de parametros de risco definidos externamente.
