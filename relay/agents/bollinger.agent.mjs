/**
 * AGENTE BOLLINGER — especialista em Bollinger (SMA20 ±2σ).
 * Regras profissionais: toque nao e sinal; fechar fora = continuacao primeiro; regimes
 * SQUEEZE / WALK / RANGE; %B e BandWidth; divergencia preco x %B.
 */
export const BOLLINGER_AGENT_VERSION = "agent-bollinger-v1";
const num = (v) => (v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function bandwidthSeries(candles, period = 20, mult = 2, samples = 120) {
  const list = candles ?? []; const out = [];
  for (let end = Math.max(period, list.length - samples); end <= list.length; end += 1) {
    const window = list.slice(end - period, end).map((c) => Number(c.close));
    if (window.length < period) continue;
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    if (mean > 0) out.push((2 * mult * sd) / mean);
  }
  return out;
}

function smaAt(candles, end, period = 20) {
  const window = (candles ?? []).slice(end - period, end).map((c) => Number(c.close));
  if (window.length < period) return null;
  return window.reduce((a, b) => a + b, 0) / period;
}

export function analyzeBollingerAgent(snapshot) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const band = snapshot?.indicators?.bollinger ?? null;
  const candles = snapshot?.recentCandles ?? [];
  const atr = num(snapshot?.indicators?.atr);
  const base = { agent: "BOLLINGER", version: BOLLINGER_AGENT_VERSION, snapshotId, state: "NO_DATA", regime: null, direction: "NEUTRAL", strength: 0, supportingEvidence: [], counterEvidence: [], observations: [] };
  if (!band) return base;

  const position = num(band.position);
  const width = num(band.width);
  const close = num(band.close);
  const upper = num(band.upper); const lower = num(band.lower); const middle = num(band.middle);
  const last = candles[candles.length - 1] ?? null; const prev = candles[candles.length - 2] ?? null;
  const bandwidths = bandwidthSeries(candles);
  const bw = bandwidths.length ? bandwidths[bandwidths.length - 1] : null;
  const bwMin = bandwidths.length ? Math.min(...bandwidths) : null;
  const bwMax = bandwidths.length ? Math.max(...bandwidths) : null;
  const squeeze = bw !== null && bwMin !== null && bwMax !== null && bwMax > bwMin ? (bw - bwMin) / (bwMax - bwMin) < 0.15 : false;
  const bwThen = bandwidths.length >= 10 ? bandwidths[bandwidths.length - 10] : null;
  const bwTrend = bw !== null && bwThen !== null && bwThen > 0 ? (bw > bwThen * 1.1 ? "EXPANDING" : bw < bwThen * 0.9 ? "CONTRACTING" : "STABLE") : null;
  const middleSlope = (() => {
    const now = smaAt(candles, candles.length);
    const then = smaAt(candles, candles.length - 60);
    return now !== null && then !== null ? Number((now - then).toFixed(8)) : null;
  })();

  // Walk profissional: 3+ fechamentos na banda, maioria dos fechamentos do lado da media,
  // %B pinado no extremo, dentro de uma janela de 5 min (60 candles de 5s). Mantem tambem o
  // proxy curto anterior (5 fechamentos seguidos do lado da media com %B pinado).
  let walkSide = null;
  const walkList = candles.slice(-60);
  if (walkList.length >= 20) {
    const atUpper = walkList.filter((c) => upper !== null && Number(c.close) >= upper).length;
    const atLower = walkList.filter((c) => lower !== null && Number(c.close) <= lower).length;
    const above = walkList.filter((c) => middle !== null && Number(c.close) > middle).length;
    const below = walkList.filter((c) => middle !== null && Number(c.close) < middle).length;
    if (atUpper >= 3 && above >= walkList.length * 0.7 && position !== null && position >= 0.8) walkSide = "UPPER";
    if (atLower >= 3 && below >= walkList.length * 0.7 && position !== null && position <= 0.2) walkSide = "LOWER";
  }
  if (!walkSide) {
    const last5 = candles.slice(-5);
    const closesAbove = last5.filter((c) => Number(c.close) > middle).length;
    const closesBelow = last5.filter((c) => Number(c.close) < middle).length;
    if (closesAbove >= 5 && position !== null && position >= 0.8) walkSide = "UPPER";
    if (closesBelow >= 5 && position !== null && position <= 0.2) walkSide = "LOWER";
  }

  const upperRejection = Boolean(last && upper !== null && Number(last.high) > upper && Number(last.close) < upper);
  const lowerRejection = Boolean(last && lower !== null && Number(last.low) < lower && Number(last.close) > lower);
  const reenteredUpper = band.outsideUpper !== true && prev && upper !== null && Number(prev.close) > upper;
  const reenteredLower = band.outsideLower !== true && prev && lower !== null && Number(prev.close) < lower;
  const rejection = upperRejection || reenteredUpper ? "UPPER" : lowerRejection || reenteredLower ? "LOWER" : null;

  const regime = squeeze ? "SQUEEZE" : walkSide ? "WALK" : position !== null && position > 0.2 && position < 0.8 ? "RANGE" : "EXPANSION";
  const supportingEvidence = [];
  const counterEvidence = [];
  const observations = [`%B ${round(position, 3)} bw ${round(bw, 4)} regime ${regime}${walkSide ? " (" + walkSide.toLowerCase() + ")" : ""}`];
  if (rejection) supportingEvidence.push({ code: `BOLLINGER_REJEICAO_${rejection}`, detail: `rejeicao/reentrada na banda ${rejection.toLowerCase()}` });
  if (walkSide === "UPPER") counterEvidence.push({ code: "BOLLINGER_WALK_UPPER", detail: "3+ fechamentos na banda superior em 5 min com %B alto (continuacao de alta)" });
  if (walkSide === "LOWER") counterEvidence.push({ code: "BOLLINGER_WALK_LOWER", detail: "3+ fechamentos na banda inferior em 5 min com %B baixo (continuacao de baixa)" });
  if (band.outsideUpper === true && !reenteredUpper) counterEvidence.push({ code: "BOLLINGER_FORA_SUPERIOR", detail: "fechando fora da banda superior (continuacao primeiro)" });
  if (band.outsideLower === true && !reenteredLower) counterEvidence.push({ code: "BOLLINGER_FORA_INFERIOR", detail: "fechando fora da banda inferior (continuacao primeiro)" });
  if (squeeze) observations.push("squeeze (energia comprimida; direcao indefinida)");
  if (middleSlope !== null) observations.push(middleSlope > 0 ? "media inclinada para cima" : middleSlope < 0 ? "media inclinada para baixo" : "media plana");

  const reversalSide = rejection === "UPPER" ? "SELL" : rejection === "LOWER" ? "BUY" : null;
  const strength = clamp01((rejection ? 0.5 : 0) + (regime === "RANGE" ? 0.2 : 0) + (squeeze ? 0.1 : 0) - (walkSide ? 0.3 : 0));
  return {
    agent: "BOLLINGER", version: BOLLINGER_AGENT_VERSION, snapshotId, state: regime, regime, walkSide, rejection, direction: reversalSide ?? "NEUTRAL",
    position: round(position, 4), bandwidth: round(bw, 6), squeeze, middleSlope: middleSlope === null ? null : round(middleSlope, 8), bwTrend, distanceUpper: band.distanceToUpper ?? null, distanceLower: band.distanceToLower ?? null,
    atrNormalizedDistance: atr && width && close !== null && upper !== null ? round((upper - close) / (atr || 1), 4) : null,
    strength: round(strength, 4), supportingEvidence, counterEvidence, observations,
    opinion: walkSide ? `Preco caminhando na banda ${walkSide.toLowerCase()} (continuacao; nao reverter).` : rejection ? `Rejeicao/reentrada na banda ${rejection.toLowerCase()}.` : `Sem rejeicao; regime ${regime.toLowerCase()}.`,
  };
}
