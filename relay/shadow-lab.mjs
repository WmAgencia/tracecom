/**
 * PROSPECTIVE SHADOW LAB — instrumentacao prospectiva de pesquisa. NUNCA controla execucao.
 *
 * Regras inviolaveis deste modulo:
 *  1. Nenhuma funcao daqui e consultada para decidir direcao, executar, vetar, alterar stake ou
 *     mover thresholds. Todo veredito e ADVISORY/SHADOW (ver SHADOW_POLICY.controlsExecution=false).
 *  2. O snapshot T0 e point-in-time e imutavel: somente dados existentes ate a decisao entram em `t0`.
 *     A janela POST (diagnostico) e persistida separada e marcada `diagnosticOnly`, `feedableToT0:false`.
 *  3. Contrafactual nunca se mistura com P&L real: `settlementBasis` distingue BROKER_EXECUTED de
 *     CAUSAL_COUNTERFACTUAL, e o dashboard separa BROKER_EXECUTED / COUNTERFACTUAL / HISTORICAL / PROSPECTIVE.
 *  4. Regras descritivas (rule-based). Sem pesos arbitrarios escondidos: cada estado/veredito carrega
 *     os codigos de motivo que o produziram.
 *
 * D1/D2 (defeitos documentados no Quality Gate / C_STABILITY) sao corrigidos SOMENTE em sombra
 * (GATE_CORRECTED_SHADOW). O gate de producao (GATE_CURRENT) permanece byte a byte o de trade-quality.mjs.
 */
import { featuresFromSnapshot, scoreTradeQuality } from "./trade-quality.mjs";

export const SHADOW_LAB_VERSION = "prospective-shadow-lab-v1";
export const PROSPECTIVE_CHECKPOINT_N = 30;

export const DECISION_SOURCES = ["G2_AUTO", "MANUAL_UI", "TEST", "INFRA_PROBE", "SHADOW"];
export const GATE_CURRENT = "GATE_CURRENT";
export const GATE_CORRECTED_SHADOW = "GATE_CORRECTED_SHADOW";
export const SETTLEMENT_BASES = ["BROKER_EXECUTED", "CAUSAL_COUNTERFACTUAL"];
export const PROVENANCES = ["PROSPECTIVE", "HISTORICAL"];

/** Politica global: nenhuma saida deste modulo pode controlar execucao. Testavel. */
export const SHADOW_POLICY = Object.freeze({
  version: SHADOW_LAB_VERSION,
  controlsExecution: false,
  controlsDirection: false,
  controlsStake: false,
  controlsThresholds: false,
  gatePolicies: Object.freeze({ [GATE_CURRENT]: "PRODUCTION", [GATE_CORRECTED_SHADOW]: "SHADOW_ONLY" }),
  note: "Correcoes que mudariam QUAIS trades executam permanecem SHADOW; producao nao le este modulo.",
});

/** Filtros v1 congelados (H1/H2/H3/degradacao) — hipoteses, NAO regras de producao. */
export const SHADOW_FILTERS_V1 = Object.freeze({
  version: "shadow-filters-v1",
  locationRejectTags: Object.freeze(["LOCATION_MID"]),
  displacementAdverseATRThreshold: 0.35,
  hardCriticRejects: true,
  degradationRejectStates: Object.freeze(["DEGRADED", "SEVERELY_DEGRADED"]),
  note: "Congelado antes da coleta prospectiva; nao e afirmacao de que o filtro e melhor.",
});

export const LOCATION_TAGS = ["LOCATION_MID", "LOCATION_LOWER_HALF", "LOCATION_UPPER_HALF", "LOCATION_EDGE", "LOCATION_OVEREXTENDED"];
export const DISPLACEMENT_BUCKETS = ["BUCKET_FAVORABLE_OR_ZERO", "BUCKET_0_015", "BUCKET_015_025", "BUCKET_025_035", "BUCKET_035_050", "BUCKET_GT_050"];
export const CONTRADICTION_SEVERITIES = ["NONE", "SOFT", "HARD", "MULTIPLE"];
export const DEGRADATION_STATES = ["STABLE", "IMPROVED", "DEGRADED", "SEVERELY_DEGRADED"];
export const POST_WINDOW_OFFSETS_SECONDS = [5, 10, 15, 20, 30, 45, 60];
export const LOCATION_RULE = "OVEREXTENDED > EDGE > MID > HALF; thresholds edge=0.10, mid=0.15, overextendedATR=2.5";
export const CRITIC_SEVERITY_RULE = "HARD>=2 => MULTIPLE; HARD=1 => HARD; apenas SOFT => SOFT; nenhuma => NONE";
export const DEGRADATION_RULE = ">=1 SEVERE ou >=2 DEGRADED => SEVERELY_DEGRADED; 1 DEGRADED => DEGRADED; 0 DEGRADED com >=1 IMPROVED => IMPROVED; caso contrario STABLE";

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const round = (value, digits = 4) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null);

/* ------------------------------------------------------------------ decisionSource (D3) */

const SOURCE_MAP = new Map([
  ["AUTO_DECISION", "G2_AUTO"],
  ["ui:smoke", "MANUAL_UI"],
  ["MANUAL", "MANUAL_UI"],
  ["MANUAL_UI", "MANUAL_UI"],
  ["UI", "MANUAL_UI"],
  ["API", "MANUAL_UI"],
  ["DIAGNOSTIC_SIGNAL", "TEST"],
  ["SYNTHETIC_TEST", "TEST"],
  ["TEST", "TEST"],
  ["INFRA_PROBE", "INFRA_PROBE"],
  ["SHADOW", "SHADOW"],
]);

/**
 * D3: separa a origem da ordem da decisao do Brain. Uma ordem manual NUNCA vira `traderDecision`.
 * `source` desconhecido/vazio cai em MANUAL_UI (ordem explicita fora do fluxo G2), nunca em G2_AUTO.
 */
export function decisionSourceOf({ source = null, setup = null, infraProbe = false, decisionSource = null } = {}) {
  if (decisionSource && DECISION_SOURCES.includes(decisionSource)) return decisionSource;
  if (infraProbe === true || setup === "INFRA_PROBE" || source === "INFRA_PROBE") return "INFRA_PROBE";
  if (setup === "SYNTHETIC_TEST") return "TEST";
  const mapped = SOURCE_MAP.get(String(source ?? ""));
  if (mapped) return mapped;
  return "MANUAL_UI";
}

/* ------------------------------------------------------------------ marketKey isolation */

/** NORMAL != OTC: extrai canonical/marketType da chave composta (nunca agrega por canonical). */
export function parseMarketKey(marketKey) {
  const key = String(marketKey ?? "");
  const match = key.match(/^([A-Z0-9]+):(NORMAL|OTC)$/i);
  if (!match) return { marketKey: key || null, canonical: null, marketType: null, valid: false };
  return { marketKey: key, canonical: match[1].toUpperCase(), marketType: match[2].toUpperCase(), valid: true };
}

export function observationKey({ candidateId = null, executionId = null, tradeId = null, correlationId = null, marketKey = null, targetEntryAt = null } = {}) {
  if (candidateId) return `obs_${candidateId}`;
  if (executionId) return `obs_${executionId}`;
  if (tradeId) return `obs_${tradeId}`;
  if (correlationId && marketKey) return `obs_${marketKey.replace(":", "_")}_${correlationId}_${targetEntryAt ?? "na"}`;
  return `obs_${marketKey ?? "UNKNOWN"}_${targetEntryAt ?? Date.now()}`;
}

/* ------------------------------------------------------------------ H1: location */

function zoneOf(position) {
  if (!Number.isFinite(position)) return null;
  if (position > 0.8) return "AT_TOP";
  if (position < 0.2) return "AT_BOTTOM";
  if (position > 0.55) return "UPPER_HALF";
  if (position < 0.45) return "LOWER_HALF";
  return "MID";
}

/**
 * H1 SHADOW: classifica a localizacao Donchian. Nao bloqueia; nao declara qual zona e melhor.
 * Ordem de precedencia documentada em LOCATION_RULE.
 */
export function classifyLocation({ donchianPosition = null, distanceToUpperATR = null, distanceToLowerATR = null, direction = null, channelHigh = null, channelLow = null, price = null } = {}) {
  const pos = num(donchianPosition);
  const distUpper = num(distanceToUpperATR);
  const distLower = num(distanceToLowerATR);
  const dir = direction === "BUY" || direction === "SELL" ? direction : null;
  const againstATR = dir === "BUY" ? distLower : dir === "SELL" ? distUpper : null;
  const withATR = dir === "BUY" ? distUpper : dir === "SELL" ? distLower : null;
  let tag = null;
  let rule = null;
  if (pos === null) { tag = null; rule = "NO_DONCHIAN_POSITION"; }
  else if (againstATR !== null && againstATR > 2.5) { tag = "LOCATION_OVEREXTENDED"; rule = "AGAINST_ATR_GT_2.5"; }
  else if (pos <= 0.1 || pos >= 0.9) { tag = "LOCATION_EDGE"; rule = "POSITION_LE_0.10_OR_GE_0.90"; }
  else if (Math.abs(pos - 0.5) <= 0.15) { tag = "LOCATION_MID"; rule = "ABS_POSITION_MINUS_0.5_LE_0.15"; }
  else { tag = pos < 0.5 ? "LOCATION_LOWER_HALF" : "LOCATION_UPPER_HALF"; rule = pos < 0.5 ? "POSITION_LT_0.5" : "POSITION_GE_0.5"; }
  return {
    tag, rule, direction: dir,
    donchianPosition: pos, zone: zoneOf(pos),
    distanceToUpperATR: distUpper, distanceToLowerATR: distLower,
    againstATR, withATR, channelHigh: num(channelHigh), channelLow: num(channelLow), price: num(price),
    thresholds: { edge: 0.1, mid: 0.15, overextendedATR: 2.5 },
    note: "SHADOW_ONLY; nao bloqueia e nao assume qual localizacao e melhor.",
  };
}

