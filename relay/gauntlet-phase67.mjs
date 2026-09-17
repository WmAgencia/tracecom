/**
 * GAUNTLET FASE 6.7 — probes de infraestrutura nao geram posicao nem contaminam estatisticas.
 */
const BASE = process.env.GAUNTLET_BASE || "https://tracecom.consecom.com.br";
const results = [];
const check = (id, name, pass, detail) => results.push({ id, name, pass: pass === true, detail: detail ?? null });
async function req(method, path) {
  try {
    const response = await fetch(`${BASE}${path}`, { method, signal: AbortSignal.timeout(60_000) });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json };
  } catch (error) { return { status: 0, json: { error: String(error?.message ?? error).slice(0, 120) } }; }
}

const audit = await req("GET", "/api/iq/broker-audit?live=0&probe=USDJPY:OTC");
const probe = audit.json.probe ?? {};
check("P67-PROBE-01", "probe padrao NAO cria ordem (ordering=false, sem accepted/disposition de execucao)", audit.status === 200 && probe.ordering === false && probe.accepted === undefined && (probe.tradable === true || probe.tradable === false || probe.tradable === null), { ordering: probe.ordering ?? null, tradable: probe.tradable ?? null, evidence: probe.evidence ? Object.keys(probe.evidence) : null });

const quality = await req("GET", "/api/iq/quality");
const q = quality.json;
check("P67-STATS-01", "estatisticas prospectivas sem contaminacao de infra (trades = apenas agentes)", quality.status === 200 && Array.isArray(q.outcomes) && (q.outcomes ?? []).every((row) => !String(row.tradeId ?? "").toLowerCase().includes("probe")), { trades: q.trades ?? null, outcomes: (q.outcomes ?? []).length });

const executions = await req("GET", "/api/iq/executions?limit=50");
const infraExecs = (executions.json.executions ?? []).filter((row) => row.meta?.infraProbe === true || row.meta?.excludedFromStats === true);
check("P67-STATS-02", "execucoes de infra, quando existirem, ficam marcadas excludedFromStats", infraExecs.every((row) => row.meta?.excludedFromStats === true), { infraExecutions: infraExecs.length });

const journal = await req("GET", "/api/iq/journal");
const infraTrades = (journal.json.recentTrades ?? []).filter((row) => String(row.tradeId ?? "").toLowerCase().includes("probe") || row.setup === "INFRA_PROBE");
check("P67-STATS-03", "journal nunca registra trades de probe/INFRA_PROBE", infraTrades.length === 0, { entries: (journal.json.recentTrades ?? []).length });

const reopened = await req("GET", "/api/iq/audit?stage=REOPEN_VALIDATION&limit=5");
const rows = reopened.json.audit ?? [];
check("P67-REOPEN-01", "transicao para OPEN grava REOPEN_VALIDATION com broker/resolver/agente/feed/ARM", rows.length === 0 || rows.every((row) => ["brokerOpen", "resolverOpen", "agentAwake", "feedFresh", "armed", "serverNow"].every((key) => key in (row.detail ?? {}))), { rows: rows.length, sample: rows[0]?.detail ?? null });

const orderProbeHint = await req("GET", "/api/iq/broker-audit?live=0");
check("P67-PROBE-02", "broker-audit expoe evidencia bruta e modo nao-ordering por padrao", orderProbeHint.status === 200 && orderProbeHint.json.debug === true && Array.isArray(orderProbeHint.json.evidence?.rows), null);

const office = await req("GET", "/api/iq/office");
check("P67-REAL-01", "PRACTICE only, zero REAL, stake R$10", office.json.mode === "PRACTICE" && (executions.json.executions ?? []).every((row) => row.mode !== "REAL" && row.accountType !== "REAL") && Number(office.json.config?.defaultStake) === 10, { mode: office.json.mode ?? null, stake: office.json.config?.defaultStake ?? null });

const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ base: BASE, at: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id), results }, null, 2));
process.exit(0);
