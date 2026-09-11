# EXP-30S

- Status: **PROVIDER_LIMITATION**
- Provider: yahoo-forex; native resolution: 60s
- Reason: Provider yahoo-forex native resolution is 60s; it cannot certify 30s outcomes without interpolation.
- Mode: **SHADOW_ONLY**; no broker order capability is used.
- Raw N / effective N / within-pair uniqueness: 0 / 0 / 0.00
- Cross-pair dependence is not estimated; this is a stated limitation, not an independence claim.

| phase | N | win rate | net EV | PF | max DD | Brier | ECE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| adaptive | 0 | — | — | — | 0 | — | — |
| locked holdout | 0 | — | — | — | 0 | — | — |
| all | 0 | — | — | — | 0 | — | — |

## Locked holdout

Not reached; no claim of final OOS holdout is made.

## Learning history

- No adaptation occurred.
