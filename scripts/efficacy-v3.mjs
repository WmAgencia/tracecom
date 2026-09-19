/**
 * EFFICACY v3 â€” medicao corrigida (READ-ONLY). Corrige as lacunas do v2 sem tocar em estrategia.
 * P1 join deterministico V4 x V3-creation (candidate_id exato) + auditoria de perdas
 * P2 auditoria de preco do LATE (evaluations[].price) e veredito de mensurabilidade
 * P3 Location condicional a Scenario x Direction
 * P4 structural trend vs short-horizon impulse vs outcome 60s
 * P5 Red Team risk stratification
 * P6 componentes inertes (distribuicao, MI, sensibilidade)
 * P7 funil por playbook, P8 payout/expectancy/break-even
 * Saida: docs/research/data/efficacy-v3.{json,md}
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, "relay", "package.json"));
const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, ssl: { rejectUnauthorized: false } });
const DECIDED = new Set(["WIN", "LOSS", "DRAW"]);
const FLIP = { WIN: "LOSS", LOSS: "WIN", DRAW: "DRAW" };

function wilson(w, n) { if (!n) return { low: null, high: null }; const p = w / n, z = 1.96, d = 1 + z * z / n; const c = (p + z * z / (2 * n)) / d; const h = (z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / d; return { low: Number(Math.max(0, c - h).toFixed(4)), high: Number(Math.min(1, c + h).toFixed(4)) }; }
function cohort(results) { const list = (results || []).filter((r) => DECIDED.has(r)); const w = list.filter((r) => r === "WIN").length; const l = list.filter((r) => r === "LOSS").length; const n = w + l; return { n: list.length, decided: n, wins: w, losses: l, draws: list.length - w - l, wr: n ? Number((w / n).toFixed(4)) : null, ci95: wilson(w, n), lowN: n < 30 }; }
function deltaPp(a, b) { return a.wr === null || b.wr === null ? null : Number(((a.wr - b.wr) * 100).toFixed(2)); }
function mean(values) { const list = values.filter(Number.isFinite); return list.length ? list.reduce((x, y) => x + y, 0) / list.length : null; }
function erf(x) { const s = Math.sign(x), ax = Math.abs(x), t = 1 / (1 + 0.3275911 * ax); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax)); }
function pTwo(w1, n1, w2, n2) { if (!n1 || !n2) return null; const p1 = w1 / n1, p2 = w2 / n2, p = (w1 + w2) / (n1 + n2), se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2)); if (!se) return null; return Number((2 * (1 - 0.5 * (1 + erf(Math.abs((p1 - p2) / se) / Math.SQRT2)))).toFixed(6)); }
function outcomeFor(direction, g2Direction, g2Result) { if (!DECIDED.has(g2Result) || !direction) return null; if (!g2Direction || direction === g2Direction) return g2Result; return FLIP[g2Result]; }
function mutualInformation(states, outcomes, binsStates = 6) {
  const pairs = [];
  for (let i = 0; i < Math.min(states.length, outcomes.length); i += 1) { const y = outcomes[i] === "WIN" ? 1 : outcomes[i] === "LOSS" ? 0 : null; if (Number.isFinite(states[i]) && y !== null) pairs.push([states[i], y]); }
  if (pairs.length < 20) return null;
  const xs = pairs.map((p) => p[0]).sort((a, b) => a - b);
  const edgeAt = (f) => xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(f * xs.length) - 1))];
  const edges = [edgeAt(0.2), edgeAt(0.4), edgeAt(0.6), edgeAt(0.8)];
  const bin = (v) => { let i = 0; while (i < edges.length && v > edges[i]) i += 1; return i; };
  const joint = new Map(), cx = new Array(5).fill(0), cy = [0, 0];
  for (const [x, y] of pairs) { const ix = bin(x), iy = y; const k = ix + ":" + iy; joint.set(k, (joint.get(k) || 0) + 1); cx[ix] += 1; cy[iy] += 1; }
  const n = pairs.length; let mi = 0;
  for (const [k, c] of joint) { const [ix, iy] = k.split(":").map(Number); const pxy = c / n, px = cx[ix] / n, py = cy[iy] / n; if (pxy > 0 && px > 0 && py > 0) mi += pxy * Math.log(pxy / (px * py)); }
  return { mi: Number(mi.toFixed(6)), n: pairs.length };
}

async function load() {
  const [v4, v3, timing, shadow] = await Promise.all([
    pool.query(`SELECT observation_id, candidate_id, market_key, market_type, direction, final_action, data_quality, regime, scenario, theoretical_result, payout, payload, created_at FROM iq_agents_v4_observations ORDER BY created_at ASC`).then((r) => r.rows),
    pool.query(`SELECT DISTINCT ON (candidate_id) candidate_id, direction, final_action, theoretical_result, current_decision, trader_scenario, created_at FROM iq_scenario_shadow_observations WHERE candidate_id IS NOT NULL ORDER BY candidate_id, created_at DESC`).then((r) => r.rows),
    pool.query(`SELECT candidate_id, direction, outcome, late_policy, current_policy, target_entry_at, created_at FROM iq_timing_policy_observations WHERE candidate_id IS NOT NULL`).then((r) => r.rows),
    pool.query(`SELECT candidate_id, theoretical_result FROM iq_shadow_observations WHERE candidate_id IS NOT NULL AND theoretical_result IS NOT NULL`).then((r) => r.rows),
  ]);
  return { v4, v3, timing, shadow };
}

function latestV4ByCandidate(v4) { const map = new Map(); for (const row of v4) if (row.candidate_id) map.set(row.candidate_id, row); return map; }

/* ---------------- P1/P3/P4: coorte pareada V4 x V3-creation ---------------- */
function pairedCohort(data) {
  const v3ByCandidate = new Map(data.v3.map((row) => [row.candidate_id, row]));
  const v4ByCandidate = latestV4ByCandidate(data.v4);
  const shadowByCandidate = new Map(data.shadow.map((row) => [row.candidate_id, row]));
  const A = [], B = [], C = [], D = [], noV3 = [];
  for (const [candidateId, v4] of v4ByCandidate) {
    const v3 = v3ByCandidate.get(candidateId);
    if (!v3) { noV3.push(v4); continue; }
    const g2Dir = v3.direction || v3.current_decision?.action || null;
    const g2Result = v3.theoretical_result || shadowByCandidate.get(candidateId)?.theoretical_result || null;
    const v4Dir = v4.direction;
    const accepted = v4.final_action === "BUY" || v4.final_action === "SELL";
    if (accepted) {
      const v4Result = v4.theoretical_result || outcomeFor(v4Dir, g2Dir, g2Result);
      const entry = { candidateId, marketKey: v4.market_key, marketType: v4.market_type, regime: v4.regime, scenario: v4.scenario, direction: v4Dir, g2Dir, g2Result, v4Result, t0: v4.payload?.t0 ?? null, payout: v4.payout, acceptedAt: v4.created_at };
      if (v4Dir && g2Dir && v4Dir === g2Dir) A.push(entry);
      else if (v4Dir && g2Dir) B.push({ ...entry, g2ResultPaired: outcomeFor(g2Dir, g2Dir, g2Result) });
      else A.push(entry);
    } else if (v4.final_action === "WAIT") C.push({ candidateId, marketKey: v4.market_key, regime: v4.regime, scenario: v4.scenario, g2Dir, g2Result, t0: v4.payload?.t0 ?? null });
    else D.push({ candidateId, g2Dir, g2Result });
  }
  const acceptedRows = [...A, ...B];
  return {
    coverage: { v4Rows: v4ByCandidate.size, v4WithV3: acceptedRows.length + C.length + D.length, v4WithoutV3: noV3.length, shadowJoinWas: data.shadow.length },
    v3WithoutV4: data.v3.filter((row) => !v4ByCandidate.has(row.candidate_id)).length,
    A_sameDirection: { ...cohort(acceptedRows.filter((row) => row.g2Dir === row.direction).map((row) => row.v4Result)), entries: acceptedRows.filter((row) => row.g2Dir === row.direction) },
    B_opposite: { ...cohort(B.map((row) => row.v4Result)), entries: B },
    C_v4Wait: { ...cohort(C.map((row) => row.g2Result)), entries: C },
    D_g2WaitV4Trade: { ...cohort(D.map((row) => row.g2Result)), entries: D },
    accepted: cohort(acceptedRows.map((row) => row.v4Result)),
    pairedTest: (() => { const a = cohort(acceptedRows.map((row) => row.v4Result)), c = cohort(C.map((row) => row.g2Result)); return { deltaPp: deltaPp(a, c), pValue: pTwo(a.wins, a.decided, c.wins, c.decided), bootstrapNote: "N pareado agora usa V3-creation (mesmo T0), nao o shadow final-entry." }; })(),
  };
}

