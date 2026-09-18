# IQ MCP — Shadow Mode (reconciliação TraceCom ↔ MCP)

Comparação contínua, somente leitura, entre o snapshot vivo do escritório
TraceCom (`GET /api/iq/office`) e o catálogo/conta do IQ Official MCP
(produto `binary` ou `turbo`). Gera registros de diagnóstico, métricas de
concordância e histórico JSONL. **Nada é substituído automaticamente.**

- Nenhuma ordem, nenhuma escrita MCP, nenhum import do caminho de trading.
- Falha do MCP nunca afeta trading: todo erro retorna `{ ok:false }` (fail-soft).
- Roda apenas quando `IQ_MCP_ENABLED=true` **E** `IQ_MCP_SHADOW=true`.
- Cadência por timeout recursivo com jitter (default 60s + até 5s), nunca por
  tick e nunca dentro de JIT/feature-engine/decisão.

Arquivos:

| Arquivo | Papel |
| --- | --- |
| `relay/iq-mcp/reconciliation.mjs` | Comparação pura + persistência JSONL (`buildComparisons`, `summarize`, `persistRecords`, `loadHistory`) |
| `relay/iq-mcp/shadow.mjs` | Orquestrador/agendador (`IQMCPShadowRunner`, `shadowEnabled`, `getShadowStatus()`) |
| `tests/ai/iq-mcp-reconciliation.test.ts` | 24 testes mockados (sem rede) |
| `tests/ai/iq-mcp-shadow.test.ts` | 9 testes mockados (scheduler/transporte) |

## Como habilitar

Somente via ambiente (o token **nunca** entra em arquivo, log, doc ou commit):

```powershell
$env:IQ_MCP_TOKEN     = "<seu-token>"   # apenas em memória de processo
$env:IQ_MCP_ENABLED   = "true"
$env:IQ_MCP_SHADOW    = "true"

node -e "import('./relay/iq-mcp/shadow.mjs').then(({ IQMCPShadowRunner }) => { const r = new IQMCPShadowRunner(); r.start(); console.log(r.getShadowStatus()); })"
```

`new IQMCPShadowRunner()` cria o adapter read-only internamente; nada no
runtime de trading é tocado. `start()` agenda a primeira execução para
`intervalMs + jitter` (use `start({ immediate: true })` para rodar já).

## Matriz de ambiente

| Variável | Default | Papel |
| --- | --- | --- |
| `IQ_MCP_ENABLED` | `false` | Chave mestra do adapter/orquestrador |
| `IQ_MCP_SHADOW` | `false` (exigido `true`) | Liga o shadow; o adapter isolado trata como `true` |
| `IQ_MCP_WRITE_ENABLED` | `false` | **Ignorado** — toda tool de escrita segue bloqueada |
| `IQ_MCP_TOKEN` | — | Segredo, somente env (nunca persistido) |
| `IQ_MCP_TOKEN_FILE` | — | Alternativa de arquivo de token |
| `IQ_MCP_TIMEOUT_MS` | `20000` | Timeout HTTP do adapter |
| `IQ_MCP_PRODUCT` | `binary` | `binary` \| `turbo` |
| `IQ_MCP_SHADOW_INTERVAL_MS` | `60000` | Intervalo base do scheduler |
| `IQ_MCP_SHADOW_JITTER_MS` | `5000` | Jitter aleatório somado ao intervalo |
| `IQ_MCP_SHADOW_TIMEOUT_MS` | `15000` | Timeout do fetch do office |
| `IQ_MCP_OFFICE_URL` | `https://tracecom.consecom.com.br/api/iq/office` | Fonte interna |
| `IQ_MCP_RECONCILIATION_PATH` | `diagnostic-results/iq-mcp-reconciliation.jsonl` | Histórico JSONL |
| `IQ_MCP_RECONCILIATION_PERSIST` | `true` | Habilita persistência |

## O que é comparado

Matching de mercado MCP: o nome do asset define canônico e tipo
(`"EUR/USD (OTC)"` → `EURUSD:OTC`; `"US 500"` → `US500:NORMAL`). Um mercado
interno só pareia com asset de **mesmo canônico E mesmo tipo** — `EURUSD:OTC`
nunca é comparado com `EURUSD:NORMAL` (e vice-versa). Se o mercado expuser
`mcpAssetId`, o pareamento explícito tem precedência; id ausente ou que aponte
para o tipo errado vira `CONFLICT` de CATALOG.

| Campo | Lado TraceCom | Lado MCP | Regra |
| --- | --- | --- | --- |
| `CATALOG` | `marketKey`, `canonical`, `marketType`, `activeId` | `name`, `asset_id`, tipo derivado | canônico+tipo iguais; `activeId` ↔ `asset_id` quando ambos existem |
| `PAYOUT` | `payout` | `profit_percent` | igualdade exata |
| `EXPIRATIONS` | `expirations[]` (se existir) | `expirations[]` | conjuntos iguais; sem lado interno → `NOT_COMPARABLE` |
| `AVAILABILITY` | `availability` (5 estados) | `is_open` (booleano) | só `OPEN` ↔ `is_open=true`; demais estados `NOT_COMPARABLE` |
| `ACCOUNT` | `modeState.practice.{balance,currency}`, `mode` | `list_balances` (`regular`/`training`) | ver tolerâncias abaixo |

