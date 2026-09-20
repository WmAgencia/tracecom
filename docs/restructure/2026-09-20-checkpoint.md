# Checkpoint — Reestruturação + Simplificação TraceCom

> **Data:** 2026-09-20 (UTC) · **Tag:** `checkpoint-pre-restructure-20260920` · **Branch:** `restructure/simplify-20260920`
> **Commit do checkpoint:** `0ecf799` (fix do guard de saldo TDZ)
> **Deploy no ar no momento do checkpoint:** `58727f39-e6ed-4918-999f-c828b2ffe5ff` (Railway, serviço `c36ae86f-bb96-4562-817b-221ba93b2601`, projeto `b9894058-a18c-44d8-a77b-7e0e6d47493a`)

## 0. Objetivo desta reestruturação
- Nova filosofia: **DADOS DE MERCADO → 4 ESPECIALISTAS → 1 DECISOR → BUY/SELL/WAIT → EXECUTION GATE**.
- Novo frontend: grade simples de ativos (10 cards/fileira, card 4:3, chart live, resultado acima).
- Escopo operacional: **SOMENTE BINARY OTC** (sem NORMAL, sem Blitz, sem Digital).
- Multi-agente é **NOVA HIPÓTESE EXPERIMENTAL** — instrumentar para comparar WR/PnL/frequência/qualidade/latência/WAIT/falsos sinais vs V2 central.

## 1. Segurança / preservação
- Checkpoint em tag + branch (acima). **Rollback:** `git checkout checkpoint-pre-restructure-20260920` e `node scripts/deploy-prod.mjs`.
- `/estrategias` e auditorias **preservados** (não apagar, não reescrever): `estrategias/v2/SPEC.md` (V2 = Estratégia Central), `estrategias/v4/audits/`, `docs/research/data/*freeze*.json`.

## 2. Configuração viva no checkpoint
| Item | Valor |
|---|---|
| MODO | REAL · execução CONNECTED_PRACTICE · killSwitch.executionEnabled=true |
| Conta | REAL · ARMED (context=REAL) |
| Estratégia central | V2-live (rsi-agents-v2-live) · routing "RSI_V2_ONLY" |
| Regra operador | candidatos só de episódios que tocaram RSI ≤25 / ≥75; entrada autorizada pela V2 (confirmação + revalidação causal) |
| Travas | 1 ordem por vez (lock global MCP) · teto R$2/operação · guard de saldo · sem martingale |
| Universo | 53 instrumentos BINARY (30 OTC + 23 NORMAL) · 0 BLITZ_45S (desligados) |
| Engine counters | {"evals":110394,"cands":1066,"finals":297,"acked":137} |

## 3. SLOC / arquivos (heurística: linhas físicas)
| Área | Arquivos | Linhas |
|---|---|---|
| docs | 264 | 411.836 |
| diagnostic-results | 59 | 381.670 |
| data | 6 | 151.314 |
| src (frontend+api legado) | 246 | 48.372 |
| **relay (runtime)** | **181** | **37.689** (75 arquivos .mjs) |
| root | 14 | 32.876 |
| tests | 185 | 30.608 |
| scripts | 82 | 21.575 |
| estrategias | 65 | 7.050 |
| extension/dist-extension | 34 | 4.920 |
| api (proxy edge `api/http.ts`) | 3 | 2.174 |
| **TOTAL (repo)** | **1.141** | **1.130.110** |

**God files:** `relay/iq-multi-runtime.mjs` 4.033 · `src/http/public/office-v2.js` 3.422 · `office-v2-blueprint.js` 2.951 · `relay/scenario-engine.mjs` 1.673 · `relay/scenario-shadow.mjs` 1.585.

## 4. Endpoints
- **123 rotas únicas** em `relay/server.mjs` (prefixos: `/api/iq/*` ~100, `/api/live/*`, `/api/ai/*`, `/api/quant/*`, `/api/shadow/*`, `/api/strategies/*`, `/health`).
- Proxy de borda: `api/http.ts` (Vercel) com allowlist de paths de operador.

## 5. Dependências
- `relay/package.json`: **pg** (única). Dev: nenhuma.
- `package.json` (raiz): ["@vercel/blob","dotenv","zod"] (dev: 4 deps).

## 6. Inventário de simplificação (PROVE FIRST, DELETE SECOND)
Órfãos provados (0 importadores em relay/scripts/tests, fora de entrypoints):
| Remoção segura | SLOC | Evidência |
|---|---|---|
| 10 gauntlets: phase{4,5,6,62,63,64,65,67}, real-crops, ws-prod | 571 | 0 importadores; só referências em docs de auditoria |
| iq-ws-runtime.mjs | 552 | importado só por `tests/ai/iqoption-ws.test.ts` (runtime v1 x v2 de produção) |
| strategy-manager.mjs | 154 | só teste; rota responde 410 e teste de contrato proíbe uso |
| agent-pair.mjs | 113 | só teste |
| market-state-classifier.mjs | 68 | só teste; doc diag confirma "não importado pelo runtime" |
| probes: probe-relay, probe-vision-real, probe-ws-hosts, selftest-run | 47 | 0 importadores |
| `server.mjs:413` handler legacy /api/live/export | 1 | inalcançável (handler novo responde antes) |
| aliases: rsi-agents/rsi-agents-v2, five-way/status | 3 | corpos idênticos duplicados |
| `DEFAULT_GLOBAL_MAX_STAKE` + import morto | 2 | constante sem consumidor |

Duplicações relevantes: 2 pollers de settlement MCP (blitz + turbo), 2 loops de experimento (frozen/experiment) sobre as mesmas `price_observations`, 2 SSE (`/api/live/stream` e `/api/iq/stream`), 5+ cópias de `HARD_CAP_STAKE=100`, 3 noções de "armed" (armState / accountContext.armed / realMode.session).

## 7. Rollback
```powershell
& "D:\tracecom\tools\cmd\git.exe" -C D:\tracecom\repo checkout checkpoint-pre-restructure-20260920
node scripts/deploy-prod.mjs --skip-tests --skip-vercel
```
