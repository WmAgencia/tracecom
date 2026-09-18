# Auditoria Forense — 5 operações PRACTICE (1 WIN / 4 LOSS)

- **Escopo:** reconstrução e autópsia das 5 operações PRACTICE liquidadas do runtime G2 (`PROFESSIONAL_BRAIN_G2`) — 2026-09-18, 20:02–21:59 UTC. **PRACTICE only, zero real, sem martingale, sem recuperação de loss, sem aumento de stake.**
- **Congelamento (Task 1):** commit de referência `chore: freeze before 5-trade forensic audit` = `f903ce25a956f14d22a1ebeeda44bbe659ce2a70` (parent deste relatório; HEAD da linha de base).
- **Fonte de verdade:** Supabase Postgres 17.6 (Railway, `DATABASE_URL`; project ref `…xzwb`), via dump read-only `scripts/forensic-5-trade-dump.mjs`.
- **Evidência congelada:** `docs/research/data/forensic-5-trades.json` (journal + executions + audit trail das 5; funil de candidatos dos 5 mercados; SHADOW_ARMS 2026-09-17..18; conjuntos excluídos).
- **Fatos computados:** `docs/research/data/forensic-5-trades-computed.json`, gerado por `scripts/forensic-5-trade-audit.mjs` usando as funções reais de produção (`relay/trade-quality.mjs`).
- **Auditoria G2 padrão (suplementar):** `docs/audits/g2-loss-audit-2026-09-18.md` (N=73; WR 46.6%; veredito PRELIMINARY).
- **Regra da amostra:** N=5 (4 trades autônomos + 1 ordem manual de smoke). WR 20% é **descritivo**, não conclusão. Nenhuma hipótese aqui autoriza mudança de produção.

---

## 0. Resumo executivo (curto e sem maquiagem)

| # | Market | Dir | Tipo | Origem | Quality (rec.) | Resultado | P&L | Fato dominante |
|---|--------|-----|------|--------|----------------|-----------|-----|----------------|
| 1 | EURUSD:OTC | CALL | LOSS | **manual `ui:smoke`** (stake 1) | — (não passou pelo gate) | LOSS | −1 | Decisão G2 era **WAIT** (extensão 3.71 ATR); ordem manual forçada |
| 2 | AUDCHF:OTC | PUT | **WIN** | AUTO_DECISION | **95** | WIN | +8.20 | Único com Critic limpo, localização com folga e deslocamento a favor |
| 3 | CADCHF:OTC | CALL | LOSS | AUTO_DECISION | **79** | LOSS | −10 | Entrada no **MID** do canal (0.45), contra-extensão 2.03 ATR; D_CRITIC vetou no braço shadow |
| 4 | EURAUD:OTC | PUT | LOSS | AUTO_DECISION | **75** (limiar) | LOSS | −10 | **`aceleracao_contra_a_entrada`** no Critic; deslocamento adverso +0.25 ATR; perdeu por 1.14 ATR |
| 5 | GBPNZD:OTC | CALL | LOSS | AUTO_DECISION | **77** | LOSS | −10 | Pior deslocamento adverso (+0.46 ATR); Donchian mudou MID→UPPER_HALF na janela; movimento −4.92 ATR contra |

