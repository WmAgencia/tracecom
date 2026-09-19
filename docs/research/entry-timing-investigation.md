# Entry Timing — Investigação profunda e política LATE_WINDOW_V2 (SHADOW)

Data: 2026-09-18/19 (UTC) · Repo: `WmAgencia/tracecom` · Runtime: `tracecom-live-relay` (PRACTICE only, ZERO REAL)

Este documento responde, com evidência de código + dados de produção, como o timing de entrada funcionava,
qual é a semântica real de expiração da IQ Option, quanto tempo de mercado deixávamos de aproveitar, e como
ficou a nova política `LATE_WINDOW_V2` — implementada **exclusivamente em SHADOW** (não envia ordem, não
altera direção, stake, threshold 75, pesos do Quality Gate, Brain G2, Critic ou Consensus).

Artefatos versionados:

- `relay/late-window-timing.mjs` — módulo puro + observador SHADOW (`LATE_WINDOW_V2`).
- `relay/migrations/030_timing_policy_shadow.sql` — tabela `iq_timing_policy_observations` (separada do
  Prospective Shadow Lab 029; `timing_policy_version` próprio).
- `relay/iq-multi-runtime.mjs` — fiação observacional + captura da expiração realmente aceita pelo broker.
- `relay/server.mjs` — `GET /api/iq/research/timing-policy` (admin).
- `scripts/entry-timing-audit.mjs` → `docs/research/data/entry-timing-reconstruction.json` (Fases 1–3).
- `scripts/timing-policy-shadow-report.mjs` → `docs/research/data/timing-policy-shadow-report.json` (Fase 4).
- `tests/ai/late-window-timing.test.ts` — 28 testes (semântica, margem, ciclos, leakage, isolamento, runtime).

---

## FASE 1 — Como o timing funcionava antes (CURRENT_V1)

Fluxo real (lido do código, `relay/iq-multi-runtime.mjs` + `relay/entry-timing.mjs`):

1. A cada candle de 5 s (`CANDLE_SIZE_SECONDS = 5`), o Feature Engine reconstrói contexto causal
   (`relay/feature-engine.mjs`) e o Brain G2 decide `BUY/SELL/WAIT` (trader → critic → consensus).
2. Se a ação é `BUY/SELL` e não existe candidato/posição, `#entryPipeline` cria um **candidato** para a
   próxima fronteira de 60 s do **server time** com folga mínima:
   `submitAt = targetEntryAt - entryLeadMs` e `targetExpiryAt = targetEntryAt + 60 s`
   (`nextEntryWindow`, `minGapMs = 1500 ms`). O lead é dinâmico:
   `p95(ACK) + 300 ms (jitter) + 150 ms (safety)`, limitado a **1.0–2.0 s** (`dynamicEntryLeadMs`).
3. Enquanto o candidato existe, cada avaliação (~1/s) **não decide**; apenas registra mudanças
   (`candidateChangedBeforeEntry`). A decisão final ocorre **em `submitAt`** (via tick ou timer):
   `#finalizeEntry` revalida as regras A–G (`revalidateCandidate`), aplica o Quality Gate de produção
   (Entry Location + Microstructure Veto + score ≥ 75) e só então chama `#handleSignal → requestOrder`.
4. `requestOrder` computa a expiração com `computeExpiration(serverNowSec, 1)` e **falha fechado** se a
   expiração do broker não for exatamente `targetExpiryAt` (`ENTRY_EXPIRATION_MISMATCH`).
5. O envio real acontece **depois** de um `await #persistExecution(... state:"REQUESTED")` (INSERT no
   Supabase), e o ACK é casado por `requestId`/`socket-option-opened`. O drift é registrado por
   `entryDriftMs = ackedAt - targetEntryAt`.

Ou seja: **o sistema já observa até `targetEntryAt - 1.3 s` (T−61.3 s da expiração)**. O ponto do usuário
não era o candidato nascer cedo (isso é correto), mas sim que **`targetEntryAt` é uma fronteira de 60 s e o
candidato compromete a expiração cerca de 30 s antes do limite real de compra daquela expiração**.

