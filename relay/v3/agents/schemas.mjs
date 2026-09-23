/**
 * V3 — SCHEMAS dos agentes (JSON validado; fail-closed se invalido).
 * Nenhum schema permite campo de confianca percentual; especialistas nao emitem BUY/SELL.
 */
export const V3_AGENT_SCHEMA_VERSION = "v3-agent-schemas-v1";

const isString = (v, { max = 400 } = {}) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isStringArray = (v, { max = 12, itemMax = 400 } = {}) => Array.isArray(v) && v.length <= max && v.every((x) => isString(x, { max: itemMax }));
const isDirection = (v) => v === "UP" || v === "DOWN" || v === null || v === undefined;

function validateFacts(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return "facts";
  for (const item of value) {
    if (!item || typeof item !== "object") return "facts.item";
    if (!isString(item.family, { max: 40 }) || !isString(item.code, { max: 80 }) || !isDirection(item.direction)) return "facts.item.fields";
  }
  return null;
}

export const SPECIALIST_SCHEMA = {
  role: "SPECIALIST",
  validate(output) {
    if (!output || typeof output !== "object") return "not_object";
    if (!isString(output.domainAssessment, { max: 160 })) return "domainAssessment";
    if (!isStringArray(output.observations, { max: 12 })) return "observations";
    if (validateFacts(output.deterministicFacts)) return "deterministicFacts";
    if (!isStringArray(output.counterFacts ?? [], { max: 12 })) return "counterFacts";
    if (!isStringArray(output.blockers ?? [], { max: 8 })) return "blockers";
    if (!isStringArray(output.invalidations ?? [], { max: 8 })) return "invalidations";
    if (!isStringArray(output.changedSincePreviousCycle ?? [], { max: 8 })) return "changedSincePreviousCycle";
    if (!isStringArray(output.nextEvidenceToWatch ?? [], { max: 8 })) return "nextEvidenceToWatch";
    if (!isStringArray(output.playbooksUsed ?? [], { max: 12 })) return "playbooksUsed";
    if (!isStringArray(output.sourcesUsed ?? [], { max: 12 })) return "sourcesUsed";
    const text = JSON.stringify(output);
    if (/\b(BUY|SELL|CALL|PUT)\b/.test(text)) return "directional_decision_language";
    if (/confidence|percent/i.test(text)) return "confidence_not_allowed";
    return null;
  },
};

export const ASSET_SCHEMA = {
  role: "ASSET",
  validate(output) {
    if (!output || typeof output !== "object") return "not_object";
    if (!isString(output.scenario, { max: 60 })) return "scenario";
    if (!isDirection(output.direction)) return "direction";
    if (!["NO_SETUP", "WAIT", "BUY_CANDIDATE", "SELL_CANDIDATE"].includes(output.state)) return "state";
    if (output.direction === "UP" && output.state === "SELL_CANDIDATE") return "state_direction_conflict";
    if (output.direction === "DOWN" && output.state === "BUY_CANDIDATE") return "state_direction_conflict";
    if (!isStringArray(output.supportingEvidence ?? [], { max: 12 })) return "supportingEvidence";
    if (!isStringArray(output.counterEvidence ?? [], { max: 12 })) return "counterEvidence";
    if (!isStringArray(output.blockers ?? [], { max: 8 })) return "blockers";
    if (!isStringArray(output.invalidations ?? [], { max: 8 })) return "invalidations";
    if (!isString(output.bestCounterCase, { max: 600 })) return "bestCounterCase";
    if (!isStringArray(output.changedSincePreviousCycle ?? [], { max: 8 })) return "changedSincePreviousCycle";
    if (/confidence|percent/i.test(JSON.stringify(output))) return "confidence_not_allowed";
    return null;
  },
};

export const CONSENSUS_INDEPENDENT_SCHEMA = {
  role: "CONSENSUS_INDEPENDENT",
  validate(output) {
    if (!output || typeof output !== "object") return "not_object";
    if (!isString(output.scenario, { max: 60 })) return "scenario";
    if (!isDirection(output.direction)) return "direction";
    if (!isStringArray(output.evidence ?? [], { max: 12 })) return "evidence";
    if (!isString(output.reasoningSummary, { max: 600 })) return "reasoningSummary";
    return null;
  },
};

export const CONSENSUS_FINAL_SCHEMA = {
  role: "CONSENSUS_FINAL",
  validate(output) {
    if (!output || typeof output !== "object") return "not_object";
    if (!["AGREE", "DISAGREE", "INSUFFICIENT_EVIDENCE"].includes(output.agreement)) return "agreement";
    if (!["APPROVE_BUY", "APPROVE_SELL", "CANCEL"].includes(output.result)) return "result";
    if (!isString(output.bestCounterCase, { max: 600 })) return "bestCounterCase";
    if (!isStringArray(output.challengeSteps ?? [], { max: 12 })) return "challengeSteps";
    if (!isStringArray(output.reasons ?? [], { max: 8 })) return "reasons";
    if (output.result === "APPROVE_BUY" && output.agreement !== "AGREE") return "approve_requires_agreement";
    if (output.result === "APPROVE_SELL" && output.agreement !== "AGREE") return "approve_requires_agreement";
    if (/confidence|percent/i.test(JSON.stringify(output))) return "confidence_not_allowed";
    return null;
  },
};

export const AGENT_SCHEMAS = Object.freeze({ SPECIALIST: SPECIALIST_SCHEMA, ASSET: ASSET_SCHEMA, CONSENSUS_INDEPENDENT: CONSENSUS_INDEPENDENT_SCHEMA, CONSENSUS_FINAL: CONSENSUS_FINAL_SCHEMA });

/** Papeis de agente -> schema (5 especialistas compartilham o contrato SPECIALIST). */
export const ROLE_SCHEMA = Object.freeze({
  RSI: "SPECIALIST", DMI_ADX: "SPECIALIST", BOLLINGER: "SPECIALIST", ATR: "SPECIALIST", PRICE_ACTION: "SPECIALIST",
  ASSET: "ASSET", CONSENSUS_INDEPENDENT: "CONSENSUS_INDEPENDENT", CONSENSUS_FINAL: "CONSENSUS_FINAL",
});

export function validateAgentOutput(role, output) {
  const schemaName = ROLE_SCHEMA[role];
  const schema = schemaName ? AGENT_SCHEMAS[schemaName] : null;
  if (!schema) return { ok: false, error: "UNKNOWN_ROLE" };
  const error = schema.validate(output);
  return error ? { ok: false, error } : { ok: true, error: null };
}
