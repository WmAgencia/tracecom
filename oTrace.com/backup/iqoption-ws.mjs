/**
 * IQOPTION WS - cliente WebSocket real para IQ Option.
 * Referencia: github.com/iqoptionapi/iqoptionapi@master
 */
import tls from "node:tls";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

export const IQ_PROTOCOL_REFERENCE = "github.com/iqoptionapi/iqoptionapi@master";
export const EXPECTED_WS_HOST_FROM_REPO = "iqoption.com";
export const IQ_WS_CANDIDATE_HOSTS = ["ws.iqoption.com", "iqoption.com"];
export const IQ_WS_PATH = "/echo/websocket";
export const CANDLE_SIZE_SECONDS = 5;
export const TIME_SYNC_TOLERANCE_MS = 2_000;
export const HEARTBEAT_FALLBACK_MS = 30_000;
export const CANDLE_SOURCE = "IQ_OPTION_WS";
export const EXPECTED_EURUSD_ACTIVE_ID_FROM_REPO = 1;
export const EXPECTED_EURUSD_OTC_ACTIVE_ID_FROM_REPO = 76;
export const BALANCE_TYPES = { 1: "REAL", 2: "TOURNAMENT", 4: "PRACTICE" };

export class IqWsError extends Error {
  constructor(code, detail = "") { super(detail ? `${code}: ${detail}` : code); this.code = code; }
}

export const WS_OPCODES = { CONTINUATION: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

export function encodeFrame({ opcode = WS_OPCODES.TEXT, payload = Buffer.alloc(0), fin = true, mask = true, maskKey = null } = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  const first = (fin ? 0x80 : 0x00) | (opcode & 0x0f);
  let header;
  if (body.length < 126) header = Buffer.from([first, (mask ? 0x80 : 0x00) | body.length]);
  else if (body.length < 65_536) { header = Buffer.alloc(4); header[0] = first; header[1] = (mask ? 0x80 : 0x00) | 126; header.writeUInt16BE(body.length, 2); }
  else { header = Buffer.alloc(10); header[0] = first; header[1] = (mask ? 0x80 : 0x00) | 127; header.writeBigUInt64BE(BigInt(body.length), 2); }
  if (!mask) return Buffer.concat([header, body]);
  const key = maskKey ? Buffer.from(maskKey) : crypto.randomBytes(4);
  const masked = Buffer.alloc(body.length);
  for (let index = 0; index < body.length; index += 1) masked[index] = body[index] ^ key[index % 4];
  return Buffer.concat([header, key, masked]);
}

export class FrameParser {
  constructor({ maxMessageBytes = 4_000_000 } = {}) { this.buffer = Buffer.alloc(0); this.fragments = []; this.fragmentOpcode = null; this.maxMessageBytes = maxMessageBytes; }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    const out = [];
    for (;;) {
      if (this.buffer.length < 2) break;
      const first = this.buffer[0], second = this.buffer[1];
      const fin = (first & 0x80) === 0x80, opcode = first & 0x0f, masked = (second & 0x80) === 0x80;
      let length = second & 0x7f, offset = 2;
      if (length === 126) { if (this.buffer.length < offset + 2) break; length = this.buffer.readUInt16BE(offset); offset += 2; }
      else if (length === 127) { if (this.buffer.length < offset + 8) break; const big = this.buffer.readBigUInt64BE(offset); if (big > BigInt(this.maxMessageBytes)) throw new IqWsError("WS_FRAME_TOO_LARGE", String(big)); length = Number(big); offset += 8; }
      let maskKey = null;
      if (masked) { if (this.buffer.length < offset + 4) break; maskKey = this.buffer.subarray(offset, offset + 4); offset += 4; }
      if (this.buffer.length < offset + length) break;
      let payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);
      if (masked) for (let index = 0; index < payload.length; index += 1) payload[index] ^= maskKey[index % 4];
      if (opcode >= 0x8) { out.push({ opcode, payload, fin: true }); continue; }
      if (opcode === WS_OPCODES.CONTINUATION) { if (this.fragmentOpcode === null) continue; this.fragments.push(payload); }
      else { this.fragments = [payload]; this.fragmentOpcode = opcode; }
      const total = this.fragments.reduce((sum, part) => sum + part.length, 0);
      if (total > this.maxMessageBytes) { this.fragments = []; this.fragmentOpcode = null; throw new IqWsError("WS_MESSAGE_TOO_LARGE"); }
      if (fin) { out.push({ opcode: this.fragmentOpcode, payload: Buffer.concat(this.fragments), fin: true }); this.fragments = []; this.fragmentOpcode = null; }
    }
    return out;
  }
}

