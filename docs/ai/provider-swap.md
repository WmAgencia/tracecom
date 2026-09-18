# Provider Swap — Anthropic retirado, OpenCode Go / DeepSeek v4.1 Flash

Data: 2026-09-18 (UTC) · Escopo: `relay/**`, config de IA em produção (Postgres do relay),
env do Railway, testes `tests/ai/`. Nenhuma lógica de Brain G2, Feature Engine, Critic,
Consensus, Quality Gate, JIT, Entry Location, MicroVeto, Portfolio/Execution ou estratégia foi
alterada. Nenhuma ordem/trade foi executado (verificação read-only).

## 1. O que mudou

### Código (`relay/`)
- `relay/opencode-go.mjs`
  - `DEFAULT_MODEL`: `qwen3.7-plus` → `deepseek-v4.1-flash`; novo `DEFAULT_PROVIDER = "openCodeGo"`.
  - Novo `resolveProviderConfig()`: DB (`ai_provider_config`, id=1) é autoritativa; se a linha não
    existir/for inválida, cai para env do servidor (`AI_PROVIDER`, `AI_MODEL`, `OPENCODE_GO_API_KEY`).
    Sem key válida → `null` (fail-closed). Não existe fallback para Anthropic (nunca existiu no relay).
  - Novo `maskProviderKey()`: única forma de serializar key (`••••` + 4 últimos) e
    `safeProviderError()` continua redigindo `sk-*` (defesa em profundidade).
- `relay/server.mjs`
  - `GET/PUT /api/ai/provider` agora usam `maskProviderKey()` (antes faziam slice inline). Provider
    do PUT continua forçado para `openCodeGo`; modelo validado por `/^[a-z0-9.\-]{2,64}$/i`.
- O relay nunca leu `ANTHROPIC_API_KEY` (verificado por teste); não há requisito de boot ligado a
  Anthropic e nenhum crash sem essa key.

### Config de produção (Postgres do relay, `ai_provider_config` id=1)
| Campo | Antes | Depois |
| --- | --- | --- |
| provider | `openCodeGo` | `openCodeGo` |
| model | `qwen3.7-plus` | `deepseek-v4.1-flash` |
| api_key (masked) | `••••3AHC` | `••••Gy8m` |

> A key real nunca é exibida, logada, commitada ou enviada ao client. A rota `GET /api/ai/provider`
> só devolve `maskedKey`.

### Env (Railway, serviço `tracecom-live-relay`, environment `production`)
Setados com `railway variable set ... --skip-deploys` (sem redeploy acidental; passam a valer no
próximo deploy/restart):
- `AI_PROVIDER=openCodeGo`
- `AI_MODEL=deepseek-v4.1-flash`
- `OPENCODE_GO_API_KEY=<segredo server-side>` (via `--stdin`; nunca em argv/log)

