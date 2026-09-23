/**
 * V3 — AGENT PROMPTS (compilacao de contexto; nunca envia livro inteiro).
 * Carrega os Agent.md/playbooks uma vez (cache), extrai ids/regras e monta o system prompt
 * por papel + payload determinístico. Prompt delta: ciclo anterior + novo candle + measurements.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLAYBOOKS, SOURCES } from "../playbooks.mjs";

export const V3_PROMPTS_VERSION = "v3-agent-prompts-v1";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const AGENT_DOCS = {
  RSI: "docs/agents/v3/RSI.md",
  DMI_ADX: "docs/agents/v3/DMI-ADX.md",
  BOLLINGER: "docs/agents/v3/BOLLINGER.md",
  ATR: "docs/agents/v3/ATR.md",
  PRICE_ACTION: "docs/agents/v3/PRICE-ACTION.md",
  ASSET: "docs/agents/v3/ASSET.md",
  CONSENSUS: "docs/agents/v3/CONSENSUS.md",
};

const cache = new Map();
function loadDoc(relative) {
  if (cache.has(relative)) return cache.get(relative);
  let text = "";
  try { text = fs.readFileSync(path.join(ROOT, relative), "utf8"); } catch { text = ""; }
  const compiled = text.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, 80).join("\n").slice(0, 6_000);
  cache.set(relative, compiled);
  return compiled;
}

/** Contexto de playbooks por dominio: apenas ids + regras-chave + source ids (compacto e auditavel). */
export function playbookContext(domain) {
  const playbooks = Object.values(PLAYBOOKS).filter((playbook) => playbook.domain === domain);
  return playbooks.map((playbook) => ({
    id: playbook.id,
    concept: playbook.concept,
    sources: playbook.sources,
    sourceBacked: playbook.tracecomDefined === false,
    keyRules: [
      ...(playbook.interpretation?.supporting ?? []).slice(0, 1).map((rule) => `support: ${rule}`),
      ...(playbook.interpretation?.counter ?? []).slice(0, 1).map((rule) => `counter: ${rule}`),
      ...(playbook.interpretation?.blockers ?? []).slice(0, 2).map((rule) => `blocker: ${rule}`),
      ...(playbook.interpretation?.invalidations ?? []).slice(0, 1).map((rule) => `invalidation: ${rule}`),
      `watch: ${(playbook.commonMisinterpretations ?? [])[0] ?? "n/a"}`,
    ],
  }));
}

const COMMON_RULES = [
  "Voce e um agente do TraceCom V3 (decisao assistida por evidencia). Responda SOMENTE com UM objeto JSON valido, sem markdown, sem explicacoes antes ou depois. O primeiro caractere deve ser { e o ultimo }.",
  "Seja CONCISO: no maximo 2 itens por lista de texto; numeros com ate 4 casas; sem repetir o payload.",
  "Os numeros determinísticos vem do backend e sao AUTORIDADE: use como dados, nunca recalcule nem invente.",
  "NUNCA use informacao futura. Analise somente o candle fechado e o historico fornecido.",
  "Especialistas NAO decidem direcao final e NAO usam BUY/SELL/CALL/PUT: descrevem fatos do dominio com direcao (UP/DOWN/null).",
  "Sem percentual de confianca. Sem votacao. Sem obrigacao de operar.",
];

