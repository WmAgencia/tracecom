/** Causal hypothesis backtest. No execution, no look-ahead, no credentials. */
import fs from "node:fs/promises";

const files = process.argv.slice(2);
const inputs = files.length ? files : ["data/otc-lab/raw/blitz-eurusd-otc.json", "data/otc-lab/raw/blitz-eurusd-otc-1m-live.json"];
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const sd = a => { const m = mean(a); return m == null ? null : Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
function indicators(s, i) { const c = s.slice(0, i + 1).map(x => x.close); const w = c.slice(-20); const m = mean(w), st = sd(w); const d = []; for (let j = 1; j < c.length; j++) d.push(c[j] - c[j - 1]); const q = d.slice(-14); const up = mean(q.map(x => Math.max(0, x))) ?? 0, dn = mean(q.map(x => Math.max(0, -x))) ?? 0; const rsi = dn === 0 ? 100 : 100 - 100 / (1 + up / dn); const ret = c.length > 5 ? (c.at(-1) - c.at(-6)) / c.at(-6) : 0; return { rsi, ret, z: st ? (c.at(-1) - m) / st : 0, width: m ? (2 * (st ?? 0)) / m : 0 }; }
const predictors = {
  alwaysUp: () => "UP", alwaysDown: () => "DOWN",
  momentum: x => x.ret > 0 ? "UP" : x.ret < 0 ? "DOWN" : "WAIT",
  reversion: x => x.z > 1 ? "DOWN" : x.z < -1 ? "UP" : "WAIT",
  rsi: x => x.rsi > 60 ? "UP" : x.rsi < 40 ? "DOWN" : "WAIT",
  volatility: x => x.width > 0.002 ? (x.ret > 0 ? "UP" : "DOWN") : "WAIT"
};
function evaluate(series, horizonMs, name, fn, proxy = false) { const out = { file: series.file, hypothesis: name, horizonSeconds: horizonMs / 1000, evaluation: proxy ? "proxy_first_close_at_or_after_horizon" : "exact_first_close_at_or_after_horizon", candleSpacingSeconds: series.spacing / 1000, n: 0, wins: 0, losses: 0, waits: 0, accuracy: null }; const byAt = series.rows; for (let i = 40; i < byAt.length; i++) { const signal = fn(indicators(byAt, i)); if (signal === "WAIT") { out.waits++; continue; } const target = byAt.find((r, j) => j > i && r.at >= byAt[i].at + horizonMs); if (!target) continue; const win = signal === "UP" ? target.close > byAt[i].close : target.close < byAt[i].close; out.n++; win ? out.wins++ : out.losses++; } out.accuracy = out.n ? out.wins / out.n : null; return out; }
const results = [];
for (const file of inputs) { const raw = JSON.parse(await fs.readFile(file, "utf8")); const rows = raw.candles.map(r => ({ at: Date.parse(r.to), close: +r.close })).filter(r => Number.isFinite(r.at) && Number.isFinite(r.close)).sort((a,b) => a.at - b.at); const spacing = rows.length > 1 ? mean(rows.slice(1).map((r,i) => r.at - rows[i].at)) : null; const series = { file, rows, spacing }; for (const horizon of [45_000, 300_000]) for (const [name, fn] of Object.entries(predictors)) results.push(evaluate(series, horizon, name, fn, horizon < (spacing ?? Infinity))); }
const report = { generatedAt: new Date().toISOString(), lab: "OTC_BLACKBOX_LAB_V1", methodology: "causal close-to-close; WAIT excluded from accuracy; stride result reduces overlapping labels", results };
await fs.mkdir("data/otc-lab/analysis", { recursive: true }); await fs.writeFile("data/otc-lab/analysis/blitz-hypothesis-backtest.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
