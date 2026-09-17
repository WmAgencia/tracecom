/**
 * TRADE QUALITY ENGINE (Fase 6.3) — pesquisa/abstencao. NUNCA decide direcao; apenas ACCEPT/ABSTAIN.
 *
 * Regras dos bracos SHADOW sao congeladas por hipotese de dominio (documentadas abaixo), avaliadas
 * APENAS com dados disponiveis em t0 antes do settlement. Resultado (WIN/LOSS) nunca entra como feature.
 *
 *  A = G2 JIT atual (controle)
 *  B = A + RegimeEligibility/TradeQualityGate: abstem TRANSITION/CHAOTIC/UNCLEAR, conflito de DI contra
 *      a direcao e trigger fraco (sem corpo/confirmacao de momentum).
 *  C = A + Stability: abstem se a direcao do candidato flipou >= 2 vezes ou mudou entre criacao e final.
 *  D = A + Critic2.0: abstem com risk flags, contradicoes duraveis ou verdict != CONFIRM.
 *  E = A + MicrostructureVeto: abstem com aceleracao contra, corpo fraco, ATR spike ou extensao excessiva.
 *  F = B + C + D + E.
 *
 * Nenhum limiar foi escolhido olhando resultado: sao limiares de engenharia documentados.
 */
export const TRADE_QUALITY_VERSION = "trade-quality-v1";
export const ARM_IDS = ["A_G2_JIT", "B_QUALITY_GATE", "C_STABILITY", "D_CRITIC", "E_MICROSTRUCTURE", "F_COMBINED"];
export const DEFAULT_MIN_TRADE_QUALITY_SCORE = 75;
export const MIN_TRADE_QUALITY_SCORE_LIMIT = 50;
export const MAX_TRADE_QUALITY_SCORE_LIMIT = 95;
export const BREAK_EVEN_WR = (payout) => { const fraction = Number(payout) > 1 ? Number(payout) / 100 : Number(payout); return Number.isFinite(fraction) && fraction > 0 ? Number((1 / (1 + fraction)).toFixed(4)) : null; };

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const norm = (value, fallback = null) => (value === undefined ? fallback : value);

/** Features de um t0 snapshot (usado no runtime e nos estudos). Resultado nunca entra aqui. */
export function featuresFromSnapshot(snapshot = {}, { direction = null, payout = null, timing = {} } = {}) {
  const trader = snapshot.trader ?? null;
  const structure = snapshot.structure ?? trader?.structure ?? {};
  const events = structure.events ?? {};
  const location = snapshot.location ?? trader?.location ?? {};
  const momentum = snapshot.momentum ?? trader?.momentum ?? {};
  const strength = snapshot.strength ?? trader?.strength ?? {};
  const volatility = snapshot.volatility ?? trader?.volatility ?? {};
  const microstructure = snapshot.microstructure ?? trader?.microstructure ?? {};
  const critic = snapshot.critic ?? {};
  const consensus = snapshot.consensus ?? {};
  const trajectory = snapshot.trajectory ?? {};
  const entryPrice = num(timing.entryPrice);
  const candidatePriceRaw = timing.candidatePrice;
  const candidatePrice = candidatePriceRaw === null || candidatePriceRaw === undefined || candidatePriceRaw === "" ? null : Number(candidatePriceRaw);
  const entryDisplacement = entryPrice !== null && candidatePrice !== null && Number.isFinite(candidatePrice) ? Number(entryPrice) - candidatePrice : null;
  const atr = num(volatility.atr);
  return {
    direction, payout: num(payout),
    regime: snapshot.regime ?? null, setup: snapshot.setup ?? null, trigger: snapshot.trigger ?? null,
    structureLabel: structure.label ?? null, bodyRatio: num(structure.candleShape?.bodyRatio), upperWick: num(structure.candleShape?.upperWick), lowerWick: num(structure.candleShape?.lowerWick),
    donchianPosition: num(location.donchianPosition), distanceUpperATR: num(location.distanceToUpperATR), distanceLowerATR: num(location.distanceToLowerATR), locationZone: location.zone ?? null,
    velocity: num(structure.velocity?.velocity), acceleration: num(structure.velocity?.acceleration),
    rsi: num(momentum.rsi14), rsiSlope: num(trajectory.rsiSlope), adx: num(strength.adx14), adxSlope: num(trajectory.adxSlope),
    plusDI: num(strength.plusDI), minusDI: num(strength.minusDI), diSpread: num(strength.diSpread), diSpreadSlope: num(trajectory.diSpreadSlope),
    atr, atrRatio: num(volatility.atrRatio), atrSlope: num(trajectory.atrSlope), compression: volatility.compression === true, expansion: volatility.expansion === true,
    streak: num(microstructure.streak), breakoutUp: events.breakoutUp === true, breakoutDown: events.breakoutDown === true, retestUp: events.retestUp === true, retestDown: events.retestDown === true,
    failedBreakoutUp: events.failedBreakoutUp === true, failedBreakoutDown: events.failedBreakoutDown === true,
    traderAction: trader?.action ?? null, traderConfidence: num(trader?.analysisConfidence), evidenceCount: (trader?.supportingEvidence ?? []).length, contradictionCount: (trader?.contradictingEvidence ?? []).length,
    criticVerdict: critic.verdict ?? null, criticIndependent: critic.independentAction ?? null, criticRiskFlags: critic.riskFlags ?? [], criticContradictions: critic.contradictions ?? [],
    consensusStatus: consensus.status ?? null,
    candidateAgeMs: num(timing.candidateAgeMs), directionChanges: num(timing.directionChanges) ?? 0, candidateChangedBeforeEntry: timing.candidateChangedBeforeEntry === true,
    entryDriftMs: num(timing.entryDriftMs), entryDisplacement, entryDisplacementATR: entryDisplacement !== null && atr !== null && atr > 0 ? Number((entryDisplacement / atr).toFixed(4)) : null,
  };
}

