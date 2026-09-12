/* Strict IQ Option asset resolver: a valid pair needs real currencies, never arbitrary words. */
(() => {
  "use strict";
  const CURRENCIES = new Set(["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "ZAR", "MXN", "TRY", "SEK", "NOK", "DKK", "PLN", "HUF", "CZK", "SGD", "HKD", "CNH", "ILS", "RUB", "BRL", "INR", "THB"]);
  const normalize = (value) => String(value || "").toUpperCase().replace(/[^A-Z]/g, "");
  function parse(text, source = "unknown", confidence = 0) {
    const raw = String(text || "").toUpperCase();
    const separated = raw.match(/\b([A-Z]{3})\s*\/\s*([A-Z]{3})(?:\s*[-_ ]?\s*(OTC))?\b/);
    const compact = raw.match(/\b([A-Z]{3})([A-Z]{3})(?:\s*[-_ ]?\s*(OTC))?\b/);
    const match = separated || compact;
    if (!match || !CURRENCIES.has(match[1]) || !CURRENCIES.has(match[2])) return null;
    const otc = Boolean(match[3]) || /\bOTC\b/.test(raw);
    // The canonical internal key keeps OTC distinct, while normalizedSymbol
    // is the broker-independent pair shown in diagnostics.
    const normalizedSymbol = `${match[1]}${match[2]}`;
    const symbol = `${normalizedSymbol}${otc ? "-OTC" : ""}`;
    return { symbol, normalizedSymbol, displaySymbol: `${match[1]}/${match[2]}`, domain: otc ? "IQ_OPTION_OTC" : "IQ_OPTION_FOREX", isOTC: otc, source, confidence };
  }
  function descriptor(el, parsed, source) {
    if (!el || !parsed) return null;
    const rect = el.getBoundingClientRect?.() || {};
    const parent = el.parentElement;
    const className = typeof el.className === "string" ? el.className.slice(0, 160) : "";
    return { ...parsed, source, element: el, candidate: { text: String(el.innerText || el.textContent || "").trim().slice(0, 80), symbol: parsed.symbol, normalizedSymbol: parsed.normalizedSymbol, domain: parsed.domain, tag: String(el.tagName || "").toLowerCase(), id: String(el.id || "").slice(0, 80) || null, role: el.getAttribute?.("role") || null, dataTestId: el.getAttribute?.("data-testid") || null, ariaLabel: el.getAttribute?.("aria-label") || null, className, parent: parent ? { tag: String(parent.tagName || "").toLowerCase(), className: typeof parent.className === "string" ? parent.className.slice(0, 160) : "" } : null, rect: { left: Math.round(rect.left || 0), top: Math.round(rect.top || 0), width: Math.round(rect.width || 0), height: Math.round(rect.height || 0) } } };
  }
  function findChartHeader(doc) {
    if (typeof doc.querySelectorAll !== "function") return null;
    const width = Number(globalThis.innerWidth || doc.defaultView?.innerWidth || 0);
    const height = Number(globalThis.innerHeight || doc.defaultView?.innerHeight || 0);
    const hits = [];
    for (const el of doc.querySelectorAll("body *")) {
      if (el.children?.length || typeof el.getBoundingClientRect !== "function") continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.top < 72 || rect.top > Math.max(260, height * .42) || rect.left < 55 || (width && rect.left > width * .48)) continue;
      const parsed = parse(el.innerText || el.textContent, "chart-header", .76);
      if (!parsed) continue;
      hits.push({ item: descriptor(el, parsed, "chart-header"), score: Math.abs(rect.top - 132) + Math.abs(rect.left - 165) * .08 });
    }
    hits.sort((a, b) => a.score - b.score);
    return hits[0]?.item || null;
  }
  function resolveVisible(doc) {
    // Only current/selected chart controls are evidence of the displayed
    // instrument. A generic body-text scan can choose an asset from a watch
    // list, so it is intentionally not a fallback.
    const strongSelectors = ["[data-testid*='active' i][data-testid*='asset' i]", "[data-testid*='selected' i][data-testid*='asset' i]", "[data-testid*='active' i][data-testid*='instrument' i]", "[aria-current='true'][data-testid*='asset' i]", "[class*='active' i][class*='asset' i]", "[class*='selected' i][class*='asset' i]", "[class*='active' i][class*='instrument' i]"];
    for (const selector of strongSelectors) { const el = doc.querySelector(selector); const found = parse(el?.textContent, "chart-header-selector", .9); if (found) return found; }
    const nameSelectors = ["[data-testid*='asset-name' i]", "[data-testid*='instrument-name' i]", "[class*='asset-name' i]", "[class*='instrument-name' i]"];
    for (const selector of nameSelectors) { const found = parse(doc.querySelector(selector)?.textContent, "iq-visible-dom-unconfirmed", .6); if (found) return found; }
    // IQ's current chart header is visually below the navigation tabs and at
    // the left of the chart. Inspect visible leaf nodes in that bounded region
    // only; this is intentionally not a generic document text fallback.
    const header = findChartHeader(doc); if (header) { const { element, candidate, ...visible } = header; return visible; }
    return parse(doc.title, "iq-title-fallback", .25);
  }
  function resolveUiPrice(doc) {
    if (typeof doc.querySelectorAll !== "function") return null;
    const width = Number(globalThis.innerWidth || doc.defaultView?.innerWidth || 0);
    const height = Number(globalThis.innerHeight || doc.defaultView?.innerHeight || 0);
    const quotes = [];
    for (const el of doc.querySelectorAll("body *")) {
      if (el.children?.length || typeof el.getBoundingClientRect !== "function") continue;
      const text = String(el.innerText || el.textContent || "").trim();
      const match = text.match(/^(ask|bid)\s*[:]?\s*(\d+(?:[.,]\d+)?)$/i);
      if (!match) continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.left < 55 || (width && rect.left > width * .5) || rect.top < height * .35) continue;
      const value = Number(match[2].replace(",", ".")); if (Number.isFinite(value) && value > 0) quotes.push({ side: match[1].toUpperCase(), value });
    }
    const ask = quotes.find((q) => q.side === "ASK")?.value, bid = quotes.find((q) => q.side === "BID")?.value;
    return Number.isFinite(ask) && Number.isFinite(bid) ? (ask + bid) / 2 : (ask ?? bid ?? null);
  }
  function assetDebugCandidates(doc) {
    if (typeof doc.querySelectorAll !== "function") return [];
    const width = Number(globalThis.innerWidth || doc.defaultView?.innerWidth || 0);
    const height = Number(globalThis.innerHeight || doc.defaultView?.innerHeight || 0);
    const seen = new Set(); const rows = [];
    for (const el of doc.querySelectorAll("body *")) {
      if (typeof el.getBoundingClientRect !== "function") continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.top < 70 || rect.top > Math.max(300, height * .45) || rect.left < 50 || (width && rect.left > width * .65)) continue;
      const parsed = parse(el.innerText || el.textContent, "chart-header", .5);
      if (!parsed) continue;
      const text = String(el.innerText || el.textContent || "").trim().slice(0, 80);
      const signature = `${parsed.symbol}|${Math.round(rect.left)}|${Math.round(rect.top)}|${text}`; if (seen.has(signature)) continue; seen.add(signature);
      const className = typeof el.className === "string" ? el.className.slice(0, 160) : "";
      const parent = el.parentElement;
      rows.push({ text, symbol: parsed.symbol, normalizedSymbol: parsed.normalizedSymbol, domain: parsed.domain, tag: String(el.tagName || "").toLowerCase(), id: String(el.id || "").slice(0, 80) || null, role: el.getAttribute?.("role") || null, dataTestId: el.getAttribute?.("data-testid") || null, ariaLabel: el.getAttribute?.("aria-label") || null, className, parent: parent ? { tag: String(parent.tagName || "").toLowerCase(), className: typeof parent.className === "string" ? parent.className.slice(0, 160) : "" } : null, rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) } });
    }
    return rows.sort((a, b) => Math.abs(a.rect.top - 132) - Math.abs(b.rect.top - 132)).slice(0, 12);
  }
  function same(a, b) { return !!a?.symbol && !!b?.symbol && normalize(a.symbol) === normalize(b.symbol) && a.domain === b.domain; }
  globalThis.TraceConAssetResolver = { CURRENCIES, parse, findChartHeader, resolveVisible, resolveUiPrice, assetDebugCandidates, same, normalize };
})();
