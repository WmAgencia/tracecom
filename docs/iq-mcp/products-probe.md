# Products (digital / blitz / marginal-*) — read-only probe

Generated: 2026-09-18T01:29:37.863Z
Authenticated: true

> Token never stored; all payloads redacted. Only explicitly allowlisted
> SAFE_READ/ACCOUNT_READ tools were called. No order tool was ever called.

## digital — https://digital-options.mcp.iqoption.com

- allowlist: `get_capabilities, get_limits, list_assets, list_balances, list_positions, get_trade_history, get_instruments, get_prices`
### get_capabilities (615ms, status 200)

args: `{}`

```json
{
  "mode": "read-write",
  "product": "digital-options"
}
```

### get_limits (203ms, status 200)

args: `{}`

```json
{
  "buckets": [
    {
      "bucket": "gateway",
      "limit": 200,
      "window_seconds": 60
    },
    {
      "bucket": "read",
      "limit": 60,
      "window_seconds": 60
    },
    {
      "bucket": "write",
      "limit": 10,
      "window_seconds": 60
    }
  ],
  "product": "digital-options",
  "scope": "per-user",
  "tools": {
    "get_candles": "read",
    "get_capabilities": "read",
    "get_instruments": "read",
    "get_limits": "read",
    "get_prices": "read",
    "get_trade_history": "read",
    "list_assets": "read",
    "list_balances": "read",
    "list_positions": "read",
    "place_trade": "write",
    "sell_position": "write"
  }
}
```

### list_assets (558ms, status 200)

args: `{}`

```json
{
  "assets": [
    {
      "asset_id": 76,
      "asset_type": "Forex",
      "image": "https://files.iqoption.com/storage/public/5a/cb/6fa29264d/76.png",
      "is_open": true,
      "name": "EUR/USD (OTC)",
      "precision": 6
    },
    {
      "asset_id": 77,
      "asset_type": "Forex",
      "image": "https://files.iqoption.com/storage/public/d0/um/8mdbd2ee5d5732mg.png",
      "is_open": true,
      "name": "EUR/GBP (OTC)",
      "precision": 6
    },
    {
      "asset_id": 78,
      "asset_type": "Forex",
      "image": "https://files.iqoption.com/storage/public/5a/cb/6fa2c52ae/78.png",
      "is_open": true,
      "name": "USD/CHF (OTC)",
      "precision": 6
    },
    {
      "asset_id": 79,
      "asset_type": "Forex",
      "image": "https://files.iqoption.com/storage/public/d0/um/9eusrdaffhulihgg.png",
      "is_open": true,
      "name": "EUR/JPY (OTC)",
      "precision": 6
    },
    {
      "asset_id": 80,
      "asset_type": "Forex",
      "image": "https://files.iqoption.com/storage/public/5a/cb/6fa355128/80.png",
      "is_open": true,
      "name": "NZD/USD (OTC)",
      "precision": 6
    },
    {
      "asset_id": 81,
      "asset_type": "Forex",
      "image": "https://files.iqoption.com/storage/public/5a/cb/6fe0daf48/81.png",
      "is_open": true,
      "name": "GBP/USD (OTC)",
      "precision": 6
    },
    {
      "asset_id": 84,
      "asset_type": "Forex",
      "image": "https://files.iqoption.com/storage/public/5a/cb/6fe1922ad/84.png",
      "is_open": true,
      "name": "GBP/JPY (OTC)",
      "precision": 6
    },
    {
      "asset_id": 85,
      "asset_type": "Forex",
      "image": "https://files.iqoption.com/storage/public/5a/cb/6fe15ffb3/85.png",
      "is_open": true,
      "name": "USD/JPY (OTC)",
      "precision": 5
    },
    {
      "asset_id": 86,
      "asset_type": "Forex",
      "image": "https://files.iqoption.com/storage/public/5a/cb/7012443f3/86.png",
      "is_open": true,
      "name": "AUD/CAD (OTC)",
      "precision": 6
    },
    {
      "asset_id": 1380,
      "asset_type": "Forex",
      "image": "https://files.iqoption.com/storage/public/cr/89/te3jcddrnsg609ig.png",
      "is_open": true,
      "name": "USD/ZAR (OTC)",
      "precision": 6
    },
    {
      "asset_id": 1383,
      "asset_type": "Forex",
      "image": "https://files.iqoption.com/storage/public/5f/7f/1e2ab61f91a4e5c0e5/USDINR_OTC.png",
      "is_open": true,
      "name": "USD/INR (OTC)",
      "precision": 4
    },
    {
      "asset_id": 1470,
      "asset_type": "Index",
      "image": "https://files.iqoption.com/storage/public/cd/pn/eipbdrop8k8emkog.png",
      "is_open": true,
      "name": "US 500",
      "precision": 6
    },
    {
      "asset_id": 1471,
      "asset_type": "Index",
      "image": "https://files.iqoption.com/storage/public/cd/pn/flpbdrop8k8emkq0.png",
      "is_open": true,
      "name": "US 100",
      "precision": 6
    },
    {
      "asset_id": 1472,
      "asset_type": "Index",
      "image": "https://files.iqoption.com/storage/public/cd/pn/h7bld277k5khm04g.png",
      "is_open": true,
      "name": "US 30",
      "precision": 6
    },
    {
      "asset_id": 1473,
      "asset_type": "Index",
      "image": "https://files.iqoption.com/storage/public/cd/pn/iiod0gfmbsuleaug.png",
      "is_open": true,
      "name": "US 2000",
      "precision": 6
    },
    {
      "asset_id": 1476,
      "asset_type": "Index",
      "image": "https://files.iqoption.com/storage/public/d4/2b/8hu6dq12h96d14hg.png",
      "is_open": true,
      "name": "JP 225",
      "precision": 6
    },
    {
      "asset_id": 1857,
      "asset_type": "Commodity",
      "image": "https://files.iqoption.com/storage/public/cn/ta/7uon68mh0vavek20.png",
      "is_open": true,
      "name": "XAUUSD (OTC)",
      "precision": 6
    },
    {
      "asset_id": 1859,
      "asset_type": "Commodity",
      "image": "https://files.iqoption.com/storage/public/cn/ta/701b24v7kcjgpeg0.png",
      "is_open": true,
…
```

