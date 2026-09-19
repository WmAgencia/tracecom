# SCENARIO SHADOW + CRITIC INDEPENDENTE + SCENARIO x TIMING INTERSECTION (Agente B)

- **Escopo:** TraceCom relay `tracecom-live-relay` (Supabase Postgres). **PRACTICE only, ZERO real.**
  Nada aqui envia ordem, controla execução, stake, direção, threshold 75, pesos do Quality Gate,
  regras do Critic atual, Consensus, JIT ou Execution Gate.
- **Regra de promoção:** toda saída é **SHADOW**. Divergência **nunca vira votação**: vira investigação
  com evidência explícita e, sem evidência suficiente, **WAIT**. A direção do Critic **nunca** é adotada.
- **Código:** `relay/scenario-engine.mjs` (motor real V3), `relay/scenario-shadow.mjs` (observação),
  `relay/scenario-timing-intersection.mjs` (comparação observacional),
  migrations `031_scenario_shadow.sql` + `032_scenario_timing_intersection.sql`,
  endpoint `GET /api/iq/research/scenario-shadow`, script `scripts/scenario-shadow-report.mjs`,
  testes `tests/ai/scenario-engine.test.ts` (47) e `tests/ai/scenario-shadow.test.ts` (50).
- **Versões:** `scenarioPolicyVersion = SCENARIO_ENGINE_V3_SHADOW`, `scenarioEngineVersion =
  SCENARIO_ENGINE_V3`, `currentPolicyVersion = CURRENT_G2`, `timingPolicyVersion = CURRENT_V1 |
  LATE_WINDOW_V2` (coluna própria, opaca, nunca misturada). `divergencePolicy = EXPERIMENTAL_V1`.

---

## 1. ISOLAMENTO REAL Scenario Engine × LATE_WINDOW_V2 (TASK 1)

`relay/scenario-shadow.mjs` **não importa** `relay/late-window-timing.mjs` (nem
`sameExpirationWindow`, `lateDeadlineAt`, `TIMING_POLICY_*`). O deadline da revalidação final é
**opaco e fornecido pelo chamador** (`timingView.deadlineAt`), e `late-window-timing.mjs` **não
conhece** scenario engine. Cada lado produz o próprio estado:

- `runScenarioShadow` classifica/congela/revalida sem chamar nenhum método do timing;
- `LateWindowTimingShadow` observa timing sem chamar nenhum método do scenario;
- a única ponte é `relay/scenario-timing-intersection.mjs`, que **apenas lê os dois estados**
  (`buildIntersection`/`ScenarioTimingIntersectionShadow.observe`) e registra a interseção como dado:
  cenário@candidate, cenário@late deadline, LATE_ACCEPT/LATE_CANCEL, mudança de cenário antes do
  deadline, invalidação antes do deadline e veredito conjunto
  (`BOTH_ENTRY | SCENARIO_ENTRY_LATE_CANCEL | SCENARIO_WAIT_LATE_ACCEPT | BOTH_WAIT | INSUFFICIENT_DATA`).
  `mutatedInputs:false`, `controlsExecution:false`, `mutatesNeither:true`.

**Provas por teste (bidirecional):** (a) ligar tráfego real do Scenario Engine (incluindo
`revalidateFinal`/`recordOutcome`) **não altera** o fingerprint do Late Window
(`outcome/verdict/deadline/comparison/evaluations` idênticos); (b) ligar tráfego real do Late Window
**não altera** o fingerprint do Scenario Engine (stages/divergência/hash do Critic/ação final).
Também testado por fonte: cenário não cita timing e timing não cita cenário.

## 2. MOTOR REAL NO SHADOW + FAIL-SAFE EXPLÍCITO (TASK 2)

`relay/scenario-engine.mjs` (`SCENARIO_ENGINE_VERSION = "SCENARIO_ENGINE_V3"`) é o caminho PRINCIPAL
(dynamic import no load do módulo e em `attachScenarioEngine`). Se o import falhar ou o contrato
estiver incompleto, o `FALLBACK_ENGINE` entra como **fail-safe explícito**:

- `scenarioEngineInfo()` → `mode`, `fallbackActive`, `fallbackReason`, `version`;
- cada observação persiste `engineFallback: { active, reason, explicit:true }` (dentro de
  `engine_info` jsonb) e `scenario_engine_version` (coluna própria);
