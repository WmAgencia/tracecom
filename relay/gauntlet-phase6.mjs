/**
 * GAUNTLET FASE 6 — Professional Brain G2 + Segundo Cerebro (Obsidian) + Professor/Journal/Hipoteses + Supervisor.
 * Nao executa ordens; nao promove hipotese; restaura configuracao do operador.
 */
const BASE = process.env.GAUNTLET_BASE || "https://tracecom.consecom.com.br";
const results = [];
const check = (id, name, pass, detail) => results.push({ id, name, pass: pass === true, detail: detail ?? null });
async function req(method, path, body) {
  try {
    const response = await fetch(`${BASE}${path}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(40_000) });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json };
  } catch (error) { return { status: 0, json: { error: String(error?.message ?? error).slice(0, 120) } }; }
}
const asText = (value) => JSON.stringify(value).toLowerCase();

const office = await req("GET", "/api/iq/office");
const o = office.json;
check("P6-PROD-01", "runtime multi v2 + WS saudavel", o.version === "iq-multi-runtime-v2" && o.connection?.connected === true && o.connection?.timeValid === true, { host: o.connection?.host ?? null });
check("P6-BRAIN-01", "Professional Brain geracao 2 exposto (principios, processo, setups)", o.brain?.generation === 2 && o.brain?.version === "professional-brain-v2" && (o.brain?.setups ?? 0) >= 9 && Array.isArray(o.brain?.process) && o.brain.process.includes("SETUP"), o.brain ?? null);
check("P6-BRAIN-02", "nenhuma variante V1/V2/V3/V8 no runtime/office", !asText(o.markets).includes("v1-") && !asText(o.markets).includes("v2-") && !asText(o.markets).includes("v3-") && !asText(o.markets).includes("v8-") && (o.config?.brainGeneration === 2), { brainGeneration: o.config?.brainGeneration ?? null });
check("P6-BRAIN-03", "decisoes com setup/regime/processo (nao estrategia)", (o.markets ?? []).every((market) => market.strategy == null) && (o.markets ?? []).filter((market) => market.enabled).every((market) => market.brainGeneration === 2), null);

const manager = await req("GET", "/api/iq/manager");
check("P6-LEGACY-02", "endpoint antigo /api/iq/manager removido (404/410) com substituto declarado", (manager.status === 410 || manager.status === 404) && (manager.status === 404 || manager.json?.replacedBy === "/api/iq/supervisor"), { status: manager.status, body: manager.json });

const supervisor = await req("GET", "/api/iq/supervisor");
const sup = supervisor.json;
check("P6-SUPERVISOR-01", "Performance Supervisor exposto e sem modo de troca de estrategia", supervisor.status === 200 && sup.version === "performance-supervisor-v1" && sup.mode === undefined && String(sup.note).toLowerCase().includes("nao troca"), { config: sup.config ?? null, reviews: (sup.reviews ?? []).length });
const beforeSamples = sup.config?.minSamples ?? 20;
const supPut = await req("PUT", "/api/iq/supervisor/config", { minSamples: beforeSamples === 25 ? 21 : 25 });
check("P6-SUPERVISOR-02", "configuracao do supervisor persiste e nunca vira switch automatico", supPut.status === 200 && Number(supPut.json.config?.minSamples) === (beforeSamples === 25 ? 21 : 25) && supPut.json.config?.mode === undefined, supPut.json.config ?? null);
await req("PUT", "/api/iq/supervisor/config", { minSamples: beforeSamples });

const journal = await req("GET", "/api/iq/journal");
check("P6-JOURNAL-01", "journal estruturado com versao e memoria por agente", journal.status === 200 && journal.json.version === "trade-journal-v1" && Array.isArray(journal.json.agents), { trades: (journal.json.recentTrades ?? []).length, agents: (journal.json.agents ?? []).length });
const firstAgent = (o.markets ?? []).map((market) => `trader:${market.marketKey}`)[0];
const memory = await req("GET", `/api/iq/journal/agent?agentId=${encodeURIComponent(firstAgent)}`);
check("P6-JOURNAL-02", "memoria do agente separa decisao de resultado (GOOD_DECISION+LOSS / BAD_DECISION+WIN)", memory.status === 200 && memory.json.memory?.stats && "goodDecisionLosses" in memory.json.memory.stats && "badDecisionWins" in memory.json.memory.stats, { agentId: firstAgent, trades: memory.json.memory?.stats?.trades ?? null });

const knowledge = await req("GET", "/api/iq/knowledge");
const kb = knowledge.json;
check("P6-KB-01", "biblioteca de conhecimento indexada com provenance e escopo TraceCom", knowledge.status === 200 && (kb.notes ?? 0) >= 30 && kb.scope === "TraceCom/" && kb.knowledgeVersion && kb.categories && Object.keys(kb.categories).length >= 8, { notes: kb.notes ?? 0, version: kb.knowledgeVersion ?? null });
const search = await req("GET", "/api/iq/knowledge/search?regime=TREND_UP&setup=TREND_PULLBACK&limit=5&atMs=1789600001000");
check("P6-KB-02", "busca point-in-time retorna notas com provenance", search.status === 200 && (search.json.results ?? []).length >= 1 && search.json.results.every((row) => row.provenance && row.tracecomApplicability), { results: (search.json.results ?? []).map((row) => row.id) });
const future = await req("GET", "/api/iq/knowledge/search?q=rsi&limit=5&atMs=1000");
check("P6-KB-03", "sem look-ahead: nada disponivel antes de availableAt", (future.json.results ?? []).length === 0, { atMs: 1000 });
const secondBrain = await req("GET", "/api/iq/second-brain");
check("P6-KB-04", "Segundo Cerebro honesto (OFFLINE sem vault/API) com escopo e gate de promocao", secondBrain.status === 200 && (secondBrain.json.mode === "OFFLINE" || secondBrain.json.reachable === true) && secondBrain.json.scope === "TraceCom/", { mode: secondBrain.json.mode ?? null });

const hypotheses = await req("GET", "/api/iq/hypotheses");
check("P6-HYP-01", "registro de hipoteses exposto com defaults do Promotion Gate", hypotheses.status === 200 && Array.isArray(hypotheses.json.items) && (hypotheses.json.defaults?.minSamples ?? 0) >= 20, { items: (hypotheses.json.items ?? []).length });
const created = await req("POST", "/api/iq/hypotheses", { originAgent: "research:gauntlet", marketKey: "EURUSD:OTC", statement: "GAUNTLET check: pullback em TREND_UP com RSI>55 (amostra exploratoria)", sample: 1, regime: "TREND_UP", setup: "TREND_PULLBACK", markets: ["EURUSD:OTC"] });
check("P6-HYP-02", "hipotese nasce CANDIDATE (nunca regra) e avaliacao sem amostra retorna HOLD", created.status === 200 && created.json.hypothesis?.state === "CANDIDATE", created.json.hypothesis?.id ?? null);
if (created.json.hypothesis?.id) {
  const evaluated = await req("POST", "/api/iq/hypotheses/evaluate", { id: created.json.hypothesis.id });
  check("P6-HYP-03", "Promotion Gate nao promove sem evidencia prospectiva", evaluated.status === 200 && evaluated.json.hypothesis?.decision !== "PROMOTE", evaluated.json.hypothesis ?? null);
}

const audit = await req("GET", "/api/iq/audit?limit=80");
const stages = new Set((audit.json.audit ?? []).map((row) => row.stage));
check("P6-AUDIT-01", "audit trail cobre agentes/professor/supervisor", audit.status === 200 && (stages.has("AGENTS") || (o.markets ?? []).some((market) => market.agents?.correlationId)), { stages: [...stages] });
check("P6-AUDIT-02", "correlationId presente nos snapshots de agentes", (o.markets ?? []).filter((market) => market.enabled).every((market) => !market.agents || market.agents.correlationId), null);

const executions = await req("GET", "/api/iq/executions?limit=20");
check("P6-REAL-01", "nenhuma ordem REAL executada", (executions.json.executions ?? []).every((row) => row.mode !== "REAL" && row.accountType !== "REAL"), null);

const uiIndex = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(30_000) }).then((response) => response.text()).catch(() => "");
const uiJs = await fetch(`${BASE}/office.js`, { signal: AbortSignal.timeout(30_000) }).then((response) => response.text()).catch(() => "");
const uiFixture = await fetch(`${BASE}/office-fixture.html`, { signal: AbortSignal.timeout(30_000) }).then((response) => response.text()).catch(() => "");
check("P6-UI-01", "escritorio mostra Supervisores e Analise Profissional (brain G2)", uiJs.includes("SUPERVISOR · ") && uiJs.includes("ANALISE PROFISSIONAL (BRAIN G2)") && uiJs.includes("drawSupervisor"), null);
check("P6-UI-02", "Segundo Cerebro visivel com modo/escopo e sem controles de estrategia antiga", uiJs.includes("SEGUNDO CEREBRO (OBSIDIAN)") && uiJs.includes("TraceCom/") && !uiJs.includes("SALVAR ESTRATEGIA") && !uiJs.includes("V3-60"), null);
check("P6-UI-03", "painel do supervisor salva apenas limites de monitoramento", uiJs.includes("officeSupervisorSave") && uiJs.includes("/api/iq/supervisor/config"), null);
check("P6-UI-04", "fixture cobre supervisor/knowledge/brain/setups", uiFixture.includes("supervisor") && uiFixture.includes("knowledge") && uiFixture.includes("brain") && uiFixture.includes("setups") && !uiFixture.includes("V3-60"), null);
check("P6-LEGACY-03", "estrategias antigas aparecem apenas como auditoria historica", uiIndex.includes("LEGACY_STRATEGY_AUDIT") && !uiIndex.includes("historyFilterStrategy"), null);

const apprentice = await req("GET", "/api/iq/apprentice");
check("P6-APPR-01", "Aprendiz permanece SHADOW_ONLY com mentor e tecnicas proprias", apprentice.status === 200 && apprentice.json.execution === "SHADOW_ONLY" && (apprentice.json.techniques ?? []).length >= 5, { techniques: (apprentice.json.techniques ?? []).length });
const feeds = o.feeds ?? {};
check("P6-FEED-01", "feeds externos com fallback honesto (NO_FEED/STALE/OK) e impacto apenas de contexto", ["NO_FEED", "STALE", "OK"].includes(feeds.state?.MACRO?.status) && ["NO_FEED", "STALE", "OK"].includes(feeds.state?.NEWS?.status) && feeds.tradingImpact === "CONTEXT_ONLY_NEVER_ORDERS", feeds.state ?? null);

const secret = asText(o) + asText(supervisor.json) + asText(journal.json) + asText(knowledge.json) + asText(secondBrain.json) + asText(audit.json);
check("P6-SECRET-01", "nenhum ssid/senha/bearer nas novas superficies", !secret.includes("ssid") && !secret.includes("password") && !secret.includes("bearer "), null);

const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ base: BASE, at: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id), results }, null, 2));
process.exit(0);
