# TRACECOM V3 — EXPIRATION-DRIVEN AGENTIC ARCHITECTURE (relatorio de execucao)

Data: 2026-09-23 · HEAD inicial: `9323d03` · HEAD final: `e1b0d9c` (+ `b2910261` de docs neste commit)
Escopo: missao completa (secoes 0-50). **Nada foi ativado**: V3 `PENDING_IMPLEMENTATION/executable=false`,
PRACTICE auto-execution OFF, REAL DISARMED, nenhuma ordem enviada nesta missao.

## 1. V2 (preservada)

- Hash antes/depois: `sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0` (inalterado);
  `V2_FROZEN_IMMUTABLE PASS` e strategy-hash 16/16.
- Stats V2 nunca reaproveitadas para V3: V3 tem manifesto, epoch e tabelas `iq_v3_*` proprios.

## 2. Forense de duracao curta (P0)

- Ordens <=60s no banco: **todas do runner LAB legado** (`lab:AGENTIC_BLITZ_45S`, 30-51s;
  `lab:AGENTIC_RSI_FIB_V1`, 88-89s), `strategy_version=null`, todas em 2026-09-22 (antes do freeze V2).
- Nenhuma ordem <=60s depois da ativacao da V2. Porem existia **capacidade paralela**:
  `AGENTIC_ENABLED=true` em producao e allowlist operacional com `pathtest:`/`ui:smoke`/`agent-v2:`.
- **Correcao P0**: allowlist unica (`intelligence:PULLBACK_4060_300_AGENTIC_V2`), PATH_TEST opt-in
  (`PATH_TEST_ENABLED=true`, rota `/api/iq/test-order` 403 sem ele) e `AGENTIC_ENABLED=false` no Railway.
  Invariante `ONE_OPERATIONAL_BROKER_PATH` verifica isso no CI/`run-all`.
- Causa-raiz conceitual confirmada: o caminho V2 usava "proximo bucket no momento do sinal" —
  em TTE=302 o proximo bucket e a expiration **iminente** (TTE ~2s); as durations V2 observadas
  (167s/207s/297s) refletem sinais disparados em qualquer ponto do bucket.

## 3. Forense das ultimas losses (sem tuning)

| Caso | Origem | Duracao efetiva | Estado | Contrafactual +300s (diagnostico) |
|------|--------|-----------------|--------|-----------------------------------|
| AUDCHF 04:58Z | PATH_TEST (`ui:smoke`, testOnly/excluded) | 87s | EXPIRED_UNSETTLED | sem candles na retencao (3h) |
| USDTRY 12:37Z | V2 natural (PUT, DOWNTREND, pullback NORMAL 1.47 ATR) | 167s | EXPIRED_UNSETTLED (ACK perdido em reconexao WS) | **PUT venceria** (+300s: 48.9418 < 48.9452) → erro de horizonte/timing |
| USDBRL 12:55Z | V2 natural (PUT, DOWNTREND, NORMAL 0.83 ATR) | 297s | SETTLED LOSS | PUT perderia (5.1335 > 5.1097) → erro de direcao/entrada |
| USDMXN 13:21Z | V2 natural (PUT, DOWNTREND, NORMAL 0.98 ATR) | 207s | EXPIRED_UNSETTLED (sweeper) | PUT perderia (17.3715 > 17.3656) → erro de direcao/entrada |

Nenhuma estatistica oficial foi alterada; contrafactual e somente diagnostico (candles reais de 5s).

## 4. Descoberta das expirations reais (protocolo IQ — medido, nao suposto)

- Fonte: `initialization-data` v3 (poll real do relay a cada 60s/20s), `active.option` + `active.deadtime`.
- **Achado que refuta a hipotese inicial**: `option.expiration_times` traz **duracoes** em ms
  (`[60000, 900000]`), nao timestamps absolutos; a IQ **nao publica a agenda de expirations** nesse canal.
- Registrado em producao: 54 mercados, duracao 60000/900000 ms, `deadtime` 30s (turbo-1m) e 300s
  (binary-15m); nenhuma secao enviou timestamps.
