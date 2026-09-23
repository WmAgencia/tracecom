/**
 * V3 — SCHEMAS COMPACTOS + VALIDACAO SEMANTICA (structured output; fail-closed).
 *
 * Especialistas NAO escrevem ensaio: assessment curto + fatos + blockers/invalidations.
 * Numeros determinísticos ficam no contexto/log (nao repetir measurements inteiros).
 * Validacao semantica: ids de playbook/source conhecidos e numeros citados ancorados no input.
 */
import { PLAYBOOKS, SOURCES } from "../playbooks.mjs";
import { SCENARIO_IDS } from "../scenarios.mjs";

export const V3_AGENT_SCHEMA_VERSION = "v3-agent-schemas-v2";

const SCENARIO_ID_SET = new Set(SCENARIO_IDS);
const scenarioValid = (scenario) => isString(scenario, 48) && SCENARIO_ID_SET.has(scenario);

export const DIRECTIONS = Object.freeze(["UP", "DOWN", "NONE"]);
export const STRENGTHS = Object.freeze(["WEAK", "MODERATE", "STRONG"]);

const isString = (value, max = 400) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isStringArray = (value, { max = 8, itemMax = 160 } = {}) => Array.isArray(value) && value.length <= max && value.every((item) => isString(item, itemMax));
const factsValid = (facts) => {
  if (!Array.isArray(facts) || facts.length === 0 || facts.length > 12) return false;
  return facts.every((fact) => fact && typeof fact === "object"
    && isString(fact.code, 48) && /^[A-Z_]{3,48}$/.test(fact.code)
    && DIRECTIONS.includes(fact.direction)
    && STRENGTHS.includes(fact.strength)
    && (fact.detail === null || fact.detail === undefined || (typeof fact.detail === "string" && fact.detail.length <= 240)));
};

export const SPECIALIST_SCHEMA = {
  role: "SPECIALIST",
  fields: ["assessment", "facts", "blockers", "invalidations", "changed", "watch", "playbooks", "sources"],
  validate(output) {
    if (!output || typeof output !== "object") return "not_object";
    if (!isString(output.assessment, 220)) return "assessment";
    if (!factsValid(output.facts)) return "facts";
    if (!isStringArray(output.blockers ?? [])) return "blockers";
    if (!isStringArray(output.invalidations ?? [])) return "invalidations";
    if (!isStringArray(output.changed ?? [])) return "changed";
    if (!isStringArray(output.watch ?? [])) return "watch";
    if (!isStringArray(output.playbooks ?? [], { max: 10, itemMax: 64 })) return "playbooks";
    if (!isStringArray(output.sources ?? [], { max: 10, itemMax: 64 })) return "sources";
    for (const id of output.playbooks ?? []) if (!PLAYBOOKS[id]) return "unknown_playbook";
    for (const id of output.sources ?? []) if (!SOURCES[id] && id !== "TRACECOM_V3_OPS") return "unknown_source";
    return null;
  },
};

export const ASSET_SCHEMA = {
  role: "ASSET",
  fields: ["scenario", "direction", "state", "bestCounterCase", "blockers", "invalidations", "changed", "watch"],
  validate(output) {
    if (!output || typeof output !== "object") return "not_object";
    if (!scenarioValid(output.scenario)) return "scenario";
    if (!["UP", "DOWN", "NONE"].includes(output.direction)) return "direction";
    if (!["NO_SETUP", "WAIT", "BUY_CANDIDATE", "SELL_CANDIDATE"].includes(output.state)) return "state";
    if (output.direction === "UP" && output.state === "SELL_CANDIDATE") return "state_direction_conflict";
    if (output.direction === "DOWN" && output.state === "BUY_CANDIDATE") return "state_direction_conflict";
    if (!isString(output.thesis, 400)) return "thesis";
    if (!isString(output.bestCounterCase, 480)) return "bestCounterCase";
    if (!isStringArray(output.blockers ?? [])) return "blockers";
    if (!isStringArray(output.invalidations ?? [])) return "invalidations";
    if (!isStringArray(output.changed ?? [])) return "changed";
    if (!isStringArray(output.watch ?? [])) return "watch";
    return null;
  },
};

/** Consensus FINAL: unica segunda onda LLM. Interpreta evidence ANTES de comparar com o Asset (anti-anchoring),
 *  faz red-team bilateral e decide APPROVE_BUY | APPROVE_SELL | CANCEL. Sem confidence %, sem votacao. */
