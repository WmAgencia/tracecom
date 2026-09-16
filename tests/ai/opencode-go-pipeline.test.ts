/** OpenCode Go pipeline — adapter, session header, fail-closed, null/UNKNOWN, segurança.
 * Provider real validado: openCodeGo / qwen3.7-plus (health PASS 2026-09-16; ~3,0-4,9s). */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const goModule = await import("../../relay/opencode-go.mjs");
const {
  DEFAULT_MODEL,
  OPENCODE_GO_BASE,
  TEXT_TIMEOUT_MS,
  VISION_TIMEOUT_MS,
  buildTextRequest,
  buildVisionRequest,
  failedObservation,
  normalizeObservation,
  parseStructured,
  resolveModel,
  sessionFor,
  shouldUseOpenCodeGo,
} = goModule as unknown as Record<string, (input: never) => never> & Record<string, unknown> as never as {
  DEFAULT_MODEL: string; OPENCODE_GO_BASE: string; TEXT_TIMEOUT_MS: number; VISION_TIMEOUT_MS: number;
  buildTextRequest: (input: { model: string; system: string; prompt: string; sessionId: string }) => { url: string; headers: Record<string, string>; body: { model: string; messages: Array<{ role: string; content: unknown }> } };
  buildVisionRequest: (input: { model: string; imageDataUrl: string; prompt: string; sessionId: string }) => { url: string; headers: Record<string, string>; body: { model: string; messages: Array<{ role: string; content: Array<{ type: string; text?: string; image_url?: { url: string } }> }> } };
  failedObservation: (provenance: Record<string, unknown>, note: string) => Record<string, unknown> & { notes: string[] };
  normalizeObservation: (parsed: Record<string, unknown> | null, provenance: Record<string, unknown>) => Record<string, unknown> & { marketType: string | null; investmentValue: number | null; expirationSeconds: number | null; symbol: string | null; availability: string; parseMode: string; provenance: Record<string, unknown>; manualPosition: { hasOpenPosition: boolean; direction: string } };
  parseStructured: (text: unknown) => Record<string, unknown> | null;
  resolveModel: (config: { model?: string } | null) => string;
  sessionFor: (context: Record<string, unknown>) => string;
  shouldUseOpenCodeGo: (config: Record<string, unknown> | null | undefined) => boolean;
};

const CV = "configurado";
describe("provider resolution — CONFIG controla o runtime", () => {
  it("openCodeGo CONFIGURED → ativo; qualquer outro → não (sem fallback silencioso)", () => {
    expect(shouldUseOpenCodeGo({ status: "CONFIGURED", provider: "openCodeGo", model: "qwen3.7-plus" })).toBe(true);
    expect(shouldUseOpenCodeGo({ status: "CONFIGURED", provider: "fable" })).toBe(false);
    expect(shouldUseOpenCodeGo({ status: "NOT_CONFIGURED", provider: "openCodeGo" })).toBe(false);
    expect(shouldUseOpenCodeGo(null)).toBe(false);
    expect(shouldUseOpenCodeGo(undefined)).toBe(false);
  });
  it("modelo inválido/ausente cai no default validado (qwen3.7-plus), nunca em modelo inventado", () => {
    expect(resolveModel({ model: "qwen3.7-plus" })).toBe("qwen3.7-plus");
    expect(resolveModel({ model: "gpt-6-v4-vision" })).toBe("gpt-6-v4-vision"); // id válido sintaticamente; descoberta real decide
    expect(resolveModel({ model: "../../etc" })).toBe(DEFAULT_MODEL);
    expect(resolveModel({ model: "" })).toBe(DEFAULT_MODEL);
    expect(resolveModel(null)).toBe(DEFAULT_MODEL);
  });
});