### Reconstrução quantitativa (72 h até 2026-09-18T23:40Z, 51 operações JIT)

Fonte: `docs/research/data/entry-timing-reconstruction.json` (gerado por `scripts/entry-timing-audit.mjs`,
read-only). Métricas em ms:

| Métrica | n | p50 | p90 | p95 | p99 | min | max |
|---|---:|---:|---:|---:|---:|---:|---:|
| `ackMs` (send→ACK, `meta.ackMs`) | 38 | 1245 | 1393 | 1798 | 1876 | 364 | 1876 |
| `decisionToSubmit` (revalidação→submit) | 51 | 1 | 3 | 5 | 7 | 0 | 7 |
| `submitToRequest` (submit→INSERT `requested_at`) | 51 | 1092 | 1177 | 1222 | 1255 | 208 | 1255 |
| `entryDriftMs` (ACK−fronteira) | 38 | −474 | +304 | +386 | +567 | −1529 | +567 |
| `msBeforeCutoffAtEntry` (corte real−entrada efetiva) | 38 | 30473 | 31245 | 31353 | 31529 | 29433 | 31529 |
| `unusedObservationMs` (corte real−submit) | 51 | 31790 | 31828 | 31989 | 31997 | 30874 | 31997 |

Leitura:
- Entrávamos com mediana de **30,5 s de antecedência** do limite real de compra da expiração e deixávamos
  ~**31,8 s** de mercado observável sem uso (≈ 6 candles de 5 s).
- O ACK mediano é **1,2 s** (p95 1,8 s) e há ~**1,1 s** de persistência DB **antes** do `placeOrder`; por
  isso o drift às vezes fica positivo (ACK depois da fronteira) — o envio efetivo do broker ocorre antes,
  mas o drift medido é conservador.
- Em 30 dias: **51 candidatos viraram ordem**; **8.797** cancelaram por `CANDIDATE_LOGIC_CHANGED_TO_WAIT`,
  **958** por `VALID_SETUP_BUT_BAD_ENTRY_PRICE`, **135** por `QUALITY_SCORE_BELOW_THRESHOLD`, **50** por
  inversão de direção (`CANDIDATE_LOGIC_CHANGED_DIRECTION`) — ou seja, a reavaliação contínua **já cancela
  muita coisa nos segundos finais**; o LATE_WINDOW_V2 estende essa janela de cancelamento em ~30 s.

---

## FASE 2 — Identificação da operação EURUSD:OTC de 18/09/2026 ~19:34–19:35

**Identificada com prova explícita** (`entry-timing-reconstruction.json → target`):

| Campo | Valor |
|---|---|
| `execution_id` | `exec_1789770838656_a9hjsa` |
| `broker_order_id` | `14274528990` |
| mercado | `EURUSD:OTC` (EUR/USD OTC, active_id 76) |
| direção | `PUT` (SELL) |
| stake | R$ 10 (PRACTICE, `stakeSource=MARKET_CONFIGURED`) |
| expiração | 2026-09-18 **22:35:00Z** = **19:35:00 BRT (−03:00)** |
| abertura efetiva (ACK) | 22:33:59.226Z = 19:33:59.226 BRT |
| preço de entrada | 1.143355 (print ≈1.14329 → diferença de 0,65 pipette; consistente com o preço exibido no clique) |
| resultado | **WIN** (+8.8) |

Prova: mercado, direção PUT, stake 10, expiração local `19:35:00-03:00`, `entryPrice` a 0,000065 do valor
informado e `broker_order_id` único — todos batem. **Não foi necessário forçar associação.**

Timeline da operação (server clock):

