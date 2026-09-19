/**
 * STAGE EFFICACY REPORT v2 â€” "qual etapa realmente adiciona informacao?" (READ-ONLY, research).
 *
 * Cruza por candidate_id: G2 (iq_shadow_observations), V4 (iq_agents_v4_observations),
 * V3 (iq_scenario_shadow_observations), Late Window (iq_timing_policy_observations +
 * iq_scenario_timing_intersections). Nao altera nada; nenhuma ordem.
 *
 * Saida: docs/research/data/stage-efficacy-report.{json,md}
 * Uso: DATABASE_URL=... node scripts/stage-efficacy-report.mjs [--limit=5000] [--ablation-limit=250]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, "relay", "package.json"));
const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, ssl: { rejectUnauthorized: false } });
const arg = (name, fallback) => { const hit = process.argv.find((value) => value.startsWith(`--${name}=`)); return hit ? Number(hit.split("=")[1]) : fallback; };
const LIMIT = arg("limit", 5000);
const ABLATION_LIMIT = arg("ablation-limit", 250);

const DECIDED = new Set(["WIN", "LOSS", "DRAW"]);
const FLIP = { WIN: "LOSS", LOSS: "WIN", DRAW: "DRAW" };

/* ---------------------------------- estatistica ---------------------------------- */