describe("x-opencode-session — obrigatório, derivado, sem segredos", () => {
  it("determinístico por contexto e distinto entre contextos", () => {
    const a = sessionFor({ sessionId: "vision_abc", traceId: "trace_1" });
    const b = sessionFor({ sessionId: "vision_abc", traceId: "trace_1" });
    const c = sessionFor({ sessionId: "vision_abc", traceId: "trace_2" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith("tc-")).toBe(true);
  });
  it("nunca embute o valor bruto da sessão nem segredo", () => {
    const session = sessionFor({ sessionId: "vision_abc" });
    expect(session).not.toContain("vision_abc");
    expect(session).not.toMatch(/sk-/);
  });
});

describe("requisições — host/modelo/session/imagem por etapa", () => {
  const sessionId = sessionFor({ sessionId: "s1" });
  it("vision: host opencode.ai, modelo, x-opencode-session e APENAS imagem sanitizada", () => {
    const request = buildVisionRequest({ model: "qwen3.7-plus", imageDataUrl: "data:image/jpeg;base64,AAAA", prompt: "RETURN JSON ONLY", sessionId });
    expect(request.url).toBe(`${OPENCODE_GO_BASE}/chat/completions`);
    expect(request.headers["x-opencode-session"]).toBe(sessionId);
    expect(request.body.model).toBe("qwen3.7-plus");
    const content = request.body.messages[0]!.content;
    expect(content[0]!.type).toBe("text");
    expect(content[1]!.type).toBe("image_url");
    expect(content[1]!.image_url!.url.startsWith("data:image/jpeg")).toBe(true);
  });
  it("text: sem imagem na etapa textual (reasoning recebe só contexto)", () => {
    const request = buildTextRequest({ model: "qwen3.7-plus", system: "sys", prompt: "ctx", sessionId });
    expect(request.headers["x-opencode-session"]).toBe(sessionId);
    expect(request.body.messages[0]!.role).toBe("system");
    expect(request.body.messages[1]!.role).toBe("user");
    expect(JSON.stringify(request.body)).not.toContain("image_url");
  });
  it("a key nunca aparece nas requisições montadas (Authorization é injetado só no relay runner)", () => {
    const vision = JSON.stringify(buildVisionRequest({ model: "qwen3.7-plus", imageDataUrl: "data:image/png;base64,AAAA", prompt: "p", sessionId }));
    const text = JSON.stringify(buildTextRequest({ model: "qwen3.7-plus", system: "s", prompt: "p", sessionId }));
    expect(vision).not.toMatch(/sk-|Authorization|Bearer/);
    expect(text).not.toMatch(/sk-|Authorization|Bearer/);
  });
});

describe("parser fail-closed e UNKNOWN/null preservado", () => {
  it("JSON válido (puro ou com cercas) → objeto; prosa/vazio/array → null", () => {
    expect(parseStructured('{"symbol":"EUR/USD OTC"}')?.symbol).toBe("EUR/USD OTC");
    expect(parseStructured('```json\n{"a":1}\n```')?.a).toBe(1);
    expect(parseStructured("não sei responder")).toBeNull();
    expect(parseStructured("")).toBeNull();
    expect(parseStructured("[1,2]")).toBeNull();
    expect(parseStructured(null)).toBeNull();
  });
  it("campos não visíveis ficam null (sem alucinação) e OTC é preservado", () => {
    const observation = normalizeObservation({ symbol: "EUR/USD", marketType: "OTC", investmentValue: 5, expirationSeconds: 45, trend: "BULLISH" }, { provider: "openCodeGo", model: "qwen3.7-plus", requestId: "r1", status: "OK", latencyMs: 4200, sessionId: "tc-x", frameId: "f1", timestamp: "t", parseMode: "DIRECT" });
    expect(observation.marketType).toBe("OTC");
    expect(observation.investmentValue).toBe(5);
    expect(observation.expirationSeconds).toBe(45);
    expect(observation.manualPosition.hasOpenPosition).toBe(false);
    expect(observation.manualPosition.direction).toBe("UNKNOWN"); // nunca inferida de candle/trend
    const partial = normalizeObservation({ symbol: null, marketType: null }, { provider: "openCodeGo", model: "qwen3.7-plus", requestId: "r2", status: "OK", latencyMs: 3000, sessionId: "tc-y", frameId: null, timestamp: "t", parseMode: "DIRECT" });
    expect(partial.symbol).toBeNull();
    expect(partial.investmentValue).toBeNull();
    expect(partial.expirationSeconds).toBeNull();
    expect(partial.availability).toBe("UNAVAILABLE");
  });
  it("resposta inválida → failedObservation (fail-closed), sem campos fabricados", () => {
    const failed = normalizeObservation(null, { provider: "openCodeGo", model: "qwen3.7-plus", requestId: "r3", status: "ERROR", latencyMs: null, sessionId: "tc-z", frameId: null, timestamp: "t", parseMode: "FAILED" });
    expect(failed).toMatchObject({ availability: "UNAVAILABLE", parseMode: "FAILED", symbol: null, investmentValue: null, expirationSeconds: null });
    const timeout = failedObservation({ provider: "openCodeGo", model: "qwen3.7-plus", requestId: "r4", status: "ERROR", latencyMs: null, sessionId: "tc-w", frameId: null, timestamp: "t", parseMode: "FAILED" }, "OPENCODE_GO_TIMEOUT");
    expect(timeout.notes[0]).toBe("OPENCODE_GO_TIMEOUT");
  });
  it("provenance obrigatória presente e sem segredos em qualquer observação", () => {
    const ok = normalizeObservation({ symbol: "EUR/USD" }, { provider: "openCodeGo", model: "qwen3.7-plus", requestId: "r5", status: "OK", latencyMs: 4300, sessionId: "tc-q", frameId: "f9", timestamp: "2026-09-16T00:00:00.000Z", parseMode: "DIRECT" });
    expect(ok.provenance).toMatchObject({ provider: "openCodeGo", model: "qwen3.7-plus", requestId: "r5", status: "OK", latencyMs: 4300 });
    expect(JSON.stringify(ok)).not.toMatch(/sk-|Bearer|Authorization/);
  });
});

describe("VISUAL MARKET OBSERVER — factual, nunca decide", () => {
  const prompt = (goModule as Record<string, unknown>).VISION_PROMPT as string;
  it("proibe decisao/explicacao e define extracao factual", () => {
    expect(prompt).toContain("VISUAL MARKET OBSERVER");
    expect(prompt).toContain("Do NOT decide BUY/SELL/WAIT");
    expect(prompt).toContain("NEVER invent numbers");
    expect(prompt).toContain("bodyTopY");
    expect(prompt).toContain("visualIndicators");
    expect(prompt).not.toContain('"decision"');
    expect(prompt).not.toContain("estimatedWinProbability");
    expect(prompt).not.toContain("analysisConfidence");
  });
  it("observacao factual NAO contem decision/analysis (decisao nao pertence ao Vision)", () => {
    const observation = normalizeObservation({ symbol: "EUR/USD", candles: [{ x: 10, bodyTopY: 100, bodyBottomY: 120, wickTopY: 95, wickBottomY: 125, direction: "UP" }] }, { provider: "openCodeGo", model: "qwen3.7-plus", requestId: "f1", status: "OK", latencyMs: 1000, sessionId: "tc", frameId: null, timestamp: "t", parseMode: "DIRECT" }) as Record<string, unknown>;
    expect(observation.decision).toBeUndefined();
    expect(observation.analysis).toBeUndefined();
    const candles = observation.candles as Array<Record<string, unknown>>;
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ bodyTopY: 100, bodyBottomY: 120, direction: "UP" });
  });
  it("geometria/indicadores normalizados com fail-closed e null preservado", () => {
    const observation = normalizeObservation({ symbol: "EUR/USD", candles: [{ direction: "WEIRD" }, 42], visualIndicators: { rsi: { visible: true, period: 14, displayedValue: null, slopeVisual: "UPUP", geometry: [{ x: 1, y: 2 }, { x: null, y: 3 }] } } }, { provider: "openCodeGo", model: "qwen3.7-plus", requestId: "f2", status: "OK", latencyMs: 1000, sessionId: "tc", frameId: null, timestamp: "t", parseMode: "DIRECT" }) as Record<string, any>;
    const candles = observation.candles as Array<Record<string, unknown>>;
    expect(candles).toHaveLength(2);
    expect(candles[0]!.direction).toBe("DOJI");
    expect(observation.visualIndicators.rsi).toMatchObject({ visible: true, period: 14, displayedValue: null, slopeVisual: null });
    expect(observation.visualIndicators.rsi.geometry).toHaveLength(1);
  });
});

