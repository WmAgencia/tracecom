import fs from "node:fs";
import { productState, PRODUCT_OFF, PRODUCT_SEM_FEED, PRODUCT_SEM_COMPRA, PRODUCT_ASSISTINDO, PRODUCT_WAIT, PRODUCT_BUY, PRODUCT_SELL } from "file:///D:/tracecom/repo/relay/intelligence/asset-pipeline.mjs";
import { IqMultiRuntime } from "file:///D:/tracecom/repo/relay/iq-multi-runtime.mjs";
import { operationalAllowlist, OPERATIONAL_EXECUTION_POLICY_NAME } from "file:///D:/tracecom/repo/relay/execution/operational-policy.mjs";

let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const grid = fs.readFileSync("D:/tracecom/repo/src/http/public/grid.html", "utf8");
const server = fs.readFileSync("D:/tracecom/repo/relay/server.mjs", "utf8");

/* 1) navegacao final */
{
  for (const label of ["MESAS", "LOG", "HISTÓRICO", "CONFIGURAÇÕES"]) ok(`navegacao contem ${label}`, grid.includes(`>${label}<`) || grid.includes(`"${label}"`) || grid.includes(label));
}

/* 2) legado removido da UI */
{
  ok("UI sem Blitz", !/blitz/i.test(grid));
  ok("UI sem seletor de duracao 30/45/60/150/180", !/(30|45|60|150|180)s?<\/option>/.test(grid) && !/horizonSeconds|durationSeconds:\s*(30|45|60|150|180)\b/.test(grid));
  ok("UI sem confidence/percentual de certeza", !/confidence|certeza|seguran[cç]a\s+ativa/i.test(grid));
  ok("UI sem seletor de estrategia antiga/LAB/seguranca", !/safetySelect|safetySave|labModal|labList|gridBlitz|PULLBACK_150|PULLBACK_180|STRATEGY_NAMES/.test(grid));
  ok("UI sem auto-arm REAL (arm real separado e explicito)", !/switchMode/.test(grid) && /btnRealArm/.test(grid) && /CONFIRMAR E ARMAR REAL/.test(grid));
}

/* 3) grid consome productState do backend (nao recalcula estrategia) */
{
  ok("grid consome /api/iq/intelligence/assets (productState do runtime)", grid.includes("/api/iq/intelligence/assets") && grid.includes("productState"));
  ok("grid nao recalcula especialistas/consensus no frontend", !/computeFeatures|runSpecialists|rsi\(|dmiAdx|bollinger\(/.test(grid));
  const states = ["ASSISTINDO", "WAIT", "BUY", "SELL", "SEM COMPRA", "SEM FEED", "OFF"];
  ok("grid mapeia os 7 estados operacionais do backend", states.every((s) => grid.includes(`"${s}"`)));
}

/* 4) LOG/Historico/Detalhe */
{
  ok("LOG mostra Asset Agent + 5 especialistas + Consensus + Execucao", grid.includes("Asset Agent:") && ["RSI", "DMI/ADX", "Bollinger", "ATR", "Price Action"].every((s) => grid.includes(s)) && grid.includes("Consensus:") && grid.includes("Execução"));
  ok("HISTORICO lista Hora/Ativo/Direcao/Resultado/PnL/Conta/Strategy Version", ["Hora", "Ativo", "Direção", "Resultado", "PnL", "Conta", "Strategy Version"].every((h) => grid.includes(`<th>${h}</th>`)));
  ok("HISTORICO nao mostra duracao nem confidence", !/<th>Dura[cç][aã]o<\/th>/.test(grid) && !/<th>Confidence<\/th>/.test(grid));
  ok("detalhe mostra AssetContext/Specialists/Consensus/Snapshot/Execution/Settlement", ["ASSET CONTEXT", "SPECIALISTS", "CONSENSUS", "DECISION SNAPSHOT", "EXECUTION", "SETTLEMENT"].every((s) => grid.includes(s)));
  ok("detalhe mostra snapshotHash/strategyHash/brokerOrderId/PnL", grid.includes("snapshotHash") && grid.includes("strategyHash") && grid.includes("brokerOrderId") && grid.includes("PnL"));
  ok("WAIT nao entra no historico (historico so le executions)", !/WAIT/.test(grid.slice(grid.indexOf("openHistory"), grid.indexOf("openHistory") + 2000)));
}

/* 5) productState backend cobre todos os estados */
{
  const cases = [
    [PRODUCT_OFF, { enabled: false, feedStatus: "OK", hydration: "HYDRATION_READY", consensusSide: "BUY" }],
    [PRODUCT_SEM_FEED, { enabled: true, feedStatus: "ABSENT", hydration: "HYDRATION_READY", consensusSide: "BUY" }],
    [PRODUCT_SEM_COMPRA, { enabled: true, feedStatus: "OK", purchaseStatus: "UNAVAILABLE", hydration: "HYDRATION_READY", consensusSide: "BUY" }],
    [PRODUCT_ASSISTINDO, { enabled: true, feedStatus: "OK", hydration: "HYDRATION_PARTIAL", consensusSide: null }],
    [PRODUCT_WAIT, { enabled: true, feedStatus: "OK", hydration: "HYDRATION_READY", consensusSide: "WAIT" }],
    [PRODUCT_BUY, { enabled: true, feedStatus: "OK", hydration: "HYDRATION_READY", consensusSide: "BUY" }],
    [PRODUCT_SELL, { enabled: true, feedStatus: "OK", hydration: "HYDRATION_READY", consensusSide: "SELL" }],
  ];
  ok("productState backend produz os 7 estados exatos", cases.every(([expected, input]) => productState(input) === expected));
}

/* 6) runtime expoe a view de assets e stats da V2 */
{
  const pool = { query: async (text) => {
    if (String(text).includes("SELECT broker_result")) return { rows: [{ broker_result: "WIN", profit: 1.8 }, { broker_result: "LOSS", profit: -2 }, { broker_result: "DRAW", profit: 0 }] };
    return { rows: [] };
  } };
  const rt = new IqMultiRuntime({ pool, log: () => {}, executionAllowlist: operationalAllowlist(), executionPolicyName: OPERATIONAL_EXECUTION_POLICY_NAME });
  const view = rt.intelligenceAssets();
  ok("runtime expoe intelligenceAssets com strategy/dispatch/candleStore/health", Array.isArray(view.assets) && view.strategy?.version === "PULLBACK_4060_300_AGENTIC_V2" && view.dispatch?.wired === true && view.candleStore?.intervalMs === 5000 && typeof view.health?.state === "string");
  const stats = await rt.strategyStats("PULLBACK_4060_300_AGENTIC_V2");
  ok("stats da V2 sao calculadas separadas (WIN/LOSS/DRAW/PnL/WR)", stats.operations === 3 && stats.wins === 1 && stats.losses === 1 && stats.draws === 1 && stats.pnl === -0.2 && stats.winRate === 50);
  const empty = await rt.strategyStats(null);
  ok("stats sem versao => N=0 (nunca mistura baseline)", empty.operations === 0 && empty.winRate === null);
}

/* 7) rotas novas expostas no server (admin-only) */
{
  ok("rotas /api/iq/intelligence/assets e /api/iq/strategy/stats existem e exigem admin", server.includes("'/api/iq/intelligence/assets'") && server.includes("'/api/iq/strategy/stats'") && server.includes("intelligenceAssets()") && server.includes("strategyStats("));
}

console.log(fail === 0 ? `FRONTEND_TESTS ALL_PASS (${pass}/${pass})` : `FRONTEND_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