- análises que degradam registram `degradedToFallback`/`degradedReason` em `engineInfo.degradedAnalyses`;
- o runtime instala um sink (`setScenarioEngineLogSink`) e loga `SCENARIO_ENGINE_FAILSAFE_ACTIVE` uma vez.
  Nada é silencioso: sem motivo, o modo real é reportado.

## 3. POLÍTICA DE DIVERGÊNCIA EXPERIMENTAL_V1 DECOMPOSTA (TASK 3)

A regra `<4/6 = WAIT` permanece, mas está marcada como política **experimental explícita**
(`divergencePolicy: "EXPERIMENTAL_V1"`) e é **decomponível**: `resolveScenarioDivergence` retorna
`checks[{point, value, state}]` para as 6 checagens (`holdAboveLevel`, `reEntry`, `noRejectionWick`,
`momentumAligned`, `ticksFresh`, `locationOk`), além de `satisfiedCount/knownCount/requiredCount`.
`value=null`/`state=UNKNOWN` = não observado (conservador). Não há score mágico.

- Conflito **Trader CALL × Critic PUT** → `DIRECTION_OPPOSITE` + `conflict: "CONFLICT_UNRESOLVED"` +
  `finalAction: "WAIT"` até evidência suficiente (`>=5/6` sem pontos faltantes).
- Mesmo resolvido, o resultado é a **direção do Trader** ou WAIT: `criticDirectionAdopted:false`,
  `adoptedDirection:null` sempre; `resultingAction` registra a ação final.

## 4. VERSIONAMENTO E SÉRIES INDEPENDENTES (TASK 4)

Cada observação persiste `scenarioEngineVersion` (migration 032) e `timingPolicyVersion` (opaca).
O dashboard expõe `series.counts` com a chave
`SCENARIO_POLICY|SCENARIO_ENGINE_VERSION|TIMING_POLICY`, permitindo comparar futuramente
**G2+CURRENT_JIT, G2+LATE_WINDOW_V2, V3+CURRENT_JIT, V3+LATE_WINDOW_V2** sem misturar amostras.
O endpoint não conhece timing (`timingCoupling:"NONE"`); a camada de interseção anexa os labels.

## 5. Critic independente em 2 fases

`runScenarioShadow({ snapshotT0, traderView, criticView })`:

1. **T0 point-in-time** (`buildT0Snapshot` do Prospective Shadow Lab): whitelist + sanitização
   recursiva remove `result/settlement/outcome/pnl/profit/postWindow/future*/broker*/causal*`; o objeto
   é congelado em profundidade. O outcome posterior entra apenas como `outcome` (marcado
   `outcomeUsedInClassification:false`).
2. **FASE 1 — Critic independente:** recebe o T0 **sem a conclusão do Trader** (`buildCriticSnapshot`
   remove `trader/consensus/action/currentDecision/scenarioDecision`), classifica sozinho e é
   **congelado**: `criticFreeze = { frozenHash (sha256), frozenAt, phase, engineMode }` com
   `criticSawTraderConclusion:false` auditável.
3. **FASE 2 — Trader + comparação:** só então a análise do Trader é computada e comparada à fase 1
   (`comparison.points`, `agreement`, `divergence`). A conclusão do Critic **nunca** é sobrescrita.

## 6. Scenario persistence (append-only, T0 imutável)

Estágios `CANDIDATE → REVALIDATION_1 → REVALIDATION_2 → FINAL_ENTRY` (re-registrar o mesmo estágio
substitui a linha do estágio, nunca duplica). Por observação: `scenarioAtCandidate/.../FinalEntry`,
`scenarioChanged`, `scenarioChangeCount`, timelines de `regime/direction/critic/quality/location/
momentum`, `playbookAtCandidate` vs `playbookAtEntry`, `stages[]` com hash e `transitions[]`.
O `t0` é congelado em memória e protegido por trigger no banco (031 + 032).

## 7. Final revalidation desacoplada (nunca inverte a direção)

`revalidateFinal({ analysis, atMs, deadlineAt?, timingView? })` recalcula o cenário no estágio final;
cenário invalidante (`FAILED_BREAKOUT`, `EXHAUSTION`, `NO_SCENARIO`, `REVERSAL`,
`TRANSITION_NO_TRADE`, `TRANSITION`) → **cancela (WAIT)** com
`reason=SCENARIO_INVALIDATED_AT_FINAL_REVALIDATION`; mudança de direção (CALL→PUT) **nunca** é
adotada (`directionFlipAttempted:true` + WAIT); avaliação após o deadline é diagnóstica
(`AFTER_DEADLINE_DIAGNOSTIC_ONLY`) e nunca decide. O deadline é dado opaco do chamador.

