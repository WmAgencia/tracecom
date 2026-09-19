/**
 * MESAS de instrumentos (UI) — contrato: filtros, bulk, toggles persistidos, endpoints no relay e no proxy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error - ESM browser sem tipagem
const mesas = await import("../../src/http/public/office-v3/mesas-instruments.js");

const { filterInstruments, bulkFilterFor } = mesas;

const rows = [
  { marketKey: "EURUSD:OTC", instrumentType: "BINARY", category: "BINARY", marketType: "OTC", assetClass: "FOREX", enabled: true },
  { marketKey: "BTCUSD:OTC", instrumentType: "BINARY", category: "BINARY", marketType: "OTC", assetClass: "CRYPTO", enabled: false },
  { marketKey: "USDCHF:OTC", instrumentType: "BLITZ_45S", category: "BLITZ", marketType: "OTC", assetClass: "FOREX", enabled: false },
  { marketKey: "EURUSD:NORMAL", instrumentType: "BINARY", category: "BINARY", marketType: "NORMAL", assetClass: "FOREX", enabled: false },
];

describe("MESAS instrumentos — filtros e bulk", () => {
  it("filtros independentes: tipo de contrato (BINARY/BLITZ/CRYPTO) x mercado (NORMAL/OTC)", () => {
    expect(filterInstruments(rows, "ALL")).toHaveLength(4);
    expect(filterInstruments(rows, "BINARY").map((row: any) => row.marketKey)).toContain("EURUSD:OTC");
    expect(filterInstruments(rows, "BLITZ").map((row: any) => row.marketKey)).toEqual(["USDCHF:OTC"]);
    expect(filterInstruments(rows, "CRYPTO").map((row: any) => row.marketKey)).toEqual(["BTCUSD:OTC"]);
    expect(filterInstruments(rows, "OTC")).toHaveLength(3);
    expect(filterInstruments(rows, "NORMAL")).toHaveLength(1);
  });

  it("bulk por filtro desliga apenas a familia do filtro", () => {
    expect(bulkFilterFor("BLITZ")).toEqual({ category: "BLITZ" });
    expect(bulkFilterFor("BINARY")).toEqual({ category: "BINARY" });
    expect(bulkFilterFor("CRYPTO")).toEqual({ category: "CRYPTO" });
    expect(bulkFilterFor("OTC")).toEqual({ marketType: "OTC" });
    expect(bulkFilterFor("ALL")).toEqual({});
  });

  it("endpoints do painel existem no relay e no proxy Vercel (persistencia real)", () => {
    const module = readFileSync(new URL("../../src/http/public/office-v3/mesas-instruments.js", import.meta.url), "utf8");
    expect(module.includes("/api/iq/mesas")).toBe(true);
    expect(module.includes("/api/iq/mesas/bulk")).toBe(true);
    const relay = readFileSync(new URL("../../relay/server.mjs", import.meta.url), "utf8");
    expect(relay.includes("'/api/iq/mesas'")).toBe(true);
    expect(relay.includes("'/api/iq/mesas/bulk'")).toBe(true);
    const proxy = readFileSync(new URL("../../api/http.ts", import.meta.url), "utf8");
    expect(proxy.includes('"/api/iq/mesas"')).toBe(true);
    expect(proxy.includes('"/api/iq/mesas/bulk"')).toBe(true);
  });

  it("painel se anexa ao MESAS existente e nao expoe segredos", () => {
    const module = readFileSync(new URL("../../src/http/public/office-v3/mesas-instruments.js", import.meta.url), "utf8");
    expect(module.includes("#mesas-panel")).toBe(true);
    for (const forbidden of ["ssid", "password", "token", "cookie"]) expect(module.toLowerCase()).not.toContain(forbidden);
  });
});
