/**
 * V3 — FINAL GATE (deterministico): compara Asset x Consensus independente SEM nova chamada LLM.
 * Usa o red-team BILATERAL ja produzido pelo Consensus (bestCaseAgainstUp/Down) para a direcao da tese.
 * Sem votacao: agreement + scenario + familias + blockers + invalidations direcionais + counter-case.
 */
export const V3_FINAL_GATE_VERSION = "v3-final-gate-v1";

const opposite = (direction) => (direction === "UP" ? "DOWN" : direction === "DOWN" ? "UP" : null);

function invalidationBlocks(code, direction) {
  const text = String(code ?? "");
  if (/BEARISH/.test(text)) return direction !== "DOWN";
  if (/BULLISH/.test(text)) return direction !== "UP";
  return true;
}

export function finalGate({ asset, consensus, timing = null, stalenessMs = null, now = Date.now() } = {}) {
  const steps = [];
  const reasons = [];
  const step = (id, ok, detail = null) => { steps.push({ id, ok, detail }); if (!ok) reasons.push(id); return ok; };

  const direction = asset?.direction ?? "NONE";
  const proposed = asset?.state === "BUY_CANDIDATE" ? "BUY" : asset?.state === "SELL_CANDIDATE" ? "SELL" : null;
  if (!step("PROPOSED_SIDE", proposed !== null, asset?.state ?? null)) return { version: V3_FINAL_GATE_VERSION, result: "CANCEL", agreement: "INSUFFICIENT_EVIDENCE", steps, reasons, direction, counterCase: null };

  const agreement = consensus?.direction && direction !== "NONE" ? (consensus.direction === direction ? "AGREE" : "DISAGREE") : "INSUFFICIENT_EVIDENCE";
  step("INDEPENDENT_AGREEMENT", agreement === "AGREE", { assetDirection: direction, consensusDirection: consensus?.direction ?? null });

  const scenarioCompatible = asset?.scenario && consensus?.scenario ? (asset.scenario === consensus.scenario ? "SAME" : "DIRECTION_ALIGNED") : "UNKNOWN";
  step("SCENARIO_COMPATIBLE", scenarioCompatible !== "UNKNOWN", { asset: asset?.scenario ?? null, consensus: consensus?.scenario ?? null, relation: scenarioCompatible });

  const families = Array.isArray(consensus?.evidenceFamilies) ? consensus.evidenceFamilies : [];
  const structureFamily = families.some((item) => String(item?.family ?? "").toUpperCase().includes("STRUCT"));
  step("STRUCTURAL_FAMILY", structureFamily, families.map((item) => item?.family ?? null));
  step("TWO_FAMILIES", families.length >= 2, families.length);

  const blockers = [...(asset?.blockers ?? []), ...(consensus?.blockers ?? [])];
  step("NO_BLOCKERS", blockers.length === 0, blockers.slice(0, 5));

  const invalidations = [...(asset?.invalidations ?? []), ...(consensus?.invalidations ?? [])].filter((item) => invalidationBlocks(item, direction === "NONE" ? null : direction));
  step("NO_DIRECTIONAL_INVALIDATIONS", invalidations.length === 0, invalidations.slice(0, 5));

  const counterCase = direction === "UP" ? (consensus?.bestCaseAgainstUp ?? []) : (consensus?.bestCaseAgainstDown ?? []);
  step("COUNTER_CASE_PREPARED", Array.isArray(counterCase), counterCase);
  if (Array.isArray(counterCase) && counterCase.length === 0) steps.push({ id: "NO_STRONG_COUNTER_DECLARED", ok: true, detail: null });

  const ambiguities = consensus?.marketAmbiguities ?? [];
  step("NO_MARKET_AMBIGUITIES", ambiguities.length === 0, ambiguities.slice(0, 5));

  if (timing) {
    const tte = Number(timing.tteMs);
    step("ANALYSIS_WINDOW", Number.isFinite(tte) ? (tte > 300_000 && tte <= 330_000) : false, timing);
  }
  if (stalenessMs !== null && asset?.at) {
    step("FRESHNESS", now - Number(asset.at) <= Number(stalenessMs), { ageMs: now - Number(asset.at), stalenessMs });
  }

  const approved = steps.every((item) => item.ok);
  const result = approved ? (proposed === "BUY" ? "APPROVE_BUY" : "APPROVE_SELL") : "CANCEL";
  return { version: V3_FINAL_GATE_VERSION, result, agreement, steps, reasons, direction, counterCase: Array.isArray(counterCase) ? counterCase.slice(0, 4) : null };
}
