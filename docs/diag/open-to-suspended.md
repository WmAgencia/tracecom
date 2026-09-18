# `/api/iq/office` — 30 OPEN → 0 OPEN / 35 SUSPENDED / 20 NOT_OFFERED

Data: 2026-09-18 (UTC). Escopo: diagnóstico + correção de infraestrutura. Zero ordens; somente leitura no broker.

## CAUSA RAIZ (uma linha)

A sessão WS de produção (long-lived, criada no reconnect de `2026-09-17T23:03–23:05Z`) passou a devolver um
snapshot **stale/degradado** de `get-initialization-data` — todos os ativos casados com `is_suspended=true` e 19
ativos ausentes — e `RuntimeAssetResolver.#merge` confiou nesse snapshot, sobrescrevendo `OPEN` já confirmado
pelo broker com `SUSPENDED`/`NOT_OFFERED`; o guard `staleSnapshot` existia mas era anulado porque `#merge`
resetava `staleSnapshot=false` em toda ingestão.

> Regra arquitetural violada: *feed desconhecido/stale/ausente ⇒ `UNKNOWN`, nunca `SUSPENDED`*.
> **PROVEN**: a sessão de produção devolvia snapshot degradado enquanto uma sessão NOVA (mesmo host, mesmo SSID)
> devolvia a verdade do broker no mesmo instante.

## EVIDÊNCIA

### `file:line` (estado ANTES da correção)

| Arquivo | Linha | O que fazia |
|---|---|---|
| `relay/asset-resolver.mjs` | 176 | `availability: open.length ? "OPEN" : selected.enabled ? "SUSPENDED" : "DISABLED"` — deriva SUSPENDED do snapshot |
| `relay/asset-resolver.mjs` | 185 | `for (const row of this.mapping.values()) row.staleSnapshot = false;` — **anula o guard de staleness em toda ingestão** |
| `relay/asset-resolver.mjs` | 189-197 | `get()` mapeia `staleSnapshot && SUSPENDED/NOT_FOUND/NOT_OFFERED/DISABLED → UNKNOWN` (guard correto, porém neutralizado) |
| `relay/iq-multi-runtime.mjs` | 312-326 | `#refreshBrokerAvailability`: ingere init-data e **já aplica** (`#applyResolver`), depois chama `get-options`; o timeout de `get-options` **não impede** o mapeamento SUSPENDED |
| `relay/iq-multi-runtime.mjs` | 344-378 | `#applyResolver`: `ctx.availability = resolved.availability` (sem corroboração) |
| `relay/server.mjs` | 39-53 | `await migrate()` no top-level: DB read-only ⇒ `CREATE TABLE` falha ⇒ **processo morre** (crash do 1º deploy) |

### Timeline (logs do relay, `IQ_MULTI_RESOLVED`)

| UTC | reason | open | resolved |
|---|---|---|---|
| 2026-09-17T20:43:29Z | `BOOTSTRAP` (start) | 37 | 54 |
| 2026-09-17T21:00:00Z | `PERIODIC` | 30 | 54 |
| 2026-09-17T22:05:25Z | `SUSPENDED_FAST` | 37 | 54 |
| **2026-09-17T23:05:42Z** | **`BOOTSTRAP` (reconnect)** | **0** | **35** |
| 2026-09-18T00:11Z → 13:19Z | `SUSPENDED_FAST` (a cada 20s) | 0 | 35 |

`reconnects=1`, `connectedAt≈2026-09-17T23:03:54Z`. A degradação começou exatamente no reconnect e nunca se recuperou
(até o redeploy). `IQ_MULTI_AVAILABILITY_REFRESH_FAILED GET_OPTIONS_TIMEOUT` em todos os ciclos ⇒ **sem corroboração**.

### JSON ao vivo

**ANTES** — `GET /api/iq/office` (13:14Z):
```json
{"connection":{"connected":true,"host":"ws.iqoption.com","reconnects":1,"healthy":true},
 "resolver":{"resolvedCount":35,"lastResolvedAt":1789737251886},
 "availabilityCounts":{"SUSPENDED":35,"NOT_OFFERED":20}}
```

**Evidência bruta do broker na sessão de produção** (`/api/iq/broker-audit?live=1`, 13:15Z) — **todo** ativo casado
com `susp=true`; `USDJPY:NORMAL` sem nenhum ativo:
```
EURUSD:NORMAL => front.EURUSD|turbo|en=True|susp=True ; front.EURUSD-op|turbo|en=True|susp=True ; ...
USDJPY:NORMAL => (vazio)
USDCAD:NORMAL => front.USDCAD|binary|en=True|susp=True ; front.USDCAD-op|binary|en=True|susp=True ; ...
```

