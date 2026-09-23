# V3 — Live Cost Audit (2 oportunidades reais) + Economic Summary

Data: 2026-09-23 (UTC) · Missão: completar a auditoria live pendente — exatamente 2 oportunidades reais,
1 ciclo FULL por oportunidade, hard cap 14 provider calls. Resultado: **2/2 testes live executados (14/14 calls)**.
Nenhuma ordem; nenhum PATH_TEST; V3 OBSERVE_ONLY.

- V3 hash: `sha256:04a7936741e12b7e9d1c7e940149d5fce5a9dcaacd541da532c602354dfcec9d`
- V2 frozen intocado: `sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0`
- Modelo: `deepseek-v4.1-flash` · Provider: `openCodeGo` (Zen Go, endpoint `/v1/chat/completions`)
- Preço oficial consultado em `https://opencode.ai/docs/go` (consulta 2026-09-23T20:50Z):
  Off-Peak input $0.15/1M · cached $0.003/1M · output $0.60/1M · Peak input $0.30/1M · cached $0.006/1M · output $1.20/1M
  (Peak = 01:00–04:00 e 06:00–10:00 UTC, seg–sex; ambos os testes Off-Peak)
- Uso/limite: Go é assinatura com limites mensais (V4.1 Flash 4x até 27/09: $60). Valores aqui são **usage-value estimado**, não fatura.

Pipeline por teste (7 calls): Wave 1 = RSI, DMI_ADX, BOLLINGER, ATR, PRICE_ACTION, ASSET (6 paralelos);
Wave 2 = CONSENSUS_FINAL (decisor de mercado); Execution Gate determinístico (somente contratos; passou).

---

## TESTE 1 — EURJPY:OTC@2026-09-23T20:58:00Z

### Identificação
| Campo | Valor |
|---|---|
| market / activeId | `EURJPY:OTC` / 79 |
| opportunityId | `EURJPY:OTC@2026-09-23T20:58:00.000Z` |
| expirationAt | 1790197080000 (2026-09-23T20:58:00Z) |
| targetSendAt | 1790196778000 (20:52:58Z) |
| firstSeenAt / firstSeenTTE | 1790196750013 (20:52:30.013Z) / 329.987s |
| cycleAt / cycleTTE | 2026-09-23T20:52:34.704Z / 325.296s |
| closedCandleId / featureSnapshotId | `EURJPY:OTC:1790196755000` / `v3feat:74386cd4bdc05247ee4d03e9` |
| candles no ciclo | 120 fechados (feed real, sem fixture) |

### FactPackets (FULL; fingerprints determinísticos)
RSI `fc5d72810e4ea1f6` (579c) · DMI_ADX `05860bba5b33f2ae` (466c) · BOLLINGER `cc6696ff3ad02629` (486c) ·
ATR `ff12a44a152efb2c` (521c) · PRICE_ACTION `38aadf5776e23777` (1727c) · ASSET `10fcfc0c6adcb42c` (2637c).

### ASSET (hipótese independente)
scenario=`PULLBACK_CONTINUATION` · direction=`UP` · state=`WAIT`
thesis: "Tendência de alta intacta com sequência de topos e fundos ascendentes, mas pullback profundo (3.67 ATR) e RSI extremo em 99.79 com divergência baixista regular sugerem correção em curso antes de retomada."
bestCounterCase: "RSI 99.79 com divergência baixista e ADX caindo (-4.1) podem indicar exaustão… squeeze pode resolver para baixo."
blockers: RSI sobrecomprado extremo; ADX em queda (-4.1) e spread DMI encolhendo (-22.75); pullback profundo 3.67 ATR.
invalidations: perda do suporte 180.9086; rompimento do último HL.

### RSI
assessment: sobrecompra extrema, trajetória plana, divergência baixista regular (momentum exausto apesar da persistência).
facts: RSI_ZONE_CONTEXT:NONE:STRONG · RSI_SLOPE:DOWN:WEAK · RSI_PERSISTENCE:UP:STRONG · RSI_DIVERGENCE:DOWN:MODERATE

### DMI_ADX
assessment: tendência de alta com domínio +DI, mas ADX forte em declínio (enfraquecimento direcional).
facts: DI_DOMINANCE:UP:STRONG · ADX_WEAKENING:NONE:MODERATE · DI_DOMINANCE:UP:MODERATE

### BOLLINGER
assessment: preço na midline com squeeze/contração; sem walk/reentrada definidos.
facts: SQUEEZE_CONTEXT:NONE:STRONG · MIDLINE_SLOPE:UP:WEAK · BAND_WALK:NONE:WEAK · BAND_REENTRY:NONE:WEAK · BAND_REJECTION:NONE:WEAK