/** Localizacao da entrada real: reconstroi a posicao Donchian no preco de entrada. */
export function classifyEntryLocation({ entryPrice = null, channelHigh = null, channelLow = null, atr = null, direction = null, distanceToUpperATR = null, distanceToLowerATR = null } = {}) {
  const price = num(entryPrice);
  let high = num(channelHigh);
  let low = num(channelLow);
  const atrValue = num(atr);
  if ((high === null || low === null) && price !== null && atrValue !== null && atrValue > 0) {
    const upper = num(distanceToUpperATR);
    const lower = num(distanceToLowerATR);
    if (upper !== null && lower !== null) { high = price + upper * atrValue; low = price - lower * atrValue; }
  }
  const pos = price !== null && high !== null && low !== null && high > low ? round((price - low) / (high - low)) : null;
  const loc = classifyLocation({ donchianPosition: pos, distanceToUpperATR, distanceToLowerATR, direction, channelHigh: high, channelLow: low, price });
  return { ...loc, entryPrice: price, positionSource: pos === null ? "UNRECONSTRUCTIBLE" : "RECONSTRUCTED_FROM_CHANNEL" };
}

/* ------------------------------------------------------------------ H2: displacement */

/** Deslocamento ajustado a direcao: positivo = adverso (preco andou contra a tese). */
export function directionAdjustedDisplacement({ fromPrice = null, toPrice = null, direction = null } = {}) {
  const from = num(fromPrice);
  const to = num(toPrice);
  if (from === null || to === null || (direction !== "BUY" && direction !== "SELL")) return null;
  return direction === "BUY" ? round(to - from) : round(from - to);
}

export function classifyDisplacementBucket(atrValue) {
  const value = num(atrValue);
  if (value === null) return null;
  if (value <= 0) return "BUCKET_FAVORABLE_OR_ZERO";
  if (value <= 0.15) return "BUCKET_0_015";
  if (value <= 0.25) return "BUCKET_015_025";
  if (value <= 0.35) return "BUCKET_025_035";
  if (value <= 0.5) return "BUCKET_035_050";
  return "BUCKET_GT_050";
}

/** H2 SHADOW: candidato -> JIT -> entrada real, em ATR, direction-adjusted (positivo = adverso). */
export function buildDisplacementShadow({ candidatePrice = null, jitPrice = null, actualEntryPrice = null, atr = null, direction = null } = {}) {
  const atrValue = num(atr);
  const divide = (delta) => (delta !== null && atrValue !== null && atrValue > 0 ? round(delta / atrValue) : null);
  const candidateToJit = directionAdjustedDisplacement({ fromPrice: candidatePrice, toPrice: jitPrice, direction });
  const jitToEntry = directionAdjustedDisplacement({ fromPrice: jitPrice, toPrice: actualEntryPrice, direction });
  const candidateToEntry = directionAdjustedDisplacement({ fromPrice: candidatePrice, toPrice: actualEntryPrice, direction });
  return {
    candidatePrice: num(candidatePrice), jitPrice: num(jitPrice), actualEntryPrice: num(actualEntryPrice), atr: atrValue, direction,
    candidateToJitATR: divide(candidateToJit), jitToEntryATR: divide(jitToEntry), candidateToEntryATR: divide(candidateToEntry),
    bucket: classifyDisplacementBucket(divide(candidateToEntry)),
    signConvention: "POSITIVE=ADVERSE (direction-adjusted)",
    buckets: DISPLACEMENT_BUCKETS,
    note: "SHADOW_ONLY; >0.35 ATR NAO e veto de producao.",
  };
}

/* ------------------------------------------------------------------ H3: critic contradictions */

/**
 * Mapeamento concreto codigo->categoria documentado em docs/research/prospective-shadow-lab.md.
 * Codigos desconhecidos caem em SOFT (conservador: nunca aumentam um veto sombra por engano).
 */
export const CRITIC_CODE_SEVERITY = Object.freeze({
  aceleracao_contra_a_entrada: "HARD",
  preco_esticado_contra_a_entrada: "HARD",
  conflito_di_contra_entrada: "HARD",
  rompimento_sem_corpo_dominante: "HARD",
  critic_nao_ve_trigger_independente: "HARD",
  rsi_extremo_contra_entrada: "HARD",
  entrada_excessivamente_estendida: "HARD",
  compra_no_topo_do_range: "HARD",
  venda_no_fundo_do_range: "HARD",
  regime_chaotic: "HARD",
  regime_unclear: "HARD",
  forca_caindo: "HARD",
  forca_cainda: "HARD",
  dados_nao_frescos: "HARD",
  features_indisponiveis: "HARD",
  rsi_exausto_mesmo_a_favor: "SOFT",
  rsi_sem_momentum_para_compra: "SOFT",
  rsi_sem_momentum_para_venda: "SOFT",
  adx_fraco_para_setup: "SOFT",
  volatilidade_spike_na_entrada: "SOFT",
  rompimento_ja_percorrido: "SOFT",
  critic_ve_setup_que_trader_ignorou: "SOFT",
  rejeicao_no_candle_de_gatilho: "SOFT",
  rsi_extremo_contra_o_pullback: "SOFT",
  noticia_alto_impacto_vigente: "SOFT",
  noticia_alto_impacto: "SOFT",
});

export function criticCodeSeverity(code) {
  const value = String(code ?? "");
  if (!value) return "SOFT";
  if (CRITIC_CODE_SEVERITY[value]) return CRITIC_CODE_SEVERITY[value];
  if (value.startsWith("checklist_falhou:")) return "SOFT";
  return "SOFT";
}

/** H3 SHADOW: NONE/SOFT/HARD/MULTIPLE + decisao contrafactual (nunca aplicada em producao). */
export function classifyContradictionSeverity({ contradictions = [], riskFlags = [], verdict = null } = {}) {
  const codes = [...new Set([...(Array.isArray(contradictions) ? contradictions : []), ...(Array.isArray(riskFlags) ? riskFlags : [])].map((code) => String(code)).filter(Boolean))];
  const hardCodes = codes.filter((code) => criticCodeSeverity(code) === "HARD");
  const softCodes = codes.filter((code) => criticCodeSeverity(code) !== "HARD");
  const severity = codes.length === 0
    ? "NONE"
    : (hardCodes.length >= 2 || (hardCodes.length >= 1 && codes.length >= 3)) ? "MULTIPLE"
      : hardCodes.length === 1 ? "HARD" : "SOFT";
  const wouldVetoIfHardContradiction = severity === "HARD" || severity === "MULTIPLE";
  return {
    severity, verdict: verdict ?? null, contradictionCodes: codes, contradictionCount: codes.length,
    hardCodes, softCodes, hardCount: hardCodes.length, softCount: softCodes.length,
    wouldVetoIfHardContradiction,
    rule: CRITIC_SEVERITY_RULE,
    counterfactual: "WOULD_VETO_IF_HARD_CONTRADICTION",
    note: "Contrafactual SHADOW; nao controla execucao, nao altera o Critic.",
  };
}

/* ------------------------------------------------------------------ D1/D2: gate current vs corrected */

/**
 * GATE_CORRECTED_SHADOW: corrige SOMENTE os paths/semantica observados (D1) e mantem a rubrica
 * identica (reusa scoreTradeQuality). Nunca e chamado pelo fluxo de execucao.
 */
export function correctedFeaturesFromSnapshot(snapshot = {}, { direction = null, payout = null, timing = {} } = {}) {
  const base = featuresFromSnapshot(snapshot, { direction, payout, timing });
  const momentum = snapshot?.momentum ?? snapshot?.trader?.momentum ?? {};
  const structureVelocity = snapshot?.structure?.velocity ?? {};
  const knowledgeIds = snapshot?.knowledgeContextIds ?? snapshot?.knowledge?.ids ?? [];
  return {
    ...base,
    velocity: num(momentum.velocity ?? structureVelocity.velocity),
    acceleration: num(momentum.acceleration ?? structureVelocity.acceleration),
    knowledgeContextIds: Array.isArray(knowledgeIds) ? knowledgeIds : [],
  };
}

export function scoreGateCorrectedShadow(snapshot = {}, options = {}) {
  const corrected = correctedFeaturesFromSnapshot(snapshot, options);
  const result = scoreTradeQuality(corrected);
  return {
    gate: GATE_CORRECTED_SHADOW, policy: SHADOW_POLICY.gatePolicies[GATE_CORRECTED_SHADOW],
    score: result.score, max: result.max, checks: result.checks,
    correctedPaths: ["structure.velocity -> momentum.velocity", "structure.velocity -> momentum.acceleration", "knowledgeContextIds <- snapshot"],
    note: "SHADOW_ONLY: nao controla execucao.",
  };
}

/** D2 SHADOW: estabilidade corrigida ignora mudanca apenas de preco/indicador; so acao/estrutura/regime. */
export function correctedStabilityShadow({ candidateSnapshot = {}, jitSnapshot = {}, directionChanges = 0 } = {}) {
  const action = (snapshot) => snapshot?.action ?? null;
  const structureLabel = (snapshot) => snapshot?.structure?.label ?? snapshot?.trader?.structure?.label ?? null;
  const regime = (snapshot) => snapshot?.regime ?? null;
  const details = {
    candidateAction: action(candidateSnapshot), jitAction: action(jitSnapshot),
    candidateStructure: structureLabel(candidateSnapshot), jitStructure: structureLabel(jitSnapshot),
    candidateRegime: regime(candidateSnapshot), jitRegime: regime(jitSnapshot),
    directionChanges: num(directionChanges) ?? 0,
  };
  const actionChanged = details.jitAction !== null && details.candidateAction !== null && details.jitAction !== details.candidateAction;
  const structureChanged = details.jitStructure !== null && details.candidateStructure !== null && details.jitStructure !== details.candidateStructure;
  const regimeChanged = details.jitRegime !== null && details.candidateRegime !== null && details.jitRegime !== details.candidateRegime;
  const unstable = details.directionChanges >= 2 || actionChanged || structureChanged || regimeChanged;
  const reason = details.directionChanges >= 2 ? "DIRECTION_FLIPPED_TWICE" : actionChanged ? "ACTION_CHANGED" : structureChanged ? "STRUCTURE_CHANGED" : regimeChanged ? "REGIME_CHANGED" : null;
  return { decision: unstable ? "ABSTAIN" : "ACCEPT", reason, details, rule: "C_STABILITY_CORRECTED: acao/estrutura/regime; mudanca apenas de preco NAO conta", note: "SHADOW_ONLY (D2)." };
}