**Sessão NOVA, mesmo host/SSID** (13:17–13:22Z, repetido 3x, inclusive após assinar `commission-changed` + candles):
```
sectionsSeen=["turbo","binary","blitz","groups"]
counts={"OPEN":26,"NOT_OFFERED":1,"SUSPENDED":28}  resolved=54
EURUSD:NORMAL => turbo:1861 en=true susp=false ; binary:1861 en=true susp=false
USDJPY:NORMAL => turbo:1865 en=true susp=false
```
> O resolver, alimentado pelo snapshot NOVO, produz 26 OPEN. Logo, **a lógica do resolver não era o defeito;
> o feed da sessão de produção é que estava stale.** O defeito de infra é confiar nesse feed.

**Causa do crash do 1º deploy** (Postgres read-only):
```
error: cannot execute CREATE TABLE in a read-only transaction
  at async migrate (file:///app/relay/server.mjs:42:3)
```
`SELECT current_setting('transaction_read_only') = 'on'` e log do Postgres: `FATAL: could not write to file
"pg_wal/xlogtemp.68": No space left on device` ⇒ **volume cheio (500 MB, ~490 MB usados)**.

## ANTES — 55 MARKET STATES (13:14Z)

Vocabulário: `BROKER_CONFIRMED_OPEN`, `BROKER_CONFIRMED_CLOSED/SUSPENDED`, `NOT_OFFERED_FOR_PRODUCT`,
`SESSION_DATA_STALE`, `SESSION_UNAVAILABLE`, `INCONCLUSIVE`.

No ANTES, **54 dos 55** mercados estavam em `SESSION_DATA_STALE` (o snapshot os listava como suspensos/ausentes,
mas eram broker-confirmados OPEN na sessão nova); `USDCHF:NORMAL` era `NOT_OFFERED_FOR_PRODUCT` real.

| marketKey | ANTES | classificação ANTES |
|---|---|---|
| AUDCAD:OTC | NOT_OFFERED | SESSION_DATA_STALE |
| AUDCHF:OTC | SUSPENDED | SESSION_DATA_STALE |
| AUDJPY:NORMAL | NOT_OFFERED | SESSION_DATA_STALE |
| AUDJPY:OTC | SUSPENDED | SESSION_DATA_STALE |
| AUDNZD:OTC | SUSPENDED | SESSION_DATA_STALE |
| AUDUSD:NORMAL | NOT_OFFERED | SESSION_DATA_STALE |
| AUDUSD:OTC | SUSPENDED | SESSION_DATA_STALE |
| AUS200:NORMAL | SUSPENDED | SESSION_DATA_STALE |
| BTCUSD:OTC | NOT_OFFERED | SESSION_DATA_STALE |
| CADCHF:OTC | SUSPENDED | SESSION_DATA_STALE |
| CADJPY:OTC | SUSPENDED | SESSION_DATA_STALE |
| EU50:NORMAL | SUSPENDED | SESSION_DATA_STALE |
| EURAUD:OTC | SUSPENDED | SESSION_DATA_STALE |
| EURCAD:OTC | SUSPENDED | SESSION_DATA_STALE |
| EURCHF:OTC | SUSPENDED | SESSION_DATA_STALE |
| EURGBP:NORMAL | NOT_OFFERED | SESSION_DATA_STALE |
| EURGBP:OTC | NOT_OFFERED | SESSION_DATA_STALE |
| EURJPY:NORMAL | NOT_OFFERED | SESSION_DATA_STALE |
| EURJPY:OTC | NOT_OFFERED | SESSION_DATA_STALE |
| EURNZD:OTC | SUSPENDED | SESSION_DATA_STALE |
| EURUSD:NORMAL | SUSPENDED | SESSION_DATA_STALE |
| EURUSD:OTC | NOT_OFFERED | SESSION_DATA_STALE |
| FR40:NORMAL | SUSPENDED | SESSION_DATA_STALE |
| GBPAUD:OTC | SUSPENDED | SESSION_DATA_STALE |
| GBPCAD:OTC | SUSPENDED | SESSION_DATA_STALE |
| GBPCHF:OTC | SUSPENDED | SESSION_DATA_STALE |
| GBPJPY:NORMAL | NOT_OFFERED | SESSION_DATA_STALE |
| GBPJPY:OTC | NOT_OFFERED | SESSION_DATA_STALE |
| GBPNZD:OTC | SUSPENDED | SESSION_DATA_STALE |
| GBPUSD:NORMAL | NOT_OFFERED | SESSION_DATA_STALE |
| GBPUSD:OTC | NOT_OFFERED | SESSION_DATA_STALE |
| GER30:NORMAL | SUSPENDED | SESSION_DATA_STALE |
| HK33:NORMAL | SUSPENDED | SESSION_DATA_STALE |
| JP225:NORMAL | SUSPENDED | SESSION_DATA_STALE |
| NZDCAD:OTC | SUSPENDED | SESSION_DATA_STALE |
| NZDCHF:OTC | SUSPENDED | SESSION_DATA_STALE |
| NZDJPY:OTC | SUSPENDED | SESSION_DATA_STALE |
| SP35:NORMAL | SUSPENDED | SESSION_DATA_STALE |
| UK100:NORMAL | SUSPENDED | SESSION_DATA_STALE |
| US100:NORMAL | SUSPENDED | SESSION_DATA_STALE |
| US2000:NORMAL | SUSPENDED | SESSION_DATA_STALE |
| US30:NORMAL | SUSPENDED | SESSION_DATA_STALE |
| US500:NORMAL | SUSPENDED | SESSION_DATA_STALE |
| USDBRL:OTC | NOT_OFFERED | SESSION_DATA_STALE |
| USDCAD:NORMAL | SUSPENDED | SESSION_DATA_STALE |
| USDCAD:OTC | SUSPENDED | SESSION_DATA_STALE |
| USDCHF:NORMAL | NOT_OFFERED | NOT_OFFERED_FOR_PRODUCT |
| USDCHF:OTC | NOT_OFFERED | SESSION_DATA_STALE |
| USDJPY:NORMAL | NOT_OFFERED | SESSION_DATA_STALE |
| USDJPY:OTC | NOT_OFFERED | SESSION_DATA_STALE |
| USDMXN:OTC | NOT_OFFERED | SESSION_DATA_STALE |
| USDTRY:OTC | SUSPENDED | SESSION_DATA_STALE |
| USDZAR:OTC | SUSPENDED | SESSION_DATA_STALE |
| XAGUSD:NORMAL | SUSPENDED | SESSION_DATA_STALE |
| XAUUSD:NORMAL | NOT_OFFERED | SESSION_DATA_STALE |