> **Disponibilidade:** o booleano `is_open` **nunca** é convertido no enum de
> 5 estados. Para `DISABLED`, `SUSPENDED`, `NOT_OFFERED` ou `UNKNOWN` o registro
> é `NOT_COMPARABLE` com nota explícita (`BOOLEAN_ONLY`), expondo o booleano
> cru em `mcpValue`. `OPEN` + `is_open=false` é `CONFLICT` honesto.

## Tolerâncias

| Regra | Valor |
| --- | --- |
| PAYOUT | exato (qualquer Δ = `CONFLICT`) |
| ACCOUNT.balance `MINOR_DIFFERENCE` | `|Δ| ≤ 1%` **e** `|Δ| ≤ 1` unidade (ambos) |
| ACCOUNT.currency / type / mode | exato (`MIXED` aceito quando o tipo exigido existe) |
| `STALE_SOURCE` | skew `|mcpTimestamp − sourceTimestamp| > 5 min`; substitui MATCH/MINOR/CONFLICT, nunca `NOT_COMPARABLE` |

## Classificações

`MATCH` · `MINOR_DIFFERENCE` · `CONFLICT` · `NOT_COMPARABLE` · `STALE_SOURCE`

Cada registro: `{ timestamp, marketKey, field, currentValue, mcpValue,
sourceTimestamp, difference, classification }` — `difference` carrega
`{ metric, code, delta, skewMs, note }` para auditoria.

`summarize(records)` devolve contagens por campo e
`agreementRate = (MATCH + MINOR_DIFFERENCE) / comparable`, com
`comparable = MATCH + MINOR_DIFFERENCE + CONFLICT` (stale e não comparáveis
ficam fora do denominador).

## Métricas / status

`runner.getShadowStatus()`:

```json
{
  "enabled": true, "running": true, "intervalMs": 60000, "jitterMs": 5000,
  "nextRunAt": 1789700000000, "lastRunAt": 1789699940000, "lastDurationMs": 412,
  "runs": 10, "failures": 0, "consecutiveFailures": 0,
  "mcpHealth": "CONNECTED", "agreementRate": 0.94,
  "summary": { "total": 36, "comparable": 22, "agreementRate": 0.94, "perField": {} },
  "lastError": null,
  "persistence": { "path": "diagnostic-results/iq-mcp-reconciliation.jsonl", "writes": 10, "records": 360, "errors": 0 },
  "practiceOnly": true
}
```

`mcpHealth` segue o adapter: `CONNECTED | DEGRADED | RATE_LIMITED |
AUTH_ERROR | UNAVAILABLE`. `runs` só conta execuções com as duas chaves ligadas;
com o shadow desligado, `runOnce()` retorna `MCP_SHADOW_DISABLED` sem fetch.

## Persistência

JSONL append-only (uma linha por registro). `persistRecords(records, { path })`
cria diretórios; `loadHistory({ path, limit })` ignora linhas corrompidas e
devolve as últimas N. O diretório `diagnostic-results/` é operacional — mantenha
`iq-mcp-reconciliation.jsonl` fora do versionamento (o arquivo é regenerável).

## Veredito por campo (nenhuma substituição automática)

| Campo | Veredito | Racional |
| --- | --- | --- |
| `CATALOG` (asset_id/nome/tipo) | **MCP AUTHORITY CANDIDATE** | MCP é a leitura direta do catálogo do broker; TraceCom mantém o catálogo operacional (enabled/estratégia) |
| `PAYOUT` | **MCP VALIDATOR** | Exato e em tempo real; valida o payout atual sem trocar a fonte |
| `EXPIRATIONS` | **NOT COMPARABLE** | TraceCom não expõe `expirations[]` hoje; `is_open` não substitui |
| `AVAILABILITY` | **MCP VALIDATOR** | Booleano só confirma/nega `OPEN`; o enum de 5 estados continua autoridade TraceCom |
| `ACCOUNT.balance` | **MCP VALIDATOR** | Tolerância mínima (1% e 1 unidade); divergência maior vira `CONFLICT` |
| `ACCOUNT.currency` | **MCP AUTHORITY CANDIDATE** | `training.currency` é a moeda real da conta de prática |
| `ACCOUNT.type/mode` | **MCP VALIDATOR** | Confirma presença de `training`/`regular`; modo interno permanece autoridade |

`KEEP CURRENT` continua valendo para todo o caminho de execução: o shadow é
evidência, não autoridade. Promoções de veredito exigem amostra histórica
(`loadHistory`) e decisão explícita fora deste módulo.
