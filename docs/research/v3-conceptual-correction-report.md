# TRACECOM V3 — CONCEPTUAL CORRECTION REPORT

Data: 2026-09-23 · HEAD base: `03adc8b` · Escopo: correcao conceitual antes de qualquer PATH_TEST.
Estado final: **V3 OBSERVE_ONLY / PENDING_IMPLEMENTATION / executable=false · PRACTICE auto OFF · REAL DISARMED**.
Nada foi ativado; nenhuma ordem (PRACTICE ou REAL) foi enviada; Supabase segue `ROTATION_PENDING_EXTERNAL`
(inalterado por decisao explicita do operador).

## 1. EXPIRATION — o que significam 60000/900000, grade real e prova

- `option.expiration_times` = **duracoes em ms** por secao: turbo `[60000]` (cadencia curta de 1 min,
  hold de 1..5 min), binary `[900000]` (15 min). `active.deadtime` = 30s (turbo) / 300s (binary).
- **Prova historica (nossa conta, nao documentacao de terceiros)**: 664 ordens turbo ACEITAS (brokerOrderId
  + settlement reais), **526 delas com expiration fora de 5min mas em multiplos de 60s** (ex.: 23:56:00,
  23:57:00, 23:58:00) e durations observadas de 31s a 89s. Ordem V2 (5min) aceita em bucket de 5min.
  Conclusao: o broker aceita a **grade de minuto** para a familia turbo — o alinhamento forcado de 300s
  estava **errado** como unica grade permitida.
- `deadtime` = purchase deadline do broker (nao e a nossa janela).
- **firstSeenTte=329.984 NAO e prova de publicacao do broker**: e o nosso derivador detectando a fronteira
  quando a janela TTE<=330 abre. O relatorio anterior foi corrigido.
- Derivacao (sustentada por server timestamp + duracao/cadencia + deadtime + option type + ACK historico):
  `candidateExpirationAt = ceilToMinute(brokerNow + 300s)` e a lista visivel da UI e
  `availableShortExpirations = fronteiras de minuto em (brokerNow+deadtime, brokerNow+330s]`.
  Testes reproduzem os dois exemplos observados: `11:24:54 -> [11:26..11:30]`, candidato 11:30 TTE 306s;
  `11:25:30 -> 11:31` entra com TTE 330s. Cadencia: ~1 nova opportunity/min/ativo.
- **HOLD != GRID**: hold alvo 300s; grade 60s. O envio ocorre em ~TTE302 e a exposicao real e ~302s —
  nunca confundida com "operacao de 1 minuto".

## 2. OPTION TYPE — provado com ordens reais

- As ordens turbo ACEITAS de 1..5 min usam `optionTypeId=3` / secao `turbo` (`option.kind` turbo; a UI
  chama visualmente de "Binary", mas o protocolo distingue). As ordens V2 de 5 min tambem foram aceitas
  com `optionTypeId=3` e expiration exata (sem mismatch de ACK). A V3 envia o mesmo tipo.
- Binary (15 min, `optionTypeId=1`, deadtime 300s) NAO e o caminho da V3.

## 3. TIMING — ANALYSIS x EXECUTION + scheduler

- `analysisWindow`: `300s < TTE <= 330s` (investigar com ciclos).
- `executionWindow`: `TTE ∈ (300s, 302.5s]` (socket), `targetSendAt = expirationAt - 302s`,
  `hardCutoffAt = expirationAt - 300s`. Funcoes **distintas** (`analysis` vs `execution`) — nao mais um
  booleano para as duas coisas.
- **Scheduler independente do candle**: aprovacao na analysis window agenda um `ScheduledExecutionIntent`
  para `targetSendAt` (broker time); no disparo revalida janela/invalidations/blockers e registra o
  resultado. Sem isso, o ciclo de 5s poderia pular de TTE304 para TTE299 e perder a janela.
- Sem auto-ajuste de latencia: alvo fixo em 302s.

## 4. AGENTES — LLM REAIS (DeepSeek V4.1 Flash)

- Camada `relay/v3/agents/*` usa a abstração existente (`opencode-go` → modelo `deepseek-v4.1-flash`),
  com schema validado por papel e **fail-closed**: timeout, erro de provider, JSON invalido ou schema
  invalido => `AGENT_UNAVAILABLE` / WAIT, nunca APPROVE.