| Evento | Horário (BRT) | Δ |
|---|---|---|
| `CANDIDATE_CREATED` (`cand_EURUSD_OTC_1789770840000`) | 19:32:59.415 | — |
| 17 `CANDIDATE_UPDATED` (avaliações ~1/s; inclui WAITs intermediários) | 19:33:00 → 19:33:56 | 59,2 s |
| `FINAL_REVALIDATION` ok (regras A–G; score 83; location OK; sem microVeto) | 19:33:58.654 | lead 1.347 s |
| `ORDER_SENT` (INSERT `REQUESTED`) | 19:33:59.030 | +0,374 s |
| `BROKER_ACK` (`socket-option-opened`) | 19:33:59.226 | +0,196 s (ack 570 ms) |
| `targetEntryAt` (fronteira) | 19:34:00.000 | drift **−774 ms** |
| **limite real de compra desta expiração** | **19:34:30.000 (exclusivo)** | entramos **30,77 s** antes |
| expiração (solicitada = aceita) | 19:35:00.000 | turbo 1 m |
| `SETTLEMENT` WIN | 19:35:00.687 | |

A operação era válida e venceu; o que se perdeu foi a chance de continuar observando até 19:34:29 para
invalidar antes de comprar (e ainda assim manter exatamente a expiração 19:35:00).

---

## FASE 3 — Semântica real da IQ (entrada/cutoff/expiração)

`relay/iqoption-ws.mjs::computeExpiration(serverSec, durationMinutes)` (referência declarada
`iqoptionapi/expiration.py`) é a regra usada em produção. Para **turbo 1 m**:

- candidatos turbo: `expDateSec = (nextMinute - now > 30 s) ? nextMinute : nextMinute + 60 s`; escolhe-se o
  candidato mais próximo de `now + 60 s`;
- logo, a **mesma expiração `E`** é selecionada quando `E − 90 s ≤ S < E − 30 s`; o instante `E − 30 s` é
  **exclusivo** (a partir dele a IQ passa para `E + 60 s`).
- `optionKind = turbo` para horizonte de 1 min; `binary`/`digital` não são usados pelo runtime no horizonte
  1 m e ficam **fora do escopo** do LATE_WINDOW_V2 (documentado; a regra de quarto de hora do arquivo de
  referência só entra para durações maiores).

Verificação com a função real (casos de fronteira em `entry-timing-reconstruction.json`):

| S | expiração retornada |
|---|---|
| `E − 90,000 s` | `E` |
| `E − 90,001 s` | `E − 60 s` |
| `E − 30,001 s` | `E` |
| `E − 30,000 s` | `E + 60 s` |

Confirmado em **100% das 51 operações** dos últimos 30 dias: `computeExpiration` no deadline preservaria a
mesma expiração (`allJitSameExpiryJustBeforeCutoff = true`) e **fliparia** em `E − 30 s`
(`allJitFlippedAtCutoff = true`). A expiração solicitada **nunca** divergiu da registrada no broker
(`expirationRequestedEqualsAccepted = true` em todas; fail-closed em `ENTRY_EXPIRATION_MISMATCH`).

### Latência real e margem adaptativa

A margem do LATE_WINDOW_V2 é derivada de dados, não arbitrada:

```
margem = p95(ACK) + p95(persistência DB) + p95(decisão→submit) + 300 ms (jitter) + 500 ms (guarda de relógio)
        clampada em [1000 ms, 5000 ms]
```

Com a distribuição atual (`ack p95 = 1798`, `persist p95 = 1222`, `decision p95 = 5`) → **margem ≈ 3.825 ms**
(observação adicional esperada ≈ 26 s). Se a latência cair, a margem cai (piso 1 s); se piorar, sobe
(teto 5 s). As amostras são as reais do runtime (`ctx.latency.orderAck`, `ctx.latency.dbPersist` novo,
`ctx.latency.decisionToSubmit` novo).

### Relógio

Decisões críticas usam `client.serverNow()` (`serverTimeMs` do `timeSync` + decorrido local), validado por
`validateServerTime`. Não há re-sync periódico do offset (só heartbeat de sessão), então o risco de offset
residual/drift é absorvido pela **guarda de relógio de 500 ms** na margem. O LATE_WINDOW_V2 nunca usa
`Date.now()` para decidir deadline: usa o server clock (mesma fonte do CURRENT_V1).

