import { describe, expect, it } from "vitest";
import { AgentEngine } from "../../src/agent/engine";
import { createAiClient, StaticAiClient } from "../../src/ai/client";
import { createLogger } from "../../src/observability/logger";
import { ToolRegistry } from "../../src/tools/registry";
import { registerMarketDataTools } from "../../src/tools/definitions/marketData";
import { createMarketDataProvider } from "../../src/market/registry";

const instrument = {
  symbol: "BTCUSDT",
  label: "BTC/USDT",
  kind: "spot" as const,
  quote: "USDT",
  providerId: "noop",
};

const resolver = (symbol: string) => ({
  symbol: symbol.toUpperCase(),
  label: symbol,
  kind: "spot" as const,
  quote: "USDT",
  providerId: "noop",
});

const logger = createLogger({ logLevel: "error", nodeEnv: "test" });

function engineFor(providerMode: "noop" | "mocked", limits?: { maxAgentRounds: number; maxToolCalls: number }) {
  const provider = createMarketDataProvider(providerMode, { syntheticBasePrice: 60_000 });
  const tools = new ToolRegistry({ maxConcurrentTools: 4, maxToolCalls: 12 });
  registerMarketDataTools(tools, provider, resolver);
  const ai = new StaticAiClient("static/test");
  return new AgentEngine({ config: { nodeEnv: "test" }, ai, tools, logger, ...(limits ? { limits } : {}) });
}

describe("AgentEngine (dry-run / StaticAiClient)", () => {
  it("em modo noop produz análise completa com dados indisponíveis e NENHUM dado inventado", async () => {
    const engine = engineFor("noop");
    const analysis = await engine.analyze({
      instrument,
      timeframe: "1m",
      horizon: "5 candles",
      input: "Analise BTCUSDT no 1m para os próximos 5 candles.",
    });

    for (const call of analysis.trail.toolCalls) {
      expect(call.availability).toBe("UNAVAILABLE");
    }
    expect(analysis.trail.toolCalls.length).toBeGreaterThan(0);
    expect(analysis.decision.direction).toBe("WAIT");
    expect(analysis.incomplete).toBe(true);
    expect(analysis.confidence).toBeUndefined();
    expect(analysis.empiricalProbability).toBeUndefined();
  });

  it("em modo mocked executa ferramentas que entrega dados (fluxo vivo) sem inventar", async () => {
    const engine = engineFor("mocked");
    const analysis = await engine.analyze({
      instrument,
      timeframe: "1h",
      horizon: "4h",
      input: "Avalie estrutura.",
    });
    expect(analysis.trail.toolCalls.length).toBeGreaterThan(0);
    const candlesCall = analysis.trail.toolCalls.find((c) => c.tool === "get_candles");
    expect(candlesCall).toBeDefined();
  });

  it("respeita limites de segurança (não entra em loop)", async () => {
    const engine = engineFor("mocked", { maxAgentRounds: 1, maxToolCalls: 2 });
    const analysis = await engine.analyze({
      instrument,
      timeframe: "1h",
      horizon: "1h",
      input: "Analise.",
    });
    // Static probe usa apenas 3 tools; com limite 2, para em 2.
    expect(analysis.trail.toolCalls.length).toBeLessThanOrEqual(2);
  });
});

describe("createAiClient", () => {
  it("sem chave retorna StaticAiClient (dry-run)", () => {
    const ai = createAiClient({ apiKey: null, model: "m", logger });
    expect(ai.mode).toBe("static");
  });
  it("com chave retorna GroqAiClient", () => {
    const ai = createAiClient({ apiKey: "sk-fake", model: "m", logger });
    expect(ai.mode).toBe("groq");
  });
});