/* ---------------- P3: location condicional cenario x direcao ---------------- */
function scenarioLocationVerdict(scenario, direction, zone, donchianPosition) {
  const atUpper = zone === "EDGE_UPPER" || zone === "OVEREXTENDED_UPPER" || (Number.isFinite(donchianPosition) && donchianPosition >= 0.8);
  const atLower = zone === "EDGE_LOWER" || zone === "OVEREXTENDED_LOWER" || (Number.isFinite(donchianPosition) && donchianPosition <= 0.2);
  const mid = zone === "MID" || (Number.isFinite(donchianPosition) && Math.abs(donchianPosition - 0.5) <= 0.15);
  if (scenario === "RANGE_MEAN_REVERSION") return (direction === "BUY" && atLower) || (direction === "SELL" && atUpper) ? "FAVORABLE" : mid ? "NEUTRAL" : "UNFAVORABLE";
  if (scenario === "BREAKOUT" || scenario === "COMPRESSION_EXPANSION") return (direction === "BUY" && atUpper) || (direction === "SELL" && atLower) ? "FAVORABLE" : "UNFAVORABLE";
  if (scenario === "TREND_PULLBACK") return (direction === "BUY" && (atLower || zone === "LOWER_HALF" || mid)) || (direction === "SELL" && (atUpper || zone === "UPPER_HALF" || mid)) ? "FAVORABLE" : "UNFAVORABLE";
  if (scenario === "REVERSAL" || scenario === "FAILED_BREAKOUT") return (direction === "BUY" && atLower) || (direction === "SELL" && atUpper) ? "FAVORABLE" : "UNFAVORABLE";
  if (scenario === "TREND_CONTINUATION") return atUpper || atLower || mid ? "NEUTRAL" : "NEUTRAL";
  return "NEUTRAL";
}
function locationConditional(paired) {
  const rows = [];
  for (const entry of [...paired.A_sameDirection.entries, ...paired.B_opposite.entries]) {
    const t0 = entry.t0;
    if (!t0 || !t0.location) continue;
    const zone = t0.location.zone ?? null;
    const pos = Number(t0.location.donchianPosition ?? t0.indicators?.donchian?.position);
    const verdict = scenarioLocationVerdict(entry.scenario, entry.direction, zone, pos);
    rows.push({ verdict, result: entry.v4Result, scenario: entry.scenario, direction: entry.direction, zone, pos, regime: entry.regime });
  }
  const groups = {};
  for (const row of rows) { const key = row.verdict; (groups[key] = groups[key] || []).push(row); }
  return { n: rows.length, byVerdict: Object.entries(groups).map(([key, list]) => ({ key, ...cohort(list.map((row) => row.result)) })).sort((a, b) => b.decided - a.decided), detail: rows };
}

