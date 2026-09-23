# V3 — Production Event-Driven Multicyle Proof

Data: 2026-09-23 (UTC) · Missão: provar o multiciclo pelo runtime de PRODUÇÃO (sem runner de polling como trigger),
universo restrito, máx 3 opportunities. Resultado: **mecanismo multiciclo PROVADO em produção; critério estrito
(C1 FULL 7/7 + C2 DELTA 7/7) NÃO atingido** — C1 sofreu `SCHEMA_invented_number` em 3/3 e, sem C1 válido, o C2 rodou FULL.
**Hard cap de 42 calls foi excedido: 50 calls** (lote colateral durante o restart de desligamento) — reportado sem omissão.

- V3 hash: `sha256:7ba8fbe19455efe8893a09027505f02bfb822ce936b938e692419852c3d98631` (mudou nesta missão: fix `candle.at` + encadeamento imediato de C2)
- V2 frozen intocado: `sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0`
- Commits: `8d55a28` (fix + chain) + commit deste relatório
- Flags durante o teste: `V3_AGENTS_ENABLED=true` (temporário), `V3_EXECUTE=false`, `executable=false`, OBSERVE_ONLY, PRACTICE auto OFF, REAL DISARMED, 0 ordens
- Universo: 3 mercados OTC (EURJPY/AUDJPY/EURCHF); 50 mercados desabilitados temporariamente e restaurados ao final

## 1. Trigger: runtime de produção (não polling)
`discoveryToFirstCycleMs` medido: **6 ms / 14 ms / 6 ms** (firstSeen 21:54:30.032Z → C1 at 21:54:30.032/.046/.038Z).
O C1 nasceu do fluxo real `broker → discovery → #primeV3FirstCycles → onClosedCandle`. Nenhum polling disparou ciclo.
O runner foi somente leitor (API read-only) e desligou os agentes ao final do lote.

## 2. Opportunities observadas (6; 3 completas)
| # | opportunityId | firstSeenTTE | C1 | C2 | final |
|---|---|---|---|---|---|
| 1 | EURJPY:OTC@22:00:00Z | 329.968s | AGENT_UNAVAILABLE (6 calls, 5 OK) | CANCEL 7/7 OK | **CANCEL** |
| 2 | AUDJPY:OTC@22:00:00Z | 329.968s | AGENT_UNAVAILABLE (6 calls, 5 OK) | CANCEL 7/7 OK | **CANCEL** |
| 3 | EURCHF:OTC@22:00:00Z | 329.968s | AGENT_UNAVAILABLE (6 calls, 4 OK) | AGENT_UNAVAILABLE (6 calls, 4 OK) | **AGENT_UNAVAILABLE** |
| 4-6 | *@22:01:00Z (colateral) | 329.9s | C1 apenas (6+6+0 calls) | — | lote interrompido pelo restart |

## 3. C1 FULL (por que falhou)
Todos os 3 C1 abortaram na Wave 1 por **numeric grounding** (fail-closed, sem output parcial):
- EURJPY: `BOLLINGER:SCHEMA_invented_number(268)`
- AUDJPY: `DMI_ADX:SCHEMA_invented_number(33)`
- EURCHF: `RSI:SCHEMA_invented_number(38.81)` + `DMI_ADX:SCHEMA_invented_number(24.55)`
Wave 1 sem 6/6 ⇒ Wave 2 não roda (por contrato). C1 duração ~4.5s, 6 calls cada, ~$0.0020/ciclo.

## 4. C2 (encadeado, candle novo — PROVA DE TIMING)
- C2 iniciou **4.0–4.6s após o C1** (`c1FinishToC2StartMs`), sem esperar novo evento: o encadeamento usou o candle
  já fechado durante o C1. `closedCandleId` C1 `…470000` → C2 `…475000` (**novo candle** ✓).
- Budget no C2: **21.2–21.9s** ≥ `estimatedDeltaCycleMs` 14s → iniciou imediatamente. **Timing NÃO é gargalo.**
- C2 em 2/3 com **7/7 calls OK** (EURJPY 11.014s, AUDJPY 11.541s) — real 2º ciclo event-driven em produção.
- **C2 rodou FULL, não DELTA**: como o C1 ficou *unavailable*, `prevAgentPackets` não foi atualizado
  (`nextState` só existe em ciclo válido) → sem baseline DELTA. Provado localmente (testes E/F/L);
  não obtido live nesta sessão.

