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
  const replay = { instruments: [], frames: [] };
  const remember = (payload) => {
    if (payload?.type === "instrument") replay.instruments = [...replay.instruments.filter((item) => item.activeId !== payload.activeId || item.symbol !== payload.symbol), payload].slice(-240);
    if (payload?.kind === "candle" || payload?.kind === "tick") replay.frames = [...replay.frames, payload].slice(-240);
    post(payload);
  };
  const replayToContent = () => { post({ type: "bridge-ready" }); for (const item of replay.instruments) post(item); for (const item of replay.frames) post(item); };
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
  const observe = (socket) => socket.addEventListener("message", (event) => {
    const frame = normalize(event.data) || tick(event.data); if (frame) { remember(frame); return; }
    const metadata = instruments(event.data); for (const item of metadata) remember(item);
    if (metadata.length) {
      // Diagnostic projection only: event name plus already-whitelisted market
      // identifiers. The source frame is never forwarded or logged.
      remember({ type: "asset-debug-event", eventName: metadata[0].instrumentType || "unknown", activeIds: metadata.slice(0, 24).map((item) => ({ activeId: item.activeId, symbol: item.symbol })) });
    }
  });
  const Original = window.WebSocket;
  window.WebSocket = new Proxy(Original, {
    construct(Target, args, NewTarget) {
      const socket = Reflect.construct(Target, args, NewTarget);
      observe(socket);
      return socket;
    },
  });
})();
