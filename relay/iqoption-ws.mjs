/**
 * IQOPTION WS — cliente WebSocket real (falado com a IQ Option) e normalizacao causal de candles 5s.
 *
 * Referencia auditada (EXPECTED_FROM_REPO): github.com/iqoptionapi/iqoptionapi@master
 *  - ws/client.py        -> envelope {"name":..., "msg":..., "request_id":...} e wss://<host>/echo/websocket
 *  - ws/chanels/ssid.py  -> handshake {"name":"ssid","msg":"<ssid>"}
 *  - ws/received/time_sync.py -> {"name":"timeSync","msg":<epoch_ms>}
 *  - ws/chanels/heartbeat.py  -> {"name":"heartbeat","msg":{"heartbeatTime":...,"userTime":...}}
 *  - ws/chanels/subscribe.py  -> {"name":"subscribeMessage","msg":{"name":"candle-generated","params":{"routingFilters":{"active_id":"<id>","size":5}}}}
 *  - ws/received/candle_generated*.py -> {"name":"candle-generated"/"candles-generated", ...}
 *  - api.py get_api_option_init_all_v2() -> {"name":"sendMessage","msg":{"name":"get-initialization-data","version":"3.0","body":{}}}
 *  - ws/chanels/get_balances.py -> {"name":"sendMessage","msg":{"name":"get-balances","version":"1.0"}}
 *  - ws/chanels/buyv3.py -> {"name":"sendMessage","msg":{"body":{...},"name":"binary-options.open-option","version":"1.0"}}
 *  - ws/received/buy_complete.py / socket_option_opened.py / result.py -> ACK real
 *  - ws/received/socket_option_closed.py -> settlement
 *
 * Implementacao sem dependencia externa: TLS + RFC6455 (masked client frames, parser com fragmentacao,
 * ping/pong, close). Auto-disarm e responsabilidade do runtime; aqui apenas conexao/protocolo.
 *
 * REGRAS: nenhum SSID em log/status; ACTUAL_2026 (host/ids/payloads reais) sempre observado em runtime.
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

/* ------------------------------------------------------------------ *
 * RFC6455 — codec puro (testavel sem rede)
 * ------------------------------------------------------------------ */

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

/** Parser incremental: aceita fragmentacao do servidor e entrega mensagens completas + control frames. */
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

/* ------------------------------------------------------------------ *
 * RawWebSocket — TLS + upgrade (sem dependencia externa)
 * ------------------------------------------------------------------ */

export class RawWebSocket extends EventEmitter {
  constructor({ host, path = IQ_WS_PATH, port = 443, timeoutMs = 15_000, tlsConnect = (options) => tls.connect(options), origin = "https://iqoption.com", userAgent = "tracecom-relay/1.0" } = {}) {
    super();
    this.host = host; this.path = path; this.port = port; this.timeoutMs = timeoutMs; this.tlsConnect = tlsConnect; this.origin = origin; this.userAgent = userAgent;
    this.socket = null; this.parser = new FrameParser(); this.connected = false; this.upgradeHeaders = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (code, detail = "") => { if (settled) return; settled = true; this.destroy(); reject(new IqWsError(code, detail)); };
      const timer = setTimeout(() => fail("WS_CONNECT_TIMEOUT", `${this.host}`), this.timeoutMs);
      const key = crypto.randomBytes(16).toString("base64");
      let socket;
      try {
        socket = this.tlsConnect({ host: this.host, port: this.port, servername: this.host, rejectUnauthorized: true });
      } catch (error) { clearTimeout(timer); fail("WS_TLS_INIT_FAILED", String(error?.message ?? error)); return; }
      this.socket = socket;
      socket.on("error", (error) => { clearTimeout(timer); if (this.listenerCount("error") > 0) this.emit("error", error); fail("WS_SOCKET_ERROR", String(error?.message ?? error)); });
      socket.on("close", () => { clearTimeout(timer); if (!settled) fail("WS_CLOSED_BEFORE_UPGRADE"); this.connected = false; this.emit("close"); });
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
    try { if (this.connected) this.socket.write(encodeFrame({ opcode: WS_OPCODES.CLOSE, payload: Buffer.from([(code >> 8) & 0xff, code & 0xff]), mask: true })); } catch { /* socket ja morto */ }
    this.connected = false;
    setTimeout(() => this.destroy(), 250).unref?.();
  }

  destroy() { this.connected = false; try { this.socket?.destroy(); } catch { /* noop */ } this.socket = null; }
}

