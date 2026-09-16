/** AUTH CRITIC — fluxo login/2FA/sessao: transicoes, redacao de segredos, zero persistencia, TLS validado. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const auth = await import("../../relay/iqoption-auth.mjs");
const { IqAuthError, IqAuthSession, sanitizeError } = auth as unknown as { IqAuthError: new (code: string, message?: string) => Error; IqAuthSession: new (options?: Record<string, unknown>) => any; sanitizeError: (input: unknown, extraSecrets?: string[]) => string };

const response = (status: number, { ssid = null, body = "{}" } = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (name: string) => (name === "set-cookie" && ssid ? `ssid=${ssid}; Path=/; HttpOnly; Secure` : null) }, text: async () => body });

describe("AUTH — login/2FA/SSID state machine", () => {
  it("login OK → CONNECTED_READ_ONLY com sessao em memoria e status sanitizado (sem ssid/senha)", async () => {
    const session = new IqAuthSession({ fetchImpl: async () => response(200, { ssid: "SESSION-SECRET-123" }) });
    const result = await session.login({ email: "user@example.com", password: "super-secret" });
    expect(result).toMatchObject({ state: "CONNECTED_READ_ONLY", twoFactorRequired: false });
    const snapshot = session.snapshot();
    expect(snapshot).toMatchObject({ state: "CONNECTED_READ_ONLY", email: "u***@example.com", hasSession: true });
    expect(JSON.stringify(snapshot)).not.toContain("SESSION-SECRET-123");
    expect(JSON.stringify(snapshot)).not.toContain("super-secret");
    expect(session.getSsidForHandshake()).toBe("SESSION-SECRET-123");
    expect(session.disconnect()).toMatchObject({ state: "DISCONNECTED", hasSession: false });
    expect(() => session.getSsidForHandshake()).toThrowError(/NO_SESSION/);
  });
  it("2FA exigido → TWO_FACTOR_REQUIRED → verify OK → CONNECTED_READ_ONLY", async () => {
    let call = 0;
    const session = new IqAuthSession({ fetchImpl: async () => { call += 1; return call === 1 ? response(403, { body: '{"token":"2fa-token-abc","message":"2fa required"}' }) : response(200, { ssid: "SSID-AFTER-2FA" }); } });
    const first = await session.login({ email: "user@example.com", password: "pw" });
    expect(first).toMatchObject({ twoFactorRequired: true });
    expect(session.snapshot()).toMatchObject({ state: "TWO_FACTOR_REQUIRED", twoFactorRequired: true });
    const verified = await session.verifyTwoFactor("123456");
    expect(verified).toMatchObject({ state: "CONNECTED_READ_ONLY" });
    expect(session.snapshot().hasSession).toBe(true);
  });
  it("2FA invalido/rejeitado → ERROR sanitizado (sem token/codigo nas mensagens) e sessao limpa", async () => {
    let call = 0;
    const session = new IqAuthSession({ fetchImpl: async () => { call += 1; return call === 1 ? response(403, { body: '{"token":"tk-secret-999"}' }) : response(400, { body: '{"message":"invalid code 123456 ssid=LEAK-ABC"}' }); } });
    await session.login({ email: "user@example.com", password: "pw" });
    let error = null; try { await session.verifyTwoFactor("123456"); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(IqAuthError);
    const message = String((error as { message?: string } | null)?.message ?? error ?? "");
    expect(message).not.toContain("123456");
    expect(message).not.toContain("tk-secret-999");
    expect(message).not.toContain("LEAK-ABC");
    expect(session.snapshot()).toMatchObject({ state: "ERROR", hasSession: false });
  });
  it("credenciais rejeitadas e erros de rede → ERROR, nunca credenciais vazadas; entrada invalida rejeitada", async () => {
    const rejected = new IqAuthSession({ fetchImpl: async () => response(401, { body: '{"message":"wrong password=hunter2"}' }) });
    let error = null; try { await rejected.login({ email: "u@x.com", password: "hunter2" }); } catch (caught) { error = caught; }
    expect(String((error as { message?: string } | null)?.message ?? "")).not.toContain("hunter2");
    const network = new IqAuthSession({ fetchImpl: async () => { throw new Error("fetch failed ssid=NET-LEAK"); } });
    let networkError = null; try { await network.login({ email: "u@x.com", password: "pw" }); } catch (caught) { networkError = caught; }
    expect(String(networkError?.message ?? "")).not.toContain("NET-LEAK");
    await expect(new IqAuthSession({ fetchImpl: async () => response(200) }).login({ email: "bad", password: "" })).rejects.toThrowError(/INVALID_CREDENTIALS_INPUT/);
  });
});

describe("SECRET LEAK — modulo em si", () => {
  const source = readFileSync(new URL("../../relay/iqoption-auth.mjs", import.meta.url), "utf8");
  it("sem console/log, sem storage, sem TLS inseguro, sem persistencia", () => {
    expect(source).not.toMatch(/console\.(log|info|warn|error)/);
    expect(source).not.toMatch(/localStorage|sessionStorage|writeFile|fs\./);
    expect(source).not.toMatch(/rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|verify\s*=\s*false/i);
  });
  it("sanitizeError remove ssid/senha/token/authorization/cookie de textos arbitrarios", () => {
    const dirty = 'url?ssid=ABC123&x=1 password=hunter2 {"token":"ttt"} authorization=Bearer xyz cookie=sess=9';
    const clean = sanitizeError(dirty, ["ABC123"]);
    for (const secret of ["ABC123", "hunter2", "ttt", "Bearer xyz", "sess=9"]) expect(clean).not.toContain(secret);
    expect(clean).toContain("***");
  });
});