### list_balances (238ms, status 200)

args: `{}`

```json
{
  "balances": [
    {
      "amount": 0,
      "balance_id": 1250741746,
      "bonus_amount": 0,
      "currency": "BRL",
      "type": "regular"
    },
    {
      "amount": 60,
      "balance_id": 1250741747,
      "bonus_amount": 0,
      "currency": "USD",
      "type": "training"
    }
  ]
}
```

### list_positions (434ms, status 200)

args: `{}`

```json
{
  "positions": []
}
```

### get_trade_history (433ms, status 200)

args: `{}`

```json
{
  "history": []
}
```

### get_instruments (558ms, status 200)

args: `{"asset_id":76}`

```json
{
  "instruments": [
    {
      "asset_id": 76,
      "deadline": "2026-09-18T01:29:30Z",
      "deadtime_seconds": 30,
      "expiration": "2026-09-18T01:30:00Z",
      "generated_at": "2026-09-18T01:14:05Z",
      "instrument_index": 3982126,
      "instruments": [
        {
          "direction": "call",
          "instrument_id": "do76A20260918D013000T15MC1F133212",
          "strike": "1.133212"
        },
        {
          "direction": "call",
          "instrument_id": "do76A20260918D013000T15MC1F134543",
          "strike": "1.134543"
        },
        {
          "direction": "call",
          "instrument_id": "do76A20260918D013000T15MC1F135208",
          "strike": "1.135208"
        },
        {
          "direction": "call",
          "instrument_id": "do76A20260918D013000T15MC1F135873",
          "strike": "1.135873"
        },
        {
          "direction": "call",
          "instrument_id": "do76A20260918D013000T15MC1F136317",
          "strike": "1.136317"
        },
        {
          "direction": "call",
          "instrument_id": "do76A20260918D013000T15MC1F136761",
          "strike": "1.136761"
        },
        {
          "direction": "call",
          "instrument_id": "do76A20260918D013000T15MC1F137649",
          "strike": "1.137649"
        },
        {
          "direction": "call",
          "instrument_id": "do76A20260918D013000T15MC1F138093",
          "strike": "1.138093"
        },
        {
          "direction": "call",
          "instrument_id": "do76A20260918D013000T15MC1F138537",
          "strike": "1.138537"
        },
        {
          "direction": "call",
          "instrument_id": "do76A20260918D013000T15MC1F139202",
          "strike": "1.139202"
        },
        {
          "direction": "call",
          "instrument_id": "do76A20260918D013000T15MC1F139867",
          "strike": "1.139867"
        },
        {
          "direction": "call",
          "instrument_id": "do76A20260918D013000T15MC1F141198",
          "strike": "1.141198"
        },
        {
          "direction": "call",
          "instrument_id": "do76A20260918D013000T15MCSPT",
          "strike": "SPT"
        },
        {
          "direction": "put",
          "instrument_id": "do76A20260918D013000T15MP1F133212",
          "strike": "1.133212"
        },
        {
          "direction": "put",
          "instrument_id": "do76A20260918D013000T15MP1F134543",
          "strike": "1.134543"
        },
        {
          "direction": "put",
          "instrument_id": "do76A20260918D013000T15MP1F135208",
          "strike": "1.135208"
        },
        {
          "direction": "put",
          "instrument_id": "do76A20260918D013000T15MP1F135873",
          "strike": "1.135873"
        },
        {
          "direction": "put",
          "instrument_id": "do76A20260918D013000T15MP1F136317",
          "strike": "1.136317"
        },
        {
          "direction": "put",
          "instrument_id": "do76A20260918D013000T15MP1F136761",
          "strike": "1.136761"
        },
        {
          "direction": "put",
          "instrument_id": "do76A20260918D013000T15MP1F137649",
          "strike": "1.137649"
        },
        {
          "direction": "put",
          "instrument_id": "do76A20260918D013000T15MP1F138093",
          "strike": "1.138093"
        },
        {
          "direction": "put",
          "instrument_id": "do76A20260918D013000T15MP1F138537",
          "strike": "1.138537"
        },
        {
          "direction": "put",
          "instrument_id": "do76A20260918D013000T15MP1F139202",
          "strike": "1.139202"
        },
        {
          "direction": "put",
          "instrument_id": "do76A20260918D013000T15MP1F139867",
          "strike": "1.139867"
        },
        {
          "direction": "put",
          "instrument_id": "do76A20260918D013000T15MP1F141198",
          "strike": "1.141198"
        },
        {
          "direction": "put",
          "instrument_id": "do76A20260…
```

### get_prices (446ms, status 200)

args: `{"asset_id":76}`

