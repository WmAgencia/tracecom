/**
 * RISK_CONTEXT_AGENT — payout, exposicao, posicoes, drawdown, loss streak, data quality,
 * saude do mercado e accountContext. NUNCA altera stake automaticamente.
 *
 * V4 e SHADOW e nao esta no allowlist REAL: qualquer accountContext REAL resulta em BLOCK.
 */
import { makeAgentOutput } from "../contracts.mjs";

export const RISK_CONTEXT_AGENT_VERSION = "risk-context-agent-v1";
export const RISK_STATES = Object.freeze(["ELIGIBLE", "CAUTION", "BLOCK"]);

export const RISK_CONTEXT_LIMITS = Object.freeze({
  maxPositions: 1,
  maxConsecutiveLosses: 6,
  maxDrawdownPct: 8,
  minPayout: 0.80,
  maxExposurePctOfCap: 0.8,
});

export function analyzeRiskContext({ features = {}, risk = null, accountContext = null, dataQualityState = "HEALTHY", dataQuality = "UNKNOWN" } = {}) {
  const f = features;
  const blockers = [];
  const cautions = [];
  const risks = [];
  const used = [];
  const limits = { ...RISK_CONTEXT_LIMITS, ...(risk?.limits ?? {}) };
  const context = String(accountContext ?? risk?.accountContext ?? "PRACTICE").toUpperCase();

  if (context === "REAL") {
    blockers.push("V4_SHADOW_ONLY_REAL_FORBIDDEN");
    risks.push("REAL_ALLOWLIST_UNTOUCHED");
  }
  if (dataQualityState === "UNSAFE") blockers.push("DATA_QUALITY_UNSAFE");

  const openPositions = Number.isFinite(Number(risk?.openPositions)) ? Number(risk.openPositions) : null;
  const consecutiveLosses = Number.isFinite(Number(risk?.consecutiveLosses)) ? Number(risk.consecutiveLosses) : null;
  const drawdownPct = Number.isFinite(Number(risk?.dailyDrawdownPct)) ? Number(risk.dailyDrawdownPct) : null;
  const payout = Number.isFinite(Number(risk?.payout)) ? Number(risk.payout) : null;
  const exposure = Number.isFinite(Number(risk?.exposure)) ? Number(risk.exposure) : null;
  const stakeCap = Number.isFinite(Number(risk?.stakeCap)) ? Number(risk.stakeCap) : null;
  if (openPositions !== null) { used.push("openPositions"); if (openPositions >= limits.maxPositions) blockers.push("MAX_POSITIONS_REACHED"); }
  if (consecutiveLosses !== null) { used.push("consecutiveLosses"); if (consecutiveLosses >= limits.maxConsecutiveLosses) blockers.push("LOSS_STREAK_LIMIT"); }
  if (drawdownPct !== null) { used.push("dailyDrawdownPct"); if (drawdownPct >= limits.maxDrawdownPct) blockers.push("DRAWDOWN_LIMIT"); }
  if (payout !== null) {
    used.push("payout");
    if (payout < limits.minPayout) cautions.push(`payout_baixo=${payout}`);
  }
  if (exposure !== null && stakeCap !== null && stakeCap > 0 && exposure / stakeCap > limits.maxExposurePctOfCap) cautions.push("EXPOSURE_NEAR_CAP");
  if (risk?.marketHealthy === false) cautions.push("MARKET_HEALTH_DEGRADED");

  const state = blockers.length ? "BLOCK" : cautions.length ? "CAUTION" : "ELIGIBLE";
  if (state === "BLOCK") risks.push(...blockers);

  return makeAgentOutput({
    agentId: "RISK_CONTEXT_AGENT",
    marketKey: f.marketKey, snapshotId: f.snapshotId,
    state,
    assessment: state === "ELIGIBLE" ? "risco_elegivel" : state === "CAUTION" ? "risco_com_cautela" : "risco_bloqueado",
    bullishEvidence: [], bearishEvidence: [],
    neutralEvidence: [...cautions, `accountContext=${context}`, `dataQuality=${dataQualityState}`],
    riskFlags: risks,
    featuresUsed: used,
    confidenceClass: "HIGH",
    dataQuality,
    reasoningSummary: `risk=${state} bloqueios=${blockers.join("|") || "nenhum"} cautelas=${cautions.join("|") || "nenhuma"}; stake_inalterado=true`,
    availableAt: f.availableAt,
    detail: { blockers, cautions, accountContext: context, limits, stakeUnchanged: true, sendsOrders: false },
  });
}
