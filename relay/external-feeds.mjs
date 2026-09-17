/**
 * EXTERNAL FEEDS (Fase 5.1) — integracao real e conservadora de MACRO (calendario economico) e NEWS (RSS).
 *
 * Regras:
 *  - Nada e inventado: se a fonte falhar, publica-se nada e o dominio permanece NO_FEED/STALE.
 *  - Point-in-time: publishedAt vem da propria fonte (data do evento / pubDate); observedAt/receivedAt do fetch.
 *  - NORMAL != OTC: marketsAffected recebe APENAS chaves NORMAL; OTC nunca e afetado automaticamente
 *    (contexto externo em OTC permanece experimental/shadow).
 *  - TTL por dominio; importancia por impacto.
 *  - Nunca bloqueia o hot path (fetch assincrono com timeout curto).
 */
export const FEEDS_VERSION = "external-feeds-v1";
export const MACRO_SOURCE = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
export const NEWS_SOURCE = "https://www.forexlive.com/feed/news";

const COUNTRY_CURRENCY = { US: "USD", EU: "EUR", EMU: "EUR", GB: "GBP", UK: "GBP", JP: "JPY", AU: "AUD", CA: "CAD", CH: "CHF", NZ: "NZD" };
const CURRENCY_PATTERN = /\b(USD|EUR|GBP|JPY|AUD|CAD|CHF|NZD)\b/gi;

export function normalKeysForCurrencies(currencies, universe = []) {
  const set = new Set(currencies.map((currency) => String(currency).toUpperCase()));
  return universe.filter((entry) => entry.marketType === "NORMAL" && entry.currencies?.some((currency) => set.has(currency))).map((entry) => `${entry.canonical}:NORMAL`);
}

export function parseMacroCalendar(rows, { universe = [], now = Date.now() } = {}) {
  const items = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const impact = String(row?.impact ?? "").toLowerCase();
    if (!["high", "medium"].includes(impact)) continue;
    const publishedAt = Date.parse(String(row?.date ?? ""));
    if (!Number.isFinite(publishedAt)) continue;
    if (publishedAt < now - 6 * 60 * 60 * 1000) continue; // eventos muito antigos nao entram
    const currency = COUNTRY_CURRENCY[String(row?.country ?? "").toUpperCase()] ?? null;
    if (!currency) continue;
    const marketsAffected = normalKeysForCurrencies([currency], universe);
    items.push({
      payload: { title: String(row?.title ?? "").slice(0, 160), country: row?.country ?? null, currency, impact, forecast: row?.forecast ?? null, previous: row?.previous ?? null },
      meta: { source: MACRO_SOURCE, sourceType: "EXTERNAL", publishedAt, observedAt: publishedAt, receivedAt: now, expiresAt: publishedAt + 2 * 60 * 60 * 1000, importance: impact === "high" ? 0.9 : 0.55, currenciesAffected: [currency], marketsAffected, dataQuality: "OK", provenance: { feed: "forexfactory-calendar", impact } },
    });
  }
  return items;
}

export function parseNewsRss(xml, { universe = [], now = Date.now() } = {}) {
  const items = [];
  const blocks = String(xml ?? "").split(/<item[\s>]/i).slice(1);
  for (const block of blocks.slice(0, 30)) {
    const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) ?? [])[1];
    const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) ?? [])[1];
    if (!title) continue;
    const publishedAt = pub ? Date.parse(pub) : NaN;
    if (!Number.isFinite(publishedAt)) continue;
    if (publishedAt < now - 12 * 60 * 60 * 1000) continue;
    const currencies = [...new Set((String(title).match(CURRENCY_PATTERN) ?? []).map((value) => value.toUpperCase()))];
    const marketsAffected = currencies.length ? normalKeysForCurrencies(currencies, universe) : [];
    items.push({
      payload: { headline: String(title).replace(/\s+/g, " ").trim().slice(0, 200), currencies },
      meta: { source: NEWS_SOURCE, sourceType: "EXTERNAL", publishedAt, observedAt: publishedAt, receivedAt: now, expiresAt: publishedAt + 6 * 60 * 60 * 1000, importance: currencies.length ? 0.6 : 0.4, currenciesAffected: currencies, marketsAffected, dataQuality: "OK", provenance: { feed: "forexlive-rss" } },
    });
  }
  return items;
}

export class ExternalFeedSync {
  constructor({ fetchImpl = globalThis.fetch, log = () => {}, universe = [], now = () => Date.now(), apply = () => {}, macroIntervalMs = 15 * 60_000, newsIntervalMs = 5 * 60_000, timeoutMs = 8_000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.universe = universe;
    this.now = now;
    this.apply = apply;
    this.macroIntervalMs = macroIntervalMs;
    this.newsIntervalMs = newsIntervalMs;
    this.timeoutMs = timeoutMs;
    this.timers = [];
    this.state = { MACRO: { status: "NO_FEED", lastSyncAt: null, items: 0, lastError: null }, NEWS: { status: "NO_FEED", lastSyncAt: null, items: 0, lastError: null } };
  }

  async #fetchText(url) {
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs), headers: { "user-agent": "tracecom-relay/1.0" } });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.text();
  }

  async syncMacro() {
    try {
      const text = await this.#fetchText(MACRO_SOURCE);
      const rows = JSON.parse(text);
      const items = parseMacroCalendar(rows, { universe: this.universe, now: this.now() });
      this.apply("MACRO", items);
      const upcoming = items.filter((item) => item.meta.publishedAt > this.now() - 60 * 60 * 1000).length;
      this.state.MACRO = { status: "OK", lastSyncAt: this.now(), items: items.length, upcoming, lastError: null };
      this.log("IQ_FEED_MACRO_SYNCED", JSON.stringify({ items: items.length, upcoming }));
    } catch (error) {
      this.state.MACRO = { ...this.state.MACRO, status: this.state.MACRO.status === "OK" ? "STALE" : "NO_FEED", lastError: String(error?.message ?? error).slice(0, 80) };
      this.log("IQ_FEED_MACRO_FAILED", String(error?.message ?? error).slice(0, 80));
    }
    return this.state.MACRO;
  }

  async syncNews() {
    try {
      const xml = await this.#fetchText(NEWS_SOURCE);
      const items = parseNewsRss(xml, { universe: this.universe, now: this.now() });
      this.apply("NEWS", items);
      this.state.NEWS = { status: "OK", lastSyncAt: this.now(), items: items.length, lastError: null };
      this.log("IQ_FEED_NEWS_SYNCED", JSON.stringify({ items: items.length }));
    } catch (error) {
      this.state.NEWS = { ...this.state.NEWS, status: this.state.NEWS.status === "OK" ? "STALE" : "NO_FEED", lastError: String(error?.message ?? error).slice(0, 80) };
      this.log("IQ_FEED_NEWS_FAILED", String(error?.message ?? error).slice(0, 80));
    }
    return this.state.NEWS;
  }

  start() {
    void this.syncMacro();
    void this.syncNews();
    this.timers.push(setInterval(() => void this.syncMacro(), this.macroIntervalMs));
    this.timers.push(setInterval(() => void this.syncNews(), this.newsIntervalMs));
    for (const timer of this.timers) timer.unref?.();
    return this.status();
  }
  stop() { for (const timer of this.timers) clearInterval(timer); this.timers = []; }
  status() { return { version: FEEDS_VERSION, sources: { MACRO: MACRO_SOURCE, NEWS: NEWS_SOURCE }, state: this.state, tradingImpact: "CONTEXT_ONLY_NEVER_ORDERS" }; }
}
