/**
 * ALLOWLIST POSITIVA (fail-closed): somente NORMAL Binary suportado e operacional.
 * OTC / UNKNOWN / undefined / instrumento nao suportado => REJECT.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const universe = await import("../../relay/market-universe.mjs");
const { isSupportedNormalBinaryMarket, OPERATIONAL_UNIVERSE, OPERATIONAL_MAX_ACTIVE_MARKETS, OPERATIONAL_MARKET_KEYS, mcpCanonical, isOperationalMarketKey } = universe as any;

const normalCtx = { marketType: "NORMAL", enabled: true, paused: false, availability: "OPEN", activeId: 1861 };

describe("ALLOWLIST positiva de mercado (fail-closed)", () => {
  it("NORMAL Binary valido => accept", () => {
    expect(isSupportedNormalBinaryMarket(normalCtx)).toBe(true);
  });

  it("OTC => reject; UNKNOWN/undefined/outros => reject", () => {
    expect(isSupportedNormalBinaryMarket({ ...normalCtx, marketType: "OTC" })).toBe(false);
    expect(isSupportedNormalBinaryMarket({ ...normalCtx, marketType: "UNKNOWN" })).toBe(false);
    expect(isSupportedNormalBinaryMarket({ ...normalCtx, marketType: undefined })).toBe(false);
    expect(isSupportedNormalBinaryMarket({ ...normalCtx, marketType: "Blitz" })).toBe(false);
    expect(isSupportedNormalBinaryMarket({ ...normalCtx, marketType: "DIGITAL" })).toBe(false);
    expect(isSupportedNormalBinaryMarket(null)).toBe(false);
    expect(isSupportedNormalBinaryMarket(undefined)).toBe(false);
  });

  it("desabilitado / pausado / nao-OPEN / sem activeId => reject", () => {
    expect(isSupportedNormalBinaryMarket({ ...normalCtx, enabled: false })).toBe(false);
    expect(isSupportedNormalBinaryMarket({ ...normalCtx, paused: true })).toBe(false);
    expect(isSupportedNormalBinaryMarket({ ...normalCtx, availability: "CLOSED" })).toBe(false);
    expect(isSupportedNormalBinaryMarket({ ...normalCtx, availability: "SUSPENDED" })).toBe(false);
    expect(isSupportedNormalBinaryMarket({ ...normalCtx, activeId: null })).toBe(false);
  });

  it("universo operacional = 24 NORMAL (inclui USDCHF do catalogo IQ) e zero OTC", () => {
    expect(OPERATIONAL_MAX_ACTIVE_MARKETS).toBe(24);
    expect(OPERATIONAL_UNIVERSE.some((entry: any) => entry.marketType === "OTC")).toBe(false);
    expect(OPERATIONAL_UNIVERSE.some((entry: any) => entry.canonical === "USDCHF" && entry.marketType === "NORMAL")).toBe(true);
    expect(OPERATIONAL_MARKET_KEYS.size).toBe(24);
  });

  it("MCP NAO define universo: ativos fora dos 24 => reject (AMAZON/NVIDIA/RIPPLE/SPACEX)", () => {
    expect(mcpCanonical("AMAZON")).toBeNull();
    expect(mcpCanonical("NVIDIA")).toBeNull();
    expect(mcpCanonical("RIPPLE")).toBeNull();
    expect(mcpCanonical("SPACEX")).toBeNull();
    expect(mcpCanonical("AMZN")).toBeNull();
    expect(mcpCanonical("Tesla")).toBeNull();
    expect(isOperationalMarketKey("AMAZON:NORMAL")).toBe(false);
    expect(isOperationalMarketKey("SPACEX:NORMAL")).toBe(false);
  });

  it("aliases explicitos do catalogo MCP: GOLD->XAUUSD, SILVER->XAGUSD, AU200->AUS200", () => {
    expect(mcpCanonical("GOLD")).toBe("XAUUSD");
    expect(mcpCanonical("SILVER")).toBe("XAGUSD");
    expect(mcpCanonical("AU200")).toBe("AUS200");
    expect(mcpCanonical("EUR/USD")).toBe("EURUSD");
    expect(mcpCanonical("US 500")).toBe("US500");
    expect(mcpCanonical("USDCHF")).toBe("USDCHF");
    expect(mcpCanonical("XAU/USD")).toBe("XAUUSD");
  });

  it("heuristicas genericas de FX sao PROIBIDAS (SPACEX nao e par de moedas)", () => {
    expect(mcpCanonical("SPACEX")).toBeNull();
    expect(mcpCanonical("NVIDIA")).toBeNull();
    expect(mcpCanonical("RIPPLE")).toBeNull();
    expect(isOperationalMarketKey("SPACEX:NORMAL")).toBe(false);
  });

  it("24 mercados permitidos; nenhum 25o pode existir operacionalmente", () => {
    expect(OPERATIONAL_MARKET_KEYS.has("EURUSD:NORMAL")).toBe(true);
    expect(OPERATIONAL_MARKET_KEYS.has("USDCHF:NORMAL")).toBe(true);
    expect(OPERATIONAL_MARKET_KEYS.has("AUS200:NORMAL")).toBe(true);
    expect(OPERATIONAL_MARKET_KEYS.size).toBe(24);
    // catalogo MCP com 100 ativos => runtime operacional continua maximo 24
    const fakeCatalog = Array.from({ length: 100 }, (_, i) => `EXTRA${i}:NORMAL`);
    const extra = fakeCatalog.filter((key) => isOperationalMarketKey(key));
    expect(extra.length).toBe(0);
  });
});