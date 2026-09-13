# Real USD/CAD dataset

`usdcad-1m-7d.json` is a point-in-time export of public Yahoo Finance Chart
API data for `USDCAD=X`, retrieved by `scripts/download-usdcad-real-dataset.mjs`.

- Instrument: USD/CAD spot reference rate
- Timeframe: 1 minute
- Timestamps: Unix milliseconds, UTC
- Exchange timezone reported by source: Europe/London (BST at retrieval)
- Fields: timestamp, open, high, low, close only
- Retrieved: see `retrievedAt` inside the JSON
- Source URL and validation metadata: included inside the JSON

The six timestamp gaps are retained in the validation metadata and correspond
to market-closed periods; no rows are forward-filled or generated. The file
contains no volume, spread, order-flow, labels, or synthetic candles. Any
backtest must segment at gaps and must derive outcomes only from later rows.
