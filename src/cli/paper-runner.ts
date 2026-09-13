/**
 * Reproducible USD/CAD paper/replay runner.
 *
 * This command deliberately requires a user supplied, chronological OHLC
 * export. It never downloads, interpolates, or fabricates candles. The four
 * phases are a reporting partition of the causal engine output; no broker
 * capability is imported or invoked.
 *
 * Usage: tsx src/cli/paper-runner.ts path/to/usdcad-1m.json [output-dir]
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { runPrequentialExperiment, type ResearchInput, type ResearchTrade } from "../multi-horizon/engine";
import type { MarketCandle } from "../market/model";

const PHASES = [{ id: "A", size: 300 }, { id: "B", size: 300 }, { id: "C", size: 300 }, { id: "D", size: 100 }] as const;
type Input = { symbol?: string; provider?: string; minimumResolutionSeconds?: number; candles?: MarketCandle[] };

function parse(raw: unknown): { input: ResearchInput; candles: MarketCandle[] } {
  const value = raw as Input;
  const rows = Array.isArray(value?.candles) ? value.candles : (Array.isArray((value as any)?.rows) ? (value as any).rows : null);
  if (!rows) throw new Error("INPUT_INVALID: expected { candles: [...] } from a real OHLC export");
  const candles = rows.map((c: any) => ({ ...c, timestamp: Number(c.timestamp), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) }))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (candles.length < 21) throw new Error("INPUT_INSUFFICIENT: at least 21 chronological candles are required");
  if (candles.some((c) => !Number.isFinite(c.timestamp) || ![c.open, c.high, c.low, c.close].every(Number.isFinite))) throw new Error("INPUT_INVALID: non-finite OHLC value");
  if (candles.some((c, i) => i > 0 && c.timestamp <= candles[i - 1]!.timestamp)) throw new Error("INPUT_INVALID: timestamps must be strictly increasing");
  return { candles, input: { provider: value.provider ?? "user-ohcl-export", minimumResolutionSeconds: value.minimumResolutionSeconds ?? 60, series: { [value.symbol ?? "USD/CAD"]: candles }, maxActionable: 1_000 } };
}

function report(trades: readonly ResearchTrade[], source: string) {
  const phases = PHASES.map((phase, i) => { const rows = trades.slice(i ? PHASES.slice(0, i).reduce((n, p) => n + p.size, 0) : 0, PHASES.slice(0, i + 1).reduce((n, p) => n + p.size, 0)); const wins = rows.filter((r) => r.outcome === "WIN").length; return { phase: phase.id, target: phase.size, n: rows.length, wins, losses: rows.filter((r) => r.outcome === "LOSS").length, winRate: rows.length ? wins / rows.length : null, firstTimestamp: rows[0]?.timestamp ?? null, lastTimestamp: rows.at(-1)?.timestamp ?? null }; });
  return { schemaVersion: 1, mode: "SHADOW_PAPER_REPLAY", source, symbol: "USD/CAD", phases, total: trades.length, trades, note: "Outcomes derive only from supplied closed OHLC. No orders, prices, or trades were fabricated." };
}

const [file, output = "diagnostic-results/paper/usdcad"] = process.argv.slice(2);
if (!file) throw new Error("USAGE: paper-runner <real-usdcad-1m.json> [output-dir]");
const parsed = parse(JSON.parse(await readFile(file, "utf8")));
const result = runPrequentialExperiment(parsed.input, 60);
if (result.status !== "COMPLETED" || result.trades.length < 1_000) throw new Error(`PAPER_DATA_INSUFFICIENT: engine produced ${result.trades.length}/1000 actionable windows; no partial A/B/C/D report written`);
const payload = report(result.trades.slice(0, 1_000), file);
await mkdir(output, { recursive: true });
await writeFile(`${output}/RUN_USDCAD_REPORT.json`, JSON.stringify(payload, null, 2), "utf8");
await writeFile(`${output}/RUN_USDCAD_REPORT.md`, `# USD/CAD paper replay\n\n- Mode: **SHADOW_PAPER_REPLAY**\n- Source: \`${file}\`\n- No broker orders were sent.\n\n| phase | target | n | wins | losses | WR | first | last |\n|---|---:|---:|---:|---:|---:|---|---|\n${payload.phases.map((p) => `| ${p.phase} | ${p.target} | ${p.n} | ${p.wins} | ${p.losses} | ${p.winRate === null ? "—" : (p.winRate * 100).toFixed(2) + "%"} | ${p.firstTimestamp ?? "—"} | ${p.lastTimestamp ?? "—"} |`).join("\n")}\n`, "utf8");
console.log(JSON.stringify({ status: "COMPLETE", output, phases: payload.phases }, null, 2));
