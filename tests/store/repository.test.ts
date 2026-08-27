import { describe, expect, it } from "vitest";
import { AnalysisBuilder, VERSION } from "../../src/analysis/model";
import { Datastore } from "../../src/store/db";
import { SqliteAnalysisRepository } from "../../src/store/repositories/sqliteAnalysisRepository";
import type { Analysis } from "../../src/domain/types";

function makeAnalysis(overrides: Partial<Analysis["decision"] & { symbol: string; tf: string }> = {}): Analysis {
  return new AnalysisBuilder({
    instrument: {
      symbol: overrides.symbol ?? "BTCUSDT",
      label: "BTC/USDT",
      kind: "spot",
      quote: "USDT",
      providerId: "binance",
    },
    timeframe: (overrides.tf ?? "1m") as Analysis["timeframe"],
    horizon: "5 candles",
    input: "teste",
    version: VERSION,
  })
    .addSource("get_candles")
    .build({
      decision: {
        direction: overrides.direction ?? "WAIT",
        rationale: overrides.rationale ?? "x",
      },
    });
}

describe("SqliteAnalysisRepository (in-memory)", () => {
  it("salva e recupera análise com roundtrip fiel", async () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new SqliteAnalysisRepository(store);
    const a = makeAnalysis({ direction: "BUY", rationale: "evidências", tf: "1h" });
    await repo.save(a);

    const loaded = await repo.findById(a.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(a.id);
    expect(loaded!.instrument.symbol).toBe("BTCUSDT");
    expect(loaded!.timeframe).toBe("1h");
    expect(loaded!.decision.direction).toBe("BUY");
    expect(loaded!.decision.rationale).toBe("evidências");
    expect(loaded!.favorableFactors).toEqual(a.favorableFactors);
    expect(loaded!.trail.toolCalls).toEqual(a.trail.toolCalls);
    await store.close();
  });

  it("lista com filtro por símbolo e timeframe", async () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new SqliteAnalysisRepository(store);
    await repo.save(makeAnalysis({ symbol: "BTCUSDT", tf: "1m" }));
    await repo.save(makeAnalysis({ symbol: "ETHUSDT", tf: "1h" }));
    await repo.save(makeAnalysis({ symbol: "BTCUSDT", tf: "1h" }));

    const btc = await repo.list({ symbol: "BTCUSDT" });
    expect(btc.length).toBe(2);
    const eth1h = await repo.list({ symbol: "ETHUSDT", timeframe: "1h" });
    expect(eth1h.length).toBe(1);
    await store.close();
  });

  it("conta e deleta", async () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new SqliteAnalysisRepository(store);
    await repo.save(makeAnalysis());
    expect(await repo.count()).toBe(1);
    const a2 = makeAnalysis();
    await repo.save(a2);
    expect(await repo.count()).toBe(2);
    const deleted = await repo.delete(a2.id);
    expect(deleted).toBe(true);
    expect(await repo.count()).toBe(1);
    await store.close();
  });
});