---

## FASE 4 — Política nova (LATE_WINDOW_V2) em SHADOW

### Desenho

- `CURRENT_V1` (produção, intocado): candidato → revalida em `targetEntryAt − lead` → ordem com expiração
  `targetEntryAt + 60 s` (entra ~E−60,5 s).
- `LATE_WINDOW_V2` (SHADOW): a oportunidade é **reavaliada continuamente** (ticks, candles 5 s, features,
  microestrutura, localização, Trader, Critic, Consensus e Quality Gate — **as mesmas funções/pesos/limiar**)
  até `lateDeadlineAt = (E − 30 s) − margem adaptativa`, com o **mesmo** `targetExpiryAt` do candidato.
  - Continua válida → o braço LATE **teria entrado** (registro `LATE_ACCEPT`) no deadline, expiração `E`.
  - Piorou/deixou de cumprir as regras atuais → `LATE_CANCEL` com motivo (WAIT, direção invertida, regime,
    setup, trigger, critic, consensus, stale, location, microVeto, score < 75). **CALL inválida morre; não
    vira PUT.** Direção contrária só nasce de um candidato novo pelo pipeline completo.
  - Veredito = **última avaliação em/antes do deadline**; avaliações posteriores são diagnósticas
    (`afterDeadline = true`) e **nunca** mudam o veredito.
- Expiração: invariante `sameExpirationAtDeadline` (com `computeExpiration` real) e fail-closed conceitual —
  se a margem estourasse a janela, o registro marca `keptSameExpiration = false` como inconsistência.
- Execução: `LATE_WINDOW_POLICY.execution = "SHADOW_ONLY"`, `controlsExecution/controlsDirection/
  controlsStake = false`, `brokerAutomation = NONE`. **Nenhuma ordem é enviada pela política nova.**

### Observação (nunca mistura com o Prospective Shadow Lab)

- Tabela própria `iq_timing_policy_observations` (migration 030) com `timing_policy_version` (`LATE_WINDOW_V2`)
  e `current_policy_version` (`CURRENT_V1`) por linha; T0 congelado por trigger (`t0`, `policy.window`,
  `policy.deadlineAt`, identidade — imutáveis).
- `t0` congelado no `begin`; observações seguintes ficam em `late_policy`/`comparison`/`evaluations`.
- `settleCausal` liquida o braço LATE pelo **candle causal** (entrada no deadline, saída no candle ≥ E) com
  `settlementBasis = CAUSAL_COUNTERFACTUAL`; o resultado do broker fica em `iq_executions`/`iq_trade_journal`.
- Comparação registrada por oportunidade: quando entraríamos hoje, até quando poderíamos observar, quando a
  nova entraria, tempo adicional observado, candles 5 s adicionais, ticks adicionais, se continuou válida,
  se virou WAIT, se o Critic/Consensus mudou, se o Gate mudou, se a localização piorou, se degradou
  (score delta), transições de validade e `keptSameExpiration`.
- Observabilidade extra na perna CURRENT (metadado, sem mudar decisão): a expiração **realmente aceita**
  (`socket-option-opened`/`option.expired`) passa a ser persistida (`meta.brokerExpirationSec`); divergência
  gera `BROKER_EXPIRATION_MISMATCH` em audit + log + evento — **a operação nunca cai silenciosamente na
  próxima expiração**.
- Endpoint: `GET /api/iq/research/timing-policy` (admin) → status, margem atual, mercados observando, sumário.
- Retenção: `TIMING_POLICY_RETENTION_HOURS` (default 168 h) em `scripts/db-retention.mjs`.

### O que é medido (por oportunidade)

