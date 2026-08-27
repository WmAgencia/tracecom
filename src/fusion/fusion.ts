/**
 * FusionEngine — combina evidências de fontes independentes e produz uma decisão
 * analítica BUY/SELL/WAIT, buscando SEMPRE contrapontos.
 *
 * Princípios (seção 5 do produto):
 *   - Não é um "vai subir?" — é investigação que pesa evidências e contraprovas.
 *   - Contraprova obrigatória: procurar fatores que invalidariam a análise.
 *   - WAIT é decisão válida (dados insuficientes ou conflito).
 *   - Probabilidade nunca é inventada — vem do Backtester ou é null.
 *   - Fontes indisponíveis são declaradas (não geram sinal).
 */
import type { MarketRegime } from "../quant/types";
import type { EmpiricalProbability, Direction } from "../backtest/types";
import type { Factor, FusionInput, FusionResult } from "./types";

const HIGH_THRESHOLD = 0.18; // score mínimo (0..1 equivalente) para não ser neutro
const RISK_CEILING = 0.55; // se risco >= isso, bloqueia decisão direcional
const MIN_SAMPLE = 30;

export class FusionEngine {
  /**
   * Combina as evidências em uma direção e score.
   * `technical` é a base (quant). Backtest (prob vs baseline) é a validação.
   * Contexto (notícias/macro) ajusta. Risco veta.
   */
  fuse(input: FusionInput): FusionResult {
    const favorable: Factor[] = [];
    const counter: Factor[] = [];
    const invalidators: string[] = [];
    const sources: string[] = [];

    let score = 0; // no espaço técnico -1..1
    let confidence = 0.4;
    let dataSufficient = true;

    // --- 1) Técnico (quant) ---
    const techScore = input.technical.score;
    if (techScore === null) {
      dataSufficient = false;
    } else {
      sources.push("quant");
      const aligned = Math.sign(techScore) === (input.direction === "up" ? 1 : -1);
      const weight = Math.abs(techScore);
      if (weight >= HIGH_THRESHOLD) {
        favorable.push({
          type: "favorable", source: "quant",
          text: `Técnico ${aligned ? "confirma" : "contraria"}: score ${techScore.toFixed(2)}`,
          weight,
        });
      }
      score += techScore * 0.5;
      confidence += weight * 0.25;
      if (!aligned) {
        counter.push({ type: "counter", source: "quant", text: `Técnico em desacordo (score ${techScore.toFixed(2)})`, weight });
        invalidators.push(`Técnico assumir direção oposta (|score| > 0.4)`);
      }
    }

    // --- 2) Regime ---
    const regime = input.technical.regime;
    if (regime) {
      sources.push("quant");
      if (regime === "high_volatility") {
        counter.push({ type: "counter", source: "quant", text: "Regime de alta volatilidade dificulta confiabilidade", weight: 0.6 });
        invalidators.push("Regime volatilidade extrema");
        confidence += 0.05;
      }
      // direção implícita do regime ajuda/atrapalha
      if (["strong_uptrend", "uptrend"].includes(regime) && input.direction === "down") {
        counter.push({ type: "counter", source: "quant", text: `Tendência de alta (${regime}) contradiz operação de venda`, weight: 0.5 });
      }
      if (["strong_downtrend", "downtrend"].includes(regime) && input.direction === "up") {
        counter.push({ type: "counter", source: "quant", text: `Tendência de baixa (${regime}) contradiz operação de compra`, weight: 0.5 });
      }
    } else {
      dataSufficient = false;
    }

    // --- 3) Probabilidade empírica (backtest) vs baseline ---
    const prob = input.probability;
    if (prob && prob.sampleSize >= MIN_SAMPLE) {
      sources.push("backtest");
      const base = prob.baseline ?? 0.5;
      const edge = prob.probability - base;
      // edge positivo = filtro de similaridade agrega valor; negativo = prejudica
      if (edge > 0.05) {
        favorable.push({ type: "favorable", source: "backtest", text: `Prob. empírica ${(prob.probability * 100).toFixed(1)}% vs baseline ${(base * 100).toFixed(1)}% (edge +${edge.toFixed(2)})`, weight: Math.min(1, edge * 4) });
        score += edge * 2;
        confidence += edge;
      } else if (edge < -0.05) {
        counter.push({ type: "counter", source: "backtest", text: `Similaridade histórica SEM vantagem: prob ${(prob.probability * 100).toFixed(1)}% vs baseline ${(base * 100).toFixed(1)}%`, weight: Math.min(1, -edge * 4) });
        score -= Math.abs(edge) * 2;
        confidence -= Math.abs(edge);
        invalidators.push("Sem edge histórico (prob empírica <= baseline)");
      } else {
        counter.push({ type: "counter", source: "backtest", text: "Prob empírica ≈ baseline (sem edge confirmado)", weight: 0.2 });
      }
    } else {
      // sem amostra suficiente → não fabro; reduz confiança
      dataSufficient = false;
      invalidators.push("Histórico insuficiente para confirmar edge");
    }

    // --- 4) Contexto (notícias/macro) — opcional, quando disponível ---
    if (input.context.newsBias) {
      sources.push("context");
      if (input.context.newsBias !== "neutral" && input.context.newsBias !== input.direction) {
        counter.push({ type: "counter", source: "context", text: `Notícias em sentido oposto (${input.context.newsBias})`, weight: 0.4 });
        score -= 0.1;
      } else if (input.context.newsBias === input.direction) {
        favorable.push({ type: "favorable", source: "context", text: "Notícias alinhadas com a direção", weight: 0.3 });
        score += 0.05;
      }
    }
    if (input.context.eventRisk) {
      counter.push({ type: "counter", source: "context", text: "Evento macro iminente", weight: 0.5 });
      invalidators.push("Evento macro/notícia agendado");
    }

    // --- 5) Risco — pode vetar decisão direcional ---
    const risk = input.risk;
    sources.push("risk");
    if (risk.unknown) {
      dataSufficient = false;
      invalidators.push("Risco não avaliável (dados insuficientes)");
    }
    if (risk.level === "high" || risk.score >= RISK_CEILING) {
      counter.push({ type: "counter", source: "risk", text: `Risco alto (${risk.score.toFixed(2)})`, weight: 0.8 });
      invalidators.push("Risco acima do limite");
    } else if (risk.level === "medium") {
      counter.push({ type: "counter", source: "risk", text: `Risco médio (${risk.score.toFixed(2)})`, weight: 0.3 });
      score -= 0.05;
    }

    score = Math.max(-1, Math.min(1, score));
    confidence = Math.max(0.05, Math.min(0.95, confidence));

    const blockedByCounterEvidence = Boolean(
      counter.reduce((s, f) => s + f.weight, 0) >= favorable.reduce((s, f) => s + f.weight, 0) ||
      risk.level === "high" || (prob && prob.sampleSize >= MIN_SAMPLE && (prob.probability ?? 0) <= (prob.baseline ?? 0.5) - 0.05),
    );

    // --- Decisão ---
    const absolute = Math.abs(score);
    const decision =
      !dataSufficient || absolute < HIGH_THRESHOLD || blockedByCounterEvidence
        ? "WAIT"
        : score > 0 ? "BUY" : "SELL";

    const rationale = buildRationale({
      decision, score, confidence, technicalScore: techScore,
      probability: prob, regime, risk, blockedByCounterEvidence, dataSufficient, counterCount: counter.length,
    });

    return {
      decision,
      direction: decision === "WAIT" ? null : input.direction,
      score,
      confidence,
      technicalScore: techScore,
      probability: prob,
      risk,
      regime,
      sampleSize: prob?.sampleSize ?? 0,
      factors: { favorable, counter, invalidators: dedupe(invalidators) },
      sources: Array.from(new Set(sources)),
      blockedByCounterEvidence,
      dataSufficient,
      rationale,
      generatedAt: Date.now(),
    };
  }
}