- 5 especialistas em **paralelo** → Asset → Consensus independente (2 fases, sem ver o Asset) →
  Final Challenge. Todas as chamadas retornam `provider/model/agentRole/requestId/latencyMs/schemaValid`
  e ficam no log (cycle payload/UI).
- **Determinismo continua sendo a matematica**: RSI/DMI/Bollinger/ATR/estrutura/pullback etc. continuam
  calculados por `measurements.mjs` (autoridade); os agentes interpretam e citam playbooks (`playbooksUsed`
  com ids) e `sourcesUsed` com source ids reais.
- Especialistas nao rotulam mais "support/counter": emitem **fatos com direcao** (`direction UP/DOWN/null`);
  o Asset/Consensus classificam relativo a tese. Zonas extremas de RSI sao contexto (nao blocker).
- `agentMode`: `LLM` (agentes reais) ou `DETERMINISTIC_OBSERVE` (coleta deterministica que **nunca aprova**;
  consensus fica `AGENT_UNAVAILABLE`). `V3_AGENTS_ENABLED=true` habilita o caminho LLM em producao.
- Selftest read-only: `POST /api/iq/v3/agents/selftest` roda um ciclo real sobre os dados atuais e devolve
  latencias por papel (nenhuma ordem).

## 5. SCENARIOS — simetria tipo x direcao

- Biblioteca refatorada: cenarios simetricos (TREND_CONTINUATION, PULLBACK_CONTINUATION,
  TREND_RESUMPTION, STRUCTURAL_REVERSAL, DEEP_PULLBACK_STRUCTURE_THREAT, BREAKOUT_RETEST) derivam a
  **direcao do mercado**; eventos (BREAKOUT/BREAKDOWN/FAILED_*) mantem semantica propria.
- Testes espelhados bull/bear provam igualdade estrutural (supports/blockers iguais) e estados opostos
  (BUY_CANDIDATE <-> SELL_CANDIDATE) — nenhuma direcao privilegiada.
- CHoCH invalida a estrutura ANTERIOR com direcao; o Final Challenge so considera invalidation que
  **contraria a tese** (BEARISH bloqueia alta; BULLISH bloqueia baixa).

## 6. LOG

Cada opportunity registra: expirationAt, brokerNow, TTE, discoveredAt/firstSeenTte, targetSendAt,
hardCutoffAt, ciclos (candle fechado, feature hash, estados especialistas LLM+deterministicos, cenario,
direcao, estado, consensus, agreement, diff), FINAL CHALLENGE (resultado, agreement, snapshot hash,
executionBlocked), agendamento (`scheduledSendAt`, `fireAt`, checks de revalidacao no alvo) e
`agentCalls` (provider/model/latency/schemaValid) — tela continua limpa; timeline no LOG.

## 7. BENCHMARK

- Deterministico (medicoes+regras): 240 ciclos p50 0ms / p95 2ms / p99 3ms.
- **Agentes (latencia simulada no adapter; 30 ativos × 4 ondas × 8 chamadas = 960 chamadas)**:
  p95 do ciclo completo 103ms, fila maxima 30 (paralelo por mercado), **zero janelas perdidas**.
- Latencia real do provider deve ser medida com o selftest em producao (execucao desta missao) e
  registrada no relatorio operacional; o orcamento de 5s por candle acomoda p95 de ~1-2s com folga.

## 8. HASH / ESTADO

- V2: inalterada, `sha256:3e9364e2…5daeb0`, `V2_FROZEN_IMMUTABLE PASS`.
- V3: novo hash `sha256:c535428d1f200000768caa383095b74571f32f719cf9509488c388a8f92097df` (grid+timing v2+scheduler+agentes+scenarios simetricos),
  manifesto `PENDING_IMPLEMENTATION`, `executable=false`, stats zeradas em tabelas `iq_v3_*`.
- Migracao 055 adiciona `agent_mode`, `scheduled_send_at`, `scheduled_fire_at`, `revalidation`.
- PRACTICE auto-execution OFF (`AUTO_ARM_PRACTICE=false`, `auto_execute=false`), REAL DISARMED,
  allowlist unica, `AGENTIC_ENABLED=false`. Nenhuma ativacao da V3 nesta missao.
