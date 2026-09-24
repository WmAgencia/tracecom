/**
 * V3 — GLOBAL LLM REQUEST SCHEDULER (concurrency, prioridade, deadline, retry 429) + provider real.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const limiterModule = await import("../../relay/llm-rate-limiter.mjs");
const { createLlmRateLimiter } = limiterModule as any;

const ok = (payload = {}) => ({ status: "OK", reason: null, model: "m", provider: "groq", limits: {}, text: "ok", parsed: null, latencyMs: 5, usage: null, finishReason: "stop", httpStatus: 200, ...payload });

const run = async (label: string, limiter: any, options: any) => limiter.run(options).then((r: any) => ({ label, ...r }));

describe("V3 llm rate limiter — concurrency global", () => {
  it("D. nunca ultrapassa maxConcurrent", async () => {
    let inflight = 0; let maxSeen = 0;
    const limiter = createLlmRateLimiter({ maxConcurrent: 3, now: () => Date.now() });
    const tasks = Array.from({ length: 12 }, (_, index) => limiter.run({ priority: 1, deadlineAt: Date.now() + 60_000, execute: async () => { inflight += 1; maxSeen = Math.max(maxSeen, inflight); await new Promise((resolve) => setTimeout(resolve, 2)); inflight -= 1; return ok({ model: "m" + index }); } }));
    await Promise.all(tasks);
    expect(maxSeen).toBeLessThanOrEqual(3);
    expect(limiter.stats().total).toBe(12);
  });

  it("E. CONSENSUS tem prioridade sobre novas Wave1 (mesmo deadline)", async () => {
    const order: string[] = [];
    const limiter = createLlmRateLimiter({ maxConcurrent: 1, now: () => Date.now() });
    const deadline = Date.now() + 60_000;
    const wave1 = limiter.run({ priority: 1, deadlineAt: deadline, execute: async () => { order.push("wave1"); return ok(); } });
    const consensus = limiter.run({ priority: 2, deadlineAt: deadline, execute: async () => { order.push("consensus"); return ok(); } });
    const wave1b = limiter.run({ priority: 1, deadlineAt: deadline, execute: async () => { order.push("wave1b"); return ok(); } });
    await Promise.all([wave1, consensus, wave1b]);
    expect(order[0]).toBe("wave1");
    expect(order[1]).toBe("consensus");
    expect(order[2]).toBe("wave1b");
  });

  it("F. sem budget no dequeue => SKIPPED_PROVIDER_CAPACITY", async () => {
    let ran = false;
    const limiter = createLlmRateLimiter({ maxConcurrent: 1, now: () => Date.now() });
    const t0 = Date.now();
    const blocker = limiter.run({ priority: 1, deadlineAt: t0 + 30_000, execute: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return ok(); } });
    const skipped = limiter.run({ priority: 1, deadlineAt: t0 + 1, execute: async () => { ran = true; return ok(); } });
    await blocker;
    const result = await skipped;
    expect(result.reason).toBe("SKIPPED_PROVIDER_CAPACITY");
    expect(ran).toBe(false);
  });

  it("G/H. 429: no maximo 1 retry se couber no deadline; senao PROVIDER_RATE_LIMIT", async () => {
    let calls = 0;
    const limiter = createLlmRateLimiter({ maxConcurrent: 1, now: () => Date.now(), sleep: async () => {} });
    const okResult = await limiter.run({ priority: 1, deadlineAt: Date.now() + 60_000, execute: async () => { calls += 1; if (calls === 1) return ok({ httpStatus: 429, limits: { "retry-after": "1" } }); return ok(); } });
    expect(okResult.status).toBe("OK");
    expect(calls).toBe(2);
    let failCalls = 0;
    const failResult = await limiter.run({ priority: 1, deadlineAt: Date.now() + 1_000, estimatedLatencyMs: 5_000, execute: async () => { failCalls += 1; return ok({ httpStatus: 429, limits: { "retry-after": "1" } }); } });
    expect(failResult.reason).toBe("PROVIDER_RATE_LIMIT");
    expect(failCalls).toBe(1);
    expect(limiter.stats().rateLimited).toBe(2);
  });

  it("J. 3 pipelines de 7 chamadas completam sem violar concurrency", async () => {
    let inflight = 0; let maxSeen = 0;
    const limiter = createLlmRateLimiter({ maxConcurrent: 4, now: () => Date.now() });
    const calls: Array<Promise<any>> = [];
    for (let pipeline = 0; pipeline < 3; pipeline += 1) {
      for (let index = 0; index < 6; index += 1) calls.push(limiter.run({ priority: 1, deadlineAt: Date.now() + 60_000, execute: async () => { inflight += 1; maxSeen = Math.max(maxSeen, inflight); await new Promise((resolve) => setTimeout(resolve, 1)); inflight -= 1; return ok(); } }));
      calls.push(limiter.run({ priority: 2, deadlineAt: Date.now() + 60_000, execute: async () => { inflight += 1; maxSeen = Math.max(maxSeen, inflight); await new Promise((resolve) => setTimeout(resolve, 1)); inflight -= 1; return ok(); } }));
    }
    const results = await Promise.all(calls);
    expect(results.every((result) => result.status === "OK")).toBe(true);
    expect(results).toHaveLength(21);
    expect(maxSeen).toBeLessThanOrEqual(4);
  });
});

describe("V3 agent client — provider real", () => {
  it("I. client propaga provider/model reais do runner", async () => {
    // @ts-expect-error - relay ESM sem tipagem
    const clientModule = await import("../../relay/v3/agents/llm-client.mjs");
    const { createLlmAgentClient } = clientModule as any;
    const parsed = { assessment: "a", facts: [{ code: "RSI_FACT", direction: "UP", strength: "MODERATE" }], blockers: [], invalidations: [], changed: [], watch: [], playbooks: [], sources: ["WILDER_1978"] };
    const client = createLlmAgentClient({ runner: async (options: any) => ok({ provider: "groq", model: "openai/gpt-oss-120b", text: JSON.stringify(parsed), parsed }), now: () => Date.now() });
    const call = await client.call({ role: "RSI", prompt: "x", requestId: "r", opportunityId: "X" });
    expect(call.provider).toBe("groq");
    expect(call.model).toBe("openai/gpt-oss-120b");
    expect(call.status).toBe("OK");
  });
});