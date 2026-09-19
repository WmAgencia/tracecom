# DUAL_REASONING_V1_SHADOW — relatorio observacional

- Gerado: 2026-09-19T13:39:09.849Z. Observacoes: 145; directional settled: 46; proximo checkpoint: 60.
- Experimento CONGELADO; relatorio nao altera regras. ZERO REAL.

## Mudancas de decisao (R1 -> FINAL)

- nada mudou: 25; so A: 36; so B: 36; ambos: 48
- R1->R2 mudou: 80; R2->FINAL mudou: 109
- causas: {"UNRESOLVED_CONFLICT":16,"STRUCTURE_CHANGE":30,"SCENARIO_CHANGE":13,"SHORT_IMPULSE_CHANGE":27,"THESIS_INVALIDATED":34}

## Matriz A x B (FINAL) — outcome do Dual por celula
| A | B | N | trades | cobertura | W/L | WR | CI95 | A-sozinho (cf) | B-sozinho (cf) |
|---|---|---|---|---|---|---|---|---|---|
| BUY | BUY | 9 | 9 | 1 | 4/4 | 50.0% | 21.5-78.5% | 50.0% | 50.0% |
| BUY | SELL | 2 | 0 | 0 | 0/0 | - | - | 100.0% | 0.0% |
| BUY | WAIT | 11 | 7 | 0.6364 | 1/6 | 14.3% | 2.6-51.3% | 22.2% | 14.3% |
| SELL | BUY | 0 | 0 | null | 0/0 | - | - | - | - |
| SELL | SELL | 14 | 14 | 1 | 4/6 | 40.0% | 16.8-68.7% | 40.0% | 40.0% |
| SELL | WAIT | 15 | 13 | 0.8667 | 5/8 | 38.5% | 17.7-64.5% | 35.7% | 38.5% |
| WAIT | BUY | 23 | 2 | 0.087 | 1/1 | 50.0% | 9.4-90.5% | 33.3% | 58.8% |
| WAIT | SELL | 15 | 7 | 0.4667 | 2/3 | 40.0% | 11.8-76.9% | 25.0% | 61.5% |
| WAIT | WAIT | 56 | 0 | 0 | 0/0 | - | - | 71.0% | 41.0% |

## Structural x Short horizon
| celula | N | trades | cobertura | W/L | WR | A-sozinho (cf) | B-sozinho (cf) |
|---|---|---|---|---|---|---|---|
| STRUCTURAL_BULLISH_SHORT_BULLISH | 25 | 18 | 0.72 | 6/11 | 35.3% | 45.8% | 45.8% |
| STRUCTURAL_BULLISH_SHORT_BEARISH | 17 | 0 | 0 | 0/0 | - | 64.3% | 35.7% |
| STRUCTURAL_BEARISH_SHORT_BEARISH | 37 | 28 | 0.7568 | 8/15 | 34.8% | 40.0% | 40.0% |
| STRUCTURAL_BEARISH_SHORT_BULLISH | 21 | 0 | 0 | 0/0 | - | 41.2% | 58.8% |
| STRUCTURAL_BULLISH_SHORT_NEUTRAL | 3 | 0 | 0 | 0/0 | - | 50.0% | - |
| STRUCTURAL_BEARISH_SHORT_NEUTRAL | 7 | 1 | 0.1429 | 1/0 | 100.0% | 66.7% | - |

## Thesis survival
| categoria | N | trades | cobertura | W/L | WR | expectancy |
|---|---|---|---|---|---|---|
| BOTH_SURVIVE | 77 | 49 | 0.6364 | 15/27 | 35.7% | -0.2791 |
| ONLY_A_SURVIVES | 25 | 2 | 0.08 | 1/1 | 50.0% | 0 |
| ONLY_B_SURVIVES | 17 | 1 | 0.0588 | 1/0 | 100.0% | 1 |
| NEITHER_SURVIVES | 0 | 0 | null | 0/0 | - | - |
| CONFLICT_UNRESOLVED | 20 | 0 | 0 | 0/0 | - | - |

## Cross-examination (pre-cross vs real)

- transicoes: {"BUY->WAIT":11,"SELL->WAIT":9}
- pre-cross trades 72 WR 0.4167; real trades 52 WR 0.3778

## Rounds / persistencia

- tick/candle deltas: NOT_MEASURABLE (payload do Dual nao persiste contagem de ticks/candles por rodada; apenas snapshotId e availableAt)
- agreement persistence: [{"key":"ALWAYS_CONFLICTED","n":107,"wr":0.36},{"key":"CONVERGED","n":22,"wr":0.4118},{"key":"DIVERGED","n":15,"wr":0},{"key":"ALWAYS_AGREED","n":1,"wr":1}]
- A stability: [{"key":"STABLE","n":82,"wr":0.4333},{"key":"ONE_CHANGE","n":63,"wr":0.2667}]
- B stability: [{"key":"ONE_CHANGE","n":89,"wr":0.3448},{"key":"STABLE","n":56,"wr":0.4375}]

## G2 vs V4 vs Dual (mesma coorte)

- Dual: trades 52 WR 0.3778 coverage 0.3586 break-even null expectancy -0.2391
- V4: trades 36 WR 0.5278 coverage 0.2483
- G2: trades 123 WR 0.5455 coverage 0.8483
- G2 x V4 discordantes: N=1

## Latencia (ms)

