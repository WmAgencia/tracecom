# TraceCom WS vs IQ Official MCP — open/suspended truth (READ-ONLY)

Generated: 2026-09-18T13:18:50.217Z
Office: https://tracecom.consecom.com.br/api/iq/office (HTTP 200)

## Session expectation

- UTC now: 2026-09-18T13:18:50.217Z
- Weekend: false | weekday: true
- FX NORMAL expected open: true
- OTC expected open: true (24/7)
- OTC pairs trade 24/7; FX NORMAL trades Sun 21:00 UTC - Fri 21:00 UTC. US cash equities 13:30-20:00 UTC weekdays.

## Freshness evidence (timestamps)

- TraceCom office `at`: 1789737531026
- TraceCom WS live serverTime (/status): 2026-09-18T13:18:51.011Z (age -794 ms, timeValid=true)
- TraceCom office top-level serverTime: 1789686342360 — office.connection.serverTimeMs is the connect-time snapshot (relay iq-multi-runtime.mjs:1731); NOT a liveness indicator.
- TraceCom WS connected: true | healthy: true | reconnects: 1
- WS resolver lastResolvedAt: 1789737522952
- WS resolver candidates suspended: 72/72 (all-suspended anomaly: true)
- WS resolver sectionsSeen: ["turbo","binary","blitz","groups"]
- TraceCom markets with a fresh tick feed (<=120s): 25/55
- MCP turbo: 112/112 open
- MCP binary: 126/126 open
- MCP digital: 126/126 open
  - digital get_instruments(1380): generated_at=2026-09-18T13:17:05Z expiration=2026-09-18T13:19:00Z instruments=26
  - digital get_instruments(1381): generated_at=2026-09-18T13:17:05Z expiration=2026-09-18T13:19:00Z instruments=26
  - digital get_instruments(1382): generated_at=2026-09-18T13:17:05Z expiration=2026-09-18T13:19:00Z instruments=26
  - digital get_instruments(1383): generated_at=2026-09-18T13:17:05Z expiration=2026-09-18T13:19:00Z instruments=26

## TraceCom availability counts

- SUSPENDED: 35
- NOT_OFFERED: 20

## Classification counts

- CONFLICT: 16
- SESSION_DATA_STALE: 10
- NOT_OFFERED_FOR_PRODUCT: 10
- BROKER_CONFIRMED_CLOSED/SUSPENDED: 19

Match rate: 26/55 markets matched to an MCP asset (by canonical + NORMAL/OTC).
Unmatched: USDCHF:NORMAL, EURUSD:OTC, GBPUSD:OTC, USDJPY:OTC, EURGBP:OTC, GBPJPY:OTC, AUDUSD:OTC, USDCAD:OTC, USDCHF:OTC, EURJPY:OTC, AUDJPY:OTC, EURAUD:OTC, EURCHF:OTC, EURCAD:OTC, AUDCAD:OTC, AUDCHF:OTC, AUDNZD:OTC, CADJPY:OTC, CADCHF:OTC, GBPAUD:OTC, GBPCAD:OTC, GBPCHF:OTC, GBPNZD:OTC, NZDCAD:OTC, NZDJPY:OTC, NZDCHF:OTC, EU50:NORMAL, SP35:NORMAL, BTCUSD:OTC

## MCP freshness (independent truth)

- turbo assets with profit_percent: 112
- binary assets with profit_percent: 126
- matched markets with future expirations[]: 26/26
- digital get_instruments generated_at: 2026-09-18T13:17:05Z, 2026-09-18T13:17:05Z, 2026-09-18T13:17:05Z, 2026-09-18T13:17:05Z
- digital get_instruments expiration: 2026-09-18T13:19:00Z, 2026-09-18T13:19:00Z, 2026-09-18T13:19:00Z, 2026-09-18T13:19:00Z

## Same asset_id contradictions (PROVEN)

The SAME IQ `asset_id` is `is_open=true` in MCP and `is_suspended=true` in the TraceCom WS catalog:

- EURUSD:NORMAL: asset_id 1861
- USDCAD:NORMAL: asset_id 1878
- EURNZD:OTC: asset_id 2122
- USDTRY:OTC: asset_id 2124
- USDZAR:OTC: asset_id 1380
- XAGUSD:NORMAL: asset_id 1913
- US30:NORMAL: asset_id 1472
- US100:NORMAL: asset_id 1471
- US500:NORMAL: asset_id 1470
- US2000:NORMAL: asset_id 1473
- GER30:NORMAL: asset_id 1478
- UK100:NORMAL: asset_id 1475
- JP225:NORMAL: asset_id 1476
- AUS200:NORMAL: asset_id 1481
- HK33:NORMAL: asset_id 1477
- FR40:NORMAL: asset_id 1479

