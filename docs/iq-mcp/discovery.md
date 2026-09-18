# IQ Option Official MCP — Discovery (read-only)

Generated: 2026-09-18T01:13:47.078Z
Authenticated: true

> Token never stored; all output redacted. Read-only: no tool was ever called.

## binary — https://binary-options.mcp.iqoption.com
- reachable: true | authenticated: true | protocolVersion: 2024-11-05
- serverInfo: `{"name":"qc-mcp-binary-options","version":"1.7.8"}`
- capabilities: `{"logging":{},"tools":{"listChanged":true}}`

| TOOL | RISK | DESCRIPTION |
|---|---|---|
| get_candles | SAFE_READ | Return recent OHLC price candles for an asset (by asset_id from list_assets) so you can gauge the recent trend before opening a position. Required: asset_id and |
| get_capabilities | SAFE_READ | Report this token's access mode for binary-options: read-write (write tools available to this token), read-only (market data and portfolio only), or none. The m |
| get_limits | SAFE_READ | Report the gateway's rate limits so you can pace calls and avoid rate_limited errors. Limits are enforced per user — shared across all of that user's tokens, no |
| get_trade_history | ACCOUNT_READ | List your already-closed positions, with paging. Optional skip (records to skip; default 0) and limit (default 50, max 500). Each row has position_id, asset_id/ |
| list_assets | SAFE_READ | List tradable assets. Each row has asset_id (pass to place_trade), name, is_open (currently tradable), minimum_amount/maximum_amount for the trade amount, profi |
| list_balances | ACCOUNT_READ | List your trading balances. Each row has balance_id, a type ('regular' = real-money account, 'training' = demo account with imaginary funds), currency, availabl |
| list_positions | ACCOUNT_READ | List your currently open positions on one balance (balance_id from list_balances). Each row carries position_id (pass to sell_position or rollover_position), as |
| place_trade | ORDER_WRITE | Open a new binary-options position. Pass balance_id (from list_balances), asset_id plus its current profit_percent (both from list_assets), direction 'call' (pr |
| rollover_position | ORDER_WRITE | Move one of your currently open, currently-losing positions to the next expiration window instead of letting it expire, for a commission charged from the balanc |
| sell_position | ORDER_WRITE | Close one of your currently open positions early at the current buyback price, before its expiration. Pass a position_id from list_positions (its sell_profit fi |

## turbo — https://turbo-options.mcp.iqoption.com
- reachable: true | authenticated: true | protocolVersion: 2024-11-05
- serverInfo: `{"name":"qc-mcp-turbo-options","version":"1.7.8"}`
- capabilities: `{"logging":{},"tools":{"listChanged":true}}`

| TOOL | RISK | DESCRIPTION |
|---|---|---|
| get_candles | SAFE_READ | Return recent OHLC price candles for an asset (by asset_id from list_assets) so you can gauge the recent trend before opening a position. Required: asset_id and |
| get_capabilities | SAFE_READ | Report this token's access mode for turbo-options: read-write (write tools available to this token), read-only (market data and portfolio only), or none. The mo |
| get_limits | SAFE_READ | Report the gateway's rate limits so you can pace calls and avoid rate_limited errors. Limits are enforced per user — shared across all of that user's tokens, no |
| get_trade_history | ACCOUNT_READ | List your already-closed positions, with paging. Optional skip (records to skip; default 0) and limit (default 50, max 500). Each row has position_id, asset_id/ |
| list_assets | SAFE_READ | List tradable assets. Each row has asset_id (pass to place_trade), name, is_open (currently tradable), minimum_amount/maximum_amount for the trade amount, profi |
| list_balances | ACCOUNT_READ | List your trading balances. Each row has balance_id, a type ('regular' = real-money account, 'training' = demo account with imaginary funds), currency, availabl |
| list_positions | ACCOUNT_READ | List your currently open positions on one balance (balance_id from list_balances). Each row carries position_id (pass to sell_position or rollover_position), as |
| place_trade | ORDER_WRITE | Open a new turbo-options position. Pass balance_id (from list_balances), asset_id plus its current profit_percent (both from list_assets), direction 'call' (pri |
| rollover_position | ORDER_WRITE | Move one of your currently open, currently-losing positions to the next expiration window instead of letting it expire, for a commission charged from the balanc |
| sell_position | ORDER_WRITE | Close one of your currently open positions early at the current buyback price, before its expiration. Pass a position_id from list_positions (its sell_profit fi |

## blitz — https://blitz-options.mcp.iqoption.com
- reachable: true | authenticated: true | protocolVersion: 2024-11-05
- serverInfo: `{"name":"qc-mcp-blitz-options","version":"1.7.8"}`
- capabilities: `{"logging":{},"tools":{"listChanged":true}}`

| TOOL | RISK | DESCRIPTION |
|---|---|---|
| get_candles | SAFE_READ | Return recent OHLC price candles for an asset (by asset_id from list_assets) so you can gauge the recent trend before opening a position. Required: asset_id and |
| get_capabilities | SAFE_READ | Report this token's access mode for blitz-options: read-write (write tools available to this token), read-only (market data and portfolio only), or none. The mo |
| get_limits | SAFE_READ | Report the gateway's rate limits so you can pace calls and avoid rate_limited errors. Limits are enforced per user — shared across all of that user's tokens, no |
| get_trade_history | ACCOUNT_READ | List your already-closed positions, with paging. Optional skip (records to skip; default 0) and limit (default 50, max 500). Each row has position_id, asset_id/ |
| list_assets | SAFE_READ | List tradable assets. Each row has asset_id (pass to place_trade), name, is_open (currently tradable), minimum_amount/maximum_amount for the trade amount, profi |
| list_balances | ACCOUNT_READ | List your trading balances. Each row has balance_id, a type ('regular' = real-money account, 'training' = demo account with imaginary funds), currency, availabl |
| list_positions | ACCOUNT_READ | List your currently open positions on one balance (balance_id from list_balances). Each row carries position_id (pass to sell_position or rollover_position), as |
| place_trade | ORDER_WRITE | Open a new blitz-options position. Pass balance_id (from list_balances), asset_id plus its current profit_percent (both from list_assets), direction 'call' (pri |
| rollover_position | ORDER_WRITE | Move one of your currently open, currently-losing positions to the next expiration window instead of letting it expire, for a commission charged from the balanc |
| sell_position | ORDER_WRITE | Close one of your currently open positions early at the current buyback price, before its expiration. Pass a position_id from list_positions (its sell_profit fi |

## digital — https://digital-options.mcp.iqoption.com
- reachable: true | authenticated: true | protocolVersion: 2024-11-05
- serverInfo: `{"name":"qc-mcp-digital-options","version":"1.7.8"}`
- capabilities: `{"resources":{"subscribe":true},"tools":{"listChanged":true}}`

| TOOL | RISK | DESCRIPTION |
|---|---|---|
| get_candles | SAFE_READ | Return recent OHLC price candles for an asset. Required: asset_id (from list_assets) and size (candle width in seconds — one of the supported values). Optional  |
| get_capabilities | SAFE_READ | Report this token's access mode for digital-options: read-write (write tools available to this token), read-only (market data and portfolio only), or none. The  |
| get_instruments | SAFE_READ | Get the tradable instruments for an asset. Required: asset_id (from list_assets). Each instrument is an expiry window carrying a top-level instrument_index plus |
| get_limits | SAFE_READ | Report the gateway's rate limits so you can pace calls and avoid rate_limited errors. Limits are enforced per user — shared across all of that user's tokens, no |
| get_prices | SAFE_READ | Get the current price grid for an asset. Required: asset_id (from list_assets). Returns one or more price sets, each tagged with an instrument_index and quote_t |
| get_trade_history | ACCOUNT_READ | List your already-closed positions, with paging. Optional skip (records to skip; default 0) and limit (default 50, max 500). Each row has position_id, balance_i |
| list_assets | SAFE_READ | List tradable assets. Each row has asset_id (pass to get_instruments, get_candles, get_prices, place_trade), name, asset_type, is_open (market currently open),  |
| list_balances | ACCOUNT_READ | List your trading balances. Each row has balance_id, a type ('regular' = real-money account, 'training' = demo account with imaginary funds), currency, availabl |
| list_positions | ACCOUNT_READ | List your currently open positions across all balances. Each row carries position_id (pass to sell_position to close early), balance_id, asset_id/asset_name, in |
| place_trade | ORDER_WRITE | Open a new digital-option position. The instrument_id (strike-level symbol) AND instrument_index (numeric window id), both from get_instruments (or a get_prices |
| sell_position | ORDER_WRITE | Close one of your currently open positions early at the current market price, before its expiry. Pass a position_id from list_positions (its sell_profit field p |

## marginal-cfd — https://marginal-cfd.mcp.iqoption.com
- reachable: true | authenticated: true | protocolVersion: 2024-11-05
- serverInfo: `{"name":"qc-mcp-marginal-cfd","version":"1.7.8"}`
- capabilities: `{"logging":{},"tools":{"listChanged":true}}`

| TOOL | RISK | DESCRIPTION |
|---|---|---|
| calculate_order_size | ACCOUNT_READ | Preview the lots/units/margin tuple for a planned marginal-cfd order WITHOUT placing it (read-only). Pass exactly one of lots/units/margin plus leverage and the |
| cancel_pending_order | ORDER_WRITE | Cancel a previously placed pending limit / stop / market-on-open order by order_id (from get_orders). WRITE action; idempotency-protected — a byte-identical ret |
| change_position_stop_loss | ORDER_WRITE | Set, move or cancel the stop-loss order on one of your currently open marginal-cfd positions (position_id from list_positions). level is the stop-loss trigger p |
| change_position_take_profit | ORDER_WRITE | Set, move or cancel the take-profit order on one of your currently open marginal-cfd positions (position_id from list_positions). level is the take-profit trigg |
| close_position | ORDER_WRITE | Close one of your currently open marginal-cfd positions by position_id (from list_positions), realizing its profit/loss. WRITE action; idempotency-protected — a |
| get_candles | SAFE_READ | Get historical price candles for an asset (by asset_id from list_assets). Specify a candle size in seconds and an optional count (default 100, max 1000). Each c |
| get_capabilities | SAFE_READ | Report this token's access mode for marginal-cfd: read-write (write tools available to this token), read-only (market data and portfolio only), or none. The mod |
| get_instruments | SAFE_READ | Get tradable marginal-cfd instruments for the requested asset, together with the leverage profiles they reference |
| get_limits | SAFE_READ | Report the gateway's rate limits so you can pace calls and avoid rate_limited errors. Limits are enforced per user — shared across all of that user's tokens, no |
| get_orders | ACCOUNT_READ | List currently open / pending marginal-cfd orders for a balance |
| get_trade_history | ACCOUNT_READ | List your closed marginal-cfd positions (trade history) for a balance |
| list_assets | SAFE_READ | List underlying assets available for marginal-cfd trading |
| list_balances | ACCOUNT_READ | List marginal-cfd balances with portfolio details (equity, margin, pnl, free margin). Each balance carries a type: 'regular' is real money, 'training' is demo f |
| list_positions | ACCOUNT_READ | List currently open marginal-cfd positions for a balance |
| place_limit_order | ORDER_WRITE | Place a new marginal-cfd limit order that triggers at limit_price (must be positive). WRITE action; on a 'regular' balance it can spend real money — confirm wit |
| place_market_order | ORDER_WRITE | Place a new marginal-cfd market order (fills immediately at the current price). WRITE action that opens a position and, on a 'regular' balance, spends real mone |
| place_stop_order | ORDER_WRITE | Place a new marginal-cfd stop order that triggers at stop_price (must be positive). WRITE action; on a 'regular' balance it can spend real money — confirm with  |

## marginal-crypto — https://marginal-crypto.mcp.iqoption.com
- reachable: true | authenticated: true | protocolVersion: 2024-11-05
- serverInfo: `{"name":"qc-mcp-marginal-crypto","version":"1.7.8"}`
- capabilities: `{"logging":{},"tools":{"listChanged":true}}`

| TOOL | RISK | DESCRIPTION |
|---|---|---|
| calculate_order_size | ACCOUNT_READ | Preview the lots/units/margin tuple for a planned marginal-crypto order WITHOUT placing it (read-only). Pass exactly one of lots/units/margin plus leverage and  |
| cancel_pending_order | ORDER_WRITE | Cancel a previously placed pending limit / stop / market-on-open order by order_id (from get_orders). WRITE action; idempotency-protected — a byte-identical ret |
| change_position_stop_loss | ORDER_WRITE | Set, move or cancel the stop-loss order on one of your currently open marginal-crypto positions (position_id from list_positions). level is the stop-loss trigge |
| change_position_take_profit | ORDER_WRITE | Set, move or cancel the take-profit order on one of your currently open marginal-crypto positions (position_id from list_positions). level is the take-profit tr |
| close_position | ORDER_WRITE | Close one of your currently open marginal-crypto positions by position_id (from list_positions), realizing its profit/loss. WRITE action; idempotency-protected  |
| get_candles | SAFE_READ | Get historical price candles for an asset (by asset_id from list_assets). Specify a candle size in seconds and an optional count (default 100, max 1000). Each c |
| get_capabilities | SAFE_READ | Report this token's access mode for marginal-crypto: read-write (write tools available to this token), read-only (market data and portfolio only), or none. The  |
| get_instruments | SAFE_READ | Get tradable marginal-crypto instruments for the requested asset, together with the leverage profiles they reference |
| get_limits | SAFE_READ | Report the gateway's rate limits so you can pace calls and avoid rate_limited errors. Limits are enforced per user — shared across all of that user's tokens, no |
| get_orders | ACCOUNT_READ | List currently open / pending marginal-crypto orders for a balance |
| get_trade_history | ACCOUNT_READ | List your closed marginal-crypto positions (trade history) for a balance |
| list_assets | SAFE_READ | List underlying assets available for marginal-crypto trading |
| list_balances | ACCOUNT_READ | List marginal-crypto balances with portfolio details (equity, margin, pnl, free margin). Each balance carries a type: 'regular' is real money, 'training' is dem |
| list_positions | ACCOUNT_READ | List currently open marginal-crypto positions for a balance |
| place_limit_order | ORDER_WRITE | Place a new marginal-crypto limit order that triggers at limit_price (must be positive). WRITE action; on a 'regular' balance it can spend real money — confirm  |
| place_market_order | ORDER_WRITE | Place a new marginal-crypto market order (fills immediately at the current price). WRITE action that opens a position and, on a 'regular' balance, spends real m |
| place_stop_order | ORDER_WRITE | Place a new marginal-crypto stop order that triggers at stop_price (must be positive). WRITE action; on a 'regular' balance it can spend real money — confirm wi |

## marginal-forex — https://marginal-forex.mcp.iqoption.com
- reachable: true | authenticated: true | protocolVersion: 2024-11-05
- serverInfo: `{"name":"qc-mcp-marginal-forex","version":"1.7.8"}`
- capabilities: `{"logging":{},"tools":{"listChanged":true}}`

| TOOL | RISK | DESCRIPTION |
|---|---|---|
| calculate_order_size | ACCOUNT_READ | Preview the lots/units/margin tuple for a planned marginal-forex order WITHOUT placing it (read-only). Pass exactly one of lots/units/margin plus leverage and t |
| cancel_pending_order | ORDER_WRITE | Cancel a previously placed pending limit / stop / market-on-open order by order_id (from get_orders). WRITE action; idempotency-protected — a byte-identical ret |
| change_position_stop_loss | ORDER_WRITE | Set, move or cancel the stop-loss order on one of your currently open marginal-forex positions (position_id from list_positions). level is the stop-loss trigger |
| change_position_take_profit | ORDER_WRITE | Set, move or cancel the take-profit order on one of your currently open marginal-forex positions (position_id from list_positions). level is the take-profit tri |
| close_position | ORDER_WRITE | Close one of your currently open marginal-forex positions by position_id (from list_positions), realizing its profit/loss. WRITE action; idempotency-protected — |
| get_candles | SAFE_READ | Get historical price candles for an asset (by asset_id from list_assets). Specify a candle size in seconds and an optional count (default 100, max 1000). Each c |
| get_capabilities | SAFE_READ | Report this token's access mode for marginal-forex: read-write (write tools available to this token), read-only (market data and portfolio only), or none. The m |
| get_instruments | SAFE_READ | Get tradable marginal-forex instruments for the requested asset, together with the leverage profiles they reference |
| get_limits | SAFE_READ | Report the gateway's rate limits so you can pace calls and avoid rate_limited errors. Limits are enforced per user — shared across all of that user's tokens, no |
| get_orders | ACCOUNT_READ | List currently open / pending marginal-forex orders for a balance |
| get_trade_history | ACCOUNT_READ | List your closed marginal-forex positions (trade history) for a balance |
| list_assets | SAFE_READ | List underlying assets available for marginal-forex trading |
| list_balances | ACCOUNT_READ | List marginal-forex balances with portfolio details (equity, margin, pnl, free margin). Each balance carries a type: 'regular' is real money, 'training' is demo |
| list_positions | ACCOUNT_READ | List currently open marginal-forex positions for a balance |
| place_limit_order | ORDER_WRITE | Place a new marginal-forex limit order that triggers at limit_price (must be positive). WRITE action; on a 'regular' balance it can spend real money — confirm w |
| place_market_order | ORDER_WRITE | Place a new marginal-forex market order (fills immediately at the current price). WRITE action that opens a position and, on a 'regular' balance, spends real mo |
| place_stop_order | ORDER_WRITE | Place a new marginal-forex stop order that triggers at stop_price (must be positive). WRITE action; on a 'regular' balance it can spend real money — confirm wit |
