# Auditoria causal V4 — v4-20260920-0439

- **Amostra real (DB):** 31 operacoes — 16W / 15L / 0D — WR **51.61%** — payout medio **83.43%** — PnL **-15.8**
- Observado pelo operador: 23 (11W/12L, 47,83%). DB tem 31 settlements reais (16W/15L); a contagem do operador era um snapshot parcial do momento.

## Classificacao causal (somente com dados ate entryAt; settlement revelado depois)

| # | ativo | dir | grade | razoes | RSI | spread | ADX slope | cushion | soft | resultado |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | AUDUSD:OTC | CALL | C | REJECTION_FAILED_SOFT | 54.8767 | 2.084 | 0.9837 | 1.0602 | 2 | LOSS |
| 2 | GBPCAD:OTC | CALL | C | REJECTION_FAILED_SOFT | 54.8854 | 5.1515 | -3.557 | 0.4208 | 2 | WIN |
| 3 | EURJPY:OTC | CALL | C | REJECTION_FAILED_SOFT | 49.2893 | -3.7739 | -1.799 | 0.3282 | 2 | WIN |
| 4 | GBPJPY:OTC | CALL | C | REJECTION_FAILED_SOFT | 51.4824 | 5.7209 | -2.2039 | 0.3305 | 2 | WIN |
| 5 | NZDCAD:OTC | PUT | C | REJECTION_FAILED_SOFT | 48.1454 | -1.4958 | -2.5009 | 0.3241 | 3 | LOSS |
| 6 | CADJPY:OTC | PUT | C | REJECTION_FAILED_SOFT | 45.7763 | -1.0783 | -4.9303 | 0.81 | 2 | WIN |
| 7 | GBPUSD:OTC | CALL | C | REJECTION_FAILED_SOFT | 54.856 | -0.8109 | -2.7491 | 0.3105 | 2 | WIN |
| 8 | EURAUD:OTC | PUT | C | REJECTION_FAILED_SOFT | 47.8251 | -4.547 | -3.8028 | 0.3891 | 2 | LOSS |
| 9 | GBPUSD:OTC | PUT | C | SEM_CONFIRMACAO_FORTE | null | undefined | undefined | null | 0 | LOSS |
| 10 | AUDJPY:OTC | CALL | C | REJECTION_FAILED_SOFT | 54.7254 | 1.1583 | -4.3553 | 1.138 | 2 | WIN |
| 11 | EURJPY:OTC | PUT | C | CUSHION_BAIXO(0.1229) | 54.8301 | 3.0586 | -2.052 | 0.1229 | 2 | LOSS |
| 12 | GBPCHF:OTC | PUT | C | REJECTION_FAILED_SOFT | 50.4806 | -0.023 | -5.6528 | 0.4249 | 3 | WIN |
| 13 | GBPUSD:OTC | PUT | C | REJECTION_FAILED_SOFT | 52.367 | 1.3783 | -1.6548 | 0.4433 | 2 | WIN |
| 14 | NZDCAD:OTC | CALL | C | REJECTION_FAILED_SOFT | 53.4137 | 10.2248 | -0.1358 | 0.7283 | 2 | LOSS |
| 15 | GBPAUD:OTC | PUT | C | REJECTION_FAILED_SOFT | 46.7213 | 1.6462 | -3.2775 | 0.7712 | 2 | WIN |
| 16 | USDZAR:OTC | CALL | C | REJECTION_FAILED_SOFT | 48.7499 | 3.2167 | -4.6486 | 0.5301 | 2 | WIN |
| 17 | EURCAD:OTC | CALL | C | REJECTION_FAILED_SOFT | 53.7091 | 3.7295 | -3.8885 | 1.0707 | 2 | LOSS |
| 18 | GBPJPY:OTC | CALL | C | REJECTION_FAILED_SOFT | 49.7336 | -0.2743 | -3.9201 | 1.2202 | 2 | LOSS |
| 19 | EURCAD:OTC | PUT | C | REJECTION_FAILED_SOFT | 48.8935 | -2.8364 | -7.0111 | 0.3392 | 2 | LOSS |
| 20 | USDMXN:OTC | PUT | C | REJECTION_FAILED_SOFT | 51.9695 | -1.3225 | -2.7245 | 0.6587 | 2 | WIN |
| 21 | CADCHF:OTC | CALL | C | SEM_CONFIRMACAO_FORTE | null | undefined | undefined | null | 0 | LOSS |
| 22 | CADCHF:OTC | CALL | C | SEM_CONFIRMACAO_FORTE | 52.7439 | 3.4618 | -3.1941 | 0.6084 | 2 | LOSS |
| 23 | AUDJPY:OTC | PUT | C | SEM_CONFIRMACAO_FORTE | null | undefined | undefined | null | 0 | LOSS |
| 24 | EURCHF:OTC | PUT | C | REJECTION_FAILED_SOFT | 45.6573 | -3.6047 | -4.053 | 1.2255 | 2 | WIN |
| 25 | CADJPY:OTC | CALL | C | CUSHION_BAIXO(0.2672) | 48.3569 | 3.4923 | -1.9552 | 0.2672 | 2 | LOSS |
| 26 | USDCAD:OTC | CALL | C | REJECTION_FAILED_SOFT | 51.1407 | 4.6648 | -3.0572 | 0.5777 | 2 | WIN |
| 27 | AUDUSD:OTC | PUT | C | REJECTION_FAILED_SOFT | 45.5032 | -7.0951 | -0.2315 | 0.8329 | 1 | LOSS |
| 28 | AUDJPY:OTC | PUT | C | REJECTION_FAILED_SOFT | 46.8725 | -3.6873 | -3.124 | 0.6312 | 2 | LOSS |
| 29 | NZDJPY:OTC | CALL | C | REJECTION_FAILED_SOFT | 53.6211 | 3.9132 | -3.5753 | 0.8893 | 2 | WIN |
| 30 | AUDCHF:OTC | PUT | C | REJECTION_FAILED_SOFT | 45.0245 | -5.2626 | -5.0059 | 1.1501 | 3 | WIN |
| 31 | USDZAR:OTC | PUT | C | CUSHION_BAIXO(0.1824) | 52.2778 | -2.1117 | -2.8228 | 0.1824 | 1 | WIN |

