# Refatoração de provider de IA — Anthropic → OpenCode Go

Data: 2026-09-18 · Escopo: `src/**`, `api/**`, `scripts/**`, `tests/**` (relay/** intocado).

## Resultado

- Provider **default = `openCodeGo`**, modelo **`deepseek-v4.1-flash`**.
- Anthropic (`claude-opus-5`, `claude-fable-5-1`) permanece implementado, porém
  **NÃO-default**: só é selecionado com `AI_PROVIDER=anthropic` explícito.
- Sem chave do provider ativo o app **boota e opera em dry-run** (`StaticAiClient`),
  sem crash e sem inventar dados.
- A chave nunca é serializada: redação por padrão em erros, logs, spans,
  details HTTP e respostas.

## Variáveis de ambiente (nomes canônicos)

| Variável | Default | Uso |
|---|---|---|
| `AI_PROVIDER` | `openCodeGo` | `openCodeGo` \| `anthropic` \| `static` |
| `AI_MODEL` | `deepseek-v4.1-flash` | modelo do provider ativo |
| `OPENCODE_GO_API_KEY` | — | chave server-side (somente env; nunca em arquivo/repo) |
| `OPENCODE_GO_BASE_URL` | `https://opencode.ai/zen/go/v1` | base OpenAI-compatible |
| `OPENCODE_GO_MAX_TOKENS` | `8192` | limite de output |
| `OPENCODE_GO_TIMEOUT_MS` | `60000` | timeout por chamada |
| `ANTHROPIC_*` / `FABLE_*` | legados | só usados com `AI_PROVIDER=anthropic` |

`.env.example` atualizado; nenhum valor real de chave foi escrito.

## Inventário (antes da refatoração)

(a) leitura de env/chave Anthropic
- `src/config/env.ts:20,89` (`ANTHROPIC_API_KEY`), `:40-42,96-98` (`FABLE_API_KEY/BASE_URL/MODEL`)
- `api/http.ts:199` (`FABLE_API_KEY`), `:901` (`NEXXUS_API_KEY || FABLE_API_KEY`)
- `api/live-api.ts:246` (`NEXXUS_API_KEY`, `FABLE_API_KEY` em `secretPresent`)
- `src/cli/serve.ts:53` (`config.fable.apiKey`)
- `scripts/smoke-anthropic.mts:12-21`, `scripts/smoke-thinking.mts:12-19`
- `scripts/diagnostic-service.mjs:5-6` (`NEXXUS_BASE_URL`, `NEXXUS_API_KEY`)

(b) modelo Anthropic hardcoded
- `src/config/env.ts:22` (`claude-opus-5`), `:42` (`claude-fable-5-1`)
- `src/research/provenance.ts:56` (`claude-opus-5`, `claude-fable-5-1`)
- `api/http.ts:220` (`claude-opus-5`), `:278` (`claude-fable-5-1`), `:885,910` (`claude-opus-5`)
- `api/live-api.ts:243` (`claude-opus-5`, `claude-fable-5-1`)
- `scripts/diagnostic-service.mjs:29` (descoberta por regex `/fable\s*5/i`)

(c) import/cliente Anthropic
- `src/ai/anthropic.ts` (cliente Messages API)
- `src/ai/client.ts:16` (import) e factory `createAiClient`
- `src/ai/fable-trader.ts` (`/v1/messages`, header `anthropic-version`)
- `src/vision/provider.ts:53`, `api/vision-provider.ts:78` (Nexxus Vision Anthropic-compatível)
- `scripts/smoke-*.mts`

(d) provider default
- `src/ai/client.ts:101-128` (chave → Anthropic; sem chave → static)
- `src/app/index.ts:70-85` (Anthropic por padrão)
- `api/http.ts:222` (Go só se o relay estiver `CONFIGURED`; senão caía em Anthropic/Fable silenciosamente)

## O que mudou

- **Novo `src/ai/opencode-go.ts`**: `OpenCodeGoClient` OpenAI-compatible
  (`POST {base}/chat/completions`, `Authorization: Bearer`, `x-opencode-session`
  derivado sem segredos) + `OPENCODE_GO_DEFAULT_MODEL = deepseek-v4.1-flash`.
- **`src/ai/client.ts`**: `OpenCodeGoAiClient`; `createAiClient` aceita
  `provider` (default `openCodeGo`); Anthropic vira branch explícito; sem chave →
  `StaticAiClient`.
- **`src/config/env.ts`**: novas vars + bloco `ai { provider, model, apiKey,
  openCodeGo }`; `aiConfigured` reflete a chave do provider ATIVO; Anthropic key
  sozinha não ativa mais nada; chave ausente não lança.
- **`src/app/index.ts`**: monta IA a partir de `config.ai`; engine usa
  `config.ai.model`.
- **`src/cli/serve.ts`**: `FableTraderClient` com `provider` conforme config
  (Go default; Anthropic legado).
- **`src/ai/fable-trader.ts`**: suporta wire OpenAI (image_url) com default
  `openCodeGo`, mantendo o wire Messages API via `provider: "anthropic"`.
- **`api/http.ts`**: modelos default `deepseek-v4.1-flash`; Go ativo via relay;
  sem relay e sem Anthropic explícito → falha fechada `ai_provider_not_configured`
  (fim do fallback silencioso); wire Anthropic só com `AI_PROVIDER=anthropic` +
  `FABLE_API_KEY`.
- **`api/live-api.ts`**: models default Go; `secretPresent("OPENCODE_GO_API_KEY")`.
- **`api/vision-provider.ts` / `src/vision/provider.ts`**: mantidos como adapter
  Nexxus legado (não-default), sem alteração de contrato.
- **`scripts/diagnostic-service.mjs`**: passa a usar
  `OPENCODE_GO_API_KEY`/`OPENCODE_GO_BASE_URL`/`AI_MODEL` e `/chat/completions`.
- **`src/research/provenance.ts`**: `modelVersions` = `deepseek-v4.1-flash`.
- **`src/http/public/legacy-landing.html`**: instruções citam `OPENCODE_GO_API_KEY`.
- **`src/config/env.ts:6` e docstrings** atualizados.

## Redação de segredos (leak paths auditados e corrigidos)

- `src/observability/logger.ts`: novo `redactSecrets()` (padrões `sk-…`, JWT,
  `Bearer/Basic`, `x-api-key/authorization: …`) aplicado a (1) qualquer string em
  `redact()`, (2) `span.fail` (antes a mensagem de erro saía crua).
- `src/ai/anthropic.ts`: corpo de erro do provider redigido.
- `src/ai/fable-trader.ts`: corpo de erro do provider redigido.
- `src/ai/opencode-go.ts`: corpo de erro redigido; `x-opencode-session` é hash,
  nunca a chave; a chave só existe no header `Authorization` montado na hora.
- `api/http.ts`: novo `redactSecretPatterns()` aplicado a detalhes de erro
  (`FABLE_HTTP_*`, `/api/fable/trade` detail) — o bundle serverless não importa `src/`.
- `api/http.ts` `/api/ai/provider`: resposta expõe apenas `maskedKey` (últimos 4).
- `redact()` já redigia por NOME de campo; agora também por CONTEÚDO (defesa em
  profundidade). Nenhum dump (audit/provenance/context/diagnóstico) inclui chave.

## O que permanece Anthropic-capaz (desabilitado por padrão)

- `AnthropicClient` + `AnthropicAiClient` (com thinking/extended-output/fallbacks).
- `FableTraderClient` modo `anthropic` e `NexxusVisionProvider` (visão legada).
- `src/vision/provider.ts`, `api/vision-provider.ts`, scripts `smoke-anthropic.mts`
  e `smoke-thinking.mts`.
- Para re-habilitar: `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` (ou
  `FABLE_API_KEY` no trader de visão) e, se aplicável, `ANTHROPIC_MODEL`.

## Testes

- `tests/ai/opencode-go.test.ts` (novo): URL/headers/body, tools OpenAI,
  parseamento, redação de chave, default provider e degradação sem chave.
- `tests/ai/fable-trader.contract.test.ts`: contrato Anthropic explícito +
  novo contrato OpenCode Go default.
- `tests/config/env.test.ts`: default `openCodeGo`/`deepseek-v4.1-flash`, boot
  sem Anthropic, chave Anthropic sozinha não ativa, `AI_MODEL`, URLs/timeouts.
- `tests/agent/engine.test.ts`, `tests/research/trace-provenance.test.ts`,
  `tests/app/pan.test.ts`, `tests/observability/logger.test.ts` ajustados.

Verificação: `npx vitest run tests/ai` ✅ · `npx vitest run` (166 arquivos /
1416 testes) ✅ · `npx tsc -p tsconfig.json --noEmit` ✅.
