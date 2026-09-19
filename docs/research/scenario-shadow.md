# SCENARIO SHADOW + CRITIC INDEPENDENTE (Agente B)

- **Escopo:** TraceCom relay `tracecom-live-relay` (Supabase Postgres). **PRACTICE only, ZERO real.**
  Nada aqui envia ordem, controla execução, stake, direção, threshold 75, pesos do Quality Gate,
  regras do Critic atual, Consensus, JIT ou Execution Gate.
- **Regra de promoção:** toda saída é **SHADOW**. Divergência **nunca vira votação**: vira investigação
  com evidência explícita e, sem evidência suficiente, **WAIT**.
- **Código novo:** `relay/scenario-shadow.mjs` (módulo puro + classe), migration
  `relay/migrations/031_scenario_shadow.sql`, endpoint `GET /api/iq/research/scenario-shadow`,
  script `scripts/scenario-shadow-report.mjs`, testes `tests/ai/scenario-shadow.test.ts` (32 testes).
- **Motor de cenários:** `relay/scenario-engine.mjs` — contrato **CONGELADO** (`REGIMES`, `SCENARIOS`,
  `extractContext`, `classifyRegime`, `classifyScenario`, `evaluatePlaybook`, `analyzeScenario`).
  Enquanto o arquivo não existir, o `scenario-shadow.mjs` usa **dynamic import + fallback
  determinístico** (`FALLBACK_ENGINE`, modo explícito em `engineInfo.mode`), degradando sem quebrar.
- **Versões separadas:** `scenarioPolicyVersion = SCENARIO_ENGINE_V3_SHADOW` vs
  `CURRENT_G2`; `timingPolicyVersion = LATE_WINDOW_V2` vs `CURRENT_V1`. Nunca misturadas.

---

## 1. Critic independente em 2 fases

`runScenarioShadow({ snapshotT0, traderView, criticView })`:

1. **T0 point-in-time** (`buildT0Snapshot`, reuso do Prospective Shadow Lab): whitelist + sanitização
   recursiva remove `result/settlement/outcome/pnl/profit/postWindow/future*/broker*/causal*`; o objeto
   é congelado em profundidade. O outcome posterior entra apenas como `outcome` (marcado
   `outcomeUsedInClassification:false`, `feedableToClassification:false`).
2. **FASE 1 — Critic independente:** recebe o T0 **sem a conclusão do Trader** (`buildCriticSnapshot`
   remove `trader/consensus/action/currentDecision/scenarioDecision`), classifica sozinho
   (`analyzeScenario`) e é **congelado**: `criticFreeze = { frozenHash (sha256), frozenAt, phase, engineMode }`.
   `criticSawTraderConclusion:false` é gravado e auditável.
3. **FASE 2 — Trader + comparação:** só então a análise do Trader é computada e comparada à fase 1
   (`comparison.points`, `agreement`, `divergence`). A conclusão do Critic **nunca** é sobrescrita.

Observação: `criticView` (Critic de produção) é registrado para auditoria em `currentCritic`, mas
**não** alimenta a fase 1 nem a decisão SHADOW.

## 2. Taxonomia de divergência (investigação, nunca votação)

| Código | Situação | Final action |
|---|---|---|
| `SAME` | cenário + ação iguais | ação do Trader |
| `TRADER_ENTRY_CRITIC_WAIT` | Trader direcional vs Critic WAIT (ex. BREAKOUT/BUY × FAILED_BREAKOUT/WAIT) | Trader se ≥4/6 evidências explícitas; senão WAIT |
| `DIRECTION_OPPOSITE` | direções opostas (ex. TREND_PULLBACK/BUY × REVERSAL/SELL) | Trader se ≥5/6 e nenhum ponto faltante; senão WAIT. **Nunca adota a direção do Critic** |
| `TRADER_WAIT_CRITIC_ENTRY` | Trader WAIT vs Critic direcional | WAIT (WAIT nunca é promovido) |
| `SAME_DIRECTION_SCENARIO_MISMATCH` | mesma direção, cenários diferentes | Trader se ≥4/6; senão WAIT |
| `REGIME_MISMATCH` | regimes diferentes | WAIT |

