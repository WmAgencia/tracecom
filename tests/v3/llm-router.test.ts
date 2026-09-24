/**
 * V3 LLM ROUTER — pool free por role: escolha por saude, cooldown de 429/402/5xx, fallback unico.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const routerModule = await import("../../relay/llm-router.mjs");
const { createLlmRouter, providerLabel, FREE_ROLES_CONFIG } = routerModule as any;

describe("V3 llm router — free pool", () => {
  it("rotas: 6 especialistas deterministicos; Consensus NVIDIA(deepseek)->NVIDIA(glm)->Groq->Alibaba(ultimo)", () => {
    for (const role of ["RSI", "DMI_ADX", "BOLLINGER", "ATR", "PRICE_ACTION", "ASSET"]) {
      expect(FREE_ROLES_CONFIG[role][0]).toMatchObject({ provider: "deterministic", model: "code" });
    }
    expect(FREE_ROLES_CONFIG.CONSENSUS_FINAL[0]).toMatchObject({ provider: "nvidia", model: "deepseek-ai/deepseek-v4.1-flash" });
    expect(FREE_ROLES_CONFIG.CONSENSUS_FINAL[1]).toMatchObject({ provider: "nvidia", model: "z-ai/glm-5.3" });
    expect(FREE_ROLES_CONFIG.CONSENSUS_FINAL[2]).toMatchObject({ provider: "groq" });
    expect(FREE_ROLES_CONFIG.CONSENSUS_FINAL[3]).toMatchObject({ provider: "alibaba" });
    const all = JSON.stringify(FREE_ROLES_CONFIG);
    expect(all).not.toMatch(/space-bunny/);
  });

  it("choose: NVIDIA primeiro; falha => glm; falha => Groq; falha => Alibaba; todos em cooldown => null", () => {
    const router = createLlmRouter({ now: () => 1_000_000 });
    expect(router.choose("CONSENSUS_FINAL")).toMatchObject({ provider: "nvidia", model: "deepseek-ai/deepseek-v4.1-flash" });
    router.report({ provider: "nvidia", model: "deepseek-ai/deepseek-v4.1-flash", httpStatus: 500, status: "ERROR" });
    expect(router.choose("CONSENSUS_FINAL")).toMatchObject({ provider: "nvidia", model: "z-ai/glm-5.3" });
    router.report({ provider: "nvidia", model: "z-ai/glm-5.3", httpStatus: 429, status: "ERROR" });
    expect(router.choose("CONSENSUS_FINAL")).toMatchObject({ provider: "groq" });
    router.report({ provider: "groq", model: "openai/gpt-oss-120b", httpStatus: 429, status: "ERROR" });
    expect(router.choose("CONSENSUS_FINAL")).toMatchObject({ provider: "alibaba" });
    router.report({ provider: "alibaba", model: null, httpStatus: 403, status: "ERROR" });
    expect(router.choose("CONSENSUS_FINAL")).toBeNull();
  });

  it("labels reais: Zen Free nunca aparece como generico", () => {
    expect(providerLabel("zen")).toBe("OpenCode Zen");
    expect(providerLabel("groq")).toBe("Groq");
    expect(providerLabel("openCodeGo")).toBe("OpenCode Go");
  });
});