/* ---------------- P4: structural vs short impulse ---------------- */
function structuralVsImpulse(paired) {
  const rows = [];
  for (const entry of [...paired.A_sameDirection.entries, ...paired.B_opposite.entries]) {
    const t0 = entry.t0; if (!t0 || !entry.v4Result || entry.v4Result === "DRAW") continue;
    const action = entry.direction;
    const structural = t0.timeframes?.structure1m?.label ?? t0.structure?.label ?? null;
    const structuralDir = structural === "UP" ? "BUY" : structural === "DOWN" ? "SELL" : null;
    const velocity = Number(t0.momentum?.velocity);
    const accel = Number(t0.momentum?.acceleration);
    const impulseDir = Number.isFinite(velocity) && velocity !== 0 ? (velocity > 0 ? "BUY" : "SELL") : Number.isFinite(accel) && accel !== 0 ? (accel > 0 ? "BUY" : "SELL") : null;
    const outcomeDir = entry.v4Result === "WIN" ? action : action === "BUY" ? "SELL" : "BUY";
    rows.push({ structuralDir, impulseDir, action, outcomeDir, result: entry.v4Result, scenario: entry.scenario });
  }
  const structuralAligned = rows.filter((row) => row.structuralDir === row.action);
  const impulseAligned = rows.filter((row) => row.impulseDir === row.action);
  const cross = (sa, ia) => rows.filter((row) => (row.structuralDir === row.action) === sa && (row.impulseDir === row.action) === ia);
  return {
    n: rows.length,
    structural: { aligned: cohort(structuralAligned.map((row) => row.result)), notAligned: cohort(rows.filter((row) => row.structuralDir && row.structuralDir !== row.action).map((row) => row.result)) },
    impulse: { aligned: cohort(impulseAligned.map((row) => row.result)), notAligned: cohort(rows.filter((row) => row.impulseDir && row.impulseDir !== row.action).map((row) => row.result)) },
    cross: { both: cohort(cross(true, true).map((row) => row.result)), structOnly: cohort(cross(true, false).map((row) => row.result)), impulseOnly: cohort(cross(false, true).map((row) => row.result)), neither: cohort(cross(false, false).map((row) => row.result)) },
    outcomeDirection: { structuralMatchesOutcome: rows.filter((row) => row.structuralDir === row.outcomeDir).length, impulseMatchesOutcome: rows.filter((row) => row.impulseDir === row.outcomeDir).length, n: rows.length },
  };
}