/** Lado a lado GATE_CURRENT vs GATE_CORRECTED_SHADOW (scores/checks); nunca alimenta decisao. */
export function compareGateVersions({ current = null, corrected = null, threshold = null } = {}) {
  const currentScore = num(current?.score);
  const correctedScore = num(corrected?.score);
  const limit = num(threshold);
  const currentChecks = Array.isArray(current?.checks) ? current.checks : [];
  const correctedChecks = Array.isArray(corrected?.checks) ? corrected.checks : [];
  const correctedById = new Map(correctedChecks.map((check) => [check.id, check]));
  const checksDelta = currentChecks.map((check) => {
    const other = correctedById.get(check.id);
    return { id: check.id, current: check.ok === true, corrected: other?.ok === true, points: check.points ?? null, max: check.max ?? null };
  });
  return {
    version: "gate-comparison-v1",
    currentGate: GATE_CURRENT, correctedGate: GATE_CORRECTED_SHADOW,
    currentScore, correctedShadowScore: correctedScore,
    scoreDelta: currentScore !== null && correctedScore !== null ? round(correctedScore - currentScore) : null,
    currentDecision: currentScore !== null && limit !== null ? (currentScore >= limit ? "ACCEPT" : "REJECT") : null,
    correctedShadowDecision: correctedScore !== null && limit !== null ? (correctedScore >= limit ? "ACCEPT" : "REJECT") : null,
    checksDelta, changedChecks: checksDelta.filter((check) => check.current !== check.corrected),
    controlPolicy: "GATE_CORRECTED_SHADOW_NEVER_CONTROLS_EXECUTION",
    note: "Decisao aqui e a decisao de SCORE do gate; a execucao real e registrada em currentExecution.",
  };
}

/* ------------------------------------------------------------------ T0 snapshot imutavel (D4) */

const T0_FIELD_WHITELIST = [
  "candidateAt", "decisionAt", "jitAt", "sendAt", "entryAt", "targetEntryAt", "targetExpiryAt",
  "marketKey", "marketType", "activeId", "agentId", "direction",
  "regime", "setup", "trigger", "structure", "location", "momentum", "strength", "volatility", "microstructure",
  "trajectory", "freshness", "features", "trader", "critic", "consensus", "processLog",
  "knowledgeContextIds", "knowledgeVersion", "knowledgeUsed", "payout",
  "qualityScore", "qualityChecks", "entryLocation", "displacement", "jitRevalidation",
];

const FORBIDDEN_KEY_PATTERN = /(result|settlement|outcome|pnl|profit|postwindow|post_window|future|expiryclose|expiry_close|broker|causal)/i;

function sanitizePointInTime(value, depth = 0) {
  if (depth > 8) return null;
  if (Array.isArray(value)) return value.map((entry) => sanitizePointInTime(entry, depth + 1)).filter((entry) => entry !== null && entry !== undefined);
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return value;
  const clean = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) continue;
    const sanitized = sanitizePointInTime(entry, depth + 1);
    if (sanitized !== undefined) clean[key] = sanitized;
  }
  return clean;
}

function deepFreeze(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  for (const entry of Object.values(value)) deepFreeze(entry, depth + 1);
  return Object.freeze(value);
}

/**
 * D4: snapshot T0 point-in-time, whitelisted e sanitizado (nunca aceita chaves de resultado/futuro).
 * Imutavel: o objeto retornado e congelado em profundidade.
 */
export function buildT0Snapshot({
  marketKey = null, marketType = null, activeId = null, agentId = null, direction = null,
  candidateAt = null, decisionAt = null, jitAt = null, sendAt = null, entryAt = null, targetEntryAt = null, targetExpiryAt = null,
  payout = null, snapshot = {}, quality = null, location = null, displacement = null, revalidation = null,
} = {}) {
  const raw = {
    candidateAt, decisionAt, jitAt, sendAt, entryAt, targetEntryAt, targetExpiryAt,
    marketKey, marketType, activeId, agentId, direction, payout,
    regime: snapshot?.regime ?? null, setup: snapshot?.setup ?? null, trigger: snapshot?.trigger ?? null,
    structure: snapshot?.structure ?? null, location: snapshot?.location ?? null, momentum: snapshot?.momentum ?? null,
    strength: snapshot?.strength ?? null, volatility: snapshot?.volatility ?? null, microstructure: snapshot?.microstructure ?? null,
    trajectory: snapshot?.trajectory ?? null, freshness: snapshot?.freshness ?? null, features: snapshot?.features ?? null,
    trader: snapshot?.trader
      ? { action: snapshot.trader.action ?? null, setup: snapshot.trader.setup ?? null, trigger: snapshot.trader.trigger ?? null, analysisConfidence: snapshot.trader.analysisConfidence ?? null, supportingEvidence: snapshot.trader.supportingEvidence ?? [], contradictingEvidence: snapshot.trader.contradictingEvidence ?? [], primaryRisk: snapshot.trader.primaryRisk ?? null }
      : (snapshot?.action ? { action: snapshot.action, setup: snapshot.setup ?? null, trigger: snapshot.trigger ?? null } : null),
    critic: snapshot?.critic ?? null,
    consensus: snapshot?.consensus ?? null,
    processLog: snapshot?.processLog ?? null,
    knowledgeContextIds: snapshot?.knowledgeContextIds ?? snapshot?.knowledge?.ids ?? [],
    knowledgeVersion: snapshot?.knowledgeVersion ?? snapshot?.knowledge?.version ?? null,
    knowledgeUsed: snapshot?.knowledgeContextUsed ?? (Array.isArray(snapshot?.knowledgeContextIds) ? snapshot.knowledgeContextIds.length > 0 : null),
    qualityScore: quality?.score ?? null, qualityChecks: quality?.checks ?? null,
    entryLocation: location ?? null, displacement: displacement ?? null, jitRevalidation: revalidation ?? null,
  };
  const whitelisted = {};
  for (const key of T0_FIELD_WHITELIST) if (raw[key] !== undefined) whitelisted[key] = raw[key];
  return deepFreeze(sanitizePointInTime(whitelisted));
}

/**
 * Leakage guard: encontra referencias temporais posteriores a `asOfMs` em um payload T0.
 * Considera chaves conhecidas de tempo (ms epoch) recursivamente.
 */
export function findFutureReferences(value, asOfMs, path = "t0", found = [], depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return found;
  if (Array.isArray(value)) { value.forEach((entry, index) => findFutureReferences(entry, asOfMs, `${path}[${index}]`, found, depth + 1)); return found; }
  const TIME_KEYS = new Set(["at", "capturedAt", "computedAt", "decisionAt", "candidateAt", "jitAt", "sendAt", "entryAt", "targetEntryAt", "targetExpiryAt", "bucketStart", "bucketEnd", "serverTimestamp"]);
  for (const [key, entry] of Object.entries(value)) {
    if (TIME_KEYS.has(key) && Number.isFinite(Number(entry)) && Number(entry) > Number(asOfMs)) found.push(`${path}.${key}=${entry}>${asOfMs}`);
    findFutureReferences(entry, asOfMs, `${path}.${key}`, found, depth + 1);
  }
  return found;
}

/* ------------------------------------------------------------------ D5: PRE/POST market window */

function compactCandle(candle, offsetSeconds = null) {
  if (!candle) return null;
  return {
    bucketStart: candle.bucketStart ?? null, offsetSeconds,
    open: num(candle.open), high: num(candle.high), low: num(candle.low), close: num(candle.close),
    marketKey: candle.marketKey ?? null, source: "CANDLE_5S",
  };
}

/** PRE: ultimos candles fechados antes de `atMs` (point-in-time). */
export function extractPreWindow(candles = [], atMs, count = 12) {
  return (Array.isArray(candles) ? candles : [])
    .filter((candle) => Number.isFinite(Number(candle?.bucketStart)) && Number(candle.bucketStart) <= Number(atMs))
    .slice(-Math.max(1, Number(count) || 12))
    .map((candle) => compactCandle(candle));
}

/**
 * POST: candles em T+offsets (5..60s) ou no expiry. NUNCA realimentavel em features T0.
 * Um candle so e aceito para um offset se `bucketStart >= alvo` e `actualSeconds <= offset + 10s`;
 * offsets que caem no mesmo candle sao deduplicados (mantem o offset alvo mais proximo).
 */
export function buildPostWindow({ entryAtMs = null, expiryAtMs = null, candles = [], offsets = POST_WINDOW_OFFSETS_SECONDS } = {}) {
  const entry = Number(entryAtMs);
  const list = Array.isArray(candles) ? candles : [];
  const offsetsOut = [];
  const used = new Set();
  if (Number.isFinite(entry)) {
    for (const offset of offsets) {
      const target = entry + offset * 1000;
      const candle = list.find((row) => Number.isFinite(Number(row?.bucketStart)) && Number(row.bucketStart) >= target);
      if (!candle) continue;
      const actualSeconds = round((Number(candle.bucketStart) - entry) / 1000, 3);
      if (actualSeconds === null || actualSeconds > offset + 10) continue;
      if (used.has(Number(candle.bucketStart))) continue;
      used.add(Number(candle.bucketStart));
      offsetsOut.push({ ...compactCandle(candle, actualSeconds), targetSeconds: offset });
    }
  }
  const expiry = Number(expiryAtMs);
  let expiryCandle = null;
  if (Number.isFinite(expiry)) {
    const found = list.filter((row) => Number.isFinite(Number(row?.bucketStart)) && Number(row.bucketStart) <= expiry).pop() ?? null;
    if (found && !used.has(Number(found.bucketStart))) expiryCandle = compactCandle(found, round((Number(found.bucketStart) - entry) / 1000, 3));
  }
  return {
    version: "market-window-post-v1",
    diagnosticOnly: true, feedableToT0: false, usedInDecision: false,
    entryAt: Number.isFinite(entry) ? entry : null, expiryAt: Number.isFinite(expiry) ? expiry : null,
    offsets: offsetsOut, expiryCandle,
    toleranceSeconds: 10,
    note: "DIAGNOSTIC ONLY — nunca realimenta features/decisao T0 (D5).",
  };
}

