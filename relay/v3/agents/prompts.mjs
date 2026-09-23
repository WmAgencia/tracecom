/**
 * V3 — PROMPTS v3: FACT PACKETS + STATIC PREFIX + ROLE PLAYBOOK + SCHEMA.
 *
 * CODE TURNS RAW MARKET DATA INTO FACTS. LLM TURNS FACTS INTO PROFESSIONAL INTERPRETATION.
 * - O prompt dinamico e o FACT PACKET (FULL no 1o ciclo; DELTA nos seguintes) — nunca 2160 candles.
 * - Wave 1: 5 specialists + Asset em PARALELO, cada um apenas com os fatos do seu papel (sem anchoring).
 * - Wave 2: Consensus FINAL recebe deterministic facts + specialists e, por ULTIMO, o bloco
 *   ASSET_THESIS_TO_CHALLENGE (anti-anchoring: interpreta antes de comparar).
 */
import { PLAYBOOKS, SOURCES } from "../playbooks.mjs";

export const V3_PROMPTS_VERSION = "v3-agent-prompts-v3";

export const STATIC_PREFIX = [
  "TraceCom V3 agent. Responda SOMENTE um unico objeto JSON valido (JSON mode). Sem markdown, sem prosa fora do JSON.",
  "Os fatos numericos vem do FACT COMPILER deterministico do backend e sao AUTORIDADE: interprete-os; nunca recalcule nem invente numeros.",
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

const SCENARIO_ID_LIST = "TREND_CONTINUATION, PULLBACK_CONTINUATION, DEEP_PULLBACK_STRUCTURE_THREAT, STRUCTURAL_REVERSAL, BREAKOUT, FAILED_BREAKOUT, BREAKDOWN, FAILED_BREAKDOWN, BREAKOUT_RETEST, COMPRESSION, EXPANSION, RANGE, TRANSITION, EXHAUSTION, STRUCTURAL_ZONE_REJECTION, TREND_WEAKENING, TREND_RESUMPTION, NO_SETUP";

const ASSET_SECTION = "PAPEL: ASSET AGENT — interprete o SNAPSHOT CROSS-DOMAIN de fatos deterministicos e forme sua propria leitura global do mercado (voce NAO recebe especialistas nem consensus). Classifique o CENARIO (tipo) e a DIRECAO separadamente, escreva a thesis e o estado operacional. Seja conservador: sem confirmacao estrutural => WAIT; sem cenario relevante => NO_SETUP. Explique o melhor contra-caso da sua propria tese (bestCounterCase <= 2 frases). scenario DEVE ser EXATAMENTE um id da Scenario Library: " + SCENARIO_ID_LIST + ". direction ∈ {UP, DOWN, NONE}; state ∈ {NO_SETUP, WAIT, BUY_CANDIDATE, SELL_CANDIDATE}.";
const CONSENSUS_SECTION = "PAPEL: CONSENSUS FINAL — voce e o DECISOR DE MERCADO do ciclo. Ordem logica OBRIGATORIA: (A) interprete deterministicFacts + specialistEvidence e escreva independentAssessment SEM considerar o bloco ASSET_THESIS_TO_CHALLENGE; (B) SO DEPOIS compare com o bloco ASSET_THESIS_TO_CHALLENGE e escreva assetComparison; (C) construa o RED TEAM dos DOIS lados (bestCaseForUp/AgainstUp/ForDown/AgainstDown); (D) registre supportingEvidence, counterEvidence, blockers, invalidations, marketAmbiguities, reasons; (E) conclua result ∈ {APPROVE_BUY, APPROVE_SELL, CANCEL}. Nao valide o Asset automaticamente: procure ativamente a melhor contra-tese. Sem confidence %. scenario DEVE ser EXATAMENTE um id da Scenario Library: " + SCENARIO_ID_LIST + ". APPROVE_BUY exige direction UP; APPROVE_SELL exige direction DOWN.";

const SCHEMA_SECTION = Object.freeze({
  RSI: '{"assessment":"...","facts":[{"code":"RSI_SLOPE","direction":"UP|DOWN|NONE","strength":"WEAK|MODERATE|STRONG","detail":"curto"}],"blockers":[],"invalidations":[],"changed":[],"watch":[],"playbooks":["RSI_TRAJECTORY"],"sources":["WILDER_1978"]}',
  DMI_ADX: '{"assessment":"...","facts":[{"code":"DI_DOMINANCE","direction":"UP|DOWN|NONE","strength":"WEAK|MODERATE|STRONG","detail":"curto"}],"blockers":[],"invalidations":[],"changed":[],"watch":[],"playbooks":["DMI_STRENGTH_VS_DIRECTION"],"sources":["WILDER_1978"]}',
  BOLLINGER: '{"assessment":"...","facts":[{"code":"BAND_WALK","direction":"UP|DOWN|NONE","strength":"WEAK|MODERATE|STRONG","detail":"curto"}],"blockers":[],"invalidations":[],"changed":[],"watch":[],"playbooks":["BOLLINGER_WALK"],"sources":["BOLLINGER_OFFICIAL_RULES"]}',
  ATR: '{"assessment":"...","facts":[{"code":"VOL_REGIME","direction":"NONE","strength":"WEAK|MODERATE|STRONG","detail":"curto"}],"blockers":[],"invalidations":[],"changed":[],"watch":[],"playbooks":["ATR_NORMALIZATION"],"sources":["WILDER_1978"]}',
  PRICE_ACTION: '{"assessment":"...","facts":[{"code":"TREND","direction":"UP|DOWN|NONE","strength":"WEAK|MODERATE|STRONG","detail":"curto"}],"blockers":[],"invalidations":[],"changed":[],"watch":[],"playbooks":["PA_TREND_STRUCTURE"],"sources":["EDWARDS_MAGEE_2018"]}',
  ASSET: '{"scenario":"PULLBACK_CONTINUATION","direction":"UP|DOWN|NONE","state":"NO_SETUP|WAIT|BUY_CANDIDATE|SELL_CANDIDATE","thesis":"1-2 frases","bestCounterCase":"...","blockers":[],"invalidations":[],"changed":[],"watch":[]}',
  CONSENSUS_FINAL: '{"independentAssessment":"...","assetComparison":"...","scenario":"PULLBACK_CONTINUATION","direction":"UP|DOWN|NONE","agreement":"AGREE|PARTIAL|DISAGREE","supportingEvidence":[],"counterEvidence":[],"bestCaseForUp":[],"bestCaseAgainstUp":[],"bestCaseForDown":[],"bestCaseAgainstDown":[],"blockers":[],"invalidations":[],"marketAmbiguities":[],"reasons":[],"result":"APPROVE_BUY|APPROVE_SELL|CANCEL"}',
});

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

const compactFacts = (facts) => (Array.isArray(facts) ? facts.slice(0, 6).map((fact) => ({ code: fact.code, direction: fact.direction, strength: fact.strength, detail: fact.detail ?? null })) : facts);
const compactSpecialist = (role, agent) => (agent ? { role, assessment: agent.assessment, facts: compactFacts(agent.facts), blockers: agent.blockers ?? [], invalidations: agent.invalidations ?? [] } : null);
const compactChange = (envelope) => {
  if (!envelope || envelope.mode === "FULL") return null;
  const detail = { role: envelope.role, changed: envelope.delta.changed.slice(0, 8), eventsNew: envelope.delta.eventsNew, eventsRemoved: envelope.delta.eventsRemoved };
  if (detail.changed.length === 0 && detail.eventsNew.length === 0 && detail.eventsRemoved.length === 0) return null;
  return detail;
};

/** Prompt da Wave 1: o proprio fact packet (FULL/DELTA). Nenhum output de outro agente. */
export function factPrompt(envelope) {
  return envelope?.json ?? "{}";
}

/** Prompt da Wave 2 (Consensus FINAL): deterministic facts -> specialists -> changes -> ASSET (por ultimo). */
export function consensusFinalPrompt({ measurements, timing = null, cycleNumber = null, envelopes = {}, specialistOutputs = {}, asset = null, previousConsensus = null, specialistRoles = [] } = {}) {
  return JSON.stringify({
    cycle: cycleNumber,
    timing: timing ? { expirationAt: timing.expirationAt ?? null, tteMs: timing.tteMs ?? null, phase: timing.phase ?? null } : null,
    deterministicFacts: digestMeasurements(measurements),
    specialistEvidence: specialistRoles.map((role) => compactSpecialist(role, specialistOutputs?.[role])).filter(Boolean),
    factChanges: Object.values(envelopes).map(compactChange).filter(Boolean),
    ASSET_THESIS_TO_CHALLENGE: asset ? { scenario: asset.scenario, direction: asset.direction, state: asset.state, thesis: asset.thesis ?? null, bestCounterCase: asset.bestCounterCase ?? null } : null,
    previousConsensus: previousConsensus ? { result: previousConsensus.result ?? null, direction: previousConsensus.direction ?? null, independentAssessment: previousConsensus.independentAssessment ?? null } : null,
  });
}

export function availableSourceIds() { return Object.keys(SOURCES); }
