import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const url = "https://query1.finance.yahoo.com/v8/finance/chart/USDCAD=X?interval=1m&range=8d&includePrePost=false&events=div%2Csplits";
const response = await fetch(url, { headers: { "User-Agent": "tracecon/0.2" } });
if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`);
const payload = await response.json();
const result = payload?.chart?.result?.[0];
const quote = result?.indicators?.quote?.[0];
if (!result?.timestamp || !quote) throw new Error("Yahoo payload missing timestamps/quote");

const rows = [];
for (let i = 0; i < result.timestamp.length; i += 1) {
  const timestamp = Number(result.timestamp[i]) * 1000;
  const open = Number(quote.open?.[i]);
  const high = Number(quote.high?.[i]);
  const low = Number(quote.low?.[i]);
  const close = Number(quote.close?.[i]);
  if (![timestamp, open, high, low, close].every(Number.isFinite)) continue;
  if (high < Math.max(open, close) || low > Math.min(open, close) || low > high) throw new Error(`Invalid OHLC at ${timestamp}`);
  rows.push({ timestamp, open, high, low, close });
}
rows.sort((a, b) => a.timestamp - b.timestamp);
const unique = rows.filter((row, i) => i === 0 || row.timestamp !== rows[i - 1].timestamp);
const gaps = [];
for (let i = 1; i < unique.length; i += 1) {
  const delta = unique[i].timestamp - unique[i - 1].timestamp;
  if (delta !== 60_000) gaps.push({ from: unique[i - 1].timestamp, to: unique[i].timestamp, minutes: delta / 60_000 });
}
const output = {
  schema: "tracecon.real-ohlc.v1",
  symbol: "USD/CAD",
  yahooSymbol: "USDCAD=X",
  timeframe: "1m",
  source: "Yahoo Finance Chart API",
  sourceUrl: url,
  retrievedAt: new Date().toISOString(),
  timezone: result.meta?.exchangeTimezoneName ?? "unknown",
  timestamps: "Unix milliseconds, UTC",
  rows: unique,
  validation: { rawRows: rows.length, uniqueRows: unique.length, gaps, noSyntheticFields: true },
};
if (unique.length < 1000) throw new Error(`Only ${unique.length} valid rows; need at least 1000`);
await mkdir("data/real", { recursive: true });
const serialized = `${JSON.stringify(output, null, 2)}\n`;
await writeFile("data/real/usdcad-1m-8d.json", serialized, "utf8");
console.log(JSON.stringify({ output: "data/real/usdcad-1m-8d.json", rows: unique.length, gaps: gaps.length, sha256: createHash("sha256").update(serialized).digest("hex"), source: output.source }, null, 2));
