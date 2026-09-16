/**
 * RUNTIME ASSET RESOLVER — descobre ativos na sessao real (nunca confia em lista estatica).
 *
 * Fonte primaria: get-initialization-data v3 (actives por secao binary/turbo).
 * Fontes auxiliares best-effort: instruments (v4), get-options (payout).
 * Persiste o ultimo mapeamento valido para diagnostico. activeId historico NUNCA e verdade absoluta.
 *
 * NORMAL ≠ OTC: a resolucao de EURUSD:NORMAL so aceita ativos SEM sufixo OTC; OTC so com sufixo.
 * Ausencia => availability NOT_FOUND (nunca substitui pelo outro mercado).
 */
import { UNIVERSE, marketKey } from "./market-universe.mjs";

export const RESOLVER_VERSION = "runtime-asset-resolver-v1";

export function canonicalFromName(rawName) {
  const cleaned = String(rawName ?? "").split(".").pop() ?? "";
  const otc = /otc/i.test(cleaned);
  const canonical = cleaned.replace(/[-_\s]?otc/ig, "").replace(/[^A-Za-z]/g, "").toUpperCase();
  return { canonical, otc };
}

function extractPayout(active) {
  if (!active || typeof active !== "object") return null;
  for (const [key, value] of Object.entries(active)) {
    if (!/payout/i.test(key)) continue;
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return { value: number, source: `initialization-data.${key}` };
  }
  const sum = Number(active.sum);
  if (Number.isFinite(sum) && sum > 0 && sum <= 100 && !/^0+$/.test(String(active.sum))) return { value: sum, source: "initialization-data.sum" };
  return null;
}

export class RuntimeAssetResolver {
  constructor({ universe = UNIVERSE, log = () => {}, now = () => Date.now() } = {}) {
    this.universe = universe;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.now = now;
    this.mapping = new Map();
    this.sectionsSeen = [];
    this.sampleActiveKeys = [];
    this.payoutByActiveId = new Map();
    this.lastResolvedAt = null;
    this.lastError = null;
    this.rawActivesSeen = 0;
  }

  ingestInitializationData(msg) {
    try {
      const source = msg?.result ?? msg ?? {};
      this.sectionsSeen = Object.keys(source).filter((key) => source[key] && typeof source[key] === "object");
      const rows = [];
      for (const section of ["binary", "turbo"]) {
        const actives = source?.[section]?.actives ?? {};
        for (const [id, active] of Object.entries(actives)) {
          this.rawActivesSeen += 1;
          if (this.sampleActiveKeys.length < 3) this.sampleActiveKeys.push(Object.keys(active ?? {}));
          const { canonical, otc } = canonicalFromName(active?.name);
          if (!canonical) continue;
          const payout = extractPayout(active);
          if (payout) this.payoutByActiveId.set(Number(id), payout.value);
          rows.push({
            activeId: Number(id), canonical, otc, section, marketType: otc ? "OTC" : "NORMAL",
            name: String(active?.name ?? ""), enabled: active?.enabled === true, suspended: active?.is_suspended === true,
            payout: payout?.value ?? null, payoutSource: payout?.source ?? null,
          });
        }
      }
      this.#merge(rows);
      return this.status();
    } catch (error) { this.lastError = String(error?.message ?? error).slice(0, 160); return this.status(); }
  }

  /** instruments (get-instruments v4), get-options e commission-changed: payout/disponibilidade auxiliares. */
  ingestAuxiliary(msg) {
    try {
      let rows = [];
      if (Array.isArray(msg)) rows = msg;
      else if (Array.isArray(msg?.instruments)) rows = msg.instruments;
      else if (Array.isArray(msg?.open_options)) rows = msg.open_options;
      else if (Array.isArray(msg?.payouts)) rows = msg.payouts;
      else if (msg && typeof msg === "object") {
        for (const [key, value] of Object.entries(msg)) {
          if (/^\d+$/.test(key) && value && typeof value === "object") rows.push({ active_id: Number(key), ...value });
          else if (value && typeof value === "object" && (value.active_id !== undefined || value.payout !== undefined)) rows.push(value);
        }
      }
      for (const row of rows) {
        const activeId = Number(row?.active_id ?? row?.activeId ?? row?.id);
        const payoutValue = Number(row?.payout ?? row?.payout_percent ?? row?.win ?? NaN);
        if (Number.isFinite(activeId) && Number.isFinite(payoutValue) && payoutValue > 0) this.payoutByActiveId.set(activeId, payoutValue);
      }
      if (rows.length) this.#refreshPayouts();
    } catch { /* best effort */ }
    return this.status();
  }

