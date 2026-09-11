/**
 * Testes do safety guard no loop de tool calling.
 *
 * Estes testes verificam que `hasProhibitedAction` (declarado em
 * `src/agent/safety.ts`) está conectado ao `#invokeTool` em
 * `src/agent/engine.ts`, bloqueando qualquer tentativa de executar
 * ordens reais (buy, sell, place_order, execute_trade, submit_order,
 * order_execution), mesmo que o nome da tool pareça legítimo.
 *
 * Complementa `tests/agent/safety-integration.test.ts`, que cobre
 * casos diferentes (action: "buy", "BUY", "execute_trade"). Aqui o
 * foco é o nome da tool, argumentos com nome de tool proibida e a
 * emissão do log estruturado `agent.safety.prohibited_action`.
 */
import { describe, expect, it, vi } from "vitest";
import { AgentEngine } from "../../src/agent/engine";
import type {
  AiClient,
  AgentMessage,
  ModelResponse,
  ToolRecord,
} from "../../src/ai/client";
import { ToolRegistry } from "../../src/tools/registry";
import type { Logger } from "../../src/observability/logger";
import { z } from "zod";

const instrument = {
  symbol: "BTCUSDT",
  label: "BTC/USDT",
  kind: "spot" as const,
  quote: "USDT",
  providerId: "noop",
};

interface SpyTool {
  readonly name: string;
  /** Quantas vezes o handler foi invocado. */
  invocations: number;
}

/** ToolRegistry que detecta invocações indevidas nas tools registradas. */
function makeSpyRegistry(tools: readonly string[]): {
  readonly registry: ToolRegistry;
  readonly spies: Map<string, SpyTool>;
} {
  const registry = new ToolRegistry({ maxConcurrentTools: 4, maxToolCalls: 50 });
  const spies = new Map<string, SpyTool>();
  for (const name of tools) {
    const spy: SpyTool = { name, invocations: 0 };
    spies.set(name, spy);
    registry.register({
      name,
      description: `Tool de teste: ${name}`,
      schema: z.object({ payload: z.unknown().optional() }).passthrough(),
      handler: async () => {
        spy.invocations++;
        return { availability: "AVAILABLE", tool: name };
      },
    });
  }
  return { registry, spies };
}

/** Logger fake que registra as chamadas a `warn`. */
function makeSpyLogger(): Logger & { readonly warns: { msg: string; context: Record<string, unknown>; meta?: unknown }[] } {
  const warns: { msg: string; context: Record<string, unknown>; meta?: unknown }[] = [];
  return {
    warns,
    debug: () => {},
    info: () => {},
    warn: (msg: string, context: Record<string, unknown> = {}, meta?: unknown) => warns.push({ msg, context, meta }),
    error: () => {},
    span: (name: string) => {
      const start = Date.now();
      return {
        end: () => {},
        fail: () => {},
        name,
        start,
      };
    },
  } as unknown as Logger & { readonly warns: { msg: string; context: Record<string, unknown>; meta?: unknown }[] };
}

/** AiClient fake que devolve toolCalls programados e em seguida vazio. */
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

function makeEngine(ai: AiClient, registry: ToolRegistry, logger: Logger) {
  return new AgentEngine({
    config: { nodeEnv: "test" },
    ai,
    tools: registry,
    logger,
    limits: { maxAgentRounds: 4, maxToolCalls: 8 },
  });
}

