/** Ajustes finais — contratos: banca 5%, provider seguro, share ação, métricas de sessão, labels operacionais. */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import handler from "../../api/http";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../../src/http/public/app.js");
const consoleJs = read("../../src/http/public/strategy-console.js");
const indexHtml = read("../../src/http/public/classic.html");

describe("banca — limite de 5% por operação (sem martingale)", () => {
  const limitOf = (total: number): number => {
    const match = /const LIMIT_PCT = ([0-9.]+);/.exec(consoleJs);
    expect(match).not.toBeNull();
    const percent = Number(match?.[1]);
    expect(percent).toBe(5);
    return (total * percent) / 100;
  };
  it("banca 100→5, 200→10, 300→15, 400→20, 1000→50", () => {
    expect(limitOf(100)).toBe(5);
    expect(limitOf(200)).toBe(10);
    expect(limitOf(300)).toBe(15);
    expect(limitOf(400)).toBe(20);
    expect(limitOf(1000)).toBe(50);
  });
  it("formata em BRL e não promete martingale", () => {
    expect(consoleJs).toContain("toLocaleString(\"pt-BR\", { style: \"currency\", currency: \"BRL\" })");
    expect(consoleJs).not.toMatch(/martingale\s*=\s*true/i);
  });
});

describe("share — ação da sidebar (não rota) e cancelamento seguro", () => {
  it("sidebar da Fase 4.1 nao expoe Area Operacional nem Compartilhar Tela (foco no Escritorio)", () => {
    expect(indexHtml).not.toMatch(/data-action="share"[^>]*>.*Compartilhar Tela/);
    expect(indexHtml).not.toMatch(/data-page="share"/);
    expect(indexHtml).not.toMatch(/data-page="operational"/);
    expect(indexHtml).toMatch(/data-page="office"/);
  });
  it("app.js trata cancelamento do seletor sem erro feio", () => {
    expect(app).toContain("SHARE_CANCELLED_OR_UNAVAILABLE");
    expect(app).toContain("NotAllowedError");
    expect(app).toContain("getDisplayMedia");
  });
});

describe("métricas de sessão — causais e sem contaminação", () => {
  it("tempo analisado só cresce com contexto válido e análise recente", () => {
    expect(app).toContain("sessionAnalyzedMs");
    expect(app).toMatch(/valid = state\.marketContext\?\.validationStatus === "VALID" && Boolean\(state\.lastAnalysis\)/);
    expect(app).toMatch(/now - last <= 2_000/);
  });
  it("candles contam buckets 5s distintos das observações de preço válidas", () => {
    expect(app).toContain("sessionValidCandles");
    expect(app).toMatch(/new Set\(\)/);
    expect(app).toMatch(/priceObservations/);
  });
  it("viés deriva de trend/lean causal com provenance (sem dados futuros)", () => {
    expect(app).toContain("deriveSessionBias");
    expect(app).toContain("biasProvenance");
    expect(app).not.toMatch(/deriveSessionBias\([^)]*outcome/);
  });
  it("FAST PERF não aparece na área operacional (stage técnico vira texto amigável)", () => {
    expect(app).toContain("OPERATIONAL_STAGE_TEXT");
    expect(indexHtml).not.toContain("FAST PERF");
    expect(consoleJs).not.toContain("FAST PERF");
  });
  it("estado IDLE é exibido como AGUARDANDO OPERAÇÃO", () => {
    expect(app).toMatch(/IDLE: "AGUARDANDO OPERAÇÃO"/);
    expect(indexHtml).toContain("AGUARDANDO OPERAÇÃO");
  });
  it("bloco CONFIGURAÇÃO DETECTADA existe com ativo/valor/expiração e fonte real", () => {
    expect(indexHtml).toContain("configAsset");
    expect(indexHtml).toContain("configValue");
    expect(indexHtml).toContain("configExpiry");
    expect(consoleJs).toContain("detectedExpirationSeconds");
    expect(consoleJs).toContain("IDENTIFICANDO");
  });
});

describe("provider de IA — segurança da API key", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];
  const OPERATOR_KEY = "test-operator-key-final-adjustments";
  const previousOperatorKey = process.env.TRACECOM_OPERATOR_KEY;
  beforeAll(() => { process.env.TRACECOM_OPERATOR_KEY = OPERATOR_KEY; });
  afterAll(async () => {
    if (previousOperatorKey === undefined) delete process.env.TRACECOM_OPERATOR_KEY;
    else process.env.TRACECOM_OPERATOR_KEY = previousOperatorKey;
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });
  async function endpoint(): Promise<string> {
    const server = createServer((req, res) => { void handler(req, res); });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("no_address");
    return `http://127.0.0.1:${address.port}`;
  }
  async function operatorCookie(base: string): Promise<string> {
    process.env.TRACECOM_OPERATOR_KEY = OPERATOR_KEY;
    const response = await fetch(`${base}/api/auth/operator`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessKey: OPERATOR_KEY }) });
    expect(response.status).toBe(200);
    return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  }
  it("GET anonimo exige operador (401); autenticado retorna NOT_CONFIGURED sem vazar chave", async () => {
    const base = await endpoint();
    const anonymous = await fetch(`${base}/api/ai/provider`);
    expect(anonymous.status).toBe(401);
    const cookie = await operatorCookie(base);
    const response = await fetch(`${base}/api/ai/provider`, { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("NOT_CONFIGURED");
    expect(body).not.toMatch(/sk-/);
  });
  it("PUT rejeita chave curta e nunca ecoa a chave válida quando o store falha", async () => {
    const base = await endpoint();
    const cookie = await operatorCookie(base);
    const short = await fetch(`${base}/api/ai/provider`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ apiKey: "curta" }) });
    expect(short.status).toBe(400);
    const secret = `sk-test-${"x".repeat(28)}`;
    const stored = await fetch(`${base}/api/ai/provider`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ apiKey: secret }) });
    const body = await stored.text();
    expect(body).not.toContain(secret);
    expect([200, 502]).toContain(stored.status);
  });
  it("frontend nunca persiste a chave em storage e usa campo password", () => {
    expect(indexHtml).toMatch(/id="aiApiKey"[^>]*type="password"/);
    expect(consoleJs).not.toMatch(/localStorage[^\n]*apiKey/i);
    expect(consoleJs).not.toMatch(/sessionStorage[^\n]*apiKey/i);
    expect(consoleJs).not.toMatch(/console\.(log|info|warn|error)[^\n]*apiKey/i);
  });
});
