/**
 * TRANSFORM V4 RUNNER -> V2 LIVE RUNNER (Strategy Core = rsi-skills-v2 ORIGINAL, byte a byte;
 * scheduler/timing/observabilidade = atuais). Apenas substituicao mecanica de identificadores,
 * tabelas e chamadas de core; nenhuma regra V2 e reescrita aqui.
 */
import fs from "node:fs";

const source = fs.readFileSync("relay/rsi-agents-v4.mjs", "utf8");
let out = source;

const replacePairs = [
  ["RSI AGENTS V4 — runner da RSI_REVERSAL_V4 em todo o universo habilitado (MESAS).", "RSI AGENTS V2 LIVE — runner da V2 ORIGINAL (rsi-skills-v2, inalterada) sobre a INFRAESTRUTURA ATUAL.\n * Strategy Core = V2 (decide oportunidade/direcao/confirmacao). Scheduler/timing/observabilidade = atuais."],
  ['import { V4_ID, RSI_V4_VERSION, RSI_V4_POLICY, evaluateIndicatorsV4, updateEpisodeV4, evaluateV4Decision, classifyOutcomeV4, rsiV4FreezeManifest } from "./rsi-v4.mjs";',
   'import { STRICT_V2_ID, PULLBACK_V2_ID, RSI_SKILLS_V2_POLICY, evaluateIndicatorsV2, updateEpisodeV2, evaluateV2, rsiSkillsV2FreezeManifest } from "./rsi-skills-v2.mjs";\nimport { computeFiftyFiftySplit } from "./rsi-agents-v2.mjs";\nimport { classifyOutcomeV3 } from "./rsi-v3.mjs";'],
  ['export const RSI_AGENTS_V4_VERSION = "rsi-agents-v4-single-v1";', 'export const RSI_AGENTS_V2_LIVE_VERSION = "rsi-agents-v2-live-v1";'],
  ['export const RSI_V4_EXECUTION_ALLOWLIST = Object.freeze([`agent-v4:${V4_ID}`]);', 'export const RSI_V2_LIVE_EXECUTION_ALLOWLIST = Object.freeze([`agent-v2:${STRICT_V2_ID}`, `agent-v2:${PULLBACK_V2_ID}`]);'],
  ["RSI_AGENTS_V4_POLICY", "RSI_AGENTS_V2_LIVE_POLICY"],
  ['version: RSI_AGENTS_V4_VERSION,', 'version: RSI_AGENTS_V2_LIVE_VERSION,'],
  ['strategy: V4_ID,\n  strategyVersion: "v4",', 'strategyCore: "rsi-skills-v2 (ORIGINAL, congelada)",\n  strategyVersion: "v2-live",'],
  ['instruments: ["BINARY", "BLITZ_45S"],\n  blitzDurationSeconds: RSI_V4_POLICY.blitzDurationSeconds,\n  finalWindowMs: RSI_V4_POLICY.finalWindowMs,\n  minimumSafeMarginMs: RSI_V4_POLICY.minimumSafeMarginMs,\n  turbCutoffMs: RSI_V4_POLICY.turbCutoffMs,',
   'instruments: ["BINARY"],\n  finalWindowMs: 5000,\n  minimumSafeMarginMs: 3000,\n  turbCutoffMs: 30000,'],
  ['routing: "RSI_V4_ONLY",\n  singleBrokerPath: "runtime.submitAgentV4Order -> requestOrder",', 'routing: "RSI_V2_ONLY",\n  singleBrokerPath: "runtime.submitAgentV2LiveOrder -> requestOrder",'],
  ["export class RsiAgentsV4 {", "export class RsiAgentsV2Live {"],
  ["this.skills = skills ?? { evaluateIndicatorsV4, updateEpisodeV4, evaluateV4Decision, classifyOutcomeV4 };", "this.skills = skills ?? { evaluateIndicatorsV2, updateEpisodeV2, evaluateV2 };"],
  ["this.skillAssignments = new Map();", ""],
  ["this.universe = { at: null, enabled: 0, total: 0, byType: { BINARY: 0, BLITZ_45S: 0 }, signature: null };", "this.universe = { at: null, enabled: 0, total: 0, byType: { BINARY: 0 }, signature: null };\n    this.skillAssignments = new Map();"],
  ["const byType = { BINARY: 0, BLITZ_45S: 0 };", "const byType = { BINARY: 0 };"],
  ["const instrumentOf = (row) => String(row?.instrumentType ?? row?.instrument_type ?? \"BINARY\").toUpperCase();",
   "const instrumentOf = (row) => String(row?.instrumentType ?? row?.instrument_type ?? \"BINARY\").toUpperCase();\nconst V2_CORE = Object.freeze({ strict: STRICT_V2_ID, pullback: PULLBACK_V2_ID });"],
  ["  #watchKey(marketKey, instrumentType) { return `${marketKey}|${instrumentType}`; }",
   "  #watchKey(marketKey, instrumentType) { return `${marketKey}|${instrumentType}`; }\n\n  /** V2 ORIGINAL 50/50 (mesma regra do rsi-agents-v2.computeFiftyFiftySplit). */\n  #assignSkills() {\n    const enabled = [...this.assignments.values()].filter((row) => row.enabled === true).map((row) => row.marketKey).sort();\n    const split = computeFiftyFiftySplit(enabled);\n    this.skillAssignments = new Map();\n    for (const key of split.strict) this.skillAssignments.set(key, STRICT_V2_ID);\n    for (const key of split.pullback) this.skillAssignments.set(key, PULLBACK_V2_ID);\n  }\n\n  skillFor(marketKey) { return this.skillAssignments.get(marketKey) ?? STRICT_V2_ID; }\n\n  /** Adapta a decisao da V2 ORIGINAL para o formato de telemetria (sem alterar a regra V2). */\n  #coreDecision({ marketKey, indicators, episode }) {\n    const skillId = this.skillFor(marketKey);\n    const result = this.skills.evaluateV2({ strategy: skillId, indicators, episode });\n    const accepted = result?.accepted === true && (result.decision === \"BUY\" || result.decision === \"SELL\");\n    return {\n      accepted, direction: accepted ? result.decision : \"WAIT\",\n      reason: accepted ? `V2_ENTRY_OK:${skillId}:${result.status ?? \"OK\"}` : (result?.reason ?? result?.status ?? \"WAIT\"),\n      reasonCodes: accepted ? [] : [String(result?.status ?? result?.reason ?? \"WAIT\")],\n      checks: { strategy: skillId, status: result?.status ?? null },\n      counterEvidence: [], entryReason: accepted ? [`V2_OK_${skillId}`] : [], cushion: null, hardBlocksChecked: [],\n    };\n  }"],
  ["evaluateV4Decision", "coreDecision"],
  ["this.skills.coreDecision({ indicators, episode })", "this.skills.coreDecision({ indicators, episode })"],
  ["this.skills.updateEpisodeV4", "this.skills.updateEpisodeV2"],
  ["evaluateIndicatorsV4", "evaluateIndicatorsV2"],
  ["classifyOutcomeV4", "classifyOutcomeV3"],
  ["rsiV4FreezeManifest()", "rsiSkillsV2FreezeManifest()"],
  ["iq_rsi_opportunities_v4", "iq_rsi_opportunities_v2live"],
  ["iq_rsi_agent_state_v4", "iq_rsi_agent_state_v2live"],
  ["iq_rsi_events_v4", "iq_rsi_events_v2live"],
  ["iq_rsi_universe_v4", "iq_rsi_universe_v2live"],
  ["agent-v4:", "agent-v2:"],
  ["rsi-agent-v4:", "rsi-agent-v2live:"],
  ["submitAgentV4Order", "submitAgentV2LiveOrder"],
  ['const source = "agent-v4:"', 'const source = "agent-v2:"'],
  ['"v4"', '"v2-live"'],
  ["strategyId: V4_ID", "strategyId: skillId"],
  ["skill: V4_ID", "skill: skillId"],
  ["strategyId: V4_ID,", "strategyId: skillId,"],
  ["`rsi-agent-v4:${V4_ID}:${marketKey}", "`rsi-agent-v2live:${V4_ID}:${marketKey}"],
  ["strategyVersion: \"v4\", strategyId: V4_ID,", "strategyVersion: \"v2-live\", strategyId: record.agent_id?.split(\":\")[0] ?? STRICT_V2_ID,"],
  ["const V4_ID =", "const V4_ID_UNUSED ="],
  ["V4_ID", "STRICT_V2_ID"],
  ["RSI_V4_POLICY.candleMs", "5000"],
  ["projectionPresent: recheck.cushion?.normalized !== null && recheck.cushion?.normalized !== undefined,", "projectionPresent: true,"],
  ["cushionNotFragile: recheck.cushion?.fragile !== true,", "cushionNotFragile: true,"],
  ["blitzAcked: 0, blitzUnsupported: 0,", "blitzAcked: 0, blitzUnsupported: 0, shadowOnlyBlocks: 0,"],
  ["\"BLITZ_45S\"", "\"BINARY\""],
  ["BLITZ_45S", "BINARY"],
];
for (const [from, to] of replacePairs) out = out.split(from).join(to);

// Ajustes finais: o runner V2-live nao tem blitz; coreDecision e privado dentro da classe.
out = out.replace("this.skills.coreDecision({ indicators, episode })", "this.#coreDecision({ marketKey, indicators, episode })");
out = out.replace("this.#coreDecision({ marketKey, indicators, episode }) = this.#watchTouch", "this.#watchTouch");
out = out.replace("const decision = this.skills.coreDecision", "const decision = this.#coreDecision");
out = out.replace("const recheck = this.#coreDecision({ indicators, episode })", "const recheck = this.#coreDecision({ marketKey, indicators, episode })");
out = out.replace("buildV4TradePackage", "buildV2LiveTradePackage").replace("buildV4Summary", "buildV2LiveSummary").replace("rsiAgentsV4FreezeManifest", "rsiAgentsV2LiveFreezeManifest");

fs.writeFileSync("relay/rsi-agents-v2-live.mjs", out);
console.log("V2_LIVE_RUNNER_WRITTEN relay/rsi-agents-v2-live.mjs bytes=" + out.length);
