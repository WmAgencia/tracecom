/**
 * RESEARCH MATH — estatistica deterministica sem dependencias externas.
 */
export const RESEARCH_MATH_VERSION = "research-math-v1";

export function mean(values) { const list = clean(values); return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null; }
export function stdev(values, { sample = true } = {}) {
  const list = clean(values);
  if (list.length < 2) return null;
  const avg = mean(list);
  const divisor = sample ? list.length - 1 : list.length;
  return Math.sqrt(list.reduce((sum, value) => sum + (value - avg) ** 2, 0) / divisor);
}
export function percentile(values, fraction) {
  const list = clean(values).sort((a, b) => a - b);
  if (!list.length) return null;
  const index = Math.min(list.length - 1, Math.max(0, Math.ceil(fraction * list.length) - 1));
  return list[index];
}
export function median(values) { return percentile(values, 0.5); }
export function minOf(values) { const list = clean(values); return list.length ? Math.min(...list) : null; }
export function maxOf(values) { const list = clean(values); return list.length ? Math.max(...list) : null; }
export function sum(values) { return clean(values).reduce((a, b) => a + b, 0); }

export function pearson(xs, ys) {
  const x = clean(xs), y = clean(ys);
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i += 1) { const a = x[i] - mx, b = y[i] - my; num += a * b; dx += a * a; dy += b * b; }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export function rank(values) {
  const list = Array.isArray(values) ? values : [];
  const indexed = list.map((value, index) => ({ value: Number.isFinite(Number(value)) ? Number(value) : null, index })).filter((row) => row.value !== null);
  indexed.sort((a, b) => a.value - b.value);
  const ranks = new Array(list.length).fill(null);
  let cursor = 0;
  while (cursor < indexed.length) {
    let end = cursor;
    while (end + 1 < indexed.length && indexed[end + 1].value === indexed[cursor].value) end += 1;
    const average = (cursor + end + 2) / 2;
    for (let i = cursor; i <= end; i += 1) ranks[indexed[i].index] = average;
    cursor = end + 1;
  }
  return ranks;
}

export function spearman(xs, ys) { return pearson(rank(xs), rank(ys)); }

export function wilsonInterval(wins, n, z = 1.96) {
  if (!Number.isFinite(n) || n <= 0) return { low: null, high: null, center: null };
  const p = wins / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denominator;
  return { low: Math.max(0, Number((center - half).toFixed(4))), high: Math.min(1, Number((center + half).toFixed(4))), center: Number(center.toFixed(4)) };
}

export function normalizedPnl(result, payout) {
  const fraction = Number(payout) > 1 ? Number(payout) / 100 : Number(payout);
  if (result === "WIN") return Number.isFinite(fraction) && fraction > 0 ? Number(fraction.toFixed(4)) : 1;
  if (result === "LOSS") return -1;
  return 0;
}

export function expectancy(wins, losses, draws, payout = null) {
  const total = wins + losses + draws;
  if (!total) return null;
  const fraction = Number(payout) > 1 ? Number(payout) / 100 : Number(payout);
  const winPnl = Number.isFinite(fraction) && fraction > 0 ? fraction : 1;
  return Number((((wins * winPnl) - losses) / total).toFixed(4));
}

export function maxDrawdown(pnls = []) {
  let equity = 0, peak = 0, maxDd = 0;
  for (const pnl of clean(pnls)) {
    equity += pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }
  return Number(maxDd.toFixed(4));
}

export function maxLossStreak(results = []) {
  let current = 0, worst = 0;
  for (const result of results) {
    if (result === "LOSS") { current += 1; if (current > worst) worst = current; }
    else if (result === "WIN") current = 0;
  }
  return worst;
}

