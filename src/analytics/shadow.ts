/**
 * Shadow trading (paper trading) — Etapa do ciclo de validação estatística.
 *
 * Registra automaticamente o que TERIA acontecido se o sinal BUY/SELL fosse
 * executado no momento do sinal. Avalia a posteriori contra candles futuros
 * reais (mesma causalidade do DecisionRecord): o horizonte já decorrido,
 * nunca inventado.
 *
 * Diferente de DecisionRecord (que valida a decisão da fusão), o ShadowTrade
 * simula a execução real: mede retorno bruto (sem ajuste direcional no pct)
 * para refletir fielmente o P&L hipotético de uma posição BUY/SELL.
 */
import { TIMEFRAME_MS, type Timeframe } from "../market/model";
import { netReturnAfterCosts, ROUND_TRIP_COST_PP } from "../risk/fees";

/** Default stop-loss como % fracional (1.5%). */
export const DEFAULT_STOP_LOSS_PCT = 0.015;
/** Default cooldown entre trades do mesmo symbol+direction em minutos (4h). */
export const DEFAULT_COOLDOWN_MINUTES = 240;

export type ShadowOutcome =
  | "pending"
  | "hit"
  | "miss"
  | "flat"
  | "insufficient"
  | "stopped"
  | "stalled"
  | "error";

export interface ShadowTrade {
  readonly id: string;
  readonly symbol: string;
  readonly timeframe: string;
  readonly direction: "up" | "down";
  readonly decision: "BUY" | "SELL" | "WAIT";
  readonly entryTime: number;
  readonly entryPrice: number | null;
  readonly exitTime: number | null;
  readonly exitPrice: number | null;
  readonly outcome: ShadowOutcome;
  /** % de retorno LÍQUIDO após custos de execução (Binance spot). */
  readonly returnPct: number | null;
  /** % de retorno BRUTO pré-custos — guardado para audit. */
  readonly grossReturnPct?: number | null;
  /** Custo descontado em PP (P-T: auditoria de sensibilidade). */
  readonly costPct?: number | null;
  readonly confidence: number | null;
  readonly probability: number | null;
  readonly stopLossPct?: number | null;
  readonly cooldownMinutes?: number | null;
  readonly stopLossTriggeredAt?: number | null;
  /** P-R: snapshots do provider e idempotência do scheduler. */
  readonly providerId?: string | null;
  readonly evaluationAttempts?: number;
  readonly lastEvaluationError?: string | null;
  readonly evaluationLocked?: boolean;
  readonly createdAt: number;
  readonly evaluatedAt: number | null;
}

export interface OpenShadowInput {
  readonly symbol: string;
  readonly timeframe: string;
  readonly direction: "up" | "down";
  readonly decision: "BUY" | "SELL" | "WAIT";
  readonly entryTime: number;
  readonly entryPrice: number;
  readonly confidence?: number;
  readonly probability?: number;
  readonly stopLossPct?: number;
  readonly cooldownMinutes?: number;
}

/** Cria um shadow trade a partir de uma decisão + preço de entrada. */
export function openShadowTrade(input: OpenShadowInput): ShadowTrade {
  return {
    id: crypto.randomUUID(),
    symbol: input.symbol,
    timeframe: input.timeframe,
    direction: input.direction,
    decision: input.decision,
    entryTime: input.entryTime,
    entryPrice: input.entryPrice,
    exitTime: null,
    exitPrice: null,
    outcome: "pending",
    returnPct: null,
    grossReturnPct: null,
    confidence: input.confidence ?? null,
    probability: input.probability ?? null,
    stopLossPct: input.stopLossPct ?? null,
    cooldownMinutes: input.cooldownMinutes ?? null,
    stopLossTriggeredAt: null,
    createdAt: Date.now(),
    evaluatedAt: null,
  };
}

export interface FutureCandle {
  readonly timestamp: number;
  readonly close: number;
  readonly high?: number;
  readonly low?: number;
}

/**
 * Avalia um shadow trade aberto contra candles futuros.
 *
 * Retorna um novo ShadowTrade (imutável) com exitTime/exitPrice/outcome/returnPct
 * populados. Se não houver candle na saída exata, outcome='insufficient' e os
 * campos de saída ficam null (não inventa dados).
 *
 * Regras:
 *   - exitTime = entryTime + horizon * TF_MS[timeframe]
 *   - WAIT nunca é direcional → flat (mas o trade segue registrado)
 *   - |pct| < minMovePct → flat (movimento insignificante)
 *   - BUY: hit se pct>0, miss se pct<0
 *   - SELL: hit se pct<0, miss se pct>0
 *   - returnPct sempre é o bruto ((exit-entry)/entry)*100 — caller decide o sinal
 *   - Stop-loss por candle: se em QUALQUER candle da janela o preço violou
 *     [entryPrice ± stopLossPct], marca outcome='stopped' e registra
 *     stopLossTriggeredAt = timestamp do candle violador. BUY: cai > stopLossPct.
 *     SELL: sobe > stopLossPct. stopLossPct default = DEFAULT_STOP_LOSS_PCT (1.5%).
 */