`docs/research/data/timing-policy-shadow-report.json` traz, além do agregado: veredito LATE para margens
alternativas (1–5 s) derivado da trilha de avaliações (para análise offline de risco × observação),
contagem de `LATE_ACCEPT`/`LATE_CANCEL` por motivo, `additionalObservedMs/Candles/Ticks`, transições,
`becameInvalid`/`recovered`, `criticChanged`, `gateChanged`, `locationChanged`, `degraded`,
`keptSameExpirationViolations`, liquidação causal e o join com o resultado do broker (CURRENT).

---

## FASE 5 — Testes fortes e anti-leakage

`tests/ai/late-window-timing.test.ts` (28 testes, verdes):

- **Semântica**: janela [E−90 s, E−30 s), fronteiras exatas, concordância com `computeExpiration` real,
  produto fora de escopo, deadline = cutoff − margem.
- **Margem**: fallbacks limitados; latência rápida ⇒ margem menor; lenta/instável ⇒ maior (clamp 1–5 s).
- **Veredito**: revalidação A–G + Gate com os mesmos pesos; WAIT/direção/critic/consensus/setup/trigger/
  regime/stale/location/micro/score; nunca inverte direção.
- **Ciclo de vida**: T0 congelado; deadline; `LATE_ACCEPT`/`LATE_CANCEL`; `afterDeadline` ignorado;
  transições (`becameInvalid`/`recovered`); liquidação causal (`WIN` em SELL com preço abaixo da entrada).
- **Anti-leakage**: T0 imutável após observações; `findFutureReferences` acusa timestamp futuro (ignorando
  apenas alvos agendados como `targetEntryAt/targetExpiryAt/currentSubmitAt`); veredito não muda por
  avaliação pós-deadline.
- **Isolamento**: `EURUSD:OTC` × `EURUSD:NORMAL` independentes; finalizar um não toca o outro.
- **Reinício**: `toJSON/loadFrom` preserva associação por `candidateId`; `markCurrentAck` pós-restart.
- **Persistência**: `INSERT` antes de `UPDATE` (serialização) e placeholders SQL 1:1.
- **Runtime**: cria a observação no candidato sem ordem extra; continua observando após CURRENT enviar/ACK;
  finaliza no deadline; vira `LATE_CANCEL` quando WAIT; expiração divergente da aceita gera inconsistência
  explícita; módulos de decisão não importam a política nova.

Cenários cobertos por construção + testes: latência normal/alta/jitter (margem), clock (server clock,
guarda de relógio), candle chegando antes da entrada (avaliação contínua), candidato deixando de ser válido
(WAIT/gate), reconexão (`stop`/WS_DISCONNECTED finalizam a janela), expiração quase fechando (deadline ×
cutoff), risco de próxima expiração (checagem com `computeExpiration`), isolamento entre ativos e
NORMAL×OTC, reinício.

Prova de zero alteração estratégica: `sha256` dos módulos de decisão em `docs/research/data/entry-timing-hashes.json`
(antes/depois) — `professional-brain.mjs`, `trade-quality.mjs`, `entry-timing.mjs`, `portfolio-gate.mjs`,
`frozen-strategies.mjs`, `research-engine.mjs`, `market-universe.mjs`, `price-structure.mjs`,
`feature-engine.mjs`, `iqoption-connector.mjs` **idênticos**.

---

## Achados da coleta (bugs encontrados e corrigidos antes do resultado final)

A coleta prospectiva existe para confrontar o desenho com a operação real. Dois defeitos foram descobertos
ao inspecionar os primeiros registros e corrigidos com teste de regressão (nenhum toca decisão/execução):

1. **Janelas consecutivas se supersediam antes do deadline.** O observador mantinha 1 janela por mercado;
   ao nascer o candidato da expiração seguinte (~E−61 s), a janela anterior (deadline E−30 s−margem) era
   fechada cedo, truncando ~26 s de observação. Corrigido: chaveamento por `windowKey` (mercado+expiração),
   com múltiplas janelas ativas por mercado e supersede apenas da **mesma** expiração.
   Teste: “janelas consecutivas coexistem; so a MESMA expiracao e supersedida por candidato novo”.
