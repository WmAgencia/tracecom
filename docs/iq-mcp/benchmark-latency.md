# IQ Official MCP — latency + timing benchmark (all 7 servers)

Generated: 2026-09-18T03:06:47.146Z · finished: 2026-09-18T03:20:45.568Z · node v24.19.0 (win32-x64)

Read-only benchmark: **practice only, zero orders**. Token from `IQ_MCP_TOKEN`, never persisted; all
artifacts redacted. Every `tools/call` passed `assertReadProbeMethod` (write/unknown tools throw).

N: cold handshake 5 · tools/list 5 · each read tool 5 · session-overhead 2 · burst 12 reads/150 ms spacing · concurrency 4×3 rounds on `binary-options`.

Pacing: minimum **1500 ms between ANY call** (~≤ 41 calls in ANY 60 s window, independent of fixed-window alignment) plus a rolling 36-call cap. Conservative on purpose: the server may count control methods (`initialize`, `tools/list`) in the read bucket, and the documented limits are per-user and shared across tokens/servers (gateway 200/60 s, read 60/60 s, write 10/60 s). The burst window is drained below 10 calls first. If the server answers `rate_limited`, the call waits `retry_after_ms` (≤ 90000 ms) and retries at most 2 times (burst/concurrency never retry).

Percentiles are nearest-rank; with N=5 the p95 equals the max by construction. Payload bytes = UTF-8 bytes of the extracted tool payload (JSON body of the MCP content part). Each measured call is fresh (no adapter cache).

Incumbent TraceCom (reference, **not** re-measured here): WS ACK p50 **177 ms**; clock drift p50 **−473 ms** (range −1327 … +272 ms).

Note: the earlier read probe (`docs/iq-mcp/current-vs-mcp.md`) reported `get_capabilities`/`list_assets` at ~600 ms;
this run measured ~215 ms / 500–740 ms from the same workstation. Treat absolute latencies as vantage- and time-dependent;
the relative ranking is the stable signal.

## 1–6. Per-server results

### turbo-options

- endpoint: `https://turbo-options.mcp.iqoption.com` · read allowlist: `get_capabilities`, `get_limits`, `list_assets`, `list_balances`, `list_positions`, `get_trade_history`, `get_candles`
- cold handshake (protocol, pacing excluded): 915.3, 651.1, 431.2, 434.9, 423.5 ms → p50 **434.9 ms**, p95 915.3 ms, mean 571.2 ms (wall incl. pacing p50 3017.1 ms)
- warm `tools/list`: 216, 226.9, 217.6, 214.4, 216.7 ms → p50 **216.7 ms** · tools reported: 10
- derived context: `{"assetId":76,"candleAssetId":76,"balanceId":1250741747,"currency":"USD","minLots":null,"openAssets":125}`

| tool | args | ok/N | p50 ms | p95 ms | min | max | mean | payload bytes (p50) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `get_capabilities` | `{}` | 5/5 | 211.6 | 240.6 | 210.1 | 240.6 | 219.5 | 47 |
| `get_limits` | `{}` | 5/5 | 214.9 | 2872.1 | 199.9 | 2872.1 | 744.5 | 456 |
| `list_assets` | `{}` | 5/5 | 512.8 | 519.9 | 502.6 | 519.9 | 512.1 | 21129 |
| `list_balances` | `{}` | 5/5 | 216.2 | 634.8 | 203.4 | 634.8 | 297.9 | 192 |
| `list_positions` | `{"balance_id":1250741747}` | 5/5 | 344.6 | 379.6 | 311.7 | 379.6 | 340.9 | 16 |
| `get_trade_history` | `{}` | 5/5 | 371.4 | 389.2 | 341.1 | 389.2 | 369.3 | 14 |
| `get_candles` | `{"asset_id":76,"size":60,"count":100}` | 5/5 | 237.7 | 245.2 | 230.1 | 245.2 | 238 | 12313 |

- session reuse: warm `get_capabilities` mean **218.7 ms** (n=2) vs fresh initialize+initialized+call mean **664.3 ms** (n=2, pacing waits excluded; raw total 4532.8 ms, call-only 219 ms) → saving **445.6 ms/call**.

- burst/429: not tested on this server — burst runs only on `binary-options`; live rate-limit observations are in section 5

- concurrency: not tested on this server (runs only on `binary-options`)

### blitz-options

