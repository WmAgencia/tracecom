# V3 — Agent Runtime Optimization Report (structured output + low-latency 2-wave pipeline)

Data: 2026-09-23 · Missao: "AGENT RUNTIME HARDENING — STRUCTURED OUTPUT + LOW-LATENCY MULTI-AGENT PIPELINE"
Status: ENTREGUE (observavel em prod com `V3_AGENTS_ENABLED`; NENHUMA ativacao de V3, NENHUMA ordem executada)
Base: `8d0f18c` · V3 hash final: `sha256:44a1aa14c7e2d4e9039058c2e7bc68d751a5f42496b67a97480c2abbd569aedb`
V2 (frozen, intocado): `PULLBACK_4060_300_AGENTIC_V2` / `sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0`

## 1. Objetivo e restricoes

Tornar o pipeline de agentes V3 estruturado (JSON estrito validado), rapido o suficiente para a janela de
analise de ~28s, fail-closed (resultado parcial nunca vira tese) e auditavel, sem ativar V3 e sem enviar
nenhuma ordem. Restricoes mantidas: sem votacao/majoria, sem cambio silencioso de modelo, V2 intocado,
grade de expiracao 60s e timing 302/300 inalterados.

## 2. Matriz de capacidade medida (OpenCode Go, probe real)

| Item | Resultado medido | Decisao no runtime |
|---|---|---|
| Header `x-opencode-session` | OBRIGATORIO (sem ele HTTP 400 MissingSessionID) | `sessionFor` + `sessionKey = v3:<oppId>:<role>` (sessao estavel por oportunidade+papel) |
| `response_format {"type":"json_object"}` | OK | sempre ligado |
| `json_schema` estrito | HTTP 400 (nao suportado) | validacao propria server-side (schemas.mjs) |
| `temperature: 0` | OK | fixo |
| `reasoning_effort: "none"` | OK (reasoning_tokens=0) | fixo nos agentes |
| `max_tokens` pequeno + reasoning ON | `finish_reason=length`, content null | reasoning desligado + maxTokens por papel |
| `usage.prompt_tokens_details.cached_tokens` | 0 para `deepseek-v4.1-flash` (sem cache real; sessao so roteamento) | sessoes estaveis mantidas por robustez |
| Catalogo | deepseek-v4-flash, deepseek-v4.1-flash, deepseek-v4-pro, glm-5.1, glm-5.2, deepseek-v4-flash-vision-exp | `AI_MODEL=deepseek-v4.1-flash` |

`relay/v3/agents/capabilities.mjs` codifica a matriz; `agentRequestOptions()` = json_object + reasoning none
+ temperature 0 + maxTokens<=4096. MaxTokens efetivo: especialistas 512, PRICE_ACTION/ASSET 768,
CONSENSUS_BILATERAL 900.

## 3. Arquitetura antes x depois

| Dimensao | Antes (medido em 2026-09-22) | Depois |
|---|---|---|
| Pipeline | 3 ondas, prompts longos, prosa | 2 ondas: Wave A 5 especialistas -> Wave B (ASSET ∥ CONSENSUS_BILATERAL) -> Final Gate deterministico |
| Chamadas/ciclo | ~10+ | 7 (5+2) |
| Formato | texto livre/JSON multi-objeto | JSON mode + schema proprio + validacao semantica fail-closed |
| Latencia por chamada | 3.4–17.7s | p50 3.3–4.5s, p95 3.9–5.3s |
| Taxa de schema valido | maioria INVALID_JSON/SCHEMA -> zero aprovacoes | 100% nas 120 chamadas single-role; 12/12 pipelines completos validos |
| Reasoning tokens | variavel (ate travar por length) | 0 (`reasoning_effort:none`) |
| Decisao | risco de resultado parcial | Final Gate deterministico: sem votacao, invalidacoes direcionais, contra-caso por direcao, `AGENT_UNAVAILABLE` em qualquer falha |

## 4. Resultados finais medidos (provider real, fixture sintetica)

