/**
 * V3 LLM ROUTER — pool free por role: escolha por saude, cooldown de 429/402/5xx, fallback unico.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const routerModule = await import("../../relay/llm-router.mjs");
const { createLlmRouter, providerLabel, FREE_ROLES_CONFIG } = routerModule as any;

describe("V3 llm router — free pool", () => {
  it("rotas: 6 especialistas deterministicos; Consensus NVIDIA(deepseek)->NVIDIA(nemotron-ultra)->NVIDIA(glm-flash)->Groq->Alibaba->OpenCodeGo", () => {
    for (const role of ["RSI", "DMI_ADX", "BOLLINGER", "ATR", "PRICE_ACTION", "ASSET"]) {
      expect(FREE_ROLES_CONFIG[role][0]).toMatchObject({ provider: "deterministic", model: "code" });
    }
    expect(FREE_ROLES_CONFIG.CONSENSUS_FINAL[0]).toMatchObject({ provider: "nvidia", model: "deepseek-ai/deepseek-v4.1-flash" });
    expect(FREE_ROLES_CONFIG.CONSENSUS_FINAL[1]).toMatchObject({ provider: "nvidia", model: "nvidia/nemotron-3-ultra-550b-a55b" });
    expect(FREE_ROLES_CONFIG.CONSENSUS_FINAL[2]).toMatchObject({ provider: "nvidia", model: "z-ai/glm-5.3-flash" });
    expect(FREE_ROLES_CONFIG.CONSENSUS_FINAL[3]).toMatchObject({ provider: "groq", model: "openai/gpt-oss-120b" });
    expect(FREE_ROLES_CONFIG.CONSENSUS_FINAL[4]).toMatchObject({ provider: "alibaba", model: "qwen3.7-flash" });
    expect(FREE_ROLES_CONFIG.CONSENSUS_FINAL[5]).toMatchObject({ provider: "openCodeGo", model: "deepseek-v4-flash" });
    const all = JSON.stringify(FREE_ROLES_CONFIG);
    expect(all).not.toMatch(/space-bunny/);
  });

  it("choose: NVIDIA deepseek => nemotron-ultra => glm-flash => Groq => Alibaba => OpenCodeGo; todos em cooldown => null", () => {
    const router = createLlmRouter({ now: () => 1_000_000 });
    const order = ["deepseek-ai/deepseek-v4.1-flash", "nvidia/nemotron-3-ultra-550b-a55b", "z-ai/glm-5.3-flash", "openai/gpt-oss-120b", "qwen3.7-flash", "deepseek-v4-flash"];
    const providers = ["nvidia", "nvidia", "nvidia", "groq", "alibaba", "openCodeGo"];
    for (let index = 0; index < order.length; index += 1) {
      const chosen = router.choose("CONSENSUS_FINAL");
      expect(chosen).toMatchObject({ provider: providers[index], model: order[index] });
      router.report({ provider: providers[index], model: order[index], httpStatus: 429, status: "ERROR" });
    }
    expect(router.choose("CONSENSUS_FINAL")).toBeNull();
  });

  it("labels reais: Zen Free nunca aparece como generico", () => {
    expect(providerLabel("zen")).toBe("OpenCode Zen");
    expect(providerLabel("groq")).toBe("Groq");
    expect(providerLabel("openCodeGo")).toBe("OpenCode Go");
  });
});