## CORREÇÃO (infra, mínima)

1. `relay/asset-resolver.mjs` — `#merge` agora calcula `previousResolved`/`nextResolved`. Se o novo snapshot é
   **incompleto** (`nextResolved < previousResolved`), mercados já broker-confirmados que seriam rebaixados para
   `SUSPENDED`/`NOT_OFFERED`/`DISABLED` são marcados `staleSnapshot=true` ⇒ `get()` devolve **`UNKNOWN`**
   (o guard existente passa a valer). Snapshot completo mantém `SUSPENDED` real. Diagnóstico exposto em
   `status().lastSnapshotIncomplete` / `lastSnapshotResolved`.
2. `relay/server.mjs` — `await migrate()` embrulhado em try/catch (`MIGRATE_SKIPPED`): DB read-only não derruba
   mais o relay no boot (foi a causa do crash do 1º deploy).
3. Deploy: `railway up` (deployment `077a8f10-479e-40a1-a2ab-e92a7e55bf11`, SUCCESS). O 1º deploy
   `5a4faec4-…` falhou por (2).

Nada de Brain G2, Feature Engine, Critic, Consensus, Quality Gate, JIT, Entry Location, MicroVeto,
Portfolio/Execution Gate ou estratégia foi tocado.

## DEPOIS — 55 MARKET STATES (13:44Z, pós-deploy)

`GET /api/iq/office`: `{"availabilityCounts":{"OPEN":26,"NOT_OFFERED":1,"SUSPENDED":28}}`,
`resolver.resolvedCount=54`, `lastSnapshotIncomplete=false`, `lastSnapshotResolved={previous:54,next:54}`,
`connection.healthy=true`, `reconnects=0`.
Os 28 `SUSPENDED` são **suspensões reais do broker** (evidência atual, snapshot completo) e os `OPEN` batem com a
sessão nova. `USDCHF:NORMAL` segue `NOT_OFFERED_FOR_PRODUCT`.

