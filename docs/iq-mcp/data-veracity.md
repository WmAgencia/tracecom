# IQ Official MCP — Data veracity (7 servers, read-only, PRACTICE)

Generated: 2026-09-18T03:05:30.231Z
Authenticated: true
TraceCom office source: `https://tracecom.consecom.com.br/api/iq/office` (HTTP 200, 55 markets)

> All calls allowlisted SAFE_READ / ACCOUNT_READ (`get_capabilities`, `get_limits`, `list_assets`, `list_balances`, `get_candles`, `get_instruments`). No order tool was called. Token never stored; payloads redacted.

## 0. What was called

- **binary-options** (10 tools listed): get_capabilities:ok, get_limits:ok, list_assets:ok, list_balances:ok, get_candles(US500:NORMAL):60 bars, get_candles(EURUSD:OTC):60 bars, get_candles(EURUSD:NORMAL):60 bars
- **turbo-options** (10 tools listed): get_capabilities:ok, get_limits:ok, list_assets:ok, list_balances:ok, get_candles(US500:NORMAL):60 bars, get_candles(EURUSD:OTC):60 bars, get_candles(EURUSD:NORMAL):60 bars
- **blitz-options** (10 tools listed): get_capabilities:ok, get_limits:ok, list_assets:ok, list_balances:ok, get_candles(US500:NORMAL):60 bars, get_candles(EURUSD:OTC):60 bars, get_candles(EURUSD:NORMAL):60 bars
- **digital-options** (11 tools listed): get_capabilities:ok, get_limits:ok, list_assets:ok, list_balances:ok, get_candles(US500:NORMAL):60 bars, get_candles(EURUSD:OTC):60 bars, get_candles(EURUSD:NORMAL):60 bars, get_instruments(asset 1470):ok
- **marginal-cfd** (17 tools listed): get_capabilities:ok, get_limits:ok, list_assets:ok, list_balances:ok, get_candles(US500:NORMAL):60 bars, get_instruments(asset 1470):ok
- **marginal-crypto** (17 tools listed): get_capabilities:ok, get_limits:ok, list_assets:ok, list_balances:ok
- **marginal-forex** (17 tools listed): get_capabilities:ok, get_limits:ok, list_assets:ok, list_balances:ok, get_candles(EURUSD:NORMAL):60 bars, get_instruments(asset 1):ok

## 1. Asset coverage per server

| server | assets | is_open=true | is_open=false | NORMAL | OTC | types |
|---|---|---|---|---|---|---|
| binary-options | 125 | 125 | 0 | 30 | 95 | UNKNOWN:125 |
| turbo-options | 125 | 125 | 0 | 21 | 104 | UNKNOWN:125 |
| blitz-options | 129 | 129 | 0 | 28 | 101 | UNKNOWN:129 |
| digital-options | 130 | 130 | 0 | 28 | 102 | Forex:68, Index:9, Commodity:14, Crypto:33, Stock:6 |
| marginal-cfd | 82 | 82 | 0 | 82 | 0 | Commodity:13, Index:19, Stock:50 |
| marginal-crypto | 80 | 80 | 0 | 80 | 0 | Crypto:80 |
| marginal-forex | 43 | 43 | 0 | 43 | 0 | Forex:43 |

## 2. TraceCom 55-market coverage (strict NORMAL vs OTC)

TraceCom markets: 55 total (24 NORMAL + 31 OTC). Match = canonical symbol equal AND OTC flag equal.

| server | matched/55 | NORMAL | OTC | unmatched | richness score |
|---|---|---|---|---|---|
| binary-options | 42/55 | 13/24 | 29/31 | 13 | 6 |
| turbo-options | 43/55 | 13/24 | 30/31 | 12 | 6 |
| blitz-options | 43/55 | 13/24 | 30/31 | 12 | 5 |
| digital-options | 44/55 | 14/24 | 30/31 | 11 | 2 |
| marginal-cfd | 10/55 | 10/24 | 0/31 | 45 | 1 |
| marginal-crypto | 0/55 | 0/24 | 0/31 | 55 | 1 |
| marginal-forex | 10/55 | 10/24 | 0/31 | 45 | 1 |

**Best catalog source by strict coverage: `digital-options` — 44/55 markets matched (14 NORMAL + 30 OTC), asset-field richness score 2.**
Coverage ranking: `digital-options` 44/55 (richness 2) · `turbo-options` 43/55 (richness 6, payout) · `blitz-options` 43/55 (richness 5, payout) · `binary-options` 42/55 (richness 6, payout) · `marginal-cfd` 10/55 (richness 1) · `marginal-forex` 10/55 (richness 1).

Full symbol list of `digital-options` (130 rows, 130 open):

