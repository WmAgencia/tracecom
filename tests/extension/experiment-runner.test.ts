import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

function harness() {
  let clock = 1_000_000;
  const storage: Record<string, unknown> = {};
  const chrome = { storage: { local: { get: (keys: string[], cb: (value: Record<string, unknown>) => void) => cb(Object.fromEntries(keys.map((key) => [key, storage[key]]))), set: (value: Record<string, unknown>, cb: () => void) => { Object.assign(storage, value); cb(); } } }, tabs: { query: async () => [] } };
  const context = vm.createContext({ chrome, console, Date: { now: () => clock }, setTimeout, clearTimeout, TraceConLocalEngine: { analyze: (_symbol: string, item: any) => ({ decision: item.lastPrice > item.candles[0].close ? "BUY" : "WAIT", shadowEligible: item.lastPrice > item.candles[0].close, currentPrice: item.lastPrice, signature: "sig:test", confidence: 0.6, features: {}, reasons: [], counterReasons: [], snapshot: { candles: item.candles.slice() } }) } });
  vm.runInContext(readFileSync(resolve("extension/experiment-runner.js"), "utf8"), context);
  return { runner: (context as any).ProgressiveExperimentRunner, storage, advance: (ms: number) => { clock += ms; } };
}

describe("ProgressiveExperimentRunner", () => {
  it("persists start, pause and resume without a remote browser", async () => {
    const { runner, storage } = harness();
    expect((await runner.start()).status).toBe("RUNNING");
    expect((await runner.pause()).status).toBe("PAUSED");
    expect((await runner.resume()).status).toBe("RUNNING");
    expect((storage as any).tcProgressiveExperiment.phase).toBe("A");
  });

  it("opens one shadow opportunity and evaluates it after the 60s horizon", async () => {
    const h = harness(); await h.runner.start();
    const item = { symbol: "EURUSD", lastPrice: 1.001, candles: [{ close: 1.0 }] };
    await h.runner.ingest(item);
    expect((await h.runner.read()).active).not.toBeNull();
    h.advance(60_001); await h.runner.ingest({ ...item, lastPrice: 1.002 });
    const state = await h.runner.read(); expect(state.active).toBeNull(); expect(state.phaseEvaluated).toBe(1); expect(state.observations[0].outcome).toBe("WIN");
  });
});
