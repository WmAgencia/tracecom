# SECURITY HARDENING — REAUDITORIA A01–A12

Data: 2026-09-23 · Commit auditado: `2a986e1` · HEAD da correção: `c1fc018` + este trabalho
Escopo: achados A01–A12 da auditoria externa + Fases 7–12 do plano de correção.
Regra de rollout: **REAL permanece DISARMED**; execução automática PRACTICE **desativada** em
qualquer deploy que toque dispatch/persistência/autorização; nenhuma ordem real; adaptadores
simulados nos testes. Conclusão máxima permitida: `SECURITY HARDENING COMPLETE FOR PRACTICE VALIDATION`.

## Tabela de reauditoria

| ID | Achado | Status | Evidência (arquivo:linha / teste) |
|----|--------|--------|-----------------------------------|
| A01 | Credenciais hardcoded em scripts | `CODE_REMOVED_SECRET` + `ROTATION_PENDING_EXTERNAL` | 9 scripts passam a exigir env (`SUPABASE_DB_URL`/`DATABASE_URL`; suítes com `TEST_DATABASE_URL` e SKIP sem ele). `scripts/secret-scan.mjs` (24ª suíte, roda no CI) = `SECRET_SCAN OK (8120 arquivos)`. Rotação: ver seção Pendências. |
| A02 | GETs privados sem autenticação | FIXED | `src/security/operator-gate.ts` (decisão pura) + `api/http.ts` (gate global; `/api/auth/panel` exige chave; 503 fail-closed sem configuração). Testes: `tests/security/operator-gate.test.ts`, `tests/security/http-private-get.test.ts`, `tests/security/iq-mutation-auth.test.ts` (15). |
| A03 | TOCTOU entre gate e `placeOrder` | FIXED | `#revalidateBeforeSubmit` (relay/iq-multi-runtime.mjs) roda após o último await e imediatamente antes do socket: lock/kill-switch/broker/conta/armed/deadline 300s/expiry/decision staleness. `tests/security/request-order-atomicity.test.ts` Casos A–E. |
| A04 | Bindings SQL errados na observabilidade | FIXED | `#canonicalExecutionFilter` gera params exatos por query; `strategyObservability` usa `params` na amostra/grupos/rolling e `[...scopeParams, hash]` na integridade. Prova em Postgres real (PGlite): `tests/security/postgres-observability.test.ts` (falha 4/4 no commit auditado; passa 5/5 agora) + `scripts/stage4-observability-tests.mjs` #16–#17. |
| A05 | Erro de DB virando “N=0 ok” | FIXED | `available:false`, `error:{code:OBS_DB_ERROR}`, `integrity.verified:false`, `ok:null`, alerta `UNVERIFIED`; stats com `error:STATS_DB_ERROR`. Testes PGlite A05 + script #18–#20. |
| A06 | Universo divergente entre stats e observability | FIXED | `#canonicalExecutionFilter` compartilhado (PRACTICE + SETTLED WIN/LOSS/DRAW + `test_only=false` + `excluded_from_stats=false` + hash quando informado); rota do relay passa `strategyHash`. Testes PGlite A06 + script #21–#22. |
| A07 | Sessão de painel emitida sem prova | FIXED | `/api/auth/panel` exige `x-operator-key` (ou `body.accessKey`); same-origin sozinho nunca cria sessão; `operator-auth.js` v3.0.0 pede a chave e reutiliza cookie HttpOnly. Testes de painel/CSRF/same-origin. |
| A08 | Inconsistência REAL | FIXED | `effectiveRealState()` = autoridade única (env + conta REAL armada + realMode autorizado/sessão ativa + kill switch + broker + estratégia ACTIVE) usada por status/gates; `directionAction`→`decisionAction` (ReferenceError real); identidade REAL = `PULLBACK_4060_300_AGENTIC_V2` (G2 removido da allowlist); `RealModeController.sessionActive()`. Teste `tests/security/real-consistency.test.ts` (3/4 falham no auditado, incl. `directionAction is not defined`; 4/4 agora). |
| A09 | Ordem órfã sem persistência durável | FIXED | `#persistExecution` detecta `dropped`/`rowCount 0`/exceção → `PERSISTENCE_REQUIRED_FAILED` e **zero placeOrder**; revalidação pré-socket. Casos F/G/G2/H. |
| A10 | Retenção de 35d vs série cumulativa | FIXED | Migração `053_strategy_daily_aggregates.sql`; poda move as linhas na MESMA instrução (`DELETE … RETURNING` → `INSERT … ON CONFLICT`) e stats/observability somam `archived` (nunca encolhem). Teste PGlite A10 (poda 13 linhas; N/PnL idênticos antes/depois). |
| A11 | Proxy sem sanitização de query | FIXED | `strategyQueryParams()` (allowlist `[A-Za-z0-9._:-]{1,120}`, `days` 1–365) aplicado a stats/observability; nada de query bruta. `tests/security/proxy-params.test.ts` (5). |
| A12 | CI não hermético | FIXED | CI: `npx vitest run tests/security` (PGlite real, edge auth, requestOrder original + broker simulado, REAL simulado) + `secret-scan` na suíte canônica. `run-all-tests.mjs` = 24 suítes; `npm run test:security` / `npm run secret:scan`. |

