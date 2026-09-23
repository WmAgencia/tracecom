/**
 * V3 — PROMPTS v2: STATIC PREFIX + ROLE PLAYBOOK + SCHEMA + DYNAMIC DELTA.
 *
 * O prefixo estatico e byte-identical entre chamadas (cache/routing do provider).
 * O playbook por papel e estavel (ids + regras-chave); nunca enviamos documentos inteiros.
 * O contexto dinamico e um DIGEST compacto (nao 2160 candles; nao measurements completos).
 */
import { PLAYBOOKS, SOURCES } from "../playbooks.mjs";

export const V3_PROMPTS_VERSION = "v3-agent-prompts-v2";

export const STATIC_PREFIX = [
  "TraceCom V3 agent. Responda SOMENTE um unico objeto JSON valido (JSON mode). Sem markdown, sem prosa fora do JSON.",
  "Os numeros determinísticos vem do backend e sao AUTORIDADE: use exatamente os valores do NORMALIZED STATE; nunca recalcule nem invente numeros.",
  "ENUMS ESTRITOS: direction ∈ {UP, DOWN, NONE}; strength ∈ {WEAK, MODERATE, STRONG} (intensidade da evidencia — NUNCA use NORMAL/SHALLOW/DEEP aqui; profundidade de pullback vai em detail).",
  "NUNCA use informacao futura. Seja conciso: assessment <= 1 frase; no maximo 6 fatos; listas curtas.",
  "Sem percentual de confianca. Sem votacao. Nao use as palavras BUY/SELL/CALL/PUT.",
].join("\n");

const PLAYBOOK_DOMAIN = { RSI: "RSI", DMI_ADX: "DMI", BOLLINGER: "BOLLINGER", ATR: "ATR", PRICE_ACTION: "PRICE_ACTION" };

function playbookLine(domain) {
  return Object.values(PLAYBOOKS).filter((playbook) => playbook.domain === domain).map((playbook) => `${playbook.id} (${playbook.tracecomDefined ? "tracecom" : "source"}:${playbook.sources.join("+")})`).join("; ");
}

const ROLE_SECTION = Object.freeze({
  RSI: "PAPEL: RSI SPECIALIST — descreva estado do momentum com fatos direcionais (direction UP/DOWN/NONE). Nao julgue a tese (sem support/counter). Fatos tipicos: RSI_SLOPE, RSI_CROSSBACK, RSI_PERSISTENCE, RSI_DIVERGENCE, RSI_FAILURE_SWING, RSI_ZONE_CONTEXT (zona extrema e CONTEXTO). Playbooks: " + playbookLine("RSI"),
  DMI_ADX: "PAPEL: DMI/ADX SPECIALIST — ADX e FORCA, +DI/-DI sao direcao. Fatos: DI_DOMINANCE, DI_TAKEOVER, ADX_STRENGTHENING, ADX_WEAKENING. Playbooks: " + playbookLine("DMI"),
  BOLLINGER: "PAPEL: BOLLINGER SPECIALIST — posicao relativa e volatilidade de banda; tag NAO e sinal. Fatos: BAND_WALK, BAND_REENTRY, BAND_REJECTION, MIDLINE_SLOPE, SQUEEZE_CONTEXT. Playbooks: " + playbookLine("BOLLINGER"),
  ATR: "PAPEL: ATR SPECIALIST — volatilidade sem direcao. Fatos: VOL_REGIME, VOL_EXPANSION, VOL_CONTRACTION, LARGE_WICK, ZONE_TOLERANCE. Playbooks: " + playbookLine("ATR"),
  PRICE_ACTION: "PAPEL: PRICE ACTION SPECIALIST — estrutura causal (pivots confirmados). Fatos: TREND, BOS, CHOCH (invalida a estrutura anterior; direction = nova direcao), PULLBACK, BREAKOUT, BREAKDOWN, RETEST, FAILED_BREAKOUT/BREAKDOWN, DECISIVE_CANDLE. Playbooks: " + playbookLine("PRICE_ACTION"),
});

