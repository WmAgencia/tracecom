// forensic.cjs — FASE 1: varredura forense dos 24 repos clonados.
const fs = require("fs");
const path = require("path");
const DIR = "C:/Users/junin/AppData/Local/Temp/opencode/repos";
const OUT = "C:/Users/junin/AppData/Local/Temp/opencode";
const repos = fs.readdirSync(DIR).filter((d) => fs.statSync(path.join(DIR, d)).isDirectory());
const KW = ["buy", "sell", "call", "put", "signal", "predict", "lstm", "gru", "transformer", "dqn", "q_learning", "qlearning", "reinforcement", "random_forest", "RandomForest", "decision_tree", "xgboost", "lightgbm", "regression", "accuracy", "win_rate", "backtest", "iqoption", "iq_option", "mt4", "mt5", "MQL", "websocket", "api_key", "scalping", "support", "resistance", "parabolic", "psar", "rsi", "macd", "bollinger", "stochastic", "ema", "sma", "timeframe", "candle"];
const WEIGHTS = [".h5", ".pkl", ".pt", ".pth", ".onnx", ".joblib", ".ckpt", ".pb", ".zip"];
const out = [];
for (const r of repos) {
  const root = path.join(DIR, r);
  const info = { repo: r, files: 0, bytes: 0, ext: {}, topFiles: [], readme: null, license: null, reqs: [], weights: [], kw: {}, notes: [] };
  const walk = (d, depth) => { if (depth > 3) return; let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { if (e.name === ".git" || e.name === "node_modules" || e.name === "__pycache__") continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, depth + 1); else { try { const st = fs.statSync(p); info.files += 1; info.bytes += st.size; const ext = path.extname(e.name).toLowerCase(); info.ext[ext] = (info.ext[ext] || 0) + 1; if (WEIGHTS.includes(ext)) info.weights.push({ f: path.relative(root, p), kb: Math.round(st.size / 1024) }); if (st.size < 400000 && /\.(py|mq4|mq5|js|ts|ipynb|md|txt|json|yaml|yml|cfg|toml)$/i.test(e.name)) { let c = ""; try { c = fs.readFileSync(p, "utf8"); } catch { } for (const k of KW) { const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"); const m = c.match(re); if (m) info.kw[k] = (info.kw[k] || 0) + m.length; } if (/readme/i.test(e.name) && !info.readme) info.readme = c.slice(0, 2200); if (/^license/i.test(e.name) && !info.license) info.license = c.slice(0, 400); if (/^requirements|^pyproject|^package\.json|environment\.yml/i.test(e.name)) info.reqs.push(e.name); } } catch { } } } };
  walk(root, 0);
  // top source files
  const all = []; const walk2 = (d, depth) => { if (depth > 4) return; let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { if (e.name === ".git" || e.name === "node_modules" || e.name === "__pycache__") continue; const p = path.join(d, e.name); if (e.isDirectory()) walk2(p, depth + 1); else { const ext = path.extname(e.name).toLowerCase(); if ([".py", ".mq4", ".mq5", ".ipynb", ".js", ".ts", ".md"].includes(ext)) { try { all.push({ f: path.relative(root, p), kb: Math.round(fs.statSync(p).size / 1024) }); } catch { } } } } }; walk2(root, 0);
  info.topFiles = all.sort((a, b) => b.kb - a.kb).slice(0, 12);
  out.push(info);
}
fs.writeFileSync(OUT + "/repo-forensics.json", JSON.stringify(out, null, 1));
for (const i of out) {
  const lang = Object.entries(i.ext).sort((a, b) => b[1] - a[1]).slice(0, 4).map((x) => x[0] + ":" + x[1]).join(" ");
  console.log(`\n===== ${i.repo} (${i.files} files, ${(i.bytes / 1048576).toFixed(1)}MB) [${lang}]`);
  console.log(`  license: ${i.license ? i.license.split("\n")[0].slice(0, 80) : "AUSENTE"} | reqs: ${i.reqs.join(",") || "-"}`);
  console.log(`  weights: ${i.weights.length ? i.weights.slice(0, 5).map((w) => w.f + "(" + w.kb + "k)").join(" ") : "NENHUM"}`);
  const topKW = Object.entries(i.kw).sort((a, b) => b[1] - a[1]).slice(0, 8).map((x) => x[0] + ":" + x[1]).join(" ");
  console.log(`  kw: ${topKW}`);
  console.log(`  top: ${i.topFiles.slice(0, 6).map((f) => f.f + "(" + f.kb + "k)").join(" ")}`);
  console.log(`  README: ${(i.readme || "sem readme").replace(/\s+/g, " ").slice(0, 300)}`);
}
