/**
 * STAGE EFFICACY REPORT — descobre empiricamente o que cada etapa agrega, sobre dados PROSPECTIVOS.
 *
 * Read-only. Cruza por candidate_id:
 *  - iq_shadow_observations (G2 baseline causal, todas as oportunidades)
 *  - iq_agents_v4_observations (V4: acao, agentes, cenario, red team, settlement direcional)
 *  - iq_scenario_shadow_observations (V3 congelada)
 *  - iq_timing_policy_observations (CURRENT vs LATE_WINDOW_V2)
 *  - iq_scenario_timing_intersections (intersecao)
 *
 * Uso: DATABASE_URL=... node scripts/stage-efficacy-report.mjs [--limit 5000]
 * Saida: docs/research/data/stage-efficacy-report.json + .md (com N e CI95 em tudo; N pequeno e sinalizado).
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, "relay", "package.json"));
const pg = require("pg");
const limit = Number((process.argv.find((arg) => arg.startsWith("--limit=")) ?? "--limit=5000").split("=")[1]) || 5000;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, ssl: { rejectUnauthorized: false } });

const DECIDED = new Set(["WIN", "LOSS", "DRAW"]);
const win = (result) => result === "WIN";
const wilson = (wins, n) => {
  if (!n) return { low: null, high: null };
  const p = wins / n, z = 1.96, den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / den;
  return { low: Number(Math.max(0, c - h).toFixed(4)), high: Number(Math.min(1, c + h).toFixed(4)) };
};
const stats = (rows, pick) => {
  const list = rows.filter((row) => DECIDED.has(pick(row)));
  const wins = list.filter((row) => win(pick(row))).length;
  const losses = list.filter((row) => pick(row) === "LOSS").length;
  return { n: list.length, wins, losses, wr: list.length ? Number((wins / list.length).toFixed(4)) : null, ci95: wilson(wins, list.length), lowPrecision: wins + losses < 30 };
};
const deltaPp = (a, b) => (a.wr === null || b.wr === null ? null : Number(((a.wr - b.wr) * 100).toFixed(2)));
const pickSettlement = (row) => row.theoretical_result ?? row.broker_result ?? null;

async function load() {
  const [shadow, v4, v3, timing, inter] = await Promise.all([
    pool.query(`SELECT candidate_id, theoretical_result, broker_result, settlement_basis, payout, entry_price, settlement_price, h1_location, h2_displacement, h3_critic, degradation, counterfactual, current_execution, created_at FROM iq_shadow_observations ORDER BY created_at DESC LIMIT $1`, [limit]),
    pool.query(`SELECT observation_id, candidate_id, market_key, market_type, direction, final_action, data_quality, regime, scenario, theoretical_result, settlement_basis, payout, payload, created_at FROM iq_agents_v4_observations ORDER BY created_at DESC LIMIT $1`, [limit]),
    pool.query(`SELECT candidate_id, final_action, direction, theoretical_result, payout, trader_scenario, critic_scenario, reasons_for_wait, scenario_at_candidate, created_at FROM iq_scenario_shadow_observations ORDER BY created_at DESC LIMIT $1`, [limit]),
    pool.query(`SELECT candidate_id, direction, current_policy, late_policy, outcome, outcome_reason, policy, target_entry_at, target_expiry_at, created_at FROM iq_timing_policy_observations ORDER BY created_at DESC LIMIT $1`, [limit]),
    pool.query(`SELECT candidate_id, verdict, late_verdict, late_valid_at_deadline, direction_agreement, scenario_final_action, intersection_codes, created_at FROM iq_scenario_timing_intersections ORDER BY created_at DESC LIMIT $1`, [limit]),
  ]);
  return { shadow: shadow.rows, v4: v4.rows, v3: v3.rows, timing: timing.rows, inter: inter.rows };
}

function byCandidate(rows) {
  const map = new Map();
  for (const row of rows) if (row.candidate_id) map.set(row.candidate_id, row);
  return map;
}

/** Resultado dentro de um jsonb de politica (current/late). Procura chaves conhecidas. */
function policyResult(policy) {
  if (!policy || typeof policy !== "object") return null;
  for (const key of ["result", "outcome", "theoreticalResult", "theoretical_result", "winLoss"]) {
    const value = policy[key];
    if (typeof value === "string" && DECIDED.has(value)) return value;
  }
  const nested = policy.settlement ?? policy.outcomeDetail ?? null;
  if (nested && typeof nested === "object") return policyResult(nested);
  return null;
}
function policyEntry(policy) { return policy?.entryPrice ?? policy?.entry_price ?? policy?.price ?? null; }