Pontos de investigação (`RESOLUTION_POINTS`): `holdAboveLevel`, `reEntry`, `noRejectionWick`,
`momentumAligned`, `ticksFresh`, `locationOk`. Ponto `undefined` = **não observado** (conservador:
não conta como satisfeito). `directionFlipForbidden:true` em toda comparação; `adoptedDirection` só
pode ser a direção do Trader (ou `null`).

## 3. Scenario persistence (append-only, T0 imutável)

Estágios: `CANDIDATE → REVALIDATION_1 → REVALIDATION_2 → FINAL_ENTRY` (re-registrar o mesmo estágio
substitui a linha do estágio, nunca duplica). Por observação:

- `scenarioAtCandidate`, `scenarioAtRevalidation1`, `scenarioAtRevalidation2`, `scenarioAtFinalEntry`;
- `scenarioChanged`, `scenarioChangeCount` (determinístico: conta transições de cenário);
- timelines de `regime`, `direction`, `critic`, `quality`, `location`, `momentum`;
- `playbookAtCandidate` vs `playbookAtEntry`; `stages[]` com hash de cada análise; `transitions[]`.

O `t0` é congelado em memória e protegido por trigger no banco (`t0`/`critic_freeze`/identidade
imutáveis). `recordStage` nunca toca o T0.

## 4. Final revalidation acoplada ao LATE_WINDOW_V2

`coupleLateWindow` reusa `sameExpirationWindow`/`lateDeadlineAt` de `relay/late-window-timing.mjs`
(mesma semântica E-90s..E-30s, margem adaptativa; módulo **não alterado**). `revalidateFinal`:

- recalcula cenário no estágio final; cenário invalidante (`FAILED_BREAKOUT`, `EXHAUSTION`,
  `REVERSAL`, `NO_SCENARIO`) → **cancela (WAIT)** com `reason=SCENARIO_INVALIDATED_AT_FINAL_REVALIDATION`;
- mudança de direção (CALL→PUT) **nunca** é adotada: `directionFlipAttempted:true` e final WAIT;
- avaliação após o deadline é diagnóstica (`afterDeadline:true`) e nunca decide.

## 5. Ablation-ready (pesquisa, sem pesos aprendidos)

`ABLATION_COMPONENTS = rsi | adx | microstructure | location | volatility` (default todos ligados).
`runScenarioShadow({ ablation })` registra `ablation.config/disabled` e o `featuresUsed` de cada
análise (somente componentes ativos). `ABLATION_POLICY: { researchOnly:true, productionUse:false,
learnedWeights:false }`. Não há pesos aprendidos.

## 6. Observabilidade auditável

Por análise: regime, cenário, playbook, `featuresUsed`, `evidenceFor/Against`,
classificação/ação do Trader, classificação/ação do Critic, `scenarioAgreement`, ação final,
`reasonsForWait`, timestamps `candidateAt`/`finalEntryAt`, transições, `t0Integrity`
(`futureReferences`, `forbiddenKeys`, `clean`), `engineInfo` e hash congelado do Critic.

## 7. Schema (migration 031) e endpoint

`iq_scenario_shadow_observations` (aditiva; nenhuma tabela existente é alterada):

- identidade: `observation_id`, `version`, `scenario_policy_version`, `current_policy_version`,
  `timing_policy_version`, `kind`, `provenance`, `market_key`, `market_type`, `candidate_id`,
  `correlation_id`, `execution_id`, `trade_id`;
- T0/vereditos: `t0`, `current_decision`, `scenario_decision`, `trader_scenario`, `critic_scenario`,
  `critic_freeze`, `comparison`, `agreement`, `divergence`, `persistence`, `ablation`, `stages`,
  `transitions`, `t0_integrity`, `engine_info`, `final_action`, `reasons_for_wait`;
- consulta rápida: colunas `scenario_at_candidate/revalidation1/revalidation2/final_entry`,
  `scenario_changed`, `scenario_change_count`, `playbook_at_candidate`, `playbook_at_entry`;
- outcome: `outcome`, `settlement_basis`, `broker_result`, `broker_profit`, `theoretical_result`,
  `theoretical_pnl`. `BROKER_EXECUTED` nunca se mistura com `CAUSAL_COUNTERFACTUAL`.