/* ---------------- P2: late price audit ---------------- */
function lateAudit(timing) {
  const accepts = timing.filter((row) => row.outcome === "LATE_ACCEPT");
  const rows = accepts.map((row) => {
    const late = row.late_policy || {};
    const evaluations = Array.isArray(late.evaluations) ? late.evaluations : [];
    const prices = evaluations.filter((ev) => Number.isFinite(Number(ev.price))).map((ev) => ({ at: Number(ev.atMs ?? ev.at), price: Number(ev.price) }));
    const deadline = Number(late.deadlineAt ?? 0);
    const beforeDeadline = prices.filter((ev) => ev.at <= deadline);
    const candidatePrice = prices.length ? prices[0].price : Number(row.current_policy?.entryPrice ?? NaN);
    const deadlinePrice = beforeDeadline.length ? beforeDeadline[beforeDeadline.length - 1].price : null;
    const wouldBe = Number(late.entryPriceWouldBe);
    const currentPrice = Number(row.current_policy?.entryPrice);
    const direction = row.direction;
    const better = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && a !== b ? (direction === "BUY" ? a < b : a > b) : null);
    return {
      candidateId: row.candidate_id, direction, result: late.result, candidatePrice,
      deadlinePrice, wouldBe: Number.isFinite(wouldBe) ? wouldBe : null, currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
      capturedAtDeadline: beforeDeadline.length > 0, evaluations: prices.length,
      lateBetterThanCurrent: better(wouldBe, currentPrice),
      deadlineBetterThanCandidate: better(deadlinePrice, candidatePrice),
      wouldBeEqualsCurrent: Number.isFinite(wouldBe) && Number.isFinite(currentPrice) ? Math.abs(wouldBe - currentPrice) < 1e-9 : null,
    };
  });
  const withDeadline = rows.filter((row) => row.capturedAtDeadline).length;
  const comparable = rows.filter((row) => row.lateBetterThanCurrent !== null);
  return {
    n: rows.length,
    measurability: {
      deadlinePriceCaptured: withDeadline,
      wouldBePresent: rows.filter((row) => row.wouldBe !== null).length,
      wouldBeEqualsCurrent: rows.filter((row) => row.wouldBeEqualsCurrent === true).length,
      verdict: withDeadline === 0 ? "NOT_MEASURABLE" : "MEASURABLE",
      note: "precos reais existem em late_policy.evaluations[].price; a igualdade anterior era comparacao de campos equivalentes, nao ausencia de preco.",
    },
    lateVsCurrent: { better: comparable.filter((row) => row.lateBetterThanCurrent === true).length, worse: comparable.filter((row) => row.lateBetterThanCurrent === false).length, equal: rows.length - comparable.length },
    deadlineVsCandidate: { measured: rows.filter((row) => row.deadlineBetterThanCandidate !== null).length, better: rows.filter((row) => row.deadlineBetterThanCandidate === true).length, worse: rows.filter((row) => row.deadlineBetterThanCandidate === false).length },
    outcome: cohort(rows.map((row) => row.result)),
    rows: rows.slice(0, 200),
  };
}

