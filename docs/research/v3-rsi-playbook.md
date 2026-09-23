# V3 — PLAYBOOK: RSI (J. Welles Wilder)

Fonte principal: `WILDER_1978` · apoio: `KIRKPATRICK_DAHLQUIST_2016`, `CMT_ASSOCIATION`.
Contratos executaveis: `relay/v3/playbooks.mjs` (ids RSI_*) · medicoes: `relay/v3/measurements.mjs::measureRsiTrajectory`.

## SOURCE-BACKED

- **Conceito**: RSI compara a magnitude media das altas com a das baixas recentes (periodo 14
  padrao de Wilder), normalizado em 0-100. E um oscilador de **momentum**, nao um sinal de
  reversao: 70/30 sao referencias classicas de leitura, nao gatilhos.
- **Failure swing** (Wilder): extremo no RSI, retracao, falha em superar o extremo, perda do
  extremo intermediario. Wilder registra failure swings >70 / <30 como indicacoes fortes de
  reversao *quando a estrutura do RSI o confirma*.
- **Divergencias**: preco faz extremo novo sem o RSI acompanhar (regular); ou o RSI acompanha
  sem o preco (oculta/continuacao). Wilder destaca divergencias como evidencia, sempre com
  swings confirmados.
- **Limitacoes**: em tendencias fortes o RSI pode permanecer extremo por longos periodos;
  zonas extremas nao indicam exaustao por si so.

## TRACECOM OPERATIONAL DEFINITION

- **Pivots causais**: um pivot de preco em `i` so existe quando `k=2` candles posteriores o
  confirmam (`causalPivots`). Divergencias usam somente pivots confirmados (sem repaint).
- **Crossback 50**: cruzamento do RSI pela linha 50 nos ultimos 3 candles fechados
  (`RSI_CROSSBACK_UP/DOWN`) — evidencia de troca de lado do momentum.
- **Persistencia**: candles consecutivos do mesmo lado de 50 (`rsi.persistence`).
- **Trajetoria**: slope = variacao media por candle na janela (6); aceleracao = delta do slope
  entre janelas sobrepostas. Rotulos: RECOVERING / FLAT / DETERIORATING (±0.5 por candle).
- **Zona e contexto, nunca blocker**: `RSI_OVERBOUGHT_CONTEXT` / `RSI_OVERSOLD_CONTEXT`
  entram como **counter evidence** (coerente com a regra oficial de que tag nao e sinal).

## Como o especialista usa

WHEN RELEVANT: todo ciclo (contexto inicial). WHEN NOT RELEVANT: series curtas, transicoes
bruscas (crossback frequente), pivot insuficiente para divergencia.
REQUIRED INPUTS: candles fechados (>= 21 para RSI 14 com janela). DETERMINISTIC MEASUREMENTS:
`rsi.value/zone/slope/acceleration/crossback/persistence/failureSwing/divergence/momentum`.
SUPPORTING: slope/crossback/persistencia a favor + divergencia oculta/regular a favor.
COUNTER: slope/crossback contra, failure swing contra, zona extrema contra a tese.
BLOCKERS: ADX fraco (de outro dominio) quando aplicavel. INVALIDATIONS: nunca sozinho — RSI
nao invalida tese; a invalidacao estrutural vive no dominio STRUCTURE.

## Erros comuns / causalidade

- "Sobrecomprado = vender" (proibido); "sobrevendido = comprar sem estrutura" (proibido).
- Calcular RSI com candle em formacao injeta futuro dentro do candle: proibido
  (todas as medicoes usam apenas candles fechados).
- Testes: `tests/v3/playbooks-causality.test.ts` (causalidade) e
  `scripts/stage4-observability-tests.mjs` (infra deterministica).
