/**
 * RED_TEAM_V4 — analise independente em DUAS FASES.
 *
 * FASE 1 (cega): recebe apenas as features do T0. NAO ve Synthesis nem especialistas.
 *   Produz regime/estrutura/cenario/direcao/risco/acao e CONGELA com sha256.
 * FASE 2: ve a Synthesis e tenta DESTRUI-la. Conflito material nao resolvido => WAIT.
 *   Nunca adota automaticamente a direcao oposta.
 */
import crypto from "node:crypto";

export const RED_TEAM_VERSION = "red-team-v4";
export const CONFLICT_TYPES = Object.freeze(["PULLBACK_VS_REVERSAL", "BREAKOUT_VS_FAILED_BREAKOUT", "RANGE_VS_EXPANSION", "CONTINUATION_VS_EXHAUSTION", "TREND_VS_TRANSITION"]);

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function clampEvidence(list) { return list.filter(Boolean).slice(0, 10); }

function phase1Direction(f) {
  const trendUp = (f.structureLabel === "UP" && f.structure1m !== "DOWN") || (Number.isFinite(f.adx) && f.adx >= 20 && f.diAlignedUp === true);
  const trendDown = (f.structureLabel === "DOWN" && f.structure1m !== "UP") || (Number.isFinite(f.adx) && f.adx >= 20 && f.diAlignedUp === false);
  if (trendUp && !trendDown) return "BUY";
  if (trendDown && !trendUp) return "SELL";
  if (f.structureLabel === "RANGE") {
    if (Number.isFinite(f.donchianPosition) && f.donchianPosition <= 0.15 && f.rejectionDown) return "BUY";
    if (Number.isFinite(f.donchianPosition) && f.donchianPosition >= 0.85 && f.rejectionUp) return "SELL";
  }
  if (f.bosUp) return "BUY";
  if (f.bosDown) return "SELL";
  return null;
}

export function runRedTeamPhase1({ features = {}, atMs = null } = {}) {
  const f = features;
  const bullish = [];
  const bearish = [];
  let regime = "TRANSITION";
  if (f.compressed || (Number.isFinite(f.atrRatio) && f.atrRatio < 0.7)) regime = "COMPRESSION";
  else if (f.expanded || (Number.isFinite(f.atrRatio) && f.atrRatio > 1.4)) regime = "EXPANSION";
  else if (f.structureLabel === "UP" && f.structure1m === "UP") regime = "TREND_UP";
  else if (f.structureLabel === "DOWN" && f.structure1m === "DOWN") regime = "TREND_DOWN";
  else if (f.structureLabel === "RANGE" && (f.adx === null || f.adx < 20)) regime = "RANGE";

  let scenario = "TRANSITION_NO_TRADE";
  if (regime === "TREND_UP" || regime === "TREND_DOWN") {
    const likelyExhaustion = (f.overextended === true) && ((f.rsi !== null && ((regime === "TREND_UP" && f.rsi >= 72) || (regime === "TREND_DOWN" && f.rsi <= 28))) || (Number.isFinite(f.accelerationATR) && Math.sign(f.accelerationATR) !== (regime === "TREND_UP" ? 1 : -1)));
    const pullback = regime === "TREND_UP" ? f.pullbackUp : f.pullbackDown;
    if (likelyExhaustion) scenario = "REVERSAL";
    else if (f.bosUp || f.bosDown) scenario = "BREAKOUT";
    else if (pullback) scenario = "TREND_PULLBACK";
    else scenario = "TREND_CONTINUATION";
  } else if (regime === "RANGE") {
    scenario = "RANGE_MEAN_REVERSION";
  } else if (regime === "COMPRESSION") {
    scenario = "COMPRESSION_EXPANSION";
  } else if (f.bosUp || f.bosDown) {
    scenario = (f.failedBreakoutUp || f.failedBreakoutDown) ? "FAILED_BREAKOUT" : "BREAKOUT";
  } else if (f.failedBreakoutUp || f.failedBreakoutDown) {
    scenario = "FAILED_BREAKOUT";
  }

  const direction = scenario === "REVERSAL"
    ? (regime === "TREND_UP" ? "SELL" : regime === "TREND_DOWN" ? "BUY" : null)
    : scenario === "FAILED_BREAKOUT"
      ? (f.failedBreakoutUp ? "SELL" : f.failedBreakoutDown ? "BUY" : null)
      : scenario === "BREAKOUT" || scenario === "COMPRESSION_EXPANSION"
        ? (f.bosUp || f.breakoutUp ? "BUY" : f.bosDown || f.breakoutDown ? "SELL" : null)
        : phase1Direction(f);

  if (direction === "BUY") bullish.push(`direcao_independente=BUY`, `regime=${regime}`, `cenario=${scenario}`);
  if (direction === "SELL") bearish.push(`direcao_independente=SELL`, `regime=${regime}`, `cenario=${scenario}`);

  const riskFlags = [];
  if (f.overextended) riskFlags.push("OVEREXTENDED");
  if (Number.isFinite(f.atrRatio) && f.atrRatio > 2.5) riskFlags.push("VOLATILITY_SPIKE");
  if (Number.isFinite(f.rsi) && (f.rsi >= 75 || f.rsi <= 25)) riskFlags.push("RSI_EXTREMO");
  if (!Number.isFinite(f.velocityATR) && !Number.isFinite(f.accelerationATR)) riskFlags.push("MOMENTUM_FEATURES_MISSING");
  if (regime === "TRANSITION") riskFlags.push("REGIME_INDEFINIDO");

  const confidence = direction && riskFlags.length === 0 ? "HIGH" : direction ? "MEDIUM" : "LOW";
  const core = {
    phase: "PHASE1_BLIND",
    seesSynthesis: false,
    seesSpecialists: false,
    regime, scenario, direction,
    structure: f.structureLabel ?? "UNKNOWN",
    action: direction && confidence !== "LOW" ? direction : "WAIT",
    risk: riskFlags.length ? "CAUTION" : "NORMAL",
    riskFlags,
    bullishEvidence: clampEvidence(bullish),
    bearishEvidence: clampEvidence(bearish),
    confidenceClass: confidence,
    featuresUsed: ["structureLabel", "structure1m", "adx", "diAlignedUp", "atrRatio", "overextended", "rsi", "velocityATR", "accelerationATR", "pullbackUp", "pullbackDown", "bosUp", "bosDown", "failedBreakoutUp", "failedBreakoutDown"].filter((path) => f[path] !== undefined && f[path] !== null),
  };
  const frozenHash = sha256Hex(core);
  const frozenAt = Number.isFinite(Number(atMs)) ? Number(atMs) : Date.now();
  return { ...core, frozenHash, frozenAt };
}

