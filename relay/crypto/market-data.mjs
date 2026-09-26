/**
 * CRYPTO MARKET DATA — interface + provider de exchange real (Binance publico, sem auth).
 * NUNCA inventa candles: toda falha retorna { ok:false } (fail-closed).
 * Fonte: REST publico https://api.binance.com/api/v3/klines (mercado REAL, nao OTC/sintetico).
 */
export const CRYPTO_MARKET_DATA_VERSION = "crypto-market-data-v1";

export const CRYPTO_SYMBOLS = Object.freeze(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
export const CRYPTO_INTERVALS = Object.freeze(["1m", "5m", "15m"]);
export const CRYPTO_TIMEFRAMES = Object.freeze({
  REGIME: "15m",
  SETUP: "5m",
  TIMING: "1m",
});

const BINANCE_REST = "https://api.binance.com/api/v3";
const BYBIT_REST = "https://api.bybit.com/v5/market";
const BYBIT_INTERVALS = Object.freeze({ "1m": "1", "5m": "5", "15m": "15" });

const toEpochMs = (raw) => {
  const value = Number(raw);
  return Number.isFinite(value) ? (value > 10_000_000_000 ? value : value * 1000) : null;
};

function normalizeKlines(rows) {
  const out = [];
  for (const row of rows ?? []) {
    const at = toEpochMs(row?.[0]);
    const open = Number(row?.[1]);
    const high = Number(row?.[2]);
    const low = Number(row?.[3]);
    const close = Number(row?.[4]);
    const volume = Number(row?.[5]);
    if (![at, open, high, low, close].every(Number.isFinite) || at <= 0 || open <= 0 || close <= 0) continue;
    out.push({ at, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  return out;
}

async function httpGet(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "tracecom/1.0" } });
    if (!res.ok) return { ok: false, status: res.status, message: `HTTP ${res.status}` };
    return { ok: true, status: res.status, data: await res.json() };
  } catch (error) {
    return { ok: false, status: 0, message: String(error?.message ?? error).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

/** Interface de dados de mercado cripto (exchange real). Implementacoes: binance. */
export class CryptoMarketDataProvider {
  constructor({ provider = "bybit", timeoutMs = 10_000, now = Date.now } = {}) {
    this.provider = String(provider ?? "bybit").toLowerCase();
    this.timeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : 10_000;
    this.now = now;
    this.healthy = false;
    this.lastOkAt = 0;
    this.lastError = null;
    this.checkedAt = 0;
  }

  /** Candles normalizados de uma exchange REAL (nunca sintetico/OTC). */
  async getCandles(symbol, interval, limit = 200) {
    const symbolOk = String(symbol).toUpperCase();
    const intervalOk = String(interval).toLowerCase();
    if (!CRYPTO_INTERVALS.includes(intervalOk)) return { ok: false, message: `unsupported interval ${intervalOk}` };
    if (this.provider === "bybit") {
      const res = await httpGet(`${BYBIT_REST}/kline?category=spot&symbol=${encodeURIComponent(symbolOk)}&interval=${BYBIT_INTERVALS[intervalOk]}&limit=${Math.min(500, Math.max(50, Number(limit) || 200))}`, this.timeoutMs);
      this.#note(res);
      if (res.ok !== true) return { ok: false, message: res.message, status: res.status };
      if (res.data?.retCode !== 0) return { ok: false, message: `bybit retCode ${res.data?.retCode}` };
      // Bybit retorna list em ordem DESCENDENTE (mais recente primeiro) -> reverter.
      const rows = [...(res.data?.result?.list ?? [])].reverse();
      const candles = normalizeKlines(rows);
      if (candles.length < 50) return { ok: false, message: `insufficient candles ${candles.length}` };
      return { ok: true, symbol: symbolOk, interval: intervalOk, candles };
    }
    if (this.provider !== "binance") return { ok: false, message: `unsupported provider ${this.provider}` };
    const res = await httpGet(`${BINANCE_REST}/klines?symbol=${encodeURIComponent(symbolOk)}&interval=${intervalOk}&limit=${Math.min(500, Math.max(50, Number(limit) || 200))}`, this.timeoutMs);
    this.#note(res);
    if (res.ok !== true) return { ok: false, message: res.message, status: res.status };
    const candles = normalizeKlines(res.data);
    if (candles.length < 50) return { ok: false, message: `insufficient candles ${candles.length}` };
    return { ok: true, symbol: symbolOk, interval: intervalOk, candles };
  }

  /** Ticker 24h (preco atual + variacao) da exchange real. */
  async getTicker(symbol) {
    const symbolOk = String(symbol).toUpperCase();
    if (this.provider === "bybit") {
      const res = await httpGet(`${BYBIT_REST}/tickers?category=spot&symbol=${encodeURIComponent(symbolOk)}`, this.timeoutMs);
      this.#note(res);
      if (res.ok !== true) return { ok: false, message: res.message, status: res.status };
      const ticker = res.data?.result?.list?.[0] ?? {};
      const lastPrice = Number(ticker.lastPrice);
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) return { ok: false, message: "invalid ticker" };
      return { ok: true, symbol: symbolOk, lastPrice, change24hPct: Number.isFinite(Number(ticker.price24hPct)) ? Number(ticker.price24hPct) : null, high24h: Number(ticker.highPrice24h) || null, low24h: Number(ticker.lowPrice24h) || null, volume24h: Number(ticker.turnover24h) || null };
    }
    if (this.provider !== "binance") return { ok: false, message: `unsupported provider ${this.provider}` };
    const res = await httpGet(`${BINANCE_REST}/ticker/24hr?symbol=${encodeURIComponent(symbolOk)}`, this.timeoutMs);
    this.#note(res);
    if (res.ok !== true) return { ok: false, message: res.message, status: res.status };
    const lastPrice = Number(res.data?.lastPrice);
    const changePct = Number(res.data?.priceChangePercent);
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) return { ok: false, message: "invalid ticker" };
    return { ok: true, symbol: symbolOk, lastPrice, change24hPct: Number.isFinite(changePct) ? changePct : null, high24h: Number(res.data?.highPrice) || null, low24h: Number(res.data?.lowPrice) || null, volume24h: Number(res.data?.quoteVolume) || null };
  }

  #note(res) {
    this.checkedAt = this.now();
    if (res?.ok === true) { this.healthy = true; this.lastOkAt = this.now(); this.lastError = null; }
    else { this.healthy = false; this.lastError = res?.message ?? "UNKNOWN"; }
  }

  status() {
    return { provider: this.provider, healthy: this.healthy, lastOkAt: this.lastOkAt, lastError: this.lastError, checkedAt: this.checkedAt, realMarket: true, otc: false };
  }
}