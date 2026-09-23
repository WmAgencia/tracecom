/**
 * V3 — ASSET AGENT: identifica o CENARIO (tipo) e a DIRECAO separadamente, com contra-argumentacao.
 * Cenarios sao simetricos (tipo != direcao); a confirmacao exigida e espelhada por direcao.
 */
import { classifyScenarios, evaluateScenario } from "./scenarios.mjs";

export const V3_ASSET_VERSION = "v3-asset-agent-v2";

const TREND_FOLLOWING = new Set(["TREND_CONTINUATION", "PULLBACK_CONTINUATION", "TREND_RESUMPTION", "BREAKOUT", "BREAKOUT_RETEST", "FAILED_BREAKDOWN"]);
const REVERSAL = new Set(["STRUCTURAL_REVERSAL"]);
const DEFENSIVE_THREAT = new Set(["DEEP_PULLBACK_STRUCTURE_THREAT", "BREAKDOWN", "FAILED_BREAKOUT"]);
const WAIT_SCENARIOS = new Set(["COMPRESSION", "EXPANSION", "TRANSITION", "EXHAUSTION", "TREND_WEAKENING", "STRUCTURAL_ZONE_REJECTION", "RANGE"]);

const opposite = (direction) => (direction === "UP" ? "DOWN" : direction === "DOWN" ? "UP" : null);

/** Confirmacao estrutural exigida (por cenario e direcao). */
function confirmationCodes(scenarioId, direction) {
  const up = direction === "UP"; const down = direction === "DOWN";
  switch (scenarioId) {
    case "TREND_CONTINUATION": return [up ? "BULLISH_BOS" : "BEARISH_BOS", up ? "PLUS_DOMINANCE_STRONG" : "MINUS_DOMINANCE_STRONG"];
    case "PULLBACK_CONTINUATION": return [up ? "BULLISH_BOS" : "BEARISH_BOS", `RSI_CROSSBACK_${direction}`, `DECISIVE_${direction}`];
    case "TREND_RESUMPTION": return [up ? "PLUS_RESUME" : "MINUS_RESUME", `RSI_CROSSBACK_${direction}`, up ? "BULLISH_BOS" : "BEARISH_BOS"];
    case "BREAKOUT": return ["BREAKOUT"];
    case "BREAKOUT_RETEST": return ["BREAKOUT_RETEST", "RETEST_DEFENDED"];
    case "FAILED_BREAKDOWN": return ["FAILED_BREAKDOWN"];
    default: return [];
  }
}

function familySupport(specialists) {
  const families = new Map();
  const touch = (family) => { if (!families.has(family)) families.set(family, { facts: 0, invalidations: 0 }); return families.get(family); };
  for (const agent of Object.values(specialists ?? {})) {
    for (const item of agent?.facts ?? []) touch(item.family).facts += 1;
    for (const _ of agent?.invalidations ?? []) touch(agent.domain).invalidations += 1;
  }
  return families;
}

export function classifyAsset({ measurements, specialists, assetContext = null, previousAssessment = null, timing = null } = {}) {
  if (!measurements) return null;
  const candidates = classifyScenarios(measurements);
  const top = candidates[0] ?? null;
  const scenarioEval = top ? evaluateScenario(top.scenarioId, measurements) : evaluateScenario("NO_SETUP", measurements);
  const blockers = [];
  const invalidations = [];
  for (const agent of Object.values(specialists ?? {})) {
    for (const blocker of agent?.blockers ?? []) blockers.push({ role: agent.role, ...blocker });
    for (const invalidation of agent?.invalidations ?? []) invalidations.push({ role: agent.role, ...invalidation });
  }
  for (const blocker of scenarioEval?.blockers ?? []) blockers.push({ scenario: scenarioEval.scenarioId, ...blocker });
  for (const invalidation of scenarioEval?.invalidations ?? []) invalidations.push({ scenario: scenarioEval.scenarioId, ...invalidation });

  const direction = scenarioEval?.direction ?? null;
  let state = "NO_SETUP";
  if (top) {
    if (WAIT_SCENARIOS.has(top.scenarioId)) state = "WAIT";
    else if (TREND_FOLLOWING.has(top.scenarioId)) {
      const expected = confirmationCodes(top.scenarioId, direction);
      const codes = new Set((scenarioEval?.evidence ?? []).filter((item) => item.type === "SUPPORT").map((item) => item.code));
      state = expected.some((code) => codes.has(code)) ? (direction === "UP" ? "BUY_CANDIDATE" : "SELL_CANDIDATE") : "WAIT";
    } else if (REVERSAL.has(top.scenarioId)) {
      state = direction === "UP" ? "BUY_CANDIDATE" : direction === "DOWN" ? "SELL_CANDIDATE" : "WAIT";
    } else if (DEFENSIVE_THREAT.has(top.scenarioId)) {
      // ameaca na direcao da tendencia implica postura defensiva na direcao oposta
      state = direction === "UP" ? "SELL_CANDIDATE" : direction === "DOWN" ? "BUY_CANDIDATE" : "WAIT";
    }
  }
  // Quebras direcionais: um BEARISH_CHOCH mata tese de alta; BULLISH_CHOCH mata tese de baixa.
  const bearishBreak = invalidations.some((item) => item.code === "BEARISH_CHOCH");
  const bullishBreak = invalidations.some((item) => item.code === "BULLISH_CHOCH");
  if (state === "BUY_CANDIDATE" && bearishBreak) state = "WAIT";
  if (state === "SELL_CANDIDATE" && bullishBreak) state = "WAIT";
  if (state === "NO_SETUP" && top) state = "WAIT";

  const priorScenario = previousAssessment?.scenario ?? null;
  const changed = [];
  if (priorScenario !== scenarioEval?.scenarioId) changed.push({ field: "scenario", from: priorScenario, to: scenarioEval?.scenarioId ?? null });
  if ((previousAssessment?.direction ?? null) !== direction) changed.push({ field: "direction", from: previousAssessment?.direction ?? null, to: direction });
  if (previousAssessment?.state !== state) changed.push({ field: "state", from: previousAssessment?.state ?? null, to: state });

  return {
    version: V3_ASSET_VERSION,
    scenario: scenarioEval?.scenarioId ?? null,
    scenarioState: scenarioEval?.matched === true ? "MATCHED" : "UNMATCHED",
    state, direction,
    reasoningSummary: summarize({ scenarioEval, state, blockers, invalidations, candidates }),
    supportingEvidence: scenarioEval?.evidence?.filter((item) => item.type === "SUPPORT") ?? [],
    counterEvidence: scenarioEval?.evidence?.filter((item) => item.type === "COUNTER") ?? [],
    blockers, invalidations,
    changedSincePreviousCycle: changed,
    nextEvidenceToWatch: nextEvidenceFor(scenarioEval?.scenarioId ?? null, direction),
    familySupport: Object.fromEntries([...familySupport(specialists).entries()].map(([family, bucket]) => [family, bucket])),
    scenarioCandidates: candidates.slice(0, 4).map((candidate) => ({ scenario: candidate.scenarioId, direction: candidate.direction, supports: candidate.supports })),
    bestCounterCase: buildBestCounterCase({ measurements, specialists, scenarioEval, state, candidates }),
    timing,
    at: measurements.closedCandleAt ?? null,
  };
}