  #refreshPayouts() {
    const now = this.now();
    for (const [key, row] of this.mapping.entries()) {
      if (row.activeId === null || row.activeId === undefined) continue;
      const payout = this.payoutByActiveId.get(Number(row.activeId));
      if (Number.isFinite(payout) && payout > 0 && row.payout !== payout) this.mapping.set(key, { ...row, payout, payoutSource: row.payoutSource?.startsWith("commission") ? row.payoutSource : "commission-changed", resolvedAt: now });
      else if (!Number.isFinite(payout) && row.payoutSource?.startsWith("initialization-data.sum")) { /* mantem leitura inicial */ }
    }
  }

  #merge(rows) {
    const now = this.now();
    for (const entry of this.universe) {
      const key = marketKey(entry.canonical, entry.marketType);
      const matches = rows.filter((row) => row.canonical === entry.canonical && row.marketType === entry.marketType);
      const open = matches.filter((row) => row.enabled && !row.suspended);
      const selected = open[0] ?? matches[0] ?? null;
      const sections = [...new Set(matches.map((row) => row.section))];
      if (!selected) {
        this.mapping.set(key, {
          marketKey: key, symbol: entry.symbol, display: entry.display, marketType: entry.marketType, canonical: entry.canonical,
          activeId: null, instrumentTypes: [], availability: "NOT_FOUND", enabledLive: false, suspended: false,
          payout: null, payoutSource: null, resolvedAt: now, candidates: [],
        });
        continue;
      }
      const payout = selected.payout ?? this.payoutByActiveId.get(selected.activeId) ?? null;
      this.mapping.set(key, {
        marketKey: key, symbol: entry.symbol, display: entry.display, marketType: entry.marketType, canonical: entry.canonical,
        activeId: selected.activeId, instrumentTypes: sections, availability: open.length ? "OPEN" : selected.enabled ? "SUSPENDED" : "DISABLED",
        enabledLive: selected.enabled, suspended: selected.suspended,
        payout, payoutSource: payout === null ? null : (selected.payoutSource ?? "auxiliary"),
        resolvedAt: now,
        candidates: matches.map((row) => ({ activeId: row.activeId, section: row.section, enabled: row.enabled, suspended: row.suspended })),
      });
    }
    this.lastResolvedAt = now;
    this.lastError = null;
  }

  get(key) { return this.mapping.get(key) ?? null; }
  resolvedCount() { return [...this.mapping.values()].filter((row) => row.activeId !== null).length; }

  status() {
    return {
      resolverVersion: RESOLVER_VERSION,
      lastResolvedAt: this.lastResolvedAt,
      lastError: this.lastError,
      sectionsSeen: this.sectionsSeen,
      rawActivesSeen: this.rawActivesSeen,
      sampleActiveKeys: this.sampleActiveKeys,
      markets: [...this.mapping.values()].map((row) => ({ ...row })),
    };
  }

  toJSON() { return { resolverVersion: RESOLVER_VERSION, lastResolvedAt: this.lastResolvedAt, resolvedAt: this.lastResolvedAt, markets: [...this.mapping.values()] }; }
  loadFrom(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.markets)) return false;
    for (const row of snapshot.markets) { if (row?.marketKey) this.mapping.set(row.marketKey, { ...row, availability: row.availability ?? "UNKNOWN", staleSnapshot: true }); }
    this.lastResolvedAt = Number(snapshot.lastResolvedAt) || null;
    return true;
  }
}
