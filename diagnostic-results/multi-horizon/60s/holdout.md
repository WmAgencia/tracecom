# EXP-60S

- Status: **COMPLETED**
- Provider: yahoo-forex; native resolution: 60s
- Reason: Closed-candle causal study completed; cross-asset correlation is not estimated.
- Mode: **SHADOW_ONLY**; no broker order capability is used.
- Raw N / effective N / within-pair uniqueness: 1000 / 1000 / 1.00
- Cross-pair dependence is not estimated; this is a stated limitation, not an independence claim.

| phase | N | win rate | net EV | PF | max DD | Brier | ECE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| adaptive | 800 | 0.38 | -0.00023273073230672706 | 0.009326646977635838 | 0.18618458584538164 | 0.2505246076549569 | 0.02465141623559497 |
| locked holdout | 200 | 0.24 | -0.0002489223219737921 | 0.014060649982262493 | 0.049784464394758414 | 0.21257906131083654 | 0.133047507122507 |
| all | 1000 | 0.352 | -0.00023596905024014005 | 0.010386272722146733 | 0.23596905024014006 | 0.24293549838613313 | 0.04633063441297758 |

## Locked holdout

Frozen before actionable trade 801; no subsequent strategy selection is allowed.

## Learning history

- after 100: mh-v2, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 200: mh-v3, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 300: mh-v4, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 400: mh-v5, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 500: mh-v6, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 600: mh-v7, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 700: mh-v8, BASELINE — prequential selection retained baseline: no alternative exceeded pre-registered support and net-EV gate
- after 800: mh-v8, BASELINE — LOCKED_HOLDOUT: features, threshold, expanding calibration snapshot and strategy frozen before trade 801.