const SCHEMA_SECTION = Object.freeze({
  RSI: '{"assessment":"...","facts":[{"code":"RSI_SLOPE","direction":"UP|DOWN|NONE","strength":"WEAK|MODERATE|STRONG","detail":"curto"}],"blockers":[],"invalidations":[],"changed":[],"watch":[],"playbooks":["RSI_TRAJECTORY"],"sources":["WILDER_1978"]}',
  DMI_ADX: '{"assessment":"...","facts":[{"code":"DI_DOMINANCE","direction":"UP|DOWN|NONE","strength":"WEAK|MODERATE|STRONG","detail":"curto"}],"blockers":[],"invalidations":[],"changed":[],"watch":[],"playbooks":["DMI_STRENGTH_VS_DIRECTION"],"sources":["WILDER_1978"]}',
  BOLLINGER: '{"assessment":"...","facts":[{"code":"BAND_WALK","direction":"UP|DOWN|NONE","strength":"WEAK|MODERATE|STRONG","detail":"curto"}],"blockers":[],"invalidations":[],"changed":[],"watch":[],"playbooks":["BOLLINGER_WALK"],"sources":["BOLLINGER_OFFICIAL_RULES"]}',
  ATR: '{"assessment":"...","facts":[{"code":"VOL_REGIME","direction":"NONE","strength":"WEAK|MODERATE|STRONG","detail":"curto"}],"blockers":[],"invalidations":[],"changed":[],"watch":[],"playbooks":["ATR_NORMALIZATION"],"sources":["WILDER_1978"]}',
  PRICE_ACTION: '{"assessment":"...","facts":[{"code":"TREND","direction":"UP|DOWN|NONE","strength":"WEAK|MODERATE|STRONG","detail":"curto"}],"blockers":[],"invalidations":[],"changed":[],"watch":[],"playbooks":["PA_TREND_STRUCTURE"],"sources":["EDWARDS_MAGEE_2018"]}',
  ASSET: '{"scenario":"PULLBACK_CONTINUATION","direction":"UP|DOWN|NONE","state":"NO_SETUP|WAIT|BUY_CANDIDATE|SELL_CANDIDATE","bestCounterCase":"...","blockers":[],"invalidations":[],"changed":[],"watch":[]}',
  CONSENSUS_BILATERAL: '{"scenario":"PULLBACK_CONTINUATION","direction":"UP|DOWN|NONE","evidenceFamilies":[{"family":"STRUCTURE","supports":"resumo"}],"bestCaseForUp":[],"bestCaseAgainstUp":[],"bestCaseForDown":[],"bestCaseAgainstDown":[],"blockers":[],"invalidations":[],"marketAmbiguities":[]}',
});

const SCENARIO_ID_LIST = "TREND_CONTINUATION, PULLBACK_CONTINUATION, DEEP_PULLBACK_STRUCTURE_THREAT, STRUCTURAL_REVERSAL, BREAKOUT, FAILED_BREAKOUT, BREAKDOWN, FAILED_BREAKDOWN, BREAKOUT_RETEST, COMPRESSION, EXPANSION, RANGE, TRANSITION, EXHAUSTION, STRUCTURAL_ZONE_REJECTION, TREND_WEAKENING, TREND_RESUMPTION, NO_SETUP";

const ASSET_SECTION = "PAPEL: ASSET AGENT — classifique o CENARIO (tipo, semantica da Scenario Library) e a DIRECAO separadamente, e o estado operacional. Seja conservador: sem confirmacao estrutural => WAIT; sem cenario relevante => NO_SETUP. Explique o melhor contra-caso da sua propria tese (bestCounterCase <= 2 frases). scenario DEVE ser EXATAMENTE um id da Scenario Library: " + SCENARIO_ID_LIST + ". direction ∈ {UP, DOWN, NONE}; state ∈ {NO_SETUP, WAIT, BUY_CANDIDATE, SELL_CANDIDATE}.";
const CONSENSUS_SECTION = "PAPEL: CONSENSUS INDEPENDENTE — classifique o mercado SEM conhecer a tese do Asset e faca o RED TEAM DOS DOIS LADOS: bestCaseForUp, bestCaseAgainstUp, bestCaseForDown, bestCaseAgainstDown, ambiguidades e blockers/invalidations. Sem votacao. scenario DEVE ser EXATAMENTE um id da Scenario Library: " + SCENARIO_ID_LIST + ".";

