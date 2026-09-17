---
title: Processo de Decisao do Core Brain
topic: pipeline de decisao em etapas
category: CORE_BRAIN
sourceIds: [SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-SCHWAGER-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.88
status: CORE_BRAIN
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION, TRANSITION, CHAOTIC]
setups: [TREND_PULLBACK, BREAKOUT_CONTINUATION, BREAKOUT_RETEST, FAILED_BREAKOUT, RANGE_REVERSAL, MOMENTUM_CONTINUATION, REJECTION, COMPRESSION_EXPANSION, REVERSAL_ATTEMPT]
indicators: [RSI14, ADX14, ATR14, DI_SPREAD, DONCHIAN]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [processo, pipeline, checklist, disciplina]
---

# Processo de Decisao do Core Brain

## Etapas
1. Coletar features apenas de candles fechados (RSI14, ADX14, ATR14, DI spread, Donchian).
2. Classificar o regime vigente e a confianca da classificacao.
3. Selecionar o setup compativel com o regime detectado.
4. Consultar a base de conhecimento point-in-time para o par e o setup.
5. Verificar risco: stake, perda maxima do ciclo e limites de drawdown.
6. Executar somente se todas as condicoes anteriores forem satisfeitas.
7. Registrar decisao, contexto e resultado para revisao posterior.

## Criterios de Bloqueio
- Regime CHAOTIC ou TRANSITION sem confirmacao: aguardar.
- Feature desatualizada (freshness gate reprovado): nao decidir.
- Setup sem invalidacao clara: descartar.
- Limite de drawdown atingido: reduzir ou interromper operacao.

## Revisao
- Comparar resultado com a hipotese original, nao apenas com o lucro.
- Separar erro de processo de variacao aleatoria do resultado.
- Atualizar calibracao somente com amostra suficiente.

## Limitacoes
- O pipeline descreve metodo; nao define parametros numericos de entrada.
- Regras de execucao dependem do motor de features implementado no repositorio.
- Nao ha dados de livro de ofertas nem de execucao real nesta base.
