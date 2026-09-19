/**
 * DEPLOY GUARD — fail-closed para deploys Railway (sem efeitos colaterais; testavel).
 * IDs de infraestrutura podem vir de env seguro; nunca secrets.
 */
export const EXPECTED_RAILWAY = Object.freeze({
  projectId: process.env.TRACECOM_RAILWAY_PROJECT_ID ?? "68e899a3-4e6f-469c-935b-2a2123476fd5",
  environmentName: process.env.TRACECOM_RAILWAY_ENVIRONMENT ?? "production",
  serviceName: process.env.TRACECOM_RAILWAY_SERVICE ?? "tracecom-live-relay",
});

export function assertRailwayTarget(statusJson = null, expected = EXPECTED_RAILWAY) {
  const errors = [];
  if (!statusJson || typeof statusJson !== "object") errors.push("RAILWAY_STATUS_UNAVAILABLE");
  else {
    const project = statusJson.id ?? statusJson.project?.id ?? statusJson.linkedProject?.project?.id ?? null;
    const name = statusJson.name ?? statusJson.project?.name ?? statusJson.linkedProject?.project?.name ?? null;
    const services = (statusJson.services?.edges ?? statusJson.project?.services?.edges ?? []).map((edge) => edge?.node?.name).filter(Boolean);
    const environments = (statusJson.environments?.edges ?? []).map((edge) => edge?.node?.name).filter(Boolean);
    if (!project || !name) errors.push("RAILWAY_NOT_LINKED");
    else if (project !== expected.projectId) errors.push(`RAILWAY_PROJECT_MISMATCH:${project}`);
    if (services.length && !services.includes(expected.serviceName)) errors.push(`RAILWAY_SERVICE_MISSING:${expected.serviceName}`);
    if (environments.length && !environments.includes(expected.environmentName)) errors.push(`RAILWAY_ENV_MISSING:${expected.environmentName}`);
  }
  return { ok: errors.length === 0, errors, expected };
}
