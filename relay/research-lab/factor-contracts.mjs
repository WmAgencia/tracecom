/**
 * FACTOR CONTRACTS — metadados obrigatorios, hash de formula e validacao.
 */
import crypto from "node:crypto";
import { FACTOR_CATEGORIES, FACTOR_STATUSES, NATIVE_OR_DERIVED } from "./contracts.mjs";

export const FACTOR_CONTRACT_VERSION = "factor-contract-v1";

export const REQUIRED_FACTOR_FIELDS = Object.freeze([
  "factorId", "name", "version", "source", "license", "category", "requiredData", "formula",
  "formulaHash", "availableAtSemantics", "normalCompatibility", "otcCompatibility", "nativeOrDerived",
  "lookaheadSafe", "status",
]);

export function formulaHash(formula, version) {
  return crypto.createHash("sha256").update(`${String(formula ?? "").trim()}::${String(version ?? "")}`).digest("hex");
}

export function buildFactorDefinition(input = {}, { defaultStatus = "DISCOVERED" } = {}) {
  const version = String(input.version ?? "1");
  const factor = {
    factorId: String(input.factorId ?? ""),
    name: String(input.name ?? input.factorId ?? ""),
    version,
    source: String(input.source ?? "TRACECOM_NATIVE"),
    license: String(input.license ?? "proprietary (TraceCom)"),
    category: input.category ?? "OTHER",
    requiredData: Array.isArray(input.requiredData) ? [...input.requiredData] : [],
    formula: String(input.formula ?? ""),
    formulaHash: formulaHash(input.formula, version),
    availableAtSemantics: String(input.availableAtSemantics ?? "close do candle 5s fechado"),
    normalCompatibility: input.normalCompatibility ?? "SUPPORTED",
    otcCompatibility: input.otcCompatibility ?? "SUPPORTED",
    nativeOrDerived: input.nativeOrDerived ?? "NATIVE",
    lookaheadSafe: input.lookaheadSafe !== false,
    status: FACTOR_STATUSES.includes(input.status) ? input.status : defaultStatus,
    imported: input.imported === true,
    upstream: input.upstream ?? null,
    sourceCommit: input.sourceCommit ?? null,
    window: input.window ?? null,
    warmup: input.warmup ?? null,
    notes: input.notes ?? null,
    compute: typeof input.compute === "function" ? input.compute : null,
    fromT0: typeof input.fromT0 === "function" ? input.fromT0 : null,
  };
  return factor;
}

export function validateFactor(factor = {}) {
  const errors = [];
  if (!factor.factorId) errors.push("FACTOR_ID_MISSING");
  if (!FACTOR_CATEGORIES.includes(factor.category)) errors.push(`CATEGORY_INVALID:${factor.category}`);
  if (!FACTOR_STATUSES.includes(factor.status)) errors.push(`STATUS_INVALID:${factor.status}`);
  if (!NATIVE_OR_DERIVED.includes(factor.nativeOrDerived)) errors.push(`NATIVE_OR_DERIVED_INVALID:${factor.nativeOrDerived}`);
  if (!factor.formula) errors.push("FORMULA_MISSING");
  if (factor.formulaHash !== formulaHash(factor.formula, factor.version)) errors.push("FORMULA_HASH_MISMATCH");
  if (!factor.availableAtSemantics) errors.push("AVAILABLE_AT_SEMANTICS_MISSING");
  if (!factor.lookaheadSafe) errors.push("FACTOR_NOT_LOOKAHEAD_SAFE");
  if (typeof factor.compute !== "function" && typeof factor.fromT0 !== "function") errors.push("COMPUTE_MISSING");
  return { ok: errors.length === 0, errors };
}

/** OTC: fator so e compativel se nao depende de dado inexistente em OTC. */
export function compatibilityFor(factor, marketType) {
  const type = String(marketType ?? "NORMAL").toUpperCase();
  const unavailable = new Set(["TRUE_VOLUME", "ORDER_BOOK", "MARKET_DEPTH", "INSTITUTIONAL_FLOW", "FUNDAMENTAL", "SECTOR"]);
  const requiresUnavailable = (factor.requiredData ?? []).some((item) => unavailable.has(item.toUpperCase()));
  if (requiresUnavailable) return "UNAVAILABLE_FOR_OTC";
  return type === "OTC" ? factor.otcCompatibility : factor.normalCompatibility;
}