```json
{
  "prices": [
    {
      "asset_id": 76,
      "instrument_index": 3982126,
      "prices": [
        {
          "call_instrument_id": "do76A20260918D013000T15MC1F133212",
          "call_price": 0,
          "put_instrument_id": "do76A20260918D013000T15MP1F133212",
          "put_price": 26.5,
          "strike": "1.133212"
        },
        {
          "call_instrument_id": "do76A20260918D013000T15MC1F134543",
          "call_price": 0,
          "put_instrument_id": "do76A20260918D013000T15MP1F134543",
          "put_price": 26.5,
          "strike": "1.134543"
        },
        {
          "call_instrument_id": "do76A20260918D013000T15MC1F135208",
          "call_price": 0,
          "put_instrument_id": "do76A20260918D013000T15MP1F135208",
          "put_price": 26.5,
          "strike": "1.135208"
        },
        {
          "call_instrument_id": "do76A20260918D013000T15MC1F135873",
          "call_price": 0,
          "put_instrument_id": "do76A20260918D013000T15MP1F135873",
          "put_price": 26.5,
          "strike": "1.135873"
        },
        {
          "call_instrument_id": "do76A20260918D013000T15MC1F136317",
          "call_price": 0,
          "put_instrument_id": "do76A20260918D013000T15MP1F136317",
          "put_price": 26.5,
          "strike": "1.136317"
        },
        {
          "call_instrument_id": "do76A20260918D013000T15MC1F136761",
          "call_price": 0,
          "put_instrument_id": "do76A20260918D013000T15MP1F136761",
          "put_price": 26.5,
          "strike": "1.136761"
        },
        {
          "call_instrument_id": "do76A20260918D013000T15MC1F137649",
          "call_price": 0,
          "put_instrument_id": "do76A20260918D013000T15MP1F137649",
          "put_price": 27.61122,
          "strike": "1.137649"
        },
        {
          "call_instrument_id": "do76A20260918D013000T15MC1F138093",
          "call_price": 26.5,
          "put_instrument_id": "do76A20260918D013000T15MP1F138093",
          "put_price": 0,
          "strike": "1.138093"
        },
        {
          "call_instrument_id": "do76A20260918D013000T15MC1F138537",
          "call_price": 26.5,
          "put_instrument_id": "do76A20260918D013000T15MP1F138537",
          "put_price": 0,
          "strike": "1.138537"
        },
        {
          "call_instrument_id": "do76A20260918D013000T15MC1F139202",
          "call_price": 26.5,
          "put_instrument_id": "do76A20260918D013000T15MP1F139202",
          "put_price": 0,
          "strike": "1.139202"
        },
        {
          "call_instrument_id": "do76A20260918D013000T15MC1F139867",
          "call_price": 26.5,
          "put_instrument_id": "do76A20260918D013000T15MP1F139867",
          "put_price": 0,
          "strike": "1.139867"
        },
        {
          "call_instrument_id": "do76A20260918D013000T15MC1F141198",
          "call_price": 26.5,
          "put_instrument_id": "do76A20260918D013000T15MP1F141198",
          "put_price": 0,
          "strike": "1.141198"
        },
        {
          "call_instrument_id": "do76A20260918D013000T15MCSPT",
          "call_price": 53.429916,
          "put_instrument_id": "do76A20260918D013000T15MPSPT",
          "put_price": 53.436128,
          "strike": "SPT"
        }
      ],
      "quote_time": "2026-09-18T01:29:43.076599485Z"
    }
  ]
}
```


## blitz — https://blitz-options.mcp.iqoption.com

- allowlist: `get_capabilities, get_limits, list_assets, list_balances, list_positions, get_trade_history`
### get_capabilities (616ms, status 200)

args: `{}`

```json
{
  "mode": "read-write",
  "product": "blitz-options"
}
```

### get_limits (208ms, status 200)

args: `{}`

```json
{
  "buckets": [
    {
      "bucket": "gateway",
      "limit": 200,
      "window_seconds": 60
    },
    {
      "bucket": "read",
      "limit": 60,
      "window_seconds": 60
    },
    {
      "bucket": "write",
      "limit": 10,
      "window_seconds": 60
    }
  ],
  "product": "blitz-options",
  "scope": "per-user",
  "tools": {
    "get_candles": "read",
    "get_capabilities": "read",
    "get_limits": "read",
    "get_trade_history": "read",
    "list_assets": "read",
    "list_balances": "read",
    "list_positions": "read",
    "place_trade": "write",
    "rollover_position": "write",
    "sell_position": "write"
  }
}
```

### list_assets (657ms, status 200)

args: `{}`

```json
{
  "assets": [
    {
      "asset_id": 76,
      "expiration_sizes_seconds": [
        30,
        45,
        60,
        120,
        180,
        300
      ],
      "is_open": true,
      "name": "EUR/USD (OTC)",
      "precision": 6,
      "profit_percent": 89
    },
    {
      "asset_id": 77,
      "expiration_sizes_seconds": [
        30,
        45,
        60,
        120,
        180,
        300
      ],
      "is_open": true,
      "name": "EUR/GBP (OTC)",
      "precision": 6,
      "profit_percent": 89
    },
    {
      "asset_id": 78,
      "expiration_sizes_seconds": [
        30,
        45,
        60,
        120,
        180,
        300
      ],
      "is_open": true,
      "name": "USD/CHF (OTC)",
      "precision": 6,
      "profit_percent": 89
    },
    {
      "asset_id": 79,
      "expiration_sizes_seconds": [
        30,
        45,
        60,
        120,
        180,
        300
      ],
      "is_open": true,
      "name": "EUR/JPY (OTC)",
      "precision": 6,
      "profit_percent": 89
    },
    {
      "asset_id": 80,
      "expiration_sizes_seconds": [
        30,
        45,
        60,
        120,
        180,
        300
      ],
      "is_open": true,
      "name": "NZD/USD (OTC)",
      "precision": 6,
      "profit_percent": 89
    },
    {
      "asset_id": 81,
      "expiration_sizes_seconds": [
        30,
        45,
        60,
        120,
        180,
        300
      ],
      "is_open": true,
      "name": "GBP/USD (OTC)",
      "precision": 6,
      "profit_percent": 89
    },
    {
      "asset_id": 84,
      "expiration_sizes_seconds": [
        30,
        45,
        60,
        120,
        180,
        300
      ],
      "is_open": true,
      "name": "GBP/JPY (OTC)",
      "precision": 6,
      "profit_percent": 89
    },
    {
      "asset_id": 85,
      "expiration_sizes_seconds": [
        30,
        45,
        60,
        120,
        180,
        300
      ],
      "is_open": true,
      "name": "USD/JPY (OTC)",
      "precision": 5,
      "profit_percent": 89
    },
    {
      "asset_id": 86,
      "expiration_sizes_seconds": [
        30,
        45,
        60,
        120,
        180,
        300
      ],
      "is_open": true,
      "name": "AUD/CAD (OTC)",
      "precision": 6,
      "profit_percent": 89
    },
    {
      "asset_id": 1380,
      "expiration_sizes_seconds": [
        30,
        45,
        60,
        120,
        180,
        300
      ],
      "is_open": true,
      "name": "USD/ZAR (OTC)",
      "precision": 6,
      "profit_percent": 89
    },
    {
      "asset_id": 1470,
      "expiration_sizes_seconds": [
        120,
        180,
        300,
        600,
        900
      ],
      "is_open": true,
      "name": "US 500",
      "precision": 6,
      "profit_percent": 91
    },
    {
      "asset_id": 1471,
      "expiration_sizes_seconds": [
        60,
        120,
        180,
        300,
        600,
        900
      ],
      "is_open": true,
      "name": "US 100",
      "precision": 6,
      "profit_percent": 91
    },
    {
      "asset_id": 1472,
      "expiration_sizes_seconds": [
        60,
        120,
        180,
        300,
        600,
        900
      ],
      "is_open": true,
      "name": "US 30",
      "precision": 6,
      "profit_percent": 91
    },
    {
      "asset_id": 1473,
      "expiration_sizes_seconds": [
        60,
        120,
        180,
        300,
        600,
        900
      ],
      "is_open": true,
      "name": "US 2000",
      "precision": 6,
      "profit_percent": 91
    },
    {
      "asset_id": 1476,
      "expiration_sizes_seconds": [
        60,
        120,
        180,
        300,
        600,
        900
      ],
      "is_open": true,
      "name": "JP 225",
      "precision": 6,
      "profit_percent": 91
    },
    {
      "asset_id": 1857,
      "expiration_sizes_seconds": [
        30,
        45,
        60,
        120,
        180,
        300
      ],
     …
```

