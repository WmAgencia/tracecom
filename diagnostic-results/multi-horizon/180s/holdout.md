# EXP-180S

- Status: **COMPLETED**
- Provider: yahoo-forex; native resolution: 60s
- Reason: Closed-candle causal study completed; cross-asset correlation is not estimated.
- Mode: **SHADOW_ONLY**; no broker order capability is used.
- Raw N / effective N / within-pair uniqueness: 1000 / 1000 / 1.00
- Cross-pair dependence is not estimated; this is a stated limitation, not an independence claim.

| phase | N | win rate | net EV | PF | max DD | Brier | ECE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| adaptive | 800 | 0.4325 | -0.00021814812353729312 | 0.09849245391946382 | 0.1745184988298345 | 0.256048926443678 | 0.01859106357116863 |
| locked holdout | 200 | 0.435 | -0.00022284440446718138 | 0.14560347908282756 | 0.044568880893436275 | 0.24599353852392278 | 0.008289982320391187 |
| all | 1000 | 0.433 | -0.00021908737972327092 | 0.10928276872545868 | 0.21908737972327091 | 0.25403784885972547 | 0.013214854392857633 |

## Locked holdout

Frozen before actionable trade 801; no subsequent strategy selection is allowed.

## Learning history

- after 100: mh-v2, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 200: mh-v3, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 300: mh-v4, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 400: mh-v5, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 500: mh-v6, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 500: mh-v7, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 500: mh-v8, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 500: mh-v9, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 500: mh-v10, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 500: mh-v11, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 500: mh-v12, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 500: mh-v13, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 500: mh-v14, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 500: mh-v15, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 500: mh-v16, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 500: mh-v17, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 500: mh-v18, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 500: mh-v19, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 500: mh-v20, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 500: mh-v21, LONDON_TREND — prequential selection: LONDON_TREND had n=56 and prior net mean=-0.000137
- after 600: mh-v22, LONDON_TREND — prequential selection: LONDON_TREND had n=154 and prior net mean=-0.000198
- after 700: mh-v23, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 800: mh-v23, BASELINE — LOCKED_HOLDOUT: features, threshold, expanding calibration snapshot and strategy frozen before trade 801.
