/**
 * IQOPTION AUTH — fluxo server-side (email/senha -> 2FA opcional -> SSID -> sessao em memoria).
 * Auditoria Fase 1: HTTP auth -> cookie `ssid`; 2FA via token SMS; canais de erro conhecidos.
 * REGRAS: nenhuma credencial em log/persistencia/frontend; TLS SEMPRE validado (validacao padrao do fetch);
 * sessao somente em memoria do processo (relay); revogavel via disconnect(); status sanitizado.
 * Endpoints reais: EXPECTED_FROM_REPO (verificacao em runtime pelo spike read-only, com credenciais digitadas pelo usuario na UI).
 */
export const IQ_AUTH_BASE_DEFAULT = "https://auth.iqoption.com"; // EXPECTED_FROM_REPO — confirmar no spike (ACTUAL_2026)
export const AUTH_STATES = ["DISCONNECTED", "CONNECTING", "TWO_FACTOR_REQUIRED", "CONNECTED_READ_ONLY", "ERROR"];

export class IqAuthError extends Error { constructor(code, message = "") { super(message ? `${code}: ${message}` : code); this.code = code; } }

/** Redacao defensiva: nada de senha/ssid/cookie/token em mensagens, logs ou responses. */
export function sanitizeError(input, extraSecrets = []) {
  let text = typeof input === "string" ? input : String((input && input.message) ?? input ?? "");
  for (const secret of extraSecrets) { if (typeof secret === "string" && secret.length >= 4) text = text.split(secret).join("***"); }
  return text
    .replace(/(ssid=)[^&;\s"']+/gi, "$1***")
    .replace(/("ssid"\s*:\s*")[^"]+/gi, "$1***")
    .replace(/(password["'\s:=]+)[^"'\s,}]+/gi, "$1***")
    .replace(/(2fa[_-]?token["'\s:=]+)[^"'\s,}]+/gi, "$1***")
    .replace(/("token"\s*:\s*")[^"]+/gi, "$1***")
    .replace(/(authorization["'\s:=]+)[^"'\s,}]+/gi, "$1***")
    .replace(/bearer\s+[^\s"',}]+/gi, "Bearer ***")
    .replace(/(cookie["'\s:=]+)[^"'\s,}]+/gi, "$1***")
    .slice(0, 300);
}

function extractCookie(setCookieHeader, name) {
  if (typeof setCookieHeader !== "string") return null;
  const match = setCookieHeader.match(new RegExp(`(?:^|[,\\s])${name}=([^;,\\s]+)`));
  return match ? match[1] : null;
}

export class IqAuthSession {
  constructor({ baseUrl = IQ_AUTH_BASE_DEFAULT, fetchImpl = null, now = () => Date.now() } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
    this.now = now;
    this.state = "DISCONNECTED";
    this.ssid = null;
    this.emailMasked = null;
    this.twoFactorToken = null;
    this.connectedAt = null;
    this.lastError = null;
  }

  static _maskEmail(email) {
    const value = String(email ?? "");
    const at = value.indexOf("@");
    if (at <= 0) return value ? "***" : null;
    return `${value.slice(0, 1)}***${value.slice(at)}`;
  }

  snapshot() {
    return {
      state: this.state,
      email: this.emailMasked,
      twoFactorRequired: this.state === "TWO_FACTOR_REQUIRED",
      connectedAt: this.connectedAt,
      lastError: this.lastError,
      hasSession: this.ssid !== null,
    };
  }

  _fail(code, error, secrets = []) {
    this.state = "ERROR";
    this.lastError = sanitizeError(error, [this.ssid, ...secrets].filter(Boolean));
    this.ssid = null;
    throw new IqAuthError(code, this.lastError);
  }

  async login({ email, password } = {}) {
    if (typeof email !== "string" || !email.includes("@") || typeof password !== "string" || password.length === 0) {
      this._fail("INVALID_CREDENTIALS_INPUT", "email/senha ausentes");
    }
    this.state = "CONNECTING";
    this.emailMasked = IqAuthSession._maskEmail(email);
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v2/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: email, password }),
      });
    } catch (error) {
      this._fail("AUTH_NETWORK_ERROR", error);
    }
    const setCookie = response.headers?.get?.("set-cookie") ?? "";
    const ssid = extractCookie(setCookie, "ssid");
    const bodyText = await response.text().catch(() => "");
    if (response.status === 403 || /2fa|two.?factor|verification/i.test(bodyText)) {
      let parsed = null; try { parsed = JSON.parse(bodyText); } catch { /* non-json */ }
      this.twoFactorToken = parsed?.token ?? null;
      this.state = "TWO_FACTOR_REQUIRED";
      return { state: this.state, twoFactorRequired: true };
    }
    if (!response.ok || !ssid) {
      const parsed = (() => { try { return JSON.parse(bodyText); } catch { return null; } })();
      this._fail("AUTH_REJECTED", parsed?.message || bodyText || `HTTP ${response.status}`, [password]);
    }
    this._establish(ssid);
    return { state: this.state, twoFactorRequired: false };
  }

  async verifyTwoFactor(code) {
    if (this.state !== "TWO_FACTOR_REQUIRED") throw new IqAuthError("TWO_FACTOR_NOT_PENDING");
    if (typeof code !== "string" || !/^\d{4,8}$/.test(code.trim())) this._fail("INVALID_2FA_CODE_FORMAT", "codigo deve ter 4-8 digitos");
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v2/verify-2fa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim(), token: this.twoFactorToken }),
      });
    } catch (error) {
      this._fail("AUTH_NETWORK_ERROR", error);
    }
    const setCookie = response.headers?.get?.("set-cookie") ?? "";
    const ssid = extractCookie(setCookie, "ssid");
    const bodyText = await response.text().catch(() => "");
    if (!response.ok || !ssid) {
      const parsed = (() => { try { return JSON.parse(bodyText); } catch { return null; } })();
      this._fail("TWO_FACTOR_REJECTED", parsed?.message || `HTTP ${response.status}`, [code.trim()]);
    }
    this._establish(ssid);
    return { state: this.state };
  }

  _establish(ssid) {
    this.ssid = String(ssid);
    this.twoFactorToken = null;
    this.state = "CONNECTED_READ_ONLY";
    this.connectedAt = this.now();
    this.lastError = null;
  }

  /** Uso interno do relay (ws handshake). Nunca expor ao frontend/logs. */
  getSsidForHandshake() {
    if (!this.ssid) throw new IqAuthError("NO_SESSION");
    return this.ssid;
  }

  disconnect() {
    this.ssid = null;
    this.twoFactorToken = null;
    this.connectedAt = null;
    this.state = "DISCONNECTED";
    return this.snapshot();
  }
}
