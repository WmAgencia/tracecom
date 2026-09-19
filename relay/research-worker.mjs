/**
 * RESEARCH WORKER — child process para jobs do laboratorio (nunca no processo do relay).
 * Tipos: SCAN_FACTORS, BACKTEST_BINARY, CHECKPOINTS, COVERAGE_AUDIT, DRIFT_REPORT, TAG.
 */
import process from "node:process";

const send = (message) => { try { process.send?.(message); } catch { /* noop */ } };
const log = (message) => send({ log: String(message).slice(0, 280) });
const progress = (value) => send({ progress: value });

const type = process.env.RESEARCH_JOB_TYPE ?? "TAG";
let payload = {};
try { payload = JSON.parse(process.env.RESEARCH_JOB_PAYLOAD ?? "{}"); } catch { payload = {}; }

try {
  log(`worker start type=${type}`);
  progress(0.05);
  const output = await run(type, payload);
  progress(0.95);
  log(`worker done type=${type}`);
  // O resultado completo e devolvido via IPC; o relay decide a persistencia.
  send({ result: output, progress: 1 });
  process.exitCode = 0;
} catch (error) {
  log(`worker error: ${String(error?.message ?? error).slice(0, 200)}`);
  send({ error: String(error?.message ?? error).slice(0, 240) });
  process.exitCode = 1;
}

async function run(jobType, input) {
  switch (jobType) {
    case "TAG": return { tag: input.tag ?? "noop", at: Date.now() };
    case "COVERAGE_AUDIT": {
      const { auditFeatureCoverage } = await import("./research-lab/coverage-audit.mjs");
      return auditFeatureCoverage(input.snapshots ?? [], input.options ?? {});
    }
    case "SCAN_FACTORS": {
      const { factorRegistry } = await import("./research-lab/factors/index.mjs");
      const manifest = factorRegistry().exportManifest();
      return { counts: manifest.counts, generatedAt: manifest.generatedAt };
    }
    case "CHECKPOINTS": {
      const { v4DirectionalCheckpoints } = await import("./research-lab/checkpoints.mjs");
      return v4DirectionalCheckpoints(input.rows ?? [], input.options ?? {});
    }
    case "DRIFT_REPORT": {
      const { driftReport } = await import("./research-lab/intelligence.mjs");
      return driftReport(input);
    }
    case "BACKTEST_BINARY": {
      const { runBinaryBacktest, purgedKFold, untouchedHoldout, bootstrapValidation } = await import("./research-lab/backtest.mjs");
      const backtest = runBinaryBacktest({ rows: input.rows ?? [], payoutOptions: input.payoutOptions ?? {}, executionOptions: input.executionOptions ?? {}, allowHypotheticalPayout: input.allowHypotheticalPayout === true });
      return { backtest, purged: purgedKFold(input.rows ?? []), holdout: untouchedHoldout(input.rows ?? []), bootstrap: bootstrapValidation(backtest.results) };
    }
    default: throw new Error(`JOB_TYPE_UNKNOWN:${jobType}`);
  }
}
