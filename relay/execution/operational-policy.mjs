/**
 * POLITICA OPERACIONAL DE EXECUCAO — caminho unico.
 *
 * P0 (auditoria V3): o unico caminho broker-capable por padrao e a V2 operacional.
 * PATH_TEST e um modo de teste controlado, desligado por padrao e habilitavel apenas
 * com PATH_TEST_ENABLED=true (aprovacao explicita do operador). Nenhum caminho legado
 * (lab/blitz/ui smoke/agent-v2) tem capacidade de envio por padrao.
 */
export const OPERATIONAL_EXECUTION_ALLOWLIST = Object.freeze([
  "intelligence:PULLBACK_4060_300_AGENTIC_V2",
]);

export const PATH_TEST_EXECUTION_ALLOWLIST = Object.freeze([
  "pathtest:AGENTIC_PATH_TEST",
]);

export const OPERATIONAL_EXECUTION_POLICY_NAME = "OPERATIONAL_V2_SINGLE_PATH";

export function pathTestEnabled() { return process.env.PATH_TEST_ENABLED === "true"; }

export function operationalAllowlist() {
  const list = [...OPERATIONAL_EXECUTION_ALLOWLIST];
  if (pathTestEnabled()) list.push(...PATH_TEST_EXECUTION_ALLOWLIST);
  return list;
}