/* ---------------- P6: componentes inertes ---------------- */
function inertComponents(v4ByCandidate) {
  const agents = ["MICROSTRUCTURE_AGENT", "VOLATILITY_AGENT", "LOCATION_AGENT", "PRICE_ACTION_AGENT", "MOMENTUM_AGENT"];
  const rows = [...v4ByCandidate.values()].filter((row) => Array.isArray(row.payload?.agents));
  const out = {};
  for (const agentId of agents) {
    const distribution = {};
    const states = [], outcomes = [];
    for (const row of rows) {
      const agent = row.payload.agents.find((entry) => entry.agentId === agentId);
      if (!agent) continue;
      const state = agent.state ?? "UNKNOWN";
      distribution[state] = (distribution[state] || 0) + 1;
      const accepted = row.final_action === "BUY" || row.final_action === "SELL";
      if (accepted && DECIDED.has(row.theoretical_result)) {
        const numeric = { STRONG: 2, BUILDING: 1, STABLE: 0, WEAKENING: -1, REVERSING: -2, BUY_PRESSURE: 1, SELL_PRESSURE: -1, BALANCED: 0, INSUFFICIENT: 0, COMPRESSED: -1, NORMAL: 0, EXPANDING: 1, EXPANDED: 2, VOLATILE_SPIKE: 3, BULLISH: 1, BEARISH: -1, NEUTRAL: 0, UNCERTAIN: 0, MID: 0, EDGE_UPPER: 1, EDGE_LOWER: -1, UPPER_HALF: 0.5, LOWER_HALF: -0.5, OVEREXTENDED_UPPER: 2, OVEREXTENDED_LOWER: -2, UNKNOWN: 0 }[state];
        if (numeric !== undefined) { states.push(numeric); outcomes.push(row.theoretical_result); }
      }
    }
    const entries = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
    const dominant = entries[0] ?? ["UNKNOWN", 0];
    out[agentId] = {
      total: rows.length, distribution, dominantShare: rows.length ? Number((dominant[1] / rows.length).toFixed(4)) : null,
      distinctStates: entries.length,
      mutualInformationWithOutcome: mutualInformation(states, outcomes),
      inertRationale: dominant[1] / Math.max(1, rows.length) > 0.9 ? "STATE_QUASE_CONSTANTE" : entries.length <= 2 ? "POUCOS_ESTADOS" : "ESTADOS_VARIAM",
    };
  }
  return out;
}

