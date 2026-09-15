# FEATURE CATALOG — GAUNTLET (todas CAUSAIS: usam somente observações com t < bucketEnd(T0))

Extraídas por `scripts/gauntlet-features.cjs` (2.592 snapshots; 5s candles reais ACCEPTED/OTC/VALID; warm-up ≥31 candles).
Convenções: candle = bucket floor(t/5000); close = último close; atr14 = média(high−low, 14); sma20 = média(closes, 20); s = (55−RSI14)/45; vol12 = sd(12 retornos 1-candle); mom/ROC em candles (24 candles = ~120s).

## Preço-ação
r1, r1p, r3, r6, r12, r24, r60 (retornos multi-janela) · accel (r1−r1p) · bodyRatio |c−o|/(h−l) · upperWick · lowerWick · bull5/bull10 (contagem alta no candle) · streak (sequência com sinal) · doji · bigCandle (range>2·atr14 clamp) · range4/range20 e expansion (ratio) · boUp/boDown (fecha além de máx/mín de 24, excluindo o atual) · falseBoUp/falseBoDown (rompeu e fechou de volta, últimas 4) · pivH/pivL (fractal 2-2; último pivô em 48) · distPH/distPL (em ATR) · estrutura HH/HL/LH/LL (2 últimos pivôs de cada lado → UP/DOWN/RANGE) · beyondExt (além de 1,272 do swing 24).

## Tendência
sma10/sma20/sma50 · ema9/ema21 · distSma20/distSma10/distEma21 (normalizados por atr14).

## Momentum
rsi14, rsi7, s · macd/macdSig/macdHist(12,26,9, hist normalizado por atr) · stochK/stochD(14,3) · bullDiv/bearDiv (fechamento faz mínima/máxima mais extrema que 6 candles atrás e RSI diverge — janela termina em T).

## Volatilidade
atr14/atr50/atrPct · atrRatio (14/50) · vol12/vol24/vol60 · bbB (%B de Bollinger 20,2) · bbWidth (4·sd20/sma20) · expansion (acima).

## Fibonacci (swing 24 causais, mesmas definições congeladas da produção)
fibHi/fibLo · upSwing (primeiro mínimo antes do primeiro máximo) · inZone (zona 38,2–61,8%) · pos ∈[0,1] no range · distFib (distância ao nível mais próximo 0.236/0.382/0.5/0.618/0.786, em % do range) · fib_deep (metade inferior/superior da zona conforme contexto) · gate fibOk(direção) = inZone E (BUY→upSwing · SELL→!upSwing).

## Suporte/Resistência
pivôs fractal-2 · distPH/distPL normalizadas · wick_rej (wick superior >50% em ≤0,3 ATR do pivô de topo → -1; espelhado em fundo) · sr_rev (proximidade aos pivôs).

## Regime / Contexto
er30/er60 (efficiency ratio) · gates: chop (er<0.35), trend (er>0.55) · vol gates (0.0009/0.0012/0.0018) · hora UTC · minuto de sessão · expansão de range.

## Causalidade
Construção em `buildSeries` usa apenas obs com `o.t < bucketEnd`; rótulos l60 vêm de [t0+60s, t0+90s]. Spot-checks de 5 snapshots reconstruídos do banco bit-exact (Critic A §C / Critic B §4). Nenhuma feature normalizada por estatística do dataset inteiro (thresholds fixos/dominio ou ajustados apenas no DISC).
