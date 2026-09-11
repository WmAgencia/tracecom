# EXP-120S

- Status: **COMPLETED**
- Provider: yahoo-forex; native resolution: 60s
- Reason: Closed-candle causal study completed; cross-asset correlation is not estimated.
- Mode: **SHADOW_ONLY**; no broker order capability is used.
- Raw N / effective N / within-pair uniqueness: 1000 / 1000 / 1.00
- Cross-pair dependence is not estimated; this is a stated limitation, not an independence claim.

| phase | N | win rate | net EV | PF | max DD | Brier | ECE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| adaptive | 800 | 0.42375 | -0.0002270943124215903 | 0.05582869361485723 | 0.18167544993727225 | 0.25624579455697083 | 0.002080543383480793 |
| locked holdout | 200 | 0.31 | -0.0002493483707303847 | 0.03525214679591779 | 0.04986967414607694 | 0.2336180133866418 | 0.12394567756350755 |
| all | 1000 | 0.401 | -0.00023154512408334908 | 0.05107959154466092 | 0.2315451240833491 | 0.25172023832290497 | 0.02312470080591711 |

## Locked holdout

Frozen before actionable trade 801; no subsequent strategy selection is allowed.

## Learning history

- after 100: mh-v2, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 200: mh-v3, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 300: mh-v4, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 400: mh-v5, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 500: mh-v6, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v7, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v8, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v9, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v10, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v11, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v12, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v13, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v14, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v15, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v16, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v17, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v18, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v19, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v20, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v21, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v22, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v23, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v24, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v25, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v26, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v27, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v28, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v29, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v30, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v31, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v32, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v33, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v34, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 500: mh-v35, LONDON_TREND — prequential selection: LONDON_TREND had n=61 and prior net mean=-0.000190
- after 600: mh-v36, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 700: mh-v37, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 800: mh-v37, BASELINE — LOCKED_HOLDOUT: features, threshold, expanding calibration snapshot and strategy frozen before trade 801.
