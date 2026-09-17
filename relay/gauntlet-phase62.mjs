/**
 * GAUNTLET FASE 6.2 — Just-in-Time entry (candidato -> janela -> revalidacao -> commit).
 * Nao executa ordens; restaura configuracao de entrada do operador; PRACTICE only.
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

const entry = await req("GET", "/api/iq/entry");
const e = entry.json;
check("P62-ENTRY-01", "entry timing exposto com JIT ligado e lead dentro de 1000-2000ms", entry.status === 200 && e.jitEnabled === true && Number(e.entryLeadMs) >= 1000 && Number(e.entryLeadMs) <= 2000 && Number(e.entryWindowMaxDriftMs) >= 0, { jitEnabled: e.jitEnabled ?? null, entryLeadMs: e.entryLeadMs ?? null, maxDriftMs: e.entryWindowMaxDriftMs ?? null });
check("P62-ENTRY-02", "vebrao prospectivo early-vs-JIT presente e nunca avalia os trades antigos", e.scoreboard?.version === "entry-timing-experiment-v1" && e.scoreboard?.arms?.EARLY_DECISION_SHADOW && e.scoreboard?.arms?.JUST_IN_TIME_ENTRY && String(e.scoreboard?.note ?? "").includes("nunca usar os 15 trades"), e.scoreboard?.counters ?? null);

const office = await req("GET", "/api/iq/office");
const o = office.json;
check("P62-OFFICE-01", "office expoe config de entrada e entryTiming por mercado", o.config?.jitEnabled === true && Number(o.config?.entryLeadMs) >= 1000 && o.entryTiming?.version === "entry-timing-v1" && Boolean(o.entryTiming?.scoreboard?.counters), { entryLeadMs: o.config?.entryLeadMs ?? null, counters: o.entryTiming?.scoreboard?.counters ?? null });
const withCandidate = (o.markets ?? []).filter((market) => market.entryTiming && ["WAITING_WINDOW", "CONFIRMED", "ORDER_SENT", "CANCELLED", "WINDOW_MISSED", "GATE_BLOCKED"].includes(market.entryTiming.status));
check("P62-OFFICE-02", "candidatos visiveis com janela alvo alinhada a 60s e stage de UI", withCandidate.length === 0 || withCandidate.every((market) => market.entryTiming.targetEntryAt % 60_000 === 0 && typeof market.entryTiming.stage === "string"), withCandidate.map((market) => ({ key: market.marketKey, stage: market.entryTiming.stage, target: market.entryTiming.targetEntryAt })));

const beforeLead = Number(e.entryLeadMs) || 1500;
const changed = beforeLead === 1600 ? 1400 : 1600;
const put = await req("PUT", "/api/iq/entry/config", { entryLeadMs: changed, entryWindowMaxDriftMs: 2500 });
check("P62-CONFIG-01", "lead configuravel (bounded 1000-2000ms) e persistido", put.status === 200 && Number(put.json.config?.entryLeadMs) === changed, put.json.config ?? null);
await req("PUT", "/api/iq/entry/config", { entryLeadMs: beforeLead, entryWindowMaxDriftMs: e.entryWindowMaxDriftMs ?? 2500 });
const restored = await req("GET", "/api/iq/entry");
check("P62-CONFIG-02", "configuracao do operador restaurada", Number(restored.json.entryLeadMs) === beforeLead, { entryLeadMs: restored.json.entryLeadMs ?? null });

const capped = await req("PUT", "/api/iq/entry/config", { entryLeadMs: 500 });
check("P62-CONFIG-03", "lead fora dos limites e clampeado para 1000ms", capped.status === 200 && Number(capped.json.config?.entryLeadMs) === 1000, capped.json.config ?? null);
await req("PUT", "/api/iq/entry/config", { entryLeadMs: beforeLead });

const auditCreated = await req("GET", "/api/iq/audit?stage=CANDIDATE_CREATED&limit=20");
const auditRevalidation = await req("GET", "/api/iq/audit?stage=FINAL_REVALIDATION&limit=50");
const auditCancelled = await req("GET", "/api/iq/audit?stage=CANDIDATE_CANCELLED&limit=50");
const auditAck = await req("GET", "/api/iq/audit?stage=BROKER_ACK&limit=50");
const auditSent = await req("GET", "/api/iq/audit?stage=ORDER_SENT&limit=50");
const stagesPresent = [auditCreated.json.audit, auditRevalidation.json.audit, auditCancelled.json.audit, auditAck.json.audit, auditSent.json.audit].filter((rows) => (rows ?? []).length > 0).length;
check("P62-AUDIT-01", "audit trail com estagios do pipeline JIT (created/revalidacao/cancel/ack/order)", stagesPresent >= 2, { created: (auditCreated.json.audit ?? []).length, revalidations: (auditRevalidation.json.audit ?? []).length, cancellations: (auditCancelled.json.audit ?? []).length, acks: (auditAck.json.audit ?? []).length });
const ackRows = (auditAck.json.audit ?? []).filter((row) => row.detail?.entryDriftMs !== undefined && row.detail?.entryDriftMs !== null);
check("P62-AUDIT-02", "BROKER_ACK registra targetEntryAt/effectiveEntryAt/entryDriftMs", ackRows.length > 0, ackRows.slice(0, 3).map((row) => row.detail));

const executions = await req("GET", "/api/iq/executions?limit=50");
const jit = (executions.json.executions ?? []).filter((row) => row.meta?.entryTiming?.targetEntryAt || row.entryTiming);
check("P62-EXEC-01", "execucoes novas carregam entryTiming no meta (target/lead/submit)", jit.length > 0 && jit.every((row) => Number.isFinite(Number(row.meta?.entryTiming?.targetEntryAt ?? row.entryTiming?.targetEntryAt))), jit.slice(0, 2).map((row) => row.meta?.entryTiming ?? row.entryTiming ?? null));
check("P62-REAL-01", "nenhuma ordem REAL", (executions.json.executions ?? []).every((row) => row.mode !== "REAL" && row.accountType !== "REAL"), null);

const uiJs = await fetch(`${BASE}/office.js`, { signal: AbortSignal.timeout(30_000) }).then((response) => response.text()).catch(() => "");
check("P62-UI-01", "UI com estados reais do JIT (observacao/janela/revalidando/enviando/cancelado)", ["OPORTUNIDADE EM OBSERVA", "AGUARDANDO JANELA", "REVALIDANDO", "ENVIANDO ORDEM", "OPORTUNIDADE CANCELADA"].every((token) => uiJs.includes(token)), null);
check("P62-UI-02", "contagem regressiva vem do backend (secondsToRevalidation) e painel de config existe", uiJs.includes("secondsToRevalidation") && uiJs.includes("officeEntrySave") && uiJs.includes("ENTRADA JUST-IN-TIME"), null);

const secret = asText(entry.json) + asText(office.json) + asText(auditCreated.json) + asText(auditAck.json);
check("P62-SECRET-01", "nenhum ssid/senha/bearer nas superficies JIT", !secret.includes("ssid") && !secret.includes("password") && !secret.includes("bearer "), null);

const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ base: BASE, at: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id), results }, null, 2));
process.exit(0);
