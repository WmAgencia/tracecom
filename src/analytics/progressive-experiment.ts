import { wilsonInterval } from "../backtest/probability";

export type ExperimentOutcome = "WIN" | "LOSS" | "DRAW" | "UNKNOWN";

export interface ShadowObservation {
  readonly signalId: string;
  readonly runId: string;
  readonly decision: "BUY" | "SELL" | "WAIT";
  readonly outcome: ExperimentOutcome;
  readonly signature: string | null;
  readonly asset?: string | null;
  readonly domain?: string | null;
  readonly session?: string | null;
  readonly regime?: string | null;
}

export interface RunSummary {
  readonly runId: string;
  readonly evaluated: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly unknown: number;
  readonly waitRate: number;
  readonly winRate: number | null;
  readonly byDecision: Readonly<Record<string, { readonly n: number; readonly wins: number; readonly winRate: number | null }>>;
}

export interface A80Signature {
  readonly signatureId: string;
  readonly conditions: readonly string[];
  readonly n: number;
  readonly wins: number;
  readonly losses: number;
  readonly wr: number;
  readonly wilson: ReturnType<typeof wilsonInterval>;
  readonly support: number;
  readonly lift: number | null;
  readonly oddsRatio: number | null;
  readonly decision: string | null;
  readonly asset: string | null;
  readonly domain: string | null;
  readonly session: string | null;
  readonly regime: string | null;
  readonly evidence: "TINY_SAMPLE" | "LOW_SAMPLE" | "PROMISING" | "STRONGER_EVIDENCE";
}

const evaluated = (o: ShadowObservation) => o.outcome === "WIN" || o.outcome === "LOSS";

export function summarizeRun(runId: string, observations: readonly ShadowObservation[]): RunSummary {
  const run = observations.filter((o) => o.runId === runId);
  const valid = run.filter(evaluated);
  const wins = valid.filter((o) => o.outcome === "WIN").length;
  const decisions = ["BUY", "SELL"] as const;
  const byDecision = Object.fromEntries(decisions.map((decision) => {
    const rows = valid.filter((o) => o.decision === decision);
    const w = rows.filter((o) => o.outcome === "WIN").length;
    return [decision, { n: rows.length, wins: w, winRate: rows.length ? w / rows.length : null }];
  }));
  return { runId, evaluated: valid.length, wins, losses: valid.length - wins, draws: run.filter((o) => o.outcome === "DRAW").length, unknown: run.filter((o) => o.outcome === "UNKNOWN").length, waitRate: run.length ? run.filter((o) => o.decision === "WAIT").length / run.length : 0, winRate: valid.length ? wins / valid.length : null, byDecision };
}

export function mineA80Signatures(observations: readonly ShadowObservation[], opts: { readonly runId?: string; readonly minimumSupport?: number; readonly baseline?: number } = {}): readonly A80Signature[] {
  const rows = observations.filter((o) => (!opts.runId || o.runId === opts.runId) && evaluated(o) && o.signature && o.decision !== "WAIT");
  const baseline = opts.baseline ?? (rows.length ? rows.filter((o) => o.outcome === "WIN").length / rows.length : 0);
  // Never permit a tiny post-hoc group to qualify as A80 evidence.
  const min = Math.max(10, opts.minimumSupport ?? 10);
  const groups = new Map<string, ShadowObservation[]>();
  for (const row of rows) groups.set(row.signature!, [...(groups.get(row.signature!) ?? []), row]);
  return [...groups.entries()].flatMap(([signatureId, group]) => {
    const wins = group.filter((o) => o.outcome === "WIN").length;
    const n = group.length;
    const wr = wins / n;
    if (n < min || wr < 0.8) return [];
    const losses = n - wins;
    const ci = wilsonInterval(wins, n);
    const a = wins + 0.5; const b = losses + 0.5;
    const rest = rows.filter((o) => o.signature !== signatureId);
    const restWins = rest.filter((o) => o.outcome === "WIN").length;
    const restLosses = rest.length - restWins;
    return [{ signatureId, conditions: signatureId.split(":").filter(Boolean), n, wins, losses, wr, wilson: ci, support: n / Math.max(1, rows.length), lift: baseline ? wr / baseline : null, oddsRatio: rest.length ? (a / b) / ((restWins + 0.5) / (restLosses + 0.5)) : null, decision: group[0]!.decision, asset: group[0]!.asset ?? null, domain: group[0]!.domain ?? null, session: group[0]!.session ?? null, regime: group[0]!.regime ?? null, evidence: (n >= 50 && ci.lower >= 0.8 ? "STRONGER_EVIDENCE" : n >= 20 ? "PROMISING" : "LOW_SAMPLE") as A80Signature["evidence"] }];
  }).sort((a, b) => b.wr - a.wr || b.n - a.n);
}

export function compareRuns(a: readonly ShadowObservation[], b: readonly ShadowObservation[], candidates: readonly A80Signature[]) {
  return candidates.map((candidate) => {
    const stats = (rows: readonly ShadowObservation[]) => { const matching = rows.filter((o) => o.signature === candidate.signatureId && evaluated(o)); const wins = matching.filter((o) => o.outcome === "WIN").length; return { n: matching.length, wins, wr: matching.length ? wins / matching.length : null }; };
    const runA = stats(a); const runB = stats(b); const total = stats([...a, ...b]);
    return { signatureId: candidate.signatureId, runA, runB, combined: total, promoted: runB.n >= 10 && (runB.wr ?? 0) >= 0.8 };
  });
}
