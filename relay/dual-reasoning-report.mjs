/**
 * DUAL_REASONING REPORT — observabilidade pura do DUAL_REASONING_V1_SHADOW (congelado).
 * Nao altera o experimento; apenas le as observacoes persistidas e produz metricas auditaveis.
 */
import { dualSynthesis } from "./dual-reasoning.mjs";

export const DUAL_REPORT_VERSION = "dual-reasoning-report-v1";
export const CHECKPOINT_LEVELS = Object.freeze([30, 60, 100, 200, 500]);
const DECIDED = new Set(["WIN", "LOSS", "DRAW"]);
const FLIP = { WIN: "LOSS", LOSS: "WIN", DRAW: "DRAW" };

export function wilson(w, n) { if (!n) return { low: null, high: null }; const p = w / n, z = 1.96, d = 1 + z * z / n; const c = (p + z * z / (2 * n)) / d; const h = (z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / d; return { low: Number(Math.max(0, c - h).toFixed(4)), high: Number(Math.min(1, c + h).toFixed(4)) }; }
export function cohort(results = []) { const list = results.filter((r) => DECIDED.has(r)); const w = list.filter((r) => r === "WIN").length, l = list.filter((r) => r === "LOSS").length, n = w + l; return { n: list.length, decided: n, wins: w, losses: l, draws: list.length - w - l, wr: n ? Number((w / n).toFixed(4)) : null, ci95: wilson(w, n), lowN: n < 30 }; }
function expectancyOf(results, payouts) { const list = results.filter((r) => DECIDED.has(r)); const w = list.filter((r) => r === "WIN").length, l = list.filter((r) => r === "LOSS").length, d = list.length - w - l; if (!list.length) return null; const p = payouts.filter((v) => Number.isFinite(v) && v > 0); const fraction = p.length ? p.reduce((a, b) => a + b, 0) / p.length : null; const win = fraction ? (fraction > 1 ? fraction / 100 : fraction) : 1; return Number((((w * win) - l) / list.length).toFixed(4)); }
function breakEven(payouts) { const p = payouts.filter((v) => Number.isFinite(v) && v > 0); if (!p.length) return null; const avg = p.reduce((a, b) => a + b, 0) / p.length; const fraction = avg > 1 ? avg / 100 : avg; return Number((1 / (1 + fraction)).toFixed(4)); }

function actionOf(thesis) { return thesis?.candidateAction ?? "WAIT"; }
function dirOf(thesis) { return thesis?.structuralDirection ?? thesis?.shortDirection ?? null; }

/** Contrafactual exato por direcao usando settlements existentes (V3 primeiro, depois V4); flip e exato em binarias. */
export function makeCounterfactualResolver({ g2 = null, v4 = null } = {}) {
  return function resolve(direction) {
    if (!direction) return { result: null, source: "NO_DIRECTION" };
    if (g2 && g2.direction === direction && DECIDED.has(g2.result)) return { result: g2.result, source: "G2" };
    if (v4 && v4.direction === direction && DECIDED.has(v4.result)) return { result: v4.result, source: "V4" };
    const base = g2 && DECIDED.has(g2.result) ? g2.result : v4 && DECIDED.has(v4.result) ? v4.result : null;
    if (!base) return { result: null, source: "NO_SETTLEMENT" };
    return { result: FLIP[base], source: g2 && DECIDED.has(g2.result) ? "G2_FLIP" : "V4_FLIP" };
  };
}

export function buildDualReport({ rows = [], g2ByCandidate = new Map(), v4ByCandidate = new Map(), levels = CHECKPOINT_LEVELS, roundDeltasByObservation = new Map() } = {}) {
  const observations = rows.map((row) => {
    const r1 = row.payload?.rounds?.R1 ?? null, r2 = row.payload?.rounds?.R2 ?? null, fin = row.payload?.rounds?.FINAL ?? null;
    const g2 = g2ByCandidate.get(row.candidate_id) ?? null;
    const v4 = v4ByCandidate.get(row.candidate_id) ?? null;
    const resolve = makeCounterfactualResolver({ g2, v4 });
    const finalA = fin?.a ?? r2?.a ?? r1?.a ?? null, finalB = fin?.b ?? r2?.b ?? r1?.b ?? null;
    const direction = row.direction ?? null;
    const result = DECIDED.has(row.theoretical_result) ? row.theoretical_result : null;
    const synthPreCross = finalA && finalB ? dualSynthesis({ a: finalA, b: finalB, crossA: { survivesChallenge: true }, crossB: { survivesChallenge: true }, comparison: {} }) : null;
    const aAlone = finalA ? resolve(dirOf(finalA) === "BULLISH" ? "BUY" : dirOf(finalA) === "BEARISH" ? "SELL" : null) : { result: null };
    const bAlone = finalB ? resolve(dirOf(finalB) === "BULLISH" ? "BUY" : dirOf(finalB) === "BEARISH" ? "SELL" : null) : { result: null };
    const preCrossDir = synthPreCross && (synthPreCross.action === "BUY" || synthPreCross.action === "SELL") ? synthPreCross.action : null;
    const preCross = resolve(preCrossDir);
    return {
      id: row.id, candidateId: row.candidate_id, marketKey: row.market_key, marketType: row.market_type,
      createdAt: Number(row.created_at) || null, direction, result, payout: Number(row.payout) || null,
      survival: row.thesis_survival ?? fin?.thesisSurvival ?? "UNKNOWN",
      latency: row.payload?.latency ?? null,
      actions: {
        R1: { a: actionOf(r1?.a), b: actionOf(r1?.b) },
        R2: { a: actionOf(r2?.a), b: actionOf(r2?.b) },
        FINAL: { a: actionOf(finalA), b: actionOf(finalB) },
        synthPreCross: synthPreCross?.action ?? null,
        dual: row.final_action ?? null,
      },
      directions: {
        R1: { a: dirOf(r1?.a), b: dirOf(r1?.b) },
        FINAL: { a: dirOf(finalA), b: dirOf(finalB) },
        structural: finalA?.structuralDirection ?? null, short: finalB?.shortDirection ?? null,
      },
      scenarios: { R1: r1?.a?.primaryScenario ?? null, FINAL: finalA?.primaryScenario ?? null },
      triggers: { R1: r1?.b?.triggerState ?? null, FINAL: finalB?.triggerState ?? null },
      locations: { R1: r1?.b?.entryLocation ?? null, FINAL: finalB?.entryLocation ?? null },
      snapshots: { R1: r1?.snapshotId ?? null, R2: r2?.snapshotId ?? null, FINAL: fin?.snapshotId ?? null },
      crossFinal: { a: fin?.crossExaminationFinal?.a?.verdict ?? null, b: fin?.crossExaminationFinal?.b?.verdict ?? null },
      crossR1: { a: r2?.crossExamination1?.a?.verdict ?? null, b: r2?.crossExamination1?.b?.verdict ?? null },
      agreement: { R1: r1?.comparison?.agreement === true, R2: r2?.comparison?.agreement === true, FINAL: fin?.comparison?.agreement === true, horizonConflict: fin?.comparison?.horizonConflict === true },
      counterfactuals: { aAlone: aAlone.result, bAlone: bAlone.result, aAloneSource: aAlone.source, bAloneSource: bAlone.source, preCross: preCross.result, preCrossSource: preCross.source, g2: g2 ? { direction: g2.direction, result: g2.result } : null, v4: v4 ? { direction: v4.direction, result: v4.result } : null },
    };
  });

  /* 1/2: decision change + attribution */
  const change = { nothing: 0, onlyA: 0, onlyB: 0, both: 0, r1ToR2Changes: 0, r2ToFinalChanges: 0, synthesisChangedFromR1: 0, causes: {} };
  for (const o of observations) {
    const aChanged = o.actions.R1.a !== o.actions.FINAL.a;
    const bChanged = o.actions.R1.b !== o.actions.FINAL.b;
    if (!aChanged && !bChanged) change.nothing += 1; else if (aChanged && bChanged) change.both += 1; else if (aChanged) change.onlyA += 1; else change.onlyB += 1;
    if (o.actions.R1.a !== o.actions.R2.a || o.actions.R1.b !== o.actions.R2.b) change.r1ToR2Changes += 1;
    if (o.actions.R2.a !== o.actions.FINAL.a || o.actions.R2.b !== o.actions.FINAL.b) change.r2ToFinalChanges += 1;
    if (o.actions.FINAL.dual !== null && o.actions.dual !== null && !(o.actions.R1.a === o.actions.R1.b && o.actions.R1.a === o.actions.dual)) change.synthesisChangedFromR1 += 1;
    if (aChanged || bChanged) {
      const cause = o.survival === "CONFLICT_UNRESOLVED" ? "UNRESOLVED_CONFLICT"
        : o.survival === "NEITHER_SURVIVES" || o.survival === "ONLY_A_SURVIVES" || o.survival === "ONLY_B_SURVIVES" ? "THESIS_INVALIDATED"
        : o.crossFinal.a === "CHALLENGE" || o.crossFinal.b === "CHALLENGE" ? "CROSS_EXAM_CHALLENGE"
        : o.directions.R1.a !== o.directions.FINAL.a ? "STRUCTURE_CHANGE"
        : o.directions.R1.b !== o.directions.FINAL.b ? "SHORT_IMPULSE_CHANGE"
        : o.scenarios.R1 !== o.scenarios.FINAL ? "SCENARIO_CHANGE"
        : o.triggers.R1 !== o.triggers.FINAL ? "TRIGGER_CHANGE"
        : o.locations.R1 !== o.locations.FINAL ? "LOCATION_CHANGE"
        : o.snapshots.R2 !== o.snapshots.R1 || o.snapshots.FINAL !== o.snapshots.R2 ? "NEW_MARKET_DATA" : "UNKNOWN";
      change.causes[cause] = (change.causes[cause] ?? 0) + 1;
    }
  }

  /* 3: A x B matrix (FINAL) + dual outcome + A-alone counterfactual */
  const abKeys = ["BUY", "SELL", "WAIT"];
  const abMatrix = [];
  for (const a of abKeys) for (const b of abKeys) {
    const cell = observations.filter((o) => o.actions.FINAL.a === a && o.actions.FINAL.b === b);
    const trades = cell.filter((o) => o.actions.dual === "BUY" || o.actions.dual === "SELL");
    abMatrix.push({ a, b, n: cell.length, trades: trades.length, coverage: cell.length ? Number((trades.length / cell.length).toFixed(4)) : null, outcome: cohort(trades.map((o) => o.result)), aAloneCounterfactual: cohort(cell.map((o) => o.counterfactuals.aAlone)), bAloneCounterfactual: cohort(cell.map((o) => o.counterfactuals.bAlone)) });
  }

  /* 4: structural x short */
  const matrixKeys = [["BULLISH", "BULLISH", "STRUCTURAL_BULLISH_SHORT_BULLISH"], ["BULLISH", "BEARISH", "STRUCTURAL_BULLISH_SHORT_BEARISH"], ["BEARISH", "BEARISH", "STRUCTURAL_BEARISH_SHORT_BEARISH"], ["BEARISH", "BULLISH", "STRUCTURAL_BEARISH_SHORT_BULLISH"], ["BULLISH", "NEUTRAL", "STRUCTURAL_BULLISH_SHORT_NEUTRAL"], ["BEARISH", "NEUTRAL", "STRUCTURAL_BEARISH_SHORT_NEUTRAL"]];
  const structuralShort = matrixKeys.map(([s, h, label]) => { const cell = observations.filter((o) => o.directions.structural === s && o.directions.short === h); const trades = cell.filter((o) => o.actions.dual === "BUY" || o.actions.dual === "SELL"); return { label, n: cell.length, trades: trades.length, coverage: cell.length ? Number((trades.length / cell.length).toFixed(4)) : null, outcome: cohort(trades.map((o) => o.result)), aAloneCounterfactual: cohort(cell.map((o) => o.counterfactuals.aAlone)), bAloneCounterfactual: cohort(cell.map((o) => o.counterfactuals.bAlone)) }; });

  /* 5: thesis survival */
  const survival = ["BOTH_SURVIVE", "ONLY_A_SURVIVES", "ONLY_B_SURVIVES", "NEITHER_SURVIVES", "CONFLICT_UNRESOLVED"].map((key) => { const cell = observations.filter((o) => o.survival === key); const trades = cell.filter((o) => o.actions.dual === "BUY" || o.actions.dual === "SELL"); return { survival: key, n: cell.length, trades: trades.length, coverage: cell.length ? Number((trades.length / cell.length).toFixed(4)) : null, outcome: cohort(trades.map((o) => o.result)), expectancy: expectancyOf(trades.map((o) => o.result), trades.map((o) => o.payout)) }; });

  /* 6: cross-examination value (pre-cross vs actual) */
  const transitions = {};
  for (const o of observations) {
    const from = o.actions.synthPreCross ?? "WAIT", to = o.actions.dual ?? "WAIT";
    if (from === to) continue;
    const key = from + "->" + to;
    transitions[key] = (transitions[key] ?? 0) + 1;
  }
  const preCrossTrades = observations.filter((o) => o.actions.synthPreCross === "BUY" || o.actions.synthPreCross === "SELL");
  const actualTrades = observations.filter((o) => o.actions.dual === "BUY" || o.actions.dual === "SELL");
  const crossValue = { transitions, preCross: { trades: preCrossTrades.length, outcome: cohort(preCrossTrades.map((o) => o.counterfactuals.preCross)) }, actual: { trades: actualTrades.length, outcome: cohort(actualTrades.map((o) => o.result)) } };

  /* 7/8: rounds value + 13/14 persistence */
  const stability = (pickR1, pickFinal) => (o) => { const a = pickR1(o), b = pickFinal(o); return a === b ? "STABLE" : "ONE_CHANGE"; };
  const agreementCategory = (o) => { const r1 = o.agreement.R1, r2 = o.agreement.R2, fin = o.agreement.FINAL; if (r1 && fin) return "ALWAYS_AGREED"; if (!r1 && !fin) return "ALWAYS_CONFLICTED"; if (!r1 && fin) return "CONVERGED"; if (r1 && !fin) return "DIVERGED"; return "MIXED"; };
  const roundsValue = {
    r1ToR2Changes: change.r1ToR2Changes, r2ToFinalChanges: change.r2ToFinalChanges,
    aStability: groupBy(observations, (o) => (o.directions.R1.a === o.directions.FINAL.a ? "STABLE" : "ONE_CHANGE")),
    bStability: groupBy(observations, (o) => (o.directions.R1.b === o.directions.FINAL.b ? "STABLE" : "ONE_CHANGE")),
    agreementPersistence: groupBy(observations, agreementCategory),
    newTicksOrCandles: "NOT_MEASURABLE (payload do Dual nao persiste contagem de ticks/candles por rodada; apenas snapshotId e availableAt)",
  };

  /* 9/10: A-alone / B-alone */
  const aAloneCohort = cohort(observations.map((o) => o.counterfactuals.aAlone));
  const bAloneCohort = cohort(observations.map((o) => o.counterfactuals.bAlone));
  const dualCohort = cohort(observations.map((o) => o.result));

  /* 11/12: Dual vs V4 vs G2 (mesma cohort) */
  const v4Trades = observations.filter((o) => o.counterfactuals.v4?.direction && DECIDED.has(o.counterfactuals.v4.result));
  const g2Trades = observations.filter((o) => o.counterfactuals.g2?.direction && DECIDED.has(o.counterfactuals.g2.result));
  const disagreement = observations.filter((o) => o.counterfactuals.g2 && o.counterfactuals.v4 && o.counterfactuals.g2.direction && o.counterfactuals.v4.direction && o.counterfactuals.g2.direction !== o.counterfactuals.v4.direction);
  const comparison = {
    cohort: observations.length,
    dual: { trades: actualTrades.length, outcome: dualCohort, coverage: observations.length ? Number((actualTrades.length / observations.length).toFixed(4)) : null, breakEven: breakEven(actualTrades.map((o) => o.payout)), expectancy: expectancyOf(actualTrades.map((o) => o.result), actualTrades.map((o) => o.payout)) },
    v4: { trades: v4Trades.length, outcome: cohort(v4Trades.map((o) => o.counterfactuals.v4.result)), coverage: observations.length ? Number((v4Trades.length / observations.length).toFixed(4)) : null },
    g2: { trades: g2Trades.length, outcome: cohort(g2Trades.map((o) => o.counterfactuals.g2.result)), coverage: observations.length ? Number((g2Trades.length / observations.length).toFixed(4)) : null },
    disagreementSubset: { n: disagreement.length, rows: disagreement.map((o) => ({ id: o.id, g2Direction: o.counterfactuals.g2?.direction, g2Result: o.counterfactuals.g2?.result, v4Direction: o.counterfactuals.v4?.direction, v4Result: o.counterfactuals.v4?.result, aDirection: o.directions.FINAL.a, bDirection: o.directions.FINAL.b, dualAction: o.actions.dual, dualResult: o.result, survival: o.survival })) },
  };

  /* 15: latency */
  const latencySamples = { total: [], agentA: [], agentB: [], comparison: [], crossExam: [], synthesis: [] };
  for (const o of observations) {
    const l = o.latency ?? null; if (!l) continue;
    if (Number.isFinite(l.totalReasoningMs)) latencySamples.total.push(l.totalReasoningMs);
    if (Number.isFinite(l.agentA_ms)) latencySamples.agentA.push(l.agentA_ms);
    if (Number.isFinite(l.agentB_ms)) latencySamples.agentB.push(l.agentB_ms);
    if (Number.isFinite(l.comparison_ms)) latencySamples.comparison.push(l.comparison_ms);
    if (Number.isFinite(l.crossExam_ms)) latencySamples.crossExam.push(l.crossExam_ms);
    if (Number.isFinite(l.finalSynthesis_ms)) latencySamples.synthesis.push(l.finalSynthesis_ms);
  }
  const percentile = (values, f) => { const list = [...values].sort((a, b) => a - b); return list.length ? list[Math.min(list.length - 1, Math.max(0, Math.ceil(f * list.length) - 1))] : null; };
  const latency = Object.fromEntries(Object.entries(latencySamples).map(([key, values]) => [key, { count: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99), max: values.length ? Math.max(...values) : null, operationallyNegligible: (percentile(values, 0.99) ?? 0) < 10 }]));

  /* 16/17: checkpoints + respostas */
  const settledDirectional = observations.filter((o) => (o.actions.dual === "BUY" || o.actions.dual === "SELL") && DECIDED.has(o.result)).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const checkpoints = levels.map((level) => {
    const slice = settledDirectional.slice(0, level);
    const outcome = cohort(slice.map((o) => o.result));
    const payouts = slice.map((o) => o.payout);
    return { level, complete: settledDirectional.length >= level, n: slice.length, outcome, coverage: observations.length ? Number((slice.length / observations.length).toFixed(4)) : null, breakEven: breakEven(payouts), expectancy: expectancyOf(slice.map((o) => o.result), payouts), answers: answersFor(slice, observations) };
  });
  /* 4/5: contrafactuais por rodada (R1_ONLY / R2_ONLY / FINAL) + overthinking */
  const roundDecision = (o, round) => { const a = o.actions[round]?.a, b = o.actions[round]?.b; return a && a === b && a !== "WAIT" ? a : "WAIT"; };
  const asOutcome = (o, action) => (action === "BUY" || action === "SELL" ? makeCounterfactualResolver({ g2: o.counterfactuals.g2, v4: o.counterfactuals.v4 })(action).result : null);
  const roundCounterfactuals = { R1_ONLY: cohort(observations.map((o) => asOutcome(o, roundDecision(o, "R1")))), R2_ONLY: cohort(observations.map((o) => asOutcome(o, roundDecision(o, "R2")))), FINAL: { ...cohort(observations.map((o) => o.result)), note: "resultado real do Dual" }, coverage: { R1: observations.filter((o) => roundDecision(o, "R1") !== "WAIT").length, R2: observations.filter((o) => roundDecision(o, "R2") !== "WAIT").length, FINAL: observations.filter((o) => o.actions.dual === "BUY" || o.actions.dual === "SELL").length, total: observations.length } };
  const overthinking = { r1_correct_final_wrong: 0, r1_wrong_final_correct: 0, r2_correct_final_wrong: 0, r2_wrong_final_correct: 0, r1_correct_final_correct: 0, r1_wrong_final_wrong: 0 };
  for (const o of observations) {
    const final = o.result;
    if (!DECIDED.has(final) && o.actions.dual !== "WAIT") continue;
    const r1 = asOutcome(o, roundDecision(o, "R1")), r2 = asOutcome(o, roundDecision(o, "R2"));
    if (r1 && DECIDED.has(final)) {
      if (r1 === "WIN" && final === "LOSS") overthinking.r1_correct_final_wrong += 1; else if (r1 === "LOSS" && final === "WIN") overthinking.r1_wrong_final_correct += 1; else if (r1 === "WIN" && final === "WIN") overthinking.r1_correct_final_correct += 1; else if (r1 === "LOSS" && final === "LOSS") overthinking.r1_wrong_final_wrong += 1;
    }
    if (r2 && DECIDED.has(final)) {
      if (r2 === "WIN" && final === "LOSS") overthinking.r2_correct_final_wrong += 1; else if (r2 === "LOSS" && final === "WIN") overthinking.r2_wrong_final_correct += 1;
    }
  }
  overthinking.note = "associacao observacional; nao e causalidade";
  /* 3/7: atribuicao por market delta real (sidecar; historico = NOT_MEASURABLE) */
  const materialAttribution = { changeWithMaterial: [], changeWithoutMaterial: [], noChangeWithMaterial: [], noChangeWithoutMaterial: [], notMeasurable: 0 };
  for (const o of observations) {
    const deltas = roundDeltasByObservation.get(o.id) ?? null;
    if (!deltas || !deltas.length) { materialAttribution.notMeasurable += 1; continue; }
    const material = deltas.some((delta) => delta.material_market_change === true);
    const changed = o.actions.R1.a !== o.actions.FINAL.a || o.actions.R1.b !== o.actions.FINAL.b;
    if (changed && material) materialAttribution.changeWithMaterial.push(o.result); else if (changed) materialAttribution.changeWithoutMaterial.push(o.result); else if (material) materialAttribution.noChangeWithMaterial.push(o.result); else materialAttribution.noChangeWithoutMaterial.push(o.result);
  }
  const materialSummary = { changeWithMaterial: cohort(materialAttribution.changeWithMaterial), changeWithoutMaterial: cohort(materialAttribution.changeWithoutMaterial), noChangeWithMaterial: cohort(materialAttribution.noChangeWithMaterial), noChangeWithoutMaterial: cohort(materialAttribution.noChangeWithoutMaterial), notMeasurable: materialAttribution.notMeasurable, policy: "material-market-change-v1 (analise apenas)" };
  const rolling = { label: "ROLLING / NOT CHECKPOINT", asOf: Date.now(), directionalSettled: settledDirectional.length, outcome: cohort(settledDirectional.map((o) => o.result)), coverage: observations.length ? Number((settledDirectional.length / observations.length).toFixed(4)) : null, note: "checkpoints imutaveis permanecem em checkpoints[]; rolling nunca os sobrescreve." };
  return {
    version: DUAL_REPORT_VERSION, generatedAtUtc: new Date().toISOString(), rolling, roundCounterfactuals, overthinking, materialSummary,
    snapshot: { asOf: Date.now(), n: observations.length, source: "PROSPECTIVE_SHADOW", note: "DUAL_REASONING_V1 congelado; relatorio apenas observacional." },
    counts: { observations: observations.length, finalized: observations.filter((o) => o.actions.dual).length, directionalSettled: settledDirectional.length, nextCheckpoint: levels.find((l) => l > settledDirectional.length) ?? null },
    change, changeMatrix: change, abMatrix, structuralShort, survival, crossValue, roundsValue, aAlone: { cohort: aAloneCohort }, bAlone: { cohort: bAloneCohort }, comparison, latency, checkpoints,
    policy: { readOnly: true, noTuning: true, dualFrozen: true, zeroReal: true, shadowOnly: true },
  };
}