function agentAlignment(agentId, state, action) {
  if (action !== "BUY" && action !== "SELL") return null;
  const bullish = action === "BUY";
  const table = {
    MARKET_REGIME_AGENT: [["TREND_UP"], ["TREND_DOWN"]],
    MARKET_STRUCTURE_AGENT: [["BULLISH_STRUCTURE"], ["BEARISH_STRUCTURE"]],
    TREND_AGENT: [["BULLISH"], ["BEARISH"]],
    PRICE_ACTION_AGENT: [["BULLISH"], ["BEARISH"]],
    LOCATION_AGENT: [["EDGE_LOWER"], ["EDGE_UPPER"]],
    MICROSTRUCTURE_AGENT: [["BUY_PRESSURE"], ["SELL_PRESSURE"]],
  };
  const entry = table[agentId];
  if (!entry) return null;
  if ((bullish ? entry[0] : entry[1]).includes(state)) return "ALIGNED";
  if ((bullish ? entry[1] : entry[0]).includes(state)) return "OPPOSED";
  return "NEUTRAL";
}

function analyze(data) {
  const shadowByCandidate = byCandidate(data.shadow);
  const v3ByCandidate = byCandidate(data.v3);
  const timingByCandidate = byCandidate(data.timing);
  const report = { generatedAtUtc: new Date().toISOString(), source: "PROSPECTIVE_SHADOW", counts: { shadow: data.shadow.length, v4: data.v4.length, v3: data.v3.length, timing: data.timing.length, intersections: data.inter.length } };

  const shadowAll = stats(data.shadow, pickSettlement);
  const shadowCausal = stats(data.shadow.filter((row) => row.settlement_basis === "CAUSAL_COUNTERFACTUAL"), pickSettlement);
  const shadowBroker = stats(data.shadow.filter((row) => row.settlement_basis === "BROKER_EXECUTED"), pickSettlement);
  report.g2Baseline = { all: shadowAll, causal: shadowCausal, brokerExecuted: shadowBroker };

  const v4Accepted = [], v4Avoided = [], v4NoTrade = [], agreement = [];
  const perAgent = new Map(), perScenarioAccepted = new Map(), perScenarioAvoided = new Map(), perRegimeAccepted = new Map(), perRegimeAvoided = new Map(), perTrigger = new Map(), perRedTeam = new Map(), perDataQuality = new Map();
  for (const row of data.v4) {
    const shadow = shadowByCandidate.get(row.candidate_id);
    const counterfactual = shadow ? pickSettlement(shadow) : null;
    const accepted = row.final_action === "BUY" || row.final_action === "SELL";
    const settled = row.theoretical_result ?? null;
    if (accepted) v4Accepted.push({ result: settled, counterfactual, row });
    else if (row.final_action === "WAIT") v4Avoided.push({ result: counterfactual, row });
    else v4NoTrade.push({ result: counterfactual, row });
    if (accepted && row.direction && shadow?.direction === row.direction) agreement.push({ result: settled });
    const bucket = (map, key) => { if (!map.has(key)) map.set(key, { accepted: [], avoided: [] }); return map.get(key); };
    const scenarioKey = row.scenario ?? "UNKNOWN";
    bucket(perScenarioAccepted, scenarioKey).accepted.push({ result: settled, counterfactual });
    bucket(perScenarioAvoided, scenarioKey).avoided.push({ result: counterfactual });
    const regimeKey = row.regime ?? "UNKNOWN";
    bucket(perRegimeAccepted, regimeKey).accepted.push({ result: settled, counterfactual });
    bucket(perRegimeAvoided, regimeKey).avoided.push({ result: counterfactual });
    const trigger = row.payload?.synthesis?.triggerState ?? row.payload?.triggerState ?? "UNKNOWN";
    bucket(perTrigger, trigger).accepted.push({ result: settled, counterfactual });
    const verdict = row.payload?.redTeam?.phase2?.verdict ?? "UNKNOWN";
    bucket(perRedTeam, verdict).accepted.push({ result: settled, counterfactual });
    bucket(perDataQuality, row.data_quality ?? "UNKNOWN").accepted.push({ result: settled, counterfactual });
    if (accepted && settled) {
      for (const agent of row.payload?.agents ?? []) {
        const alignment = agentAlignment(agent.agentId, agent.state, row.direction);
        if (!alignment || alignment === "NEUTRAL") continue;
        if (!perAgent.has(agent.agentId)) perAgent.set(agent.agentId, { aligned: [], opposed: [] });
        perAgent.get(agent.agentId)[alignment === "ALIGNED" ? "aligned" : "opposed"].push(settled);
      }
    }
  }
  report.v4Selection = {
    accepted: stats(v4Accepted, (row) => row.result), avoidedCounterfactual: stats(v4Avoided, (row) => row.result), noTradeCounterfactual: stats(v4NoTrade, (row) => row.result),
    sameDirectionAgreement: stats(agreement, (row) => row.result),
    selectionDeltaPp: deltaPp(stats(v4Accepted, (row) => row.result), stats(v4Avoided, (row) => row.result)),
  };

  const v3Final = {};
  for (const row of data.v3) v3Final[row.final_action ?? "UNKNOWN"] = (v3Final[row.final_action ?? "UNKNOWN"] ?? 0) + 1;
  const v3Directional = stats(data.v3.filter((row) => row.final_action === "BUY" || row.final_action === "SELL"), pickSettlement);
  const v3Avoided = stats(data.v3.filter((row) => row.final_action === "WAIT"), (row) => shadowByCandidate.get(row.candidate_id)?.theoretical_result ?? null);
  report.v3 = { finalActions: v3Final, directional: v3Directional, avoidedCounterfactual: v3Avoided, selectionDeltaPp: deltaPp(v3Directional, v3Avoided) };

  const summarizeBuckets = (map) => [...map.entries()].map(([key, value]) => ({
    key, accepted: stats(value.accepted, (row) => row.result), avoidedCounterfactual: stats(value.avoided ?? [], (row) => row.result),
  })).sort((a, b) => b.accepted.n - a.accepted.n);
  report.byScenario = summarizeBuckets(perScenarioAccepted);
  report.byRegime = summarizeBuckets(perRegimeAccepted);
  report.bySynthesisTrigger = summarizeBuckets(perTrigger);
  report.byRedTeamVerdict = summarizeBuckets(perRedTeam);
  report.byDataQuality = summarizeBuckets(perDataQuality);
  report.byAgentAlignment = [...perAgent.entries()].map(([agentId, value]) => ({ agentId, aligned: stats(value.aligned, (r) => r), opposed: stats(value.opposed, (r) => r), deltaPp: deltaPp(stats(value.aligned, (r) => r), stats(value.opposed, (r) => r)) }));

  const timingRows = data.timing.map((row) => ({ ...row, current: policyResult(row.current_policy), late: policyResult(row.late_policy) }));
  const timingBoth = timingRows.filter((row) => row.current && row.late);
  report.lateWindow = {
    observations: timingRows.length, bothArmsSettled: timingBoth.length,
    currentArm: stats(timingBoth, (row) => row.current), lateArm: stats(timingBoth, (row) => row.late),
    lateDeltaPp: deltaPp(stats(timingBoth, (row) => row.late), stats(timingBoth, (row) => row.current)),
    decisions: timingBoth.filter((row) => row.current !== row.late).length,
    lateWinsOverCurrent: timingBoth.filter((row) => row.late === "WIN" && row.current !== "WIN").length,
    currentWinsOverLate: timingBoth.filter((row) => row.current === "WIN" && row.late !== "WIN").length,
    samplePolicyShape: timingRows[0] ? { currentKeys: Object.keys(timingRows[0].current_policy ?? {}), lateKeys: Object.keys(timingRows[0].late_policy ?? {}), outcome: timingRows[0].outcome, outcomeReason: timingRows[0].outcome_reason } : null,
  };

  const interVerdicts = {};
  const interLate = {};
  for (const row of data.inter) {
    interVerdicts[row.verdict ?? "UNKNOWN"] = (interVerdicts[row.verdict ?? "UNKNOWN"] ?? 0) + 1;
    interLate[row.late_verdict ?? "UNKNOWN"] = (interLate[row.late_verdict ?? "UNKNOWN"] ?? 0) + 1;
  }
  const survival = data.inter.filter((row) => row.late_valid_at_deadline === true);
  const survivalStats = stats(survival.map((row) => ({ candidate_id: row.candidate_id, theoretical_result: shadowByCandidate.get(row.candidate_id)?.theoretical_result ?? null })), pickSettlement);
  report.intersections = { verdicts: interVerdicts, lateVerdicts: interLate, survivorsToCutoff: survivalStats };

  const censoredShadow = stats(data.shadow.filter((row) => row.settlement_basis === "BROKER_EXECUTED"), pickSettlement);
  report.executedVsShadow = { g2Executed: censoredShadow, g2CausalCounterfactual: shadowCausal };

  const coverage = { v4WithCandidate: data.v4.filter((row) => row.candidate_id).length, v4WithoutShadowJoin: data.v4.filter((row) => row.candidate_id && !shadowByCandidate.has(row.candidate_id)).length, v3WithShadowJoin: data.v3.filter((row) => row.candidate_id && shadowByCandidate.has(row.candidate_id)).length, timingWithShadowJoin: timingRows.filter((row) => row.candidate_id && shadowByCandidate.has(row.candidate_id)).length };
  report.coverage = coverage;
  report.caveats = [
    "N prospectivo pequeno: toda metrica carrega N e CI95; nada e headline de performance.",
    "G2 baseline causal usa iq_shadow_observations (CAUSAL_COUNTERFACTUAL) para comparar na MESMA oportunidade; BROKER_EXECUTED e mostrado separado e nunca somado.",
    "V4/V3 WAIT nao tem settlement proprio; o resultado contrafactual vem do G2 causal da mesma oportunidade (mesmo T0/candles).",
    "PROSPECTIVE_SHADOW nao e PRACTICE nem REAL; nenhuma ordem foi executada pelo V4/V3.",
  ];
  return report;
}