- endpoint: `https://blitz-options.mcp.iqoption.com` · read allowlist: `get_capabilities`, `get_limits`, `list_assets`, `list_balances`, `list_positions`, `get_trade_history`, `get_candles`
- cold handshake (protocol, pacing excluded): 844.7, 630.5, 422.7, 572.8, 432.6 ms → p50 **572.8 ms**, p95 844.7 ms, mean 580.7 ms (wall incl. pacing p50 2878.5 ms)
- warm `tools/list`: 214.8, 222.6, 209.3, 223.2, 223.5 ms → p50 **222.6 ms** · tools reported: 10
- derived context: `{"assetId":76,"candleAssetId":76,"balanceId":1250741747,"currency":"USD","minLots":null,"openAssets":129}`

| tool | args | ok/N | p50 ms | p95 ms | min | max | mean | payload bytes (p50) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `get_capabilities` | `{}` | 5/5 | 220.1 | 315.8 | 217.2 | 315.8 | 246 | 47 |
| `get_limits` | `{}` | 5/5 | 226.1 | 258.2 | 218.8 | 258.2 | 234.1 | 456 |
| `list_assets` | `{}` | 5/5 | 556.2 | 585.8 | 527.8 | 585.8 | 555.3 | 18066 |
| `list_balances` | `{}` | 5/5 | 225.9 | 625.8 | 222.7 | 625.8 | 305.6 | 192 |
| `list_positions` | `{"balance_id":1250741747}` | 5/5 | 360.3 | 370.2 | 346 | 370.2 | 359.1 | 16 |
| `get_trade_history` | `{}` | 5/5 | 379.5 | 463.9 | 365.7 | 463.9 | 394.4 | 14 |
| `get_candles` | `{"asset_id":76,"size":60,"count":100}` | 5/5 | 234.7 | 418.5 | 223.3 | 418.5 | 272.7 | 12313 |

- session reuse: warm `get_capabilities` mean **213.3 ms** (n=2) vs fresh initialize+initialized+call mean **652.2 ms** (n=2, pacing waits excluded; raw total 4540 ms, call-only 224.6 ms) → saving **438.9 ms/call**.

- burst/429: not tested on this server — burst runs only on `binary-options`; live rate-limit observations are in section 5

- concurrency: not tested on this server (runs only on `binary-options`)

### digital-options

- endpoint: `https://digital-options.mcp.iqoption.com` · read allowlist: `get_capabilities`, `get_limits`, `list_assets`, `list_balances`, `list_positions`, `get_trade_history`, `get_candles`, `get_instruments`, `get_prices`
- cold handshake (protocol, pacing excluded): 912.1, 462.4, 415.6, 453.6, 427.4 ms → p50 **453.6 ms**, p95 912.1 ms, mean 534.2 ms (wall incl. pacing p50 3001.5 ms)
- warm `tools/list`: 214.7, 223.1, 224.5, 217.2, 221.8 ms → p50 **221.8 ms** · tools reported: 11
- derived context: `{"assetId":76,"candleAssetId":76,"balanceId":1250741747,"currency":"USD","minLots":null,"openAssets":130}`

| tool | args | ok/N | p50 ms | p95 ms | min | max | mean | payload bytes (p50) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `get_capabilities` | `{}` | 5/5 | 214.1 | 218.1 | 201.7 | 218.1 | 213.1 | 49 |
| `get_limits` | `{}` | 5/5 | 212.4 | 264.1 | 212 | 264.1 | 222.8 | 475 |
| `list_assets` | `{}` | 5/5 | 554 | 576.4 | 541.7 | 576.4 | 557 | 22018 |
| `list_balances` | `{}` | 5/5 | 222.3 | 623.5 | 218 | 623.5 | 301.7 | 192 |
| `list_positions` | `{}` | 5/5 | 388 | 404.3 | 373 | 404.3 | 386.6 | 16 |
| `get_trade_history` | `{}` | 5/5 | 415.4 | 470.4 | 400.5 | 470.4 | 422.3 | 14 |
| `get_instruments` | `{"asset_id":76}` | 5/5 | 390 | 410.7 | 354.7 | 410.7 | 387.7 | 10461 |
| `get_prices` | `{"asset_id":76}` | 5/5 | 369.8 | 814 | 365.5 | 814 | 457.6 | 9083 |
| `get_candles` | `{"asset_id":76,"size":60,"count":100}` | 5/5 | 402.6 | 563 | 362.8 | 563 | 430.1 | 12313 |

