import fs from "node:fs";
import "../src/http/public/ops-ui.js";

let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };
const OpsUI = globalThis.OpsUI;
const V2 = "PULLBACK_4060_300_AGENTIC_V2";
const HASH = "sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0";
const NOW = 1_800_000_000_000;
const iso = (ms) => new Date(ms).toISOString();

ok("ops-ui expoe as funcoes puras esperadas", OpsUI && typeof OpsUI.cardResultFor === "function" && typeof OpsUI.executionButtonState === "function" && typeof OpsUI.switchDisarmPlan === "function" && typeof OpsUI.buildV2Report === "function");

const row = (patch = {}) => ({
  executionId: "e1", marketKey: "EURUSD:OTC", direction: "CALL", state: "SETTLED", brokerResult: "WIN", profit: 1.64,
  stake: 2, payout: 82, strategyVersion: V2, strategyHash: HASH, testOnly: false, excludedFromStats: false,
  decisionId: "d1", snapshotHash: "s1", decisionSnapshot: { id: "s1", features: { regime: "UPTREND", structure: "UPTREND", priceAction: { pullback: { depth: "NORMAL" } } } },
  requestedAt: iso(NOW - 60_000), expirationAt: iso(NOW), settledAt: iso(NOW - 5_000), accountContext: "PRACTICE", accountType: "PRACTICE", mode: "PRACTICE",
  ...patch,
});

/* 1) filtro V2 operacional */
{
  ok("V2 operacional reconhecida", OpsUI.isV2Operational(row(), V2) === true);
  ok("PATH_TEST (mesma version, testOnly) excluido", OpsUI.isV2Operational(row({ strategyVersion: "PATH_TEST", testOnly: true, excludedFromStats: true }), V2) === false);
  ok("excludedFromStats excluido", OpsUI.isV2Operational(row({ excludedFromStats: true }), V2) === false);
  ok("strategyVersion legada/null excluida", OpsUI.isV2Operational(row({ strategyVersion: null }), V2) === false && OpsUI.isV2Operational(row(), null) === false);
  ok("outra strategyVersion excluida", OpsUI.isV2Operational(row({ strategyVersion: "PULLBACK_4060_300_BASELINE" }), V2) === false);
}

/* 2) resultado acima do card */
{
  const open = OpsUI.cardResultFor(row({ state: "ACKNOWLEDGED", brokerResult: null, profit: null }), NOW, { strategyVersion: V2 });
  ok("operacao V2 aberta -> EM OPERACAO", open.text === "EM OPERAÇÃO" && open.cls === "op");
  const win = OpsUI.cardResultFor(row(), NOW, { strategyVersion: V2 });
  const loss = OpsUI.cardResultFor(row({ brokerResult: "LOSS", profit: -2 }), NOW, { strategyVersion: V2 });
  const draw = OpsUI.cardResultFor(row({ brokerResult: "DRAW", profit: 0 }), NOW, { strategyVersion: V2 });
  ok("settled recente mostra PnL com cor (win/loss/draw)", win.text === "+1,64" && win.cls === "win" && loss.text === "-2,00" && loss.cls === "loss" && draw.text === "R$ 0,00" && draw.cls === "draw");
  ok("resultado some apos a janela (15s)", OpsUI.cardResultFor(row({ settledAt: iso(NOW - 16_000) }), NOW, { strategyVersion: V2 }).text === "" && OpsUI.cardResultFor(row({ settledAt: iso(NOW - 15_000) }), NOW, { strategyVersion: V2 }).text !== "");
  ok("settled sem timestamp nao mostra nada", OpsUI.cardResultFor(row({ settledAt: null, expirationAt: null }), NOW, { strategyVersion: V2 }).text === "");
  ok("PATH_TEST/excluida/legada nunca aparece como resultado do card", OpsUI.cardResultFor(row({ strategyVersion: "PATH_TEST", testOnly: true, excludedFromStats: true }), NOW, { strategyVersion: V2 }).text === "" && OpsUI.cardResultFor(row({ excludedFromStats: true }), NOW, { strategyVersion: V2 }).text === "" && OpsUI.cardResultFor(row({ strategyVersion: null }), NOW, { strategyVersion: V2 }).text === "");
}

