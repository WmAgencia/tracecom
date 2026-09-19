# DUAL_REASONING_V1_SHADOW — relatorio observacional

- Gerado: 2026-09-19T13:22:14.369Z. Observacoes: 50; directional settled: 19; proximo checkpoint: 30.
- Experimento CONGELADO; relatorio nao altera regras. ZERO REAL.

## Mudancas de decisao (R1 -> FINAL)

- nada mudou: 12; so A: 14; so B: 11; ambos: 13
- R1->R2 mudou: 24; R2->FINAL mudou: 38
- causas: {"UNRESOLVED_CONFLICT":5,"STRUCTURE_CHANGE":11,"SCENARIO_CHANGE":5,"SHORT_IMPULSE_CHANGE":7,"THESIS_INVALIDATED":10}

## Matriz A x B (FINAL) — outcome do Dual por celula
| A | B | N | trades | cobertura | W/L | WR | CI95 | A-sozinho (cf) | B-sozinho (cf) |
|---|---|---|---|---|---|---|---|---|---|
| BUY | BUY | 2 | 2 | 1 | 1/1 | 50.0% | 9.4-90.5% | 50.0% | 50.0% |
| BUY | SELL | 0 | 0 | null | 0/0 | - | - | - | - |
| BUY | WAIT | 6 | 4 | 0.6667 | 0/4 | 0.0% | 0.0-49.0% | 16.7% | 0.0% |
| SELL | BUY | 0 | 0 | null | 0/0 | - | - | - | - |
| SELL | SELL | 5 | 5 | 1 | 2/2 | 50.0% | 15.0-85.0% | 50.0% | 50.0% |
| SELL | WAIT | 8 | 8 | 1 | 3/4 | 42.9% | 15.8-75.0% | 42.9% | 42.9% |
| WAIT | BUY | 7 | 1 | 0.1429 | 0/1 | 0.0% | 0.0-79.3% | 25.0% | 50.0% |
| WAIT | SELL | 3 | 3 | 1 | 1/0 | 100.0% | 20.6-100.0% | - | 100.0% |
| WAIT | WAIT | 19 | 0 | 0 | 0/0 | - | - | 63.6% | 41.7% |

## Structural x Short horizon
| celula | N | trades | cobertura | W/L | WR | A-sozinho (cf) | B-sozinho (cf) |
|---|---|---|---|---|---|---|---|
| STRUCTURAL_BULLISH_SHORT_BULLISH | 12 | 7 | 0.5833 | 1/6 | 14.3% | 33.3% | 33.3% |
| STRUCTURAL_BULLISH_SHORT_BEARISH | 4 | 0 | 0 | 0/0 | - | 100.0% | 0.0% |
| STRUCTURAL_BEARISH_SHORT_BEARISH | 15 | 13 | 0.8667 | 5/6 | 45.5% | 41.7% | 41.7% |
| STRUCTURAL_BEARISH_SHORT_BULLISH | 6 | 0 | 0 | 0/0 | - | 25.0% | 75.0% |
| STRUCTURAL_BULLISH_SHORT_NEUTRAL | 2 | 0 | 0 | 0/0 | - | 50.0% | - |
| STRUCTURAL_BEARISH_SHORT_NEUTRAL | 1 | 0 | 0 | 0/0 | - | 100.0% | - |

## Thesis survival
| categoria | N | trades | cobertura | W/L | WR | expectancy |
|---|---|---|---|---|---|---|
| BOTH_SURVIVE | 29 | 21 | 0.7241 | 7/12 | 36.8% | -0.2632 |
| ONLY_A_SURVIVES | 8 | 2 | 0.25 | 0/0 | - | - |
| ONLY_B_SURVIVES | 6 | 0 | 0 | 0/0 | - | - |
| NEITHER_SURVIVES | 0 | 0 | null | 0/0 | - | - |
| CONFLICT_UNRESOLVED | 6 | 0 | 0 | 0/0 | - | - |

## Cross-examination (pre-cross vs real)

- transicoes: {"BUY->WAIT":4}
- pre-cross trades 27 WR 0.3913; real trades 23 WR 0.3684

## Rounds / persistencia

- tick/candle deltas: NOT_MEASURABLE (payload do Dual nao persiste contagem de ticks/candles por rodada; apenas snapshotId e availableAt)
- agreement persistence: [{"key":"ALWAYS_CONFLICTED","n":40,"wr":0.3333},{"key":"CONVERGED","n":6,"wr":0.4},{"key":"DIVERGED","n":3,"wr":0},{"key":"ALWAYS_AGREED","n":1,"wr":1}]
- A stability: [{"key":"STABLE","n":30,"wr":0.5},{"key":"ONE_CHANGE","n":20,"wr":0.2222}]
- B stability: [{"key":"ONE_CHANGE","n":28,"wr":0.3},{"key":"STABLE","n":22,"wr":0.4444}]

## G2 vs V4 vs Dual (mesma coorte)

- Dual: trades 23 WR 0.3684 coverage 0.46 break-even null expectancy -0.2632
- V4: trades 10 WR 0.5 coverage 0.2
- G2: trades 40 WR 0.5897 coverage 0.8
- G2 x V4 discordantes: N=0

## Latencia (ms)