export function extractFeatures(trade = {}, timing = {}) {
  const direction = trade.direction === "CALL" ? "BUY" : trade.direction === "PUT" ? "SELL" : trade.direction ?? null;
  const base = featuresFromSnapshot(trade.snapshot ?? {}, { direction, payout: trade.payout, timing });
  return {
    tradeId: trade.tradeId ?? null, marketKey: trade.marketKey ?? null, marketType: trade.marketType ?? null,
    hour: trade.settlementAt ? new Date(trade.settlementAt).getUTCHours() : null, stake: num(trade.stake), settlementAt: trade.settlementAt ?? null,
    ...base,
    breakEvenWR: BREAK_EVEN_WR(trade.payout),
    result: trade.result ?? null, pnl: num(trade.pnl), normalizedPnl: Number.isFinite(Number(trade.pnl)) && Number(trade.stake) > 0 ? Number((Number(trade.pnl) / Number(trade.stake)).toFixed(4)) : null,
  };
}

export function triggerStrength(features = {}) {
  let score = 0;
  const reasons = [];
  if (features.bodyRatio !== null && features.bodyRatio >= 0.5) { score += 1; reasons.push("corpo_dominante"); }
  const momentumAgrees = features.acceleration !== null && ((features.direction === "BUY" && features.acceleration > 0) || (features.direction === "SELL" && features.acceleration < 0));
  if (momentumAgrees) { score += 1; reasons.push("momentum_a_favor"); }
  if (features.diSpread !== null && features.plusDI !== null && features.minusDI !== null) { const diAgrees = features.direction === "BUY" ? features.plusDI > features.minusDI : features.minusDI > features.plusDI; if (diAgrees) { score += 1; reasons.push("di_a_favor"); } }
  if (features.criticVerdict === "CONFIRM") { score += 1; reasons.push("critic_confirm"); }
  if (features.trigger) { score += 1; reasons.push("trigger_presente"); }
  return { score, max: 5, reasons };
}

