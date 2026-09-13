# USD/CAD paper replay

- Run ID: `RUN_USDCAD_SETTLEMENT_V2_20260913`
- Mode: **SHADOW_PAPER_REPLAY**
- Source: `data\real\usdcad-1m-8d.json`
- Settlement: `src/training/settlement.ts#settleTrade`
- Temporal validity: **VALID_BUCKET_ALIGNED**
- Training eligible: **NO**
- No broker orders were sent.

| phase | target | n | wins | losses | draws | WR excluding draws | first | last |
|---|---:|---:|---:|---:|---:|---:|---|---|
| A | 300 | 300 | 116 | 162 | 22 | 41.73% | 2026-09-01T23:22:00.000Z | 2026-09-04T07:59:00.000Z |
| B | 300 | 300 | 109 | 165 | 26 | 39.78% | 2026-09-04T08:10:00.000Z | 2026-09-08T17:29:00.000Z |
| C | 300 | 300 | 108 | 174 | 18 | 38.30% | 2026-09-08T17:39:00.000Z | 2026-09-11T03:09:00.000Z |
| D | 100 | 100 | 39 | 54 | 7 | 41.94% | 2026-09-11T03:19:00.000Z | 2026-09-11T21:22:00.000Z |
