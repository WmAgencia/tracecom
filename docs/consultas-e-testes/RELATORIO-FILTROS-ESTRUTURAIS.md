# Relatório — Filtros estruturais (como Fibonacci) aplicados em TODAS as estratégias

Data: 2026-09-15 · 7 filtros × 21 estratégias × 2 horizontes · avaliação causal sobre 8.327 observações reais (EUR/USD, NZD/USD, EUR/NZD) · últimos 100 sinais por variante.

## Filtros testados (mesma família do Fibonacci — níveis "ímã" de preço)

| Filtro | O que é | Fonte clássica |
|---|---|---|
| `fib` | Zona dourada 38,2–61,8% do swing | Fibonacci (já validado) |
| `pv` | Pivot Points (PP, S1, R1) da janela de 100 candles | Pivot clássico |
| `vw` | VWAP/TWAP (média das últimas 60 barras) | VWAP institucional |
| `rn` | Números redondos (múltiplos de 0,0050) | Níveis psicológicos |
| `kj` | Kijun-sen (mediana do range de 26) | Ichimoku |
| `sw` | Swing high/low de 50 candles | Estrutura de mercado |
| `pr` | Range anterior (high/low da janela -119…-60) | Máx/mín anteriores |

Regra: o sinal só passa se o preço estiver a menos de ~0,06% do nível do filtro.

## Agregado (T+60; só combos com n≥30)

| Filtro | Estratégias melhoraram | Pioraram | Δ médio |
|---|---|---|---|
| **fib** | **7** | **2** | **+5,0** |
| kj | 8 | 10 | +0,9 |
| rn | 10 | 8 | +0,4 |
| vw | 7 | 10 | −0,2 |
| pv | 9 | 8 | −2,3 |
| sw | 4 | 14 | −4,8 |
| pr | 2 | 9 | −5,9 |

## Melhores combos (Δ = ganho do filtro sobre a base)

| Combo | Base | Com filtro | Δ | n |
|---|---|---|---|---|
| **reversion-v1 + vw (VWAP)** | 58,0% | **78,4%** | **+20,4** | **100** ⭐ |
| reversion-v5 + kj | 40,0% | 66,7% | +26,7 | 43 |
| reversion-v3 + fib | 54,4% | 70,6% | +16,2 | 51 |
| reversion-v2 + vw | 48,0% | 63,8% | +15,8 | 100 |
| reversion-v2 + fib | 48,0% | 61,0% | +13,0 | 82 |
| macd-rsi-v1 + rn | 52,6% | 63,3% | +10,7 | 60 |
| reversion-v2 + pv | 48,0% | 58,7% | +10,7 | 100 |
| rsi-div-v1 + kj | 47,0% | 57,0% | +10,0 | 100 |
| snapback-v1 + fib | 59,6% | 66,7% | +7,1 | 73 |
| dual-rsi-v1 + sw | 55,0% | 61,6% | +6,6 | 100 |

## Conclusões

1. **O melhor filtro novo é o VWAP/TWAP**: `reversion-v1 + vw` = **78,4% em 100 trades** — o resultado com amostra cheia mais forte de todo o projeto (base era 58%). Também melhora a v2 para 63,8% (n=100) e a irmã dual-rsi.
2. **Padrão confirmado**: filtros de nível (fib, vwap, kijun, pivot, redondo) ajudam a **família de reversão** — eles marcam onde o preço tem maior chance de "voltar". Filtros de estrutura bruta (swing, range anterior) **pioram quase tudo** — são gatilhos de momentum.
3. **Kijun-sen é o segundo melhor**: recupera a reversion-v5 (40%→66,7%) e o rsi-div (47%→57%).
4. **Ressalva estatística obrigatória**: testamos 7×21=147 combinações — parte do ganho pode ser seleção. Os candidatos com **n=100** (rev1+vw, rev2+vw, rev2+pv, rev2+fib) são os que merecem validação forward; os de n~40-60 (v5+kj, v3+fib) são promessas.
5. **Próximo passo recomendado**: validar forward, com 100 trades cada, o trio `reversion-v1+vw`, `reversion-v2+vw` e `snapback-v1+fib` (T+60).

## Arquivos

- `exports/research-filters/filters-all-summary.json` — todos os 7 filtros × 21 estratégias × T+45/T+60.
- `scripts/research-filters-all.js` — motor de avaliação.