const OPPOSITES = { BUY: "SELL", SELL: "BUY" };

function conflictBetween({ synthesis, phase1 }) {
  const conflicts = [];
  const sDirection = synthesis?.detail?.direction ?? synthesis?.direction ?? null;
  const sScenario = synthesis?.detail?.primaryScenario ?? synthesis?.scenario ?? null;
  const pScenario = phase1?.scenario ?? null;
  const pDirection = phase1?.direction ?? null;
  const opposite = sDirection && pDirection === OPPOSITES[sDirection];
  const add = (type, material, detail) => conflicts.push({ type, material, detail });

  if (sScenario === "TREND_PULLBACK" && pScenario === "REVERSAL") add("PULLBACK_VS_REVERSAL", opposite || phase1.riskFlags?.length >= 1, { synthesis: sScenario, redTeam: pScenario });
  if ((sScenario === "BREAKOUT" && pScenario === "FAILED_BREAKOUT") || (sScenario === "FAILED_BREAKOUT" && pScenario === "BREAKOUT")) add("BREAKOUT_VS_FAILED_BREAKOUT", true, { synthesis: sScenario, redTeam: pScenario });
  if (sScenario === "RANGE_MEAN_REVERSION" && (pScenario === "COMPRESSION_EXPANSION" || pScenario === "BREAKOUT" || phase1.regime === "EXPANSION")) add("RANGE_VS_EXPANSION", phase1.regime === "EXPANSION" || pScenario === "BREAKOUT", { synthesis: sScenario, redTeam: pScenario, redTeamRegime: phase1.regime });
  if (sScenario === "TREND_CONTINUATION" && pScenario === "REVERSAL") add("CONTINUATION_VS_EXHAUSTION", opposite || (phase1.riskFlags ?? []).some((flag) => ["OVEREXTENDED", "RSI_EXTREMO"].includes(flag)), { synthesis: sScenario, redTeam: pScenario });
  if (["TREND_CONTINUATION", "TREND_PULLBACK"].includes(sScenario) && ["TRANSITION", "RANGE"].includes(phase1.regime)) add("TREND_VS_TRANSITION", phase1.regime === "RANGE" && opposite, { synthesis: sScenario, redTeamRegime: phase1.regime });
  return conflicts;
}