### list_balances (212ms, status 200)

args: `{}`

```json
{
  "balances": [
    {
      "amount": 0,
      "balance_id": 1250741746,
      "bonus_amount": 0,
      "currency": "BRL",
      "type": "regular"
    },
    {
      "amount": 60,
      "balance_id": 1250741747,
      "bonus_amount": 0,
      "currency": "USD",
      "type": "training"
    }
  ]
}
```

### list_positions (329ms, status 200)

args: `{"balance_id":1250741746}`

```json
{
  "positions": []
}
```

### get_trade_history (406ms, status 200)

args: `{}`

```json
{
  "history": []
}
```


## marginal-cfd — https://marginal-cfd.mcp.iqoption.com

- allowlist: `get_capabilities, get_limits, list_assets, list_balances, list_positions, get_trade_history, get_orders, get_instruments, calculate_order_size`
### get_capabilities (612ms, status 200)

args: `{}`

```json
{
  "mode": "read-write",
  "product": "marginal-cfd"
}
```

### get_limits (204ms, status 200)

args: `{}`

```json
{
  "buckets": [
    {
      "bucket": "gateway",
      "limit": 200,
      "window_seconds": 60
    },
    {
      "bucket": "read",
      "limit": 60,
      "window_seconds": 60
    },
    {
      "bucket": "write",
      "limit": 10,
      "window_seconds": 60
    }
  ],
  "product": "marginal-cfd",
  "scope": "per-user",
  "tools": {
    "calculate_order_size": "read",
    "cancel_pending_order": "write",
    "change_position_stop_loss": "write",
    "change_position_take_profit": "write",
    "close_position": "write",
    "get_candles": "read",
    "get_capabilities": "read",
    "get_instruments": "read",
    "get_limits": "read",
    "get_orders": "read",
    "get_trade_history": "read",
    "list_assets": "read",
    "list_balances": "read",
    "list_positions": "read",
    "place_limit_order": "write",
    "place_market_order": "write",
    "place_stop_order": "write"
  }
}
```

### list_assets (578ms, status 200)

args: `{}`

