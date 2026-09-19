/** Deploy safety guard (fail-closed): nunca permitir railway up sem alvo valido. */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const guard = await import("../../relay/deploy-guard.mjs");

const expected = { projectId: "68e899a3-4e6f-469c-935b-2a2123476fd5", environmentName: "production", serviceName: "tracecom-live-relay" };
const validStatus = {
  id: expected.projectId, name: "SERVIDOR TRACECOM",
  services: { edges: [{ node: { name: "tracecom-live-relay" } }, { node: { name: "Postgres" } }] },
  environments: { edges: [{ node: { name: "production" } }] },
};

describe("deploy-prod railway fail-closed guard", () => {
  it("aceita somente o projeto/servico/ambiente esperados", () => {
    expect(guard.assertRailwayTarget(validStatus, expected).ok).toBe(true);
  });
  it("aborta quando nao ha link (caso do incidente)", () => {
    const result = guard.assertRailwayTarget(null, expected);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("RAILWAY_STATUS_UNAVAILABLE");
  });
  it("aborta quando o projeto diverge", () => {
    const result = guard.assertRailwayTarget({ ...validStatus, id: "outro-projeto" }, expected);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error: string) => error.startsWith("RAILWAY_PROJECT_MISMATCH"))).toBe(true);
  });
  it("aborta quando o servico esperado nao existe no projeto", () => {
    const result = guard.assertRailwayTarget({ ...validStatus, services: { edges: [{ node: { name: "repo" } }] } }, expected);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error: string) => error.startsWith("RAILWAY_SERVICE_MISSING"))).toBe(true);
  });
  it("aborta quando o ambiente esperado nao existe", () => {
    const result = guard.assertRailwayTarget({ ...validStatus, environments: { edges: [{ node: { name: "staging" } }] } }, expected);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error: string) => error.startsWith("RAILWAY_ENV_MISSING"))).toBe(true);
  });
  it("nunca contem secrets e usa apenas IDs de infraestrutura", () => {
    expect(JSON.stringify(guard.EXPECTED_RAILWAY)).not.toMatch(/token|secret|password|ssid/i);
  });
});