- **Single-role (24 chamadas/papel)**: schema valido 100% nos 5 especialistas; RSI p50 3524ms/p95 4043ms;
  DMI 3557/3905; BOLLINGER 3596/4234; ATR 3675/4081; PRICE_ACTION 4543/5258.
- **Wave A (fanout 5)**: fase p50 ~4.2s; disponibilidade 9–10/10 nas rodadas finais.
- **Pipeline completo (2 ondas + gate), n=12**: **12/12 disponiveis**, p50 **10157ms**, p95 **11468ms**,
  max **11468ms** — dentro da janela de ~28s com margem >2x. Resultados CANCEL no fixture sintetico
  (correto: o gate deterministico recusa sem setup real).
- **Concorrencia/carga**: n=5 4285ms; n=10 4241ms; n=20 4575ms; n=30 4568ms (152ms/chamada amortizado),
  100% schema valido, **0 HTTP 429, 0 5xx, 0 timeouts**.
- **Reasoning**: 0 tokens; saida tipica 300–360 tokens.

## 5. Fail-closed e auditabilidade

- `llm-client.mjs`: qualquer `!OK` do provider, `TRUNCATED` (finish_reason=length), JSON invalido,
  schema/semantica violados -> `status=ERROR` com `reason` explicito e `rawExcerpt` (400 chars) para
  auditoria; nunca aceita parcial. Numeros citados sao ancorados no input (`numericGroundingError`,
  tolerancia de arredondamento/relativa; aproximacoes grosseiras como RSI 87 com input 45 falham).
- `team.mjs`: Wave A exige 5/5; Wave B exige 2/2; qualquer falha -> `AGENT_UNAVAILABLE` (sem voto).
- `final-gate.mjs`: deterministico — agreement/schema compat, familias, blockers, invalidacoes
  direcionais e contra-caso por direcao; sem votacao, sem confianca percentual.
- Budget por **duracao** (`budgetMs = targetSendAt - agentSafetyMarginMs - at`), nunca epoch de relogios
  diferentes; se `budget < estimatedWaveMs` o ciclo nem chama agentes (contadores
  `cyclesSkippedDeadline`/`deadlineAborts`). Engine nunca rebaixa `FINAL_REVIEW/APPROVED_*`.
- Bugs corrigidos durante a medicao real (todos com teste de regressao): validacao de `fact.code`
  (regex aplicada no join com virgula), enum de `scenario` restrito a Scenario Library,
  `bestCounterCase` ate 480 chars, maxTokens por papel, ancoragem numerica com sinal/tolerancia.

## 6. Testes e verificacao

- `tests/v3`: 10 arquivos / 80 testes verdes; `v3-smoke` 14/14; `run-all-tests` 25 suites, 0 falhas
  (inclui security suite e secret-scan).
- `npm run build` OK; hash V3 regenerado (`44a1aa14…`) apos cada edicao do decision-runtime.
- Prod: `V3_AGENTS_ENABLED=false` ao final do soak de observacao (medicao concluida); `V3_ENABLED=true`
  (OBSERVE_ONLY), `executable=false`, estrategia `PENDING_IMPLEMENTATION`.

## 7. Estado e nao-acoes

- V2 frozen intocado (`V2_FROZEN_IMMUTABLE PASS`); V3 nao ativado; nenhuma ordem; PRACTICE auto-exec OFF;
  REAL desarmado; Supabase segue `ROTATION_PENDING_EXTERNAL` (decisao do operador, sem bloqueio).
- Soak real em oportunidades impossivel no momento (OTC suspenso, 0 ciclos); fixture sintetica usada.

## 8. Riscos residuais / proximos passos

- Falhas intermitentes de papel (~1/50 chamadas) sao absorvidas pelo fail-closed (ciclo CANCEL, sem
  degradacao) — taxa de pipeline completo 12/12 na rodada final.
- PRICE_ACTION e o papel mais lento (p95 5.3s) e define o piso da Wave A; se necessario, encurtar o
  playbook no delta dinamico.
- Com OTC reaberto: repetir soak com oportunidades reais e monitorar `cyclesSkippedDeadline`,
  `deadlineAborts` e distribuicao de `agentCalls` antes de qualquer discussao de ativacao.
