# Binary/Turbo — read-only probe (Fase 3)

Generated: 2026-09-18T01:15:34.891Z
Authenticated: true

Tools chamadas: `get_capabilities`, `get_limits`, `list_assets`, `list_balances` (allowlist). Nenhuma tool de ordem.

## binary

### get_capabilities (602ms)
```json
{"mode":"read-write","product":"binary-options"}
```

### get_limits (213ms)
```json
{"buckets":[{"bucket":"gateway","limit":200,"window_seconds":60},{"bucket":"read","limit":60,"window_seconds":60},{"bucket":"write","limit":10,"window_seconds":60}],"product":"binary-options","scope":"per-user","tools":{"get_candles":"read","get_capabilities":"read","get_limits":"read","get_trade_history":"read","list_assets":"read","list_balances":"read","list_positions":"read","place_trade":"write","rollover_position":"write","sell_position":"write"}}
```

### list_assets (665ms)
```json
{"assets":[{"asset_id":76,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"EUR/USD (OTC)","precision":6,"profit_percent":89},{"asset_id":77,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"EUR/GBP (OTC)","precision":6,"profit_percent":87},{"asset_id":78,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"USD/CHF (OTC)","precision":6,"profit_percent":90},{"asset_id":79,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"EUR/JPY (OTC)","precision":6,"profit_percent":90},{"asset_id":80,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"NZD/USD (OTC)","precision":6,"profit_percent":90},{"asset_id":81,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"GBP/USD (OTC)","precision":6,"profit_percent":90},{"asset_id":84,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"GBP/JPY (OTC)","precision":6,"profit_percent":90},{"asset_id":85,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"USD/JPY (OTC)","precision":5,"profit_percent":88},{"asset_id":86,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"AUD/CAD (OTC)","precision":6,"profit_percent":89},{"asset_id":1380,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"USD/ZAR (OTC)","precision":6,"profit_percent":90},{"asset_id":1383,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"USD/INR (OTC)","precision":4,"profit_percent":90},{"asset_id":1470,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"US 500","precision":6,"profit_percent":91},{"asset_id":1471,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"US 100","precision":6,"profit_percent":91},{"asset_id":1472,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"US 30","precision":6,"profit_percent":91},{"asset_id":1473,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"US 2000","precision":6,"profit_percent":91},{"asset_id":1476,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"JP 225","precision":6,"profit_percent":91},{"asset_id":1857,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"XAUUSD (OTC)","precision":6,"profit_percent":89},{"asset_id":1859,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"USOUSD (OTC)","precision":6,"profit_percent":90},{"asset_id":1861,"expirations":[1789695000,1789695900,1789696800,1789697700,1789698600],"is_open":true,"name":"EUR/USD","precision":6,"profit_perc…
```

### list_balances (221ms)
```json
{"balances":[{"amount":0,"balance_id":1250741746,"bonus_amount":0,"currency":"BRL","type":"regular"},{"amount":60,"balance_id":1250741747,"bonus_amount":0,"currency":"USD","type":"training"}]}
```

## turbo

### get_capabilities (610ms)
```json
{"mode":"read-write","product":"turbo-options"}
```

### get_limits (201ms)
```json
{"buckets":[{"bucket":"gateway","limit":200,"window_seconds":60},{"bucket":"read","limit":60,"window_seconds":60},{"bucket":"write","limit":10,"window_seconds":60}],"product":"turbo-options","scope":"per-user","tools":{"get_candles":"read","get_capabilities":"read","get_limits":"read","get_trade_history":"read","list_assets":"read","list_balances":"read","list_positions":"read","place_trade":"write","rollover_position":"write","sell_position":"write"}}
```

### list_assets (602ms)
```json
{"assets":[{"asset_id":76,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"EUR/USD (OTC)","precision":6,"profit_percent":86},{"asset_id":77,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"EUR/GBP (OTC)","precision":6,"profit_percent":86},{"asset_id":78,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"USD/CHF (OTC)","precision":6,"profit_percent":86},{"asset_id":79,"buyback_deadtime_seconds":15,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"EUR/JPY (OTC)","precision":6,"profit_percent":86},{"asset_id":80,"buyback_deadtime_seconds":15,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"NZD/USD (OTC)","precision":6,"profit_percent":86},{"asset_id":81,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"GBP/USD (OTC)","precision":6,"profit_percent":86},{"asset_id":84,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"GBP/JPY (OTC)","precision":6,"profit_percent":86},{"asset_id":86,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"AUD/CAD (OTC)","precision":6,"profit_percent":86},{"asset_id":1380,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"USD/ZAR (OTC)","precision":6,"profit_percent":86},{"asset_id":1383,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"USD/INR (OTC)","precision":4,"profit_percent":86},{"asset_id":1470,"buyback_deadtime_seconds":15,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"US 500","precision":6,"profit_percent":91},{"asset_id":1471,"buyback_deadtime_seconds":15,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"US 100","precision":6,"profit_percent":91},{"asset_id":1472,"buyback_deadtime_seconds":15,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"US 30","precision":6,"profit_percent":90},{"asset_id":1473,"buyback_deadtime_seconds":15,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"US 2000","precision":6,"profit_percent":89},{"asset_id":1476,"buyback_deadtime_seconds":15,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"JP 225","precision":6,"profit_percent":91},{"asset_id":1857,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"XAUUSD (OTC)","precision":6,"profit_percent":86},{"asset_id":1859,"expirations":[1789694220,1789694280,1789694340,1789694400,1789694460],"is_open":true,"name":"USOUSD (OTC)","precision":6,"profit_percent":86},{"asset_id":1861,"buyback_deadtime_seconds":15,"expirations":[1789694220,1789694280,1789694340,…
```

### list_balances (221ms)
```json
{"balances":[{"amount":0,"balance_id":1250741746,"bonus_amount":0,"currency":"BRL","type":"regular"},{"amount":60,"balance_id":1250741747,"bonus_amount":0,"currency":"USD","type":"training"}]}
```
