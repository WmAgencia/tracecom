import fs from "node:fs/promises";

const horizon = 300_000;
const entropy = (values) => { const n = values.length; const counts = new Map(); for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1); return [...counts.values()].reduce((sum, count) => { const p = count / n; return sum - p * Math.log2(p); }, 0); };
const autocorr = (values, lag) => { if (values.length <= lag + 2) return null; const mean = values.reduce((a, b) => a + b, 0) / values.length; let num = 0; let den = 0; for (const value of values) den += (value - mean) ** 2; for (let i = lag; i < values.length; i += 1) num += (values[i] - mean) * (values[i - lag] - mean); return den ? num / den : null; };
const analyse = async (file) => {
  const source = JSON.parse(await fs.readFile(file, "utf8"));
  const candles = source.candles.map((row) => ({ ...row, at: Date.parse(row.to), close: Number(row.close) })).sort((a, b) => a.at - b.at);
  const labels = [];
  for (let i = 0; i < candles.length; i += 1) { const target = candles[i].at + horizon; const future = candles.find((row, j) => j >= i && row.at >= target); if (!future) continue; const delta = future.close - candles[i].close; labels.push({ at: candles[i].at, direction: Math.abs(delta) < 1e-10 ? "FLAT" : delta > 0 ? "UP" : "DOWN", close: candles[i].close, future: future.close }); }
  const dirs = labels.filter((row) => row.direction !== "FLAT").map((row) => row.direction);
  const returns = candles.slice(1).map((row, i) => (row.close - candles[i].close) / candles[i].close);
  const transitions = { UP_UP: 0, UP_DOWN: 0, DOWN_UP: 0, DOWN_DOWN: 0 };
  for (let i = 1; i < dirs.length; i += 1) transitions[`${dirs[i - 1]}_${dirs[i]}`] += 1;
  let runs = [], previous = null, length = 0;
  for (const value of dirs) { if (value !== previous) { if (length) runs.push(length); previous = value; length = 1; } else length += 1; }
  if (length) runs.push(length);
  const trainEnd = Math.floor(labels.length * 0.6), validationEnd = Math.floor(labels.length * 0.8);
  const segment = (rows) => { const up = rows.filter((r) => r.direction === "UP").length; const down = rows.filter((r) => r.direction === "DOWN").length; return { n: rows.length, up, down, flat: rows.length - up - down, alwaysUp: rows.length ? up / rows.length : null, alwaysDown: rows.length ? down / rows.length : null }; };
  return { product: source.product, asset: source.assetName, period: { from: candles[0]?.from, to: candles.at(-1)?.to }, candles: candles.length, labels: labels.length, distribution: segment(labels), temporal: { train: segment(labels.slice(0, trainEnd)), validation: segment(labels.slice(trainEnd, validationEnd)), test: segment(labels.slice(validationEnd)), embargoMs: horizon, chronological: true }, returnAutocorrelation: Object.fromEntries([1, 2, 3, 5, 10, 20, 60].map((lag) => [`lag${lag}`, autocorr(returns, lag)])), labelEntropyBits: entropy(dirs), transitions, meanRunLength: runs.length ? runs.reduce((a, b) => a + b, 0) / runs.length : null, maxRunLength: runs.length ? Math.max(...runs) : null, execution: "NONE", synthetic: false };
};
const report = { generatedAt: new Date().toISOString(), lab: "OTC_BLACKBOX_LAB_V1", products: [await analyse("data/otc-lab/raw/binary-eurusd-otc.json"), await analyse("data/otc-lab/raw/blitz-eurusd-otc.json")] };
console.log(JSON.stringify(report, null, 2));