export function systemPromptFor(role) {
  return [STATIC_PREFIX, ROLE_SECTION[role] ?? (role === "ASSET" ? ASSET_SECTION : CONSENSUS_SECTION), "SCHEMA:", SCHEMA_SECTION[role] ?? SCHEMA_SECTION.ASSET].join("\n");
}

/** Digest compacto do estado determinístico (apenas o essencial; numeros reais do backend). */
export function digestMeasurements(m) {
  if (!m) return null;
  const s = m.structure ?? {}; const r = m.rsi ?? {}; const d = m.dmi ?? {}; const b = m.bollinger ?? {}; const a = m.atr ?? {}; const p = m.pullback ?? {}; const mi = m.micro ?? {}; const im = m.impulse ?? {}; const br = m.breakoutRetest ?? {};
  return {
    closedCandle: m.closedCandle ?? null,
    structure: { trend: s.trend, lastBOS: s.lastBOS ?? null, lastCHoCH: s.lastCHoCH ?? null, lastHigh: s.lastHigh ?? null, lastLow: s.lastLow ?? null },
    pullback: p, micro: mi, impulse: im, breakoutRetest: br,
    rsi: { value: r.value, zone: r.zone, slope: r.slope, crossback: r.crossback ?? null, persistence: r.persistence ?? null, momentum: r.momentum, failureSwing: r.failureSwing ?? null, divergence: r.divergence ?? [] },
    dmi: { adx: d.adx, adxSlope: d.adxSlope, plusDi: d.plusDi, minusDi: d.minusDi, spread: d.spread, dominance: d.dominance, trendState: d.trendState, takeover: d.takeover },
    bollinger: { percentB: b.percentB, bandwidth: b.bandwidth, midlineSlope: b.midlineSlope, bandWalk: b.bandWalk, reentry: b.reentry, rejection: b.rejection, squeeze: b.squeeze },
    atr: { atr: a.atr, atrPct: a.atrPct, volRatio: a.volRatio, regime: a.regime, normalizedRange: a.normalizedRange, normalizedImpulse: a.normalizedImpulse, normalizedPullback: a.normalizedPullback, wickNormalization: a.wickNormalization },
  };
}

export function specialistDelta({ role, measurements, previous = null, cycleNumber = null, timing = null }) {
  return JSON.stringify({
    cycle: cycleNumber,
    timing: timing ? { expirationAt: timing.expirationAt, tteMs: timing.tteMs, phase: timing.phase ?? null } : null,
    state: digestMeasurements(measurements),
    previous: previous ? { assessment: previous.assessment ?? null, facts: previous.facts ?? null } : null,
  });
}

const compactFacts = (facts) => (Array.isArray(facts) ? facts.slice(0, 6).map((fact) => ({ code: fact.code, direction: fact.direction, strength: fact.strength, detail: fact.detail ?? null })) : facts);
const compactSpecialist = (agent) => (agent ? { role: agent.role, assessment: agent.assessment, facts: compactFacts(agent.facts), blockers: agent.blockers ?? [], invalidations: agent.invalidations ?? [] } : null);

export function assetDelta({ measurements, specialists, previousAssessment = null, cycleNumber = null, timing = null }) {
  return JSON.stringify({
    cycle: cycleNumber,
    timing: timing ? { expirationAt: timing.expirationAt, tteMs: timing.tteMs } : null,
    state: digestMeasurements(measurements),
    specialists: Object.values(specialists ?? {}).map(compactSpecialist),
    previous: previousAssessment ? { scenario: previousAssessment.scenario, direction: previousAssessment.direction, state: previousAssessment.state } : null,
  });
}

export function consensusDelta({ measurements, specialists, cycleNumber = null, timing = null }) {
  return JSON.stringify({
    cycle: cycleNumber,
    timing: timing ? { expirationAt: timing.expirationAt, tteMs: timing.tteMs } : null,
    state: digestMeasurements(measurements),
    specialists: Object.values(specialists ?? {}).map(compactSpecialist),
  });
}

export function availableSourceIds() { return Object.keys(SOURCES); }