/* ------------------------------------------------------------------ degradation observer */

export function degradationInputsFromSnapshot({ snapshot = {}, direction = null, freshness = null, displacementATR = null, criticSeverity = null, locationTag = null } = {}) {
  const loc = snapshot?.location ?? snapshot?.trader?.location ?? {};
  const mom = snapshot?.momentum ?? snapshot?.trader?.momentum ?? {};
  const str = snapshot?.strength ?? snapshot?.trader?.strength ?? {};
  const vol = snapshot?.volatility ?? snapshot?.trader?.volatility ?? {};
  const micro = snapshot?.microstructure ?? snapshot?.trader?.microstructure ?? {};
  const structure = snapshot?.structure ?? snapshot?.trader?.structure ?? {};
  return {
    direction: direction ?? snapshot?.action ?? null,
    donchianPosition: num(loc.donchianPosition), distanceToUpperATR: num(loc.distanceToUpperATR), distanceToLowerATR: num(loc.distanceToLowerATR),
    channelHigh: num(loc.channelHigh), channelLow: num(loc.channelLow),
    rsi: num(mom.rsi14), velocity: num(mom.velocity), acceleration: num(mom.acceleration),
    adx: num(str.adx14), plusDI: num(str.plusDI), minusDI: num(str.minusDI),
    atr: num(vol.atr), atrRatio: num(vol.atrRatio),
    streak: num(micro.streak), bodyRatio: num(micro.bodyRatio), upperWick: num(micro.upperWick), lowerWick: num(micro.lowerWick),
    structureLabel: structure?.label ?? null, regime: snapshot?.regime ?? null,
    fresh: snapshot?.freshness?.fresh ?? freshness?.fresh ?? null,
    tickAgeMs: num(snapshot?.freshness?.tickAgeMs ?? freshness?.tickAgeMs),
    displacementATR: num(displacementATR), criticSeverity: criticSeverity ?? null, locationTag: locationTag ?? null,
  };
}

function rsiExtreme(direction, rsi) {
  if (rsi === null) return false;
  return direction === "BUY" ? rsi >= 70 : direction === "SELL" ? rsi <= 30 : false;
}

function diAgainst(direction, plusDI, minusDI) {
  if (plusDI === null || minusDI === null) return false;
  return direction === "BUY" ? minusDI > plusDI : direction === "SELL" ? plusDI > minusDI : false;
}

function structureAgrees(direction, label) {
  if (!label) return false;
  return direction === "BUY" ? ["UP", "HH_HL"].includes(label) : direction === "SELL" ? ["DOWN", "LH_LL"].includes(label) : false;
}

function rejectionWick(direction, wanted) {
  if (direction === "BUY") return wanted.upperWick !== null && wanted.upperWick > 0.55;
  if (direction === "SELL") return wanted.lowerWick !== null && wanted.lowerWick > 0.55;
  return false;
}

/**
 * DEGRADATION OBSERVER (experimento principal, SHADOW): compara candidato T0 vs JIT.
 * Nao preve direcao, nao executa, nao veta. Cada motivo e descritivo e rastreavel.
 */
export function observeDegradation({ candidate = {}, jit = {} } = {}) {
  const reasons = [];
  const add = (impact, code, dimension, detail) => reasons.push({ impact, code, dimension, detail });
  const direction = jit.direction ?? candidate.direction ?? null;

  if (jit.displacementATR !== null) {
    if (jit.displacementATR > 0.5) add("SEVERE", "DISPLACEMENT_ADVERSE_GT_050", "displacement", jit.displacementATR);
    else if (jit.displacementATR > 0.35) add("DEGRADED", "DISPLACEMENT_ADVERSE_GT_035", "displacement", jit.displacementATR);
  }
  const hardJit = jit.criticSeverity === "HARD" || jit.criticSeverity === "MULTIPLE";
  const hardCand = candidate.criticSeverity === "HARD" || candidate.criticSeverity === "MULTIPLE";
  if (hardJit && !hardCand) add("SEVERE", "CRITIC_HARD_CONTRADICTION_APPEARED", "critic", { candidate: candidate.criticSeverity, jit: jit.criticSeverity });
  else if (jit.criticSeverity === "SOFT" && candidate.criticSeverity === "NONE") add("DEGRADED", "CRITIC_SOFT_CONTRADICTION_APPEARED", "critic", { candidate: candidate.criticSeverity, jit: jit.criticSeverity });
  else if (candidate.criticSeverity !== "NONE" && candidate.criticSeverity !== null && jit.criticSeverity === "NONE") add("IMPROVED", "CRITIC_CLEANED", "critic", { candidate: candidate.criticSeverity, jit: jit.criticSeverity });

  const jitStale = jit.fresh === false || (jit.tickAgeMs !== null && jit.tickAgeMs > 15_000);
  const candStale = candidate.fresh === false || (candidate.tickAgeMs !== null && candidate.tickAgeMs > 15_000);
  if (jitStale) add("SEVERE", "FEED_STALE_AT_JIT", "freshness", { fresh: jit.fresh, tickAgeMs: jit.tickAgeMs });
  else if (candStale && jit.fresh === true) add("IMPROVED", "FEED_FRESHENED", "freshness", { candidate: candidate.tickAgeMs, jit: jit.tickAgeMs });

  const candMid = candidate.donchianPosition !== null && Math.abs(candidate.donchianPosition - 0.5) <= 0.15;
  const jitMid = jit.donchianPosition !== null && Math.abs(jit.donchianPosition - 0.5) <= 0.15;
  if (jitMid && !candMid) add("DEGRADED", "LOCATION_MOVED_TOWARD_MID", "location", { candidate: candidate.donchianPosition, jit: jit.donchianPosition });
  else if (!jitMid && candMid) add("IMPROVED", "LOCATION_AWAY_FROM_MID", "location", { candidate: candidate.donchianPosition, jit: jit.donchianPosition });
  if (jit.locationTag === "LOCATION_OVEREXTENDED" && candidate.locationTag !== "LOCATION_OVEREXTENDED") add("DEGRADED", "LOCATION_OVEREXTENDED_APPEARED", "location", { candidate: candidate.locationTag, jit: jit.locationTag });

  if (rsiExtreme(direction, jit.rsi) && !rsiExtreme(direction, candidate.rsi)) add("DEGRADED", "RSI_EXTREME_APPEARED", "rsi", { candidate: candidate.rsi, jit: jit.rsi });
  else if (rsiExtreme(direction, candidate.rsi) && !rsiExtreme(direction, jit.rsi)) add("IMPROVED", "RSI_EXTREME_CLEARED", "rsi", { candidate: candidate.rsi, jit: jit.rsi });

  if (diAgainst(direction, jit.plusDI, jit.minusDI) && !diAgainst(direction, candidate.plusDI, candidate.minusDI)) add("DEGRADED", "DI_FLIPPED_AGAINST", "di", { candidate: [candidate.plusDI, candidate.minusDI], jit: [jit.plusDI, jit.minusDI] });
  else if (!diAgainst(direction, jit.plusDI, jit.minusDI) && diAgainst(direction, candidate.plusDI, candidate.minusDI)) add("IMPROVED", "DI_ALIGNED_APPEARED", "di", { candidate: [candidate.plusDI, candidate.minusDI], jit: [jit.plusDI, jit.minusDI] });

  if (candidate.adx !== null && jit.adx !== null) {
    if (candidate.adx - jit.adx >= 5) add("DEGRADED", "ADX_DROPPED_GE_5", "adx", { candidate: candidate.adx, jit: jit.adx });
    else if (jit.adx - candidate.adx >= 5) add("IMPROVED", "ADX_IMPROVED_GE_5", "adx", { candidate: candidate.adx, jit: jit.adx });
  }
  if (candidate.atrRatio !== null && jit.atrRatio !== null && jit.atrRatio >= 2.0 && jit.atrRatio - candidate.atrRatio >= 0.5) add("DEGRADED", "ATR_RATIO_RISING", "atr", { candidate: candidate.atrRatio, jit: jit.atrRatio });

  if (rejectionWick(direction, jit) && !rejectionWick(direction, candidate)) add("DEGRADED", "WICK_REJECTION_APPEARED", "microstructure", { candidate: [candidate.upperWick, candidate.lowerWick], jit: [jit.upperWick, jit.lowerWick] });
  if (candidate.structureLabel !== null && jit.structureLabel !== null && structureAgrees(direction, candidate.structureLabel) && !structureAgrees(direction, jit.structureLabel)) add("DEGRADED", "STRUCTURE_FLIPPED_AGAINST", "structure", { candidate: candidate.structureLabel, jit: jit.structureLabel });

  const severe = reasons.filter((reason) => reason.impact === "SEVERE");
  const degraded = reasons.filter((reason) => reason.impact === "DEGRADED" || reason.impact === "SEVERE");
  const improved = reasons.filter((reason) => reason.impact === "IMPROVED");
  const state = severe.length > 0 || degraded.length >= 2 ? "SEVERELY_DEGRADED" : degraded.length === 1 ? "DEGRADED" : improved.length > 0 ? "IMPROVED" : "STABLE";
  return {
    version: "degradation-observer-v1",
    state, direction,
    degradationReasons: reasons.map((reason) => reason.code),
    reasons,
    counts: { severe: severe.length, degraded: degraded.length, improved: improved.length },
    rule: DEGRADATION_RULE, thresholds: { displacementAdverse: 0.35, displacementSevere: 0.5, adxDrop: 5, atrRatioRise: 0.5, feedStaleMs: 15_000, wickRejection: 0.55, locationMid: 0.15 },
    note: "Descritivo/SHADOW; nunca prevê direção, nunca veta, nunca executa.",
  };
}

