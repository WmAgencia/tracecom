# ESTRATÉGIA CAMPEÃ — `reversion-v3 + Fibonacci` (especificação reprodutível)

> Documento de referência para reprodução por qualquer pessoa/IA. Contém: lógica exata, matemática, critérios de entrada/saída, liquidação, estatísticas completas (wins/losses), lista de trades com preços e pseudocódigo executável.

## 1. Resumo do veredito

**A `reversion-v3 + Fibonacci` é a melhor estratégia descoberta no projeto até agora.**

| Métrica (T+60s, todos os sinais) | Valor |
|---|---|
| N total | 60 trades |
| Wins / Losses / Draws | **40 / 20 / 0** |
| **WR (wins/(wins+losses))** | **66,7%** |
| IC95 (Wilson) | **54,1% – 77,3%** |
| 1ª metade → 2ª metade | 56,7% → 76,7% (melhora, sem degradação) |
| Lado BUY | **70,6%** (36W/15L, n=51) |
| Lado SELL | 44,4% (4W/5L, n=9) — amostra pequena |
| EUR/NZD (ativo atual) | **82,6%** (19W/4L, n=23; IC95 62,9%–93,0%) |
| EUR/USD | 61,5% (8W/5L, n=13) |
| NZD/USD | 54,2% (13W/11L, n=24) |

Em T+45s: 59,0% (36W/25L/1D, n=62). O horizonte ótimo é **T+60**.

## 2. Dados de entrada (schema e filtros)

Fonte: tabela `price_observations` (Postgres). Só entram linhas com:

```sql
status = 'ACCEPTED'
AND asset_canonical IS NOT NULL
AND market_type = 'OTC'
AND context_validation_status = 'VALID'
```

Agrupamento: por `(session_id, segment_id, asset_canonical)`, ordenado por `observed_at`.

Observação: os valores são os preços lidos da tela da corretora (EUR/USD, EUR/NZD ou NZD/USD OTC), com timestamp do momento da leitura. **Nenhum preço é fabricado.**

## 3. Construção dos candles (5 segundos)

Para cada observação, `bucket = floor(t_ms / 5000) * 5000`. Cada bucket gera um candle:

- `open` = primeiro valor do bucket
- `high` = máximo dos valores
- `low` = mínimo dos valores
- `close` = último valor
- `start` = bucket

Somente candles com histórico suficiente (mínimo 30 candles antes) são avaliados.

## 4. Indicadores (matemática exata)

Todas as fórmulas usam `closes = [close_0 … close_n]` (fechamentos até o candle atual `i`).

**a) RSI(14) — média simples (não-Wilder):**
```
g = soma das diferenças positivas (d >= 0) nos últimos 14 intervalos
l = soma das magnitudes das diferenças negativas
RSI = 100 − 100 / (1 + g/l)   ; se l = 0 → RSI = 100
```

**b) Mapeamento do extremo:**
```
s = (55 − RSI) / 45
s > 0 → queda (sobrevendido) ; s < 0 → alta (sobrecomprado)
```

**c) Volatilidade realizada (12 retornos de 5s):**
```
r_j = (close_j − close_{j−1}) / close_{j−1}   para os últimos 12 intervalos
vol = desvio-padrão(r_1..r_12)
```

**d) Momento 120s:**
```
mom120 = (close_n − close_{n−24}) / close_{n−24}
```

**e) Fibonacci (janela de 24 candles, incluindo o atual):**
```
hi = máximo dos highs da janela ; lo = mínimo dos lows
hiIdx = primeiro índice onde high == hi ; loIdx = primeiro índice onde low == lo
upSwing = (loIdx <= hiIdx)            // fundo veio antes do topo = perna de alta
range = hi − lo
lv382 = upSwing ? hi − 0.382*range : lo + 0.382*range
lv618 = upSwing ? hi − 0.618*range : lo + 0.618*range
zonaDourada = [min(lv382, lv618), max(lv382, lv618)]
inZone = close_n dentro da zonaDourada
```

