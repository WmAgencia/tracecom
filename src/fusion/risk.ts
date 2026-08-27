/**
 * RiskEngine — avalia risco de uma operação a partir de dados observados.
 *
 * Inputs: regime, volatilidade anualizada, ATR%, volatilidade da janela,
 * disponibilidade/qualidade, event risk. Combina em um score 0..1.
 * Dados ausentes → `unknown: true` (não fabrica risco).
 */
import type { MarketRegime } from "../quant/types";
import type { RiskScore } from "./types";

export interface RiskInput {
  readonly regime: MarketRegime | null;
  readonly annualizedVolatility: number | null; // % 
  readonly atrPct: number | null; // % por candle
  readonly windowVolatility: number | null; // 0..1
  readonly dataQuality: "high" | "medium" | "low" | "unknown";
  readonly eventRisk: boolean;
  readonly hasHistoricalSupport: boolean;
}

export function assessRisk(input: RiskInput): RiskScore {
  const factors: string[] = [];
  let score = 0;
  let unknown = false;

  const vol = input.annualizedVolatility;
  if (vol !== null) {
    // volatilidade anualizada alta eleva risco
    if (vol > 100) { score += 0.35; factors.push(`Volatilidade anualizada alta (${vol.toFixed(0)}%)`); }
    else if (vol > 60) { score += 0.2; factors.push(`Volatilidade anualizada elevada (${vol.toFixed(0)}%)`); }
    else if (vol > 30) { score += 0.1; }
  } else {
    unknown = true;
  }

  const atr = input.atrPct;
  if (atr !== null) {
    if (atr > 2) { score += 0.2; factors.push(`ATR% alto (${atr.toFixed(2)}%)`); }
    else if (atr > 1) { score += 0.1; }
  }

  if (input.regime) {
    if (input.regime === "high_volatility") { score += 0.3; factors.push("Regime de alta volatilidade"); }
    if (input.regime === "strong_downtrend") { score += 0.1; }
  } else {
    unknown = true;
  }

  if (input.eventRisk) { score += 0.25; factors.push("Evento macro/notícia de risco iminente"); }

  if (!input.hasHistoricalSupport) { score += 0.1; factors.push("Sem suporte histórico suficiente"); }
  if (input.dataQuality === "low") { score += 0.15; factors.push("Qualidade de dados baixa"); }
  if (input.dataQuality === "unknown") { unknown = true; }

  score = Math.max(0, Math.min(1, score));
  const level: RiskScore["level"] = score >= 0.55 ? "high" : score >= 0.3 ? "medium" : "low";

  return { score, level, factors, unknown };
}
