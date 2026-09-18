import fs from "node:fs";
import { extractFeatures, evaluateShadowArms, triggerStrength, fitLogistic } from "../relay/trade-quality.mjs";
const raw = JSON.parse(fs.readFileSync("audit-g2-data.json", "utf8"));
const executions = new Map((raw.executions ?? []).map((row) => [row.execution_id, row]));
const rows = [];
for (const row of raw.journal ?? []) {
  const payload = row.payload ?? {};
  if (payload.snapshotSource !== "T0_DECISION_SNAPSHOT") continue;
  if (!["WIN", "LOSS", "DRAW"].includes(row.result)) continue;
  const execution = executions.get(row.trade_id) ?? null;
  const timing = { ...(payload.entryTiming ?? {}), entryPrice: Number(execution?.entry_price ?? execution?.meta?.causal?.entry ?? null), candidatePrice: Number(payload.snapshot?.price ?? null) };
  const features = extractFeatures({ tradeId: row.trade_id, marketKey: row.market_key, marketType: row.market_type, direction: row.direction, settlementAt: Date.parse(row.settlement_at), stake: row.stake, payout: row.payout, result: row.result, snapshot: payload.snapshot }, timing);
  Object.assign(features, { result: row.result, normalizedPnl: row.result === "WIN" ? 1 : row.result === "LOSS" ? -1 : 0, marketKey: row.market_key });
  rows.push(features);
}
console.log("rows", rows.length, "snapshot keys sample", JSON.stringify(Object.keys(raw.journal.find((r) => r.payload?.snapshotSource === "T0_DECISION_SNAPSHOT").payload.snapshot)));
console.log(JSON.stringify(rows[0], null, 1));
const nullCounts = {};
for (const key of Object.keys(rows[0])) nullCounts[key] = rows.filter((r) => r[key] === null || r[key] === undefined).length;
console.log("nulls:", JSON.stringify(nullCounts));
const strengths = rows.map((r) => triggerStrength(r));
console.log("triggerStrength:", strengths.map((s) => s.score).join(","));
console.log("critic verdicts:", rows.map((r) => r.criticVerdict).join(","));
console.log("riskFlags:", JSON.stringify(rows.map((r) => r.criticRiskFlags)));
console.log("arms:", JSON.stringify(rows.map((r) => Object.fromEntries(Object.entries(evaluateShadowArms(r))))));
const model = fitLogistic(rows, ["rsi", "adx", "atrRatio", "donchianPosition", "bodyRatio", "acceleration", "directionChanges", "entryDisplacementATR", "traderConfidence", "evidenceCount", "contradictionCount"]);
console.log("model:", JSON.stringify(model));
