/**
 * COMITES V4 — TECHNICAL / RISK / EXECUTION.
 *
 * Nenhum comite executa ordem ou altera stake/direcao. Sao filtros de pesquisa (SHADOW).
 */
export const COMMITTEE_VERSION = "agents-v4-committees-v1";

export const COMMITTEE_POLICY = Object.freeze({
  version: COMMITTEE_VERSION,
  execution: "SHADOW_ONLY",
  sendsOrders: false,
  controlsExecution: false,
  changesStake: false,
  promotesToReal: false,
});

function conclusion(verdict, reasons, detail = {}) { return { verdict, reasons, ...detail, sendsOrders: false }; }

export function technicalCommittee({ specialists = {}, synthesis = null, redTeam = null } = {}) {
  const critical = [];
  const notes = [];
  const direction = synthesis?.detail?.direction ?? null;
  const scenario = synthesis?.detail?.primaryScenario ?? null;
  const trend = specialists.TREND_AGENT;
  const structure = specialists.MARKET_STRUCTURE_AGENT;
  const momentum = specialists.MOMENTUM_AGENT;
  const volatility = specialists.VOLATILITY_AGENT;
  if (direction) {
    const scenarioRequiresTrend = ["TREND_CONTINUATION", "TREND_PULLBACK", "REVERSAL"].includes(scenario);
    if (scenarioRequiresTrend) {
      const trendAgainst = trend && ((direction === "BUY" && trend.state === "BEARISH") || (direction === "SELL" && trend.state === "BULLISH"));
      if (trendAgainst) critical.push("TREND_AGAINST_DIRECTION");
    }
    const structureAgainst = structure && ((direction === "BUY" && structure.state === "BEARISH_STRUCTURE") || (direction === "SELL" && structure.state === "BULLISH_STRUCTURE"));
    if (structureAgainst && ["BREAKOUT", "TREND_CONTINUATION", "TREND_PULLBACK"].includes(scenario)) critical.push("STRUCTURE_AGAINST_DIRECTION");
    if (momentum?.state === "REVERSING" && ["TREND_CONTINUATION"].includes(scenario)) critical.push("MOMENTUM_REVERSING_AGAINST_CONTINUATION");
    if (volatility?.state === "VOLATILE_SPIKE") critical.push("VOLATILITY_SPIKE");
  } else {
    notes.push("SEM_DIRECAO_PARA_REVISAR");
  }
  if (redTeam?.verdict === "CHALLENGED_UNRESOLVED") critical.push("RED_TEAM_UNRESOLVED");
  const verdict = critical.length ? "FAIL" : (synthesis?.conflictingAgents?.length ?? 0) > 0 ? "CAUTION" : "PASS";
  return conclusion(verdict, critical, { notes, direction, scenario, policy: COMMITTEE_POLICY });
}

export function riskCommittee({ specialists = {}, synthesis = null, risk = null } = {}) {
  const riskAgent = specialists.RISK_CONTEXT_AGENT;
  const dq = specialists.DATA_QUALITY_AGENT;
  const reasons = [];
  let verdict = "ELIGIBLE";
  if (dq?.state === "UNSAFE" || riskAgent?.state === "BLOCK") { verdict = "BLOCK"; reasons.push(dq?.state === "UNSAFE" ? "DATA_QUALITY_UNSAFE" : "RISK_CONTEXT_BLOCK"); }
  else if (dq?.state === "DEGRADED" || riskAgent?.state === "CAUTION") { verdict = "CAUTION"; reasons.push(dq?.state === "DEGRADED" ? "DATA_QUALITY_DEGRADED" : "RISK_CONTEXT_CAUTION"); }
  if (String(risk?.accountContext ?? "").toUpperCase() === "REAL") { verdict = "BLOCK"; reasons.push("V4_SHADOW_ONLY_REAL_FORBIDDEN"); }
  if (verdict === "BLOCK" && synthesis?.action && synthesis.action !== "WAIT") reasons.push("SYNTHESIS_ACTION_IGNORED_FOR_EXECUTION");
  return conclusion(verdict, reasons, { accountContext: risk?.accountContext ?? "PRACTICE", policy: COMMITTEE_POLICY });
}

export function executionCommittee({ specialists = {}, synthesis = null, execution = null } = {}) {
  const timing = specialists.EXECUTION_TIMING_AGENT;
  const reasons = [];
  let verdict = "CLEAR";
  if (timing?.state === "UNSAFE") { verdict = "BLOCK"; reasons.push("TIMING_UNSAFE"); }
  else if (timing?.state === "TOO_LATE") { verdict = "BLOCK"; reasons.push("TOO_LATE"); }
  else if (timing?.state === "READY_WINDOW") { verdict = "CLEAR"; reasons.push("READY_WINDOW"); }
  else { verdict = "HOLD"; reasons.push(`TIMING_${timing?.state ?? "UNKNOWN"}`); }
  if ((timing?.riskFlags ?? []).includes("LATENCY_ABOVE_BUDGET")) { verdict = verdict === "CLEAR" ? "CAUTION" : verdict; reasons.push("LATENCY_ABOVE_BUDGET"); }
  if ((timing?.riskFlags ?? []).includes("ADVERSE_DISPLACEMENT")) { verdict = "CAUTION"; reasons.push("ADVERSE_DISPLACEMENT"); }
  if (String(execution?.accountContext ?? "").toUpperCase() === "REAL") { verdict = "BLOCK"; reasons.push("V4_SHADOW_ONLY_REAL_FORBIDDEN"); }
  reasons.push("IDEMPOTENCY_UNCHANGED", "EXECUTION_GATE_UNTOUCHED");
  return conclusion(verdict, reasons, { timingState: timing?.state ?? "UNKNOWN", policy: COMMITTEE_POLICY });
}

export function runCommittees({ specialists = {}, synthesis = null, redTeam = null, risk = null, execution = null } = {}) {
  return {
    version: COMMITTEE_VERSION,
    technical: technicalCommittee({ specialists, synthesis, redTeam }),
    risk: riskCommittee({ specialists, synthesis, risk }),
    execution: executionCommittee({ specialists, synthesis, execution }),
    policy: COMMITTEE_POLICY,
  };
}
