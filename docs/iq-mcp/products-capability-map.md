# IQ Official MCP — Products capability map (digital / blitz / marginal-*)

Source: read-only probe run (`scripts/iq-mcp-products-probe.mjs`) against the live
gateway, PRACTICE accounts only, zero orders. Raw evidence:
`products-probe.raw.json` / `products-probe.md`. Token never stored; payloads redacted.
Server build for all five: `qc-mcp-* 1.7.8`, protocol `2024-11-05` (see `discovery.md`).

Calls per server (all allowlisted SAFE_READ/ACCOUNT_READ, 0 skipped, all HTTP 200):

| product | read tools called | capability mode |
|---|---|---|
| digital | get_capabilities, get_limits, list_assets, list_balances, list_positions, get_trade_history, get_instruments, get_prices | read-write |
| blitz | get_capabilities, get_limits, list_assets, list_balances, list_positions, get_trade_history | read-write |
| marginal-cfd | get_capabilities, get_limits, list_assets, list_balances, list_positions, get_trade_history, get_orders, get_instruments, calculate_order_size | read-write |
| marginal-crypto | same 9 as marginal-cfd | read-write |
| marginal-forex | same 9 as marginal-cfd | read-write |

## Shared observations

- `get_capabilities` payload is `{ mode, product }`; `mode = "read-write"` for this token on all five.
- `get_limits` payload is `{ product, scope: "per-user", buckets, tools }` with identical buckets:
  `gateway 200/60s`, `read 60/60s`, `write 10/60s`. `tools` maps each tool name to `read` or `write`;
  write buckets: digital 2, blitz 3, marginal 7.
- `list_balances` types: one `regular` (real money) and one `training` (demo) account. No orders were placed on any balance.
- `list_positions`, `get_trade_history` and `get_orders` returned **empty arrays** on this practice account;
  row shapes below come from the tool schemas documented in `discovery.md` and are unverified for populated accounts.

## digital — `digital-options` (11 tools)

- **Assets**: 100 rows, keys `asset_id, asset_type, image, is_open, name, precision`.
  `asset_type` values: Forex 42, Crypto 30, Commodity 14, Index 8, Stock 6.
  **No** `profit_percent`, **no** `expirations`, **no** min/max amount in `list_assets`.
- **Market status**: `is_open` only.
- **Payout / expiry**: not on the asset. Price/odds live in the strike grid:
  `get_prices` → `prices[].prices[]` rows with `call_instrument_id, call_price, put_instrument_id, put_price, strike`
  (observed call_price 0 / 26.5 / 53.43 = per-strike quote, not a payout percent).
  `get_instruments` returns absolute expiry windows: `instrument_index, expiration, deadline,
  deadtime_seconds, period_seconds (60/300/900…), quote, volatility, instruments[]` where each strike entry is
  `{ direction: call|put, instrument_id, strike }` (13 call + 13 put per window observed).
- **Balances**: `amount, balance_id, bonus_amount, currency, type`.
- **Positions / history**: `list_positions` takes **no** arguments and spans all balances;
  `get_trade_history` is global with `skip/limit`. Unverified row fields.
- **Rate limits**: gateway/read/write buckets above; tools classified `read` include
  get_instruments/get_prices; `write`: place_trade, sell_position.
- **NOT EQUIVALENT TO BINARY/TURBO**: strike-level model. `place_trade` requires
  `balance_id, instrument_id (str), instrument_index, asset_id, amount` — no direction/expired/profit_percent.
  There is **no rollover_position**, and `get_instruments`/`get_prices` are digital-only.
  `list_positions` is cross-balance instead of per-balance. Expiry is an absolute window + deadtime, not a duration.

## blitz — `blitz-options` (10 tools, same tool names as binary/turbo)

- **Assets**: 103 rows, keys `asset_id, expiration_sizes_seconds, is_open, name, precision, profit_percent`
  (e.g. EUR/USD: `expiration_sizes_seconds: [30,45,60,120,180,300]`, `profit_percent: 89`).
  No `asset_type` field (all rows undefined); `list_assets` also returns a `defaults` block:
  `{ minimum_amount: 2, maximum_amount: 20000, deadtime_seconds: 0, buyback_enabled: true, buyback_deadtime_seconds: 0 }`.
- **Market status**: `is_open`.
- **Payout**: `profit_percent` per asset (integer percent).
- **Expiration**: duration model — `place_trade` takes `expiration_size` (seconds) picked from
  `expiration_sizes_seconds`; no absolute `expired` timestamp.
- **Balances**: `amount, balance_id, bonus_amount, currency, type`.
- **Positions / history**: `list_positions` requires `balance_id`; both arrays empty on this token.
- **Rate limits**: same buckets; `read` 7 tools, `write`: place_trade, rollover_position, sell_position.
- **NOT EQUIVALENT TO BINARY/TURBO**: same tool names, but the expiry argument is `expiration_size`
  (seconds) instead of an absolute unix `expired`, assets carry duration lists and a `defaults` block,
  and there is no `asset_type`. Do not reuse the binary/turbo `place_trade` shape.

## marginal-cfd — `marginal-cfd` (17 tools)

- **Assets**: 58 rows, keys `asset_id, asset_type, base_currency, quote_currency, is_open, max_leverages,
  min_quantity, name, price_precision, quantity_presets, quantity_step, quantity_unit` (e.g. Gold:
  `asset_type Commodity`, `base_currency XAU`, `quantity_unit oz`, `min_quantity 1`, `quantity_step 0.01`,
  `max_leverages {"0": 800}`, `quantity_presets [1,2,3,4,5,7,10]`). Types: Index 19, Commodity 13, Stock 26.
