import { describe, expect, it } from "vitest";
import { Datastore } from "../../src/store/db";
import { AdaptiveRepository } from "../../src/store/repositories/adaptiveRepository";

describe("AdaptiveRepository multi-key", () => {
  it("preserva snapshots independentes por símbolo/timeframe/regime", () => {
    const store = new Datastore({ path: ":memory:" });
    const repo = new AdaptiveRepository(store);
    repo.upsertEnsembleWeights({
      key: "EUR/USD|1m|trend", A: 1.1, B: 0.1, status: "PROVISIONAL",
      nSamples: 40, ece: 0.12, updatedAt: 100, holdoutBrier: 0.21,
    });
    repo.upsertEnsembleWeights({
      key: "USD/JPY|1h|range", A: 0.9, B: -0.1, status: "CALIBRATED",
      nSamples: 140, ece: 0.07, updatedAt: 200, holdoutBrier: 0.18,
    });

    expect(repo.getEnsembleWeights("EUR/USD|1m|trend")).toMatchObject({
      key: "EUR/USD|1m|trend", A: 1.1, nSamples: 40, holdoutBrier: 0.21,
    });
    expect(repo.getEnsembleWeights("USD/JPY|1h|range")).toMatchObject({
      key: "USD/JPY|1h|range", B: -0.1, nSamples: 140, holdoutBrier: 0.18,
    });
    expect(repo.getEnsembleWeights()).toMatchObject({ key: "USD/JPY|1h|range" });
  });
});
