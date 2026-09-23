import { matchPendingOrder, pendingCandidates, matchClosedOption, SETTLEMENT_GRACE_MS } from "../relay/execution/order-ack-matcher.mjs";
import { IqMultiRuntime } from "../relay/iq-multi-runtime.mjs";

let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const NOW = 1_800_000_000_000;
const pending = (patch = {}) => ({ executionId: "e1", marketKey: "USDTRY:OTC", requestId: "req-1", connectionId: "conn-old", activeId: 2121, expirationSec: Math.floor(NOW / 1000) + 300, stake: 2, requestedAt: NOW - 5_000, ackResolved: false, ...patch });

/* 1) matcher puro: ACK cross-connection (reconexao entre envio e ACK) */
{
  const crossConnection = matchPendingOrder({ kind: "socket-option-opened", event: { connectionId: "conn-new", msg: { id: "14288039202", active_id: 2121, expired: Math.floor(NOW / 1000) + 300, price: 2 } }, pendings: [pending()], now: NOW });
  ok("ACK por tupla em conexao NOVA casa com pendencia da conexao antiga", crossConnection?.executionId === "e1");
  const byRequestId = matchPendingOrder({ kind: "option", event: { requestId: "req-1", msg: { id: "1" } }, pendings: [pending()], now: NOW });
  ok("ACK por requestId casa", byRequestId?.executionId === "e1");
  const ambiguous = matchPendingOrder({ kind: "socket-option-opened", event: { msg: { active_id: 2121, expired: Math.floor(NOW / 1000) + 300, price: 2 } }, pendings: [pending({ executionId: "a" }), pending({ executionId: "b" })], now: NOW });
  ok("ambiguidade nao chuta (2 pendencias compativeis -> null)", ambiguous === null);
  const stale = matchPendingOrder({ kind: "option", event: { requestId: "req-1", msg: { id: "1" } }, pendings: [pending({ requestedAt: NOW - 20 * 60_000 })], now: NOW });
  ok("pendencia fora da janela de correlacao nao recebe ACK", stale === null && pendingCandidates([pending()], { now: NOW }).length === 1);
  const resolved = matchPendingOrder({ kind: "option", event: { requestId: "req-1", msg: { id: "1" } }, pendings: [pending({ ackResolved: true })], now: NOW });
  ok("pendencia ja resolvida nao recebe ACK duplicado", resolved === null);
  const wrongDirection = matchClosedOption({ broker_order_id: null, active_id: 2121, expiration_at: new Date(NOW).toISOString(), direction: "PUT", stake: 2 }, [{ id: 1, active_id: 2121, expired: Math.floor(NOW / 1000), direction: "call", price: 2, win: "win" }]);
  ok("matchClosedOption por tupla exige direcao compativel", wrongDirection === null);
  const tuple = matchClosedOption({ broker_order_id: null, active_id: 2121, expiration_at: new Date(NOW).toISOString(), direction: "PUT", stake: 2 }, [{ id: "14288039202", active_id: 2121, expired: Math.floor(NOW / 1000), direction: "put", price: 2, win: "loose", sum: 2 }]);
  ok("matchClosedOption por tupla (ativo+expiry+direcao+stake) com evidencia do broker", tuple?.basis === "TUPLE_ACTIVE_EXPIRED_DIRECTION" && String(tuple.entry.id) === "14288039202");
  ok("SETTLEMENT_GRACE_MS definido (tolerancia curta pos-expiry)", SETTLEMENT_GRACE_MS > 0 && SETTLEMENT_GRACE_MS <= 120_000);
}

/* 2) runtime: ACK (conexao nova) -> SETTLED com resultado do broker */
class SettlementPool {
  constructor(reconcileRows = []) { this.reconcileRows = reconcileRows; this.updates = []; this.inserts = []; }
  async query(text, params = []) {
    const sql = String(text);
    if (sql.includes("to_regclass")) return { rows: [{ table_name: "iq_executions", read_only: "off" }] };
    if (sql.includes("broker_result IS NULL AND state IN")) return { rows: this.reconcileRows };
    if (sql.startsWith("UPDATE iq_executions")) { this.updates.push(params); return { rowCount: 1 }; }
    if (sql.startsWith("INSERT INTO iq_executions")) { this.inserts.push(params); return { rowCount: 1 }; }
    return { rows: [] };
  }
}

