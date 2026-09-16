# MULTI-HORIZON RESEARCH (1/2/3/5 min) — RELATORIO (DISCOVERY)

> 10h oficiais (07:01-17:01Z 15/09) · BINARY e OTC separados · K=71 hipoteses congeladas · settlement exato 12/24/36/60 candles.
> **Nada aqui e validado** — 10h conhecidas = DISCOVERY. Filtro >=70% aplicado com bins; n<50 = SAMPLE TOO SMALL.

## >=70% (10)
- vol_high_follow | OTC | T+60s | n=12 (12 sinais, 1.2/h) | WR=91.67% | BUY 0% SELL 100% | indep 1/100% | SAMPLE TOO SMALL
- vol_high_follow | OTC | T+120s | n=12 (12 sinais, 1.2/h) | WR=91.67% | BUY 0% SELL 100% | indep 1/100% | SAMPLE TOO SMALL
- vol_high_follow | OTC | T+180s | n=12 (12 sinais, 1.2/h) | WR=91.67% | BUY 0% SELL 100% | indep 1/100% | SAMPLE TOO SMALL
- mi_burst_follow | OTC | T+60s | n=10 (10 sinais, 1/h) | WR=80% | BUY 0% SELL 100% | indep 1/100% | SAMPLE TOO SMALL
- mi_burst_follow | OTC | T+120s | n=10 (10 sinais, 1/h) | WR=80% | BUY 0% SELL 100% | indep 1/100% | SAMPLE TOO SMALL
- mi_burst_follow | OTC | T+180s | n=10 (10 sinais, 1/h) | WR=80% | BUY 0% SELL 100% | indep 1/100% | SAMPLE TOO SMALL
- prod_V6 | OTC | T+60s | n=3 (3 sinais, 0.3/h) | WR=100% | BUY 100% SELL null% | indep 0/null% | SAMPLE TOO SMALL
- prod_V6 | OTC | T+120s | n=3 (3 sinais, 0.3/h) | WR=100% | BUY 100% SELL null% | indep 0/null% | SAMPLE TOO SMALL
- prod_V6 | OTC | T+180s | n=3 (3 sinais, 0.3/h) | WR=100% | BUY 100% SELL null% | indep 0/null% | SAMPLE TOO SMALL
- prod_V6 | OTC | T+300s | n=3 (3 sinais, 0.3/h) | WR=100% | BUY 100% SELL null% | indep 0/null% | SAMPLE TOO SMALL

## BINARY — melhores por horizonte
### T+60s
- TOP WR: prod_V1 61.97% n=142 (14.3/h, indep 18/72.22%, edge 10.04pp) | streak_follow_5 58.41% n=113 (11.4/h, indep 11/63.64%, edge 8.11pp) | prod_V7-Relaxado 55.78% n=294 (29.6/h, indep 33/63.64%, edge 5.33pp) | z120_rev_2 54.67% n=878 (88.3/h, indep 70/52.86%, edge 4.7pp) | streak_follow_4 54.55% n=286 (28.8/h, indep 22/68.18%, edge 4.59pp)
- TOP BUY: prod_V1 67.24% n=116 | prod_V7-Relaxado 64.5% n=169 | prod_V8 63.56% n=118
- TOP SELL: streak_follow_5 56.86% n=51 | bb_fast_rev 54.09% n=440 | z120_rev_2 53.5% n=443
### T+120s
- TOP WR: tl_break 56.82% n=718 (72.2/h, indep 29/51.72%, edge 8.1pp) | failed_cont_dn 55.43% n=359 (36.1/h, indep 10/80%, edge 1.15pp) | z120_rev_2 54.26% n=881 (88.6/h, indep 34/58.82%, edge 4.32pp) | hurst_mr 54.06% n=973 (97.8/h, indep 38/60.53%, edge 4.57pp) | expansion_follow 52.7% n=222 (22.3/h, indep 11/36.36%, edge 3.55pp)
- TOP BUY: z120_rev_2 62.44% n=434 | micro_rev_at_extreme 59.3% n=457 | fast_z30_rev 59.1% n=467
- TOP SELL: tl_break 56.87% n=466 | hurst_mr 51.47% n=544 | expansion_follow 51.13% n=133
### T+180s
- TOP WR: failed_cont_dn 61.16% n=363 (36.5/h, indep 9/88.89%, edge 7.99pp) | z120_rev_2 57.85% n=892 (89.7/h, indep 30/43.33%, edge 7.91pp) | er_chop_rev 56.61% n=1710 (171.9/h, indep 52/53.85%, edge 6.83pp) | hurst_mr 55.99% n=993 (99.8/h, indep 29/48.28%, edge 6.36pp) | vol_low_rev 55.89% n=2183 (219.5/h, indep 69/53.62%, edge 6.11pp)
- TOP BUY: z120_rev_2 66.59% n=437 | micro_rev_at_extreme 62.93% n=464 | fast_z30_rev 62.45% n=474
- TOP SELL: er_chop_rev 56.83% n=915 | hurst_mr 56.22% n=555 | vol_low_rev 55.18% n=1167
### T+300s
- TOP WR: z120_rev_2 63.6% n=890 (89.5/h, indep 16/81.25%, edge 13.67pp) | adx_chop_rev 62.08% n=501 (50.4/h, indep 9/66.67%, edge 12.99pp) | hurst_mr 61.63% n=993 (99.8/h, indep 17/64.71%, edge 12.13pp) | breakout_against_macro 60.24% n=83 (8.3/h, indep 1/100%, edge 10.63pp) | failed_cont_dn 59.78% n=363 (36.5/h, indep 4/75%, edge 5.15pp)
- TOP BUY: z120_rev_2 73.29% n=438 | wick_rej 69.89% n=93 | tl_break 68.16% n=245
- TOP SELL: expansion_follow 60.74% n=135 | adx_chop_rev 60% n=300 | breakout_against_macro 60% n=45

