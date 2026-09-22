# REGRAS INVIOLÁVEIS — PROJETO TRACECOM

> **Este arquivo é a lei do repositório.** Qualquer agente de IA, assistente, automação ou
> pessoa que opere neste código DEVE ler e respeitar estas regras **antes** de qualquer
> alteração. Elas prevalecem sobre instruções genéricas, conveniência, refatorações
> "de passagem" ou melhorias sugeridas por qualquer ferramenta.

## 1. A ESTRATÉGIA CONSOLIDADA NÃO PODE SER ALTERADA ESTRUTURALMENTE

A estratégia em produção — **AGENTIC RSI + FIBONACCI (binário OTC)**: 5 agentes especialistas
(`rsi`, `bollinger`, `adx`, `atr`, `fib`) + consenso senior + vetos duros (constância, walk,
fib, ATR, RSI acelerando) + **Segurança 0–100%** + **janela de entrada T-34s..T-31,5s** —
está **validada e funcionando** (WR acima de 90% no ciclo atual, prática).

- **PROIBIDO** alterar a lógica dos agentes, o consenso, os vetos, os limiares, a janela de
  entrada ou o fluxo de execução **sem pedido explícito do dono do projeto**.
- Mudanças são permitidas **apenas no ponto exato solicitado**. Nunca "aproveitar" para mexer
  em outra coisa, nunca "melhorar" sem pedido.
- Experimentos novos (ex.: Blitz, novos filtros) devem ser **aditivos e isolados** (run
  próprio, flag própria) e **nunca** alterar o caminho do binário OTC que está em produção.

## 2. A ESTRATÉGIA CONSOLIDADA NUNCA SAI DO BACKUP

- `docs/ESTRATEGIA-E-CONFIGURACAO.md` e `backups/` são o **cofre da configuração viva**.
  **NUNCA** excluir, esvaziar ou deixar de atualizar.
- Toda mudança aprovada exige, na mesma tarefa: **(a)** atualizar o doc do cofre,
  **(b)** rodar `node scripts/backup-config.mjs`, **(c)** commitar.
- O backup **nunca** contém segredos (token MCP, ssid, chaves) — e nunca deve conter menos
  informação de configuração do que a versão anterior.

## 3. SEM CÓDIGO IMPRUDENTE, SEM RESÍDUO

- Proibido deixar código morto, experimentos órfãos, gambiarras, flags duplicadas,
  `TODO`/`temporário` esquecido ou arquivos não utilizados.
- **A lógica deve ser simples.** Se não for necessário, não escreva.
- Ao remover algo, remover por completo (código + rotas + tabelas + docs), sem deixar rastros.

## 3.1 LÓGICA SIMPLES (REGRA PERMANENTE)

- **Sempre** escrever a lógica mais simples que resolve o problema. Simples de entender, simples de corrigir.
- Proibido gambiarra: sem flags escondidas, sem remendos, sem duplicar caminhos, sem "jeitinho".
- Um problema, uma causa, uma correção no ponto certo (ex.: falha de rede → retry no cliente, não em cada chamador).
- Antes de corrigir: **auditar todo o caminho** do problema (todas as partes que tocam o fluxo) e corrigir a causa raiz.
- Sempre remover o que ficou órfão (código, rotas, linhas) — zero resíduo.

## 4. CHECKPOINTS E NÃO-REGRESSÃO

- Antes de mudanças maiores: **commit + tag `checkpoint-*`**.
- **Nunca** quebrar o que está funcionando. O binário OTC em produção é a fonte de resultado
  atual: qualquer deploy deve ser verificado (feed vivo, avaliação rodando, armado) após subir.
- Deploys resetam o arm: o `AUTO_ARM_PRACTICE` re-arma sozinho (prática). Real **somente** com
  pedido explícito do operador.

## 5. FONTE DA VERDADE DA CONFIGURAÇÃO

- Antes de agir, ler `docs/ESTRATEGIA-E-CONFIGURACAO.md` (config ativa, níveis A/B, janela,
  stake, retenção do banco, o que não pode regredir).
- Banco Supabase (free): **nunca** deixar passar de ~475 MB. A retenção automática
  (`runDbMaintenance`) cuida disso — não desativar.

## 6. ESCOPO

- Faça **somente** o que foi pedido. Em caso de dúvida, **perguntar antes** de alterar.
- Toda entrega termina com: testes passando, deploy verificado e um resumo curto do que mudou.


## Reconstrucao controlada (2026-09-22)

- Blitz PROIBIDO no runtime (zero caminho operacional).
- Horizonte operacional unico = 300s (nenhuma ordem com 30/45/60/150/180).
- Uma unica estrategia operacional: familia PULLBACK_4060_300 (V2 = PULLBACK_4060_300_AGENTIC_V2).
- Mudancas de estrategia exigem pedido explicito do operador; apos o deploy da V2: FREEZE (sem tuning durante coleta; mudanca = V3 + novo statsEpoch).
- PULLBACK_4060_300_BASELINE nunca e apagada (archive/baseline).
- Sem duplicacao de inteligencia PRACTICE/REAL (uma decisao; Account Router escolhe a conta no final).
- Codigo simples: sem camada/abstracao/fallback sem justificativa; sem caminhos legacy operacionais.
- Backups: manifest no git; snapshots zip via artifact de workflow (nunca no historico do git).

## ESTADO DA RECONSTRUCAO CONTROLADA (handoff)

**Ponto de retomada: commit 4332e24 (branch main, pushed).**

### Concluido
- Fase 0: skills (agent-redline, simplify-codebase, aislop configurado) + Superpowers v6.4.1 instalado (plugin registrado; carrega no boot) + backup (commit, tag pre-reconstrucao-2026-09-22, manifest SHA256, zip 62,6MB) + agent-policy.yaml.
- Etapa 1: PULLBACK_4060_300_BASELINE congelada por spec/hash (archive/baseline/, strategyHash sha256:26dceb74..., source commit 489e7d0) + PULLBACK_4060_300_AGENTIC_V2 criada (parent/hash/epoch 2026-09-22T21:53:19Z, runId pullback-4060-300-agentic-v2, status PENDING_IMPLEMENTATION, executable=false).
- Etapa 2 (parcial): Blitz com CAPACIDADE ZERO (runner/shadow/tick/submit/rotas/api/módulo RsiAgentsV2Blitz arquivado/campos+setters+config neutralizados/gate binary-only) · side-preference removido · market-state-classifier + blitz-lab removidos (dead code provado) · research-worker classificado RESEARCH_ONLY · testes 44/44 + 20/20 verdes a cada corte.

