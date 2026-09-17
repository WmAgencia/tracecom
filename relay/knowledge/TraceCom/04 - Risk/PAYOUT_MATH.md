---
title: Matematica de Payout em Opcoes Binarias
topic: payout, taxa de acerto de equilibrio e expectativa
category: RISK
sourceIds: [SRC-CFA-001, SRC-BOOK-THARP-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.9
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION, TRANSITION, CHAOTIC]
setups: [TREND_PULLBACK, BREAKOUT_CONTINUATION, BREAKOUT_RETEST, FAILED_BREAKOUT, RANGE_REVERSAL, MOMENTUM_CONTINUATION, REJECTION, COMPRESSION_EXPANSION, REVERSAL_ATTEMPT]
indicators: [ATR14]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [payout, breakeven, expectativa, binarias]
---

# Matematica de Payout em Opcoes Binarias

## Estrutura do Contrato
- Opcao binaria paga valor fixo se a condicao de expiracao for verdadeira e perde o stake caso contrario.
- Seja S o stake e p a taxa de payout (lucro por unidade apostada em caso de vitoria).

## Resultado por Cenario
- Vitoria: +S * p.
- Derrota: -S.
- Expectativa por operacao = S * (W * p - L), onde W e a taxa de acerto e L = 1 - W.

## Taxa de Acerto de Equilibrio
- Breakeven: W * p = (1 - W), logo W = 1 / (1 + p).
- Exemplos: p = 0.80 exige W maior que 55.6%; p = 0.90 exige W maior que 52.6%; p = 1.00 exige W maior que 50%.
- Quanto menor o payout, maior a taxa de acerto necessaria para nao perder capital.

## Implicacoes
- Diferenca entre taxa de acerto observada e breakeven define a expectativa economica.
- Aumentar stake nao melhora a expectativa; apenas amplifica o resultado esperado e a variancia.
- Drawdown cresce com sequencias perdedoras; ver DRAWDOWN_POLICY.

## Limitacoes
- Payouts variam por plataforma, ativo e prazo; valores devem ser lidos no momento da operacao.
- A taxa de acerto futura e desconhecida; exemplos numericos sao ilustrativos, nao previsoes.
- Nao ha dados reais de payout ou execucao nesta base de conhecimento.
