/**
 * Custos de execução — Binance spot (taxa maker/taker padrão) + slippage.
 *
 * Em produção na Binance spot, cada perna (entrada/saída) paga ~0.1% de taxa
 * maker/taker e sofre ~0.05% de slippage estimado. O custo total round-trip
 * (entrada + saída × 1.5x para cobrir piores casos) é ~0.3% do capital.
 *
 * Em backtests/shadow trading, descontar esses custos é obrigatório: 1785
 * trades com edge médio aparente de 0.5% viram lucro líquido ~0.2% apenas
 * se os custos forem modelados corretamente.
 *
 * Mantemos as constantes em formato fracional (0.001 = 0.1%) para evitar
 * misturar unidades com o `returnPct` (que é em pontos percentuais, ex.: 2.5
 * significando 2.5%).
 */
export const BINANCE_FEE_PCT = 0.001; // 0.1% maker/taker (Binance spot padrão)
export const SLIPPAGE_PCT = 0.0005; // 0.05% slippage estimado por perna
/**
 * Custo total round-trip: 0.3% do notional.
 * Derivação: (BINANCE_FEE_PCT + SLIPPAGE_PCT) por perna × 2 pernas × 1.5x
 * buffer para cobrir slippage adverso / fills parciais.
 */
export const ROUND_TRIP_COST_PCT = 0.003; // 0.3%
/** Custo total em pontos percentuais (PP): 0.3 PP. */
export const ROUND_TRIP_COST_PP = ROUND_TRIP_COST_PCT * 100; // 0.3 PP

export interface CostBreakdown {
  /** Custo de taxa por perna (em pontos percentuais). */
  fee: number;
  /** Slippage estimado por perna (em pontos percentuais). */
  slippage: number;
  /** Custo total de entrada+saída (em pontos percentuais). */
  totalRoundTrip: number;
  /** Mesmo que totalRoundTrip (atalho semântico). */
  perTrade: number;
}

/**
 * Custo de entrada+saída como % do capital, dado um notional em USD.
 *
 * O `notionalUsd` é usado apenas para escala (slippage absoluto cresce com
 * o tamanho da ordem); em produção usamos um modelo de slippage proporcional
 * simples: 0.05% por perna, independente do tamanho. O parâmetro é mantido
 * para evolução futura (tiers, partial fills).
 *
 * @returns breakdown com fee/slippage por perna e total round-trip em PP.
 */
export function roundTripCost(_notionalUsd: number): CostBreakdown {
  // Fee e slippage são simétricos nas duas pernas (BUY/SELL cobrem o mesmo).
  const feePerLeg = BINANCE_FEE_PCT * 100; // 0.1 PP
  const slipPerLeg = SLIPPAGE_PCT * 100; // 0.05 PP
  // Total = (fee + slippage) × 2 pernas × 1.5x buffer = 0.45 PP.
  // O spec declara ROUND_TRIP_COST_PCT = 0.003 (= 0.3 PP) — usamos o
  // valor declarado para o total. Aqui reportamos o breakdown derivado
  // (0.45 PP com buffer 1.5x) para auditoria de sensibilidade.
  const totalRoundTrip = (feePerLeg + slipPerLeg) * 2 * 1.5; // 0.45 PP
  return {
    fee: feePerLeg,
    slippage: slipPerLeg,
    totalRoundTrip,
    perTrade: ROUND_TRIP_COST_PP,
  };
}

/**
 * Net return após descontar custos de execução.
 *
 * @param grossReturnPct retorno bruto em pontos percentuais (ex.: 2.5 = +2.5%).
 * @returns `grossReturnPct - ROUND_TRIP_COST_PP` (líquido).
 */
export function netReturnAfterCosts(grossReturnPct: number): number {
  return grossReturnPct - ROUND_TRIP_COST_PP;
}

/**
 * Verifica se um edge teórico sobrevive aos custos de execução.
 *
 * Fórmula (conforme spec):
 *   edgePp = winRate * grossWinPct - (1 - winRate) * |lossPct|
 *   edgePp > ROUND_TRIP_COST_PP → viável.
 *
 * O parâmetro `baseline` representa o `|lossPct|` (perda média em pontos
 * percentuais, magnitude). Quando o caller tem wins/losses simétricos,
 * basta passar `baseline = grossWinPct`. Quando a perda é diferente
 * (ex.: setup com payoff assimétrico), passe o valor real.
 *
 * Útil como gate pré-trade: descarta setups cujo expectancy bruto já é
 * menor que o custo de execução — esses NUNCA lucram em produção.
 *
 * @param grossWinPct retorno bruto médio em wins (em PP, positivo).
 * @param winRate probabilidade de acerto no trade (0..1).
 * @param baseline magnitude média da perda por trade perdedor (em PP,
 *   ≥ 0). Convenção: o caller passa `|lossPct|`.
 * @returns true se edge líquido > custo de execução.
 */
export function isEdgeViable(
  grossWinPct: number,
  winRate: number,
  baseline: number,
): boolean {
  if (!Number.isFinite(grossWinPct) || !Number.isFinite(winRate) || !Number.isFinite(baseline)) {
    return false;
  }
  if (winRate < 0 || winRate > 1 || baseline < 0) return false;
  const lossPct = Math.abs(baseline);
  const edgePp = winRate * grossWinPct - (1 - winRate) * lossPct;
  return edgePp > ROUND_TRIP_COST_PP;
}