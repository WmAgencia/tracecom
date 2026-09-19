/**
 * FACTOR REGISTRY — versionado, status explicito e SEM promocao automatica.
 *
 * Fluxo de status permitido (manual):
 *   DISCOVERED -> RESEARCH -> VALIDATED -> SHADOW_CANDIDATE -> PROMOTED -> RETIRED
 *   qualquer -> REJECTED (com evidencia); REJECTED/RETIRED nao voltam sozinhos.
 */
import { FACTOR_STATUSES } from "./contracts.mjs";
import { buildFactorDefinition, validateFactor, compatibilityFor } from "./factor-contracts.mjs";

export const FACTOR_REGISTRY_VERSION = "factor-registry-v1";

const ALLOWED_TRANSITIONS = Object.freeze({
  DISCOVERED: ["RESEARCH", "REJECTED"],
  RESEARCH: ["VALIDATED", "REJECTED", "RETIRED"],
  VALIDATED: ["SHADOW_CANDIDATE", "REJECTED", "RETIRED"],
  SHADOW_CANDIDATE: ["PROMOTED", "REJECTED", "RETIRED"],
  PROMOTED: ["RETIRED"],
  REJECTED: [],
  RETIRED: [],
});

export class FactorRegistry {
  constructor({ version = FACTOR_REGISTRY_VERSION } = {}) {
    this.version = version;
    this.factors = new Map();
    this.history = [];
    this.createdAt = Date.now();
  }

  register(definition = {}, { status = "DISCOVERED", actor = "system" } = {}) {
    const factor = buildFactorDefinition(definition, { defaultStatus: status });
    const validation = validateFactor(factor);
    if (!validation.ok) throw new Error(`FACTOR_INVALID:${factor.factorId}:${validation.errors.join(",")}`);
    if (this.factors.has(factor.factorId)) throw new Error(`FACTOR_DUPLICATE:${factor.factorId}`);
    this.factors.set(factor.factorId, factor);
    this.history.push({ at: Date.now(), factorId: factor.factorId, action: "REGISTER", status: factor.status, actor });
    return factor;
  }

  registerMany(definitions = [], options = {}) {
    const registered = [];
    for (const definition of definitions) registered.push(this.register(definition, options));
    return registered;
  }

  get(factorId) { return this.factors.get(factorId) ?? null; }

  list({ category = null, status = null, nativeOrDerived = null, imported = null, lookaheadSafe = null, marketType = null, otcCompatible = null } = {}) {
    return [...this.factors.values()].filter((factor) => {
      if (category && factor.category !== category) return false;
      if (status && factor.status !== status) return false;
      if (nativeOrDerived && factor.nativeOrDerived !== nativeOrDerived) return false;
      if (imported !== null && factor.imported !== imported) return false;
      if (lookaheadSafe !== null && factor.lookaheadSafe !== lookaheadSafe) return false;
      if (otcCompatible === true && compatibilityFor(factor, "OTC") === "UNAVAILABLE_FOR_OTC") return false;
      if (marketType && compatibilityFor(factor, marketType) === "UNAVAILABLE_FOR_OTC") return false;
      return true;
    });
  }

  /** Mudanca de status e SEMPRE manual e auditada; nenhuma rotina promove sozinha. */
  setStatus(factorId, nextStatus, { actor = "manual", reason = null, evidence = null } = {}) {
    const factor = this.factors.get(factorId);
    if (!factor) throw new Error(`FACTOR_NOT_FOUND:${factorId}`);
    if (!FACTOR_STATUSES.includes(nextStatus)) throw new Error(`STATUS_INVALID:${nextStatus}`);
    const allowed = ALLOWED_TRANSITIONS[factor.status] ?? [];
    if (!allowed.includes(nextStatus)) throw new Error(`TRANSITION_NOT_ALLOWED:${factor.status}->${nextStatus}`);
    this.history.push({ at: Date.now(), factorId, action: "STATUS_CHANGE", from: factor.status, status: nextStatus, actor, reason, evidence });
    factor.status = nextStatus;
    return factor;
  }

  exportManifest() {
    const factors = [...this.factors.values()].map((factor) => ({
      factorId: factor.factorId, name: factor.name, version: factor.version, category: factor.category,
      source: factor.source, license: factor.license, requiredData: factor.requiredData,
      formula: factor.formula, formulaHash: factor.formulaHash, availableAtSemantics: factor.availableAtSemantics,
      normalCompatibility: factor.normalCompatibility, otcCompatibility: factor.otcCompatibility,
      nativeOrDerived: factor.nativeOrDerived, lookaheadSafe: factor.lookaheadSafe, status: factor.status,
      imported: factor.imported, upstream: factor.upstream, sourceCommit: factor.sourceCommit,
    }));
    const counts = { total: factors.length, byCategory: {}, byStatus: {}, imported: 0, native: 0 };
    for (const factor of factors) {
      counts.byCategory[factor.category] = (counts.byCategory[factor.category] ?? 0) + 1;
      counts.byStatus[factor.status] = (counts.byStatus[factor.status] ?? 0) + 1;
      if (factor.imported) counts.imported += 1; else counts.native += 1;
    }
    return { schema: "factor-registry-manifest-v1", version: this.version, generatedAt: Date.now(), counts, factors, history: this.history.slice(-100) };
  }
}