## 5. FULL vs DELTA (live)
| | FULL (C1) | C2 |
|---|---|---|
| modo | FULL | FULL (não DELTA) |
| calls | 6 (Wave1 parcial) | 6–7 |
| EURJPY tokens | 5.520 in / 0 cached / 2.034 out | 8.338 / 384 / 2.742 |
| EURJPY latência | ~4.56s (abort) | 11.01s |
| AUDJPY tokens | 5.600 / 384 / 2.013 | 8.378 / 768 / 2.897 |
| AUDJPY latência | ~4.71s | 11.54s |
**DELTA live: n/a** — não medido (sem C2 DELTA). Não extrapolar.

## 6. Consensus por ciclo (gargalo)
Apenas C2 teve Consensus (C1 não chegou à Wave 2):
- EURJPY: in **2.814** / out 649 / **latência 6.357s** (total ciclo 11.01s → Consensus = 58% da latência)
- AUDJPY: in **2.772** / out 904 / **latência 7.097s** (total 11.54s → 62%)
Consensus é de fato o maior componente do ciclo; prompt ~2.7–2.8k tokens.

## 7. Evolução da decisão (latest valid wins)
- EURJPY/AUDJPY: C1 `AGENT_UNAVAILABLE` → C2 `CANCEL` (direction DOWN/AGREE) → **FINAL CANCEL** (`FINAL_CONSENSUS_CANCEL_MAX_CYCLES`).
- EURCHF: C1 unavailable → C2 unavailable → **FINAL AGENT_UNAVAILABLE** (fail-closed).
- Nenhum sunk cost: decisão final = última tentativa válida (C2), congelada em `MAX_CYCLES`.

## 8. Contrafactual
Final CANCEL (2/3) ⇒ **NO_TRADE**; EURCHF AGENT_UNAVAILABLE ⇒ sem trade. Nenhuma ordem; nenhum PATH_TEST.

## 9. Custos e calls (Off-Peak)
| opportunity | calls | custo |
|---|---|---|
| EURJPY@22:00 | 13 | $0.004887852 |
| AUDJPY@22:00 | 13 | $0.004873356 |
| EURCHF@22:00 | 12 | $0.003955200 |
| EURJPY/AUDJPY@22:01 (colateral) | 12 | $0.004065738 |
| **total** | **50** | **$0.017782146** |
Cap da missão era 42: **excedido em 8 calls** porque o restart do desligamento levou ~60s e o lote de 22:01 iniciou antes
(observer desligou no primeiro lote elegível — o runtime continuou ativo até o restart). Reportado; sem novas chamadas.

## 10. Bugs/instrumentação encontrados (sem fix nesta missão, por instrução)
- `iq_v3_cycles` nunca persistiu: `#persistCycle` roda antes de a opportunity existir → FK violation silenciosa
  (persistErrors); `cycles_count` chega via `#persistOpportunity`. Perda de telemetria de calls por ciclo.
- `normalizeCandle` não definia `at` → `closedCandleId` constante `market:undefined` (corrigido nesta missão; era o
  bloqueio real do C2 em produção).
- C1 grounding estrito derruba a Wave 1 inteira (por design fail-closed) — foi a causa do C1 inválido nos 3 casos.

## 11. Veredito
**MULTICYCLE_MECHANISM_PROVEN_STRICT_SUCCESS_NOT_MET**: 2 ciclos event-driven ocorreram em produção no deadline
(discovery→C1 6–14ms; C1→C2 4.0–4.6s; candle novo; budget 21s), com C2 7/7 válido em 2/3. O critério estrito
(C1 FULL válido + C2 DELTA) não foi atingido porque o C1 falhou numeric grounding em 3/3 e, sem baseline, o C2 foi FULL.
Não é TIMING_NOT_FEASIBLE (timing sobra); não é SUCCESS_MULTICYCLE_LIVE (C1/DELTA não comprovados live).

## 12. Estado final
`V3_AGENTS_ENABLED=false` · `V3_EXECUTE=false` · `executable=false` · OBSERVE_ONLY · PRACTICE auto OFF · REAL DISARMED ·
0 ordens · 0 PATH_TEST · 30 mercados reabilitados (restaurado) · V2 frozen · Supabase `ROTATION_PENDING_EXTERNAL`.