function groupBy(observations, keyOf) { const map = new Map(); for (const o of observations) { const key = keyOf(o); if (!map.has(key)) map.set(key, []); map.get(key).push(o); } return [...map.entries()].map(([key, list]) => ({ key, n: list.length, outcome: cohort(list.map((o) => o.result)), trades: list.filter((o) => o.actions.dual === "BUY" || o.actions.dual === "SELL").length })).sort((a, b) => b.n - a.n); }

function answersFor(slice, allObservations) {
  const outcomeOf = (list) => cohort(list.map((o) => o.result));
  const dual = outcomeOf(slice);
  const v4 = cohort(slice.map((o) => o.counterfactuals.v4?.result).filter(Boolean));
  const g2 = cohort(slice.map((o) => o.counterfactuals.g2?.result).filter(Boolean));
  const agreeTrades = slice.filter((o) => o.actions.FINAL.a === o.actions.FINAL.b && o.actions.FINAL.a !== "WAIT");
  const aAlone = cohort(slice.map((o) => o.counterfactuals.aAlone));
  const bAlone = cohort(slice.map((o) => o.counterfactuals.bAlone));
  const bWaitProtect = slice.filter((o) => o.actions.FINAL.a !== "WAIT" && o.actions.FINAL.b === "WAIT");
  const preCross = cohort(slice.map((o) => o.counterfactuals.preCross));
  const delta = (x, y) => x.wr === null || y.wr === null ? null : Number(((x.wr - y.wr) * 100).toFixed(2));
  return {
    A_dualVsV4: { dual: dual.wr, v4: v4.wr, deltaPp: delta(dual, v4), verdict: dual.decided >= 30 ? "MEASURED" : "INSUFFICIENT" },
    B_dualVsG2: { dual: dual.wr, g2: g2.wr, deltaPp: delta(dual, g2), verdict: dual.decided >= 30 ? "MEASURED" : "INSUFFICIENT" },
    C_agreementVsA: { agreementTrades: agreeTrades.length, agreementOutcome: outcomeOf(agreeTrades), aAlone, deltaPp: delta(outcomeOf(agreeTrades), aAlone), verdict: agreeTrades.length >= 20 ? "MEASURED" : "INSUFFICIENT" },
    D_agreementVsB: { agreementOutcome: outcomeOf(agreeTrades), bAlone, deltaPp: delta(outcomeOf(agreeTrades), bAlone), verdict: agreeTrades.length >= 20 ? "MEASURED" : "INSUFFICIENT" },
    E_bWaitProtectsA: { cases: bWaitProtect.length, dualOutcome: outcomeOf(bWaitProtect), aAloneCounterfactual: cohort(bWaitProtect.map((o) => o.counterfactuals.aAlone)), deltaPp: delta(outcomeOf(bWaitProtect), cohort(bWaitProtect.map((o) => o.counterfactuals.aAlone))), verdict: bWaitProtect.length >= 20 ? "MEASURED" : "INSUFFICIENT" },
    F_crossExamValue: { preCross, actual: dual, deltaPp: delta(dual, preCross), transitions: allObservations === observationsSame ? null : null, verdict: dual.decided >= 30 ? "MEASURED" : "INSUFFICIENT" },
    G_round2Value: { changedR1toR2: allObservations.filter((o) => o.actions.R1.a !== o.actions.R2.a || o.actions.R1.b !== o.actions.R2.b).length, verdict: allObservations.length >= 50 ? "MEASURED" : "INSUFFICIENT" },
    H_finalRoundValue: { changedR2toFinal: allObservations.filter((o) => o.actions.R2.a !== o.actions.FINAL.a || o.actions.R2.b !== o.actions.FINAL.b).length, verdict: allObservations.length >= 50 ? "MEASURED" : "INSUFFICIENT" },
    I_survivalPredicts: { groups: [...new Set(slice.map((o) => o.survival))].map((key) => ({ survival: key, outcome: outcomeOf(slice.filter((o) => o.survival === key)) })), verdict: slice.length >= 60 ? "MEASURED" : "INSUFFICIENT" },
    J_coverageCost: { observations: allObservations.length, trades: slice.length, coverage: allObservations.length ? Number((slice.length / allObservations.length).toFixed(4)) : null },
    note: "Respostas usam a mesma coorte; N insuficiente nao vira conclusao.",
  };
}
const observationsSame = null;
