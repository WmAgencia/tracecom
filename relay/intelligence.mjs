/**
 * GLOBAL INTELLIGENCE STATE (Fase 5) — snapshots versionados e point-in-time.
 *
 * Regras inviolaveis:
 *  - Toda informacao externa tem source/sourceType/observedAt/publishedAt/receivedAt/expiresAt/dataQuality/provenance.
 *  - Informacao expirada nunca entra em decisao (snapshot filtrado por atMs).
 *  - Informacao publicada depois de uma decisao nunca aparece retroativamente nela (point-in-time).
 *  - Ausencia de informacao = NO_FEED/UNAVAILABLE (nunca "neutro").
 *  - MACRO/NEWS sem integracao real ficam NO_FEED (nada inventado).
 */
export const INTELLIGENCE_VERSION = "intelligence-v1";
export const INTELLIGENCE_DOMAINS = ["MACRO", "NEWS", "MARKET", "RISK", "SECURITY", "RESEARCH"];
export const DEFAULT_TTL_MS = { MACRO: 15 * 60_000, NEWS: 30 * 60_000, MARKET: 60_000, RISK: 30_000, SECURITY: 60_000, RESEARCH: 5 * 60_000 };

export function normalizeExternalItem(item, { now, defaultTtlMs = 30 * 60_000 } = {}) {
  const observedAt = Number(item?.observedAt ?? now);
  const publishedAt = item?.publishedAt === null || item?.publishedAt === undefined ? null : Number(item.publishedAt);
  const receivedAt = Number(item?.receivedAt ?? now);
  const expiresAt = Number(item?.expiresAt ?? (Math.max(observedAt, publishedAt ?? observedAt, receivedAt) + (Number(item?.ttlMs) || defaultTtlMs)));
  return {
    source: String(item?.source ?? "UNKNOWN").slice(0, 120),
    sourceType: item?.sourceType === "EXTERNAL" ? "EXTERNAL" : "INTERNAL",
    observedAt, publishedAt, receivedAt, expiresAt,
    currenciesAffected: Array.isArray(item?.currenciesAffected) ? item.currenciesAffected.map((value) => String(value).toUpperCase()).slice(0, 8) : [],
    marketsAffected: Array.isArray(item?.marketsAffected) ? item.marketsAffected.map((value) => String(value)).slice(0, 20) : [],
    importance: Math.max(0, Math.min(1, Number(item?.importance) || 0)),
    dataQuality: ["OK", "PARTIAL", "STALE", "UNAVAILABLE"].includes(item?.dataQuality) ? item.dataQuality : "OK",
    provenance: item?.provenance && typeof item.provenance === "object" ? item.provenance : {},
  };
}

