import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OPERATIONAL_MANIFEST_PATH = path.join("estrategias", "strategy-versions", "PULLBACK_4060_300_AGENTIC_V2.json");
export const STRATEGY_STATUS_ACTIVE = "ACTIVE";
export const STRATEGY_STATUS_READY_FOR_DEPLOY = "READY_FOR_DEPLOY";

const normalizeStatus = (value) => String(value ?? "").trim().split(/[\s\u2014-]+/)[0].toUpperCase();

/** Candidatos: layout do repo (relay/..), deploy do relay (manifesto copiado para o dir do relay) e cwd. */
function manifestCandidates(rootDir, manifestPath) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const roots = rootDir ? [rootDir] : [path.resolve(here, "..", ".."), here, process.cwd()];
  const list = [];
  for (const root of roots) {
    list.push(path.isAbsolute(manifestPath) ? manifestPath : path.join(root, manifestPath));
    list.push(path.join(root, path.basename(manifestPath)));
  }
  return [...new Set(list)];
}

export function loadOperationalStrategy({ rootDir = null, manifestPath = OPERATIONAL_MANIFEST_PATH } = {}) {
  let lastError = null;
  for (const file of manifestCandidates(rootDir, manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      const strategyHash = manifest.newStrategyHash ?? manifest.strategyHash ?? null;
      const status = normalizeStatus(manifest.status);
      // Fase 7: `executable` explicito do manifesto e autoridade — nunca inferido apenas do status.
      const explicitExecutable = manifest.executable === undefined ? true : manifest.executable === true;
      return Object.freeze({
        version: manifest.strategyVersion ?? null,
        status,
        executable: explicitExecutable && status === STRATEGY_STATUS_ACTIVE && typeof strategyHash === "string" && strategyHash.length > 0,
        strategyHash: typeof strategyHash === "string" && strategyHash.length > 0 ? strategyHash : null,
        manifestPath: file,
        manifest,
      });
    } catch (error) { lastError = error; }
  }
  return Object.freeze({ version: null, status: "UNAVAILABLE", executable: false, strategyHash: null, manifestPath: null, error: String(lastError?.message ?? lastError).slice(0, 140) });
}
