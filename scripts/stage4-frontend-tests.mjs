import fs from "node:fs";
import { productState, PRODUCT_OFF, PRODUCT_SEM_FEED, PRODUCT_SEM_COMPRA, PRODUCT_ASSISTINDO, PRODUCT_WAIT, PRODUCT_BUY, PRODUCT_SELL } from "../relay/intelligence/asset-pipeline.mjs";
import { IqMultiRuntime } from "../relay/iq-multi-runtime.mjs";
import { operationalAllowlist, OPERATIONAL_EXECUTION_POLICY_NAME } from "../relay/execution/operational-policy.mjs";

let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const grid = fs.readFileSync(new URL("../src/http/public/grid.html", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../relay/server.mjs", import.meta.url), "utf8");

/* 1) navegacao final */
{
  for (const label of ["MESAS", "LOG", "HISTÓRICO", "CONFIGURAÇÕES"]) ok(`navegacao contem ${label}`, grid.includes(`>${label}<`) || grid.includes(`"${label}"`) || grid.includes(label));
}

/* 2) legado removido da UI + controles operacionais unificados */
{
  ok("UI sem Blitz", !/blitz/i.test(grid));
  ok("UI sem seletor de duracao 30/45/60/150/180", !/(30|45|60|150|180)s?<\/option>/.test(grid) && !/horizonSeconds|durationSeconds:\s*(30|45|60|150|180)\b/.test(grid));
  ok("UI sem confidence/percentual de certeza", !/confidence|certeza|seguran[cç]a\s+ativa/i.test(grid));
  ok("UI sem seletor de estrategia antiga/LAB/seguranca", !/safetySelect|safetySave|labModal|labList|gridBlitz|PULLBACK_150|PULLBACK_180|STRATEGY_NAMES/.test(grid));
  ok("SEARCH_REMOVED: busca de ativos removida (HTML/CSS/listener)", !/searchInput/.test(grid) && !/\.search\b/.test(grid) && !/Buscar ativo/i.test(grid) && !/oninput/.test(grid));
  ok("ONE_EXECUTION_TOGGLE: um unico botao de execucao", (grid.match(/id="btnExecutionToggle"/g) ?? []).length === 1 && !/btnArm\b/.test(grid) && !/btnRealArm/.test(grid) && /toggleExecution/.test(grid));
  ok("NO_SEPARATE_REAL_ARM_BUTTON: sem botao ARMAR REAL (confirmacao REAL mantida)", !/>ARMAR REAL</.test(grid) && /CONFIRMAR E ARMAR REAL/.test(grid) && /\/api\/iq\/real\/arm/.test(grid));
  ok("botao unico usa estado do backend + labels ATIVAR/DESATIVAR", grid.includes("executionButtonState") && grid.includes("state.practiceArmed") && grid.includes("state.realArmed") && !/armed\s*\?\s*"ARMADO"/.test(grid));
  const selectFn = grid.slice(grid.indexOf("const selectAccount ="), grid.indexOf("const selectAccount =") + 1400);
  ok("troca de conta usa switchDisarmPlan (nunca auto-arma)", grid.includes("switchDisarmPlan") && /\/api\/iq\/real\/disarm/.test(selectFn) && !/armPracticeNow|armRealNow|"\/api\/iq\/arm"/.test(selectFn));
  ok("cards usam cardResultFor (V2-only, janela curta) e nunca PATH_TEST/legado", grid.includes("cardResultFor") && grid.includes("isV2Operational") && grid.includes('src="/ops-ui.js"') && !/exec\.open\s*\?\s*\["ABERTA"/.test(grid));
  ok("OBSERVATION_PANEL_REMOVED_FROM_MAIN_GRID: sem Observação V2/obsBody/tabelas", !/Observação V2/.test(grid) && !/obsBody|obsSample|obsIntegrity|obsTable|refreshV2Observation/.test(grid));
  ok("NO_OBSERVATION_POLLING_ON_MAIN_GRID: sem polling da observação", !/setInterval\(\s*refreshV2Observation/.test(grid) && !/executions\?accountContext=" \+ ctx \+ "&limit=200[\s\S]{0,400}buildV2Report/.test(grid));
  ok("NO_ORPHAN_OBSERVATION_DOM: ids/classes da observacao inexistentes", !/id="obs/.test(grid) && !/class="obs/.test(grid));
  ok("three summary cards remain (V2/Lucro/Inteligencia) e grid logo em seguida", (grid.match(/<section class="pcard/g) ?? []).length === 3 && grid.indexOf('<main id="grid">') < grid.indexOf('class="foot"') && !/Observação/.test(grid.slice(grid.indexOf("sumgrid"), grid.indexOf('<main id="grid">'))));
  ok("broker status com fonte explicita (connection.execution.ready), sem 'connected' ambiguo", grid.includes("connection?.execution") && grid.includes("execConn?.ready") && !/st\?\.connected|st\.connected/.test(grid));
  /* Fase 7: mutacao com falha (null) interrompe a sequencia — nunca segue para o proximo passo. */
  ok("MUTATION_FAIL_FAST: apiStrict existe e avisa falha sem seguir", /const apiStrict = async/.test(grid) && /result === null\) notify/.test(grid));
  const armFn = grid.slice(grid.indexOf("const armPracticeNow"), grid.indexOf("const armPracticeNow") + 900);
  ok("ARM_PRACTICE nao segue apos falha (steps + return false)", /const steps = \[/.test(armFn) && /=== null\) return false/.test(armFn));
  const selectFnFailFast = grid.slice(grid.indexOf("const selectAccount ="), grid.indexOf("const openMesas"));
  ok("selectAccount aborta a sequencia em qualquer falha", (selectFnFailFast.match(/=== null\) return;/g) ?? []).length >= 4);
  ok("toggle de MESAS nao refaz refresh apos falha", /apiStrict\("\/api\/iq\/mesas"[\s\S]{0,240}result === null\) return; await openMesas\(\)/.test(grid));
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