```json
{
  "assets": [
    {
      "asset_id": 74,
      "asset_type": "Commodity",
      "base_currency": "XAU",
      "is_open": true,
      "max_leverages": {
        "0": 800
      },
      "min_quantity": 1,
      "name": "Gold",
      "price_precision": 2,
      "quantity_presets": [
        1,
        2,
        3,
        4,
        5,
        7,
        10
      ],
      "quantity_step": 0.01,
      "quantity_unit": "oz",
      "quote_currency": "USD"
    },
    {
      "asset_id": 969,
      "asset_type": "Commodity",
      "base_currency": "UKO",
      "is_open": true,
      "max_leverages": {
        "0": 600
      },
      "min_quantity": 10,
      "name": "Crude Oil Brent",
      "price_precision": 2,
      "quantity_presets": [
        10,
        20,
        30,
        40,
        50,
        70,
        100
      ],
      "quantity_step": 0.01,
      "quantity_unit": "barrels",
      "quote_currency": "USD"
    },
    {
      "asset_id": 970,
      "asset_type": "Commodity",
      "base_currency": "XPT",
      "is_open": true,
      "max_leverages": {
        "0": 100
      },
      "min_quantity": 0.1,
      "name": "Platinum",
      "price_precision": 2,
      "quantity_presets": [
        0.1,
        0.2,
        0.3,
        0.4,
        0.5,
        0.7,
        1
      ],
      "quantity_step": 0.1,
      "quantity_unit": "oz",
      "quote_currency": "USD"
    },
    {
      "asset_id": 971,
      "asset_type": "Commodity",
      "base_currency": "USO",
      "is_open": true,
      "max_leverages": {
        "0": 600
      },
      "min_quantity": 10,
      "name": "Crude Oil WTI",
      "price_precision": 2,
      "quantity_presets": [
        10,
        20,
        30,
        40,
        50,
        70,
        100
      ],
      "quantity_step": 0.01,
      "quantity_unit": "barrels",
      "quote_currency": "USD"
    },
    {
      "asset_id": 1470,
      "asset_type": "Index",
      "base_currency": "SPX",
      "is_open": true,
      "max_leverages": {
        "0": 1000
      },
      "min_quantity": 0.01,
      "name": "US 500",
      "price_precision": 2,
      "quantity_presets": [
        0.01,
        0.02,
        0.03,
        0.04,
        0.05,
        0.07,
        0.1
      ],
      "quantity_step": 0.01,
      "quantity_unit": "lots",
      "quote_currency": "USD"
    },
    {
      "asset_id": 1471,
      "asset_type": "Index",
      "base_currency": "NDQ",
      "is_open": true,
      "max_leverages": {
        "0": 1000
      },
      "min_quantity": 0.01,
      "name": "US 100",
      "price_precision": 2,
      "quantity_presets": [
        0.01,
        0.02,
        0.03,
        0.04,
        0.05,
        0.07,
        0.1
      ],
      "quantity_step": 0.01,
      "quantity_unit": "lots",
      "quote_currency": "USD"
    },
    {
      "asset_id": 1472,
      "asset_type": "Index",
      "base_currency": "DOW",
      "is_open": true,
      "max_leverages": {
        "0": 1000
      },
      "min_quantity": 0.01,
      "name": "US 30",
      "price_precision": 2,
      "quantity_presets": [
        0.01,
        0.02,
        0.03,
        0.04,
        0.05,
        0.07,
        0.1
      ],
      "quantity_step": 0.01,
      "quantity_unit": "lots",
      "quote_currency": "USD"
    },
    {
      "asset_id": 1473,
      "asset_type": "Index",
      "base_currency": "US2000",
      "is_open": true,
      "max_leverages": {
        "0": 200
      },
      "min_quantity": 0.01,
      "name": "US 2000",
      "price_precision": 2,
      "quantity_presets": [
        0.01,
        0.02,
        0.03,
        0.04,
        0.05,
        0.07,
        0.1
      ],
      "quantity_step": 0.01,
      "quantity_unit": "lots",
      "quote_currency": "USD"
    },
    {
      "asset_id": 1475,
      "asset_type": "Index",
      "base_currency": "FTS",
      "is_open": true,
      "max_leverages": {
        "0": 1000
      },
      "min_quantity": 0.01,
      "name": "UK 100",
      "pr…
```

### list_balances (217ms, status 200)

args: `{"types":"ALL"}`

```json
{
  "balances": [
    {
      "amount": 0,
      "balance_id": 1250741746,
      "bonus_amount": 0,
      "currency": "BRL",
      "dividends": 0,
      "equity": 0,
      "equity_usd": 0,
      "free_margin": 0,
      "isolated_dividends": 0,
      "isolated_margin": 0,
      "isolated_pnl": 0,
      "isolated_pnl_net": 0,
      "isolated_swap": 0,
      "margin": 0,
      "margin_level": 0,
      "pnl": 0,
      "pnl_net": 0,
      "stop_out_level": 50,
      "swap": 0,
      "type": "regular"
    },
    {
      "amount": 60,
      "balance_id": 1250741747,
      "bonus_amount": 0,
      "currency": "USD",
      "dividends": 0,
      "equity": 60,
      "equity_usd": 60,
      "free_margin": 60,
      "isolated_dividends": 0,
      "isolated_margin": 0,
      "isolated_pnl": 0,
      "isolated_pnl_net": 0,
      "isolated_swap": 0,
      "margin": 0,
      "margin_level": 0,
      "pnl": 0,
      "pnl_net": 0,
      "stop_out_level": 50,
      "swap": 0,
      "type": "training"
    }
  ]
}
```

### list_positions (206ms, status 200)

args: `{"balance_id":1250741746}`

```json
{
  "positions": []
}
```

### get_trade_history (270ms, status 200)

args: `{"balance_id":1250741746}`

```json
{
  "history": []
}
```

### get_orders (207ms, status 200)

args: `{"balance_id":1250741746}`

```json
{
  "orders": []
}
```

### get_instruments (215ms, status 200)

args: `{"asset_id":74}`

```json
{
  "instruments": [
    {
      "asset_id": 74,
      "instrument_id": "mcfd.74",
      "lot_size": 1,
      "min_quantity": 1,
      "quantity_step": 0.01,
      "spread_markup": 0.035,
      "stop_levels": {
        "stop_loss": 1,
        "take_profit": 1
      }
    }
  ],
  "leverage_profiles": [
    {
      "min_leverage": 20,
      "tiers": [
        {
          "max_equity_usd": 40000,
          "max_leverage": 800,
          "min_equity_usd": 0
        },
        {
          "max_equity_usd": 80000,
          "max_leverage": 400,
          "min_equity_usd": 40000
        },
        {
          "max_equity_usd": 100000,
          "max_leverage": 300,
          "min_equity_usd": 80000
        },
        {
          "max_equity_usd": 10010000,
          "max_leverage": 200,
          "min_equity_usd": 100000
        },
        {
          "max_equity_usd": 10020000,
          "max_leverage": 100,
          "min_equity_usd": 10010000
        },
        {
          "max_equity_usd": 10030000,
          "max_leverage": 50,
          "min_equity_usd": 10020000
        },
        {
          "max_leverage": 20,
          "min_equity_usd": 10030000
        }
      ]
    }
  ]
}
```

### calculate_order_size (633ms, status 200)

args: `{"asset_id":74,"balance_currency":"BRL","leverage":1,"lots":1}`

```json
{
  "buy_price": 4359.76,
  "leverage": 1,
  "lots": 1,
  "margin": 22551.183695999996,
  "notional": 22551.183695999996,
  "sell_price": 4359.38,
  "units": 1
}
```


## marginal-crypto — https://marginal-crypto.mcp.iqoption.com

- allowlist: `get_capabilities, get_limits, list_assets, list_balances, list_positions, get_trade_history, get_orders, get_instruments, calculate_order_size`
### get_capabilities (599ms, status 200)

