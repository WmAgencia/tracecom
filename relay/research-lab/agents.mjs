/**
 * RESEARCH AGENTS + DAG — 8 papeis de pesquisa. Deterministicos por padrao; LLM opcional
 * (fora do hot path) via hook `llm`. Nenhum promove fator/modelo automaticamente.
 */
export const RESEARCH_AGENTS_VERSION = "research-agents-v1";
export const RESEARCH_DAG_VERSION = "research-dag-v1";

export const RESEARCH_AGENT_IDS = Object.freeze([
  "FACTOR_RESEARCHER", "ALPHA_RESEARCHER", "STRATEGY_RESEARCHER", "BACKTEST_RESEARCHER",
  "MODEL_RESEARCHER", "JOURNAL_RESEARCHER", "STATISTICAL_REVIEWER", "RED_TEAM_RESEARCHER",
]);

export function makeArtifact({ agentId, question, findings = [], status = "DRAFT", extra = {} }) {
  return { agentId, question, findings, status, createdAt: Date.now(), researchOnly: true, controlsExecution: false, ...extra };
}

export async function runResearchAgent({ agentId, question, data = {}, llm = null }) {
  if (!RESEARCH_AGENT_IDS.includes(agentId)) throw new Error(`AGENT_INVALID:${agentId}`);
  const deterministic = deterministicFindings(agentId, data);
  let llmSummary = null;
  if (typeof llm === "function") {
    try { llmSummary = await llm({ agentId, question, findings: deterministic }); } catch { llmSummary = { status: "LLM_UNAVAILABLE" }; }
  }
  return makeArtifact({ agentId, question, findings: deterministic, extra: { llmSummary } });
}

function deterministicFindings(agentId, data) {
  switch (agentId) {
    case "FACTOR_RESEARCHER": return { cataloged: data.catalog?.counts ?? null, portableCandidates: data.catalog?.portableCandidates?.length ?? null, otcUnavailable: data.catalog?.compatibility?.UNAVAILABLE_FOR_OTC ?? null };
    case "ALPHA_RESEARCHER": return { benchTop: (data.bench?.factors ?? []).slice(0, 10).map((row) => ({ factorId: row.factorId, coverage: row.coverage, edgePp: row.conditional?.edgePp, ic: row.ic })) };
    case "STRATEGY_RESEARCHER": return { groups: (data.strategyRegime ?? []).length, top: (data.strategyRegime ?? []).slice(0, 10) };
    case "BACKTEST_RESEARCHER": return { metrics: data.backtest?.metrics ?? null, validation: data.validation ? Object.keys(data.validation) : [] };
    case "MODEL_RESEARCHER": return { mlStatus: data.mlStatus ?? null, calibration: data.calibration ?? null };
    case "JOURNAL_RESEARCHER": return { patterns: (data.journal?.patterns ?? []).slice(0, 10), hypotheses: (data.journal?.hypotheses ?? []).length };
    case "STATISTICAL_REVIEWER": return statisticalReview(data);
    case "RED_TEAM_RESEARCHER": return redTeamReview(data);
    default: return {};
  }
}

function statisticalReview(data) {
  const flags = [];
  const decided = data.backtest?.metrics?.decided ?? 0;
  if (decided < 30) flags.push("N_INSUFICIENTE_PARA_CONCLUSAO");
  if (data.bench?.warning) flags.push("BENCH_N_PEQUENO");
  if ((data.journal?.patterns ?? []).some((row) => row.exploratoryOnly)) flags.push("PADROES_EXPLORATORIOS");
  if (!data.validation?.holdout) flags.push("SEM_HOLDOUT");
  return { verdict: flags.length ? "CAUTION" : "OK", flags, reminders: ["CI95 obrigatorio", "nunca headline com N<30", "prospective e backtest nao se somam"] };
}

function redTeamReview(data) {
  const attacks = [];
  if (data.bench?.correlation?.clusters?.some((cluster) => cluster.size > 1)) attacks.push("FATORES_REDUNDANTES_CONTAM_COMO_CONFIRMACAO");
  if ((data.validation?.bootstrap?.wr?.high ?? 0) - (data.validation?.bootstrap?.wr?.low ?? 0) > 0.3) attacks.push("CI_AMPLO_DEMAIS");
  if ((data.drift?.feature?.alerts ?? []).length) attacks.push("FEATURE_DRIFT_ATIVO");
  return { verdict: attacks.length ? "CHALLENGED" : "CONFIRMED", attacks };
}

/** DAG: QUESTION -> DATASET -> FACTOR/STRATEGY -> BACKTEST -> STATISTICAL REVIEW -> RED TEAM -> REPORT. */
export async function runResearchDag({ question, loaders = {}, llm = null } = {}) {
  const steps = [];
  const run = async (name, fn) => { const started = Date.now(); const output = await fn(); steps.push({ step: name, ms: Date.now() - started, status: "OK" }); return output; };
  const dataset = await run("DATASET", async () => loaders.dataset());
  const catalog = await run("FACTOR_STRATEGY", async () => loaders.factors());
  const backtest = await run("BACKTEST", async () => loaders.backtest());
  const stats = await run("STATISTICAL_REVIEW", async () => runResearchAgent({ agentId: "STATISTICAL_REVIEWER", question, data: { dataset, catalog, backtest, validation: loaders.validation?.() ?? null, bench: loaders.bench?.() ?? null, journal: loaders.journal?.() ?? null } }));
  const redTeam = await run("RED_TEAM", async () => runResearchAgent({ agentId: "RED_TEAM_RESEARCHER", question, data: { bench: loaders.bench?.() ?? null, drift: loaders.drift?.() ?? null, validation: loaders.validation?.() ?? null } }));
  const report = await run("REPORT", async () => ({ question, dataset: dataset ?? null, backtest: backtest?.metrics ?? null, statistics: stats.findings, redTeam: redTeam.findings, promotion: "MANUAL_ONLY", researchOnly: true }));
  return { version: RESEARCH_DAG_VERSION, question, steps, report, llmUsed: typeof llm === "function", promotion: "MANUAL_ONLY", controlsExecution: false };
}
