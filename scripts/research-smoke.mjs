/**
 * RESEARCH SMOKE — valida endpoints de producao (lab + agentes + office + quality + REAL preflight).
 * Uso: node scripts/research-smoke.mjs [base]
 */
const BASE = process.argv[2] ?? "https://tracecom.consecom.com.br";
const CHECKS = [
  "/health",
  "/api/iq/office",
  "/api/iq/status",
  "/api/iq/intelligence",
  "/api/iq/intelligence/assets",
  "/api/iq/strategy/stats",
  "/api/iq/execution-routing",
  "/api/iq/mesas",
  "/api/iq/account/context",
  "/api/iq/real/preflight",
  "/api/iq/research/lab/overview",
  "/api/iq/research/lab/factors",
  "/api/iq/research/lab/alphas",
  "/api/iq/research/lab/backtests",
  "/api/iq/research/lab/coverage",
  "/api/iq/research/lab/strategy-regime",
  "/api/iq/research/lab/journal-intelligence",
  "/api/iq/research/lab/drift",
  "/api/iq/research/lab/models",
  "/api/iq/research/lab/checkpoints",
  "/api/iq/research/lab/jobs",
  "/api/iq/research/lab/comparison",
  "/api/iq/research/scenario-shadow",
  "/api/iq/quality",
  "/research/index.html",
];

let failures = 0;
for (const path of CHECKS) {
  try {
    const response = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(45_000) });
    const ok = response.ok;
    if (!ok) failures += 1;
    console.log(`${ok ? "OK " : "FAIL"} ${response.status} ${path}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ERR ${path} :: ${String(error?.message ?? error).slice(0, 120)}`);
  }
}
console.log(failures === 0 ? "RESEARCH_SMOKE_ALL_OK" : `RESEARCH_SMOKE_FAILURES=${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
