/**
 * TRACE/COM — PIXEL OFFICE V3 · BASE MODE resolver
 *
 * Small, dependency-light helper that decides which static layer the hybrid
 * renderer uses:
 *   "reference"  → the frozen reference image as the pre-rendered base
 *   "procedural" → the procedural world renderer (no base image)
 *
 * Precedence: URL query `?base=...` > env `OFFICE_V3_BASE` > OFFICE_V3_BASE.mode
 * (default "reference"). Invalid values are ignored, never throw.
 *
 * Frontend/rendering only. PRACTICE only. ZERO REAL.
 */

import { BASE_MODES, DEFAULT_BASE_MODE } from "./blueprint-base.js";

const VALID_MODES = new Set(BASE_MODES);

function normalizeMode(value) {
  if (value == null) return null;
  const mode = String(value).trim().toLowerCase();
  return VALID_MODES.has(mode) ? mode : null;
}

function queryValue(search, key) {
  if (!search) return null;
  try {
    if (typeof search.get === "function") return search.get(key);
    if (typeof search === "object") return search[key] ?? null;
    const text = String(search).replace(/^[?#]/, "");
    const params = new URLSearchParams(text);
    return params.get(key);
  } catch {
    return null;
  }
}

function envValue(env, key) {
  if (!env || typeof env !== "object") return null;
  if (typeof env.get === "function") return env.get(key);
  return env[key];
}

/**
 * Resolve the base mode.
 *
 * @param {string|URLSearchParams|{get?:Function}|object} [search] URL search
 *   string ("?base=procedural"), URLSearchParams, or a plain object.
 * @param {object} [env] environment-like object (e.g. `process.env`).
 * @returns {"reference"|"procedural"}
 */
export function resolveBaseMode(search, env) {
  const fromQuery = normalizeMode(queryValue(search, "base"));
  if (fromQuery) return fromQuery;
  const fromEnv = normalizeMode(envValue(env, "OFFICE_V3_BASE"));
  if (fromEnv) return fromEnv;
  return DEFAULT_BASE_MODE;
}

/** True only when the static base image should be drawn. */
export function shouldDrawBlueprintBase(mode) {
  if (mode == null) return DEFAULT_BASE_MODE === "reference";
  return normalizeMode(mode) === "reference";
}

export default { resolveBaseMode, shouldDrawBlueprintBase };
