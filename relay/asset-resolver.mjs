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

/** Aliases reais descobertos na sessao IQ (Fase 7). NUNCA inventar IDs: apenas nomes->canonico. */
export const NAME_ALIASES = {
  USNDAQ100: "US100", USSPX500: "US500", GERMANY30: "GER30", JAPAN225: "JP225", EURO50: "EU50",
  FRANCE40: "FR40", HONGKONG33: "HK33", SPAIN35: "SP35", UK100: "UK100", AUS200: "AUS200",
  USOUSD: "WTI", UKOUSD: "BRENT", XNGUSD: "NATGAS", XAUUSD: "XAUUSD", XAGUSD: "XAGUSD",
};

/**
 * Nomes IQ reais (Fase 7): prefixo de servidor (`front.`), sufixos de familia
 * (`-OTC` OTC; `-op` e `:N` NORMAL) e aliases. Compostos (com `/`) sao rejeitados:
 * nunca associar um instrumento composto a um ativo simples.
 */
export function canonicalFromName(rawName) {
  const cleaned = String(rawName ?? "").split(".").pop() ?? "";
  if (cleaned.includes("/")) return { canonical: null, otc: false }; // composto (ex.: GER30/UK100-OTC)
  const otc = /otc/i.test(cleaned);
  const base = cleaned
    .replace(/[-_\s]?otc/ig, "")
    .replace(/[-_\s]?op$/i, "")
    .replace(/[-_\s]?:n$/i, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  if (!base) return { canonical: null, otc };
  return { canonical: NAME_ALIASES[base] ?? base, otc };
}

function extractPayout(active) {
  if (!active || typeof active !== "object") return null;
  const profit = active?.option?.profit;
  const commissionRaw = profit && typeof profit === "object" ? (profit.commission?.value ?? profit.commission) : null;
  const commission = Number(commissionRaw);
  if (Number.isFinite(commission) && commission >= 0 && commission < 100) return { value: Number((100 - commission).toFixed(2)), source: "initialization-data.option.profit.commission" };
  for (const [key, value] of Object.entries(active)) {
    if (!/payout/i.test(key)) continue;
    const number = Number(value?.value ?? value);
    if (Number.isFinite(number) && number > 0) return { value: number, source: `initialization-data.${key}` };
  }
  return null;
}

export class RuntimeAssetResolver {
  constructor({ universe = UNIVERSE, log = () => {}, now = () => Date.now() } = {}) {
    this.universe = universe;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.now = now;
    this.mapping = new Map();
    this.optionsRefreshCount = 0;
    this.sectionsSeen = [];
    this.sampleActiveKeys = [];
    this.payoutByActiveId = new Map();
    this.lastResolvedAt = null;
    this.lastError = null;
    this.lastSnapshotIncomplete = false;
    this.lastSnapshotResolved = null;
    this.rawActivesSeen = 0;
    this.auxMessages = 0;
    this.lastAuxShape = null;
    this.sampleOptionShape = null;
    this.rawSections = [];
    this.rawCatalog = [];
    this.digitalByCanonical = new Map();
  }

  ingestInitializationData(msg) {
    try {
      const source = msg?.result ?? msg ?? {};
      this.sectionsSeen = Object.keys(source).filter((key) => source[key] && typeof source[key] === "object");
      const rows = [];
      const catalog = [];
      this.rawSections = this.sectionsSeen.filter((key) => source?.[key]?.actives && typeof source[key].actives === "object");
      for (const section of this.rawSections) {
        const actives = source?.[section]?.actives ?? {};
        for (const [id, active] of Object.entries(actives)) {
          this.rawActivesSeen += 1;
          if (this.sampleActiveKeys.length < 3) this.sampleActiveKeys.push(Object.keys(active ?? {}));
          if (!this.sampleOptionShape && active?.option) this.sampleOptionShape = { keys: Object.keys(active.option ?? {}), profit: active.option?.profit ?? null };
          const { canonical, otc } = canonicalFromName(active?.name);
          if (!canonical) continue;
          const payout = extractPayout(active);
          if (payout) this.payoutByActiveId.set(Number(id), payout.value);
          catalog.push({ section, activeId: Number(id), name: String(active?.name ?? ""), canonical, otc, enabled: active?.enabled === true, suspended: active?.is_suspended === true, payout: payout?.value ?? null });
          if (section === "digital") { if (!this.digitalByCanonical.has(canonical)) this.digitalByCanonical.set(canonical, []); this.digitalByCanonical.get(canonical).push({ activeId: Number(id), otc, enabled: active?.enabled === true, suspended: active?.is_suspended === true }); continue; }
          if (section !== "binary" && section !== "turbo") continue;
          rows.push({
            activeId: Number(id), canonical, otc, section, marketType: otc ? "OTC" : "NORMAL",
            name: String(active?.name ?? ""), enabled: active?.enabled === true, suspended: active?.is_suspended === true,
            payout: payout?.value ?? null, payoutSource: payout?.source ?? null,
          });
        }
      }
      this.rawCatalog = catalog.slice(0, 500);
      this.#merge(rows);
      return this.status();
    } catch (error) { this.lastError = String(error?.message ?? error).slice(0, 160); return this.status(); }
  }

  /** instruments (get-instruments v4), get-options e commission-changed: payout/disponibilidade auxiliares. */
  ingestAuxiliary(msg) {
    this.auxMessages += 1;
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
      if (!this.lastAuxShape) {
        const sample = rows[0] ?? (msg && typeof msg === "object" ? msg : null);
        this.lastAuxShape = sample && typeof sample === "object" ? Object.keys(sample).slice(0, 24) : null;
      }
      for (const row of rows) {
        const activeId = Number(row?.active_id ?? row?.activeId ?? row?.id);
        const payoutValue = Number(row?.payout ?? row?.payout_percent ?? row?.win ?? NaN);
        if (Number.isFinite(activeId) && Number.isFinite(payoutValue) && payoutValue > 0) this.payoutByActiveId.set(activeId, payoutValue);
      }
      const commissionActiveId = Number(msg?.active_id ?? msg?.activeId);
      const commissionValue = Number(msg?.commission?.value ?? msg?.commission);
      if (Number.isFinite(commissionActiveId) && Number.isFinite(commissionValue) && commissionValue >= 0 && commissionValue < 100) this.payoutByActiveId.set(commissionActiveId, Number((100 - commissionValue).toFixed(2)));
      if (rows.length || Number.isFinite(commissionActiveId)) this.#refreshPayouts();
    } catch { /* best effort */ }
    return this.status();
  }

  #refreshPayouts() {
    const now = this.now();
    for (const [key, row] of this.mapping.entries()) {
      if (row.activeId === null || row.activeId === undefined) continue;
      const payout = this.payoutByActiveId.get(Number(row.activeId));
      if (!Number.isFinite(payout) || payout <= 0) continue;
      const source = row.payoutSource?.startsWith("commission") ? row.payoutSource : "commission-changed";
      if (row.payout !== payout || row.payoutSource !== source) this.mapping.set(key, { ...row, payout, payoutSource: source, resolvedAt: now });
    }
  }

  #merge(rows) {
    const now = this.now();
    const previous = this.mapping;
    const previousResolved = [...previous.values()].filter((row) => row.activeId !== null && row.activeId !== undefined).length;
    const next = new Map();
    for (const entry of this.universe) {
      const key = marketKey(entry.canonical, entry.marketType);
      const matches = rows.filter((row) => row.canonical === entry.canonical && row.marketType === entry.marketType);
      const open = matches.filter((row) => row.enabled && !row.suspended);
      const selected = open[0] ?? matches[0] ?? null;
      const sections = [...new Set(matches.map((row) => row.section))];
      if (!selected) {
        // Broker NAO lista o instrumento em nenhuma secao: NOT_OFFERED (nunca confundir com mercado fechado/suspenso).
        const digital = this.digitalByCanonical.get(entry.canonical) ?? [];
        next.set(key, {
          marketKey: key, symbol: entry.symbol, display: entry.display, marketType: entry.marketType, canonical: entry.canonical,
          activeId: null, instrumentTypes: [], availability: "NOT_OFFERED", enabledLive: false, suspended: false, offered: false,
          product: digital.length ? "DIGITAL_ONLY" : "NONE",
          digitalCandidates: digital.length, digitalOpen: digital.some((row) => row.enabled && !row.suspended),
          payout: null, payoutSource: null, resolvedAt: now, candidates: [],
        });
        continue;
      }
      const payout = selected.payout ?? this.payoutByActiveId.get(selected.activeId) ?? null;
      const digital = this.digitalByCanonical.get(entry.canonical) ?? [];
      next.set(key, {
        marketKey: key, symbol: entry.symbol, display: entry.display, marketType: entry.marketType, canonical: entry.canonical,
        activeId: selected.activeId, instrumentTypes: sections, availability: open.length ? "OPEN" : selected.enabled ? "SUSPENDED" : "DISABLED",
        enabledLive: selected.enabled, suspended: selected.suspended, offered: true, product: "BINARY_TURBO",
        digitalCandidates: digital.length, digitalOpen: digital.some((row) => row.enabled && !row.suspended),
        payout, payoutSource: payout === null ? null : (selected.payoutSource ?? "auxiliary"),
        resolvedAt: now,
        candidates: matches.map((row) => ({ activeId: row.activeId, section: row.section, enabled: row.enabled, suspended: row.suspended })),
      });
    }
    const nextResolved = [...next.values()].filter((row) => row.activeId !== null && row.activeId !== undefined).length;
    // Snapshot incompleto (feed ausente/parcial/reconectando): o broker deixou de listar ativos ja confirmados.
    // Regra arquitetural: feed desconhecido/stale/ausente => UNKNOWN, NUNCA SUSPENDED/NOT_OFFERED.
    // SUSPENDED so permanece quando o snapshot e completo (mesmo universo de ativos resolvidos).
    const incomplete = previousResolved > 0 && nextResolved < previousResolved;
    this.lastSnapshotIncomplete = incomplete;
    this.lastSnapshotResolved = { previous: previousResolved, next: nextResolved };
    for (const [key, row] of next.entries()) {
      const prev = previous.get(key);
      const wasConfirmed = Boolean(prev && prev.activeId !== null && prev.activeId !== undefined);
      const downgraded = row.availability === "SUSPENDED" || row.availability === "NOT_OFFERED" || row.availability === "DISABLED";
      row.staleSnapshot = incomplete && wasConfirmed && downgraded;
      next.set(key, row);
    }
    this.mapping = next;
    this.lastResolvedAt = now;
    this.lastError = null;
  }

  get(key) {
    const row = this.mapping.get(key) ?? null;
    if (!row) return null;
    // Snapshot persistido nao e verdade operacional: SUSPENDED/NOT_FOUND de cache vira UNKNOWN ate o broker confirmar.
    if (row.staleSnapshot === true && (row.availability === "SUSPENDED" || row.availability === "NOT_FOUND" || row.availability === "NOT_OFFERED" || row.availability === "DISABLED")) {
      return { ...row, availability: "UNKNOWN", suspended: false };
    }
    return row;
  }

  /** Evidencia bruta lado a lado com o resolver (nunca adivinha: mostra o que a IQ retornou). */
  evidence(marketKeys = null) {
    const rows = [...this.mapping.values()].filter((row) => !marketKeys || marketKeys.includes(row.marketKey)).map((row) => ({
      marketKey: row.marketKey, type: row.marketType, canonical: row.canonical,
      resolver: { availability: row.availability, activeId: row.activeId, offered: row.offered ?? null, product: row.product ?? null, instrumentTypes: row.instrumentTypes ?? [], candidates: row.candidates ?? [], digitalCandidates: row.digitalCandidates ?? 0, digitalOpen: row.digitalOpen ?? false, payout: row.payout ?? null },
      brokerRaw: this.rawCatalog.filter((entry) => entry.canonical === row.canonical).map((entry) => ({ section: entry.section, activeId: entry.activeId, name: entry.name, otc: entry.otc, enabled: entry.enabled, suspended: entry.suspended, payout: entry.payout })),
    }));
    return { sections: this.rawSections, sectionsSeen: this.sectionsSeen, sampleOptionShape: this.sampleOptionShape, sampleActiveKeys: this.sampleActiveKeys, lastAuxShape: this.lastAuxShape, lastResolvedAt: this.lastResolvedAt, rows };
  }
  resolvedCount() { return [...this.mapping.values()].filter((row) => row.activeId !== null).length; }

  status() {
    return {
      resolverVersion: RESOLVER_VERSION,
      lastResolvedAt: this.lastResolvedAt,
      lastError: this.lastError,
      lastSnapshotIncomplete: this.lastSnapshotIncomplete === true,
      lastSnapshotResolved: this.lastSnapshotResolved,
      sectionsSeen: this.sectionsSeen,
      rawActivesSeen: this.rawActivesSeen,
      sampleActiveKeys: this.sampleActiveKeys,
      sampleOptionShape: this.sampleOptionShape,
      auxMessages: this.auxMessages,
      lastAuxShape: this.lastAuxShape,
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
