/**
 * OTC_BLACKBOX_LAB_V1 — deterministic feature export and hypothesis registry.
 * Read-only: consumes the archived Blitz candles and never calls trading tools.
 */
import fs from "node:fs/promises";

const input = process.argv[2] ?? "data/otc-lab/raw/blitz-eurusd-otc-1m-live.json";
const output = process.argv[3] ?? "data/otc-lab/analysis/blitz-eurusd-otc-1m-features.json";
const rows = JSON.parse(await fs.readFile(input, "utf8")).candles
  .map((r) => ({ at: Date.parse(r.to), open: +r.open, high: +r.max, low: +r.min, close: +r.close }))
  .filter((r) => Number.isFinite(r.at) && [r.open, r.high, r.low, r.close].every(Number.isFinite))
  .sort((a, b) => a.at - b.at);

const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const sd = (a) => { const m = mean(a); return m == null ? null : Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const rsi = (closes, n = 14) => { if (closes.length <= n) return null; const d = []; for (let i = 1; i < closes.length; i++) d.push(closes[i] - closes[i - 1]); const g = mean(d.slice(-n).map((x) => Math.max(0, x))); const l = mean(d.slice(-n).map((x) => Math.max(0, -x))); return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
const atr = (series, n = 14) => { if (series.length <= n) return null; const tr = []; for (let i = 1; i < series.length; i++) tr.push(Math.max(series[i].high - series[i].low, Math.abs(series[i].high - series[i - 1].close), Math.abs(series[i].low - series[i - 1].close))); return mean(tr.slice(-n)); };
const featureRows = [];
for (let i = 30; i < rows.length - 5; i++) {
  const past = rows.slice(0, i + 1); const closes = past.map((r) => r.close); const w = closes.slice(-20); const m = mean(w); const s = sd(w); const future = rows[i + 5].close - rows[i].close;
  featureRows.push({ at: rows[i].at, close: rows[i].close, rsi14: rsi(closes), atr14: atr(past), bbMid20: m, bbUpper20: m == null || s == null ? null : m + 2 * s, bbLower20: m == null || s == null ? null : m - 2 * s, return1m: (rows[i].close - rows[i - 1].close) / rows[i - 1].close, target5m: future > 0 ? "UP" : future < 0 ? "DOWN" : "FLAT" });
}
const hypotheses = [
  { id: "H1", name: "momentum", test: "RSI/retornos recentes explicam T+300s", falsifier: "coeficiente fora da amostra compatível com zero" },
  { id: "H2", name: "reversion", test: "distância à Bollinger prevê retorno contrário", falsifier: "sinal muda entre blocos temporais" },
  { id: "H3", name: "volatility-regime", test: "ATR/volatilidade muda a distribuição UP/DOWN", falsifier: "calibração não melhora o baseline" },
  { id: "H4", name: "periodicity", test: "fase/minuto do relógio altera a distribuição", falsifier: "efeito desaparece no holdout" },
  { id: "H5", name: "gateway-common-source", test: "Blitz e Binary são séries independentes", falsifier: "concordância permanece próxima de 100%" },
  { id: "H6", name: "nonstationarity", test: "parâmetros mudam por regime", falsifier: "walk-forward não detecta drift" }
];
const payload = { lab: "OTC_BLACKBOX_LAB_V1", product: "blitz", assetId: 76, input, generatedAt: new Date().toISOString(), rows: featureRows, hypotheses, methodology: { causal: true, horizonSeconds: 300, split: "chronological 60/20/20 + 300s embargo", execution: "NONE" } };
await fs.mkdir("data/otc-lab/analysis", { recursive: true });
await fs.writeFile(output, JSON.stringify(payload, null, 2) + "\n");
console.log(JSON.stringify({ input, output, candles: rows.length, features: featureRows.length, hypotheses: hypotheses.length }));
