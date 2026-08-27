/**
 * Regime detection — classifica o estado do mercado em termos de tendência e
 * volatilidade, combinando determinismo (indicadores) sem intervenção da LLM.
 */
import type { MarketRegime } from "./types";

export interface RegimeInput {
  readonly adx: number | null;
  readonly adxDir: number; // +1 se +DI > -DI, -1 caso contrário (derivado de inclinação)
  readonly slope: number; // inclinação normalizada (close-close) do período
  readonly volatilityPct: number | null; // volatilidade da janela (0..1)
  readonly volatilityThreshold: number;
  readonly closeAboveSma: boolean;
  readonly rsiLast: number | null;
}

export interface RegimeOutput {
  readonly regime: MarketRegime;
  readonly confidence: number; // 0..1
  readonly reasons: readonly string[];
}

export function detectRegime(input: RegimeInput): RegimeOutput {
  const reasons: string[] = [];
  const volRatio = input.volatilityPct !== null ? input.volatilityPct / input.volatilityThreshold : 1;

  let regime: MarketRegime = "unknown";
  let confidence = 0.4;

  // Tendência forte via ADX
  const adx = input.adx ?? 0;
  const trending = adx >= 25;
  const dir = input.adxDir;

  if (volRatio >= 1.6) {
    regime = "high_volatility";
    reasons.push(`Volatilidade ${(volRatio * 100).toFixed(0)}% do limiar`);
    confidence = Math.min(0.85, 0.5 + volRatio * 0.1);
  } else if (trending) {
    if (dir > 0) {
      regime = adx >= 40 ? "strong_uptrend" : "uptrend";
      reasons.push(`ADX=${adx.toFixed(1)} (${adx >= 40 ? "forte" : "médio"}) e direção +`);
    } else {
      regime = adx >= 40 ? "strong_downtrend" : "downtrend";
      reasons.push(`ADX=${adx.toFixed(1)} (${adx >= 40 ? "forte" : "médio"}) e direção −`);
    }
    confidence = Math.min(0.9, 0.5 + adx / 100);
  } else if (Math.abs(input.slope) >= 0.003) {
    regime = input.slope > 0 ? "uptrend" : "downtrend";
    reasons.push(`Inclinação ${(input.slope * 100).toFixed(2)}%`);
    confidence = 0.55;
  } else {
    regime = "range";
    reasons.push("Tendência fraca (ADX baixo) e inclinação contida");
    confidence = input.rsiLast !== null ? 0.55 : 0.45;
  }

  return { regime, confidence, reasons };
}
