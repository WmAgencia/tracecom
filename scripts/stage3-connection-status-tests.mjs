import { IqMultiRuntime } from "../relay/iq-multi-runtime.mjs";

let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const pool = { query: async () => ({ rows: [] }) };
const rt = new IqMultiRuntime({ pool, log: () => {} });

const setConnected = ({ connected, timeValid = true, verified = true, balanceId = 1 }) => {
  rt.session = { ...rt.session, connected, timeValid, host: "ws.iqoption.com", connectionId: "conn-1" };
  rt.client = connected ? { serverNow: () => Date.now() } : null;
  rt.account = { ...rt.account, practice: { ...rt.account.practice, verified, balanceId } };
};

/* 1) fontes explicitas: marketData != execution (nunca um 'connected' ambiguo) */
{
  const status = rt.status();
  ok("status expoe connection.marketData e connection.execution (sem 'connected' ambiguo no topo)", status.connection?.marketData !== undefined && status.connection?.execution !== undefined && status.connected === undefined);
  ok("desconectado: marketData.connected=false, execution.ready=false com motivo WS_DISCONNECTED", status.connection.marketData.connected === false && status.connection.execution.ready === false && status.connection.execution.reasons.includes("WS_DISCONNECTED"));
}

/* 2) feed READY nao implica broker conectado (fontes separadas) */
{
  rt.assetIntelligence = { health: () => ({ state: "READY", intelligenceReady: true, assetsReady: 30, assetsTotal: 30 }) };
  const feed = rt.intelligenceStatus().assetIntelligence;
  const conn = rt.status().connection;
  ok("feed/inteligencia READY com execucao NAO pronta (nao usa feed como proxy de broker)", feed.state === "READY" && feed.intelligenceReady === true && conn.execution.ready === false && conn.marketData.connected === false);
}

/* 3) execucao fail-closed sem conexao (nenhuma ordem sai) */
{
  let threw = null;
  try { await rt.requestOrder({ marketKey: "EURUSD:OTC", direction: "BUY", stake: 2 }); } catch (error) { threw = error; }
  ok("broker desconectado -> requestOrder nega (WS_DISCONNECTED), sem ordem", threw?.code === "WS_DISCONNECTED");
}

/* 4) reconexao atualiza o status corretamente */
{
  setConnected({ connected: true, timeValid: true, verified: true, balanceId: 1250741747 });
  const after = rt.status().connection;
  ok("reconectado + timeValid + conta verificada -> execution.ready=true", after.execution.connected === true && after.execution.ready === true && after.execution.reasons.length === 0 && after.marketData.connected === true);
  setConnected({ connected: true, timeValid: false });
  const skew = rt.status().connection;
  ok("conectado sem time sync -> execution.ready=false (TIME_SYNC_INVALID)", skew.execution.connected === true && skew.execution.ready === false && skew.execution.reasons.includes("TIME_SYNC_INVALID"));
  setConnected({ connected: true, timeValid: true, verified: false });
  ok("conectado sem conta verificada -> execution.ready=false", rt.status().connection.execution.ready === false);
  setConnected({ connected: false });
  ok("queda -> status volta a desconectado (sem fila/estado stale)", rt.status().connection.execution.ready === false && rt.pendingOrders.size === 0);
}

/* 5) REAL continua fail-closed */
{
  const status = rt.status();
  ok("REAL fail-closed: modo/contexto PRACTICE e realExecutionForbidden", rt.config.mode === "PRACTICE" && rt.accountContext.context === "PRACTICE" && status.account.realExecutionForbidden === true && status.connection.execution.ready === false);
}

console.log(fail === 0 ? `CONNECTION_STATUS_TESTS ALL_PASS (${pass}/${pass})` : `CONNECTION_STATUS_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
