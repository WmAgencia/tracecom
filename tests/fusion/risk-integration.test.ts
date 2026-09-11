/**
 * Risk integration tests — verifica que `FusionService.analyze()` popula o
 * campo `risk` (RiskScore) em todos os regimes de mercado.
 *
 * IMPORTANTE — divergência com o briefing original:
 *   O briefing dizia que `src/fusion/risk.ts` define uma classe `RiskEngine`
 *   com ZERO callers e propunha importá-la em `FusionService` via DI
 *   (`riskEngine` no construtor). Auditoria real mostrou que:
 *     1. `risk.ts` exporta uma FUNÇÃO `assessRisk(RiskInput): RiskScore`,
 *        não uma classe `RiskEngine`.
 *     2. `FusionService.analyze()` JÁ chama `assessRisk(...)` no passo 3
 *        (linha 138 de `service.ts`) e devolve `risk` no `FusionResult`.
 *     3. O tipo `RiskScore` mora em `src/fusion/types.ts`, não em `risk.ts`.
 *     4. `src/app/index.ts` não instancia `FusionService` — ele compõe
 *        AgentEngine + ToolRegistry, então não há local para injetar
 *        `riskEngine`.
 *   Portanto, a "integração" do RiskEngine já está feita. Este arquivo testa
 *   o comportamento da pontuação de risco populada em `FusionResult.risk`.
 */
import { describe, expect, it } from "vitest";
import { QuantEngine } from "../../src/quant/engine";
import { Backtester } from "../../src/backtest/backtest";
import { FusionService } from "../../src/fusion/service";
import type { CandleHistorySource, CandleHistoryQuery } from "../../src/backtest/types";
import type { MarketCandle, Timeframe } from "../../src/market/model";

// ---------------------------------------------------------------------------
// Geradores de candles sintéticos (espelham regression.test.ts)
// ---------------------------------------------------------------------------

function mkCandle(ts: number, close: number, opts?: { vol?: number }): MarketCandle {
  const vol = opts?.vol ?? 0.005;
  return {
    provider: "test",
    symbol: "BTCUSDT",
    timeframe: "1h",
    open: close * (1 - vol * 0.1),
    high: close * (1 + vol),
    low: close * (1 - vol),
    close,
    volume: 1000,
    timestamp: ts,
    receivedAt: ts + 1,
    isClosed: true,
    source: "test",
    quality: "high",
  };
}

/** Regime volátil: candles com variações grandes e aleatórias.
 *  ATR% alto, gera regime high_volatility. */
function volatileCandles(n: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  const start = Date.parse("2024-01-01T00:00:00Z");
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = (Math.sin(i * 0.7) + Math.cos(i * 1.3)) * 0.03;
    price = price * (1 + drift);
    out.push(mkCandle(start + i * 3_600_000, price, { vol: 0.05 }));
  }
  return out;
}

/** Range lateral apertado: preços oscilando ±1% em torno de 100. */
function rangeCandles(n: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  const start = Date.parse("2024-01-01T00:00:00Z");
  let price = 100;
  for (let i = 0; i < n; i++) {
    price = 100 + Math.sin(i / 3) * 1.0;
    out.push(mkCandle(start + i * 3_600_000, price));
  }
  return out;
}