- session reuse: warm `get_capabilities` mean **212.9 ms** (n=2) vs fresh initialize+initialized+call mean **643.1 ms** (n=2, pacing waits excluded; raw total 4514.5 ms, call-only 214.5 ms) → saving **430.2 ms/call**.

- burst/429: not tested on this server — burst runs only on `binary-options`; live rate-limit observations are in section 5

- concurrency: not tested on this server (runs only on `binary-options`)

### marginal-cfd

- endpoint: `https://marginal-cfd.mcp.iqoption.com` · read allowlist: `get_capabilities`, `get_limits`, `list_assets`, `list_balances`, `list_positions`, `get_trade_history`, `get_candles`, `get_orders`, `get_instruments`, `calculate_order_size`
- cold handshake (protocol, pacing excluded): 856.7, 422.1, 427.4, 453.6, 433 ms → p50 **433 ms**, p95 856.7 ms, mean 518.6 ms (wall incl. pacing p50 3019.7 ms)
- warm `tools/list`: 409, 407.6, 410.7, 416.8, 410.6 ms → p50 **410.6 ms** · tools reported: 17
- derived context: `{"assetId":74,"candleAssetId":74,"balanceId":1250741747,"currency":"USD","minLots":1,"openAssets":82}`

| tool | args | ok/N | p50 ms | p95 ms | min | max | mean | payload bytes (p50) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `get_capabilities` | `{}` | 5/5 | 212.5 | 228.6 | 212.3 | 228.6 | 216.5 | 46 |
| `get_limits` | `{}` | 5/5 | 215.5 | 217.8 | 213.2 | 217.8 | 215.2 | 670 |
| `list_assets` | `{}` | 5/5 | 738.5 | 765 | 700.7 | 765 | 735.1 | 23681 |
| `list_balances` | `{"types":"ALL"}` | 5/5 | 228.6 | 614.4 | 224.2 | 614.4 | 304.8 | 659 |
| `list_positions` | `{"balance_id":1250741747}` | 5/5 | 234.8 | 246.7 | 218.7 | 246.7 | 235.8 | 16 |
| `get_trade_history` | `{"balance_id":1250741747}` | 5/5 | 248.4 | 280.2 | 243.2 | 280.2 | 256.1 | 14 |
| `get_orders` | `{"balance_id":1250741747}` | 5/5 | 217.2 | 223.1 | 203 | 223.1 | 216.1 | 13 |
| `get_instruments` | `{"asset_id":74}` | 5/5 | 221.6 | 241.2 | 218 | 241.2 | 226 | 690 |
| `calculate_order_size` | `{"asset_id":74,"balance_currency":"USD","leverage":1,"lots":1}` | 5/5 | 534.5 | 699.4 | 522 | 699.4 | 578.1 | 112 |
| `get_candles` | `{"asset_id":74,"size":60,"count":100}` | 5/5 | 232.7 | 239 | 227.7 | 239 | 232.4 | 12067 |

- session reuse: warm `get_capabilities` mean **211.7 ms** (n=2) vs fresh initialize+initialized+call mean **843 ms** (n=2, pacing waits excluded; raw total 7582.3 ms, call-only 413.3 ms) → saving **631.3 ms/call**.

- burst/429: not tested on this server — burst runs only on `binary-options`; live rate-limit observations are in section 5

- concurrency: not tested on this server (runs only on `binary-options`)

### marginal-crypto

- endpoint: `https://marginal-crypto.mcp.iqoption.com` · read allowlist: `get_capabilities`, `get_limits`, `list_assets`, `list_balances`, `list_positions`, `get_trade_history`, `get_candles`, `get_orders`, `get_instruments`, `calculate_order_size`
- cold handshake (protocol, pacing excluded): 874.4, 439.1, 515.6, 441.2, 427.7 ms → p50 **441.2 ms**, p95 874.4 ms, mean 539.6 ms (wall incl. pacing p50 3004.9 ms)
- warm `tools/list`: 426.6, 423.2, 423.9, 422.7, 426.2 ms → p50 **423.9 ms** · tools reported: 17
- derived context: `{"assetId":816,"candleAssetId":816,"balanceId":1250741747,"currency":"USD","minLots":0.001,"openAssets":80}`

