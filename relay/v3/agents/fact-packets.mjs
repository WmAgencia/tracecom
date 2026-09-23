/**
 * V3 — FACT PACKETS v1: o motor deterministico compila os measurements em FACT PACKETS por papel.
 *
 * CODE TURNS RAW MARKET DATA INTO FACTS. LLM TURNS FACTS INTO PROFESSIONAL INTERPRETATION.
 *
 * - Pacote compacto por papel (RSI, DMI_ADX, BOLLINGER, ATR, PRICE_ACTION) + snapshot cross-domain (ASSET).
 * - Sem prosa, sem series longas, sem documentos: apenas fatos objetivos e numeros do backend.
 * - Primeiro ciclo de uma opportunity: FULL. Ciclos seguintes: DELTA (mudou/removeu/continua valido/eventos).
 * - Fingerprint deterministico por pacote (auditoria); sem depender de cache do provider.
 */
import crypto from "node:crypto";
import { stableStringify } from "../../intelligence/features.mjs";

export const V3_FACT_PACKETS_VERSION = "v3-fact-packets-v1";

const pick = (source, keys) => {
  const out = {};
  if (!source || typeof source !== "object") return out;
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
};

const compactRsi = (rsi) => (rsi ? pick(rsi, ["value", "zone", "slope", "acceleration", "crossback", "persistence", "failureSwing", "momentum", "divergence"]) : null);
const compactDmi = (dmi) => {
  if (!dmi) return null;
  const out = pick(dmi, ["adx", "adxSlope", "plusDi", "minusDi", "spread", "strength", "trendState", "dominance", "takeover", "pressureChange"]);
  if (dmi.measurements) out.previousSpread = dmi.measurements.previousSpread ?? null;
  return out;
};
const compactBollinger = (bollinger) => (bollinger ? pick(bollinger, ["percentB", "bandwidth", "midline", "midlineSlope", "bandWalk", "reentry", "rejection", "expansion", "squeeze"]) : null);
const compactAtr = (atr) => (atr ? pick(atr, ["atr", "atrPct", "volRatio", "regime", "normalizedRange", "normalizedImpulse", "normalizedPullback", "wickNormalization", "assessment"]) : null);
const compactStructure = (structure) => (structure ? pick(structure, ["trend", "lastBOS", "lastCHoCH", "lastHigh", "lastLow", "zones", "swingLegs", "pivotCount"]) : null);
const compactPullback = (pullback) => (pullback ? pick(pullback, ["active", "direction", "depth", "distanceAtr", "referenceExtreme", "structureTrend", "state"]) : null);
const compactMicro = (micro) => (micro ? pick(micro, ["bodyRatio", "closeInRange", "upperWickRatio", "lowerWickRatio", "direction", "streak", "character"]) : null);
const compactImpulse = (impulse) => (impulse ? pick(impulse, ["direction", "netMove", "normalized", "candles", "consecutiveDirection", "decelerating", "classification"]) : null);
const compactBreakout = (breakoutRetest) => (breakoutRetest ? pick(breakoutRetest, ["breakout", "breakdown", "retest", "failed", "resistance", "support"]) : null);
const compactZones = (zoneDistance) => (Array.isArray(zoneDistance) ? zoneDistance.slice(0, 4).map((zone) => pick(zone, ["type", "kind", "price", "distance", "distanceAtr", "side"])) : null);
const compactTiming = (timing) => (timing ? pick(timing, ["expirationAt", "tteMs", "phase"]) : null);

/** Fact packet por papel: somente o dominio do papel + o minimo de contexto estrutural. */
export function buildRolePacket(role, measurements, timing = null) {
  const m = measurements ?? {};
  const base = { timing: compactTiming(timing), closedCandle: m.closedCandle ?? null };
  switch (role) {
    case "RSI": return { ...base, structure: pick(compactStructure(m.structure), ["trend", "lastBOS", "lastCHoCH"]), rsi: compactRsi(m.rsi) };
    case "DMI_ADX": return { ...base, structure: pick(compactStructure(m.structure), ["trend"]), dmi: compactDmi(m.dmi) };
    case "BOLLINGER": return { ...base, atrContext: pick(compactAtr(m.atr), ["volRatio", "regime"]), bollinger: compactBollinger(m.bollinger) };
    case "ATR": return { ...base, atr: compactAtr(m.atr), micro: pick(compactMicro(m.micro), ["bodyRatio", "upperWickRatio", "lowerWickRatio"]) };
    case "PRICE_ACTION": return { ...base, structure: compactStructure(m.structure), pullback: compactPullback(m.pullback), zones: compactZones(m.zoneDistance), impulse: compactImpulse(m.impulse), micro: compactMicro(m.micro), breakoutRetest: compactBreakout(m.breakoutRetest) };
    case "ASSET": return buildAssetSnapshot(m, timing);
    default: return base;
  }
}

/** Snapshot cross-domain compacto do Asset (todos os dominios, formato de fatos, sem prosa). */
export function buildAssetSnapshot(measurements, timing = null) {
  const m = measurements ?? {};
  return {
    timing: compactTiming(timing),
    closedCandle: m.closedCandle ?? null,
    structure: compactStructure(m.structure),
    pullback: compactPullback(m.pullback),
    zones: compactZones(m.zoneDistance),
    impulse: compactImpulse(m.impulse),
    micro: compactMicro(m.micro),
    breakoutRetest: compactBreakout(m.breakoutRetest),
    rsi: compactRsi(m.rsi),
    dmi: compactDmi(m.dmi),
    bollinger: compactBollinger(m.bollinger),
    atr: compactAtr(m.atr),
  };
}