/* ------------------------------------------------------------------ *
 * Helpers puros (testaveis)
 * ------------------------------------------------------------------ */

export function envelope(name, msg, requestId = "") { return JSON.stringify({ name, msg, request_id: requestId }); }

export function toEpochMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  if (number > 1e15) return Math.round(number / 1e6); // nanoseconds (ACTUAL_2026: candle-generated.at)
  if (number > 1e12) return Math.round(number); // milliseconds
  return Math.round(number * 1000); // seconds
}

export function validateServerTime(serverTimeMs, localNowMs, toleranceMs = TIME_SYNC_TOLERANCE_MS) {
  const server = Number(serverTimeMs), local = Number(localNowMs);
  if (!Number.isFinite(server) || !Number.isFinite(local)) return { valid: false, skewMs: null, reason: "TIME_SYNC_INVALID" };
  const skewMs = Math.round(server - local);
  return { valid: Math.abs(skewMs) <= toleranceMs, skewMs, toleranceMs, reason: Math.abs(skewMs) <= toleranceMs ? "OK" : "CLOCK_SKEW_EXCEEDED" };
}

/** Normaliza candle 5s da IQ para IQCandle causal. Rejeita futuro e ativo cruzado; nunca inventa preco. */
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
  if (bucketEnd > bucketStart + size * 1000 + 1) throw new IqWsError("CANDLE_TOO_LONG");
  return {
    symbol, activeId: activeId ?? (rawActive === null ? null : Number(rawActive)),
    bucketStart, bucketEnd, open, high, low, close,
    source: CANDLE_SOURCE,
    serverTimestamp: rawAtMs ?? (Number.isFinite(serverTimestamp) ? serverTimestamp : null),
    receivedAt: receivedAt ?? Date.now(),
    segmentId: `${symbol}:${bucketStart}`,
    connectionId: connectionId ?? null,
    volume: Number.isFinite(Number(raw.volume)) ? Number(raw.volume) : null,
    ask: price([raw.ask, raw.price_ask]),
    bid: price([raw.bid, raw.price_bid]),
  };
}

/** Classificacao SERVER-SIDE da conta via get_balances (type 1 REAL / 4 PRACTICE). */
export function classifyBalances(list) {
  const rows = (Array.isArray(list) ? list : []).filter((row) => row && typeof row === "object");
  const decorate = (row) => ({ id: row.id ?? null, type: BALANCE_TYPES[Number(row.type)] ?? "UNKNOWN", rawType: Number(row.type) || null, currency: row.currency ?? null, amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : null, isDefault: row.is_default === true });
  const balances = rows.map(decorate);
  const practice = balances.filter((row) => row.type === "PRACTICE");
  const real = balances.filter((row) => row.type === "REAL");
  const tournament = balances.filter((row) => row.type === "TOURNAMENT");
  const selected = practice.find((row) => row.isDefault) ?? practice[0] ?? real.find((row) => row.isDefault) ?? real[0] ?? tournament[0] ?? null;
  const type = practice.length ? "PRACTICE" : real.length ? "REAL" : tournament.length ? "TOURNAMENT" : "UNKNOWN";
  return { balances, practice, real, tournament, selected, type, verifiedPractice: practice.length > 0 && selected?.type === "PRACTICE", hasReal: real.length > 0 };
}

/** EUR/USD resolvido em RUNTIME (nunca hardcodado): initialization-data v3 -> actives binarias/turbo. */
export function resolveEurUsdActive(initializationData) {
  const source = initializationData?.result ?? initializationData ?? {};
  const sections = ["binary", "turbo"];
  const found = [];
  for (const section of sections) {
    const actives = source?.[section]?.actives ?? {};
    for (const [id, active] of Object.entries(actives)) {
      const rawName = String(active?.name ?? "");
      const cleaned = rawName.split(".").pop() ?? "";
      const otc = /otc/i.test(cleaned);
      const canonical = cleaned.replace(/[-_\s]?otc/ig, "").replace(/[^A-Za-z]/g, "").toUpperCase();
      if (canonical !== "EURUSD") continue;
      found.push({ activeId: Number(id), symbol: "EUR/USD", name: rawName, section, otc, enabled: active?.enabled === true, suspended: active?.is_suspended === true, open: active?.enabled === true && active?.is_suspended !== true });
    }
  }
  const tradeable = found.find((row) => row.open && !row.otc) ?? found.find((row) => row.open) ?? found.find((row) => !row.otc) ?? found[0] ?? null;
  return { candidates: found, selected: tradeable, expectedFromRepo: EXPECTED_EURUSD_ACTIVE_ID_FROM_REPO };
}