```text
EUR/USD (OTC) | asset_id=76 | OPEN | OTC
EUR/GBP (OTC) | asset_id=77 | OPEN | OTC
USD/CHF (OTC) | asset_id=78 | OPEN | OTC
EUR/JPY (OTC) | asset_id=79 | OPEN | OTC
NZD/USD (OTC) | asset_id=80 | OPEN | OTC
GBP/USD (OTC) | asset_id=81 | OPEN | OTC
GBP/JPY (OTC) | asset_id=84 | OPEN | OTC
USD/JPY (OTC) | asset_id=85 | OPEN | OTC
AUD/CAD (OTC) | asset_id=86 | OPEN | OTC
USD/ZAR (OTC) | asset_id=1380 | OPEN | OTC
USD/SGD (OTC) | asset_id=1381 | OPEN | OTC
USD/HKD (OTC) | asset_id=1382 | OPEN | OTC
USD/INR (OTC) | asset_id=1383 | OPEN | OTC
US 500 | asset_id=1470 | OPEN | NORMAL
US 100 | asset_id=1471 | OPEN | NORMAL
US 30 | asset_id=1472 | OPEN | NORMAL
US 2000 | asset_id=1473 | OPEN | NORMAL
JP 225 | asset_id=1476 | OPEN | NORMAL
XAUUSD (OTC) | asset_id=1857 | OPEN | OTC
USOUSD (OTC) | asset_id=1859 | OPEN | OTC
EUR/USD | asset_id=1861 | OPEN | NORMAL
EUR/JPY | asset_id=1864 | OPEN | NORMAL
USD/JPY | asset_id=1865 | OPEN | NORMAL
GBP/JPY | asset_id=1866 | OPEN | NORMAL
GBP/USD | asset_id=1867 | OPEN | NORMAL
AUD/CAD | asset_id=1868 | OPEN | NORMAL
AUD/JPY | asset_id=1869 | OPEN | NORMAL
AUD/USD | asset_id=1870 | OPEN | NORMAL
CAD/JPY | asset_id=1872 | OPEN | NORMAL
EUR/AUD | asset_id=1874 | OPEN | NORMAL
GBP/AUD | asset_id=1877 | OPEN | NORMAL
GBP/NZD | asset_id=1880 | OPEN | NORMAL
NZD/CAD | asset_id=1881 | OPEN | NORMAL
AUD/CHF | asset_id=1884 | OPEN | NORMAL
NZD/USD | asset_id=1896 | OPEN | NORMAL
AUD/NZD | asset_id=1900 | OPEN | NORMAL
EUR/NZD | asset_id=1901 | OPEN | NORMAL
Gold | asset_id=1912 | OPEN | NORMAL
Silver | asset_id=1913 | OPEN | NORMAL
Crude Oil WTI | asset_id=1914 | OPEN | NORMAL
Crude Oil Brent | asset_id=1915 | OPEN | NORMAL
UKOUSD (OTC) | asset_id=1931 | OPEN | OTC
ETH/USD (OTC) | asset_id=1941 | OPEN | OTC
CARDANO (OTC) | asset_id=1974 | OPEN | OTC
SHIB/USD (OTC) | asset_id=1975 | OPEN | OTC
TRON/USD (OTC) | asset_id=1976 | OPEN | OTC
DOGECOIN (OTC) | asset_id=1977 | OPEN | OTC
SOL/USD (OTC) | asset_id=1978 | OPEN | OTC
JP 225 (OTC) | asset_id=2051 | OPEN | OTC
Gold/Silver | asset_id=2071 | OPEN | NORMAL
US100/JP225 (OTC) | asset_id=2080 | OPEN | OTC
GER30/UK100 (OTC) | asset_id=2093 | OPEN | OTC
Ripple (OTC) | asset_id=2107 | OPEN | OTC
AUD/USD (OTC) | asset_id=2111 | OPEN | OTC
USD/CAD (OTC) | asset_id=2112 | OPEN | OTC
AUD/JPY (OTC) | asset_id=2113 | OPEN | OTC
GBP/CAD (OTC) | asset_id=2114 | OPEN | OTC
GBP/CHF (OTC) | asset_id=2115 | OPEN | OTC
GBP/AUD (OTC) | asset_id=2116 | OPEN | OTC
EUR/CAD (OTC) | asset_id=2117 | OPEN | OTC
CHF/JPY (OTC) | asset_id=2118 | OPEN | OTC
CAD/CHF (OTC) | asset_id=2119 | OPEN | OTC
EUR/AUD (OTC) | asset_id=2120 | OPEN | OTC
EUR/NZD (OTC) | asset_id=2122 | OPEN | OTC
USD/TRY (OTC) | asset_id=2124 | OPEN | OTC
Litecoin (OTC) | asset_id=2126 | OPEN | OTC
Vaulta (OTC) | asset_id=2127 | OPEN | OTC
USD/PLN (OTC) | asset_id=2128 | OPEN | OTC
AUD/CHF (OTC) | asset_id=2129 | OPEN | OTC
AUD/NZD (OTC) | asset_id=2130 | OPEN | OTC
EUR/CHF (OTC) | asset_id=2131 | OPEN | OTC
GBP/NZD (OTC) | asset_id=2132 | OPEN | OTC
CAD/JPY (OTC) | asset_id=2136 | OPEN | OTC
NZD/CAD (OTC) | asset_id=2137 | OPEN | OTC
NZD/JPY (OTC) | asset_id=2138 | OPEN | OTC
Jupiter (OTC) | asset_id=2141 | OPEN | OTC
Dogwifhat (OTC) | asset_id=2144 | OPEN | OTC
Pepe (OTC) | asset_id=2145 | OPEN | OTC
Polkadot (OTC) | asset_id=2149 | OPEN | OTC
Cosmos (OTC) | asset_id=2150 | OPEN | OTC
Sei (OTC) | asset_id=2152 | OPEN | OTC
Dash (OTC) | asset_id=2155 | OPEN | OTC
Arbitrum (OTC) | asset_id=2156 | OPEN | OTC
Worldcoin (OTC) | asset_id=2157 | OPEN | OTC
1000Sats (OTC) | asset_id=2159 | OPEN | OTC
EUR/THB (OTC) | asset_id=2181 | OPEN | OTC
USD/THB (OTC) | asset_id=2182 | OPEN | OTC
JPY/THB (OTC) | asset_id=2183 | OPEN | OTC
USD/ARS (OTC) | asset_id=2186 | OPEN | OTC
USD/DOP (OTC) | asset_id=2188 | OPEN | OTC
TRUMP Coin (OTC) | asset_id=2265 | OPEN | OTC
BTC/USD (OTC) | asset_id=2270 | OPEN | OTC
Ondo (OTC) | asset_id=2276 | OPEN | OTC
DYDX (OTC) | asset_id=2277 | OPEN | OTC
Fartcoin (OTC) | asset_id=2279 | OPEN | OTC
Pudgy Penguins (OTC) | asset_id=2280 | OPEN | OTC
Raydium (OTC) | asset_id=2286 | OPEN | OTC
Sui (OTC) | asset_id=2287 | OPEN | OTC
HBAR (OTC) | asset_id=2288 | OPEN | OTC
FET (OTC) | asset_id=2289 | OPEN | OTC
Render (OTC) | asset_id=2290 | OPEN | OTC
TAO (OTC) | asset_id=2291 | OPEN | OTC
USD/BRL (OTC) | asset_id=2298 | OPEN | OTC
USD/COP (OTC) | asset_id=2299 | OPEN | OTC
USD/MXN (OTC) | asset_id=2300 | OPEN | OTC
PEN/USD (OTC) | asset_id=2301 | OPEN | OTC
Formula One Group (OTC) | asset_id=2312 | OPEN | OTC
Uranium (OTC) | asset_id=2323 | OPEN | OTC
Platinum (OTC) | asset_id=2327 | OPEN | OTC
Palladium (OTC) | asset_id=2328 | OPEN | OTC
USD/IDR (OTC) | asset_id=2409 | OPEN | OTC
Cocoa (OTC) | asset_id=2414 | OPEN | OTC
Coffee (OTC) | asset_id=2415 | OPEN | OTC
Cotton (OTC) | asset_id=2416 | OPEN | OTC
Sugar (OTC) | asset_id=2417 | OPEN | OTC
Terra Classic (OTC) | asset_id=2430 | OPEN | OTC
USD/SAR (OTC) | asset_id=2431 | OPEN | OTC
USD/MYR (OTC) | asset_id=2432 | OPEN | OTC
USD/VND (OTC) | asset_id=2434 | OPEN | OTC
USD/NGN (OTC) | asset_id=2435 | OPEN | OTC
USD/PHP (OTC) | asset_id=2436 | OPEN | OTC
USD/BOB (OTC) | asset_id=2437 | OPEN | OTC
USD/CLP (OTC) | asset_id=2438 | OPEN | OTC
USD/BDT (OTC) | asset_id=2439 | OPEN | OTC
VISA (OTC) | asset_id=2440 | OPEN | OTC
SpaceX (OTC) | asset_id=2443 | OPEN | OTC
Hyperliquid (OTC) | asset_id=2448 | OPEN | OTC
Anthropic (OTC) | asset_id=2451 | OPEN | OTC
OpenAI (OTC) | asset_id=2452 | OPEN | OTC
S&P500/Gold | asset_id=2461 | OPEN | NORMAL
```

