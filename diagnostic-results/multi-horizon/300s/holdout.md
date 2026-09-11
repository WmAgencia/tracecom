# EXP-300S

- Status: **COMPLETED**
- Provider: yahoo-forex; native resolution: 60s
- Reason: Closed-candle causal study completed; cross-asset correlation is not estimated.
- Mode: **SHADOW_ONLY**; no broker order capability is used.
- Raw N / effective N / within-pair uniqueness: 1000 / 1000 / 1.00
- Cross-pair dependence is not estimated; this is a stated limitation, not an independence claim.

| phase | N | win rate | net EV | PF | max DD | Brier | ECE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| adaptive | 800 | 0.4225 | -0.00022737322682500922 | 0.14314313602320022 | 0.18189858146000737 | 0.25574276601672635 | 0.0040126130235970114 |
| locked holdout | 200 | 0.43 | -0.00024586224271416226 | 0.12630088457004787 | 0.049172448542832446 | 0.24689293196971873 | 0.014615225178774394 |
| all | 1000 | 0.424 | -0.0002310710300028396 | 0.13945392809573384 | 0.2310710300028396 | 0.25397279920732574 | 0.00028704538312190886 |

## Locked holdout

Frozen before actionable trade 801; no subsequent strategy selection is allowed.

## Learning history

- after 100: mh-v2, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 200: mh-v3, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 300: mh-v4, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 400: mh-v5, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 500: mh-v6, LONDON_TREND — prequential selection: LONDON_TREND had n=62 and prior net mean=-0.000148
- after 500: mh-v7, LONDON_TREND — prequential selection: LONDON_TREND had n=63 and prior net mean=-0.000148
- after 500: mh-v8, LONDON_TREND — prequential selection: LONDON_TREND had n=63 and prior net mean=-0.000148
- after 500: mh-v9, LONDON_TREND — prequential selection: LONDON_TREND had n=63 and prior net mean=-0.000148
- after 600: mh-v10, LONDON_TREND — prequential selection: LONDON_TREND had n=158 and prior net mean=-0.000195
- after 700: mh-v11, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 800: mh-v11, BASELINE — LOCKED_HOLDOUT: features, threshold, expanding calibration snapshot and strategy frozen before trade 801.
