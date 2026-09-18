# OFFICE V3 — FINAL UX + AGENT VALIDATION (T1–T13)

- Data: 2026-09-18
- Commit desta entrega (código/UX/testes/scripts/screenshots): `974555378f6acebd6fd8715f81592170484dd2ef`
- Este documento (`final-ux.md`) entra no commit de documentação imediatamente seguinte, no mesmo push.
- Commit anterior / base de rollback: `beaa5f5` (hotfix clean-nav)
- Rollback preservado: `/classic.html` (200) e `/office-v2.html`
- Deploy produção: `https://tracecom-consecom.vercel.app` (deployment `https://tracecom-22bictxal-consecom.vercel.app`)
- Modo: **PRACTICE only · ZERO REAL**. Nenhuma ordem foi enviada nesta task.

## Resultados gerais

| Verificação | Resultado |
| --- | --- |
| `npx vitest run tests/ai` | **751/751 PASS** (53 arquivos; +8 novos de isolamento/T2/T7) |
| `npx tsc -p tsconfig.json --noEmit` | **limpo** |
| `npm run build` | **ok** (tsc + postbuild para `dist/`) |
| Browser real (Playwright + Chrome 153) `office-v3-final-check.mjs` | **32/32 asserts PASS** |
| Browser real `office-v3-browser-check.mjs` (regressão) | **53/53 asserts PASS** |
| Produção real `office-v3-prod-smoke.mjs` | **6/6 asserts PASS** |
| Diagnóstico ALL-AGENTS (`office-v3-agents-diagnostic.mjs`, prod) | **30/30 WORKING PASS · contaminação NENHUMA** |

---

## T1 · Centralizar de verdade

- `camera.js`: `refreshWorldBounds` passa a usar o **contentBounds real** do mundo como área navegável (com fallback para `worldWidth/Height` em callers antigos). `fitContent` enquadra o conteúdo uma única vez (nascimento centralizado); a partir daí o usuário controla.
- `world.js`: piso/paredes agora existem **somente dentro do content window**; `drawWorld` preenche o vazio ao redor com a cor base do piso — o escritório deixa de ficar “preso no topo dentro de uma área cinza maior”.
- Sem screenshot não há PASS: o browser real mede as margens **em pixels** na screenshot.
  - viewport 1280×720: `left=172 · right=172 · top=48 · bottom=48` (centro exato: `1280,512`).
  - amostragem de pixel nas 4 bordas do conteúdo: diffs `top=93 · bottom=115 · left=72 · right=72` (dentro ≠ fora).
- Pan em todos os lados, clamp vivo por zoom/viewport e conteúdo sempre acessível (testes `office-v3-ui-controls` + cenários browser 3/7).

## T2 · IQ OPTION na top bar

- Botão `IQ OPTION` + modal compacto (`topbar.js`), endpoints reais existentes: `GET /api/iq/status`, `POST /api/iq/disconnect`.
- Mostra: CONECTADO/DESCONECTADO, PRACTICE/REAL (REAL sempre BLOQUEADO), conta (`PRACTICE`), saldo real (`USD 57.20` em produção), WS (`ONLINE`), **MCP** (o snapshot não expõe MCP → “SEM STATUS NO SNAPSHOT”, sem invenção), stake global/teto, AUTO, JIT/QUALITY, troca de conta.
- **Zero credencial**: nenhum input no DOM, nenhuma senha/token/SSID/cookie/secret enviado, exibido ou armazenado. O botão RECONECTAR fica desabilitado com explicação (reconexão exige credencial server-side; vault do relay restaura sessão no start).
- Produção: modal real com `CONECTADO`, `USD 57.20`, `AUTO ON`, `MCP — SEM STATUS NO SNAPSHOT`.

## T3 · LOG global no painel superior

- Retângulo `LOGS` desenhado no canvas à direita de MERCADOS / LUCRO SEMANAL / LUCRO MENSAL, alimentado exclusivamente pelo stream real `GET /api/iq/events` (mesma infra do runtime/audit), formato `HH:MM:SS ATIVO — evento`.
- Atualização incremental por cursor (`after`) com seed no cursor vivo; lista limitada a 12 no canvas e 12 por mercado — sem crescimento indefinido (canvas não cria DOM; o painel direito é re-montado com lista limitada).
- Nenhum evento é fabricado: tipos/fields existentes (`agent.trader`, `agent.critic`, `market.decision`, `position.settled`, etc.).

## T4 · Setores na frente