function buildBestCounterCase({ measurements, specialists, scenarioEval, state, candidates }) {
  const contrary = [];
  for (const agent of Object.values(specialists ?? {})) {
    for (const item of agent?.facts ?? []) {
      if (item.direction && scenarioEval?.direction && item.direction !== scenarioEval.direction) contrary.push({ role: agent.role, ...item });
    }
    for (const item of agent?.blockers ?? []) contrary.push({ role: agent.role, type: "BLOCKER", code: item.code, detail: item.detail });
  }
  const opposite = candidates.find((candidate) => candidate.direction && scenarioEval?.direction && candidate.direction !== scenarioEval.direction);
  return {
    thesisUnderTest: scenarioEval?.scenarioId ?? null,
    assumedWrong: state === "BUY_CANDIDATE" || state === "SELL_CANDIDATE" ? state.replace("_CANDIDATE", "") : null,
    strongestContrary: contrary.sort((a, b) => (a.type === "BLOCKER" ? -1 : 1) - (b.type === "BLOCKER" ? -1 : 1)).slice(0, 4),
    alternativeScenario: opposite ? { scenario: opposite.scenarioId, direction: opposite.direction, supports: opposite.supports } : null,
    structuralFacts: {
      trend: measurements?.structure?.trend ?? null,
      lastCHoCH: measurements?.structure?.lastCHoCH?.type ?? null,
      pullbackDepth: measurements?.pullback?.depth ?? null,
      adx: measurements?.dmi?.adx ?? null,
      adxSlope: measurements?.dmi?.adxSlope ?? null,
    },
  };
}

function summarize({ scenarioEval, state, blockers, invalidations, candidates }) {
  const parts = [`cenario=${scenarioEval?.scenarioId ?? "NONE"} direcao=${scenarioEval?.direction ?? "NONE"} estado=${state}`];
  if (scenarioEval?.supports) parts.push(`supports=${scenarioEval.supports}`);
  if (scenarioEval?.counters) parts.push(`counters=${scenarioEval.counters}`);
  if (blockers.length) parts.push(`blockers=${blockers.map((item) => item.code).join(",")}`);
  if (invalidations.length) parts.push(`invalidations=${invalidations.map((item) => item.code).join(",")}`);
  if (candidates.length > 1) parts.push(`alternativas=${candidates.slice(1, 3).map((candidate) => `${candidate.scenarioId}:${candidate.direction ?? "-"}`).join(",")}`);
  return parts.join(" · ");
}

function nextEvidenceFor(scenarioId, direction) {
  const dir = direction ?? "-";
  switch (scenarioId) {
    case "PULLBACK_CONTINUATION": return [`BOS de retomada (${dir}) ou crossback do RSI`, "defesa do swing de referencia", `micro decisivo ${dir}`];
    case "TREND_CONTINUATION": return [`novo BOS ${dir}`, "persistencia da dominancia DI", "ausencia de CHoCH contrario"];
    case "STRUCTURAL_REVERSAL": return [`CHoCH mantido ${dir} + takeover DI`, "failed breakout no lado antigo"];
    case "BREAKOUT": return ["reteste defensavel", "retencao da zona rompida"];
    case "RANGE": return ["rompimento com fechamento ou perda da zona oposta"];
    default: return ["novo candle fechado com mudanca estrutural"];
  }
}

export function validateAssetAgent() {
  return { version: V3_ASSET_VERSION, states: ["NO_SETUP", "WAIT", "BUY_CANDIDATE", "SELL_CANDIDATE"] };
}