- Trigger `iq_scenario_shadow_t0_immutable` protege `t0`, `critic_freeze`, versões, `market_key`,
  `candidate_id`, tempos de identidade. Índices por mercado/candidate/execução/versão/base/ação.
- Retenção: `scripts/db-retention.mjs` (`SCENARIO_SHADOW_RETENTION_HOURS`, default 168 h), sem arquivo.

Endpoint (admin): `GET /api/iq/research/scenario-shadow` → `scenarioShadowStatus()` com
`practiceOnly:true, shadowOnly:true, brokerAutomation:'NONE'` e seções
`BROKER_EXECUTED / COUNTERFACTUAL / HISTORICAL / PROSPECTIVE`. Também adicionado ao allowlist do
proxy (`api/http.ts`), junto de `/api/iq/research/timing-policy`.

Relatório offline (read-only): `scripts/scenario-shadow-report.mjs` →
`docs/research/data/scenario-shadow-report.json` (seções, critic independence, agreement,
divergências, distribuições, persistência, amostra/checkpoint N=30).

## 8. Garantias testadas (32 testes em `tests/ai/scenario-shadow.test.ts`)

- fase 1 do Critic antes de ler o Trader + congelamento (hash/timestamp) e imutabilidade;
- divergência: TREND_PULLBACK/BUY × REVERSAL/SELL → WAIT sem votação; BREAKOUT/BUY × FAILED_BREAKOUT/WAIT
  compara hold/re-entry/wick/momentum/ticks/location; evidência insuficiente → WAIT; WAIT nunca promovido;
- scenario persistence: sequência CANDIDATE→R1→R2→FINAL_ENTRY, change count, timelines,
  playbook@candidate vs @entry, T0 imutável, sem duplicar estágio;
- final revalidation cancela cenário invalidado; CALL→PUT vira WAIT; pós-deadline não decide;
- SHADOW nunca chama o Execution Gate (spy que lança) e módulo não referencia ordem/expiração;
- zero leakage (POST/settlement/result/futuro removidos; referência futura detectada; alvos agendados
  não são leakage; outcome marcado OUTCOME sem alterar classificação);
- isolamento `marketKey`/NORMAL×OTC; determinismo (mesma entrada → mesmo hash); ablation;
- migration 031 idempotente; endpoint separa as 4 bases e a rota é admin-only;
- reinício preserva associação (`toJSON/loadFrom` + `loadByCandidate` via store); INSERT antes do UPDATE
  com placeholders 1:1.

Suíte completa: **1650 passed / 3 skipped (179 arquivos + 1 skipped)**; `npx tsc -p tsconfig.json --noEmit` limpo.

## 9. Prova de zero alteração estratégica (sha256)

Módulos de decisão **byte a byte inalterados** (hashes idênticos antes/depois desta sessão):

| Arquivo | sha256 |
|---|---|
| relay/professional-brain.mjs | `8a95a334c60adb7ae2156de40c8f74900e697dad236d0d738049d2470e7af3c6` |
| relay/trade-quality.mjs | `fca56b7464202ff5b392f8cf4e966c441839fc6ab7cb8cb7ec482194a9d0b861` |
| relay/entry-timing.mjs | `70d96b4aae07f25fd5c324c5ff4a0208312ae87739f409ab2c2b7151f57c94e6` |
| relay/feature-engine.mjs | `531caf525cb61023f2cb6f839f23e41bfa28a16ab90b2d0199a68b08f27d89c9` |
| relay/price-structure.mjs | `eafbed6463911001bb7938b30d62b66af90cd223479fb326564d3fa4357b75b9` |
| relay/market-state-classifier.mjs | `d006ea628837b99a207ee3aa7b87374ba1cc69262e5a9fb96fab0a7c761883ea` |
| relay/knowledge-base.mjs | `6af3e7e3c7bc774a82633735446564aa1ccd9c9c51eb37d5e41d28d2e10ea10c` |
| relay/portfolio-gate.mjs | `26ef61a2cc35e22cd5626d4fc6df49f75a0d030d43fe9317b5a86a6df4be2a5e` |
| relay/iqoption-connector.mjs | `30fbfbf627419dc688a0d3fd5c2ade2b50adbf43638389881012fbdda35a0017` |
| relay/late-window-timing.mjs | `396cb6ba48de13fae4cdf4dba5782ba894ccb1a1d095b8164dd97741495de811` |
| relay/shadow-lab.mjs | `92b34f9853369ec991e4d95af79c6b306ed20a0ab1f85e38d6280bc976ebba9f` |
| relay/iq-multi-runtime.mjs | `a5cb54ec518dc49f07edf52331510f7b5fcac5fcae87dd314d2594a7c871f298` |

