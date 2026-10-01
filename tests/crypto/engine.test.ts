/**
 * CRYPTO â€” position manager + engine (PAPER only) + isolamento Binary x Crypto.
 * Regras: stop estrutural/ATR; TP por R:R; tamanho por risco %; uma posicao por symbol;
 * trailing OFF por padrao; REAL execution sempre BLOCKED; metricas isoladas (CRYPTO_V1_EPOCH).
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const pmModule = await import("../../relay/crypto/position-manager.mjs");
// @ts-expect-error - relay ESM sem tipagem
const engineModule = await import("../../relay/crypto/engine.mjs");
const { CryptoPositionManager, positionSize, CRYPTO_V1_EPOCH } = pmModule as any;
const { CryptoEngine } = engineModule as any;

describe("CRYPTO position manager", () => {
  it("sizing por risco percentual: riskAmount = balance * pct% / distancia", () => {
    const sized = positionSize({ paperBalance: 1000, riskPct: 1, entry: 100, stop: 99 });
    expect(Number(sized.riskAmount)).toBeCloseTo(10, 2);
    expect(Number(sized.notional)).toBeCloseTo(1000, 2);
  });

  it("LONG aberto; stop atingido => posicao encerra com loss; TP atingido => win", () => {
    const pm = new CryptoPositionManager();
    const opened = pm.open({ symbol: "BTCUSDT", side: "LONG", entryPrice: 100, quantity: 1, notional: 100, stopLoss: 98, takeProfit: 104, riskAmount: 2, riskReward: 2 });
    expect(opened.ok).toBe(true);
    const stopEvents = pm.tick("BTCUSDT", 97.9);
    expect(stopEvents.length).toBe(1);
    expect(stopEvents[0].reason).toBe("STOP_LOSS");
    const opened2 = pm.open({ symbol: "BTCUSDT", side: "LONG", entryPrice: 100, quantity: 1, notional: 100, stopLoss: 98, takeProfit: 104, riskAmount: 2, riskReward: 2 });
    const tpEvents = pm.tick("BTCUSDT", 104.1);
    expect(tpEvents.length).toBe(1);
    expect(tpEvents[0].reason).toBe("TAKE_PROFIT");
    expect(tpEvents[0].pnl).toBeGreaterThan(0);
  });

  it("SHORT: stop acima e TP abaixo; encerra corretamente", () => {
    const pm = new CryptoPositionManager();
    pm.open({ symbol: "ETHUSDT", side: "SHORT", entryPrice: 200, quantity: 1, notional: 200, stopLoss: 204, takeProfit: 196, riskAmount: 4, riskReward: 1.5 });
    const stop = pm.tick("ETHUSDT", 204.2);
    expect(stop[0].reason).toBe("STOP_LOSS");
    pm.open({ symbol: "ETHUSDT", side: "SHORT", entryPrice: 200, quantity: 1, notional: 200, stopLoss: 204, takeProfit: 196, riskAmount: 4, riskReward: 1.5 });
    const tp = pm.tick("ETHUSDT", 195.8);
    expect(tp[0].reason).toBe("TAKE_PROFIT");
    expect(tp[0].pnl).toBeGreaterThan(0);
  });

  it("uma posicao por symbol (nunca dobra; sem martingale)", () => {
    const pm = new CryptoPositionManager();
    pm.open({ symbol: "SOLUSDT", side: "LONG", entryPrice: 50, quantity: 1, notional: 50, stopLoss: 49, takeProfit: 53, riskAmount: 1, riskReward: 2 });
    const second = pm.open({ symbol: "SOLUSDT", side: "LONG", entryPrice: 51, quantity: 1, notional: 51, stopLoss: 50, takeProfit: 54, riskAmount: 1, riskReward: 2 });
    expect(second.ok).toBe(false);
  });

  it("metricas isoladas: epoch CRYPTO_V1_EPOCH, zero contaminacao binaria", () => {
    const pm = new CryptoPositionManager();
    pm.open({ symbol: "BTCUSDT", side: "LONG", entryPrice: 100, quantity: 1, notional: 100, stopLoss: 98, takeProfit: 104, riskAmount: 2, riskReward: 2 });
    pm.tick("BTCUSDT", 104.1);
    const stats = pm.stats();
    expect(stats.epoch).toBe(CRYPTO_V1_EPOCH);
    expect(stats.trades).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.bySymbol.BTCUSDT.trades).toBe(1);
    expect(Object.keys(stats).some((k) => k.includes("payout") || k.includes("WIN/LOSS/DRAW"))).toBe(false);
  });
});

describe("CRYPTO engine (PAPER only, pipeline separado)", () => {
  const linear = (from: number, to: number, n: number) => { const out: number[] = []; for (let i = 0; i < n; i += 1) out.push(from + ((to - from) * i) / Math.max(1, n - 1)); return out; };
  const mk = (closes: number[]) => closes.map((c, i) => ({ at: 1_700_000_000_000 + i * 60_000, open: i === 0 ? c : closes[i - 1]!, high: Math.max(c, i === 0 ? c : closes[i - 1]!) * 1.001, low: Math.min(c, i === 0 ? c : closes[i - 1]!) * 0.999, close: c }));
  const nz = (arr: number[]) => arr.map((v, i) => v + Math.sin(i * 1.7) * 0.0002 * (1 + (i % 7 === 0 ? 1 : 0)));

  const fakeProvider = (series: any[]) => ({
    getCandles: async (symbol: string, interval: string) => {
      const scaled = series.map((c) => ({ ...c, at: c.at, open: c.open, high: c.high, low: c.low, close: c.close, volume: 100 }));
      const candles = interval === "1m" ? scaled.slice(-60) : scaled;
      return { ok: true, symbol, interval, candles };
    },
    getTicker: async (symbol: string) => ({ ok: true, symbol, lastPrice: series[series.length - 1].close, change24hPct: 1.2 }),
    status: () => ({ provider: "test", healthy: true, realMarket: true, otc: false }),
  });

  const makeEngine = async ({ consensusResult = "NO_TRADE", realExecution = "false", direction = "UP", pool = { query: async () => ({ rows: [], rowCount: 1 }) } as any } = {}) => {
    const up = linear(1.35, 1.36, 40);
    const pb = linear(up[up.length - 1]!, up[up.length - 1]! - 0.0015, 8);
    const rec = linear(pb[pb.length - 1]!, pb[pb.length - 1]! + 0.003, 14);
    const baseUp = [...up, ...pb.slice(1), ...rec.slice(1)];
    const baseDown = linear(1.36, 1.35, 40);
    const pbUp = linear(baseDown[baseDown.length - 1]!, baseDown[baseDown.length - 1]! + 0.0015, 8);
    const recDown = linear(pbUp[pbUp.length - 1]!, pbUp[pbUp.length - 1]! - 0.003, 14);
    const closes = direction === "UP" ? baseUp : [...baseDown, ...pbUp.slice(1), ...recDown.slice(1)];
    const candles = mk(nz(closes));
    const router = { choose: () => ({ provider: "test", model: "test-model" }), report: () => {} };
    const limiter = { run: async (opts: any) => ({ status: "OK", model: "test-model", provider: "test", text: JSON.stringify({ result: consensusResult, confidence: 0.7, thesis: "t", counterCase: "c", invalidation: "i" }), latencyMs: 3 }) };
    const runProvider = async () => ({ status: "OK", text: JSON.stringify({ result: consensusResult, confidence: 0.7, thesis: "t", counterCase: "c", invalidation: "i" }) });
    const engine = new CryptoEngine({ pool, log: () => {}, env: { CRYPTO_PAPER_EXECUTION: "true", CRYPTO_REAL_EXECUTION: realExecution, CRYPTO_SYMBOLS: ["BTCUSDT"], CRYPTO_PAPER_BALANCE: "1000", CRYPTO_RISK_PERCENT: "1", CRYPTO_MIN_RR: "1.5" }, router, limiter, runProvider, provider: fakeProvider(candles), now: () => 1_700_000_000_000 });
    await engine.analyzeSymbol("BTCUSDT");
    return engine;
  };

  it("LONG aprovado pelo consensus => posicao PAPER aberta (nunca real)", async () => {
    const engine = await makeEngine({ consensusResult: "LONG" });
    const market = engine.markets.get("BTCUSDT");
    expect(market.setup.candidate?.side).toBe("LONG");
    expect(market.consensus?.result).toBe("LONG");
    expect(market.position).toBeTruthy();
    expect(market.position.side).toBe("LONG");
    expect(engine.gate.paperOnly).toBe(true);
  });

  it("SHORT aprovado => posicao PAPER aberta", async () => {
    const engine = await makeEngine({ consensusResult: "SHORT", direction: "DOWN" });
    expect(engine.markets.get("BTCUSDT").position?.side).toBe("SHORT");
  });

  it("consensus NO_TRADE => zero posicao", async () => {
    const engine = await makeEngine({ consensusResult: "NO_TRADE" });
    expect(engine.markets.get("BTCUSDT").position).toBeNull();
    expect(engine.positions.stats().trades).toBe(0);
  });

  it("CRYPTO_REAL_EXECUTION=true => execucao BLOQUEADA (zero posicao)", async () => {
    const engine = await makeEngine({ consensusResult: "LONG", realExecution: "true" });
    expect(engine.gate.paperOnly).toBe(false);
    expect(engine.markets.get("BTCUSDT").position).toBeNull();
    expect(engine.positions.stats().trades).toBe(0);
  });

  it("stop atingido => posicao PAPER encerra e entra nas metricas isoladas", async () => {
    const engine = await makeEngine({ consensusResult: "LONG" });
    const position = engine.markets.get("BTCUSDT").position;
    expect(position).toBeTruthy();
    // preco cai abaixo do stop estrutural
    engine.tickers.set("BTCUSDT", { lastPrice: Number(position.stopLoss) - 1 });
    await engine.tickPositions();
    expect(engine.markets.get("BTCUSDT").position).toBeNull();
    expect(engine.positions.stats().trades).toBe(1);
    expect(engine.positions.stats().epoch).toBe(CRYPTO_V1_EPOCH);
  });

  it("isolamento: status do engine crypto NAO contem campos/contadores da Binary V3", async () => {
    const engine = await makeEngine({ consensusResult: "NO_TRADE" });
    const status = engine.status();
    expect(status.strategy).toBe("CRYPTO_REGIME_TREND_V1");
    expect(status.epoch).toBe(CRYPTO_V1_EPOCH);
    const json = JSON.stringify(status);
    expect(json).not.toContain("PULLBACK_4060");
    expect(json).not.toContain("APPROVE_BUY");
    expect(json).not.toContain("exactExpiration");
  });
});
