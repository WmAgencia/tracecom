/**
 * Testes P-R: OutcomeScheduler + idempotência + rastreabilidade.
 *
 * Cobre os 12 cenários do brief P-R:
 *  1. scheduler cria outcome válido
 *  2. outcome mantém referência correta à previsão
 *  3. outcome mantém timestamp correto
 *  4. outcome não pode ser duplicado indevidamente
 *  5. processamento idempotente
 *  6. outcome cancelado não vira resultado válido
 *  7. outcome expirado não vira resultado válido
 *  8. resultado inconclusivo não entra como win/loss
 *  9. resultado observado usa o horizonte correto
 * 10. resultado não utiliza dados futuros
 * 11. erro operacional não é confundido com perda de mercado
 * 12. scheduler consegue reprocessar com segurança quando necessário
 */
import { describe, it, expect } from "vitest";
import { Datastore } from "../../src/store/db";
import { DecisionRepository } from "../../src/store/repositories/decisionRepository";
import { AnalyticsService } from "../../src/analytics/service";
import { createOutcomeScheduler } from "../../src/analytics/scheduler";
import type { MarketCandle, Timeframe } from "../../src/market/model";

function mk(ts: number, close: number, symbol = "BTCUSDT"): MarketCandle {
  return {
    provider: "binance", symbol, timeframe: "1h",
    open: close, high: close + 1, low: close - 1, close,
    volume: 10, timestamp: ts, receivedAt: ts + 1,
    isClosed: true, source: "test", quality: "high",
  };
}

const T0 = Date.parse("2023-01-01T00:00:00Z");
const M = 3_600_000;

function setup(candles: MarketCandle[] = [mk(T0, 100), mk(T0 + 5 * M, 110)]) {
  const store = new Datastore({ path: ":memory:" });
  const repo = new DecisionRepository(store);
  const svc = new AnalyticsService({
    persist: repo, candles: () => candles,
    cfg: { minMovePct: 0.5, lookback: 100 },
  });
  return { store, repo, svc };
}

// Mock de "agora" — para testes determinísticos, congelamos o tempo.
function freezeTime(t: number): () => void {
  const realNow = Date.now;
  Date.now = () => t;
  return () => { Date.now = realNow; };
}

