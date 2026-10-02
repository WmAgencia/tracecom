# Manual das estratégias do walk-forward (mercado real não-OTC) — set/2026

Código único de referência: `diagnostic-results/walk_forward_real.mts`. Todos os sinais são **causais** (decisão no close do candle `i` usando somente dados ≤ `i`) e o outcome é binário: direção certa do close `i+h` vs close `i` (`evaluateOutcome` do repo, `minMovePct=0`, **flat excluído**). Nenhuma estratégia olha volume, order book, spread ou notícia — só preço de fechamento e hora.

## 0. O que TODAS olham antes de agir (base comum)

Antes de qualquer sinal, o motor constrói, a partir dos closes:

1. **`closes[]`** — preços de fechamento dos candles fechados (o candle em formação nunca entra).
2. **`rets[i]`** — log-retorno do candle `i`: `ln(close_i / close_{i-1})`.
3. **`rsi2[i]` / `rsi14[i]`** — RSI de Wilder com período 2 e 14 (`100 − 100/(1+g/l)`, suavização `(g×(p−1)+ganho)/p`).
4. **`sma20[i]`, `sd20[i]`** — média e **desvio-padrão populacional** das últimas 20 fechamentos (base das Bandas de Bollinger 2.0σ/2.5σ).
5. **`volMed`** — mediana de `|rets|` de toda a série (corte do filtro de volatilidade).
6. **`hourUtc(i)`** — hora UTC do candle (corte de sessão).

Premissa econômica comum: nas análises anteriores (ACF lag-1 negativa em FX 1m, VR(5)<1) o intradiário dos subjacentes mostrou **reversão à média**, não tendência — por isso todas as 7 estratégias são de **contra-movimento** (fade).

Filtros opcionais (aplicados depois do sinal; se o filtro reprovar, não há operação):
- `all` — sempre aprova.
- `london` — hora UTC do candle entre 07:00 e 16:00 (sessão de Londres, a mais volátil nas 18/18 séries).
- `highvol` — `|rets[i]| > volMed` (só age em candles acima da volatilidade mediana).
- `lowvol` — `|rets[i]| ≤ volMed`.

Horizontes testados: **h1** (candle seguinte) e **h5** (5 candles à frente). A operação "entra" no close do candle do sinal (em produção real, seria no primeiro tick seguinte — pequena diferença de slippage não modelada).

## 1. fade1 — fade do último candle

- **Olha**: apenas o sinal de `rets[i]`.
- **Regra**: `rets[i] > 0` → entra **DOWN**; `rets[i] < 0` → entra **UP**; ret exatamente 0 → nada.
- **Racional**: candles isolados em séries mean-reverting tendem a ser corrigidos no seguinte.
- **Melhores resultados OOS**: USD/CAD 5m/highvol h1 62.3%, GBP/USD 5m/highvol h5 57.9%, AUD/USD 5m/all h5 55.2%, NZD/USD 5m/highvol h5 54.4%.
- **Onde brilha/fracassa**: frequência altíssima em FX 1m com highvol (até 0,57 ops/min no USD/JPY 1m, WR ~50% — sem edge); forte em FX 5m com filtro highvol.

## 2. fade3 — fade de 3 candles consecutivos

- **Olha**: `rets[i]`, `rets[i−1]`, `rets[i−2]`.
- **Regra**: 3 retornos consecutivos positivos → **DOWN**; 3 negativos consecutivos → **UP**; caso contrário nada.
- **Racional**: exaustão de micro-tendência; exige 3 candles na mesma direção (sinal mais raro e mais seletivo que fade1).
- **Resultados OOS**: BTCUSDT 1h/highvol h1 60.4%, ETHUSDT 1h/highvol h5 60.2%, USD/CAD 1m/all h5 62.2%; em cripto 1m/5m fica ~48–53%.

## 3. bb — Bollinger 2.0σ revert (o melhor do grid)

- **Olha**: `closes[i]` vs banda `sma20[i] ± 2.0 × sd20[i]`.
- **Regra**: close **acima** da banda superior → **DOWN**; close **abaixo** da banda inferior → **UP**; dentro das bandas → nada.
- **Racional**: preço esticado ≥2σ da média de 20 é o evento de reversão clássico; alinhado à premissa mean-reverting.
- **Melhores resultados OOS**: **ETHUSDT 5m/all h5 69.6% [64.1, 74.5] (201W/88L, 289 ops)**, BTCUSDT 5m/highvol h5 61.8%, USD/JPY 1h/london h5 61.3% (com bb25 idêntico), USD/CAD 1m 80.7% ⚠ (artefato de quantização — não usar).
- **Observação de implementação**: o sd é **populacional** (÷20) e calculado sobre closes, não sobre retornos; bug anterior (usava log-retorno) já corrigido.

## 4. bb25 — Bollinger 2.5σ revert

- **Olha**: igual ao bb, com banda `± 2.5 × sd20`.
- **Regra**: mesmo mapeamento (acima → DOWN, abaixo → UP).
- **Racional**: versão mais seletiva — só extremos maiores disparam (menos operações, teoricamente mais limpas).
- **Resultados OOS**: praticamente não sobreviveu à seleção; no USD/JPY 1h/london h5 empata com bb (61.3%). Sinais raros demais para n confortável na maioria das séries.

