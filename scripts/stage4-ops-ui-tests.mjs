import fs from "node:fs";
import "../src/http/public/ops-ui.js";

let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };
const OpsUI = globalThis.OpsUI;
const V2 = "PULLBACK_4060_300_AGENTIC_V2";
const HASH = "sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0";
const NOW = 1_800_000_000_000;
const iso = (ms) => new Date(ms).toISOString();

ok("ops-ui expoe as funcoes puras de UI (cards/botao/troca)", OpsUI && typeof OpsUI.cardResultFor === "function" && typeof OpsUI.executionButtonState === "function" && typeof OpsUI.switchDisarmPlan === "function" && typeof OpsUI.isV2Operational === "function");

const row = (patch = {}) => ({
  executionId: "e1", marketKey: "EURUSD:OTC", direction: "CALL", state: "SETTLED", brokerResult: "WIN", profit: 1.64,
  stake: 2, payout: 82, strategyVersion: V2, strategyHash: HASH, testOnly: false, excludedFromStats: false,
  decisionId: "d1", snapshotHash: "s1", decisionSnapshot: { id: "s1" },
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
  const open = OpsUI.cardResultFor(row({ state: "ACKNOWLEDGED", brokerResult: null, profit: null, expirationAt: iso(NOW + 120_000) }), NOW, { strategyVersion: V2 });
  ok("operacao V2 aberta -> EM OPERACAO", open.text === "EM OPERAÇÃO" && open.cls === "op");
  const stale = OpsUI.cardResultFor(row({ state: "ACKNOWLEDGED", brokerResult: null, profit: null, expirationAt: iso(NOW - 180_000), requestedAt: iso(NOW - 480_000) }), NOW, { strategyVersion: V2 });
  const future = OpsUI.cardResultFor(row({ state: "ACKNOWLEDGED", brokerResult: null, profit: null, expirationAt: iso(NOW + 120_000) }), NOW, { strategyVersion: V2 });
  const grace = OpsUI.cardResultFor(row({ state: "ACKNOWLEDGED", brokerResult: null, profit: null, expirationAt: iso(NOW - 30_000) }), NOW, { strategyVersion: V2 });
  ok("stale execution (expirada ha 3min, estado aberto) NAO mostra EM OPERACAO", stale.text === "" && future.text === "EM OPERAÇÃO" && grace.text === "AGUARDANDO RESULTADO" && grace.cls === "pending");
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

/* 5) helper NAO carrega agregacao cumulativa (fonte unica e o backend) */
{
  const src = fs.readFileSync(new URL("../src/http/public/ops-ui.js", import.meta.url), "utf8");
  ok("ops-ui sem agregador cumulativo (buildV2Report/rolling/byAsset)", !/buildV2Report|byAsset|rolling|byHour|byRegime/.test(src));
  ok("ops-ui sem fetch/estrategia (somente apresentacao)", !/fetch\(|computeFeatures|runSpecialists|consensus\(/.test(src));
}

console.log(fail === 0 ? `OPS_UI_TESTS ALL_PASS (${pass}/${pass})` : `OPS_UI_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