/** Decision-shadow por braco. ABSTAIN nunca vira direcao; A é o fluxo atual. */
export function evaluateShadowArms(features = {}) {
  const arms = {};
  const add = (arm, ok, reason = null) => { arms[arm] = { decision: ok === true ? "ACCEPT" : "ABSTAIN", reason }; };
  add("A_G2_JIT", true);
  const regimeBlocked = ["TRANSITION", "CHAOTIC", "UNCLEAR"].includes(features.regime);
  const diConflict = features.plusDI !== null && features.minusDI !== null && ((features.direction === "BUY" && features.minusDI > features.plusDI) || (features.direction === "SELL" && features.plusDI > features.minusDI));
  const weakTrigger = !features.trigger || triggerStrength(features).score < 3;
  add("B_QUALITY_GATE", !(regimeBlocked || diConflict || weakTrigger), regimeBlocked ? "REGIME_UNCERTAIN" : diConflict ? "DI_CONFLICT" : weakTrigger ? "WEAK_TRIGGER" : null);
  const unstable = features.directionChanges >= 2 || features.candidateChangedBeforeEntry;
  add("C_STABILITY", !unstable, unstable ? "DIRECTION_UNSTABLE" : null);
  const criticBlocked = features.criticVerdict !== "CONFIRM" || (features.criticRiskFlags ?? []).length > 0;
  const criticContradiction = (features.criticContradictions ?? []).some((code) => ["aceleracao_contra_a_entrada", "rompimento_sem_corpo_dominante"].includes(code));
  add("D_CRITIC", !(criticBlocked || criticContradiction), criticBlocked ? "CRITIC_NOT_CONFIRM" : criticContradiction ? "CRITIC_CONTRADICTION" : null);
  const adverseAcceleration = features.acceleration !== null && ((features.direction === "BUY" && features.acceleration < 0) || (features.direction === "SELL" && features.acceleration > 0));
  const weakBody = features.bodyRatio !== null && features.bodyRatio < 0.4;
  const atrSpike = features.atrRatio !== null && features.atrRatio > 2.5;
  const extended = (features.distanceUpperATR ?? 0) > 2.5 || (features.distanceLowerATR ?? 0) > 2.5;
  add("E_MICROSTRUCTURE", !(adverseAcceleration || weakBody || atrSpike || extended), adverseAcceleration ? "ADVERSE_ACCELERATION" : weakBody ? "WEAK_BODY" : atrSpike ? "ATR_SPIKE" : extended ? "OVEREXTENSION" : null);
  add("F_COMBINED", ["B_QUALITY_GATE", "C_STABILITY", "D_CRITIC", "E_MICROSTRUCTURE"].every((arm) => arms[arm].decision === "ACCEPT"), ["B_QUALITY_GATE", "C_STABILITY", "D_CRITIC", "E_MICROSTRUCTURE"].find((arm) => arms[arm].decision === "ABSTAIN") ?? null);
  return arms;
}

/* ------------------------------------------------------------------ score 0-100 (rubrica, nao probabilidade) */

/**
 * tradeQualityScore 0-100 — RUBRICA deterministica (checklist de engenharia).
 * NAO e probabilidade; estimatedWinProbability permanece null. Threshold operacional default: 75.
 * Cada componente tem peso e justificativa; todos calculados apenas com dados t0.
 */