| tool | args | ok/N | p50 ms | p95 ms | min | max | mean | payload bytes (p50) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `get_capabilities` | `{}` | 5/5 | 220.2 | 225 | 204.8 | 225 | 218.3 | 49 |
| `get_limits` | `{}` | 5/5 | 230.7 | 235.6 | 219.5 | 235.6 | 227.9 | 673 |
| `list_assets` | `{}` | 5/5 | 493.3 | 502.8 | 487 | 502.8 | 493.6 | 22491 |
| `list_balances` | `{"types":"ALL"}` | 5/5 | 230.7 | 627 | 229.6 | 627 | 311.1 | 659 |
| `list_positions` | `{"balance_id":1250741747}` | 5/5 | 226.7 | 270.1 | 218.9 | 270.1 | 238.5 | 16 |
| `get_trade_history` | `{"balance_id":1250741747}` | 5/5 | 247.4 | 266.6 | 246.2 | 266.6 | 251.2 | 14 |
| `get_orders` | `{"balance_id":1250741747}` | 5/5 | 219.6 | 225.3 | 215.3 | 225.3 | 220.5 | 13 |
| `get_instruments` | `{"asset_id":816}` | 5/5 | 222.8 | 306.5 | 218.5 | 306.5 | 239.8 | 488 |
| `calculate_order_size` | `{"asset_id":816,"balance_currency":"USD","leverage":1,"lots":0.001}` | 5/5 | 283.9 | 291.9 | 280.1 | 291.9 | 284.7 | 124 |
| `get_candles` | `{"asset_id":816,"size":60,"count":100}` | 5/5 | 258.7 | 415.9 | 220.1 | 415.9 | 305.6 | 12713 |

- session reuse: warm `get_capabilities` mean **216.6 ms** (n=2) vs fresh initialize+initialized+call mean **846.1 ms** (n=2, pacing waits excluded; raw total 7610 ms, call-only 421.2 ms) → saving **629.5 ms/call**.

- burst/429: not tested on this server — burst runs only on `binary-options`; live rate-limit observations are in section 5

- concurrency: not tested on this server (runs only on `binary-options`)

### marginal-forex

- endpoint: `https://marginal-forex.mcp.iqoption.com` · read allowlist: `get_capabilities`, `get_limits`, `list_assets`, `list_balances`, `list_positions`, `get_trade_history`, `get_candles`, `get_orders`, `get_instruments`, `calculate_order_size`
- cold handshake (protocol, pacing excluded): 857.2, 434.7, 437.8, 432.7, 453 ms → p50 **437.8 ms**, p95 857.2 ms, mean 523.1 ms (wall incl. pacing p50 3020 ms)
- warm `tools/list`: 425, 418.6, 507.5, 418.1, 415.5 ms → p50 **418.6 ms** · tools reported: 17
- derived context: `{"assetId":1,"candleAssetId":1,"balanceId":1250741747,"currency":"USD","minLots":0.001,"openAssets":43}`

| tool | args | ok/N | p50 ms | p95 ms | min | max | mean | payload bytes (p50) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `get_capabilities` | `{}` | 5/5 | 216.2 | 219.7 | 215.7 | 219.7 | 216.8 | 48 |
| `get_limits` | `{}` | 5/5 | 219.2 | 226.4 | 217.3 | 226.4 | 221 | 672 |
| `list_assets` | `{}` | 5/5 | 281.6 | 324.9 | 272.9 | 324.9 | 291.7 | 11921 |
| `list_balances` | `{"types":"ALL"}` | 5/5 | 228 | 634.2 | 226.1 | 634.2 | 309.2 | 659 |
| `list_positions` | `{"balance_id":1250741747}` | 5/5 | 231.2 | 265 | 227.2 | 265 | 239.1 | 16 |
| `get_trade_history` | `{"balance_id":1250741747}` | 5/5 | 281.9 | 295.9 | 251 | 295.9 | 274.9 | 14 |
| `get_orders` | `{"balance_id":1250741747}` | 5/5 | 226.2 | 231.2 | 225 | 231.2 | 227.3 | 13 |
| `get_instruments` | `{"asset_id":1}` | 5/5 | 225.6 | 233.3 | 221.4 | 233.3 | 226.2 | 690 |
| `calculate_order_size` | `{"asset_id":1,"balance_currency":"USD","leverage":1,"lots":0.001}` | 5/5 | 279.3 | 297.5 | 266 | 297.5 | 280.4 | 136 |
| `get_candles` | `{"asset_id":1,"size":60,"count":100}` | 5/5 | 229.9 | 233.2 | 226.5 | 233.2 | 229.7 | 12135 |

