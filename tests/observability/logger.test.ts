import { describe, expect, it } from "vitest";
import { redact } from "../../src/observability/logger";

describe("redact", () => {
  it("remove chaves/segredos", () => {
    const out = redact({
      apiKey: "secret",
      GROQ_API_KEY: "secret",
      token: "t",
      data: { plain: 1, token2: "x" },
    }) as Record<string, unknown>;
    expect(out.apiKey).toBe("[REDACTED]");
    expect(out.data).toEqual({ plain: 1, token2: "[REDACTED]" });
  });

  it("redige envelopes de rede (headers/set-cookie) que podem expor dados", () => {
    const out = redact({
      headers: { "set-cookie": "secret", authorization: "Bearer x" },
      request: {},
      cookies: "a=1",
      message: "ok",
    }) as Record<string, unknown>;
    expect(out.headers).toBe("[WIRE_REDACTED]");
    expect(out.request).toBe("[WIRE_REDACTED]");
    expect(out.cookies).toBe("[WIRE_REDACTED]");
    expect(out.message).toBe("ok");
  });

  it("não altera primitivos", () => {
    expect(redact("abc")).toBe("abc");
    expect(redact(5)).toBe(5);
  });
});