function tryResolve({ type, specialists, features }) {
  const trend = specialists.TREND_AGENT, structure = specialists.MARKET_STRUCTURE_AGENT, momentum = specialists.MOMENTUM_AGENT, volatility = specialists.VOLATILITY_AGENT, priceAction = specialists.PRICE_ACTION_AGENT, location = specialists.LOCATION_AGENT;
  switch (type) {
    case "BREAKOUT_VS_FAILED_BREAKOUT": {
      const freshBreak = (features.bosUp || features.bosDown) && (features.bodyRatio === null || features.bodyRatio >= 0.5) && !features.overextended;
      const failedNow = features.failedBreakoutUp || features.failedBreakoutDown;
      if (freshBreak && !failedNow) return { resolved: true, rule: "ROMPIMENTO_COM_CORPO_E_SEM_FALHA_NO_INSTANTE" };
      if (failedNow && !freshBreak) return { resolved: false, rule: "FALHA_E_SEM_ROMPIMENTO_FRESCO" };
      return { resolved: false, rule: "EVIDENCIA_INSUFICIENTE" };
    }
    case "PULLBACK_VS_REVERSAL": {
      const trendIntact = (trend?.state === "BULLISH" || trend?.state === "BEARISH") && trend?.detail?.weakening !== true && !["REVERSING"].includes(momentum?.state);
      const structureAligned = (trend?.state === "BULLISH" && structure?.state === "BULLISH_STRUCTURE") || (trend?.state === "BEARISH" && structure?.state === "BEARISH_STRUCTURE");
      if (trendIntact && structureAligned) return { resolved: true, rule: "TENDENCIA_E_ESTRUTURA_INTACTAS" };
      return { resolved: false, rule: "TENDENCIA_OU_ESTRUTURA_COMPROMETIDAS" };
    }
    case "RANGE_VS_EXPANSION": {
      const rangeHeld = structure?.state === "RANGE_STRUCTURE" && (volatility?.state === "COMPRESSED" || volatility?.state === "NORMAL") && (features.rejectionUp || features.rejectionDown);
      if (rangeHeld) return { resolved: true, rule: "RANGE_MANTIDO_COM_REJEICAO" };
      return { resolved: false, rule: "RANGE_SEM_DEFESA_OU_EXPANSAO_ATIVA" };
    }
    case "CONTINUATION_VS_EXHAUSTION": {
      const exhausted = (trend?.detail?.maturity === "MATURE" || trend?.detail?.weakening === true) && momentum?.state === "REVERSING";
      if (exhausted) return { resolved: false, rule: "EXAUSTAO_CONFIRMADA_POR_MOMENTUM" };
      const aligned = momentum?.state === "STRONG" || momentum?.state === "BUILDING";
      if (aligned) return { resolved: true, rule: "MOMENTUM_AINDA_A_FAVOR" };
      return { resolved: false, rule: "SEM_PROVA_DE_EXAUSTAO_NEM_DE_FORCA" };
    }
    case "TREND_VS_TRANSITION": {
      const aligned = (trend?.state === "BULLISH" && structure?.state === "BULLISH_STRUCTURE") || (trend?.state === "BEARISH" && structure?.state === "BEARISH_STRUCTURE");
      if (aligned && priceAction?.state !== "UNCERTAIN") return { resolved: true, rule: "ESTRUTURA_E_PRECO_DE_ACAO_ALINHADOS" };
      return { resolved: false, rule: "LEITURA_DE_ESTRUTURA_AMBIGUA" };
    }
    default:
      return { resolved: false, rule: "DESCONHECIDO" };
  }
}

export function runRedTeamPhase2({ phase1 = null, synthesis = null, specialists = {}, features = {}, atMs = null } = {}) {
  const reviewedAt = Number.isFinite(Number(atMs)) ? Number(atMs) : Date.now();
  if (!phase1 || !synthesis) {
    return { version: RED_TEAM_VERSION, phase: "PHASE2_REVIEW", verdict: "NO_REVIEW", conflicts: [], unresolvedMaterial: 0, action: synthesis?.action ?? "WAIT", direction: null, reviewedAt, note: "Fase cega indisponivel; nenhuma inversao automatica." };
  }
  const conflicts = conflictBetween({ synthesis: { ...synthesis, direction: synthesis.direction }, phase1 }).map((conflict) => {
    const resolution = tryResolve({ type: conflict.type, specialists, features });
    return { ...conflict, ...resolution, unresolved: conflict.material && !resolution.resolved };
  });
  const unresolvedMaterial = conflicts.filter((row) => row.unresolved).length;
  const verdict = unresolvedMaterial > 0 ? "CHALLENGED_UNRESOLVED" : conflicts.length > 0 ? "CHALLENGED_RESOLVED" : "CONFIRMED_UNCHALLENGED";
  const synthesisAction = synthesis?.detail?.action ?? synthesis?.action ?? "WAIT";
  const action = unresolvedMaterial > 0 ? "WAIT" : synthesisAction;
  return {
    version: RED_TEAM_VERSION,
    phase: "PHASE2_REVIEW",
    verdict,
    conflicts,
    conflictTypes: [...new Set(conflicts.map((row) => row.type))],
    unresolvedMaterial,
    action,
    direction: synthesis?.detail?.direction ?? null,
    neverInvertsDirection: true,
    phase1Hash: phase1.frozenHash,
    reviewedAt,
    note: unresolvedMaterial > 0 ? "Conflito material nao resolvido: WAIT (nunca inverte a direcao)." : "Tese revisada; conflitos resolvidos com evidencia dos especialistas.",
  };
}
