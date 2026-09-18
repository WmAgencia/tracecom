# PROSPECTIVE SHADOW LAB — observabilidade + pesquisa prospectiva (H1–H3 / D1–D5)

- **Escopo:** TraceCom relay `tracecom-live-relay` (Supabase Postgres, ref `…xzwb`). **PRACTICE only, ZERO real, stake inalterado, sem martingale, sem recuperação de loss.**
- **Regra de promoção:** **ZERO alteração estratégica em produção nesta rodada.** Toda correção que mudaria QUAIS trades executam permanece **SHADOW** (`GATE_CORRECTED_SHADOW`, filtros H1/H2/H3, degradation observer, contrafactual). Promotion Gate só depois das etapas: discovery → temporal/purged → holdout → prospective shadow → PRACTICE → promoção.
- **Baseline forense:** `docs/research/5-trade-forensic-audit.md` (D1–D5), `docs/research/hypotheses/H1..H6`.
- **Código novo:** `relay/shadow-lab.mjs` (módulo puro), migrations `relay/migrations/029_prospective_shadow_lab.sql`, endpoint `GET /api/iq/research/shadow-lab`, script `scripts/shadow-lab-report.mjs`.
- **Versão:** `prospective-shadow-lab-v1` (filtros v1 congelados em `SHADOW_FILTERS_V1`).

---

## 1. Garantias point-in-time e imutabilidade (D4)

O snapshot T0 é construído por `buildT0Snapshot()` com **whitelist de campos** e sanitização
recursiva que **remove qualquer chave de resultado/futuro** (`result`, `settlement`, `pnl`, `profit`,
`postWindow`, `future*`, `expiryClose`, `broker*`, `causal*`). O objeto retornado é congelado em
profundidade (`Object.freeze` recursivo) e persistido uma única vez.

Campos T0 persistidos (coluna `t0 jsonb`):

| Grupo | Campos |
|---|---|
| Tempos | `candidateAt`, `decisionAt`, `jitAt`, `sendAt`, `entryAt`, `targetEntryAt`, `targetExpiryAt` |
| Identidade | `marketKey`, `marketType`, `activeId`, `agentId`, `direction`, `payout` |
| Brain G2 | `regime`, `setup`, `trigger`, `structure`, `location`, `momentum`, `strength`, `volatility`, `microstructure`, `trajectory`, `freshness`, `features`, `trader`, `critic`, `consensus`, `processLog`, `knowledgeContextIds`, `knowledgeVersion` |
| Gate | `qualityScore`, `qualityChecks`, `entryLocation`, `displacement`, `jitRevalidation` |

Imutabilidade em duas camadas:
1. **Runtime:** T0 congelado em memória; apenas campos de ciclo de vida (execução/settlement) são atualizados.
2. **DB:** trigger `iq_shadow_observations_t0_immutable` rejeita qualquer `UPDATE` que altere `t0`,
   `gate_current`, `gate_corrected_shadow`, `gate_comparison`, `h3_critic`, `degradation`,
   `decision_source`, `market_key`, `candidate_at`, `decision_at`, `jit_at`.
3. **Journal:** `position.t0Snapshot` (`candidate.initialFull`) agora chega ao journal (`initialSnapshot`),
   corrigindo D4 (antes chegava `null`).

Guarda anti-leakage testável: `findFutureReferences(payload, asOfMs)` acusa qualquer timestamp
(`at`, `decisionAt`, `bucketStart`, …) posterior ao ponto de decisão — inclui o caso de features
calculadas em candle futuro.

## 2. Janela de mercado PRE/POST (D5)

- Tabela `iq_trade_market_windows` — uma linha por candle da janela, PK `(observation_id, kind, bucket_start)`.
- Semântica explícita por linha e por janela: `diagnostic_only=true`, `feedable_to_t0=false`,
  `usedInDecision=false`. O builder `buildPostWindow()` também expõe `diagnosticOnly/feedableToT0/usedInDecision`.
- **PRE:** últimos 12 candles fechados antes de `candidateAt` (point-in-time).
- **POST:** candles em T+5/10/15/20/30/45/60 s (tolerância 10 s, deduplicados por candle) + candle do expiry.
- **Nunca realimentável:** teste prova que injetar a janela POST no snapshot não altera o score do gate.
- **Retenção:** `scripts/db-retention.mjs` (`MARKET_WINDOW_RETENTION_HOURS`, default 168 h) apaga linhas antigas;
  `scripts/retention-cron.mjs` já executa o ciclo existente.

## 3. D3 — origem da decisão (`decisionSource`)

