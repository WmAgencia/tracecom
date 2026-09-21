/**
 * AGENTE FIBONACCI — swings CONFIRMADOS causalmente (pivot ±3, confirmacao em i+3); zona = 0.5xATR.
 * Zonas 38.2/50/61.8 (23.6 contexto). Reacao na zona = confluencia; anchor perdido = leg invalido.
 */
export const FIB_AGENT_VERSION = "agent-fib-v1";
const num = (v) => (v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function analyzeFibAgent(snapshot) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const fib = snapshot?.indicators?.fib ?? null;
  const close = num(snapshot?.ohlc?.close);
  const candles = snapshot?.recentCandles ?? [];
  const base = { agent: "FIB", version: FIB_AGENT_VERSION, snapshotId, state: "NO_CONTEXT", direction: "NEUTRAL", strength: 0, supportingEvidence: [], counterEvidence: [], observations: [], episodeId: fib?.episodeId ?? null };
  if (!fib || close === null) return base;
  const bullishLeg = fib.direction === "BULLISH_LEG";
  const thesisSide = bullishLeg ? "BUY" : "SELL";
  const tolerance = num(fib.tolerance) ?? 0;
  const levels = fib.levels ?? {};
  const inZone = ["38.2", "50.0", "61.8"].filter((level) => Number.isFinite(Number(levels[level])) && Math.abs(close - Number(levels[level])) <= tolerance);
  const anchorA = num(fib.anchorA?.price);
  const broken = anchorA !== null ? (bullishLeg ? close < anchorA : close > anchorA) : false;
  const last = candles[candles.length - 1] ?? null; const prev = candles[candles.length - 2] ?? null;
  const reaction = Boolean(last && prev && (bullishLeg ? Number(last.close) > Number(last.open) && Number(last.close) > Number(prev.close) : Number(last.close) < Number(last.open) && Number(last.close) < Number(prev.close)));
  const state = broken ? "ZONE_BROKEN" : inZone.length ? (reaction ? "ZONE_REACTION" : "IN_ZONE") : "OUT_OF_ZONE";
  const supportingEvidence = [];
  const counterEvidence = [];
  const observations = [`leg ${fib.direction} ${round(anchorA, 6)} -> ${round(num(fib.anchorB?.price), 6)}`];
  if (inZone.length) observations.push(`preco em zona ${inZone.join("/")} (tol ${round(tolerance, 6)})`);
  if (state === "ZONE_REACTION") { supportingEvidence.push({ code: "FIB_ZONE_REACTION", detail: `reacao na zona ${inZone.join("/")}` }); observations.push("reacao na zona fibonacci"); }
  if (state === "IN_ZONE") counterEvidence.push({ code: "FIB_SEM_REACAO", detail: "na zona sem reacao de preco" });
  if (state === "OUT_OF_ZONE") counterEvidence.push({ code: "FIB_FORA_DE_ZONA", detail: "fora das zonas 38.2/50.0/61.8" });
  if (state === "ZONE_BROKEN") { counterEvidence.push({ code: "FIB_ZONE_BROKEN", detail: "preco perdeu o anchor do leg" }); observations.push("zona rompida (leg invalidado)"); }
  return {
    agent: "FIB", version: FIB_AGENT_VERSION, snapshotId, state, direction: thesisSide, thesisSide,
    inZone, zoneReaction: reaction, levels: fib.levels, tolerance: round(tolerance, 8),
    anchors: fib.anchorA && fib.anchorB ? { a: fib.anchorA, b: fib.anchorB } : null,
    strength: round(clamp01(state === "ZONE_REACTION" ? 0.7 : state === "IN_ZONE" ? 0.35 : 0.05), 4),
    supportingEvidence, counterEvidence, observations,
    opinion: state === "ZONE_REACTION" ? `Preco reagiu na zona fibonacci ${inZone.join("/")}.` : state === "IN_ZONE" ? `Preco na zona ${inZone.join("/")} sem reacao ainda.` : state === "ZONE_BROKEN" ? "Leg fibonacci rompido." : "Preco fora das zonas fibonacci.",
  };
}
