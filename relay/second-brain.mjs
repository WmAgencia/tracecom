/**
 * SECOND BRAIN ADAPTER (Fase 6) — conexao segura e escopada ao Segundo Cerebro/Obsidian.
 *
 * Modos (nunca cria um "segundo cerebro" concorrente; conecta-se ao existente):
 *  - OFFLINE: nenhuma conexao configurada; agentes usam apenas o Core Brain + biblioteca do repo.
 *  - LOCAL_FS: copia server-side autorizada do vault (Obsidian Headless/sync oficial). Escopo obrigatorio: TraceCom/.
 *  - REST: Second Brain Knowledge API ja existente (SECOND_BRAIN_BASE_URL/SECOND_BRAIN_TOKEN server-side).
 *
 * Regras: credenciais nunca no frontend/log/audit/prompt; acesso restrito ao namespace TraceCom;
 * escrita automatica proibida em "00 - Core Brain" e "15 - Validated Knowledge" (somente via Promotion Gate).
 */
import fs from "node:fs/promises";
import path from "node:path";

export const SECOND_BRAIN_SCOPE = "TraceCom/";
export const SYSTEM_VERSION = "second-brain-adapter-v1";
export const PROTECTED_PREFIXES = ["00 - Core Brain", "15 - Validated Knowledge"];
export const PROVENANCE_TYPES = ["CORE_BRAIN", "OBSIDIAN_KNOWLEDGE", "VALIDATED_LESSON", "AGENT_MEMORY", "MARKET_DATA", "CENTRAL_INTELLIGENCE", "EXTERNAL_SOURCE"];

export class SecondBrainError extends Error { constructor(code, detail = "") { super(detail ? `${code}: ${detail}` : code); this.code = code; } }

export function normalizeScopePath(relative) {
  const value = String(relative ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!value.startsWith(SECOND_BRAIN_SCOPE)) throw new SecondBrainError("SCOPE_VIOLATION", `${value} fora de ${SECOND_BRAIN_SCOPE}`);
  if (value.includes("..")) throw new SecondBrainError("SCOPE_VIOLATION", "path traversal bloqueado");
  return value;
}
export function isProtectedPath(relative) {
  const value = String(relative ?? "").replaceAll("\\", "/");
  return PROTECTED_PREFIXES.some((prefix) => value.startsWith(`${SECOND_BRAIN_SCOPE}${prefix}`) || value.startsWith(prefix));
}

export class SecondBrainAdapter {
  constructor({ vaultPath = process.env.SECOND_BRAIN_VAULT_PATH || null, baseUrl = process.env.SECOND_BRAIN_BASE_URL || null, token = process.env.SECOND_BRAIN_TOKEN || null, fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {}, namespaceRoot = null } = {}) {
    this.vaultPath = vaultPath || null;
    this.baseUrl = baseUrl ? String(baseUrl).replace(/\/$/, "") : null;
    this.token = token || null;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.namespaceRoot = namespaceRoot ?? (this.vaultPath ? path.join(this.vaultPath) : null);
    this.mode = this.baseUrl ? "REST" : this.vaultPath ? "LOCAL_FS" : "OFFLINE";
    this.lastError = null;
    this.lastCheckAt = null;
  }

  status() {
    return {
      version: SYSTEM_VERSION, mode: this.mode, scope: SECOND_BRAIN_SCOPE,
      configured: this.mode !== "OFFLINE",
      credentials: { tokenPresent: Boolean(this.token), vaultPathPresent: Boolean(this.vaultPath), baseUrlPresent: Boolean(this.baseUrl) },
      lastError: this.lastError, lastCheckAt: this.lastCheckAt,
      policy: { readScope: SECOND_BRAIN_SCOPE, writeProtected: PROTECTED_PREFIXES, autoPromotionToValidatedForbidden: true },
    };
  }

  async probe() {
    this.lastCheckAt = this.now();
    try {
      if (this.mode === "OFFLINE") return { reachable: false, reason: "OFFLINE" };
      if (this.mode === "LOCAL_FS") {
        await fs.access(this.vaultPath);
        await fs.access(path.join(this.vaultPath, "TraceCom")).catch(async () => { await fs.mkdir(path.join(this.vaultPath, "TraceCom"), { recursive: true }); });
        return { reachable: true, mode: this.mode };
      }
      const response = await this.fetchImpl(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(5_000) });
      return { reachable: response.ok, mode: this.mode, status: response.status };
    } catch (error) {
      this.lastError = String(error?.code ?? error?.message ?? error).slice(0, 80);
      return { reachable: false, reason: this.lastError };
    }
  }

  #absolute(relative) {
    const scoped = normalizeScopePath(relative);
    const root = this.namespaceRoot ?? (this.vaultPath ? path.join(this.vaultPath) : null);
    if (!root) throw new SecondBrainError("VAULT_NOT_CONFIGURED");
    const absolute = path.resolve(root, scoped);
    const normalizedRoot = path.resolve(root, SECOND_BRAIN_SCOPE);
    if (!absolute.startsWith(normalizedRoot)) throw new SecondBrainError("SCOPE_VIOLATION", "fora do namespace TraceCom");
    return absolute;
  }

  async readNote(relative) {
    if (this.mode === "OFFLINE") return null;
    if (this.mode === "LOCAL_FS") return fs.readFile(this.#absolute(relative), "utf8").catch(() => null);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/notes?scope=TRACECOM&path=${encodeURIComponent(normalizeScopePath(relative))}`, { headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return null;
      const body = await response.json().catch(() => null);
      return typeof body?.content === "string" ? body.content : null;
    } catch (error) { this.lastError = String(error?.message ?? error).slice(0, 80); return null; }
  }

  async writeNote(relative, content, { promotion = false } = {}) {
    const scoped = normalizeScopePath(relative);
    if (isProtectedPath(scoped) && promotion !== true) throw new SecondBrainError("PROMOTION_GATE_REQUIRED", scoped);
    if (this.mode === "OFFLINE") return { written: false, reason: "OFFLINE" };
    if (this.mode === "LOCAL_FS") {
      const absolute = this.#absolute(scoped);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content, "utf8");
      return { written: true, mode: this.mode, path: scoped };
    }
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/notes`, { method: "POST", headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" }, body: JSON.stringify({ scope: "TRACECOM", path: scoped, content, promotion: promotion === true }), signal: AbortSignal.timeout(10_000) });
      return { written: response.ok, mode: this.mode, status: response.status };
    } catch (error) { this.lastError = String(error?.message ?? error).slice(0, 80); return { written: false, reason: this.lastError }; }
  }

  async listNamespace() {
    if (this.mode === "OFFLINE") return [];
    if (this.mode === "LOCAL_FS") {
      const root = path.join(this.vaultPath, "TraceCom");
      const entries = [];
      const walk = async (directory) => {
        const rows = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
        for (const row of rows) {
          const absolute = path.join(directory, row.name);
          if (row.isDirectory()) await walk(absolute);
          else if (row.name.endsWith(".md")) entries.push(path.relative(this.vaultPath, absolute).replaceAll("\\", "/"));
        }
      };
      await walk(root);
      return entries;
    }
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/notes/list?scope=TRACECOM`, { headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return [];
      const body = await response.json().catch(() => ({}));
      return Array.isArray(body?.notes) ? body.notes : [];
    } catch { return []; }
  }
}
