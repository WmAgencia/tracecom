# TraceCom Quant V2 Shadow

Quant V2 is an isolated, shadow-only research stack. It does not create orders,
change the operational signal, alter `settleTrade`, or change the T+60 target.

## Causal contract

Every feature snapshot is built from candles at or before its decision timestamp.
The T+60 label is `UP`, `DOWN`, or `DRAW` from the causal entry and settlement
prices. Similar-pattern lookup rejects the current event and every future event.
Walk-forward folds use a 60-second embargo because adjacent samples overlap the
target horizon. `UNKNOWN`, synthetic, and legacy incomplete provenance rows are
excluded from training unless explicitly retained as audit rows.

## Stack

- `src/quant-v2/feature-engine.ts`: versioned causal returns, momentum, geometry, volatility, trend, structure, and statistical features.
- `src/quant-v2/regime-engine.ts`: causal regime classification with evidence.
- `src/quant-v2/similar-pattern.ts`: KNN-style Euclidean/cosine neighbors with temporal exclusion.
- `src/quant-v2/models.ts`: deterministic baseline model; external sklearn/LightGBM/River workers remain offline extensions.
- `src/quant-v2/calibration.ts`: Platt/isotonic-compatible calibration contract and reliability metrics.
- `src/quant-v2/walk-forward.ts`: temporal folds with purge/embargo.
- `src/quant-v2/quant-fusion.ts`: supervised + neighborhood + regime components, explicit `NO_EDGE`, and versioned shadow output.
- `POST /api/quant/shadow`: evaluates a supplied causal candle sequence only; it has no operational side effect.

## Promotion

Every output is `SHADOW`, carries feature/model/calibration/regime/policy versions,
and is never promoted automatically. Promotion requires untouched holdout,
walk-forward validation, leakage tests, adequate sample size, calibration, and
stability across time and regimes.