export function scoreTradeQuality(features = {}) {
  const checks = [];
  const add = (id, points, max, ok, detail = null) => { checks.push({ id, points: ok ? points : 0, max, ok: ok === true, detail }); return ok ? points : 0; };
  let score = 0;
  const direction = features.direction;
  const diAgrees = features.plusDI !== null && features.minusDI !== null && (direction === "BUY" ? features.plusDI > features.minusDI : features.minusDI > features.plusDI);
  const accelAgrees = features.acceleration !== null && (direction === "BUY" ? features.acceleration > 0 : features.acceleration < 0);
  const velocityAgrees = features.velocity !== null && (direction === "BUY" ? features.velocity > 0 : features.velocity < 0);
  const streakAgrees = features.streak !== null && (direction === "BUY" ? features.streak >= 0 : features.streak <= 0);
  const structureAgrees = features.structureLabel !== null && (direction === "BUY" ? ["HH_HL", "UP"].includes(features.structureLabel) : ["LH_LL", "DOWN"].includes(features.structureLabel));
  const regimeOk = !["CHAOTIC", "UNCLEAR", "TRANSITION"].includes(features.regime);
  const regimeTrend = String(features.regime ?? "").startsWith("TREND");
  const adxOk = features.adx !== null && features.adx >= 20;
  const adxNotFalling = features.adxSlope === null || features.adxSlope >= -0.5;
  const criticClean = features.criticVerdict === "CONFIRM" && (features.criticRiskFlags ?? []).length === 0 && (features.criticContradictions ?? []).length === 0;
  const rsiSafe = features.rsi !== null && (direction === "BUY" ? features.rsi <= 70 : features.rsi >= 30);
  const rsiBeyond = features.rsi !== null && (direction === "BUY" ? features.rsi >= 30 : features.rsi <= 70);
  const pos = features.donchianPosition;
  const posNotMid = pos !== null && Math.abs(pos - 0.5) >= 0.15;
  const posFavors = pos !== null && (direction === "BUY" ? pos <= 0.8 : pos >= 0.2);
  const againstATR = direction === "BUY" ? features.distanceLowerATR : features.distanceUpperATR;
  const withATR = direction === "BUY" ? features.distanceUpperATR : features.distanceLowerATR;
  const notExtended = (againstATR ?? 0) <= 2.0;
  const headroom = (withATR ?? 0) >= 0.3;
  const displacementOk = features.entryDisplacementATR === null || Math.abs(features.entryDisplacementATR) <= 0.35;
  const displacementAdverse = features.entryDisplacementATR !== null && (direction === "BUY" ? features.entryDisplacementATR > 0.35 : features.entryDisplacementATR < -0.35);
  const fresh = features.fresh !== false;

  score += add("setup_trigger", 8, 8, Boolean(features.setup) && features.setup !== "NO_VALID_SETUP" && Boolean(features.trigger), { setup: features.setup, trigger: features.trigger });
  score += add("regime_ok", 8, 8, regimeOk, features.regime);
  score += add("regime_trend", 4, 4, regimeTrend, { regime: features.regime, note: "bonus; setups de tendencia rendem mais em TREND" });
  score += add("structure_agrees", 6, 6, structureAgrees, features.structureLabel);
  score += add("di_agrees", 6, 6, diAgrees, { plusDI: features.plusDI, minusDI: features.minusDI });
  score += add("adx_strength", 6, 6, adxOk, features.adx);
  score += add("adx_not_falling", 4, 4, adxNotFalling, features.adxSlope);
  score += add("critic_clean", 6, 6, criticClean, { verdict: features.criticVerdict, flags: features.criticRiskFlags });
  score += add("location_not_mid", 6, 6, posNotMid, pos);
  score += add("location_favors_room", 6, 6, posFavors, pos);
  score += add("not_overextended", 8, 8, notExtended, { againstATR });
  score += add("headroom", 4, 4, headroom, { withATR });
  score += add("entry_displacement", 8, 8, displacementOk, features.entryDisplacementATR);
  score += add("rsi_not_extreme", 8, 8, rsiSafe, features.rsi);
  score += add("accel_agrees", 8, 8, accelAgrees, features.acceleration);
  score += add("velocity_agrees", 4, 4, velocityAgrees, features.velocity);
  score += add("streak_agrees", 4, 4, streakAgrees, features.streak);
  score += add("data_fresh", 3, 3, fresh, features.fresh === undefined ? "nao informado" : features.fresh);
  score += add("knowledge_used", 3, 3, (features.knowledgeContextIds ?? []).length > 0, null);
  void rsiBeyond;
  return {
    version: TRADE_QUALITY_VERSION, score: Math.max(0, Math.min(100, Math.round(score))), max: 100, checks,
    adverseDisplacement: displacementAdverse,
    note: "Rubrica deterministica (checklist). NAO e probabilidade; nao confundir com calibracao.",
  };
}

/** Entry Location Quality: setup valido mas preco ja andou => WAIT. */
export function entryLocationCheck(features = {}) {
  const reasons = [];
  const direction = features.direction;
  const displacement = features.entryDisplacementATR;
  if (displacement !== null) {
    const adverse = direction === "BUY" ? displacement > 0.5 : displacement < -0.5;
    const chased = Math.abs(displacement) > 1.0;
    if (adverse && chased) reasons.push("ENTRY_DISPLACEMENT_CHASED");
    else if (adverse) reasons.push("ENTRY_DISPLACEMENT_ADVERSE");
  }
  const against = direction === "BUY" ? features.distanceLowerATR : features.distanceUpperATR;
  if ((against ?? 0) > 2.5) reasons.push("OVEREXTENDED_FROM_CHANNEL");
  if (features.rsi !== null && (direction === "BUY" ? features.rsi >= 75 : features.rsi <= 25)) reasons.push("RSI_EXTREME_AT_ENTRY");
  return { ok: reasons.length === 0, reason: reasons[0] ?? null, reasons, code: reasons.length ? "VALID_SETUP_BUT_BAD_ENTRY_PRICE" : null };
}

