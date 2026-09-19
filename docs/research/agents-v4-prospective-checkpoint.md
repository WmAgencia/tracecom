# CHECKPOINT PROSPECTIVO V4 — primeiros minutos em producao (SHADOW)

- **Data:** 2026-09-19 (UTC-3). **Ambiente:** relay `tracecom-live-relay` (Railway production) +
  Vercel `tracecom.consecom.com.br` + Supabase.
- **Fonte:** `GET /api/iq/research/agents-v4` (dados reais) + `iq_agents_v4_observations` (Postgres).
- **Modo:** SHADOW_ONLY; nenhuma ordem V4; G2 continua o unico caminho de execucao; REAL LOCKED.

## 1. Estado dos agentes por mercado (n = 30 mercados ativos)

| Dimensao | Distribuicao |
|---|---|
| dataQuality | **HEALTHY 30** / DEGRADED 0 / UNSAFE 0 |
| regimes | TREND_UP 13 · TRANSITION 7 · TREND_DOWN 5 · UNCERTAIN 5 |
| acoes V4 | WAIT 24 · BUY 3 · SELL 3 |

Leitura: TREND_UP/TREND_DOWN/TRANSITION sao alcancados com features reais no feed vivo — o defeito
estrutural do V3 (0% TREND) nao se repete. BUY/SELL/WAIT sao todos alcancaveis.

## 2. Benchmark G2 × V3 Frozen × V4 (n = 19 oportunidades G2)

| Versao | BUY | SELL | WAIT | NO_TRADE |
|---|---|---|---|---|
| G2_CURRENT | 11 | 8 | 0 | 0 |
| SCENARIO_ENGINE_V3_FROZEN | 0 | 0 | 19 | 0 |
| PROFESSIONAL_AGENT_SYSTEM_V4 | 1 | 3 | 15 | 0 |

- `g2V3 = 0%` — a V3 congelada segue 100% WAIT exatamente como no diagnostico causal.
- `v3V4 = 78,9%` — V4 concorda com a V3 em 15/19 (WAIT), mas decide BUY/SELL em 4/19 quando o
  gating por cenario e o trigger existem (V4 nao e 100% WAIT).
- `g2V4 = 21,1%` — as oportunidades em que G2 entra e o V4 aceita a tese.

Cenarios V4 nas oportunidades: TREND_PULLBACK 14 · TREND_CONTINUATION 2 · FAILED_BREAKOUT 1 ·
REVERSAL 1 · TRANSITION_NO_TRADE 1.
Regimes V4 nas oportunidades: TREND_UP 10 · TREND_DOWN 7 · TRANSITION 2.
Conflitos registrados: TREND_VS_TRANSITION 16 (todos nao-materiais; nao forcaram WAIT).

## 3. Settlement observacional

- `settlement.settled.total = 1` (WIN 1 / LOSS 0 / DRAW 0), basis **CAUSAL_COUNTERFACTUAL**,
  provenance **PROSPECTIVE_SHADOW**. Nenhum `BROKER_EXECUTED` vindo do V4.
- Observacoes sem direcao (WAIT/NO_TRADE) nao entram na liquidacao causal (comportamento esperado).

## 4. Performance em producao

| Metrica | Valor |
|---|---|
| Latencia analyze V4 p50/p95/p99/max | 0 / 1 / 1 / 8 ms |
| DataHub | 36.221 eventos publicados; ~147 eventos/s; latencia de entrega p95 = 2 ms |
| Coverage ao vivo | 128 snapshots T0 na janela; 100% de disponibilidade nas 21 features auditadas |
| Persistencia | `iq_agents_v4_observations` com payload + T0; migration 034 aplicada |

## 5. Coverage prospectiva por feature (DATABASE_PROSPECTIVE, n = 81 snapshots)

`docs/research/data/agents-v4-feature-coverage.json`: 21 features, todas com
`available=100% / missing=0% / stale=0%`, separadas por NORMAL/OTC (mercados observados: OTC).

## 6. Notas de infraestrutura

- O push no GitHub **nao dispara deploy automatico** (nem Vercel nem Railway). O deploy foi feito
  manualmente: `vercel --prod` e `railway up` no servico `tracecom-live-relay`.
- Correcoes encontradas SOMENTE em producao e ja aplicadas/redeployadas: leitura de clock/timeValid da
  sessao (falso UNSAFE apos restart) e semantica de duplicatas do feed IQ (reentrega de vela e
  protocolo, nao anomalia).
- Proximos checkpoints: repetir este endpoint/relatorio e rodar
  `scripts/agents-v4-coverage.mjs --from-db` conforme N cresce. G2/V3/V4 permanecem independentes.