export function systemPromptFor(role) {
  if (role === "ASSET") {
    return [
      ...COMMON_RULES,
      "PAPEL: ASSET AGENT — identifique o CENARIO (Scenario Library) separando TIPO e DIRECAO, e o estado operacional (NO_SETUP/WAIT/BUY_CANDIDATE/SELL_CANDIDATE).",
      "Cenarios simetricos: TREND_CONTINUATION, PULLBACK_CONTINUATION, TREND_RESUMPTION, STRUCTURAL_REVERSAL, DEEP_PULLBACK_STRUCTURE_THREAT, BREAKOUT_RETEST. Eventos: BREAKOUT(UP), BREAKDOWN(DOWN), FAILED_BREAKOUT(DOWN), FAILED_BREAKDOWN(UP), COMPRESSION, EXPANSION, RANGE, TRANSITION, EXHAUSTION, STRUCTURAL_ZONE_REJECTION, TREND_WEAKENING.",
      "BUY_CANDIDATE/SELL_CANDIDATE exigem CONFIRMACAO ESTRUTURAL (BOS/crossback/candle decisivo/rompimento/reteste) e nenhuma invalidacao contraria. Sem confirmacao => WAIT. Sem cenario relevante => NO_SETUP.",
      loadDoc(AGENT_DOCS.ASSET),
      'RETORNE JSON: {"scenario":string,"direction":"UP"|"DOWN"|null,"state":"NO_SETUP"|"WAIT"|"BUY_CANDIDATE"|"SELL_CANDIDATE","supportingEvidence":string[],"counterEvidence":string[],"blockers":string[],"invalidations":string[],"bestCounterCase":string,"changedSincePreviousCycle":string[],"nextEvidenceToWatch":string[]}',
    ].join("\n");
  }
  if (role === "CONSENSUS_INDEPENDENT") {
    return [
      ...COMMON_RULES,
      "PAPEL: CONSENSUS INDEPENDENTE — classifique o MESMO mercado SEM conhecer a conclusao do Asset (evitar anchoring).",
      "Use a mesma Scenario Library e os fatos dos especialistas. Sem votacao: pesos por familia de evidencia e invalidations tem precedencia.",
      loadDoc(AGENT_DOCS.CONSENSUS),
      'RETORNE JSON: {"scenario":string,"direction":"UP"|"DOWN"|null,"evidence":string[],"reasoningSummary":string}',
    ].join("\n");
  }
  if (role === "CONSENSUS_FINAL") {
    return [
      ...COMMON_RULES,
      "PAPEL: FINAL CHALLENGE — compare a tese do Asset com a sua classificacao independente; assuma a tese ERRADA e construa o melhor caso contrario; verifique blockers/invalidations/mudancas/timing.",
      "Resultado SOMENTE APPROVE_BUY | APPROVE_SELL | CANCEL. APPROVE exige agreement=AGREE e nenhuma invalidacao relevante. Duvida => CANCEL.",
      loadDoc(AGENT_DOCS.CONSENSUS),
      'RETORNE JSON: {"agreement":"AGREE"|"DISAGREE"|"INSUFFICIENT_EVIDENCE","result":"APPROVE_BUY"|"APPROVE_SELL"|"CANCEL","bestCounterCase":string,"challengeSteps":string[],"reasons":string[]}',
    ].join("\n");
  }
  const domain = role === "DMI_ADX" ? "DMI" : role;
  const sources = [...new Set(playbookContext(domain).flatMap((playbook) => playbook.sources))];
  return [
    ...COMMON_RULES,
    `PAPEL: ESPECIALISTA ${role} — descreva o estado do dominio com FATOS DIRECIONAIS (direction UP/DOWN/null). Nao rotule support/counter: isso e do Asset/Consensus.`,
    "PLAYBOOKS DISPONIVEIS (use os ids em playbooksUsed):",
    JSON.stringify(playbookContext(domain)),
    `SOURCE IDS DISPONIVEIS: ${JSON.stringify(sources.filter((id) => SOURCES[id]).slice(0, 20))}`,
    loadDoc(AGENT_DOCS[role] ?? AGENT_DOCS.RSI),
    'RETORNE JSON: {"domainAssessment":string,"observations":string[],"deterministicFacts":[{"family":string,"code":string,"direction":"UP"|"DOWN"|null,"detail":any}],"counterFacts":string[],"blockers":string[],"invalidations":string[],"changedSincePreviousCycle":string[],"nextEvidenceToWatch":string[],"playbooksUsed":string[],"sourcesUsed":string[]}',
  ].join("\n");
}

export function specialistPayload({ role, measurements, previousCycle = null, cycleNumber = null, expiration = null }) {
  return JSON.stringify({
    role, cycleNumber,
    expiration: expiration ? { expirationAt: expiration.expirationAt, tteMs: expiration.tteMs, brokerNow: expiration.brokerNow } : null,
    closedCandle: measurements?.closedCandle ?? null,
    deterministicMeasurements: measurements ? {
      rsi: measurements.rsi, dmi: measurements.dmi, bollinger: measurements.bollinger, atr: measurements.atr,
      structure: measurements.structure, pullback: measurements.pullback, impulse: measurements.impulse, micro: measurements.micro, breakoutRetest: measurements.breakoutRetest,
    } : null,
    previousCycle: previousCycle ? { role: previousCycle.role, assessment: previousCycle.assessment, facts: previousCycle.facts, changed: previousCycle.changedSincePreviousCycle } : null,
  }).slice(0, 18_000);
}

export function assetPayload({ measurements, specialists, previousAssessment = null, expiration = null, cycleNumber = null }) {
  return JSON.stringify({
    cycleNumber,
    expiration: expiration ? { expirationAt: expiration.expirationAt, tteMs: expiration.tteMs } : null,
    marketContext: measurements ? { closedCandle: measurements.closedCandle, structure: measurements.structure, pullback: measurements.pullback, dmi: measurements.dmi, atr: measurements.atr, bollinger: measurements.bollinger, rsi: measurements.rsi, impulse: measurements.impulse, micro: measurements.micro, breakoutRetest: measurements.breakoutRetest } : null,
    specialists: Object.values(specialists ?? {}).filter(Boolean).map((agent) => ({ role: agent.role, domainAssessment: agent.assessment, facts: agent.facts, blockers: agent.blockers, invalidations: agent.invalidations })),
    previousAssessment: previousAssessment ? { scenario: previousAssessment.scenario, direction: previousAssessment.direction, state: previousAssessment.state } : null,
  }).slice(0, 24_000);
}

export function consensusBasePayload({ measurements, specialists, expiration = null, cycleNumber = null }) {
  return JSON.stringify({
    cycleNumber,
    expiration: expiration ? { expirationAt: expiration.expirationAt, tteMs: expiration.tteMs } : null,
    marketContext: measurements ? { closedCandle: measurements.closedCandle, structure: measurements.structure, pullback: measurements.pullback, dmi: measurements.dmi, atr: measurements.atr, bollinger: measurements.bollinger, rsi: measurements.rsi, impulse: measurements.impulse, micro: measurements.micro, breakoutRetest: measurements.breakoutRetest } : null,
    specialists: Object.values(specialists ?? {}).filter(Boolean).map((agent) => ({ role: agent.role, domainAssessment: agent.assessment, facts: agent.facts, blockers: agent.blockers, invalidations: agent.invalidations })),
  }).slice(0, 24_000);
}
