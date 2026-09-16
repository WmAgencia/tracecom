/** VAULT — criptografia da sessao IQ (AES-256-GCM). Chave derivada de segredo do servidor; zero plaintext. */
import crypto from "node:crypto";
export function deriveKey(secret) { return crypto.createHash("sha256").update(`iq-session-v1:${String(secret ?? "")}`).digest(); }
export function encryptSecret(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return { enc: encrypted.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
export function decryptSecret({ enc, iv, tag }, key) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(String(iv), "base64"));
  decipher.setAuthTag(Buffer.from(String(tag), "base64"));
  return Buffer.concat([decipher.update(Buffer.from(String(enc), "base64")), decipher.final()]).toString("utf8");
}
export async function saveSession(pool, secret, { ssid, emailMasked = null, connectedAt = null }) {
  const key = deriveKey(secret);
  const sealed = encryptSecret(ssid, key);
  await pool.query("INSERT INTO iq_auth_session(id,ssid_enc,iv,tag,email_masked,connected_at,updated_at) VALUES(1,$1,$2,$3,$4,$5,now()) ON CONFLICT(id) DO UPDATE SET ssid_enc=EXCLUDED.ssid_enc, iv=EXCLUDED.iv, tag=EXCLUDED.tag, email_masked=EXCLUDED.email_masked, connected_at=EXCLUDED.connected_at, updated_at=now()", [sealed.enc, sealed.iv, sealed.tag, emailMasked, connectedAt]);
  return true;
}
export async function loadSession(pool, secret) {
  try {
    const row = (await pool.query("SELECT ssid_enc, iv, tag, email_masked, connected_at FROM iq_auth_session WHERE id=1")).rows[0];
    if (!row) return null;
    const ssid = decryptSecret({ enc: row.ssid_enc, iv: row.iv, tag: row.tag }, deriveKey(secret));
    if (typeof ssid !== "string" || ssid.length < 8) return null;
    return { ssid, emailMasked: row.email_masked ?? null, connectedAt: row.connected_at ? Number(row.connected_at) : null };
  } catch { return null; }
}
export async function clearSession(pool) { await pool.query("DELETE FROM iq_auth_session WHERE id=1").catch(() => undefined); return true; }
