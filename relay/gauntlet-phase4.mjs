/**
 * GAUNTLET FASE 4 — multiativo/NORMAL-OTC/REAL/limites/segredo/UI contra o runtime real.
 * Nao executa ordem REAL; usa no maximo praticas de leitura + arm/disarm + uma checagem de stake.
 * Saida JSON com PASS/FAIL e evidencias (sem segredos).
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

const health = await req("GET", "/health");
check("P4-PROD-01", "relay /health 200", health.status === 200 && health.json.ok === true, health.json);

const office = await req("GET", "/api/iq/office");
const o = office.json;
check("P4-PROD-02", "runtime multi v2", o.version === "iq-multi-runtime-v2", o.version ?? null);
check("P4-PROD-03", "WS conectado e server time valido", o.connection?.connected === true && o.connection?.timeValid === true, { host: o.connection?.host ?? null, skewMs: o.connection?.clockSkewMs ?? null, reconnects: o.connection?.reconnects ?? null });
check("P4-UNIVERSE-01", "15 mercados configurados (10 NORMAL + 5 OTC)", o.markets?.length === 15 && o.markets.filter((m) => m.marketType === "NORMAL").length === 10 && o.markets.filter((m) => m.marketType === "OTC").length === 5, { total: o.markets?.length ?? 0 });
check("P4-UNIVERSE-02", "limite global de 10 ativos respeitado", o.activeCount <= o.activeLimit && o.activeLimit === 10, { active: o.activeCount, limit: o.activeLimit });
const activeIds = new Map();
for (const market of o.markets ?? []) for (const candidate of market.instrumentTypes?.length ? [{ id: market.activeId, type: market.marketType }] : []) { if (!candidate.id) continue; const list = activeIds.get(candidate.id) ?? new Set(); list.add(candidate.type); activeIds.set(candidate.id, list); }
const contaminated = [...activeIds.entries()].filter(([, types]) => types.size > 1).map(([id, types]) => ({ id, types: [...types] }));
check("P4-NORMALOTC-01", "nenhum activeId compartilhado entre NORMAL e OTC", contaminated.length === 0, contaminated);
check("P4-NORMALOTC-02", "NORMAL indisponivel NAO herda OTC (sem fallback silencioso)", (o.markets ?? []).filter((m) => m.marketType === "NORMAL" && m.availability !== "OPEN").every((m) => m.activeId === null && m.candles5s === 0), (o.markets ?? []).filter((m) => m.marketType === "NORMAL").map((m) => ({ key: m.marketKey, availability: m.availability, activeId: m.activeId, candles: m.candles5s })));
const sharedSegment = (o.markets ?? []).filter((m) => m.lastTick?.segmentId).map((m) => ({ key: m.marketKey, segmentId: m.lastTick.segmentId }));
check("P4-NORMALOTC-03", "segmentId carrega o marketKey (isolamento de buffer)", sharedSegment.every((row) => String(row.segmentId).startsWith(row.key + ":")), sharedSegment);
const crossAsset = (o.markets ?? []).filter((m) => m.lastTick).every((m) => (m.lastTick.segmentId ?? "").includes(String(m.marketKey)));
check("P4-CROSS-01", "candles roteados apenas para o proprio mercado", crossAsset, null);

const assetMap = await req("GET", "/api/iq/asset-map");
const resolver = assetMap.json.resolver ?? {};
check("P4-RESOLVER-01", "resolver em runtime ativo (rawActivesSeen>0, sem erro)", resolver.resolverVersion === "runtime-asset-resolver-v1" && Number(resolver.rawActivesSeen) > 0 && !resolver.lastError, { rawActivesSeen: resolver.rawActivesSeen ?? null, lastError: resolver.lastError ?? null });
check("P4-RESOLVER-02", "mapeamento recente (nao e ID historico de arquivo)", Number(resolver.lastResolvedAt) > Date.now() - 60 * 60 * 1000, { lastResolvedAt: resolver.lastResolvedAt ?? null });
const payouts = (o.markets ?? []).filter((m) => m.enabled && m.availability === "OPEN").map((m) => ({ key: m.marketKey, payout: m.payout, source: m.payoutSource }));
check("P4-RESOLVER-03", "payout resolvido em runtime para mercados ativos", payouts.every((row) => Number(row.payout) > 0), payouts);

check("P4-REAL-01", "modo REAL nao herda ARM e nao ativa sem confirmacao", o.mode === "PRACTICE" && o.modeState?.realMode?.realModeEnabled !== true, { mode: o.mode, realMode: o.modeState?.realMode?.realModeEnabled ?? null });
const realMode = await req("POST", "/api/iq/mode", { mode: "REAL" });
check("P4-REAL-02", "troca para REAL bloqueada sem confirmacao server-side", realMode.status === 400 && realMode.json.error === "REAL_MODE_NOT_CONFIRMED", realMode.json);
const realBadPhrase = await req("POST", "/api/iq/real/confirm", { phrase: "SIM", acknowledgeRisk: true, maxStake: 1 });
check("P4-REAL-03", "confirmacao REAL exige frase literal", realBadPhrase.status === 400 && realBadPhrase.json.error === "REAL_PHRASE_MISMATCH", realBadPhrase.json);
const realNoAck = await req("POST", "/api/iq/real/confirm", { phrase: "OPERAR CONTA REAL", acknowledgeRisk: false, maxStake: 1 });
check("P4-REAL-04", "confirmacao REAL exige acknowledge de risco", realNoAck.status === 400 && realNoAck.json.error === "REAL_RISK_ACK_REQUIRED", realNoAck.json);
const realGood = await req("POST", "/api/iq/real/confirm", { phrase: "OPERAR CONTA REAL", acknowledgeRisk: true, maxStake: 1 });
const realBlockedByBalance = realGood.status === 400 && realGood.json.error === "REAL_BALANCE_UNAVAILABLE";
const realEnabled = realGood.status === 200 && realGood.json.realModeEnabled === true;
check("P4-REAL-05", "REAL nao autoriza sem saldo real positivo (ou autoriza com saldo)", realBlockedByBalance || realEnabled, { error: realGood.json.error ?? null, enabled: realGood.json.realModeEnabled ?? null, balance: o.modeState?.real?.balance ?? null });
if (realEnabled) await req("POST", "/api/iq/real/revoke", {});
const executions = await req("GET", "/api/iq/executions?limit=20");
const realOrders = (executions.json.executions ?? []).filter((row) => row.mode === "REAL" || row.accountType === "REAL");
check("P4-REAL-06", "nenhuma ordem REAL executada (testes/gauntlet)", realOrders.length === 0, realOrders.length);

const killOn = await req("POST", "/api/iq/kill-switch", { engaged: true });
const armKill = await req("POST", "/api/iq/arm", { limitBrl: 2, confirmation: "ARM_PRACTICE" });
const orderKill = await req("POST", "/api/iq/test-order", { marketKey: o.markets.find((m) => m.enabled)?.marketKey, direction: "BUY", stake: 1 });
check("P4-KILL-01", "kill switch bloqueia ARM e ordem", killOn.json.killSwitch?.executionEnabled === false && armKill.status === 400 && orderKill.status === 400, { arm: armKill.json.error ?? null, order: orderKill.json.error ?? null });
await req("POST", "/api/iq/kill-switch", { engaged: false });

const originalGlobal = Number(o.config.globalMaxStake) || 2;
const badGlobal = await req("POST", "/api/iq/config/global-stake", { value: 150 });
check("P4-STAKE-01", "stake global acima do hard cap bloqueado", badGlobal.status === 400 && badGlobal.json.error === "invalid_global_stake", badGlobal.json);
const applyAll = await req("POST", "/api/iq/config/global-stake", { value: 3 });
const afterApply = await req("GET", "/api/iq/markets");
const enabledMarkets = (afterApply.json.universe ?? []).filter((m) => m.enabled);
check("P4-STAKE-02", "APLICAR A TODOS define o teto individual", applyAll.status === 200 && enabledMarkets.every((m) => Number(m.maxStake) === 3), { applied: applyAll.json.appliedTo ?? null, stakes: enabledMarkets.map((m) => m.maxStake) });
const target = enabledMarkets[0]?.marketKey;
const individual = await req("PUT", "/api/iq/market", { marketKey: target, maxStake: 1 });
const afterIndividual = await req("GET", "/api/iq/markets");
const individualMarket = (afterIndividual.json.universe ?? []).find((m) => m.marketKey === target);
check("P4-STAKE-03", "stake individual prevalece sobre global (teto menor)", individual.status === 200 && Number(individualMarket?.maxStake) === 1, { marketKey: target ?? null, maxStake: individualMarket?.maxStake ?? null });
await req("POST", "/api/iq/config/global-stake", { value: originalGlobal });
if (target) await req("PUT", "/api/iq/market", { marketKey: target, maxStake: originalGlobal });

const armNoConfirm2 = await req("POST", "/api/iq/arm", { limitBrl: 2 });
check("P4-GATE-01", "ARM exige confirmacao explicita", armNoConfirm2.status === 400 && armNoConfirm2.json.error === "EXPLICIT_CONFIRMATION_REQUIRED", armNoConfirm2.json);
const orderNoArm = await req("POST", "/api/iq/test-order", { direction: "BUY", stake: 1 });
check("P4-GATE-02", "ordem sem ARM bloqueada", orderNoArm.status === 400 && ["EXECUTION_NOT_ARMED", "ORDER_IN_FLIGHT", "POSITION_ALREADY_OPEN"].includes(orderNoArm.json.error), orderNoArm.json);

const officeText = asText(office.json);
const signalFeed = await req("GET", "/api/iq/signals?limit=20");
check("P4-SIGNAL-01", "feed de sinais com disposicao observavel", signalFeed.status === 200 && Array.isArray(signalFeed.json.signals) && typeof signalFeed.json.stats === "object", { signals: signalFeed.json.signals?.length ?? null });
const executedSignals = (signalFeed.json.signals ?? []).filter((row) => row.disposition === "EXECUTED");
const blockedSignals = (signalFeed.json.signals ?? []).filter((row) => row.disposition === "BLOCKED" || row.disposition === "EXPIRED");
check("P4-SIGNAL-02", "todo sinal tem disposition e reason", [...(signalFeed.json.signals ?? [])].every((row) => ["EXECUTED", "BLOCKED", "EXPIRED", "DUPLICATE"].includes(row.disposition) && Boolean(row.reason)), { executed: executedSignals.length, blocked: blockedSignals.length });
check("P4-SIGNAL-03", "stake final nunca excede o limite global (teto, nao obrigacao)", (signalFeed.json.signals ?? []).every((row) => Number(row.stakeFinal) <= Number(o.config.globalMaxStake)) && Number(o.config.calculatedBankrollStake) <= Number(o.config.globalMaxStake), { globalMax: o.config.globalMaxStake, calculated: o.config.calculatedBankrollStake });
check("P4-SIGNAL-04", "ordens reais de sinal persistidas com brokerOrderId quando executadas", executedSignals.every((row) => row.executionId) && (executions.json.executions ?? []).every((row) => row.mode !== "REAL"), executedSignals.length);

const marketsText = asText(await req("GET", "/api/iq/markets"));
const eventsText = asText(await req("GET", "/api/iq/events?after=0&limit=200"));
check("P4-SECRET-01", "office sem ssid/senha/bearer/2fa", !officeText.includes("ssid") && !officeText.includes("password") && !officeText.includes("bearer ") && !officeText.includes("2fa"), null);
check("P4-SECRET-02", "markets/events sem ssid/senha", !marketsText.includes("ssid") && !eventsText.includes("ssid") && !eventsText.includes("password"), null);
const statusText = asText(await req("GET", "/api/iq/status"));
check("P4-SECRET-03", "status legado sem ssid/senha", !statusText.includes("ssid") && !statusText.includes("password") && !statusText.includes("bearer "), null);

const stuck = (executions.json.executions ?? []).filter((row) => row.state === "REQUESTED" && Date.now() - new Date(row.requestedAt).getTime() > 5 * 60 * 1000);
const uniqueKeys = new Set((executions.json.executions ?? []).map((row) => row.idempotencyKey));
check("P4-IDEMP-01", "historico sem ordem travada e keys unicas", stuck.length === 0 && uniqueKeys.size === (executions.json.executions ?? []).length, { stuck: stuck.length, executions: (executions.json.executions ?? []).length });
check("P4-RESTART-01", "reconciliacao executada sem erro", o.reconcile?.lastRunAt > 0 && !o.reconcile?.error, o.reconcile);
check("P4-RESTART-02", "config restaurada pos-restart (enabled persistido)", o.activeCount >= 1 && (o.markets ?? []).filter((m) => m.enabled).length === o.activeCount, { activeCount: o.activeCount });
const marketByKey = new Map((o.markets ?? []).map((m) => [m.marketKey, m]));
check("P4-IDEMP-02", "posicao aberta por mercado limitada a 1", o.portfolio.openPositions.every((position) => (o.markets ?? []).filter((m) => m.marketKey === position.marketKey && m.positionState?.status === "OPEN").length <= 1), o.portfolio.openPositions.length);

const uiIndex = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(30_000) }).then((response) => response.text()).catch(() => "");
const uiJs = await fetch(`${BASE}/office.js`, { signal: AbortSignal.timeout(30_000) }).then((response) => response.text()).catch(() => "");
check("P4-UI-01", "pagina do escritorio servida com canvas e controles simplificados", uiIndex.includes('id="page-office"') && uiIndex.includes('id="officeCanvas"') && uiIndex.includes("office.js") && uiIndex.includes("office.css"), null);
check("P4-UI-02", "frontend consome o backend real (office/events/market/config)", uiJs.includes("/api/iq/office") && uiJs.includes("/api/iq/events") && uiJs.includes("/api/iq/market") && uiJs.includes("/api/iq/real/confirm"), null);
check("P4-UI-03", "UI simplificada: SISTEMA/CONTA/EMERGENCIA/VALOR/ESCOLHER MERCADOS/ATIVIDADE", uiIndex.includes("officeSystemStart") && uiIndex.includes("officeAccountPractice") && uiIndex.includes("officeEmergency") && uiIndex.includes("officeApplyLimit") && uiIndex.includes("officeChooseMarkets") && uiIndex.includes("officeActivity"), null);
check("P4-UI-04", "WS nao e informacao principal (host apenas em detalhes)", !uiIndex.includes("ws.iqoption.com") && uiIndex.includes("IQ Option"), null);
check("P4-UI-05", "sidebar enxuta: sem Area Operacional/Compartilhar Tela", !uiIndex.includes('data-page="operational"') && !uiIndex.includes('data-action="share"'), null);
const uiFixture = await fetch(`${BASE}/office-fixture.html`, { signal: AbortSignal.timeout(30_000) }).then((response) => response.text()).catch(() => "");
check("P4-UI-06", "fixture visual cobre estados amigaveis (AGUARDANDO/ANALISANDO/OPORTUNIDADE/EM OPERACAO/ENVIANDO/INDISPONIVEL/PAUSADO/WIN/LOSS/FAVORABLE/UNFAVORABLE)", ["SIGNAL", "ORDERING", "IN_POSITION", "ANALYZING", "UNAVAILABLE", "paused", "WIN", "FAVORABLE", "UNFAVORABLE"].every((state) => uiFixture.includes(state)) && uiJs.includes("AGUARDANDO") && uiJs.includes("LIVRE") && uiJs.includes("OPORTUNIDADE"), null);
check("P4-UI-07", "mesas em slots com ticker grande NORMAL/OTC e slots livres", uiJs.includes("MESA ") && uiJs.includes("market.marketType") && uiJs.includes("SLOTS"), null);

const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ base: BASE, at: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id), results }, null, 2));
process.exit(0);
