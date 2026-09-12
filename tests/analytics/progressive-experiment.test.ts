import { describe, expect, it } from "vitest";
import { compareRuns, mineA80Signatures, summarizeRun, type ShadowObservation } from "../../src/analytics/progressive-experiment";

const rows = (runId: string, signature: string, outcomes: readonly ("WIN" | "LOSS")[]): ShadowObservation[] => outcomes.map((outcome, i) => ({ signalId: `${runId}-${i}`, runId, decision: "BUY", outcome, signature, asset: "EURUSD", domain: "FOREX/OTC", regime: "TREND" }));

describe("progressive shadow experiment", () => {
  it("summarizes only evaluated outcomes and exposes wait rate", () => {
    const data: ShadowObservation[] = [...rows("RUN-A", "sig", ["WIN", "LOSS"]), { signalId: "wait", runId: "RUN-A", decision: "WAIT", outcome: "UNKNOWN", signature: null }];
    expect(summarizeRun("RUN-A", data)).toMatchObject({ evaluated: 2, wins: 1, losses: 1, waitRate: 1 / 3 });
  });

  it("does not promote tiny 4/5 samples and mines only supported >=80% signatures", () => {
    const data = rows("RUN-A", "strong", Array(8).fill("WIN").concat(["LOSS", "WIN"]) as ("WIN" | "LOSS")[]).concat(rows("RUN-A", "tiny", ["WIN", "WIN", "WIN", "WIN", "LOSS"]));
    const found = mineA80Signatures(data, { minimumSupport: 5 });
    expect(found.map((x) => x.signatureId)).toEqual(["strong"]);
    expect(found[0]).toMatchObject({ n: 10, wins: 9, evidence: "LOW_SAMPLE" });
  });

  it("compares frozen A candidates against new B observations", () => {
    const a = rows("RUN-A", "sig", ["WIN", "WIN", "LOSS", "WIN", "WIN", "WIN", "WIN", "WIN", "WIN", "WIN"]);
    const b = rows("RUN-B", "sig", Array(10).fill("WIN") as ("WIN" | "LOSS")[]);
    const candidate = mineA80Signatures(a, { minimumSupport: 10 });
    expect(compareRuns(a, b, candidate)[0]).toMatchObject({ runA: { n: 10, wins: 9 }, runB: { n: 10, wins: 10 }, promoted: true });
  });
});