Grade: WIN {"C":16} | LOSS {"C":15}

## LOSS (15)
- **AUDUSD:OTC CALL** (-10) — tags: CURRENT_STATE_CONTRADICTION+THIN_ENTRY+EARLY_REVERSAL+OLD_TREND_STILL_TOO_STRONG
  - por que entrou: entryReason=REVERSAO_BOLLINGER_OK+DMI_ADX_OK | RSI 54.8767 | spread 2.084 | ADX slope 0.9837 | cushion 1.0602 | soft=ADX_FALLING_CONTEXT_ONLY+REJECTION_FAILED
  - o que aconteceu: settlement LOSS (-10) | quality null | actualCushion n/a | actualDisplacement n/a
- **NZDCAD:OTC PUT** (-10) — tags: CURRENT_STATE_CONTRADICTION+THIN_ENTRY
  - por que entrou: entryReason=REVERSAO_BOLLINGER_OK+DMI_ADX_OK | RSI 48.1454 | spread -1.4958 | ADX slope -2.5009 | cushion 0.3241 | soft=OPPOSITE_DI_ACCELERATING+ADX_FALLING_CONTEXT_ONLY+REJECTION_FAILED
  - o que aconteceu: settlement LOSS (-10) | quality null | actualCushion n/a | actualDisplacement n/a
- **EURAUD:OTC PUT** (-10) — tags: CURRENT_STATE_CONTRADICTION+THIN_ENTRY
  - por que entrou: entryReason=REVERSAO_BOLLINGER_OK+DMI_ADX_OK | RSI 47.8251 | spread -4.547 | ADX slope -3.8028 | cushion 0.3891 | soft=ADX_FALLING_CONTEXT_ONLY+REJECTION_FAILED
  - o que aconteceu: settlement LOSS (-10) | quality null | actualCushion n/a | actualDisplacement n/a
- **GBPUSD:OTC PUT** (-10) — tags: THIN_ENTRY
  - por que entrou: entryReason=n/a | RSI null | spread undefined | ADX slope undefined | cushion null | soft=nenhum
  - o que aconteceu: settlement LOSS (-10) | quality null | actualCushion n/a | actualDisplacement n/a
- **EURJPY:OTC PUT** (-10) — tags: CURRENT_STATE_CONTRADICTION+THIN_ENTRY+LATE_REVERSAL
  - por que entrou: entryReason=REVERSAO_BOLLINGER_OK+DMI_ADX_OK | RSI 54.8301 | spread 3.0586 | ADX slope -2.052 | cushion 0.1229 | soft=ADX_FALLING_CONTEXT_ONLY+REJECTION_FAILED
  - o que aconteceu: settlement LOSS (-10) | quality null | actualCushion n/a | actualDisplacement n/a