/** Veto final de microestrutura (ultimos segundos): apenas PASS/VETO, nunca cria direcao. */
export function finalMicrostructureVeto({ direction, atr = null, lastTick = null, lastClose = null }) {
  if (!lastTick || !Number.isFinite(Number(lastTick.price)) || !Number.isFinite(Number(lastClose))) return { veto: false, reason: null, detail: { note: "sem tick/close" } };
  const atrValue = Number(atr);
  if (!Number.isFinite(atrValue) || atrValue <= 0) return { veto: false, reason: null, detail: { note: "sem ATR" } };
  const delta = Number(lastTick.price) - Number(lastClose);
  const adverse = direction === "BUY" ? delta < 0 : delta > 0;
  const adverseATR = Math.abs(delta) / atrValue;
  if (adverse && adverseATR >= 0.25) return { veto: true, reason: "ADVERSE_TICK_DISPLACEMENT", detail: { delta, adverseATR: Number(adverseATR.toFixed(4)) } };
  if (adverse && Number(lastTick.ageMs) <= 3_000 && adverseATR >= 0.15) return { veto: true, reason: "RAPID_ADVERSE_TICK", detail: { delta, adverseATR: Number(adverseATR.toFixed(4)), ageMs: lastTick.ageMs } };
  return { veto: false, reason: null, detail: { delta, adverseATR: Number(adverseATR.toFixed(4)) } };
}

/* ------------------------------------------------------------------ selective curve / temporal split */

export function selectiveCurve(rows, thresholds = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]) {
  const withScore = rows.filter((row) => Number.isFinite(row.qualityScore));
  return thresholds.map((threshold) => {
    const accepted = withScore.filter((row) => row.qualityScore >= threshold);
    const decided = accepted.filter((row) => row.result === "WIN" || row.result === "LOSS" || row.result === "DRAW");
    const wins = decided.filter((row) => row.result === "WIN").length;
    const losses = decided.filter((row) => row.result === "LOSS").length;
    const draws = decided.filter((row) => row.result === "DRAW").length;
    const pnl = accepted.reduce((sum, row) => sum + (Number(row.normalizedPnl) || 0), 0);
    return { threshold, candidates: rows.length, accepted: accepted.length, coverage: rows.length ? Number((accepted.length / rows.length).toFixed(4)) : null, wins, losses, draws, wr: decided.length ? Number((wins / decided.length).toFixed(4)) : null, normalizedPnl: Number(pnl.toFixed(4)) };
  });
}

export function temporalSplit(rows, { discovery = 0.5, validation = 0.25, gapMs = 120_000 } = {}) {
  const ordered = [...rows].sort((a, b) => (a.settlementAt ?? 0) - (b.settlementAt ?? 0));
  const total = ordered.length;
  const discoveryEnd = Math.floor(total * discovery);
  const validationEnd = Math.floor(total * (discovery + validation));
  const discoveryRows = ordered.slice(0, discoveryEnd);
  const validationStart = validationEnd;
  const validationRows = ordered.slice(discoveryEnd, validationEnd).filter((row) => (row.settlementAt ?? 0) - (discoveryRows.at(-1)?.settlementAt ?? 0) >= gapMs || discoveryRows.length === 0);
  const futureRows = ordered.slice(validationEnd).filter((row) => (row.settlementAt ?? 0) - (ordered.at(validationEnd - 1)?.settlementAt ?? 0) >= gapMs || validationEnd === 0);
  return { discovery: discoveryRows, validation: validationRows, future: futureRows, sizes: { total, discovery: discoveryRows.length, validation: validationRows.length, future: futureRows.length }, gapMs };
}