Enum: `G2_AUTO | MANUAL_UI | TEST | INFRA_PROBE | SHADOW`. Mapeamento determinístico
(`decisionSourceOf`): `AUTO_DECISION→G2_AUTO`, `ui:smoke|MANUAL|UI|API→MANUAL_UI`,
`DIAGNOSTIC_SIGNAL|SYNTHETIC_TEST|TEST→TEST`, `infraProbe|INFRA_PROBE→INFRA_PROBE`, `SHADOW→SHADOW`;
origem desconhecida/vazia cai em `MANUAL_UI` (**nunca** em `G2_AUTO`).

No `decisionSnapshot` (journal/ACK):
- `action` e `brainDecision` = decisão do **Brain** (ex.: `WAIT`);
- `manualRequestedDirection` = direção pedida pela ordem (ex.: `CALL`) quando a origem é manual/teste;
- `executedDirection` = direção executada (auditoria);
- `traderDecision` do journal deriva de `snapshot.action` (correção da verdade histórica; **não** muda execução).
- Colunas dedicadas em `iq_trade_journal`: `decision_source`, `brain_decision`, `manual_requested_direction`
  (fallback automático para payload-only se a coluna ainda não existir).

## 4. D1/D2 em SHADOW — GATE_CURRENT vs GATE_CORRECTED_SHADOW

| | GATE_CURRENT (produção) | GATE_CORRECTED_SHADOW |
|---|---|---|
| Velocidade/aceleração | `structure.velocity.*` (runtime grava em `momentum` → **sempre null**) | `momentum.velocity`/`momentum.acceleration` (fallback `structure.velocity`) |
| Knowledge | campo ausente → `knowledge_used` nunca pontua | `knowledgeContextIds` do snapshot |
| Estabilidade | `C_STABILITY` degenerado (qualquer mudança + `directionChanges>=2` impossível) | `C_STABILITY_CORRECTED`: só ação/estrutura/regime contam; preço não |
| Controle | execução real (inalterado) | **apenas observação** |

Gravação lado a lado por candidato: `currentScore`, `correctedShadowScore`, `currentDecision`,
`correctedShadowDecision`, `scoreDelta`, `checksDelta` (`compareGateVersions`). A rubrica usada é a
mesma (`scoreTradeQuality`); `relay/trade-quality.mjs` permanece **byte a byte inalterado**.

## 5. H1 — localização (SHADOW)

- `classifyLocation` grava `candidateLocation`, `jitLocation`, `entryLocation` (posição Donchian
  normalizada, distâncias a topo/fundo em ATR, canal).
- Precedência congelada (`LOCATION_RULE`): `OVEREXTENDED (against ATR > 2.5) > EDGE (pos ≤ 0.10 ou ≥ 0.90)
  > MID (|pos−0.5| ≤ 0.15) > LOWER_HALF (< 0.5) / UPPER_HALF (≥ 0.5)`.
- Filtro v1 (`SHADOW_FILTERS_V1`): `locationFilterWouldReject = tag === LOCATION_MID`. **Não bloqueia; não assume qual é melhor.**

## 6. H2 — deslocamento (SHADOW)

- `buildDisplacementShadow` grava `candidatePrice`, `jitPrice`, `actualEntryPrice`,
  `candidateToJitATR`, `jitToEntryATR`, `candidateToEntryATR` **direction-adjusted (positivo = adverso)**.
- Buckets congelados: `≤0 / 0–0.15 / 0.15–0.25 / 0.25–0.35 / 0.35–0.50 / >0.50 ATR`.
- Filtro v1: `displacementFilterWouldReject = candidateToEntryATR > 0.35`. **Não transforma >0,35 em veto.**

## 7. H3 — contradições do Critic (SHADOW)

- `contradictionSeverityShadow ∈ {NONE, SOFT, HARD, MULTIPLE}` + `contradictionCodes`,
  `contradictionCount`, `criticDecision` (verdict + independentAction) e a decisão contrafactual
  `WOULD_VETO_IF_HARD_CONTRADICTION`.
- Regra congelada: `HARD ≥ 2` **ou** (`HARD = 1` e total ≥ 3) → `MULTIPLE`; `HARD = 1` → `HARD`; só `SOFT` → `SOFT`; vazio → `NONE`.
- Mapeamento concreto (ver `CRITIC_CODE_SEVERITY`): HARD = `aceleracao_contra_a_entrada`,
  `preco_esticado_contra_a_entrada`, `conflito_di_contra_entrada`, `rompimento_sem_corpo_dominante`,
  `critic_nao_ve_trigger_independente`, `rsi_extremo_contra_entrada`, `entrada_excessivamente_estendida`,
  `compra_no_topo_do_range`, `venda_no_fundo_do_range`, `regime_chaotic|unclear`, `forca_caindo`,
  `dados_nao_frescos`, `features_indisponiveis`; SOFT = `adx_fraco_para_setup`,
  `volatilidade_spike_na_entrada`, `rompimento_ja_percorrido`, `rsi_sem_momentum_para_compra|venda`,
  `rsi_exausto_mesmo_a_favor`, `critic_ve_setup_que_trader_ignorou`, `rejeicao_no_candle_de_gatilho`,
  `rsi_extremo_contra_o_pullback`, `noticia_alto_impacto*`, `checklist_falhou:*`;
  desconhecido → SOFT (conservador; documentado).