2. **Finalizar uma janela fechava todas as do mercado.** O `observe` que atingia o deadline chamava o
   finalizador por `marketKey`, fechando também a janela seguinte (recém-criada) com veredito prematuro.
   Corrigido: finalização por `candidateId`/`windowKey`; `marketKey` só é usado em parada/reconexão
   (encerramento deliberado de todas as janelas). Interrupções antes do deadline passam a ser registradas
   como `SUPERSEDED_BY_NEW_CANDIDATE`/`SESSION_LOST`/`WS_DISCONNECTED` — nunca como ACCEPT/CANCEL.
   Teste: “deadline de uma janela NAO finaliza a janela seguinte do mesmo mercado”.

O piloto anterior às correções (≈00:08–00:28Z) permanece na tabela para auditoria, mas o relatório final é
gerado com `--since` posterior ao deploy da versão corrigida (dados limpos).

## Resultados CURRENT × LATE_WINDOW_V2 em SHADOW

Coleta prospectiva da versão corrigida: **2026-09-19 00:28Z → ~01:00Z** (deploy `e771fd9e`), 30 mercados,
fonte `docs/research/data/timing-policy-shadow-report.json` (`--since 2026-09-19T00:28:00Z`).

| Métrica | Resultado |
|---|---|
| Observações | **245** (239 finalizadas, 6 em observação; 0 stale) |
| `LATE_ACCEPT` | **4** (1,7%) — continuava válida no deadline |
| `LATE_CANCEL` | **235** (98,3%) — inválida no deadline |
| Virou `WAIT` no período extra | **224** (93,7%) |
| Direção invertida | **0** (direção antiga morre; nunca vira PUT) |
| Critic mudou | 203 / 239 |
| Localização mudou | 117 / 239 |
| Degradação de score | 234 / 239 |
| Ficou inválida e voltou a válida | 119 / 91 |
| Expiração preservada no deadline | **100%** (`keptSameExpirationViolations = 0`) |
| Mismatch de expiração aceita | **0** |
| Tempo adicional observado | **+28,35 s** por oportunidade (vs submit atual) |
| Candles de 5 s adicionais | **6** (constante) |
| Preços de tick adicionais | p50 **19**, p95 **25** |
| Braço LATE liquidado causalmente | 4 (2 WIN / 2 LOSS; PnL normalizado −0,31 — n insuficiente) |
| CURRENT executado na janela | 0 (comparação vs `submitAt` planejado; o join com resultado do broker fica registrado no relatório quando houver execução) |

Análise de margem (offline, mesma trilha de avaliações): com margens de 1 s a 5 s o LATE teria aceitado
2–4 de 245 oportunidades (tempo adicional médio de 26,5–30,5 s). A margem em produção ficou no fallback de
3.150 ms porque **nenhuma ordem CURRENT executou na janela** (sem ACKs novos para calibrar); a fórmula
adaptativa é a mesma testada e passa a calibrar com os ACKs reais assim que o CURRENT executar.

**Leitura honesta:** a janela extra de ~28 s faria a política NOVA **cancelar ~94% do que a política atual
aceita**, sem nenhum flip de direção e mantendo a expiração. Isso não é evidência de melhoria de resultado —
é evidência de que existe muito mais invalidação observável depois do momento em que o CURRENT decide.
A amostra de `LATE_ACCEPT` (4) é insuficiente para qualquer conclusão de edge. **Não há evidência para
PRACTICE; a política permanece SHADOW** até o checkpoint prospectivo (referência do lab: N=30; aqui o
checkpoint relevante é de `LATE_ACCEPT` liquidados, ainda em 4).


---

## Respostas objetivas (1–18)

1. **Como o timing funcionava antes**: candidato na 1ª fronteira de 60 s elegível; reavaliação contínua a
   cada ~1 s; decisão final em `targetEntryAt − lead (1,0–2,0 s)`; revalidação A–G + Quality Gate; ordem com
   expiração `targetEntryAt + 60 s`; fail-closed se a expiração não bater.
