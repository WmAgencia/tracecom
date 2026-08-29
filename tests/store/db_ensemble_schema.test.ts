import { describe, it, expect, beforeEach } from "vitest";
import { Datastore } from "../../src/store/db";

describe("Datastore ensemble schema", () => {
  let ds: Datastore;
  beforeEach(() => { ds = new Datastore({ path: ":memory:" }); });

  it("cria tabela ensemble_weights com PK=1", () => {
    ds.db.exec("INSERT INTO ensemble_weights (id, weights_json, baseline_brier_json, trained_at, sample_size, holdout_brier) VALUES (1, '{\"technical\":0.5}', '{\"technical\":0.2}', 1000, 100, 0.21)");
    const row = ds.db.prepare("SELECT weights_json FROM ensemble_weights WHERE id=1").get();
    expect(row).toEqual({ weights_json: '{"technical":0.5}' });
  });

  it("cria tabela retrain_history com autoincrement", () => {
    ds.db.exec("INSERT INTO retrain_history (trained_at, trigger, weights_json, holdout_brier, deployed) VALUES (1, 'auto_24h', '{}', 0.20, 1)");
    ds.db.exec("INSERT INTO retrain_history (trained_at, trigger, weights_json, holdout_brier, deployed) VALUES (2, 'auto_100trades', '{}', 0.19, 1)");
    const rows = ds.db.prepare("SELECT COUNT(*) as n FROM retrain_history").get() as { n: number };
    expect(rows.n).toBe(2);
  });

  it("cria tabela model_daily_metrics com PK composta", () => {
    ds.db.exec("INSERT INTO model_daily_metrics (date, model, brier, win_rate, n_trades) VALUES ('2026-08-29', 'technical', 0.21, 0.55, 50)");
    ds.db.exec("INSERT INTO model_daily_metrics (date, model, brier, win_rate, n_trades) VALUES ('2026-08-29', 'microstructure', 0.19, 0.58, 48)");
    const rows = ds.db.prepare("SELECT COUNT(*) as n FROM model_daily_metrics").get() as { n: number };
    expect(rows.n).toBe(2);
  });

  it("cria tabela drift_alerts", () => {
    ds.db.exec("INSERT INTO drift_alerts (detected_at, model, severity, action_taken, details_json) VALUES (1000, 'ensemble', 'mild', 'alert', '{}')");
    const row = ds.db.prepare("SELECT model, severity FROM drift_alerts WHERE detected_at=1000").get() as { model: string; severity: string };
    expect(row).toEqual({ model: "ensemble", severity: "mild" });
  });
});