export const CONSENSUS_FINAL_SCHEMA = {
  role: "CONSENSUS_FINAL",
  fields: ["independentAssessment", "assetComparison", "scenario", "direction", "agreement", "supportingEvidence", "counterEvidence", "bestCaseForUp", "bestCaseAgainstUp", "bestCaseForDown", "bestCaseAgainstDown", "blockers", "invalidations", "marketAmbiguities", "reasons", "result"],
  validate(output) {
    if (!output || typeof output !== "object") return "not_object";
    if (!isString(output.independentAssessment, 320)) return "independentAssessment";
    if (!isString(output.assetComparison, 320)) return "assetComparison";
    if (!scenarioValid(output.scenario)) return "scenario";
    if (!["UP", "DOWN", "NONE"].includes(output.direction)) return "direction";
    if (!["AGREE", "PARTIAL", "DISAGREE"].includes(output.agreement)) return "agreement";
    if (!isStringArray(output.supportingEvidence ?? [], { max: 6, itemMax: 200 })) return "supportingEvidence";
    if (!isStringArray(output.counterEvidence ?? [], { max: 6, itemMax: 200 })) return "counterEvidence";
    for (const key of ["bestCaseForUp", "bestCaseAgainstUp", "bestCaseForDown", "bestCaseAgainstDown", "marketAmbiguities", "reasons"]) {
      if (!isStringArray(output[key] ?? [], { max: 6, itemMax: 200 })) return key;
    }
    if (!isStringArray(output.blockers ?? [])) return "blockers";
    if (!isStringArray(output.invalidations ?? [])) return "invalidations";
    if (!["APPROVE_BUY", "APPROVE_SELL", "CANCEL"].includes(output.result)) return "result";
    if (output.result === "APPROVE_BUY" && output.direction !== "UP") return "result_direction_conflict";
    if (output.result === "APPROVE_SELL" && output.direction !== "DOWN") return "result_direction_conflict";
    return null;
  },
};

export const AGENT_SCHEMAS = Object.freeze({ SPECIALIST: SPECIALIST_SCHEMA, ASSET: ASSET_SCHEMA, CONSENSUS_FINAL: CONSENSUS_FINAL_SCHEMA });

export const ROLE_SCHEMA = Object.freeze({
  RSI: "SPECIALIST", DMI_ADX: "SPECIALIST", BOLLINGER: "SPECIALIST", ATR: "SPECIALIST", PRICE_ACTION: "SPECIALIST",
  ASSET: "ASSET", CONSENSUS_FINAL: "CONSENSUS_FINAL",
});

/** Ancoragem numerica: todo numero citado no output deve existir no input (ou ser pequeno/estrutural).
 *  Tolerancias: igualdade arredondada (precisao do token), fracao estrutural pequena e
 *  aproximacao relativa de ate 2% (min 0.5) — o suficiente para "~80" de um input 82.26 NAO passar,
 *  mas "50" de um input 50.85 passar. Inventar valores (ex.: RSI 87 com input 45) falha. */
export function numericGroundingError(output, inputNumbers, { structuralMax = 20, structuralConstants = [14, 20, 25, 30, 50, 70, 75, 80, 100], relativeTolerance = 0.02, minTolerance = 0.5 } = {}) {
  const inputs = [];
  const rounded = new Map();
  const allowRounded = (value, decimals) => {
    if (!rounded.has(decimals)) rounded.set(decimals, new Set());
    rounded.get(decimals).add(String(Number(Number(value).toFixed(decimals))));
  };
  for (const value of inputNumbers ?? []) {
    const number = Number(value);
    if (!Number.isFinite(number)) continue;
    inputs.push(number);
    for (let decimals = 0; decimals <= 4; decimals += 1) allowRounded(number, decimals);
  }
  const tokens = JSON.stringify(output ?? {}).match(/-?\d+(?:\.\d+)?/g) ?? [];
  for (const token of tokens) {
    const value = Number(token);
    if (!Number.isFinite(value)) continue;
    const decimals = (token.split(".")[1] ?? "").length;
    if (rounded.get(Math.min(decimals, 4))?.has(String(value))) continue;
    if (Math.abs(value) <= structuralMax && Number.isInteger(value)) continue;
    if (Number.isInteger(value) && structuralConstants.includes(value)) continue;
    if (/^(19|20)\d{2}$/.test(token)) continue;
    const tolerance = (input) => Math.max(minTolerance, Math.abs(input) * relativeTolerance);
    const near = inputs.some((input) => Math.abs(value - input) <= tolerance(input) || Math.abs(Math.abs(value) - Math.abs(input)) <= tolerance(input));
    if (near) continue;
    return { error: "invented_number", token };
  }
  return null;
}

/** Coleta numeros do input (measurements + timing) para a ancoragem. */
export function collectInputNumbers(measurements, timing = null) {
  const out = [];
  const walk = (value, depth = 0) => {
    if (depth > 6 || value === null || value === undefined) return;
    if (typeof value === "number") { if (Number.isFinite(value)) out.push(value); return; }
    if (typeof value === "string") { const asNumber = Number(value); if (Number.isFinite(asNumber) && value.trim() !== "") out.push(asNumber); return; }
    if (Array.isArray(value)) { for (const item of value.slice(0, 60)) walk(item, depth + 1); return; }
    if (typeof value === "object") { for (const item of Object.values(value)) walk(item, depth + 1); }
  };
  walk(measurements);
  if (timing) walk(timing);
  return out;
}

export function validateAgentOutput(role, output, { inputNumbers = null } = {}) {
  const schemaName = ROLE_SCHEMA[role];
  const schema = schemaName ? AGENT_SCHEMAS[schemaName] : null;
  if (!schema) return { ok: false, error: "UNKNOWN_ROLE" };
  const error = schema.validate(output);
  if (error) return { ok: false, error };
  if (inputNumbers) { const grounding = numericGroundingError(output, inputNumbers); if (grounding) return { ok: false, error: grounding.error, token: grounding.token }; }
  return { ok: true, error: null };
}
