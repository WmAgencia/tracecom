/**
 * V3 LLM ROUTER — pool free por role: escolha por saude, cooldown de 429/402/5xx, fallback unico.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const routerModule = await import("../../relay/llm-router.mjs");
const { createLlmRouter, providerLabel, FREE_ROLES_CONFIG } = routerModule as any;

describe("V3 llm router — free pool", () => {
  it("rotas: 6 especialistas deterministicos; Consensus Alibaba primario + Groq fallback; sem modelos Go pagos/Zen Free", () => {
    for (const role of ["RSI", "DMI_ADX", "BOLLINGER", "ATR", "PRICE_ACTION", "ASSET"]) {
      expect(FREE_ROLES_CONFIG[role][0]).toMatchObject({ provider: "deterministic", model: "code" });
    }
    expect(FREE_ROLES_CONFIG.CONSENSUS_FINAL[0]).toMatchObject({ provider: "alibaba" });
    expect(FREE_ROLES_CONFIG.CONSENSUS_FINAL[1]).toMatchObject({ provider: "groq", model: "openai/gpt-oss-120b" });
    const all = JSON.stringify(FREE_ROLES_CONFIG);
    expect(all).not.toMatch(/deepseek-v4|qwen3\.8-max|space-bunny/);
  });

  it("choose: Alibaba primeiro; falha => cooldown e fallback Groq; ambos em cooldown => null", () => {
    const router = createLlmRouter({ now: () => 1_000_000 });
    expect(router.choose("RSI")).toMatchObject({ provider: "deterministic", model: "code" });
    expect(router.choose("CONSENSUS_FINAL")).toMatchObject({ provider: "alibaba" });
    router.report({ provider: "alibaba", model: "qwen3.5-flash", httpStatus: 403, status: "ERROR" });
    expect(router.choose("CONSENSUS_FINAL")).toMatchObject({ provider: "groq", model: "openai/gpt-oss-120b" });
    router.report({ provider: "groq", model: "openai/gpt-oss-120b", httpStatus: 429, status: "ERROR" });
    expect(router.choose("CONSENSUS_FINAL")).toBeNull();
  });

  it("labels reais: Zen Free nunca aparece como generico", () => {
    expect(providerLabel("zen")).toBe("OpenCode Zen");
    expect(providerLabel("groq")).toBe("Groq");
    expect(providerLabel("openCodeGo")).toBe("OpenCode Go");
  });
});