Unmatched TraceCom markets per server:

- **binary-options** (13): AUDUSD:NORMAL, USDCAD:NORMAL, USDCHF:NORMAL, EURGBP:NORMAL, NZDCHF:OTC, GER30:NORMAL, UK100:NORMAL, AUS200:NORMAL, EU50:NORMAL, HK33:NORMAL, FR40:NORMAL, SP35:NORMAL, BTCUSD:OTC
- **turbo-options** (12): AUDUSD:NORMAL, USDCAD:NORMAL, USDCHF:NORMAL, EURGBP:NORMAL, USDJPY:OTC, GER30:NORMAL, UK100:NORMAL, AUS200:NORMAL, EU50:NORMAL, HK33:NORMAL, FR40:NORMAL, SP35:NORMAL
- **blitz-options** (12): AUDUSD:NORMAL, USDCAD:NORMAL, USDCHF:NORMAL, EURGBP:NORMAL, NZDCHF:OTC, GER30:NORMAL, UK100:NORMAL, AUS200:NORMAL, EU50:NORMAL, HK33:NORMAL, FR40:NORMAL, SP35:NORMAL
- **digital-options** (11): USDCAD:NORMAL, USDCHF:NORMAL, EURGBP:NORMAL, NZDCHF:OTC, GER30:NORMAL, UK100:NORMAL, AUS200:NORMAL, EU50:NORMAL, HK33:NORMAL, FR40:NORMAL, SP35:NORMAL
- **marginal-cfd** (45): EURUSD:NORMAL, USDJPY:NORMAL, GBPUSD:NORMAL, AUDUSD:NORMAL, USDCAD:NORMAL, USDCHF:NORMAL, EURJPY:NORMAL, EURGBP:NORMAL, AUDJPY:NORMAL, GBPJPY:NORMAL, EURUSD:OTC, GBPUSD:OTC, USDJPY:OTC, EURGBP:OTC, GBPJPY:OTC, AUDUSD:OTC, USDCAD:OTC, USDCHF:OTC, EURJPY:OTC, AUDJPY:OTC, EURAUD:OTC, EURCHF:OTC, EURCAD:OTC, EURNZD:OTC, AUDCAD:OTC, AUDCHF:OTC, AUDNZD:OTC, CADJPY:OTC, CADCHF:OTC, GBPAUD:OTC, GBPCAD:OTC, GBPCHF:OTC, GBPNZD:OTC, NZDCAD:OTC, NZDJPY:OTC, NZDCHF:OTC, USDMXN:OTC, USDBRL:OTC, USDTRY:OTC, USDZAR:OTC, AUS200:NORMAL, EU50:NORMAL, FR40:NORMAL, SP35:NORMAL, BTCUSD:OTC
- **marginal-crypto** (55): EURUSD:NORMAL, USDJPY:NORMAL, GBPUSD:NORMAL, AUDUSD:NORMAL, USDCAD:NORMAL, USDCHF:NORMAL, EURJPY:NORMAL, EURGBP:NORMAL, AUDJPY:NORMAL, GBPJPY:NORMAL, EURUSD:OTC, GBPUSD:OTC, USDJPY:OTC, EURGBP:OTC, GBPJPY:OTC, AUDUSD:OTC, USDCAD:OTC, USDCHF:OTC, EURJPY:OTC, AUDJPY:OTC, EURAUD:OTC, EURCHF:OTC, EURCAD:OTC, EURNZD:OTC, AUDCAD:OTC, AUDCHF:OTC, AUDNZD:OTC, CADJPY:OTC, CADCHF:OTC, GBPAUD:OTC, GBPCAD:OTC, GBPCHF:OTC, GBPNZD:OTC, NZDCAD:OTC, NZDJPY:OTC, NZDCHF:OTC, USDMXN:OTC, USDBRL:OTC, USDTRY:OTC, USDZAR:OTC, XAUUSD:NORMAL, XAGUSD:NORMAL, US30:NORMAL, US100:NORMAL, US500:NORMAL, US2000:NORMAL, GER30:NORMAL, UK100:NORMAL, JP225:NORMAL, AUS200:NORMAL, EU50:NORMAL, HK33:NORMAL, FR40:NORMAL, SP35:NORMAL, BTCUSD:OTC
- **marginal-forex** (45): EURUSD:OTC, GBPUSD:OTC, USDJPY:OTC, EURGBP:OTC, GBPJPY:OTC, AUDUSD:OTC, USDCAD:OTC, USDCHF:OTC, EURJPY:OTC, AUDJPY:OTC, EURAUD:OTC, EURCHF:OTC, EURCAD:OTC, EURNZD:OTC, AUDCAD:OTC, AUDCHF:OTC, AUDNZD:OTC, CADJPY:OTC, CADCHF:OTC, GBPAUD:OTC, GBPCAD:OTC, GBPCHF:OTC, GBPNZD:OTC, NZDCAD:OTC, NZDJPY:OTC, NZDCHF:OTC, USDMXN:OTC, USDBRL:OTC, USDTRY:OTC, USDZAR:OTC, XAUUSD:NORMAL, XAGUSD:NORMAL, US30:NORMAL, US100:NORMAL, US500:NORMAL, US2000:NORMAL, GER30:NORMAL, UK100:NORMAL, JP225:NORMAL, AUS200:NORMAL, EU50:NORMAL, HK33:NORMAL, FR40:NORMAL, SP35:NORMAL, BTCUSD:OTC

