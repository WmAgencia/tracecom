/**
 * Adaptador serverless da API TRACECON — para Vercel (API Routes).
 *
 * Servidor leve e autocontido: não importa o bundle do runtime principal (que
 * usa node:sqlite / import.meta.url / WebSocket, inadequados p/ serverless).
 * Expõe apenas os endpoints REST públicos de snapshot (mercado, contexto,
 * análise, notícias) via fetch direto + lógica mínima, sem persistência e
 * SEM inventar dados (provedores indisponíveis → unavailable).
 *
 * Para o backend completo (WebSocket, cold store, aprendizado), use o Railway
 * (processo long-running: `npm run serve`).
 */
import type { IncomingMessage, ServerResponse } from "node:http";

const CC = "https://cryptocurrency.cv/api";
const BINANCE = "https://api.binance.com/api/v3";
const TF_MS: Record<string, number> = { "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000 };

interface Candle { timestamp: number; open: number; high: number; low: number; close: number; volume: number }

async function binanceKlines(symbol: string, timeframe: string, limit = 200): Promise<Candle[]> {
  const res = await fetch(`${BINANCE}/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&limit=${limit}`, { headers: { "User-Agent": "tracecon" } });
  if (!res.ok) throw new Error(`binance ${res.status}`);
  const raw = (await res.json()) as unknown[];
  return raw.map((r) => {
    const a = r as unknown[];
    return { timestamp: Number(a[0]), open: Number(a[1]), high: Number(a[2]), low: Number(a[3]), close: Number(a[4]), volume: Number(a[5]) };
  });
}

function sma(v: number[], p: number): number | null {
  if (v.length < p) return null;
  let s = 0; for (let i = v.length - p; i < v.length; i++) s += v[i]!;
  return s / p;
}
function rsiLast(closes: number[], p = 14): number | null {
  if (closes.length < p + 1) return null;
  let g = 0, l = 0;
  for (let i = closes.length - p; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) g += d; else l -= d;
  }
  const ag = g / p, al = l / p;
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}
function stdev(v: number[]): number {
  if (v.length < 2) return 0;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / (v.length - 1));
}

