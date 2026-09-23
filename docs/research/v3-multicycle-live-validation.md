# V3 — Multi-Cycle Liveness + Reversible Pre-Send Decision (validação live)

Data: 2026-09-23 (UTC) · Missão: permitir múltiplos ciclos LLM por opportunity (máx 2: FULL+DELTA),
primeiro ciclo o mais cedo possível, deadline explícito de 2s e decisão pré-send REVERSÍVEL (NO SUNK COST).
Auditoria live: **2 oportunidades reais, C1 executado em ambas; C2 não coube → TIMING_NOT_FEASIBLE** (medido, não escondido).

- V3 hash: `sha256:04a7936741e12b7e9d1c7e940149d5fce5a9dcaacd541da532c602354dfcec9d` → **`sha256:fecef3cacfe53c0e284c1d7825127cfa118117bb71ea7625f25b1e63d215c7d4`**
- V2 frozen intocado: `sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0`
- Commits: `6bd9b57` (código multiciclo) + commit deste relatório
- Provider calls: **14/28** (C1 ×2 ×7) · 0 ordens · 0 PATH_TEST · OBSERVE_ONLY
- Preço oficial OpenCode Go reconsultado (`https://opencode.ai/docs/go`): Off-Peak in $0.15/1M · cached $0.003/1M · out $0.60/1M; Peak $0.30/$0.006/$1.20 (ambos os testes Off-Peak)

## 1. Causa do single-cycle prático anterior
`agentSafetyMarginMs=8000` + `estimatedWaveMs=12000` + primeiro ciclo só no candle seguinte ao discovery.
Budget = TTE − 302s − 8s; após um ciclo (~11–13s) o restante ficava < 12s → todo C2 era pulado.
Além disso o engine protegia FINAL_REVIEW/APPROVED contra downgrade (sunk cost).

## 2. Correções de scheduling/lifecycle (sem mudar lógica de mercado)
- **Primeiro ciclo imediato**: `#primeV3FirstCycles` (relay) dispara o C1 no discovery com candles FECHADOS já disponíveis (nunca em formação; dedupe por `closedCandleId`).
- **Max 2 ciclos** (`maxAgentCycles=2`): C1 FULL, C2 DELTA. Guardas `cyclesSkippedMaxCycles`/`cyclesSkippedOverlap` (ciclos serializados por mercado).
- **Deadline explícito**: `analysisMustFinishBy = targetSendAt − analysisSafetyMarginMs` (default **2000ms**); C2 só inicia se `remaining ≥ estimate` (`estimatedFullCycleMs=15000`, `estimatedDeltaCycleMs=14000`; env `V3_AGENT_ESTIMATED_FULL_MS`/`_DELTA_MS`). Telemetria por ciclo: `remainingBudgetAtCycleStart`, `estimatedCycleLatency`, `actualCycleLatency`, `deadlineAbort`.
- **Tentative × Final**: `tentativeDecision` + `decisionHistory` por ciclo; freeze pre-send (`finalizeOpportunity`) converte a **última tentativa válida** em `finalDecision` (snapshot final imutável) quando não há mais ciclo viável.
- **Scheduler reversível**: intent tentativo é cancelado/substituído (schedule replace / `cancel(FINAL_CONSENSUS_CANCEL)`); nunca fica BUY stale após CANCEL/SELL. Código nunca escolhe direção (canonical = Consensus).
- Regras: C1 `NO_SETUP` encerra (sem C2); WAIT/candidatos/APPROVE podem ir ao C2; C2 exige `closedCandleId` NOVO e FactPackets DELTA.

## 3. Testes (todos verdes)
`tests/v3`+`tests/observability`: **114/114** · security **72/72** · v3-smoke **14/14** · run-all-tests **25/25** · build OK.
Cobertura A–K em `tests/v3/multicycle.test.ts`: A) C1 BUY+C2 CANCEL→CANCEL; B) C1 BUY+C2 SELL→SELL/DOWN; C) C1 CANCEL/WAIT+C2 BUY→BUY/UP; D) NO_SETUP sem C2; E) candle novo; F) DELTA; G) scheduler cancel/replace; H) snapshot final = última decisão; I) sem orçamento não inicia LLM; J) deadline abortado fail-closed; K) V2 frozen.

## 4. LIVE — TESTE 1 (`EURJPY:OTC@2026-09-23T21:26:00Z`)
- firstSeen 21:20:30.128Z (TTE 330.0s) · C1 start 21:20:35.040Z (TTE **324.96s**) · detection latency do runner **4.912s** (artefato de polling; em prod o prime é imediato)
- closedCandleId `EURJPY:OTC:…435000` · mode **FULL** · Asset `FAILED_BREAKOUT`/DOWN/WAIT · Consensus **CANCEL**/NONE/PARTIAL (evidências conflitantes; squeeze sem direção) · Gate pass (6/6 checks)
- Latência wave1 4.433s · wave2 5.642s · total **10.079s**
- Tokens 8.271 in / 384 cached / 3.065 out / 0 reasoning · **custo $0.003023202**
- C2: **SKIP `TIMING_NOT_FEASIBLE(remaining=9.464s < est 13.5s)`** após aguardar candle novo
- Evolution `REMAINED_WAIT` → final **CANCEL** · canonical NONE
- Contrafactual: entry 180.834075 @21:21:00Z · expiration 21:26:00Z **UNRESOLVED** (feed do mercado parou ~21:23:15; sem preço comprovável) · **NO_TRADE**