/** Bootstrap deterministico (LCG interno) sobre resultados para CI95 de WR/expectancy. */
export function bootstrapResults(results = [], { iterations = 1000, seed = 42, statistic = null } = {}) {
  const list = (Array.isArray(results) ? results : []).filter((value) => value === "WIN" || value === "LOSS" || value === "DRAW");
  if (!list.length) return { n: 0, p50: null, low: null, high: null, iterations: 0 };
  const rand = lcg(seed);
  const stats = [];
  for (let index = 0; index < iterations; index += 1) {
    let wins = 0, losses = 0, draws = 0;
    for (let pick = 0; pick < list.length; pick += 1) {
      const value = list[Math.floor(rand() * list.length)];
      if (value === "WIN") wins += 1; else if (value === "LOSS") losses += 1; else draws += 1;
    }
    stats.push(statistic ? statistic({ wins, losses, draws, n: list.length }) : wins / list.length);
  }
  stats.sort((a, b) => a - b);
  return { n: list.length, p50: percentile(stats, 0.5), low: percentile(stats, 0.025), high: percentile(stats, 0.975), iterations };
}

/** Monte Carlo de sequencia: distribuicao de drawdown/streak sobre reamostragem da ordem. */
export function monteCarloSequence(results = [], { iterations = 500, seed = 7, payout = null } = {}) {
  const list = (Array.isArray(results) ? results : []).filter((value) => value === "WIN" || value === "LOSS" || value === "DRAW");
  if (!list.length) return { iterations: 0, maxDrawdownP95: null, maxLossStreakP95: null };
  const rand = lcg(seed);
  const drawdowns = [], streaks = [];
  for (let index = 0; index < iterations; index += 1) {
    const shuffled = [...list];
    for (let cursor = shuffled.length - 1; cursor > 0; cursor -= 1) { const swap = Math.floor(rand() * (cursor + 1)); [shuffled[cursor], shuffled[swap]] = [shuffled[swap], shuffled[cursor]]; }
    drawdowns.push(maxDrawdown(shuffled.map((result) => normalizedPnl(result, payout))));
    streaks.push(maxLossStreak(shuffled));
  }
  return { iterations: iterations, maxDrawdownP95: percentile(drawdowns, 0.95), maxLossStreakP95: percentile(streaks, 0.95), maxDrawdownMedian: percentile(drawdowns, 0.5) };
}

export function mutualInformation(xs, ys, bins = 6) {
  const pairs = [];
  for (let index = 0; index < Math.min(xs.length, ys.length); index += 1) {
    const x = Number(xs[index]), y = Number(ys[index]);
    if (Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y]);
  }
  if (pairs.length < 12) return null;
  const bx = binEdges(pairs.map((row) => row[0]), bins);
  const by = binEdges(pairs.map((row) => row[1]), bins);
  const joint = new Map();
  const cx = new Array(bins).fill(0), cy = new Array(bins).fill(0);
  for (const [x, y] of pairs) {
    const ix = binOf(bx, x), iy = binOf(by, y);
    const key = `${ix}:${iy}`;
    joint.set(key, (joint.get(key) ?? 0) + 1);
    cx[ix] += 1; cy[iy] += 1;
  }
  const n = pairs.length;
  let mi = 0;
  for (const [key, count] of joint) {
    const [ix, iy] = key.split(":").map(Number);
    const pxy = count / n, px = cx[ix] / n, py = cy[iy] / n;
    if (pxy > 0 && px > 0 && py > 0) mi += pxy * Math.log(pxy / (px * py));
  }
  return Number(mi.toFixed(6));
}

export function clusterByCorrelation(labels = [], matrix = [], threshold = 0.8) {
  const clusters = [];
  const assigned = new Map();
  for (let i = 0; i < labels.length; i += 1) {
    if (assigned.has(i)) continue;
    const members = [i];
    assigned.set(i, clusters.length);
    for (let j = i + 1; j < labels.length; j += 1) {
      if (assigned.has(j)) continue;
      const value = matrix[i]?.[j];
      if (Number.isFinite(value) && Math.abs(value) >= threshold) { members.push(j); assigned.set(j, clusters.length); }
    }
    clusters.push({ id: clusters.length, members: members.map((index) => labels[index]), size: members.length });
  }
  return clusters;
}

function clean(values) { return (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite); }
function binEdges(values, bins) {
  const sorted = clean(values).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const edges = [];
  for (let index = 1; index < bins; index += 1) edges.push(percentile(sorted, index / bins));
  return edges;
}
function binOf(edges, value) { let index = 0; while (index < edges.length && value > edges[index]) index += 1; return Math.min(index, Math.max(0, edges.length)); }
export function lcg(seed = 1) { let state = seed >>> 0 || 1; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; }; }