- Faixas `FOREX MAJORS / FOREX CRUZADOS / OTC 24H / CRIPTOMOEDAS / ÍNDICES / COMMODITIES / OUTROS ATIVOS` saíram do ground layer e passaram a ser desenhadas na passada dinâmica **depois** das mesas (z-order/frente), elevadas para `deskTop-60` (não cobrem monitores), com painel opaco, texto com sombra e guarda de clipping/escala.
- Browser real: pixel do painel azul `(51,67,103)` contra piso `(78,52,25)` → PASS.

## T5 · Estado dos agentes

- `MARKET_STATES.WORKING` → exatamente 1 trader + 1 critic sentados na mesa (110 agentes para 55 mercados WORKING no teste de isolamento).
- Qualquer estado não-operacional (CLOSED/SUSPENDED/DISABLED/NOT_OFFERED/UNKNOWN/OPEN_BUT_FEED_OFFLINE) → nenhum agente visível.
- Supervisor/andarilho e áreas sociais **não são renderizados** nesta versão (continua existindo apenas no estado/testes de vida).

## T6 · Animação de análise sutil

- Monitor: brilho respirando + 2–3 pixels de terminal piscando (determinístico por tempo+índice).
- Agente: deslocamento de ~1px (respiração) + frame de animação determinístico no `updateLife`.
- Sem textos “WORKING”, sem badges extras. Browser real: 4.297 pixels mudam entre dois frames com câmera estática (sutil).

## T7 · WIN/LOSS/DRAW sobre o agente

- Badge acima da estação apenas em **settlement real** (`settlementState.lastResult/lastProfit/lastAt`), com janela de **12s** (`settlementBadgeVisible`), depois volta à animação.
- WIN `+R$ 8,50` verde, LOSS `−R$ 4,20` vermelho, DRAW `R$ 0,00` neutro; cancelada/indicativePnL/candidate/shadow/infraProbe/NULL nunca geram badge (testes de isolamento).

## T8 · Painel direito simplificado

- Interface principal mostra SÓ: cabeçalho com nome real; **STAKE DESTE MERCADO** (input individual + `GLOBAL` vs `OVERRIDE INDIVIDUAL`, preservando hard caps/gates do servidor); **ESTADO** (rótulo derivado, nunca mascarando OPEN_BUT_FEED_OFFLINE/SUSPENDED/DISABLED/NOT_OFFERED/UNKNOWN); **PERFORMANCE DO DIA** (OPERAÇÕES/WINS/LOSSES/WR de `settlementState.daily` — somente settled daquele marketKey no dia); **ATIVIDADE EM TEMPO REAL**.
- TÉCNICO/GIT/ENTRADA/EXECUÇÃO/RESULTADO/JOURNAL e abas foram removidos da interface (o modelo técnico continua no backend/`buildMarketDetailModel` para diagnóstico).
- Produção: EURUSD:OTC com blocos `estado,performance,atividade` e zero abas/blocos técnicos.

## T9 · Log do agente em tempo real

- Bloco grande `ATIVIDADE EM TEMPO REAL` abaixo da performance, com eventos reais de Trader/Critic/Consensus/Decision/WAIT/candidate/ordem/settlement filtrados **pelo marketKey selecionado**.
- Trocar de ativo limpa/troca imediatamente (re-mount por marketKey; teste de isolamento e sequência rápida no browser).

## T10 · ALL-AGENTS DIAGNOSTIC (produção, sem ordens)

Fonte: `GET /api/iq/office` real. Relatórios: `docs/office-v3/all-agents-diagnostic.{json,md}`.

| Métrica | Valor |
| --- | --- |
| Mercados | 54 |
| OPEN (broker) | 31 |
| ENABLED | 37 |
| **WORKING (OPEN+ENABLED+FEED FRESH)** | **30** |
| OPEN que NÃO estão WORKING | 1 |
| WORKING com par trader+critic | 30 |
| Decisões WAIT (válidas) | 30 |

- Cada WORKING validado em: marketKey, availability, enabled, feedFresh, candles5s, lastTick, Trader, Critic, Brain action, regime, setup, trigger, Consensus, Quality Score, JIT state e Execution eligibility → **todos PASS**.
- `structure` e `trigger`: `trigger` é `null` quando a decisão é WAIT (correto); `structure` **não é exposto** no snapshot público → reportado como ABSENT, nunca fabricado.
- Prova de isolamento: ActiveIds distintos e correlationIds distintos por mercado; `contamination.ok = true` (nenhum ACTIVE_ID_SHARED/CORRELATION_ID_SHARED).
- JIT/HQ: `jitEnabled=true`, `qualityGateEnabled=true`, `minTradeQualityScore=75`, `entryLeadMs=1500`, `brainGeneration=2`.