## 3. Candle veracity — same asset across servers

### US 500 (NORMAL index) — `US500:NORMAL`, size=60s, count=60

| server | bars | first from→to | last from→to | aligned to 60s | gaps | close decimals | fields |
|---|---|---|---|---|---|---|---|
| binary-options | 60 | 1789697160→1789697220 | 1789700700→1789700760 | yes | 0 | 2 | close,from,max,min,open,to |
| turbo-options | 60 | 1789697160→1789697220 | 1789700700→1789700760 | yes | 0 | 2 | close,from,max,min,open,to |
| blitz-options | 60 | 1789697220→1789697280 | 1789700760→1789700820 | yes | 0 | 2 | close,from,max,min,open,to |
| digital-options | 60 | 1789697220→1789697280 | 1789700760→1789700820 | yes | 0 | 2 | close,from,max,min,open,to |
| marginal-cfd | 60 | 1789697220→1789697280 | 1789700760→1789700820 | yes | 0 | 2 | close,from,max,min,open,to |

Reference: `binary-options`, aligned by `from` timestamp, last common bar excluded from "completed" stats (forming bar).

| server vs ref | common | missing | extra | completed compared | OHLC mismatches | max |Δclose| | max |Δhigh| | max |Δlow| | max |Δopen| | last-ts offset (s) | forming bar differs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| turbo-options vs binary-options | 60 | 0 | 0 | 59 | 0 | 0 | 0 | 0 | 0 | 0 | yes |
| blitz-options vs binary-options | 59 | 1 | 1 | 58 | 0 | 0 | 0 | 0 | 0 | 60 | yes |
| digital-options vs binary-options | 59 | 1 | 1 | 58 | 0 | 0 | 0 | 0 | 0 | 60 | yes |
| marginal-cfd vs binary-options | 59 | 1 | 1 | 58 | 0 | 0 | 0 | 0 | 0 | 60 | yes |

**Verdict:** SAME price feed — all 233 common completed bars are byte-equal; differences are limited to the still-forming last bar and/or a one-bar fetch-time offset (missing/extra = 1).

Volume field exposed: binary-options:no, turbo-options:no, blitz-options:no, digital-options:no, marginal-cfd:no.

### EUR/USD (OTC) — `EURUSD:OTC`, size=60s, count=60

| server | bars | first from→to | last from→to | aligned to 60s | gaps | close decimals | fields |
|---|---|---|---|---|---|---|---|
| binary-options | 60 | 1789697160→1789697220 | 1789700700→1789700760 | yes | 0 | 6 | close,from,max,min,open,to |
| turbo-options | 60 | 1789697160→1789697220 | 1789700700→1789700760 | yes | 0 | 6 | close,from,max,min,open,to |
| blitz-options | 60 | 1789697220→1789697280 | 1789700760→1789700820 | yes | 0 | 6 | close,from,max,min,open,to |
| digital-options | 60 | 1789697220→1789697280 | 1789700760→1789700820 | yes | 0 | 6 | close,from,max,min,open,to |

