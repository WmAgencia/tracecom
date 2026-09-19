/**
 * MARKET_REGIME_AGENT — TREND_UP/TREND_DOWN/RANGE/COMPRESSION/EXPANSION/TRANSITION/UNCERTAIN.
 *
 * Corrige o gargalo estrutural do V3: velocity/acceleration + estrutura 1m/5m + BOS entram no
 * score (nao sao descartados no plumbing). A soma maxima de tendencia e ~7.75 com limiar 3.0,
 * entao TREND_UP/TREND_DOWN sao alcancaveis com features reais (provado em teste).
 */
import { makeAgentOutput, confidenceFrom } from "../contracts.mjs";

export const REGIME_AGENT_VERSION = "market-regime-agent-v1";
export const REGIME_STATES = Object.freeze(["TREND_UP", "TREND_DOWN", "RANGE", "COMPRESSION", "EXPANSION", "TRANSITION", "UNCERTAIN"]);
export const TREND_SCORE_THRESHOLD = 3;
export const TREND_SCORE_MAX = 7.75;

export function analyzeMarketRegime({ features = {}, t0 = {}, dataQuality = "UNKNOWN" } = {}) {
  const f = features;
  const bullish = [];
  const bearish = [];
  const neutral = [];
  const risks = [];
  const used = [];
  let up = 0, down = 0;

  if (f.structureLabel === "UP") { up += 2; bullish.push("estrutura5s:UP_HH_HL"); used.push("structureLabel"); }
  else if (f.structureLabel === "DOWN") { down += 2; bearish.push("estrutura5s:DOWN_LH_LL"); used.push("structureLabel"); }
  if (f.structure1m === "UP") { up += 1.5; bullish.push("estrutura1m:UP"); used.push("structure1m"); }
  else if (f.structure1m === "DOWN") { down += 1.5; bearish.push("estrutura1m:DOWN"); used.push("structure1m"); }
  if (f.context5m === "UP") { up += 0.5; used.push("context5m"); }
  else if (f.context5m === "DOWN") { down += 0.5; used.push("context5m"); }
  if (f.bosUp) { up += 0.5; bullish.push("bos:UP"); used.push("bosUp"); }
  if (f.bosDown) { down += 0.5; bearish.push("bos:DOWN"); used.push("bosDown"); }

  const adx = f.adx;
  const hasAdx = Number.isFinite(adx);
  const adxStrong = hasAdx && adx >= 25;
  const adxValid = hasAdx && adx >= 20;
  if (hasAdx) used.push("adx");
  if (adxStrong && f.diAlignedUp === true) { up += 1.5; bullish.push(`adx:${adx.toFixed(1)}+DI>${f.minusDI !== null ? Number(f.minusDI).toFixed(1) : "?"}`); used.push("plusDI", "minusDI"); }
  else if (adxStrong && f.diAlignedUp === false) { down += 1.5; bearish.push(`adx:${adx.toFixed(1)}-DI>+DI`); used.push("plusDI", "minusDI"); }
  else if (adxValid && f.diAlignedUp === true) { up += 1; bullish.push("adx>=20_di_alinhado"); }
  else if (adxValid && f.diAlignedUp === false) { down += 1; bearish.push("adx>=20_di_alinhado_baixa"); }

  const velocityATR = f.velocityATR;
  if (Number.isFinite(velocityATR)) {
    used.push("velocityATR");
    if (velocityATR >= 0.5) { up += 1.25; bullish.push(`velocity:${velocityATR}ATR/candle`); }
    else if (velocityATR >= 0.25) { up += 0.75; bullish.push(`velocity:${velocityATR}ATR/candle`); }
    else if (velocityATR <= -0.5) { down += 1.25; bearish.push(`velocity:${velocityATR}ATR/candle`); }
    else if (velocityATR <= -0.25) { down += 0.75; bearish.push(`velocity:${velocityATR}ATR/candle`); }
  }
  const accelerationATR = f.accelerationATR;
  if (Number.isFinite(accelerationATR) && Math.abs(accelerationATR) >= 0.05) {
    used.push("accelerationATR");
    if (velocityATR !== null && Math.sign(accelerationATR) === Math.sign(velocityATR)) {
      if (accelerationATR > 0) { up += 0.5; bullish.push("aceleracao_a_favor"); }
      else { down += 0.5; bearish.push("aceleracao_a_favor_baixa"); }
    } else {
      neutral.push("aceleracao_contra_velocidade");
      risks.push("ACCELERATION_DIVERGENT");
    }
  }

  const labelsAgree = f.structureLabel && f.structure1m && f.structureLabel === f.structure1m && f.structureLabel !== "RANGE";
  if (!labelsAgree && f.structureLabel && f.structure1m) neutral.push(`estruturas_divergem:${f.structureLabel}/${f.structure1m}`);
  if (!Number.isFinite(velocityATR)) risks.push("VELOCITY_UNAVAILABLE");
  if (!Number.isFinite(accelerationATR)) risks.push("ACCELERATION_UNAVAILABLE");

  const trendScore = Math.max(up, down);
  const trendDirection = up > down ? "UP" : down > up ? "DOWN" : "NONE";
  const hardTrend = f.structureLabel === trendDirection || (adxValid && (trendDirection === "UP" ? f.diAlignedUp === true : f.diAlignedUp === false));

  let state = "UNCERTAIN";
  let detail = "sem_regime_claro";
  if (trendScore >= TREND_SCORE_THRESHOLD && hardTrend) {
    state = up > down ? "TREND_UP" : "TREND_DOWN";
    detail = `${state} score=${Number(trendScore.toFixed(2))} (max=${TREND_SCORE_MAX})`;
  } else if (f.compressed && (f.atrRatio === null || f.atrRatio < 0.7)) {
    state = "COMPRESSION";
    detail = `atrRatio=${f.atrRatio} donchianWidthATR=${f.donchianWidthATR}`;
    neutral.push("volatilidade_contraida_sem_direcao");
  } else if (f.expanded || (f.expansionEvent && f.atrSlope !== null && f.atrSlope > 0)) {
    state = "EXPANSION";
    detail = `atrRatio=${f.atrRatio} expansionEvent=${f.expansionEvent}`;
  } else if (trendScore >= 1.5 && !labelsAgree && f.structureLabel && f.structure1m) {
    state = "TRANSITION";
    detail = "estruturas_desalinhadas";
  } else if (f.structureLabel === "RANGE" && f.structure1m === "RANGE" && (!hasAdx || adx < 20)) {
    state = "RANGE";
    detail = hasAdx ? `adx=${adx.toFixed(1)}` : "adx_indisponivel";
  } else if (trendScore >= TREND_SCORE_THRESHOLD) {
    state = "TRANSITION";
    detail = `score_sem_evidencia_dura:${trendScore.toFixed(2)}`;
  }

  const confidence = state.startsWith("TREND")
    ? (trendScore >= 5 ? "HIGH" : trendScore >= 3.5 ? "MEDIUM" : "LOW")
    : confidenceFrom({ total: bullish.length + bearish.length + neutral.length + 2, supporting: (state === "RANGE" ? neutral.length : bullish.length + bearish.length + neutral.length) });

  return makeAgentOutput({
    agentId: "MARKET_REGIME_AGENT",
    marketKey: f.marketKey, snapshotId: f.snapshotId,
    state, assessment: detail,
    bullishEvidence: bullish, bearishEvidence: bearish, neutralEvidence: neutral, riskFlags: risks,
    featuresUsed: used,
    confidenceClass: confidence,
    dataQuality,
    reasoningSummary: `regime=${state}; score_up=${Number(up.toFixed(2))} score_down=${Number(down.toFixed(2))} limiar=${TREND_SCORE_THRESHOLD}; estrutura5s=${f.structureLabel} estrutura1m=${f.structure1m} adx=${adx} velocityATR=${velocityATR}`,
    availableAt: f.availableAt,
    detail: { scoreUp: Number(up.toFixed(2)), scoreDown: Number(down.toFixed(2)), threshold: TREND_SCORE_THRESHOLD, max: TREND_SCORE_MAX, trendScore: Number(trendScore.toFixed(2)), hardTrend, adx, velocityATR, accelerationATR },
  });
}