- session reuse: warm `get_capabilities` mean **221.5 ms** (n=2) vs fresh initialize+initialized+call mean **851.3 ms** (n=2, pacing waits excluded; raw total 7579.7 ms, call-only 411.3 ms) → saving **629.8 ms/call**.

- burst/429: not tested on this server — burst runs only on `binary-options`; live rate-limit observations are in section 5

- concurrency: not tested on this server (runs only on `binary-options`)

### binary-options

- endpoint: `https://binary-options.mcp.iqoption.com` · read allowlist: `get_capabilities`, `get_limits`, `list_assets`, `list_balances`, `list_positions`, `get_trade_history`, `get_candles`
- cold handshake (protocol, pacing excluded): 864.3, 442.3, 475.6, 442.8, 446 ms → p50 **446 ms**, p95 864.3 ms, mean 534.2 ms (wall incl. pacing p50 3005.5 ms)
- warm `tools/list`: 216, 217.2, 217.1, 235.9, 215.7 ms → p50 **217.1 ms** · tools reported: 10
- derived context: `{"assetId":76,"candleAssetId":76,"balanceId":1250741747,"currency":"USD","minLots":null,"openAssets":133}`

| tool | args | ok/N | p50 ms | p95 ms | min | max | mean | payload bytes (p50) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `get_capabilities` | `{}` | 5/5 | 216.7 | 224.1 | 212.2 | 224.1 | 216.6 | 48 |
| `get_limits` | `{}` | 5/5 | 213.6 | 216.8 | 199.1 | 216.8 | 211.3 | 457 |
| `list_assets` | `{}` | 5/5 | 531 | 662.5 | 514.9 | 662.5 | 558.7 | 21389 |
| `list_balances` | `{}` | 5/5 | 220.1 | 641.9 | 218.1 | 641.9 | 304.2 | 192 |
| `list_positions` | `{"balance_id":1250741747}` | 5/5 | 336.8 | 393.8 | 329.6 | 393.8 | 349.6 | 16 |
| `get_trade_history` | `{}` | 5/5 | 397.6 | 853 | 370.1 | 853 | 482.4 | 14 |
| `get_candles` | `{"asset_id":76,"size":60,"count":100}` | 5/5 | 430.1 | 435.2 | 232.2 | 435.2 | 391.6 | 12313 |

- session reuse: warm `get_capabilities` mean **217.8 ms** (n=2) vs fresh initialize+initialized+call mean **650.4 ms** (n=2, pacing waits excluded; raw total 4528.3 ms, call-only 217.1 ms) → saving **432.6 ms/call**.

- burst/429: 12 reads in 5200.7ms — no rate_limited observed (window drained first; documented 60/60 s cap never exceeded by design) · burst p50 211.6 ms

- concurrency (4 parallel × 3): batch wall 820.9, 825.9, 824.2 ms · pooled p50 **810.4 ms** vs serial candle p50 **430.1 ms** → delta **380.3 ms** (start-spacing bypassed so the 4 reads are in-flight together; read window still enforced)

## 5. Rate-limit behavior

Observed live (turbo-options get_limits/get_capabilities (pre-flight diagnostic)): HTTP **200** with a JSON-RPC error `rate_limited: rate limit exceeded (limit=60, retry_after_ms=60000, reset_at=<timestamp>)` — i.e. the
read bucket is NOT signalled with HTTP 429 and carries **no `Retry-After` header**; the backoff hint is
`retry_after_ms=60000` + `reset_at` inside the error payload. Real limit hit in successive runs even after pacing EVERY call at 1.5s (<= ~41 calls per any 60s window) and recording controls in the rolling window — consistent with the documented per-user quota being shared across tokens and servers and already consumed elsewhere. The benchmark therefore waits retry_after_ms (<=90s) and retries a call at most twice; burst and concurrency never retry.

In the measured run itself, the 12-read burst on `binary-options` was preceded by draining the window below 10 reads, so it stayed well under 60/60 s. Per-server burst notes are in the tables above.