### Pendente (ordem de execucao)
1. Etapa 2.2: deswiring dos runners antigos (rsi-agents-v2/v3/v4, rsi-v4, rsi-reversal, rsi-variants, agents-v4, scenario-*, four-way, dual/solo, shadow-lab, frozen-strategies, indicator-5m) com prova de consumidor individual; extrair funcao pura util quando houver (ex.: indicator-5m).
2. Etapa 2.4/2.5: OPERATIONAL_EXPIRY_SECONDS=300 como unica source of truth + Binary300Timing (server time/buckets/deadline/safe cutoff do contrato real; nunca REAL para descobrir timing).
3. Etapa 2.6-2.9: caminho unico (ConsensusDecision -> Revalidation -> Binary300Timing -> ExecutionGate -> AccountRouter) com invariantes (status != ACTIVE -> DENY; researchOnly -> DENY).
4. Etapa 2.10: fechamento (node --check, build, smokes, aislop escopado) + metricas de complexidade.
5. Etapa 3: Asset Agent (3h/2160 candles ring buffer + hydration), Feature Engine incremental, 5 especialistas com AssetContext-first, Consensus BUY/SELL/WAIT sem confidence, Decision Snapshot, fixtures causais.
6. Etapa 4: frontend (History lista+detalhe, sem Blitz/duration/seletor antigo, LOG novo).
7. Etapa 5: DB fields + invariants/CI + docs + paridade PRACTICE/REAL + E2E PRACTICE (path-test excluido de metricas) + REAL dry-run only.
8. Etapa 6: deploy + hydration + discovery + PRACTICE conforme config + REAL DISARMED + FREEZE da V2 (mudanca futura = V3 + novo hash + novo epoch).

### Regra de execucao
- PROVE FIRST / CHANGE SECOND / VERIFY THIRD; commits pequenos por marco; push a cada marco validado.
- Nao usar git reset --hard, force push, rewrite de historico, delete de baseline/tags.
- Nao commitar ZIPs grandes (snapshots via artifact de workflow).
- Relatorio final completo SOMENTE quando Etapas 2-6 estiverem verificadas.

### Progresso 2.2 (atualizado)
- CORTADO: rotas POST prepare/arm/stop do four-way-experiment + paths da API (unico caminho legado capaz de ordem via arm; default do modulo e DRY_RUN). Status/report GET seguem read-only.
- PROXIMO (2.2): deswiring completo do four-way (instanciacao/observeDecision/fourWayStatus/cohort) e dos demais runners antigos (rsi-agents-v2/v3/v4, rsi-v4, rsi-reversal, rsi-variants, agents-v4, scenario-*, dual/solo, shadow-lab, frozen-strategies, indicator-5m) — todos hoje construidos-desabilitados por flags do server (prova no server.mjs:54); extrair funcao pura util quando houver (ex.: indicator-5m) e entao remover as instanciacoes/rotas.

### Progresso 2.2 - lote labs (atualizado)
- CORTADO: instanciacoes LabRunner legadas (lab runId lab6 + labS04 bollinger-50) e params labEnabled/labRunId/labS04Enabled/labS04RunId; referencias restantes no runtime sao null-safe; rota /api/iq/lab/status vira no-op com researchOnly=true.
- FIX CRITICO: param labStake PRESERVADO (consumido pelo runner agentic linha 127) — sem ele o catch silencioso mataria o runner atual (agentic=null).
- EVIDENCIA: scripts/stage22-smoke.mjs -> agentic=OK, lab=REMOVED, labS04=REMOVED, initFails=NENHUM; agentic 44/44; lab6 20/20.
- SCAN null-safety dos demais legados (linhas_sem_?.): shadowLab 10, timingShadow 17, fourWay 4, agentsV4 8, indicator5m 5, rsiAgentsV3 5, rsiAgentsV4 11, rsiAgentsV2Live 5, iqMcp 4, scenarioShadow 12 -> cada um exige editar referencias diretas antes de remover; proximo lote recomendado: shadowLab + timingShadow (shadow-only, sem ordem) ou scenario*.

### Progresso 2.5 (atualizado)
- CRIADO relay/execution/binary300.mjs: OPERATIONAL_EXPIRY_SECONDS=300, ExpiryPolicyError, assertOperationalExpiry/isOperationalExpiry, Binary300Timing (syncServerTime/offset, serverNow, bucketStart/bucketEnd, targetExpiryAt ESTRITO = (floor(t/300000)+1)*300000, deadlineAt=t_exp-minLead 5s, secondsToExpiry, canSubmit fail-closed, snapshot). Sem comentarios/REAL; aditivo, runtime intocado.
- PROVA da semantica legada: Math.ceil(serverNow/60_000)*60_000 (Turbo 1m) repetido em 8 pontos do iq-multi-runtime (1430/1456/1485/1506/1592/1836/1870/2402/2420) -> deve ser substituido por Binary300Timing quando o caminho unico (2.6-2.9) entrar.
- TESTES: scripts/binary300-tests.mjs 21/21 (EXPIRY_NOT_300S p/ 60/180/null, NO_SERVER_TIME, offset, fronteira exata -> proxima, janela fechada no deadline, aberta 1ms antes, sem campo REAL).
- PROXIMO (2.6-2.9): ExecutionGate/AccountRouter/Revalidation com invariantes status!=ACTIVE->DENY e researchOnly->DENY; depois 2.2 restante (shadowLab/timingShadow/scenario*/indicator5m/agentsV4/rsiAgentsV3/V4/V2Live com referencias diretas a editar).

