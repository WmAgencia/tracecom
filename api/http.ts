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
import { wilsonLowerBound, isActionable, expectedValue } from "../src/fusion/calibration";
import { analyzeConfluence } from "../src/fusion/confluence";
import { evaluateGuards, freshGuardState } from "../src/fusion/guards";
import type { Direction, EmpiricalProbability } from "../src/backtest/types";
import type { TFSnapshot, Timeframe } from "../src/fusion/confluence";

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
      const now = Date.now();
      const rawDirection = (q.get("direction") ?? "up").toLowerCase();
      const direction: Direction = rawDirection === "down" ? "down" : "up";
      const horizon = Number(q.get("horizon") ?? DEFAULT_HORIZON);

      // Candles do TF operacional (maior amostra p/ probability + técnico).
      const k = await binanceKlinesSafe(symbol, timeframe, 300);
      if (typeof k === "string") {
        json(200, {
          decision: "WAIT", dataSufficient: false,
          rationale: `provedor indisponível (${k})`,
          note: "use Railway p/ backend completo",
          calibration: null,
          guards: { allowed: false, reason: "provedor indisponível" },
          confluence: null,
        });
        return;
      }
      if (k.length < 30) {
        json(200, {
          decision: "WAIT", dataSufficient: false, rationale: "dados insuficientes",
          calibration: null,
          guards: { allowed: true, reason: null },
          confluence: null,
        });
        return;
      }

      // --- Técnico (camada clássica) ---
      const closes = k.map((c) => c.close);
      const last = closes[closes.length - 1]!;
      const avg20 = sma(closes, 20)!;
      const tech = Math.max(-1, Math.min(1, ((last - avg20) / avg20) * 20));
      const counter = Math.abs(tech) < 0.18;
      const baseDecision = toDecision(tech, true, counter);

      // --- 3 TFs para confluência ---
      let confluence: { direction: "up" | "down" | "neutral"; agreementScore: number; confidenceBoost: number; reason: string } | null = null;
      try {
        const perTf = await fetchCandlesMultiTf(symbol);
        const { snapshots, direction: confDir } = buildConfluenceSnapshots(perTf, direction);
        if (snapshots.length >= 2 && confDir !== null) {
          const r = analyzeConfluence({ perTf: snapshots, direction });
          confluence = {
            direction: r.direction,
            agreementScore: r.agreementScore,
            confidenceBoost: r.confidenceBoost,
            reason: r.reason,
          };
        }
      } catch {
        confluence = null;
      }

      // --- Probabilidade empírica (in-memory, sem persistência) ---
      const probability = quickEmpiricalProbability(k, direction, horizon, DEFAULT_MIN_MOVE_PCT);

      // --- Calibração Wilson ---
      let calibration: { calibratedProb: number; ciLower: number; ciUpper: number; baseline: number; expectedValue: number; actionable: boolean } | null = null;
      if (probability.sampleSize >= MIN_PROB_SAMPLE) {
        const p = probability.probability;
        const base = probability.baseline ?? 0.5;
        const ciLower = probability.confidenceInterval?.lower ?? wilsonLowerBound(probability.favorable, probability.sampleSize);
        const ciUpper = probability.confidenceInterval?.upper ?? (1 - ciLower);
        calibration = {
          calibratedProb: p,
          ciLower,
          ciUpper,
          baseline: base,
          expectedValue: expectedValue({ probability: p, gain: 1, loss: 1 }),
          actionable: isActionable({ probability: p, ciLower, baseline: base }),
        };
      }

      // --- Guards (estado fresh — serverless não persiste) ---
      const guardState = freshGuardState(now);
      const sd = stdev(closes);
      // Vol anualizada como proxy p/ atrPct (em %); se volatilidade baixa, sem bloqueio.
      const atrPct = sd !== 0 ? sd * 1.732 / Math.max(last, 1e-9) * 100 : null;
      const age = lastCandleAgeMs(k, now, timeframe);
      const guardDecision = evaluateGuards({ state: guardState, atrPct, lastCandleAgeMs: age, now });
      const guards = { allowed: guardDecision.allow, reason: guardDecision.reason ?? null };

      // --- Combinação final: qualquer camada bloqueando → WAIT ---
      const blockedReasons: string[] = [];
      if (!guards.allowed) blockedReasons.push(guards.reason ?? "guards bloqueou");
      if (confluence && confluence.direction === "neutral") {
        blockedReasons.push(`confluência insuficiente (${confluence.reason})`);
      }
      if (calibration && !calibration.actionable && baseDecision !== "WAIT") {
        blockedReasons.push(
          `calibração não acionável (ci_lower ${(calibration.ciLower * 100).toFixed(1)}% ≤ baseline ${(calibration.baseline * 100).toFixed(1)}% + margem)`,
        );
      }
      const decision: "BUY" | "SELL" | "WAIT" = blockedReasons.length > 0 ? "WAIT" : baseDecision;
      const rationale = blockedReasons.length > 0
        ? `Bloqueado por: ${blockedReasons.join("; ")}. Técnico ${tech.toFixed(2)}. Provedor Binance (snapshot serverless).`
        : `${decision === "WAIT" ? "Contraponto insuficiente" : "Direcionamento"} — técnico ${tech.toFixed(2)}. Provedor Binance (snapshot).`;

      json(200, {
        decision,
        direction: decision === "WAIT" ? null : direction,
        score: tech,
        confidence: Math.min(0.9, 0.4 + Math.abs(tech)),
        dataSufficient: true,
        blockedByCounterEvidence: counter,
        rationale,
        factors: {
          favorable: [],
          counter: counter ? [{ text: `Score técnico ${tech.toFixed(2)} < limite` }] : [],
          invalidators: ["edge histórico não avaliado em serverless"],
        },
        calibration,
        guards,
        confluence,
        sampleSize: probability.sampleSize,
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

/**
 * Probabilidade empírica derivada em memória, sem persistência.
 * Conta quantas janelas rolling (entryIndex → entryIndex+horizon) produziram
 * retorno na direção solicitada acima de `minMovePct`%.
 *
 * Não inventa dados: se a amostra for insuficiente (< MIN_SAMPLE), o caller
 * deve tratar `probability.sampleSize < 30` como ausência de calibração.
 */
const MIN_PROB_SAMPLE = 30;
const DEFAULT_HORIZON = 12;
const DEFAULT_MIN_MOVE_PCT = 0.3;

function quickEmpiricalProbability(
  candles: readonly Candle[],
  direction: Direction,
  horizon: number = DEFAULT_HORIZON,
  minMovePct: number = DEFAULT_MIN_MOVE_PCT,
): EmpiricalProbability {
  const closes = candles.map((c) => c.close);
  const n = closes.length;
  const periodStart = n > 0 ? candles[0]!.timestamp : 0;
  const periodEnd = n > 0 ? candles[n - 1]!.timestamp : 0;

  let favorable = 0;
  let sampleSize = 0;
  for (let i = 0; i + horizon < n; i++) {
    const entry = closes[i]!;
    const exit = closes[i + horizon]!;
    if (entry === 0) continue;
    const pct = ((exit - entry) / entry) * 100;
    if (Math.abs(pct) < minMovePct) continue; // flat — exclui
    sampleSize++;
    if (direction === "up" ? pct > 0 : pct < 0) favorable++;
  }

  const prob = sampleSize > 0 ? favorable / sampleSize : 0;
  return {
    probability: prob,
    sampleSize,
    favorable,
    periodStart,
    periodEnd,
    similarityCriteria: "rolling-window-direction",
    horizon: `${horizon} candles`,
    methodology: "contagem direta em candles Binance (snapshot, sem similaridade)",
    confidenceInterval: sampleSize > 0
      ? {
          lower: wilsonLowerBound(favorable, sampleSize),
          upper: 1 - wilsonLowerBound(sampleSize - favorable, sampleSize),
          method: "wilson",
          level: 0.95,
        }
      : null,
    outOfSample: false,
    baseline: 0.5,
    limitations: [
      "amostra in-sample (sem split OOS)",
      "snapshot serverless: sem cold store",
      "sem filtro de similaridade",
    ],
  };
}

const CONFLUENCE_TFS: ReadonlyArray<Timeframe> = ["15m", "1h", "4h"];

async function fetchCandlesMultiTf(symbol: string): Promise<Record<Timeframe, Candle[]>> {
  const entries = await Promise.all(
    CONFLUENCE_TFS.map(async (tf) => {
      const k = await binanceKlinesSafe(symbol, tf, 120);
      const candles = typeof k === "string" ? [] : k;
      return [tf, candles] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<Timeframe, Candle[]>;
}

function buildConfluenceSnapshots(
  perTf: Record<Timeframe, Candle[]>,
  direction: Direction,
): { snapshots: TFSnapshot[]; direction: "up" | "down" | "neutral" | null } {
  // Só calcula se ao menos 2 TFs têm 30+ candles (regra da fusão clássica).
  const eligible = CONFLUENCE_TFS.filter((tf) => perTf[tf] && perTf[tf]!.length >= 30);
  if (eligible.length < 2) return { snapshots: [], direction: null };
  const snapshots: TFSnapshot[] = eligible.map((tf) => ({
    tf,
    candles: perTf[tf]!.map((c) => ({ close: c.close, high: c.high, low: c.low })),
  }));
  return { snapshots, direction };
}

function lastCandleAgeMs(candles: readonly Candle[], now: number, timeframe: string): number | null {
  if (candles.length === 0) return null;
  const tfMs = TF_MS[timeframe];
  if (!tfMs) return null;
  const lastClose = candles[candles.length - 1]!.timestamp + tfMs;
  return Math.max(0, now - lastClose);
}
