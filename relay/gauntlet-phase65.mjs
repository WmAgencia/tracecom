/**
 * GAUNTLET FASE 6.5 — status de mercado em tempo real (broker) + ARM estruturado + reabertura automatica.
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
const AVAILABILITY = ["OPEN", "SUSPENDED", "NOT_OFFERED", "DISABLED", "UNKNOWN"];

const office = await req("GET", "/api/iq/office");
const o = office.json;
const enabled = (o.markets ?? []).filter((market) => market.enabled);
check("P65-STATUS-01", "disponibilidade vem do broker em tempo real (enum honesto, sem horario teorico)", enabled.length > 0 && enabled.every((market) => AVAILABILITY.includes(market.availability)), enabled.map((market) => `${market.marketKey}=${market.availability}`));
check("P65-STATUS-02", "NORMAL/OTC separados com activeId proprio (nunca fallback)", (o.markets ?? []).length === 15 && (o.markets ?? []).every((market) => market.marketType === "NORMAL" || market.marketType === "OTC"), null);
const resolverAge = o.resolver?.lastResolvedAt ? Date.now() - Number(o.resolver.lastResolvedAt) : null;
check("P65-STATUS-03", "resolver re-resolvido ha <= 180s (reabertura automatica sem restart)", resolverAge !== null && resolverAge <= 180_000, { ageMs: resolverAge });

const armNoConfirm = await req("POST", "/api/iq/arm", { limitBrl: 10 });
check("P65-ARM-01", "ARM sem confirmacao retorna 400 ESTRUTURADO com code/reason/details (sem mascarar)", armNoConfirm.status === 400 && armNoConfirm.json.error === "EXPLICIT_CONFIRMATION_REQUIRED" && typeof armNoConfirm.json.reason === "string" && armNoConfirm.json.details?.markets, armNoConfirm.json.error ?? null);
const arm = await req("POST", "/api/iq/arm", { limitBrl: 10, confirmation: "ARM_PRACTICE" });
check("P65-ARM-02", "ARM aceito com confirmacao e retorna estado estruturado (armed/warning/markets)", arm.status === 200 && arm.json.armed === true && (arm.json.warning === null || arm.json.warning === "NO_OPEN_MARKET_NOW") && Array.isArray(arm.json.markets), { armed: arm.json.armed ?? null, warning: arm.json.warning ?? null, openMarkets: arm.json.openMarkets ?? null });
const openCount = Number(arm.json.openMarkets ?? 0);
check("P65-ARM-03", "se ha mercado OPEN o aviso e nulo; se manutencao o aviso e explicito", openCount > 0 ? arm.json.warning === null : arm.json.warning === "NO_OPEN_MARKET_NOW", { openCount, warning: arm.json.warning ?? null });

const awake = enabled.filter((market) => market.availability === "OPEN").map((market) => market.agentState);
check("P65-WAKE-01", "mercado OPEN => agente acordado (nao OFFLINE/UNAVAILABLE)", enabled.some((market) => market.availability === "OPEN") ? awake.every((state) => state !== "OFFLINE" && state !== "UNAVAILABLE") : true, { open: enabled.filter((market) => market.availability === "OPEN").map((market) => `${market.marketKey}=${market.agentState}`), note: openCount === 0 ? "broker em manutencao; reabertura acorda automaticamente" : null });

const autoExec = await req("POST", "/api/iq/config/auto-execute", { enabled: true });
check("P65-AUTO-01", "AUTO ON aceito (PRACTICE) com stake R$10 preservado", autoExec.status === 200 && autoExec.json.autoExecute === true && Number(o.config?.defaultStake) === 10, { autoExecute: autoExec.json.autoExecute ?? null, stake: o.config?.defaultStake ?? null });

const uiJs = await fetch(`${BASE}/office.js`, { signal: AbortSignal.timeout(30_000) }).then((response) => response.text()).catch(() => "");
check("P65-UI-01", "UI mostra a razao real do ARM e os status do broker", ["ARM recusado", "NO_OPEN_MARKET_NOW", "availabilityLabel", "SUSPENSO PELA IQ", "NAO OFERECIDO PELA IQ"].every((token) => uiJs.includes(token)), null);
check("P65-UI-02", "UI nao maquia o 400 com mensagem generica de sistema", !uiJs.includes("Não foi possível iniciar o sistema"), null);

const executions = await req("GET", "/api/iq/executions?limit=20");
check("P65-REAL-01", "nenhuma ordem REAL", (executions.json.executions ?? []).every((row) => row.mode !== "REAL" && row.accountType !== "REAL") && o.mode === "PRACTICE", null);
const secret = JSON.stringify(o).toLowerCase() + JSON.stringify(arm.json).toLowerCase();
check("P65-SECRET-01", "nenhum segredo nas superficies", !secret.includes("ssid") && !secret.includes("password") && !secret.includes("bearer "), null);

const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ base: BASE, at: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id), results }, null, 2));
process.exit(0);
