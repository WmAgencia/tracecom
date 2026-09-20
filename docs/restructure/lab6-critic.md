# LAB 6 — FRESH CRITIC (pre-T0)

Data: 2026-09-20T22:36:14.808Z · Run: lab6-20260920-practice

## Checklist de riscos (com evidencia)
| Risco | Veredito | Evidencia |
|---|---|---|
| future leak | OK | teste 02 (candle futuro excluido) + teste 16 (snapshot.at <= now); swing fib confirma em i+3 (candles fechados) |
| strategy cross-contamination | OK | testes 03/04 (states independentes, determinismo) |
| duplicate orders | OK | idempotencia = strategyTradeId (teste 06) + IdempotencyStore do runtime |
| incorrect settlement attribution | OK | teste 11 (join por decision_id; S02 intocada) |
| 20-cap race | OK | teste 09/10 (UPDATE atomico com reserva de slot) |
| restart race | OK | teste 13 (recovery de contadores/trades abertos via DB) |
| Fibonacci hindsight | OK | anchors confirmados causalmente (pivot 3, confirmacao em i+3); anchorA/B e confirmedAt persistidos |
| snapshot mismatch | OK | teste 01 (mesmo snapshotId nas 6) + teste 15 (feature engine compartilhado) |
| PRACTICE/REAL leak | OK | teste 08 + guarda dura no runtime (LAB_PRACTICE_ONLY / LAB_PRACTICE_ONLY_CONTEXT) |
| scheduler regression | OK | teste 16 (causal) |
| safe-cutoff regression | OK | teste 17 (missed, sem submit) |
| memory growth | OK | decisoes com coalescing (mudanca/60s/approval); entry snapshots apenas por trade (<=120) |
| duplicated Feature Engine | OK | teste 15 (1 snapshot com tudo) |
| duplicated feed | OK | teste 14 (router nao reconstroi snapshot; 1 build por mercado/avaliacao) |

## Achados reais
- Bug de TESTE (nao de producao): teste 18 usava expiry no passado do fixture e caia no cutoff em vez do gate — corrigido no teste; suite agora 20/20.
- Nenhum outro problema real encontrado.

## Limitacoes declaradas
- Amostra exploratoria (20 settlements/estrategia). Sem claim de edge/WR verdadeiro.
- EntryQuality A/B/C congelado pre-settlement (support/counter), nunca reclassificado por resultado.
