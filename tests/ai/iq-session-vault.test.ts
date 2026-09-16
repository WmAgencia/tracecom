/** VAULT CRITIC — sessao IQ criptografada: roundtrip, chave errada, zero plaintext, clear no disconnect. */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const vault = await import("../../relay/iq-session-vault.mjs");
const vaultApi = vault as unknown as {
  clearSession: (pool: unknown) => Promise<unknown>;
  decryptSecret: (sealed: { enc: string; iv: string; tag: string }, key: Buffer) => string;
  deriveKey: (secret: string) => Buffer;
  encryptSecret: (plain: string, key: Buffer) => { enc: string; iv: string; tag: string };
  loadSession: (pool: unknown, secret: string) => Promise<{ ssid: string; emailMasked: string | null; connectedAt: number | null } | null>;
  saveSession: (pool: unknown, secret: string, record: { ssid: string; emailMasked?: string | null; connectedAt?: number | null }) => Promise<unknown>;
};
const { clearSession, decryptSecret, deriveKey, encryptSecret, loadSession, saveSession } = vaultApi;

const SECRET = "server-side-signing-secret";

describe("VAULT — AES-256-GCM", () => {
  it("roundtrip com a mesma chave; chave errada falha (auth tag)", () => {
    const key = deriveKey(SECRET);
    const sealed = encryptSecret("SSID-SUPER-SECRETO-123456", key);
    expect(decryptSecret(sealed, key)).toBe("SSID-SUPER-SECRETO-123456");
    let thrown = false;
    try { decryptSecret(sealed, deriveKey("outra-chave")); } catch { thrown = true; }
    expect(thrown).toBe(true);
  });
  it("payload persistido nao contem plaintext (ssid nem aparece nos parametros)", async () => {
    const captured: unknown[][] = [];
    const pool = { query: async (sql: string, params: unknown[]) => { captured.push([sql, params]); return { rows: [] }; } };
    await saveSession(pool, SECRET, { ssid: "SSID-SUPER-SECRETO-123456", emailMasked: "w***@gmail.com", connectedAt: 123 });
    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain("SSID-SUPER-SECRETO-123456");
    expect(serialized).toContain("w***@gmail.com");
  });
  it("loadSession restaura com a chave certa e retorna null com chave errada/tabela vazia", async () => {
    const key = deriveKey(SECRET);
    const sealed = encryptSecret("SSID-RESTORE-OK-12345678", key);
    const row = { ssid_enc: sealed.enc, iv: sealed.iv, tag: sealed.tag, email_masked: "w***@gmail.com", connected_at: "999" };
    const pool = { query: async () => ({ rows: [row] }) };
    expect(await loadSession(pool, SECRET)).toMatchObject({ ssid: "SSID-RESTORE-OK-12345678", emailMasked: "w***@gmail.com", connectedAt: 999 });
    expect(await loadSession(pool, "chave-errada")).toBeNull();
    expect(await loadSession({ query: async () => ({ rows: [] }) }, SECRET)).toBeNull();
  });
  it("clearSession remove a linha (usado somente no DISCONNECT explicito)", async () => {
    const statements: string[] = [];
    await clearSession({ query: async (sql: string) => { statements.push(sql); return { rows: [] }; } });
    expect(statements.some((sql) => /DELETE FROM iq_auth_session/i.test(sql))).toBe(true);
  });
});