export class RawWebSocket extends EventEmitter {
  constructor({ host, path = IQ_WS_PATH, port = 443, timeoutMs = 15_000, tlsConnect = (options) => tls.connect(options), origin = "https://iqoption.com", userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } = {}) {
    super();
    this.host = host; this.path = path; this.port = port; this.timeoutMs = timeoutMs; this.tlsConnect = tlsConnect; this.origin = origin; this.userAgent = userAgent;
    this.socket = null; this.parser = new FrameParser(); this.connected = false; this.upgradeHeaders = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (code, detail = "") => { if (settled) return; settled = true; this.destroy(); reject(new IqWsError(code, detail)); };
      const timer = setTimeout(() => fail("WS_CONNECT_TIMEOUT", `${this.host}`), this.timeoutMs);
      let socket;
      try {
        socket = this.tlsConnect({ host: this.host, port: this.port, servername: this.host, rejectUnauthorized: false });
      } catch (error) { clearTimeout(timer); fail("WS_TLS_INIT_FAILED", String(error?.message ?? error)); return; }
      this.socket = socket;
      socket.on("error", (error) => { clearTimeout(timer); if (this.listenerCount("error") > 0) this.emit("error", error); fail("WS_SOCKET_ERROR", String(error?.message ?? error)); });
      socket.on("close", () => { clearTimeout(timer); if (!settled) fail("WS_CLOSED_BEFORE_UPGRADE"); this.connected = false; this.emit("close"); });
      const key = crypto.randomBytes(16).toString("base64");
      const request = [
        `GET ${this.path} HTTP/1.1`,
        `Host: ${this.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        `Origin: ${this.origin}`,
        `User-Agent: ${this.userAgent}`,
        "",
        "",
      ].join("\r\n");
      let handshake = Buffer.alloc(0);
      const onHandshakeData = (chunk) => {
        handshake = Buffer.concat([handshake, chunk]);
        const end = handshake.indexOf("\r\n\r\n");
        if (end === -1) { if (handshake.length > 65_536) { clearTimeout(timer); fail("WS_HANDSHAKE_TOO_LARGE"); } return; }
        const head = handshake.subarray(0, end).toString("latin1");
        const rest = handshake.subarray(end + 4);
        const match = head.match(/^HTTP\/1\.1\s+(\d{3})/);
        const status = match ? Number(match[1]) : 0;
        if (status !== 101) { clearTimeout(timer); fail("WS_UPGRADE_REJECTED", `HTTP ${status}`); return; }
        const expected = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
        const accept = (head.match(/sec-websocket-accept:\s*(\S+)/i) ?? [])[1] ?? "";
        if (accept !== expected) { clearTimeout(timer); fail("WS_UPGRADE_BAD_ACCEPT"); return; }
        socket.removeListener("data", onHandshakeData);
        socket.on("data", (data) => this.emit("data", data));
        clearTimeout(timer);
        this.connected = true;
        this.upgradeHeaders = head;
        if (rest.length) this.emit("data", rest);
        settled = true;
        resolve({ host: this.host, path: this.path, headers: head });
      };
      socket.on("data", onHandshakeData);
      socket.once("secureConnect", () => socket.write(request));
    });
  }

  sendText(text) {
    if (!this.connected || !this.socket) throw new IqWsError("WS_NOT_CONNECTED");
    this.socket.write(encodeFrame({ opcode: WS_OPCODES.TEXT, payload: Buffer.from(String(text), "utf8"), mask: true }));
  }

  ping(payload = Buffer.alloc(0)) { if (this.connected && this.socket) this.socket.write(encodeFrame({ opcode: WS_OPCODES.PING, payload, mask: true })); }
  pong(payload = Buffer.alloc(0)) { if (this.connected && this.socket) this.socket.write(encodeFrame({ opcode: WS_OPCODES.PONG, payload, mask: true })); }

  close(code = 1000, reason = "") {
    if (!this.socket) return;
    try { if (this.connected) this.socket.write(encodeFrame({ opcode: WS_OPCODES.CLOSE, payload: Buffer.from([(code >> 8) & 0xff, code & 0xff]), mask: true })); } catch { /* noop */ }
    this.connected = false;
    setTimeout(() => this.destroy(), 250).unref?.();
  }

  destroy() { this.connected = false; try { this.socket?.destroy(); } catch { /* noop */ } this.socket = null; }
}

export function envelope(name, msg, requestId = "") { return JSON.stringify({ name, msg, request_id: requestId }); }

export function toEpochMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  if (number > 1e15) return Math.round(number / 1e6);
  if (number > 1e12) return Math.round(number);
  return Math.round(number * 1000);
}

export function validateServerTime(serverTimeMs, localNowMs, toleranceMs = TIME_SYNC_TOLERANCE_MS) {
  const server = Number(serverTimeMs), local = Number(localNowMs);
  if (!Number.isFinite(server) || !Number.isFinite(local)) return { valid: false, skewMs: null, reason: "TIME_SYNC_INVALID" };
  const skewMs = Math.round(server - local);
  return { valid: Math.abs(skewMs) <= toleranceMs, skewMs, toleranceMs, reason: Math.abs(skewMs) <= toleranceMs ? "OK" : "CLOCK_SKEW_EXCEEDED" };
}

export function normalizeCandle(raw, { symbol, activeId, serverTimestamp, receivedAt, connectionId, sizeSeconds = CANDLE_SIZE_SECONDS } = {}) {
  if (!raw || typeof raw !== "object") throw new IqWsError("INVALID_CANDLE");
  const rawActive = raw.active_id ?? raw.activeId ?? raw.active ?? null;
  if (rawActive !== null && activeId !== null && activeId !== undefined && Number(rawActive) !== Number(activeId)) throw new IqWsError("CROSS_ASSET_REJECTED", `${rawActive} != ${activeId}`);
  const rawSize = Number(raw.size ?? raw.candle_size ?? sizeSeconds);
  const size = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : sizeSeconds;
  const price = (candidates) => { for (const value of candidates) { const number = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value); if (Number.isFinite(number)) return number; } return null; };
  const open = price([raw.open, raw.price_open, raw.o]);
  const high = price([raw.high, raw.max, raw.price_high, raw.h]);
  const low = price([raw.low, raw.min, raw.price_low, raw.l]);
  const close = price([raw.close, raw.value, raw.price_close, raw.c]);
  const rawFromMs = toEpochMs(raw.from ?? raw.start);
  const rawAtMs = toEpochMs(raw.at ?? raw.timestamp);
  let bucketStart = rawFromMs ?? (rawAtMs === null ? null : Math.floor(rawAtMs / (size * 1000)) * size * 1000);
  if (bucketStart === null && rawAtMs !== null && Number.isFinite(serverTimestamp)) bucketStart = Math.floor(serverTimestamp / (size * 1000)) * size * 1000;
  const bucketEnd = toEpochMs(raw.to ?? raw.end) ?? (bucketStart === null ? null : bucketStart + size * 1000);
  if (bucketStart === null) throw new IqWsError("INVALID_CANDLE_TIMESTAMP");
  if (![open, high, low, close].every(Number.isFinite)) throw new IqWsError("INVALID_CANDLE_PRICE", `open=${open} high=${high} low=${low} close=${close}`);
  if (Number.isFinite(serverTimestamp) && bucketStart > serverTimestamp + size * 1000) throw new IqWsError("FUTURE_CANDLE_REJECTED", `${bucketStart} > ${serverTimestamp}`);
  return {
    symbol, activeId: activeId ?? (rawActive === null ? null : Number(rawActive)),
    bucketStart, bucketEnd, at: bucketEnd, open, high, low, close,
    source: CANDLE_SOURCE,
    serverTimestamp: rawAtMs ?? (Number.isFinite(serverTimestamp) ? serverTimestamp : null),
    receivedAt: receivedAt ?? Date.now(),
    segmentId: `${symbol}:${bucketStart}`,
    connectionId: connectionId ?? null,
    volume: Number.isFinite(Number(raw.volume)) ? Number(raw.volume) : null,
  };
}

export function classifyBalances(list) {
  const rows = (Array.isArray(list) ? list : []).filter((row) => row && typeof row === "object");
  const decorate = (row) => ({ id: row.id ?? null, type: BALANCE_TYPES[Number(row.type)] ?? "UNKNOWN", rawType: Number(row.type) || null, currency: row.currency ?? null, amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : null, isDefault: row.is_default === true });
  const balances = rows.map(decorate);
  const practice = balances.filter((row) => row.type === "PRACTICE");
  const real = balances.filter((row) => row.type === "REAL");
  const selected = practice.find((row) => row.isDefault) ?? practice[0] ?? real.find((row) => row.isDefault) ?? real[0] ?? null;
  return { balances, practice, real, selected, type: practice.length ? "PRACTICE" : real.length ? "REAL" : "UNKNOWN", verifiedPractice: practice.length > 0 && selected?.type === "PRACTICE" };
}

export function resolveEurUsdActive(initializationData) {
  const source = initializationData?.result ?? initializationData ?? {};
  const sections = ["binary", "turbo"];
  const found = [];
  for (const section of sections) {
    const actives = source?.[section]?.actives ?? {};
    for (const [id, active] of Object.entries(actives)) {
      const rawName = String(active?.name ?? "");
      const canonical = rawName.replace(/[-_\s]?otc/ig, "").replace(/[^A-Za-z]/g, "").toUpperCase();
      if (canonical !== "EURUSD") continue;
      found.push({ activeId: Number(id), symbol: "EUR/USD", name: rawName, section, otc: /otc/i.test(rawName), enabled: active?.enabled === true, suspended: active?.is_suspended === true, open: active?.enabled === true && active?.is_suspended !== true });
    }
  }
  const tradeable = found.find((row) => row.open && !row.otc) ?? found.find((row) => row.open) ?? found.find((row) => !row.otc) ?? found[0] ?? null;
  return { candidates: found, selected: tradeable };
}

export function computeExpiration(serverTimestampSeconds, durationMinutes) {
  const duration = Math.max(1, Math.round(Number(durationMinutes) || 1));
  const nowSec = Math.floor(Number(serverTimestampSeconds));
  if (!Number.isFinite(nowSec) || nowSec <= 0) throw new IqWsError("SERVER_TIME_REQUIRED");
  if (duration === 5) {
    const expiration = (Math.floor(nowSec / 300) + 1) * 300;
    return { expiration, optionTypeId: 3, optionKind: "turbo", durationMinutes: 5 };
  }
  let expDateSec = Math.floor(nowSec / 60) * 60;
  const nextMinute = expDateSec + 60;
  if (nextMinute - nowSec > 30) expDateSec = nextMinute; else expDateSec = nextMinute + 60;
  const candidates = [];
  for (let index = 0; index < 5; index += 1) candidates.push(expDateSec + index * 60);
  let quarter = Math.ceil((nowSec + 301) / 900) * 900;
  for (let index = 0; index < 50; index += 1) { candidates.push(quarter); quarter += 900; }
  let bestIndex = 0, bestDistance = Infinity;
  for (let index = 0; index < candidates.length; index += 1) { const distance = Math.abs(candidates[index] - nowSec - duration * 60); if (distance < bestDistance) { bestDistance = distance; bestIndex = index; } }
  return { expiration: candidates[bestIndex], optionTypeId: bestIndex < 5 ? 3 : 1, optionKind: bestIndex < 5 ? "turbo" : "binary", durationMinutes: duration };
}

export function buildOrderRequest({ price, activeId, direction, expiration, optionTypeId, balanceId }) {
  const normalized = direction === "CALL" || direction === "BUY" ? "call" : "put";
  return { name: "sendMessage", msg: { body: { price: Number(price), active_id: Number(activeId), expired: Number(expiration), direction: normalized, option_type_id: Number(optionTypeId), user_balance_id: Number(balanceId) }, name: "binary-options.open-option", version: "1.0" } };
}

/** Build a digital-options order request (NEW API format) */
export function buildDigitalOrderRequest({ price, activeId, direction, expiration, balanceId }) {
  const normalized = direction === "CALL" || direction === "BUY" ? "call" : "put";
  return { name: "sendMessage", msg: { body: { price: Number(price), active_id: Number(activeId), expired: Number(expiration), direction: normalized, option_type: "turbo", user_balance_id: Number(balanceId) }, name: "digital-options.place-digital-option", version: "2.0" } };
}

export function parseSettlement(msg) {
  const win = String(msg?.win ?? "").toLowerCase();
  const result = win === "win" ? "WIN" : win === "loose" || win === "loss" ? "LOSS" : win === "equal" || win === "draw" ? "DRAW" : "UNKNOWN";
  const amount = Number(msg?.sum ?? msg?.amount);
  const payout = Number(msg?.win_amount);
  const profit = result === "WIN" && Number.isFinite(payout) && Number.isFinite(amount) ? payout - amount : result === "LOSS" && Number.isFinite(amount) ? -amount : null;
  return { result, profit, rawWin: win || null };
}

export class IqWsClient extends EventEmitter {
  constructor({ hosts = IQ_WS_CANDIDATE_HOSTS, socketFactory = null, now = () => Date.now(), uuid = () => crypto.randomUUID(), log = null } = {}) {
    super();
    this.hosts = hosts;
    this.socketFactory = socketFactory ?? ((options) => new RawWebSocket({ ...options }));
    this.now = now;
    this.uuid = uuid;
    // log = null usa console (scripts soltos); o bot passa um logger que escreve na
    // própria linha de status, para nenhum log do cliente quebrar o painel.
    this.log = (...args) => { try { (log ?? console.log)(...args); } catch { /* noop */ } };
    this.host = null; this.socket = null; this.connectionId = null; this.state = "IDLE";
    this.serverTimeMs = null; this.serverTimeReceivedAt = null; this.clockSkewMs = null; this.timeValid = false;
    this.lastHeartbeatAt = null; this.pending = new Map(); this.heartbeatTimer = null;
    this.helloAt = null; this.subscriptions = new Set();
  }

  serverNow() { return this.serverTimeMs === null ? null : this.serverTimeMs + (this.now() - this.serverTimeReceivedAt); }

  async connect({ ssid, timeoutMs = 25_000 } = {}) {
    if (typeof ssid !== "string" || ssid.length < 8) throw new IqWsError("SSID_REQUIRED");
    this.state = "CONNECTING";
    const failures = [];
    for (const host of this.hosts) {
      try {
        const socket = this.socketFactory({ host, path: IQ_WS_PATH, timeoutMs: Math.min(timeoutMs, 15_000) });
        this.socket = socket;
        socket.on("data", (chunk) => { this.lastMessageAt = this.now(); this.#onData(chunk); });
        // Avisa o dono do cliente (o bot) quando a conexão JÁ PRONTA cai; falha de
        // uma tentativa do boot não conta como fim de sessão (o loop tenta o próximo host).
        socket.on("close", () => { const wasReady = this.state === "READY"; this.state = "CLOSED"; this.#clearHeartbeat(); this.#rejectPending("WS_CLOSED"); if (wasReady) this.emit("close"); });
        socket.on("error", (error) => { this.log("IQ_WS_SOCKET_ERROR", String(error?.message ?? error)); });
        await socket.connect();
        this.host = host;
        this.connectionId = this.uuid();
        this.helloAt = this.now();
        this.state = "HANDSHAKE";
        socket.sendText(envelope("ssid", ssid, this.uuid().replace(/-/g, "").slice(0, 12)));
        const sync = await this.#waitFor((message) => message.name === "timeSync", timeoutMs, "TIME_SYNC_TIMEOUT");
        this.#handleTimeSync(sync.msg);
        this.state = "READY";
        this.#startHeartbeat();
        this.emit("ready", { connectionId: this.connectionId, host, serverTimeMs: this.serverTimeMs });
        return { connectionId: this.connectionId, host, serverTimeMs: this.serverTimeMs };
      } catch (error) {
        failures.push(`${host}:${error?.code ?? error?.message ?? "FAILED"}`);
        try { this.socket?.destroy(); } catch { /* noop */ }
        this.socket = null;
      }
    }
    this.state = "ERROR";
    throw new IqWsError("WS_HOSTS_UNREACHABLE", failures.join("|"));
  }

  #onData(chunk) {
    let frames;
    try { frames = this.socket?.parser.push(chunk) ?? []; } catch (error) { return; }
    for (const frame of frames) {
      if (frame.opcode === WS_OPCODES.PING) { try { this.socket?.pong(frame.payload); } catch { /* noop */ } continue; }
      if (frame.opcode === WS_OPCODES.PONG) continue;
      if (frame.opcode === WS_OPCODES.CLOSE) { try { this.socket?.close(1000); } catch { /* noop */ } return; }
      let message;
      try { message = JSON.parse(frame.payload.toString("utf8")); } catch { continue; }
      try { this.#onMessage(message); } catch (error) { this.log("HANDLER_ERROR", message?.name ?? "?", String(error?.message ?? error)); }
    }
  }

  #onMessage(message) {
    if (message?.name === "timeSync") this.#handleTimeSync(message.msg);
    if (message?.name === "heartbeat") {
      this.lastHeartbeatAt = this.now();
      const heartbeatTime = Number(message?.msg?.heartbeatTime ?? message?.msg ?? this.now());
      this.send("heartbeat", { heartbeatTime: Math.round(heartbeatTime), userTime: Math.round(this.serverNow() ?? this.now()) });
    }
    for (const pending of [...this.pending.values()]) pending.resolveIfMatches(message);
    this.emit("message", { name: message?.name ?? null, msg: message?.msg ?? null });
    this.emit(message?.name ?? "unknown", message);
    // Log de mensagens: só com IQ_WS_VERBOSE=1 (o bot tem painel próprio; log
    // periódico do cliente quebraria a linha de status).
    if (!this._msgCount) this._msgCount = 0;
    this._msgCount++;
    if (process.env.IQ_WS_VERBOSE === '1') this.log('[IQ-WS]', this._msgCount, message?.name ?? 'unknown');
  }

  #handleTimeSync(msg) {
    const serverTimeMs = toEpochMs(msg) ?? (Number.isFinite(Number(msg)) ? Number(msg) : null);
    if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0) return;
    this.serverTimeMs = serverTimeMs;
    this.serverTimeReceivedAt = this.now();
    const skewMs = Math.round(serverTimeMs - this.serverTimeReceivedAt);
    this.clockSkewMs = skewMs; this.timeValid = Math.abs(skewMs) <= TIME_SYNC_TOLERANCE_MS;
  }

  #startHeartbeat() {
    this.#clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      try { this.send("heartbeat", { heartbeatTime: this.now(), userTime: Math.round(this.serverNow() ?? this.now()) }); } catch { /* noop */ }
    }, 10_000);
    this.heartbeatTimer.unref?.();
  }

  #clearHeartbeat() { if (this.heartbeatTimer) clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }

  #waitFor(predicate, timeoutMs, timeoutCode, requestId = null) {
    return new Promise((resolve, reject) => {
      const key = requestId ?? `event:${this.uuid()}`;
      const finish = (callback, value) => { const pending = this.pending.get(key); if (!pending) return; this.pending.delete(key); clearTimeout(pending.timer); callback(value); };
      const timer = setTimeout(() => finish(reject, new IqWsError(timeoutCode)), timeoutMs);
      const resolveIfMatches = (message) => {
        // Mensagem sem request_id (ex.: a resposta `options` do get-options) casa
        // pelo predicate — a IQ responde get-options sem ecoar o request_id.
        const responseId = message?.request_id ?? message?.requestId ?? null;
        if (requestId !== null && responseId !== null && responseId !== requestId) return;
        if (!predicate(message)) return;
        finish(resolve, message);
      };
      this.pending.set(key, { timer, resolveIfMatches, reject });
    });
  }

  #rejectPending(code, requestId = null) {
    for (const [key, pending] of this.pending) {
      if (requestId !== null && key !== requestId) continue;
      this.pending.delete(key);
      clearTimeout(pending.timer);
      pending.reject(new IqWsError(code));
    }
  }

  send(name, msg, requestId = "") {
    if (!this.socket || this.state === "CLOSED") throw new IqWsError("WS_NOT_CONNECTED");
    this.socket.sendText(envelope(name, msg, requestId));
    if (!this._sentCount) this._sentCount = 0;
    this._sentCount++;
    if (process.env.IQ_WS_VERBOSE === '1') this.log('[SEND]', this._sentCount, name, JSON.stringify(msg).slice(0, 200));
  }

  async request(name, msg, { predicate, timeoutMs = 15_000, timeoutCode = "REQUEST_TIMEOUT", requestId = null } = {}) {
    const id = requestId ?? this.uuid().replace(/-/g, "").slice(0, 12);
    const wait = this.#waitFor(predicate ?? ((message) => message.request_id === id || message.requestId === id), timeoutMs, timeoutCode, id);
    try { this.send(name, msg, id); } catch { this.#rejectPending("WS_NOT_CONNECTED", id); return await wait; }
    return await wait;
  }

  subscribeCandles(activeId, size = CANDLE_SIZE_SECONDS) {
    const key = `${activeId}:${size}`;
    this.send("subscribeMessage", { name: "candle-generated", params: { routingFilters: { active_id: String(activeId), size: Number(size) } } });
    this.subscriptions.add(key);
    return activeId; // retorna o activeId (não a key) para compatibilidade com o bot
  }

  getCandlesHistory({ activeId, size = CANDLE_SIZE_SECONDS, count = 300, to = null, timeoutMs = 12_000 } = {}) {
    // to=null/undefined → usa serverNow ou Date.now
    let serverTo;
    if (to !== null && to !== undefined) {
      serverTo = Number(to);
    } else if (this.serverTimeMs !== null) {
      serverTo = this.serverNow();
    } else {
      serverTo = Math.floor(Date.now() / 1000);
    }
    const body = { active_id: Number(activeId), size: Number(size), to: serverTo, count: Math.max(1, Math.min(1000, Number(count) || 300)), "": "" };
    return this.request("sendMessage", { name: "get-candles", version: "2.0", body }, {
      predicate: (message) => message?.name === "candles" && Array.isArray(message?.msg?.candles),
      timeoutMs, timeoutCode: "GET_CANDLES_TIMEOUT",
    });
  }

  getInitializationData({ timeoutMs = 20_000 } = {}) {
    return this.request("sendMessage", { name: "get-initialization-data", version: "3.0", body: {} }, {
      predicate: (message) => message.name === "initialization-data" || message.name === "api_option_init_all_result",
      timeoutMs, timeoutCode: "INITIALIZATION_DATA_TIMEOUT",
    });
  }

  getBalances({ timeoutMs = 15_000 } = {}) {
    return this.request("sendMessage", { name: "get-balances", version: "1.0" }, { predicate: (message) => message.name === "balances", timeoutMs, timeoutCode: "BALANCES_TIMEOUT" });
  }

  // ATENCAO: a IQ SÓ responde o get-options na versao 1.0 (a 2.0 fica em silêncio), e a
  // resposta se chama `options` (sem request_id) com open_options/closed_options.
  // Medido em 2026-10-02: v2.0 = nenhuma mensagem; v1.0 = `options` em ~1s.
  getOptions({ limit = 50, instrumentType = "binary,turbo", balanceId, timeoutMs = 12_000 } = {}) {
    return this.request("sendMessage", { name: "get-options", version: "1.0", body: { limit: Number(limit), instrument_type: instrumentType, user_balance_id: Number(balanceId) } }, {
      predicate: (message) => message.name === "options", timeoutMs, timeoutCode: "GET_OPTIONS_TIMEOUT",
    });
  }

  // Assina as mudanças das posições (push do broker). Cada evento `position-changed` traz
  // `sell_profit` (liquido se vender agora), `expected_profit`, `current_price`, `status`
  // (open/closed) e `raw_event.binary_options_option_changed1` com os dados da opcao —
  // e a fonte da cotacao da venda antecipada (protocolo quadcode: v3.0). Medido em 2026-10-02.
  subscribePositionChanges({ userId, balanceId, instrumentType = "turbo-option" } = {}) {
    this.send("subscribeMessage", {
      name: "portfolio.position-changed",
      version: "3.0",
      params: { routingFilters: { user_id: Number(userId), user_balance_id: Number(balanceId), instrument_type: instrumentType } },
    });
  }

  /** get-instruments v4 (catalogo por produto: turbo-option/binary-option/digital-option/blitz-option). */
  getInstruments({ type = "turbo-option", timeoutMs = 20_000 } = {}) {
    return this.request("sendMessage", { name: "get-instruments", version: "4.0", body: { type, instrument_types: [type] } }, {
      predicate: (message) => message.name === "instruments" || message.name === "api_game_getinstruments_result" || message.name === "get-instruments-result", timeoutMs, timeoutCode: "GET_INSTRUMENTS_TIMEOUT",
    });
  }

  /** Place a digital option (turbo) and wait for response.
   * Use the correct IQ Option digital API format.
   */
  async placeDigitalOrderAndWait({ price, activeId, direction, expiration, balanceId, timeoutMs = 20_000 } = {}) {
    const id = this.uuid().replace(/-/g, "").slice(0, 12);
    const normalized = direction === "CALL" || direction === "BUY" ? "call" : "put";
    const msg = {
      name: "digital-options.place-digital-option",
      version: "2.0",
      body: {
        price: Number(price),
        active_id: Number(activeId),
        asset_id: Number(activeId),
        instrument_id: String(activeId),
        instrument_index: Number(activeId),
        expired: Number(expiration),
        direction: normalized,
        option_type: "turbo",
        user_balance_id: Number(balanceId)
      }
    };
    this.send("sendMessage", msg, id);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ORDER_TIMEOUT')), timeoutMs);
      const handler = (msg) => {
        if (msg?.request_id !== id) return;
        const optionId = msg?.msg?.id ?? msg?.result?.id ?? msg?.id ?? null;
        clearTimeout(timer);
        this.off('message', handler);
        resolve({ requestId: id, optionId, raw: msg });
      };
      this.on('message', handler);
    });
  }

  /**
   * Vende (early close) uma opção ativa. Retorna o requestId.
   *
   * A mensagem é 'sell-options' com a lista 'options_ids' — é o que os clientes de
   * referência usam (github.com/iqoptionapi/iqoptionapi e a lib JS LuKks/iqoption).
   * 'close-position' com 'position_id' (usado antes) a IQ IGNORA EM SILÊNCIO: a opção
   * seguia até o vencimento e fechava como loss, sem nenhum erro no socket.
   */
  sellOption(optionId) {
    const id = this.uuid().replace(/-/g, "").slice(0, 12);
    this.send("sendMessage", {
      name: "sell-options",
      version: "2.0",
      body: { options_ids: [Number(optionId)] }
    }, id);
    return id;
  }

  close(reason = "CLIENT_CLOSE") {
    this.state = "CLOSING";
    this.#clearHeartbeat();
    try { this.socket?.close(1000, reason.slice(0, 100)); } catch { /* noop */ }
    try { this.socket?.destroy(); } catch { /* noop */ }
    this.state = "CLOSED";
  }
}