/* 3) botao unico ATIVAR/DESATIVAR por conta */
{
  const practiceOff = OpsUI.executionButtonState({ mode: "PRACTICE", practiceArmed: false, realArmed: false });
  const practiceOn = OpsUI.executionButtonState({ mode: "PRACTICE", practiceArmed: true, realArmed: false });
  const realOff = OpsUI.executionButtonState({ mode: "REAL", practiceArmed: false, realArmed: false });
  const realOn = OpsUI.executionButtonState({ mode: "REAL", practiceArmed: false, realArmed: true });
  ok("PRACTICE inativo -> ATIVAR; ativo -> DESATIVAR", practiceOff.label === "ATIVAR" && practiceOff.active === false && practiceOn.label === "DESATIVAR" && practiceOn.active === true);
  ok("REAL inativo -> ATIVAR; ativo -> DESATIVAR", realOff.label === "ATIVAR" && realOff.active === false && realOn.label === "DESATIVAR" && realOn.active === true);
  ok("armed da outra conta nao ativa o botao", OpsUI.executionButtonState({ mode: "PRACTICE", practiceArmed: false, realArmed: true }).active === false && OpsUI.executionButtonState({ mode: "REAL", practiceArmed: true, realArmed: false }).active === false);
}

/* 4) troca de conta desarma a anterior e nunca auto-arma */
{
  const toReal = OpsUI.switchDisarmPlan({ to: "REAL", practiceArmed: true, realArmed: false });
  const toPractice = OpsUI.switchDisarmPlan({ to: "PRACTICE", practiceArmed: false, realArmed: true });
  const idle = OpsUI.switchDisarmPlan({ to: "REAL", practiceArmed: false, realArmed: false });
  ok("PRACTICE(ativo)->REAL desarma PRACTICE sem auto-armar", toReal.disarm.length === 1 && toReal.disarm[0] === "PRACTICE" && toReal.autoArm === false);
  ok("REAL(ativo)->PRACTICE desarma REAL sem auto-armar", toPractice.disarm.length === 1 && toPractice.disarm[0] === "REAL" && toPractice.autoArm === false);
  ok("troca sem conta ativa nao dispara disarm", idle.disarm.length === 0);
}

