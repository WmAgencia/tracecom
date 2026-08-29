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

export type ShadowOutcome = "pending" | "hit" | "miss" | "flat" | "insufficient";

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
  readonly returnPct: number | null; // % de retorno bruto ((exit-entry)/entry)*100
  readonly confidence: number | null;
  readonly probability: number | null;
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
    confidence: input.confidence ?? null,
    probability: input.probability ?? null,
    createdAt: Date.now(),
    evaluatedAt: null,
  };
}

export interface FutureCandle {
  readonly timestamp: number;
  readonly close: number;
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
      evaluatedAt: Date.now(),
    };
  }

  const pct = ((exitCandle.close - entry) / entry) * 100;
  let outcome: ShadowOutcome;
  if (trade.decision === "WAIT") {
    outcome = "flat";
  } else if (Math.abs(pct) < minMovePct) {
    outcome = "flat";
  } else if (trade.decision === "BUY") {
    outcome = pct > 0 ? "hit" : "miss";
  } else {
    // SELL
    outcome = pct < 0 ? "hit" : "miss";
  }

  return {
    ...trade,
    exitTime,
    exitPrice: exitCandle.close,
    outcome,
    returnPct: pct,
    evaluatedAt: Date.now(),
  };
}