- **NZDCAD:OTC CALL** (-10) — tags: CURRENT_STATE_CONTRADICTION+THIN_ENTRY
  - por que entrou: entryReason=REVERSAO_BOLLINGER_OK+DMI_ADX_OK | RSI 53.4137 | spread 10.2248 | ADX slope -0.1358 | cushion 0.7283 | soft=ADX_FALLING_CONTEXT_ONLY+REJECTION_FAILED
  - o que aconteceu: settlement LOSS (-10) | quality null | actualCushion n/a | actualDisplacement n/a
- **EURCAD:OTC CALL** (-10) — tags: CURRENT_STATE_CONTRADICTION+THIN_ENTRY
  - por que entrou: entryReason=REVERSAO_BOLLINGER_OK+DMI_ADX_OK | RSI 53.7091 | spread 3.7295 | ADX slope -3.8885 | cushion 1.0707 | soft=ADX_FALLING_CONTEXT_ONLY+REJECTION_FAILED
  - o que aconteceu: settlement LOSS (-10) | quality null | actualCushion n/a | actualDisplacement n/a
- **GBPJPY:OTC CALL** (-10) — tags: CURRENT_STATE_CONTRADICTION+THIN_ENTRY+LATE_REVERSAL
  - por que entrou: entryReason=REVERSAO_BOLLINGER_OK+DMI_ADX_OK | RSI 49.7336 | spread -0.2743 | ADX slope -3.9201 | cushion 1.2202 | soft=ADX_FALLING_CONTEXT_ONLY+REJECTION_FAILED
  - o que aconteceu: settlement LOSS (-10) | quality null | actualCushion n/a | actualDisplacement n/a
- **EURCAD:OTC PUT** (-10) — tags: CURRENT_STATE_CONTRADICTION+THIN_ENTRY
  - por que entrou: entryReason=REVERSAO_BOLLINGER_OK+DMI_ADX_OK | RSI 48.8935 | spread -2.8364 | ADX slope -7.0111 | cushion 0.3392 | soft=ADX_FALLING_CONTEXT_ONLY+REJECTION_FAILED
  - o que aconteceu: settlement LOSS (-10) | quality null | actualCushion n/a | actualDisplacement n/a
- **CADCHF:OTC CALL** (-10) — tags: THIN_ENTRY
  - por que entrou: entryReason=n/a | RSI null | spread undefined | ADX slope undefined | cushion null | soft=nenhum
  - o que aconteceu: settlement LOSS (-10) | quality null | actualCushion n/a | actualDisplacement n/a
- **CADCHF:OTC CALL** (-10) — tags: CURRENT_STATE_CONTRADICTION+THIN_ENTRY+LATE_REVERSAL
  - por que entrou: entryReason=REVERSAO_BOLLINGER_OK+DMI_ADX_OK | RSI 52.7439 | spread 3.4618 | ADX slope -3.1941 | cushion 0.6084 | soft=OPPOSITE_DI_ACCELERATING+ADX_FALLING_CONTEXT_ONLY
  - o que aconteceu: settlement LOSS (-10) | quality null | actualCushion n/a | actualDisplacement n/a
- **AUDJPY:OTC PUT** (-10) — tags: THIN_ENTRY
  - por que entrou: entryReason=n/a | RSI null | spread undefined | ADX slope undefined | cushion null | soft=nenhum
  - o que aconteceu: settlement LOSS (-10) | quality null | actualCushion n/a | actualDisplacement n/a
- **CADJPY:OTC CALL** (-10) — tags: CURRENT_STATE_CONTRADICTION+THIN_ENTRY
  - por que entrou: entryReason=REVERSAO_BOLLINGER_OK+DMI_ADX_OK | RSI 48.3569 | spread 3.4923 | ADX slope -1.9552 | cushion 0.2672 | soft=ADX_FALLING_CONTEXT_ONLY+REJECTION_FAILED
  - o que aconteceu: settlement LOSS (-10) | quality null | actualCushion n/a | actualDisplacement n/a
- **AUDUSD:OTC PUT** (-10) — tags: CURRENT_STATE_CONTRADICTION+THIN_ENTRY+LATE_REVERSAL
  - por que entrou: entryReason=REVERSAO_BOLLINGER_OK+DMI_ADX_OK | RSI 45.5032 | spread -7.0951 | ADX slope -0.2315 | cushion 0.8329 | soft=REJECTION_FAILED
  - o que aconteceu: settlement LOSS (-10) | quality null | actualCushion n/a | actualDisplacement n/a
