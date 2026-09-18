/**
 * IQ Official MCP — shadow orchestrator.
 *
 * Periodically (default 60s + jitter) compares the TraceCom office snapshot
 * with the read-only IQ MCP catalog/account and appends reconciliation records
 * to JSONL. It is strictly outside the trading path:
 * - runs only when IQ_MCP_ENABLED=true AND IQ_MCP_SHADOW=true;
 * - cadence is a recursive timeout with jitter (never per tick, never inside
 *   the JIT/hot path, never on demand from feature/decision code);
 * - every failure is fail-soft: MCP down never affects trading, never throws.
 *
 * No trading imports. Reads via the adapter (read-only tools only) and the
 * public office endpoint; writes only the diagnostic JSONL.
 */

import { HEALTH, IQOfficialMCPAdapter } from "./adapter.mjs";
import {
  DEFAULT_RECONCILIATION_PATH,
  buildComparisons,
  persistRecords,
  summarize,
} from "./reconciliation.mjs";

export const DEFAULT_INTERVAL_MS = 60_000;
export const DEFAULT_JITTER_MS = 5_000;
export const DEFAULT_OFFICE_URL = "https://tracecom.consecom.com.br/api/iq/office";
export const DEFAULT_TIMEOUT_MS = 15_000;

function envBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nonNegativeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function failError(code, message) {
  const error = new Error(String(message ?? code));
  error.code = code;
  return error;
}

/** Shadow requires BOTH switches; IQ_MCP_SHADOW alone is not enough. */
export function shadowEnabled(env = process.env) {
  return envBool(env.IQ_MCP_ENABLED, false) && envBool(env.IQ_MCP_SHADOW, false);
}

export class IQMCPShadowRunner {
  #timer = null;

  constructor(options = {}) {
    const env = options.env ?? process.env;
    this.env = env;
    this.enabled = options.enabled ?? shadowEnabled(env);
    this.intervalMs = positiveNumber(options.intervalMs ?? env.IQ_MCP_SHADOW_INTERVAL_MS, DEFAULT_INTERVAL_MS);
    this.jitterMs = nonNegativeNumber(options.jitterMs ?? env.IQ_MCP_SHADOW_JITTER_MS, DEFAULT_JITTER_MS);
    this.officeUrl = options.officeUrl ?? env.IQ_MCP_OFFICE_URL ?? DEFAULT_OFFICE_URL;
    this.timeoutMs = positiveNumber(options.timeoutMs ?? env.IQ_MCP_SHADOW_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    this.persistPath = options.persistPath ?? env.IQ_MCP_RECONCILIATION_PATH ?? DEFAULT_RECONCILIATION_PATH;
    this.persistEnabled = options.persist ?? envBool(env.IQ_MCP_RECONCILIATION_PERSIST, true);
    this.now = options.now ?? (() => Date.now());
    this.fetchImpl = options.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
    this.adapter = options.adapter ?? new IQOfficialMCPAdapter({ env, product: options.product ?? env.IQ_MCP_PRODUCT ?? "binary" });
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    this.random = options.random ?? Math.random;
    this.fsImpl = options.fs ?? null;
    this.logger = options.logger ?? null;

    this.running = false;
    this.nextRunAt = null;
    this.runs = 0;
    this.failures = 0;
    this.consecutiveFailures = 0;
    this.lastRunAt = null;
    this.lastDurationMs = null;
    this.lastSummary = null;
    this.lastError = null;
    this.lastTrigger = null;
    this.persistWrites = 0;
    this.persistRecords = 0;
    this.persistErrors = 0;
  }

  #health() {
    return typeof this.adapter?.health === "function" ? this.adapter.health() : HEALTH.UNAVAILABLE;
  }