## 8. HOOK DE RUNTIME SHADOW (TASK 5)

`relay/iq-multi-runtime.mjs` (aditivo, somente observação — não toca Brain/Trader/Critic/Consensus/
Quality Gate/JIT/Execution Gate/stake):

- `#beginScenarioShadow` no candidato → `scenarioShadow.observe(...)` (Critic fase 1 + Trader fase 2);
- `#observeScenarioShadow` a cada avaliação → `recordStage(REVALIDATION_1/2)` com
  `analyzeScenarioSnapshot` (puro);
- `#finalizeScenarioShadow` na revalidação final → `revalidateFinal` com deadline próprio
  (`targetEntryAt`, `timingView` CURRENT_V1) — independente do gate;
- `#observeScenarioTimingIntersection` no candidato/ACK/cancel/settle → registra a interseção;
- `recordOutcome(BROKER_EXECUTED)` no settlement; settle causal segue no script/camada apropriada;
- flags independentes: `config.scenarioShadowEnabled`, `config.scenarioTimingIntersectionEnabled`
  (métodos `setScenarioShadowEnabled`/`setScenarioTimingIntersectionEnabled`); desligar um lado não
  altera o outro (testado em runtime);
- `scenarioShadowStatus()` no runtime agrega observações + `intersections` + `isolation`
  (`scenarioControlsTiming:false`, `timingControlsScenario:false`, `mutatesNeither:true`) e o
  `server.mjs` serve no endpoint admin.

## 9. Schema (031 + 032) e endpoint

- 031 (inalterada): `iq_scenario_shadow_observations` com T0/critic_freeze imutáveis via trigger.
- 032 (aditiva): coluna `scenario_engine_version` (default `SCENARIO_ENGINE_V3`,
  trigger `iq_scenario_shadow_engine_immutable`), `timing_policy_version` passa a nullable/opaca,
  tabela `iq_scenario_timing_intersections` (verdict/codes/late_deadline/payload) com índices.
- Retenção: `scripts/db-retention.mjs` (`SCENARIO_SHADOW_RETENTION_HOURS`, default 168 h) cobre as
  duas tabelas.
- Endpoint (admin): `GET /api/iq/research/scenario-shadow` → seções
  `BROKER_EXECUTED / COUNTERFACTUAL / HISTORICAL / PROSPECTIVE`, `engine`, `engineFallback`, `series`,
  `criticIndependence` (inclui `criticDirectionAdopted`), `intersections`, `controlsExecution:false`.
  Allowlist do proxy Vercel (`api/http.ts`) já continha o path; deploy desta rodada confirmou 200.

## 10. Provas de teste (50 testes em `tests/ai/scenario-shadow.test.ts`, 18 novos nesta rodada)

- isolamento bidirecional Scenario↔LateWindow (2 casos) + fontes sem acoplamento;
- fail-safe explícito (engine que lança → motivo persistido; modo real reportado quando carregado);
- divergência decomposta (6 checagens), `EXPERIMENTAL_V1`, conflito CALL×PUT `CONFLICT_UNRESOLVED`,
  Critic nunca adotado;
- versionamento (`scenarioEngineVersion`, séries `V3+LATE_WINDOW_V2`/`V3+CURRENT_V1`);
- hook de runtime: cria observação + interseção, zero `requestOrder/placeOrder`, endpoint traz
  `engine.mode=SCENARIO_ENGINE` e `intersections.isolation.mutatesNeither`;
- enable/disable independentes; migration 032; interseção somente leitura + restart (loadFrom);
- T0 imutável, leakage (`findForbiddenKeys`), marketKey/NORMAL×OTC, reinício por candidateId,
  determinismo, ablation (preservados da rodada anterior).

## 11. Deploy e smoke (esta rodada)

- **Vercel:** `npx --yes vercel@latest --prod --yes` → `https://tracecom-1pk4aew95-consecom.vercel.app`
  (alias `https://tracecom.consecom.com.br`), build OK.
- **Railway:** `npx --yes @railway/cli@latest up --service tracecom-live-relay --environment production
  --detach` → deployment `507ea566-f354-46b6-bb74-7f5b7434468b`; `/health` 200.
- Migration 032 aplicada no boot: `schema_migrations = 032_scenario_timing_intersection.sql @
  2026-09-19T01:42:45Z`; coluna `scenario_engine_version` (1), tabela
  `iq_scenario_timing_intersections` (1), trigger `iq_scenario_shadow_engine_immutable` (1).
