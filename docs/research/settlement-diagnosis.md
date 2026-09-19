# DIAGNÓSTICO DE SETTLEMENT PROSPECTIVO (fase 29) + FIX OBSERVACIONAL

- **Escopo:** infraestrutura observacional apenas. Nenhuma estratégia, stake, direção, JIT, threshold, Brain G2,
  Execution Gate ou regra do motor congelado foi alterada. **PRACTICE ONLY, ZERO REAL.**
- **Data:** 2026-09-19 (UTC). Fonte: `iq_scenario_shadow_observations`, `iq_scenario_timing_intersections`,
  `iq_shadow_observations` (Postgres Supabase/Railway; leitura para diagnóstico).

## 1. A cadeia esperada × o que existia (FACT)

```
candidato G2 (BUY/SELL)
  └─ observacao prospectiva (target_entry_at, target_expiry_at)          [031/032 ✔]
       └─ preco na entrada  (close do candle em target_entry_at)         [não persistido ✘]
            └─ preco no expiry (close do candle em target_expiry_at)     [não persistido ✘]
                 └─ WIN/LOSS/DRAW comparando direção × (entrada, expiry)  [nunca executado ✘]
                      └─ outcome + settlement_basis                       [0 CAUSAL_COUNTERFACTUAL ✘]
```

Estado antes do fix (3.140 observações prospectivas):

| Métrica | Valor |
|---|---|
| `outcome` preenchido | **2 / 3.140 (0,06%)** — somente 2 posições BROKER_EXECUTED |
| `settlement_basis = CAUSAL_COUNTERFACTUAL` | **0** |
| Pendentes com `target_expiry_at` no passado | **3.131** (99,7%) |
| Interseções com `late_outcome = OBSERVING` / veredito `INSUFFICIENT_DATA` | **3.069 / 3.071 (99,9%)** |

## 2. Onde a cadeia quebra (FACT, com arquivo/linha)

1. **Settlement do cenário só existe para broker.** `ScenarioShadow.recordOutcome` é chamado **apenas** no
   settlement de posição real (`relay/iq-multi-runtime.mjs`, `recordOutcome(BROKER_EXECUTED)`), ou seja, para as
   2–3 ordens que existiram. Toda observação prospectiva (a maioria absoluta) nunca recebe outcome.
2. **O loop de liquidação causal não incluía o cenário.** No pipeline de candles
   (`#maybeEvaluate`, bloco por bucket) o runtime já liquidava `shadowLab.settleCausal(...)` (029) e
   `timingShadow.settleCausal(...)` (030), mas **não havia** contraparte para as observações de cenário (031/032).
   O módulo congelado `scenario-shadow.mjs` não expõe `settleCausal` — e não pode ser alterado (freeze sha256).
3. **Não havia propagação do shadow-lab para o cenário.** 307 observações de cenário têm observação do shadow-lab
   linkada por `candidate_id`; 298–307 delas **já estavam liquidadas** como `CAUSAL_COUNTERFACTUAL` pelo shadow-lab,
   mas o outcome nunca era copiado para a observação de cenário.
4. **Interseção finalizada antes do desfecho do timing.** `buildIntersection` deriva o veredito de `timing.outcome`.
   A observação LATE só sai de `OBSERVING` quando é finalizada (deadline/supersessão/quebra de sessão); como a
   interseção era registrada apenas até o cancel/avaliação do candidato, o estado final do timing nunca era
   reobservado → `lateOutcome=OBSERVING` e veredito `INSUFFICIENT_DATA` em ~100% das linhas.
5. **Sem histórico de preço para backfill total.** Os candles antigos não são persistidos por observação; o
   `iq_trade_market_windows` guarda apenas janelas PRE do shadow-lab (e POST só para trades executados), e
   `market_observations` cobre outro dataset (2026-09-14/15, EUR/USD etc.). Logo, observações **não linkadas** não
   são liquidáveis retroativamente — só prospectivamente, pelo pipeline vivo de candles.