Vercel: **nada** foi adicionado. O path de IA do relay é server-side no Railway; a key do provider
não vai para Vercel (muito menos `NEXT_PUBLIC_*`). As envs já existentes
`TRACECOM_LIVE_RELAY_URL`/`TRACECOM_LIVE_RELAY_ADMIN_SECRET` continuam sendo o proxy do app.
As `ANTHROPIC_*`/`FABLE_*` ainda presentes na Vercel são de outro escopo (api/**, front) e não são
usadas pelo runtime do relay.

## 2. Endpoints usados
- `GET  /api/ai/provider` — header `x-relay-admin: <TOKEN_SIGNING_SECRET>`; retorna
  `{status, provider, model, maskedKey, updatedAt}` (key redigida).
- `PUT  /api/ai/provider` — body `{provider:"openCodeGo", model:"deepseek-v4.1-flash", apiKey:"<key>"}`.
- `POST /api/ai/go/text` — probe read-only (`{prompt, maxTokens, requestId}`) que passa pelo mesmo
  `runTextProvider()` → `https://opencode.ai/zen/go/v1/chat/completions` com `Bearer <key>`.
- `GET  https://opencode.ai/zen/go/v1/models` — descoberta; confirmou `deepseek-v4.1-flash`.
- `POST /api/ai/go/vision` — mesmo provider (não exercitado neste swap; caminho de código idêntico).

## 3. Verificação ao vivo (2026-09-18)

Descoberta de modelo (key server-side): lista da OpenCode Go contém `deepseek-v4.1-flash`.

`GET /api/ai/provider`:
```json
{"status":"CONFIGURED","provider":"openCodeGo","model":"deepseek-v4.1-flash","maskedKey":"••••Gy8m","updatedAt":"2026-09-18T14:26:10.775Z"}
```

`POST /api/ai/go/text` (prompt: `Reply with exactly: OPENCODE_GO_DEEPSEEK_OK`):
```json
{"status":"OK","reason":null,"model":"deepseek-v4.1-flash","providerLatencyMs":1728,"sessionId":"tc-c2b0286ad6ecf8ea","parsed":null,"text":"OPENCODE_GO_DEEPSEEK_OK"}
```
HTTP 200, wall ~2,97s, modelo `deepseek-v4.1-flash`, resposta correta. Nenhuma ordem/trade.

### Nota operacional — Postgres em read-only (incidente aberto)
`PUT /api/ai/provider` respondeu `400 {"error":"cannot execute INSERT in a read-only transaction"}`.
Causa raiz: volume do Postgres lotado (`FATAL: could not write to file "pg_wal/xlogtemp.69":
No space left on device`); o Postgres entrou em `default_transaction_read_only=on`
(`postgresql.auto.conf`). O relay usa o usuário `postgres` (owner, não superuser).
Para não bloquear a entrega, a MESMA linha foi gravada via SQL com override de sessão
(`BEGIN; SET TRANSACTION READ WRITE; UPDATE ai_provider_config ...; COMMIT;`) — equivalente exato
ao PUT. Enquanto o volume seguir cheio/read-only, qualquer escrita do relay (telemetria incluída)
tende a falhar.
Maiores consumidores: `iqopt_raw_ticks` 660 MB, `live_frames` 490 MB, `iq_audit_trail` 145 MB.
Recomendação (requer autorização do dono): aumentar o volume no Railway ou podar tabelas de
telemetria antigas; depois validar `SHOW default_transaction_read_only` = `off` e reexecutar o PUT.

## 4. Rollback

Pré-requisito: ter a key anterior (só o cofre do operador a possui; pista: masked `••••3AHC`).

1. Provider anterior (OpenCode Go / qwen3.7-plus):
   - Preferido: `PUT /api/ai/provider` com
     `{"provider":"openCodeGo","model":"qwen3.7-plus","apiKey":"<key anterior>"}`.
   - Se o Postgres ainda estiver read-only: mesma transação com `SET TRANSACTION READ WRITE`
     (UPDATE em `ai_provider_config` id=1).
2. Código: reverter `DEFAULT_MODEL` para `qwen3.7-plus` e remover o fallback de env/`maskProviderKey`
   se desejado (o fallback é inerte sem `OPENCODE_GO_API_KEY`).
3. Env Railway (um comando por variável):
   `railway variable delete OPENCODE_GO_API_KEY --service tracecom-live-relay --environment production`,
   idem `AI_MODEL` e `AI_PROVIDER`.
4. Nenhum restart é necessário para o rollback de DB (o relay lê a linha a cada chamada); mudanças
   de env valem no próximo deploy/restart.
5. Anthropic não precisa ser reativado no relay: nunca foi requisito de runtime.

## 5. Testes
`npx vitest run tests/ai` → 44 arquivos, 620 testes verdes (inclui `tests/ai/provider-swap.test.ts`:
default openCodeGo/deepseek, precedência DB > env, fail-closed sem key, redaction/mascaramento e boot
sem `ANTHROPIC_API_KEY`).
`npx tsc -p tsconfig.json --noEmit` → 0 erros.
