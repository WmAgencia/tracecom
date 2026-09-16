/** Champion/Candidate — gate de promocao congelado (5000 trades NOVOS, OOS, sem leakage).
 *
 * Regras:
 *  - treino e validacao NUNCA usam os mesmos trades (trainingN != validationN por construcao);
 *  - promocao exige validationN >= 5000 trades novos e elegiveis;
 *  - candidato precisa Wilson lower (95%) estritamente maior que o champion na MESMA janela;
 *  - estabilidade: 2a metade da validacao nao pode colapsar vs 1a (queda maxima 10pp);
 *  - regressao critica: candidate WR >= champion WR - 2pp;
 *  - baseline: candidate WR acima do baseline direcional + 2pp.
 * Decisao ruim NUNCA altera o gate. Tudo persistido (audit) com reason.
 */
export const PROMOTION_REQUIRED_NEW_TRADES = 5000;
export const PROMOTION_MAX_HALF_DROP_PP = 10;
export const PROMOTION_MAX_REGRESSION_PP = 2;
export const PROMOTION_MIN_EDGE_OVER_BASELINE_PP = 2;

export interface PromotionEvidence {
  candidateVersion: string;
  championVersion: string;
  trainingN: number;
  validationN: number;
  candidateWins: number;
  candidateLosses: number;
  championWins: number;
  championLosses: number;
  baselineWr: number | null;
  firstHalfWr: number | null;
  secondHalfWr: number | null;
}

export type PromotionDecision = "PROMOTE" | "REJECT" | "INSUFFICIENT_EVIDENCE";

export interface PromotionResult {
  decision: PromotionDecision;
  reasons: string[];
  candidateWr: number | null;
  championWr: number | null;
  candidateWilsonLower: number | null;
  championWilsonLower: number | null;
}

export function wilsonLowerBound(wins: number, n: number): number | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = wins / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return Math.max(0, center - half);
}

export function evaluatePromotion(evidence: PromotionEvidence): PromotionResult {
  const candidateDecided = evidence.candidateWins + evidence.candidateLosses;
  const championDecided = evidence.championWins + evidence.championLosses;
  const candidateWr = candidateDecided > 0 ? (evidence.candidateWins / candidateDecided) * 100 : null;
  const championWr = championDecided > 0 ? (evidence.championWins / championDecided) * 100 : null;
  const candidateWilson = wilsonLowerBound(evidence.candidateWins, candidateDecided);
  const championWilson = wilsonLowerBound(evidence.championWins, championDecided);
  const reasons: string[] = [];
  if (evidence.validationN < PROMOTION_REQUIRED_NEW_TRADES) {
    reasons.push(`INSUFFICIENT_EVIDENCE: validationN=${evidence.validationN} < ${PROMOTION_REQUIRED_NEW_TRADES} trades novos exigidos`);
    return { decision: "INSUFFICIENT_EVIDENCE", reasons, candidateWr, championWr, candidateWilsonLower: candidateWilson, championWilsonLower: championWilson };
  }
  if (council(candidateWr, championWr)) reasons.push(`REJECT: ${Number(candidateWr).toFixed(2)}% < champion ${Number(championWr).toFixed(2)}%`);
  if (candidateWr === null || championWr === null) reasons.push("REJECT: amostra decidida vazia");
  if (candidateWr !== null && championWr !== null && candidateWr < championWr - PROMOTION_MAX_REGRESSION_PP) {
    reasons.push(`REJECT: regressao critica (>${PROMOTION_MAX_REGRESSION_PP}pp abaixo do champion)`);
  }
  if (evidence.baselineWr !== null && candidateWr !== null && candidateWr < evidence.baselineWr + PROMOTION_MIN_EDGE_OVER_BASELINE_PP) {
    reasons.push(`REJECT: sem edge sobre baseline (${candidateWr.toFixed(2)}% vs baseline ${evidence.baselineWr.toFixed(2)}%)`);
  }
  if (evidence.firstHalfWr !== null && evidence.secondHalfWr !== null && evidence.secondHalfWr < evidence.firstHalfWr - PROMOTION_MAX_HALF_DROP_PP) {
    reasons.push(`REJECT: instabilidade (2a metade caiu >${PROMOTION_MAX_HALF_DROP_PP}pp)`);
  }
  if (candidateWilson === null || championWilson === null || candidateWilson <= championWilson) {
    reasons.push("REJECT: Wilson lower do candidato nao supera o champion (sem significancia)");
  }
  if (reasons.length === 0) {
    reasons.push(`PROMOTE: candidate ${Number(candidateWr).toFixed(2)}% (wilsonLo ${(candidateWilson as number * 100).toFixed(2)}%) > champion ${Number(championWr).toFixed(2)}% em ${evidence.validationN} trades OOS`);
    return { decision: "PROMOTE", reasons, candidateWr, championWr, candidateWilsonLower: candidateWilson, championWilsonLower: championWilson };
  }
  return { decision: "REJECT", reasons, candidateWr, championWr, candidateWilsonLower: candidateWilson, championWilsonLower: championWilson };
}

function council(candidateWr: number | null, championWr: number | null): boolean {
  return candidateWr !== null && championWr !== null && candidateWr < championWr;
}
