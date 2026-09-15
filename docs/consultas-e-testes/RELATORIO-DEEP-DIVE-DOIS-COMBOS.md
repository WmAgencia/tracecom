# Relatório — Mergulho profundo: `reversion-v3+Fibonacci` vs `reversion-v1+VWAP`

Data: 2026-09-15 · Todos os sinais históricos (amostra completa) + recorte dos últimos 100 · dados reais (EUR/USD, NZD/USD, EUR/NZD) · T+45s e T+60s.

## Veredito rápido

| Combo | Amostra completa (T+60) | IC95 | Veredito |
|---|---|---|---|
| **reversion-v3 + Fibonacci** | **66,7% (40W/20L, n=60)** | **54,1% – 77,3%** | ✅ **CONFIRMADO — vai para validação forward** |
| reversion-v1 + VWAP | 53,8% (127W/109L, n=331) | 47,4% – 60,1% | ❌ **NÃO confirmado** (o 78,4% era artefato de recência) |

## 1. `reversion-v3 + Fibonacci` — detalhado

**Regra**: vol<0,0012 + RSI extremo (|s|>(55−RSI)/45 > 0,22) alinhado à tendência de 120s + preço na zona dourada (38,2–61,8%) do swing de 24 candles, no contexto de swing correto.

| Corte | N | W/L/D | WR | IC95 |
|---|---|---|---|---|
| **Tudo (T+60)** | 60 | 40/20/0 | **66,7%** | 54,1% – 77,3% |
| Tudo (T+45) | 62 | 36/25/1 | 59,0% | 46,5% – 70,5% |
| BUY (T+60) | 51 | 36/15/0 | **70,6%** | 57,0% – 81,3% |
| SELL (T+60) | 9 | 4/5/0 | 44,4% | 18,9% – 73,3% |
| 1ª metade | 30 | 17/13/0 | 56,7% | — |
| 2ª metade | 30 | 23/7/0 | **76,7%** | — |
| EUR/NZD | 23 | 19/4/0 | **82,6%** | 62,9% – 93,0% |
| EUR/USD | 13 | 8/5/0 | 61,5% | — |
| NZD/USD | 24 | 13/11/0 | 54,2% | — |

**Pontos fortes**: consistência entre metades (56,7% → 76,7%, sem degradação); lado BUY forte (70,6%); excelente no ativo atual EUR/NZD (82,6%).
**Ponto fraco**: lado SELL fraco (n=9) — considerar BUY-only na validação.

## 2. `reversion-v1 + VWAP` — por que NÃO passou

| Corte | N | W/L/D | WR | Observação |
|---|---|---|---|---|
| **Tudo (T+60)** | **331** | 127/109/95 | **53,8%** | amostra real; **63 dos últimos 100 são empates** |
| Últimos 100 (T+60) | 100 | 29/8/63 | 78,4%* | *efeito de recência + empates (só 37 decisões) |
| 1ª metade | 165 | 86/60/19 | 58,9% | — |
| 2ª metade | 166 | 41/49/76 | **45,6%** | degrade — período de empates |
| EUR/NZD | 115 | 34/17/64 | 66,7% | ok no ativo atual |
| EUR/USD | 158 | 56/83/19 | **40,3%** | destrói no EUR/USD |
| NZD/USD | 58 | 37/9/12 | 80,4% | ótimo (ativo da época) |

**Conclusão**: o número de 78,4% que apareceu no relatório anterior era um **viés de recência** — os últimos 100 sinais concentraram-se num período de preço estático (63 draws) e um regime favorável. Na amostra completa (331 sinais), o filtro VWAP vale 53,8% e **degrada entre metades**, com comportamento extremo por ativo (40% EUR/USD vs 80% NZD/USD). Falhou o teste de robustez — **não recomendado** como está.

## 3. Próximos passos (spec para o motor)

Implementar `shadow-reversion-v3-fib` (T+60, opcionalmente BUY-only):
1. Condições base da reversion-v3 (vol<0,0012; |s|>0,22; mom120 alinhado) **E**
2. Fibonacci: swing de 24 candles (maior alta/menor baixa) → níveis 38,2–61,8% → preço dentro da zona **E** contexto de swing correto (compra só em swing de alta; venda só em swing de baixa).
3. Horizonte T+60; liquidação causal padrão.
4. Validação forward: 100 trades. Com n=60 já em 66,7% e IC95 inf 54,1%, é o candidato mais forte já produzido pelo projeto.

**Bloqueios atuais**: (a) o stream de captura está offline (EUR/NZD, desde 00:21Z); (b) o source do motor foi perdido com o D: — para adicionar a estratégia ao relay é preciso reconectar o D: ou reconstruir o arquivo `relay/experiment.mjs` a partir do comportamento documentado.

## Arquivos

- `exports/research-two-combos/deep-dive-two-combos.json` — todos os cortes.
- `exports/research-two-combos/reversion-v3-fib-t60.csv` · `reversion-v1-vwap-t60.csv` — trades individuais.
- `scripts/deep-dive-two.js` — motor de avaliação.
