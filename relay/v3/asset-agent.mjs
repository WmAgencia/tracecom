/**
 * V3 — ASSET AGENT: identifica o CENARIO e o estado operacional.
 *
 * Nao e gatilho de RSI. Recebe AssetContext/measurements + outputs dos especialistas,
 * classifica o cenario com a Scenario Library e produz um estado operacional
 * (NO_SETUP | WAIT | BUY_CANDIDATE | SELL_CANDIDATE), sempre com contra-argumentacao
 * explicita (bestCounterCase). A opiniao anterior nao tem autoridade: mudar de ideia
 * e permitido a cada ciclo.
 */
import { classifyScenarios, evaluateScenario } from "./scenarios.mjs";

export const V3_ASSET_VERSION = "v3-asset-agent-v1";

const CONFIRMATION_SCENARIOS = new Set(["TREND_CONTINUATION", "PULLBACK_CONTINUATION", "TREND_RESUMPTION", "BREAKOUT", "BREAKOUT_RETEST", "FAILED_BREAKDOWN"]);
const DEFENSIVE_SCENARIOS = new Set(["STRUCTURAL_REVERSAL", "BREAKDOWN", "FAILED_BREAKOUT", "DEEP_PULLBACK_STRUCTURE_THREAT"]);
const WAIT_SCENARIOS = new Set(["COMPRESSION", "EXPANSION", "TRANSITION", "EXHAUSTION", "TREND_WEAKENING", "STRUCTURAL_ZONE_REJECTION", "RANGE"]);
/** Confirmacao estrutural exigida para sair de WAIT rumo a candidato (por cenario). */
const CONFIRMATION_EVIDENCE = Object.freeze({
  TREND_CONTINUATION: ["BULLISH_BOS", "PLUS_DOMINANCE_STRONG"],
  PULLBACK_CONTINUATION: ["BULLISH_BOS", "RSI_CROSSBACK_UP", "DECISIVE_UP"],
  TREND_RESUMPTION: ["PLUS_RESUME", "RSI_CROSSBACK_UP", "BULLISH_BOS"],
  BREAKOUT: ["BREAKOUT"],
  BREAKOUT_RETEST: ["BREAKOUT_RETEST"],
  FAILED_BREAKDOWN: ["FAILED_BREAKDOWN"],
});

