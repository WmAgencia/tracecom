#!/usr/bin/env node
/** V3 SMOKE — sanidade rapida do nucleo V3 (roda no run-all; nenhum caminho de ordem). */
import { ExpirationTargetTiming, buildV3OrderIntent, assertExactExpirationTarget } from "../relay/v3/timing.mjs";
import { ExpirationDiscovery } from "../relay/v3/expiration-discovery.mjs";
import { ExpirationOpportunityEngine } from "../relay/v3/opportunity-engine.mjs";
import { measureAll } from "../relay/v3/measurements.mjs";
import { runSpecialists } from "../relay/v3/specialists.mjs";
import { classifyAsset } from "../relay/v3/asset-agent.mjs";
import { runConsensus } from "../relay/v3/consensus.mjs";
import { validatePlaybooks } from "../relay/v3/playbooks.mjs";
import { validateScenarioLibrary } from "../relay/v3/scenarios.mjs";
import { V3Runtime } from "../relay/v3/runtime.mjs";
import { derivedExpirationAt, TARGET_HOLD_MS } from "../relay/v3/expiration-grid.mjs";
import { ExecutionScheduler } from "../relay/v3/scheduler.mjs";
import { createScriptedAgentClient } from "../relay/v3/agents/llm-client.mjs";
import { runAgentCycle } from "../relay/v3/agents/team.mjs";
import { computeV3StrategyHash, V3_MANIFEST_PATH } from "./v3-strategy-hash.mjs";
import fs from "node:fs";

const specialistStub = (role) => ({ assessment: `${role} ok`, facts: [{ code: `${role}_FACT`, direction: "UP", strength: "MODERATE", detail: "curto" }], blockers: [], invalidations: [], changed: [], watch: ["next"], playbooks: [], sources: ["WILDER_1978"] });

let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const BASE = Math.floor(Date.now() / 300_000) * 300_000;
const EXP = BASE + 300_000;

ok("playbooks e scenario library validos", validatePlaybooks().ok && validateScenarioLibrary().ok && validatePlaybooks().count >= 25);
ok("manifesto V3 ACTIVE/executable e hash deterministico", (() => {
  const manifest = JSON.parse(fs.readFileSync(V3_MANIFEST_PATH, "utf8"));
  const computed = computeV3StrategyHash();
  return manifest.status === "ACTIVE" && manifest.executable === true && manifest.strategyHash === computed.strategyHash && computed.strategyHash === computeV3StrategyHash().strategyHash;
})());

const discovery = new ExpirationDiscovery({ now: () => EXP - 330_000 });
discovery.ingest({ actives: [{ marketKey: "EURUSD:OTC", section: "binary", active: { id: 76, enabled: true, deadtime: 30, option: { expiration_times: [60000, 900000] } } }], brokerNow: EXP - 330_000 });
ok("discovery deriva a frente compravel do relogio (~330s) e registra durations/deadtime reais", discovery.front("EURUSD:OTC", EXP - 330_000).tteMs === 330_000 && discovery.status().distribution.deadtimeMs.includes(30_000) && discovery.status().distribution.allowedDurationsMs.includes(900_000));

const engine = new ExpirationOpportunityEngine({ now: () => EXP - 330_000 });
const created = engine.discover({ marketKey: "EURUSD:OTC", expirationAt: EXP, brokerNow: EXP - 330_000, deadtimeMs: 30_000 });
ok("opportunity deduplicada por marketKey+expirationAt", created.created === true && engine.discover({ marketKey: "EURUSD:OTC", expirationAt: EXP, brokerNow: EXP - 330_000 }).created === false);
const opportunity = engine.get(created.opportunity.opportunityId);
ok("alvo de envio em TTE=302 e corte duro em TTE=300", opportunity.targetSendAt === EXP - 302_000 && opportunity.hardStrategicCutoffAt === EXP - 300_000);
ok("intent exato e guard negam expiration trocada", buildV3OrderIntent({ opportunity, brokerNow: EXP - 302_000, stake: 2, direction: "BUY" }).intent.exactExpirationAt === Math.round(EXP / 1000) && assertExactExpirationTarget({ opportunity, requestedExpirationAt: (EXP + 300_000) / 1000 }).ok === false);
engine.enforceWindow(opportunity.opportunityId, EXP - 299_000);
ok("TTE<=300 => MISSED_5M_ENTRY_WINDOW (nunca persegue)", opportunity.status === "MISSED_5M_ENTRY_WINDOW");

const closes = Array.from({ length: 120 }, (_, index) => 1.35 + index * 0.00005 + Math.sin(index / 5) * 0.0004);
const candles = closes.map((close, index) => { const prev = index ? closes[index - 1] : close; const open = close - (close - prev) * 0.3; return { at: EXP - (119 - index) * 5_000, open, high: Math.max(open, close) + 0.0004, low: Math.min(open, close) - 0.0004, close }; });
const measurements = measureAll(candles, { marketKey: "EURUSD:OTC" });
const specialists = runSpecialists({ measurements });
const asset = classifyAsset({ measurements, specialists });
const consensus = runConsensus({ measurements, asset, timing: { ok: true, code: "ENTRY_WINDOW_OPEN", tteMs: 305_000 } });
ok("pipeline deterministico: measurements -> specialists -> Asset -> Consensus", measurements.rsi.value !== null && specialists.rsi && ["BUY_CANDIDATE", "SELL_CANDIDATE", "WAIT", "NO_SETUP"].includes(asset.state) && ["APPROVE_BUY", "APPROVE_SELL", "CANCEL"].includes(consensus.result));