No rate-limit event was recorded during the measured run itself.

## Rankings

### (a) Lowest read latency (pooled p50 across all measured read tools)

| # | server | pooled p50 ms | pooled p95 ms |
| --- | --- | --- | --- |
| 1 | `marginal-forex` | 228.5 | 301 |
| 2 | `marginal-cfd` | 229.8 | 738.5 |
| 3 | `marginal-crypto` | 232.4 | 497.5 |
| 4 | `turbo-options` | 245.2 | 634.8 |
| 5 | `blitz-options` | 315.8 | 585.8 |
| 6 | `binary-options` | 336.8 | 662.5 |
| 7 | `digital-options` | 384 | 576.4 |

### (b) Lowest cold handshake (initialize + notifications/initialized, p50)

| # | server | handshake p50 ms |
| --- | --- | --- |
| 1 | `marginal-cfd` | 433 |
| 2 | `turbo-options` | 434.9 |
| 3 | `marginal-forex` | 437.8 |
| 4 | `marginal-crypto` | 441.2 |
| 5 | `binary-options` | 446 |
| 6 | `digital-options` | 453.6 |
| 7 | `blitz-options` | 572.8 |

### (c) Payload richness (list_assets p50 bytes primary; read-tool coverage tie-break)

| # | server | list_assets bytes p50 | read tools measured | tools reported | Σ tool payload p50 |
| --- | --- | --- | --- | --- | --- |
| 1 | `marginal-cfd` | 23681 | 10 | 17 | 37968 |
| 2 | `marginal-crypto` | 22491 | 10 | 17 | 37240 |
| 3 | `digital-options` | 22018 | 9 | 11 | 54621 |
| 4 | `binary-options` | 21389 | 7 | 10 | 34429 |
| 5 | `turbo-options` | 21129 | 7 | 10 | 34167 |
| 6 | `blitz-options` | 18066 | 7 | 10 | 31104 |
| 7 | `marginal-forex` | 11921 | 10 | 17 | 26304 |

## 7. Hot-path suitability

Criterion per task: `HOT_PATH_COMPATIBLE = no` when p95 > 2000 ms (JIT revalidation inside the last seconds before `submitAt`).

| server | candleFetch p50 ms | candleFetch p95 ms | HOT_PATH_COMPATIBLE (p95 ≤ 2000 ms) | 60 s entry window |
| --- | --- | --- | --- | --- |
| `turbo-options` | 237.7 | 245.2 | yes | yes |
| `blitz-options` | 234.7 | 418.5 | yes | yes |
| `digital-options` | 402.6 | 563 | yes | yes |
| `marginal-cfd` | 232.7 | 239 | yes | yes |
| `marginal-crypto` | 258.7 | 415.9 | yes | yes |
| `marginal-forex` | 229.9 | 233.2 | yes | yes |
| `binary-options` | 430.1 | 435.2 | yes | yes |

- `turbo-options`: HOT_PATH_COMPATIBLE: **yes** — p95 245.2 ms vs 2000 ms; p95 <= 2000 ms: compatible with JIT revalidation inside the last seconds before submitAt, subject to jitter
- `blitz-options`: HOT_PATH_COMPATIBLE: **yes** — p95 418.5 ms vs 2000 ms; p95 <= 2000 ms: compatible with JIT revalidation inside the last seconds before submitAt, subject to jitter
- `digital-options`: HOT_PATH_COMPATIBLE: **yes** — p95 563 ms vs 2000 ms; p95 <= 2000 ms: compatible with JIT revalidation inside the last seconds before submitAt, subject to jitter
- `marginal-cfd`: HOT_PATH_COMPATIBLE: **yes** — p95 239 ms vs 2000 ms; p95 <= 2000 ms: compatible with JIT revalidation inside the last seconds before submitAt, subject to jitter
- `marginal-crypto`: HOT_PATH_COMPATIBLE: **yes** — p95 415.9 ms vs 2000 ms; p95 <= 2000 ms: compatible with JIT revalidation inside the last seconds before submitAt, subject to jitter
- `marginal-forex`: HOT_PATH_COMPATIBLE: **yes** — p95 233.2 ms vs 2000 ms; p95 <= 2000 ms: compatible with JIT revalidation inside the last seconds before submitAt, subject to jitter
- `binary-options`: HOT_PATH_COMPATIBLE: **yes** — p95 435.2 ms vs 2000 ms; p95 <= 2000 ms: compatible with JIT revalidation inside the last seconds before submitAt, subject to jitter

