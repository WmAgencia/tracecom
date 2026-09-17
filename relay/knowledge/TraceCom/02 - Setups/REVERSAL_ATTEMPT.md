---
title: Setup REVERSAL_ATTEMPT
topic: tentativa de reversao de tendencia
category: SETUP
sourceIds: [SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-WILDER-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.65
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TREND_UP, TREND_DOWN, TRANSITION, EXPANSION]
setups: [REVERSAL_ATTEMPT]
indicators: [RSI14, ADX14, DI_SPREAD, ATR14, DONCHIAN]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [reversao, topo, fundo, divergencia, risco]
---

# Setup REVERSAL_ATTEMPT

## Definicao
- Tentativa de operar contra a tendencia vigente em busca de mudanca de regime.
- Classe de setup menos frequente e mais arriscada que continuacoes; exige evidencia multipla.

## Condicoes de Contexto
- Tendencia previa com sinais de exaustao: ADX14 caindo, DI spread estreitando.
- Divergencia classica entre preco e RSI14 (preco renova extremo, RSI nao).
- Perda de estrutura: rompimento do ultimo fundo/topo relevante com fechamento.

## Gatilho
- Confirmacao dupla: quebra estrutural + recusa no novo extremo tentado.
- Consistencia entre multiplos timeframes, quando disponiveis (M5 confirmando M1).

## Invalidacao
- Retomada da tendencia com renovacao de extremo e ADX14 voltando a subir.
- Falha em sustentar o novo extremo oposto apos a quebra.

## Gestao
- Stake reduzido: base rate de reversoes e menor que a de continuacoes.
- Preferir aguardar reteste da estrutura rompida antes de aumentar conviccao.

## Limitacoes
- Divergencias podem persistir por longos periodos sem reversao.
- Regime CHAOTIC gera falsos sinais de reversao em sequencia.
- Nao ha dados de posicionamento (CO T) integrados a esta base.
