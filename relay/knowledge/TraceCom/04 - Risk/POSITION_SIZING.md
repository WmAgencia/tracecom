---
title: Dimensionamento de Posicao
topic: position sizing e risco por decisao
category: RISK
sourceIds: [SRC-BOOK-THARP-001, SRC-CFA-001, SRC-CMT-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.85
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION, TRANSITION]
setups: [TREND_PULLBACK, BREAKOUT_CONTINUATION, BREAKOUT_RETEST, FAILED_BREAKOUT, RANGE_REVERSAL, MOMENTUM_CONTINUATION, REJECTION, COMPRESSION_EXPANSION]
indicators: [ATR14]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [risco, position-sizing, stake, capital]
---

# Dimensionamento de Posicao

## Definicao
- Position sizing define quanto capital e comprometido por decisao, condicionado ao risco aceito.
- E o principal controle de sobrevivencia do capital; precede qualquer escolha de entrada.

## Metodo Classico (fractional fixa)
- Risco por operacao expresso como fracao pequena do capital (faixa conservadora amplamente citada: 0.5% a 2%).
- Risco em dinheiro = capital * fracao de risco; tamanho derivado da distancia ate a invalidacao.
- Reduzir fracao quando a incerteza do contexto aumenta (TRANSITION, CHAOTIC).

## Adaptacao a Opcoes Binarias
- Em binarias, a perda maxima por decisao e o proprio stake; nao ha stop intra-operacao.
- Dimensionar stake pela perda maxima tolerada, nao pelo payoff potencial.
- Exposicao simultanea em pares correlacionados (EURUSD/GBPUSD) deve ser tratada como risco agregado.

## Regras Praticas
- Nunca aumentar stake para recuperar perdas (martingale e rejeitado).
- Fracao fixa ou decrescente apos drawdown; nunca crescente em sequencia perdedora.
- Registrar stake, motivo e contexto para auditoria.

## Limitacoes
- Percentuais citados sao convencoes de risco, nao garantia de resultado.
- Sem medicao de slippage e latencia reais no ambiente OTC.
- A fracao ideal depende do payoff e da taxa de acerto, ambos incertos ex ante.