### ATR
assessment: volatilidade comprimida/compatível, sem expansão direcional.
facts: VOL_REGIME:NONE:WEAK · VOL_CONTRACTION:NONE:MODERATE · LARGE_WICK:NONE:WEAK · ZONE_TOLERANCE:NONE:WEAK

### PRICE ACTION
assessment: uptrend intacta com HLs, mas pullback profundo (3.67 ATR) e impulso de baixa pressionam suporte 180.9086.
facts: TREND:UP:MODERATE · PULLBACK:DOWN:STRONG · DECISIVE_CANDLE:DOWN:MODERATE · TREND:NONE:WEAK · BOS:NONE:WEAK

### CONSENSUS FINAL
independentAssessment: "Uptrend intacta com HLs, mas pullback DEEP 3.67 ATR e impulso de baixa de 5 candles pressionam 180.9086; RSI extremo com divergência e ADX em declínio sinalizam exaustão."
assetComparison: "PULLBACK_CONTINUATION UP coerente com a estrutura, porém contra-caso de exaustão/reversão reforçado; squeeze pode resolver para baixo."
scenario=`PULLBACK_CONTINUATION` · direction=`UP` · agreement=`PARTIAL`
supportingEvidence: [HH/HL; +DI 43.28 vs -DI 21.51; midline slope positivo]
counterEvidence: [RSI 99.79 OVERBOUGHT com divergência baixista; ADX 58 slope -4.1 WEAKENING; pullback DEEP 3.67 ATR com 5 candles DOWN; squeeze pode resolver para baixo]
bestCaseForUp: [HLs acima de 180.9086; dominância de alta] · bestCaseAgainstUp: [confluência de exaustão] ·
bestCaseForDown: [rompimento do suporte] · bestCaseAgainstDown: [dominância +DI forte]
blockers: [pullback profundo sem reversão confirmada; squeeze sem direção] ·
invalidations: [fechamento < 180.9086; -DI > +DI] · marketAmbiguities: [squeeze bidirecional; RSI extremo sem crossback] ·
reasons: ["estrutura intacta mas exaustão+compressão aumentam incerteza", "sem confirmação de retomada ou reversão => WAIT"]
**result = CANCEL**

### Canonical Decision
result=`CANCEL` · canonicalDirection=`NONE` (Consensus é a autoridade; Asset DIR/UP registrado apenas como hipótese)

### Execution Gate (todos os checks)
`ALL_AGENT_CALLS_OK:true · SAME_OPPORTUNITY_ID:true · DECISION_PRESENT:true · RESULT_ENUM:true · ANALYSIS_WINDOW:true · ANALYSIS_DEADLINE_RESPECTED:true`
pass=`true` · result=`CANCEL` · reasons=[] — o gate **não** decidiu mercado; apenas validou contratos.

### Contrafactual
theoreticalEntryAt=1790196780000 (20:53:00Z) · theoreticalEntryPrice=`180.928375` · priceSource=`BROKER_FEED_CANDLE_CLOSE`
expirationAt=1790197080000 (20:58:00Z) · expirationPrice=`180.988125` · exactBucket=true · source=`BROKER_FEED_CANDLE_CLOSE`
**outcome = NO_TRADE** (CANCEL não vira trade).

### Custo do ciclo 1 (Off-Peak)
| role | status | latency | prompt | cached | output | reasoning | payload | USD |
|---|---|---|---|---|---|---|---|---|
| RSI | OK | 3105ms | 759 | 0 | 304 | 0 | 579 | $0.00029625 |
| DMI_ADX | OK | 5186ms | 644 | 0 | 277 | 0 | 466 | $0.00026280 |
| BOLLINGER | OK | 2469ms | 702 | 384 | 283 | 0 | 486 | $0.00021865 |
| ATR | OK | 4299ms | 664 | 0 | 367 | 0 | 521 | $0.00031980 |
| PRICE_ACTION | OK | 4117ms | 1209 | 0 | 391 | 0 | 1727 | $0.00041595 |
| ASSET | OK | 3248ms | 1544 | 0 | 359 | 0 | 2637 | $0.00044700 |
| CONSENSUS_FINAL | OK | 6143ms | 2719 | 0 | 630 | 0 | 6118 | $0.00078585 |
| **total** | **7/7 OK** | wave1 5188ms · wave2 6144ms · **11334ms** | **8241** | **384** | **2611** | **0** | — | **$0.002746302** |

---

## TESTE 2 — EURJPY:OTC@2026-09-23T20:59:00Z