- **Market status**: `is_open`.
- **Leverage** (no payout): `max_leverages` on the asset plus `get_instruments.leverage_profiles[]`
  = equity-band tiers (`min_equity_usd/max_equity_usd → max_leverage`, `min_leverage` floor; observed
  tiers 800/400/300/200/100/50/20 by equity up to >$10M). Instrument:
  `{ asset_id, instrument_id: "mcfd.74", lot_size, min_quantity, quantity_step, spread_markup, stop_levels
  {stop_loss, take_profit} }`. `calculate_order_size` preview returns
  `{ lots, units, notional, margin, leverage, buy_price, sell_price }`.
- **Expiration**: none — positions stay open until closed; pending limit/stop orders via `get_orders`.
- **Balances**: portfolio block `amount, bonus_amount, currency, type, equity, equity_usd, free_margin,
  margin, margin_level, pnl, pnl_net, swap, dividends, isolated_*, stop_out_level (50)`.
- **Positions / history / orders**: all **per balance** (`balance_id` required), each with `skip/limit`.
- **Rate limits**: same buckets; `read` 10 (incl. calculate_order_size); `write` 7
  (place_market/limit/stop_order, close_position, cancel_pending_order, change_position_stop_loss/take_profit).
- **NOT EQUIVALENT TO BINARY/TURBO**: macro/CFD model — side buy/sell, lots/units/margin sizing,
  leverage tiers, spread and stop_levels distance, pending orders, SL/TP mutation, portfolio balances.
  There is no direction call/put, no payout, no expiry; `list_balances` requires `types`.

## marginal-crypto — `marginal-crypto` (17 tools)

- **Assets**: 80 rows, all `asset_type Crypto`; same key set as marginal-cfd (e.g. Bitcoin:
  `base_currency BTC`, `quote_currency USD`, `min_quantity 0.001`, `quantity_step 0.001`,
  `quantity_unit lots`, `max_leverages {"0": 20}`, `price_precision 2`).
- **Leverage**: `leverage_profiles` observed: min_leverage 5, tiers max 20/15/10/5 by equity.
  Instrument `mcrpt.816`: `lot_size 1`, `spread_markup 10`, `stop_levels {stop_loss:1, take_profit:1}`.
- **Expiration**: none (positions held until close; limit/stop pending orders).
- **Balances**: same portfolio block as marginal-cfd; `regular` + `training`.
- **Positions / history / orders**: per balance (`balance_id` required).
- **Rate limits**: same buckets/tool split as marginal-cfd.
- **NOT EQUIVALENT TO BINARY/TURBO**: same marginal/CFD semantics as marginal-cfd, crypto-only
  universe (80 assets), different leverage tiers (20/15/10/5) and lot sizing (0.001 steps);
  no payout, no expiry, no call/put direction.

## marginal-forex — `marginal-forex` (17 tools)

- **Assets**: 43 rows, all `asset_type Forex`; same key set (e.g. EUR/USD: `base_currency EUR`,
  `quote_currency USD`, `min_quantity 0.001`, `quantity_step 0.001`, `quantity_unit lots`,
  `price_precision 4`, `max_leverages {"0": 5000}`).
- **Leverage**: `leverage_profiles` observed: min_leverage 50, tiers max 5000/3000/2000/1000/500/400/300
  by equity. Instrument `mf.1`: `lot_size 100000`, `spread_markup 0.00003`,
  `stop_levels {stop_loss: 0.0002, take_profit: 0.0002}`.
- `calculate_order_size` preview (lots 0.001, leverage 1): `units 100`, `notional 593.81`, `margin 593.81`.
- **Expiration**: none — no expiry model at all.
- **Balances**: same portfolio block as marginal-cfd/crypto.
- **Positions / history / orders**: per balance (`balance_id` required).
- **Rate limits**: same buckets; same read/write split as marginal-cfd/crypto.
- **NOT EQUIVALENT TO BINARY/TURBO**: same marginal/CFD semantics, forex-only (43 pairs),
  different leverage tiers and 100k lot_size; no payout, no expiry, no call/put direction.

## Cross-product summary

| attribute | digital | blitz | marginal-cfd | marginal-crypto | marginal-forex |
|---|---|---|---|---|---|
| tools | 11 | 10 | 17 | 17 | 17 |
| asset universe | 100 (5 types) | 103 (no type) | 58 (Index/Commodity/Stock) | 80 Crypto | 43 Forex |
| pricing field | call/put strike prices | profit_percent | spread_markup + leverage | same | same |
| expiry model | absolute window + deadtime + strikes | duration seconds | none | none | none |
| sizing | amount | amount | lots/units/margin | lots/units/margin | lots/units/margin |
| balances | flat | flat | portfolio | portfolio | portfolio |
| positions scope | all balances | per balance | per balance | per balance | per balance |
| has rollover | no | yes | no | no | no |
| has pending orders/SL-TP | no | no | yes | yes | yes |
| rate limit (write) | 10/60s (2 w tools) | 10/60s (3 w tools) | 10/60s (7 w tools) | 10/60s (7 w tools) | 10/60s (7 w tools) |

**Do not assume equivalence with Binary/Turbo for any of these five products.**
