/**
 * VERSION ROUTER — roda G2 / V3 congelada / V4 lado a lado na MESMA oportunidade.
 *
 * Nenhuma versao controla a outra: cada runner e chamado em isolamento total (try/catch proprio),
 * sem compartilhar estado mutavel. O router apenas REGISTRA as saidas.
 */
export const VERSION_ROUTER_VERSION = "version-router-v1";
export const VERSION_IDS = Object.freeze(["G2_CURRENT", "SCENARIO_ENGINE_V3_FROZEN", "PROFESSIONAL_AGENT_SYSTEM_V4"]);
export const ROUTER_POLICY = Object.freeze({
  version: VERSION_ROUTER_VERSION,
  mode: "SHADOW_ONLY",
  controlsExecution: false,
  sendsOrders: false,
  crossVersionInfluence: "NONE",
  promotesToReal: false,
});

function invoke(runner, source) {
  try {
    if (typeof runner === "function") return runner(source);
    if (runner && typeof runner === "object") return runner;
    return { action: "UNAVAILABLE", reason: "NO_RUNNER" };
  } catch (error) {
    return { action: "ERROR", reason: String(error?.message ?? error).slice(0, 160) };
  }
}

function normalizeVersionResult(raw) {
  if (!raw || typeof raw !== "object") return { action: "UNAVAILABLE" };
  return {
    action: raw.action ?? raw.finalAction ?? "WAIT",
    scenario: raw.primaryScenario ?? raw.scenario ?? null,
    regime: raw.marketRegime ?? raw.regime ?? null,
    dataQuality: raw.dataQuality ?? raw.dataQualityState ?? null,
    reason: raw.reason ?? raw.triggerState ?? null,
    version: raw.version ?? raw.engineVersion ?? null,
  };
}

export function runVersionRouter({ t0 = {}, atMs = null, g2 = null, v3 = null, v4 = null, candidateId = null, correlationId = null } = {}) {
  const startedAt = Date.now();
  const opportunityId = `${t0?.market?.marketKey ?? "UNKNOWN"}:${candidateId ?? t0?.snapshotId ?? startedAt}`;
  const g2Result = normalizeVersionResult(invoke(g2, { t0 }));
  const v3Result = normalizeVersionResult(invoke(v3, { t0 }));
  const v4Result = normalizeVersionResult(invoke(v4, { t0 }));
  return {
    version: VERSION_ROUTER_VERSION,
    opportunityId,
    candidateId,
    correlationId,
    marketKey: t0?.market?.marketKey ?? null,
    marketType: t0?.market?.marketType ?? null,
    accountContext: t0?.market?.accountContext ?? null,
    snapshotId: t0?.snapshotId ?? null,
    atMs: Number.isFinite(Number(atMs)) ? Number(atMs) : Date.now(),
    versions: {
      G2_CURRENT: g2Result,
      SCENARIO_ENGINE_V3_FROZEN: v3Result,
      PROFESSIONAL_AGENT_SYSTEM_V4: v4Result,
    },
    independence: { isolated: true, crossCalls: 0, order: [...VERSION_IDS] },
    policy: ROUTER_POLICY,
    latencyMs: Date.now() - startedAt,
  };
}