- Objetivo prospectivo: medir `losses evitados` vs `wins descartados` por severidade.
- Critic **não** foi alterado.

## 8. Degradation Observer (experimento principal, SHADOW)

Compara **candidate T0 vs JIT** em 10 dimensões: location Donchian, RSI, ADX, ±DI, ATR ratio,
microestrutura (streak/body/wicks), displacement adverso, contradições do Critic, estrutura e
feed freshness. Estados: `STABLE / IMPROVED / DEGRADED / SEVERELY_DEGRADED` com
`degradationReasons: [...]` **decomponível** (`{impact, code, dimension, detail}`).

Regra congelada (`DEGRADATION_RULE`): ≥1 `SEVERE` ou ≥2 `DEGRADED` → `SEVERELY_DEGRADED`;
1 `DEGRADED` → `DEGRADED`; 0 degradações com ≥1 melhoria → `IMPROVED`; senão `STABLE`.
Severos: displacement adverso >0.50 ATR, contradição HARD apareceu, feed stale; degradações:
>0.35 ATR, mid, ADX caiu ≥5, DI virou contra, spike de ATR, wick de rejeição, estrutura virou contra,
RSI extremo, contradição SOFT apareceu. **Não prevê direção, não executa, não veta.**

## 9. Counterfactual (TASK 7)

Para toda oportunidade que chega à revalidação final, o runtime grava (`iq_shadow_observations`):
`currentExecution` (`EXECUTE/REJECT/PENDING` + motivo real), `gateAccepted/gateReason` e o pacote
`counterfactual`: `locationFilterWouldReject`, `displacementFilterWouldReject`, `hardCriticWouldReject`,
`degradationObserverState`, `correctedGateWouldAccept` — todos advisory.

Outcome:
- trade executado → `settlementBasis=BROKER_EXECUTED` com o mesmo result/profit do broker (nunca somado duas vezes);
- oportunidade não executada → `settlementBasis=CAUSAL_COUNTERFACTUAL`, usando a **mesma regra temporal/preço**
  do `#causalSettlement` de produção (último close ≤ `targetExpiryAt`).
- **`COUNTERFACTUAL ≠ BROKER_EXECUTED`**: bases separadas por linha e por seção do dashboard;
  PnL contrafactual normalizado (`WIN=+payout/100`, `LOSS=−1`, `DRAW=0`) nunca entra no PnL do broker.

## 10. Dashboard de pesquisa (TASK 8)

`GET /api/iq/research/shadow-lab` (admin) → `wsRuntime.shadowLabStatus()`; leitura offline via
`scripts/shadow-lab-report.mjs`. Seções **sempre separadas**:
`BROKER_EXECUTED` (com `byDecisionSource`, incl. `UNKNOWN` pré-instrumentação), `COUNTERFACTUAL`
(por base e por braço), `HISTORICAL` (backfill) e `PROSPECTIVE`.
Braços: `CURRENT_G2`, `H1_LOCATION`, `H2_DISPLACEMENT`, `H3_CRITIC`, `DEGRADATION_OBSERVER`,
`GATE_CORRECTED`. Cada braço reporta **N, W/L/D, WR, CI95 (Wilson), coverage, expectancy,
PnL normalizado, payout médio, max loss streak**. H2 também permite bucket ATR; H3 por severidade;
degradação por 4 estados; gate current vs corrected (`scoreDelta`).

## 11. Tamanho de amostra (TASK 9)

`PROSPECTIVE_CHECKPOINT_N = 30` por braço relevante — **checkpoint exploratório, não prova**.
`sampleSize.byArm` marca `reachedCheckpoint`. Uma hipótese que aumenta WR mas destrói coverage/expectancy
não é automaticamente melhor (coverage e expectancy são reportados lado a lado). **N=30 não é esperado nesta execução**:
a infraestrutura está implantada e coletando.

## 12. Testes (TASK 10)

`tests/research/prospective-shadow-lab.test.ts` (29 testes): T0 sem dado futuro; POST não realimentável;
`MANUAL_UI ≠ G2_AUTO`; SHADOW não controla Execution Gate; `correctedGateShadow` não controla produção;
isolamento `marketKey` e `NORMAL/OTC`; contrafactual fora do PnL do broker; settlement executado ≠ shadow;
reinício preserva associação (store persistente); leakage de candle futuro; classificadores H1/H2/H3;
degradation (4 estados); migration 029 (trigger de imutabilidade + `diagnostic_only`/`feedable_to_t0=false`).