/** Logistic regression simples (gradiente) para diagnostico interpretavel; retorna pesos e AUC in-sample. */
export function fitLogistic(rows, featureNames, { iterations = 600, learningRate = 0.08, l2 = 0.02 } = {}) {
  const usable = rows.filter((row) => featureNames.every((name) => Number.isFinite(Number(row.features?.[name] ?? row[name]))) && (row.result === "WIN" || row.result === "LOSS"));
  if (usable.length < 12) return { ok: false, reason: "INSUFFICIENT_SAMPLE", n: usable.length };
  const matrix = usable.map((row) => featureNames.map((name) => Number(row.features?.[name] ?? row[name])));
  const means = featureNames.map((_, index) => matrix.reduce((sum, row) => sum + row[index], 0) / matrix.length);
  const stds = featureNames.map((_, index) => { const variance = matrix.reduce((sum, row) => sum + (row[index] - means[index]) ** 2, 0) / matrix.length; return Math.sqrt(variance) || 1; });
  const xs = matrix.map((row) => row.map((value, index) => (value - means[index]) / stds[index]));
  const ys = usable.map((row) => (row.result === "WIN" ? 1 : 0));
  const weights = new Array(featureNames.length).fill(0);
  let bias = 0;
  for (let step = 0; step < iterations; step += 1) {
    const gradient = new Array(featureNames.length).fill(0);
    let biasGradient = 0;
    for (let index = 0; index < xs.length; index += 1) {
      const z = xs[index].reduce((sum, value, position) => sum + value * weights[position], bias);
      const prediction = 1 / (1 + Math.exp(-z));
      const error = prediction - ys[index];
      for (let position = 0; position < weights.length; position += 1) gradient[position] += error * xs[index][position];
      biasGradient += error;
    }
    for (let position = 0; position < weights.length; position += 1) weights[position] -= learningRate * (gradient[position] / xs.length + l2 * weights[position]);
    bias -= learningRate * (biasGradient / xs.length);
  }
  const scored = usable.map((row, index) => { const z = xs[index].reduce((sum, value, position) => sum + value * weights[position], bias); return { score: 1 / (1 + Math.exp(-z)), outcome: ys[index] }; });
  return {
    ok: true, n: usable.length, features: featureNames,
    weights: Object.fromEntries(featureNames.map((name, index) => [name, Number(weights[index].toFixed(4))])), bias: Number(bias.toFixed(4)),
    mean: Object.fromEntries(featureNames.map((name, index) => [name, Number(means[index].toFixed(4))])), std: Object.fromEntries(featureNames.map((name, index) => [name, Number(stds[index].toFixed(4))])),
    auc: auc(scored.map((row) => ({ score: row.score, label: row.outcome }))), note: "Pesquisa; N pequeno; nao usar como probabilidade calibrada.",
  };
}

export function auc(pairs) {
  const positives = pairs.filter((pair) => pair.label === 1).map((pair) => pair.score);
  const negatives = pairs.filter((pair) => pair.label === 0).map((pair) => pair.score);
  if (!positives.length || !negatives.length) return null;
  let wins = 0, ties = 0;
  for (const positive of positives) for (const negative of negatives) { if (positive > negative) wins += 1; else if (positive === negative) ties += 1; }
  return Number(((wins + 0.5 * ties) / (positives.length * negatives.length)).toFixed(4));
}

/* ------------------------------------------------------------------ critic + stability + health */

const CRITIC_CATEGORIES = {
  LATE_ENTRY: (f) => (f.direction === "BUY" ? f.rsi >= 70 : f.rsi !== null && f.rsi <= 30) || (f.distanceUpperATR ?? 0) > 2.5 || (f.distanceLowerATR ?? 0) > 2.5,
  OVEREXTENSION: (f) => (f.distanceUpperATR ?? 0) > 2.5 || (f.distanceLowerATR ?? 0) > 2.5,
  REGIME_UNCERTAIN: (f) => ["TRANSITION", "CHAOTIC", "UNCLEAR"].includes(f.regime),
  WEAK_TRIGGER: (f) => triggerStrength(f).score < 3,
  MOMENTUM_FADE: (f) => f.acceleration !== null && ((f.direction === "BUY" && f.acceleration < 0) || (f.direction === "SELL" && f.acceleration > 0)),
  DI_CONFLICT: (f) => f.plusDI !== null && f.minusDI !== null && ((f.direction === "BUY" && f.minusDI > f.plusDI) || (f.direction === "SELL" && f.plusDI > f.minusDI)),
  ATR_SPIKE: (f) => f.atrRatio !== null && f.atrRatio > 2.5,
  FAILED_BREAKOUT_RISK: (f) => f.direction === "BUY" ? f.failedBreakoutUp === true : f.failedBreakoutDown === true,
  MICROSTRUCTURE_REVERSAL: (f) => f.streak !== null && ((f.direction === "BUY" && f.streak < 0) || (f.direction === "SELL" && f.streak > 0)),
  LOCATION_BAD: (f) => Math.abs((f.donchianPosition ?? 0.5) - 0.5) < 0.05,
};
export const CRITIC_CATEGORY_IDS = Object.keys(CRITIC_CATEGORIES);
export function criticAudit(confirmedLosses) {
  const counts = {};
  const detail = [];
  for (const row of confirmedLosses) {
    const categories = CRITIC_CATEGORY_IDS.filter((id) => CRITIC_CATEGORIES[id](row.features));
    for (const id of categories) counts[id] = (counts[id] ?? 0) + 1;
    detail.push({ tradeId: row.tradeId, marketKey: row.marketKey, setup: row.features.setup, regime: row.features.regime, categories });
  }
  return { confirmedLosses: confirmedLosses.length, counts, detail };
}

