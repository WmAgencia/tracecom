/**
 * REGRESSAO (incidente 19/09 22:14:55Z): o proxy Vercel descartava o payload de
 * /api/iq/mesas/bulk (virava {} => enabled:false SEM filtro, desligando as 53
 * MESAS) e enviava o toggle individual como POST (relay exige PUT => 404).
 *
 * Estes helpers provam o contrato do proxy sem rede.
 */
import { describe, expect, it } from "vitest";
import { mesasBulkPayload, mesasTogglePayload, proxyMethodFor } from "../../api/http";

describe("MESAS reverse proxy (Vercel -> relay)", () => {
  it("toggle individual usa PUT (relay so aceita PUT em /api/iq/mesas)", () => {
    expect(proxyMethodFor("/api/iq/mesas")).toBe("PUT");
    expect(proxyMethodFor("/api/iq/mesas/bulk")).toBe("POST");
    expect(proxyMethodFor("/api/iq/market")).toBe("PUT");
    expect(proxyMethodFor("/api/iq/arm")).toBe("POST");
    expect(proxyMethodFor("/api/iq/kill-switch")).toBe("POST");
  });

  it("payload do toggle preserva enabled e identificacao do instrumento", () => {
    expect(mesasTogglePayload({ marketKey: "EURUSD:OTC", instrumentType: "BINARY", durationSeconds: 60, enabled: true })).toEqual({
      marketKey: "EURUSD:OTC", instrumentType: "BINARY", durationSeconds: 60, enabled: true,
    });
    expect(mesasTogglePayload({})).toEqual({ marketKey: "", instrumentType: "BINARY", durationSeconds: 60, enabled: false });
  });

  it("payload do bulk NUNCA perde o filtro (regressao do desligamento global)", () => {
    const payload = mesasBulkPayload({ filter: { instrumentType: "BINARY", marketType: "OTC", unknown: "x" }, enabled: true });
    expect(payload).toEqual({ filter: { instrumentType: "BINARY", marketType: "OTC" }, enabled: true, confirmZeroUniverse: false });
    const single = mesasBulkPayload({ filter: { marketKey: "EURUSD:OTC" }, enabled: true });
    expect(single).toEqual({ filter: { marketKey: "EURUSD:OTC" }, enabled: true, confirmZeroUniverse: false });
    const filtered = mesasBulkPayload({ filter: { category: "BINARY" }, enabled: false, confirmZeroUniverse: true });
    expect(filtered).toEqual({ filter: { category: "BINARY" }, enabled: false, confirmZeroUniverse: true });
  });

  it("bulk incompleto => null (400, nunca default destrutivo)", () => {
    expect(mesasBulkPayload({})).toBeNull();
    expect(mesasBulkPayload({ enabled: false })).toBeNull();
    expect(mesasBulkPayload({ filter: {} })).toBeNull();
    expect(mesasBulkPayload({ filter: { unknown: "x" }, enabled: true })).toBeNull();
    expect(mesasBulkPayload({ filter: { instrumentType: "BINARY" } })).toBeNull();
    expect(mesasBulkPayload({ filter: { instrumentType: "BINARY" }, enabled: "false" })).toBeNull();
  });
});
