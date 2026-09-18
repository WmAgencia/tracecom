# CURRENT vs Official MCP — resultado real (Fases 3–4)

Coleta: probe **read-only allowlistado** (`get_capabilities`, `get_limits`, `list_assets`, `list_balances`)
em binary + turbo. Nenhuma tool de ordem foi chamada. Token nunca gravado; saída redigida.

## Achados de plataforma
- `get_capabilities` → `{"mode":"read-write"}` nos dois servidores: **o token PODE escrever**. Por isso os gates de execução são obrigatórios.
- `get_limits` → `gateway 200/60s`, `read 60/60s`, `write 10/60s`, `scope: per-user`.
  O próprio servidor classifica: `list_assets/list_balances/list_positions/get_candles/get_trade_history` = **read**; `place_trade/sell_position/rollover_position` = **write**.
- Latência observada: `get_limits` 201–213 ms · `list_balances` 221 ms · `get_capabilities` 602–610 ms · `list_assets` 602–665 ms.
  → ordem de grandeza **10× maior** que o WS atual (ACK p50 177 ms); não serve para tick/JIT.
- `list_assets` (binary e turbo) por ativo: `asset_id`, `name` canônico (ex.: `"EUR/USD (OTC)"`), `is_open`, `profit_percent` (payout), `precision`, `expirations[]`, `buyback_deadtime_seconds` (turbo).

## Matriz
| CAPABILITY | TRACE/COM ATUAL | OFFICIAL MCP (real) | RESULTADO |
|---|---|---|---|
| Market catalog / identidade canônica | `canonicalFromName` (`-op`, `:N`, OTC, aliases) + catálogo 774 | `asset_id` + `name` canônico **incluindo `(OTC)`**; `US 500`=1470, `US 100`=1471 | **MCP_CAN_VALIDATE** (substituir parte do parser só após mapear `asset_id`↔`marketKey` nos 55) |
| Instrument / activeId | activeId por mercado (ex.: 1861 FX NORMAL) | `asset_id` (76, 1470…). Coincide em índices (1470/1471); divergente em FX | **INSUFFICIENT_EVIDENCE** (precisa mapeamento 1:1) |
| Availability | 5 estados `OPEN/DISABLED/SUSPENDED/NOT_OFFERED/UNKNOWN`, refresh 60s/20s, stale→UNKNOWN | somente `is_open` booleano | **CURRENT_STILL_REQUIRED** (MCP não distingue SUSPENDED/DISABLED) |
| Payout | `initialization-data.option.profit.commission` | `profit_percent` por ativo (ex.: 89/90/91) | **MCP_CAN_VALIDATE** |
| Server time (JIT) | fonte interna, drift p50 −473 ms | **não existe tool de server time**; só `expirations[]` (binary 5 min, turbo 60 s) | **CURRENT_STILL_REQUIRED** |
| Candles | WS stream + Feature Engine | `get_candles(asset_id, size, count)` read | **MCP_CAN_VALIDATE** (batch/backfill, não streaming) |
| Ticks / preço corrente | WS em tempo real | **não exposto** | **CURRENT_STILL_REQUIRED** |
| Settlement (WIN/LOSS/DRAW, PnL realizado) | settlement interno por price labels | `get_trade_history` (posições fechadas) | **MCP_CAN_VALIDATE** |
| Modo PRACTICE/REAL | `modeState` + `realModeEnabled=false` | `list_balances.type`: `regular` vs `training` — **inequívoco** | **MCP_CAN_VALIDATE** |
| Open/historical positions | journal + reconciliação | `list_positions` / `get_trade_history` | **MCP_CAN_VALIDATE** |
| Order status | interno | não há tool dedicada | **INSUFFICIENT_EVIDENCE** |
| Execution (write) | `brokerAutomation=WS_ONLY_PRACTICE`; só Execution Gate escreve | `place_trade`, `sell_position`, `rollover_position` (write, 10/min) | **CURRENT_STILL_REQUIRED** — MCP apenas atrás do Execution Gate, nunca por LLM |

## Divergência encontrada (importante)
`list_balances` retornou:
- `regular` — BRL, `amount: 0`
- `training` — USD, `amount: 60`

Nosso runtime reporta **PRACTICE verificado, saldo USD 10.142,60**. O `training` do MCP é **60 USD** → o MCP **não está lendo a mesma conta/instância** que o nosso pipeline (ou é outro usuário/tenant). Antes de qualquer shadow-compare de PnL, essa divergência precisa ser explicada e reconciliada.

## Veredito desta fase
- Binary/Turbo **não substituem** o WS: faltam ticks/preço corrente/server time e a latência é 10× maior.
- **Complementam com força** em: catálogo canônico (`asset_id`/`name`), payout (`profit_percent`), expirations, modo de conta inequívoco, posições e histórico.
- Nenhuma migração. Infra atual permanece executor e fallback. MCP em READ-ONLY/SHADOW.