- total: p50 0 p95 1 p99 2 max 2 negligivel=true
- agentA: p50 0 p95 1 p99 1 max 1 negligivel=true
- agentB: p50 0 p95 0 p99 1 max 1 negligivel=true
- comparison: p50 0 p95 0 p99 0 max 0 negligivel=true
- crossExam: p50 0 p95 0 p99 0 max 1 negligivel=true
- synthesis: p50 0 p95 0 p99 1 max 1 negligivel=true

## Checkpoints
| nivel | completo | N | W/L/D | WR | CI95 | cobertura | break-even | expectancy |
|---|---|---|---|---|---|---|---|---|
| 30 | sim | 30 | 10/20/0 | 33.3% | 19.2-51.2% | 0.2069 | null | -0.3333 |
| 60 | nao | 45 | 17/28/1 | 37.8% | 25.1-52.4% | 0.3172 | null | -0.2391 |
| 100 | nao | 45 | 17/28/1 | 37.8% | 25.1-52.4% | 0.3172 | null | -0.2391 |
| 200 | nao | 45 | 17/28/1 | 37.8% | 25.1-52.4% | 0.3172 | null | -0.2391 |
| 500 | nao | 45 | 17/28/1 | 37.8% | 25.1-52.4% | 0.3172 | null | -0.2391 |

## Respostas do checkpoint
```
{
 "A_dualVsV4": {
  "dual": 0.3333,
  "v4": 0.6,
  "deltaPp": -26.67,
  "verdict": "MEASURED"
 },
 "B_dualVsG2": {
  "dual": 0.3333,
  "g2": 0.4667,
  "deltaPp": -13.34,
  "verdict": "MEASURED"
 },
 "C_agreementVsA": {
  "agreementTrades": 11,
  "agreementOutcome": {
   "n": 11,
   "decided": 11,
   "wins": 5,
   "losses": 6,
   "draws": 0,
   "wr": 0.4545,
   "ci95": {
    "low": 0.2127,
    "high": 0.7199
   },
   "lowN": true
  },
  "aAlone": {
   "n": 27,
   "decided": 27,
   "wins": 8,
   "losses": 19,
   "draws": 0,
   "wr": 0.2963,
   "ci95": {
    "low": 0.1585,
    "high": 0.4848
   },
   "lowN": true
  },
  "deltaPp": 15.82,
  "verdict": "INSUFFICIENT"
 },
 "D_agreementVsB": {
  "agreementOutcome": {
   "n": 11,
   "decided": 11,
   "wins": 5,
   "losses": 6,
   "draws": 0,
   "wr": 0.4545,
   "ci95": {
    "low": 0.2127,
    "high": 0.7199
   },
   "lowN": true
  },
  "bAlone": {
   "n": 30,
   "decided": 30,
   "wins": 10,
   "losses": 20,
   "draws": 0,
   "wr": 0.3333,
   "ci95": {
    "low": 0.1923,
    "high": 0.5122
   },
   "lowN": false
  },
  "deltaPp": 12.12,
  "verdict": "INSUFFICIENT"
 },
 "E_bWaitProtectsA": {
  "cases": 14,
  "dualOutcome": {
   "n": 14,
   "decided": 14,
   "wins": 3,
   "losses": 11,
   "draws": 0,
   "wr": 0.2143,
   "ci95": {
    "low": 0.0757,
    "high": 0.4759
   },
   "lowN": true
  },
  "aAloneCounterfactual": {
   "n": 14,
   "decided": 14,
   "wins": 3,
   "losses": 11,
   "draws": 0,
   "wr": 0.2143,
   "ci95": {
    "low": 0.0757,
    "high": 0.4759
   },
   "lowN": true
  },
  "deltaPp": 0,
  "verdict": "INSUFFICIENT"
 },
 "F_crossExamValue": {
  "preCross": {
   "n": 30,
   "decided": 30,
   "wins": 10,
   "losses": 20,
   "draws": 0,
   "wr": 0.3333,
   "ci95": {
    "low": 0.1923,
    "high": 0.5122
   },
   "lowN": false
  },
  "actual": {
   "n": 30,
   "decided": 30,
   "wins": 10,
   "losses": 20,
   "draws": 0,
   "wr": 0.3333,
   "ci95": {
    "low": 0.1923,
    "high": 0.5122
   },
   "lowN": false
  },
  "deltaPp": 0,
  "transitions": null,
  "verdict": "MEASURED"
 },
 "G_round2Value": {
  "changedR1toR2": 80,
  "verdict": "MEASURED"
 },
 "H_finalRoundValue": {
  "changedR2toFinal": 109,
  "verdict": "MEASURED"
 },
 "I_survivalPredicts": {
  "groups": [
   {
    "survival": "BOTH_SURVIVE",
    "outcome": {
     "n": 28,
     "decided": 28,
     "wins": 9,
     "losses": 19,
     "draws": 0,
     "wr": 0.3214,
     "ci95": {
      "low": 0.1793,
      "high": 0.5066
     },
     "lowN": true
    }
   },
   {
    "survival": "ONLY_A_SURVIVES",
    "outcome": {
     "n": 2,
     "decided": 2,
     "wins": 1,
     "losses": 1,
     "draws": 0,
     "wr": 0.5,
     "ci95": {
      "low": 0.0945,
      "high": 0.9055
     },
     "lowN": true
    }
   }
  ],
  "verdict": "INSUFFICIENT"
 },
 "J_coverageCost": {
  "observations": 145,
  "trades": 30,
  "coverage": 0.2069
 },
 "note": "Respostas usam a mesma coorte; N insuficiente nao vira conclusao."
}
```