const runtime = new V3Runtime({ strategy: { version: "PULLBACK_4060_300_AGENTIC_V3", status: "ACTIVE", executable: true }, now: () => EXP - 330_000 });
ok("runtime V3 delega execucao apenas ao callback gated", runtime.status().executionMode === "PRACTICE_GATED" && runtime.status().executionEnabled === true && !/requestOrder\s*\(|placeOrder\s*\(/.test(fs.readFileSync(new URL("../relay/v3/runtime.mjs", import.meta.url), "utf8")));

/* Grade real + janelas separadas (exemplos da UI reproduzidos) */
const AT_112454 = Date.UTC(2026, 8, 23, 11, 24, 54);
const candidate = derivedExpirationAt(AT_112454);
ok("grade de minuto: 11:24:54 => candidato 11:30 (TTE 306s), hold alvo 300s", candidate === Date.UTC(2026, 8, 23, 11, 30) && candidate - AT_112454 === 306_000 && TARGET_HOLD_MS === 300_000);
const AT_120931 = Date.UTC(2026, 8, 25, 12, 9, 31);
ok("grade IQ: 12:09:31 => 12:15:00 (5m29s), nova frente a cada minuto", derivedExpirationAt(AT_120931) === Date.UTC(2026, 8, 25, 12, 15) && derivedExpirationAt(AT_120931) - AT_120931 === 329_000);
const analysis = ExpirationTargetTiming.analysis({ expirationAt: candidate, brokerNow: AT_112454 });
const early = ExpirationTargetTiming.execution({ expirationAt: candidate, brokerNow: AT_112454 });
const atTarget = ExpirationTargetTiming.execution({ expirationAt: candidate, brokerNow: AT_112454 + 4_000 });
ok("ANALYSIS (330->300) e EXECUTION (~302) sao funcoes distintas", analysis.ok === true && early.ok === false && early.code === "BEFORE_TARGET_SEND" && atTarget.ok === true);

/* Scheduler dispara no alvo em broker time */
{
  const timers = [];
  let fired = 0;
  const scheduler = new ExecutionScheduler({ now: () => AT_112454, setTimer: (fn, delay) => { timers.push({ fn, delay }); return { unref() {} }; }, clearTimer: () => {}, onFire: () => { fired += 1; } });
  scheduler.schedule({ opportunityId: "x", expirationAt: candidate, targetSendAt: candidate - 302_000, hardCutoffAt: candidate - 300_000, brokerNow: AT_112454 });
  await timers[0].fn();
  ok("scheduler agenda ~TTE302 e dispara revalidacao no alvo", timers[0].delay === 4_000 && fired === 1);
}

/* Agentes LLM: scripted (mesma interface do provider real) — aprovacao e fail-closed */
{
  const script = {
    RSI: specialistStub("RSI"), DMI_ADX: specialistStub("DMI_ADX"), BOLLINGER: specialistStub("BOLLINGER"), ATR: specialistStub("ATR"), PRICE_ACTION: specialistStub("PRICE_ACTION"),
    ASSET: { scenario: "TREND_CONTINUATION", direction: "UP", state: "BUY_CANDIDATE", thesis: "tendencia de alta com estrutura intacta", bestCounterCase: "CHoCH bearish", blockers: [], invalidations: [], changed: [], watch: [] },
    CONSENSUS_FINAL: { independentAssessment: "estrutura e momentum alinhados", assetComparison: "asset concorda com a leitura independente", scenario: "TREND_CONTINUATION", direction: "UP", agreement: "AGREE", supportingEvidence: ["BOS bullish"], counterEvidence: [], bestCaseForUp: ["HH/HL"], bestCaseAgainstUp: ["CHoCH bearish"], bestCaseForDown: ["perda do swing"], bestCaseAgainstDown: ["BOS recente"], blockers: [], invalidations: [], marketAmbiguities: [], reasons: [], result: "APPROVE_BUY" },
  };
  const okCycle = await runAgentCycle({ client: createScriptedAgentClient(script), measurements: { closedCandle: { at: 1 } }, cycleNumber: 1 });
  const failScript = { ...script, ASSET: { status: "ERROR", reason: "TIMEOUT" } };
  const failCycle = await runAgentCycle({ client: createScriptedAgentClient(failScript), measurements: { closedCandle: { at: 1 } }, cycleNumber: 2 });
  ok("timeout de agente => AGENT_UNAVAILABLE/CANCEL (fail-closed)", failCycle.available === false && failCycle.reason === "AGENT_UNAVAILABLE" && failCycle.result === "CANCEL");
  ok("7 chamadas (5 specialists + Asset na Wave 1; Consensus Final na Wave 2) decidem o mercado", okCycle.available === true && okCycle.result === "APPROVE_BUY" && okCycle.agentCalls.length === 7 && okCycle.finalGate?.result === "APPROVE_BUY" && okCycle.factPackets?.RSI?.fingerprint && okCycle.factPackets?.ASSET?.fingerprint);
}

console.log(fail === 0 ? `V3_SMOKE ALL_PASS (${pass}/${pass})` : `V3_SMOKE FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
