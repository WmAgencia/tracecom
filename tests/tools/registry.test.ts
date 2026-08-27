import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../../src/tools/registry";

function makeRegistry() {
  return new ToolRegistry({ maxConcurrentTools: 4, maxToolCalls: 12 });
}

describe("ToolRegistry", () => {
  it("registra e executa ferramenta com schema", async () => {
    const reg = makeRegistry();
    reg.register({
      name: "echo",
      description: "Retorna o símbolo.",
      schema: z.object({ symbol: z.string() }),
      handler: async (args) => ({ symbol: args.symbol, ok: true }),
    });
    const out = await reg.invoke("echo", { symbol: "BTCUSDT" });
    expect(out).toEqual({ symbol: "BTCUSDT", ok: true });
  });

  it("rejeita argumentos inválidos pelo schema", async () => {
    const reg = makeRegistry();
    reg.register({
      name: "echo",
      description: "x",
      schema: z.object({ symbol: z.string().min(2) }),
      handler: async (args) => ({ symbol: args.symbol }),
    });
    await expect(reg.invoke("echo", { symbol: "" })).rejects.toThrow();
  });

  it("lança para ferramenta desconhecida", async () => {
    const reg = makeRegistry();
    await expect(reg.invoke("nope", {})).rejects.toThrow(/desconhecida/i);
  });

  it("lança para ferramenta duplicada", () => {
    const reg = makeRegistry();
    reg.register({
      name: "dup",
      description: "x",
      schema: z.object({}),
      handler: async () => null,
    });
    expect(() =>
      reg.register({
        name: "dup",
        description: "y",
        schema: z.object({}),
        handler: async () => null,
      }),
    ).toThrow(/duplicada/i);
  });

  it("listForModel retorna JSON Schema consumível", () => {
    const reg = makeRegistry();
    reg.register({
      name: "candles",
      description: "d",
      schema: z.object({
        symbol: z.string(),
        frame: z.enum(["1m", "1h"]),
        limit: z.number().int().optional(),
      }),
      handler: async () => null,
    });
    const list = reg.listForModel();
    const c = list[0]!;
    expect(c.name).toBe("candles");
    expect(c.parameters.type).toBe("object");
    expect(c.parameters.required).toContain("symbol");
    expect(c.parameters.required).toContain("frame");
    expect(c.parameters.required).not.toContain("limit");
    expect((c.parameters.properties as Record<string, { enum: string[] }>).frame!.enum).toEqual(["1m", "1h"]);
  });
});