/** Breakout bullish clássico (~80 candles com drift +0.8%). */
function breakoutBullishCandles(n: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  const start = Date.parse("2024-01-01T00:00:00Z");
  let price = 100;
  for (let i = 0; i < n; i++) {
    if (i < 20) {
      price = 100 + Math.sin(i / 2) * 0.5;
    } else {
      price = price * 1.008;
    }
    out.push(mkCandle(start + i * 3_600_000, price));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helper: monta FusionService mínimo com mock historySource
// ---------------------------------------------------------------------------

function makeService(candles: MarketCandle[]) {
  const historySource: CandleHistorySource = {
    async getCandles(_q: CandleHistoryQuery): Promise<MarketCandle[]> {
      return candles;
    },
  };
  const quant = new QuantEngine();
  const backtester = new Backtester();
  const tf: Timeframe = "1h";
  const currentCandles = (_s: string, _t: Timeframe) => candles;
  const svc = new FusionService({
    quant,
    backtester,
    historySource,
    currentCandles,
  });
  return svc;
}

// ---------------------------------------------------------------------------
// Testes de integração de risco
// ---------------------------------------------------------------------------

describe("Risk integration — RiskScore em FusionResult", () => {
  it("Caso 1: FusionService.analyze() SEM eventRisk popula risk sempre", async () => {
    // Não há construtor opcional "riskEngine" — assessRisk é chamado
    // internamente. Construção sem parâmetros extras continua funcionando
    // (compatibilidade retroativa).
    const candles = breakoutBullishCandles(80);
    const svc = makeService(candles);
    const r = await svc.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      horizon: 5,
    });
    expect(r.risk).toBeDefined();
    expect(r.risk).not.toBeNull();
    expect(typeof r.risk.score).toBe("number");
    expect(Array.isArray(r.risk.factors)).toBe(true);
    expect(typeof r.risk.unknown).toBe("boolean");
  });

  it("Caso 2: level é um de {low, medium, high}", async () => {
    const candles = breakoutBullishCandles(80);
    const svc = makeService(candles);
    const r = await svc.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      horizon: 5,
    });
    expect(["low", "medium", "high"]).toContain(r.risk.level);
  });

  it("Caso 3: volatilidade alta (ATR alto) → risk.level === 'high'", async () => {
    const candles = volatileCandles(80);
    const svc = makeService(candles);
    const r = await svc.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      horizon: 5,
    });
    expect(r.risk.level).toBe("high");
    // E o score agregado de risco deve estar no topo da escala
    expect(r.risk.score).toBeGreaterThanOrEqual(0.55);
  });

  it("Caso 4: risk.score ∈ [0, 1] em qualquer regime", async () => {
    for (const [name, gen] of [
      ["volatile", volatileCandles] as const,
      ["range", rangeCandles] as const,
      ["bullish", breakoutBullishCandles] as const,
    ]) {
      const candles = gen(80);
      const svc = makeService(candles);
      const r = await svc.analyze({
        symbol: "BTCUSDT",
        timeframe: "1h",
        direction: "up",
        horizon: 5,
      });
      expect(r.risk.score, `regime ${name}`).toBeGreaterThanOrEqual(0);
      expect(r.risk.score, `regime ${name}`).toBeLessThanOrEqual(1);
    }
  });

  it("Caso extra: eventRisk=true eleva o score de risco", async () => {
    const candles = rangeCandles(80); // regime calmo
    const svc = makeService(candles);
    const rBase = await svc.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      horizon: 5,
    });
    const rEvent = await svc.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      horizon: 5,
      context: { eventRisk: true },
    });
    // eventRisk adiciona 0.25 ao score — em regime calmo isso promove
    // o nível pelo menos uma faixa.
    expect(rEvent.risk.score).toBeGreaterThanOrEqual(rBase.risk.score);
    expect(rEvent.risk.factors.some((f) => /evento|macro/i.test(f))).toBe(true);
  });

  it("Caso extra: dados insuficientes (<30 candles) → risk ainda é calculado, mas pode marcar unknown", async () => {
    const candles = rangeCandles(15);
    const svc = makeService(candles);
    const r = await svc.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      direction: "up",
      horizon: 5,
    });
    // risk continua presente — assessRisk não depende do tamanho da amostra,
    // apenas dos campos derivados do summary do QuantEngine.
    expect(r.risk).toBeDefined();
    expect(r.risk.score).toBeGreaterThanOrEqual(0);
    expect(r.risk.score).toBeLessThanOrEqual(1);
    // Mas a decisão principal deve ser WAIT por dados insuficientes.
    expect(r.decision).toBe("WAIT");
  });
});