- total: p50 0 p95 1 p99 2 max 2 negligivel=true
- agentA: p50 0 p95 1 p99 1 max 1 negligivel=true
- agentB: p50 0 p95 0 p99 1 max 1 negligivel=true
- comparison: p50 0 p95 0 p99 0 max 0 negligivel=true
- crossExam: p50 0 p95 0 p99 0 max 0 negligivel=true
- synthesis: p50 0 p95 0 p99 1 max 1 negligivel=true

## Checkpoints
| nivel | completo | N | W/L/D | WR | CI95 | cobertura | break-even | expectancy |
|---|---|---|---|---|---|---|---|---|
| 30 | nao | 19 | 7/12/0 | 36.8% | 19.1-59.0% | 0.38 | null | -0.2632 |
| 60 | nao | 19 | 7/12/0 | 36.8% | 19.1-59.0% | 0.38 | null | -0.2632 |
| 100 | nao | 19 | 7/12/0 | 36.8% | 19.1-59.0% | 0.38 | null | -0.2632 |
| 200 | nao | 19 | 7/12/0 | 36.8% | 19.1-59.0% | 0.38 | null | -0.2632 |
| 500 | nao | 19 | 7/12/0 | 36.8% | 19.1-59.0% | 0.38 | null | -0.2632 |

## Respostas do checkpoint
```
{
 "A_dualVsV4": {
  "dual": 0.3684,
  "v4": 0.6667,
  "deltaPp": -29.83,
  "verdict": "INSUFFICIENT"
 },
 "B_dualVsG2": {
  "dual": 0.3684,
  "g2": 0.5789,
  "deltaPp": -21.05,
  "verdict": "INSUFFICIENT"
 },
 "C_agreementVsA": {
  "agreementTrades": 6,
  "agreementOutcome": {
   "n": 6,
   "decided": 6,
   "wins": 3,
   "losses": 3,
   "draws": 0,
   "wr": 0.5,
   "ci95": {
    "low": 0.1876,
    "high": 0.8124
   },
   "lowN": true
  },
  "aAlone": {
   "n": 18,
   "decided": 18,
   "wins": 6,
   "losses": 12,
   "draws": 0,
   "wr": 0.3333,
   "ci95": {
    "low": 0.1628,
    "high": 0.5625
   },
   "lowN": true
  },
  "deltaPp": 16.67,
  "verdict": "INSUFFICIENT"
 },
 "D_agreementVsB": {
  "agreementOutcome": {
   "n": 6,
   "decided": 6,
   "wins": 3,
   "losses": 3,
   "draws": 0,
   "wr": 0.5,
   "ci95": {
    "low": 0.1876,
    "high": 0.8124
   },
   "lowN": true
  },
  "bAlone": {
   "n": 19,
   "decided": 19,
   "wins": 7,
   "losses": 12,
   "draws": 0,
   "wr": 0.3684,
   "ci95": {
    "low": 0.1915,
    "high": 0.5896
   },
   "lowN": true
  },
  "deltaPp": 13.16,
  "verdict": "INSUFFICIENT"
 },
 "E_bWaitProtectsA": {
  "cases": 11,
  "dualOutcome": {
   "n": 11,
   "decided": 11,
   "wins": 3,
   "losses": 8,
   "draws": 0,
   "wr": 0.2727,
   "ci95": {
    "low": 0.0975,
    "high": 0.5657
   },
   "lowN": true
  },
  "aAloneCounterfactual": {
   "n": 11,
   "decided": 11,
   "wins": 3,
   "losses": 8,
   "draws": 0,
   "wr": 0.2727,
   "ci95": {
    "low": 0.0975,
    "high": 0.5657
   },
   "lowN": true
  },
  "deltaPp": 0,
  "verdict": "INSUFFICIENT"
 },
 "F_crossExamValue": {
  "preCross": {
   "n": 19,
   "decided": 19,
   "wins": 7,
   "losses": 12,
   "draws": 0,
   "wr": 0.3684,
   "ci95": {
    "low": 0.1915,
    "high": 0.5896
   },
   "lowN": true
  },
  "actual": {
   "n": 19,
   "decided": 19,
   "wins": 7,
   "losses": 12,
   "draws": 0,
   "wr": 0.3684,
   "ci95": {
    "low": 0.1915,
    "high": 0.5896
   },
   "lowN": true
  },
  "deltaPp": 0,
  "transitions": null,
  "verdict": "INSUFFICIENT"
 },
 "G_round2Value": {
  "changedR1toR2": 24,
  "verdict": "MEASURED"
 },
 "H_finalRoundValue": {
  "changedR2toFinal": 38,
  "verdict": "MEASURED"
 },
 "I_survivalPredicts": {
  "groups": [
   {
    "survival": "BOTH_SURVIVE",
    "outcome": {
     "n": 19,
     "decided": 19,
     "wins": 7,
     "losses": 12,
     "draws": 0,
     "wr": 0.3684,
     "ci95": {
      "low": 0.1915,
      "high": 0.5896
     },
     "lowN": true
    }
   }
  ],
  "verdict": "INSUFFICIENT"
 },
 "J_coverageCost": {
  "observations": 50,
  "trades": 19,
  "coverage": 0.38
 },
 "note": "Respostas usam a mesma coorte; N insuficiente nao vira conclusao."
}
```
