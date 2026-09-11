/**
 * Sizing conservador para paper trading.
 *
 * Esta camada nunca envia ordens e nunca aumenta a aposta depois de perda.
 * Ela transforma probabilidade calibrada + payoff + stop em um limite de
 * risco auditável, respeitando evidência, drawdown, perda diária e kill switch.
 */

export interface BankrollConstraints {
  /** Fração do Kelly teórico. Default 25%. */
  readonly fractionalKelly?: number;
  /** Perda máxima por trade como fração do saldo. Default 1%. */
  readonly maxRiskPerTradePct?: number;
  /** Perda diária máxima como fração do saldo. Default 5%. */
  readonly maxDailyLossPct?: number;
  /** Drawdown máximo antes de parar. Default 20%. */
  readonly maxDrawdownPct?: number;
  /** Número mínimo de observações para usar probabilidade. Default 30. */
  readonly minSampleSize?: number;
  /** Limite de posições paper simultâneas. Default 1. */
  readonly maxOpenPositions?: number;
}

export interface BankrollState {
  /** Fração já perdida no dia, sempre positiva. */
  readonly realizedDailyLossPct: number;
  /** Drawdown atual como fração do pico de capital, sempre positivo. */
  readonly currentDrawdownPct: number;
  readonly openPositions: number;
  /** Chave manual, persistível, para interromper novas entradas. */
  readonly killSwitch: boolean;
}

export interface SizingRequest {
  readonly balance: number;
  /** Probabilidade calibrada, em [0, 1]. */
  readonly calibratedProbability: number | null;
  readonly sampleSize: number;
  /** Ganho esperado para cada 1 de perda (ex.: 1.5 = risco:retorno 1:1.5). */
  readonly payoutRatio: number;
  /** Distância até o stop como fração do preço (0.01 = 1%). */
  readonly stopDistancePct: number;
  readonly state: BankrollState;
  readonly constraints?: BankrollConstraints;
}

export type SizingStatus = "approved" | "blocked" | "no_edge" | "insufficient_evidence" | "invalid_input";

export interface SizingResult {
  readonly status: SizingStatus;
  readonly reasonCodes: readonly string[];
  readonly kellyFraction: number | null;
  readonly appliedRiskFraction: number;
  readonly maxLoss: number;
  readonly positionNotional: number;
}

const DEFAULTS: Required<BankrollConstraints> = {
  fractionalKelly: 0.25,
  maxRiskPerTradePct: 0.01,
  maxDailyLossPct: 0.05,
  maxDrawdownPct: 0.2,
  minSampleSize: 30,
  maxOpenPositions: 1,
};

function finiteBetween(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/** Calcula um tamanho apenas quando todos os gates independentes permitem. */
export function recommendPaperPosition(input: SizingRequest): SizingResult {
  const limits = { ...DEFAULTS, ...input.constraints };
  const reasons: string[] = [];
  const p = input.calibratedProbability;
  if (!Number.isFinite(input.balance) || input.balance <= 0) reasons.push("INVALID_BALANCE");
  if (p === null || !finiteBetween(p, 0, 1)) reasons.push("INVALID_CALIBRATED_PROBABILITY");
  if (!Number.isInteger(input.sampleSize) || input.sampleSize < 0) reasons.push("INVALID_SAMPLE_SIZE");
  if (!Number.isFinite(input.payoutRatio) || input.payoutRatio <= 0) reasons.push("INVALID_PAYOUT_RATIO");
  if (!finiteBetween(input.stopDistancePct, Number.EPSILON, 1)) reasons.push("INVALID_STOP_DISTANCE");
  if (!finiteBetween(input.state.realizedDailyLossPct, 0, 1)
    || !finiteBetween(input.state.currentDrawdownPct, 0, 1)
    || !Number.isInteger(input.state.openPositions) || input.state.openPositions < 0) reasons.push("INVALID_STATE");
  if (reasons.length > 0) return empty("invalid_input", reasons);

  if (input.state.killSwitch) return empty("blocked", ["KILL_SWITCH_ACTIVE"]);
  if (input.state.openPositions >= limits.maxOpenPositions) return empty("blocked", ["MAX_OPEN_POSITIONS"]);
  if (input.state.currentDrawdownPct >= limits.maxDrawdownPct) return empty("blocked", ["MAX_DRAWDOWN_REACHED"]);
  if (input.state.realizedDailyLossPct >= limits.maxDailyLossPct) return empty("blocked", ["DAILY_LOSS_LIMIT_REACHED"]);
  if (input.sampleSize < limits.minSampleSize) return empty("insufficient_evidence", ["INSUFFICIENT_CALIBRATION_SAMPLE"]);

  // Kelly: f* = (b*p - q)/b, q = 1-p. Resultado <= 0 não tem edge.
  const kelly = ((input.payoutRatio * p!) - (1 - p!)) / input.payoutRatio;
  if (kelly <= 0) return empty("no_edge", ["NON_POSITIVE_KELLY"], kelly);

  const remainingDaily = Math.max(0, limits.maxDailyLossPct - input.state.realizedDailyLossPct);
  const riskFraction = Math.min(kelly * limits.fractionalKelly, limits.maxRiskPerTradePct, remainingDaily);
  if (riskFraction <= 0) return empty("blocked", ["NO_REMAINING_RISK_BUDGET"], kelly);

  const maxLoss = input.balance * riskFraction;
  return {
    status: "approved",
    reasonCodes: [],
    kellyFraction: kelly,
    appliedRiskFraction: riskFraction,
    maxLoss,
    positionNotional: maxLoss / input.stopDistancePct,
  };
}

function empty(status: Exclude<SizingStatus, "approved">, reasonCodes: readonly string[], kellyFraction: number | null = null): SizingResult {
  return { status, reasonCodes, kellyFraction, appliedRiskFraction: 0, maxLoss: 0, positionNotional: 0 };
}
