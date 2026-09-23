import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OPERATIONAL_MANIFEST_PATH = path.join("estrategias", "strategy-versions", "PULLBACK_4060_300_AGENTIC_V2.json");
export const STRATEGY_STATUS_ACTIVE = "ACTIVE";
export const STRATEGY_STATUS_READY_FOR_DEPLOY = "READY_FOR_DEPLOY";

const normalizeStatus = (value) => String(value ?? "").trim().split(/[\s\u2014-]+/)[0].toUpperCase();

export function loadOperationalStrategy({ rootDir = null, manifestPath = OPERATIONAL_MANIFEST_PATH } = {}) {
  try {
    const root = rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const file = path.isAbsolute(manifestPath) ? manifestPath : path.join(root, manifestPath);
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    const strategyHash = manifest.newStrategyHash ?? manifest.strategyHash ?? null;
    const status = normalizeStatus(manifest.status);
    return Object.freeze({
      version: manifest.strategyVersion ?? null,
      status,
      executable: status === STRATEGY_STATUS_ACTIVE && typeof strategyHash === "string" && strategyHash.length > 0,
      strategyHash: typeof strategyHash === "string" && strategyHash.length > 0 ? strategyHash : null,
      manifest,
    });
  } catch (error) {
    return Object.freeze({ version: null, status: "UNAVAILABLE", executable: false, strategyHash: null, error: String(error?.message ?? error).slice(0, 140) });
  }
}