/* ---------------- P7: funil por playbook ---------------- */
function playbookFunnel(v4ByCandidate) {
  const scenarios = ["TREND_CONTINUATION", "TREND_PULLBACK", "BREAKOUT", "FAILED_BREAKOUT", "RANGE_MEAN_REVERSION", "REVERSAL", "COMPRESSION_EXPANSION", "TRANSITION_NO_TRADE"];
  return scenarios.map((scenario) => {
    const rows = [...v4ByCandidate.values()].filter((row) => {
      const agent = row.payload?.agents?.find((entry) => entry.agentId === "SCENARIO_AGENT");
      return row.scenario === scenario || row.payload?.synthesis?.primaryScenario === scenario || agent?.state === scenario;
    });
    const detected = rows.length;
    const directionPresent = rows.filter((row) => row.payload?.synthesis?.direction || row.direction).length;
    const trigger = rows.filter((row) => (row.payload?.synthesis?.triggerState ?? "") === "TRIGGERED").length;
    const synthesisTrade = rows.filter((row) => ["BUY", "SELL"].includes(row.payload?.synthesis?.action)).length;
    const redTeam = { CONFIRMED_UNCHALLENGED: 0, CHALLENGED_RESOLVED: 0, CHALLENGED_UNRESOLVED: 0, NONE: 0 };
    for (const row of rows) { const verdict = row.payload?.redTeam?.phase2?.verdict ?? "NONE"; redTeam[verdict] = (redTeam[verdict] || 0) + 1; }
    const finalTrade = rows.filter((row) => row.final_action === "BUY" || row.final_action === "SELL").length;
    const settled = rows.filter((row) => DECIDED.has(row.theoretical_result)).length;
    const gateReasons = {};
    for (const row of rows) { const reason = row.payload?.synthesis?.triggerState ?? "UNKNOWN"; gateReasons[reason] = (gateReasons[reason] || 0) + 1; }
    return { scenario, detected, directionPresent, trigger, synthesisTrade, redTeam, finalTrade, settled, funnel: { DETECTED: detected, VALID_CONTEXT: directionPresent, TRIGGER: trigger, SYNTHESIS_TRADE: synthesisTrade, FINAL_TRADE: finalTrade, SETTLED: settled }, triggerStates: gateReasons };
  });
}

/* ---------------- P8: payout ---------------- */
function payoutAnalysis(v4ByCandidate, paired) {
  const settledAccepted = [...v4ByCandidate.values()].filter((row) => (row.final_action === "BUY" || row.final_action === "SELL") && DECIDED.has(row.theoretical_result));
  const payouts = settledAccepted.map((row) => Number(row.payload?.t0?.market?.payout ?? row.payout)).filter((value) => Number.isFinite(value) && value > 0);
  const withPayout = payouts.length, total = settledAccepted.length;
  const avg = mean(payouts);
  const fraction = avg !== null ? (avg > 1 ? avg / 100 : avg) : null;
  const wins = settledAccepted.filter((row) => row.theoretical_result === "WIN" && Number.isFinite(Number(row.payout))).length;
  const losses = settledAccepted.filter((row) => row.theoretical_result === "LOSS" && Number.isFinite(Number(row.payout))).length;
  const draws = settledAccepted.filter((row) => row.theoretical_result === "DRAW" && Number.isFinite(Number(row.payout))).length;
  const expectancy = fraction !== null && wins + losses > 0 ? Number((((wins * fraction) - losses) / (wins + losses + draws)).toFixed(4)) : null;
  return {
    settledDirectional: total, payoutPresent: withPayout, payoutCoverage: total ? Number((withPayout / total).toFixed(4)) : null,
    avgPayout: avg === null ? null : Number(avg.toFixed(4)),
    breakEvenWr: fraction !== null ? Number((1 / (1 + fraction)).toFixed(4)) : null,
    observedWr: cohort(settledAccepted.map((row) => row.theoretical_result)).wr,
    expectancy: expectancy === null ? "EXPECTANCY_UNKNOWN" : expectancy,
    normalizedEv: fraction === null ? "EXPECTANCY_UNKNOWN" : Number((expectancy ?? 0).toFixed(4)),
    policy: { noImputation: true, payoutFromObservationOnly: true },
  };
}

