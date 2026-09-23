/**
 * V3 — EXPIRATION DISCOVERY (read-only, protocolo real da IQ).
 *
 * Fonte: initialization-data v3 -> result.binary.actives[activeId].option
 *   - option.expiration_times : expirations REAIS oferecidas pela IQ (epoch s ou ms)
 *   - option.exp_time         : expiration corrente (quando presente)
 *   - active.deadtime         : purchase deadline do broker (segundos antes da expiration)
 *
 * A descoberta NAO decide nada: registra firstSeen (brokerNow) e firstSeenTteMs por
 * (marketKey, expirationAt), deduplica e mede a cadencia. A "oportunidade" nasce quando a
 * expiration vira a FRENTE COMPRAVEL (TTE > deadtime) com TTE <= discoveryMaxTteMs.
 */
export const V3_DISCOVERY_VERSION = "v3-expiration-discovery-v1";

const toMs = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
};

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};
const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
};

export function parseActiveExpirations(active) {
  const option = active?.option ?? {};
  const timestamps = [];
  const durations = new Set();
  const push = (value) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) { for (const item of value) push(item); return; }
    if (typeof value === "object") { push(value.expiration ?? value.expired ?? value.time ?? value.at); return; }
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    // Evidencia real de producao (2026-09-23): `option.expiration_times` traz DURACOES
    // (ex.: 60000 = 60s, 900000 = 15min), nao timestamps. Timestamps reais sao epoch
    // (>= 1e9 s ou >= 1e12 ms). Nada de inferir expiry a partir de duracao.
    if (n >= 1e12) timestamps.push(n);
    else if (n >= 1e9) timestamps.push(n * 1000);
    else durations.add(n < 1000 ? n * 1000 : n);
  };
  push(option.expiration_times);
  push(option.exp_time);
  const deadtimeRaw = Number(active?.deadtime);
  const deadtimeMs = Number.isFinite(deadtimeRaw) && deadtimeRaw > 0 ? (deadtimeRaw > 1000 ? deadtimeRaw : deadtimeRaw * 1000) : null;
  return {
    timestamps: [...new Set(timestamps)].sort((a, b) => a - b),
    allowedDurationsMs: [...durations].sort((a, b) => a - b),
    deadtimeMs,
    buybackDeadtimeMs: (() => { const raw = Number(active?.buyback_deadtime); return Number.isFinite(raw) && raw > 0 ? (raw > 1000 ? raw : raw * 1000) : null; })(),
  };
}

export class ExpirationDiscovery {
  constructor({ now = () => Date.now(), discoveryMaxTteMs = 330_000, maxSamples = 2_000, onOffer = null } = {}) {
    this.now = now;
    this.discoveryMaxTteMs = discoveryMaxTteMs;
    this.maxSamples = maxSamples;
    this.onOffer = typeof onOffer === "function" ? onOffer : null;
    this.offers = new Map();
    this.samples = [];
    this.byMarket = new Map();
    this.lastIngestAt = null;
    this.ingestCount = 0;
    this.duplicateCount = 0;
  }

  /** Ativos binarios: recebe pares { marketKey, active, section } resolvidos pelo chamador. */
  ingest({ actives = [], brokerNow = null } = {}) {
    const at = Number.isFinite(Number(brokerNow)) ? Number(brokerNow) : this.now();
    this.lastIngestAt = at;
    this.ingestCount += 1;
    let newOffers = 0;
    for (const row of actives) {
      const marketKey = String(row?.marketKey ?? "");
      const active = row?.active ?? {};
      if (!marketKey) continue;
      const parsed = parseActiveExpirations(active);
      const state = this.byMarket.get(marketKey) ?? { marketKey, section: row.section ?? null, deadtimeMs: null, allowedDurationsMs: [], timestamps: new Map(), lastEnabled: null };
      state.deadtimeMs = parsed.deadtimeMs ?? state.deadtimeMs;
      state.allowedDurationsMs = parsed.allowedDurationsMs.length ? parsed.allowedDurationsMs : state.allowedDurationsMs;
      state.section = row.section ?? state.section;
      state.lastEnabled = active?.enabled === true && active?.is_suspended !== true;
      for (const expirationAt of parsed.timestamps) {
        const key = `${marketKey}|${expirationAt}`;
        if (this.offers.has(key)) { this.duplicateCount += 1; continue; }
        const tteMs = expirationAt - at;
        const offer = {
          key, marketKey, activeId: Number(active?.id ?? row?.activeId ?? NaN) || null, expirationAt, firstSeenAt: at, firstSeenTteMs: tteMs,
          deadtimeMs: parsed.deadtimeMs, buybackDeadtimeMs: parsed.buybackDeadtimeMs,
          payout: Number(active?.option?.profit?.commission) >= 0 ? Number((100 - Number(active.option.profit.commission)).toFixed(2)) : null,
          buyable: active?.enabled === true && active?.is_suspended !== true,
          source: "initialization-data.timestamps",
        };
        this.offers.set(key, offer);
        state.timestamps.set(expirationAt, { expirationAt, firstSeenAt: at, firstSeenTteMs: tteMs });
        newOffers += 1;
        this.samples.push(offer);
        if (this.samples.length > this.maxSamples) this.samples.splice(0, this.samples.length - this.maxSamples);
        if (this.onOffer) { try { this.onOffer(offer); } catch { /* observacional */ } }
      }
      this.byMarket.set(marketKey, state);
    }
    return { newOffers, markets: this.byMarket.size };
  }