- Smoke via domínio público (proxy admin): `/api/iq/office` **200**, `/api/iq/research/shadow-lab`
  **200**, `/api/iq/research/timing-policy` **200**, `/api/iq/research/scenario-shadow` **200**
  (payload: `engine.mode=SCENARIO_ENGINE`, `fallbackActive=false`,
  `scenarioEngineVersion=SCENARIO_ENGINE_V3`, `divergencePolicy=EXPERIMENTAL_V1`,
  `timingCoupling=NONE`, `intersections.enabled=true`, `intersections.isolation.mutatesNeither=true`,
  `controlsExecution=false`). Coleta prospectiva inicia do zero pós-deploy.

## 12. Prova de zero alteração estratégica (sha256)

Módulos de decisão **byte a byte inalterados** (hashes idênticos à rodada anterior):

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

Arquivos alterados nesta rodada (todos SHADOW/observacionais ou de versionamento):

| Arquivo | sha256 | Natureza |
|---|---|---|
| relay/scenario-engine.mjs (novo, outro agente) | `54c68f07b45e64ac2da61ebf816619ccd5dd9dab3a65b83e4235ab31460f385d` | motor puro V3 |
| relay/scenario-shadow.mjs | `8216fb18826dc18137bf50376a699b714850c406d80cf3a6bd4b50754db096dc` | desacoplado + fail-safe explícito |
| relay/scenario-timing-intersection.mjs (novo) | `a493cd4b9fbf6fa837b7d5cbf642905fc71292ab16b888869ef8e1a204d87f74` | comparação somente leitura |
| relay/iq-multi-runtime.mjs | `1f6b1764735f4fa3daca2d9002a9cabdd1f52de85cf10e13b4ff57c7bdf848c5` | hook aditivo (nenhuma ordem; control-flow testado) |
| relay/server.mjs | `e9c1d02509db26e645fdd4e500ec17eea848609ffe4bca0f1b58ba9d25c338f6` | 1 rota (payload do runtime) |
| relay/migrations/032_scenario_timing_intersection.sql (novo) | — | DDL aditiva |
| scripts/db-retention.mjs, scripts/scenario-shadow-report.mjs | — | retenção/série |
| tests/ai/scenario-shadow.test.ts | — | 50 testes |

Threshold 75, pesos do Quality Gate, setups, Brain G2, Critic, Consensus, stake, JIT e Execution
Gate permanecem os mesmos. `iq-multi-runtime.mjs` só recebeu chamadas observacionais dentro de
`try/catch` (`#beginScenarioShadow`, `#observeScenarioShadow`, `#finalizeScenarioShadow`,
`#observeScenarioTimingIntersection`, `recordOutcome`) — o resultado da decisão de produção não é
lido nem alterado por elas.

## 13. Suíte completa

- `npx vitest run tests/ai/scenario-engine.test.ts tests/ai/scenario-shadow.test.ts`: **97 passed**
  (47 + 50).
- `npx vitest run tests/ai`: **878 passed / 56 arquivos** (execução final). Em uma execução intermediária
  `office-v3-perf.test.ts` (budget de FPS) falhou sob carga e **passou isolado** → flaky pré-existente,
  não regressão desta rodada.
- `npx vitest run`: **1715 passed / 3 skipped (181 arquivos, 1 skipped)**.
- `npx tsc -p tsconfig.json --noEmit`: limpo. `npm run build`: OK.

## 14. Limitações honestas / pendências

1. A coleta prospectiva de interseções recomeça vazia após este deploy (N=0); nada aqui é conclusão.
2. A interseção é recalculada nos pontos observados do runtime (candidate/avaliação/ACK/cancel/settle);
   o "cenário no late deadline" é o último estágio registrado em/antes do deadline — não há avaliação
   dedicada no instante exato do deadline (deliberado para não acoplar os dois lados).
3. `office-v3-perf.test.ts` é flaky sob suíte completa (orçamento de frames); não relacionado a este
   trabalho e passa isolado.
4. `api/http.ts` já estava no allowlist desde 67efcd1; o deploy Vercel desta rodada foi executado e o
   smoke confirma 200 no domínio.
5. O motor real V3 e seus 47 testes foram produzidos em paralelo por outro agente; esta rodada apenas
   o importa como caminho principal e mantém o fallback como fail-safe explícito.