Reference: `binary-options`, aligned by `from` timestamp, last common bar excluded from "completed" stats (forming bar).

| server vs ref | common | missing | extra | completed compared | OHLC mismatches | max |Δclose| | max |Δhigh| | max |Δlow| | max |Δopen| | last-ts offset (s) | forming bar differs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| turbo-options vs binary-options | 60 | 0 | 0 | 59 | 0 | 0 | 0 | 0 | 0 | 0 | yes |
| blitz-options vs binary-options | 59 | 1 | 1 | 58 | 0 | 0 | 0 | 0 | 0 | 60 | yes |
| digital-options vs binary-options | 59 | 1 | 1 | 58 | 0 | 0 | 0 | 0 | 0 | 60 | yes |

**Verdict:** SAME price feed — all 175 common completed bars are byte-equal; differences are limited to the still-forming last bar and/or a one-bar fetch-time offset (missing/extra = 1).

Volume field exposed: binary-options:no, turbo-options:no, blitz-options:no, digital-options:no.

### EUR/USD (NORMAL) — `EURUSD:NORMAL`, size=60s, count=60

| server | bars | first from→to | last from→to | aligned to 60s | gaps | close decimals | fields |
|---|---|---|---|---|---|---|---|
| binary-options | 60 | 1789697160→1789697220 | 1789700700→1789700760 | yes | 0 | 6 | close,from,max,min,open,to |
| turbo-options | 60 | 1789697160→1789697220 | 1789700700→1789700760 | yes | 0 | 6 | close,from,max,min,open,to |
| blitz-options | 60 | 1789697220→1789697280 | 1789700760→1789700820 | yes | 0 | 6 | close,from,max,min,open,to |
| digital-options | 60 | 1789697220→1789697280 | 1789700760→1789700820 | yes | 0 | 6 | close,from,max,min,open,to |
| marginal-forex | 60 | 1789697220→1789697280 | 1789700760→1789700820 | yes | 0 | 6 | close,from,max,min,open,to |

Reference: `binary-options`, aligned by `from` timestamp, last common bar excluded from "completed" stats (forming bar).

| server vs ref | common | missing | extra | completed compared | OHLC mismatches | max |Δclose| | max |Δhigh| | max |Δlow| | max |Δopen| | last-ts offset (s) | forming bar differs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| turbo-options vs binary-options | 60 | 0 | 0 | 59 | 0 | 0 | 0 | 0 | 0 | 0 | yes |
| blitz-options vs binary-options | 59 | 1 | 1 | 58 | 0 | 0 | 0 | 0 | 0 | 60 | yes |
| digital-options vs binary-options | 59 | 1 | 1 | 58 | 0 | 0 | 0 | 0 | 0 | 60 | yes |
| marginal-forex vs binary-options | 59 | 1 | 1 | 58 | 58 | 0.000045 | 0.000025 | 0.000045 | 0.000045 | 60 | yes |

**Verdict:** DIFFERENT feed/sampling for `marginal-forex` (58/58 completed bars differ, max |Δclose|=0.000045).
  - first divergence @ 1789697220: ref o/h/l/c=1.14814/1.14818/1.148125/1.148135 vs marginal-forex o/h/l/c=1.148145/1.148185/1.148125/1.148145

Volume field exposed: binary-options:no, turbo-options:no, blitz-options:no, digital-options:no, marginal-forex:no.

`get_candles` tool schema (from `tools/list`, one call per server):

| server | size enum | count max | volume arg |
|---|---|---|---|
| binary-options | 19 values: 1,5,10,15,30,60,120,300,600… | 1000 | no |
| turbo-options | 19 values: 1,5,10,15,30,60,120,300,600… | 1000 | no |
| blitz-options | 19 values: 1,5,10,15,30,60,120,300,600… | 1000 | no |
| digital-options | 19 values: 1,5,10,15,30,60,120,300,600… | 1000 | no |
| marginal-cfd | 19 values: 1,5,10,15,30,60,120,300,600… | 1000 | no |
| marginal-crypto | 19 values: 1,5,10,15,30,60,120,300,600… | 1000 | no |
| marginal-forex | 19 values: 1,5,10,15,30,60,120,300,600… | 1000 | no |

## 4. Expiration model / cadence

| server / asset | expirations[] | cadence (s) | aligned to cadence | duration sizes (s) | extra model fields |
|---|---|---|---|---|---|
| binary-options / US 500 (NORMAL index) | 5 (1789701300,1789702200,1789703100…) | 900 | yes | — | — |
| binary-options / EUR/USD (OTC) | 5 (1789701300,1789702200,1789703100…) | 900 | yes | — | — |
| binary-options / EUR/USD (NORMAL) | 5 (1789701300,1789702200,1789703100…) | 900 | yes | — | — |
| turbo-options / US 500 (NORMAL index) | 5 (1789700820,1789700880,1789700940…) | 60 | yes | — | — |
| turbo-options / EUR/USD (OTC) | 5 (1789700820,1789700880,1789700940…) | 60 | yes | — | — |
| turbo-options / EUR/USD (NORMAL) | 5 (1789700820,1789700880,1789700940…) | 60 | yes | — | — |
| blitz-options / US 500 (NORMAL index) | none | — | n/a | 120,180,300,600,900 | — |
| blitz-options / EUR/USD (OTC) | none | — | n/a | 30,45,60,120,180,300 | — |
| blitz-options / EUR/USD (NORMAL) | none | — | n/a | 60,120,180,300,600,900 | — |
| digital-options / US 500 (NORMAL index) | none | — | n/a | — | instruments: {"instrument_index":1123380,"expiration":"2026-09-18T03:07:00Z","deadline":"2026-09-18T03:06:30Z","deadtime_seconds":30,"period_seconds":60,"strikes":11} |
| digital-options / EUR/USD (OTC) | none | — | n/a | — | instruments: {"instrument_index":1123380,"expiration":"2026-09-18T03:07:00Z","deadline":"2026-09-18T03:06:30Z","deadtime_seconds":30,"period_seconds":60,"strikes":11} |
| digital-options / EUR/USD (NORMAL) | none | — | n/a | — | instruments: {"instrument_index":1123380,"expiration":"2026-09-18T03:07:00Z","deadline":"2026-09-18T03:06:30Z","deadtime_seconds":30,"period_seconds":60,"strikes":11} |
| marginal-cfd / US 500 (NORMAL index) | none | — | n/a | — | instruments: {"assetId":1470,"note":"no expiry windows — marginal product has no expiration model","leverageProfiles":1} |
| marginal-forex / EUR/USD (NORMAL) | none | — | n/a | — | instruments: {"assetId":1,"note":"no expiry windows — marginal product has no expiration model","leverageProfiles":1} |

