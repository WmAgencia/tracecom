# DUAL_REASONING_V1_SHADOW — relatorio observacional

- Gerado: 2026-09-19T13:45:01.239Z. Observacoes: 187; directional settled: 60; proximo checkpoint: 100.
- Experimento CONGELADO; relatorio nao altera regras. ZERO REAL.

## Mudancas de decisao (R1 -> FINAL)

- nada mudou: 37; so A: 39; so B: 45; ambos: 66
- R1->R2 mudou: 104; R2->FINAL mudou: 140
- causas: {"UNRESOLVED_CONFLICT":20,"STRUCTURE_CHANGE":35,"SCENARIO_CHANGE":16,"SHORT_IMPULSE_CHANGE":34,"THESIS_INVALIDATED":44,"UNKNOWN":1}

## Matriz A x B (FINAL) — outcome do Dual por celula
| A | B | N | trades | cobertura | W/L | WR | CI95 | A-sozinho (cf) | B-sozinho (cf) |
|---|---|---|---|---|---|---|---|---|---|
| BUY | BUY | 13 | 13 | 1 | 7/5 | 58.3% | 31.9-80.7% | 58.3% | 58.3% |
| BUY | SELL | 2 | 0 | 0 | 0/0 | - | - | 100.0% | 0.0% |
| BUY | WAIT | 15 | 9 | 0.6 | 3/6 | 33.3% | 12.1-64.6% | 33.3% | 40.0% |
| SELL | BUY | 1 | 0 | 0 | 0/0 | - | - | 0.0% | 100.0% |
| SELL | SELL | 18 | 18 | 1 | 7/7 | 50.0% | 26.8-73.2% | 50.0% | 50.0% |
| SELL | WAIT | 18 | 13 | 0.7222 | 5/8 | 38.5% | 17.7-64.5% | 35.3% | 43.8% |
| WAIT | BUY | 24 | 3 | 0.125 | 1/2 | 33.3% | 6.2-79.2% | 38.5% | 52.6% |
| WAIT | SELL | 22 | 10 | 0.4545 | 4/4 | 50.0% | 21.5-78.5% | 25.0% | 66.7% |
| WAIT | WAIT | 74 | 0 | 0 | 0/0 | - | - | 66.7% | 45.5% |

## Structural x Short horizon
| celula | N | trades | cobertura | W/L | WR | A-sozinho (cf) | B-sozinho (cf) |
|---|---|---|---|---|---|---|---|
| STRUCTURAL_BULLISH_SHORT_BULLISH | 35 | 24 | 0.6857 | 11/12 | 47.8% | 54.5% | 54.5% |
| STRUCTURAL_BULLISH_SHORT_BEARISH | 26 | 0 | 0 | 0/0 | - | 55.0% | 45.0% |
| STRUCTURAL_BEARISH_SHORT_BEARISH | 45 | 33 | 0.7333 | 12/17 | 41.4% | 43.6% | 43.6% |
| STRUCTURAL_BEARISH_SHORT_BULLISH | 28 | 0 | 0 | 0/0 | - | 41.7% | 58.3% |
| STRUCTURAL_BULLISH_SHORT_NEUTRAL | 3 | 0 | 0 | 0/0 | - | 50.0% | - |
| STRUCTURAL_BEARISH_SHORT_NEUTRAL | 7 | 1 | 0.1429 | 1/0 | 100.0% | 66.7% | - |

## Thesis survival
| categoria | N | trades | cobertura | W/L | WR | expectancy |
|---|---|---|---|---|---|---|
| BOTH_SURVIVE | 95 | 60 | 0.6316 | 25/30 | 45.5% | -0.0893 |
| ONLY_A_SURVIVES | 38 | 5 | 0.1316 | 1/2 | 33.3% | -0.3333 |
| ONLY_B_SURVIVES | 19 | 1 | 0.0526 | 1/0 | 100.0% | 1 |
| NEITHER_SURVIVES | 0 | 0 | null | 0/0 | - | - |
| CONFLICT_UNRESOLVED | 27 | 0 | 0 | 0/0 | - | - |

