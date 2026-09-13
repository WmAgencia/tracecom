/* DEV diagnostics only: keep secrets out before a bundle leaves the extension. */
(() => {
  "use strict";
  const BLOCKED = /(token|auth|cookie|session|ssid|pass|email|phone|account|wallet|balance|profile|user|credential|secret|key)/i;
  const primitive = (value) => value === null || ["string", "number", "boolean"].includes(typeof value);
  function sanitize(value, depth = 0) {
    if (depth > 6) return "[depth-limited]";
    if (primitive(value)) return typeof value === "string" ? value.slice(0, 240) : value;
    if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item, depth + 1));
    if (!value || typeof value !== "object") return null;
    const out = {};
    for (const [key, item] of Object.entries(value)) if (!BLOCKED.test(key)) out[key] = sanitize(item, depth + 1);
    return out;
  }
  function fingerprint(snapshot) {
    const trader = snapshot?.profile === "FABLE_TRADER" ? { profile: snapshot.profile, asset: snapshot.asset, domain: snapshot.domain, activeId: snapshot.activeId, price: snapshot.price, lastCandle: snapshot.candles?.at?.(-1), features: snapshot.features, localContext: snapshot.localContext } : null;
    const input = JSON.stringify(sanitize(trader || { failure: snapshot?.syncState?.failure || snapshot?.syncState?.syncFailureReason, eventTypes: snapshot?.protocolSummary?.eventTypes, candidates: snapshot?.syncState?.candidateIds || snapshot?.syncState?.candidateActiveIds, registry: snapshot?.syncState?.registryMappings, errors: snapshot?.errors }));
    let hash = 2166136261; for (let i = 0; i < input.length; i += 1) { hash ^= input.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return `tcdiag-${(hash >>> 0).toString(16)}`;
  }
  globalThis.TraceConDiagnostic = { sanitize, fingerprint };
})();
