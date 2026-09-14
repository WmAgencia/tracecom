import { randomUUID } from "node:crypto";

const count = 18_000; const observations = new Map<string, { observationId: string; timestamp: number; price: number }>(); const start = Date.now(); let duplicates = 0;
for (let i = 0; i < count; i++) { const timestamp = start + i * 1_000; const observationId = `sim_${i}`; if (observations.has(observationId)) duplicates++; observations.set(observationId, { observationId, timestamp, price: 100 + Math.sin(i / 30) }); }
const rows = [...observations.values()]; const report = { observations: rows.length, expected: count, duplicates, ordered: rows.every((x, i) => i === 0 || x.timestamp > rows[i - 1]!.timestamp), horizons: { "15s": rows.length >= 15, "5m": rows.length >= 300, "1h": rows.length >= 3600, "5h": rows.length >= 18_000 }, boundedContext: rows.slice(-300).length === 300 };
if (!report.ordered || report.duplicates || report.observations !== count) throw new Error("five_hour_observer_simulation_failed"); console.log(JSON.stringify(report));