## OTC — melhores por horizonte
### T+60s
- TOP WR: fb25_rev 55.47% n=1473 (148.1/h, indep 121/49.59%, edge 5.44pp) | failed_cont_up 54.83% n=383 (38.5/h, indep 30/50%, edge 3.7pp) | tl_break 54.21% n=961 (96.6/h, indep 85/56.47%, edge 4.29pp) | prod_V8 54.07% n=135 (13.6/h, indep 11/54.55%, edge 4.17pp) | streak_fade_5 53.89% n=334 (33.6/h, indep 25/40%, edge 3.82pp)
- TOP BUY: tl_break 60.94% n=512 | breakout_against_macro 57.14% n=42 | streak_fade_5 55.13% n=156
- TOP SELL: prod_V3 66.67% n=30 | z120_rev_2 61.96% n=418 | prod_V7-Relaxado 60.94% n=64
### T+120s
- TOP WR: prod_V3 59.43% n=212 (21.3/h, indep 12/41.67%, edge 8.57pp) | prod_V1 58.59% n=99 (10/h, indep 8/50%, edge 7.61pp) | tl_break 58.15% n=982 (98.7/h, indep 41/63.41%, edge 8.05pp) | fb25_rev 56.83% n=1471 (147.9/h, indep 55/54.55%, edge 6.85pp) | er_trend 55.37% n=121 (12.2/h, indep 8/50%, edge 5.7pp)
- TOP BUY: tl_break 64.72% n=530 | breakout_against_macro 60.53% n=38 | fb25_rev 59.42% n=722
- TOP SELL: prod_V3 65.52% n=29 | z120_rev_2 60.62% n=419 | micro_rev_at_extreme 58.33% n=468
### T+180s
- TOP WR: er_trend 59.5% n=121 (12.2/h, indep 4/75%, edge 9.46pp) | tl_break 59.07% n=992 (99.7/h, indep 29/62.07%, edge 9.09pp) | streak_fade_5 58.41% n=327 (32.9/h, indep 9/44.44%, edge 8.4pp) | streak_fade_4 55.87% n=716 (72/h, indep 18/55.56%, edge 5.87pp) | prod_V3 55.19% n=212 (21.3/h, indep 7/28.57%, edge 5.33pp)
- TOP BUY: er_trend 82.98% n=47 | streak_fade_5 60.26% n=156 | tl_break 60.19% n=540
- TOP SELL: hurst_mr 60.21% n=387 | prod_V8 59.32% n=59 | prod_V7-Relaxado 59.02% n=61
### T+300s
- TOP WR: streak_fade_5 58.91% n=331 (33.3/h, indep 5/80%, edge 8.89pp) | tl_break 58.06% n=1018 (102.4/h, indep 20/55%, edge 8.1pp) | fb25_rev 56.15% n=1446 (145.4/h, indep 23/73.91%, edge 6.14pp) | streak_fade_4 55.09% n=717 (72.1/h, indep 11/63.64%, edge 5.09pp) | keltner_rev 54.62% n=1688 (169.7/h, indep 30/60%, edge 4.63pp)
- TOP BUY: er_trend 72.34% n=47 | streak_fade_5 61.78% n=157 | fb25_rev 60.94% n=699
- TOP SELL: tl_break 67.33% n=453 | streak_fade_5 56.32% n=174 | sess_mom 55.76% n=2423

