/* Runs in the page's main world. Inbound market frames only; no auth/session data. */
(() => {
  "use strict";
  if (window.__traceconIqBridge) return;
  window.__traceconIqBridge = true;
  let sequence = 0;
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  // IQ Option's `currency-updated` can carry id: 0 as a UI placeholder.
  // It is diagnostic only, never a market-instrument identifier.
  const numericId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const post = (payload) => window.postMessage({ channel: "tracecon-iq-market", payload }, location.origin);
  const replay = { instruments: [], frames: [], protocol: [] };
  // A subscription transition is evidence for a candidate, not confirmation
  // of the chart currently selected. The content/background must still join
  // it with catalog metadata and the matching price stream.
  const AssetSwitchDifferentialAnalyzer = (() => {
    let before = new Set();
    return {
      observe(signal) {
        const isSubscription = signal?.direction === "OUT" && /(subscribe|unsubscribe|routing|instrument|currency)/i.test(String(signal.eventName || ""));
        if (!isSubscription || !Array.isArray(signal.activeIds) || !signal.activeIds.length) return signal;
        const prior = [...before]; const after = new Set(signal.activeIds);
        const added = [...after].filter((id) => !before.has(id));
        const removed = prior.filter((id) => !after.has(id));
        before = after;
        return { ...signal, differential: { beforeActiveIds: prior.slice(0, 24), afterActiveIds: [...after].slice(0, 24), newSubscriptions: added.slice(0, 24), removedSubscriptions: removed.slice(0, 24), candidateCurrentActiveIds: added.slice(0, 24), confidence: "LOW" } };
      },
    };
  })();
  const remember = (payload) => {
    if (payload?.type === "instrument") replay.instruments = [...replay.instruments.filter((item) => item.activeId !== payload.activeId || item.symbol !== payload.symbol), payload].slice(-240);
    if (payload?.kind === "candle" || payload?.kind === "tick") replay.frames = [...replay.frames, payload].slice(-240);
    if (payload?.type === "protocol-event") replay.protocol = [...replay.protocol, payload].slice(-120);
    post(payload);
  };
  const replayToContent = () => { post({ type: "bridge-ready" }); for (const item of replay.instruments) post(item); for (const item of replay.protocol) post(item); for (const item of replay.frames) post(item); };
  replayToContent(); setTimeout(replayToContent, 1_000); setTimeout(replayToContent, 5_000);
  window.addEventListener("message", (event) => { if (event.source === window && event.origin === location.origin && event.data?.channel === "tracecon-iq-control" && event.data?.type === "replay-request") replayToContent(); });
  const normalize = (raw) => {
    let envelope;
    try { envelope = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
    if (!envelope || envelope.name !== "candle-generated" || !envelope.msg || typeof envelope.msg !== "object") return null;
    const c = envelope.msg;
    if (![c.open, c.close, c.min, c.max, c.from, c.size].every(finite)) return null;
    const sizes = { 60: "1m", 300: "5m", 900: "15m", 3600: "1h", 14400: "4h", 86400: "1d" };
    const timeframe = sizes[c.size];
    if (!timeframe || numericId(c.active_id) == null) return null;
    return { kind: "candle", activeId: numericId(c.active_id), timeframe, open: c.open, high: c.max, low: c.min, close: c.close, volume: finite(c.volume) ? c.volume : 0, timestamp: c.from * 1000, isClosed: c.to ? Date.now() >= c.to * 1000 : false, sequence: ++sequence, receivedAt: Date.now(), serverTime: c.to ? c.to * 1000 : undefined };
  };
  const instruments = (raw) => {
    let envelope;
    try { envelope = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return []; }
    const msg = envelope?.msg;
    if (!msg || typeof msg !== "object") return [];
    const found = []; const seen = new Set(); const queue = [{ value: msg, depth: 0 }];
    while (queue.length && found.length < 80) {
      const { value, depth } = queue.shift();
      if (!value || typeof value !== "object" || depth > 4) continue;
      if (Array.isArray(value)) { for (const child of value.slice(0, 240)) queue.push({ value: child, depth: depth + 1 }); continue; }
      const activeId = numericId(value.active_id ?? value.activeId ?? value.id);
      const symbol = value.symbol ?? value.ticker ?? value.instrument ?? value.underlying ?? value.name ?? value.description;
      if (activeId != null && typeof symbol === "string" && symbol.length <= 48 && !seen.has(`${activeId}:${symbol}`)) {
        seen.add(`${activeId}:${symbol}`);
        // Only a small whitelisted metadata projection leaves the page: no
        // account/session fields and never the original socket envelope.
        found.push({ type: "instrument", activeId, symbol, name: typeof value.name === "string" ? value.name.slice(0, 48) : undefined, instrumentType: typeof envelope?.name === "string" ? envelope.name.slice(0, 48) : "unknown", receivedAt: Date.now() });
      }
      for (const key of ["actives", "active", "instruments", "instrument", "items", "data", "result", "list"]) if (value[key] && typeof value[key] === "object") queue.push({ value: value[key], depth: depth + 1 });
    }
    return found;
  };
  const MARKET_EVENT = /(active|instrument|currency|option|candle|quote|tick|price|subscribe|unsubscribe|routing|expiration|period|timeframe|blitz)/i;
  const SAFE_MARKET_KEYS = new Set(["active", "active_id", "activeId", "symbol", "ticker", "instrument", "instrument_id", "instrumentId", "underlying", "currency", "instrument_type", "instrumentType", "option_type", "routingFilters", "routing_filters", "expiration", "period", "size", "timeframe", "request_id", "requestId", "event", "action", "subscribe", "unsubscribe", "candle", "quote", "tick", "price", "bid", "ask"]);
  const safeString = (value, max = 64) => typeof value === "string" && value.length <= max ? value : null;
  function decodePayload(raw) {
    if (typeof raw === "string") { try { return { value: JSON.parse(raw), byteLength: raw.length }; } catch { return null; } }
    if (raw instanceof ArrayBuffer) return { binary: true, byteLength: raw.byteLength };
    if (typeof Blob !== "undefined" && raw instanceof Blob) return { binary: true, byteLength: raw.size };
    return raw && typeof raw === "object" ? { value: raw, byteLength: 0 } : null;
  }
  function marketProtocol(raw, direction, transport = "ws", extra = {}) {
    const decoded = decodePayload(raw); if (!decoded) return null;
    if (decoded.binary) return { type: "protocol-event", direction, transport, eventName: "binary-market-frame", byteLength: decoded.byteLength, timestamp: Date.now(), ...extra };
    const envelope = decoded.value;
    const eventName = safeString(envelope?.name ?? envelope?.event ?? envelope?.action ?? envelope?.type, 80) || "unknown";
    const activeIds = []; const symbols = []; const fields = {}; const seen = new Set(); const queue = [{ value: envelope, depth: 0 }];
    while (queue.length) {
      const { value, depth } = queue.shift(); if (!value || typeof value !== "object" || depth > 4) continue;
      if (Array.isArray(value)) { for (const child of value.slice(0, 120)) queue.push({ value: child, depth: depth + 1 }); continue; }
      for (const [key, candidate] of Object.entries(value)) {
        if (!SAFE_MARKET_KEYS.has(key)) continue;
        if (["active", "active_id", "activeId", "instrument_id", "instrumentId"].includes(key)) {
          const id = numericId(candidate); if (id != null && !activeIds.includes(id)) activeIds.push(id);
        } else if (["symbol", "ticker", "instrument", "underlying", "currency"].includes(key)) {
          const text = safeString(candidate); if (text && !symbols.includes(text)) symbols.push(text);
        } else if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean") {
          const text = typeof candidate === "string" ? safeString(candidate) : candidate;
          if (text != null && Object.keys(fields).length < 18) fields[key] = text;
        }
      }
      for (const key of ["msg", "data", "result", "params", "payload", "actives", "instruments", "items", "list", "routingFilters", "routing_filters"]) if (value[key] && typeof value[key] === "object") queue.push({ value: value[key], depth: depth + 1 });
    }
    const relevant = MARKET_EVENT.test(eventName) || activeIds.length || symbols.length || Object.keys(fields).length;
    if (!relevant) return null;
    return { type: "protocol-event", direction, transport, eventName, activeIds: activeIds.slice(0, 24), symbols: symbols.slice(0, 24), fields, byteLength: decoded.byteLength, timestamp: Date.now(), ...extra };
  }
  const tick = (raw) => {
    let envelope;
    try { envelope = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
    if (!/^(instrument-quotes-generated|quote-generated|tick-generated|price-generated)$/i.test(String(envelope?.name || ""))) return null;
    const q = envelope?.msg; if (!q || typeof q !== "object" || Array.isArray(q)) return null;
    const activeId = numericId(q.active_id ?? q.activeId); const price = Number(q.price ?? q.value ?? q.close); const rawTime = Number(q.timestamp ?? q.time ?? q.at ?? q.created_at);
    if (activeId == null || !Number.isFinite(price) || price <= 0) return null;
    const timestamp = Number.isFinite(rawTime) && rawTime > 0 ? (rawTime < 10_000_000_000 ? rawTime * 1000 : rawTime) : Date.now();
    return { kind: "tick", activeId, price, timestamp, sequence: ++sequence, receivedAt: Date.now() };
  };
  const protocolLog = (signal) => { if (!signal) return; const observed = AssetSwitchDifferentialAnalyzer.observe(signal); const scope = observed.direction === "OUT" ? "WS_OUT" : "WS_IN"; console.info(`[TRACE_CON][${scope}]`, observed); remember(observed); };
  const observe = (socket) => {
    const originalSend = socket.send;
    if (typeof originalSend === "function") socket.send = function traceConPassiveSend(data) { protocolLog(marketProtocol(data, "OUT", "ws")); return originalSend.call(this, data); };
    socket.addEventListener("message", (event) => {
    const frame = normalize(event.data) || tick(event.data); if (frame) { remember(frame); return; }
    const metadata = instruments(event.data); for (const item of metadata) remember(item);
    if (metadata.length) {
      // Diagnostic projection only: event name plus already-whitelisted market
      // identifiers. The source frame is never forwarded or logged.
      remember({ type: "asset-debug-event", eventName: metadata[0].instrumentType || "unknown", activeIds: metadata.slice(0, 24).map((item) => ({ activeId: item.activeId, symbol: item.symbol })) });
    }
    protocolLog(marketProtocol(event.data, "IN", "ws"));
    });
  };
  const Original = window.WebSocket;
  window.WebSocket = new Proxy(Original, {
    construct(Target, args, NewTarget) {
      const socket = Reflect.construct(Target, args, NewTarget);
      observe(socket);
      return socket;
    },
  });
  const marketPath = (input) => {
    try { const url = new URL(typeof input === "string" ? input : input?.url, location.origin); return /active|instrument|market|candle|quote|option|blitz/i.test(url.pathname) ? url.pathname : null; } catch { return null; }
  };
  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;
    window.fetch = function traceConPassiveFetch(input, init) {
      const path = marketPath(input); const method = String(init?.method || input?.method || "GET").toUpperCase();
      if (path) protocolLog({ type: "protocol-event", direction: "OUT", transport: "fetch", eventName: "http-market-request", activeIds: [], symbols: [], fields: { method }, path, timestamp: Date.now() });
      return originalFetch.apply(this, arguments).then((response) => {
        if (path && response?.clone) response.clone().text().then((body) => protocolLog(marketProtocol(body, "IN", "fetch", { path, status: Number(response.status) || null }))).catch(() => null);
        return response;
      });
    };
  }
  // XHR is still used by some IQ Option application shells. This hook only
  // inspects a response when its URL is market-related and emits the same
  // redacted projection as WebSocket/fetch. It never reads request headers or
  // request bodies.
  const Xhr = window.XMLHttpRequest;
  if (Xhr?.prototype?.open) {
    const originalOpen = Xhr.prototype.open;
    Xhr.prototype.open = function traceConPassiveXhrOpen(method, url) {
      const path = marketPath(url);
      if (path && !this.__traceConMarketObserved) {
        this.__traceConMarketObserved = true;
        this.addEventListener("load", () => {
          const text = typeof this.responseText === "string" ? this.responseText : null;
          if (text) protocolLog(marketProtocol(text, "IN", "xhr", { path, status: Number(this.status) || null }));
        });
        protocolLog({ type: "protocol-event", direction: "OUT", transport: "xhr", eventName: "http-market-request", activeIds: [], symbols: [], fields: { method: String(method || "GET").toUpperCase() }, path, timestamp: Date.now() });
      }
      return originalOpen.apply(this, arguments);
    };
  }
})();