## Cross-examination (pre-cross vs real)

- transicoes: {"BUY->WAIT":11,"SELL->WAIT":14}
- pre-cross trades 91 WR 0.4744; real trades 66 WR 0.4576

## Rounds / persistencia

- tick/candle deltas: NOT_MEASURABLE (payload do Dual nao persiste contagem de ticks/candles por rodada; apenas snapshotId e availableAt)
- agreement persistence: [{"key":"ALWAYS_CONFLICTED","n":141,"wr":0.4194},{"key":"CONVERGED","n":30,"wr":0.52},{"key":"DIVERGED","n":15,"wr":0},{"key":"ALWAYS_AGREED","n":1,"wr":1}]
- A stability: [{"key":"STABLE","n":108,"wr":0.5},{"key":"ONE_CHANGE","n":79,"wr":0.3913}]
- B stability: [{"key":"ONE_CHANGE","n":105,"wr":0.4211},{"key":"STABLE","n":82,"wr":0.5238}]

## G2 vs V4 vs Dual (mesma coorte)

- Dual: trades 66 WR 0.4576 coverage 0.3529 break-even null expectancy -0.0833
- V4: trades 40 WR 0.55 coverage 0.2139
- G2: trades 162 WR 0.522 coverage 0.8663
- G2 x V4 discordantes: N=3

## ROLLING (NOT CHECKPOINT)

- directional settled: 60; WR 0.4576; coverage 0.3209 (checkpoints imutaveis abaixo)

## Contrafactual por rodada

- R1_ONLY: {"n":13,"decided":13,"wins":4,"losses":9,"draws":0,"wr":0.3077,"ci95":{"low":0.1268,"high":0.5763},"lowN":true}
- R2_ONLY: {"n":19,"decided":19,"wins":10,"losses":9,"draws":0,"wr":0.5263,"ci95":{"low":0.3171,"high":0.7267},"lowN":true}
- FINAL (real): {"n":60,"decided":59,"wins":27,"losses":32,"draws":1,"wr":0.4576,"ci95":{"low":0.337,"high":0.5834},"lowN":false,"note":"resultado real do Dual"}

## Overthinking (associacao, nao causalidade)

- {"r1_correct_final_wrong":0,"r1_wrong_final_correct":0,"r2_correct_final_wrong":1,"r2_wrong_final_correct":1,"r1_correct_final_correct":1,"r1_wrong_final_wrong":2,"note":"associacao observacional; nao e causalidade"}

## Market delta material (sidecar; historico NOT_MEASURABLE)

- changeWithMaterial {"n":0,"decided":0,"wins":0,"losses":0,"draws":0,"wr":null,"ci95":{"low":null,"high":null},"lowN":true}
- changeWithoutMaterial {"n":0,"decided":0,"wins":0,"losses":0,"draws":0,"wr":null,"ci95":{"low":null,"high":null},"lowN":true}
- notMeasurable 187

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
| 30 | sim | 30 | 10/20/0 | 33.3% | 19.2-51.2% | 0.1604 | null | -0.3333 |
| 60 | sim | 59 | 27/32/1 | 45.8% | 33.7-58.3% | 0.3209 | null | -0.0833 |
| 100 | nao | 59 | 27/32/1 | 45.8% | 33.7-58.3% | 0.3209 | null | -0.0833 |
| 200 | nao | 59 | 27/32/1 | 45.8% | 33.7-58.3% | 0.3209 | null | -0.0833 |
| 500 | nao | 59 | 27/32/1 | 45.8% | 33.7-58.3% | 0.3209 | null | -0.0833 |

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
  "changedR1toR2": 104,
  "verdict": "MEASURED"
 },
 "H_finalRoundValue": {
  "changedR2toFinal": 140,
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
  "observations": 187,
  "trades": 30,
  "coverage": 0.1604
 },
 "note": "Respostas usam a mesma coorte; N insuficiente nao vira conclusao."
}
```