2. **Quantos s/ms antes do limite**: envio mediano **30,47 s** antes do limite real de compra da expiração
   (p95 31,35 s); submit ~31,8 s antes (`unusedObservationMs`).
3. **Operação EURUSD:OTC do print**: **identificada** — `exec_1789770838656_a9hjsa` / broker `14274528990`,
   PUT, R$10, expiração 19:35 BRT, entrada 1.143355, WIN +8.8; entrou 30,77 s antes do limite real; ver
   timeline acima.
4. **Semântica IQ**: turbo 1 m aceita a mesma expiração `E` para `S ∈ [E−90 s, E−30 s)`; `E−30 s` é
   exclusivo e joga para `E+60 s`; `computeExpiration` real confirma; 100% das 51 ordens com expiração
   solicitada = aceita.
5. **Distribuição de latência**: ACK p50 1.245 / p95 1.798 ms; persistência DB pré-envio p50 1.092 /
   p95 1.222 ms; decisão→submit p50 1 ms; drift p50 −474 ms.
6. **Tempo não aproveitado**: mediana **31,8 s** (≈6 candles de 5 s; p95 32,0 s).
7. **Nova lógica**: `LATE_WINDOW_V2` puro + observador SHADOW; reavalia até `E−30 s−margem`; aceita/cancela
   com as regras atuais; mesma expiração ou nada; nunca inverte direção; nunca envia ordem.
8. **Tempo adicional**: **+28,35 s** medidos prospetivamente (margem 3.150 ms = fallback; a margem adaptativa
   reduz para ~1 s ou cresce até 5 s conforme o ACK/persistência reais).
9. **Candles/ticks adicionais**: **6 candles de 5 s** e p50 **19** / p95 **25** preços de tick por
   oportunidade (245 observações, 30 mercados).
10. **Virou WAIT nesse tempo**: **sim** — 224 de 239 janelas finalizadas (93,7%) ficaram inválidas/WAIT no
    deadline; 0 inversões de direção.
11. **Esperar coloca a expiração em risco?** Sim, se passar de `E−30 s`; a margem adaptativa + verificação
    com `computeExpiration` + fail-closed eliminam o risco de cair na próxima expiração.
12. **Tratamento do risco**: deadline = cutoff − (p95ACK+p95persist+p95decision+300+500), clamp 1–5 s;
    `keptSameExpiration` auditado (0 violações em 239); qualquer divergência de expiração aceita vira
    `BROKER_EXPIRATION_MISMATCH`.
13. **Mismatch de expiração**: 0 observado (solicitada = aceita em 100% das 51 ordens históricas e 0 nas
    janelas SHADOW); o runtime agora persiste a expiração aceita e audita divergências.
14. **CURRENT × NOVA em SHADOW**: 239 janelas → 4 `LATE_ACCEPT` (2 WIN/2 LOSS causal, n insuficiente) vs
    235 `LATE_CANCEL`; +28,35 s e 6 candles observados; 100% mesma expiração. Detalhes na seção de resultados.
15. **Evidência para PRACTICE?** **Não.** Continua **SHADOW**; sem edge demonstrado e com n=4 no braço que
    aceita, não há base para promover.
16. **Testes**: 30 novos verdes; `tests/ai` 781 verdes; suíte completa 1.618 verdes + 3 skip; `tsc` limpo.
17. **Commits**: ver histórico (`feat(entry-timing): LATE_WINDOW_V2 em SHADOW ...`).
18. **Pendências reais**: (a) acumular `LATE_ACCEPT` liquidados até checkpoint prospectivo para decidir
    qualquer promoção; (b) coletar ACKs CURRENT para a margem adaptativa sair do fallback; (c) validar em
    produção o instante aceito pelo broker em ordens perto do cutoff (a política nova não envia ordem);
    (d) re-sync periódico do offset de relógio; (e) escopo binary/digital fora de 1 m; (f) revisar retenção
    e métricas após primeiros dias.