args: `{}`

```json
{
  "mode": "read-write",
  "product": "marginal-crypto"
}
```

### get_limits (198ms, status 200)

args: `{}`

```json
{
  "buckets": [
    {
      "bucket": "gateway",
      "limit": 200,
      "window_seconds": 60
    },
    {
      "bucket": "read",
      "limit": 60,
      "window_seconds": 60
    },
    {
      "bucket": "write",
      "limit": 10,
      "window_seconds": 60
    }
  ],
  "product": "marginal-crypto",
  "scope": "per-user",
  "tools": {
    "calculate_order_size": "read",
    "cancel_pending_order": "write",
    "change_position_stop_loss": "write",
    "change_position_take_profit": "write",
    "close_position": "write",
    "get_candles": "read",
    "get_capabilities": "read",
    "get_instruments": "read",
    "get_limits": "read",
    "get_orders": "read",
    "get_trade_history": "read",
    "list_assets": "read",
    "list_balances": "read",
    "list_positions": "read",
    "place_limit_order": "write",
    "place_market_order": "write",
    "place_stop_order": "write"
  }
}
```

### list_assets (465ms, status 200)

args: `{}`

```json
{
  "assets": [
    {
      "asset_id": 816,
      "asset_type": "Crypto",
      "base_currency": "BTC",
      "is_open": true,
      "max_leverages": {
        "0": 20
      },
      "min_quantity": 0.001,
      "name": "Bitcoin",
      "price_precision": 2,
      "quantity_presets": [
        0.001,
        0.002,
        0.003,
        0.004,
        0.005,
        0.007,
        0.01
      ],
      "quantity_step": 0.001,
      "quantity_unit": "lots",
      "quote_currency": "USD"
    },
    {
      "asset_id": 817,
      "asset_type": "Crypto",
      "base_currency": "XRP",
      "is_open": true,
      "max_leverages": {
        "0": 5
      },
      "min_quantity": 100,
      "name": "Ripple",
      "price_precision": 2,
      "quantity_presets": [
        100,
        200,
        300,
        400,
        500,
        700,
        1000
      ],
      "quantity_step": 1,
      "quantity_unit": "lots",
      "quote_currency": "USD"
    },
    {
      "asset_id": 818,
      "asset_type": "Crypto",
      "base_currency": "ETH",
      "is_open": true,
      "max_leverages": {
        "0": 5
      },
      "min_quantity": 0.01,
      "name": "Ethereum",
      "price_precision": 2,
      "quantity_presets": [
        0.01,
        0.02,
        0.03,
        0.04,
        0.05,
        0.07,
        0.1
      ],
      "quantity_step": 0.001,
      "quantity_unit": "lots",
      "quote_currency": "USD"
    },
    {
      "asset_id": 819,
      "asset_type": "Crypto",
      "base_currency": "LTC",
      "is_open": true,
      "max_leverages": {
        "0": 3
      },
      "min_quantity": 1,
      "name": "Litecoin",
      "price_precision": 2,
      "quantity_presets": [
        1,
        2,
        3,
        4,
        5,
        7,
        10
      ],
      "quantity_step": 0.01,
      "quantity_unit": "lots",
      "quote_currency": "USD"
    },
    {
      "asset_id": 821,
      "asset_type": "Crypto",
      "base_currency": "DAH",
      "is_open": true,
      "max_leverages": {
        "0": 3
      },
      "min_quantity": 1,
      "name": "Dash",
      "price_precision": 2,
      "quantity_presets": [
        1,
        2,
        3,
        4,
        5,
        7,
        10
      ],
      "quantity_step": 0.01,
      "quantity_unit": "lots",
      "quote_currency": "USD"
    },
    {
      "asset_id": 824,
      "asset_type": "Crypto",
      "base_currency": "BCH",
      "is_open": true,
      "max_leverages": {
        "0": 3
      },
      "min_quantity": 0.1,
      "name": "Bitcoin Cash",
      "price_precision": 2,
      "quantity_presets": [
        0.1,
        0.2,
        0.3,
        0.4,
        0.5,
        0.7,
        1
      ],
      "quantity_step": 0.01,
      "quantity_unit": "lots",
      "quote_currency": "USD"
    },
    {
      "asset_id": 826,
      "asset_type": "Crypto",
      "base_currency": "ZEC",
      "is_open": true,
      "max_leverages": {
        "0": 3
      },
      "min_quantity": 1,
      "name": "ZCash",
      "price_precision": 2,
      "quantity_presets": [
        1,
        2,
        3,
        4,
        5,
        7,
        10
      ],
      "quantity_step": 0.01,
      "quantity_unit": "lots",
      "quote_currency": "USD"
    },
    {
      "asset_id": 829,
      "asset_type": "Crypto",
      "base_currency": "ETC",
      "is_open": true,
      "max_leverages": {
        "0": 3
      },
      "min_quantity": 1,
      "name": "Ethereum Classic",
      "price_precision": 2,
      "quantity_presets": [
        1,
        2,
        3,
        4,
        5,
        7,
        10
      ],
      "quantity_step": 0.1,
      "quantity_unit": "lots",
      "quote_currency": "USD"
    },
    {
      "asset_id": 831,
      "asset_type": "Crypto",
      "base_currency": "ETH",
      "is_open": true,
      "max_leverages": {
        "0": 500
      },
      "min_quantity": 0.08,
      "name": "Ethereum-PerpFuture",
      "price_precision": 2,
      "quantity_presets": [
        1,…
```

### list_balances (217ms, status 200)

args: `{"types":"ALL"}`