## Conflict table

| marketKey | TraceCom | WS activeId | WS suspended | turbo | binary | digital | classification | rootCause |
|---|---|---|---|---|---|---|---|---|
| EURUSD:NORMAL | SUSPENDED | 1 | true | open | open | open | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| USDJPY:NORMAL | NOT_OFFERED | - | false | open | open | open | SESSION_DATA_STALE | WS_INIT_CATALOG_ALL_SUSPENDED |
| GBPUSD:NORMAL | NOT_OFFERED | - | false | open | open | open | SESSION_DATA_STALE | WS_INIT_CATALOG_ALL_SUSPENDED |
| AUDUSD:NORMAL | NOT_OFFERED | - | false | open | open | open | SESSION_DATA_STALE | WS_INIT_CATALOG_ALL_SUSPENDED |
| USDCAD:NORMAL | SUSPENDED | 100 | true | absent | open | open | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| USDCHF:NORMAL | NOT_OFFERED | - | false | absent | absent | absent | NOT_OFFERED_FOR_PRODUCT | ABSENT_FROM_BROKER_CATALOG |
| EURJPY:NORMAL | NOT_OFFERED | - | false | open | open | open | SESSION_DATA_STALE | WS_INIT_CATALOG_ALL_SUSPENDED |
| EURGBP:NORMAL | NOT_OFFERED | - | false | open | open | open | SESSION_DATA_STALE | WS_INIT_CATALOG_ALL_SUSPENDED |
| AUDJPY:NORMAL | NOT_OFFERED | - | false | open | open | open | SESSION_DATA_STALE | WS_INIT_CATALOG_ALL_SUSPENDED |
| GBPJPY:NORMAL | NOT_OFFERED | - | false | open | open | open | SESSION_DATA_STALE | WS_INIT_CATALOG_ALL_SUSPENDED |
| EURUSD:OTC | NOT_OFFERED | - | false | absent | absent | absent | NOT_OFFERED_FOR_PRODUCT | ABSENT_FROM_BROKER_CATALOG |
| GBPUSD:OTC | NOT_OFFERED | - | false | absent | absent | absent | NOT_OFFERED_FOR_PRODUCT | ABSENT_FROM_BROKER_CATALOG |
| USDJPY:OTC | NOT_OFFERED | - | false | absent | absent | absent | NOT_OFFERED_FOR_PRODUCT | ABSENT_FROM_BROKER_CATALOG |
| EURGBP:OTC | NOT_OFFERED | - | false | absent | absent | absent | NOT_OFFERED_FOR_PRODUCT | ABSENT_FROM_BROKER_CATALOG |
| GBPJPY:OTC | NOT_OFFERED | - | false | absent | absent | absent | NOT_OFFERED_FOR_PRODUCT | ABSENT_FROM_BROKER_CATALOG |
| AUDUSD:OTC | SUSPENDED | 2111 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| USDCAD:OTC | SUSPENDED | 2112 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| USDCHF:OTC | NOT_OFFERED | - | false | absent | absent | absent | NOT_OFFERED_FOR_PRODUCT | ABSENT_FROM_BROKER_CATALOG |
| EURJPY:OTC | NOT_OFFERED | - | false | absent | absent | absent | NOT_OFFERED_FOR_PRODUCT | ABSENT_FROM_BROKER_CATALOG |
| AUDJPY:OTC | SUSPENDED | 2113 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| EURAUD:OTC | SUSPENDED | 2120 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| EURCHF:OTC | SUSPENDED | 2131 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| EURCAD:OTC | SUSPENDED | 2117 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| EURNZD:OTC | SUSPENDED | 2122 | true | open | open | open | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| AUDCAD:OTC | NOT_OFFERED | - | false | absent | absent | absent | NOT_OFFERED_FOR_PRODUCT | ABSENT_FROM_BROKER_CATALOG |
| AUDCHF:OTC | SUSPENDED | 2129 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| AUDNZD:OTC | SUSPENDED | 2130 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| CADJPY:OTC | SUSPENDED | 2136 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| CADCHF:OTC | SUSPENDED | 2119 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| GBPAUD:OTC | SUSPENDED | 2116 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| GBPCAD:OTC | SUSPENDED | 2114 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| GBPCHF:OTC | SUSPENDED | 2115 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| GBPNZD:OTC | SUSPENDED | 2132 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| NZDCAD:OTC | SUSPENDED | 2137 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| NZDJPY:OTC | SUSPENDED | 2138 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| NZDCHF:OTC | SUSPENDED | 2202 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| USDMXN:OTC | NOT_OFFERED | - | false | open | open | open | SESSION_DATA_STALE | WS_INIT_CATALOG_ALL_SUSPENDED |
| USDBRL:OTC | NOT_OFFERED | - | false | open | absent | absent | SESSION_DATA_STALE | WS_INIT_CATALOG_ALL_SUSPENDED |
| USDTRY:OTC | SUSPENDED | 2124 | true | open | open | open | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| USDZAR:OTC | SUSPENDED | 1380 | true | open | open | open | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| XAUUSD:NORMAL | NOT_OFFERED | - | false | open | open | open | SESSION_DATA_STALE | WS_INIT_CATALOG_ALL_SUSPENDED |
| XAGUSD:NORMAL | SUSPENDED | 1913 | true | open | open | open | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| US30:NORMAL | SUSPENDED | 1472 | true | open | open | open | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| US100:NORMAL | SUSPENDED | 1471 | true | open | open | open | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| US500:NORMAL | SUSPENDED | 1470 | true | open | open | open | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| US2000:NORMAL | SUSPENDED | 1473 | true | open | open | open | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| GER30:NORMAL | SUSPENDED | 1478 | true | open | open | open | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| UK100:NORMAL | SUSPENDED | 1475 | true | open | open | open | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| JP225:NORMAL | SUSPENDED | 1476 | true | open | open | open | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| AUS200:NORMAL | SUSPENDED | 1481 | true | open | open | open | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| EU50:NORMAL | SUSPENDED | 1480 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| HK33:NORMAL | SUSPENDED | 1477 | true | open | absent | absent | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| FR40:NORMAL | SUSPENDED | 1479 | true | open | open | open | CONFLICT | WS_INIT_CATALOG_ALL_SUSPENDED |
| SP35:NORMAL | SUSPENDED | 1474 | true | absent | absent | absent | BROKER_CONFIRMED_CLOSED/SUSPENDED | NO_MCP_COUNTERPART_NON_OPEN |
| BTCUSD:OTC | NOT_OFFERED | - | false | absent | absent | absent | NOT_OFFERED_FOR_PRODUCT | ABSENT_FROM_BROKER_CATALOG |

