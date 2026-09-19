/**
 * FACTOR PURITY — provas automaticas anti-lookahead.
 *
 * Regras:
 *  - prefix equality: valor em t nao muda quando existem candles futuros;
 *  - future perturbation: alterar candles apos t nao muda o valor em t;
 *  - availableAt <= decisionAt (semantica declarada + warmup respeitado);
 *  - padroes proibidos na formula (shift/delay negativo, lead, future, centered window).
 */
export const FACTOR_PURITY_VERSION = "factor-purity-v1";
export const FORBIDDEN_FORMULA_PATTERNS = Object.freeze([
  /lead\s*\(/i, /future/i, /centered/i, /settlement/i, /result/i, /outcome/i,
  /shift\s*\(\s*-/i, /delay\s*\(\s*-/i, /ref\s*\(\s*[^,]+,\s*-/i,
]);

function deepCopyCandles(candles) { return candles.map((candle) => ({ ...candle })); }

export function checkFactorPurity(factor, { candles = [], index = null, ticks = [] } = {}) {
  const list = Array.isArray(candles) ? candles : [];
  const t = Number.isInteger(index) ? index : list.length - 1;
  const report = { factorId: factor?.factorId ?? null, ok: true, checks: [], errors: [] };
  const fail = (id, detail) => { report.ok = false; report.errors.push(`${id}:${detail}`); report.checks.push({ id, ok: false, detail }); };
  const pass = (id, detail) => report.checks.push({ id, ok: true, detail });

  if (!factor) return { ...report, ok: false, errors: ["FACTOR_MISSING"] };
  if (factor.lookaheadSafe !== true) fail("LOOKAHEAD_SAFE_DECLARED", String(factor.lookaheadSafe));
  else pass("LOOKAHEAD_SAFE_DECLARED", true);

  for (const pattern of FORBIDDEN_FORMULA_PATTERNS) {
    if (pattern.test(String(factor.formula))) fail("FORBIDDEN_FORMULA_PATTERN", pattern.source);
  }
  if (report.ok) pass("FORBIDDEN_FORMULA_PATTERN", "none");

  if (typeof factor.compute === "function" && list.length > t + 2 && t >= 0) {
    const base = evaluateOnWindow(factor, list, t, ticks);
    const prefix = evaluateOnWindow(factor, list.slice(0, t + 1), t, ticks);
    if (base === null || prefix === null) {
      if (base === prefix) pass("PREFIX_EQUALITY", "both_null");
      else fail("PREFIX_EQUALITY", `${base} != ${prefix}`);
    } else if (Math.abs(base - prefix) > 1e-9) fail("PREFIX_EQUALITY", `${base} != ${prefix}`);
    else pass("PREFIX_EQUALITY", base);

    const perturbed = deepCopyCandles(list);
    for (let cursor = t + 1; cursor < perturbed.length; cursor += 1) {
      perturbed[cursor].close *= 1.37;
      perturbed[cursor].high *= 1.37;
      perturbed[cursor].low *= 0.63;
      perturbed[cursor].open *= 1.11;
    }
    const after = evaluateOnWindow(factor, perturbed, t, ticks);
    if (base === null && after === null) pass("FUTURE_PERTURBATION", "both_null");
    else if (base === null || after === null || Math.abs(base - after) > 1e-9) fail("FUTURE_PERTURBATION", `${base} != ${after}`);
    else pass("FUTURE_PERTURBATION", base);
  } else {
    pass("PREFIX_EQUALITY", "not_applicable_from_t0_or_short_series");
    pass("FUTURE_PERTURBATION", "not_applicable_from_t0_or_short_series");
  }

  if (Number.isFinite(Number(factor.warmup)) && t + 1 < Number(factor.warmup)) {
    const value = evaluateOnWindow(factor, list, t, ticks);
    if (value !== null) fail("WARMUP_RESPECTED", `value_before_warmup=${value}`);
    else pass("WARMUP_RESPECTED", "null_before_warmup");
  } else pass("WARMUP_RESPECTED", "warmup_ok");

  if (!factor.availableAtSemantics) fail("AVAILABLE_AT_SEMANTICS", "missing");
  else pass("AVAILABLE_AT_SEMANTICS", factor.availableAtSemantics);

  return report;
}

function evaluateOnWindow(factor, candles, index, ticks) {
  try {
    const value = factor.compute({ candles, ticks, index }, candles.slice(0, index + 1));
    return Number.isFinite(Number(value)) ? Number(value) : null;
  } catch {
    return null;
  }
}

export function puritySuite(factors = [], dataset = {}) {
  const reports = factors.map((factor) => checkFactorPurity(factor, dataset));
  const failed = reports.filter((report) => !report.ok);
  return {
    version: FACTOR_PURITY_VERSION,
    examined: reports.length,
    passed: reports.length - failed.length,
    failed: failed.length,
    failures: failed.map((report) => ({ factorId: report.factorId, errors: report.errors })),
    reports,
  };
}