Cross-server note (same asset `US500:NORMAL`): binary cadence 900s, turbo 60s, digital window 60s period / deadtime 30s / 11 strikes, blitz duration menu 120,180,300,600,900s, marginal-* none. Expiry models are product-specific — there is no single shared expiration grid.

## 5. Candle freshness (last bar vs server time implied by expirations, not the local clock)

Server-now window derived from the finest expiration feed available (`turbo-options expirations[] (60s grid)`): now ∈ [1789700760, 1789700820] UNIX.

| asset | server | last bar to | own next expiration | own period (s) | delta own (s) | bar age min–max vs now (s) | fresh? |
|---|---|---|---|---|---|---|---|
| US 500 (NORMAL index) | binary-options | 1789700760 | 1789701300 | 900 | 540 | 0…60 | yes |
| EUR/USD (OTC) | binary-options | 1789700760 | 1789701300 | 900 | 540 | 0…60 | yes |
| EUR/USD (NORMAL) | binary-options | 1789700760 | 1789701300 | 900 | 540 | 0…60 | yes |
| US 500 (NORMAL index) | turbo-options | 1789700760 | 1789700820 | 60 | 60 | 0…60 | yes |
| EUR/USD (OTC) | turbo-options | 1789700760 | 1789700820 | 60 | 60 | 0…60 | yes |
| EUR/USD (NORMAL) | turbo-options | 1789700760 | 1789700820 | 60 | 60 | 0…60 | yes |
| US 500 (NORMAL index) | blitz-options | 1789700820 | — | — | — | -60…0 | yes |
| EUR/USD (OTC) | blitz-options | 1789700820 | — | — | — | -60…0 | yes |
| EUR/USD (NORMAL) | blitz-options | 1789700820 | — | — | — | -60…0 | yes |
| US 500 (NORMAL index) | digital-options | 1789700820 | — | — | — | -60…0 | yes |
| EUR/USD (OTC) | digital-options | 1789700820 | — | — | — | -60…0 | yes |
| EUR/USD (NORMAL) | digital-options | 1789700820 | — | — | — | -60…0 | yes |
| US 500 (NORMAL index) | marginal-cfd | 1789700820 | — | — | — | -60…0 | yes |
| EUR/USD (NORMAL) | marginal-forex | 1789700820 | — | — | — | -60…0 | yes |

> `bar age` = last bar end minus the turbo-derived now window (negative = the last bar is still forming right now). A stale feed would show a positive age greater than one candle size.

## 6. Payout / leverage / sizing quality

| server | payout field | payout min/median/max | min trade | max trade | precision | buyback deadtime | leverage tiers | min quantity |
|---|---|---|---|---|---|---|---|---|
| binary-options | profit_percent | 87/90/94 | 2 | 20000 | 4–7 | 10 (on 1 asset) | — | — |
| turbo-options | profit_percent | 86/86/94 | 2 | 20000 | 4–7 | 15 (on 33 assets) | — | — |
| blitz-options | profit_percent | 86/89/93 | 2 | 20000 | 4–7 | — | — | — |
| digital-options | — | — | — | — | 4–7 | — | — | — |
| marginal-cfd | — | — | — | — | 2–5 | — | 1000,800,600,500,200,100,50,30 | 0.01–100 |
| marginal-crypto | — | — | — | — | 2–5 | — | 1000,500,200,150,100,50,25,20 | 0.001–50000 |
| marginal-forex | — | — | — | — | 2–4 | — | 5000,1000,500,200 | 0.001–0.01 |

## 7. Account / funds per server (real calls, PRACTICE)

| server | capabilities mode | balances (type/currency/amount) | portfolio fields |
|---|---|---|---|
| binary-options | read-write (binary-options) | regular/BRL/0, training/USD/60 | — |
| turbo-options | read-write (turbo-options) | regular/BRL/0, training/USD/60 | — |
| blitz-options | read-write (blitz-options) | regular/BRL/0, training/USD/60 | — |
| digital-options | read-write (digital-options) | regular/BRL/0, training/USD/60 | — |
| marginal-cfd | read-write (marginal-cfd) | regular/BRL/0, training/USD/60 | dividends,equity,equity_usd,free_margin,isolated_dividends,isolated_margin,isolated_pnl,isolated_pnl_net,isolated_swap,margin,margin_level,pnl,pnl_net,stop_out_level,swap |
| marginal-crypto | read-write (marginal-crypto) | regular/BRL/0, training/USD/60 | dividends,equity,equity_usd,free_margin,isolated_dividends,isolated_margin,isolated_pnl,isolated_pnl_net,isolated_swap,margin,margin_level,pnl,pnl_net,stop_out_level,swap |
| marginal-forex | read-write (marginal-forex) | regular/BRL/0, training/USD/60 | dividends,equity,equity_usd,free_margin,isolated_dividends,isolated_margin,isolated_pnl,isolated_pnl_net,isolated_swap,margin,margin_level,pnl,pnl_net,stop_out_level,swap |