## FRESH CRITIC (refutation attempts)

- **Is it genuinely market-closed (weekend/holiday/session hours)?** → REFUTED
  - UTC 2026-09-18T13:18:50.217Z; weekday=true; FX NORMAL expected open=true; OTC 24/7 expected open. MCP confirms open with future expirations.
- **Is it product-specific (Turbo vs Binary vs Digital)?** → REFUTED
  - Turbo 112/112 open, Binary 126/126 open, Digital 126/126 open — all three products report the same markets open.
- **Is it NORMAL vs OTC specific?** → BOTH
  - CONFLICTs: NORMAL=13, OTC=3. OTC major pairs (EURUSD/GBPUSD/USDJPY/AUDUSD/USDCAD) are absent from the MCP catalog (withdrawn during NORMAL hours) so TraceCom NOT_OFFERED is consistent there; OTC exotics (EURNZD, USDTRY, USDZAR) are MCP-open while TraceCom suspends.
- **Could the MCP itself be stale/cached?** → REFUTED
  - Digital get_instruments generated_at=2026-09-18T13:17:05Z,2026-09-18T13:17:05Z,2026-09-18T13:17:05Z,2026-09-18T13:17:05Z with future expiration 2026-09-18T13:19:00Z,2026-09-18T13:19:00Z,2026-09-18T13:19:00Z,2026-09-18T13:19:00Z; turbo/binary expirations are all in the future and profit_percent is present.
- **Is TraceCom's NOT_OFFERED list consistent with the MCP catalog (genuinely absent) or a resolver artifact?** → MIXED
  - OTC majors absent from MCP -> consistent. But USDJPY/GBPUSD/AUDUSD/EURJPY/EURGBP/AUDJPY/GBPJPY NORMAL, XAUUSD NORMAL, USDMXN/USDBRL OTC are MCP-open yet TraceCom NOT_OFFERED -> WS catalog omission (resolver artifact).
- **Do any markets share the SAME IQ asset_id with opposite flags (open vs suspended)?** → CONFIRMED
  - 16 market(s): EURUSD:NORMAL=[1861]; USDCAD:NORMAL=[1878]; EURNZD:OTC=[2122]; USDTRY:OTC=[2124]; USDZAR:OTC=[1380]; XAGUSD:NORMAL=[1913]; US30:NORMAL=[1472]; US100:NORMAL=[1471]; US500:NORMAL=[1470]; US2000:NORMAL=[1473]; GER30:NORMAL=[1478]; UK100:NORMAL=[1475]; JP225:NORMAL=[1476]; AUS200:NORMAL=[1481]; HK33:NORMAL=[1477]; FR40:NORMAL=[1479]
