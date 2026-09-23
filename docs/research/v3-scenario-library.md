# V3 — SCENARIO LIBRARY (compartilhada: Asset + Consensus)

Contratos executaveis: `relay/v3/scenarios.mjs` (`SCENARIOS`, `evaluateScenario`, `classifyScenarios`).
As definicoes abaixo sao **TRACECOM OPERATIONAL DEFINITION** sobre conceitos source-backed
(estrutura, momentum, volatilidade, posicao relativa). A classificacao **nao usa votacao**:
usa familias de evidencia (`STRUCTURE`, `MOMENTUM`, `DIRECTIONAL_PRESSURE`, `VOLATILITY`,
`RELATIVE_POSITION`, `MICRO_PRICE_ACTION`), blockers e invalidations com precedencia.

| Cenario | Direcao | Definicao operacional | Distingue de |
|---------|---------|----------------------|--------------|
| TREND_CONTINUATION | UP | Uptrend intacto com BOS recente **ou** dominancia PLUS com ADX >= 20; sem pullback relevante | PULLBACK_CONTINUATION |
| PULLBACK_CONTINUATION | UP | Uptrend + correcao ativa NORMAL/DEEP, sem CHoCH; aguarda confirmacao (BOS/crossback/micro decisivo) | TREND_CONTINUATION |
| DEEP_PULLBACK_STRUCTURE_THREAT | UP | Correcao > 1.5 ATR ameacando o swing de referencia | PULLBACK_CONTINUATION |
| STRUCTURAL_REVERSAL | DOWN | CHoCH bearish confirmado + evidencia de momentum/pressao na nova direcao | pullback profundo sem quebra |
| BREAKOUT | UP | >= 2 fechamentos acima da resistencia, tipicamente pos-squeeze | BREAKOUT_RETEST |
| FAILED_BREAKOUT | DOWN | Rompeu a resistencia e voltou para dentro | BREAKOUT |
| BREAKDOWN | DOWN | >= 2 fechamentos abaixo do suporte | FAILED_BREAKDOWN |
| FAILED_BREAKDOWN | UP | Perdeu o suporte e recuperou o range | BREAKDOWN |
| BREAKOUT_RETEST | UP | Rompimento + retorno a zona + defesa (fechamento no lado do rompimento) | BREAKOUT |
| COMPRESSION | - | Squeeze de BandWidth + contracao de volatilidade | EXPANSION |
| EXPANSION | - | volRatio > 1.15 sem estrutura direcional | COMPRESSION |
| RANGE | - | Estrutura mista + ADX fraco + preco no miolo das bandas | TRANSITION |
| TRANSITION | - | Estrutura em transicao (HH+LL ou LH+HL) ou ADX caindo pos-tendencia | RANGE |
| EXHAUSTION | - | ADX caindo com ADX >= 20 + impulso desacelerando e/ou bulge | TREND_WEAKENING |
| STRUCTURAL_ZONE_REJECTION | - | Rejeicao em zona/banda com pavio e fechamento de volta, sem rompimento | FAILED_BREAKOUT |
| TREND_WEAKENING | - | ADX caindo + spread encolhendo, estrutura ainda intacta | EXHAUSTION |
| TREND_RESUMPTION | UP | Apos pullback, pressao retoma (takeover/resume) + BOS/crossback | PULLBACK_CONTINUATION |
| NO_SETUP | - | Expiration existe, mas sem configuracao estrutural relevante | WAIT |

## NO_SETUP vs WAIT (missao 19)

- **NO_SETUP**: ausencia de cenario operacional (range sem edge, evidencias dispersas,
  preco no meio da faixa). O primeiro ciclo e FULL; depois dele NO_SETUP **encerra** a
  opportunity (`FIRST_FULL_CYCLE_NO_SETUP`), reduzindo carga naturalmente.
- **WAIT**: cenario existe mas falta confirmacao (ex.: uptrend + pullback sem BOS/crossback).
  A opportunity continua ciclando enquanto houver tempo (TTE > 300s).

## Cancelamentos

- Qualquer **INVALIDATION** (ex.: CHoCH contra a tese) ou **BLOCKER** relevante (ex.: deep
  pullback, low information volatility) => CANCEL no Final Challenge.
- Asset e Consensus classificam o MESMO mercado **independentemente** (evita anchoring);
  o Consensus compara depois (AGREE/DISAGREE/INSUFFICIENT_EVIDENCE) e roda o Final Challenge.