function dedupe(a: string[]): string[] {
  return Array.from(new Set(a));
}

function buildRationale(opts: {
  decision: "BUY" | "SELL" | "WAIT";
  score: number;
  confidence: number;
  technicalScore: number | null;
  probability: EmpiricalProbability | null;
  regime: MarketRegime | null;
  risk: { score: number; level: string };
  blockedByCounterEvidence: boolean;
  dataSufficient: boolean;
  counterCount: number;
}): string {
  const parts: string[] = [];
  if (opts.decision === "WAIT") {
    if (!opts.dataSufficient) parts.push("Dados insuficientes para concluir.");
    if (opts.blockedByCounterEvidence) parts.push("Contraprovas superam as evidências favoráveis.");
    if (opts.risk.level === "high") parts.push("Risco alto.");
  } else {
    parts.push(`Direcionamento ${opts.decision === "BUY" ? "de compra" : "de venda"} (score ${opts.score.toFixed(2)}).`);
    if (opts.probability) parts.push(`Prob empírica ${(opts.probability.probability * 100).toFixed(1)}% (amostra ${opts.probability.sampleSize}).`);
  }
  if (opts.technicalScore !== null) parts.push(`Técnico ${opts.technicalScore.toFixed(2)}.`);
  if (opts.regime) parts.push(`Regime ${opts.regime}.`);
  parts.push(`Risco ${opts.risk.level} (${opts.risk.score.toFixed(2)}).`);
  if (opts.counterCount > 0) parts.push(`${opts.counterCount} fator(es) contrário(s) considerados.`);
  return parts.join(" ");
}