```json
{
  "balances": [
    {
      "amount": 0,
      "balance_id": 1250741746,
      "bonus_amount": 0,
      "currency": "BRL",
      "dividends": 0,
      "equity": 0,
      "equity_usd": 0,
      "free_margin": 0,
      "isolated_dividends": 0,
      "isolated_margin": 0,
      "isolated_pnl": 0,
      "isolated_pnl_net": 0,
      "isolated_swap": 0,
      "margin": 0,
      "margin_level": 0,
      "pnl": 0,
      "pnl_net": 0,
      "stop_out_level": 50,
      "swap": 0,
      "type": "regular"
    },
    {
      "amount": 60,
      "balance_id": 1250741747,
      "bonus_amount": 0,
      "currency": "USD",
      "dividends": 0,
      "equity": 60,
      "equity_usd": 60,
      "free_margin": 60,
      "isolated_dividends": 0,
      "isolated_margin": 0,
      "isolated_pnl": 0,
      "isolated_pnl_net": 0,
      "isolated_swap": 0,
      "margin": 0,
      "margin_level": 0,
      "pnl": 0,
      "pnl_net": 0,
      "stop_out_level": 50,
      "swap": 0,
      "type": "training"
    }
  ]
}
```

### list_positions (218ms, status 200)

args: `{"balance_id":1250741746}`

```json
{
  "positions": []
}
```

### get_trade_history (277ms, status 200)

args: `{"balance_id":1250741746}`

```json
{
  "history": []
}
```

### get_orders (242ms, status 200)

args: `{"balance_id":1250741746}`

```json
{
  "orders": []
}
```

### get_instruments (210ms, status 200)

args: `{"asset_id":816}`

```json
{
  "instruments": [
    {
      "asset_id": 816,
      "instrument_id": "mcrpt.816",
      "lot_size": 1,
      "min_quantity": 0.001,
      "quantity_step": 0.001,
      "spread_markup": 10,
      "stop_levels": {
        "stop_loss": 1,
        "take_profit": 1
      }
    }
  ],
  "leverage_profiles": [
    {
      "min_leverage": 5,
      "tiers": [
        {
          "max_equity_usd": 10000100,
          "max_leverage": 20,
          "min_equity_usd": 0
        },
        {
          "max_equity_usd": 10001000,
          "max_leverage": 15,
          "min_equity_usd": 10000100
        },
        {
          "max_equity_usd": 10010000,
          "max_leverage": 10,
          "min_equity_usd": 10001000
        },
        {
          "max_leverage": 5,
          "min_equity_usd": 10010000
        }
      ]
    }
  ]
}
```

### calculate_order_size (278ms, status 200)

args: `{"asset_id":816,"balance_currency":"BRL","leverage":1,"lots":0.001}`

```json
{
  "buy_price": 76598.01,
  "leverage": 1,
  "lots": 0.001,
  "margin": 396.174432264,
  "notional": 396.174432264,
  "sell_price": 76578,
  "units": 0.001
}
```


## marginal-forex — https://marginal-forex.mcp.iqoption.com

- allowlist: `get_capabilities, get_limits, list_assets, list_balances, list_positions, get_trade_history, get_orders, get_instruments, calculate_order_size`
### get_capabilities (599ms, status 200)

args: `{}`

```json
{
  "mode": "read-write",
  "product": "marginal-forex"
}
```

### get_limits (210ms, status 200)

args: `{}`

```json
{
  "buckets": [
    {
      "bucket": "gateway",
      "limit": 200,
      "window_seconds": 60
    },
    {
      "bucket": "read",
      "limit": 60,
      "window_seconds": 60
    },
    {
      "bucket": "write",
      "limit": 10,
      "window_seconds": 60
    }
  ],
  "product": "marginal-forex",
  "scope": "per-user",
  "tools": {
    "calculate_order_size": "read",
    "cancel_pending_order": "write",
    "change_position_stop_loss": "write",
    "change_position_take_profit": "write",
    "close_position": "write",
    "get_candles": "read",
    "get_capabilities": "read",
    "get_instruments": "read",
    "get_limits": "read",
    "get_orders": "read",
    "get_trade_history": "read",
    "list_assets": "read",
    "list_balances": "read",
    "list_positions": "read",
    "place_limit_order": "write",
    "place_market_order": "write",
    "place_stop_order": "write"
  }
}
```

### list_assets (265ms, status 200)

args: `{}`