/* 5) relatorio observacional */
{
  const rows = [
    row({ executionId: "a", decisionId: "d1", requestedAt: iso(NOW - 10_000), settledAt: iso(NOW - 5_000) }),
    row({ executionId: "b", decisionId: "d2", brokerResult: "LOSS", profit: -2, requestedAt: iso(NOW - 20_000), settledAt: iso(NOW - 15_000) }),
    row({ executionId: "c", decisionId: "d3", brokerResult: "DRAW", profit: 0, requestedAt: iso(NOW - 30_000), settledAt: iso(NOW - 25_000) }),
    row({ executionId: "d", decisionId: "d4", direction: "PUT", state: "ACKNOWLEDGED", brokerResult: null, profit: null, requestedAt: iso(NOW - 3_000), settledAt: null, expirationAt: iso(NOW + 297_000) }),
    row({ executionId: "p", strategyVersion: "PATH_TEST", testOnly: true, excludedFromStats: true, decisionId: "dp", direction: "PUT" }),
    row({ executionId: "l", strategyVersion: null, decisionId: "dl" }),
    row({ executionId: "x", excludedFromStats: true, decisionId: "dx" }),
  ];
  const report = OpsUI.buildV2Report(rows, { strategyVersion: V2, strategyHash: HASH, now: NOW });
  ok("sample considera somente settled V2 (W/L/D separados, DRAW fora do WR)", report.sample.n === 3 && report.sample.w === 1 && report.sample.l === 1 && report.sample.d === 1 && report.sample.wr === 50 && report.sample.settled === 3);
  ok("aberta contabilizada separada; PATH_TEST/legado/excluded fora da amostra", report.sample.open === 1 && report.sample.excluded === 3);
  ok("PnL medio/trade e stake/payout medios", report.sample.pnl === -0.36 && report.sample.avgPnl === -0.12 && report.sample.avgStake === 2 && report.sample.avgPayout === 82);
  ok("BUY vs SELL separados com N/W/L/WR", report.buy.n === 3 && report.buy.w === 1 && report.buy.l === 1 && report.buy.wr === 50 && report.sell.n === 0 && report.sell.wr === null);
  ok("rolling 20/50/100 (por recencia) com N junto do WR", report.rolling.r20.n === 3 && report.rolling.r50.n === 3 && report.rolling.r100.n === 3 && report.rolling.r20.wr === 50);
  ok("por ativo sem esconder (asset + N/W/L/D/WR/PnL/payout)", report.byAsset.length === 1 && report.byAsset[0].key === "EURUSD:OTC" && report.byAsset[0].n === 3 && report.byAsset[0].avgPayout === 82);
  ok("por hora do dia agrupa com N", report.byHour.length >= 1 && report.byHour.every((h) => Number.isInteger(h.key) && h.n >= 1));
  ok("por estado de mercado via DecisionSnapshot (regime/structure/pullback)", report.byRegime[0].key === "UPTREND" && report.byStructure[0].key === "UPTREND" && report.byPullback[0].key === "NORMAL");
  ok("rotulo de amostra (N<30 = muito pequena)", report.sample.label === "amostra muito pequena" && OpsUI.sampleLabel(30) === "ainda limitada" && OpsUI.sampleLabel(100) === "maior, mas ainda observacional" && OpsUI.sampleLabel(300) === "mais informativa");
  ok("sem amostra: WR nulo e nenhum juizo de edge", OpsUI.buildV2Report([], { strategyVersion: V2, now: NOW }).sample.wr === null && !/edge|aprovada|score|confidence/i.test(JSON.stringify(report)));
}

/* 6) alertas de integridade */
{
  const bad = [
    row({ executionId: "1", decisionId: "same", requestedAt: iso(NOW - 30_000), expirationAt: iso(NOW - 299_000) }),
    row({ executionId: "2", decisionId: "same", strategyHash: "sha256:outro", requestedAt: iso(NOW - 20_000) }),
    row({ executionId: "3", decisionId: "d3", expirationAt: new Date(1_800_000_123_000).toISOString(), requestedAt: iso(NOW - 10_000) }),
    row({ executionId: "4", decisionId: null, decisionSnapshot: null }),
    row({ executionId: "5", decisionId: "d5", marketKey: "EURUSD:NORMAL" }),
    row({ executionId: "6", decisionId: "d6", accountContext: "REAL", accountType: "REAL" }),
  ];
  const report = OpsUI.buildV2Report(bad, { strategyVersion: V2, strategyHash: HASH, now: NOW });
  const codes = new Set(report.integrity.issues.map((i) => i.code));
  ok("integridade: decisionId duplicado, hash divergente, expiry fora do bucket, snapshot ausente, instrumento nao-OTC e REAL detectado", report.integrity.ok === false && codes.has("DUPLICATE_DECISION_ID") && codes.has("STRATEGY_HASH_MISMATCH") && codes.has("EXPIRY_NOT_300_BUCKET") && codes.has("SNAPSHOT_MISSING") && codes.has("INSTRUMENT_NOT_BINARY_OTC") && codes.has("REAL_TRADE_DETECTED"));
  const clean = OpsUI.buildV2Report([row()], { strategyVersion: V2, strategyHash: HASH, now: NOW });
  ok("integridade limpa quando os dados estao coerentes", clean.integrity.ok === true && clean.integrity.count === 0);
}

/* 7) nenhuma chamada de rede/logica estrategica no helper */
{
  const src = fs.readFileSync(new URL("../src/http/public/ops-ui.js", import.meta.url), "utf8");
  ok("ops-ui sem fetch/estrategia (somente apresentacao/agregacao)", !/fetch\(|computeFeatures|runSpecialists|consensus\(/.test(src));
}

console.log(fail === 0 ? `OPS_UI_TESTS ALL_PASS (${pass}/${pass})` : `OPS_UI_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
