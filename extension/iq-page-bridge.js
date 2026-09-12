/* Runs in the page's main world. Inbound market frames only; no auth/session data. */
(() => {
  "use strict";
  if (window.__traceconIqBridge) return;
  window.__traceconIqBridge = true;
  let sequence = 0;
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const numericId = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  const post = (payload) => window.postMessage({ channel: "tracecon-iq-market", payload }, location.origin);
  post({ type: "bridge-ready" });
  const normalize = (raw) => {
    let envelope;
    try { envelope = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
    if (!envelope || envelope.name !== "candle-generated" || !envelope.msg || typeof envelope.msg !== "object") return null;
    const c = envelope.msg;
    if (![c.open, c.close, c.min, c.max, c.from, c.size].every(finite)) return null;
    const sizes = { 60: "1m", 300: "5m", 900: "15m", 3600: "1h", 14400: "4h", 86400: "1d" };
    const timeframe = sizes[c.size];
    if (!timeframe || !finite(c.active_id)) return null;
    return { kind: "candle", activeId: c.active_id, timeframe, open: c.open, high: c.max, low: c.min, close: c.close, volume: finite(c.volume) ? c.volume : 0, timestamp: c.from * 1000, isClosed: c.to ? Date.now() >= c.to * 1000 : false, sequence: ++sequence, receivedAt: Date.now(), serverTime: c.to ? c.to * 1000 : undefined };
  };
  const instrument = (raw) => {
    let envelope;
    try { envelope = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
    const msg = envelope?.msg;
    if (!msg || typeof msg !== "object") return null;
    const activeId = numericId(msg.active_id ?? msg.activeId ?? msg.id);
    const symbol = msg.symbol ?? msg.ticker ?? msg.instrument ?? msg.name;
    if (activeId == null || typeof symbol !== "string" || symbol.length > 48) return null;
    // Only a small metadata projection leaves the page: no account/session fields.
    return { type: "instrument", activeId, symbol, name: typeof msg.name === "string" ? msg.name.slice(0, 48) : undefined, instrumentType: typeof envelope?.name === "string" ? envelope.name.slice(0, 48) : "unknown", receivedAt: Date.now() };
  };
  const observe = (socket) => socket.addEventListener("message", (event) => { const frame = normalize(event.data); if (frame) { post(frame); return; } const metadata = instrument(event.data); if (metadata) post(metadata); });
  const Original = window.WebSocket;
  window.WebSocket = new Proxy(Original, {
    construct(Target, args, NewTarget) {
      const socket = Reflect.construct(Target, args, NewTarget);
      observe(socket);
      return socket;
    },
  });
})();