> Balances returned (real calls): binary-options=regular/BRL/0|training/USD/60; turbo-options=regular/BRL/0|training/USD/60; blitz-options=regular/BRL/0|training/USD/60; digital-options=regular/BRL/0|training/USD/60; marginal-cfd=regular/BRL/0|training/USD/60; marginal-crypto=regular/BRL/0|training/USD/60; marginal-forex=regular/BRL/0|training/USD/60. This differs from the TraceCom runtime's own PRACTICE account (see `docs/iq-mcp/current-vs-mcp.md`); treat MCP balances as a separate credential/tenant until reconciled. Capability mode is `read-write` for this token on every server — the read-only guarantee here comes from the allowlist gates, not from the server.
>
> The server can answer a successful HTTP 200 with a body `{code:0, message:"rate_limited: rate limit exceeded (limit=60, retry_after_ms=60000...)"}`. This probe detects that body and retries after the advertised delay; any data captured before the fix (or by callers that do not check `message`) can be silently incomplete.

### Rate limits (`get_limits`, real calls)

| server | scope | gateway | read | write | tools classified read/write | write tool names |
|---|---|---|---|---|---|---|
| binary-options | per-user | 200/60s | 60/60s | 10/60s | 7/3 | place_trade,rollover_position,sell_position |
| turbo-options | per-user | 200/60s | 60/60s | 10/60s | 7/3 | place_trade,rollover_position,sell_position |
| blitz-options | per-user | 200/60s | 60/60s | 10/60s | 7/3 | place_trade,rollover_position,sell_position |
| digital-options | per-user | 200/60s | 60/60s | 10/60s | 9/2 | place_trade,sell_position |
| marginal-cfd | per-user | 200/60s | 60/60s | 10/60s | 10/7 | cancel_pending_order,change_position_stop_loss,change_position_take_profit,close_position,place_limit_order,place_market_order,place_stop_order |
| marginal-crypto | per-user | 200/60s | 60/60s | 10/60s | 10/7 | cancel_pending_order,change_position_stop_loss,change_position_take_profit,close_position,place_limit_order,place_market_order,place_stop_order |
| marginal-forex | per-user | 200/60s | 60/60s | 10/60s | 10/7 | cancel_pending_order,change_position_stop_loss,change_position_take_profit,close_position,place_limit_order,place_market_order,place_stop_order |


## 8. Asset field inventory (data richness, real payloads)

| asset field | binary-options | turbo-options | blitz-options | digital-options | marginal-cfd | marginal-crypto | marginal-forex |
|---|---|---|---|---|---|---|---|
| asset_id | yes | yes | yes | yes | yes | yes | yes |
| asset_type | — | — | — | yes | yes | yes | yes |
| base_currency | — | — | — | — | yes | yes | yes |
| buyback_deadtime_seconds | — | yes | — | — | — | — | — |
| expiration_sizes_seconds | — | — | yes | — | — | — | — |
| expirations | yes | yes | — | — | — | — | — |
| image | — | — | — | yes | — | — | — |
| is_open | yes | yes | yes | yes | yes | yes | yes |
| max_leverages | — | — | — | — | yes | yes | yes |
| min_quantity | — | — | — | — | yes | yes | yes |
| name | yes | yes | yes | yes | yes | yes | yes |
| precision | yes | yes | yes | yes | — | — | — |
| price_precision | — | — | — | — | yes | yes | yes |
| profit_percent | yes | yes | yes | — | — | — | — |
| quantity_presets | — | — | — | — | yes | yes | yes |
| quantity_step | — | — | — | — | yes | yes | yes |
| quantity_unit | — | — | — | — | yes | yes | yes |
| quote_currency | — | — | — | — | yes | yes | yes |

## 9. Indicators

- **No server exposes ANY indicator tool or indicator field.** Tool names and asset/balance/candle fields were scanned for indicator-like names (`rsi|macd|ema|sma|bollinger|stoch|atr|adx|cci|ichimoku|williams|donchian|momentum|feature`): zero matches on all 7 servers.
- TraceCom must compute all features itself (trend/momentum/volatility/regime). MCP only returns raw OHLC (`get_candles`) and, on digital, a strike grid (`get_prices`/`get_instruments`).

## 10. Schema / field-name differences between servers

- binary/turbo: asset keys `asset_id, name, is_open, precision, profit_percent, expirations[]`; turbo adds `buyback_deadtime_seconds` on part of the catalog; both expose a `defaults` block on `list_assets` in this run.
- blitz: same shape but replaces `expirations[]` with duration list `expiration_sizes_seconds[]` (no absolute expiry timestamps).
- digital: asset keys `asset_id, name, asset_type, image, is_open, precision` — **no payout, no expirations on the asset**; expiry lives in `get_instruments` (`expiration`, `deadline`, `deadtime_seconds`, `period_seconds`, strike rows) and prices in `get_prices`.
- marginal-cfd/crypto/forex: asset keys `asset_id, name, asset_type, base_currency, quote_currency, is_open, price_precision, min_quantity, quantity_step, quantity_presets, quantity_unit, max_leverages{}`; **no expirations, no payout**; leverage and spread replace payout.
- balances: binary/turbo/blitz/digital return flat `{amount, balance_id, bonus_amount, currency, type}`; marginal-* return a portfolio block (`equity, margin, free_margin, pnl, margin_level, stop_out_level…`).
- Candle rows on all 7 servers use the same field names: `{open, close, min, max, from, to}` (ISO-8601 UTC), **no volume**, no size/asset echo.

