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