## Evidência agregada (Fase 10)

- `npm run build` OK (tsc + postbuild).
- `node scripts/run-all-tests.mjs` → `RUN_ALL_TESTS total=24 failed=0` (inclui secret-scan, invariantes 25/25, hash 16/16, settlement 14/14).
- `npx vitest run tests/security` → 72/72 em 9 arquivos.
- Regressão no repositório: baseline (HEAD auditado) 76 falhas → 57 após o trabalho; nenhum teste que passa no baseline falha agora (diff nome-a-nome; 2 casos intermitentes sob carga, estáveis isolados).
- `strategyHash` da V2 inalterado: `sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0`.

## Fase 7 (itens estruturais)

- Loader respeita `executable:false` explícito do manifesto (nunca inferido só do status) — `relay/execution/operational-strategy.mjs` + testes 15–16 do hash.
- `connection.execution.ready` é por conta: `readyPractice` / `readyReal` / `account`; PRACTICE nunca é prova de REAL — `stage3-connection-status-tests.mjs` (12/12).
- UI: `apiStrict` interrompe sequências de mutação em falha (ARM PRACTICE passo a passo, troca de conta, MESAS, MCP) — `stage4-frontend-tests.mjs` (37/37).

## Pendências externas

1. **A01 — rotação de credenciais (bloqueada por acesso)**: rotacionar a senha do banco no provedor
   (Supabase → Project Settings → Database → Reset database password), atualizar `DATABASE_URL` no
   Railway (relay) e na Vercel (edge) e reexecutar o deploy; invalidar a credencial antiga.
   Nenhuma credencial permanece no git (secret-scan verde), mas a exposta deve ser considerada vazada.
2. **Drift de testes legados**: ~57 falhas pré-existentes no baseline (suítes defasadas de etapas
   anteriores, ex.: rótulos G2/freeze/JIT antigos). Não fazem parte do escopo da auditoria; foram
   atualizadas as que conflitavam com os novos contratos de segurança (auth, identidade REAL, persistência).

## Critério de conclusão

- Uso permitido agora: `SECURITY HARDENING COMPLETE FOR PRACTICE VALIDATION`.
- REAL: permanece DISARMED; só liberar após validação PRACTICE estendida e nova decisão explícita do operador.

## Deploy e validação de produção (Fase 12)

Deploy: relay `tracecom-live-relay` (Railway) + edge Vercel (`https://tracecom.consecom.com.br`), commit `029dfce`.
Pré-deploy (Fase 9): PRACTICE desarmado via admin, `auto_execute=false` persistido e `AUTO_ARM_PRACTICE=false`
no Railway — a execução automática segue DESLIGADA e deve ser religada apenas por decisão explícita do operador.

Validação read-only (sem ordens):

- `/health` 200; relay com código novo: `connection.execution.readyPractice/readyReal/account` presentes.
- Estratégia: `PULLBACK_4060_300_AGENTIC_V2` ACTIVE, executável, hash
  `sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0` (inalterado).
- Edge fail-closed: `GET /api/iq/status|strategy/stats|strategy/observability|intelligence|account/context` → 401 anônimo;
  `POST /api/auth/panel` sem prova de chave → 401; `/health` → 200.
- Observabilidade: `available=true`, `integrity.verified=true`, `counts` zerados, `archived.included=false`
  (nada podado ainda); stats canônicos N=2 W=1 L=1 PnL=-0.36 (PRACTICE, V2).
- Reconcile periódico ativo (`checked:20, settled:0, unknown:0, error:null`). O incidente USDTRY
  (`exec_1790167033134_wkt4zu`, EXPIRED_UNSETTLED) permanece sinalizado: o broker não devolveu entrada
  correspondente em `closed_options` (histórico) — nenhum settlement foi inventado. Reavaliar manualmente
  quando o broker expuser a posição; a correção está validada por testes (settlement 14/14).
- `SECRET_SCAN OK` no repositório versionado.

## Estado operacional pós-deploy

- Execução automática PRACTICE: **DESLIGADA** (`auto_execute=false`, `AUTO_ARM_PRACTICE=false`, desarmado).
- REAL: DISARMED (fail-closed em todas as camadas).
- Para religar PRACTICE: operador deve reativar `AUTO_ARM_PRACTICE`/auto-execute deliberadamente após validar.