try {
  const data = await load();
  const paired = pairedCohort(data);
  const report = {
    schema: "efficacy-v3", generatedAtUtc: new Date().toISOString(),
    joinAudit: {
      causeOfV2Loss: [
        "observacao V4 ocorre na CRIACAO do candidato; shadow-lab somente no FINAL ENTRY (candidatos cancelados antes nao geram linha shadow)",
        "janelas diferentes (shadow desde 2026-09-18T22:55Z; V4 desde 2026-09-19T10:38Z)",
        "consequencia: 474 linhas shadow settled sem par V4 e ~181 V4 settled sem linha shadow",
      ],
      fix: "join deterministico por candidate_id entre V4 e iq_scenario_shadow_observations (ambos na criacao, mesmo T0), sem heuristica de horario",
      coverage: paired.coverage,
    },
    paired: { A: { ...paired.A_sameDirection, entries: undefined }, B: { ...paired.B_opposite, entries: undefined }, C: { ...paired.C_v4Wait, entries: undefined }, D: { ...paired.D_g2WaitV4Trade, entries: undefined }, accepted: paired.accepted, test: paired.pairedTest },
    locationConditional: locationConditional(paired),
    structuralVsImpulse: structuralVsImpulse(paired),
    lateAudit: lateAudit(data.timing),
    redTeam: (() => { const rows = [...latestV4ByCandidate(data.v4).values()]; const groups = {}; for (const row of rows) { const verdict = row.payload?.redTeam?.phase2?.verdict ?? "NONE"; (groups[verdict] = groups[verdict] || []).push(row.theoretical_result ?? null); } return { stratification: Object.entries(groups).map(([key, results]) => ({ verdict: key, ...cohort(results) })).sort((a, b) => b.decided - a.decided), vetoCount: rows.filter((row) => ["BUY", "SELL"].includes(row.payload?.synthesis?.action) && !["BUY", "SELL"].includes(row.final_action)).length }; })(),
    inertComponents: inertComponents(latestV4ByCandidate(data.v4)),
    playbookFunnel: playbookFunnel(latestV4ByCandidate(data.v4)),
    payout: payoutAnalysis(latestV4ByCandidate(data.v4), paired),
    policy: { readOnly: true, noTuning: true, noAgentChange: true, zeroReal: true },
  };
  report.locationConditional.detail = report.locationConditional.detail.slice(0, 300);
  fs.writeFileSync(path.join(ROOT, "docs/research/data/efficacy-v3.json"), JSON.stringify(report, null, 1) + "\n");
  const md = [];
  const line = (label, s) => "| " + label + " | " + s.decided + " | " + s.wins + "/" + s.losses + "/" + s.draws + " | " + (s.wr === null ? "-" : (s.wr * 100).toFixed(1) + "%") + " | " + (s.ci95.low === null ? "-" : (s.ci95.low * 100).toFixed(1) + "-" + (s.ci95.high * 100).toFixed(1) + "%") + " |";
  md.push("# EFFICACY v3 â€” medicao corrigida (read-only)\n");
  md.push("- Gerado: " + report.generatedAtUtc + ". Cobertura pareada: " + JSON.stringify(paired.coverage));
  md.push("- Causa das perdas no v2: " + report.joinAudit.causeOfV2Loss.join("; "));
  md.push("\n## 1. G2 vs V4 pareado (V4 x V3-creation)\n| coorte | decididos | W/L/D | WR | CI95 |\n|---|---|---|---|---|");
  md.push(line("A mesma direcao", paired.A_sameDirection));
  md.push(line("B direcao oposta (V4)", paired.B_opposite));
  md.push(line("B G2 pareado", cohort(paired.B_opposite.entries.map((row) => row.g2ResultPaired))));
  md.push(line("C V4 WAIT (contrafactual G2)", paired.C_v4Wait));
  md.push("- Teste: delta " + paired.pairedTest.deltaPp + " pp; p=" + paired.pairedTest.pValue + "\n");
  md.push("## 2. Late price audit\n");
  md.push("- mensurabilidade: " + JSON.stringify(report.lateAudit.measurability));
  md.push("- late vs current: " + JSON.stringify(report.lateAudit.lateVsCurrent));
  md.push("- deadline vs candidate: " + JSON.stringify(report.lateAudit.deadlineVsCandidate));
  md.push("- outcome LATE_ACCEPT: " + JSON.stringify(report.lateAudit.outcome) + "\n");
  md.push("## 3. Location condicional (Scenario x Direction)\n| veredito | decididos | W/L/D | WR | CI95 |\n|---|---|---|---|---|");
  for (const row of report.locationConditional.byVerdict) md.push(line(row.key, row));
  md.push("\n## 4. Structural vs short-horizon impulse\n");
  md.push("- N=" + report.structuralVsImpulse.n);
  md.push(line("Structural alinhado", report.structuralVsImpulse.structural.aligned));
  md.push(line("Structural NAO alinhado", report.structuralVsImpulse.structural.notAligned));
  md.push(line("Impulse alinhado", report.structuralVsImpulse.impulse.aligned));
  md.push(line("Impulse NAO alinhado", report.structuralVsImpulse.impulse.notAligned));
  md.push("- outcomeDirection: " + JSON.stringify(report.structuralVsImpulse.outcomeDirection) + "\n");
  md.push("## 5. Red Team stratification (sem veto)\n| veredito | decididos | W/L/D | WR | CI95 |\n|---|---|---|---|---|");
  for (const row of report.redTeam.stratification) md.push(line(row.verdict, row));
  md.push("- vetos: " + report.redTeam.vetoCount + "\n");
  md.push("## 6. Componentes inertes\n");
  for (const [agentId, info] of Object.entries(report.inertComponents)) md.push("- " + agentId + ": dominante " + (info.dominantShare * 100).toFixed(0) + "%, estados " + info.distinctStates + ", MI " + JSON.stringify(info.mutualInformationWithOutcome) + " (" + info.inertRationale + ")");
  md.push("\n## 7. Funil por playbook\n| cenario | detected | valid_ctx | trigger | synth_trade | final_trade | settled |\n|---|---|---|---|---|---|---|");
  for (const row of report.playbookFunnel) md.push("| " + row.scenario + " | " + row.detected + " | " + row.directionPresent + " | " + row.trigger + " | " + row.synthesisTrade + " | " + row.finalTrade + " | " + row.settled + " |");
  md.push("\n## 8. Payout\n- " + JSON.stringify(report.payout));
  md.push("\n## 9. Politica\n- " + JSON.stringify(report.policy));
  fs.writeFileSync(path.join(ROOT, "docs/research/data/efficacy-v3.md"), md.join("\n") + "\n");
  console.log("EFFICACY_V3_WRITTEN");
  console.log(JSON.stringify({ coverage: paired.coverage, A: paired.A_sameDirection.decided, B: paired.B_opposite.decided, C: paired.C_v4Wait.decided, test: paired.pairedTest, lateMeasurable: report.lateAudit.measurability.verdict, payout: report.payout.payoutCoverage }, null, 1));
} catch (error) {
  console.error("EFFICACY_V3_FAILED", String(error?.stack ?? error).slice(0, 400));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}