export function evaluateShadowTrade(
  trade: ShadowTrade,
  futureCandles: readonly FutureCandle[],
  horizon: number,
  minMovePct: number,
): ShadowTrade {
  if (trade.outcome !== "pending") {
    // Já avaliado: retorna como está (idempotente).
    return trade;
  }
  const step = TIMEFRAME_MS[trade.timeframe as Timeframe];
  if (!step || horizon <= 0) {
    return { ...trade, outcome: "insufficient", evaluatedAt: Date.now() };
  }
  const exitTime = trade.entryTime + horizon * step;
  const exitCandle = futureCandles.find((c) => c.timestamp === exitTime);

  if (!exitCandle) {
    return {
      ...trade,
      outcome: "insufficient",
      exitTime: null,
      exitPrice: null,
      returnPct: null,
      grossReturnPct: null,
      evaluatedAt: Date.now(),
    };
  }

  const entry = trade.entryPrice;
  if (entry === null || entry === 0 || !Number.isFinite(entry)) {
    return {
      ...trade,
      outcome: "insufficient",
      exitTime,
      exitPrice: exitCandle.close,
      returnPct: null,
      grossReturnPct: null,
      evaluatedAt: Date.now(),
    };
  }

  // Stop-loss check: percorre cada candle da janela (incluindo o exit).
  // Aplica apenas para BUY/SELL (WAIT não tem exposição direcional).
  const stopLossPct = trade.stopLossPct ?? DEFAULT_STOP_LOSS_PCT;
  if (trade.decision !== "WAIT" && Number.isFinite(stopLossPct) && stopLossPct > 0) {
    for (const c of futureCandles) {
      if (c.timestamp < trade.entryTime) continue;
      if (c.timestamp > exitTime) break;
      const high = Number.isFinite(c.high) ? c.high! : c.close;
      const low = Number.isFinite(c.low) ? c.low! : c.close;
      const adversePct = trade.decision === "BUY" ? (entry - low) / entry : (high - entry) / entry;
      // BUY: caiu mais que stopLossPct → stop.
      // SELL: subiu mais que stopLossPct → stop.
      if (trade.decision === "BUY" && adversePct >= stopLossPct) {
        const grossPct = ((c.close - entry) / entry) * 100;
        return {
          ...trade,
          exitTime: c.timestamp,
          exitPrice: c.close,
          outcome: "stopped",
          returnPct: netReturnAfterCosts(grossPct),
          costPct: ROUND_TRIP_COST_PP,
          grossReturnPct: grossPct,
          stopLossTriggeredAt: c.timestamp,
          evaluatedAt: Date.now(),
        };
      }
      if (trade.decision === "SELL" && adversePct >= stopLossPct) {
        const grossPct = ((entry - c.close) / entry) * 100;
        return {
          ...trade,
          exitTime: c.timestamp,
          exitPrice: c.close,
          outcome: "stopped",
          returnPct: netReturnAfterCosts(grossPct),
          costPct: ROUND_TRIP_COST_PP,
          grossReturnPct: grossPct,
          stopLossTriggeredAt: c.timestamp,
          evaluatedAt: Date.now(),
        };
      }
    }
  }

  const grossPct = trade.decision === "SELL"
    ? ((entry - exitCandle.close) / entry) * 100
    : ((exitCandle.close - entry) / entry) * 100;
  let outcome: ShadowOutcome;
  if (trade.decision === "WAIT") {
    outcome = "flat";
  } else if (Math.abs(grossPct) < minMovePct) {
    outcome = "flat";
  } else if (trade.decision === "BUY") {
    outcome = grossPct > 0 ? "hit" : "miss";
  } else {
    // SELL
    outcome = grossPct > 0 ? "hit" : "miss";
  }

  return {
    ...trade,
    exitTime,
    exitPrice: exitCandle.close,
    outcome,
    returnPct: netReturnAfterCosts(grossPct),
    costPct: ROUND_TRIP_COST_PP,
    grossReturnPct: grossPct,
    evaluatedAt: Date.now(),
  };
}
