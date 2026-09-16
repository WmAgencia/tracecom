/**
 * GAUNTLET PRODUCAO — criticos frescos contra o runtime real (https://tracecom.consecom.com.br).
 * Nao imprime segredos; nao deixa a execucao armada. Cobre: protocolo/ws/market-data/causalidade/
 * seguranca/gate/idempotencia(historico)/settlement/secret-leak/producao.
 */
const BASE = process.env.GAUNTLET_BASE || "https://tracecom.consecom.com.br";
const results = [];
const check = (id, name, pass, detail) => { results.push({ id, name, pass: pass === true, detail: detail === undefined ? null : detail }); };
async function req(method, path, body) {
  try {
    const response = await fetch(`${BASE}${path}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json };
  } catch (error) { return { status: 0, json: { error: String(error?.message ?? error).slice(0, 120) } }; }
}

const health = await req("GET", "/health");
check("PROD-01", "relay /health 200", health.status === 200 && health.json.ok === true, health.json);
const status = await req("GET", "/api/iq/status");
const md = status.json.marketData ?? {};
const acct = status.json.account ?? {};
const ex = status.json.execution ?? {};
check("WS-01", "runtime WS ativo", ["iq-ws-runtime-v1", "iq-multi-runtime-v2"].includes(status.json.runtimeVersion), status.json.runtimeVersion ?? null);
check("WS-02", "WS conectado", md.connected === true, md.host ?? null);
check("WS-03", "host real esperado (ws.iqoption.com/iqoption.com)", ["ws.iqoption.com", "iqoption.com"].includes(md.host), md.host ?? null);
check("WS-04", "server time validado (+-2s)", md.timeValid === true && Number.isFinite(md.clockSkewMs) && Math.abs(md.clockSkewMs) <= 2_000, { skewMs: md.clockSkewMs ?? null });
check("MD-01", "EUR/USD resolvido em runtime (nunca hardcoded)", Number.isFinite(md.activeId) && (md.activeOtc === true ? md.activeExpectedFromRepo === 76 : md.activeExpectedFromRepo === 1) && md.activeActual2026 !== null && md.activeActual2026 !== undefined, { expected: md.activeExpectedFromRepo, actual: md.activeActual2026, otc: md.activeOtc ?? null, section: md.activeSection ?? null });
check("MD-02", "candles 5s suficientes", Number(md.candles5s) >= 30, md.candles5s ?? 0);
check("MD-03", "ultimo tick fresco (<15s)", Boolean(md.lastTick) && Number(md.lastTick.ageMs) < 15_000, md.lastTick ? { ageMs: md.lastTick.ageMs, price: md.lastTick.price } : null);
check("MD-04", "market data healthy", md.healthy === true, md.healthReasons ?? []);
check("MD-05", "latencia p95 servidor->recebido < 1s", Boolean(md.latencyMs?.serverToReceived?.p95) && md.latencyMs.serverToReceived.p95 < 1_000, md.latencyMs?.serverToReceived ?? null);
check("MD-06", "Feature Engine fresco a partir do WS", Boolean(md.features) && md.features.fresh === true && Number.isFinite(md.features.rsi14), md.features ?? null);
check("MD-07", "zero candles rejeitados", Number(md.candleDiagnostics?.rejected ?? 0) === 0, md.candleDiagnostics ?? null);
const candles = Array.isArray(md.recentCandles) ? md.recentCandles : [];
check("CA-01", "candles ordenados (bucket estritamente crescente)", candles.length >= 3 && candles.every((c, i, a) => i === 0 || c.bucketStart > a[i - 1].bucketStart), candles.length);
check("CA-02", "nenhum candle futuro vs server time", candles.every((c) => Number(c.bucketEnd) <= Number(md.serverTimeMs) + 5_000), { serverTimeMs: md.serverTimeMs ?? null });
check("CA-03", "segmentId/ativo coerentes", candles.every((c) => typeof c.segmentId === "string" && c.segmentId.endsWith(`:${c.bucketStart}`) && /EURUSD/.test(c.segmentId)), candles[0]?.segmentId ?? null);
check("CA-04", "OHLC coerente", candles.every((c) => c.high >= Math.max(c.open, c.close) - 1e-9 && c.low <= Math.min(c.open, c.close) + 1e-9), null);
check("AC-01", "conta PRACTICE verificada server-side", acct.verified === true && acct.type === "PRACTICE", { type: acct.type ?? null, currency: acct.currency ?? null, balance: acct.balance ?? null });
check("AC-02", "REAL detectada permanece proibida", acct.realExecutionForbidden === true && (acct.hasReal !== true || ex.practiceOnly === true), { hasReal: acct.hasReal ?? null, practiceOnly: ex.practiceOnly ?? null });
check("SEC-01", "status sem ssid/senha/bearer", !JSON.stringify(status.json).toLowerCase().includes("ssid") && !JSON.stringify(status.json).toLowerCase().includes("password"), null);
const armNoConfirm = await req("POST", "/api/iq/arm", { limitBrl: 1 });
check("GATE-01", "ARM sem confirmacao explicita bloqueado", armNoConfirm.status === 400 && armNoConfirm.json.error === "EXPLICIT_CONFIRMATION_REQUIRED", armNoConfirm.json);
const armOverLimit = await req("POST", "/api/iq/arm", { limitBrl: 1000, confirmation: "ARM_PRACTICE" });
check("GATE-02", "limite > R$100 bloqueado", armOverLimit.status === 400 && armOverLimit.json.error === "invalid_limit_brl", armOverLimit.json);
const orderNotArmed = await req("POST", "/api/iq/test-order", { direction: "BUY", stake: 1 });
check("GATE-03", "ordem PRACTICE sem ARM bloqueada", orderNotArmed.status === 400 && ["EXECUTION_NOT_ARMED", "ORDER_IN_FLIGHT", "WS_DISCONNECTED"].includes(orderNotArmed.json.error), orderNotArmed.json);
const ksOn = await req("POST", "/api/iq/kill-switch", { engaged: true });
check("GATE-04", "kill switch engata", ksOn.json.killSwitch?.executionEnabled === false, ksOn.json.killSwitch ?? null);
const armKill = await req("POST", "/api/iq/arm", { limitBrl: 1, confirmation: "ARM_PRACTICE" });
check("GATE-05", "ARM bloqueado com kill switch", armKill.status === 400 && armKill.json.error === "KILL_SWITCH_ACTIVE", armKill.json);
const ksOff = await req("POST", "/api/iq/kill-switch", { engaged: false });
check("GATE-06", "REATIVAR libera execucao", ksOff.json.killSwitch?.executionEnabled === true, ksOff.json.killSwitch ?? null);
const armed = await req("POST", "/api/iq/arm", { limitBrl: 1, confirmation: "ARM_PRACTICE" });
check("GATE-07", "ARM explicito funciona (limite <= R$100)", armed.status === 200 && armed.json.armed === true && armed.json.maxPracticeStakeBrl === 100, { state: armed.json.state ?? null, userLimitBrl: armed.json.userLimitBrl ?? null });
const disarmed = await req("POST", "/api/iq/disarm", {});
check("GATE-08", "DISARM imediato pos-gauntlet", disarmed.status === 200 && disarmed.json.armed === false, { disarmReason: disarmed.json.disarmReason ?? null });
const execs = await req("GET", "/api/iq/executions?limit=10");
const settled = (execs.json.executions ?? []).find((row) => row.state === "SETTLED");
check("SET-01", "historico persistido com brokerOrderId real", Boolean(settled && settled.brokerOrderId), settled ? { brokerOrderId: settled.brokerOrderId, state: settled.state } : null);
check("SET-02", "settlement broker x causal registrado", Boolean(settled && settled.brokerResult && settled.causalResult), settled ? { brokerResult: settled.brokerResult, causalResult: settled.causalResult, settlementMismatch: settled.settlementMismatch } : null);
check("SET-03", "idempotencia visivel no historico (keys unicas)", new Set((execs.json.executions ?? []).map((row) => row.idempotencyKey)).size === (execs.json.executions ?? []).length, null);
check("SET-04", "historico sem segredo", !JSON.stringify(execs.json).toLowerCase().includes("ssid"), null);
check("PROD-02", "proxy Vercel servindo UI com painel IQ", (await (await fetch(`${BASE}/`, { signal: AbortSignal.timeout(20_000) })).text()).includes("iqMarketBadge"), null);

const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ base: BASE, at: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id), results }, null, 2));
process.exit(0);