- Implementacao resultante: `ExpirationDiscovery.front()` deriva a frente compravel do **relogio do
  broker** (multiplo operacional de 300s com TTE > deadtime) e a adocao roda a cada candle fechado
  (resolucao 5s). A expiration-alvo e **preservada exatamente**; aceitacao real e verificada no ACK
  (`BROKER_EXPIRATION_MISMATCH` se divergir).
- Evidencia de producao (pos-deploy, zero ordens): adocao `firstSeenTteMs = 329.984ms` (~5m30
  exatos) quando o boundary cruza a janela; `duplicatesBlocked=0`; oportunidades persistidas com
  `first_seen_tte_ms` em `(300s, 330s]`; 0 ciclos por ausencia de candles (todos os 54 OTC estavam
  `enabled=false`/suspensos no horario da observacao) — sem invencao de dados.
- Cadencia medida: 300s por boundary por ativo (fronteira derivada); o valor "1 nova/min/ativo"
  nao se confirma nem se descarta como evento do broker porque o broker nao publica eventos de
  expiracao neste canal (registrado no relatorio e em `docs/research/v3-sources.md`).

## 5. Arquitetura V3 entregue (observe-only)

- **ExpirationOpportunityEngine** (`relay/v3/opportunity-engine.mjs`): estados da missao, dedup
  `marketKey+expirationAt`, memoria de ciclos, regra temporal (`MISSED_5M_ENTRY_WINDOW` em TTE<=300s,
  adocao tardia rejeitada), `APPROVED_*`/`FINAL_REVIEW`.
- **ExpirationTargetTiming** (`relay/v3/timing.mjs`): brokerNow como autoridade, `targetSendAt =
  expirationAt - 302s`, `hardStrategicCutoffAt = expirationAt - 300s`, alinhamento 300s obrigatorio,
  `buildV3OrderIntent` + `assertExactExpirationTarget` (deny para expiration trocada/30s/60s/bucket recalculado).
- **requestOrder** aceita `exactExpirationAt` (V3): preserva a expiration exata, valida alinhamento,
  e no pre-submit usa a autoridade V3 (TTE em (300,330] + purchase deadline) em vez do "proximo bucket";
  hardening A03/A09 intacto (persistencia fail-closed + revalidacao pos-await).
- **Medicoes deterministicas causais** (`measurements.mjs`): RSI (trajetoria/crossback/persistencia/
  failure swing/divergencia), DMI (forca/slope/takeover/resume), Bollinger (%B/walk/reentry/rejection/
  squeeze), ATR (normalizacoes/regime/tolerancias), estrutura (pivots confirmados k=2, HH/HL/LH/LL,
  BOS/CHoCH formalizados, zonas), pullback (extensao != pullback), impulso, micro, breakout/retest.
- **5 especialistas** (`specialists.mjs`): descrevem dominio, nunca BUY/SELL (teste automatico);
  zonas extremas do RSI sao contexto (coerente com a regra oficial de Wilder), nao blocker.
- **Asset Agent** (`asset-agent.mjs`): Scenario Library com 18 cenarios, confirmacao obrigatoria por
  cenario (WAIT sem confirmacao), `bestCounterCase` em todo ciclo, mudanca de opiniao permitida.
- **Consensus** (`consensus.mjs`): classificacao independente (sem a conclusao do Asset) + comparacao
  AGREE/DISAGREE + FINAL CHALLENGE com familias de evidencia, precedencia invalidation > blocker >
  supports; **sem votacao/percentual**; duvida => CANCEL.
- **DecisionSnapshot V3** imutavel (deep-freeze + SHA256) com ciclos, especialistas, cenarios,
  agreement, bestCounterCase e timing; settlement nunca altera analise.
- **Persistencia/log**: migracao `054_v3_opportunities.sql` (`iq_v3_opportunities`,
  `iq_v3_cycles`, `iq_v3_expiration_offers`); log por ciclo com candle fechado, TTE, feature hash,
  estados por especialista, cenario, consensus e diff. UI: LOG com timeline por opportunity
  (ciclos + FINAL CHALLENGE), CONFIG mostra status V3; grid principal permanece limpo.