export function packetFingerprint(packet) {
  return crypto.createHash("sha256").update(stableStringify(packet ?? null)).digest("hex").slice(0, 16);
}

function flatten(value, prefix = "", out = new Map()) {
  if (value === null || value === undefined || typeof value !== "object") { out.set(prefix, value); return out; }
  if (Array.isArray(value)) { out.set(prefix, value); return out; }
  const keys = Object.keys(value);
  if (keys.length === 0) { out.set(prefix, {}); return out; }
  for (const key of keys) flatten(value[key], prefix ? `${prefix}.${key}` : key, out);
  return out;
}

const ESSENTIAL_BY_ROLE = Object.freeze({
  RSI: ["rsi.zone", "rsi.value", "rsi.momentum", "structure.trend"],
  DMI_ADX: ["dmi.dominance", "dmi.adx", "dmi.trendState", "structure.trend"],
  BOLLINGER: ["bollinger.squeeze", "bollinger.bandWalk", "bollinger.percentB"],
  ATR: ["atr.regime", "atr.volRatio"],
  PRICE_ACTION: ["structure.trend", "pullback.active", "pullback.depth", "breakoutRetest.breakout", "breakoutRetest.breakdown"],
  ASSET: ["structure.trend", "rsi.zone", "dmi.dominance", "atr.regime", "bollinger.squeeze", "pullback.active", "breakoutRetest.breakout", "breakoutRetest.breakdown"],
});

/** DELTA entre pacotes: mudou / removeu / continua valido / eventos novos e removidos. */
export function diffPacket(previous, current, { role = null, maxChanged = 12 } = {}) {
  const before = flatten(previous ?? {});
  const after = flatten(current ?? {});
  const changed = [];
  const removed = [];
  const eventsNew = [];
  const eventsRemoved = [];
  for (const [path, value] of after) {
    if (!before.has(path)) { changed.push({ path, from: null, to: value }); if (value === true) eventsNew.push(path); continue; }
    const prior = before.get(path);
    if (stableStringify(prior) === stableStringify(value)) continue;
    changed.push({ path, from: prior, to: value });
    if (prior === false && value === true) eventsNew.push(path);
    if (prior === true && value === false) eventsRemoved.push(path);
  }
  for (const [path, value] of before) if (!after.has(path)) { removed.push({ path, from: value }); if (value === true) eventsRemoved.push(path); }
  const essential = ESSENTIAL_BY_ROLE[role] ?? [];
  const stillValid = {};
  for (const path of essential) if (after.has(path) && before.has(path) && stableStringify(before.get(path)) === stableStringify(after.get(path))) stillValid[path] = after.get(path);
  return { changed: changed.slice(0, maxChanged), removed: removed.slice(0, maxChanged), eventsNew, eventsRemoved, stillValid, changedCount: changed.length, removedCount: removed.length };
}

/** Envelope pronto para o prompt: FULL no primeiro ciclo, DELTA (compacto) nos seguintes. */
export function buildPacketEnvelope({ role, measurements, timing = null, cycleNumber = null, previousPacket = null, previousAssessment = null } = {}) {
  const packet = buildRolePacket(role, measurements, timing);
  const fingerprint = packetFingerprint(packet);
  const hasPrevious = previousPacket !== null && previousPacket !== undefined;
  const delta = hasPrevious ? diffPacket(previousPacket, packet, { role }) : null;
  const mode = hasPrevious ? "DELTA" : "FULL";
  const payload = mode === "FULL"
    ? { cycle: cycleNumber, mode, role, facts: packet }
    : {
      cycle: cycleNumber, mode, role,
      changed: Object.fromEntries(delta.changed.map((item) => [item.path, [item.from, item.to]])),
      ...(delta.removed.length ? { removed: delta.removed.map((item) => item.path) } : {}),
      ...(delta.eventsNew.length || delta.eventsRemoved.length ? { events: { ...(delta.eventsNew.length ? { new: delta.eventsNew } : {}), ...(delta.eventsRemoved.length ? { removed: delta.eventsRemoved } : {}) } } : {}),
      stillValid: delta.stillValid,
      previousAssessment: previousAssessment ? {
        ...pick(previousAssessment, ["assessment", "scenario", "direction", "state", "thesis", "bestCounterCase"]),
        facts: Array.isArray(previousAssessment.facts) ? previousAssessment.facts.slice(0, 4).map((fact) => pick(fact, ["code", "direction", "strength"])) : undefined,
      } : null,
    };
  const json = JSON.stringify(payload);
  return { role, mode, fingerprint, chars: json.length, bytes: Buffer.byteLength(json, "utf8"), previousFingerprint: hasPrevious ? packetFingerprint(previousPacket) : null, packet, delta, payload, json };
}

export function factPacketEnvelopeJson(envelope) {
  return envelope?.json ?? JSON.stringify(envelope?.payload ?? null);
}
