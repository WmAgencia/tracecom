import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

async function resolver() {
  const source = await readFile(new URL("../../extension/asset-resolver.js", import.meta.url), "utf8");
  const context: { TraceConAssetResolver?: any } = {};
  runInNewContext(source, context);
  if (!context.TraceConAssetResolver) throw new Error("asset resolver did not initialize");
  return context.TraceConAssetResolver;
}

describe("IQ Option strict asset resolver", () => {
  it("never turns the platform title into a fake OPT-ION asset", async () => {
    const assets = await resolver();
    expect(assets.parse("IQ Option")).toBeNull();
    expect(assets.parse("OPTION")).toBeNull();
    expect(assets.resolveVisible({ body: { innerText: "" }, title: "IQ Option", querySelector: () => null })).toBeNull();
  });

  it("normalizes visible forex and OTC instruments only when both codes are real currencies", async () => {
    const assets = await resolver();
    expect(assets.parse("EUR/USD")).toMatchObject({ symbol: "EURUSD", displaySymbol: "EUR/USD", domain: "IQ_OPTION_FOREX" });
    expect(assets.parse("EUR/USD OTC")).toMatchObject({ symbol: "EURUSD-OTC", displaySymbol: "EUR/USD OTC", domain: "IQ_OPTION_OTC" });
    expect(assets.parse("OPT/ION")).toBeNull();
  });

  it("detects an asset or domain switch as a mismatch instead of allowing price reuse", async () => {
    const assets = await resolver();
    const forex = assets.parse("EUR/USD");
    const otc = assets.parse("EUR/USD OTC");
    const gbp = assets.parse("GBP/USD");
    expect(assets.same(forex, otc)).toBe(false);
    expect(assets.same(forex, gbp)).toBe(false);
    expect(assets.same(forex, assets.parse("EURUSD"))).toBe(true);
  });
});