/* ------------------------------------------------------------------ counterfactual shadow (H1/H2/H3/degradation + gate corrigido) */

export function buildCounterfactualShadow({ location = null, displacement = null, critic = null, degradation = null, gateComparison = null, threshold = null } = {}) {
  const locationTag = location?.entry?.tag ?? location?.jit?.tag ?? location?.candidate?.tag ?? null;
  const adverseATR = displacement?.candidateToEntryATR ?? displacement?.candidateToJitATR ?? null;
  const correctedScore = gateComparison?.correctedShadowScore ?? null;
  const limit = num(threshold);
  return {
    version: "counterfactual-shadow-v1",
    filtersVersion: SHADOW_FILTERS_V1.version,
    locationTag,
    displacementAdverseATR: adverseATR,
    locationFilterWouldReject: locationTag !== null && SHADOW_FILTERS_V1.locationRejectTags.includes(locationTag),
    displacementFilterWouldReject: adverseATR !== null && adverseATR > SHADOW_FILTERS_V1.displacementAdverseATRThreshold,
    hardCriticWouldReject: critic?.wouldVetoIfHardContradiction === true,
    degradationObserverState: degradation?.state ?? null,
    degradationFilterWouldReject: degradation?.state === "DEGRADED" || degradation?.state === "SEVERELY_DEGRADED",
    correctedGateWouldAccept: correctedScore !== null && limit !== null ? correctedScore >= limit : null,
    controlPolicy: "SHADOW_ONLY_NEVER_CONTROLS_EXECUTION",
    note: "CONTRAFACTUAL ≠ BROKER_EXECUTED; nunca entra no P&L do broker.",
  };
}

/** Identidade explicita usada pelo runtime: aplicar conselho shadow NAO muda a execucao. */
export function applyShadowAdvisory(currentExecution) { return currentExecution; }

/* ------------------------------------------------------------------ stats / dashboard */

export function wilsonInterval(wins, n, z = 1.96) {
  if (!Number.isFinite(wins) || !Number.isFinite(n) || n <= 0) return null;
  const p = wins / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { low: round(Math.max(0, center - half)), high: round(Math.min(1, center + half)), level: 0.95 };
}

export function normalizedOutcomePnl({ result = null, payout = null, stake = null, profit = null } = {}) {
  if (result === "WIN" || result === "LOSS" || result === "DRAW") {
    const fraction = Number(payout) > 1 ? Number(payout) / 100 : Number(payout) || 0.85;
    if (result === "WIN") return round(fraction);
    if (result === "LOSS") return -1;
    return 0;
  }
  if (Number.isFinite(Number(profit)) && Number(stake) > 0) return round(Number(profit) / Number(stake));
  return null;
}

/** Resumo estatistico de uma linha de pesquisa. N sempre reportado; nunca concluir sem N. */
export function summarizeRows(rows = [], { pickResult = (row) => row?.theoreticalResult ?? null, pickPnl = (row) => row?.theoreticalPnl ?? null, pickPayout = (row) => row?.payout ?? null } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  let wins = 0, losses = 0, draws = 0, pnl = 0, payoutSum = 0, payoutCount = 0, streak = 0, maxLossStreak = 0;
  for (const row of list) {
    const result = pickResult(row);
    const payout = pickPayout(row);
    if (Number.isFinite(Number(payout))) { payoutSum += Number(payout); payoutCount += 1; }
    if (result === "WIN") { wins += 1; streak = 0; } else if (result === "LOSS") { losses += 1; streak += 1; maxLossStreak = Math.max(maxLossStreak, streak); } else if (result === "DRAW") { draws += 1; streak = 0; }
    const rowPnl = pickPnl(row);
    if (Number.isFinite(Number(rowPnl))) pnl += Number(rowPnl);
  }
  const decided = wins + losses + draws;
  return {
    n: list.length, decided, wins, losses, draws,
    wr: decided ? round(wins / decided) : null,
    ci95: wilsonInterval(wins, decided),
    expectancyPerTrade: decided ? round(pnl / decided) : null,
    normalizedPnl: round(pnl),
    avgPayout: payoutCount ? round(payoutSum / payoutCount, 2) : null,
    maxLossStreak: maxLossStreak || 0,
  };
}

function provenanceOf(observation) { return observation?.provenance === "HISTORICAL" ? "HISTORICAL" : "PROSPECTIVE"; }

function outcomeRow(observation) {
  return {
    marketKey: observation.marketKey, decisionSource: observation.decisionSource,
    theoreticalResult: observation.theoreticalResult ?? null, theoreticalPnl: observation.theoreticalPnl ?? null,
    payout: observation.payout ?? null, settlementBasis: observation.settlementBasis ?? null,
    currentExecution: observation.currentExecution ?? null,
  };
}

function armView(rows, predicate, { label = null } = {}) {
  const accepted = rows.filter((row) => predicate(row) === true);
  const rejected = rows.filter((row) => predicate(row) === false);
  return {
    label,
    accepted: accepted.length, rejected: rejected.length,
    coverage: rows.length ? round(accepted.length / rows.length) : null,
    acceptedSummary: summarizeRows(accepted.map(outcomeRow)),
    rejectedSummary: summarizeRows(rejected.map(outcomeRow)),
    rejectedOutcomes: "CONTRAFACTUAL: outcome teorico do que teria sido descartado",
  };
}