**Autópsia (resumo):** nenhuma das 4 perdas autônomas tem causa única provada. A leitura defensável é **variância normal (H) combinada com localização/atraso de entrada (A/B/C) em 3 de 4**; o trade manual (#1) é **classe A pura** (o sistema mandou WAIT e a ordem foi forçada por testes de UI). Nenhuma evidência de bug que invalide execução, mapeamento ou settlement das 5 operações. Foram encontrados **defeitos reais de instrumentação/plumbing** no Quality Gate e nos braços shadow (documentados, **não corrigidos** por regra), que *não* comprometem a liquidação das operações.

---

## 1. Seleção das 5 operações (Task 2)

### 1.1 Prova de que são exatamente as 5

- `iq_trade_journal`: 73 linhas totais — **68 em 2026-09-17** e **exatamente 5 em 2026-09-18**.
- `iq_executions` com `requested_at >= 2026-09-18`: **exatamente 5 linhas, todas `state='SETTLED'`** (`selection.executionsSep18`).
- As 5 linhas do journal casam 1:1 com as 5 execuções por `trade_id = execution_id`.
- `settlement_mismatch=false` nas 5 (`mismatchesSep18 = 0`); 8 mismatches existem no histórico, todos ≤ 2026-09-17.

### 1.2 Identificadores e tempos

| # | tradeId / executionId | decisionId | correlationId | orderId | activeId | marketKey | candidate |
|---|---|---|---|---|---|---|---|
| 1 | `exec_1789761733551_9531r8` | `ord_1789761733551` | `corr_356988` | 14274204934 | 76 | EURUSD:OTC | — (manual) |
| 2 | `exec_1789764899007_b4khil` | `auto_AUDCHF:OTC_1789764895000` | `corr_450528` | 14274316648 | 2129 | AUDCHF:OTC | `cand_AUDCHF_OTC_1789764900000` |
| 3 | `exec_1789765738953_12798x` | `auto_CADCHF:OTC_1789765735000` | `corr_475015` | 14274346901 | 2119 | CADCHF:OTC | `cand_CADCHF_OTC_1789765740000` |
| 4 | `exec_1789766458670_rofxu6` | `auto_EURAUD:OTC_1789766455000` | `corr_495995` | 14274375990 | 2120 | EURAUD:OTC | `cand_EURAUD_OTC_1789766460000` |
| 5 | `exec_1789768678656_s8qvm6` | `auto_GBPNZD:OTC_1789768675000` | `corr_560702` | 14274454931 | 2132 | GBPNZD:OTC | `cand_GBPNZD_OTC_1789768680000` |

### 1.3 O que foi excluído e por quê

| Conjunto | N | Motivo da exclusão |
|---|---|---|
| `iq_trade_journal` 2026-09-17 | 68 | Fora da janela das 5 (auditadas em outro ciclo; usadas apenas como contexto) |
| Execuções sem settlement (`state≠SETTLED`) | 22 | 15 `REJECTED` (broker: “time for purchasing is over”/“asset suspended”), 6 `ACKNOWLEDGED`, 1 `UNKNOWN` órfão — **todas ≤ 2026-09-17** |
| Execuções `settlement_mismatch=true` | 8 | broker≠causal; **nenhuma em 2026-09-18** — incluídas as 5 |
| Candidatos `CANDIDATE_CANCELLED` na janela | 150 | Nunca viraram ordem |
| `shadow_trades` (experimento) | 6.878 | Experimento de 2026-09-15; fora da janela |
| `market_observations` / `price_observations` | 12.449 / 25.179 | Cobrem 2026-09-14..16; **não existe tick/candle persistido para 2026-09-18** |

**Observação crítica (FACT):** o trade #1 é uma **ordem manual de smoke** (`source='ui:smoke'`, `stakeSource='MANUAL_OVERRIDE'`, `stake=1`), disparada por `POST /api/iq/test-order`. No instante do envio, a decisão G2 era **WAIT** (`processLog DECISION=WAIT`, `consensus.status=NO_CONSENSUS`, `consensus.reason=TRADER_WAIT`, Critic `CONTEST`/`WAIT`). Ele conta como operação liquidada (entra na tabela das 5 por solicitação explícita), mas **NÃO pode ser usado como evidência de qualidade de decisão do G2**. A amostra autônoma real é N=4 (1 WIN / 3 LOSS).

---

## 2. T0 reconstruído (Task 3)

> Tudo abaixo usa **somente** o que existia até decisão/entrada: snapshot `T0_DECISION_SNAPSHOT` do journal, trilha de auditoria (candidate/revalidação/ordem), `meta` da execução e o funil de candidatos. Nenhum dado de resultado foi usado como feature.

### 2.1 Market data e features no T0 (FACT, persistido)

| Campo | #1 EURUSD (manual) | #2 AUDCHF (WIN) | #3 CADCHF | #4 EURAUD | #5 GBPNZD |
|---|---|---|---|---|---|
| RSI14 (Wilder) | 45.48 | 48.23 | 55.21 | 45.36 | 54.49 |
| ATR (Wilder) | 0.00015915 | 0.00004831 | 0.00004429 | 0.00023632 | 0.00024185 |
| ATR ratio (vs baseline) | 0.971 | 0.855 | 0.988 | 0.894 | 0.966 |
| ADX14 | 28.07 | 20.57 | 33.99 | 20.33 | 20.40 |
| +DI / −DI | 19.23 / 28.17 | 20.85 / 22.83 | 27.40 / 16.10 | 23.71 / 31.89 | 28.43 / 15.52 |
| DI spread | 8.94 | **1.98** | 11.30 | 8.19 | 12.91 |
| DI contra a direção? | sim (BUY com −DI>+DI) | não | não | não | não |
| Donchian position / zone | 0.3218 / LOWER_HALF | 0.7368 / UPPER_HALF | 0.45 / **MID** | 0.5426 / **MID** | 0.6667 / UPPER_HALF (era MID no candidato) |
| dist. upper / lower (ATR) | 3.71 / 1.76 | 1.04 / 2.90 | 2.48 / 2.03 | 1.82 / 2.16 | 1.12 / 2.23 |
| streak / bodyRatio | 2 / 0.40 | 0 / 0.00 (corpo nulo) | −1 / 1.00 | 3 / 0.45 | 3 / 0.05 |
| Estrutura | DOWN (LH+LL) | DOWN (LH+LL) | UP (HH+HL) | DOWN (LH+LL) | UP (HH+HL) |
| Regime | TREND_DOWN | TREND_DOWN | TREND_UP | TREND_DOWN | TREND_UP |
| Setup / trigger | TREND_PULLBACK / pullback… | TREND_PULLBACK / pullback… | TREND_PULLBACK / pullback… | TREND_PULLBACK / pullback… | TREND_PULLBACK / pullback… |
| Freshness (`tickAgeMs`) | 201 ms | 203 ms | 826 ms | 55 ms | 1 ms |
| Candle do último swing (bucketStart) | 20:02:00 ≤ 20:02:13 (decisão) | ≤ decisão | ≤ decisão | ≤ decisão | ≤ decisão |

Os indicadores vêm do **Feature Engine v1** (`relay/feature-engine.mjs`): RSI/ATR/ADX Wilder 14 com seed SMA, Donchian 20 causal incluindo o candle atual, microestrutura de 6 candles. O Trader usa de fato: `rsi14/adx14/plusDI/minusDI` (contexto) + `structure/velocity/location/events/candleShape` do price-structure; `s/r24/vol12` são calculados mas não entram na classificação do Brain (uso marginal/legado). As trajetórias (`rsiSlope`, `adxSlope`, `diSpreadSlope`, `atrSlope`, `donchianDelta`) existem no snapshot do candidato, mas **não são persistidas** — ver §5 (lacuna de observabilidade). **Spread bid/ask não é persistido** (proxy utilizado: ATR e diferenças de close; microestrutura via bodyRatio/wicks).

### 2.2 Brain G2 / Trader / Critic / Consensus (FACT, persistido)

| Campo | #1 | #2 WIN | #3 | #4 | #5 |
|---|---|---|---|---|---|
| Trader (ação) | WAIT (hard-block `entrada_excessivamente_estendida`) | SELL | BUY | SELL | BUY |
| Contradições do Trader | `entrada_excessivamente_estendida` | — | — | — | — |
| Critic verdict | **CONTEST** | **CONFIRM** | CONFIRM | CONFIRM | CONFIRM |
| Critic contradict. (snapshot ACK) | `checklist_falhou:sem_extensao_excessiva` | — | `preco_esticado_contra_a_entrada` | **`aceleracao_contra_a_entrada`** | `preco_esticado_contra_a_entrada` |
| Critic independente | WAIT | SELL | BUY | SELL | BUY |
| Consensus | **NO_CONSENSUS / TRADER_WAIT** | CONFIRMED | CONFIRMED | CONFIRMED | CONFIRMED |
| Fontes de conhecimento | usadas | usadas | usadas | usadas | usadas |
| `supportingEvidence` | setup/trigger/estrutura/RSI/ADX | idem | idem | idem | idem |

### 2.3 Quality Gate + JIT + Execução (FACT)

| Campo | #1 manual | #2 WIN | #3 | #4 | #5 |
|---|---|---|---|---|---|
| Score gravado (SHADOW_ARMS) | — | **95** | 79 | **75** | 77 |
| Location check (gravado) | — | ok | ok | ok | ok |
| Candidato criado | — | 20:54:56.137 | 21:08:48.486 | 21:20:51.127 | 21:57:56.088 |
| Idade do candidato | — | 2.868 s | 10.465 s | 7.541 s | 2.567 s |
| `entryLeadMs` / submit | — | 1000 ms | 1058 ms | 1337 ms | 1347 ms |
| Alvo entrada / expiry | — | 20:55:00 / 20:56:00 | 21:09:00 / 21:10:00 | 21:21:00 / 21:22:00 | 21:58:00 / 21:59:00 |
| delta expiry broker−alvo | — | **0 ms** | **0 ms** | **0 ms** | **0 ms** |
| `entryDriftMs` (ACK−alvo) | — | −385 ms | −160 ms | −433 ms | −484 ms |
| `candidateChangedBeforeEntry` | — | true | true | true | true |
| Campos alterados (candidato→final) | — | rsi, adx, diSpread, atrRatio, price | rsi, adx, diSpread, atrRatio | rsi, adx, diSpread, atrRatio, price | rsi, adx, diSpread, atrRatio, **donchian (MID→UPPER_HALF)**, price |
| Direção mudou? | — | não | não | não | não |
| Deslocamento entrada (ATR) | — | **−0.207 (favorável)** | 0 (price inalterado) | +0.254 (adverso) | **+0.455 (adverso)** |
| Latência decision→submit | — | ~2 ms | ~2 ms | ~2 ms | ~1 ms |
| send→ACK | 463 ms | 608 ms | 887 ms | 897 ms | 860 ms |
| ACK→expiry | 45.99 s | 60.39 s | 60.16 s | 60.43 s | 60.48 s |
| Preço entrada (runtime) | 1.147895 | 0.586155 | 0.590125 | 1.627895 | 2.325305 |
| Preço settlement (causal) | 1.147735 | 0.585975 | 0.589935 | 1.628165 | 2.324115 |
| Δ settlement (ATR) | −1.01 | **−3.73 (a favor do PUT)** | **−4.29 (contra o CALL)** | **+1.14 (contra o PUT)** | **−4.92 (contra o CALL)** |
| Broker = causal? | sim | sim | sim | sim | sim |
| Resultado / P&L | LOSS / −1 | WIN / +8.20 | LOSS / −10 | LOSS / −10 | LOSS / −10 |

> `entryDriftMs` negativo em 4/4 significa que o ACK chegou **antes** da fronteira de 60 s (o runtime registra `effectiveEntryAt = ackedAt`, não o instante oficial de abertura do broker). `entry_price` é o último close no momento do submit (~1,0–1,4 s antes da fronteira), não o fill oficial do broker — aproximação de observabilidade, não erro de mapeamento (o settlement do broker é autoritativo e casou com o causal em 4/4).

---

## 3. Autópsia dos 4 LOSS (Task 4)

Classificação A–H com marcação **FACT / HYPOTHESIS / UNKNOWN**. Mais de uma classe por trade é permitida; nenhuma causa foi forçada.

### LOSS #1 — EURUSD:OTC (manual, CALL, −1)
- **A. DECISION / H. Variância:** **FACT** — o G2 decidiu **WAIT** (hard-block `entrada_excessivamente_estendida`, extensão 3.71 ATR; Critic `CONTEST`), e a ordem foi **forçada manualmente** (`ui:smoke`). A perda era o resultado esperado de desobedecer o processo — não é evidência sobre o G2.
- **B. Entry location:** FACT — LOWER_HALF a 1.76 ATR do fundo, mas com extensão oposta de 3.71 ATR e DI contra a direção (BUY com −DI 28.17 > +DI 19.23).
- **F. Execution:** FACT — sem JIT/gate (manual). `decisionId` da ordem ≠ decisão.
- **G. Data:** FACT — journal grava `traderDecision='BUY'` derivado da direção da ordem, contradizendo `consensus.traderAction='WAIT'` (artefato de mapeamento documentado em §5.4).

### LOSS #2 — CADCHF:OTC (CALL, −10)
- **A. DECISION:** FACT — o Professor classificou **GOOD_DECISION** (0 mistakes). HYPOTHESIS — o D_CRITIC (shadow) registrou `CRITIC_CONTRADICTION` no T0 do candidato, sinal que o veto principal ignorou.
- **B. ENTRY LOCATION:** FACT — **MID** (posição 0.45, `location_not_mid` falhou) e `not_overextended` contra 2.03 ATR (limite 2.0) já no snapshot do ACK. HYPOTHESIS — entrada em zona neutra sem folga de canal.
- **C. TIMING/JIT:** FACT — candidato viveu 10.5 s; indicadores caíram entre criação e final (ADX 35.3→34.0, DI 12.4→11.3, ATR ratio 1.04→0.99); score de produção 79 (no T0 do candidato) mas o estado no ACK indica degradação.
- **D. MICROSTRUCTURE:** FACT — candle de entrada com `bodyRatio=1.00` e `streak=−1` (candle de baixa imediatamente antes de uma entrada comprada); UNKNOWN o efeito causal exato.
- **E. REGIME/SETUP:** FACT — TREND_UP com estrutura UP e DI a favor (27.4 vs 16.1), ADX 34 — contexto nominalmente alinhado.
- **H. NORMAL VARIANCE:** HYPOTHESIS — movimento de −4.29 ATR em 60 s contra a entrada, sem notícia/tick registrado; perda “boa decisão”.
- **Conclusão:** B + H (com C como agravante), tudo em nível HYPOTHESIS exceto os fatos acima.

### LOSS #3 — EURAUD:OTC (PUT, −10)
- **A. DECISION:** FACT — Professor `ACCEPTABLE_DECISION` por **MOMENTUM_CONTRA** (`aceleracao_contra_a_entrada`, accel +0.000023 para SELL). **Este é o LOSS com maior evidência de decisão ruim detectável no T0**: o próprio Critic marcou a contradição e o braço D_CRITIC abstiu; mesmo assim o Consensus aprovou (o gate principal não usa contradições do Critic exceto o veto direto).
- **B. ENTRY LOCATION:** FACT — MID (0.5426). **C. TIMING:** FACT — deslocamento adverso +0.25 ATR (preço subiu entre candidato e entrada para um PUT); drift −433 ms.
- **D. MICROSTRUCTURE:** FACT — corpo 0.45, streak 3 contra o PUT (3 candles de alta) — comprando PUT após 3 altas.
- **H:** possível — perdeu por apenas **1.14 ATR** (o menor movimento contra entre os LOSS autônomos).
- **Conclusão:** A + C (+ D agravante); perda pequena. O D_CRITIC teria abstido — evidência pró-Critic (N=1).

### LOSS #4 — GBPNZD:OTC (CALL, −10)
- **A. DECISION:** FACT — Professor `GOOD_DECISION`; Critic `CONFIRM` porém com `preco_esticado_contra_a_entrada`.
- **B. ENTRY LOCATION / C. TIMING:** FACT — no T0 do candidato a zona era **MID**; no ACK já era **UPPER_HALF** (Donchian mudou na janela) com deslocamento adverso **+0.46 ATR** (o pior das 5) e `entry_displacement` > 0.35 (limite do checklist). HYPOTHESIS — perseguição de preço no último segundo.
- **D. MICROSTRUCTURE:** FACT — candle de entrada com corpo 0.05 e wick inferior 0.68 (rejeição).
- **H:** FACT/HYPOTHESIS — movimento de −4.92 ATR contra a entrada em 60 s (maior entre os LOSS).
- **Conclusão:** B/C + H; nenhum erro de regime/setup (TREND_UP, DI 28.4 vs 15.5, ADX 20.4).

### Padrão transversal dos 4 LOSS (exploratório, N=4)
- 3/4 autônomos entraram com **zona MID no T0 do candidato** (#3, #4, #5) e o WIN entrou em **UPPER_HALF com folga** (0.7368, 1.04 ATR do topo). #1 (manual) tinha extensão extrema.
- 2/4 autônomos com **deslocamento adverso ≥ 0.25 ATR**; o WIN teve deslocamento **favorável** (−0.21 ATR).
- O único com **Critic 100% limpo** foi o WIN (#2). O LOSS #3 tinha contradição de aceleração; #3 e #5 tinham `preco_esticado`.
- **Nenhum** LOSS tem evidência de mapeamento invertido, candle de outro ativo, activeId errado, expiry errado ou settlement atribuído ao trade errado (ver §5).

---

## 4. Estudo do WIN (Task 5)

**AUDCHF:OTC — PUT — WIN (+8.20)** — `cand_AUDCHF_OTC_1789764900000`, entrada 20:55:00, settlement −0.00018 (≈ −3.73 ATR a favor do PUT).

- TREND_DOWN + estrutura DOWN + TREND_PULLBACK; SELL com DI levemente a favor (22.8 vs 20.8), ADX 20.6 (limiar).
- Localização **UPPER_HALF (0.7368)** com apenas 1.04 ATR do topo do canal → venda perto da borda superior, com 2.90 ATR de espaço até o fundo.
- Critic `CONFIRM` com **zero contradições e zero risk flags**; Consensus `TRADER_E_CRITIC_ALINHADOS`.
- Score de produção **95** — o teto efetivo do gate (ver §5.1/§6) — sem nenhuma falha exceto os 3 checks estruturalmente inativos.
- Deslocamento candidato→entrada **−0.207 ATR (a favor do PUT)**; drift −385 ms; microestrutura do candle de entrada: bodyRatio 0, lowerWick 1.0 (rejeição no fundo? para um PUT, candle sem corpo).
- Professor: `ENTRADA_ATRASADA` (2.90 ATR de extensão) e `wouldWaitBeBetter=true` — **o próprio Professor não distingue o WIN por processo**: ele aponta o mesmo defeito de extensão do lado oposto.

**Comparação estrutural 1 WIN × 4 LOSS (NÃO tratar o WIN como padrão-ouro):**

| Dimensão | WIN #2 | LOSS autônomos #3/#4/#5 | Manual #1 |
|---|---|---|---|
| Score Quality (rec.) | **95** | 79 / 75 / 77 | — |
| Critic | CONFIRM limpo | 1 contrad. aceleração + 2 “esticado” | CONTEST |
| DI spread | 1.98 (fraco) | 11.3 / 8.2 / 12.9 | 8.9 |
| ADX | 20.6 | 34.0 / 20.3 / 20.4 | 28.1 |
| Donchian (T0) | UPPER_HALF 0.74 | MID 0.45 / MID 0.54 / MID→UPPER_HALF | LOWER_HALF |
| Deslocamento (ATR) | −0.21 (favorável) | 0 / +0.25 / +0.46 | n/d |
| Payout | 82 | 82 / 82 / 82 | 88 |
| Horário UTC | 20:55 | 21:09 / 21:21 / 21:58 | 20:02 |
| Movimento no expiry (ATR) | −3.73 a favor | −4.29 / +1.14 / −4.92 contra | −1.01 contra |

Observação honesta: o WIN tem ADX mais fraco e DI spread menor que os LOSS #3 e #5 (ou seja, “força” não separou). O que separou foi **localização + limpeza do Critic + deslocamento**, com N=1 de WIN — **qualquer inferência é HYPOTHESIS, não resultado**.

---

## 5. Procura de falha de implementação (Task 6)

Cadeia auditada: `marketKey → feed → Feature Engine → Brain → Trader/Critic → Consensus → Quality Gate → JIT/Execution Gate → activeId → settlement → trade`. Resultado: **nenhum bug que invalide as 5 operações**. Foram encontrados 5 defeitos reais de instrumentação/observabilidade (D1–D5), todos documentados e **não corrigidos** (fora da exceção permitida).

### 5.1 Counterexamples de mapeamento — CORRETOS (testes `tests/research/forensic-5-trade-audit.test.ts`)

| Invariante | Resultado | Evidência |
|---|---|---|
| `marketKey → activeId` (contra `iq_markets`) | PASS 5/5 | 2129, 2119, 2120, 2132, 76 |
| `marketKey → symbol` (broker) | PASS 5/5 | “AUD/CHF OTC”, “CAD/CHF OTC”, “EUR/AUD OTC”, “GBP/NZD OTC”, “EUR/USD OTC” |
| Direção `BUY→CALL`, `SELL→PUT` (ação G2 × executada) | PASS 4/4 autônomos (+ manual coerente com a ordem) | journal `direction` × `snapshot.action` |
| `targetExpiryAt` (JIT) == `expiration_at` (broker) | PASS 4/4 | delta **0 ms** |
| Ordem ↔ settlement ↔ journal (por `broker_order_id`/`execution_id`) | PASS 5/5 | `SETTLEMENT` audit + `profit` × stake/payout |
| Cross-market contamination (candidateId contém o mercado; preços compatíveis com o ativo) | PASS 5/5 | ex.: GBPNZD ~2.325, CADCHF ~0.590 |
| NORMAL/OTC misturado | PASS | 5/5 `OTC` |
| Settlement de trade errado | PASS | `settlement_mismatch=false` 5/5 |
| Candle futuro / timestamp desalinhado | PASS | último swing ≤ `decisionAt`; `tickAgeMs` 1–826 ms |
| Direção invertida / CALL-PUT trocado | PASS | broker result coerente com `causal` em 5/5 |

### 5.2 Defeito D1 — Quality Gate: 3 checks nunca pontuam (FACT, não corrigido)
`relay/trade-quality.mjs` (`featuresFromSnapshot`) lê `structure.velocity.velocity/acceleration`, mas o runtime guarda velocidade/aceleração em **`momentum`** (`professional-brain.mjs` `buildOutput`), e **não copia `knowledgeContextIds`** para as features.
Efeito: `accel_agrees` (8 pts), `velocity_agrees` (4 pts) e `knowledge_used` (3 pts) **falham sempre** → **teto efetivo = 95/100**, e o teto real da rubrica (110 pts, clampeado em 100) vira 95.
Confirmação empírica: AUDCHF marcou exatamente 95 com todos os outros checks ok; nas 1.120 SHADOW_ARMS nenhuma tem pontos nesses 3 itens.
Impacto: filtro fica mais restritivo que o projetado (75 efetivo ≈ 90 “intencional”), mas **não invalida** nenhuma das 5 operações. **Não corrigido** (regra: não alterar Quality Gate; e a correção mudaria a seleção de trades).

### 5.3 Defeito D2 — Braço `C_STABILITY` degenerado (FACT, shadow, não corrigido)
`evaluateShadowArms`: `unstable = directionChanges >= 2 || candidateChangedBeforeEntry`. `directionChanges` só pode ser 0/1 (compara ação inicial × final) e `candidateChangedBeforeEntry` é true se **qualquer** campo mudou — inclusive preço. Resultado: **1.016/1.120 abstêm (90,7%)** por `DIRECTION_UNSTABLE`; `F_COMBINED` aceita **1/1.120**. Afeta apenas pesquisa shadow, não a execução.

### 5.4 Defeito D3 — Ordem manual grava `traderDecision` pela direção da ordem (FACT, observabilidade)
`#decisionSnapshot`: `action = pending.direction === 'CALL' ? 'BUY' : …`. No trade #1 (WAIT/NO_CONSENSUS), o journal grava `traderDecision='BUY'` e `snapshot.action='BUY'` enquanto `consensus.traderAction='WAIT'` e `processLog DECISION=WAIT`. É um artefato do caminho manual `ui:smoke`; **não afeta** ordens AUTO (4/4 coerentes).

### 5.5 Defeito D4 — Snapshot T0 do gate não é persistido (FACT, observabilidade)
O Quality Gate usa `candidate.initialFull` (criação do candidato, `iq-multi-runtime.mjs:777-783`), mas o journal persiste o snapshot do **ACK** e o `initialSnapshot` chega `null`. Recomputar o score a partir do journal produz diferenças (CADCHF 71 vs 79; GBPNZD 73 vs 77; EURAUD 79 vs 75; AUDCHF 95 vs 95) — **explicadas pela janela candidato→ACK**, não por bug de cálculo. Sem o snapshot do candidato não é possível reproduzir o score de produção byte a byte.

### 5.6 Defeito D5 — Dados de mercado pós-candidato/pós-entrada não persistidos (FACT, dados)
O event buffer (`EVENT_BUFFER=2000`) e a série de candles vivem só em memória; o audit trail só grava `CANDIDATE_UPDATED` quando **muda a cardinalidade** dos campos alterados (amostragem esparsa), e `market_observations`/`price_observations` não cobrem 2026-09-18. Consequência: **T+5/10/15/…s não são reconstruíveis** para as 5 operações (ver §9).

### 5.7 Itens verificados e descartados
- `activeId` errado, NORMAL/OTC misturado, candle de outro ativo: descartados com os counterexamples de §5.1.
- Feature calculada em candle futuro: descartado (`bucketStart ≤ decisionAt`; `FRESHNESS` ok).
- `direction` invertida, expiry incorreto, timezone: descartados (delta 0 ms; todos UTC; maps corretos).
- Settlement atribuído ao trade errado: descartado (`mismatch=false` 5/5; broker=causal).
- Contaminação cruzada por idempotência (`marketKey:bucket:action`): consistente por mercado.

**Conclusão Task 6:** a “plumbing” das 5 operações está **correta e auditável**. Os defeitos D1/D2 são de **filtro/instrumentação**; D3/D4/D5 são de **observabilidade**. Nenhum exige correção para manter a validade das operações — e todos os módulos protegidos pela regra (Brain, Quality Gate, JIT, thresholds, stake, Execution Gate, resolver, universo) permanecem intocados.

---

## 6. Quality Gate (Task 7)

- Threshold operacional: `minTradeQualityScore=75` (config no DB: `quality_gate_enabled=true`, `jit_enabled=true`, `entry_lead_ms=1500`, `entry_window_max_drift_ms=2500`, `brain_generation=2`).
- Fluxo real por candidato: revalidação (A–G) → `SHADOW_ARMS` (score+braços) → `entryLocationCheck` → `finalMicrostructureVeto` → score ≥ 75 → ordem.
- **Ordem de veto:** localização (`VALID_SETUP_BUT_BAD_ENTRY_PRICE`) e microestrutura são avaliadas **antes** do score; por isso candidatos com score **81** foram rejeitados por localização (Tabela abaixo).

**Scores/threshold/checks das 5 operações (gravado em produção):**

| Trade | Score | Location | Limiar | Check decisivo |
|---|---|---|---|---|
| #2 AUDCHF WIN | 95 | ok | 75 | todos os checks ativos OK (só os 3 inativos D1) |
| #3 CADCHF LOSS | 79 | ok | 75 | `critic_clean`/`location_not_mid`/`not_overextended` falharam no snapshot ACK |
| #4 EURAUD LOSS | 75 | ok | 75 | **passou raspando** (`MOMENTUM_CONTRA` no Critic; braço D absteve) |
| #5 GBPNZD LOSS | 77 | ok | 75 | `preco_esticado` + donchian mudou MID→UPPER_HALF |
| #1 manual | — | — | — | não passou pelo gate (ordem manual) |

**Distribuição de Quality Score no período (1.120 candidatos com `SHADOW_ARMS`, 2026-09-17..18):**
- min 59 · máx 95 · média 70,74 · **≥75: 296 (26,4%)** · **<75: 824 (73,6%)**.
- Histograma (bucket 5): 55→9, 60→243, 65→194, **70→378**, **75→200**, 80→67, 85→23, 90→1, 95→5.
- O threshold 75 corta **exatamente na região mais densa** (70–79 = 578 candidatos). O gate **discrimina**, mas com margem apertada: 26% acima.
- Rejeições por gate na janela (5 mercados): 9 `VALID_SETUP_BUT_BAD_ENTRY_PRICE` (scores 63–81), 1 `QUALITY_SCORE_BELOW_THRESHOLD`. Executados: 4.
- **Aceitos × rejeitados por localização:** score 81 rejeitado (`OVEREXTENDED_FROM_CHANNEL`) vs 75 aceito ⇒ o score sozinho **não** é o discriminador; a localização é.

**Limitação (FACT):** com D1, os scores estão comprimidos no topo (teto 95); a distribuição observada é a **distribuição do gate com o defeito**, não da rubrica projetada. **Nenhum threshold foi alterado.**

---

## 7. Critic (Task 8)

- O Critic roda **de novo o Trader** de forma independente e emite `CONFIRM`/`CONTEST`/`VETO`, contradições e risk flags (`professional-brain.mjs` `criticBrainAssessment`), além de um checklist de 8 itens.
- **Nas 140 revalidações falhas da janela, o veredito final do Critic foi:** `CONTEST` 74 (52,9%), `VETO` 37 (26,4%), `CONFIRM` 29 (20,7%). O Critic **não é um espelho do Trader** — vetou ou contestou 79% dos candidatos rejeitados.
- **Nos 4 executados:** #2 limpo (CONFIRM, sem contradições); #3 `preco_esticado` (D_CRITIC absteve); #4 **`aceleracao_contra_a_entrada`** (o LOSS com defeito de decisão detectável — D_CRITIC absteve, Consensus aprovou porque o veto só ocorre em `VETO`, não em `CONTEST`); #5 `preco_esticado` (D_CRITIC aceitou).
- **Contradição forte ignorada:** #4. O Consensus confirma com `criticVerdict=CONFIRM` mesmo havendo contradição; o gate principal **não consulta contradições** (só localização, micro-veto e score), então `aceleracao_contra_a_entrada` não bloqueia.
- **Não é possível medir o Critic inteiro pelo DB:** `AGENTS` só é persistido quando `consensus=BUY/SELL` ⇒ **todas as 1.165 linhas AGENTS gravadas são CONFIRM**. Os CONTEST/VETO só aparecem em `FINAL_REVALIDATION`/`CANDIDATE_CANCELLED`. Outra lacuna de observabilidade.
- **Braço shadow D_CRITIC:** absteve em **708/1.120 (63,2%)**, sempre `CRITIC_CONTRADICTION`; como o braço só olha 2 códigos (`aceleracao_contra_a_entrada`, `rompimento_sem_corpo_dominante`), ele **ignora** outros códigos relevantes emitidos (p.ex. `preco_esticado_contra_a_entrada`, `rsi_sem_momentum_para_compra`, `conflito_di_contra_entrada`). **Não alterado** (regra).
- **Veredito:** o Critic é **discriminativo** (vetos/contests reais, 37 vetos na janela) mas o **elo entre contradição e execução é fraco**: `CONTEST` não impede a ordem e a lista de códigos usada pelo braço D é estreita. HYPOTHESIS (H4): usar o conjunto completo de contradições duras como veto reduziria perdas como #4, ao custo de cobertura.

---

## 8. JIT / Entry Timing (Task 9)

| Trade | Idade cand. | Lead | Drift ACK−alvo | Desloc. cand→entry (ATR) | Direção do desloc. | Δ até expiry (ATR, a favor +) | Resultado |
|---|---|---|---|---|---|---|---|
| #2 AUDCHF WIN | 2,9 s | 1000 ms | −385 ms | **−0.207** | favorável (PUT) | negativo a favor; +3,73 a favor | WIN |
| #3 CADCHF | 10,5 s | 1058 ms | −160 ms | 0 (preço não mudou no log) | neutro | −4,29 contra | LOSS |
| #4 EURAUD | 7,5 s | 1337 ms | −433 ms | **+0.254** | adverso (PUT) | +1,14 contra | LOSS |
| #5 GBPNZD | 2,6 s | 1347 ms | −484 ms | **+0.455** | adverso (CALL) | −4,92 contra | LOSS |
| #1 manual | — | — | — | — | — | −1,01 contra | LOSS |

- **Todos** os 4 autônomos tiveram `candidateChangedBeforeEntry=true` (algum campo mudou) e nenhum mudou de direção; a revalidação confirmou A–G em 4/4.
- O **WIN** teve deslocamento **favorável**; os 2 LOSS com deslocamento mensurável tiveram **adverso** (+0.25 e +0.46 ATR). O LOSS #3 não registrou preço no log de mudanças.
- **Rejeitados com deslocamento adverso** existem e foram corretamente barrados: p.ex. `cand_GBPNZD_OTC_1789762620000` (score 63, `ENTRY_DISPLACEMENT_CHASED`), `cand_EURUSD_OTC_1789766040000` (67, `ENTRY_DISPLACEMENT_ADVERSE`), `cand_GBPNZD_OTC_1789766580000` (63, `OVEREXTENDED_FROM_CHANNEL`). Portanto o gate de localização **estava ativo** — os 3 LOSS passaram porque, **no T0 do candidato**, a localização era aceitável; a degradação ocorreu **depois** (janela candidato→entrada), exatamente o que D4 não permite auditar em detalhe.
- `entryDriftMs` negativo (−160 a −484 ms) em 4/4: o ACK chega antes da fronteira; o timestamp de entrada registrado é o ACK, não a abertura oficial do broker.
- Comparação com candidatos rejeitados é **exploratória (N=4)**; não há base para declarar JIT pior que EARLY (comparação prospectiva não foi analisada aqui).

---

## 9. Pós-entrada (Task 10 — diagnóstico, nunca realimentar features T0)

**Limitação factual:** não existem candles/ticks persistidos para 2026-09-18 (D5). Só é possível medir o **ponto final (expiry)** via `causal` (broker confirmado) e observações esparsas de `CANDIDATE_UPDATED` pós-evento. T+5/10/15/20/30/45 s são **UNKNOWN** para as 5 operações. Portanto a classificação abaixo é conservadora:

| Trade | Classificação | Base |
|---|---|---|
| #1 EURUSD | **Direção errada desde o início (provável)** | entrada a 3.71 ATR de extensão contra WAIT; preço caiu −1.01 ATR no expiry |
| #2 AUDCHF WIN | **Movimento correto (a favor) desde cedo** | deslocamento favorável no T0; expiry −3.73 ATR a favor |
| #3 CADCHF | **Direção errada / reversão não recuperada** | −4.29 ATR contra; entrada em MID; sem dados intermediários |
| #4 EURAUD | **Perdido por pequena diferença no expiry** | +1.14 ATR contra (menor da amostra); accel contrária detectada no T0 |
| #5 GBPNZD | **Spike contrário + entrada atrasada** | deslocamento +0.46 ATR adverso; wick 0.68; expiry −4.92 ATR contra |

Nenhuma conclusão de “entrada atrasada causou a perda” pode ser provada com os dados disponíveis; é **HYPOTHESIS** em #4/#5.

---

## 10. Relatório comparativo (Task 11)

### 10.1 Tabela das 5 operações

| Trade | Market | Type | Dir | Setup/Regime | Quality | Critic | JIT | Entry disp. (ATR) | Payout | Result | P&L | Evidence | Hypothesis |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| #1 | EURUSD:OTC | OTC | CALL | TREND_PULLBACK / TREND_DOWN | — | CONTEST/WAIT | manual | n/d | 88 | LOSS | −1 | A(H): decisão WAIT desobedecida; extensão 3.71 ATR | variância irrelevante — ordem de teste |
| #2 | AUDCHF:OTC | OTC | PUT | TREND_PULLBACK / TREND_DOWN | **95** | CONFIRM limpo | 2,9 s; −385 ms | −0.207 (favor) | 82 | **WIN** | +8.20 | B/E: localização UPPER_HALF com folga; DI 1.98 | N=1; sem inferência |
| #3 | CADCHF:OTC | OTC | CALL | TREND_PULLBACK / TREND_UP | 79 | CONFIRM c/ `preco_esticado` | 10,5 s; −160 ms | 0 | 82 | LOSS | −10 | B/C: MID + 2.03 ATR; D_CRITIC absteve | H2 | 
| #4 | EURAUD:OTC | OTC | PUT | TREND_PULLBACK / TREND_DOWN | **75** | CONFIRM c/ **`aceleracao_contra`** | 7,5 s; −433 ms | +0.254 (adverso) | 82 | LOSS | −10 | **A/C**: contradição detectada e ignorada; expiry −1.14 ATR | H1/H2/H4 |
| #5 | GBPNZD:OTC | OTC | CALL | TREND_PULLBACK / TREND_UP | 77 | CONFIRM c/ `preco_esticado` | 2,6 s; −484 ms | **+0.455 (adverso)** | 82 | LOSS | −10 | B/C: MID→UPPER_HALF; pior chase; expiry −4.92 ATR | H2/H3 |

### 10.2 Matriz LOSS×WIN (padrões repetidos — exploratório)

| Característica | WIN #2 | LOSS #3 | LOSS #4 | LOSS #5 | Manual #1 | Repetição |
|---|---|---|---|---|---|---|
| Zona MID no T0 | não (0.74) | sim (0.45) | sim (0.54) | sim (cand. MID) | não | **3/4 LOSS** |
| Deslocamento adverso ≥0.25 ATR | não (−0.21) | n/d | sim (+0.25) | sim (+0.46) | n/d | 2/3 mensuráveis |
| Critic com contradição | não | sim | sim (aceleração) | sim | sim | 3/4 LOSS |
| `not_overextended` falhou no ACK | não | sim (2.03) | não (1.82) | sim (2.23) | sim (3.71) | 3/4 LOSS |
| DI a favor | sim (fraco 1.98) | sim (11.3) | sim (8.2) | sim (12.9) | não | **não separa** |
| ADX ≥ 20 | 20.6 | 34.0 | 20.3 | 20.4 | 28.1 | **não separa** |
| Payout 82 | sim | sim | sim | sim | 88 | constante |
| Expiry contra ≥1 ATR | não (a favor) | sim (−4.29) | sim (+1.14) | sim (−4.92) | sim (−1.01) | 4/4 LOSS |

Mensagem honesta: **os padrões existem, mas N=5 e o WIN é N=1**; nada aqui é causa provada. A leitura mais defensável: 3 LOSS tiveram decisão/localização defensável no T0 e perderam por movimento normal; 1 LOSS (#4) tem defeito de decisão detectável no T0.

---

## 11. Hipóteses (Task 12)

Arquivos completos em `docs/research/hypotheses/`:

| ID | Hipótese | Evidência (nível) | Trades |
|---|---|---|---|
| H1 | Entrada em zona MID/atrasada discrimina perdas | 3/4 LOSS MID; WIN com folga (OBSERVACIONAL, N=5) | #3 #4 #5 |
| H2 | Deslocamento adverso > 0.35 ATR piora outcome | WIN favorável; #5 pior chase e pior movimento (OBSERVACIONAL) | #5 (+#4) |
| H3 | Contradições duras do Critic (`aceleracao_contra`, `preco_esticado`, `conflito_di`) deveriam vetar/abster | #4 perdeu com contradição detectável e aprovada (FACT+opinativo) | #4 |
| H4 | Quality Gate tem 15 pts permanentemente inativos (accel/velocity/knowledge) — corrigir e recalibrar offline | código + 1.120 amostras (FACT) | todos |
| H5 | `C_STABILITY` (shadow) é degenerado; redesenhar antes de qualquer conclusão | 1.016/1.120 abstêm (FACT) | pesquisa |
| H6 | Sem persistência de candles/ticks por trade, nenhuma autópsia pós-entrada é conclusiva | D5 (FACT) | todos |

Nenhuma hipótese foi implementada. Nenhum threshold foi movido.

---

## 12. Próximo experimento (Task 13)

**NENHUMA mudança no Brain/Critic/Consensus/Gate/JIT entra em produção só porque explicaria estes 4 LOSS.** Ordem obrigatória:

1. **Discovery (offline, dados existentes):** montar dataset point-in-time de candidatos (`SHADOW_ARMS` já contém score/arms dos 1.120) e cruzar com settlement **somente para estudo**, marcando claramente que é retroditivo. Medir: score, zona, deslocamento ATR, contradições, resultado. Reportar AUC/curvas seletivas **com N e limitações** (`trade-quality.mjs` já oferece `selectiveCurve`/`temporalSplit`).
2. **Teste histórico point-in-time:** reconstruir features T0 a partir de candles causais (fonte atual em memória) para um período longo, sem usar candles futuros; rodar braços A–F **em sombra offline**.
3. **Validação temporal/purged:** `temporalSplit` com gap (ex.: 120 s) + purga de sobreposição de horizonte; verificar estabilidade do sinal.
4. **Holdout intocado:** reservar por data/ativo; tocar **uma vez**.
5. **Prospective SHADOW:** logs `SHADOW_ARMS` já ativos — congelar os 6 braços e medir prospectivamente por ≥30 decisões por braço antes de qualquer juízo.
6. **PRACTICE (stake mínima e fixa):** só depois do SHADOW prospectivo com amostra mínima; sem recuperação, sem martingale.
7. **Promotion Gate:** `HypothesisRegistry.evaluate` (min 30 amostras prospectivas, ganho mínimo, sem `REVIEW_REQUIRED` do supervisor).

Instrumentação recomendada **antes** dos passos 5–6 (H4/H6): persistir o `candidate.initialFull` (snapshot T0 do gate), as contradições completas do Critic e candles por trade — sem mudar nenhuma regra de decisão.

---

## Anexo A — Como reproduzir

```powershell
# 1) evidencia congelada (read-only; DATABASE_URL via Railway)
npx --yes @railway/cli@latest run --service tracecom-live-relay --environment production -- node scripts/forensic-5-trade-dump.mjs
# 2) fatos computados + validação dos mappings/score (funcoes de produção, sem IO)
node scripts/forensic-5-trade-audit.mjs
# 3) testes de counterexample da auditoria
npx vitest run tests/research/forensic-5-trade-audit.test.ts
# 4) verificacao global
npx vitest run tests/ai ; npx tsc -p tsconfig.json --noEmit
```

## Anexo B — Proveniência e verificação

- Freeze commit: `f903ce25a956f14d22a1ebeeda44bbe659ce2a70` (`chore: freeze before 5-trade forensic audit`).
- Este relatório e os testes foram commitados em seguida; hashes no rodapé do commit e no retorno da auditoria.
- `npx tsc -p tsconfig.json --noEmit`: limpo.
- `npx vitest run tests/ai`: **53 arquivos / 751 testes verdes**. (Na primeira execução desta sessão, antes das mudanças, houve 1 falha de performance flaky em `office-v3-perf.test.ts` — p50 17,4 ms vs budget 16,7 ms sob carga de 53 workers; o teste passa isolado e voltou a passar na execução final. Não relacionada a esta auditoria.)
- `npx vitest run` (suíte completa, com os novos testes de auditoria): **176 arquivos passando / 1 skipped; 1.557 testes passando / 3 skipped**.
- `npx vitest run tests/research/forensic-5-trade-audit.test.ts`: **14/14 verdes** (counterexamples de mapping + caracterização D1/D2/D3/D4).
- Nenhum arquivo de produção foi alterado (Brain G2, setups, Feature Engine, Trader, Critic, Consensus, Quality Gate, JIT, thresholds, stake, Execution Gate, resolver, universo).
