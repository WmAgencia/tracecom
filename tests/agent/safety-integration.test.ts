import { describe, expect, it } from "vitest";
import { AgentEngine } from "../../src/agent/engine";
import type { AiClient, AgentMessage, ModelResponse, ToolRecord } from "../../src/ai/client";
import { ToolRegistry } from "../../src/tools/registry";
import { z } from "zod";

/** Instrumenta uma ToolRegistry para detectar se uma tool foi invocada. */
function makeSpyToolRegistry(): {
  readonly tools: ToolRegistry;
  readonly invokeSpy: { readonly count: number; readonly names: string[] };
} {
  const calls: { count: number; names: string[] } = { count: 0, names: [] };
  const tools = new ToolRegistry({ maxConcurrentTools: 4, maxToolCalls: 50 });
  // Tool genérica que aceita qualquer objeto e seria invocada em todos os casos
  // legítimos. Se for invocada num caso bloqueado, o teste fica vermelho.
  tools.register({
    name: "probe",
    description: "Tool de teste que detecta invocações indevidas.",
    schema: z.object({ payload: z.unknown().optional() }).passthrough(),
    handler: async (args) => {
      calls.count++;
      calls.names.push("probe");
      return { availability: "AVAILABLE", echoed: args };
    },
  });
  return { tools, invokeSpy: calls };
}

/** AiClient fake: devolve toolCalls programados e, em seguida, vazio. */
class ScriptedAiClient implements AiClient {
  readonly mode = "anthropic" as const;
  readonly model = "scripted/test";
  readonly script: ModelResponse[];
  #idx = 0;
  constructor(script: ModelResponse[]) {
    this.script = script;
  }
  async chat(_messages: AgentMessage[], _tools?: ToolRecord[]): Promise<ModelResponse> {
    const next = this.script[this.#idx] ?? { content: null, toolCalls: [] };
    this.#idx++;
    return next;
  }
}

const instrument = {
  symbol: "BTCUSDT",
  label: "BTC/USDT",
  kind: "spot" as const,
  quote: "USDT",
  providerId: "noop",
};

function makeEngine(ai: AiClient) {
  const { tools, invokeSpy } = makeSpyToolRegistry();
  const engine = new AgentEngine({
    config: { nodeEnv: "test" },
    ai,
    tools,
    limits: { maxAgentRounds: 4, maxToolCalls: 8 },
  });
  return { engine, invokeSpy };
}

describe("AgentEngine — safety gate integration (hasProhibitedAction)", () => {
  it("Caso 1: tool call com { action: 'buy' } → blocked, tool NÃO é invocada, step blocked_tool presente", async () => {
    const ai = new ScriptedAiClient([
      {
        content: null,
        toolCalls: [{ id: "call-1", name: "probe", arguments: JSON.stringify({ action: "buy" }) }],
      },
    ]);
    const { engine, invokeSpy } = makeEngine(ai);
    const analysis = await engine.analyze({
      instrument,
      timeframe: "1h",
      horizon: "1h",
      input: "Teste.",
    });

    expect(invokeSpy.count).toBe(0);
    expect(analysis.trail.steps.some((s) => s.startsWith("blocked_tool"))).toBe(true);
    const blockedCall = analysis.trail.toolCalls.find((c) => c.tool === "probe");
    expect(blockedCall).toBeDefined();
    expect(blockedCall?.error).toMatch(/BLOCKED/);
  });

  it("Caso 2: tool call normal { symbol: 'BTCUSDT' } → tool é invocada normalmente", async () => {
    const ai = new ScriptedAiClient([
      {
        content: null,
        toolCalls: [
          { id: "call-2", name: "probe", arguments: JSON.stringify({ symbol: "BTCUSDT" }) },
        ],
      },
    ]);
    const { engine, invokeSpy } = makeEngine(ai);
    const analysis = await engine.analyze({
      instrument,
      timeframe: "1h",
      horizon: "1h",
      input: "Teste.",
    });

    expect(invokeSpy.count).toBe(1);
    expect(invokeSpy.names).toEqual(["probe"]);
    expect(analysis.trail.steps.some((s) => s.startsWith("blocked_tool"))).toBe(false);
  });

  it("Caso 3: tool call com 'execute_trade' → blocked (PROHIBITED_ACTIONS)", async () => {
    const ai = new ScriptedAiClient([
      {
        content: null,
        toolCalls: [
          {
            id: "call-3",
            name: "probe",
            arguments: JSON.stringify({ command: "execute_trade", symbol: "BTCUSDT" }),
          },
        ],
      },
    ]);
    const { engine, invokeSpy } = makeEngine(ai);
    const analysis = await engine.analyze({
      instrument,
      timeframe: "1h",
      horizon: "1h",
      input: "Teste.",
    });

    expect(invokeSpy.count).toBe(0);
    expect(analysis.trail.steps.some((s) => s.startsWith("blocked_tool"))).toBe(true);
    const blockedCall = analysis.trail.toolCalls.find((c) => c.tool === "probe");
    expect(blockedCall?.error).toMatch(/BLOCKED/);
  });

  it("Caso 4: tool call com 'BUY' em maiúscula → blocked (case-insensitive)", async () => {
    const ai = new ScriptedAiClient([
      {
        content: null,
        toolCalls: [
          {
            id: "call-4",
            name: "probe",
            arguments: JSON.stringify({ action: "BUY", quantity: 1 }),
          },
        ],
      },
    ]);
    const { engine, invokeSpy } = makeEngine(ai);
    const analysis = await engine.analyze({
      instrument,
      timeframe: "1h",
      horizon: "1h",
      input: "Teste.",
    });

    expect(invokeSpy.count).toBe(0);
    expect(analysis.trail.steps.some((s) => s.startsWith("blocked_tool"))).toBe(true);
    const blockedCall = analysis.trail.toolCalls.find((c) => c.tool === "probe");
    expect(blockedCall?.error).toMatch(/BLOCKED/);
  });
});