  #log(event, payload) {
    if (typeof this.logger === "function") this.logger(event, payload);
  }

  #disabledResult(trigger, startedAt) {
    return {
      ok: false,
      trigger,
      code: "MCP_SHADOW_DISABLED",
      error: { code: "MCP_SHADOW_DISABLED", message: "IQ_MCP_ENABLED and IQ_MCP_SHADOW must both be true" },
      mcpHealth: this.#health(),
      runAt: startedAt,
      durationMs: 0,
      practiceOnly: true,
    };
  }

  #failRun({ code, message, trigger, startedAt }) {
    this.failures += 1;
    this.consecutiveFailures += 1;
    this.lastRunAt = this.now();
    this.lastDurationMs = Math.max(0, this.lastRunAt - startedAt);
    this.lastTrigger = trigger;
    this.lastError = { code, message: String(message ?? code), at: this.lastRunAt };
    this.#log("iq_mcp_shadow_failed", { code, message: this.lastError.message });
    return {
      ok: false,
      trigger,
      code,
      error: { code, message: this.lastError.message },
      mcpHealth: this.#health(),
      runAt: this.lastRunAt,
      durationMs: this.lastDurationMs,
      practiceOnly: true,
    };
  }

  /* ------------------------------ scheduler ------------------------------ */

  #schedule() {
    if (!this.running) return;
    const jitter = this.jitterMs > 0 ? Math.floor(this.random() * this.jitterMs) : 0;
    const delayMs = this.intervalMs + jitter;
    this.nextRunAt = this.now() + delayMs;
    this.#timer = this.setTimer(() => {
      this.#timer = null;
      void this.#tick();
    }, delayMs);
    this.#timer?.unref?.();
  }

  async #tick() {
    if (!this.running) return;
    await this.runOnce({ trigger: "schedule" });
    this.#schedule();
  }

  start({ immediate = false } = {}) {
    if (!this.enabled) return { ok: false, code: "MCP_SHADOW_DISABLED" };
    if (this.running) return { ok: true, alreadyRunning: true, intervalMs: this.intervalMs, jitterMs: this.jitterMs };
    this.running = true;
    if (immediate) void this.#tick();
    else this.#schedule();
    return { ok: true, alreadyRunning: false, intervalMs: this.intervalMs, jitterMs: this.jitterMs };
  }

  stop() {
    this.running = false;
    if (this.#timer) {
      this.clearTimer(this.#timer);
      this.#timer = null;
    }
    this.nextRunAt = null;
    return { ok: true, running: false };
  }

  /* -------------------------------- fetch -------------------------------- */

  async #fetchOffice() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.officeUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response || typeof response.ok !== "boolean") throw failError("OFFICE_FETCH_FAILED", "office fetch returned no response");
      if (!response.ok) throw failError("OFFICE_HTTP_ERROR", `office HTTP ${response.status}`);
      const text = typeof response.text === "function" ? await response.text() : "";
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw failError("OFFICE_MALFORMED", "office body is not JSON");
      }
      if (!data || typeof data !== "object") throw failError("OFFICE_MALFORMED", "office body is not an object");
      return data;
    } catch (error) {
      if (error?.name === "AbortError" || controller.signal.aborted) throw failError("OFFICE_TIMEOUT", `office fetch exceeded ${this.timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------------- one pass ------------------------------ */

  async runOnce({ trigger = "manual" } = {}) {
    const startedAt = this.now();
    if (!this.enabled) return this.#disabledResult(trigger, startedAt);

    this.runs += 1;
    try {
      const office = await this.#fetchOffice();

      const assetsResult = await this.adapter.listAssets();
      if (!assetsResult?.ok) {
        const code = assetsResult?.error?.code ?? "MCP_UNAVAILABLE";
        return this.#failRun({ code, message: assetsResult?.error?.message ?? code, trigger, startedAt });
      }
      const accountResult = await this.adapter.getAccountState();
      if (!accountResult?.ok) {
        const code = accountResult?.error?.code ?? "MCP_UNAVAILABLE";
        return this.#failRun({ code, message: accountResult?.error?.message ?? code, trigger, startedAt });
      }

      const nowMs = this.now();
      const records = buildComparisons({
        markets: Array.isArray(office.markets) ? office.markets : [],
        mcpAssets: assetsResult.data ?? [],
        account: office,
        mcpAccount: accountResult.data ?? null,
        sourceTimestamp: office.at ?? office.serverTime ?? null,
        mcpTimestamp: nowMs,
        now: nowMs,
      });
      const summary = summarize(records);

      let persisted = null;
      let persistError = null;
      if (this.persistEnabled && records.length > 0) {
        try {
          const written = await persistRecords(records, { path: this.persistPath, fsImpl: this.fsImpl });
          this.persistWrites += 1;
          this.persistRecords += written.written;
          persisted = { path: written.path, written: written.written };
        } catch (error) {
          this.persistErrors += 1;
          persistError = String(error?.message ?? error);
          this.#log("iq_mcp_shadow_persist_failed", { message: persistError });
        }
      }

      this.consecutiveFailures = 0;
      this.lastRunAt = nowMs;
      this.lastDurationMs = Math.max(0, nowMs - startedAt);
      this.lastSummary = summary;
      this.lastError = null;
      this.lastTrigger = trigger;
      this.#log("iq_mcp_shadow_run", { trigger, records: records.length, agreementRate: summary.agreementRate });

      return {
        ok: true,
        trigger,
        runAt: nowMs,
        durationMs: this.lastDurationMs,
        records: records.length,
        summary,
        mcpHealth: this.#health(),
        persisted,
        persistError,
        practiceOnly: true,
      };
    } catch (error) {
      return this.#failRun({
        code: error?.code ?? "MCP_SHADOW_ERROR",
        message: error?.message ?? String(error),
        trigger,
        startedAt,
      });
    }
  }

  /* -------------------------------- status ------------------------------- */

  getShadowStatus() {
    return {
      enabled: this.enabled,
      running: this.running,
      intervalMs: this.intervalMs,
      jitterMs: this.jitterMs,
      nextRunAt: this.nextRunAt,
      lastRunAt: this.lastRunAt,
      lastTrigger: this.lastTrigger,
      lastDurationMs: this.lastDurationMs,
      runs: this.runs,
      failures: this.failures,
      consecutiveFailures: this.consecutiveFailures,
      mcpHealth: this.#health(),
      agreementRate: this.lastSummary?.agreementRate ?? null,
      summary: this.lastSummary,
      lastError: this.lastError,
      persistence: {
        path: this.persistPath,
        enabled: this.persistEnabled,
        writes: this.persistWrites,
        records: this.persistRecords,
        errors: this.persistErrors,
      },
      practiceOnly: true,
    };
  }
}

export default IQMCPShadowRunner;