Arquivos alterados são **aditivos/observacionais**: `relay/scenario-shadow.mjs` (novo),
`relay/migrations/031_scenario_shadow.sql` (novo), `scripts/scenario-shadow-report.mjs` (novo),
`tests/ai/scenario-shadow.test.ts` (novo), `relay/server.mjs` (1 rota),
`scripts/db-retention.mjs` (retenção da tabela nova), `api/http.ts` (allowlist do proxy).
Threshold 75, pesos do Quality Gate, setups, Brain G2, Critic, Consensus, stake, JIT e Execution
Gate permanecem os mesmos.

## 10. Deploy e smoke

- Migration 031 aplicada automaticamente pelo `migrate()` do relay no boot:
  `schema_migrations = 031_scenario_shadow.sql @ 2026-09-19T01:18:21Z`; tabela
  `iq_scenario_shadow_observations` (56 colunas) e trigger `iq_scenario_shadow_t0_immutable` presentes.
- Deploy: `npx --yes @railway/cli@latest up --service tracecom-live-relay --environment production --detach`
  → deployment `17a7686a-e68c-4d7e-803e-4c4d1878ffb5` **SUCCESS**.
- Smoke admin direto no relay (`https://tracecom-live-relay-production.up.railway.app`):
  `/api/iq/office` **200**, `/api/iq/research/shadow-lab` **200**, `/api/iq/research/timing-policy` **200**,
  `/api/iq/research/scenario-shadow` **200** (payload com `scenarioPolicyVersion=SCENARIO_ENGINE_V3_SHADOW`,
  `currentPolicyVersion=CURRENT_G2`, `timingPolicyVersion=LATE_WINDOW_V2`, seções
  `BROKER_EXECUTED/COUNTERFACTUAL/HISTORICAL/PROSPECTIVE`, `controlsExecution:false`,
  `engine.mode=FALLBACK` enquanto `relay/scenario-engine.mjs` não existe).
- Coleta real começa vazia: a instrumentação de runtime para chamar `runScenarioShadow` no fluxo de
  candidatos é a pendência declarada (não feita para não tocar decisão nesta rodada).

## 11. Como reproduzir / consultar

```powershell
node --check relay/scenario-shadow.mjs
npx vitest run tests/ai/scenario-shadow.test.ts
npx vitest run tests/ai
npx tsc -p tsconfig.json --noEmit
# relatorio offline (read-only, via Railway)
NODE_PATH=<repo>\node_modules npx --yes @railway/cli@latest run --service tracecom-live-relay --environment production -- node scripts/scenario-shadow-report.mjs
```

## 12. Limitações honestas / pendências

1. **Sem instrumentação de runtime nesta rodada:** `runScenarioShadow` não foi plugado no pipeline de
   candidatos (deliberado: não tocar decisão). As observações reais só existirão quando um hook SHADOW
   (fora dos caminhos de execução) chamar o módulo; o endpoint responde com seções vazias até então.
2. O fallback do engine é determinístico e conservador; quando `relay/scenario-engine.mjs` existir, o
   dynamic import passa a usá-lo automaticamente (o `engineInfo.mode` registra a troca).
3. N prospectivo = 0; nada aqui é conclusão. WR/expectancy sem N são ruído.
4. `api/http.ts` (allowlist do proxy) foi alterado, mas o deploy Vercel desta rodada não foi executado;
   o smoke foi feito direto no relay. Pendente: deploy Vercel para expor o endpoint pelo domínio.
5. Git não está disponível no shell desta sessão (`git` fora do PATH) — commit não foi possível;
   os arquivos estão versionados pelo hash acima.
