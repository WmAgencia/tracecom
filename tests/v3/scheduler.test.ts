/**
 * V3 — SCHEDULER: disparo em broker time no alvo (TTE~302), cancelamento e substituicao.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const schedulerModule = await import("../../relay/v3/scheduler.mjs");
const { ExecutionScheduler } = schedulerModule as any;

const BASE = Math.floor(Date.now() / 300_000) * 300_000;
const EXP = BASE + 300_000;

function fixture({ brokerNow = EXP - 330_000, fired = [] as any[] } = {}) {
  let clock = brokerNow;
  const timers: Array<{ fn: () => void; delay: number; cleared: boolean }> = [];
  const scheduler = new ExecutionScheduler({
    now: () => clock,
    setTimer: (fn: () => void, delay: number) => { const timer = { fn, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimer: (timer: any) => { timer.cleared = true; },
    onFire: async (intent: any) => { fired.push(intent); },
  });
  return { scheduler, timers, fired, advance: (ms: number) => { clock += ms; }, setClock: (value: number) => { clock = value; } };
}

const intentFor = () => ({ opportunityId: "EURUSD:OTC@x", expirationAt: EXP, targetSendAt: EXP - 302_000, hardCutoffAt: EXP - 300_000 });

describe("V3 scheduler — disparo no alvo", () => {
  it("agenda para targetSendAt (TTE~302) usando broker time", () => {
    const { scheduler, timers } = fixture({ brokerNow: EXP - 330_000 });
    const result = scheduler.schedule({ ...intentFor(), brokerNow: EXP - 330_000 });
    expect(result.scheduled).toBe(true);
    expect(result.intent.targetSendAt).toBe(EXP - 302_000);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.delay).toBe(28_000);
    expect(scheduler.pending()).toHaveLength(1);
    expect(scheduler.status().counters.scheduled).toBe(1);
  });

  it("disparo chama onFire e sai de pending", async () => {
    const { scheduler, timers, fired } = fixture({ brokerNow: EXP - 303_000 });
    scheduler.schedule({ ...intentFor(), brokerNow: EXP - 303_000 });
    expect(timers[0]!.delay).toBe(1_000);
    timers[0]!.fn();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fired).toHaveLength(1);
    expect(fired[0].opportunityId).toBe("EURUSD:OTC@x");
    expect(scheduler.pending()).toHaveLength(0);
    expect(scheduler.status().counters.fired).toBe(1);
  });

  it("cancel impede o disparo (MISSED/cancelamento antes do alvo)", async () => {
    const { scheduler, timers, fired } = fixture();
    scheduler.schedule({ ...intentFor(), brokerNow: EXP - 330_000 });
    expect(scheduler.cancel("EURUSD:OTC@x", "MISSED_5M_ENTRY_WINDOW")).toBe(true);
    timers[0]!.fn();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fired).toHaveLength(0);
    expect(scheduler.status().counters.cancelled).toBe(1);
  });

  it("reagendamento substitui o intento anterior (contador replaced)", () => {
    const { scheduler, timers } = fixture();
    scheduler.schedule({ ...intentFor(), brokerNow: EXP - 330_000 });
    scheduler.schedule({ ...intentFor(), brokerNow: EXP - 320_000 });
    expect(timers[0]!.cleared).toBe(true);
    expect(scheduler.status().counters.replaced).toBe(1);
    expect(scheduler.pending()).toHaveLength(1);
  });

  it("delay nunca e negativo (target ja passado => disparo imediato)", () => {
    const { scheduler, timers } = fixture({ brokerNow: EXP - 300_500 });
    scheduler.schedule({ ...intentFor(), brokerNow: EXP - 300_500 });
    expect(timers[0]!.delay).toBe(0);
  });
});