/** Expiracao + tipo de opcao conforme referencia (iqoptionapi/expiration.py get_expiration_time). */
export function computeExpiration(serverTimestampSeconds, durationMinutes) {
  const duration = Math.max(1, Math.round(Number(durationMinutes) || 1));
  const nowSec = Math.floor(Number(serverTimestampSeconds));
  if (!Number.isFinite(nowSec) || nowSec <= 0) throw new IqWsError("SERVER_TIME_REQUIRED");
  // 300s operacional: expiracao ESTRITA no bucket de 5 minutos (mesma autoridade do Binary300Timing).
  if (duration === 5) {
    const expiration = (Math.floor(nowSec / 300) + 1) * 300;
    return { expiration, optionTypeId: 3, optionKind: "turbo", durationMinutes: 5, reference: "tracecom/binary300-bucket" };
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
  return { expiration: candidates[bestIndex], optionTypeId: bestIndex < 5 ? 3 : 1, optionKind: bestIndex < 5 ? "turbo" : "binary", durationMinutes: duration, reference: "iqoptionapi/expiration.py" };
}

export function buildOrderRequest({ price, activeId, direction, expiration, optionTypeId, balanceId }) {
  const normalized = direction === "CALL" || direction === "BUY" ? "call" : direction === "PUT" || direction === "SELL" ? "put" : null;
  if (!normalized) throw new IqWsError("INVALID_DIRECTION");
  if (!Number.isFinite(Number(price)) || Number(price) <= 0) throw new IqWsError("INVALID_PRICE");
  if (!Number.isFinite(Number(activeId))) throw new IqWsError("ACTIVE_ID_REQUIRED");
  if (!Number.isFinite(Number(expiration))) throw new IqWsError("EXPIRATION_REQUIRED");
  if (!Number.isFinite(Number(balanceId))) throw new IqWsError("BALANCE_ID_REQUIRED");
  return { name: "sendMessage", msg: { body: { price: Number(price), active_id: Number(activeId), expired: Number(expiration), direction: normalized, option_type_id: Number(optionTypeId), user_balance_id: Number(balanceId) }, name: "binary-options.open-option", version: "1.0" } };
}

export function parseSettlement(msg) {
  const win = String(msg?.win ?? "").toLowerCase();
  const result = win === "win" ? "WIN" : win === "loose" || win === "loss" ? "LOSS" : win === "equal" || win === "draw" ? "DRAW" : "UNKNOWN";
  const amount = Number(msg?.sum ?? msg?.amount);
  const payout = Number(msg?.win_amount);
  const profit = result === "WIN" && Number.isFinite(payout) && Number.isFinite(amount) ? payout - amount : result === "LOSS" && Number.isFinite(amount) ? -amount : result === "DRAW" ? 0 : null;
  return { result, profit, rawWin: win || null };
}

/* ------------------------------------------------------------------ *
 * IqWsClient — conexao unica com hosting discovery + protocolo
 * ------------------------------------------------------------------ */

export class IqWsClient extends EventEmitter {
  constructor({ hosts = IQ_WS_CANDIDATE_HOSTS, socketFactory = null, now = () => Date.now(), uuid = () => crypto.randomUUID(), log = () => {}, origin = null } = {}) {
    super();
    this.hosts = hosts;
    this.socketFactory = socketFactory ?? ((options) => new RawWebSocket({ ...options, origin: origin ?? options.origin ?? "https://iqoption.com" }));
    this.now = now;
    this.uuid = uuid;
    this.log = (...args) => { try { log(...args); } catch { /* log nunca derruba conexao */ } };
    this.host = null; this.socket = null; this.connectionId = null; this.state = "IDLE";
    this.serverTimeMs = null; this.serverTimeReceivedAt = null; this.clockSkewMs = null; this.timeValid = false;
    this.lastHeartbeatAt = null; this.lastHeartbeatServer = null;
    this.pending = new Map();
    this.heartbeatTimer = null;
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
        socket.on("data", (chunk) => this.#onData(chunk));
        socket.on("close", () => { const connectionId = this.connectionId; this.state = "CLOSED"; this.#clearHeartbeat(); this.emit("closed", { connectionId, host: this.host, at: this.now() }); });
        socket.on("error", (error) => { this.log("IQ_WS_SOCKET_ERROR", String(error?.message ?? error)); });
        await socket.connect();
        this.host = host;
        this.connectionId = this.uuid();
        this.helloAt = this.now();
        this.state = "HANDSHAKE";
        this.emit("upgraded", { connectionId: this.connectionId, host, expectedFromRepo: EXPECTED_WS_HOST_FROM_REPO, actual2026: host });
        socket.sendText(envelope("ssid", ssid, this.uuid().replace(/-/g, "").slice(0, 12)));
        const timeSync = this.#waitFor((message) => message.name === "timeSync", timeoutMs, "TIME_SYNC_TIMEOUT");
        const sync = await timeSync;
        this.#handleTimeSync(sync.msg);
        this.state = "READY";
        this.#startHeartbeat();
        this.emit("ready", { connectionId: this.connectionId, host, serverTimeMs: this.serverTimeMs, clockSkewMs: this.clockSkewMs, timeValid: this.timeValid });
        return { connectionId: this.connectionId, host, serverTimeMs: this.serverTimeMs, clockSkewMs: this.clockSkewMs, timeValid: this.timeValid };
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
    try { frames = this.socket?.parser.push(chunk) ?? []; } catch (error) { this.log("IQ_WS_PARSE_ERROR", String(error?.message ?? error)); return; }
    for (const frame of frames) {
      if (frame.opcode === WS_OPCODES.PING) { try { this.socket?.pong(frame.payload); } catch { /* noop */ } continue; }
      if (frame.opcode === WS_OPCODES.PONG) continue;
      if (frame.opcode === WS_OPCODES.CLOSE) { try { this.socket?.close(1000); } catch { /* noop */ } return; }
      let message;
      try { message = JSON.parse(frame.payload.toString("utf8")); } catch { continue; }
      try { this.#onMessage(message); } catch (error) { this.log("IQ_WS_HANDLER_ERROR", message?.name ?? "?", String(error?.message ?? error)); }
    }
  }

  #onMessage(message) {
    const event = { connectionId: this.connectionId, host: this.host, receivedAt: this.now(), name: message?.name ?? null, requestId: message?.request_id ?? message?.requestId ?? null, msg: message?.msg ?? null };
    if (message?.name === "timeSync") this.#handleTimeSync(message.msg);
    if (message?.name === "heartbeat") {
      this.lastHeartbeatAt = this.now();
      this.lastHeartbeatServer = message.msg ?? null;
      const heartbeatTime = Number(message.msg?.heartbeatTime ?? message.msg ?? this.now());
      this.send("heartbeat", { heartbeatTime: Number.isFinite(heartbeatTime) ? Math.round(heartbeatTime) : this.now(), userTime: Math.round(this.serverNow() ?? this.now()) });
    }
    const resolver = this.pending.get("any");
    if (resolver) resolver(message);
    this.emit("message", event);
    this.emit(event.name ?? "unknown", event);
  }

  #handleTimeSync(msg) {
    const serverTimeMs = toEpochMs(msg) ?? (Number.isFinite(Number(msg)) ? Number(msg) : null);
    if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0) return;
    this.serverTimeMs = serverTimeMs;
    this.serverTimeReceivedAt = this.now();
    const check = validateServerTime(serverTimeMs, this.serverTimeReceivedAt);
    this.clockSkewMs = check.skewMs; this.timeValid = check.valid;
    if (!check.valid) this.log("IQ_WS_CLOCK_SKEW", JSON.stringify({ skewMs: check.skewMs, toleranceMs: check.toleranceMs }));
  }

  #startHeartbeat() {
    this.#clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const elapsed = this.lastHeartbeatAt === null ? Infinity : this.now() - this.lastHeartbeatAt;
      if (elapsed < HEARTBEAT_FALLBACK_MS) return;
      try { this.send("heartbeat", { heartbeatTime: this.now(), userTime: Math.round(this.serverNow() ?? this.now()) }); } catch { /* desconectando */ }
    }, 10_000);
    this.heartbeatTimer.unref?.();
  }

  #clearHeartbeat() { if (this.heartbeatTimer) clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }

  #waitFor(predicate, timeoutMs, timeoutCode) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete("any"); reject(new IqWsError(timeoutCode)); }, timeoutMs);
      const resolver = (message) => {
        if (!predicate(message)) return;
        this.pending.delete("any");
        clearTimeout(timer);
        resolve(message);
      };
      this.pending.set("any", resolver);
    });
  }

  send(name, msg, requestId = "") {
    if (!this.socket || this.state === "CLOSED") throw new IqWsError("WS_NOT_CONNECTED");
    this.socket.sendText(envelope(name, msg, requestId));
  }

  async request(name, msg, { predicate, timeoutMs = 15_000, timeoutCode = "REQUEST_TIMEOUT", requestId = null } = {}) {
    const id = requestId ?? this.uuid().replace(/-/g, "").slice(0, 12);
    const wait = this.#waitFor(predicate ?? ((message) => message.request_id === id || message.requestId === id), timeoutMs, timeoutCode);
    this.send(name, msg, id);
    const response = await wait;
    return { requestId: id, response };
  }

  subscribeCandles(activeId, size = CANDLE_SIZE_SECONDS) {
    const key = `${activeId}:${size}`;
    this.send("subscribeMessage", { name: "candle-generated", params: { routingFilters: { active_id: String(activeId), size: Number(size) } } });
    this.subscriptions.add(key);
    return key;
  }

  unsubscribeCandles(activeId, size = CANDLE_SIZE_SECONDS) {
    const key = `${activeId}:${size}`;
    this.send("unsubscribeMessage", { name: "candle-generated", params: { routingFilters: { active_id: String(activeId), size: Number(size) } } });
    this.subscriptions.delete(key);
    return key;
  }

  /** Historico real de candles (protocolo get-candles v2, referencia iqoptionapi ja validada no projeto).
   *  Resposta esperada: name "candles" com msg.candles[] (NUNCA aceita eventos do stream live).
   *  NUNCA fabrica: se o broker nao responder, lanca timeout e o chamador segue com o stream live. */
  getCandlesHistory({ activeId, size = CANDLE_SIZE_SECONDS, count = 300, to = null, timeoutMs = 12_000 } = {}) {
    const serverTo = Number.isFinite(Number(to)) ? Number(to) : (Number.isFinite(Number(this.serverNow?.())) ? Number(this.serverNow()) : Date.now());
    const body = { active_id: Number(activeId), size: Number(size), to: serverTo, count: Math.max(1, Math.min(1000, Number(count) || 300)), "": "" };
    return this.request("sendMessage", { name: "get-candles", version: "2.0", body }, {
      predicate: (message) => message?.name === "candles" && Array.isArray(message?.msg?.candles),
      timeoutMs, timeoutCode: "GET_CANDLES_TIMEOUT",
    });
  }

  getInitializationData({ timeoutMs = 20_000 } = {}) {
    return this.request("sendMessage", { name: "get-initialization-data", version: "3.0", body: {} }, {
      predicate: (message) => message.name === "initialization-data" || (message.name === "initialization-data-v2" || message.name === "api_option_init_all_result"),
      timeoutMs, timeoutCode: "INITIALIZATION_DATA_TIMEOUT",
    });
  }

  getBalances({ timeoutMs = 15_000 } = {}) {
    return this.request("sendMessage", { name: "get-balances", version: "1.0" }, { predicate: (message) => message.name === "balances", timeoutMs, timeoutCode: "BALANCES_TIMEOUT" });
  }

  getOptions({ limit = 50, instrumentType = "binary,turbo", balanceId, timeoutMs = 12_000 } = {}) {
    return this.request("sendMessage", { name: "get-options", version: "2.0", body: { limit: Number(limit), instrument_type: instrumentType, user_balance_id: Number(balanceId) } }, {
      predicate: (message) => message.name === "api_game_getoptions_result", timeoutMs, timeoutCode: "GET_OPTIONS_TIMEOUT",
    });
  }

  /** get-instruments v4 (catalogo por produto: turbo-option/binary-option/digital-option/blitz-option). */
  getInstruments({ type = "turbo-option", timeoutMs = 20_000 } = {}) {
    return this.request("sendMessage", { name: "get-instruments", version: "4.0", body: { type, instrument_types: [type] } }, {
      predicate: (message) => message.name === "instruments" || message.name === "api_game_getinstruments_result" || message.name === "get-instruments-result", timeoutMs, timeoutCode: "GET_INSTRUMENTS_TIMEOUT",
    });
  }

  /** Ordem PRACTICE pela buyv3. Retorna requestId; ACK chega por eventos (option/buyComplete/result). */
  placeOrder({ price, activeId, direction, expiration, optionTypeId, balanceId, requestId }) {
    const id = requestId ?? this.uuid().replace(/-/g, "").slice(0, 12);
    const request = buildOrderRequest({ price, activeId, direction, expiration, optionTypeId, balanceId });
    this.send(request.name, request.msg, id);
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
