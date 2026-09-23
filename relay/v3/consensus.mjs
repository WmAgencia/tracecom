/**
 * V3 — CONSENSUS (arbitro independente + red-team + FINAL CHALLENGE).
 *
 * Duas fases para evitar anchoring:
 *  PASSO A: classificacao INDEPENDENTE do mercado (mesma Scenario Library, sem a
 *           conclusao do Asset) — preserva a independencia do julgamento.
 *  PASSO B: compara com a tese do Asset (AGREE/DISAGREE/INSUFFICIENT_EVIDENCE), assume
 *           a tese ERRADA, constroi o melhor caso contrario e roda o FINAL CHALLENGE.
 *
 * PROIBIDO votacao/majority/confidence: usa familias de evidencia independentes e regras
 * de precedencia (invalidations > blockers > supports correlacionados).
 */
import { classifyScenarios, evaluateScenario } from "./scenarios.mjs";

export const V3_CONSENSUS_VERSION = "v3-consensus-v1";

export const FINAL_CHALLENGE_RESULTS = Object.freeze(["APPROVE_BUY", "APPROVE_SELL", "CANCEL"]);
export const AGREEMENT = Object.freeze(["AGREE", "DISAGREE", "INSUFFICIENT_EVIDENCE"]);

export function independentClassification({ measurements, assetContext = null } = {}) {
  const candidates = classifyScenarios(measurements);
  const top = candidates[0] ?? null;
  return {
    method: "INDEPENDENT_SCENARIO_CLASSIFICATION",
    scenario: top?.scenarioId ?? null,
    direction: top?.direction ?? null,
    supports: top?.supports ?? 0,
    counters: top?.counters ?? 0,
    candidates: candidates.slice(0, 4).map((candidate) => ({ scenario: candidate.scenarioId, direction: candidate.direction, supports: candidate.supports })),
    evidence: top?.evidence ?? [],
    assetContextIncluded: assetContext !== null,
  };
}

function sameDirection(a, b) { return a !== null && b !== null && a === b; }

/** Invalidation bloqueia a tese conforme a direcao: BEARISH quebra alta; BULLISH quebra baixa. */
function invalidationBlocks(code, direction) {
  const text = String(code ?? "");
  if (/BEARISH/.test(text)) return direction !== "DOWN";
  if (/BULLISH/.test(text)) return direction !== "UP";
  return true;
}

export function compareWithAsset({ independent, asset }) {
  if (!independent?.scenario || !asset?.scenario) return "INSUFFICIENT_EVIDENCE";
  if (independent.scenario === asset.scenario) return "AGREE";
  if (sameDirection(independent.direction, asset.direction)) return "AGREE";
  return "DISAGREE";
}

function evidenceFamilies(measurements, scenarioEval) {
  const families = new Map();
  for (const item of scenarioEval?.evidence ?? []) {
    if (!families.has(item.family)) families.set(item.family, { support: 0, counter: 0 });
    const bucket = families.get(item.family);
    if (item.type === "SUPPORT") bucket.support += 1; else bucket.counter += 1;
  }
  return Object.fromEntries([...families.entries()]);
}

/**
 * FINAL CHALLENGE: sem percentage, sem obrigacao de operar. Qualquer duvida relevante => CANCEL.
 * Regras de precedencia (documentadas, nao votos):
 *  1) qualquer INVALIDATION => CANCEL;
 *  2) qualquer BLOCKER relevante => CANCEL;
 *  3) direcao proposta tem de ter suporte estrutural (familia STRUCTURE);
 *  4) exige >= 2 familias independentes de SUPPORT;
 *  5) classificacao independente nao pode DISAGREE do Asset;
 *  6) timing/expiration tem de estar dentro da janela (quando informado).
 */
export function finalChallenge({ measurements, asset, independent, timing = null, changedSincePreviousCycle = [] } = {}) {
  const result = { version: V3_CONSENSUS_VERSION, agreement: compareWithAsset({ independent, asset }), challengeSteps: [], bestCounterCase: asset?.bestCounterCase ?? null, result: "CANCEL", reasons: [], evidenceFamilies: {}, timing: timing ?? null };
  const step = (id, ok, detail = null) => { result.challengeSteps.push({ id, ok, detail }); return ok; };

  const scenarioEval = evaluateScenario(asset?.scenario ?? "NO_SETUP", measurements);
  result.evidenceFamilies = evidenceFamilies(measurements, scenarioEval);

  const invalidations = [...(asset?.invalidations ?? []), ...(scenarioEval?.invalidations ?? [])].filter((item) => invalidationBlocks(item.code, asset?.direction ?? null));
  step("NO_INVALIDATIONS", invalidations.length === 0, invalidations.map((item) => item.code));
  const blockers = [...(asset?.blockers ?? []), ...(scenarioEval?.blockers ?? [])].filter((item) => !["ADX_WEAK", "SQUEEZE_DIRECTION_UNKNOWN", "VOL_BULGE_CONTEXT"].includes(item.code));
  step("NO_BLOCKERS", blockers.length === 0, blockers.map((item) => item.code));
  const structuralSupport = Object.entries(result.evidenceFamilies).some(([family, bucket]) => family === "STRUCTURE" && bucket.support > 0);
  step("STRUCTURAL_SUPPORT", structuralSupport, result.evidenceFamilies);
  const independentFamilies = Object.values(result.evidenceFamilies).filter((bucket) => bucket.support > 0).length;
  step("TWO_INDEPENDENT_FAMILIES", independentFamilies >= 2, independentFamilies);
  step("INDEPENDENT_AGREEMENT", result.agreement !== "DISAGREE", result.agreement);
  if (timing) step("TIMING_WINDOW", timing.ok === true, timing.code ?? null);
  step("PROPOSED_SIDE", asset?.state === "BUY_CANDIDATE" || asset?.state === "SELL_CANDIDATE", asset?.state ?? null);

  if (changedSincePreviousCycle?.some((change) => change.field === "scenario")) result.reasons.push("SCENARIO_CHANGED_LAST_CYCLE");

  const approved = result.challengeSteps.every((item) => item.ok) && result.agreement === "AGREE";
  if (approved) result.result = asset.state === "BUY_CANDIDATE" ? "APPROVE_BUY" : "APPROVE_SELL";
  else result.reasons.push(...result.challengeSteps.filter((item) => !item.ok).map((item) => item.id));
  return result;
}

export function runConsensus({ measurements, asset, timing = null, changedSincePreviousCycle = [] } = {}) {
  const independent = independentClassification({ measurements });
  const challenge = finalChallenge({ measurements, asset, independent, timing, changedSincePreviousCycle });
  return { version: V3_CONSENSUS_VERSION, independent, agreement: challenge.agreement, bestCounterCase: challenge.bestCounterCase, challenge, result: challenge.result };
}
