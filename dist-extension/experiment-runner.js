/* ProgressiveExperimentRunner: local-only, persistent, shadow/paper state machine. */
(() => {
  "use strict";
  const KEY = "tcProgressiveExperiment";
  const RUNS = { A: 100, B: 100, C: 100, D: 20 };
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const empty = () => ({ version: 1, status: "IDLE", phase: "A", phaseTarget: 100, phaseEvaluated: 0, observations: [], active: null, a80v1: [], a80v2: [], finalSet: [], events: [], startedAt: null, updatedAt: Date.now() });
  const read = () => new Promise((resolve) => chrome.storage.local.get([KEY], (s) => resolve(s[KEY] || empty())));
  const write = (state) => new Promise((resolve) => chrome.storage.local.set({ [KEY]: { ...state, updatedAt: Date.now() } }, resolve));
  const emit = async (state) => { await write(state); const tabs = await chrome.tabs.query({}); for (const tab of tabs) if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "tc.experiment.status", payload: state }).catch(() => null); return state; };
  const event = (state, name) => ({ ...state, events: [...(state.events || []).slice(-49), { name, at: Date.now() }] });
  const valid = (o) => o === "WIN" || o === "LOSS" || o === "DRAW";
  const outcome = (direction, entry, exit) => {
    if (!Number.isFinite(Number(entry)) || !Number.isFinite(Number(exit)) || Number(entry) <= 0) return "UNKNOWN";
    const move = (Number(exit) - Number(entry)) / Number(entry);
    const signed = direction === "SELL" ? -move : move;
    return Math.abs(signed) < 0.00001 ? "DRAW" : signed > 0 ? "WIN" : "LOSS";
  };
  const mine = (rows) => {
    const groups = new Map();
    for (const row of rows.filter((r) => valid(r.outcome) && r.signature && r.decision !== "WAIT")) groups.set(row.signature, [...(groups.get(row.signature) || []), row]);
    return [...groups.entries()].flatMap(([signatureId, group]) => {
      const wins = group.filter((r) => r.outcome === "WIN").length;
      if (group.length < 10 || wins / group.length < 0.8) return [];
      return [{ signatureId, n: group.length, wins, losses: group.length - wins, wr: wins / group.length }];
    });
  };
  const eligible = (state, decision) => state.phase === "A" || state.phase === "D" || state.finalSet.some((s) => s.signatureId === decision.signature);
  async function update(patch) { const current = await read(); return emit({ ...current, ...patch }); }
  async function start() { let state = empty(); state = event({ ...state, status: "RUNNING", startedAt: Date.now() }, "EXPERIMENT_STARTED"); return emit(state); }
  async function pause() { const state = await read(); return emit({ ...state, status: state.status === "RUNNING" ? "PAUSED" : state.status }); }
  async function resume() { const state = await read(); return emit({ ...state, status: state.status === "PAUSED" ? "RUNNING" : state.status }); }
  async function stop() { const state = await read(); return emit({ ...state, status: "STOPPED", active: null }); }
  async function reset() { return emit(empty()); }
  async function advance(state) {
    if (state.phaseEvaluated < RUNS[state.phase]) return state;
    if (state.phase === "A") return event({ ...state, phase: "B", phaseTarget: 100, phaseEvaluated: 0, a80v1: mine(state.observations.filter((o) => o.phase === "A")), active: null }, "RUN_A_COMPLETE_A80_V1_CREATED_RUN_B_STARTED");
    if (state.phase === "B") return event({ ...state, phase: "C", phaseTarget: 100, phaseEvaluated: 0, a80v2: mine(state.observations.filter((o) => o.phase === "B" && state.a80v1.some((s) => s.signatureId === o.signature))), active: null }, "RUN_B_COMPLETE_A80_V2_CREATED_RUN_C_STARTED");
    if (state.phase === "C") return event({ ...state, phase: "D", phaseTarget: 20, phaseEvaluated: 0, finalSet: mine(state.observations.filter((o) => ["A", "B", "C"].includes(o.phase))), active: null, frozen: true }, "RUN_C_COMPLETE_FINAL_SET_FROZEN_RUN_D_STARTED");
    return event({ ...state, status: "COMPLETE", active: null, frozen: true }, "RUN_D_COMPLETE_REPORT_READY");
  }
  async function ingest(item) {
    let state = await read();
    if (state.status !== "RUNNING" || !item?.symbol) return state;
    const analysis = globalThis.TraceConLocalEngine.analyze(item.symbol, item);
    if (state.active) {
      const sameAsset = state.active.asset === item.symbol && state.active.domain === (String(item.symbol).includes("OTC") ? "IQ_OPTION_OTC" : "IQ_OPTION_FOREX");
      if (!sameAsset) return state;
      if (Date.now() - state.active.entryTime < 60_000) return state;
      const result = outcome(state.active.decision, state.active.entryPrice, analysis.currentPrice);
      if (!valid(result)) return state;
      const closed = { ...state.active, exitTime: Date.now(), exitPrice: analysis.currentPrice, outcome: result, postAnalysis: { outcome: result, snapshotPreserved: true } };
      state = { ...state, active: null, phaseEvaluated: state.phaseEvaluated + 1, observations: [...state.observations, closed] };
      return emit(await advance(state));
    }
    if (analysis.decision === "WAIT" || !analysis.shadowEligible) return state;
    if (!eligible(state, analysis)) return state;
    state.active = { signalId: `experiment-${Date.now()}`, phase: state.phase, asset: item.symbol, domain: String(item.symbol).includes("OTC") ? "IQ_OPTION_OTC" : "IQ_OPTION_FOREX", decision: analysis.decision, entryTime: Date.now(), entryPrice: analysis.currentPrice, signature: analysis.signature, confidence: analysis.confidence, features: clone(analysis.features), reasons: clone(analysis.reasons), counterReasons: clone(analysis.counterReasons), snapshot: clone(analysis.snapshot) };
    return emit(state);
  }
  async function disconnect() { const state = await read(); if (!state.active) return state; return emit({ ...state, active: null, events: [...(state.events || []).slice(-49), { name: "ACTIVE_TRADE_UNKNOWN_INTERRUPTED", at: Date.now() }] }); }
  globalThis.ProgressiveExperimentRunner = { read, start, pause, resume, stop, reset, ingest, disconnect, mine, outcome, constants: RUNS };
})();
