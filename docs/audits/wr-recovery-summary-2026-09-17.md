# WR RECOVERY — RESUMO EXECUTIVO (Fase 6.3)

> Diagnóstico somente. Nenhuma regra de trading alterada. PRACTICE only, stake congelado em R$10, zero REAL.
> Estudos completos: `docs/audits/wr-recovery-study-2026-09-17.md` · Obsidian `TraceCom/13 - Research/WR Recovery/`.

## Amostra (somente G2+JIT com T0_DECISION_SNAPSHOT + FinalEntrySnapshot)

| métrica | valor |
|---|---|
| trades decididos | **37** (17W / 20L) |
| WR observado | **45,9%** |
| break-even (payout médio 84,7) | **54,1%** |
| PnL normalizado | **−5,62** (expectancy **−0,152/trade**) |
| cobertura (executadas/candidates na janela) | ~14,7% |
| max sequência de losses | 3 |

## O que diferencia WIN de LOSS (effect size, N=37 — todos fracos)

| feature | WIN | LOSS | d |
|---|---:|---:|---:|
| RSI | menor | maior | −0,44 |
| Dist. fundo (ATR) | maior | menor | −0,31 |
| Streak micro | menor | maior | −0,30 |
| Dist. topo (ATR) | maior | menor | −0,22 |

**Sem poder discriminativo (|d|<0,2):** ADX, DI spread, ATR ratio, Donchian position, payout, evidências/contraevidências, confiança.

## Bracos SHADOW (mesma oportunidade; regras congeladas por hipótese, avaliação in-sample)

| braço | accepted | coverage | W | L | WR | PnL norm |
|---|---:|---:|---:|---:|---:|---:|
| A_G2_JIT (controle) | 37 | 100% | 17 | 20 | 46,0% | −5,62 |
| B_QUALITY_GATE | 29 | 78,4% | 14 | 15 | 48,3% | −3,19 |
| C_STABILITY | 19 | 51,3% | 8 | 11 | 42,1% | −4,22 |
| D_CRITIC | 20 | 54,0% | 8 | 12 | 40,0% | −5,22 |
| E_MICROSTRUCTURE | 12 | 32,4% | 6 | 6 | 50,0% | −0,91 |
| F_COMBINED | 3 | 8,1% | 2 | 1 | 66,7% | +0,66 |

## Critic — falha comprovada (in-sample)

20/20 losses tiveram **CONFIRM**. Evidências t0 presentes e não capturadas:
LATE_ENTRY=14 · OVEREXTENSION=14 · MICROSTRUCTURE_REVERSAL=14 · WEAK_TRIGGER=5 · LOCATION_BAD=4 · DI_CONFLICT=3 · REGIME_UNCERTAIN=2.

## Hipóteses testadas e status

- Instabilidade direcional prevê LOSS? **Não suportado** (STABLE 42,1% vs CHANGED_ONCE 50%).
- Entrada após movimento já ocorrido? **Não instrumentado nesta amostra** (displacement indisponível; corrigido: `candidatePrice` + `trajectory` agora persistidos).
- Microestrutura (E) melhora? Melhor braço, mas **N=12 → não promovível**.
- Modelo logistico: AUC 0,77 em discovery (in-sample; **não calibrado**; `estimatedWinProbability` continua null).

## Veredito prospectivo

**NÃO HÁ EVIDÊNCIA PROSPECTIVA AINDA.** Os braços B–F foram congelados nesta fase e começaram a ser registrados agora (audit `SHADOW_ARMS`). Nenhuma promoção para o pipeline PRACTICE. Próximo passo: acumular N≥30 futuros com stake fixo e reavaliar.

## Operação / ambiente

- OTC **suspenso pela IQ** na janela ~05:00–06:00 BRT (observado >40 min) → nenhuma entrada possível; sistema armado automaticamente quando reabrir.
- Monitor de saúde: OK in-sample; marca `PAUSE_NEW_ENTRIES_RECOMMENDED` apenas quando cobertura cai a ~0 (suspensão), sem alterar estratégia/stake.
- Testes: 1004 pass (11 novos). Gauntlets: Fase 6.3 **12/12**, Fase 6 **27/27**; Fase 6.2 13/14 (1 check depende de mercado aberto após restart).
