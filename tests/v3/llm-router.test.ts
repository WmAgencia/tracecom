/**
 * V3 LLM ROUTER — pool free por role: escolha por saude, cooldown de 429/402/5xx, fallback unico.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const routerModule = await import("../../relay/llm-router.mjs");
const { createLlmRouter, providerLabel, FREE_ROLES_CONFIG } = routerModule as any;

describe("V3 llm router — free pool", () => {
  it("rotas free: 6 especialistas no Zen Free e consensus Groq->Zen fallback; sem modelos Go pagos", () => {
    for (const role of ["RSI", "DMI_ADX", "BOLLINGER", "ATR", "PRICE_ACTION", "ASSET"]) {
      expect(FREE_ROLES_CONFIG[role][0]).toMatchObject({ provider: "zen", model: "space-bunny-free" });
    }
    expect(FREE_ROLES_CONFIG.CONSENSUS_FINAL[0]).toMatchObject({ provider: "groq", model: "openai/gpt-oss-120b" });
    expect(FREE_ROLES_CONFIG.CONSENSUS_FINAL[1]).toMatchObject({ provider: "zen", model: "space-bunny-free" });
    const all = JSON.stringify(FREE_ROLES_CONFIG);
    expect(all).not.toMatch(/deepseek-v4|deepseek-v4\.1|qwen3\.8-max/);
  });

  it("choose prioriza modelo sem falhas; cooldown remove do pool; fallback consenso funciona", () => {
    const router = createLlmRouter({ now: () => 1_000_000 });
    expect(router.choose("RSI")).toMatchObject({ provider: "zen", model: "space-bunny-free" });
    const consensus = router.choose("CONSENSUS_FINAL");
    expect(consensus).toMatchObject({ provider: "groq", model: "openai/gpt-oss-120b" });
    router.report({ provider: "groq", model: "openai/gpt-oss-120b", httpStatus: 429, status: "ERROR" });
    expect(router.choose("CONSENSUS_FINAL")).toMatchObject({ provider: "zen", model: "space-bunny-free" });
    router.report({ provider: "zen", model: "space-bunny-free", httpStatus: 402, status: "ERROR" });
    expect(router.choose("CONSENSUS_FINAL")).toBeNull();
  });

  it("labels reais: Zen Free nunca aparece como generico", () => {
    expect(providerLabel("zen")).toBe("OpenCode Zen");
    expect(providerLabel("groq")).toBe("Groq");
    expect(providerLabel("openCodeGo")).toBe("OpenCode Go");
  });
});