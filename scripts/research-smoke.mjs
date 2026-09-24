/**
 * RESEARCH SMOKE — valida endpoints de producao (lab + agentes + office + quality + REAL preflight).
 * Uso: node scripts/research-smoke.mjs [base]
 *
 * Pos-reconciliacao do painel: GETs read-only do grid (/api/iq/status, intelligence/assets,
 * strategy/stats, mesas, account/context) sao PUBLICOS; as demais /api/iq/* seguem privadas:
 * sem TRACECOM_OPERATOR_KEY valida 401 anonimo; com a chave, autentica e exige 200.
 */
const BASE = process.argv[2] ?? "https://tracecom.consecom.com.br";
const OPERATOR_KEY = (process.env.TRACECOM_OPERATOR_KEY ?? "").trim() || null;
const PANEL_PUBLIC_GETS = new Set(["/api/iq/status", "/api/iq/intelligence/assets", "/api/iq/strategy/stats", "/api/iq/mesas", "/api/iq/account/context"]);
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
  "/api/iq/quality",
  "/research/index.html",
];

let cookie = null;
if (OPERATOR_KEY) {
  try {
    const login = await fetch(`${BASE}/api/auth/operator`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessKey: OPERATOR_KEY }), signal: AbortSignal.timeout(20_000) });
    if (login.status === 200) cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  } catch { /* sem sessao: valida fail-closed */ }
}

let failures = 0;
for (const path of CHECKS) {
  try {
    const isPanelPublic = PANEL_PUBLIC_GETS.has(path);
    const isPrivate = path.startsWith("/api/iq/") && !isPanelPublic;
    const response = await fetch(`${BASE}${path}`, { headers: cookie && isPrivate ? { cookie } : {}, signal: AbortSignal.timeout(45_000) });
    const ok = isPanelPublic ? response.ok : isPrivate ? (cookie ? response.ok : response.status === 401) : response.ok;
    if (!ok) failures += 1;
    console.log(`${ok ? "OK " : "FAIL"} ${response.status} ${path}${isPrivate ? ` (auth ${cookie ? "operator" : "fail-closed"})` : isPanelPublic ? " (painel publico)" : ""}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ERR ${path} :: ${String(error?.cause?.message ?? error?.message ?? error).slice(0, 160)}`);
  }
}
console.log(failures === 0 ? "RESEARCH_SMOKE_ALL_OK" : `RESEARCH_SMOKE_FAILURES=${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
