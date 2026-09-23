# V3 — PLAYBOOK: ATR / VOLATILIDADE (J. Welles Wilder)

Fonte principal: `WILDER_1978` · apoio: `CMT_ASSOCIATION`.
Contratos: `relay/v3/playbooks.mjs` (ATR_*) · medicoes: `relay/v3/measurements.mjs::measureAtrContext`.

## SOURCE-BACKED

- **ATR** e a media suavizada (Wilder) do true range — medida de volatilidade, **sem direcao**.
- A utilidade pratica e **normalizar**: stops, alvos, distancias de zona e tamanho de
  movimento devem ser comparados em multiplos de ATR, nunca em valores absolutos.
- Volatilidade e ciclica (contracao/expansao), o que conecta com o squeeze de Bollinger.

## TRACECOM OPERATIONAL DEFINITION

- `normalizedRange = range / ATR`, `normalizedImpulse = |net move| / ATR`,
  `normalizedPullback = distancia do extremo / ATR`, `wickNormalization = pavio / ATR`.
- **Regime por volRatio (ATR5/ATR14)**: >1.6 `ABNORMAL_EXPANSION`; >1.15 `VOLATILITY_EXPANSION`;
  <0.7 `LOW_INFORMATION_VOLATILITY`; caso contrario `VOLATILITY_COMPATIBLE`.
  Limiares internos documentados (nao vem de Wilder), calibrados para 5s OTC.
- **Tolerancia de zona**: zona considerada ativa quando a distancia preco-zona <= ~0.75 ATR
  (tolerancia interna; ATR e o normalizador, a tolerancia e decisao TraceCom).
- ATR **nunca escolhe direcao**: `assessment` e sempre VOLATILITY_COMPATIBLE /
  VOLATILITY_UNFAVORABLE / ABNORMAL_EXPANSION / LOW_INFORMATION_VOLATILITY.

## Uso pelo especialista

WHEN RELEVANT: todo ciclo (normalizacao) e candles de rejeicao (pavios).
WHEN NOT RELEVANT: horizontes muito menores que o periodo do ATR.
SUPPORTING: volRatio compativel; COUNTER: expansao anormal; BLOCKER: LOW_INFORMATION_VOLATILITY.
Causalidade: ATR com candles fechados; nunca incluir o candle corrente em formacao.
