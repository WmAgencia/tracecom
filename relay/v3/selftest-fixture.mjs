/**
 * V3 — FIXTURE SINTETICA DE SELFTEST (deterministica; nunca usada em decisao real).
 * Permite medir a latencia real dos agentes mesmo com todos os mercados suspensos.
 */
export const V3_SELFTEST_FIXTURE_VERSION = "v3-selftest-fixture-v1";

export function syntheticSeries({ candles = 120, base = 1.35 } = {}) {
  const closes = Array.from({ length: candles }, (_, index) => base + index * 0.00005 + Math.sin(index / 5) * 0.0004);
  return closes.map((close, index) => {
    const previous = index === 0 ? close : closes[index - 1];
    const open = close - (close - previous) * 0.3;
    return { at: index * 5_000, open, high: Math.max(open, close) + 0.0004, low: Math.min(open, close) - 0.0004, close };
  });
}
