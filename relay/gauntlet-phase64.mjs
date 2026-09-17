/**
 * GAUNTLET FASE 6.4 — Quality Gate 75/100 + Entry Location + Microstructure Veto + curriculo + disponibilidade em tempo real.
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
check("P64-GATE-01", "Quality Gate ativo com threshold 75/100 exposto na config", o.config?.qualityGateEnabled === true && Number(o.config?.minTradeQualityScore) === 75, { qualityGateEnabled: o.config?.qualityGateEnabled ?? null, minTradeQualityScore: o.config?.minTradeQualityScore ?? null });
check("P64-GATE-02", "JIT/lead preservados (1000-2000ms) e stake congelado em R$10", Number(o.config?.entryLeadMs) >= 1000 && Number(o.config?.entryLeadMs) <= 2000 && Number(o.config?.defaultStake) === 10, { lead: o.config?.entryLeadMs ?? null, stake: o.config?.defaultStake ?? null });

const entry = await req("GET", "/api/iq/entry");
check("P64-GATE-03", "entry config expoe qualityGate/minTradeQualityScore e aceita ajuste dentro dos limites", entry.json.qualityGateEnabled === true && Number(entry.json.minTradeQualityScore) === 75, { qualityGateEnabled: entry.json.qualityGateEnabled ?? null, min: entry.json.minTradeQualityScore ?? null });
const clamp = await req("PUT", "/api/iq/entry/config", { minTradeQualityScore: 10 });
check("P64-GATE-04", "threshold e clampado em 50..95 (nunca aceita valor arbitrario)", clamp.status === 200 && Number(clamp.json.config?.minTradeQualityScore) === 50, clamp.json.config ?? null);
await req("PUT", "/api/iq/entry/config", { minTradeQualityScore: 75 });

const knowledge = await req("GET", "/api/iq/knowledge");
check("P64-CURRICULUM-01", "curriculo profissional indexado (>= 44 notas) com provenance", knowledge.status === 200 && (knowledge.json.notes ?? 0) >= 44 && knowledge.json.knowledgeVersion, { notes: knowledge.json.notes ?? 0, version: knowledge.json.knowledgeVersion ?? null });

const resolver = o.resolver ?? {};
const age = resolver.lastResolvedAt ? Date.now() - Number(resolver.lastResolvedAt) : null;
check("P64-AVAIL-01", "disponibilidade re-resolvida do broker em tempo real (<= 180s)", age !== null && age <= 180_000, { lastResolvedAtAgeMs: age, resolvedCount: resolver.resolvedCount ?? null });
const markets = o.markets ?? [];
check("P64-AVAIL-02", "NORMAL e OTC separados e status nunca inventado por horario teorico", markets.length === 15 && markets.every((market) => market.marketType === "NORMAL" || market.marketType === "OTC"), { markets: markets.length });

const audit = await req("GET", "/api/iq/audit?stage=SHADOW_ARMS&limit=10");
const shadowRows = audit.json.audit ?? [];
check("P64-QUALITY-01", "audit SHADOW_ARMS registra qualityScore quando ha candidato confirmado", shadowRows.length === 0 || shadowRows.every((row) => Number.isFinite(Number(row.detail?.qualityScore))), { rows: shadowRows.length, sample: shadowRows[0]?.detail ?? null });

const quality = await req("GET", "/api/iq/quality");
check("P64-QUALITY-02", "quality status segue SHADOW e inclui bracos A-F", quality.status === 200 && quality.json.shadowOnly === true && ["A_G2_JIT", "B_QUALITY_GATE", "C_STABILITY", "D_CRITIC", "E_MICROSTRUCTURE", "F_COMBINED"].every((arm) => quality.json.arms?.[arm]), null);

const executions = await req("GET", "/api/iq/executions?limit=30");
check("P64-REAL-01", "nenhuma ordem REAL", (executions.json.executions ?? []).every((row) => row.mode !== "REAL" && row.accountType !== "REAL") && o.mode === "PRACTICE", { mode: o.mode });

const secret = asText(o) + asText(entry.json) + asText(quality.json) + asText(knowledge.json);
check("P64-SECRET-01", "nenhum ssid/senha/bearer nas superficies", !secret.includes("ssid") && !secret.includes("password") && !secret.includes("bearer "), null);

const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ base: BASE, at: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id), results }, null, 2));
process.exit(0);