const makeRuntime = (pool, { now = () => NOW, serverNow = () => NOW } = {}) => {
  const rt = new IqMultiRuntime({ pool, log: () => {}, now });
  rt.client = { serverNow, placeOrder: () => undefined, getOptions: async () => ({ response: { msg: { closed_options: [] } } }) };
  rt.connection = { connectionId: "conn-old" };
  rt.session = { ...rt.session, connected: true, timeValid: true, host: "ws.iqoption.com", serverTimeMs: NOW, clockSkewMs: 0 };
  rt.armState.onConnected("PRACTICE");
  rt.armState.onMarketData(true);
  rt.armState.arm(10, { explicitConfirmation: true });
  rt.userLimitBrl = 10;
  rt.account = { ...rt.account, practice: { verified: true, balanceId: 1250741747, balance: 5000, currency: "USD" }, type: "PRACTICE", checkedAt: NOW };
  rt.gate = { evaluate: () => ({ allowed: true, reasons: [] }) };
  const ctx = rt.markets.get("USDTRY:OTC");
  ctx.enabled = true; ctx.availability = "OPEN"; ctx.activeId = 2121; ctx.payout = 82; ctx.instrumentTypes = ["turbo", "binary"]; ctx.lastTickAt = NOW; ctx.featureState = { fresh: true, freshnessReason: "OK" };
  return rt;
};

{
  const pool = new SettlementPool();
  const rt = makeRuntime(pool);
  const orderPromise = rt.requestOrder({ marketKey: "USDTRY:OTC", direction: "SELL", stake: 2, source: "intelligence:PULLBACK_4060_300_AGENTIC_V2" }).catch((error) => ({ state: "ERROR", code: error?.code ?? String(error) }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const requested = pool.updates.find((params) => params[13] === "REQUESTED");
  ok("requestOrder registra REQUESTED antes do ACK", requested !== undefined);
  const expirationSec = Math.round(new Date(String(requested[15])).getTime() / 1000);
  ok("expiry persistido e bucket de 5 min", expirationSec % 300 === 0);
  rt.connection = { connectionId: "conn-new" };
  rt.ingestEvent("socket-option-opened", { connectionId: "conn-new", msg: { id: "14288039202", active_id: 2121, expired: expirationSec, price: 2 } });
  const order = await orderPromise;
  await new Promise((resolve) => setTimeout(resolve, 10));
  const acked = pool.updates.find((params) => params[13] === "ACKNOWLEDGED");
  ok("ACK aceito mesmo com conexao nova (cross-connection) e persistido com brokerOrderId", order?.state === "ACKNOWLEDGED" && acked !== undefined && String(acked[7]) === "14288039202");
  rt.ingestEvent("socket-option-closed", { connectionId: "conn-new", msg: { id: "14288039202", win: "loose", sum: 2, win_amount: 0 } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const settled = pool.updates.find((params) => params[13] === "SETTLED");
  ok("settlement do broker -> SETTLED LOSS com PnL -2", settled !== undefined && String(settled[19]) === "LOSS" && String(settled[22]) === "-2");
}

/* 3) reconciliação por tupla quando ACK/settlement foram perdidos */
{
  const expirationAt = new Date(NOW - 300_000).toISOString();
  const row = { execution_id: "exec_stuck", market_key: "USDTRY:OTC", broker_order_id: null, state: "EXPIRED_UNSETTLED", direction: "PUT", symbol: "USD/TRY OTC", active_id: 2121, stake: "2", expiration_at: expirationAt, entry_price: "48.945155", mode: "PRACTICE" };
  const pool = new SettlementPool([row]);
  const rt = makeRuntime(pool);
  rt.client.getOptions = async () => ({ response: { msg: { closed_options: [{ id: [14288039202], active_id: 2121, expired: Math.round(new Date(expirationAt).getTime() / 1000), direction: "put", price: 2, win: "loose", sum: 2, win_amount: 0 }] } } });
  const result = await rt.reconcileOrphans();
  const settled = pool.updates.find((params) => params[13] === "SETTLED");
  ok("reconcile recupera orfa EXPIRED_UNSETTLED por tupla e marca SETTLED com evidencia do broker", result.settled === 1 && settled !== undefined && String(settled[7]) === "14288039202" && String(settled[19]) === "LOSS" && String(settled[22]) === "-2");
}

/* 4) sem evidencia do broker: nunca inventa resultado */
{
  const row = { execution_id: "exec_no_evidence", market_key: "USDTRY:OTC", broker_order_id: null, state: "EXPIRED_UNSETTLED", direction: "PUT", symbol: "USD/TRY OTC", active_id: 2121, stake: "2", expiration_at: new Date(NOW - 300_000).toISOString(), entry_price: "48.9", mode: "PRACTICE" };
  const pool = new SettlementPool([row]);
  const rt = makeRuntime(pool);
  rt.client.getOptions = async () => ({ response: { msg: { closed_options: [] } } });
  const result = await rt.reconcileOrphans();
  ok("sem evidencia: nenhum SETTLED inventado (segue EXPIRED_UNSETTLED para o sweeper)", result.settled === 0 && pool.updates.every((params) => params[13] !== "SETTLED"));
}

console.log(fail === 0 ? `SETTLEMENT_TESTS ALL_PASS (${pass}/${pass})` : `SETTLEMENT_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