### Progresso 2.6 (atualizado)
- CRIADO relay/execution/execution-gate.mjs: ExecutionGate.decide() puro e deterministico com ordem fixa de guardas (KILL_SWITCH_ENGAGED > RESEARCH_ONLY_DENY > STRATEGY_MISSING > STRATEGY_NOT_EXECUTABLE > STRATEGY_NOT_ACTIVE > STRATEGY_HASH_MISSING > BINARY_ONLY > EXPIRY_NOT_300S > timing > REAL_FAIL_CLOSED > REAL_ACCOUNT_CONTEXT_REQUIRED > ACCOUNT_MODE_INVALID > ACCOUNT_CONTEXT_MISMATCH); negacao retorna accountMode=null e executionMode=NONE.
- PROVA do invariante central: V2 PENDING_IMPLEMENTATION e READY_FOR_DEPLOY -> STRATEGY_NOT_ACTIVE (so ACTIVE executa); teste explicito.
- TESTES: scripts/execution-gate-tests.mjs 19/19.
- PROXIMO (2.7-2.9): AccountRouter (paridade Practice/Real: MESMO AssetContext/specialists/consensus, unica diferenca = conta) e Revalidation (re-checar gate imediatamente antes do submit) + ligacao do Binary300Timing ao Gate no caminho novo; depois fechamento 2.10 e 2.2 restante.

### Progresso 2.2/2.5 - defaults fail-closed + fim do Turbo 1m
- DEFAULTS do construtor: scenarioShadow/scenarioTiming/agentsV4/dualReasoning/soloReasoning/indicator5m/rsiReversal/rsiVariants/rsiAgentsV3 = false (antes true) — construcao sem flags NAO habilita legado (fail-closed). Mantidos true apenas dataHubEnabled e consensusEnabled (produto atual).
- TURBO 1m MORTO: 9x Math.ceil(serverNow/60_000)*60_000 substituidos por nextOperationalExpiryAt(serverNow) (binary300.mjs); TURBO_RESTANTE=0; nenhum fallback 60s capaz de chegar ao broker.
- EVIDENCIA: smoke -> legacyEnabled=NENHUM, agentic=OK, labs REMOVED, initFails=NENHUM; binary300 21/21; gate 19/19; agentic 44/44; lab6 20/20; build OK.
- PENDENTE 2.2: remocao fisica das instanciacoes/referencias (shadowLab/timingShadow/scenario*/indicator5m/agentsV4/rsiAgentsV3/V4/V2Live/iqMcp/fourWay) — hoje incapazes de operar (flags false + defaults false); extrair funcoes puras uteis se houver. Proximo: 2.7 Revalidation, 2.8 ligacao Timing->Gate, 2.9 AccountRouter, prova do caminho unico, 2.10.

### Progresso 2.7-2.9 (caminho unico composto)
- relay/execution/revalidation.mjs: Revalidation.evaluate -> DECISION_MISSING/DECISION_SIDE_INVALID/DECISION_TIMESTAMP_MISSING/DECISION_STALE (>5s)/timing/decisao do gate; so BUY/SELL.
- relay/execution/account-router.mjs: decisionFingerprint (marketKey|side|strategyId|strategyVersion|strategyHash|snapshotId|decidedAt), assertParity (ACCOUNT_PARITY_VIOLATION), AccountRouter.route -> ROTED_PRACTICE/ROUTED_REAL, REAL exige realArmed+context.mode=REAL, requiresConfirmation=true, negacao nao expoe conta.
- relay/execution/single-path.mjs: SinglePath.evaluate compoe timing.canSubmit -> gate.decide -> revalidation -> router; sucesso = SINGLE_PATH_ALLOWED com expiryAt/deadlineAt/conta/fingerprint.
- PROVA (item 6): scripts/single-path-tests.mjs 19/19 - PRACTICE e REAL com MESMA decisao => MESMA expiracao/DEADLINE/FINGERPRINT (paridade); V2 pendente negada nos dois modos; Turbo 60s/BINARY-only/researchOnly/kill switch/decisao velha/WAIT/sem serverTime negados.
- GATE: ordem de guardas corrigida (status!=ACTIVE ANTES de executable) - invariante semantico.
- PENDENTE item 1 (2.2 fisico): remover instanciacoes/referencias fisicas dos legados (shadowLab/timingShadow/scenario*/indicator5m/agentsV4/rsiAgentsV3/V4/V2Live/iqMcp/fourWay) - hoje ja incapazes de operar; extrair funcoes puras uteis. 2.10 (smokes/metricas/aislop/fechamento) fica gated ate esse fisico concluir.

### ETAPA 2 FECHADA (d810181 + este commit) - evidencias
- runtime startup smoke: stage22-smoke -> agentic=OK, labs REMOVED, legacyEnabled=NENHUM, initFails=NENHUM.
- build/typecheck: tsc + postbuild OK.
- API smoke: 114 rotas; 0 refs a handlers removidos; producao /health 200 {ok,db:true,dbBytes~393MB}; boot local NAO executado de proposito (evitar segundo relay/ordens).
- frontend smoke: 0 refs a endpoints legados; assets copiados no build.
- DB nao-destrutivo: DB_SMOKE=OK select1=true mb=395 tabelas=133.
- PRACTICE sem REAL: nenhuma ordem enviada; REAL fail-closed provado (gate 19/19: REAL sem arm -> REAL_FAIL_CLOSED; caminho REAL legado -> REAL_LEGACY_V2_PATH_DISABLED).
- aislop escopado: 59/100 (== baseline; sem piora), 793 arquivos.
- metricas: runtime 4526->4187 (-339); server 565->525 (-40).
- auditoria de paths: TURBO_1M_RESIDUAL=0; placeTrade=0; unicas funcoes de ordem = requestOrder + submitLabPracticeOrder; rotas de arm restantes = /api/iq/arm|disarm (pratica) e /api/iq/real/arm|disarm (fail-closed).
- PARIDADE: single-path 19/19 prova mesma decisao+timing+fingerprint em PRACTICE e REAL; garantia de AssetContext/features/specialists/Consensus identicos sera implementada/testada na ETAPA 3 (ainda nao existem).
- PENDENTE ETAPA 3 (proximo): AssetAgent por ativo (ring buffer 3h/2160 candles 1m + hidratacao pos-restart; regime UPTREND/DOWNTREND/RANGE/TRANSITION; BOS/CHoCH causal; zonas S/R MICRO/LOCAL/STRUCTURAL por ATR; PULLBACK/TREND_RESUMING/REVERSAL_RISK/REVERSAL_CONFIRMED) -> Feature Engine incremental (1x por tick) -> 5 especialistas AssetContext-first (RSI/DMI-ADX/Bollinger/ATR/PriceAction; domainAssessment/supporting/counter/blockers) -> Consensus BUY/SELL/WAIT sem confidence -> Decision Snapshot imutavel; testes com fixtures causais + paridade de contexto entre contas. Retomada: ler este handoff.