  /**
   * Frente compravel DERIVADA do relogio do broker: proxima fronteira operacional
   * (multiplo de operativeDurationMs) que ainda pode ser comprada (TTE > deadtime).
   * A IQ nao publica a lista de expirations absolutas (confirmado em producao:
   * `option.expiration_times` = duracoes); a expiration-alvo e validada pelo ACK.
   */
  front(marketKey, brokerNow = null, { operativeDurationMs = 300_000 } = {}) {
    const at = Number.isFinite(Number(brokerNow)) ? Number(brokerNow) : this.now();
    const state = this.byMarket.get(String(marketKey));
    if (!state) return null;
    const deadtimeMs = Number.isFinite(Number(state.deadtimeMs)) ? Number(state.deadtimeMs) : 0;
    let expirationAt = (Math.floor(at / operativeDurationMs) + 1) * operativeDurationMs;
    let guard = 0;
    while (expirationAt - at <= deadtimeMs && guard < 12) { expirationAt += operativeDurationMs; guard += 1; }
    return { marketKey: String(marketKey), expirationAt, tteMs: expirationAt - at, deadtimeMs, operativeDurationMs, allowedDurationsMs: state.allowedDurationsMs, offer: this.offers.get(`${marketKey}|${expirationAt}`) ?? null };
  }

  /** Oportunidades candidatas: frente compravel com TTE <= discoveryMaxTteMs. */
  due(brokerNow = null) {
    const at = Number.isFinite(Number(brokerNow)) ? Number(brokerNow) : this.now();
    const out = [];
    for (const marketKey of this.byMarket.keys()) {
      const front = this.front(marketKey, at);
      if (!front) continue;
      if (front.tteMs <= this.discoveryMaxTteMs) out.push(front);
    }
    return out;
  }

  distribution() {
    const values = [...this.offers.values()].map((offer) => offer.firstSeenTteMs).filter((value) => Number.isFinite(value));
    const durations = [...new Set([...this.byMarket.values()].flatMap((state) => state.allowedDurationsMs))].sort((a, b) => a - b);
    const deadtimes = [...new Set([...this.byMarket.values()].map((state) => state.deadtimeMs).filter((value) => Number.isFinite(value)))].sort((a, b) => a - b);
    return {
      offers: values.length,
      markets: this.byMarket.size,
      firstSeenTteMs: { min: values.length ? Math.min(...values) : null, median: median(values), p95: percentile(values, 0.95), max: values.length ? Math.max(...values) : null },
      allowedDurationsMs: durations,
      deadtimeMs: deadtimes,
      note: "Producao (2026-09-23): option.expiration_times = DURACOES (60s/900s), nao timestamps; a expiration-alvo e derivada de brokerNow+deadtime e validada pelo ACK.",
    };
  }

  status() {
    return {
      version: V3_DISCOVERY_VERSION,
      lastIngestAt: this.lastIngestAt,
      ingestCount: this.ingestCount,
      duplicateCount: this.duplicateCount,
      markets: this.byMarket.size,
      offers: this.offers.size,
      distribution: this.distribution(),
      marketDetail: [...this.byMarket.values()].map((state) => ({ marketKey: state.marketKey, section: state.section, deadtimeMs: state.deadtimeMs, allowedDurationsMs: state.allowedDurationsMs, enabled: state.lastEnabled })).slice(0, 120),
    };
  }
}
