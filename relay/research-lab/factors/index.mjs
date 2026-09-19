/**
 * FACTOR CATALOG — registro unico com nativos + importados (subconjunto Vibe) e avaliacao point-in-time.
 */
import { FactorRegistry } from "../factor-registry.mjs";
import { NATIVE_FACTORS } from "./native.mjs";
import { IMPORTED_FACTORS, IMPORTED_NOTICE, IMPORTED_SOURCE } from "./imported.mjs";
import { FROM_T0_READERS } from "./from-t0.mjs";

export const FACTOR_CATALOG_VERSION = "factor-catalog-v1";
export { IMPORTED_NOTICE, IMPORTED_SOURCE };

let singleton = null;

export function buildFactorRegistry({ withImported = true } = {}) {
  const registry = new FactorRegistry();
  for (const factor of NATIVE_FACTORS) {
    registry.register({
      ...factor, version: "1", source: "TRACECOM_NATIVE", license: "proprietary (TraceCom)",
      normalCompatibility: "SUPPORTED", otcCompatibility: "SUPPORTED",
      fromT0: FROM_T0_READERS[factor.factorId] ?? null,
    });
  }
  if (withImported) {
    for (const factor of IMPORTED_FACTORS) {
      registry.register({
        ...factor, version: "1",
        normalCompatibility: "SUPPORTED", otcCompatibility: "SUPPORTED",
      });
    }
  }
  return registry;
}

export function factorRegistry() {
  if (!singleton) singleton = buildFactorRegistry();
  return singleton;
}

/** Avaliacao point-in-time: prefere leitura do T0; senao usa candles ATE t (nunca futuros). */
export function evaluateFactor(factor, { t0 = null, candles = null, ticks = null, index = null } = {}) {
  try {
    if (t0 && typeof factor.fromT0 === "function") {
      const value = factor.fromT0(t0);
      return Number.isFinite(Number(value)) ? Number(value) : null;
    }
    const list = Array.isArray(candles) ? candles : null;
    if (!list || !list.length) return null;
    const resolvedIndex = Number.isInteger(index) ? index : list.length - 1;
    const window = list.slice(0, resolvedIndex + 1);
    if (Number.isFinite(Number(factor.warmup)) && window.length < Number(factor.warmup)) return null;
    const value = factor.compute({ candles: list, ticks: ticks ?? [], t0, index: resolvedIndex }, window);
    return Number.isFinite(Number(value)) ? Number(value) : null;
  } catch {
    return null;
  }
}

export function factorCatalogManifest() {
  return factorRegistry().exportManifest();
}
