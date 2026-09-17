---
title: Disciplina de Espera (No-Trade)
topic: quando nao operar
category: PLAYBOOK
sourceIds: [SRC-BOOK-DOUGLAS-001, SRC-BOOK-THARP-001, SRC-CMT-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.8
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TRANSITION, CHAOTIC, COMPRESSION, RANGE]
setups: [TREND_PULLBACK, BREAKOUT_CONTINUATION, BREAKOUT_RETEST, FAILED_BREAKOUT, RANGE_REVERSAL, MOMENTUM_CONTINUATION, REJECTION, COMPRESSION_EXPANSION, REVERSAL_ATTEMPT]
indicators: [ADX14, ATR14, RSI14]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [espera, no-trade, disciplina, filtro]
---

# Disciplina de Espera (No-Trade)

## Principio
- Nao operar e uma decisao valida; preserva capital e evita trades de baixa qualidade.
- A espera protege contra a necessidade psicologica de acao, documentada na literatura de trading.

## Condicoes de No-Trade
- Regime CHAOTIC ou TRANSITION sem confirmacao estrutural.
- Feature desatualizada (freshness gate reprovado) ou dado ausente.
- Setup sem invalidacao clara ou sem nivel de referencia bem definido.
- Janela de noticia iminente; liquidez anormal de abertura/fechamento de sessao.
- Drawdown no gatilho de pausa definido em DRAWDOWN_POLICY.

## Pratica
- Definir uma regra de paciencia contada em candles fechados, nao em minutos de relogio emocional.
- Medir decisoes evitadas e seus resultados hipoteticos para calibrar filtros.
- Registrar cada no-trade com o motivo objetivo.

## Custo da Espera
- Perder oportunidades e aceitavel; perder capital por impaciencia e evitavel.
- Filtros em excesso reduzem amostra; calibrar com dados, nao com desconforto.

## Limitacoes
- Paciencia sem criterio objetivo vira procrastinacao.
- Nao ha backtest proprio do custo de oportunidade nesta base.
- A regra de espera depende de parametros definidos pelo motor.
