/**
 * MIGRACAO OTC -> MERCADO REAL: universo operacional SEM OTC; guardas e filtros comprovam rejeicao.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const universe = await import("../../relay/market-universe.mjs");
const { OPERATIONAL_UNIVERSE, UNIVERSE, isOtcKey, marketKey } = universe as any;

describe("OTC -> MERCADO REAL (universo operacional)", () => {
  it("OPERATIONAL_UNIVERSE contem ZERO OTC e so NORMAL", () => {
    expect(OPERATIONAL_UNIVERSE.length).toBeGreaterThan(0);
    for (const entry of OPERATIONAL_UNIVERSE) expect(entry.marketType).not.toBe("OTC");
    expect(OPERATIONAL_UNIVERSE.every((entry: any) => entry.marketType === "NORMAL")).toBe(true);
  });

  it("UNIVERSE historico mantem OTC apenas como referencia (nao operacional)", () => {
    expect(UNIVERSE.some((entry: any) => entry.marketType === "OTC")).toBe(true);
    expect(OPERATIONAL_UNIVERSE.some((entry: any) => entry.marketType === "OTC")).toBe(false);
  });

  it("guardas: chave OTC detectada e excluida; chave NORMAL aceita", () => {
    expect(isOtcKey("EURUSD:OTC")).toBe(true);
    expect(isOtcKey("EURUSD:NORMAL")).toBe(false);
    expect(marketKey("EURUSD", "NORMAL")).toBe("EURUSD:NORMAL");
  });

  it("pares OTC com equivalente NORMAL oferecido pela IQ estao no universo operacional", () => {
    const otcPairs = UNIVERSE.filter((entry: any) => entry.marketType === "OTC").map((entry: any) => entry.canonical);
    const normalKeys = new Set(OPERATIONAL_UNIVERSE.map((entry: any) => entry.canonical));
    const offeredNormals = ["EURUSD", "GBPUSD", "USDJPY", "EURGBP", "GBPJPY", "AUDUSD", "USDCAD", "EURJPY", "AUDJPY"];
    for (const pair of otcPairs) {
      if (offeredNormals.includes(pair)) expect(normalKeys.has(pair)).toBe(true);
    }
  });
});