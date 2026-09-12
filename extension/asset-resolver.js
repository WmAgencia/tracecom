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
    return parse(doc.title, "iq-title-fallback", .25);
  }
  function same(a, b) { return !!a?.symbol && !!b?.symbol && normalize(a.symbol) === normalize(b.symbol) && a.domain === b.domain; }
  globalThis.TraceConAssetResolver = { CURRENCIES, parse, resolveVisible, same, normalize };
})();
