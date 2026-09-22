/**
 * AGENTE CANDLES / PRICE ACTION — 6o especialista do grafo agentic.
 * Le a sequencia OHLC pura (sem RSI/Bollinger). Regras profissionais:
 *  - Padrao SEM localizacao e ruido: reversao so pesa no extremo da banda/zona Fibonacci.
 *  - Reversao exige extensao antes (Bulkowski: straight-line run) e/ou perda de impulso.
 *  - Rompimento falho (sweep de topo/fundo com fechamento de volta) = evidencia classica de reversao.
 *  - Marubozu/expansao com estrutura a favor = continuacao (nao fade).
 * Saida estruturada consumida pelo consenso (structure/direction/rejection).
 */
export const CANDLE_AGENT_VERSION = "agent-candle-v1";
const num = (v) => (v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function shape(candle) {
  const open = num(candle?.open); const close = num(candle?.close); const high = num(candle?.high); const low = num(candle?.low);
  if ([open, close, high, low].some((v) => v === null)) return null;
  const range = high - low;
  const body = Math.abs(close - open);
  return {
    open, close, high, low, range, body,
    bullish: close > open, bearish: close < open,
    upperWickRatio: range > 0 ? (high - Math.max(open, close)) / range : 0,
    lowerWickRatio: range > 0 ? (Math.min(open, close) - low) / range : 0,
    bodyRatio: range > 0 ? body / range : 0,
    closePos: range > 0 ? (close - low) / range : 0.5,
  };
}

function swingsOf(list, lookback = 2) {
  const highs = []; const lows = [];
  for (let i = lookback; i < list.length - lookback; i += 1) {
    const window = list.slice(i - lookback, i + lookback + 1);
    const high = Number(list[i].high); const low = Number(list[i].low);
    if (high === Math.max(...window.map((c) => Number(c.high)))) highs.push({ index: i, price: high });
    if (low === Math.min(...window.map((c) => Number(c.low)))) lows.push({ index: i, price: low });
  }
  return { highs, lows };
}

export function analyzeCandleAgent(snapshot) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const candles = Array.isArray(snapshot?.recentCandles) ? snapshot.recentCandles : [];
  const atr = num(snapshot?.indicators?.atr);
  const band = snapshot?.indicators?.bollinger ?? null;
  const fib = snapshot?.indicators?.fib ?? null;
  const base = {
    agent: "CANDLE", version: CANDLE_AGENT_VERSION, snapshotId, state: "NO_DATA", structure: "UNCLEAR", direction: "NEUTRAL",
    rejection: null, strength: 0, reversalEvidence: 0, continuationEvidence: 0, patterns: [], trend: null, location: null,
    supportingEvidence: [], counterEvidence: [], observations: [],
  };
  if (candles.length < 30) return base;

  const shapes = candles.map(shape).filter(Boolean);
  const n = shapes.length;
  const last = shapes[n - 1]; const prev = shapes[n - 2]; const prev2 = shapes[n - 3];

  const hammer = last.lowerWickRatio >= 0.55 && last.bodyRatio <= 0.35 && last.closePos >= 0.6;
  const shooting = last.upperWickRatio >= 0.55 && last.bodyRatio <= 0.35 && last.closePos <= 0.4;
  const doji = last.bodyRatio <= 0.12;
  const marubozu = last.bodyRatio >= 0.8;
  const engulfBull = Boolean(prev && prev.bearish && last.bullish && last.close >= prev.open && last.open <= prev.close && last.body >= prev.body * 0.8);
  const engulfBear = Boolean(prev && prev.bullish && last.bearish && last.close <= prev.open && last.open >= prev.close && last.body >= prev.body * 0.8);
  const pierce = Boolean(prev && prev.bearish && last.bullish && last.close > (prev.open + prev.close) / 2 && last.close < prev.open);
  const cloud = Boolean(prev && prev.bullish && last.bearish && last.close < (prev.open + prev.close) / 2 && last.close > prev.open);
  const inside = Boolean(prev && last.high <= prev.high && last.low >= prev.low);
  const outside = Boolean(prev && last.high > prev.high && last.low < prev.low);
  const starBull = Boolean(prev2 && prev2.bearish && prev2.bodyRatio >= 0.5 && prev.bodyRatio <= 0.3 && last.bullish && last.close > (prev2.open + prev2.close) / 2);
  const starBear = Boolean(prev2 && prev2.bullish && prev2.bodyRatio >= 0.5 && prev.bodyRatio <= 0.3 && last.bearish && last.close < (prev2.open + prev2.close) / 2);
  const climax = atr !== null && atr > 0 && last.range >= atr * 2;
  const climaxBull = climax && last.lowerWickRatio >= 0.4 && last.closePos >= 0.5;
  const climaxBear = climax && last.upperWickRatio >= 0.4 && last.closePos <= 0.5;

  const prior = shapes.slice(-43, -3);
  const priorHigh = prior.length ? Math.max(...prior.map((s) => s.high)) : null;
  const priorLow = prior.length ? Math.min(...prior.map((s) => s.low)) : null;
  const sweptHigh = priorHigh !== null && shapes.slice(-3).some((s) => s.high > priorHigh) && last.close < priorHigh;
  const sweptLow = priorLow !== null && shapes.slice(-3).some((s) => s.low < priorLow) && last.close > priorLow;

  const swingList = candles.slice(-60);
  const { highs, lows } = swingsOf(swingList, 2);
  const h1 = highs[highs.length - 1] ?? null; const h2 = highs[highs.length - 2] ?? null;
  const l1 = lows[lows.length - 1] ?? null; const l2 = lows[lows.length - 2] ?? null;
  let trend = "NEUTRAL";
  if (h1 && h2 && l1 && l2) {
    if (h1.price > h2.price && l1.price > l2.price) trend = "BULLISH";
    else if (h1.price < h2.price && l1.price < l2.price) trend = "BEARISH";
  }

  const closeNow = last.close;
  const closeThen = shapes[Math.max(0, n - 30)].close;
  const extension = atr !== null && atr > 0 ? (closeNow - closeThen) / atr : null;
  const last5 = shapes.slice(-5); const prior5 = shapes.slice(-10, -5);
  const rangeLast5 = last5.reduce((a, s) => a + s.range, 0);
  const rangePrior5 = prior5.reduce((a, s) => a + s.range, 0);
  const decelerating = rangePrior5 > 0 && rangeLast5 < rangePrior5 * 0.8;
  const expanding = rangePrior5 > 0 && rangeLast5 > rangePrior5 * 1.2;

  const position = num(band?.position);
  const fibExtreme = (() => {
    if (!fib) return null;
    const a = num(fib.anchorA?.price); const b = num(fib.anchorB?.price);
    if (a === null || b === null) return null;
    const top = Math.max(a, b); const bottom = Math.min(a, b); const tol = num(fib.tolerance) ?? 0;
    if (Math.abs(closeNow - top) <= tol) return "UPPER";
    if (Math.abs(closeNow - bottom) <= tol) return "LOWER";
    return null;
  })();
  const atBandUpper = position !== null && position >= 0.8;
  const atBandLower = position !== null && position <= 0.2;
  const location = atBandUpper || fibExtreme === "UPPER" ? "UPPER" : atBandLower || fibExtreme === "LOWER" ? "LOWER" : null;

  const bullWeight = (hammer ? 0.3 : 0) + (engulfBull ? 0.35 : 0) + (pierce ? 0.25 : 0) + (starBull ? 0.4 : 0) + (climaxBull ? 0.3 : 0) + (sweptLow ? 0.45 : 0);
  const bearWeight = (shooting ? 0.3 : 0) + (engulfBear ? 0.35 : 0) + (cloud ? 0.25 : 0) + (starBear ? 0.4 : 0) + (climaxBear ? 0.3 : 0) + (sweptHigh ? 0.45 : 0);
  const bullScore = bullWeight > 0 ? bullWeight * (location === "LOWER" ? 1 : 0.55) * (extension !== null && extension <= -1 ? 1 : 0.7) + (decelerating ? 0.15 : 0) : 0;
  const bearScore = bearWeight > 0 ? bearWeight * (location === "UPPER" ? 1 : 0.55) * (extension !== null && extension >= 1 ? 1 : 0.7) + (decelerating ? 0.15 : 0) : 0;

  const withTrend = (trend === "BULLISH" && last.bullish) || (trend === "BEARISH" && last.bearish);
  const continuationScore = clamp01((marubozu && withTrend ? 0.35 : 0) + (trend !== "NEUTRAL" && expanding ? 0.25 : 0) + (outside && withTrend ? 0.2 : 0) + (trend !== "NEUTRAL" && !bullWeight && !bearWeight ? 0.2 : 0));

  const reversalSide = bullScore >= 0.35 && bullScore >= bearScore ? "BUY" : bearScore >= 0.35 ? "SELL" : null;
  // Contexto de tendencia (continuacao): padrao de reversao contra tendencia forte perde peso.
  const dmi = snapshot?.indicators?.dmi ?? null;
  const adxInd = snapshot?.indicators?.adx ?? null;
  const trendMove = atr !== null && atr > 0 && n > 60 ? (closeNow - shapes[n - 60].close) / atr : null;
  const strongTrendAgainst = Boolean(reversalSide && dmi && adxInd && Number(adxInd.value) >= 25 && trendMove !== null && ((reversalSide === "SELL" && trendMove > 1.2 && Number(dmi.plusDI) > Number(dmi.minusDI)) || (reversalSide === "BUY" && trendMove < -1.2 && Number(dmi.minusDI) > Number(dmi.plusDI))));
  // Estrutura de mercado (Dow/BOS/CHoCH) nos ultimos 30 min: sequencia de topos e fundos.
  const structureList = candles.slice(-360);
  const pivotsOf = (list, lb = 3) => {
    const highs = []; const lows = [];
    for (let i = lb; i < list.length - lb; i += 1) {
      const win = list.slice(i - lb, i + lb + 1);
      const high = Number(list[i].high); const low = Number(list[i].low);
      if (high === Math.max(...win.map((c) => Number(c.high)))) highs.push({ i, price: high });
      if (low === Math.min(...win.map((c) => Number(c.low)))) lows.push({ i, price: low });
    }
    // Platos (candles encadeados com o mesmo extremo) contam como UM pivo: fica o mais recente.
    const dedupe = (rows) => { const out = []; for (const row of rows) { const prev = out[out.length - 1]; if (prev && Math.abs(row.price - prev.price) <= Math.abs(prev.price) * 1e-9) { out[out.length - 1] = row; continue; } out.push(row); } return out; };
    return { highs: dedupe(highs), lows: dedupe(lows) };
  };
  const { highs: sHighs, lows: sLows } = pivotsOf(structureList, 3);
  const sh1 = sHighs[sHighs.length - 1] ?? null; const sh2 = sHighs[sHighs.length - 2] ?? null;
  const sl1 = sLows[sLows.length - 1] ?? null; const sl2 = sLows[sLows.length - 2] ?? null;
  const isHH = Boolean(sh1 && sh2 && sh1.price > sh2.price);
  const isLH = Boolean(sh1 && sh2 && sh1.price < sh2.price);
  const isHL = Boolean(sl1 && sl2 && sl1.price > sl2.price);
  const isLL = Boolean(sl1 && sl2 && sl1.price < sl2.price);
  const swingStructure = isHH && isHL ? "UP" : isLH && isLL ? "DOWN" : "RANGE";
  const lastClose = Number(structureList[structureList.length - 1]?.close ?? closeNow);
  const bos = swingStructure === "UP" && sh1 && lastClose > sh1.price ? "UP" : swingStructure === "DOWN" && sl1 && lastClose < sl1.price ? "DOWN" : null;
  const choch = swingStructure === "UP" && sl1 && lastClose < sl1.price ? "BEARISH" : swingStructure === "DOWN" && sh1 && lastClose > sh1.price ? "BULLISH" : null;
  const tol = atr !== null && atr > 0 ? atr * 0.25 : 0;
  const pullbackHolding = swingStructure === "UP" && sl1 && Number(last.low) >= sl1.price - tol ? true : swingStructure === "DOWN" && sh1 && Number(last.high) <= sh1.price + tol ? true : false;
  const swingLabels = `${isHH ? "HH" : isLH ? "LH" : "--"} ${isHL ? "HL" : isLL ? "LL" : "--"}`;
  const structureNote = swingStructure === "RANGE" ? null : `estrutura ${swingStructure} (${swingLabels})${bos ? " BOS " + bos : ""}${choch ? " CHOCH " + choch : ""}${pullbackHolding ? " pullback segurando" : ""}`;
  const continuationSide = trend === "BULLISH" ? "BUY" : trend === "BEARISH" ? "SELL" : null;
  const structure = reversalSide ? "REVERSAL" : continuationSide && continuationScore >= 0.4 ? "CONTINUATION" : location === null && Math.abs(extension ?? 0) < 0.8 ? "RANGE" : "UNCLEAR";
  const direction = reversalSide ?? (structure === "CONTINUATION" ? continuationSide : "NEUTRAL");
  const rejection = location === "LOWER" && (hammer || sweptLow || climaxBull || engulfBull || pierce) ? "LOWER"
    : location === "UPPER" && (shooting || sweptHigh || climaxBear || engulfBear || cloud) ? "UPPER" : null;

  const patterns = [
    hammer ? "HAMMER" : null, shooting ? "SHOOTING_STAR" : null, doji ? "DOJI" : null, marubozu ? "MARUBOZU" : null,
    engulfBull ? "ENGULFING_BULLISH" : null, engulfBear ? "ENGULFING_BEARISH" : null,
    pierce ? "PIERCING" : null, cloud ? "DARK_CLOUD" : null, inside ? "INSIDE_BAR" : null, outside ? "OUTSIDE_BAR" : null,
    starBull ? "MORNING_STAR" : null, starBear ? "EVENING_STAR" : null, climax ? "CLIMAX_BAR" : null,
    sweptHigh ? "SWEEP_HIGH" : null, sweptLow ? "SWEEP_LOW" : null,
  ].filter(Boolean);

  const supportingEvidence = [];
  const counterEvidence = [];
  if (strongTrendAgainst) counterEvidence.push({ code: "CANDLE_CONTRA_TENDENCIA", detail: `reversao ${reversalSide} contra tendencia forte (${round(trendMove, 2)}xATR, ADX ${round(Number(adxInd?.value), 1)})` });
  const observations = [`tendencia ${trend} | localizacao ${location ?? "meio"} | extensao30 ${extension === null ? "-" : round(extension, 2) + "xATR"} | padroes ${patterns.join(",") || "nenhum"}`];
  if (structureNote) observations.push(structureNote);
  if (reversalSide === "BUY") {
    supportingEvidence.push({ code: "CANDLE_REVERSAO_ALTA", detail: `padrao de reversao de alta (${patterns.join(",")}) em ${location === "LOWER" ? "extremo inferior" : "meio de faixa"}` });
    if (sweptLow) supportingEvidence.push({ code: "CANDLE_FALSO_ROMPIMENTO_ALTA", detail: "fundo varrido e recuperado (sweep)" });
    if (extension !== null && extension <= -1) supportingEvidence.push({ code: "CANDLE_EXTENSAO_ANTES_DA_REVERSAO", detail: `queda previa ${round(extension, 2)}xATR (straight-line run)` });
  }
  if (reversalSide === "SELL") {
    supportingEvidence.push({ code: "CANDLE_REVERSAO_BAIXA", detail: `padrao de reversao de baixa (${patterns.join(",")}) em ${location === "UPPER" ? "extremo superior" : "meio de faixa"}` });
    if (sweptHigh) supportingEvidence.push({ code: "CANDLE_FALSO_ROMPIMENTO_BAIXA", detail: "topo varrido e devolvido (sweep)" });
    if (extension !== null && extension >= 1) supportingEvidence.push({ code: "CANDLE_EXTENSAO_ANTES_DA_REVERSAO", detail: `alta previa ${round(extension, 2)}xATR (straight-line run)` });
  }
  if (structure === "CONTINUATION") counterEvidence.push({ code: "CANDLE_CONTINUACAO", detail: `estrutura ${trend.toLowerCase()} com expansao/marubozu (nao fade)` });
  if ((bullWeight > 0 || bearWeight > 0) && location === null) counterEvidence.push({ code: "CANDLE_FORA_DE_LOCALIZACAO", detail: "padrao fora de extremo/banda/zona (ruido de meio de faixa)" });
  if (structure === "UNCLEAR" && !reversalSide && !continuationSide) counterEvidence.push({ code: "CANDLE_SEM_PADRAO", detail: "sem leitura direcional clara" });

  const state = sweptLow && reversalSide === "BUY" ? "FAILED_BREAKOUT_BULLISH"
    : sweptHigh && reversalSide === "SELL" ? "FAILED_BREAKOUT_BEARISH"
      : starBull && reversalSide === "BUY" ? "MORNING_STAR"
        : starBear && reversalSide === "SELL" ? "EVENING_STAR"
          : engulfBull && reversalSide === "BUY" ? "ENGULFING_BULLISH"
            : engulfBear && reversalSide === "SELL" ? "ENGULFING_BEARISH"
              : hammer && reversalSide === "BUY" ? "HAMMER_REJECTION"
                : shooting && reversalSide === "SELL" ? "SHOOTING_STAR"
                  : climax ? "CLIMAX"
                    : inside ? "INSIDE_BAR"
                      : marubozu ? "MARUBOZU"
                        : structure === "CONTINUATION" ? `STRUCTURE_${trend}`
                          : structure === "RANGE" ? "RANGE" : "NEUTRAL";

  const reversalEvidence = round(clamp01(Math.max(bullScore, bearScore)), 4);
  const strength = round(clamp01(Math.max(Math.max(bullScore, bearScore), continuationScore)), 4);
  return {
    agent: "CANDLE", version: CANDLE_AGENT_VERSION, snapshotId, state, structure, direction, rejection,
    trend, location, extension: extension === null ? null : round(extension, 4), patterns,
    reversalEvidence, continuationEvidence: round(continuationScore, 4), strength, strongTrendAgainst,
    swingStructure, swingLabels, bos, choch, pullbackHolding,
    lastSwingHigh: sh1 ? round(sh1.price, 8) : null, lastSwingLow: sl1 ? round(sl1.price, 8) : null,
    supportingEvidence, counterEvidence, observations,
    opinion: structure === "REVERSAL" ? `Candle de reversao ${direction} (${state.toLowerCase().replace(/_/g, " ")}) ${location === "LOWER" ? "no fundo" : location === "UPPER" ? "no topo" : "sem extremo"}.`
      : structure === "CONTINUATION" ? `Candles em continuacao ${direction} (${state.toLowerCase().replace(/_/g, " ")}); nao fade.`
        : structure === "RANGE" ? "Candles em faixa (sem extremo)." : "Candles sem leitura clara.",
  };
}