### ETAPA 3 INICIADA - AssetContext (fundacao)
- relay/intelligence/asset-context.mjs: ASSET_CONTEXT_WINDOW_CANDLES=2160 (3h@1m), pivotK=2; ingest/ingestMany/hydrate com rejeicao de duplicado/fora-de-ordem; eventos PIVOT_HIGH/LOW com confirmedAt>detectedAt (causal); estrutura/regime UPTREND/DOWNTREND/RANGE por ultimos 2 topos/fundos (HH/HL/LH/LL); BOS_UP/BOS_DOWN e CHOCH_UP/CHOCH_DOWN por close com dedupe por nivel; zones() MICRO/LOCAL/STRUCTURAL + distanceAtr (ATR14); pullback() SHALLOW<0.5 / NORMAL<1.5 / DEEP<3 / STRUCTURE_THREATENING (ou perda do ultimo fundo); snapshot() completo.
- TESTES: scripts/asset-context-tests.mjs 16/16 (serie sintetica 43 candles -> UPTREND + BOS_UP; CHOCH_DOWN e BOS_DOWN ao perder o ultimo fundo confirmado; determinismo; hydratedAt; ring 2200->2160; sem vazamento futuro).
- PROXIMO (Etapa 3): FeatureEngine incremental (1x por tick, consome AssetContext) -> 5 especialistas AssetContext-first (RSI/DMI-ADX/Bollinger/ATR/PriceAction; domainAssessment/supporting/counter/blockers) -> Consensus BUY/SELL/WAIT sem confidence -> DecisionSnapshot imutavel -> fixtures causais + teste de paridade AssetContext identico entre contas; depois Etapa 4 (frontend History/LOG/Grid), Etapa 5 (DB stats V2 separadas/invariants/CI/docs/paridade/E2E PRACTICE), Etapa 6 (deploy/hydration/discovery/REAL DISARMED/FREEZE).

### ETAPA 3 - PIPELINE COMPLETO (modulos) - c13a1a3+
- relay/intelligence/features.mjs: computeFeatures(ctx) 1x por tick (deep-freeze) -> RSI14 Wilder (zone OVERSOLD/LOW/NEUTRAL/HIGH/OVERBOUGHT), DMI/ADX14 (adx/plusDi/minusDi/trending>=20), Bollinger20/2 (bandwidth/percentB/expanding), ATR14+ATR5/volRatio, priceAction (bodyRatio/closeInRange/direction/pullback/nearestZone MICRO-LOCAL-STRUCTURAL/lastBOS/lastCHoCH); stableStringify/deepFreeze utilitarios.
- relay/intelligence/specialists.mjs: 5 especialistas AssetContext-first (runSpecialists(features) -> mesma features para todos, featuresVersion/featuresAt em cada saida); contratos domainAssessment/supportingEvidence/counterEvidence/blockers/summary; blockers: ADX_RANGE, ATR_EXPANDING, ATR_DEAD, STRUCTURE_THREATENING, CHOCH_AGAINST.
- relay/intelligence/consensus.mjs: consensus(features,specialists) -> side BUY/SELL/WAIT (sem confidence), thesis, blockers, invalidations, agreement, unsatisfied; BUY exige uptrend+pullback SHALLOW/NORMAL+RSI LOW/OVERSOLD+DMI TREND_UP+ATR ALIVE+zero blockers; SELL espelhado.
- relay/intelligence/decision-snapshot.mjs: buildDecisionSnapshot (expiracao 300 obrigatoria; hash sha256 deterministico; deep-freeze), snapshotFingerprint, decisionFromSnapshot (recusa WAIT).
- TESTES: scripts/stage3-pipeline-tests.mjs 22/22 (determinismo, contratos, BUY/SELL/WAIT, snapshot imutavel/hash estavel/60s rejeitado, PARIDADE PRACTICE/REAL com fingerprint/expiracao iguais e so o destino diferindo).
- PENDENTE Etapa 3: ligar o pipeline novo ao caminho de execucao (hoje modulos standalone; o runtime usa o grafo antigo), hidratacao do AssetContext no boot, fixtures com candles reais arquivados, e o teste de contexto identico entre contas no proprio runtime. Depois Etapa 4 (frontend History/LOG/Grid), Etapa 5 (DB stats V2 separadas/invariants/CI/docs/paridade/E2E PRACTICE), Etapa 6 (deploy/hydration/discovery/REAL DISARMED/FREEZE).

