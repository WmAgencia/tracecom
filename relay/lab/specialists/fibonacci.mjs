/** ESPECIALISTA FIBONACCI (lab S06) — swings CONFIRMADOS causalmente; zona proporcional ao ATR (nao pixel). */
export const FIBONACCI_VERSION = "lab-fibonacci-v1";
const num = (v) => (v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function analyzeFibonacci(snapshot) {
  const fib = snapshot?.indicators?.fib ?? null;
  const snapshotId = snapshot?.snapshotId ?? null;
  const close = num(snapshot?.ohlc?.close);
  const candles = snapshot?.recentCandles ?? [];
  const base = { state: "NO_CONTEXT", direction: "NEUTRAL", strength: 0, inZone: [], zoneReaction: false, supportingEvidence: [], counterEvidence: [], observations: [], snapshotId, version: FIBONACCI_VERSION, episodeId: fib?.episodeId ?? null };
  if (!fib || close === null) return base;
  const bullishLeg = fib.direction === "BULLISH_LEG";
  const direction = bullishLeg ? "BUY" : "SELL";
  const tolerance = num(fib.tolerance) ?? 0;
  const levels = fib.levels ?? {};
  const mainLevels = ["38.2", "50.0", "61.8"];
  const inZone = mainLevels.filter((level) => Number.isFinite(Number(levels[level])) && Math.abs(close - Number(levels[level])) <= tolerance);
  const anchorA = num(fib.anchorA?.price);
  const broken = anchorA !== null ? (bullishLeg ? close < anchorA : close > anchorA) : false;
  const last = candles[candles.length - 1] ?? null;
  const prev = candles[candles.length - 2] ?? null;
  const reaction = Boolean(last && prev && (bullishLeg
    ? Number(last.close) > Number(last.open) && Number(last.close) > Number(prev.close)
    : Number(last.close) < Number(last.open) && Number(last.close) < Number(prev.close)));
  const state = broken ? "ZONE_BROKEN" : inZone.length ? (reaction ? "ZONE_REACTION" : "IN_ZONE") : "OUT_OF_ZONE";
  const supportingEvidence = [];
  const counterEvidence = [];
  const observations = [`leg ${fib.direction} anchors ${round(anchorA, 6)} -> ${round(num(fib.anchorB?.price), 6)}`];
  if (inZone.length) observations.push(`preco em zona fib ${inZone.join("/")} (tol ${round(tolerance, 6)})`);
  if (state === "ZONE_REACTION") { supportingEvidence.push({ code: "FIB_ZONE_REACTION", detail: `reacao na zona ${inZone.join("/")} do leg ${fib.direction}` }); observations.push("reacao na zona fibonacci"); }
  if (state === "IN_ZONE") counterEvidence.push({ code: "FIB_SEM_REACAO", detail: "na zona sem reacao de preco" });
  if (state === "OUT_OF_ZONE") counterEvidence.push({ code: "FIB_FORA_DE_ZONA", detail: "fora das zonas 38.2/50.0/61.8" });
  if (state === "ZONE_BROKEN") { counterEvidence.push({ code: "FIB_ZONE_BROKEN", detail: "preco perdeu o anchor do leg (swing invalidado)" }); observations.push("zona rompida"); }
  const strength = clamp01(state === "ZONE_REACTION" ? 0.7 : state === "IN_ZONE" ? 0.35 : 0.05);
  return { state, direction, strength: round(strength, 4), inZone, zoneReaction: reaction, levels: fib.levels, tolerance: round(tolerance, 8), anchors: fib.anchorA && fib.anchorB ? { a: fib.anchorA, b: fib.anchorB } : null, supportingEvidence, counterEvidence, observations, snapshotId, version: FIBONACCI_VERSION, episodeId: fib.episodeId ?? null };
}
