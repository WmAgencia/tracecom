/**
 * IQ MCP CLIENT (API OFICIAL) — Blitz/binárias. JSON-RPC com handshake de sessao MCP.
 * Token SEMPRE de env (IQ_MCP_TOKEN); nunca loga/grava segredo. Rate limit simples.
 * Doc tools (blitz): get_candles, list_assets, list_balances, list_positions, get_trade_history,
 * place_trade {balance_id, asset_id, direction, amount, profit_percent, expiration_size}, sell_position.
 */
export const IQ_MCP_ENDPOINTS = Object.freeze({
  blitz: "https://blitz-options.mcp.iqoption.com",
  binary: "https://binary-options.mcp.iqoption.com",
  digital: "https://digital-options.mcp.iqoption.com",
  turbo: "https://turbo-options.mcp.iqoption.com",
});

export class IqMcpClient {
  constructor({ token = null, endpoint = IQ_MCP_ENDPOINTS.blitz, log = () => {}, timeoutMs = 30_000, now = () => Date.now() } = {}) {
    this.token = token ?? process.env.IQ_MCP_TOKEN ?? null;
    this.endpoint = endpoint;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.sessionId = null;
    this.nextId = 1;
    this.writes = []; // timestamps para rate limit (write 10/min)
  }

  get enabled() { return Boolean(this.token); }

  async #rpc(method, params, { notification = false } = {}) {
    if (!this.enabled) throw Object.assign(new Error("IQ_MCP_TOKEN ausente"), { code: "IQ_MCP_TOKEN_MISSING" });
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${this.token}` };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const body = notification ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: this.nextId++, method, params };
    const response = await fetch(this.endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs) });
    this.sessionId = response.headers.get("mcp-session-id") ?? this.sessionId;
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { const line = text.split(/\r?\n/).find((l) => l.startsWith("data:")); if (line) { try { json = JSON.parse(line.slice(5).trim()); } catch { /* noop */ } } }
    if (!json) throw Object.assign(new Error(`IQ_MCP_BAD_RESPONSE_${response.status}`), { code: "IQ_MCP_BAD_RESPONSE" });
    if (json.error) throw Object.assign(new Error(String(json.error.message ?? "IQ_MCP_ERROR").slice(0, 200)), { code: `IQ_MCP_${json.error.code ?? "ERROR"}`, detail: json.error });
    return json.result ?? null;
  }

  async #ensureSession() {
    if (this.sessionId) return;
    await this.#rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "tracecom-live-relay", version: "1.0.0" } });
    await this.#rpc("notifications/initialized", {}, { notification: true });
  }

  async callTool(name, args = {}) {
    await this.#ensureSession();
    try {
      return await this.#rpc("tools/call", { name, arguments: args });
    } catch (error) {
      // Sessao expirada/invalida: re-inicializa uma vez.
      this.sessionId = null;
      await this.#ensureSession();
      return await this.#rpc("tools/call", { name, arguments: args });
    }
  }

  /** Resultado das tools vem em content[0].text (JSON) e/ou structuredContent. */
  static unwrap(result) {
    if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
    const text = result?.content?.[0]?.text ?? null;
    if (typeof text === "string") { try { return JSON.parse(text); } catch { return { text }; } }
    return result ?? null;
  }

  async listAssets({ onlyEnabled = true } = {}) {
    const data = IqMcpClient.unwrap(await this.callTool("list_assets", { only_enabled: onlyEnabled }));
    return Array.isArray(data?.assets) ? data.assets : [];
  }

  async getCandles({ assetId, size = 5, count = 120 } = {}) {
    const data = IqMcpClient.unwrap(await this.callTool("get_candles", { asset_id: Number(assetId), size: Number(size), count: Number(count) }));
    return Array.isArray(data?.candles) ? data.candles : [];
  }

  async listBalances() {
    const data = IqMcpClient.unwrap(await this.callTool("list_balances", {}));
    return Array.isArray(data?.balances) ? data.balances : (Array.isArray(data) ? data : []);
  }

  async listPositions(balanceId) {
    const data = IqMcpClient.unwrap(await this.callTool("list_positions", { balance_id: Number(balanceId) }));
    return Array.isArray(data?.positions) ? data.positions : (Array.isArray(data) ? data : []);
  }

  async getTradeHistory({ skip = 0, limit = 50 } = {}) {
    const data = IqMcpClient.unwrap(await this.callTool("get_trade_history", { skip, limit }));
    return Array.isArray(data?.trades) ? data.trades : (Array.isArray(data?.history) ? data.history : (Array.isArray(data) ? data : []));
  }

  #writeAllowed() {
    const cutoff = this.now() - 60_000;
    this.writes = this.writes.filter((t) => t > cutoff);
    return this.writes.length < 10; // limite oficial: write 10/min
  }

  async placeTrade({ balanceId, assetId, direction, amount, profitPercent, expirationSize }) {
    if (!this.#writeAllowed()) throw Object.assign(new Error("IQ_MCP_WRITE_RATE_LIMIT"), { code: "IQ_MCP_WRITE_RATE_LIMIT" });
    this.writes.push(this.now());
    const wireDirection = String(direction).toUpperCase() === "BUY" || String(direction).toUpperCase() === "CALL" ? "call" : "put";
    const data = IqMcpClient.unwrap(await this.callTool("place_trade", {
      balance_id: Number(balanceId), asset_id: Number(assetId), direction: wireDirection,
      amount: Number(amount), profit_percent: Number(profitPercent), expiration_size: Number(expirationSize),
    }));
    return data ?? null;
  }
}