Caveat: even where p95 ≤ 2000 ms, this is a necessary-not-sufficient test. The incumbent WS ACK p50 is 177 ms
while a `get_candles` p50 here is **229.9–430.1 ms** (1.3–2.4×), and WS also carries ticks/clock that MCP
does not expose (no server-time tool). See verdict below.

## 8. Verdict — MOST_PROFESSIONAL_FOR_TRACECOM

**None of the 7 MCP servers replaces the incumbent WS path for tick/JIT execution.** The fastest pooled
read p50 is **228.5 ms** (`marginal-forex`) vs the incumbent WS ACK p50 **177 ms**, and
`get_candles` p50 spans 229.9–430.1 ms — same order of magnitude, but MCP exposes no tick stream and no
server-time tool, so the −473 ms drift correction and real-time pricing remain CURRENT_STILL_REQUIRED.
On top of that, the read quota is per-user and shared across all servers; it was observed live to answer
`rate_limited` with `retry_after_ms=60000`, which is unacceptable as a timing dependency in an entry window.

### Ranking by metric
- (a) lowest read latency: `marginal-forex` 228.5 ms · `marginal-cfd` 229.8 ms · `marginal-crypto` 232.4 ms …
- (b) lowest handshake: `marginal-cfd` 433 ms · `turbo-options` 434.9 ms · `marginal-forex` 437.8 ms …
- (c) payload richness: `marginal-cfd` 23681 B · `marginal-crypto` 22491 B · `digital-options` 22018 B …

### MOST_PROFESSIONAL_FOR_TRACECOM — validation / backfill role
Metric rank alone is misleading: TraceCom trades fixed-expiry binary options, and only binary/turbo/digital
expose that product model (`expirations`, `profit_percent`). Domain-weighted recommendation:

- **1st — `binary-options`** (validator/backfill for the binary book): domain match (fixed-expiry call/put),
  catalog 21389 B p50 with canonical `name`/payout/expirations, pooled read p50
  336.8 ms, `get_candles` p50 430.1 / p95 435.2 ms.
- **2nd — `turbo-options`**: same product model with 60 s expirations; faster reads (pooled 245.2 ms, candles p50 237.7 ms) — a good secondary validator.
- **3rd — `digital-options`**: only server exposing a current price grid (`get_prices`, incl. `quote_time`) and
  strike-level `get_instruments`; slowest pooled reads (384 ms), candles p50 402.6 ms — use for mark/validation only.
- **marginal-cfd / crypto / forex**: fastest reads (228.5–232.4 ms pooled) and richest catalogs, but a different product model (CFD/spot, not fixed-expiry); consider only
  if TraceCom expands beyond binary options.

JIT revalidation (p95 ≤ 2000 ms on `get_candles`): pass for `turbo-options`, `blitz-options`, `digital-options`, `marginal-cfd`, `marginal-crypto`, `marginal-forex`, `binary-options`.
Necessary but not sufficient: MCP stays a validation/backfill connector, never the tick source.

### Caveats (do not overclaim)
- Single vantage point (this workstation), N=5 per tool; p95 at N=5 is the max — treat as an upper bound.
- Rate limits are per-user and shared across servers/tokens: a real TraceCom integration cannot fan out
  across all 7 servers at once without a global budget (documented: gateway 200/60 s, read 60/60 s, write 10/60 s).
- Rate limiting was observed live in pre-flight and is signalled as HTTP 200 + JSON-RPC `rate_limited`
  (no `Retry-After` header); the burst did not trip it because the window was drained first. A
  `retry_after_ms=60000` wait is catastrophic inside a 60 s entry window, so no MCP read may sit on the
  execution critical path.
- The PRACTICE balance divergence found in the earlier probe (training balance ≠ pipeline balance) still
  applies: validate account/tenant identity before any shadow-compare of PnL.
- MCP write tools exist for these servers but are **out of scope** here; execution must stay behind the
  TraceCom Execution Gate (WS_ONLY_PRACTICE).

### Limitations
- Session overhead saving measured with `get_capabilities`; other tools may differ slightly.
- `get_candles` measured with `size=60`, `count=100`; payload size scales with count.
- Concurrency measured only on `binary-options`; burst only on `binary-options`.