- **Multi-ciclos**: um ciclo por candle fechado (dedup por `closedCandleId`), janela (300s,330s].

## 6. Pesquisa e playbooks

- `docs/research/v3-sources.md` (registry com Wilder 1978 ISBN 978-0-89459-027-6, Bollinger book +
  regras oficiais, CMT Association, Edwards/Magee 11th ed., Kirkpatrick/Dahlquist 3rd ed., definicoes
  internas) e o achado de protocolo.
- Playbooks: `v3-rsi-playbook.md`, `v3-dmi-adx-playbook.md`, `v3-bollinger-playbook.md`,
  `v3-atr-playbook.md`, `v3-price-action-playbook.md`, `v3-scenario-library.md`.
- Agent.md: `docs/agents/v3/` (RSI, DMI-ADX, BOLLINGER, ATR, PRICE-ACTION, ASSET, CONSENSUS).
- BOS/CHoCH documentados como **sem definicao academica padronizada** (origem SMC) + definicao
  operacional interna causal (fechamento + pivot confirmado), marcada como TRACECOM.

## 7. Testes, benchmark e regressao

- `npm run build` OK; `node scripts/run-all-tests.mjs` → **25/25** (inclui `v3-smoke` 9/9, secret-scan,
  invariantes 26/26, settlement 14/14, hash V2 16/16).
- `npx vitest run tests/security tests/v3` → **111/111** (V3: 39 testes — expiration A–J, exact-order
  via requestOrder simulado, ciclos/anti-votacao, NO_SETUP/WAIT, schema de playbooks, causalidade,
  runtime integration, hash drift, benchmark).
- Benchmark 30 ativos × 8 ciclos: **240 ciclos em 116ms · p50 0ms · p95 1ms · p99 2ms**, zero janelas
  perdidas no orcamento de 5s (meta atendida com folga; nenhuma otimizacao destrutiva necessaria).
- Regressao no repositorio: baseline 76 falhas → 56 agora; diff nome-a-nome **sem regressoes**
  (1 teste de timing intermitente sob carga, estavel isolado, tambem intermitente no baseline).
- Correcoes de bugs reais encontradas durante a execucao (e cobertas por teste): `Number(null)=0`
  ativando o caminho exato; pullback classificado a partir de extensao; RSI extremo tratado como
  blocker; duplicatas massivas por re-adocao; adocao tardia criando opportunity invalida.

## 8. V3 — identidade

- Version: `PULLBACK_4060_300_AGENTIC_V3`
- Hash: `sha256:b2910261e3e32f2e138e5178a656fa071f0b3f371f9cdfd91d856e324f660028`
- statsEpoch: `2026-09-23T15:00:00.000Z` · Status: `PENDING_IMPLEMENTATION` · `executable=false`
- Execution: `OBSERVE_ONLY` (`V3_EXECUTE` ausente); nenhum caminho de ordem nos modulos V3.

## 9. Seguranca / deploy / estado operacional

- A01–A12 permanecem verdes (edge 401 anonimo, pre-submit, persistencia fail-closed, filtro canonico,
  REAL efetivo, params, CI hermetico, secret-scan).
- Supabase: `ROTATION_PENDING_EXTERNAL` continua aberto (sem acesso ao provedor); nao bloqueia a V3 local.
- Deploy desta missao: relay `e1b0d9c` + edge (Vercel) com smoke verde; `V3_ENABLED=true` para
  observacao read-only; `AGENTIC_ENABLED=false`; `AUTO_ARM_PRACTICE=false`; `auto_execute=false`.
- **PRACTICE auto-execution: OFF. REAL: DISARMED.** Nenhuma ordem (PRACTICE ou REAL) foi enviada.

## 10. Proximos passos (separados, com aprovacao explicita)

1. Observar oportunidades com mercados abertos (candles) para coleta de ciclos completos em producao.
2. Aprovar `PATH_TEST PRACTICE` controlado (env opt-in) para validar a ordem exata fim-a-fim.
3. Somente depois: ativar a V3 (`status ACTIVE` + `executable=true` + `V3_EXECUTE=true`) com novo hash/epoch.
4. Rotacionar a credencial Supabase (pendencia externa).
