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
    expect(assets.parse("EUR/USD OTC")).toMatchObject({ symbol: "EURUSD-OTC", normalizedSymbol: "EURUSD", displaySymbol: "EUR/USD", domain: "IQ_OPTION_OTC", isOTC: true });
    expect(assets.parse("OPT/ION")).toBeNull();
  });

  it("finds the visible chart-header asset without scanning generic body text", async () => {
    const assets = await resolver();
    const header = { children: [], innerText: "EUR/USD (OTC)", getBoundingClientRect: () => ({ left: 150, top: 132, width: 90, height: 20 }) };
    const watchlist = { children: [], innerText: "GBP/USD", getBoundingClientRect: () => ({ left: 40, top: 40, width: 90, height: 20 }) };
    const doc = { title: "IQ Option", defaultView: { innerWidth: 1500, innerHeight: 700 }, querySelector: () => null, querySelectorAll: () => [watchlist, header] };
    expect(assets.resolveVisible(doc)).toMatchObject({ symbol: "EURUSD-OTC", normalizedSymbol: "EURUSD", displaySymbol: "EUR/USD", domain: "IQ_OPTION_OTC", source: "chart-header" });
  });

  it("uses only visible bid/ask nodes to calculate a UI price", async () => {
    const assets = await resolver();
    const ask = { children: [], innerText: "ask 1.160230", getBoundingClientRect: () => ({ left: 150, top: 580, width: 80, height: 12 }) };
    const bid = { children: [], innerText: "bid 1.160220", getBoundingClientRect: () => ({ left: 150, top: 600, width: 80, height: 12 }) };
    const unrelated = { children: [], innerText: "ask 9.99", getBoundingClientRect: () => ({ left: 2, top: 10, width: 80, height: 12 }) };
    const doc = { defaultView: { innerWidth: 1500, innerHeight: 700 }, querySelectorAll: () => [ask, bid, unrelated] };
    expect(assets.resolveUiPrice(doc)).toBeCloseTo(1.160225, 8);
  });

  it("returns only safe bounded chart-header diagnostics for valid forex candidates", async () => {
    const assets = await resolver();
    const candidate = { tagName: "SPAN", className: "instrument-name", innerText: "EUR/USD OTC", parentElement: { tagName: "DIV", className: "chart-header" }, getAttribute: (name: string) => name === "data-testid" ? "selected-asset" : null, getBoundingClientRect: () => ({ left: 150, top: 130, width: 90, height: 20 }) };
    const invalid = { tagName: "SPAN", className: "account-secret", innerText: "OPTION", parentElement: null, getAttribute: () => null, getBoundingClientRect: () => ({ left: 150, top: 130, width: 90, height: 20 }) };
    const doc = { defaultView: { innerWidth: 1500, innerHeight: 700 }, querySelectorAll: () => [candidate, invalid] };
    expect(assets.assetDebugCandidates(doc)).toEqual([expect.objectContaining({ text: "EUR/USD OTC", symbol: "EURUSD-OTC", normalizedSymbol: "EURUSD", dataTestId: "selected-asset", parent: { tag: "div", className: "chart-header" } })]);
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
