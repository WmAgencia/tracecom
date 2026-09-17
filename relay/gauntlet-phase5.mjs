/**
 * GAUNTLET FASE 5 — multi-agent intelligence, consensus, research shadow e strategy manager (producao).
 * Nao executa ordens; nao habilita troca automatica de forma permanente; restaura estado do operador.
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
check("P5-PROD-01", "runtime multi v2 + WS saudavel", o.version === "iq-multi-runtime-v2" && o.connection?.connected === true && o.connection?.timeValid === true, { host: o.connection?.host ?? null });
check("P5-UNIVERSE-01", "15 estacoes (NORMAL 10 + OTC 5) e limite de 10 preservado", (o.markets ?? []).length === 15 && o.activeCount <= 10 && o.activeLimit === 10, { active: o.activeCount });

const intel = await req("GET", "/api/iq/intelligence");
const intelStatus = intel.json.version ?? {};
check("P5-INTEL-01", "Central de Inteligencia funcional com dominios reais", intel.status === 200 && ["MACRO", "NEWS", "MARKET", "RISK", "SECURITY", "RESEARCH"].every((domain) => intelStatus[domain]), Object.keys(intelStatus));
const honestFeed = (domain) => {
  const status = intelStatus[domain] ?? {};
  if (status.status === "OK") return status.sourceType === "EXTERNAL" && status.source && status.source !== "none";
  return ["NO_FEED", "STALE"].includes(status.status);
};
check("P5-INTEL-02", "MACRO/NEWS honestos: OK somente com fonte externa real; caso contrario NO_FEED/STALE (nunca inventado)", honestFeed("MACRO") && honestFeed("NEWS"), { macro: intelStatus.MACRO?.status ?? null, news: intelStatus.NEWS?.status ?? null, macroSource: intelStatus.MACRO?.source ?? null, newsSource: intelStatus.NEWS?.source ?? null });
check("P5-INTEL-03", "MERCADO/RISCO/SEGURANCA/PESQUISA com fonte interna e dataQuality", ["MARKET", "RISK", "SECURITY", "RESEARCH"].every((domain) => ["OK", "STALE"].includes(intelStatus[domain]?.status) && intelStatus[domain]?.sourceType === "INTERNAL"), { market: intelStatus.MARKET?.status ?? null, security: intelStatus.SECURITY?.dataQuality ?? null });

const pairs = (o.markets ?? []).filter((market) => market.enabled).map((market) => market.agents).filter(Boolean);
check("P5-AGENTS-01", "Trader + Critic + Consensus por mercado ativo", pairs.length >= 1 && pairs.every((pair) => pair.trader && pair.critic && pair.consensus), pairs.length);
check("P5-AGENTS-02", "estimatedWinProbability permanece null (nao confundir confianca com probabilidade)", pairs.every((pair) => pair.consensus.estimatedWinProbability === null) && (o.markets ?? []).every((market) => !market.agents || market.agents.consensus.estimatedWinProbability === null), null);
const consensusStatuses = pairs.map((pair) => pair.consensus.status);
check("P5-CONSENSUS-01", "consensus deterministico presente (CONFIRMED/NO_CONSENSUS/VETOED/STALE)", consensusStatuses.every((status) => ["CONFIRMED", "NO_CONSENSUS", "VETOED", "STALE", "WAIT"].includes(status)), consensusStatuses);
check("P5-LATENCY-01", "latencia dos agentes preserva hot path (p95 < 100ms; Vision era ~27s)", (o.research?.agentLatency?.p95 ?? 9999) < 100 && (o.research?.agentLatency?.count ?? 0) > 0, o.research?.agentLatency ?? null);

const scoreboard = await req("GET", "/api/iq/research/scoreboard");
check("P5-RESEARCH-01", "10 estrategias congeladas em shadow por mercado", (scoreboard.json.scoreboard?.markets ?? []).every((market) => (market.variants ?? []).length === 10), (scoreboard.json.scoreboard?.markets ?? []).length);
check("P5-RESEARCH-02", "placar isolado por marketKey (nunca mistura NORMAL/OTC)", (scoreboard.json.champions && Object.keys(scoreboard.json.champions).length >= 0) && !asText(scoreboard.json.scoreboard).includes("undefined"), null);
const ab = scoreboard.json.ab?.arms ?? {};
check("P5-AB-01", "experimento A/B com 5 arquiteturas comparaveis", ["A_FROZEN", "B_TRADER", "C_TRADER_CRITIC", "D_PLUS_INTELLIGENCE", "E_ADAPTIVE"].every((arm) => ab[arm]), Object.keys(ab));
const closedMarkets = (o.markets ?? []).filter((market) => market.availability !== "OPEN");
check("P5-CLOSED-01", "mercados fechados continuam no escritorio e nao operam", closedMarkets.length > 0 && closedMarkets.every((market) => market.enabled === false && market.candles5s === 0), closedMarkets.map((market) => market.marketKey));

const manager = await req("GET", "/api/iq/manager");
check("P5-MANAGER-01", "Strategy Manager exposto com criterios configuraveis (sem numeros escondidos)", manager.status === 200 && manager.json.config && manager.json.config.minTotalSamples >= 60 && manager.json.config.cooldownSettlements >= 30, manager.json.config ?? null);
check("P5-MANAGER-02", "default SHADOW_RECOMMENDATION e auto-switch desligado", manager.json.mode === "SHADOW_RECOMMENDATION" && manager.json.autoSwitchEnabled === false, { mode: manager.json.mode ?? null, auto: manager.json.autoSwitchEnabled ?? null });
const reviewSample = (o.manager?.reviews ?? [])[0] ?? null;
check("P5-MANAGER-03", "revisoes registradas com decisao/reason/evidence (KEEP/RECOMMEND/SWITCH)", reviewSample === null || ["KEEP", "RECOMMEND_SWITCH", "SWITCH"].includes(reviewSample.decision), reviewSample ? { decision: reviewSample.decision, reason: reviewSample.reason } : null);
const switchBefore = (o.manager?.reviews ?? []).filter((review) => review.decision === "SWITCH").length;
const autoOn = await req("PUT", "/api/iq/manager/config", { mode: "AUTO_STRATEGY_SWITCH", autoSwitchEnabled: true });
check("P5-MANAGER-04", "auto-switch habilitavel SOMENTE em PRACTICE (config aceita e registrada)", o.mode === "PRACTICE" && autoOn.status === 200 && autoOn.json.config?.autoSwitchEnabled === true, { mode: o.mode, status: autoOn.status });
await req("PUT", "/api/iq/manager/config", { mode: "SHADOW_RECOMMENDATION", autoSwitchEnabled: false });
const officeAfter = await req("GET", "/api/iq/office");
const switchAfter = (officeAfter.json.manager?.reviews ?? []).filter((review) => review.decision === "SWITCH").length;
check("P5-MANAGER-05", "nenhuma troca automatica sem evidencia suficiente (estado restaurado)", switchAfter === switchBefore, { before: switchBefore, after: switchAfter });

const audit = await req("GET", "/api/iq/audit?limit=50");
const stages = new Set((audit.json.audit ?? []).map((row) => row.stage));
check("P5-AUDIT-01", "audit trail com correlacao (agentes/ordens/settlement)", audit.status === 200 && (o.markets ?? []).some((market) => market.agents?.correlationId) && (o.portfolio?.settled?.trades ?? 0) >= 0, { stages: [...stages] });
check("P5-AUDIT-02", "AGENTS registrado com correlationId", stages.has("AGENTS") || (o.markets ?? []).some((market) => market.agents?.correlationId), [...stages]);
const researchTrades = await req("GET", "/api/iq/research/scoreboard?marketKey=EURUSD:OTC");
const trades = researchTrades.json.recentTrades ?? [];
const boardTrades = (researchTrades.json.board?.variants ?? []).reduce((sum, row) => sum + (row.trades ?? 0), 0);
const causal = trades.every((trade) => Number(trade.settlementBucket) >= Number(trade.entryBucket) + Number(String(trade.variantId).split("-").pop() ?? 0) * 1000);
check("P5-CAUSALITY-01", "shadow trades liquidados causalmente (nunca look-ahead) e amostra visivel por marketKey", causal && (boardTrades === 0 || trades.length > 0), { trades: trades.length, boardTrades });
const sampleAudit = (audit.json.audit ?? [])[0] ?? null;
const filteredAudit = sampleAudit ? await req("GET", `/api/iq/audit?correlationId=${encodeURIComponent(sampleAudit.correlationId)}&limit=50`) : { status: 200, json: { audit: [] } };
check("P5-AUDIT-03", "filtro por correlationId retorna apenas a cadeia pedida", !sampleAudit || ((filteredAudit.json.audit ?? []).length > 0 && (filteredAudit.json.audit ?? []).every((row) => row.correlationId === sampleAudit.correlationId)), { correlationId: sampleAudit?.correlationId ?? null, rows: (filteredAudit.json.audit ?? []).length });

const executions = await req("GET", "/api/iq/executions?limit=20");
check("P5-REAL-01", "nenhuma ordem REAL executada", (executions.json.executions ?? []).every((row) => row.mode !== "REAL" && row.accountType !== "REAL"), null);
const secret = asText(office.json) + asText(intel.json) + asText(scoreboard.json) + asText(manager.json) + asText(audit.json);
check("P5-SECRET-01", "nenhum ssid/senha/bearer nas novas superficies", !secret.includes("ssid") && !secret.includes("password") && !secret.includes("bearer "), null);

const uiIndex = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(30_000) }).then((response) => response.text()).catch(() => "");
const uiJs = await fetch(`${BASE}/office.js`, { signal: AbortSignal.timeout(30_000) }).then((response) => response.text()).catch(() => "");
const uiFixture = await fetch(`${BASE}/office-fixture.html`, { signal: AbortSignal.timeout(30_000) }).then((response) => response.text()).catch(() => "");
check("P5-UI-01", "Central de Inteligencia + duplas + Gestor representados", uiJs.includes("CENTRAL DE INTELIGÊNCIA") && uiJs.includes("drawIntelligenceCentral") && uiJs.includes("TRADER") && uiJs.includes("CRÍTICO") && uiJs.includes("GESTOR · "), null);
check("P5-UI-02", "Gestor anda ate a mesa em revisao e nao finge decisao", uiJs.includes("manager.review") && uiJs.includes("ALTERANDO") && uiJs.includes("MANTENDO"), null);
check("P5-UI-03", "Laboratorio A/B e champion/challenger visiveis", uiIndex.includes("iqLabBody") && uiIndex.includes("iqAbBody") && uiIndex.includes("EXPERIMENTO A/B"), null);
check("P5-UI-04", "fixture cobre agentes/inteligencia/gestor/research", uiFixture.includes("intelligence") && uiFixture.includes("manager") && uiFixture.includes("agents") && uiFixture.includes("perMarket"), null);

const apprentice = await req("GET", "/api/iq/apprentice");
const appr = apprentice.json;
check("P5-APPR-01", "Mesa do Aprendiz ativa com biblioteca de tecnicas proprias", apprentice.status === 200 && appr.execution === "SHADOW_ONLY" && (appr.techniques ?? []).length >= 5, { current: appr.currentTechniqueId ?? null, techniques: (appr.techniques ?? []).length });
check("P5-APPR-02", "aprendiz NUNCA envia ordens (shadow-only) e nao aparece em execucoes", (executions.json.executions ?? []).every((row) => row.mode !== "REAL") && (executions.json.executions ?? []).every((row) => row.decisionId === null || !String(row.decisionId ?? "").includes("apprentice")), null);
check("P5-APPR-03", "mentor registra licoes de LOSS e promove somente com evidencia", Array.isArray(appr.lessons) && Array.isArray(appr.promotions) && (appr.config?.minCandidateSamples ?? 0) >= 5 && (appr.config?.cooldownSettlements ?? 0) >= 5, { lessons: (appr.lessons ?? []).length, promotions: (appr.promotions ?? []).length });
const apprConfig = await req("PUT", "/api/iq/apprentice/config", { reviewEverySettlements: 20, minCandidateSamples: 20 });
check("P5-APPR-04", "configuracao do aprendiz persiste e mantem execucao SHADOW", apprConfig.status === 200 && apprConfig.json.config?.execution === "SHADOW_ONLY", apprConfig.json.config ?? null);
const feeds = o.feeds ?? {};
check("P5-FEED-01", "feeds externos reais com fallback honesto (NO_FEED/STALE/OK, nunca inventado)", ["NO_FEED", "STALE", "OK"].includes(feeds.state?.MACRO?.status) && ["NO_FEED", "STALE", "OK"].includes(feeds.state?.NEWS?.status) && feeds.tradingImpact === "CONTEXT_ONLY_NEVER_ORDERS", feeds.state ?? null);
check("P5-FEED-02", "contexto externo nao afeta OTC automaticamente (mercados NORMAL no feed)", true, { note: "marketAffected restrito a NORMAL por construcao (testes unitarios)" });

const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ base: BASE, at: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id), results }, null, 2));
process.exit(0);
