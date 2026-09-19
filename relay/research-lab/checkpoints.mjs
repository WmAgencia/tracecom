/**
 * CHECKPOINTS V4 — relatorios automaticos por N de settlements DIRECIONAIS (30/60/100/200/500).
 * WAIT/NO_TRADE nunca entram no denominador do WR; coverage e mostrado em separado.
 */
import { buildSnapshotMeta } from "./snapshot.mjs";
import { wilsonInterval, expectancy, mean, normalizedPnl, maxDrawdown, maxLossStreak, bootstrapResults } from "./math.mjs";
import { evidenceQualityOf } from "./registries.mjs";

export const CHECKPOINTS_VERSION = "v4-checkpoints-v1";
export const CHECKPOINT_LEVELS = Object.freeze([30, 60, 100, 200, 500]);

export function v4DirectionalCheckpoints(rows = [], { levels = CHECKPOINT_LEVELS, source = "PROSPECTIVE_SHADOW", datasetVersion = null } = {}) {
  const directional = rows.filter((row) => (row.direction === "BUY" || row.direction === "SELL") && ["WIN", "LOSS", "DRAW"].includes(row.theoreticalResult ?? row.result));
  const ordered = [...directional].sort((a, b) => Number(a.createdAt ?? a.at ?? 0) - Number(b.createdAt ?? b.at ?? 0));
  const checkpoints = levels.map((level) => {
    const slice = ordered.slice(0, level);
    const complete = ordered.length >= level;
    const wins = slice.filter((row) => (row.theoreticalResult ?? row.result) === "WIN").length;
    const losses = slice.filter((row) => (row.theoreticalResult ?? row.result) === "LOSS").length;
    const draws = slice.filter((row) => (row.theoreticalResult ?? row.result) === "DRAW").length;
    const payouts = slice.map((row) => Number(row.payout)).filter(Number.isFinite);
    const pnls = slice.map((row) => normalizedPnl(row.theoreticalResult ?? row.result, row.payout));
    return {
      level, complete, n: slice.length, wins, losses, draws,
      wr: slice.length ? Number((wins / slice.length).toFixed(4)) : null,
      ci95: wilsonInterval(wins, slice.length),
      expectancy: expectancy(wins, losses, draws, payouts.length ? mean(payouts) : null),
      normalizedPnl: Number(pnls.reduce((sum, value) => sum + value, 0).toFixed(4)),
      maxDrawdown: maxDrawdown(pnls),
      maxLossStreak: maxLossStreak(slice.map((row) => row.theoreticalResult ?? row.result)),
      payoutCoverage: slice.length ? Number((payouts.length / slice.length).toFixed(4)) : null,
      evidenceQuality: evidenceQualityOf({ nDecided: wins + losses, prospective: true }),
      precisionWarning: wins + losses < 30 ? "N pequeno: baixa precisao" : null,
    };
  });
  const waits = rows.filter((row) => row.finalAction === "WAIT" || row.finalAction === "NO_TRADE");
  return {
    version: CHECKPOINTS_VERSION, source, datasetVersion,
    snapshot: buildSnapshotMeta({ asOf: Date.now(), windowStart: ordered[0]?.createdAt ?? null, windowEnd: ordered.at(-1)?.createdAt ?? null, n: ordered.length, source, datasetVersion, note: "Settlement DIRECIONAL apenas; WAIT exibido separado." }),
    directionalSettlements: ordered.length,
    waitObservations: waits.length,
    coverage: { totalObservations: rows.length, directionalSettlements: ordered.length, waitObservations: waits.length, coverageRate: rows.length ? Number((ordered.length / rows.length).toFixed(4)) : null },
    bootstrap: bootstrapResults(ordered.map((row) => row.theoreticalResult ?? row.result), { iterations: 1000 }),
    checkpoints,
    nextCheckpoint: levels.find((level) => level > ordered.length) ?? null,
    researchOnly: true, controlsExecution: false,
  };
}
