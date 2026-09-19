/**
 * TIME-SERIES OPERATORS — base para fatores portados (qlib/alpha101/gtja) sobre janelas CAUSAIS.
 *
 * Toda funcao recebe arrays de janela terminando em t (inclusive) e devolve valor em t.
 * NENHUMA funcao olha para indices futuros: shift positivo so existe como lag.
 */
export const OPS_VERSION = "research-ts-ops-v1";

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
export const last = (values) => (Array.isArray(values) && values.length ? values[values.length - 1] : null);
export const shift = (values, periods = 1) => (Array.isArray(values) ? values.slice(0, Math.max(0, values.length - periods)) : []);
export const delta = (values, periods = 1) => {
  const list = Array.isArray(values) ? values.map(num) : [];
  if (list.length <= periods) return null;
  const current = list[list.length - 1], previous = list[list.length - 1 - periods];
  return current === null || previous === null ? null : current - previous;
};
export const pctChange = (values, periods = 1) => {
  const list = Array.isArray(values) ? values.map(num) : [];
  if (list.length <= periods) return null;
  const current = list[list.length - 1], previous = list[list.length - 1 - periods];
  if (current === null || previous === null || previous === 0) return null;
  return current / previous - 1;
};
export const tsMean = (values, window = null) => {
  const list = sliceWindow(values, window).map(num).filter((value) => value !== null);
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
};
export const tsSum = (values, window = null) => {
  const list = sliceWindow(values, window).map(num).filter((value) => value !== null);
  return list.length ? list.reduce((a, b) => a + b, 0) : null;
};
export const tsStd = (values, window = null) => {
  const list = sliceWindow(values, window).map(num).filter((value) => value !== null);
  if (list.length < 2) return null;
  const avg = list.reduce((a, b) => a + b, 0) / list.length;
  return Math.sqrt(list.reduce((sum, value) => sum + (value - avg) ** 2, 0) / list.length);
};
export const tsMax = (values, window = null) => { const list = sliceWindow(values, window).map(num).filter((v) => v !== null); return list.length ? Math.max(...list) : null; };
export const tsMin = (values, window = null) => { const list = sliceWindow(values, window).map(num).filter((v) => v !== null); return list.length ? Math.min(...list) : null; };
export const tsArgMax = (values, window = null) => { const list = sliceWindow(values, window).map(num); const max = Math.max(...list.filter((v) => v !== null)); return max === -Infinity ? null : list.lastIndexOf(max); };
export const tsArgMin = (values, window = null) => { const list = sliceWindow(values, window).map(num); const min = Math.min(...list.filter((v) => v !== null)); return min === Infinity ? null : list.lastIndexOf(min); };
export const tsRank = (values, window = null) => {
  const raw = sliceWindow(values, window).map(num);
  const valid = raw.filter((value) => value !== null);
  if (!valid.length) return null;
  const current = raw[raw.length - 1];
  if (current === null) return null;
  return valid.filter((value) => value <= current).length / valid.length;
};
export const tsCorr = (xs, ys, window = null) => {
  const a = sliceWindow(xs, window).map(num), b = sliceWindow(ys, window).map(num);
  const pairs = [];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) if (a[index] !== null && b[index] !== null) pairs.push([a[index], b[index]]);
  if (pairs.length < 3) return null;
  const mx = pairs.reduce((sum, row) => sum + row[0], 0) / pairs.length;
  const my = pairs.reduce((sum, row) => sum + row[1], 0) / pairs.length;
  let num_ = 0, dx = 0, dy = 0;
  for (const [x, y] of pairs) { num_ += (x - mx) * (y - my); dx += (x - mx) ** 2; dy += (y - my) ** 2; }
  if (dx === 0 || dy === 0) return null;
  return num_ / Math.sqrt(dx * dy);
};
export const tsCov = (xs, ys, window = null) => {
  const a = sliceWindow(xs, window).map(num), b = sliceWindow(ys, window).map(num);
  const pairs = [];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) if (a[index] !== null && b[index] !== null) pairs.push([a[index], b[index]]);
  if (pairs.length < 2) return null;
  const mx = pairs.reduce((sum, row) => sum + row[0], 0) / pairs.length;
  const my = pairs.reduce((sum, row) => sum + row[1], 0) / pairs.length;
  return pairs.reduce((sum, [x, y]) => sum + (x - mx) * (y - my), 0) / pairs.length;
};
export const tsSlope = (values, window = null) => {
  const list = sliceWindow(values, window).map(num);
  const pairs = list.map((value, index) => [index, value]).filter(([, value]) => value !== null);
  if (pairs.length < 3) return null;
  const n = pairs.length;
  const sumX = pairs.reduce((sum, row) => sum + row[0], 0);
  const sumY = pairs.reduce((sum, row) => sum + row[1], 0);
  const sumXY = pairs.reduce((sum, row) => sum + row[0] * row[1], 0);
  const sumXX = pairs.reduce((sum, row) => sum + row[0] ** 2, 0);
  const denominator = n * sumXX - sumX * sumX;
  return denominator === 0 ? null : (n * sumXY - sumX * sumY) / denominator;
};
export const tsRSquare = (values, window = null) => {
  const list = sliceWindow(values, window).map(num);
  const pairs = list.map((value, index) => [index, value]).filter(([, value]) => value !== null);
  if (pairs.length < 3) return null;
  const n = pairs.length;
  const sumX = pairs.reduce((sum, row) => sum + row[0], 0);
  const sumY = pairs.reduce((sum, row) => sum + row[1], 0);
  const sumXY = pairs.reduce((sum, row) => sum + row[0] * row[1], 0);
  const sumXX = pairs.reduce((sum, row) => sum + row[0] ** 2, 0);
  const sumYY = pairs.reduce((sum, row) => sum + row[1] ** 2, 0);
  const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
  if (denominator === 0) return null;
  const r = (n * sumXY - sumX * sumY) / denominator;
  return r * r;
};
export const tsResidual = (values, window = null) => {
  const list = sliceWindow(values, window).map(num);
  const pairs = list.map((value, index) => [index, value]).filter(([, value]) => value !== null);
  if (pairs.length < 3) return null;
  const n = pairs.length;
  const sumX = pairs.reduce((sum, row) => sum + row[0], 0);
  const sumY = pairs.reduce((sum, row) => sum + row[1], 0);
  const sumXY = pairs.reduce((sum, row) => sum + row[0] * row[1], 0);
  const sumXX = pairs.reduce((sum, row) => sum + row[0] ** 2, 0);
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const currentX = pairs[pairs.length - 1][0], currentY = pairs[pairs.length - 1][1];
  return currentY - (slope * currentX + intercept);
};
export const tsQuantile = (values, fraction, window = null) => {
  const list = sliceWindow(values, window).map(num).filter((value) => value !== null).sort((a, b) => a - b);
  if (!list.length) return null;
  const index = Math.min(list.length - 1, Math.max(0, Math.ceil(fraction * list.length) - 1));
  return list[index];
};
export const tsCount = (values, window = null, predicate = (value) => value > 0) => sliceWindow(values, window).map(num).filter((value) => value !== null && predicate(value)).length;
export const tsDecayLinear = (values, window = null) => {
  const list = sliceWindow(values, window).map(num).filter((value) => value !== null);
  if (!list.length) return null;
  let weightSum = 0, weighted = 0;
  for (let index = 0; index < list.length; index += 1) { const weight = index + 1; weighted += list[index] * weight; weightSum += weight; }
  return weighted / weightSum;
};
export const signedPower = (value, exponent = 2) => (num(value) === null ? null : Math.sign(value) * Math.abs(value) ** exponent);

function sliceWindow(values, window) {
  const list = Array.isArray(values) ? values : [];
  if (!Number.isFinite(Number(window)) || Number(window) <= 0) return list;
  return list.slice(-Number(window));
}
