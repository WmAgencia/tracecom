/** AUTO — politica deterministica e conservadora de escolha entre variantes congeladas.
 *
 * Nunca inventa estrategia, nunca retuna parametros. Regras:
 *  1. elegibilidade minima: independent N >= AUTO_MIN_INDEPENDENT_N;
 *  2. WR liquido >= breakeven (52.91%) + margem (AUTO_MIN_EDGE_PP);
 *  3. maior Wilson lower bound (95%) = mais estavel, nao apenas WR maximo;
 *  4. empate tecnico (delta <= AUTO_TIE_DELTA) => maior N; depois ordem canonica.
 * Sem candidato elegivel: mantem a selecao atual (nunca "churna").
 * Toda troca gera audit (oldStrategy/newStrategy/reason/metrics/timestamp).
 */
import { FROZEN_VARIANTS, isValidVariant, type FrozenFamily } from "./frozen.js";
import { makeSelection, type StrategySelection } from "./selection.js";

export const AUTO_BREAKEVEN_WR = 52.91;
export const AUTO_MIN_EDGE_PP = 2.0;
export const AUTO_MIN_INDEPENDENT_N = 30;
export const AUTO_TIE_DELTA = 0.005;

export interface VariantStats {
  family: FrozenFamily;
  horizonSeconds: number;
  wins: number;
  losses: number;
  draws: number;
  independentN: number;
  independentWins: number;
  independentLosses: number;
}

export interface AutoChoice {
  changed: boolean;
  selection: StrategySelection;
  reason: string;
  metrics: Array<{ variantId: string; wr: number | null; n: number; wilsonLower: number | null; eligible: boolean; why: string }>;
}

function wilsonLowerBound(wins: number, n: number): number | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = wins / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return Math.max(0, center - half);
}

export function chooseAutoSelection(stats: readonly VariantStats[], current: StrategySelection, nowIso: string): AutoChoice {
  const evaluated = stats.map((variant) => {
    const decided = variant.independentWins + variant.independentLosses;
    const wr = decided > 0 ? (variant.independentWins / decided) * 100 : null;
    const wilsonLower = wilsonLowerBound(variant.independentWins, decided);
    let eligible = true;
    let why = "ELIGIBLE";
    if (variant.independentN < AUTO_MIN_INDEPENDENT_N) { eligible = false; why = `INDEP_N<${AUTO_MIN_INDEPENDENT_N}`; }
    else if (wr === null) { eligible = false; why = "NO_DECIDED"; }
    else if (wr < AUTO_BREAKEVEN_WR + AUTO_MIN_EDGE_PP) { eligible = false; why = `WR<${(AUTO_BREAKEVEN_WR + AUTO_MIN_EDGE_PP).toFixed(2)}`; }
    return { variant, wr, decided, wilsonLower, eligible, why };
  });
  const eligible = evaluated.filter((entry) => entry.eligible && entry.wilsonLower !== null);
  const metrics = evaluated.map((entry) => ({
    variantId: `${entry.variant.family}-${entry.variant.horizonSeconds}`,
    wr: entry.wr === null ? null : Number(entry.wr.toFixed(2)),
    n: entry.decided,
    wilsonLower: entry.wilsonLower === null ? null : Number(entry.wilsonLower.toFixed(4)),
    eligible: entry.eligible,
    why: entry.why,
  }));
  if (eligible.length === 0) {
    return { changed: false, selection: { ...current, updatedAt: nowIso, reason: "AUTO_KEEP_NO_ELIGIBLE" }, reason: "AUTO_KEEP_NO_ELIGIBLE", metrics };
  }
  eligible.sort((a, b) => {
    const wilsonDelta = (b.wilsonLower as number) - (a.wilsonLower as number);
    if (Math.abs(wilsonDelta) > AUTO_TIE_DELTA) return wilsonDelta;
    if (b.decided !== a.decided) return b.decided - a.decided;
    const aIndex = FROZEN_VARIANTS.findIndex((variant) => variant.family === a.variant.family && variant.horizonSeconds === a.variant.horizonSeconds);
    const bIndex = FROZEN_VARIANTS.findIndex((variant) => variant.family === b.variant.family && variant.horizonSeconds === b.variant.horizonSeconds);
    return aIndex - bIndex;
  });
  const best = eligible[0];
  if (best === undefined) return { changed: false, selection: { ...current, updatedAt: nowIso, reason: "AUTO_KEEP_NO_ELIGIBLE" }, reason: "AUTO_KEEP_NO_ELIGIBLE", metrics };
  const bestVariantId = `${best.variant.family}-${best.variant.horizonSeconds}`;
  const changed = bestVariantId !== current.variantId;
  const selection = makeSelection(best.variant.family, best.variant.horizonSeconds, `AUTO: ${changed ? "switch" : "keep"} ${bestVariantId} (wilsonLo=${(best.wilsonLower as number).toFixed(4)}, n=${best.decided})`);
  const resolved = selection ?? current;
  const withMode: StrategySelection = { ...resolved, mode: "AUTO", updatedAt: nowIso, reason: `AUTO ${changed ? "switch" : "keep"} -> ${bestVariantId} (wilsonLo=${(best.wilsonLower as number).toFixed(4)}, n=${best.decided})` };
  return { changed, selection: withMode, reason: changed ? "AUTO_SWITCH" : "AUTO_KEEP", metrics };
}

export function statsKey(family: FrozenFamily, horizonSeconds: number): string {
  return `${family}-${horizonSeconds}`;
}

export function parseVariantKey(key: string): { family: FrozenFamily; horizonSeconds: number } | null {
  const [family, horizonText] = key.split("-");
  if (family === undefined || horizonText === undefined) return null;
  const horizonSeconds = Number(horizonText);
  if (!Number.isFinite(horizonSeconds)) return null;
  if (family !== "V1" && family !== "V2" && family !== "V3" && family !== "V8") return null;
  if (!isValidVariant(family, horizonSeconds)) return null;
  return { family, horizonSeconds };
}
