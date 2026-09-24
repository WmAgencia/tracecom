# Correcões GPT-6 — auditoria local (2026-09-24)

Escopo: correções raiz LOCAIS, sem deploy, sem push, sem armar conta, sem ativar AUTO, sem enviar ordem.

## Fonte de produção confirmada
- Repositório que alimenta `tracecom-live-relay`: `D:\tracecom\repo`, branch `main`, HEAD `3282d3e` (antes deste commit), deploy via `scripts/deploy-prod.mjs`.
- O checkout auditado (`fix/audit-20260923` / HEAD `1ee91ee`) NÃO existe nesta árvore — divergente/obsoleto. Produção é a fonte de verdade.

## A. WS_DISCONNECTED (fail-closed preservado)
- Mantido o desarme em toda desconexão/troca de sessão. Sem rearm automático (reconnect ≠ ARM).
- Instrumentado: `relay/iq-multi-runtime.mjs` (`#wire`) registra `lastDisconnect` { at, previousConnectionId, host, lastMessageAgeMs, closeCode, closeReason, offlineMs, reconnectResult } + eventos `ws.disconnected`/`ws.reconnected`; `relay/iqoption-ws.mjs` agora expõe `lastMessageAt` no payload de `closed`.
- Close code/reason NÃO estão disponíveis no RawWebSocket (null por design) — documentado; corrigir a causa demonstrada exige telemetria do broker, fora do escopo sem evidência.

## B. Stake global (sem R$1, sem fallback calculado)
- `relay/portfolio-gate.mjs` `resolveFinalStake`: removido `calculatedBankrollStake` da cadeia de fallback → sem stake positivo → `NO_STAKE_CONFIGURED`.
- `iq-multi-runtime.mjs`: construtor sem defaults R$1 (`defaultStake: null`, `calculatedBankrollStake: null`).
- `applyGlobalMaxStake` agora: `await` em cada persistência por mercado + config, erros acumulados → `STAKE_PERSIST_INCOMPLETE`; read-back por alvo → `STAKE_READBACK_MISMATCH`; expõe `revision` e `lastStakeAppliedAt`.
- `arm()`: bloqueia com `NO_STAKE_CONFIGURED` se não houver stake global válido e com `STAKE_READBACK_MISMATCH` se algum mercado habilitado divergir.
- Ordem: disposition `NO_STAKE_CONFIGURED` quando `resolveFinalStake` retorna nulo; registro ganha `stakeRevision`.
- Hard cap R$100 preservado como limite (nunca stake). Overrides só por ação explícita ("Aplicar a todos" sobrescreve todos os alvos).

## C. Economia de IA (zero chamadas quando inativo + invalidação in-flight)
- `relay/v3/agents/llm-client.mjs`: opção `activityCheck` — gate imediatamente antes de cada request (`SYSTEM_INACTIVE`, zero chamadas) e descarte de resposta in-flight após parada (`INACTIVE_INVALIDATED`).
- `iq-multi-runtime.mjs`: `#v3SystemActive()` (ARM PRACTICE / REAL armado / V3_ANALYSIS_ACTIVE) wired no client; bloqueio adicional antes de enfileirar no runner (`llmGate.suppressedInactive`); exposto `llmGate` no `/api/iq/v3/status`.
- Testes: `tests/v3/economy-gate.test.ts` (zero chamadas inativo; ativo normal; STOP descarta resposta).

## D. Feed
- `feedByMarket` no `/api/iq/v3/status`: por mercado habilitado { activeId, candles, newestAgeMs, state: WS_CONNECTED | HISTORY_HYDRATING | FEED_READY | FEED_STALE | FEED_DISCONNECTED | INSUFFICIENT_HISTORY }.
- Threshold de 40 candles e regras V2 NÃO alterados. Sem fabricar candle.

## E. 429 / limiter
- Backoff com jitter (±20%) no retry (`relay/llm-rate-limiter.mjs`), respeitando Retry-After e deadline; sem retry infinito.
- Log por chamada já estruturado (provider/model/requestId/status/latency/httpStatus); `recent429` conta respostas 429 (requests), documentado.
- Ordem de fallback preservada (NVIDIA deepseek → NVIDIA glm → Groq → Alibaba).

## F. Zero aprovações — evidência (read-only)
- DB: últimas 6h → 10.356 ciclos, 100% `CANCEL`/`AGENT_UNAVAILABLE`, zero aprovações; 29.615 ciclos no total.
- Logs V3_CYCLE ao vivo: `consensus:CANCEL`, `agreement:INSUFFICIENT_EVIDENCE`, latência sub-300ms → caminho de rejeição sem chamada LLM (prefilter). NÃO relaxado nenhum filtro.

## Testes
- `tests/v3/economy-gate.test.ts` (novo); fixtures de stake explícito em `request-order-atomicity`, `exact-expiration-order`, `entry-timing` (isolando R$1 dos fixtures antigos).
- Suíte: v3+observability+security **206/206**; typecheck e build OK. Suíte completa: apenas falhas pré-existentes (ai/research/strategies/vision — confirmadas via baseline com stash).
- Hash V3: `8cea543b…`.

## Não executado (por instrução explícita)
Nenhum deploy, push, alteração de Railway/env, arm, AUTO ou ordem.