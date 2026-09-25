/**
 * ALLOWLIST POSITIVA (fail-closed): somente NORMAL Binary suportado e operacional.
 * OTC / UNKNOWN / undefined / instrumento nao suportado => REJECT.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const universe = await import("../../relay/market-universe.mjs");
const { isSupportedNormalBinaryMarket, OPERATIONAL_UNIVERSE, OPERATIONAL_MAX_ACTIVE_MARKETS } = universe as any;

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
  });
});