describe("DECISION AGENT — numeros calculados, WAIT-first, fail-closed", () => {
  const go = goModule as Record<string, unknown>;
  it("prompt embute os valores calculados e proibe recalcular/inventar", () => {
    const prompt = (go.buildDecisionPrompt as (context: unknown) => string)({ market: { timeframeSeconds: 5 }, causalPrice: { value: 1.1537 }, deterministicIndicators: { rsi14: { value: 47.82, source: "DETERMINISTIC_CALCULATION" }, adx14: { value: 21.31, source: "DETERMINISTIC_CALCULATION" } }, microstructure: null, visualObservation: null, freshness: null, provenance: null });
    expect(prompt).toContain("47.82");
    expect(prompt).toContain("21.31");
    expect(prompt).toContain("1.1537");
    expect(prompt).toContain("never recompute");
    expect(prompt).toContain("WAIT-FIRST");
    expect(prompt).toContain("estimatedWinProbability MUST be null");
  });
  it("parseDecision valido preserva action/confianca clampada e forca estimatedWinProbability null", () => {
    const decision = (go.parseDecision as (text: string) => Record<string, unknown>)('{"action":"BUY","analysisConfidence":150,"estimatedWinProbability":0.9,"referencePrice":1.1537,"regime":"UPTREND","trigger":"micro-break","supportingEvidence":["a"],"contradictingEvidence":[],"primaryRisk":"timing","whatWouldChange":["x"]}');
    expect(decision.action).toBe("BUY");
    expect(decision.analysisConfidence).toBe(100);
    expect(decision.estimatedWinProbability).toBeNull();
    expect(decision.referencePrice).toBe(1.1537);
  });
  it("parseDecision invalido → UNAVAILABLE (fail-closed), WAIT e SELL validos", () => {
    const invalid = (go.parseDecision as (text: string) => Record<string, unknown>)("isso nao e json");
    expect(invalid.action).toBe("UNAVAILABLE");
    expect(invalid.estimatedWinProbability).toBeNull();
    expect((go.parseDecision as (text: string) => Record<string, unknown>)('{"action":"WAIT","analysisConfidence":20}').action).toBe("WAIT");
    expect((go.parseDecision as (text: string) => Record<string, unknown>)('{"action":"SELL","analysisConfidence":61}').action).toBe("SELL");
  });
});

describe("timeouts — coerentes com evidência real (texto 3-8s; vision JSON pode passar de 20s)", () => {
  it("vision 40s e texto 20s documentados (rota deep_background; nunca infinito)", () => {
    expect(VISION_TIMEOUT_MS).toBe(40_000);
    expect(TEXT_TIMEOUT_MS).toBe(20_000);
    expect(VISION_TIMEOUT_MS).toBeGreaterThan(4_900 * 3);
    expect(VISION_TIMEOUT_MS).toBeLessThanOrEqual(45_000); // nunca request infinito
  });
});