describe("AgentEngine — safety guard integration (safety-guard)", () => {
  it("Caso 1: tool_call com name='place_order' é bloqueado e retorna PROHIBITED_ACTION", async () => {
    const { registry, spies } = makeSpyRegistry(["place_order", "get_candles"]);
    const logger = makeSpyLogger();
    const ai = new ScriptedAiClient([
      {
        content: null,
        toolCalls: [
          {
            id: "call-1",
            name: "place_order",
            arguments: JSON.stringify({ symbol: "BTCUSDT", side: "buy", quantity: 1 }),
          },
        ],
      },
    ]);
    const engine = makeEngine(ai, registry, logger);

    const analysis = await engine.analyze({
      instrument,
      timeframe: "1h",
      horizon: "1h",
      input: "Teste safety guard - place_order.",
    });

    // A tool NÃO foi invocada.
    expect(spies.get("place_order")?.invocations).toBe(0);
    expect(spies.get("get_candles")?.invocations).toBe(0);

    // Trail registra o tool_call com erro PROHIBITED_ACTION.
    const blockedCall = analysis.trail.toolCalls.find((c) => c.tool === "place_order");
    expect(blockedCall).toBeDefined();
    expect(blockedCall?.availability).toBe("UNAVAILABLE");
    expect(blockedCall?.error).toBeDefined();
    const parsedError = JSON.parse(blockedCall!.error!);
    expect(parsedError.error).toBe("PROHIBITED_ACTION");
    expect(parsedError.code).toBe("SAFETY_BLOCKED");
    expect(parsedError.message).toContain("place_order");

    // Step de auditoria marca a tentativa.
    expect(analysis.trail.steps.some((s) => s.startsWith("blocked_tool"))).toBe(true);
  });

  it("Caso 2: tool 'get_candles' legítima passa pelo guard sem bloqueio", async () => {
    const { registry, spies } = makeSpyRegistry(["get_candles"]);
    const logger = makeSpyLogger();
    const ai = new ScriptedAiClient([
      {
        content: null,
        toolCalls: [
          {
            id: "call-2",
            name: "get_candles",
            arguments: JSON.stringify({ symbol: "BTCUSDT", timeframe: "1h" }),
          },
        ],
      },
    ]);
    const engine = makeEngine(ai, registry, logger);

    const analysis = await engine.analyze({
      instrument,
      timeframe: "1h",
      horizon: "1h",
      input: "Teste - get_candles legítima.",
    });

    // A tool FOI invocada normalmente.
    expect(spies.get("get_candles")?.invocations).toBe(1);

    // Sem step de bloqueio, sem erro.
    const candlesCall = analysis.trail.toolCalls.find((c) => c.tool === "get_candles");
    expect(candlesCall).toBeDefined();
    expect(candlesCall?.error).toBeUndefined();
    expect(analysis.trail.steps.some((s) => s.startsWith("blocked_tool"))).toBe(false);

    // Nenhum log de safety emitido.
    const safetyLogs = logger.warns.filter((w) => w.msg === "agent.safety.prohibited_action");
    expect(safetyLogs.length).toBe(0);
  });

  it("Caso 3: argumentos JSON contendo 'place_order' são bloqueados mesmo se tool_name é legítima", async () => {
    const { registry, spies } = makeSpyRegistry(["probe"]);
    const logger = makeSpyLogger();
    // Tool 'probe' tem nome legítimo, mas os args carregam uma chave 'place_order'
    // com um objeto aninhado — o guard deve detectar isso via hasProhibitedAction
    // sobre a string JSON.stringify(parsedArgs).
    const ai = new ScriptedAiClient([
      {
        content: null,
        toolCalls: [
          {
            id: "call-3",
            name: "probe",
            arguments: JSON.stringify({
              payload: { place_order: { side: "buy", quantity: 1 } },
            }),
          },
        ],
      },
    ]);
    const engine = makeEngine(ai, registry, logger);

    const analysis = await engine.analyze({
      instrument,
      timeframe: "1h",
      horizon: "1h",
      input: "Teste - args com place_order.",
    });

    // Tool NÃO foi invocada.
    expect(spies.get("probe")?.invocations).toBe(0);

    const blockedCall = analysis.trail.toolCalls.find((c) => c.tool === "probe");
    expect(blockedCall).toBeDefined();
    expect(blockedCall?.availability).toBe("UNAVAILABLE");
    const parsedError = JSON.parse(blockedCall!.error!);
    expect(parsedError.error).toBe("PROHIBITED_ACTION");
    expect(parsedError.code).toBe("SAFETY_BLOCKED");
  });

  it("Caso 4: log estruturado 'agent.safety.prohibited_action' é emitido via logger.warn", async () => {
    const { registry, spies } = makeSpyRegistry(["submit_order"]);
    const logger = makeSpyLogger();
    const ai = new ScriptedAiClient([
      {
        content: null,
        toolCalls: [
          {
            id: "call-4",
            name: "submit_order",
            arguments: JSON.stringify({ symbol: "BTCUSDT", qty: 1 }),
          },
        ],
      },
    ]);
    const engine = makeEngine(ai, registry, logger);

    await engine.analyze({
      instrument,
      timeframe: "1h",
      horizon: "1h",
      input: "Teste - log de safety.",
    });

    // Tool NÃO invocada.
    expect(spies.get("submit_order")?.invocations).toBe(0);

    // Log estruturado emitido.
    const safetyLogs = logger.warns.filter((w) => w.msg === "agent.safety.prohibited_action");
    expect(safetyLogs.length).toBeGreaterThanOrEqual(1);
    const firstLog = safetyLogs[0];
    expect(firstLog!.context.tool).toBe("submit_order");
  });
});
