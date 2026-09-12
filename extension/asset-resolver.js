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
    const symbol = `${match[1]}${match[2]}${otc ? "-OTC" : ""}`;
    return { symbol, displaySymbol: `${match[1]}/${match[2]}${otc ? " OTC" : ""}`, domain: otc ? "IQ_OPTION_OTC" : "IQ_OPTION_FOREX", source, confidence };
  }
  function resolveVisible(doc) {
    // Only current/selected chart controls are evidence of the displayed
    // instrument. A generic body-text scan can choose an asset from a watch
    // list, so it is intentionally not a fallback.
    const strongSelectors = ["[data-testid*='active' i][data-testid*='asset' i]", "[data-testid*='selected' i][data-testid*='asset' i]", "[data-testid*='active' i][data-testid*='instrument' i]", "[aria-current='true'][data-testid*='asset' i]", "[class*='active' i][class*='asset' i]", "[class*='selected' i][class*='asset' i]", "[class*='active' i][class*='instrument' i]"];
    for (const selector of strongSelectors) { const found = parse(doc.querySelector(selector)?.textContent, "iq-visible-dom", .9); if (found) return found; }
    const nameSelectors = ["[data-testid*='asset-name' i]", "[data-testid*='instrument-name' i]", "[class*='asset-name' i]", "[class*='instrument-name' i]"];
    for (const selector of nameSelectors) { const found = parse(doc.querySelector(selector)?.textContent, "iq-visible-dom-unconfirmed", .6); if (found) return found; }
    // IQ's current chart header is visually below the navigation tabs and at
    // the left of the chart. Inspect visible leaf nodes in that bounded region
    // only; this is intentionally not a generic document text fallback.
    if (typeof doc.querySelectorAll === "function") {
      const width = Number(globalThis.innerWidth || doc.defaultView?.innerWidth || 0);
      const height = Number(globalThis.innerHeight || doc.defaultView?.innerHeight || 0);
      const candidates = [];
      for (const el of doc.querySelectorAll("body *")) {
        if (el.children?.length || typeof el.getBoundingClientRect !== "function") continue;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height || rect.top < 72 || rect.top > Math.max(260, height * .42) || rect.left < 55 || (width && rect.left > width * .48)) continue;
        const found = parse(el.innerText || el.textContent, "iq-chart-header-geometry", .76);
        if (found) candidates.push({ found, rect, score: Math.abs(rect.top - 132) + Math.abs(rect.left - 165) * .08 });
      }
      candidates.sort((a, b) => a.score - b.score);
      if (candidates[0]) return candidates[0].found;
    }
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
  function same(a, b) { return !!a?.symbol && !!b?.symbol && normalize(a.symbol) === normalize(b.symbol) && a.domain === b.domain; }
  globalThis.TraceConAssetResolver = { CURRENCIES, parse, resolveVisible, resolveUiPrice, same, normalize };
})();