## 5. rsi2 — RSI(2) extremo moderado

- **Olha**: `rsi2[i]` (RSI de Wilder, período 2 — média de ~2 candles de ganho/perda).
- **Regra**: `rsi2 < 10` → **UP**; `rsi2 > 90` → **DOWN**; entre 10 e 90 → nada.
- **Racional**: RSI(2) é o indicador clássico de sobre-venda/sobre-compra de curtíssimo prazo ( Larry Connors-style); capta exaustão em 2–3 candles.
- **Resultados OOS**: USD/CAD 1m/highvol h5 76.4% ⚠ (mesmo artefato), ETHUSDT 5m/all h5 61.5% (n=603, o maior n do grid ≥60%), ETHUSDT 5m/highvol h5 61.5%, USD/CAD 1m/all h1 63.9%, USD/CHF 5m/all h5 60.9%.

## 6. rsi2x — RSI(2) extremo severo

- **Olha**: `rsi2[i]`.
- **Regra**: `rsi2 < 5` → **UP**; `rsi2 > 95` → **DOWN**; caso contrário nada.
- **Racional**: só os extremos absolutos (quase só quando houve queda/risquimento monotônico de 2+ candles) — ainda mais seletivo que rsi2.
- **Resultados OOS**: ETHUSDT 5m/all h5 62.7% (n=308), USD/CAD 1m 72–74% ⚠, BTCUSDT 1h/lowvol h1 58.9%.
- **Trade-off vs rsi2**: menos operações (n menor → IC mais largo), WR levemente maior em cripto 5m.

## 7. rsi14 — RSI(14) clássico

- **Olha**: `rsi14[i]` (Wilder 14, o RSI padrão de plataforma).
- **Regra**: `rsi14 < 30` → **UP**; `rsi14 > 70` → **DOWN**; entre 30 e 70 → nada.
- **Racional**: sobre-venda/sobre-compra tradicional; mais lento que RSI(2), pega reversões de meio período em vez de micro-pullbacks.
- **Resultados OOS**: em geral inferior aos de período curto neste dataset — melhor caso AUD/USD 1m/all h5 51.5% (n=101); só entrou na seleção de 1 dos 27 pares ativo×TF. Conclusão empírica: em 1m/5m/1h intradiário, RSI lento vira sinal tarde demais; a velocidade do RSI(2) casa melhor com horizontes de 1–5 candles.

## 8. Como reproduzir tudo

```bash
# 1. Dados (já coletados; NÃO recolher se os CSVs existem):
ls diagnostic-results/data/*.csv   # 18 CSVs + MANIFEST.json

# 2. Grid completo + relatório por ativo (WR, W/L, ops/min, ops testadas):
npx tsx diagnostic-results/walk_forward_real.mts
# -> diagnostic-results/walk-forward-real-results.json (campo "perSymbol")
# -> console imprime a tabela por ativo

# 3. Auditoria do dado antes de acreditar em qualquer WR alto:
npx tsx diagnostic-results/audit_usdcad_1m.mts   # duplicatas, flats, micro-moves, ACF

# 4. Métricas estatísticas de fundo (ACF/VR/sessões) se quiser revalidar a premissa:
npx tsx diagnostic-results/otc_proxy_pattern_analysis.mts
```

Para **testar uma estratégia nova**: adicione um objeto em `STRATS` no `walk_forward_real.mts` com `name`, `params` e uma função `dir(ctx, i)` que retorna `"up" | "down" | null` usando apenas `ctx.closes/rets/rsi2/rsi14/sma20/sd20/volMed/hourUtc` no índice `i` (nada de `i+1` ou além — causalidade). O grid, split 70/30, seleção por treino e IC Wilson são automáticos.

Para **operar ao vivo (paper primeiro)**: no fechamento de cada candle do TF escolhido, recalcule os indicadores com a janela dos últimos 20+ candles, aplique a regra + filtro, e se houver sinal registre entrada no tick seguinte e desenlace no close `h` candles depois. Compara com o OOS reportado — se a WR live divergir >5 p.p. do IC OOS após ~100 operações, o setup não validou.

## 9. Verdades do grid que valem mais que qualquer estratégia isolada

1. **Reversão > momentum** neste mercado intradiário: fade1 em FX 1m dá ~40–44% *a favor* do momentum, logo ~56–60% contra (os setups acima são exatamente isso).
2. **Cripto 5m + Bollinger/RSI2 é o bloco mais sólido** (n grande, dado da Binance de boa qualidade, sem artefato de quantização).
3. **Filtro highvol ajuda em FX, é neutro/ruim em cripto** (cripto não tem sessão fechada; o filtro de hora "london" só empata com all).
4. **H5 batendo H1** na maioria dos pares: 1 candle é ruído demais mesmo para reversão; 5 candles dá tempo da reversão acontecer.
5. **Nenhuma estratégia foi validada com spread real, latência ou em conta** — os WRs são close-to-close. Antes de dinheiro real: forward paper 2–4 semanas e conferência do IC-lower vs breakeven do payout.
