/**
 * CRYPTO MARKET DATA — interface + providers de exchange REAL com FAILOVER.
 * Ordem de tentativa: bybit -> okx -> coinbase -> kraken (todas publicas, sem auth).
 * NUNCA inventa candles: toda falha retorna { ok:false } (fail-closed). OTC/sintetico = NO.
 * (Binance fica de fora: HTTP 451/403 para IPs de datacenter em varias regioes.)
 */
export const CRYPTO_MARKET_DATA_VERSION = "crypto-market-data-v1";

export const CRYPTO_SYMBOLS = Object.freeze(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
export const CRYPTO_INTERVALS = Object.freeze(["1m", "5m", "15m"]);
export const CRYPTO_TIMEFRAMES = Object.freeze({
  REGIME: "15m",
  SETUP: "5m",
  TIMING: "1m",
});

const PROVIDER_ORDER = ["bybit", "okx", "coinbase", "kraken"];
const OKX_BARS = Object.freeze({ "1m": "1m", "5m": "5m", "15m": "15m" });
const KRAKEN_SYMBOLS = Object.freeze({ BTCUSDT: "XBTUSD", ETHUSDT: "ETHUSD", SOLUSDT: "SOLUSD" });
const KRAKEN_INTERVALS = Object.freeze({ "1m": 1, "5m": 5, "15m": 15 });
const CB_GRANULARITY = Object.freeze({ "1m": 60, "5m": 300, "15m": 900 });
const CB_SYMBOLS = Object.freeze({ BTCUSDT: "BTC-USD", ETHUSDT: "ETH-USD", SOLUSDT: "SOL-USD" });
const OKX_SYMBOLS = Object.freeze({ BTCUSDT: "BTC-USDT", ETHUSDT: "ETH-USDT", SOLUSDT: "SOL-USDT" });

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

async function httpGet(url, timeoutMs, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; TraceCom/1.0)", ...headers } });
    if (!res.ok) return { ok: false, status: res.status, message: `HTTP ${res.status}` };
    return { ok: true, status: res.status, data: await res.json() };
  } catch (error) {
    return { ok: false, status: 0, message: String(error?.message ?? error).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

/** Interface de dados de mercado cripto (exchange real) com failover automatico. */
export class CryptoMarketDataProvider {
  constructor({ provider = "auto", timeoutMs = 10_000, now = Date.now, order = PROVIDER_ORDER } = {}) {
    this.order = Array.isArray(order) && order.length ? order : PROVIDER_ORDER;
    this.timeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : 10_000;
    this.now = now;
    this.healthy = false;
    this.lastOkAt = 0;
    this.lastError = null;
    this.checkedAt = 0;
    this.activeProvider = null;
  }

  async #candlesByProvider(provider, symbol, interval, limit) {
    const timeoutMs = this.timeoutMs;
    if (provider === "bybit") {
      const res = await httpGet(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval={{I}}&limit=${limit}`.replace("{{I}}", { "1m": "1", "5m": "5", "15m": "15" }[interval]), timeoutMs);
      if (res.ok !== true) return { ok: false, message: res.message };
      if (res.data?.retCode !== 0) return { ok: false, message: `retCode ${res.data?.retCode}` };
      const rows = [...(res.data?.result?.list ?? [])].reverse();
      return { ok: true, candles: normalizeKlines(rows) };
    }
    if (provider === "okx") {
      const res = await httpGet(`https://www.okx.com/api/v5/market/candles?instId=${OKX_SYMBOLS[symbol]}&bar=${OKX_BARS[interval]}&limit=${limit}`, timeoutMs);
      if (res.ok !== true) return { ok: false, message: res.message };
      if (String(res.data?.code ?? "") !== "0") return { ok: false, message: `code ${res.data?.code}` };
      const rows = [...(res.data?.data ?? [])].reverse();
      return { ok: true, candles: normalizeKlines(rows) };
    }
    if (provider === "coinbase") {
      const res = await httpGet(`https://api.exchange.coinbase.com/products/${CB_SYMBOLS[symbol]}/candles?granularity=${CB_GRANULARITY[interval]}&limit=${limit}`, timeoutMs);
      if (res.ok !== true) return { ok: false, message: res.message };
      return { ok: true, candles: normalizeKlines(res.data) };
    }
    if (provider === "kraken") {
      const res = await httpGet(`https://api.kraken.com/0/public/OHLC?pair=${KRAKEN_SYMBOLS[symbol]}&interval=${KRAKEN_INTERVALS[interval]}`, timeoutMs);
      if (res.ok !== true) return { ok: false, message: res.message };
      if (res.data?.error?.length) return { ok: false, message: res.data.error.join(",") };
      const key = Object.keys(res.data?.result ?? {}).find((k) => k !== "last");
      const rows = res.data?.result?.[key] ?? [];
      return { ok: true, candles: normalizeKlines(rows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[6]])) };
    }
    return { ok: false, message: `unsupported provider ${provider}` };
  }

  async #tickerByProvider(provider, symbol) {
    const timeoutMs = this.timeoutMs;
    if (provider === "bybit") {
      const res = await httpGet(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`, timeoutMs);
      if (res.ok !== true) return { ok: false, message: res.message };
      const t = res.data?.result?.list?.[0] ?? {};
      const lastPrice = Number(t.lastPrice);
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) return { ok: false, message: "invalid ticker" };
      return { ok: true, lastPrice, change24hPct: Number.isFinite(Number(t.price24hPct)) ? Number(t.price24hPct) : null };
    }
    if (provider === "okx") {
      const res = await httpGet(`https://www.okx.com/api/v5/market/ticker?instId=${OKX_SYMBOLS[symbol]}`, timeoutMs);
      if (res.ok !== true) return { ok: false, message: res.message };
      const t = res.data?.data?.[0] ?? {};
      const lastPrice = Number(t.last);
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) return { ok: false, message: "invalid ticker" };
      const open = Number(t.open24h);
      const change = open > 0 ? ((lastPrice - open) / open) * 100 : null;
      return { ok: true, lastPrice, change24hPct: change };
    }
    if (provider === "coinbase") {
      const [spot, stats] = await Promise.all([
        httpGet(`https://api.coinbase.com/v2/prices/${CB_SYMBOLS[symbol]}/spot`, timeoutMs),
        httpGet(`https://api.exchange.coinbase.com/products/${CB_SYMBOLS[symbol]}/stats`, timeoutMs),
      ]);
      if (spot.ok !== true) return { ok: false, message: spot.message };
      const lastPrice = Number(spot.data?.data?.amount);
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) return { ok: false, message: "invalid ticker" };
      const open = Number(stats.ok === true ? stats.data?.open : NaN);
      const change = open > 0 ? ((lastPrice - open) / open) * 100 : null;
      return { ok: true, lastPrice, change24hPct: change };
    }
    if (provider === "kraken") {
      const res = await httpGet(`https://api.kraken.com/0/public/Ticker?pair=${KRAKEN_SYMBOLS[symbol]}`, timeoutMs);
      if (res.ok !== true) return { ok: false, message: res.message };
      const key = Object.keys(res.data?.result ?? {})[0];
      const t = res.data?.result?.[key] ?? {};
      const lastPrice = Number(t.c?.[0]);
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) return { ok: false, message: "invalid ticker" };
      const open = Number(t.o);
      const change = open > 0 ? ((lastPrice - open) / open) * 100 : null;
      return { ok: true, lastPrice, change24hPct: change };
    }
    return { ok: false, message: `unsupported provider ${provider}` };
  }

  /** Candles normalizados de uma exchange REAL (failover automatico; nunca sintetico/OTC). */
  async getCandles(symbol, interval, limit = 200) {
    const symbolOk = String(symbol).toUpperCase();
    const intervalOk = String(interval).toLowerCase();
    const lim = Math.min(500, Math.max(50, Number(limit) || 200));
    if (!CRYPTO_INTERVALS.includes(intervalOk)) return { ok: false, message: `unsupported interval ${intervalOk}` };
    for (const provider of this.order) {
      const res = await this.#candlesByProvider(provider, symbolOk, intervalOk, lim);
      if (res.ok === true && res.candles.length >= 50) {
        this.#noteOk(provider);
        return { ok: true, provider, symbol: symbolOk, interval: intervalOk, candles: res.candles };
      }
      this.#noteFail(provider, res?.message ?? "EMPTY");
    }
    return { ok: false, message: "ALL_PROVIDERS_FAILED", status: this.lastError };
  }

  /** Ticker 24h (preco atual + variacao) da exchange real (failover automatico). */
  async getTicker(symbol) {
    const symbolOk = String(symbol).toUpperCase();
    for (const provider of this.order) {
      const res = await this.#tickerByProvider(provider, symbolOk);
      if (res.ok === true) {
        this.#noteOk(provider);
        return { ok: true, provider, symbol: symbolOk, lastPrice: res.lastPrice, change24hPct: res.change24hPct };
      }
      this.#noteFail(provider, res?.message ?? "EMPTY");
    }
    return { ok: false, message: "ALL_PROVIDERS_FAILED" };
  }

  #noteOk(provider) {
    this.healthy = true;
    this.lastOkAt = this.now();
    this.lastError = null;
    this.activeProvider = provider;
    this.checkedAt = this.now();
  }

  #noteFail(provider, message) {
    this.checkedAt = this.now();
    this.healthy = false;
    this.lastError = `${provider}: ${message}`;
  }

  status() {
    return { providers: this.order, activeProvider: this.activeProvider, healthy: this.healthy, lastOkAt: this.lastOkAt, lastError: this.lastError, checkedAt: this.checkedAt, realMarket: true, otc: false };
  }
}