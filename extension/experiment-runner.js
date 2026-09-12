/* ProgressiveExperimentRunner: extension-local, persistent, one shadow trade at a time. */
(() => {
  "use strict";
  const KEY = "tcProgressiveExperiment"; const RUNS = { A: 100, B: 100, C: 100, D: 20 };
  const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v)); const valid = (o) => ["WIN", "LOSS", "DRAW"].includes(o);
  const empty = () => ({ version: 2, status: "IDLE", phase: "A", phaseTarget: 100, phaseEvaluated: 0, observations: [], active: null, a80v1: [], a80v2: [], finalSet: [], events: [], startedAt: null, updatedAt: Date.now(), frozen: false });
  const read = () => new Promise((resolve) => chrome.storage.local.get([KEY], (s) => resolve(s[KEY] || empty())));
  const write = (state) => new Promise((resolve) => chrome.storage.local.set({ [KEY]: { ...state, updatedAt: Date.now() } }, resolve));
  const emit = async (state) => { await write(state); const tabs = await chrome.tabs.query({}); for (const tab of tabs) if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "tc.experiment.status", payload: state }).catch(() => null); return state; };
  const note = (state, name) => ({ ...state, events: [...(state.events || []).slice(-99), { name, at: Date.now() }] });
  const domainOf = (symbol) => /OTC/i.test(String(symbol)) ? "IQ_OPTION_OTC" : "IQ_OPTION_FOREX";
  const wilson = (wins, total) => { if (!total) return { lower: 0, upper: 0 }; const z = 1.96, p = wins / total, d = 1 + z * z / total, c = p + z * z / (2 * total), m = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)); return { lower: Math.max(0, (c - m) / d), upper: Math.min(1, (c + m) / d) }; };
  const mine = (rows) => { const eligibleRows = rows.filter((r) => valid(r.outcome) && r.signature && r.decision !== "WAIT"); const baseline = eligibleRows.length ? eligibleRows.filter((r) => r.outcome === "WIN").length / eligibleRows.length : null; const groups = new Map(); for (const row of eligibleRows) groups.set(row.signature, [...(groups.get(row.signature) || []), row]); return [...groups.entries()].flatMap(([signatureId, group]) => { const wins = group.filter((r) => r.outcome === "WIN").length, n = group.length, wr = wins / n; if (n < 10 || wr < .8) return []; const losses = n - wins, rest = eligibleRows.filter((r) => r.signature !== signatureId), restWins = rest.filter((r) => r.outcome === "WIN").length, restLosses = rest.length - restWins; return [{ signatureId, n, wins, losses, wr, wilson: wilson(wins, n), support: n / Math.max(1, eligibleRows.length), lift: baseline ? wr / baseline : null, oddsRatio: rest.length ? ((wins + .5) / (losses + .5)) / ((restWins + .5) / (restLosses + .5)) : null, evidence: n >= 50 && wilson(wins, n).lower >= .8 ? "STRONGER_EVIDENCE" : n >= 20 ? "PROMISING" : "LOW_SAMPLE" }]; }); };
  const ids = (xs) => new Set((xs || []).map((x) => x.signatureId));
  const eligible = (state, analysis) => {
    if (state.phase === "A") return true; // discovery/base only
    if (state.phase === "B") return ids(state.a80v1).has(analysis.signature);
    if (state.phase === "C") return ids(state.a80v2).has(analysis.signature);
    if (state.phase === "D") return ids(state.finalSet).has(analysis.signature);
    return false;
  };
  const outcome = (decision, entry, exit) => globalThis.TraceConLocalEngine.classifyOutcome(decision, entry, exit);
  async function start() { const state = note({ ...empty(), status: "RUNNING", startedAt: Date.now() }, "EXPERIMENT_STARTED"); return emit(state); }
  async function pause() { const state = await read(); return emit({ ...state, status: state.status === "RUNNING" ? "PAUSED" : state.status }); }
  async function resume() { const state = await read(); return emit({ ...state, status: state.status === "PAUSED" ? "RUNNING" : state.status }); }
  async function stop() { const state = await read(); return emit(note({ ...state, status: "STOPPED", active: null }, "EXPERIMENT_STOPPED")); }
  async function reset() { return emit(empty()); }
  const survivors = (prior, rows) => mine(rows.filter((r) => ids(prior).has(r.signature)));
  async function advance(state) {
    if (state.phaseEvaluated < RUNS[state.phase]) return state;
    if (state.phase === "A") { const a80v1 = mine(state.observations.filter((o) => o.phase === "A")); if (!a80v1.length) return note({ ...state, status: "NO_A80_AFTER_RUN_A", active: null }, "RUN_A_COMPLETE_NO_A80_AFTER_RUN_A"); return note({ ...state, phase: "B", phaseTarget: RUNS.B, phaseEvaluated: 0, a80v1, active: null }, "RUN_A_COMPLETE_A80_V1_FROZEN_RUN_B_STARTED"); }
    if (state.phase === "B") { const a80v2 = survivors(state.a80v1, state.observations.filter((o) => o.phase === "B")); if (!a80v2.length) return note({ ...state, status: "NO_STABLE_A80_AFTER_RUN_B", active: null }, "RUN_B_COMPLETE_NO_STABLE_A80"); return note({ ...state, phase: "C", phaseTarget: RUNS.C, phaseEvaluated: 0, a80v2, active: null }, "RUN_B_COMPLETE_A80_V2_FROZEN_RUN_C_STARTED"); }
    if (state.phase === "C") { const finalSet = survivors(state.a80v2, state.observations.filter((o) => o.phase === "C")); if (!finalSet.length) return note({ ...state, status: "NO_STABLE_A80_EDGE", active: null, frozen: true }, "RUN_C_COMPLETE_NO_STABLE_A80_EDGE"); return note({ ...state, phase: "D", phaseTarget: RUNS.D, phaseEvaluated: 0, finalSet, active: null, frozen: true }, "RUN_C_COMPLETE_FINAL_SET_FROZEN_RUN_D_STARTED"); }
    return note({ ...state, status: "COMPLETE", active: null, frozen: true }, "RUN_D_COMPLETE_REPORT_READY");
  }
  async function ingest(item, originTabId) {
    let state = await read(); if (state.status !== "RUNNING" || !item?.symbol) return state;
    const analysis = globalThis.TraceConLocalEngine.analyze(item.symbol, item);
    if (state.active) {
      if (state.active.originTabId !== originTabId || state.active.asset !== item.symbol || state.active.domain !== domainOf(item.symbol)) return state;
      if (Date.now() - state.active.entryTime < 60_000) return state;
      const result = outcome(state.active.decision, state.active.entryPrice, analysis.currentPrice);
      if (!valid(result)) return emit(note({ ...state, active: null }, "ACTIVE_TRADE_UNKNOWN"));
      const closed = { ...state.active, exitTime: Date.now(), exitPrice: analysis.currentPrice, outcome: result, postAnalysis: { outcome: result, snapshotPreserved: true, evaluatedAt: Date.now() } };
      state = { ...state, active: null, phaseEvaluated: state.phaseEvaluated + 1, observations: [...state.observations, closed] };
      return emit(await advance(state));
    }
    if (analysis.decision === "WAIT" || !analysis.shadowEligible || !eligible(state, analysis)) return state;
    state.active = { signalId: `experiment-${Date.now()}`, phase: state.phase, originTabId, asset: item.symbol, domain: domainOf(item.symbol), decision: analysis.decision, entryTime: Date.now(), entryPrice: analysis.currentPrice, signature: analysis.signature, confidence: analysis.confidence, regime: analysis.regime, features: clone(analysis.features), reasons: clone(analysis.reasons), counterReasons: clone(analysis.counterReasons), snapshot: clone(analysis.snapshot) };
    return emit(state);
  }
  async function disconnect(tabId) { const state = await read(); if (!state.active || state.active.originTabId !== tabId) return state; return emit(note({ ...state, active: null }, "ACTIVE_TRADE_UNKNOWN_INTERRUPTED")); }
  globalThis.ProgressiveExperimentRunner = { read, start, pause, resume, stop, reset, ingest, disconnect, mine, outcome, eligible, advance, constants: RUNS };
})();