### Identificação
| Campo | Valor |
|---|---|
| market / activeId | `EURJPY:OTC` / 79 |
| opportunityId | `EURJPY:OTC@2026-09-23T20:59:00.000Z` |
| expirationAt | 1790197140000 (20:59:00Z) · targetSendAt 1790196838000 (20:53:58Z) |
| firstSeenAt / firstSeenTTE | 1790196810011 (20:53:30.011Z) / ~329.99s |
| cycleAt / cycleTTE | 2026-09-23T20:53:33.962Z / 326.038s |
| closedCandleId / featureSnapshotId | `EURJPY:OTC:1790196815000` / `v3feat:0c9149161fd578444240e28b` |
| candles no ciclo | 120 fechados (feed real) |

### FactPackets (FULL)
RSI `…` (485c) · DMI_ADX (475c) · BOLLINGER (490c) · ATR (519c) · PRICE_ACTION (1769c) · ASSET (2593c) — fingerprints completos no artefato JSON da auditoria.

### ASSET (hipótese independente)
scenario=`PULLBACK_CONTINUATION` · state=`WAIT` (leitura própria; direção analítica no artefato)

### Specialists (resumo factual)
- **RSI**: RSI 99.3 sobrecomprado com persistência (54 candles > 50).
- **DMI_ADX**: **-DI 42.99 vs +DI 13.98**, spread -29.02, dominância vendedora forte; ADX 36.76 com slope -13.33.
- **BOLLINGER**: midline slope -0.01071, preço abaixo da midline; bandwidth 0.00057 (squeeze).
- **ATR**: volRatio 0.663 (LOW_INFORMATION_VOLATILITY); impulsos COILED.
- **PRICE ACTION**: pullback de alta DEEP (1.614 ATR) contra downtrend; falha de rompimento em 180.9393.

### CONSENSUS FINAL
independentAssessment: "Downtrend com dominância vendedora forte; pullback DEEP contra a estrutura; falha de rompimento em 180.9393."
assetComparison: "Hipótese de pullback é compatível, mas o viés direcional favorece continuação baixa se a resistência segurar."
scenario=`PULLBACK_CONTINUATION` · **direction=`DOWN`** · agreement=`AGREE`
supportingEvidence: [-DI 42.99 vs +DI 13.98 spread -29.02; pullback DEEP 1.614 ATR; falha de rompimento 180.9393; preço abaixo da midline]
counterEvidence: [RSI 99.3 extremo com persistência; ADX caindo -13.33; impulso COILED desacelerando; squeeze pode expandir]
bestCaseForUp / bestCaseAgainstUp / bestCaseForDown / bestCaseAgainstDown: registrados no artefato (red-team bilateral explícito)
blockers: [resistência 180.9393 a 0.697 ATR; sem confirmação BOS/CHoCH; LOW_INFORMATION_VOLATILITY]
invalidations: [fechamento > 180.9393; +DI cruzando acima; rompimento < 180.9073 validaria baixa]
marketAmbiguities: [squeeze bidirecional; RSI extremo sem divergência; impulso COILED; ADX caindo com -DI dominante]
reasons: ["estrutura de baixa intacta com dominância vendedora", "pullback profundo favorece continuação baixa se resistência segurar", "exaustão e squeeze exigem confirmação", "WAIT apropriado"]
**result = CANCEL**

### Canonical Decision
result=`CANCEL` · canonicalDirection=`NONE` (direção analítica DOWN registrada; não executável)

### Execution Gate
`ALL_AGENT_CALLS_OK:true · SAME_OPPORTUNITY_ID:true · DECISION_PRESENT:true · RESULT_ENUM:true · ANALYSIS_WINDOW:true · ANALYSIS_DEADLINE_RESPECTED:true`
pass=`true` · result=`CANCEL` · reasons=[].

### Contrafactual
theoreticalEntryAt=1790196840000 (20:54:00Z) · theoreticalEntryPrice=`180.943325` · source=`BROKER_FEED_CANDLE_CLOSE`
expirationPrice=`180.970595` (20:59:00Z, exactBucket=true) · **outcome = NO_TRADE**