function erf(x) { const sign = Math.sign(x); const ax = Math.abs(x); const t = 1 / (1 + 0.3275911 * ax); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax); return sign * y; }
function normality(z) { return 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)); }
function twoProportionP(w1, n1, w2, n2) {
  if (!n1 || !n2) return null;
  const p1 = w1 / n1, p2 = w2 / n2, p = (w1 + w2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return null;
  return Number((2 * (1 - normality(Math.abs((p1 - p2) / se)))).toFixed(6));
}
function wilson(wins, n) { if (!n) return { low: null, high: null }; const p = wins / n, z = 1.96, den = 1 + z * z / n; const c = (p + z * z / (2 * n)) / den; const h = (z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / den; return { low: Number(Math.max(0, c - h).toFixed(4)), high: Number(Math.min(1, c + h).toFixed(4)) }; }
function cohort(rows, pick) {
  const list = rows.map(pick).filter((value) => DECIDED.has(value));
  const wins = list.filter((value) => value === "WIN").length;
  const losses = list.filter((value) => value === "LOSS").length;
  const draws = list.filter((value) => value === "DRAW").length;
  const decided = wins + losses;
  return { n: list.length, wins, losses, draws, decided, wr: decided ? Number((wins / decided).toFixed(4)) : null, ci95: wilson(wins, decided), lowN: decided < 30 };
}
function expectancyOf(rows, pick, payouts) {
  const list = rows.map(pick).filter((value) => DECIDED.has(value));
  if (!list.length) return null;
  const wins = list.filter((value) => value === "WIN").length;
  const losses = list.filter((value) => value === "LOSS").length;
  const draws = list.length - wins - losses;
  const fraction = payouts.length ? payouts.reduce((a, b) => a + b, 0) / payouts.length : null;
  const winPnl = fraction && fraction > 0 ? (fraction > 1 ? fraction / 100 : fraction) : 1;
  return Number((((wins * winPnl) - losses) / list.length).toFixed(4));
}
function bootstrapDelta(rowsA, pickA, rowsB, pickB, { iterations = 2000, seed = 7 } = {}) {
  const a = rowsA.map(pickA).filter((value) => DECIDED.has(value));
  const b = rowsB.map(pickB).filter((value) => DECIDED.has(value));
  if (!a.length || !b.length) return { low: null, high: null, p50: null };
  let state = seed >>> 0 || 1;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  const deltas = [];
  for (let index = 0; index < iterations; index += 1) {
    const sample = (list) => { let wins = 0; for (let cursor = 0; cursor < list.length; cursor += 1) if (list[Math.floor(rand() * list.length)] === "WIN") wins += 1; return wins / list.length; };
    deltas.push(sample(a) - sample(b));
  }
  deltas.sort((x, y) => x - y);
  const at = (fraction) => deltas[Math.min(deltas.length - 1, Math.max(0, Math.ceil(fraction * deltas.length) - 1))];
  return { low: Number(at(0.025).toFixed(4)), high: Number(at(0.975).toFixed(4)), p50: Number(at(0.5).toFixed(4)) };
}
function mcnemar(pairs) {
  const b = pairs.filter(([left, right]) => left === "WIN" && right === "LOSS").length;
  const c = pairs.filter(([left, right]) => left === "LOSS" && right === "WIN").length;
  const n = b + c;
  if (!n) return { b, c, n: 0, p: null };
  const z = Math.abs(b - c) - 1;
  const p = n > 0 && z > 0 ? 2 * (1 - normality(z / Math.sqrt(n))) : (b === c ? 1 : null);
  return { b, c, n, p: p === null ? null : Number(p.toFixed(6)) };
}
function bhFdr(entries) { // entries: [{id,p}]
  const valid = entries.filter((entry) => entry.p !== null && entry.p !== undefined).sort((a, b) => a.p - b.p);
  const m = valid.length;
  const adjusted = valid.map((entry, index) => ({ ...entry, q: Number(Math.min(1, entry.p * m / (index + 1)).toFixed(6)), rank: index + 1, m }));
  for (let index = adjusted.length - 2; index >= 0; index -= 1) adjusted[index].q = Number(Math.min(adjusted[index].q, adjusted[index + 1].q).toFixed(6));
  return adjusted;
}
function statusOf(decided, deltaPp) {
  if (decided < 20) return "INSUFFICIENT";
  if (decided < 50) return "EXPLORATORY";
  if (decided < 200) return deltaPp !== null && Math.abs(deltaPp) >= 5 ? "PROMISING" : "EXPLORATORY";
  return deltaPp !== null && Math.abs(deltaPp) >= 3 ? "SUPPORTED" : "NEUTRAL";
}

/* ---------------------------------- carga ---------------------------------- */

async function load() {
  const [shadow, v4, v3, timing, inter] = await Promise.all([
    pool.query(`SELECT candidate_id, theoretical_result, settlement_basis, payout, entry_price, settlement_price, direction, t0, created_at FROM iq_shadow_observations WHERE theoretical_result IN ('WIN','LOSS','DRAW') ORDER BY created_at DESC LIMIT $1`, [LIMIT]).catch(async () => pool.query(`SELECT candidate_id, theoretical_result, settlement_basis, payout, entry_price, settlement_price, t0->>'direction' AS direction, t0, created_at FROM iq_shadow_observations WHERE theoretical_result IN ('WIN','LOSS','DRAW') ORDER BY created_at DESC LIMIT $1`, [LIMIT])),
    pool.query(`SELECT observation_id, candidate_id, market_key, market_type, direction, final_action, data_quality, regime, scenario, theoretical_result, payout, payload, created_at FROM iq_agents_v4_observations ORDER BY created_at DESC LIMIT $1`, [LIMIT]),
    pool.query(`SELECT candidate_id, final_action, direction, theoretical_result, payout, trader_scenario, scenario_at_candidate, created_at FROM iq_scenario_shadow_observations ORDER BY created_at DESC LIMIT $1`, [LIMIT]),
    pool.query(`SELECT candidate_id, direction, late_policy, current_policy, outcome, outcome_reason, target_entry_at, created_at FROM iq_timing_policy_observations ORDER BY created_at DESC LIMIT $1`, [LIMIT]).catch(() => ({ rows: [] })),
    pool.query(`SELECT candidate_id, late_verdict, late_valid_at_deadline FROM iq_scenario_timing_intersections ORDER BY created_at DESC LIMIT $1`, [LIMIT]).catch(() => ({ rows: [] })),
  ]);
  return { shadow: shadow.rows, v4: v4.rows, v3: v3.rows, timing: timing.rows, inter: inter.rows };
}

/* ---------------------------------- analise ---------------------------------- */

function outcomeFor(direction, g2) {
  if (!g2 || !DECIDED.has(g2.result)) return null;
  if (!direction) return null;
  if (!g2.direction || direction === g2.direction) return g2.result;
  return FLIP[g2.result];
}

function analyze(data) {
  const g2ByCandidate = new Map();
  for (const row of data.shadow) if (row.candidate_id) g2ByCandidate.set(row.candidate_id, { result: row.theoretical_result, direction: row.direction, payout: row.payout, entry: row.entry_price, settlement: row.settlement_price, basis: row.settlement_basis });
  const report = { schema: "stage-efficacy-v2", generatedAtUtc: new Date().toISOString(), source: "PROSPECTIVE_SHADOW_READ_ONLY", counts: { g2Settled: data.shadow.length, v4: data.v4.length, v3: data.v3.length, timing: data.timing.length, intersections: data.inter.length } };

  /* 1. coortes pareadas A/B/C/D */
  const A = [], B = [], C = [], D = [], unmatched = [];
  for (const row of data.v4) {
    const g2 = row.candidate_id ? g2ByCandidate.get(row.candidate_id) : null;
    if (!g2) { unmatched.push(row); continue; }
    const v4dir = row.direction;
    const v4res = row.theoretical_result;
    const accepted = row.final_action === "BUY" || row.final_action === "SELL";
    const sameDirection = accepted && v4dir && g2.direction && v4dir === g2.direction;
    const opposite = accepted && v4dir && g2.direction && v4dir !== g2.direction;
    if (sameDirection) A.push({ g2, row, g2Result: g2.result, v4Result: v4res ?? g2.result });
    else if (opposite) B.push({ g2, row, g2Result: g2.result, v4Result: v4res ?? outcomeFor(v4dir, g2), flippedCounterfactual: outcomeFor(v4dir, g2) });
    else if (row.final_action === "WAIT") C.push({ g2, row, g2Result: g2.result });
    else if (row.final_action === "NO_TRADE") C.push({ g2, row, g2Result: g2.result, noTrade: true });
    else D.push({ g2, row });
  }
  const cohortOf = (list, pick) => cohort(list, pick);
  const payoutOf = (list) => list.map((entry) => Number(entry.row?.payout ?? entry.g2?.payout)).filter(Number.isFinite);
  report.cohorts = {
    A_sameDirection: { ...cohortOf(A, (entry) => entry.v4Result), expectancy: expectancyOf(A, (entry) => entry.v4Result, payoutOf(A)), g2Same: cohortOf(A, (entry) => entry.g2Result) },
    B_directionFlip: {
      v4: { ...cohortOf(B, (entry) => entry.v4Result), expectancy: expectancyOf(B, (entry) => entry.v4Result, payoutOf(B)) },
      g2: { ...cohortOf(B, (entry) => entry.g2Result), expectancy: expectancyOf(B, (entry) => entry.g2Result, payoutOf(B)) },
      pairedMcNemar: mcnemar(B.map((entry) => [entry.g2Result, entry.v4Result])),
      deltaPp: (cohortOf(B, (entry) => entry.v4Result).wr !== null && cohortOf(B, (entry) => entry.g2Result).wr !== null) ? Number(((cohortOf(B, (entry) => entry.v4Result).wr - cohortOf(B, (entry) => entry.g2Result).wr) * 100).toFixed(2)) : null,
    },
    C_v4Wait: { ...cohortOf(C, (entry) => entry.g2Result), expectancy: expectancyOf(C, (entry) => entry.g2Result, payoutOf(C)), noTrade: C.filter((entry) => entry.noTrade).length },
    D_g2WaitV4Trade: { ...cohortOf(D, (entry) => entry.row?.theoretical_result), n: D.length },
    unmatchedV4: unmatched.length,
  };
  const acceptedAll = [...A, ...B];
  const acceptedCohort = cohortOf(acceptedAll, (entry) => entry.v4Result);
  const avoidedCohort = cohortOf(C, (entry) => entry.g2Result);
  const acceptedOwnRows = data.v4.filter((row) => (row.final_action === "BUY" || row.final_action === "SELL") && DECIDED.has(row.theoretical_result));
  const acceptedOwn = cohort(acceptedOwnRows.map((row) => ({ result: row.theoretical_result })), (entry) => entry.result);
  const acceptedOwnPayouts = acceptedOwnRows.map((row) => Number(row.payout)).filter(Number.isFinite);
  const selection = {
    paired: {
      accepted: { ...acceptedCohort, expectancy: expectancyOf(acceptedAll, (entry) => entry.v4Result, payoutOf(acceptedAll)) },
      avoidedCounterfactual: { ...avoidedCohort, expectancy: expectancyOf(C, (entry) => entry.g2Result, payoutOf(C)) },
      deltaPp: acceptedCohort.wr !== null && avoidedCohort.wr !== null ? Number(((acceptedCohort.wr - avoidedCohort.wr) * 100).toFixed(2)) : null,
      bootstrapDelta: bootstrapDelta(acceptedAll, (entry) => entry.v4Result, C, (entry) => entry.g2Result),
      pValue: twoProportionP(acceptedCohort.wins, acceptedCohort.decided, avoidedCohort.wins, avoidedCohort.decided),
      note: "estrito: exige contrafactual G2 na MESMA oportunidade (join por candidate_id com settlement).",
    },
    fullAccepted: { ...acceptedOwn, expectancy: expectancyOf(acceptedOwnRows.map((row) => ({ result: row.theoretical_result })), (entry) => entry.result, acceptedOwnPayouts), note: "todos os aceitos com settlement proprio V4 (sem exigir join)." },
  };
  const pairedSelection = selection.paired;

  /* 2. estratificado (Simpson) */
  const strata = new Map();
  const pushStratum = (key, accepted, avoided) => { if (!strata.has(key)) strata.set(key, { key, accepted: [], avoided: [] }); const bucket = strata.get(key); if (accepted) bucket.accepted.push(accepted); if (avoided) bucket.avoided.push(avoided); };
  for (const entry of acceptedAll) { const row = entry.row; pushStratum(`market:${row.market_key}`, entry.v4Result, null); pushStratum(`type:${row.market_type}`, entry.v4Result, null); pushStratum(`regime:${row.regime}`, entry.v4Result, null); pushStratum(`scenario:${row.scenario}`, entry.v4Result, null); }
  for (const entry of C) { const row = entry.row; pushStratum(`market:${row.market_key}`, null, entry.g2Result); pushStratum(`type:${row.market_type}`, null, entry.g2Result); pushStratum(`regime:${row.regime}`, null, entry.g2Result); pushStratum(`scenario:${row.scenario}`, null, entry.g2Result); }
  const stratumRows = [...strata.values()].map((bucket) => {
    const a = cohort(bucket.accepted, (value) => value), b = cohort(bucket.avoided, (value) => value);
    return { key: bucket.key, accepted: a, avoided: b, deltaPp: a.wr !== null && b.wr !== null ? Number(((a.wr - b.wr) * 100).toFixed(2)) : null, p: twoProportionP(a.wins, a.decided, b.wins, b.decided) };
  }).filter((row) => row.accepted.decided > 0 && row.avoided.decided > 0);
  const weighted = stratumRows.reduce((acc, row) => { const w = Math.min(row.accepted.decided, row.avoided.decided); if (acc.w + w > 0) { acc.sum += (row.deltaPp ?? 0) * w; acc.w += w; } return acc; }, { sum: 0, w: 0 });
  const signFlip = stratumRows.some((row) => row.deltaPp !== null && pairedSelection.deltaPp !== null && Math.sign(row.deltaPp) !== Math.sign(selection.deltaPp) && Math.abs(row.deltaPp) > 5);
  report.selection = { ...selection, weightedDeltaPp: weighted.w ? Number((weighted.sum / weighted.w).toFixed(2)) : null, strataWithBothArms: stratumRows.length, signFlipStratum: signFlip, strata: stratumRows };

  /* 3. Red Team incremental */
  const pass = [], veto = [], keepsWait = [], other = [];
  for (const row of data.v4) {
    const g2 = row.candidate_id ? g2ByCandidate.get(row.candidate_id) : null;
    const synthesisAction = row.payload?.synthesis?.action ?? null;
    const synthesisDir = row.payload?.synthesis?.direction ?? null;
    const final = row.final_action;
    const tradeT = synthesisAction === "BUY" || synthesisAction === "SELL";
    const tradeF = final === "BUY" || final === "SELL";
    if (tradeT && tradeF) pass.push({ result: row.theoretical_result ?? outcomeFor(row.direction, g2), row });
    else if (tradeT && !tradeF) veto.push({ result: outcomeFor(synthesisDir, g2), row, synthesisDir });
    else if (!tradeT && !tradeF) keepsWait.push(row);
    else other.push(row);
  }
  const passCohort = cohort(pass, (entry) => entry.result);
  const vetoCohort = cohort(veto, (entry) => entry.result);
  report.redTeam = {
    pass: { ...passCohort, expectancy: expectancyOf(pass, (entry) => entry.result, pass.map((entry) => Number(entry.row?.payout)).filter(Number.isFinite)) },
    vetoedCounterfactual: { ...vetoCohort, expectancy: expectancyOf(veto, (entry) => entry.result, veto.map((entry) => Number(entry.row?.payout)).filter(Number.isFinite)) },
    keepsWait: keepsWait.length, otherStates: other.length,
    vetoDeltaPp: passCohort.wr !== null && vetoCohort.wr !== null ? Number(((passCohort.wr - vetoCohort.wr) * 100).toFixed(2)) : null,
    pValue: twoProportionP(passCohort.wins, passCohort.decided, vetoCohort.wins, vetoCohort.decided),
    bootstrap: bootstrapDelta(pass, (entry) => entry.result, veto, (entry) => entry.result),
    byVerdict: groupCohorts(data.v4, (row) => row.payload?.redTeam?.phase2?.verdict ?? "UNKNOWN", (row) => row.theoretical_result ?? outcomeFor(row.direction, g2ByCandidate.get(row.candidate_id))),
  };

  /* 4. especialistas: alinhamento e condicionamento */
  report.specialists = specialistAnalysis(data.v4, g2ByCandidate);

  /* 5. scenario / playbook */
  const scenarioRows = new Map();
  for (const row of data.v4) {
    const g2 = g2ByCandidate.get(row.candidate_id);
    const key = [row.scenario ?? "UNKNOWN", row.regime ?? "UNKNOWN", row.direction ?? "WAIT", row.market_type ?? "?"].join(" | ");
    if (!scenarioRows.has(key)) scenarioRows.set(key, { key, scenario: row.scenario, regime: row.regime, direction: row.direction, marketType: row.market_type, accepted: [], avoided: [], all: 0 });
    const bucket = scenarioRows.get(key);
    bucket.all += 1;
    const accepted = row.final_action === "BUY" || row.final_action === "SELL";
    if (accepted) bucket.accepted.push(row.theoretical_result ?? outcomeFor(row.direction, g2));
    else bucket.avoided.push(outcomeFor(row.direction ?? null, g2));
  }
  report.playbooks = [...scenarioRows.values()].map((bucket) => {
    const accepted = cohort(bucket.accepted, (value) => value);
    const avoided = cohort(bucket.avoided, (value) => value);
    return { key: bucket.key, scenario: bucket.scenario, regime: bucket.regime, direction: bucket.direction, marketType: bucket.marketType, nObserved: bucket.all, accepted: { ...accepted, coverage: bucket.all ? Number((accepted.n / bucket.all).toFixed(4)) : null }, avoided, status: statusOf(accepted.decided, accepted.wr !== null && avoided.wr !== null ? Number(((accepted.wr - avoided.wr) * 100).toFixed(2)) : null) };
  }).sort((a, b) => b.accepted.decided - a.accepted.decided);

  /* 6. funil FAILED_BREAKOUT / RANGE */
  report.funnel = funnel(data.v4);

  /* 7. trigger */
  const triggerGroups = groupCohorts(data.v4, (row) => row.payload?.synthesis?.triggerState ?? "UNKNOWN", (row) => {
    const g2 = g2ByCandidate.get(row.candidate_id);
    const accepted = row.final_action === "BUY" || row.final_action === "SELL";
    if (accepted) return row.theoretical_result ?? outcomeFor(row.direction, g2);
    const dir = row.payload?.synthesis?.direction ?? null;
    return outcomeFor(dir, g2);
  });
  report.trigger = triggerGroups;

  /* 8. data quality */
  report.dataQuality = groupCohorts(data.v4, (row) => row.data_quality ?? "UNKNOWN", (row) => {
    const g2 = g2ByCandidate.get(row.candidate_id);
    const accepted = row.final_action === "BUY" || row.final_action === "SELL";
    return accepted ? row.theoretical_result ?? outcomeFor(row.direction, g2) : outcomeFor(row.payload?.synthesis?.direction ?? null, g2);
  });

  /* 9/10. late window */
  const timing = data.timing.map((row) => {
    const g2 = g2ByCandidate.get(row.candidate_id);
    const late = row.late_policy ?? {};
    const current = row.current_policy ?? {};
    return {
      candidateId: row.candidate_id, direction: row.direction, outcome: row.outcome, reason: row.outcome_reason,
      lateResult: late.result ?? null, lateVerdict: late.verdict ?? null, lateEntry: late.entryPriceWouldBe ?? null,
      lateDeadlineAt: late.deadlineAt ?? null, lateEvaluations: Array.isArray(late.evaluations) ? late.evaluations.length : null,
      currentResult: current.result ?? null, currentEntry: current.entryPrice ?? null,
      originalCounterfactual: g2 ? g2.result : null, targetEntryAt: row.target_entry_at,
    };
  });
  const lateGroups = new Map();
  for (const row of timing) {
    const key = row.outcome ?? "UNKNOWN";
    if (!lateGroups.has(key)) lateGroups.set(key, []);
    lateGroups.get(key).push(row);
  }
  report.lateWindow = {
    outcomeGroups: [...lateGroups.entries()].map(([key, rows]) => ({ outcome: key, n: rows.length, originalCounterfactual: cohort(rows, (row) => row.originalCounterfactual), reasons: [...new Set(rows.map((row) => row.reason).filter(Boolean))].slice(0, 4) })).sort((a, b) => b.n - a.n),
    lateAcceptTrades: cohort(timing.filter((row) => row.outcome === "LATE_ACCEPT"), (row) => row.lateResult),
    currentVsLateBothSettled: (() => { const both = timing.filter((row) => row.currentResult && row.lateResult); return { n: both.length, current: cohort(both, (row) => row.currentResult), late: cohort(both, (row) => row.lateResult) }; })(),
    entryQuality: (() => {
      const accepts = timing.filter((row) => row.outcome === "LATE_ACCEPT" && row.lateEntry !== null);
      const better = accepts.filter((row) => { const reference = Number(row.currentEntry ?? row.lateEntry); const late = Number(row.lateEntry); return row.direction === "BUY" ? late < reference : late > reference; }).length;
      const worse = accepts.filter((row) => { const reference = Number(row.currentEntry ?? row.lateEntry); const late = Number(row.lateEntry); return row.direction === "BUY" ? late > reference : late < reference; }).length;
      const evaluations = accepts.map((row) => row.lateEvaluations).filter((value) => Number.isFinite(value));
      return { n: accepts.length, priceBetter: better, priceWorse: worse, priceEqual: accepts.length - better - worse, avgExtraEvaluations: evaluations.length ? Number((evaluations.reduce((a, b) => a + b, 0) / evaluations.length).toFixed(1)) : null };
    })(),
    coverage: (() => { const accept = timing.filter((row) => row.outcome === "LATE_ACCEPT").length; const cancel = timing.filter((row) => row.outcome === "LATE_CANCEL").length; const observing = timing.filter((row) => row.outcome === "OBSERVING").length; return { accept, cancel, observing, total: timing.length, coverageRate: timing.length ? Number((accept / timing.length).toFixed(4)) : null }; })(),
    intersectionVerdicts: (() => { const map = new Map(); for (const row of data.inter) { const key = row.late_verdict ?? "UNKNOWN"; if (!map.has(key)) map.set(key, []); const g2 = g2ByCandidate.get(row.candidate_id); map.get(key).push(g2?.result ?? null); } return [...map.entries()].map(([key, values]) => ({ verdict: key, n: values.length, originalWR: cohort(values.map((value) => ({ result: value })), (entry) => entry.result).wr })).sort((a, b) => b.n - a.n); })(),
  };

  /* 11. ablation e preenchida no fluxo principal (async) */

  /* 12. FDR */
  const tests = [];
  if (report.selection.paired.pValue !== null) tests.push({ id: "V4_selection_accepted_vs_avoided", p: report.selection.paired.pValue });
  if (report.redTeam.pValue !== null) tests.push({ id: "red_team_pass_vs_vetoed", p: report.redTeam.pValue });
  for (const row of report.trigger) if (row.p !== null && row.p !== undefined) tests.push({ id: `trigger:${row.key}`, p: row.p });
  for (const row of report.selection.strata) if (row.p !== null) tests.push({ id: `stratum:${row.key}`, p: row.p });
  report.multipleTesting = { raw: tests, adjusted: bhFdr(tests), policy: "Benjamini-Hochberg FDR; q<=0.10 como limite exploratorio; nada aqui e verdade binaria." };

  /* 13. status por etapa (minimum sample) */
  report.stageStatus = stageStatusTable(report);
  return report;
}

function groupCohorts(rows, keyOf, resultOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(resultOf(row));
  }
  return [...groups.entries()].map(([key, values]) => {
    const stats = cohort(values.map((value) => ({ result: value })), (entry) => entry.result);
    return { key, ...stats, status: statusOf(stats.decided, null) };
  }).sort((a, b) => b.decided - a.decided);
}

function parseDirection(text) { const match = String(text ?? "").match(/direcao=(UP|DOWN|FLAT)/i); return match ? match[1] : null; }

function specialistAnalysis(v4Rows, g2ByCandidate) {
  const table = new Map();
  for (const row of v4Rows) {
    if (row.final_action !== "BUY" && row.final_action !== "SELL") continue;
    const g2 = g2ByCandidate.get(row.candidate_id);
    const result = row.theoretical_result ?? outcomeFor(row.direction, g2);
    if (!DECIDED.has(result)) continue;
    for (const agent of row.payload?.agents ?? []) {
      const state = agent.state;
      const alignment = alignmentOf(agent.agentId, state, row.direction, agent.reasoningSummary);
      if (!alignment) continue;
      const key = `${agent.agentId}:${alignment}`;
      if (!table.has(key)) table.set(key, { agentId: agent.agentId, alignment, results: [] });
      table.get(key).results.push(result);
    }
  }
  const byAgent = new Map();
  for (const entry of table.values()) {
    if (!byAgent.has(entry.agentId)) byAgent.set(entry.agentId, { agentId: entry.agentId, aligned: [], opposed: [], neutral: [] });
    byAgent.get(entry.agentId)[entry.alignment.toLowerCase()].push(...entry.results);
  }
  return [...byAgent.values()].map((entry) => {
    const aligned = cohort(entry.aligned.map((value) => ({ result: value })), (row) => row.result);
    const opposed = cohort(entry.opposed.map((value) => ({ result: value })), (row) => row.result);
    const deltaPp = aligned.wr !== null && opposed.wr !== null ? Number(((aligned.wr - opposed.wr) * 100).toFixed(2)) : null;
    return { agentId: entry.agentId, aligned, opposed, deltaPp, pValue: twoProportionP(aligned.wins, aligned.decided, opposed.wins, opposed.decided), status: statusOf(Math.min(aligned.decided, opposed.decided), deltaPp) };
  }).sort((a, b) => (b.aligned.decided + b.opposed.decided) - (a.aligned.decided + a.opposed.decided));
}

function alignmentOf(agentId, state, action, reasoning) {
  if (action !== "BUY" && action !== "SELL") return null;
  const bullish = action === "BUY";
  const table = {
    MARKET_REGIME_AGENT: [["TREND_UP"], ["TREND_DOWN"]],
    MARKET_STRUCTURE_AGENT: [["BULLISH_STRUCTURE"], ["BEARISH_STRUCTURE"]],
    TREND_AGENT: [["BULLISH"], ["BEARISH"]],
    PRICE_ACTION_AGENT: [["BULLISH"], ["BEARISH"]],
    LOCATION_AGENT: [["EDGE_LOWER"], ["EDGE_UPPER"]],
    MICROSTRUCTURE_AGENT: [["BUY_PRESSURE"], ["SELL_PRESSURE"]],
    MOMENTUM_AGENT: [["STRONG", "BUILDING"], ["WEAKENING", "REVERSING"]],
    VOLATILITY_AGENT: [["NORMAL"], ["VOLATILE_SPIKE"]],
  };
  const mapping = table[agentId];
  if (mapping) {
    if ((bullish ? mapping[0] : mapping[1]).includes(state)) return "ALIGNED";
    if ((bullish ? mapping[1] : mapping[0]).includes(state)) return "OPPOSED";
    return "NEUTRAL";
  }
  if (agentId === "MOMENTUM_AGENT") { const dir = parseDirection(reasoning); if (dir === "UP") return bullish ? "ALIGNED" : "OPPOSED"; if (dir === "DOWN") return bullish ? "OPPOSED" : "ALIGNED"; }
  return null;
}

function funnel(v4Rows) {
  const targets = ["FAILED_BREAKOUT", "RANGE_MEAN_REVERSION"];
  const rows = targets.map((scenario) => {
    const asPrimarySynthesis = v4Rows.filter((row) => row.payload?.synthesis?.primaryScenario === scenario);
    const asCompeting = v4Rows.filter((row) => row.payload?.synthesis?.competingScenario === scenario || row.payload?.synthesis?.secondaryScenario === scenario);
    const accepted = v4Rows.filter((row) => (row.final_action === "BUY" || row.final_action === "SELL") && (row.scenario === scenario || row.payload?.synthesis?.primaryScenario === scenario));
    const triggerStates = {};
    for (const row of asPrimarySynthesis) { const key = row.payload?.synthesis?.triggerState ?? "UNKNOWN"; triggerStates[key] = (triggerStates[key] ?? 0) + 1; }
    const redTeamVerdicts = {};
    for (const row of asPrimarySynthesis) { const key = row.payload?.redTeam?.phase2?.verdict ?? "UNKNOWN"; redTeamVerdicts[key] = (redTeamVerdicts[key] ?? 0) + 1; }
    return { scenario, synthesisPrimary: asPrimarySynthesis.length, synthesisCompetingOrSecondary: asCompeting.length, accepted: accepted.length, triggerStates, redTeamVerdicts, note: "Lista completa de candidatos do SCENARIO_AGENT nao e persistida (payload compacto); funil usa synthesis/agents." };
  });
  return rows;
}

async function runAblation(data) {
  if (!data.v4.length) return { available: false, reason: "SEM_ROWS" };
  const { ABLATION_COMPONENTS, evaluateAblation } = await import(new URL("../relay/research-lab/ablation.mjs", import.meta.url));
  const g2Map = new Map();
  for (const row of data.shadow) if (row.candidate_id) g2Map.set(row.candidate_id, { result: row.theoretical_result, direction: row.direction, payout: row.payout });
  const rows = data.v4.filter((row) => row.payload?.t0).slice(0, ABLATION_LIMIT);
  if (!rows.length) return { available: false, reason: "SEM_T0_NO_PAYLOAD" };
  const fullTaken = [];
  let fullAvoided = 0;
  for (const row of rows) {
    const accepted = row.final_action === "BUY" || row.final_action === "SELL";
    if (accepted) fullTaken.push(row.theoretical_result ?? outcomeFor(row.direction, g2Map.get(row.candidate_id)));
    else fullAvoided += 1;
  }
  const fullWins = cohort(fullTaken.map((result) => ({ result })), (entry) => entry.result);
  const components = [];
  for (const component of Object.keys(ABLATION_COMPONENTS)) {
    const taken = [];
    let changed = 0, avoided = 0, errors = 0;
    for (const row of rows) {
      let action = null;
      try { action = evaluateAblation({ t0: row.payload.t0, components: [component], dataQuality: row.data_quality === "UNSAFE" ? "UNSAFE" : "HEALTHY" }).action; }
      catch { errors += 1; continue; }
      if (action !== row.final_action) changed += 1;
      if (action === "BUY" || action === "SELL") {
        const result = action === row.direction && row.theoretical_result ? row.theoretical_result : outcomeFor(action, g2Map.get(row.candidate_id));
        taken.push(result);
      } else avoided += 1;
    }
    const ablated = cohort(taken.map((result) => ({ result })), (entry) => entry.result);
    const deltaPp = fullWins.wr !== null && ablated.wr !== null ? Number(((fullWins.wr - ablated.wr) * 100).toFixed(2)) : null;
    components.push({
      component, n: rows.length, errors, decisionsChanged: changed,
      coverageFull: rows.length ? Number((fullTaken.length / rows.length).toFixed(4)) : null,
      coverageAblated: rows.length ? Number(((rows.length - avoided) / rows.length).toFixed(4)) : null,
      wrFull: fullWins.wr, wrAblated: ablated.wr, decidedAblated: ablated.decided,
      deltaWrPp: deltaPp, deltaCoveragePp: rows.length ? Number((((rows.length - avoided - fullTaken.length) / rows.length) * 100).toFixed(2)) : null,
      status: statusOf(ablated.decided, deltaPp),
    });
  }
  return { available: true, sampleN: rows.length, baseline: { decided: fullWins.decided, wr: fullWins.wr, coverage: rows.length ? Number((fullTaken.length / rows.length).toFixed(4)) : null }, components, note: "single-removal marginal (proxy de contribuicao; NAO e Shapley)." };
}

function stageStatusTable(report) {
  const rows = [];
  const add = (component, baseline, withComponent, withoutComponent, decided, deltaPp, status, note) => rows.push({ component, baseline, withComponent, withoutComponent, deltaPp, decided, ci95: null, status, note });
  add("Regime", "â€”", `${(report.specialists.find((row) => row.agentId === "MARKET_REGIME_AGENT")?.aligned.wr ?? 0) * 100}%`, `${(report.specialists.find((row) => row.agentId === "MARKET_REGIME_AGENT")?.opposed.wr ?? 0) * 100}%`, report.specialists.find((row) => row.agentId === "MARKET_REGIME_AGENT")?.aligned.decided ?? 0, report.specialists.find((row) => row.agentId === "MARKET_REGIME_AGENT")?.deltaPp ?? null, report.specialists.find((row) => row.agentId === "MARKET_REGIME_AGENT")?.status ?? "INSUFFICIENT", "alinhamento vs oposto");
  add("Structure", "â€”", "â€”", "â€”", report.specialists.find((row) => row.agentId === "MARKET_STRUCTURE_AGENT")?.aligned.decided ?? 0, report.specialists.find((row) => row.agentId === "MARKET_STRUCTURE_AGENT")?.deltaPp ?? null, report.specialists.find((row) => row.agentId === "MARKET_STRUCTURE_AGENT")?.status ?? "INSUFFICIENT", "alinhamento vs oposto");
  add("Trend", "â€”", "â€”", "â€”", report.specialists.find((row) => row.agentId === "TREND_AGENT")?.aligned.decided ?? 0, report.specialists.find((row) => row.agentId === "TREND_AGENT")?.deltaPp ?? null, report.specialists.find((row) => row.agentId === "TREND_AGENT")?.status ?? "INSUFFICIENT", "alinhamento vs oposto (checar inversao)");
  const location = report.specialists.find((row) => row.agentId === "LOCATION_AGENT");
  add("Location", "â€”", "â€”", "â€”", location?.aligned.decided ?? 0, location?.deltaPp ?? null, (location?.aligned.decided ?? 0) + (location?.opposed.decided ?? 0) < 20 ? "BUG_BLOCKED" : location?.status, "mapeamento auditado na secao locationAudit");
  add("Momentum", "â€”", "â€”", "â€”", report.specialists.find((row) => row.agentId === "MOMENTUM_AGENT")?.aligned.decided ?? 0, report.specialists.find((row) => row.agentId === "MOMENTUM_AGENT")?.deltaPp ?? null, report.specialists.find((row) => row.agentId === "MOMENTUM_AGENT")?.status ?? "INSUFFICIENT", "alinhamento vs oposto");
  add("Volatility", "â€”", "â€”", "â€”", report.specialists.find((row) => row.agentId === "VOLATILITY_AGENT")?.aligned.decided ?? 0, report.specialists.find((row) => row.agentId === "VOLATILITY_AGENT")?.deltaPp ?? null, report.specialists.find((row) => row.agentId === "VOLATILITY_AGENT")?.status ?? "INSUFFICIENT", "media de estado; ver agentes");
  add("PriceAction", "â€”", "â€”", "â€”", report.specialists.find((row) => row.agentId === "PRICE_ACTION_AGENT")?.aligned.decided ?? 0, report.specialists.find((row) => row.agentId === "PRICE_ACTION_AGENT")?.deltaPp ?? null, report.specialists.find((row) => row.agentId === "PRICE_ACTION_AGENT")?.status ?? "INSUFFICIENT", "alinhamento vs oposto");
  add("Microstructure", "â€”", "â€”", "â€”", report.specialists.find((row) => row.agentId === "MICROSTRUCTURE_AGENT")?.aligned.decided ?? 0, report.specialists.find((row) => row.agentId === "MICROSTRUCTURE_AGENT")?.deltaPp ?? null, report.specialists.find((row) => row.agentId === "MICROSTRUCTURE_AGENT")?.status ?? "INSUFFICIENT", "alinhamento vs oposto");
  add("SynthesisTrigger", String(Number((report.cohorts.C_v4Wait.wr ?? 0) * 100)) + "% contexto vetado", String(Number((report.selection.paired.accepted.wr ?? 0) * 100)) + "% triggered", "â€”", report.selection.paired.accepted.decided, report.selection.paired.deltaPp, statusOf(Math.min(report.selection.paired.accepted.decided, report.cohorts.C_v4Wait.decided), report.selection.paired.deltaPp), "triggered vs vetados");
  add("RedTeam", String(Number((report.redTeam.vetoedCounterfactual.wr ?? 0) * 100)) + "% vetados", String(Number((report.redTeam.pass.wr ?? 0) * 100)) + "% passou", "â€”", report.redTeam.pass.decided, report.redTeam.vetoDeltaPp, statusOf(Math.min(report.redTeam.pass.decided, report.redTeam.vetoedCounterfactual.decided), report.redTeam.vetoDeltaPp), "pass vs veto");
  const dqHealthy = report.dataQuality.find((row) => row.key === "HEALTHY");
  const dqDegraded = report.dataQuality.find((row) => row.key === "DEGRADED");
  add("DataQuality", `${(dqDegraded?.wr ?? 0) * 100}% (degraded)`, `${(dqHealthy?.wr ?? 0) * 100}% (healthy)`, "â€”", dqHealthy?.decided ?? 0, dqHealthy?.wr !== null && dqDegraded?.wr !== null ? Number(((dqHealthy.wr - dqDegraded.wr) * 100).toFixed(2)) : null, statusOf(Math.min(dqHealthy?.decided ?? 0, dqDegraded?.decided ?? 0), null), "healthy vs degraded");
  const lateAccept = report.lateWindow.lateAcceptTrades;
  const lateCancelLogic = report.lateWindow.outcomeGroups.find((row) => row.outcome === "LATE_CANCEL");
  add("LateWindow", "checkpoint atual", `${(lateAccept.wr ?? 0) * 100}% (LATE_ACCEPT)`, `${(lateCancelLogic?.originalCounterfactual?.wr ?? 0) * 100}% (CANCEL original)`, lateAccept.decided, null, statusOf(lateAccept.decided, null), "cancelamentos logicos ainda sem contrafactual proprio");
  return rows;
}

/* ---------------------------------- markdown ---------------------------------- */

function renderMarkdown(report) {
  const out = [];
  const line = (label, s) => `| ${label} | ${s.decided} | ${s.wins}/${s.losses}/${s.draws} | ${s.wr === null ? "â€”" : (s.wr * 100).toFixed(1) + "%"} | ${s.ci95.low === null ? "â€”" : (s.ci95.low * 100).toFixed(1) + "â€“" + (s.ci95.high * 100).toFixed(1) + "%"} |`;
  out.push("# EFICÃCIA POR ETAPA â€” v2 (coortes pareadas, testes, FDR)\n");
  out.push(`- Gerado: ${report.generatedAtUtc}. Fonte: ${report.source}. Contagens: ${JSON.stringify(report.counts)}.`);
  out.push("- READ-ONLY. N pequeno sinalizado. WAIT fora do denominador. PROSPECTIVE â‰  PRACTICE â‰  REAL.\n");
  out.push("## 1. Coortes pareadas (mesma oportunidade)\n| coorte | decididos | W/L/D | WR | CI95 |\n|---|---|---|---|---|");
  out.push(line("A G2 trade + V4 trade MESMA direÃ§Ã£o (V4)", { ...report.cohorts.A_sameDirection, decided: report.cohorts.A_sameDirection.n, wr: report.cohorts.A_sameDirection.wr, wins: report.cohorts.A_sameDirection.wins, losses: report.cohorts.A_sameDirection.losses, draws: report.cohorts.A_sameDirection.draws, ci95: report.cohorts.A_sameDirection.ci95 }));
  out.push(line("B V4 direÃ§Ã£o DIFERENTE do G2 (V4)", { ...report.cohorts.B_directionFlip.v4, decided: report.cohorts.B_directionFlip.v4.n }));
  out.push(line("B G2 na mesma oportunidade", { ...report.cohorts.B_directionFlip.g2, decided: report.cohorts.B_directionFlip.g2.n }));
  out.push(line("C G2 trade + V4 WAIT (contrafactual G2)", { ...report.cohorts.C_v4Wait, decided: report.cohorts.C_v4Wait.n }));
  out.push(`\n- B: McNemar b=${report.cohorts.B_directionFlip.pairedMcNemar.b} c=${report.cohorts.B_directionFlip.pairedMcNemar.c} p=${report.cohorts.B_directionFlip.pairedMcNemar.p ?? "â€”"}`);
  out.push(`- D (G2 WAIT Ã— V4 TRADE): ${report.cohorts.D_g2WaitV4Trade.n} (nÃ£o observado no fluxo atual)\n`);
  out.push("## 2/3. Delta de seleÃ§Ã£o e teste pareado\n");
  out.push(line("V4 aceitos", { ...report.selection.paired.accepted, decided: report.selection.paired.accepted.n }));
  out.push(line("V4 evitados (contrafactual G2)", { ...report.selection.paired.avoidedCounterfactual, decided: report.selection.paired.avoidedCounterfactual.n }));
  out.push(`\n- Delta: **${report.selection.paired.deltaPp ?? "â€”"} pp**; bootstrap CI95 [${report.selection.paired.bootstrapDelta.low}, ${report.selection.paired.bootstrapDelta.high}]; p=${report.selection.paired.pValue ?? "â€”"}`);
  out.push(`- Estratificado (peso min decididos): **${report.selection.weightedDeltaPp ?? "â€”"} pp** em ${report.selection.strataWithBothArms} estratos com ambos braÃ§os; sinal invertido em estrato: ${report.selection.signFlipStratum ? "SIM (checar Simpson)" : "nÃ£o"}`);
  for (const row of report.selection.strata.slice(0, 12)) out.push(`  - ${row.key}: delta ${row.deltaPp} pp (A ${row.accepted.wins}/${row.accepted.decided} vs B ${row.avoided.wins}/${row.avoided.decided}) p=${row.p ?? "â€”"}`);
  out.push("\n## 4. Red Team â€” valor incremental\n");
  out.push(line("Pass (Synthesis TRADE â†’ final TRADE)", { ...report.redTeam.pass, decided: report.redTeam.pass.n }));
  out.push(line("Vetados (Synthesis TRADE â†’ WAIT, contrafactual)", { ...report.redTeam.vetoedCounterfactual, decided: report.redTeam.vetoedCounterfactual.n }));
  out.push(`\n- Delta passâˆ’veto: **${report.redTeam.vetoDeltaPp ?? "â€”"} pp**; bootstrap [${report.redTeam.bootstrap.low}, ${report.redTeam.bootstrap.high}]; p=${report.redTeam.pValue ?? "â€”"}`);
  out.push(`- Synthesis WAIT â†’ WAIT: ${report.redTeam.keepsWait}; outros estados: ${report.redTeam.otherStates}`);
  out.push("\n## 5/7/8. Especialistas\n| agente | N alin | W/L alin | WR alin | N opos | WR opos | delta pp | p | status |\n|---|---|---|---|---|---|---|---|---|");
  for (const row of report.specialists) out.push(`| ${row.agentId} | ${row.aligned.decided} | ${row.aligned.wins}/${row.aligned.losses} | ${row.aligned.wr === null ? "â€”" : (row.aligned.wr * 100).toFixed(1) + "%"} | ${row.opposed.decided} | ${row.opposed.wr === null ? "â€”" : (row.opposed.wr * 100).toFixed(1) + "%"} | ${row.deltaPp ?? "â€”"} | ${row.pValue ?? "â€”"} | ${row.status} |`);
  out.push("\n## 9. Playbooks (scenario Ã— regime Ã— direction Ã— tipo)\n| chave | N obs | cobertura | decididos | WR | CI95 | contrafactual evitado WR | status |\n|---|---|---|---|---|---|---|---|");
  for (const row of report.playbooks.slice(0, 25)) out.push(`| ${row.key} | ${row.nObserved} | ${row.accepted.coverage} | ${row.accepted.decided} | ${row.accepted.wr === null ? "â€”" : (row.accepted.wr * 100).toFixed(1) + "%"} | ${row.accepted.ci95.low === null ? "â€”" : (row.accepted.ci95.low * 100).toFixed(1) + "â€“" + (row.accepted.ci95.high * 100).toFixed(1) + "%"} | ${row.avoided.wr === null ? "â€”" : (row.avoided.wr * 100).toFixed(1) + "%"} | ${row.status} |`);
  out.push("\n## 10. Funil FAILED_BREAKOUT / RANGE\n| cenÃ¡rio | synthesis primary | competing/secondary | aceitos | triggerStates | redTeam |\n|---|---|---|---|---|---|");
  for (const row of report.funnel) out.push(`| ${row.scenario} | ${row.synthesisPrimary} | ${row.synthesisCompetingOrSecondary} | ${row.accepted} | ${JSON.stringify(row.triggerStates)} | ${JSON.stringify(row.redTeamVerdicts)} |`);
  out.push("\n## 11/12. Trigger e Data Quality\n| grupo | decididos | W/L | WR | CI95 |\n|---|---|---|---|---|");
  for (const row of report.trigger) out.push(line(`trigger:${row.key}`, { ...row, decided: row.n }));
  out.push("");
  for (const row of report.dataQuality) out.push(line(`dq:${row.key}`, { ...row, decided: row.n }));
  out.push("\n## 13/14/15. Late Window\n| outcome | N | contrafactual original (WR) | reasons |\n|---|---|---|---|");
  for (const row of report.lateWindow.outcomeGroups) out.push(`| ${row.outcome} | ${row.n} | ${row.originalCounterfactual.wr === null ? "â€”" : (row.originalCounterfactual.wr * 100).toFixed(1) + "% (N=" + row.originalCounterfactual.decided + ")"} | ${(row.reasons ?? []).join(", ")} |`);
  out.push(`\n- LATE_ACCEPT liquidados: ${report.lateWindow.lateAcceptTrades.decided} (WR ${report.lateWindow.lateAcceptTrades.wr === null ? "â€”" : (report.lateWindow.lateAcceptTrades.wr * 100).toFixed(1) + "%"})`);
  out.push(`- Ambos braÃ§os liquidados: N=${report.lateWindow.currentVsLateBothSettled.n}`);
  out.push(`- Entry quality (LATE_ACCEPT): N=${report.lateWindow.entryQuality.n}; preÃ§o melhor ${report.lateWindow.entryQuality.priceBetter} / pior ${report.lateWindow.entryQuality.priceWorse} / igual ${report.lateWindow.entryQuality.priceEqual}; avaliaÃ§Ãµes extras mÃ©dias ${report.lateWindow.entryQuality.avgExtraEvaluations}`);
  out.push(`- Coverage: ${JSON.stringify(report.lateWindow.coverage)}`);
  out.push("\n### Late verdict Ã— contrafactual original\n| veredito | N | WR original |\n|---|---|---|");
  for (const row of report.lateWindow.intersectionVerdicts) out.push(`| ${row.verdict} | ${row.n} | ${row.originalWR === null ? "â€”" : (row.originalWR * 100).toFixed(1) + "%"} |`);
  out.push("\n## 16. Tabela de contribuiÃ§Ã£o por componente\n| componente | baseline | com | sem | delta pp | decididos | status | nota |\n|---|---|---|---|---|---|---|---|");
  for (const row of report.stageStatus) out.push(`| ${row.component} | ${row.baseline} | ${row.withComponent} | ${row.withoutComponent} | ${row.deltaPp ?? "â€”"} | ${row.decided} | ${row.status} | ${row.note} |`);
  out.push("\n## 17. Ablation / contribuiÃ§Ã£o marginal (single-removal; proxy, nÃ£o Shapley)\n");
  if (report.ablation.available) {
    out.push(`- amostra N=${report.ablation.sampleN}; baseline V4 full: WR ${report.ablation.baseline.wr === null ? "â€”" : (report.ablation.baseline.wr * 100).toFixed(1) + "%"} cobertura ${(report.ablation.baseline.coverage * 100).toFixed(0)}%`);
    out.push("| componente removido | decisÃµes mudadas | cobertura ablada | WR ablado | N ablado | delta WR (fullâˆ’ablado) | status |\n|---|---|---|---|---|---|---|");
    for (const row of report.ablation.components) out.push(`| ${row.component} | ${row.decisionsChanged}/${row.n} (err ${row.errors}) | ${(row.coverageAblated * 100).toFixed(0)}% | ${row.wrAblated === null ? "â€”" : (row.wrAblated * 100).toFixed(1) + "%"} | ${row.decidedAblated} | ${row.deltaWrPp ?? "â€”"} | ${row.status} |`);
  } else out.push(`- nÃ£o executada: ${report.ablation.reason}`);
  out.push("\n## 18. Multiple testing (BH-FDR)\n| teste | p | rank | q |\n|---|---|---|---|");
  for (const row of report.multipleTesting.adjusted.slice(0, 20)) out.push(`| ${row.id} | ${row.p} | ${row.rank}/${row.m} | ${row.q} |`);
  out.push(`\n${report.multipleTesting.adjusted.filter((row) => row.q <= 0.1).length} de ${report.multipleTesting.adjusted.length} passam q<=0.10 (exploratÃ³rio).\n`);
  out.push("## 19/20. Leitura\n");
  out.push("- Nenhuma conclusÃ£o definitiva com N pequeno; status por etapa na tabela acima.");
  out.push("- V4 nunca executou ordem; G2 broker executado = 0 nesta janela; a comparaÃ§Ã£o usa settlement causal da MESMA oportunidade.");
  return out.join("\n");
}

try {
  const data = await load();
  const report = analyze(data);
  report.ablation = await runAblation(data);
  if (report.ablation.available) {
    const mapping = { PRICE_ACTION: "PriceAction", MICROSTRUCTURE: "Microstructure", STRUCTURE: "Structure", LOCATION: "Location", VOLATILITY: "Volatility", RSI: "Momentum", ADX: "Regime" };
    for (const row of report.stageStatus) {
      const component = Object.entries(mapping).find(([, name]) => name === row.component)?.[0];
      const hit = component ? report.ablation.components.find((entry) => entry.component === component) : null;
      if (!hit) continue;
      row.withoutComponent = hit.wrAblated === null ? "â€”" : `${(hit.wrAblated * 100).toFixed(1)}%`;
      row.deltaPp = hit.deltaWrPp;
      row.decided = hit.decidedAblated;
      row.ci95 = wilson(0, 0);
      row.note = `ablation single-removal: cobertura ${(hit.coverageAblated * 100).toFixed(0)}% vs ${(hit.coverageFull * 100).toFixed(0)}%; ${hit.decisionsChanged} decisoes mudaram`;
      if (["SUPPORTED", "PROMISING", "EXPLORATORY", "INSUFFICIENT", "NEUTRAL"].includes(row.status) && hit.status) row.status = hit.status === "NEUTRAL" ? row.status : hit.status;
    }
  }
  fs.writeFileSync(path.join(ROOT, "docs/research/data/stage-efficacy-report.json"), `${JSON.stringify(report, null, 1)}\n`);
  fs.writeFileSync(path.join(ROOT, "docs/research/data/stage-efficacy-report.md"), `${renderMarkdown(report)}\n`);
  console.log("STAGE_EFFICACY_V2_WRITTEN");
  console.log(JSON.stringify({
    cohorts: { A: report.cohorts.A_sameDirection.n, B: report.cohorts.B_directionFlip.v4.n, C: report.cohorts.C_v4Wait.n, D: report.cohorts.D_g2WaitV4Trade.n },
    selection: { accepted: `${report.selection.paired.accepted.wins}/${report.selection.paired.accepted.decided}`, avoided: `${report.selection.paired.avoidedCounterfactual.wins}/${report.selection.paired.avoidedCounterfactual.decided}`, deltaPp: report.selection.paired.deltaPp, p: report.selection.paired.pValue, weighted: report.selection.weightedDeltaPp },
    redTeam: { pass: `${report.redTeam.pass.wins}/${report.redTeam.pass.decided}`, veto: `${report.redTeam.vetoedCounterfactual.wins}/${report.redTeam.vetoedCounterfactual.decided}`, deltaPp: report.redTeam.vetoDeltaPp, p: report.redTeam.pValue },
    late: { accept: report.lateWindow.lateAcceptTrades.decided, coverage: report.lateWindow.coverage, entryQuality: report.lateWindow.entryQuality },
    fdr10: report.multipleTesting.adjusted.filter((row) => row.q <= 0.1).length,
  }, null, 1));
} catch (error) {
  console.error("STAGE_EFFICACY_V2_FAILED", String(error?.stack ?? error).slice(0, 500));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}


