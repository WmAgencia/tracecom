# V3 — Economic Hybrid Architecture Finalization + Live Cost Audit

Data: 2026-09-23 · Missao: arquitetura hibrida final (Wave 1 = 6 LLMs paralelos; Wave 2 = Consensus Final decisor)
+ auditoria de custo com 2 ciclos live. Resultado da auditoria live: **BLOCKED_NO_LIVE_OPPORTUNITY**.

- V3 hash inicial (missao): `sha256:44a1aa14c7e2d4e9039058c2e7bc68d751a5f42496b67a97480c2abbd569aedb`
- V3 hash final: `sha256:a5a81fcc97183c019b6145e6140a3a0e8d002a24bcac9614de2c20540187e0e5` (confirmado no runtime de prod)
- V2 intocado: `PULLBACK_4060_300_AGENTIC_V2` / ACTIVE / frozen=true / `sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0`
- Commits: `f86effd` (arquitetura) · `0681989` (normalizacao + caps) · deploy de prod validado

## 1. Arquitetura final implementada

```
MOTOR DETERMINISTICO (measurements.mjs)
        |
FACT COMPILER (agents/fact-packets.mjs)  ->  fact packet por papel + fingerprint
        |
WAVE 1 — 6 LLMs EM PARALELO
  RSI | DMI/ADX | Bollinger | ATR | Price Action | Asset Agent   (ninguem ve ninguem)
        |
WAVE 2 — 1 LLM
  CONSENSUS FINAL (decisor de mercado; ve facts + 5 specialists e, por ultimo, ASSET_THESIS_TO_CHALLENGE)
        |
EXECUTION/SAFETY GATE (final-gate.mjs) — SOMENTE contratos operacionais; direcao vem do Consensus
```

- 7 chamadas LLM por ciclo completo (6+1). Nenhuma terceira onda.
- Independencia: Asset nao recebe specialists/consensus; specialists nao recebem Asset nem uns aos outros;
  todos recebem apenas o proprio fact packet. Provado em `tests/v3/agents.test.ts`
  ("INDEPENDENCIA...", maxActive=6, consensusStartedWith=6, 7 chamadas exatas).
- Wave 2 somente apos 6/6 validas; qualquer falha => `AGENT_UNAVAILABLE` (nunca 5 de 6).
- Gate deterministico nao decide mercado (sem familias/agreement/heuristica tecnica): 7/7 calls OK, schema/grounding,
  mesmo opportunityId, resultado enum, consistencia result x direction, blockers/invalidations/ambiguidades
  declarados pela propria decisao, janela TTE (300s,330s], deadline e freshness. Falha => CANCEL.

## 2. FACT COMPILER (code -> fatos; LLM -> interpretacao)

Pacotes por papel (`buildRolePacket`): RSI (rsi + structure minimo), DMI/ADX (dmi + trend), Bollinger
(bollinger + volRatio/regime), ATR (atr + wick), Price Action (structure/pullback/zones/impulse/micro/breakoutRetest),
Asset (snapshot cross-domain compacto). Sem series longas, sem documentos, sem 2160 candles.
FULL no 1o ciclo; DELTA nos seguintes (changed compacto `path:[from,to]`, removed, events, stillValid,
assessment anterior do MESMO agente). Fingerprint SHA-256 curto por pacote (auditoria) — ver `factPackets` no selftest.

## 3. AUDITORIA LIVE — BLOCKED_NO_LIVE_OPPORTUNITY

Nenhuma oportunidade real disponivel: o broker nao esta ofertando expiracoes compraveis (OTC suspenso, decisao do operador).

| Evidencia (prod) | T0 2026-09-23T18:35:28Z | T75 2026-09-23T18:36:45Z |
|---|---|---|
| `discovery.offers` | 0 | 0 |
| `discovery.markets` | 54 | 54 |
| `lastIngestAt` | 18:35:08Z (fresco) | 18:36:38Z (fresco) |
| `candleCycles` | 52 | 52 (nenhum ciclo novo elegivel) |
| `cyclesSkippedNoOpportunity` | 62.300 | 67.367 (+5.067 em 75s) |
| `cyclesSkippedWindow` | 795 | 848 |
| `agentCycles` / `snapshots` / `approvals` | 0 / 0 / 0 | 0 / 0 / 0 |

- **TESTE 1 e TESTE 2: NAO EXECUTADOS** — sem opportunityId real, sem expirationAt real, sem candles live;
  nada foi fabricado, nenhum candle foi adiantado, nenhuma expiration foi alterada, nenhuma ordem foi enviada.
- **Provider budget: 0 de 14 calls gastas** na auditoria live.
- Contrafactual: **NO_TRADE / BLOCKED** (nao ha trade a avaliar; CANCEL hipotetico nao existe).
- Limitacao: repetir a auditoria quando o broker voltar a ofertar (OTC reaberto) — roteiro identico, 2 oportunidades reais.

## 4. Validacao suplementar da arquitetura (provider real, fixture sintetica — NAO e a auditoria live)

Execucao unica em prod pos-deploy, 2026-09-23T18:47:52Z (Off-Peak), modelo `deepseek-v4.1-flash`:

| role | status | latency | prompt | cached | output | reasoning | payload chars | cost USD* |
|---|---|---|---|---|---|---|---|---|
| RSI | OK | 3281ms | 780 | 0 | 369 | 0 | 628 | $0.000338 |
| DMI_ADX | OK | 2060ms | 646 | 256 | 324 | 0 | 455 | $0.000256 |
| BOLLINGER | OK | 3422ms | 699 | 0 | 300 | 0 | 466 | $0.000285 |
| ATR | OK | 3050ms | 663 | 0 | 366 | 0 | 511 | $0.000319 |
| PRICE_ACTION | OK | 2507ms | 1254 | 0 | 424 | 0 | 1822 | $0.000443 |
| ASSET | OK | 3485ms | 1618 | 512 | 293 | 0 | 2794 | $0.000342 |
| CONSENSUS_FINAL | OK | 5971ms | 2884 | 0 | 681 | 0 | 3050 | $0.000841 |
| **total** | **7/7 OK** | wall wave1 3569ms / wave2 6001ms / **9574ms** | **8544** | **768** | **2757** | **0** | — | **$0.002822904** |

- `available=true`, `finalGate.pass=true`, decisao do Consensus = CANCEL no fixture (gate nao inventou direcao).
- Zero HTTP 429/5xx, zero timeouts. `cached_tokens` apareceu em 2/7 calls (sessao reutilizada) —
  nao assumimos cache: usamos exatamente o usage retornado.
- *Custo = tokens medidos x preco oficial; **nao e fatura** (Go e assinatura com limites de uso, ver secao 6).

## 5. FULL vs DELTA (payload gerado localmente; sem chamadas extras)

Ciclo 1 FULL vs ciclo 2 DELTA (mesma oportunidade, novo candle), payload-only:

| role | FULL chars | DELTA chars | reducao |
|---|---|---|---|
| RSI | 641 | 693 | -8.1% |
| DMI_ADX | 468 | 609 | -30.1% |
| BOLLINGER | 479 | 670 | -39.9% |
| ATR | 524 | 595 | -13.5% |
| PRICE_ACTION | 1849 | 1116 | +39.6% |
| ASSET | 2821 | 1249 | +55.7% |
| **total payload** | **6782** | **4932** | **+27.3%** |
| total com system prompts | 15474 | 13624 | +12.0% |

- Papéis ricos economizam de verdade; em papéis muito compactos, um ciclo de alto churn pode fazer o DELTA
  ficar marginalmente maior (comportamento honesto, documentado).
- Estimativa local do DELTA (sem chamada): ~1.233 tokens (chars/4) — **ESTIMATE**.
- A economia vem de **prompt menor**, nunca de cache presumido.

## 6. Preco oficial OpenCode Go (consulta no momento da execucao)

- Fonte: `https://opencode.ai/docs/go` — consulta UTC 2026-09-23T18:35Z.
- Modelo: `deepseek-v4.1-flash` (endpoint `https://opencode.ai/zen/go/v1/chat/completions`).
- Off-Peak: input $0.15 /1M · cached read $0.003 /1M · output $0.60 /1M (o teste rodou Off-Peak).
- Peak: input $0.30 /1M · cached read $0.006 /1M · output $1.20 /1M.
- Regra de horario: Peak = 01:00–04:00 e 06:00–10:00 UTC, segunda a sexta; demais horarios/fins de semana Off-Peak.
- Limite mensal promocional 4x (ate 2026-09-27): $60 de usage (regular $15).

### Projecao (a partir do ciclo suplementar medido; Off-Peak; sem extrapolar lucro/WR)

| volume | prompt | output | custo estimado |
|---|---|---|---|
| 1 ciclo | 8.544 | 2.757 | **$0.002822904** |
| 1.000 ciclos | 8.544.000 | 2.757.000 | **≈ $2.82** |
| 10.000 ciclos | 85.440.000 | 27.570.000 | **≈ $28.23** |
| 10.000 ciclos (Peak) | idem | idem | ≈ $56.46 |

- Separacao: **PROVIDER-MEASURED TOKENS** (tabela secao 4) vs **ESTIMATED GO USAGE-VALUE** (acima).
- Nao e cobranca de fatura; e o valor de usage conforme a tabela oficial.

## 7. Testes e integridade

- `tests/v3`: 10 arquivos / **85 testes verdes** (inclui normalizacao string->lista, independencia, concorrencia 6,
  Wave 2 apos 6/6, 7 calls exatas, fail-closed, gate sem analise tecnica, grounding, scenario library, deadline).
- `v3-smoke`: **14/14**; `run-all-tests`: **25/25**; security/secret-scan: **72/72**; `npm run build`: OK.
- Timing preservado: janela analysis (300s,330s], alvo ~TTE302, corte duro TTE300, grade 60s.
- V2 frozen intocado (manifest ACTIVE/frozen, hash inalterado). Supabase segue `ROTATION_PENDING_EXTERNAL`.

## 8. Estado final de flags (prod)

`V3_ENABLED=true` (OBSERVE_ONLY) · `V3_AGENTS_ENABLED=false` · `agentMode=DETERMINISTIC_OBSERVE` ·
`executionMode=OBSERVE_ONLY` · `executable=false` · PRACTICE auto OFF · REAL DISARMED ·
nenhuma ordem · nenhum PATH_TEST · approvals=0 · snapshots=0 · scheduler fired=0.

## 9. Limitacoes / proximos passos

1. Auditoria live pendente de mercado real (bloqueio externo); roteiro: 2 opportunities distintas, 14 calls max,
   congelar snapshot no Consensus, entrada teorica no target ~302s, settlement na expiration real, contrafactual causal.
2. DELTA em papéis compactos pode nao reduzir bytes em ciclos de alto churn — monitorar por fingerprint/payload.
3. `cached_tokens` pode variar de 0 a parcial; manter medicao por call (nunca presumir cache).