### Custo do ciclo 2 (Off-Peak)
| role | status | latency | prompt | cached | output | reasoning | payload | USD |
|---|---|---|---|---|---|---|---|---|
| RSI | OK | 3525ms | 718 | 0 | 275 | 0 | 485 | $0.00027270 |
| DMI_ADX | OK | 4286ms | 647 | 0 | 335 | 0 | 475 | $0.00029805 |
| BOLLINGER | OK | 3206ms | 705 | 0 | 239 | 0 | 490 | $0.00024915 |
| ATR | OK | 3683ms | 662 | 0 | 335 | 0 | 519 | $0.00030030 |
| PRICE_ACTION | OK | 5011ms | 1215 | 0 | 437 | 0 | 1769 | $0.00044445 |
| ASSET | OK | 5131ms | 1517 | 0 | 405 | 0 | 2593 | $0.00047055 |
| CONSENSUS_FINAL | OK | 8087ms | 2679 | 0 | 1055 | 0 | 6113 | $0.00103485 |
| **total** | **7/7 OK** | wave1 5133ms · wave2 8087ms · **13221ms** | **8143** | **0** | **3081** | **0** | — | **$0.003070050** |

---

## Resumo econômico (média real dos 2 ciclos)

| Métrica | Média |
|---|---|
| promptTokens/ciclo | 8.192 |
| cachedTokens/ciclo | 192 |
| completionTokens/ciclo | 2.846 |
| totalTokens/ciclo | 11.038 |
| reasoningTokens | 0 |
| latência Wave 1 | 5.160,5ms |
| latência Wave 2 | 7.115,5ms |
| latência pipeline total | 12.277,5ms |
| custo médio/ciclo (Off-Peak) | **$0.002908176** |

### Projeções (sem novas chamadas; usage-value, não fatura)
| volume | Off-Peak | Peak | Dia útil misto* |
|---|---|---|---|
| 100 ciclos | $0.2908 | $0.5816 | $0.3756 |
| 1.000 ciclos | $2.908 | $5.816 | $3.756 |
| 10.000 ciclos | $29.08 | $58.16 | $37.56 |

\* misto = 7h Peak (01–04, 06–10 UTC seg–sex) + 17h Off-Peak → preço ponderado (in $0.19375/1M · cached $0.003875/1M · out $0.775/1M).

| taxa | 1 hora Off-Peak | 24h Off-Peak | 1 hora Peak | 24h Peak | 24h misto |
|---|---|---|---|---|---|
| 1 ciclo/min | $0.1745 | $4.188 | $0.3490 | $8.376 | $5.409 |
| 10 ciclos/min | $1.745 | $41.88 | $3.490 | $83.76 | $54.09 |
| 30 ciclos/min | $5.235 | $125.63 | $10.47 | $251.26 | $162.27 |

Nota de limite: 30 ciclos/min contínuos (24h) estouram o limite mensal promocional de $60 do V4.1 Flash;
10 ciclos/min em 24h Off-Peak (~$41.9) cabe no limite 4x atual.

## Conclusão (sem conclusão de performance)
- **TESTE 1 = NO_TRADE** (Consensus CANCEL).
- **TESTE 2 = NO_TRADE** (Consensus CANCEL).
Dois testes **não** provam edge, WR, rentabilidade ou desempenho. Servem exclusivamente para validar
causalidade do pipeline, telemetria e custo real (14/14 provider calls, Off-Peak, zero erros de schema).

## Anexo A — consistência direcional (patch desta missão)
- `canonicalDecisionDirection(consensus)` em `relay/v3/final-gate.mjs`: APPROVE_BUY→UP, APPROVE_SELL→DOWN, CANCEL→NONE.
- `finalDecision.direction`, scheduler context, snapshot (`canonicalDirection`), `#onExecutionFire` e logs usam a autoridade do Consensus.
- Testes em `tests/v3/canonical-direction.test.ts` (Asset DOWN + Consensus APPROVE_BUY ⇒ execução UP; espelho SELL; snapshot).
- Hash lineage: `a5a81fcc…` → `7b066cd0…` → **`04a79367…`**.

## Anexo B — feed guard final (5 motivos, fail-closed, zero LLM)
Candle (via `candleFeedBlockReason`): `NO_CANDLE_HISTORY`, `INSUFFICIENT_CANDLES`, `CANDLE_FEED_STALE`.
Relay (classificação na camada de WS/subscription): `CANDLE_FEED_DISCONNECTED` (`#runLoop` queda do WS),
`MARKET_NOT_SUBSCRIBED` (`#subscribeCtx` falhou / activeId sem ctx habilitado), visível em `v3/status.candleFeed.reasons`.
Disconnect **não** é inferido por ausência de candles.

## Anexo C — histórico
1ª tentativa (19:10–19:30Z) ficou bloqueada por bug do cliente de auditoria (lia `payload[key]` em vez de `payload.rows[key]`),
não por falha de feed; corrigido e comprovado em `docs/research/v3-candle-feed-forensics.md`.
Validação suplementar sintética (7 calls) usada apenas para latência: 9,57s/ciclo; não é a auditoria.