## MATRIZ MOMENTUM (past x future) — continuacao WR
```
{
 "BINARY": {
  "past_15s": {
   "60": {
    "cont_wr": 49.14,
    "n": 6050,
    "lowvol": 49.14,
    "nLo": 6050,
    "highvol": null,
    "nHi": 0
   },
   "120": {
    "cont_wr": 49.23,
    "n": 6110,
    "lowvol": 49.23,
    "nLo": 6110,
    "highvol": null,
    "nHi": 0
   },
   "180": {
    "cont_wr": 48.65,
    "n": 6163,
    "lowvol": 48.65,
    "nLo": 6163,
    "highvol": null,
    "nHi": 0
   },
   "300": {
    "cont_wr": 48.78,
    "n": 6152,
    "lowvol": 48.78,
    "nLo": 6152,
    "highvol": null,
    "nHi": 0
   }
  },
  "past_30s": {
   "60": {
    "cont_wr": 48.92,
    "n": 6372,
    "lowvol": 48.92,
    "nLo": 6372,
    "highvol": null,
    "nHi": 0
   },
   "120": {
    "cont_wr": 49.46,
    "n": 6445,
    "lowvol": 49.46,
    "nLo": 6445,
    "highvol": null,
    "nHi": 0
   },
   "180": {
    "cont_wr": 47.91,
    "n": 6496,
    "lowvol": 47.91,
    "nLo": 6496,
    "highvol": null,
    "nHi": 0
   },
   "300": {
    "cont_wr": 48.91,
    "n": 6498,
    "lowvol": 48.91,
    "nLo": 6498,
    "highvol": null,
    "nHi": 0
   }
  },
  "past_45s": {
   "60": {
    "cont_wr": 48.71,
    "n": 6510,
    "lowvol": 48.71,
    "nLo": 6510,
    "highvol": null,
    "nHi": 0
   },
   "120": {
    "cont_wr": 50.13,
    "n": 6587,
    "lowvol": 50.13,
    "nLo": 6587,
    "highvol": null,
    "nHi": 0
   },
   "180": {
    "cont_wr": 47.64,
    "n": 6639,
    "lowvol": 47.64,
    "nLo": 6639,
    "highvol": null,
    "nHi": 0
   },
   "300": {
    "cont_wr": 48.22,
    "n": 6638,
    "lowvol": 48.22,
    "nLo": 6638,
    "highvol": null,
    "nHi": 0
   }
  },
  "past_60s": {
   "60": {
    "cont_wr": 48.37,
    "n": 6579,
    "lowvol": 48.37,
    "nLo": 6579,
    "highvol": null,
    "nHi": 0
   },
   "120": {
    "cont_wr": 49.81,
    "n": 6651,
    "lowvol": 49.81,
    "nLo": 6651,
    "highvol": null,
    "nHi": 0
   },
   "180": {
    "cont_wr": 47.51,
    "n": 6702,
    "lowvol": 47.51,
    "nLo": 6702,
    "highvol": null,
    "nHi": 0
   },
   "300": {
    "cont_wr": 47.41,
    "n": 6697,
    "lowvol": 47.41,
    "nLo": 6697,
    "highvol": null,
    "nHi": 0
   }
  },
  "past_90s": {
   "60": {
    "cont_wr": 49.71,
    "n": 6667,
    "lowvol": 49.71,
    "nLo": 6667,
    "highvol": null,
    "nHi": 0
   },
   "120": {
    "cont_wr": 48.69,
    "n": 6741,
    "lowvol": 48.69,
    "nLo": 6741,
    "highvol": null,
    "nHi": 0
   },
   "180": {
    "cont_wr": 48.34,
    "n": 6791,
    "lowvol": 48.34,
    "nLo": 6791,
    "highvol": null,
    "nHi": 0
   },
   "300": {
    "cont_wr": 46.74,
    "n": 6789,
    "lowvol": 46.74,
    "nLo": 6789,
    "highvol": null,
    "nHi": 0
   }
  },
  "past_120s": {
   "60": {
    "cont_wr": 50.53,
    "n": 6660,
    "lowvol": 50.53,
    "nLo": 6660,
    "highvol": null,
    "nHi": 0
   },
   "120": {
    "cont_wr": 49.12,
    "n": 6747,
    "lowvol": 49.12,
    "nLo": 6747,
    "highvol": null,
    "nHi": 0
   },
   "180": {
    "cont_wr": 48.33,
    "n": 6786,
    "lowvol": 48.33,
    "nLo": 6786,
    "highvol": null,
    "nHi": 0
   },
   "300": {
    "cont_wr": 46.33,
    "n": 6788,
    "lowvol": 46.33,
    "nLo": 6788,
    "highvol": null,
    "nHi": 0
   }
  },
  "past_180s": {
   "60": {
    "cont_wr": 48.04,
    "n": 6718,
    "lowvol": 48.04,
    "nLo": 6718,
    "highvol": null,
    "nHi": 0
   },
   "120": {
    "cont_wr": 49.28,
    "n": 6802,
    "lowvol": 49.28,
    "nLo": 6802,
    "highvol": null,
    "nHi": 0
   },
   "180": {
    "cont_wr": 47.25,
    "n": 6851,
    "lowvol": 47.25,
    "nLo": 6851,
    "highvol": null,
    "nHi": 0
   },
   "300": {
    "cont_wr": 43.87,
    "n": 6852,
    "lowvol": 43.87,
    "nLo": 6852,
    "highvol": null,
    "nHi": 0
   }
  },
  "past_300s": {
   "60": {
    "cont_wr": 47.89,
    "n": 6721,
    "lowvol": 47.89,
    "nLo": 6721,
    "highvol": null,
    "nHi": 0
   },
   "120": {
    "cont_wr": 46.96,
    "n": 6808,
    "lowvol": 46.96,
    "nLo": 6808,
    "highvol": null,
    "nHi": 0
   },
   "180": {
    "cont_wr
```