### ETAPA 3.7 PARCIAL (esta sessao) - retomada EXATA
- FEITO: relay/intelligence/asset-pipeline.mjs (AssetPipeline por ativo: AssetContext+features+specialists+consensus+lastSnapshot/lastDecision, hydration PENDING/READY/PARTIAL/FAILED, ready gate -> onCandle/evaluate retornam null e WAIT nunca cria snapshot; dedup/lock por snapshotId com markSubmitted/isDuplicate; evaluate(features) como seam de teste) + PipelineRegistry (ensure/get/hydrateAll com relatorio by-asset ready/partial/failed, onCandle, actionable() so READY+BUY/SELL+nao-duplicado, status()).
- TESTES: scripts/stage3-wiring-tests.mjs 16/16 com CANDLES REAIS arquivados (data/real/usdcad-1m-7d.json, 9832 velas): replay deterministico (3 execucoes iguais), causalidade por truncamento em T (estado identico; nenhum pivo/BOS/evento com at/confirmedAt > T), hydrate vazio->FAILED/NO_HISTORY, insuficiente->FAILED/INSUFFICIENT_HISTORY (WARMING_UP), 300->PARTIAL e pronto, 2300->READY com ring 2160, dedup, WAIT->sem snapshot, registry fail-closed, PROVA ESTATICA: relay/intelligence/* sem requestOrder/placeTrade/broker/realArmed/PRACTICE/REAL/iqoption/wsRuntime/accountRouter/executionGate.
- FALTA (proxima sessao, nesta ordem): (1) ligar o AssetPipeline ao iq-multi-runtime SUBSTITUINDO o grafo antigo no caminho de decisao (single pipeline, sem grafo paralelo) + hydration loader real (WS/DB/candles-archive) no boot com estados por ativo (ASSISTINDO/WAIT/BUY/SELL/SEM COMPRA/SEM FEED/OFF conforme feed+purchase status) + SEM_COMPRA quando feed ok e broker nao permite compra; (2) bloquear operacao ate READY (fail-closed) e NOT_READY/DEGRADED explicito se a inteligencia nao inicializar (sem catch silencioso); (3) gerar strategyHash real da V2 (AssetContext+features+specialists+consensus+300s; sem frontend) e gravar newStrategyHash + status READY_FOR_DEPLOY no manifesto (NUNCA ACTIVE antes da Etapa 6); (4) testes restantes da Etapa 3: dominios dos especialistas, REVERSAL_RISK->WAIT, TRANSITION->WAIT, duplicata/stale no runtime, init failure->DENY, hydration incompleta->DENY, paridade full-runtime PRACTICE/REAL (mesmo AssetContext hash/features/consensus/snapshot/timing; so rota difere); (5) E2E PRACTICE PATH_TEST depois; (6) Etapa 4 frontend (History/LOG/Grid, remover Blitz/duracao/seletor/confidence); (7) Etapa 5 DB (stats V2 separadas, statsEpoch, W/(W+L), DRAW separado) + invariants/CI + docs; (8) Etapa 6 deploy + hydration real + REAL DISARMED + ACTIVE + FREEZE.
- INVARIANTES PRESERVADOS: Blitz 0, 300s unico, REAL fail-closed/nunca enviado, V2 PENDING_IMPLEMENTATION (executable=false), baseline intacta, nenhuma ordem enviada, sem confidence, inteligencia sem broker/conta. Suites: asset 16 + pipeline 22 + wiring 16 + binary300 21 + gate 19 + single-path 19 + agentic 44 + lab6 20 = 177 verdes; build e smoke OK.
- COMMIT DE RETOMADA: este (ver git log -1 pos-push).

### ETAPA 3 - CORRECAO TIME-BASED CONCLUIDA (esta sessao) - retomada EXATA
- CORRIGIDO: janela de contexto agora e derivada de TIMESTAMPS (MAX_CONTEXT_AGE_MS=3h; pruning candle.at < last.at-3h + bound de capacidade 2160); intervalo explicito inferido (min diff) e validado (OPERATIONAL_CANDLE_INTERVAL_MS=5000; |intervalo-esperado|>50% -> PARTIAL/INTERVAL_INCOMPATIBLE, SEM conversao silenciosa); assessReadiness exige observacoes>=25 + intervalo compativel + cobertura(>=3h-1 intervalo) + maxGap<=10x intervalo + gapRatio<=2% -> READY, senao PARTIAL (nao-executavel) ou FAILED; candles futuros -> FAILED/FUTURE_CANDLES; duplicata/fora-de-ordem/invalido contabilizados (counts).
- AssetPipeline: hydration READY=executavel; PARTIAL=observavel mas NUNCA produz snapshot/acao; AnalysisState leve para WAIT (sem registro de trade/stake); productState() implementado (OFF/SEM FEED/SEM COMPRA/ASSISTINDO/WAIT/BUY/SELL) com feed != buyability.
- FIXTURES: 5s sintetica (3h-1 intervalo -> READY; <3h -> PARTIAL/COVERAGE_INSUFFICIENT; >3h -> pruning; gap 10min -> PARTIAL/GAP_TOO_LARGE; intervalo 5s vs expectativa 60s -> INTERVAL_INCOMPATIBLE; futuros -> FAILED). Fixture real 1m data/real/usdcad-1m-7d.json renomeada/documentada CAUSALITY_AND_DETERMINISM_FIXTURE (NAO valida 3h/5s) e usada para replay determinista + causalidade por truncamento (estado em T nao muda com candles >T; nenhum evento/pivo alem de T).
- EVIDENCIA: asset 16/16, pipeline 22/22, wiring 26/26, binary300 21/21, gate 19/19, single-path 19/19, agentic 44/44, lab6 20/20 (TOTAL 187), node --check, build, smoke (agentic=OK, legacyEnabled=NENHUM).
- FALTA (proxima sessao, ordem exata): (1) WIRING NO RUNTIME: instanciar PipelineRegistry no iq-multi-runtime, conectar o feed de candles fechados (apenas candle fechado; nao processar 2x), substituir o grafo antigo no caminho de decisao (PROVAR consumidores e deswirar; broker-capable intelligence paths = 1), hydration loader real no boot (descobrir Binary OTC -> historico canonico -> validar granularidade -> hidratar -> status por ativo), startup NOT_READY/DEGRADED com causa se registry/inteligencia falhar (sem catch silencioso), Execution DENY se nao READY; (2) dedup/lock por ativo/snapshot e stale decision no runtime; (3) paridade full-runtime PRACTICE/REAL (mesmo AssetContext/features/specialists/consensus/snapshot hash/timing ate o AccountRouter; so rota difere; REAL DISARMED); (4) testes restantes: TRANSITION/RANGE/REVERSAL_RISK/PULLBACK-ativo -> WAIT, TREND_RESUMING UP/DOWN elegiveis, PARTIAL/FAILED -> sem decisao, feed stale -> DENY, SEM COMPRA -> DENY; (5) strategyHash da V2 (AssetContext+features+specialists+consensus+300s; sem frontend) + newStrategyHash + status READY_FOR_DEPLOY; (6) Etapa 4 frontend; (7) Etapa 5 DB/invariants/CI/docs + E2E PRACTICE PATH_TEST excluded + validacao Binary300Timing no broker PRACTICE; (8) Etapa 6 deploy/health/hydration real/REAL DISARMED/V2 ACTIVE/FREEZE.
- INVARIANTES: blitz 0, 300s unico, REAL fail-closed/nunca enviado, V2 PENDING_IMPLEMENTATION, baseline intacta, sem confidence, inteligencia sem broker/conta (prova estatica), nenhuma ordem enviada.
- COMMIT DE RETOMADA: este (git log -1 apos push).

### ETAPA 3 - WIRING: INVENTARIO + ADAPTADOR (esta sessao) - retomada EXATA
- ITEM 1 (inventario PROVADO, grep no commit b3bd73d): CURRENT_DECISION_PATH = iq-multi-runtime.mjs:111 (agentic evaluate: runAgentGraph + agentGraphToStrategyResult + agentCustomStrategy) -> relay/lab/runner.mjs:146 -> runtime.submitLabPracticeOrder (:1514) -> runtime.requestOrder (:1533, agentExpirySeconds) -> broker. requestOrder (:3267) e o unico submit de broker. PURE_HELPER = agents/graph.mjs (runAgentGraph/agentGraphToStrategyResult) e relay/agents/custom-strategies.mjs (gate/signal) - reutilizaveis como funcoes puras. LEGADOS BROKER-CAPABLE A CORTAR: :2306 (source experiment:, horizonSeconds 60), :2888 (auto path), server.mjs:423 /api/iq/test-order (horizonSeconds 60). PATH_TEST ok: server.mjs:469 (horizonSeconds 300).
- CRIADO relay/intelligence/runtime-adapter.mjs (RuntimeIntelligence): UM PipelineRegistry por runtime (nunca PRACTICE/REAL), onClosedCandle com dedup por asset+at+intervalMs (nao processa 2x), feedStatusFor ABSENT/OK/STALE (feedStaleMs 30s), productStateFor (ASSISTINDO/SEM FEED/SEM COMPRA/OFF/WAIT/BUY/SELL), decisions() apenas ativos READY+BUY/SELL com DecisionSnapshot imutavel, allowsExecution() fail-closed (INTELLIGENCE_NOT_READY/HYDRATION_NOT_READY/FEED_NOT_OK/STRATEGY_NOT_ACTIVE), health() com intelligenceReady/degraded/assetsTotal/Ready/Partial/Failed/strategyVersion/strategyStatus/lastPipelineUpdateAt/expectedIntervalMs; start() sem catch silencioso (loader falhando -> FAILED + DENY); zero referencias a conta/broker (prova estatica incluindo selectedAccount).
- TESTES: scripts/stage3-runtime-adapter-tests.mjs 21/21 (dedup, feed stale, hydration PARTIAL/FAILED -> DENY, V2 pendente -> STRATEGY_NOT_ACTIVE via SinglePath, REAL sem arm -> REAL_FAIL_CLOSED, WAIT -> zero decisao, 1 feature computation por candle fechado com mesma featuresVersion/featuresAt nos 5 especialistas, estado isolado por ativo). TOTAL DA SUITE: 208 verdes (21+26+22+16+21+19+19+44+20) + build + smoke.
- FALTA (proxima sessao, ordem EXATA): (1) instanciar RuntimeIntelligence no iq-multi-runtime como UNICO registry; (2) conectar o feed de candles FECHADOS (5s; forming != closed; dedup via adapter) ao onClosedCandle; (3) hydration loader real no boot por Binary OTC (historico canonico; validar intervalo/cobertura; sem inventar candles) + publicar hydrationStatus; (4) substituir o CURRENT_DECISION_PATH: remover o evaluate do agentic (runAgentGraph+custom strategy) e o submitLabPracticeOrder do lab runner do caminho de decisao; usar decisions() -> SinglePath (Revalidation->Binary300Timing->ExecutionGate->AccountRouter) mantendo requestOrder apenas como executor final; (5) cortar os legados broker-capable: :2306 (experiment 60s), :2888 (auto), server test-order (60s) - provar consumidores antes; (6) startup fail-closed: registry/inteligencia falhou -> health DEGRADED/NOT_READY + ExecutionGate DENY (sem agentic=null silencioso); (7) expor health (intelligenceReady/strategyVersion/strategyStatus/assetsTotal/Ready/Partial/Failed/lastPipelineUpdateAt); (8) paridade full-runtime PRACTICE/REAL (mesmos candles -> tudo identico ate AccountRouter; REAL DENY armed=false); (9) fixtures restantes: RANGE/TRANSITION/REVERSAL_RISK/PULLBACK_ACTIVE -> WAIT, TREND_RESUMING UP/DOWN elegiveis, interval incompatible/future/feed stale/SEM COMPRA -> DENY, lock por ativo (EURUSD nao bloqueia USDJPY); (10) causalidade full-runtime com dados reais; (11) strategyHash V2 (incluir readiness/gap policy no hash) + manifesto completo + status READY_FOR_DEPLOY (NUNCA ACTIVE); (12) Etapa 4 frontend; (13) Etapa 5 DB/invariants/CI/docs/E2E PRACTICE/Binary300 broker validation; (14) Etapa 6 deploy/hydration real/REAL DISARMED/V2 ACTIVE/FREEZE.
- INVARIANTES: blitz 0, 300s unico, REAL fail-closed/nunca enviado, V2 PENDING_IMPLEMENTATION executable=false, baseline intacta, sem confidence, inteligencia sem conta/broker, nenhuma ordem enviada.
- COMMIT DE RETOMADA: este (git log -1 apos push).

### ETAPA 3 - CORTE DOS LEGADOS 60s (esta sessao) - retomada EXATA
- CORTADO (7 substituicoes provadas): (1) iq-multi-runtime submit 'experiment:' (era :2306, horizonSeconds 60) -> throw fail-closed EXPERIMENT_LEGACY_BROKER_PATH_DISABLED; (2) auto path (era :2888) -> throw fail-closed AUTO_LEGACY_BROKER_PATH_DISABLED (helper BRAIN_HORIZON_SECONDS permanece, sem submit); (3) server /api/iq/test-order -> guard PRACTICE-only (REAL -> 403 TEST_ORDER_PRACTICE_ONLY) + horizonSeconds fixo 300 + marcadores testOnly/excludedFromStats; (4) front strategy-console.js test-order 60->300; (5) this.agentExpirySeconds 60->300 (o caminho CURRENT agora submete 300s, alinhado a observacao nextOperationalExpiryAt ja vigente).
- PROVA DE DURACAO (submit-capable): callers de requestOrder = iq-multi-runtime:1533 (submitLabPracticeOrder = caminho CURRENT, 300s) + server:423 (test-order, PRACTICE-only 300s) + server:469 (engine/path-test PATH_TEST 300s). 30=0, 45=0, 60=0, 150=0, 180=0, 300=1 operacional. Aprendiz/Pesquisa: apprentice.mjs tem duracoes 45/60 no catalogo, mas NAO chama requestOrder (research-only, sem broker capability).
- EVIDENCIA: agentic 44/44, lab6 (rodado), runtime-adapter 21/21, wiring 26/26, node --check runtime+server, build OK.
- FALTA (ordem da missao, retomar): (1) instanciar RuntimeIntelligence no iq-multi-runtime (UNICO registry; start() explicito; falha -> intelligenceReady=false + DEGRADED/NOT_READY + DENY, sem catch silencioso); (2) hydration loader real (historico canonico por Binary OTC; validar 5s/timestamps/futuros/gaps; sem converter 1m->5s; sem inventar candles); (3) conectar feed de candles FECHADOS ao onClosedCandle (forming != closed; dedup asset+at+interval); (4) SUBSTITUIR o CURRENT_DECISION_PATH: remover runAgentGraph/agentGraphToStrategyResult/agentCustomStrategy + lab runner como motor operacional e ligar decisions() -> SinglePath (Revalidation->Binary300Timing->ExecutionGate->AccountRouter) reutilizando requestOrder como unica fronteira de broker; (5) health com intelligenceReady/degraded/strategyVersion/strategyStatus/assetsTotal/Ready/Partial/Failed/lastPipelineUpdateAt; (6) paridade full-runtime PRACTICE/REAL (tudo identico ate AccountRouter; REAL armed=false); (7) fixtures: RANGE/TRANSITION/REVERSAL_RISK/PULLBACK_ACTIVE -> WAIT, TREND_RESUMING UP/DOWN elegiveis, PENDING/PARTIAL/FAILED/INTERVAL_INCOMPATIBLE/FUTURE_CANDLES/STALE_FEED/SEM_COMPRA -> DENY; lock por ativo (EURUSD nao bloqueia USDJPY); race: killSwitch antes do submit -> DENY broker calls=0; (8) causalidade full-runtime com candles reais; (9) strategyHash V2 (incluir readiness/gap policy) + manifesto (operationalExpirySeconds=300, operationalCandleIntervalMs=5000, maxContextAgeMs=3h, readinessPolicy, specialists, consensus version) + status READY_FOR_DEPLOY (NUNCA ACTIVE); (10) Etapa 4 frontend (History/LOG/Grid, sem Blitz/duracao/seletor/confidence, productState do runtime); (11) Etapa 5 DB/invariants/CI/docs/E2E PRACTICE/Binary300 broker validation; (12) Etapa 6 deploy/hydration real/REAL DISARMED/V2 ACTIVE/FREEZE.
- INVARIANTES: blitz 0, 300s unico no capability de submit, REAL fail-closed/nunca enviado, V2 PENDING_IMPLEMENTATION executable=false, baseline intacta, sem confidence, inteligencia sem conta/broker.
- COMMIT DE RETOMADA: este (git log -1 apos push).

### ETAPA 3 - INTEGRACAO NO RUNTIME (esta sessao) - retomada EXATA
- INTEGRADO (5 substituicoes provadas + smoke): (1) UMA RuntimeIntelligence em iq-multi-runtime (this.assetIntelligence; strategy={version PULLBACK_4060_300_AGENTIC_V2, status PENDING_IMPLEMENTATION, executable false}); (2) start() explicito com log ASSET_INTELLIGENCE_START e falha estruturada ASSET_INTELLIGENCE_START_FAIL/INIT_FAIL (nunca silencioso); (3) GRAFO ANTIGO DESWIRED: evaluate do agentic (linha ~111) agora e { this.lastEvaluationAt = this.now(); return []; } -> lab runner nao recebe candidatos -> submitLabPracticeOrder nao gera ordem; (4) FEED: #pipeClosedCandle chamado de #ingestCandle (evento canonico candle-generated via #onCandleEvent) com mapeamento tolerante (at/time/ts/timestamp/t, open/o, high/h, low/l, close/c; ms vs s) e dedup do adapter; falha de feed loga PIPE_FEED_FAIL e nao derruba o runtime; (5) HEALTH: intelligenceStatus() agora inclui assetIntelligence (intelligenceReady/degraded/strategyStatus/assetsTotal/Ready/Partial/Failed/lastPipelineUpdateAt) - rota /api/iq/intelligence ja existente.
- EFEITO OPERACIONAL (fail-closed por construcao): caminho ANTIGO sem candidatos = 0 ordens; caminho NOVO existe mas nao esta ligado ao submit e V2 PENDING_IMPLEMENTATION -> ExecutionGate DENY; capability operacional de broker = 0 ate V2 ACTIVE (Etapa 6). requestOrder segue fronteira unica (1 caller operacional agora sem candidatos + 2 test-only PRACTICE 300s).
- EVIDENCIA: smoke -> assetIntelligence=INSTANCIADO ready=true strategy=PENDING_IMPLEMENTATION assets=0 exit=0; 208 testes verdes (asset 16 + pipeline 22 + wiring 26 + runtime-adapter 21 + binary300 21 + gate 19 + single-path 19 + agentic 44 + lab6 20) + node --check + build.
- FALTA (retomar): (1) decisions() -> SinglePath -> requestOrder no loop do runtime (o novo motor ainda NAO esta ligado ao submit; hoje capability=0) com dedup/lock por ativo e race test (killSwitch antes do submit -> DENY brokerCalls=0); (2) HYDRATION LOADER real no boot por Binary OTC (historico canonico; provavelmente candles-archive/DB; validar 5s vs 1m -> INTERVAL_INCOMPATIBLE/PARTIAL/DENY - o feed WS atual pode ser 1m: validar com evidencia real); (3) provar via runtime que feed atual classifica intervalo (esperado PARTIAL/DENY se 1m) e product states reais (OFF/SEM FEED/SEM COMPRA/ASSISTINDO/WAIT/BUY/SELL); (4) paridade full-runtime PRACTICE/REAL + causalidade runtime com dados reais + fixtures restantes (RANGE/TRANSITION/REVERSAL_RISK/PULLBACK_ACTIVE->WAIT; TREND_RESUMING UP/DOWN elegiveis; PENDING/PARTIAL/FAILED/INTERVAL_INCOMPATIBLE/FUTURE_CANDLES/STALE_FEED/SEM_COMPRA->DENY); (5) remover/read-only a fonte paralela agentExpirySeconds=300 (autoridade unica = OPERATIONAL_EXPIRY_SECONDS/Binary300Timing); (6) rename seguro de submitLabPracticeOrder (sem semantica lab no caminho novo) apos provar consumers; (7) strategyHash V2 (com readiness/gap policy) + manifesto + status READY_FOR_DEPLOY; (8) Etapa 4 frontend; (9) Etapa 5 DB/invariants/CI/docs/E2E PRACTICE/Binary300 broker validation; (10) Etapa 6 deploy/hydration real/REAL DISARMED/V2 ACTIVE/FREEZE.
- INVARIANTES: blitz 0, 300s unico, capability operacional de broker = 0 (fail-closed), REAL nunca tocado, V2 PENDING_IMPLEMENTATION executable=false, baseline intacta, sem confidence, inteligencia sem conta/broker.
- COMMIT DE RETOMADA: este (git log -1 apos push).

### ETAPA 3 - BLOQUEADOR 1 RESOLVIDO (esta sessao) - retomada EXATA
- FEITO: RuntimeIntelligence.health() agora expoe state (NOT_READY/DEGRADED/READY) + initialized + intelligenceReady (exige initialized && initError null && assetsTotal>=1 && assetsReady>=1) + observedIntervalMs + lastHydrationAt; allowsExecution() usa health().state != READY -> DENY (INTELLIGENCE_NOT_READY/INTELLIGENCE_DEGRADED). Smoke: assetIntelligence=INSTANCIADO state=DEGRADED initialized=true ready=false assets=0 (exit 0) - 0 assets NUNCA reporta pronto.
- EVIDENCIA: adapter 21/21, wiring 26/26, agentic 44/44, lab6 20/20, build OK.
- FALTA (retomar, prioridade): (1) BLOQUEADOR 2 - PROVAR granularidade REAL do feed: inspecionar iqoption-ws/iq-multi-runtime #onCandleEvent/#ingestCandle/candle-generated (campo de size/interval no payload), tick stream e historico canonico; relatar raw feed type + interval ms + intervalo entregue; se tick -> implementar UM agregador canonico 5s (bucket deterministico, closed-only, dedup, restart definido, boundaries) OU se 1m-only -> V2 NAO ACTIVE documentando BLOCKED_BY_5S_DATA_SOURCE (nunca dividir/interpolar 1m); (2) hydration loader real por Binary OTC (fonte canonica; 5s se existir; senao PENDING/PARTIAL acumulando ao vivo; se viavel persistir serie 5s canonica unica asset+intervalMs+at); (3) decisions() -> SinglePath -> requestOrder no loop do runtime (hoje o motor novo NAO esta ligado ao submit; capability=0 fail-closed) com dedup/lock por ativo + race killSwitch; (4) paridade full-runtime PRACTICE/REAL + causalidade runtime + fixtures restantes (RANGE/TRANSITION/REVERSAL_RISK/PULLBACK_ACTIVE->WAIT; TREND_RESUMING UP/DOWN elegiveis; PENDING/PARTIAL/FAILED/INTERVAL_INCOMPATIBLE/FUTURE_CANDLES/STALE_FEED/SEM_COMPRA->DENY); (5) agentExpirySeconds -> read-only/remover (autoridade unica OPERATIONAL_EXPIRY_SECONDS/Binary300Timing); rename seguro de submitLabPracticeOrder; (6) strategyHash V2 (incluir readiness/gap policy) + manifesto + READY_FOR_DEPLOY (NUNCA ACTIVE); (7) Etapa 4 frontend (MESAS/LOG/HISTORICO/CONFIGURACOES; productState do runtime; sem Blitz/duracao/seletor/confidence); (8) Etapa 5 DB/invariants/CI/docs/E2E PRACTICE PATH_TEST/Binary300 broker validation; (9) Etapa 6 deploy/hydration real/REAL DISARMED/V2 ACTIVE/SO SE ENTAO ACTIVE + FREEZE; se feed 5s nao existir: finalizar frontend/DB/CI deploy safe e reportar BLOCKED_BY_5S_DATA_SOURCE sem ativar V2.
- INVARIANTES: blitz 0, 300s unico, capability operacional de broker = 0, REAL nunca tocado, V2 PENDING_IMPLEMENTATION executable=false, baseline intacta, sem confidence.
- COMMIT DE RETOMADA: este (git log -1 apos push).