## 11. Verdict

### PROVEN

- Catalog (strict NORMAL/OTC): `digital-options` 44/55, `turbo-options` 43/55 +payout, `blitz-options` 43/55 +payout, `binary-options` 42/55 +payout, `marginal-cfd` 10/55, `marginal-forex` 10/55. Best coverage `digital-options` (44/55); every server's exact unmatched list is in §2.
- Candles: options servers binary/turbo/blitz/digital serve the same OHLC series. US 500 (asset_id 1470) across 5 servers: byte-equal on all completed bars (differences only on the forming bar and a possible one-bar fetch-time offset); EUR/USD (OTC) across 4 servers: byte-equal on all completed bars (same caveat).
- Same-feed servers proven on US 500 completed bars: binary-options, turbo-options, blitz-options, digital-options, marginal-cfd.
- EUR/USD (NORMAL) is a DIFFERENT feed from the options servers on: `marginal-forex` (58/58 completed bars differ up to |Δclose|=0.000045) — tiny but systematic, consistent with distinct FX sampling/rounding rather than a transient glitch. Compared servers: binary-options, turbo-options, blitz-options, digital-options, marginal-forex.
- Candle schema is identical on all 7: `get_candles(asset_id, size, count)`, size enum 1s…2592000s, count default 100 / max 1000 (from `tools/list`); rows `{open, close, min, max, from, to}` ISO-8601 UTC, no volume, 1m bars aligned to the wall clock.
- Expirations are product-specific, all wall-clock aligned: binary 900s on sampled assets, turbo 60s, digital absolute windows (60s period + 30s deadtime, strike grid), blitz duration menu with no absolute timestamps, marginal-* no expiry.
- Freshness: every sampled candle feed is live at fetch time (last bar within one candle of the turbo/digital-implied server now, §5); no stale feed was observed.
- Payouts exist only on binary/turbo/blitz (`profit_percent`, per asset, e.g. binary 87–94, turbo 86–94, blitz 86–93); digital exposes strikes/odds, marginal-* expose leverage tiers instead.
- Rate limits identical on all 7 (real `get_limits`): `gateway 200/60s`, `read 60/60s`, `write 10/60s`, scope `per-user`; the server itself classifies every tool as read or write (see §7).
- Account mode from `get_capabilities`: binary-options=read-write, turbo-options=read-write, blitz-options=read-write, digital-options=read-write, marginal-cfd=read-write, marginal-crypto=read-write, marginal-forex=read-write. Balances returned on: binary-options, turbo-options, blitz-options, digital-options, marginal-cfd, marginal-crypto, marginal-forex (same `regular/BRL/0` + `training/USD/60` view where present — see §7).
- Rate limiting can arrive as HTTP 200 with body `{code:0, message:"rate_limited: ..."}` (observed once on `marginal-forex`); this probe detects that body and retries, but any consumer that only checks the HTTP status can silently ingest empty data. No indicator is exposed by any server (tool names + payload fields scanned).

### INFERRED (not proven here)

- Shared candle bytes imply one market-data backend for binary/turbo/blitz/digital and for marginal-cfd indices; this probe proves byte-equality on sampled windows, not the physical feed origin.
- `marginal-forex` FX candles come from a different sampling/rounding than the options feeds (proven divergence) — which one matches the TraceCom runtime feed is NOT proven here.
- `get_trade_history`/`get_prices` settlement semantics were not exercised with populated positions (practice history is empty), so settlement validation remains unproven.
- MCP `training` balance (USD 60) is not the TraceCom runtime account; multi-tenant/reconciliation status is unproven.

### Recommended roles

- **MOST PROFESSIONAL OVERALL: `turbo-options`** — role score = strict-covered markets×2 + asset-field richness + payout (score 98; 43/55 markets, richness 6, payout yes, absolute expirations yes). Recommended as TraceCom's **catalog + payout validator**.
- **Catalog authority (pure coverage):** `digital-options` (44/55, §2). Among coverage ties, prefer the payout-capable server; use `digital-options` only if you need `asset_type`/`image` and the strike grid, and `binary-options` if you need the exact binary product mapping.
- **Candle backfill / veracity:** binary-options, turbo-options, blitz-options, digital-options, marginal-cfd are interchangeable for index candles (same completed-bar bytes, same `get_candles` schema: 1s…2592000s sizes, max 1000 bars); use `turbo-options` for the freshest 60s grid or `binary-options` to stay in-product. Do NOT use marginal-forex candles as a stand-in for the options FX feed (different sampling, proven in §3).
- **Payout validator:** binary-options, turbo-options, blitz-options. digital and marginal-* are structurally unable to validate payout (strike grid / leverage+spread instead).
- **Settlement validator:** binary-options/turbo-options/digital-options/blitz-options expose `get_trade_history`; digital additionally exposes the strike grid (`get_prices`/`get_instruments`) needed to model digital settlement. UNPROVEN on this practice account (empty history/orders).
- **NOT SUITABLE / low value for TraceCom's 55-market workflow:** `marginal-cfd` (10/55, OTC 0), `marginal-crypto` (0/55, OTC 0), `marginal-forex` (10/55, OTC 0) — perp/CFD naming universe, no OTC markets, no payout. Valid only as an index candle/leverage reference, never as a binary catalog.