## 5. Regra de entrada (determinística)

**Compra (BUY)** se TODAS:
1. `vol < 0,0012`
2. `s > 0,22` (RSI ≈ abaixo de 45)
3. `mom120 > 0` (tendência de 120s para cima)
4. `upSwing == true` (perna recente de alta)
5. `inZone == true` (preço na zona dourada 38,2–61,8% do pullback)

**Venda (SELL)** se TODAS (espelho):
1. `vol < 0,0012`
2. `s < −0,22`
3. `mom120 < 0`
4. `upSwing == false`
5. `inZone == true`

**Limite**: no máximo 1 trade por candle por estratégia (dedupe por `market_event_id = session:start_do_candle`).

## 6. Liquidação (T+60s, causal)

- **Preço de entrada** = valor da última observação do candle do sinal (referência).
- **Preço de liquidação** = primeira observação com timestamp em `[entrada + 60s, entrada + 90s]` na MESMA sessão+segmento.
- **Resultado**: BUY vence se `saída > entrada`; SELL vence se `saída < entrada`; iguais = empate (DRAW); sem observação na janela = trade não conta.
- Sem usar nada do futuro além da janela de liquidação (100% causal).

## 7. Estatística

WR = wins / (wins + losses). IC95 via Wilson (z=1,96):
```
p = w/(w+l) ; denom = 1 + z²/n ; centro = (p + z²/2n)/denom
margem = z*sqrt(p(1−p)/n + z²/4n²)/denom ; IC = [centro−margem, centro+margem]
```

## 8. Lista completa de trades (auditável)

- `exports/research-repro-v3fib/reversion-v3-fib-t60-all.csv` — **os 60 trades** com: ativo, direção, timestamps ISO, preço de entrada, preço de saída, resultado.
- `exports/research-repro-v3fib/reversion-v3-fib-t60-eurnzd.csv` — só EUR/NZD (os 23).
- `exports/research-repro-v3fib/reversion-v6-t60-eurnzd.csv` — trades do comparativo (v6).

## 9. Pseudocódigo (pronto para reproduzir)

```js
for (const grupo of grupos(session, segment, asset)) {
  const candles = buildCandles(grupo);          // 5s
  for (let i = 30; i < candles.length; i++) {
    const closes = candles.slice(0, i+1).map(c => c.close);
    const rsi = rsiSimples(closes, 14);          // seção 4a
    const s = (55 - rsi) / 45;
    const vol = volRealizada(closes, 12);        // seção 4c
    const mom120 = (closes.at(-1) - closes.at(-25)) / closes.at(-25);
    const fib = fibZona(candles, i, 24);         // seção 4e → {upSwing, inZone}
    const buy  = vol < 0.0012 && s >  0.22 && mom120 > 0 && fib.upSwing  && fib.inZone;
    const sell = vol < 0.0012 && s < -0.22 && mom120 < 0 && !fib.upSwing && fib.inZone;
    if (!buy && !sell) continue;
    const ref = ultimaObservacaoDentroDoCandle(i);
    const settle = primeiraObservacaoEntre(ref.t + 60000, ref.t + 90000, grupo);
    if (!settle) continue;
    registraTrade(buy ? 'BUY' : 'SELL', ref.v, settle.v);  // WIN/LOSS/DRAW
  }
}
```

## 10. Ressalvas obrigatórias

1. **Amostra pequena (n=60)** — o número 66,7% é o melhor do projeto, mas ainda é retrospectivo e precisa de validação forward (100 trades).
2. **Lado SELL fraco** (n=9) — versão de produção deve ser **BUY-only** até o SELL provar valor.
3. **Seleção**: a zona Fibonacci foi escolhida após testes em várias variantes — existe risco de seleção; a estabilidade entre metades (56,7%→76,7%) e a coerência com a família (reversão melhora com filtros de nível) mitigam, mas não eliminam.
4. Regra de governança do projeto: **nenhuma promoção a produção sem validação forward com N≥100 e IC95 inferior > 50%.**