- **How many markets disagree (MCP open vs TraceCom non-open)?** → COUNTED
  - 26 of 55 markets; unmatched to MCP: 29.

## Verdict

- State: **WRONG** (PROVEN)
- MCP (turbo/binary/digital) reports 112/112, 126/126, 126/126 assets open with future expirations, while TraceCom reports 26 market(s) SUSPENDED/NOT_OFFERED. The TraceCom WS init catalog marks ALL 72/72 candidate actives as is_suspended=true (a session-catalog anomaly), so the 0-OPEN state is a TraceCom session/resolver artifact, not genuine market closure.
- MCP open keys: USDZAR:OTC, USDSGD:OTC, USDHKD:OTC, USDINR:OTC, US500:NORMAL, US100:NORMAL, US30:NORMAL, US2000:NORMAL, UK100:NORMAL, JP225:NORMAL, HK33:NORMAL, GER30:NORMAL, FR40:NORMAL, AUS200:NORMAL, ASMLHOLDINGNV:NORMAL, EURUSD:NORMAL, EURGBP:NORMAL, EURJPY:NORMAL, USDJPY:NORMAL, GBPJPY:NORMAL, GBPUSD:NORMAL, AUDCAD:NORMAL, AUDJPY:NORMAL, AUDUSD:NORMAL, GBPAUD:NORMAL, GBPNZD:NORMAL, NZDCAD:NORMAL, AUDCHF:NORMAL, USDTHB:NORMAL, NZDUSD:NORMAL, GBPCAD:NORMAL, AUDNZD:NORMAL, EURNZD:NORMAL, XAUUSD:NORMAL, XAGUSD:NORMAL, CRUDEOILWTI:NORMAL, CRUDEOILBRENT:NORMAL, ETHUSD:OTC, US100:OTC, CARDANO:OTC, SOLUSD:OTC, JP225:OTC, RIPPLE:OTC, EURNZD:OTC, USDTRY:OTC, LITECOIN:OTC, VAULTA:OTC, USDPLN:OTC, JUPITER:OTC, DOGWIFHAT:OTC, PEPE:OTC, POLKADOT:OTC, COSMOS:OTC, SEI:OTC, DASH:OTC, ARBITRUM:OTC, WORLDCOIN:OTC, 1000SATS:OTC, SANDBOX:OTC, EURTHB:OTC, USDTHB:OTC, JPYTHB:OTC, USDARS:OTC, USDDOP:OTC, TRUMPCOIN:OTC, ONDO:OTC, DYDX:OTC, FARTCOIN:OTC, PUDGYPENGUINS:OTC, RAYDIUM:OTC, SUI:OTC, HBAR:OTC, FET:OTC, RENDER:OTC, TAO:OTC, USDBRL:OTC, USDCOP:OTC, USDMXN:OTC, PENUSD:OTC, FORMULAONEGROUP:OTC, URANIUM:OTC, PLATINUM:OTC, PALLADIUM:OTC, USDIDR:OTC, COCOA:OTC, COFFEE:OTC, COTTON:OTC, SUGAR:OTC, TERRACLASSIC:OTC, USDSAR:OTC, USDMYR:OTC, USDAED:OTC, USDVND:OTC, USDNGN:OTC, USDPHP:OTC, USDBOB:OTC, USDCLP:OTC, USDBDT:OTC, SPACEX:OTC, SPACEX:NORMAL, HYPERLIQUID:OTC, ANTHROPIC:OTC, OPENAI:OTC, MAGNIFICENT7:NORMAL, EURTHB:NORMAL, CADCHF:NORMAL, CADJPY:NORMAL, CHFJPY:NORMAL, EURAUD:NORMAL, EURCAD:NORMAL, EURCHF:NORMAL, USDCAD:NORMAL, NZDJPY:NORMAL, GBPCHF:NORMAL, TESLA:NORMAL, AMAZON:NORMAL, APPLEINC:NORMAL, BITCOIN:NORMAL, ETHEREUM:NORMAL, MICROSOFTCORPORATION:NORMAL, META:NORMAL, ALPHABETINC:NORMAL, DOLLARINDEX:NORMAL, YENINDEX:NORMAL, EUROINDEX:NORMAL, POUNDINDEX:NORMAL, CANADIANDOLLARINDEX:NORMAL, AUSTRALIANDOLLARINDEX:NORMAL, NVIDIA:NORMAL, RIPPLE:NORMAL, DOGECOIN:OTC, VISA:OTC, AIEUROPE:NORMAL, LUXURY:NORMAL

> READ-ONLY evidence artifact. No trading or relay logic was modified. Token never stored; output redacted.