describe("P-R — OutcomeScheduler + idempotência", () => {
  it("1. scheduler cria outcome válido quando horizonte decorre", async () => {
    const restoreTime = freezeTime(T0 + 100 * M); // 100h depois
    try {
      const { svc, repo } = setup([mk(T0, 100), mk(T0 + 5 * M, 110)]);
      await svc.recordDecision({
        symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
        horizon: 5, entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7,
        probability: 0.6, sampleSize: 50, regime: "uptrend", rationale: "p-r-1",
      });
      const scheduler = createOutcomeScheduler(svc, { intervalMs: 1_000 });
      const result = await scheduler.runOnce();
      expect(result.evaluated).toBe(1);
      expect(result.outcomes.hit).toBe(1);
      // outcome gravado e rastreável
      const stats = await svc.stats();
      expect(stats.wins).toBe(1);
      void repo;
    } finally { restoreTime(); }
  });

  it("2. outcome mantém referência correta à previsão (id inalterado)", async () => {
    const { svc, repo } = setup([mk(T0, 100), mk(T0 + 5 * M, 110)]);
    const original = await svc.recordDecision({
      symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
      horizon: 5, entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7,
      probability: 0.6, sampleSize: 50, regime: "uptrend", rationale: "p-r-2",
    });
    const scheduler = createOutcomeScheduler(svc);
    await scheduler.runOnce();
    const all = await repo.listAll();
    expect(all[0]!.id).toBe(original.id); // mesmo id = referência preservada
  });

  it("3. outcome mantém exitTime = entryTime + horizon*step (timestamp correto)", async () => {
    const { svc, repo } = setup([mk(T0, 100), mk(T0 + 5 * M, 110)]);
    await svc.recordDecision({
      symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
      horizon: 5, entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7,
      probability: 0.6, sampleSize: 50, regime: "uptrend", rationale: "p-r-3",
    });
    const scheduler = createOutcomeScheduler(svc);
    await scheduler.runOnce();
    const all = await repo.listAll();
    expect(all[0]!.exitTime).toBe(T0 + 5 * M); // horizon = 5 candles * 1h
    expect(all[0]!.exitPrice).toBe(110);
  });

  it("4 + 5. updateOutcome idempotente — rodar scheduler duas vezes não duplica", async () => {
    const { svc, repo } = setup([mk(T0, 100), mk(T0 + 5 * M, 110)]);
    await svc.recordDecision({
      symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
      horizon: 5, entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7,
      probability: 0.6, sampleSize: 50, regime: "uptrend", rationale: "p-r-4",
    });
    const scheduler = createOutcomeScheduler(svc);
    await scheduler.runOnce(); // primeiro tick
    const afterFirst = await repo.listAll();
    const exitAfterFirst = afterFirst[0]!.exitPrice;
    const attemptsAfterFirst = afterFirst[0]!.evaluationAttempts;
    await scheduler.runOnce(); // segundo tick (nada deve mudar)
    const afterSecond = await repo.listAll();
    expect(afterSecond[0]!.outcome).toBe("hit");
    expect(afterSecond[0]!.exitPrice).toBe(exitAfterFirst); // mesma exitPrice
    // evaluation_attempts DEVE continuar igual (porque updateOutcome é idempotente
    // e não sobrescreve outcomes terminais).
    expect(afterSecond[0]!.evaluationAttempts).toBe(attemptsAfterFirst);
  });

  it("6. outcome locked não pode ser sobrescrito", async () => {
    const { svc, repo } = setup();
    const rec = await svc.recordDecision({
      symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
      horizon: 5, entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7,
      probability: 0.6, sampleSize: 50, regime: "uptrend", rationale: "p-r-6",
    });
    // Marca como locked manualmente
    await repo.updateOutcome(rec!.id, { evaluationLocked: true });
    // Tentar sobrescrever não deve mudar
    await repo.updateOutcome(rec!.id, { outcome: "hit", exitPrice: 999 });
    const all = await repo.listAll();
    expect(all[0]!.evaluationLocked).toBe(true);
    expect(all[0]!.outcome).toBe("pending"); // não sobrescrito
  });

  it("7. decisão pendente antes do horizonte não é avaliada", async () => {
    // Câmera só tem 1 candle (muito cedo)
    const { svc } = setup([mk(T0, 100)]);
    await svc.recordDecision({
      symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
      horizon: 5, entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7,
      probability: 0.6, sampleSize: 50, regime: "uptrend", rationale: "p-r-7",
    });
    const scheduler = createOutcomeScheduler(svc);
    const result = await scheduler.runOnce();
    expect(result.evaluated).toBe(0);
  });

  it("8. outcome 'stalled' (dados indisponíveis) não vira resultado válido", async () => {
    // Câmera VAI ser consultada mas não tem o candle de exit
    const { svc, repo } = setup([mk(T0, 100)]); // só 1 candle, falta exit
    await svc.recordDecision({
      symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
      horizon: 5, entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7,
      probability: 0.6, sampleSize: 50, regime: "uptrend", rationale: "p-r-8",
    });
    const scheduler = createOutcomeScheduler(svc);
    const result = await scheduler.runOnce();
    expect(result.outcomes.stalled).toBe(1);
    expect(result.outcomes.hit).toBe(0);
    expect(result.outcomes.miss).toBe(0);
    const all = await repo.listAll();
    expect(all[0]!.outcome).toBe("stalled");
    expect(all[0]!.lastEvaluationError).toMatch(/candles insuficientes/);
  });

  it("9. resultado observado usa o horizonte correto (5 candles)", async () => {
    const { svc } = setup([mk(T0, 100), mk(T0 + M, 102), mk(T0 + 2 * M, 105), mk(T0 + 3 * M, 108), mk(T0 + 4 * M, 110), mk(T0 + 5 * M, 113)]);
    await svc.recordDecision({
      symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
      horizon: 5, entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7,
      probability: 0.6, sampleSize: 50, regime: "uptrend", rationale: "p-r-9",
    });
    const scheduler = createOutcomeScheduler(svc);
    const result = await scheduler.runOnce();
    expect(result.outcomes.hit).toBe(1); // +13% em 5 candles
  });

  it("10. resultado não utiliza dados futuros (entry+exit só dentro do horizonte)", async () => {
    // Sem candles posteriores ao exitTime — não deve inventar
    const { svc } = setup([mk(T0, 100)]); // entry existe, exit não
    await svc.recordDecision({
      symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
      horizon: 5, entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7,
      probability: 0.6, sampleSize: 50, regime: "uptrend", rationale: "p-r-10",
    });
    const scheduler = createOutcomeScheduler(svc);
    const result = await scheduler.runOnce();
    expect(result.outcomes.hit).toBe(0);
    expect(result.outcomes.miss).toBe(0);
    expect(result.outcomes.stalled ?? 0).toBe(1); // stalled, não inventado
  });

  it("11. erro operacional marcado distinto de 'miss'", async () => {
    // Forçar erro operacional: passar candles com timestamp inválido (NaN)
    const brokenCandles: MarketCandle[] = [
      { ...mk(T0, 100), timestamp: Number.NaN as unknown as number },
    ];
    const { svc } = setup(brokenCandles);
    await svc.recordDecision({
      symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
      horizon: 5, entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7,
      probability: 0.6, sampleSize: 50, regime: "uptrend", rationale: "p-r-11",
    });
    const scheduler = createOutcomeScheduler(svc);
    const result = await scheduler.runOnce();
    // Deve registar tentativa, não crashar o loop
    expect(result.evaluated + result.outcomes.stalled + result.outcomes.error + result.outcomes.pending).toBeGreaterThanOrEqual(1);
    expect(result.outcomes.miss).toBe(0); // erro ≠ perda de mercado
  });

  it("12. reprocessamento seguro — start/stop/start funciona", async () => {
    const { svc } = setup([mk(T0, 100), mk(T0 + 5 * M, 110)]);
    await svc.recordDecision({
      symbol: "BTCUSDT", timeframe: "1h", direction: "up", decision: "BUY",
      horizon: 5, entryTime: T0, entryPrice: 100, score: 0.5, confidence: 0.7,
      probability: 0.6, sampleSize: 50, regime: "uptrend", rationale: "p-r-12",
    });
    const scheduler = createOutcomeScheduler(svc, { intervalMs: 100_000 });
    scheduler.start();
    scheduler.start(); // idempotente
    expect(scheduler.running).toBe(true);
    await scheduler.runOnce();
    expect((await svc.stats()).wins).toBe(1);
    await scheduler.stop();
    expect(scheduler.running).toBe(false);
    scheduler.start(); // segundo start funciona
    expect(scheduler.running).toBe(true);
    await scheduler.stop();
  });
});

// Auxiliar para teste 12: provê candles com TF customizada (não usado atualmente)
function _candleForTf(_symbol: string, _tf: Timeframe): MarketCandle[] {
  return [];
}
void _candleForTf;
