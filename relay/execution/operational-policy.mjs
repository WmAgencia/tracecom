export const OPERATIONAL_EXECUTION_ALLOWLIST = Object.freeze([
  "intelligence:PULLBACK_4060_300_AGENTIC_V2",
  "pathtest:AGENTIC_PATH_TEST",
  "ui:smoke",
  "agent-v2:RSI_REVERSAL_STRICT_V2",
]);

export const OPERATIONAL_EXECUTION_POLICY_NAME = "OPERATIONAL_V2_PLUS_TEST_PATHS";

export function operationalAllowlist() { return [...OPERATIONAL_EXECUTION_ALLOWLIST]; }
