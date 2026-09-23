# V3 — PLAYBOOK: PRICE ACTION / ESTRUTURA

Fontes: `EDWARDS_MAGEE_2018`, `CMT_ASSOCIATION`, `KIRKPATRICK_DAHLQUIST_2016`;
definicoes internas em `TRACECOM_V3_OPS`.
Contratos: `relay/v3/playbooks.mjs` (PA_*) · medicoes: `relay/v3/measurements.mjs::measureStructure/measurePullback/measureBreakoutRetest`.

## SOURCE-BACKED

- **Tendencia por swing points** (Dow Theory / Edwards & Magee): HH+HL = alta; LH+LL = baixa;
  combinacoes mistas = transicao/range. Suporte/resistencia sao **regioes**, nao linhas exatas.
- **Rompimento**: exige fechamento alem da zona (Edwards & Magee); **false moves** (rompimento
  falho) sao armadilhas classicas de continuacao.
- **Pullback**: correcao contra a tendencia apos impulso; a profundidade relativa (em ATR)
  diferencia correcao saudavel de ameaca estrutural.
- **BOS/CHoCH**: NAO possuem definicao academica padronizada (origem comunitaria/SMC).
  A literatura classica trata o fenomeno como rompimento de swing points.

## TRACECOM OPERATIONAL DEFINITION (BOS/CHoCH)

- **Pivot confirmado**: extremo em `i` somente quando `k=2` candles posteriores o confirmam
  (sem repaint).
- **BOS**: fechamento de candle **alem do ultimo swing confirmado** na direcao da tendencia
  (`BULLISH_BOS`/`BEARISH_BOS`).
- **CHoCH**: fechamento alem do swing que definia o fim da tendencia (contra a tendencia):
  `BEARISH_CHOCH` em UPTREND, `BULLISH_CHOCH` em DOWNTREND. CHoCH e **aviso**, nao reversao
  confirmada; CHoCH **contra a tese invalida o cenario de continuacao**.
- **Rompimento valido**: >= 2 fechamentos alem da zona (`breakout`/`breakdown`).
  **Reteste defensavel**: toque na zona rompida com fechamento de volta no lado do rompimento.
- **Pullback**: `depth` SHALLOW <=0.5 ATR, NORMAL <=1.5, DEEP >1.5; extensao (close acima do
  ultimo topo confirmado em UPTREND) **nao e pullback** (`AT_OR_ABOVE_PRIOR_HIGH`).
- **Micro**: corpo/range, close-in-range, pavios, streak, carater DECISIVE/MIXED/INDECISIVE.

## Uso pelo especialista

WHEN RELEVANT: todo ciclo. Erros comuns: rotular BOS/CHoCH por pavio; usar pivots nao
confirmados; tratar CHoCH como reversao confirmada; chamar falha de rompimento sem
fechamento de volta. Causalidade: ohlc fechado; pivots somente apos confirmacao.
