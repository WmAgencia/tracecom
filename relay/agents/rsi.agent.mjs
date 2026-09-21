/**
 * AGENTE RSI — especialista em RSI (Wilder 14). Gatilho da oportunidade: RSI toca 70 ou 30.
 * Regras profissionais: extremo e alerta (nao ordem), divergencia (aviso), failure swing,
 * crossback acionavel e linha 50 como filtro de lado.
 */
export const RSI_AGENT_VERSION = "agent-rsi-v1";
const num = (v) => (v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function swingPoints(candles, lookback = 3) {
  const list = (candles ?? []).slice(-60);
  const highs = []; const lows = [];
  for (let i = lookback; i < list.length - lookback; i += 1) {
    const window = list.slice(i - lookback, i + lookback + 1);
    const high = Number(list[i].high); const low = Number(list[i].low);
    if (high === Math.max(...window.map((c) => Number(c.high)))) highs.push({ at: Number(list[i].bucketEnd), price: high });
    if (low === Math.min(...window.map((c) => Number(c.low)))) lows.push({ at: Number(list[i].bucketEnd), price: low });
  }
  return { highs, lows };
}

export function analyzeRsiAgent(snapshot) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const rsi = num(snapshot?.indicators?.rsi);
  const slope = num(snapshot?.indicators?.rsiSlope);
  const trajectory = (snapshot?.indicators?.rsiTrajectory ?? []).map(num).filter((v) => v !== null);
  const base = { agent: "RSI", version: RSI_AGENT_VERSION, snapshotId, state: "NO_DATA", direction: "NEUTRAL", strength: 0, trigger: false, supportingEvidence: [], counterEvidence: [], observations: [] };
  if (rsi === null) return base;

  const triggerSell = rsi >= 70; const triggerBuy = rsi <= 30;
  const trigger = triggerSell || triggerBuy;
  const side = triggerSell ? "SELL" : triggerBuy ? "BUY" : null;
  const peak = trajectory.length ? Math.max(...trajectory) : rsi;
  const trough = trajectory.length ? Math.min(...trajectory) : rsi;
  const slopeOk = slope === null ? null : (side === "SELL" ? slope <= 0.05 : slope >= -0.05);
  const crossback = side === "SELL" ? (peak >= 70 && rsi < 70 && (slope ?? 0) <= 0) : side === "BUY" ? (trough <= 30 && rsi > 30 && (slope ?? 0) >= 0) : false;
  const { highs, lows } = swingPoints(snapshot?.recentCandles);
  const lastHigh = highs[highs.length - 1] ?? null; const prevHigh = highs[highs.length - 2] ?? null;
  const lastLow = lows[lows.length - 1] ?? null; const prevLow = lows[lows.length - 2] ?? null;
  const divergenceBear = Boolean(lastHigh && prevHigh && lastHigh.price > prevHigh.price && rsi < (peak - 0.5) && peak >= 70);
  const divergenceBull = Boolean(lastLow && prevLow && lastLow.price < prevLow.price && rsi > (trough + 0.5) && trough <= 30);
  const failureSwingBear = Boolean(peak >= 70 && rsi < peak - 2 && slope !== null && slope < 0);
  const failureSwingBull = Boolean(trough <= 30 && rsi > trough + 2 && slope !== null && slope > 0);
  const line50Ok = side === "SELL" ? rsi >= 50 : side === "BUY" ? rsi <= 50 : false;

  const supportingEvidence = [];
  const counterEvidence = [];
  const observations = [`rsi ${round(rsi, 1)} slope ${round(slope, 3)} traj ${trajectory.map((v) => round(v, 1)).join("->")}`];
  if (trigger) observations.push(`trigger RSI ${side === "SELL" ? ">=70" : "<=30"} atingido`);
  if (side === "SELL") {
    if (divergenceBear) supportingEvidence.push({ code: "RSI_DIVERGENCIA_BEARISH", detail: "preco HH com RSI LH no extremo" });
    if (failureSwingBear) supportingEvidence.push({ code: "RSI_FAILURE_SWING_BEARISH", detail: `pico ${round(peak, 1)} -> recuo` });
    if (crossback) supportingEvidence.push({ code: "RSI_CROSSBACK_70", detail: "rompeu de volta para dentro do extremo" });
    if (line50Ok) supportingEvidence.push({ code: "RSI_ACIMA_50", detail: "lado vendedor coerente com a linha 50" });
    if (slope !== null && slope > 0.5) counterEvidence.push({ code: "RSI_ACELERANDO_PARA_EXTREMO", detail: `slope ${round(slope, 3)}` });
    if (!line50Ok) counterEvidence.push({ code: "RSI_ABAIXO_50_CONTRA_SELL", detail: `rsi ${round(rsi, 1)}` });
  }
  if (side === "BUY") {
    if (divergenceBull) supportingEvidence.push({ code: "RSI_DIVERGENCIA_BULLISH", detail: "preco LL com RSI HL no extremo" });
    if (failureSwingBull) supportingEvidence.push({ code: "RSI_FAILURE_SWING_BULLISH", detail: `vale ${round(trough, 1)} -> recuperacao` });
    if (crossback) supportingEvidence.push({ code: "RSI_CROSSBACK_30", detail: "rompeu de volta para dentro do extremo" });
    if (line50Ok) supportingEvidence.push({ code: "RSI_ABAIXO_50", detail: "lado comprador coerente com a linha 50" });
    if (slope !== null && slope < -0.5) counterEvidence.push({ code: "RSI_ACELERANDO_PARA_EXTREMO", detail: `slope ${round(slope, 3)}` });
    if (!line50Ok) counterEvidence.push({ code: "RSI_ACIMA_50_CONTRA_BUY", detail: `rsi ${round(rsi, 1)}` });
  }
  const state = !trigger ? "NEUTRAL" : crossback ? "CROSSBACK" : failureSwingBear || failureSwingBull ? "FAILURE_SWING" : divergenceBear || divergenceBull ? "DIVERGENCE" : slopeOk === false ? "EXTREME_ACCELERATING" : "EXTREME_HOLDING";
  const quality = clamp01((divergenceBear || divergenceBull ? 0.45 : 0) + (failureSwingBear || failureSwingBull ? 0.35 : 0) + (crossback ? 0.3 : 0) + (line50Ok ? 0.15 : 0));
  return {
    agent: "RSI", version: RSI_AGENT_VERSION, snapshotId, state, direction: trigger ? side : "NEUTRAL",
    trigger, side, strength: round(trigger ? clamp01(0.3 + quality) : 0, 4), quality: round(quality, 4),
    divergence: divergenceBear ? "BEARISH" : divergenceBull ? "BULLISH" : null,
    failureSwing: failureSwingBear ? "BEARISH" : failureSwingBull ? "BULLISH" : null,
    crossback, line50Ok, rsi: round(rsi, 4), peak: round(peak, 4), trough: round(trough, 4),
    supportingEvidence, counterEvidence, observations,
    opinion: trigger ? `RSI ${round(rsi, 1)} tocou ${side === "SELL" ? "70" : "30"} (${state.toLowerCase().replace(/_/g, " ")}).` : `RSI ${round(rsi, 1)} neutro (sem oportunidade).`,
  };
}