6. **Nuance de persistência (encontrada no fix):** linhas pendentes têm `outcome = 'null'::jsonb` (JSON null), não
   `SQL NULL` (o caminho de persistência congelado serializa `null`). Qualquer predicate de idempotência precisa
   cobrir os dois casos.

## 3. Fix observacional implementado (sem tocar em estratégia/V3)

| Artefato | Natureza | O que faz |
|---|---|---|
| `relay/scenario-shadow-settlement.mjs` (**novo**) | módulo observacional puro | `settleDirectionalOutcome` (WIN/LOSS/DRAW), `causalPricesFromCandles` (entrada=close ≤ targetEntryAt; liquidação=close ≤ targetExpiryAt; pós-expiry nunca participa) e `ScenarioShadowSettlement.settleCausal` com persistência idempotente `UPDATE ... SET outcome, settlement_basis, theoretical_result, theoretical_pnl` |
| `relay/iq-multi-runtime.mjs` (aditivo) | hook no pipeline de candles | `void this.scenarioSettlement.settleCausal({ marketKey, candles, index, nowMs })` ao lado dos settlements do shadow-lab/timing; `settlement` no `scenarioShadowStatus()`; reobservação de interseções após supersessão LATE e após `finalize` de sessão |
| `scripts/scenario-shadow-settle.mjs` (**novo**) | worker de backfill (dry-run por padrão) | Liga o outcome do shadow-lab (por `candidate_id`) à observação de cenário pendente; `--apply` grava; relatório JSON de cobertura |
| `tests/ai/scenario-shadow-settlement.test.ts` (**novo, 10 testes**) | prova | direção×preço, causalidade, idempotência, bases proibidas, isolamento do freeze, hooks do runtime |

**Garantias:** sempre `settlementBasis = "CAUSAL_COUNTERFACTUAL"` e `outcome.provenance = "PROSPECTIVE_SHADOW"`;
`outcomeUsedInClassification:false`, `feedableToClassification:false`, `postWindowDiagnosticOnly:true`;
**nunca** `BROKER_EXECUTED` (o settlement do broker continua exclusivo de `recordOutcome`); nenhuma migration
necessária (colunas já existiam desde 031); nenhum sha256 do freeze foi alterado (o teste de congelamento passa).

## 4. Evidência de execução (FACT)

Backfill aplicado em 2026-09-19T09:09:51Z (`docs/research/data/scenario-shadow-settlement-backfill.json`):

| Item | Antes | Depois |
|---|---|---|
| `CAUSAL_COUNTERFACTUAL` | 0 | **307** (154 WIN · 151 LOSS · 2 DRAW — contrafactual prospectivo) |
| Pendentes | 3.131 | 2.830 (sem fonte de preço retroativa; ver §2.5) |
| `BROKER_EXECUTED` | 3 | 3 (intocados) |
| Idempotência | — | 2ª execução dry-run: `candidates=0` |

Coleta **em andamento**: a partir do deploy do relay, cada observação prospectiva liquida automaticamente no
pipeline de candles (close do candle ≥ `target_expiry_at`), com persistência idempotente.

## 5. Limitações honestas

1. **Backfill parcial (307/3.140):** as demais não têm preço de entrada/expiry persistido. Não há como reconstruir
   sem inventar dados — proibido por governança. A série prospectiva corrige a partir do deploy.
2. **`market_observations` não serve:** cobre 2026-09-14/15 e 8 ativos de outro dataset; usado apenas como
   verificação negativa.
3. **Interseção:** o fix reobserva supersessão/quebra de sessão; o veredito final por candidato depende do desfecho
   LATE (`LATE_CANCEL`/`LATE_ACCEPT`) e passa a ser atualizado. Casos ainda `OBSERVING` legítimos (janela aberta)
   permanecem.
4. **Sem tuning:** nenhuma conclusão de win-rate deve ser tirada desta amostra contrafactual (N pequeno, sem
   validação); os números servem apenas para provar que a cadeia passou a fechar.