## T11 · OPEN × ENABLED × WORKING

- **OPEN** = disponibilidade do broker (`availability === "OPEN"`), sem considerar feed.
- **ENABLED** = mercado habilitado pelo operador (`enabled === true`), independente de estar aberto.
- **WORKING** = OPEN + ENABLED + feed fresco (featureState/tick/candles dentro da janela) → agentes trabalham.
- Exceções OPEN e não WORKING (1): `NZDCHF:OTC` → `DISABLED` com `reason=ENABLED_FALSE` (mercado OPEN no broker, porém desabilitado no config; feed `AGENT_OFFLINE`, 0 candles). Nenhuma config foi alterada para forçar coincidência de números.

## T12 · Testes de isolamento

- `tests/ai/office-v3-isolation.test.ts` (8 testes): EURUSD → GBPJPY:OTC → GOLD → USDJPY → EURUSD sem mistura de painel/stake/log/estado; 55 mercados WORKING simultâneos → 110 agentes, 55 pares únicos (1 trader + 1 critic), todos no próprio desk, invariantes ok; feed/candles/Brain por estação; badge real; IQ OPTION sem credenciais.
- Browser real: sequência rápida com `data-market-key` do painel, stake e linhas de atividade sempre do ativo corrente; zero contaminação do ativo anterior.

## T13 · Teste visual final (browser real)

- `office-v3-final-check.mjs` — **32/32 PASS**: centering/margens em pixels, pan, wheel vertical, Shift+wheel, Ctrl+zoom no cursor, Space+drag, focus-to-desk por clique, IQ OPTION, LOGS globais, faixas de setor, agentes WORKING, animação sutil, badge WIN, painel simplificado, logs individuais, stake individual, popup MESAS, resize.
- `office-v3-browser-check.mjs` — **53/53 PASS** (regressão completa).
- `office-v3-prod-smoke.mjs` — **6/6 PASS** em `https://tracecom-consecom.vercel.app` (54 mercados, P&L real, IQ OPTION, painel simplificado, rollback).
- Screenshots em `docs/office-v3/screenshots/`: `final-boot-centered.png`, `final-logs.png`, `final-panel-eurusd.png`, `final-panel-switch.png`, `final-iq-option.png`, `final-iq-option-after.png`, `final-mesas-popup.png`, `final-resize.png`, `final-prod-boot.png`, `final-prod-iq.png`, `final-prod-panel.png` (+ série `browser-s*.png`).

## Isolamento — prova

- 55 mercados × 2 agentes = 110 agentes únicos; cada par pertence a um único marketKey; `validateLifeInvariants` ok; zero agentes em mesa não-WORKING.
- Diagnóstico de produção: nenhum activeId/correlationId compartilhado entre mercados.
- Sequência rápida no browser: painel/stake/atividade sempre no marketKey atual; nenhum texto do ativo anterior (`Mercado não encontrado` nunca apareceu na sequência final).

## Exceções e pendências honestas

1. **MCP**: o snapshot real não expõe status MCP; o modal mostra “SEM STATUS NO SNAPSHOT”. Nada foi inventado.
2. **Reconexão IQ**: botão RECONECTAR desabilitado — reconectar exige credenciais no servidor (vault do relay). A UI nunca manipula senha/token/SSID (política ZERO credencial). `DESCONECTAR` é real.
3. **Troca de conta**: não suportada nesta build (PRACTICE única) — exibido explicitamente.
4. **`structure`**: não exposto no `GET /api/iq/office`; reportado como ABSENT no diagnóstico (sem fabricação).
5. **Diagnóstico depende do relay**: em produção 30 dos 31 OPEN são WORKING; a exceção (`NZDCHF:OTC` desabilitado) exige decisão do operador, não foi alterada nesta task.
6. **Arquivos de teste pré-existentes** (`tests/agent/engine.test.ts`, `tests/app/pan.test.ts`, `tests/config/env.test.ts`, `tests/research/trace-provenance.test.ts`) continuam modificados no working tree, não relacionados a esta task; não foram commitados.
7. **Browser screenshots de T3/T9** usam um stream de fixture local com os mesmos tipos/fields do runtime (o diagnóstico T10 e o prod smoke usam o stream real); o texto dos logs nesses screenshots é do fixture de teste, não dados de produção.

## Rollback

- `git revert` do commit `9745553` ou checkout de `beaa5f5`.
- Páginas de rollback preservadas: `/classic.html` e `/office-v2.html`.