## 13. Prova de zero alteração estratégica

Módulos de decisão **byte a byte inalterados** (sha256 antes/depois; baseline registrado no início da sessão):
`relay/trade-quality.mjs`, `relay/entry-timing.mjs`, `relay/professional-brain.mjs`,
`relay/price-structure.mjs`, `relay/feature-engine.mjs`, `relay/market-state-classifier.mjs`,
`relay/knowledge-base.mjs`, `relay/portfolio-gate.mjs`, `relay/iqoption-connector.mjs`.
Arquivos alterados são **aditivos/observacionais**: `relay/iq-multi-runtime.mjs` (hooks shadow;
condições/ordem dos checks do gate idênticas; nenhum veto/score/direção/stake novo),
`relay/professor.mjs` (campos D3 no journal + INSERT tolerante), `relay/server.mjs` (1 endpoint),
`scripts/db-retention.mjs` (retenção da tabela diagnóstica). Threshold 75, pesos do Quality Gate,
JIT, Execution Gate e stake permanecem os mesmos.

## 14. Limitações honestas

1. N prospectivo começa em zero; nada aqui é conclusão. WR/expectancy sem N são ruído.
2. O filtro v1 de H1/H2/H3/degradacao é uma **operacionalização congelada** das hipóteses — não uma
   afirmação de que o filtro melhora o resultado.
3. `PENDING → EXECUTE/REJECT` pode mudar em corrida de ACK; a base causal só é aplicada a oportunidades
   não-EXECUTE/não-PENDING.
4. `entryLocation` usa o último close do runtime no submit/ACK (não o fill oficial do broker), como na
   auditoria forense.
5. Se o runtime reiniciar antes do settlement, a observação é retomada pelo DB via `candidate_id`
   (testado), mas a janela PRE/POST pode ficar parcial se os candles não estiverem mais em memória.
6. `C_STABILITY_CORRECTED` é um braço de pesquisa; não foi promovido nem substitui o braço C original
   nos `SHADOW_ARMS` de produção (que permanecem intocados).
7. A observação começa na **revalidação final** (candidato confirmado/rejeitado pelo gate). Candidatos
   cancelados antes disso (janela perdida, revalidação falha) não geram observação — fora do escopo
   “oportunidade aprovada pelo G2”.
8. Trades anteriores à instrumentação têm `decisionSource=null` no journal; o dashboard os agrupa em
   `byDecisionSource.UNKNOWN` e **não** os soma ao braço `CURRENT_G2` (que exige tag `G2_AUTO`).

## 15. Deploy e coleta (esta rodada)

- Relay: deployment Railway `8e9bab72-c0e9-46c8-8ab7-c4d3f0dad357` (SUCCESS, produção) após migration 029
  aplicada (`schema_migrations`); `GET /api/iq/office` = **200** (smoke); `GET /api/iq/research/shadow-lab` = **200**
  via proxy Vercel (`api/http.ts` allowlist atualizada). Vercel prod deployado.
- Persistência verificada end-to-end contra o Postgres de produção (observe → markExecution → markEntry →
  settleCausal → settleExecuted, 0 falhas após dois fixes: stride de placeholders da janela e serialização
  INSERT→UPDATE).
- **N prospectivo coletado até o fechamento desta rodada: 21 observações** (11 com `current_execution=REJECT`
  e motivo real do gate; 18 com settlement `CAUSAL_COUNTERFACTUAL`; 14 janelas PRE de 12 candles; 0 trades
  executados no período observado). Coleta continua; 0/30 no checkpoint — nenhuma conclusão.
- Amostra observada confirma o instrumento: `currentScore` 63–81 vs `correctedShadowScore` 66–96
  (delta D1/D2 real), H1/H2/H3 e degradation (STABLE/DEGRADED/SEVERELY_DEGRADED/IMPROVED) gravados por linha.
- Pendência conhecida: as primeiras 8 observações (antes dos fixes de persistência) podem ter
  `current_execution=PENDING` mesmo após settlement causal e janela PRE/POST incompleta; T0 e gate comparison
  dessas linhas estão íntegros.

## 16. Como reproduzir / consultar

```powershell
# dashboard offline (read-only, via Railway)
NODE_PATH=<repo>\node_modules npx --yes @railway/cli@latest run --service tracecom-live-relay --environment production -- node scripts/shadow-lab-report.mjs
# endpoint (admin)
GET https://tracecom.consecom.com.br/api/iq/research/shadow-lab   # x-relay-admin: <TOKEN_SIGNING_SECRET>
# testes
npx vitest run tests/research/prospective-shadow-lab.test.ts
```