```json
{
  "assets": [
    {
      "asset_id": 1,
      "asset_type": "Forex",
      "base_currency": "EUR",
      "is_open": true,
      "max_leverages": {
        "0": 5000
      },
      "min_quantity": 0.001,
      "name": "EUR/USD",
      "price_precision": 4,
      "quantity_presets": [
        0.001,
        0.01,
        0.1,
        0.2,
        0.3,
        0.5,
        1
      ],
      "quantity_step": 0.001,
      "quantity_unit": "lots",
      "quote_currency": "USD"
    },
    {
      "asset_id": 2,
      "asset_type": "Forex",
      "base_currency": "EUR",
      "is_open": true,
      "max_leverages": {
        "0": 5000
      },
      "min_quantity": 0.001,
      "name": "EUR/GBP",
      "price_precision": 4,
      "quantity_presets": [
        0.001,
        0.01,
        0.1,
        0.2,
        0.3,
        0.5,
        1
      ],
      "quantity_step": 0.001,
      "quantity_unit": "lots",
      "quote_currency": "GBP"
    },
    {
      "asset_id": 3,
      "asset_type": "Forex",
      "base_currency": "GBP",
      "is_open": true,
      "max_leverages": {
        "0": 5000
      },
      "min_quantity": 0.001,
      "name": "GBP/JPY",
      "price_precision": 2,
      "quantity_presets": [
        0.001,
        0.01,
        0.1,
        0.2,
        0.3,
        0.5,
        1
      ],
      "quantity_step": 0.001,
      "quantity_unit": "lots",
      "quote_currency": "JPY"
    },
    {
      "asset_id": 4,
      "asset_type": "Forex",
      "base_currency": "EUR",
      "is_open": true,
      "max_leverages": {
        "0": 1000
      },
      "min_quantity": 0.001,
      "name": "EUR/JPY",
      "price_precision": 2,
      "quantity_presets": [
        0.001,
        0.01,
        0.1,
        0.2,
        0.3,
        0.5,
        1
      ],
      "quantity_step": 0.001,
      "quantity_unit": "lots",
      "quote_currency": "JPY"
    },
    {
      "asset_id": 5,
      "asset_type": "Forex",
      "base_currency": "GBP",
      "is_open": true,
      "max_leverages": {
        "0": 5000
      },
      "min_quantity": 0.001,
      "name": "GBP/USD",
      "price_precision": 4,
      "quantity_presets": [
        0.001,
        0.01,
        0.1,
        0.2,
        0.3,
        0.5,
        1
      ],
      "quantity_step": 0.001,
      "quantity_unit": "lots",
      "quote_currency": "USD"
    },
    {
      "asset_id": 6,
      "asset_type": "Forex",
      "base_currency": "USD",
      "is_open": true,
      "max_leverages": {
        "0": 1000
      },
      "min_quantity": 0.001,
      "name": "USD/JPY",
      "price_precision": 2,
      "quantity_presets": [
        0.001,
        0.01,
        0.1,
        0.2,
        0.3,
        0.5,
        1
      ],
      "quantity_step": 0.001,
      "quantity_unit": "lots",
      "quote_currency": "JPY"
    },
    {
      "asset_id": 7,
      "asset_type": "Forex",
      "base_currency": "AUD",
      "is_open": true,
      "max_leverages": {
        "0": 500
      },
      "min_quantity": 0.001,
      "name": "AUD/CAD",
      "price_precision": 4,
      "quantity_presets": [
        0.001,
        0.01,
        0.1,
        0.2,
        0.3,
        0.5,
        1
      ],
      "quantity_step": 0.001,
      "quantity_unit": "lots",
      "quote_currency": "CAD"
    },
    {
      "asset_id": 8,
      "asset_type": "Forex",
      "base_currency": "NZD",
      "is_open": true,
      "max_leverages": {
        "0": 5000
      },
      "min_quantity": 0.001,
      "name": "NZD/USD",
      "price_precision": 4,
      "quantity_presets": [
        0.001,
        0.01,
        0.1,
        0.2,
        0.3,
        0.5,
        1
      ],
      "quantity_step": 0.001,
      "quantity_unit": "lots",
      "quote_currency": "USD"
    },
    {
      "asset_id": 72,
      "asset_type": "Forex",
      "base_currency": "USD",
      "is_open": true,
      "max_leverages": {
        "0": 5000
      },
      "min_quantity": 0.001,
      "name": "USD/CHF",
      "price_prec…
```

### list_balances (230ms, status 200)

args: `{"types":"ALL"}`

```json
{
  "balances": [
    {
      "amount": 0,
      "balance_id": 1250741746,
      "bonus_amount": 0,
      "currency": "BRL",
      "dividends": 0,
      "equity": 0,
      "equity_usd": 0,
      "free_margin": 0,
      "isolated_dividends": 0,
      "isolated_margin": 0,
      "isolated_pnl": 0,
      "isolated_pnl_net": 0,
      "isolated_swap": 0,
      "margin": 0,
      "margin_level": 0,
      "pnl": 0,
      "pnl_net": 0,
      "stop_out_level": 50,
      "swap": 0,
      "type": "regular"
    },
    {
      "amount": 60,
      "balance_id": 1250741747,
      "bonus_amount": 0,
      "currency": "USD",
      "dividends": 0,
      "equity": 60,
      "equity_usd": 60,
      "free_margin": 60,
      "isolated_dividends": 0,
      "isolated_margin": 0,
      "isolated_pnl": 0,
      "isolated_pnl_net": 0,
      "isolated_swap": 0,
      "margin": 0,
      "margin_level": 0,
      "pnl": 0,
      "pnl_net": 0,
      "stop_out_level": 50,
      "swap": 0,
      "type": "training"
    }
  ]
}
```

### list_positions (215ms, status 200)

args: `{"balance_id":1250741746}`

```json
{
  "positions": []
}
```

### get_trade_history (254ms, status 200)

args: `{"balance_id":1250741746}`

```json
{
  "history": []
}
```

### get_orders (229ms, status 200)

args: `{"balance_id":1250741746}`

```json
{
  "orders": []
}
```

### get_instruments (208ms, status 200)

args: `{"asset_id":1}`

```json
{
  "instruments": [
    {
      "asset_id": 1,
      "instrument_id": "mf.1",
      "lot_size": 100000,
      "min_quantity": 0.001,
      "quantity_step": 0.001,
      "spread_markup": 0.00003,
      "stop_levels": {
        "stop_loss": 0.0002,
        "take_profit": 0.0002
      }
    }
  ],
  "leverage_profiles": [
    {
      "min_leverage": 50,
      "tiers": [
        {
          "max_equity_usd": 1000,
          "max_leverage": 5000,
          "min_equity_usd": 0
        },
        {
          "max_equity_usd": 3000,
          "max_leverage": 3000,
          "min_equity_usd": 1000
        },
        {
          "max_equity_usd": 5000,
          "max_leverage": 2000,
          "min_equity_usd": 3000
        },
        {
          "max_equity_usd": 40000,
          "max_leverage": 1000,
          "min_equity_usd": 5000
        },
        {
          "max_equity_usd": 80000,
          "max_leverage": 500,
          "min_equity_usd": 40000
        },
        {
          "max_equity_usd": 100000,
          "max_leverage": 400,
          "min_equity_usd": 80000
        },
        {
          "max_leverage": 300,
          "min_equity_usd": 100000
        }
      ]
    }
  ]
}
```

### calculate_order_size (267ms, status 200)

args: `{"asset_id":1,"balance_currency":"BRL","leverage":1,"lots":0.001}`

```json
{
  "buy_price": 1.148,
  "leverage": 1,
  "lots": 0.001,
  "margin": 593.811576,
  "notional": 593.811576,
  "sell_price": 1.1479,
  "units": 100
}
```