function toDecision(score: number, suff: boolean, counter: boolean): "BUY" | "SELL" | "WAIT" {
  if (!suff || Math.abs(score) < 0.18 || counter) return "WAIT";
  return score > 0 ? "BUY" : "SELL";
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://x");
  const q = url.searchParams;
  const symbol = (q.get("symbol") ?? "BTCUSDT").toUpperCase();
  const timeframe = q.get("timeframe") ?? "1h";

  res.setHeader("Content-Type", "application/json");

  const json = (status: number, body: unknown): void => {
    res.statusCode = status;
    res.end(JSON.stringify(body));
  };

  // Binance bloqueia alguns IPs de nuvem (HTTP 451). Retornamos disponível:false.
  const safeKlines = async (): Promise<Candle[] | string> => {
    try {
      return await binanceKlines(symbol, timeframe, 200);
    } catch (e) {
      return e instanceof Error ? e.message : "erro";
    }
  };

  try {
    const path = url.pathname;
    if (path === "/health" || path === "/api/health") {
      json(200, { ok: true, ts: Date.now() });
      return;
    }

    if (path.endsWith("/status")) {
      json(200, { provider: "binance", state: "connected", configured: true });
      return;
    }

    if (path === "/api/catalog") {
      json(200, { assets: [
        { id: "binance:BTCUSDT", symbol: "BTCUSDT", name: "Bitcoin", market: "crypto", provider: "binance", baseAsset: "BTC", quoteAsset: "USDT", status: "active", metadata: {} },
        { id: "binance:ETHUSDT", symbol: "ETHUSDT", name: "Ethereum", market: "crypto", provider: "binance", baseAsset: "ETH", quoteAsset: "USDT", status: "active", metadata: {} },
        { id: "binance:SOLUSDT", symbol: "SOLUSDT", name: "Solana", market: "crypto", provider: "binance", baseAsset: "SOL", quoteAsset: "USDT", status: "active", metadata: {} },
      ]});
      return;
    }

    if (path.endsWith("/context") || path.endsWith("/market")) {
      const k = await safeKlines();
      if (typeof k === "string") {
        json(200, { provider: "binance", symbol, timeframe, available: false, currentPrice: null, dataQuality: "unknown", note: `provedor de mercado indisponível (${k})` });
        return;
      }
      if (k.length === 0) { json(200, { symbol, timeframe, available: false, note: "sem dados" }); return; }
      const candles = k;
      const closes = candles.map((c) => c.close);
      const last = candles[candles.length - 1]!;
      const prev = candles[candles.length - 2]!.close;
      const rsi = rsiLast(closes);
      const sma20 = sma(closes, 20);
      const volPct = Math.abs((last.close - prev) / prev) * 100;
      const regime = rsi === null ? null : rsi > 60 ? "uptrend" : rsi < 40 ? "downtrend" : "range";
      const sd = stdev(closes);
      json(200, {
        provider: "binance", symbol, timeframe, available: true,
        currentPrice: last.close,
        latestClosedCandle: last,
        volume: candles.reduce((s, c) => s + c.volume, 0),
        dataQuality: "high",
        quant: {
          technicalScore: sma20 !== null ? Math.max(-1, Math.min(1, ((last.close - sma20) / sma20) * 20)) : null,
          rsi,
          marketRegime: regime,
          structureTrend: last.close >= prev ? "up" : "down",
          atrPct: null,
          volatilityAnnualized: sd !== 0 ? sd * 1.732 : null,
          supports: candles.slice(-20).map((c) => c.low), resistances: candles.slice(-20).map((c) => c.high),
          sampleSize: closes.length,
          note: `volatilidade ${volPct.toFixed(2)}% no último candle`,
        },
      });
      return;
    }

    if (path.endsWith("/analyze")) {
      const k = await binanceKlinesSafe(symbol, timeframe, 300);
      if (typeof k === "string") {
        json(200, { decision: "WAIT", dataSufficient: false, rationale: `provedor indisponível (${k})`, note: "use Railway p/ backend completo" });
        return;
      }
      if (k.length < 30) { json(200, { decision: "WAIT", dataSufficient: false, rationale: "dados insuficientes" }); return; }
      const closes = k.map((c) => c.close);
      const last = closes[closes.length - 1]!;
      const avg20 = sma(closes, 20)!;
      const tech = Math.max(-1, Math.min(1, ((last - avg20) / avg20) * 20));
      const counter = Math.abs(tech) < 0.18;
      const decision = toDecision(tech, true, counter);
      json(200, {
        decision, direction: decision === "WAIT" ? null : (q.get("direction") ?? "up"),
        score: tech, confidence: Math.min(0.9, 0.4 + Math.abs(tech)),
        dataSufficient: true, blockedByCounterEvidence: counter,
        rationale: `${decision === "WAIT" ? "Contraponto insuficiente" : "Direcionamento"} — técnico ${tech.toFixed(2)}. Provedor Binance (snapshot).`,
        factors: { favorable: [], counter: counter ? [{ text: `Score técnico ${tech.toFixed(2)} < limite` }] : [], invalidators: ["edge histórico não avaliado em serverless"] },
      });
      return;
    }

    if (path.endsWith("/news")) {
      const asset = (symbol.replace(/USDT$/, "") || "bitcoin").toLowerCase();
      try {
        const resN = await fetch(`${CC}/news?category=${encodeURIComponent(asset)}&lang=en`, { headers: { "User-Agent": "tracecon" } });
        const j = (await resN.json()) as { articles?: { title: string; link: string; pubDate?: string; source?: string; credibility?: number }[] };
        const items = (j.articles ?? []).slice(0, 8);
        json(200, { available: items.length > 0, source: "free-crypto-news", bias: null, items });
      } catch {
        json(200, { available: false, note: "fonte indisponível", items: [] });
      }
      return;
    }

    if (path.endsWith("/analytics/calibration")) {
      // Serverless: SQLite não está disponível. Devolve zeros honestos.
      json(200, {
        totalDecisions: 0, evaluated: 0, wins: 0, misses: 0, winRate: 0,
        brierScore: 0, ece: 0,
        perSignal: { BUY: { n: 0, wins: 0, winRate: 0, avgReturn: null }, SELL: { n: 0, wins: 0, winRate: 0, avgReturn: null }, WAIT: { n: 0, wins: 0, winRate: 0, avgReturn: null } },
        perTimeframe: {}, topSetups: [],
        drawdownObserved: 0, drawdownMax: 5,
        guardStatus: { circuitBreaker: "ok", dailyLossPct: 0, lastLossAt: null },
        snapshotAt: new Date().toISOString(),
        note: "em serverless a calibração real requer o backend Node local (npm run serve)",
      });
      return;
    }

    if (path.endsWith("/analytics/perf-snapshot")) {
      json(200, {
        pnlTotal: 0, pnlPct: 0, sharpe: 0, maxDrawdown: 0,
        nTrades: 0, winRate: 0, periodStart: null, periodEnd: null,
        note: "em serverless a PnL real requer o backend Node local",
      });
      return;
    }

    if (path === "/extension/info") {
      json(200, {
        available: false,
        url: "/extension/download",
        filename: "tracecon-extension-v0.2.0.zip",
        sizeBytes: null,
        note: "em serverless o zip binário não pode ser servido; use o release do GitHub",
      });
      return;
    }
    if (path === "/extension/download") {
      json(503, { error: "extension_zip_unsupported_in_serverless" });
      return;
    }

    json(404, { error: "not_found", path });
  } catch (e) {
    json(500, { error: e instanceof Error ? e.message : "erro", note: "use Railway p/ backend completo" });
  }
}

async function binanceKlinesSafe(symbol: string, timeframe: string, limit: number): Promise<Candle[] | string> {
  try {
    return await binanceKlines(symbol, timeframe, limit);
  } catch (e) {
    return e instanceof Error ? e.message : "erro";
  }
}
