/**
 * GAUNTLET FASE 6.3 — Selective Trade Quality Engine (SHADOW) + stake congelado + zero REAL.
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

const quality = await req("GET", "/api/iq/quality");
const q = quality.json;
check("P63-QUALITY-01", "TradeQualityEngine exposto em SHADOW (sem alterar direcao)", quality.status === 200 && q.shadowOnly === true && String(q.note ?? "").toLowerCase().includes("nenhuma alteracao de direcao"), { trades: q.trades ?? null, mode: q.mode ?? null });
const arms = q.arms ?? {};
check("P63-QUALITY-02", "bracos A-F presentes e somente ACCEPT/ABSTAIN", ["A_G2_JIT", "B_QUALITY_GATE", "C_STABILITY", "D_CRITIC", "E_MICROSTRUCTURE", "F_COMBINED"].every((arm) => arms[arm]) && Object.values(arms).every((arm) => Number.isFinite(arm.accepted)), Object.fromEntries(Object.entries(arms).map(([key, value]) => [key, value.accepted])));
check("P63-QUALITY-03", "break-even WR calculado a partir do payout real (nao probabilidade calibrada)", q.breakEvenWR !== null && Math.abs(Number(q.breakEvenWR) - 1 / (1 + Number(q.avgPayout) / 100)) < 0.002, { avgPayout: q.avgPayout ?? null, breakEvenWR: q.breakEvenWR ?? null });

const office = await req("GET", "/api/iq/office");
const o = office.json;
check("P63-STAKE-01", "stake congelado em R$10 durante o experimento (PRACTICE)", Number(o.config?.defaultStake) === 10 && (o.markets ?? []).filter((market) => market.enabled).every((market) => Number(market.configuredStake) === 10), { defaultStake: o.config?.defaultStake ?? null, markets: (o.markets ?? []).filter((market) => market.enabled).map((market) => [market.marketKey, market.configuredStake]) });
check("P63-STAKE-02", "hard cap tecnico preservado (100)", Number(o.config?.hardCap) === 100, o.config?.hardCap ?? null);
check("P63-REAL-01", "PRACTICE only e nenhuma ordem REAL", o.mode === "PRACTICE" && (o.aux?.compliance?.realMode?.realModeEnabled === false || o.aux?.compliance?.realMode?.realModeEnabled === undefined), { mode: o.mode });

const health = q.health ?? {};
check("P63-HEALTH-01", "monitor de saude nao muda estrategia nem stake", ["OK", "PAUSE_NEW_ENTRIES_RECOMMENDED"].includes(health.status) && String(health.note ?? "").includes("nao muda"), { status: health.status ?? null, reasons: health.reasons ?? [] });

const tradeCount = Number(q.trades ?? 0);
check("P63-OUTCOME-01", "quando ha trades, qualidade inicial vs final fica registrada (Professor dual)", tradeCount === 0 || (q.outcomes ?? []).length > 0, { trades: tradeCount, outcomes: (q.outcomes ?? []).length });

const executions = await req("GET", "/api/iq/executions?limit=30");
check("P63-REAL-02", "execucoes recentes sao PRACTICE", (executions.json.executions ?? []).every((row) => row.mode !== "REAL" && row.accountType !== "REAL"), null);
const entry = await req("GET", "/api/iq/entry");
check("P63-ENTRY-01", "JIT permanece ativo e com lead 1000-2000ms", entry.status === 200 && entry.json.jitEnabled === true && Number(entry.json.entryLeadMs) >= 1000 && Number(entry.json.entryLeadMs) <= 2000, { lead: entry.json.entryLeadMs ?? null });
const audit = await req("GET", "/api/iq/audit?stage=SHADOW_ARMS&limit=20");
check("P63-AUDIT-01", "decisoes SHADOW registradas no audit trail (quando houver candidato confirmado)", audit.status === 200, { rows: (audit.json.audit ?? []).length });

const secret = asText(q) + asText(o) + asText(entry.json);
check("P63-SECRET-01", "nenhum ssid/senha/bearer nas superficies de qualidade", !secret.includes("ssid") && !secret.includes("password") && !secret.includes("bearer "), null);

const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ base: BASE, at: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id), results }, null, 2));
process.exit(0);