| marketKey | DEPOIS | classificação DEPOIS |
|---|---|---|
| AUDCAD:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| AUDCHF:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| AUDJPY:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| AUDJPY:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| AUDNZD:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| AUDUSD:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| AUDUSD:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| AUS200:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| BTCUSD:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| CADCHF:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| CADJPY:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| EU50:NORMAL | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| EURAUD:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| EURCAD:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| EURCHF:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| EURGBP:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| EURGBP:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| EURJPY:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| EURJPY:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| EURNZD:OTC | OPEN | BROKER_CONFIRMED_OPEN |
| EURUSD:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| EURUSD:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| FR40:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| GBPAUD:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| GBPCAD:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| GBPCHF:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| GBPJPY:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| GBPJPY:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| GBPNZD:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| GBPUSD:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| GBPUSD:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| GER30:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| HK33:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| JP225:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| NZDCAD:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| NZDCHF:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| NZDJPY:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| SP35:NORMAL | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| UK100:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| US100:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| US2000:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| US30:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| US500:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| USDBRL:OTC | OPEN | BROKER_CONFIRMED_OPEN |
| USDCAD:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| USDCAD:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| USDCHF:NORMAL | NOT_OFFERED | NOT_OFFERED_FOR_PRODUCT |
| USDCHF:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| USDJPY:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| USDJPY:OTC | SUSPENDED | BROKER_CONFIRMED_CLOSED/SUSPENDED |
| USDMXN:OTC | OPEN | BROKER_CONFIRMED_OPEN |
| USDTRY:OTC | OPEN | BROKER_CONFIRMED_OPEN |
| USDZAR:OTC | OPEN | BROKER_CONFIRMED_OPEN |
| XAGUSD:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |
| XAUUSD:NORMAL | OPEN | BROKER_CONFIRMED_OPEN |

## TESTES

- `tests/ai/market-status-arm.test.ts` (novos):
  - *snapshot INCOMPLETO … vira UNKNOWN, nunca SUSPENDED/NOT_OFFERED* — reproduz o cenário do incidente e valida a
    recuperação quando o snapshot volta completo.
  - *suspensão REAL do broker com snapshot completo continua SUSPENDED* — garante que o guard não mascara
    suspensão legítima.
- `tests/ai/multi-market.test.ts` (ajustado à regra): feed que encolhe inesperadamente ⇒ `UNKNOWN` por um ciclo;
  feed estável confirma ausência ⇒ `NOT_OFFERED` (sem fallback NORMAL→OTC).
- Execução: `npx vitest run tests/ai` ⇒ **587 passed / 41 files** (inclui `market-status-arm`, `multi-market`,
  `office-v2`, `office-v3-assets-world`).
- Verificação ao vivo: `broker-audit` pós-deploy confirma `lastSnapshotIncomplete=false`,
  `lastSnapshotResolved={previous:54,next:54}` e `OPEN:26`.

## PROVEN vs INFERRED

**PROVEN**
- A sessão de produção devolvia snapshot degradado (`is_suspended=true` em todos os ativos casados + ativos
  ausentes) enquanto uma sessão NOVA, mesmo host/SSID, devolvia 26 OPEN no mesmo instante.
- `#merge` mapeava esse snapshot para SUSPENDED/NOT_OFFERED e resetava `staleSnapshot=false` (linha 185),
  neutralizando o guard de `get()`.
- A transição 37→0 ocorreu num `BOOTSTRAP` (reconnect) em `2026-09-17T23:05:42Z` e persistiu.
- O 1º deploy crashou por `migrate()` em DB read-only; a causa do read-only é **volume cheio**
  (`No space left on device`).
- A correção + redeploy restaura `OPEN:26` e mantém `lastSnapshotIncomplete=false`.

**INFERRED**
- O *motivo* pelo qual a conexão antiga passou a servir snapshot stale (cache/snapshot por conexão no backend IQ,
  afinidade de nó, ou estado de manutenção) — **não provado**; não houve instrumentação dentro do container
  (SSH exigia host-key e não foi possível). O observável (sessão velha ≠ sessão nova) é PROVEN.
- A correlação temporal entre o DB read-only e o incidente: o DB já estava read-only antes do reconnect; não há
  evidência de nexo causal com o snapshot stale (INFERRED como independente).

## ACHADO DE INFRA ADJACENTE (fora do escopo do office)

`Postgres` (serviço `f5b60eb6-…`) está **read-only por volume cheio** (`500 MB`, `~490 MB` usados;
`pg_wal/xlogtemp: No space left on device`). Persistência do relay (`iq_runtime_config`, `iq_markets`,
`iq_audit_trail`) está falhando com `cannot execute INSERT in a read-only transaction`. Ação recomendada:
**expandir o volume** do Postgres e redeployar. O relay agora tolera o DB read-only no boot (`MIGRATE_SKIPPED`) e
segue operando em memória/WS.