function groupBy(rows, pick) {
  const groups = new Map();
  for (const row of rows) {
    const key = pick(row) ?? "UNSPECIFIED";
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return Object.fromEntries([...groups.entries()].map(([key, list]) => [key, summarizeRows(list.map(outcomeRow))]));
}

function summarizeBrokerTrades(trades = []) {
  const rows = (Array.isArray(trades) ? trades : []).filter((trade) => trade && trade.result !== "UNKNOWN");
  const decided = rows.filter((trade) => trade.result === "WIN" || trade.result === "LOSS" || trade.result === "DRAW");
  let wins = 0, losses = 0, streak = 0, maxLossStreak = 0, pnl = 0, payoutSum = 0, payoutCount = 0;
  for (const trade of rows) {
    if (!Number.isFinite(Number(trade.payout))) { /* payout opcional */ } else { payoutSum += Number(trade.payout); payoutCount += 1; }
    const normalized = trade.normalizedPnl ?? (Number.isFinite(Number(trade.pnl)) && Number(trade.stake) > 0 ? round(Number(trade.pnl) / Number(trade.stake)) : normalizedOutcomePnl({ result: trade.result, payout: trade.payout, stake: trade.stake }));
    if (normalized !== null) pnl += normalized;
    if (trade.result === "WIN") { wins += 1; streak = 0; } else if (trade.result === "LOSS") { losses += 1; streak += 1; maxLossStreak = Math.max(maxLossStreak, streak); }
  }
  return {
    n: rows.length, decided: decided.length, wins, losses, draws: decided.length - wins - losses,
    wr: decided.length ? round(wins / decided.length) : null,
    ci95: wilsonInterval(wins, decided.length),
    expectancyPerTrade: decided.length ? round(pnl / decided.length) : null,
    normalizedPnl: round(pnl), avgPayout: payoutCount ? round(payoutSum / payoutCount, 2) : null,
    maxLossStreak,
  };
}

export function buildShadowLabDashboard({ observations = [], executedTrades = [] } = {}) {
  const all = (Array.isArray(observations) ? observations : []).filter(Boolean);
  const prospective = all.filter((observation) => provenanceOf(observation) === "PROSPECTIVE");
  const historical = all.filter((observation) => provenanceOf(observation) === "HISTORICAL");
  const rows = prospective.filter((observation) => observation.theoreticalResult === "WIN" || observation.theoreticalResult === "LOSS" || observation.theoreticalResult === "DRAW");
  const bySource = (source) => rows.filter((row) => row.decisionSource === source);
  const arms = {
    CURRENT_G2: { ...summarizeBrokerTrades(executedTrades.filter((trade) => trade.decisionSource === "G2_AUTO")), note: "BROKER_EXECUTED (apenas trades tagueados G2_AUTO; pre-instrumentacao fica em byDecisionSource.UNKNOWN)" },
    H1_LOCATION: armView(rows, (row) => row.counterfactual?.locationFilterWouldReject !== true, { label: "reject LOCATION_MID (v1)" }),
    H2_DISPLACEMENT: armView(rows, (row) => row.counterfactual?.displacementFilterWouldReject !== true, { label: "reject adverse > 0.35 ATR (v1)" }),
    H3_CRITIC: armView(rows, (row) => row.counterfactual?.hardCriticWouldReject !== true, { label: "reject HARD/MULTIPLE (v1)" }),
    DEGRADATION_OBSERVER: armView(rows, (row) => row.counterfactual?.degradationFilterWouldReject !== true, { label: "reject DEGRADED/SEVERELY_DEGRADED (v1)" }),
    GATE_CORRECTED: armView(rows, (row) => row.counterfactual?.correctedGateWouldAccept === true, { label: "corrected gate score >= threshold" }),
  };
  const sampleSize = {
    checkpointN: PROSPECTIVE_CHECKPOINT_N,
    byArm: Object.entries(arms).map(([arm, view]) => ({ arm, accepted: view.accepted ?? view.n, decided: view.acceptedSummary?.decided ?? view.decided ?? null, reachedCheckpoint: (view.acceptedSummary?.decided ?? view.decided ?? 0) >= PROSPECTIVE_CHECKPOINT_N })),
    byDecisionSource: Object.fromEntries(DECISION_SOURCES.map((source) => [source, summarizeRows(bySource(source).map(outcomeRow))])),
    note: "Checkpoint exploratorio >=30 por braco; NAO e prova. Sempre reportar N/WR/CI/coverage/expectancy/PnL/payout/maxLossStreak.",
  };
  return {
    version: SHADOW_LAB_VERSION,
    policy: SHADOW_POLICY,
    filters: SHADOW_FILTERS_V1,
    sections: {
      BROKER_EXECUTED: { basis: "BROKER_EXECUTED", observations: rows.filter((row) => row.settlementBasis === "BROKER_EXECUTED").length, summary: summarizeBrokerTrades(executedTrades), byDecisionSource: Object.fromEntries(DECISION_SOURCES.map((source) => [source, summarizeBrokerTrades((Array.isArray(executedTrades) ? executedTrades : []).filter((trade) => (trade.decisionSource ?? "UNKNOWN") === source))])) },
      COUNTERFACTUAL: { basis: "COUNTERFACTUAL", note: "Nunca somado ao P&L do broker; settlementBasis=CAUSAL_COUNTERFACTUAL ou espelho teorico.", observations: rows.length, bySettlementBasis: groupBy(rows, (row) => row.settlementBasis), byDecisionSource: Object.fromEntries(DECISION_SOURCES.map((source) => [source, summarizeRows(bySource(source).map(outcomeRow))])), arms },
      HISTORICAL: { basis: "HISTORICAL", observations: historical.length, summary: summarizeRows(historical.map(outcomeRow)), note: "Backfill/arquivo; nunca misturar com prospectivo." },
      PROSPECTIVE: { basis: "PROSPECTIVE", observations: prospective.length, settled: rows.length, pendingSettlement: prospective.length - rows.length, summary: summarizeRows(rows.map(outcomeRow)) },
    },
    arms,
    sampleSize,
    gateComparison: {
      note: "CURRENT (producao, exato) vs CORRECTED_SHADOW (D1 paths + D2 estabilidade).",
      currentPolicy: SHADOW_POLICY.gatePolicies[GATE_CURRENT],
      correctedPolicy: SHADOW_POLICY.gatePolicies[GATE_CORRECTED_SHADOW],
      scoreDelta: summarizeRows(rows.map((row) => ({ theoreticalResult: null, theoreticalPnl: row.gateComparison?.scoreDelta ?? null, payout: null }))).normalizedPnl,
    },
  };
}

/* ------------------------------------------------------------------ ShadowLab (orquestracao + persistencia best effort) */

const OBSERVATION_SELECT = `SELECT observation_id, version, kind, provenance, decision_source, market_key, market_type, active_id, agent_id,
  candidate_id, trade_id, execution_id, correlation_id, candidate_at, decision_at, jit_at, send_at, entry_at, target_entry_at, target_expiry_at,
  payout, t0, gate_current, gate_corrected_shadow, gate_comparison, h1_location, h2_displacement, h3_critic, degradation, counterfactual,
  current_execution, current_execution_reason, settlement_basis, broker_result, broker_profit, theoretical_result, theoretical_pnl, created_at, updated_at
  FROM iq_shadow_observations`;

function rowToObservation(row) {
  if (!row) return null;
  return {
    id: row.observation_id, version: row.version, kind: row.kind, provenance: row.provenance,
    decisionSource: row.decision_source, marketKey: row.market_key, marketType: row.market_type, activeId: row.active_id, agentId: row.agent_id,
    candidateId: row.candidate_id, tradeId: row.trade_id, executionId: row.execution_id, correlationId: row.correlation_id,
    candidateAt: row.candidate_at ? Number(new Date(row.candidate_at)) : null, decisionAt: row.decision_at ? Number(new Date(row.decision_at)) : null,
    jitAt: row.jit_at ? Number(new Date(row.jit_at)) : null, sendAt: row.send_at ? Number(new Date(row.send_at)) : null, entryAt: row.entry_at ? Number(new Date(row.entry_at)) : null,
    targetEntryAt: row.target_entry_at ? Number(new Date(row.target_entry_at)) : null, targetExpiryAt: row.target_expiry_at ? Number(new Date(row.target_expiry_at)) : null,
    payout: row.payout, t0: row.t0, gateCurrent: row.gate_current, gateCorrectedShadow: row.gate_corrected_shadow, gateComparison: row.gate_comparison,
    h1Location: row.h1_location, h2Displacement: row.h2_displacement, h3Critic: row.h3_critic, degradation: row.degradation, counterfactual: row.counterfactual,
    currentExecution: row.current_execution, currentExecutionReason: row.current_execution_reason,
    settlementBasis: row.settlement_basis, brokerResult: row.broker_result, brokerProfit: row.broker_profit,
    theoreticalResult: row.theoretical_result, theoreticalPnl: row.theoretical_pnl,
    createdAt: row.created_at ? Number(new Date(row.created_at)) : null, updatedAt: row.updated_at ? Number(new Date(row.updated_at)) : null,
  };
}

/**
 * Observador central. Persistencia best-effort (nunca derruba o runtime; nunca toca decisao).
 * `store` injetavel para testes (save/update/getById/listByMarket) — o default usa `pool`.
 */
export class ShadowLab {
  constructor({ pool = null, store = null, now = () => Date.now(), log = () => {}, maxInMemory = 2_000 } = {}) {
    this.pool = pool;
    this.store = store;
    this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.maxInMemory = maxInMemory;
    this.observations = new Map();
    this.byMarket = new Map();
    this.persist = { attempts: 0, failures: 0, lastError: null, lastOkAt: null };
  }

  #index(observation) {
    if (observation.marketKey) {
      const list = this.byMarket.get(observation.marketKey) ?? [];
      const filtered = list.filter((row) => row.id !== observation.id);
      filtered.push(observation);
      this.byMarket.set(observation.marketKey, filtered.slice(-this.maxInMemory));
    }
  }

  #remember(observation) {
    this.observations.set(observation.id, observation);
    this.#index(observation);
    if (this.observations.size > this.maxInMemory) {
      const oldest = [...this.observations.keys()][0];
      this.observations.delete(oldest);
    }
  }

  resetInMemory() { this.observations.clear(); this.byMarket.clear(); }

  list() { return [...this.observations.values()]; }

  get(id) { return this.observations.get(id) ?? null; }

  /** D4/D5/H1/H2/H3 + gate comparison + contrafactual de uma oportunidade aprovada/rejeitada pelo G2. */
  observeCandidate({
    marketKey = null, marketType = null, activeId = null, agentId = null,
    candidateId = null, tradeId = null, executionId = null, correlationId = null,
    decisionSource = null, provenance = "PROSPECTIVE",
    candidateAt = null, decisionAt = null, jitAt = null, sendAt = null, entryAt = null, targetEntryAt = null, targetExpiryAt = null,
    payout = null, candidateSnapshot = {}, jitSnapshot = {}, candidatePrice = null, jitPrice = null, actualEntryPrice = null,
    direction = null, atr = null, quality = null, location = null, microVeto = null, revalidation = null,
    qualityTiming = {}, candidateTiming = {}, threshold = null, candles = [],
    currentExecution = null, currentExecutionReason = null, gateAccepted = null, gateReason = null,
  } = {}) {
    const at = this.now();
    const dir = direction ?? candidateSnapshot?.action ?? jitSnapshot?.action ?? null;
    const candidateLocationInput = candidateSnapshot?.location ?? candidateSnapshot?.trader?.location ?? {};
    const jitLocationInput = jitSnapshot?.location ?? jitSnapshot?.trader?.location ?? {};
    const corrected = scoreGateCorrectedShadow(candidateSnapshot, { direction: dir, payout, timing: qualityTiming });
    const gateComparison = compareGateVersions({ current: quality, corrected, threshold });
    const candidateLocation = classifyLocation({
      donchianPosition: candidateLocationInput.donchianPosition, distanceToUpperATR: candidateLocationInput.distanceToUpperATR, distanceToLowerATR: candidateLocationInput.distanceToLowerATR,
      direction: dir, channelHigh: candidateLocationInput.channelHigh, channelLow: candidateLocationInput.channelLow, price: candidatePrice,
    });
    const jitLocation = classifyLocation({
      donchianPosition: jitLocationInput.donchianPosition, distanceToUpperATR: jitLocationInput.distanceToUpperATR, distanceToLowerATR: jitLocationInput.distanceToLowerATR,
      direction: dir, channelHigh: jitLocationInput.channelHigh, channelLow: jitLocationInput.channelLow, price: jitPrice,
    });
    const entryLocation = actualEntryPrice !== null && actualEntryPrice !== undefined
      ? classifyEntryLocation({ entryPrice: actualEntryPrice, channelHigh: jitLocation.channelHigh, channelLow: jitLocation.channelLow, atr, direction: dir, distanceToUpperATR: jitLocation.distanceToUpperATR, distanceToLowerATR: jitLocation.distanceToLowerATR })
      : null;
    const displacement = buildDisplacementShadow({ candidatePrice, jitPrice, actualEntryPrice: actualEntryPrice ?? jitPrice, atr, direction: dir });
    const candidateCritic = classifyContradictionSeverity({ contradictions: candidateSnapshot?.critic?.contradictions ?? [], riskFlags: candidateSnapshot?.critic?.riskFlags ?? [], verdict: candidateSnapshot?.critic?.verdict ?? null });
    const jitCritic = classifyContradictionSeverity({ contradictions: jitSnapshot?.critic?.contradictions ?? [], riskFlags: jitSnapshot?.critic?.riskFlags ?? [], verdict: jitSnapshot?.critic?.verdict ?? null });
    const degradation = observeDegradation({
      candidate: degradationInputsFromSnapshot({ snapshot: candidateSnapshot, direction: dir, displacementATR: null, criticSeverity: candidateCritic.severity, locationTag: candidateLocation.tag }),
      jit: degradationInputsFromSnapshot({ snapshot: jitSnapshot, direction: dir, displacementATR: displacement.candidateToJitATR, criticSeverity: jitCritic.severity, locationTag: jitLocation.tag }),
    });
    const counterfactual = buildCounterfactualShadow({
      location: { candidate: candidateLocation, jit: jitLocation, entry: entryLocation },
      displacement, critic: candidateCritic, degradation, gateComparison, threshold,
    });
    const t0 = buildT0Snapshot({
      marketKey, marketType, activeId, agentId, direction: dir,
      candidateAt, decisionAt, jitAt, sendAt, entryAt, targetEntryAt, targetExpiryAt, payout,
      snapshot: candidateSnapshot, quality, location: entryLocation ?? location ?? candidateLocation, displacement, revalidation,
    });
    const decisionSourceValue = decisionSource && DECISION_SOURCES.includes(decisionSource) ? decisionSource : decisionSourceOf({ source: decisionSource });
    const observation = {
      id: observationKey({ candidateId, executionId, tradeId, correlationId, marketKey, targetEntryAt }),
      version: SHADOW_LAB_VERSION, kind: "SHADOW_OBSERVATION", provenance,
      decisionSource: decisionSourceValue,
      marketKey, marketType, activeId, agentId, candidateId, tradeId, executionId, correlationId,
      candidateAt, decisionAt, jitAt, sendAt, entryAt, targetEntryAt, targetExpiryAt, payout,
      direction: dir,
      t0,
      gateCurrent: { gate: GATE_CURRENT, policy: "PRODUCTION", score: quality?.score ?? null, checks: quality?.checks ?? null, location, microVeto },
      gateCorrectedShadow: corrected,
      gateComparison,
      h1Location: { candidate: candidateLocation, jit: jitLocation, entry: entryLocation },
      h2Displacement: displacement,
      h3Critic: { candidate: candidateCritic, jit: jitCritic },
      degradation,
      counterfactual,
      threshold: num(threshold),
      gateAccepted: gateAccepted === true, gateReason,
      currentExecution, currentExecutionReason,
      settlementBasis: null, brokerResult: null, brokerProfit: null, theoreticalResult: null, theoreticalPnl: null,
      preWindow: extractPreWindow(candles, candidateAt ?? at, 12),
      createdAt: at, updatedAt: at,
    };
    deepFreeze(observation.t0);
    deepFreeze(observation.gateCorrectedShadow);
    deepFreeze(observation.gateComparison);
    deepFreeze(observation.counterfactual);
    deepFreeze(observation.degradation);
    deepFreeze(observation.h3Critic);
    this.#remember(observation);
    void this.#persistObservation(observation);
    if (observation.preWindow.length) void this.#persistWindow(observation, "PRE", observation.preWindow);
    return observation;
  }

  #resolve({ observationId = null, candidateId = null, executionId = null, tradeId = null }) {
    if (observationId && this.observations.has(observationId)) return { observation: this.observations.get(observationId), source: "MEMORY" };
    for (const observation of this.observations.values()) {
      if (candidateId && observation.candidateId === candidateId) return { observation, source: "MEMORY" };
      if (executionId && (observation.executionId === executionId || observation.tradeId === executionId)) return { observation, source: "MEMORY" };
      if (tradeId && observation.tradeId === tradeId) return { observation, source: "MEMORY" };
    }
    return { observation: null, source: "NONE" };
  }

  /** Resolucao pos-restart: le a observacao persistida por candidate_id/execution_id (associacao nao depende de memoria). */
  async #loadObservation({ observationId = null, candidateId = null, executionId = null }) {
    const direct = this.#resolve({ observationId, candidateId, executionId });
    if (direct.observation) return direct.observation;
    if (this.store?.getById) {
      const row = await this.store.getById(observationId ?? candidateId ?? executionId).catch(() => null);
      if (row) return row;
    }
    if (this.pool?.query) {
      try {
        const result = candidateId
          ? await this.pool.query(`${OBSERVATION_SELECT} WHERE candidate_id=$1 ORDER BY created_at DESC LIMIT 1`, [candidateId])
          : executionId
            ? await this.pool.query(`${OBSERVATION_SELECT} WHERE execution_id=$1 OR trade_id=$1 ORDER BY created_at DESC LIMIT 1`, [executionId])
            : observationId ? await this.pool.query(`${OBSERVATION_SELECT} WHERE observation_id=$1`, [observationId]) : { rows: [] };
        return rowToObservation(result.rows?.[0]);
      } catch (error) { this.#recordPersistFailure(error); return null; }
    }
    return null;
  }

  markExecution({ observationId = null, candidateId = null, executionId = null, currentExecution, reason = null, entryPrice = null, at = null }) {
    const { observation } = this.#resolve({ observationId, candidateId, executionId });
    const patch = { currentExecution: applyShadowAdvisory(currentExecution), currentExecutionReason: reason ?? null, executionId: executionId ?? observation?.executionId ?? null, updatedAt: at ?? this.now() };
    if (entryPrice !== null && entryPrice !== undefined) patch.actualEntryPrice = num(entryPrice);
    if (observation) Object.assign(observation, patch);
    void this.#updateObservation({ observationId: observation?.id ?? observationId, candidateId, executionId, patch });
    return observation ? { observationId: observation.id, currentExecution: observation.currentExecution } : null;
  }

  /** ACK: completa H2/entryLocation com o preco real de entrada (nao altera a decisao). */
  markEntry({ observationId = null, candidateId = null, executionId = null, actualEntryPrice = null, entryAt = null }) {
    const { observation } = this.#resolve({ observationId, candidateId, executionId });
    if (!observation) return null;
    const entryPrice = num(actualEntryPrice);
    if (entryPrice === null) return null;
    const displacement = buildDisplacementShadow({
      candidatePrice: observation.h2Displacement?.candidatePrice ?? null,
      jitPrice: observation.h2Displacement?.jitPrice ?? null,
      actualEntryPrice: entryPrice, atr: observation.h2Displacement?.atr ?? observation.t0?.volatility?.atr ?? null,
      direction: observation.direction ?? null,
    });
    const entryLocation = classifyEntryLocation({
      entryPrice, channelHigh: observation.h1Location?.jit?.channelHigh ?? null, channelLow: observation.h1Location?.jit?.channelLow ?? null,
      atr: observation.t0?.volatility?.atr ?? null, direction: observation.direction ?? null,
      distanceToUpperATR: observation.h1Location?.jit?.distanceToUpperATR ?? null, distanceToLowerATR: observation.h1Location?.jit?.distanceToLowerATR ?? null,
    });
    observation.h2Displacement = displacement;
    observation.h1Location = { ...observation.h1Location, entry: entryLocation };
    observation.counterfactual = buildCounterfactualShadow({
      location: observation.h1Location, displacement, critic: observation.h3Critic?.candidate ?? null,
      degradation: observation.degradation, gateComparison: observation.gateComparison, threshold: observation.threshold ?? null,
    });
    observation.entryAt = entryAt ?? observation.entryAt;
    observation.updatedAt = this.now();
    void this.#updateObservation({ observationId: observation.id, patch: { h1Location: observation.h1Location, h2Displacement: displacement, counterfactual: observation.counterfactual, entryAt: observation.entryAt } });
    return { observationId: observation.id, entryLocation, displacement };
  }

  /** Settlement executado (broker). Nunca mistura com contrafactual: basis=BROKER_EXECUTED. */
  async settleExecuted({ observationId = null, candidateId = null, executionId = null, tradeId = null, brokerResult = null, profit = null, stake = null, payout = null, settlementAt = null, entryAt = null, entryPrice = null, settlementPrice = null, candles = [], decisionSource = null, marketKey = null } = {}) {
    const observation = await this.#loadObservation({ observationId, candidateId, executionId });
    const at = this.now();
    const normalized = normalizedOutcomePnl({ result: brokerResult, payout: payout ?? observation?.payout ?? null, stake, profit });
    const patch = {
      settlementBasis: "BROKER_EXECUTED",
      brokerResult: brokerResult ?? null, brokerProfit: profit ?? null,
      theoreticalResult: brokerResult ?? null, theoreticalPnl: normalized,
      tradeId: tradeId ?? observation?.tradeId ?? null, executionId: executionId ?? observation?.executionId ?? null,
      entryAt: entryAt ?? observation?.entryAt ?? null, settlementAt, actualEntryPrice: entryPrice ?? null,
      settlementPrice: settlementPrice ?? null, decisionSource: decisionSource ?? observation?.decisionSource ?? null,
      updatedAt: at,
    };
    if (observation) {
      Object.assign(observation, patch);
      if (entryPrice !== null && entryPrice !== undefined) {
        const entryLocation = classifyEntryLocation({ entryPrice, channelHigh: observation.h1Location?.jit?.channelHigh ?? null, channelLow: observation.h1Location?.jit?.channelLow ?? null, atr: observation.t0?.volatility?.atr ?? null, direction: observation.direction ?? null, distanceToUpperATR: observation.h1Location?.jit?.distanceToUpperATR ?? null, distanceToLowerATR: observation.h1Location?.jit?.distanceToLowerATR ?? null });
        observation.h1Location = { ...observation.h1Location, entry: entryLocation };
        observation.h2Displacement = buildDisplacementShadow({ candidatePrice: observation.h2Displacement?.candidatePrice ?? null, jitPrice: observation.h2Displacement?.jitPrice ?? null, actualEntryPrice: entryPrice, atr: observation.h2Displacement?.atr ?? observation.t0?.volatility?.atr ?? null, direction: observation.direction ?? null });
        patch.h1Location = observation.h1Location; patch.h2Displacement = observation.h2Displacement;
      }
      const postWindow = buildPostWindow({ entryAtMs: entryAt ?? observation.entryAt, expiryAtMs: observation.targetExpiryAt, candles });
      observation.postWindow = postWindow;
      const postRows = [...postWindow.offsets, ...(postWindow.expiryCandle ? [postWindow.expiryCandle] : [])];
      if (postRows.length) void this.#persistWindow(observation, "POST", postRows);
    }
    await this.#updateObservation({ observationId: observation?.id ?? observationId, candidateId, executionId, patch });
    return observation ? { observationId: observation.id, basis: "BROKER_EXECUTED", result: brokerResult } : null;
  }

  /**
   * Settlement causal (MESMA regra do #causalSettlement de producao: ultimo close <= expiry) para
   * oportunidades NAO executadas. Basis=CAUSAL_COUNTERFACTUAL; nunca entra no P&L do broker.
   */
  settleCausal({ marketKey = null, candles = [], index = -1, nowMs = null } = {}) {
    if (!marketKey || !Array.isArray(candles) || index < 0 || index >= candles.length) return 0;
    const candle = candles[index];
    const rows = this.byMarket.get(marketKey) ?? [];
    let settled = 0;
    for (const observation of rows) {
      if (observation.settlementBasis !== null || observation.theoreticalResult !== null) continue;
      // EXECUTE e PENDING resolvem pelo broker (settleExecuted); evitam mistura de bases.
      if (observation.currentExecution === "EXECUTE" || observation.currentExecution === "PENDING") continue;
      if (!Number.isFinite(Number(observation.targetExpiryAt)) || Number(candle.bucketStart) < Number(observation.targetExpiryAt)) continue;
      const entryPrice = Number(observation.h2Displacement?.actualEntryPrice ?? observation.h2Displacement?.jitPrice);
      const settlement = candles.filter((row) => Number(row.bucketStart) <= Number(observation.targetExpiryAt)).pop()?.close ?? null;
      if (!Number.isFinite(entryPrice) || settlement === null) continue;
      const direction = observation.direction;
      const result = direction === "BUY" ? (settlement > entryPrice ? "WIN" : settlement < entryPrice ? "LOSS" : "DRAW") : (settlement < entryPrice ? "WIN" : settlement > entryPrice ? "LOSS" : "DRAW");
      observation.settlementBasis = "CAUSAL_COUNTERFACTUAL";
      observation.theoreticalResult = result;
      observation.theoreticalPnl = normalizedOutcomePnl({ result, payout: observation.payout });
      observation.settlementPrice = settlement;
      observation.updatedAt = nowMs ?? this.now();
      settled += 1;
      void this.#updateObservation({ observationId: observation.id, patch: { settlementBasis: observation.settlementBasis, theoreticalResult: result, theoreticalPnl: observation.theoreticalPnl, settlementPrice: settlement } });
    }
    return settled;
  }

  status({ executedTrades = [], at = null } = {}) {
    return {
      ...buildShadowLabDashboard({ observations: this.list(), executedTrades }),
      at: at ?? this.now(),
      store: { mode: this.store ? "INJECTED" : this.pool ? "POSTGRES" : "MEMORY", ...this.persist },
      executionControl: "NONE",
      observedCandidates: this.list().length,
    };
  }

  async #persistObservation(observation) {
    if (this.store?.save) { this.#markPersistAttempt(); try { await this.store.save(observation); this.#markPersistOk(); } catch (error) { this.#recordPersistFailure(error); } return; }
    if (!this.pool?.query) return;
    this.#markPersistAttempt();
    try {
      await this.pool.query(
        `INSERT INTO iq_shadow_observations(observation_id,version,kind,provenance,decision_source,market_key,market_type,active_id,agent_id,
          candidate_id,trade_id,execution_id,correlation_id,candidate_at,decision_at,jit_at,send_at,entry_at,target_entry_at,target_expiry_at,payout,
          t0,gate_current,gate_corrected_shadow,gate_comparison,h1_location,h2_displacement,h3_critic,degradation,counterfactual,
          current_execution,current_execution_reason,settlement_basis,broker_result,broker_profit,theoretical_result,theoretical_pnl,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,to_timestamp($14::double precision/1000.0),to_timestamp($15::double precision/1000.0),to_timestamp($16::double precision/1000.0),to_timestamp($17::double precision/1000.0),to_timestamp($18::double precision/1000.0),to_timestamp($19::double precision/1000.0),to_timestamp($20::double precision/1000.0),$21,
          $22::jsonb,$23::jsonb,$24::jsonb,$25::jsonb,$26::jsonb,$27::jsonb,$28::jsonb,$29::jsonb,$30::jsonb,$31,$32,$33,$34,$35,$36,$37,now(),now())
         ON CONFLICT(observation_id) DO NOTHING`,
        [
          observation.id, observation.version, observation.kind, observation.provenance, observation.decisionSource, observation.marketKey, observation.marketType, observation.activeId, observation.agentId,
          observation.candidateId, observation.tradeId, observation.executionId, observation.correlationId,
          observation.candidateAt, observation.decisionAt, observation.jitAt, observation.sendAt, observation.entryAt, observation.targetEntryAt, observation.targetExpiryAt, observation.payout,
          JSON.stringify(observation.t0 ?? {}), JSON.stringify(observation.gateCurrent ?? null), JSON.stringify(observation.gateCorrectedShadow ?? null), JSON.stringify(observation.gateComparison ?? null),
          JSON.stringify(observation.h1Location ?? null), JSON.stringify(observation.h2Displacement ?? null), JSON.stringify(observation.h3Critic ?? null), JSON.stringify(observation.degradation ?? null), JSON.stringify(observation.counterfactual ?? null),
          observation.currentExecution ?? null, observation.currentExecutionReason ?? null, observation.settlementBasis ?? null, observation.brokerResult ?? null, observation.brokerProfit ?? null, observation.theoreticalResult ?? null, observation.theoreticalPnl ?? null,
        ],
      );
      this.#markPersistOk();
    } catch (error) { this.#recordPersistFailure(error); }
  }

  async #persistWindow(observation, kind, candles) {
    const rows = Array.isArray(candles) ? candles.filter((candle) => candle && candle.bucketStart !== null && Number.isFinite(Number(candle.bucketStart))) : [];
    if (!rows.length) return;
    if (this.store?.saveWindow) { try { await this.store.saveWindow(observation, kind, rows); } catch (error) { this.#recordPersistFailure(error); } return; }
    if (!this.pool?.query) return;
    try {
      const values = [];
      const params = [];
      rows.forEach((candle, position) => {
        const base = position * 10;
        values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},to_timestamp($${base + 5}::double precision/1000.0),$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},true,false)`);
        params.push(
          observation.id, observation.tradeId ?? observation.executionId ?? null, observation.marketKey, kind,
          candle.bucketStart, candle.offsetSeconds ?? candle.targetSeconds ?? null,
          candle.open ?? null, candle.high ?? null, candle.low ?? null, candle.close ?? null,
        );
      });
      await this.pool.query(
        `INSERT INTO iq_trade_market_windows(observation_id,trade_id,market_key,kind,bucket_start,offset_seconds,open,high,low,close,diagnostic_only,feedable_to_t0)
         VALUES ${values.join(",")}
         ON CONFLICT(observation_id,kind,bucket_start) DO NOTHING`,
        params,
      );
    } catch (error) { this.#recordPersistFailure(error); }
  }

  async #updateObservation({ observationId = null, candidateId = null, executionId = null, patch = {} } = {}) {
    if (!patch || !Object.keys(patch).length) return;
    if (this.store?.update) { try { await this.store.update({ observationId, candidateId, executionId, patch }); this.#markPersistOk(); } catch (error) { this.#recordPersistFailure(error); } return; }
    if (!this.pool?.query) return;
    const sets = [];
    const params = [];
    const push = (column, value) => { params.push(value); sets.push(`${column}=$${params.length}`); };
    if (patch.currentExecution !== undefined) push("current_execution", patch.currentExecution);
    if (patch.currentExecutionReason !== undefined) push("current_execution_reason", patch.currentExecutionReason);
    if (patch.settlementBasis !== undefined) push("settlement_basis", patch.settlementBasis);
    if (patch.brokerResult !== undefined) push("broker_result", patch.brokerResult);
    if (patch.brokerProfit !== undefined) push("broker_profit", patch.brokerProfit);
    if (patch.theoreticalResult !== undefined) push("theoretical_result", patch.theoreticalResult);
    if (patch.theoreticalPnl !== undefined) push("theoretical_pnl", patch.theoreticalPnl);
    if (patch.settlementPrice !== undefined) push("settlement_price", patch.settlementPrice);
    if (patch.actualEntryPrice !== undefined) push("entry_price", patch.actualEntryPrice);
    if (patch.entryAt !== undefined) { params.push(patch.entryAt); sets.push(`entry_at=to_timestamp($${params.length}::double precision/1000.0)`); }
    if (patch.tradeId !== undefined) push("trade_id", patch.tradeId);
    if (patch.executionId !== undefined) push("execution_id", patch.executionId);
    if (patch.decisionSource !== undefined) push("decision_source", patch.decisionSource);
    if (patch.h1Location !== undefined) push("h1_location", JSON.stringify(patch.h1Location));
    if (patch.h2Displacement !== undefined) push("h2_displacement", JSON.stringify(patch.h2Displacement));
    if (patch.counterfactual !== undefined) push("counterfactual", JSON.stringify(patch.counterfactual));
    if (!sets.length) return;
    sets.push("updated_at=now()");
    params.push(observationId ?? candidateId ?? executionId);
    const whereClause = observationId ? `observation_id=$${params.length}` : candidateId ? `candidate_id=$${params.length}` : `execution_id=$${params.length}`;
    try {
      await this.pool.query(`UPDATE iq_shadow_observations SET ${sets.join(",")} WHERE ${whereClause}`, params);
      this.#markPersistOk();
    } catch (error) { this.#recordPersistFailure(error); }
  }

  #markPersistAttempt() { this.persist.attempts += 1; }
  #markPersistOk() { this.persist.lastOkAt = this.now(); }
  #recordPersistFailure(error) {
    this.persist.failures += 1;
    this.persist.lastError = String(error?.message ?? error).slice(0, 160);
    this.log("SHADOW_LAB_PERSIST_FAILED", this.persist.lastError);
  }

  statusSnapshot() { return { observations: this.list().length, persist: { ...this.persist } }; }

  toJSON() { return { version: SHADOW_LAB_VERSION, observations: this.list().slice(-300) }; }

  loadFrom(snapshot = {}) {
    if (!snapshot || !Array.isArray(snapshot.observations)) return false;
    for (const observation of snapshot.observations.slice(-this.maxInMemory)) if (observation?.id) this.#remember(observation);
    return true;
  }
}