function renderMarkdown(report) {
  const line = (label, s) => `| ${label} | ${s.n} | ${s.wr === null ? "—" : (s.wr * 100).toFixed(1) + "%"} | ${s.ci95.low === null ? "—" : (s.ci95.low * 100).toFixed(1) + "–" + (s.ci95.high * 100).toFixed(1) + "%"} | ${s.lowPrecision ? "SIM" : "não"} |`;
  const out = [];
  out.push("# EFICÁCIA POR ETAPA — relatório prospectivo (real, read-only)\n");
  out.push(`- Gerado: ${report.generatedAtUtc}. Fonte: ${report.source}. Contagens: ${JSON.stringify(report.counts)}.`);
  out.push("- Todas as métricas com N e CI95; N<30 sinalizado. WAIT nunca entra no denominador do WR.\n");
  out.push("## G2 baseline (mesma oportunidade)\n| conjunto | N | WR | CI95 | baixa precisão |\n|---|---|---|---|---|");
  out.push(line("G2 causal (contrafactual)", report.g2Baseline.causal));
  out.push(line("G2 broker executado", report.g2Baseline.brokerExecuted));
  out.push("\n## V4 seleção vs G2\n| conjunto | N | WR | CI95 | baixa precisão |\n|---|---|---|---|---|");
  out.push(line("V4 aceitos (BUY/SELL)", report.v4Selection.accepted));
  out.push(line("V4 WAIT (contrafactual G2)", report.v4Selection.avoidedCounterfactual));
  out.push(line("V4 NO_TRADE (contrafactual G2)", report.v4Selection.noTradeCounterfactual));
  out.push(`\n- Delta de seleção (aceitos − evitados): **${report.v4Selection.selectionDeltaPp ?? "—"} pp**\n`);
  out.push("## V3 congelada\n");
  out.push(`- Ações: ${JSON.stringify(report.v3.finalActions)}`);
  out.push(line("V3 direcionais", report.v3.directional));
  out.push(line("V3 WAIT (contrafactual G2)", report.v3.avoidedCounterfactual));
  out.push("\n## Especialistas (alinhamento vs resultado em trades aceitos)\n| agente | N alinhado | WR alinhado | N oposto | WR oposto | delta pp |\n|---|---|---|---|---|---|");
  for (const row of report.byAgentAlignment) out.push(`| ${row.agentId} | ${row.aligned.n} | ${row.aligned.wr === null ? "—" : (row.aligned.wr * 100).toFixed(1) + "%"} | ${row.opposed.n} | ${row.opposed.wr === null ? "—" : (row.opposed.wr * 100).toFixed(1) + "%"} | ${row.deltaPp ?? "—"} |`);
  out.push("\n## Cenários / regimes / trigger / red team / DQ (aceitos com WR; evitados com contrafactual)\n");
  const block = (title, rows) => { out.push(`### ${title}\n| chave | N aceitos | WR aceitos | N evitados | WR evitados (G2) |\n|---|---|---|---|---|`); for (const row of rows) out.push(`| ${row.key} | ${row.accepted.n} | ${row.accepted.wr === null ? "—" : (row.accepted.wr * 100).toFixed(1) + "%"} | ${row.avoidedCounterfactual.n} | ${row.avoidedCounterfactual.wr === null ? "—" : (row.avoidedCounterfactual.wr * 100).toFixed(1) + "%"} |`); out.push(""); };
  block("Por cenário", report.byScenario);
  block("Por regime", report.byRegime);
  block("Por trigger de síntese", report.bySynthesisTrigger);
  block("Por veredito do Red Team", report.byRedTeamVerdict);
  block("Por data quality", report.byDataQuality);
  out.push("## LATE WINDOW (CURRENT vs LATE, observações pareadas)\n");
  out.push(`- pares liquidados: ${report.lateWindow.bothArmsSettled} de ${report.lateWindow.observations}; decisões divergentes: ${report.lateWindow.decisions}`);
  out.push(line("CURRENT", report.lateWindow.currentArm));
  out.push(line("LATE_WINDOW_V2", report.lateWindow.lateArm));
  out.push(`- delta LATE−CURRENT: **${report.lateWindow.lateDeltaPp ?? "—"} pp**; late venceu current em ${report.lateWindow.lateWinsOverCurrent}; current venceu late em ${report.lateWindow.currentWinsOverLate}\n`);
  out.push("## Interseção cenário×timing\n");
  out.push(`- verdicts: ${JSON.stringify(report.intersections.verdicts)}`);
  out.push(`- late verdicts: ${JSON.stringify(report.intersections.lateVerdicts)}`);
  out.push(line("sobreviventes até o cutoff (G2 causal)", report.intersections.survivorsToCutoff));
  out.push(`\n## Caveats\n${report.caveats.map((c) => `- ${c}`).join("\n")}\n`);
  return out.join("\n");
}

try {
  const data = await load();
  const report = analyze(data);
  const jsonPath = path.join(ROOT, "docs/research/data/stage-efficacy-report.json");
  const mdPath = path.join(ROOT, "docs/research/data/stage-efficacy-report.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 1)}\n`);
  fs.writeFileSync(mdPath, `${renderMarkdown(report)}\n`);
  console.log(`STAGE_EFFICACY_WRITTEN ${jsonPath} + .md`);
  console.log(JSON.stringify({
    counts: report.counts,
    g2: report.g2Baseline.causal,
    v4Accepted: report.v4Selection.accepted,
    v4Avoided: report.v4Selection.avoidedCounterfactual,
    selectionDeltaPp: report.v4Selection.selectionDeltaPp,
    v3Actions: report.v3.finalActions,
    late: { both: report.lateWindow.bothArmsSettled, current: report.lateWindow.currentArm, lateArm: report.lateWindow.lateArm, delta: report.lateWindow.lateDeltaPp },
  }, null, 1));
} catch (error) {
  console.error("STAGE_EFFICACY_FAILED", String(error?.message ?? error).slice(0, 300));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
