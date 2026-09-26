import { describe, expect, it } from "vitest";
import { OtcBlackBoxLab, OTC_HORIZON_MS, temporalSplit } from "../../relay/otc-lab/index.mjs";

describe("OTC black-box lab", () => {
  it("is OTC-only, research-only and labels future observed prices", () => {
    const lab = new OtcBlackBoxLab({ enabled: true });
    expect(lab.observe({ marketKey: "EURUSD:NORMAL", at: 1, close: 1 })).toMatchObject({ accepted: false, reason: "OTC_ONLY" });
    expect(lab.observe({ marketKey: "EURUSD:OTC", at: 1_000, close: 1 })).toMatchObject({ accepted: true, execution: "NONE" });
    lab.observe({ marketKey: "EURUSD:OTC", at: 1_000 + OTC_HORIZON_MS, close: 1.01 });
    expect(lab.status()).toMatchObject({ isolated: true, realMoneyExecution: 0, labels: 1 });
  });

  it("uses chronological data with a horizon embargo", () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({ at: index * 300_000, close: 1 + index / 100 }));
    const split = temporalSplit(rows);
    expect(split.chronological).toBe(true);
    expect(split.embargoMs).toBe(OTC_HORIZON_MS);
    expect(split.train.at(-1)!.at).toBeLessThan(rows[12].at);
  });
});