function familySupport(specialists) {
  const families = new Map();
  for (const role of ["rsi", "dmi", "bollinger", "atr", "priceAction"]) {
    const agent = specialists?.[role];
    if (!agent) continue;
    for (const item of [...(agent.supportingEvidence ?? []), ...(agent.invalidations ?? []).map((entry) => ({ ...entry, family: agent.domain, type: "INVALIDATION" }))]) {
      if (!families.has(item.family)) families.set(item.family, { support: 0, counter: 0, invalidation: 0 });
      const bucket = families.get(item.family);
      if (item.type === "INVALIDATION") bucket.invalidation += 1;
      else if (item.family === "STRUCTURE" ? agent.role === "PRICE_ACTION" : true) bucket.support += 1;
    }
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
    else if (CONFIRMATION_SCENARIOS.has(top.scenarioId)) {
      // "Existe cenario interessante, mas ainda nao ha evidencia suficiente" => WAIT (missao 19).
      const expected = CONFIRMATION_EVIDENCE[top.scenarioId] ?? [];
      const codes = new Set((scenarioEval?.evidence ?? []).filter((item) => item.type === "SUPPORT").map((item) => item.code));
      state = expected.some((code) => codes.has(code)) ? "BUY_CANDIDATE" : "WAIT";
    } else if (DEFENSIVE_SCENARIOS.has(top.scenarioId)) state = "SELL_CANDIDATE";
  }
  const structuralThreat = invalidations.some((item) => /CHOCH|STRUCTURE_BREAK/.test(String(item.code ?? "")));
  if (state === "BUY_CANDIDATE" && (blockers.some((item) => item.code === "DEEP_PULLBACK_STRUCTURE_THREAT") || structuralThreat)) state = "WAIT";
  if (state === "SELL_CANDIDATE" && invalidations.some((item) => item.code === "FRESH_BULLISH_BOS")) state = "WAIT";
  if (state === "NO_SETUP" && top) state = "WAIT";

  const priorScenario = previousAssessment?.scenario ?? null;
  const changed = [];
  if (priorScenario !== scenarioEval?.scenarioId) changed.push({ field: "scenario", from: priorScenario, to: scenarioEval?.scenarioId ?? null });
  if (previousAssessment?.state !== state) changed.push({ field: "state", from: previousAssessment?.state ?? null, to: state });

  const bestCounterCase = buildBestCounterCase({ measurements, specialists, scenarioEval, state, candidates });

  return {
    version: V3_ASSET_VERSION,
    scenario: scenarioEval?.scenarioId ?? null,
    scenarioState: scenarioEval?.matched === true ? "MATCHED" : "UNMATCHED",
    state,
    direction,
    reasoningSummary: summarize({ scenarioEval, state, blockers, invalidations, candidates }),
    supportingEvidence: scenarioEval?.evidence?.filter((item) => item.type === "SUPPORT") ?? [],
    counterEvidence: scenarioEval?.evidence?.filter((item) => item.type === "COUNTER") ?? [],
    blockers,
    invalidations,
    changedSincePreviousCycle: changed,
    nextEvidenceToWatch: nextEvidenceFor(scenarioEval?.scenarioId ?? null),
    familySupport: Object.fromEntries([...familySupport(specialists).entries()].map(([family, bucket]) => [family, bucket])),
    scenarioCandidates: candidates.slice(0, 4).map((candidate) => ({ scenario: candidate.scenarioId, supports: candidate.supports, direction: candidate.direction })),
    bestCounterCase,
    timing,
    at: measurements.closedCandleAt ?? null,
  };
}

function buildBestCounterCase({ measurements, specialists, scenarioEval, state, candidates }) {
  const contrary = [];
  for (const agent of Object.values(specialists ?? {})) {
    for (const item of agent?.counterEvidence ?? []) contrary.push({ role: agent.role, ...item });
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
  const parts = [`cenario=${scenarioEval?.scenarioId ?? "NONE"} estado=${state}`];
  if (scenarioEval?.supports) parts.push(`supports=${scenarioEval.supports}`);
  if (scenarioEval?.counters) parts.push(`counters=${scenarioEval.counters}`);
  if (blockers.length) parts.push(`blockers=${blockers.map((item) => item.code).join(",")}`);
  if (invalidations.length) parts.push(`invalidations=${invalidations.map((item) => item.code).join(",")}`);
  if (candidates.length > 1) parts.push(`alternativas=${candidates.slice(1, 3).map((candidate) => candidate.scenarioId).join(",")}`);
  return parts.join(" · ");
}

function nextEvidenceFor(scenarioId) {
  switch (scenarioId) {
    case "PULLBACK_CONTINUATION": return ["BOS de retomada ou crossback do RSI", "defesa do swing de referencia", "micro decisivo a favor"];
    case "TREND_CONTINUATION": return ["novo BOS", "persistencia da dominancia DI", "ausencia de CHoCH"];
    case "STRUCTURAL_REVERSAL": return ["CHoCH mantido + takeover DI", "failed breakout no lado antigo"];
    case "BREAKOUT": return ["reteste defensavel", "retencao da zona rompida"];
    case "RANGE": return ["rompimento com fechamento ou perda da zona oposta"];
    default: return ["novo candle fechado com mudanca estrutural"];
  }
}

export function validateAssetAgent() {
  return { version: V3_ASSET_VERSION, states: ["NO_SETUP", "WAIT", "BUY_CANDIDATE", "SELL_CANDIDATE"] };
}
