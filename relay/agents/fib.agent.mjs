/**
 * AGENTE FIBONACCI (v2 — TESE DE REVERSAO) — swings confirmados causalmente (pivot ±3, confirmacao em i+3).
 * SELL: leg anterior de ALTA; confirma reversao se o preco esta NO TOPO do leg (dentro de 0.5xATR) com
 * candle de rejeicao, OU retracou para a 1a zona (23.6/38.2) e rejeitou (retracao falhou).
 * BUY: espelho (leg de BAIXA; fundo do leg com reacao, ou rejeicao da 1a zona acima).
 * Leg rompido (preco segue alem do extremo) = continuacao -> bloqueio.
 */
export const FIB_AGENT_VERSION = "agent-fib-v2-reversal";
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
  const side = bullishLeg ? "SELL" : "BUY";
  const extreme = bullishLeg ? num(fib.anchorB?.price) : num(fib.anchorB?.price);
  const anchorA = num(fib.anchorA?.price);
  const tolerance = num(fib.tolerance) ?? 0;
  const levels = fib.levels ?? {};
  const firstZones = ["23.6", "38.2"];
  const inFirstZone = firstZones.filter((level) => Number.isFinite(Number(levels[level])) && Math.abs(close - Number(levels[level])) <= tolerance);
  const last = candles[candles.length - 1] ?? null; const prev = candles[candles.length - 2] ?? null;
  const reactionAgainstLeg = Boolean(last && (bullishLeg
    ? Number(last.close) < Number(last.open) && Number(last.close) < Number(prev?.close ?? Number(last.open))
    : Number(last.close) > Number(last.open) && Number(last.close) > Number(prev?.close ?? Number(last.open))));
  const atExtreme = extreme !== null && Math.abs(close - extreme) <= tolerance;
  const brokeExtreme = extreme !== null && (bullishLeg ? close > extreme + tolerance : close < extreme - tolerance);
  const brokeAnchor = anchorA !== null ? (bullishLeg ? close < anchorA : close > anchorA) : false;

  let state = "NO_CONTEXT";
  if (brokeAnchor) state = "ZONE_BROKEN";
  else if (brokeExtreme) state = "EXTREME_BROKEN";
  else if (atExtreme) state = reactionAgainstLeg ? "AT_EXTREME_REACTION" : "AT_EXTREME";
  else if (inFirstZone.length) state = reactionAgainstLeg ? "ZONE_REJECTION" : "IN_RETRACEMENT";
  else state = "OUT_OF_ZONE";

  const supportingEvidence = [];
  const counterEvidence = [];
  const observations = [`leg ${fib.direction} ${round(anchorA, 6)} -> ${round(extreme, 6)} | tese ${side} (reversao)`];
  if (atExtreme) observations.push(`preco no extremo do leg (tol ${round(tolerance, 6)})`);
  if (inFirstZone.length) observations.push(`preco na 1a zona de retracao ${inFirstZone.join("/")}`);
  if (state === "AT_EXTREME_REACTION") { supportingEvidence.push({ code: "FIB_EXTREMO_REJEICAO", detail: `rejeicao no extremo do leg ${bullishLeg ? "de alta" : "de baixa"}` }); observations.push("rejeicao no extremo (reversao faz sentido)"); }
  if (state === "ZONE_REJECTION") { supportingEvidence.push({ code: "FIB_ZONA_REJEITADA", detail: `retracao para ${inFirstZone.join("/")} falhou (rejeicao)` }); observations.push("retracao rejeitada"); }
  if (state === "AT_EXTREME") counterEvidence.push({ code: "FIB_SEM_REACAO", detail: "no extremo sem candle de rejeicao ainda" });
  if (state === "IN_RETRACEMENT") counterEvidence.push({ code: "FIB_SEM_REACAO", detail: "na retracao sem rejeicao ainda" });
  if (state === "OUT_OF_ZONE") counterEvidence.push({ code: "FIB_FORA_DE_ZONA", detail: "fora do extremo e das 1as zonas de retracao" });
  if (state === "EXTREME_BROKEN") { counterEvidence.push({ code: "FIB_ZONE_BROKEN", detail: "preco seguiu alem do extremo do leg (continuacao)" }); observations.push("extremo rompido (continuacao)"); }
  if (state === "ZONE_BROKEN") { counterEvidence.push({ code: "FIB_ZONE_BROKEN", detail: "preco perdeu o anchor do leg" }); observations.push("leg invalidado"); }

  const strength = clamp01(state === "AT_EXTREME_REACTION" ? 0.75 : state === "ZONE_REJECTION" ? 0.65 : state === "AT_EXTREME" || state === "IN_RETRACEMENT" ? 0.3 : 0.05);
  return {
    agent: "FIB", version: FIB_AGENT_VERSION, snapshotId, state, direction: side, thesisSide: side,
    inZone: inFirstZone, zoneReaction: reactionAgainstLeg, atExtreme, levels: fib.levels, tolerance: round(tolerance, 8),
    anchors: fib.anchorA && fib.anchorB ? { a: fib.anchorA, b: fib.anchorB } : null,
    strength: round(strength, 4), supportingEvidence, counterEvidence, observations,
    opinion: state === "AT_EXTREME_REACTION" ? `Preco rejeitou o extremo do leg ${bullishLeg ? "de alta" : "de baixa"} (reversao ${side}).` : state === "ZONE_REJECTION" ? `Retracao ${inFirstZone.join("/")} rejeitada (reversao ${side}).` : state === "AT_EXTREME" ? "Preco no extremo sem rejeicao ainda." : state === "EXTREME_BROKEN" || state === "ZONE_BROKEN" ? "Leg rompido (continuacao)." : "Sem contexto fibonacci para reversao.",
  };
}