export class GlobalIntelligenceState {
  constructor({ now = () => Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
    this.now = now;
    this.ttlMs = { ...DEFAULT_TTL_MS, ...ttlMs };
    this.history = new Map(INTELLIGENCE_DOMAINS.map((domain) => [domain, []]));
    this.versions = new Map(INTELLIGENCE_DOMAINS.map((domain) => [domain, 0]));
    this.lastPublished = new Map();
  }

  /** Publica snapshot (append-only). Point-in-time correto: chamadas no passado enxergam apenas o que existia. */
  publish(domain, payload = {}, options = {}) {
    if (!INTELLIGENCE_DOMAINS.includes(domain)) throw new Error(`UNKNOWN_INTELLIGENCE_DOMAIN:${domain}`);
    const now = this.now();
    const item = normalizeExternalItem({ ...options, ...(payload?.__meta ?? {}) }, { now, defaultTtlMs: this.ttlMs[domain] ?? 30 * 60_000 });
    const version = (this.versions.get(domain) ?? 0) + 1;
    this.versions.set(domain, version);
    const snapshot = {
      domain, version, status: options.status ?? (item.dataQuality === "UNAVAILABLE" ? "NO_FEED" : "OK"),
      observedAt: item.observedAt, publishedAt: item.publishedAt, receivedAt: item.receivedAt, expiresAt: item.expiresAt,
      currenciesAffected: item.currenciesAffected, marketsAffected: item.marketsAffected,
      importance: item.importance, dataQuality: item.dataQuality,
      source: item.source, sourceType: item.sourceType, provenance: item.provenance,
      payload,
    };
    const list = this.history.get(domain);
    list.push(snapshot);
    if (list.length > 500) list.splice(0, list.length - 500);
    this.lastPublished.set(domain, now);
    return snapshot;
  }

  /** Snapshot valido para o instante atMs (point-in-time + TTL). null => EXTERNAL_CONTEXT_UNAVAILABLE. */
  snapshot(domain, { atMs = null } = {}) {
    const at = atMs === null ? this.now() : Number(atMs);
    const list = this.history.get(domain) ?? [];
    let latest = null;
    for (const snapshot of list) {
      const effective = snapshot.publishedAt ?? snapshot.observedAt;
      if (effective > at) continue;
      if (snapshot.expiresAt <= at) continue;
      if (snapshot.status === "NO_FEED") continue;
      latest = snapshot;
    }
    return latest;
  }

  all({ atMs = null } = {}) {
    const out = {};
    for (const domain of INTELLIGENCE_DOMAINS) out[domain] = this.snapshot(domain, { atMs });
    return out;
  }

  status({ atMs = null } = {}) {
    const at = atMs === null ? this.now() : Number(atMs);
    const out = {};
    for (const domain of INTELLIGENCE_DOMAINS) {
      const list = this.history.get(domain) ?? [];
      const current = this.snapshot(domain, { atMs: at });
      const last = list[list.length - 1] ?? null;
      const ageMs = current ? at - (current.publishedAt ?? current.observedAt) : last ? at - (last.publishedAt ?? last.observedAt) : null;
      out[domain] = {
        status: current ? "OK" : last ? (last.status === "NO_FEED" ? "NO_FEED" : "STALE") : "NO_FEED",
        version: this.versions.get(domain) ?? 0,
        ageMs, source: current?.source ?? last?.source ?? null, sourceType: current?.sourceType ?? last?.sourceType ?? null,
        dataQuality: current?.dataQuality ?? "UNAVAILABLE",
        marketsAffected: current?.marketsAffected ?? [], currenciesAffected: current?.currenciesAffected ?? [],
        expiresAt: current?.expiresAt ?? null, payloadAvailable: Boolean(current),
      };
    }
    return out;
  }

  /** Macros/noticias relevantes a um mercado, apenas se validas no instante e marcadas para ele (OTC nunca herda NORMAL). */
  contextForMarket(marketKey, marketType, { atMs = null } = {}) {
    const macro = this.snapshot("MACRO", { atMs });
    const news = this.snapshot("NEWS", { atMs });
    const applicable = (snapshot) => {
      if (!snapshot) return null;
      if (!snapshot.marketsAffected.length && !snapshot.currenciesAffected.length) return null;
      if (snapshot.marketsAffected.length && !snapshot.marketsAffected.includes(marketKey)) return null;
      return snapshot;
    };
    const macroForMarket = applicable(macro);
    const newsForMarket = applicable(news);
    return {
      macro: macroForMarket ? { domain: "MACRO", version: macroForMarket.version, importance: macroForMarket.importance, dataQuality: macroForMarket.dataQuality, sourceType: macroForMarket.sourceType, payload: macroForMarket.payload } : null,
      news: newsForMarket ? { domain: "NEWS", version: newsForMarket.version, importance: newsForMarket.importance, dataQuality: newsForMarket.dataQuality, sourceType: newsForMarket.sourceType, payload: newsForMarket.payload } : null,
      experimental: marketType === "OTC",
      note: marketType === "OTC" ? "contexto externo em OTC e experimental/shadow (sem evidencia prospectiva propria ainda)" : null,
    };
  }
}