- **AUDJPY:OTC PUT** (-10) — tags: CURRENT_STATE_CONTRADICTION+THIN_ENTRY+LATE_REVERSAL
  - por que entrou: entryReason=REVERSAO_BOLLINGER_OK+DMI_ADX_OK | RSI 46.8725 | spread -3.6873 | ADX slope -3.124 | cushion 0.6312 | soft=ADX_FALLING_CONTEXT_ONLY+REJECTION_FAILED
  - o que aconteceu: settlement LOSS (-10) | quality null | actualCushion n/a | actualDisplacement n/a

## WIN (16)
- **GBPCAD:OTC CALL** (8.2) [THIN_WIN] — RSI 54.8854 | spread 5.1515 | cushion 0.4208
- **EURJPY:OTC CALL** (8.7) [THIN_WIN] — RSI 49.2893 | spread -3.7739 | cushion 0.3282
- **GBPJPY:OTC CALL** (8.7) [THIN_WIN] — RSI 51.4824 | spread 5.7209 | cushion 0.3305
- **CADJPY:OTC PUT** (8.2) [THIN_WIN] — RSI 45.7763 | spread -1.0783 | cushion 0.81
- **GBPUSD:OTC CALL** (8.7) [THIN_WIN] — RSI 54.856 | spread -0.8109 | cushion 0.3105
- **AUDJPY:OTC CALL** (8.2) [THIN_WIN] — RSI 54.7254 | spread 1.1583 | cushion 1.138
- **GBPCHF:OTC PUT** (8.2) [THIN_WIN] — RSI 50.4806 | spread -0.023 | cushion 0.4249
- **GBPUSD:OTC PUT** (8.7) [THIN_WIN] — RSI 52.367 | spread 1.3783 | cushion 0.4433
- **GBPAUD:OTC PUT** (8.2) [THIN_WIN] — RSI 46.7213 | spread 1.6462 | cushion 0.7712
- **USDZAR:OTC CALL** (8.7) [THIN_WIN] — RSI 48.7499 | spread 3.2167 | cushion 0.5301
- **USDMXN:OTC PUT** (8.2) [THIN_WIN] — RSI 51.9695 | spread -1.3225 | cushion 0.6587
- **EURCHF:OTC PUT** (8.2) [THIN_WIN] — RSI 45.6573 | spread -3.6047 | cushion 1.2255
- **USDCAD:OTC CALL** (8.2) [THIN_WIN] — RSI 51.1407 | spread 4.6648 | cushion 0.5777
- **NZDJPY:OTC CALL** (8.2) [THIN_WIN] — RSI 53.6211 | spread 3.9132 | cushion 0.8893
- **AUDCHF:OTC PUT** (8.2) [THIN_WIN] — RSI 45.0245 | spread -5.2626 | cushion 1.1501
- **USDZAR:OTC PUT** (8.7) [THIN_WIN] — RSI 52.2778 | spread -2.1117 | cushion 0.1824

## WIN vs LOSS (descritivo; sem otimizacao)
```json
{
 "rsi": 0.1554,
 "rsiCandidate": 0.86,
 "plusDI": -2.0211,
 "minusDI": -2.0654,
 "diSpread": 0.0443,
 "adx": 2.0028,
 "adxSlope": -0.9348,
 "position": 0.0991,
 "cushion": 0.0041,
 "velocity": 0.3129,
 "acceleration": 0.5593,
 "candidateAgeMs": 10458.7917,
 "evaluations": 2.0625,
 "soft": 0.4625,
 "hard": 0,
 "leadMs": 28.2083
}
```

## Timing (ACTIVE WATCH)
```json
{
 "trades": 31,
 "postCutoffSubmissions": 0,
 "finalEvaluationMissing": 0,
 "finalLeadMs": {
  "n": 28,
  "mean": 1239.5357,
  "min": 589,
  "max": 1787
 },
 "maxEvaluationGapMs": {
  "n": 28,
  "mean": 6056.4643,
  "max": 6596
 },
 "missedEventsInSession": 241,
 "schedulerAttributableLosses": 0
}
```

Nenhuma LOSS atribuivel ao scheduler: submissions pos-cutoff=0, LOSS atribuiveis=0.