export function stabilityStudy(rows) {
  const buckets = new Map();
  const featuresOf = (row) => row.features ?? row;
  for (const row of rows) {
    if (row.result !== "WIN" && row.result !== "LOSS") continue;
    const features = featuresOf(row);
    const changes = features.directionChanges ?? 0;
    const key = features.candidateChangedBeforeEntry ? (changes >= 2 ? "CHANGED_2PLUS" : "CHANGED_ONCE") : (changes === 0 ? "STABLE" : `INTERIM_${changes}`);
    const bucket = buckets.get(key) ?? { n: 0, wins: 0, losses: 0, pnl: 0 };
    bucket.n += 1; if (row.result === "WIN") bucket.wins += 1; else bucket.losses += 1;
    bucket.pnl = Number((bucket.pnl + (Number(row.normalizedPnl) || 0)).toFixed(4));
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].map(([key, bucket]) => ({ key, ...bucket, wr: bucket.n ? Number((bucket.wins / bucket.n).toFixed(4)) : null })).sort((a, b) => b.n - a.n);
}

export function priceChaseStudy(rows) {
  const featuresOf = (row) => row.features ?? row;
  const withDisplacement = rows.filter((row) => Number.isFinite(featuresOf(row).entryDisplacementATR));
  const groups = { NEGATIVE: [], SMALL: [], MODERATE: [], LARGE: [] };
  for (const row of withDisplacement) {
    const features = featuresOf(row);
    const displacement = features.entryDisplacementATR;
    const adverse = features.direction === "BUY" ? displacement > 0 : displacement < 0;
    const magnitude = Math.abs(displacement);
    const key = adverse ? (magnitude <= 0.25 ? "SMALL" : magnitude <= 0.75 ? "MODERATE" : "LARGE") : "NEGATIVE";
    groups[key].push(row);
  }
  const summarize = (rows) => { const decided = rows.filter((row) => row.result === "WIN" || row.result === "LOSS"); const wins = decided.filter((row) => row.result === "WIN").length; return { n: rows.length, wins, losses: decided.length - wins, wr: decided.length ? Number((wins / decided.length).toFixed(4)) : null, pnl: Number(rows.reduce((sum, row) => sum + (Number(row.normalizedPnl) || 0), 0).toFixed(4)) }; };
  return { note: "Adverse = preco andou contra a direcao entre candidato e entrada (em ATR).", buckets: Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, summarize(value)])) };
}

export function performanceHealth({ trades = [], coverage = null, sequentialLossLimit = 6, drawdownLimitZ = null } = {}) {
  const decided = trades.filter((row) => row.result === "WIN" || row.result === "LOSS");
  let sequential = 0, maxSequential = 0;
  for (const row of decided) { if (row.result === "LOSS") { sequential += 1; maxSequential = Math.max(maxSequential, sequential); } else sequential = 0; }
  const normalizedPnl = Number(trades.reduce((sum, row) => sum + (Number(row.normalizedPnl) || 0), 0).toFixed(4));
  const reasons = [];
  if (maxSequential >= sequentialLossLimit) reasons.push("SEQUENTIAL_LOSS_CONCENTRATION");
  if (coverage !== null && coverage < 0.02) reasons.push("ABNORMAL_LOW_COVERAGE");
  const status = reasons.length ? "PAUSE_NEW_ENTRIES_RECOMMENDED" : "OK";
  return { status, reasons, maxSequentialLosses: maxSequential, normalizedPnl, note: "Monitor nao muda estrategia nem stake; apenas recomenda pausa para revisao humana." };
}