## 5. LIVE — TESTE 2 (`EURJPY:OTC@2026-09-23T21:27:00Z`)
- firstSeen 21:21:30.012Z (TTE 329.99s) · C1 start 21:21:34.130Z (TTE **325.87s**) · detection **4.118s**
- closedCandleId `…495000` · mode **FULL** · Asset `BREAKOUT`/UP/WAIT · Consensus **CANCEL**/UP/AGREE (sobrecompra extrema; sem confirmação) · Gate pass
- Latência 4.939s + 7.733s = **12.673s**
- Tokens 8.471 in / 384 cached / 2.857 out · **custo $0.002928402**
- C2: **SKIP `TIMING_NOT_FEASIBLE(remaining=7.259s < est 13.5s)`**
- Evolution `REMAINED_WAIT` → final **CANCEL** · canonical NONE
- Contrafactual: entry 180.882825 @21:22:00Z · expiration 21:27:00Z **UNRESOLVED** (feed parou) · **NO_TRADE**

## 6. Análise de deadline (por que C2 não coube)
| | T1 | T2 |
|---|---|---|
| C1 latência real | 10.079s | 12.673s |
| C1 start (TTE) | 324.96s | 325.87s |
| Fim do C1 (TTE) | ~314.9s | ~313.2s |
| Espera por candle novo | ~1.5s | ~1.5s |
| remaining no C2 | 9.464s | 7.259s |
| estimate DELTA | 13.5s | 13.5s |
| decisão | SKIP | SKIP |

**Diagnóstico honesto**: TIMING_NOT_FEASIBLE nesta execução. Com o trigger de produção (latência de detecção ≈0, como `#primeV3FirstCycles`) o T1 teria started em TTE ≈329.8 e terminado ≈319.7 → remaining ≈14.7s ≥ estimate (13.5–14.0s) → **C2 teria iniciado**; T2 (12.673s) continuaria infactível. O runner gastou 4–5s de polling, portanto a prova em mercado real do C2 **NÃO foi obtida** — reportada como TIMING_NOT_FEASIBLE com medições, sem maquiagem. O suporte a C2 DELTA está provado em teste local (E/F) e fica condicionado a C1 ≤ ~11s com trigger imediato.

## 7. Custos live
| ciclo | teste | prompt | cached | output | reasoning | latência | USD |
|---|---|---|---|---|---|---|---|
| FULL | 1 | 8.271 | 384 | 3.065 | 0 | 10.079s | $0.003023202 |
| FULL | 2 | 8.471 | 384 | 2.857 | 0 | 12.673s | $0.002928402 |
| **DELTA** | — | **n/a (C2 não executado)** | — | — | — | — | — |
| **média/opportunity** | 2 | 8.371 | 384 | 2.961 | 0 | 11.376s | **$0.002975802** |

Projeções (usage-value; sem novas chamadas; base FULL médio Off-Peak):
| volume | Off-Peak | Peak (2x) | Dia útil misto |
|---|---|---|---|
| 100 ciclos | $0.2976 | $0.5952 | $0.3843 |
| 1.000 ciclos | $2.976 | $5.952 | $3.843 |
| 10.000 ciclos | $29.76 | $59.52 | $38.43 |

| taxa | 24h Off-Peak | 24h Peak | 24h misto |
|---|---|---|---|
| 1 ciclo/min | $4.285 | $8.570 | $5.534 |
| 10 ciclos/min | $42.85 | $85.70 | $55.34 |
| 30 ciclos/min | $128.55 | $257.11 | $166.02 |

## 8. Evolução das decisões (live)
T1: DISCOVERED → ANALYZING/WAIT (C1 CANCEL+WAIT) → freeze final CANCEL (NO_TRADE).
T2: DISCOVERED → WAIT (C1 CANCEL/UP+WAIT) → freeze final CANCEL (NO_TRADE).
C2/DELTA não executado em nenhuma → sem mudança de direção em produção nesta sessão.

## 9. Estado final
`V3_AGENTS_ENABLED=false` · `V3_EXECUTE` off · `executable=false` · OBSERVE_ONLY · PRACTICE auto OFF · REAL DISARMED · **0 ordens** · 0 PATH_TEST · V2 frozen · Supabase `ROTATION_PENDING_EXTERNAL`.
Critério principal: **TIMING_NOT_FEASIBLE** (não declaramos sucesso sem prova live do C2).
