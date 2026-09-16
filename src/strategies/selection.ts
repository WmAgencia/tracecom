/** Seleção operacional — source of truth server-side (MANUAL | AUTO).
 *
 * O agente operacional só aceita sinal compatível com a seleção vigente:
 *  - MANUAL: direction/horizon precisam bater com o último sinal da variante selecionada;
 *  - AUTO: a política determinística escolhe a variante (src/strategies/auto.ts).
 * Operação ativa NUNCA é alterada por troca de seleção (imutabilidade no OperationalController).
 */
import { FROZEN_VARIANTS, isValidVariant, type FrozenFamily } from "./frozen.js";

export type OperationalMode = "MANUAL" | "AUTO";

export interface StrategySelection {
  mode: OperationalMode;
  family: FrozenFamily;
  horizonSeconds: number;
  entryLogicHash: string;
  variantId: string;
  updatedAt: string;
  reason: string;
}

export const DEFAULT_SELECTION: StrategySelection = {
  mode: "MANUAL",
  family: "V3",
  horizonSeconds: 60,
  entryLogicHash: "acf733a866146537",
  variantId: "V3-60",
  updatedAt: "1970-01-01T00:00:00.000Z",
  reason: "default",
};

export interface LatestOperationalSignal {
  family: FrozenFamily;
  horizonSeconds: number;
  direction: "BUY" | "SELL";
  signalBucket: number;
  entryPrice: number;
  strategyHash: string;
  entryTimestamp: number;
}

export interface GateRequest {
  direction: "BUY" | "SELL";
  horizonMs: number;
}

export type GateDecision =
  | { allowed: true; reason: "OK"; variantId: string; signalBucket: number }
  | { allowed: false; reason: "NO_SELECTION" | "NO_FRESH_SIGNAL" | "DIRECTION_MISMATCH" | "HORIZON_MISMATCH" | "HORIZON_INCOMPATIBLE" | "HASH_MISMATCH"; detail: string };

export const SIGNAL_FRESHNESS_MS = 20_000;

export function makeSelection(family: FrozenFamily, horizonSeconds: number, reason: string): StrategySelection | null {
  if (!isValidVariant(family, horizonSeconds)) return null;
  const variant = FROZEN_VARIANTS.find((candidate) => candidate.family === family && candidate.horizonSeconds === horizonSeconds);
  if (variant === undefined) return null;
  return { mode: "MANUAL", family, horizonSeconds, entryLogicHash: variant.entryLogicHash, variantId: variant.variantId, updatedAt: new Date().toISOString(), reason };
}

export function makeAutoSelection(chosen: StrategySelection, reason: string): StrategySelection {
  return { ...chosen, mode: "AUTO", updatedAt: new Date().toISOString(), reason };
}

/** Bloqueio por incompatibilidade de horizonte com o broker (validade visivel). */
export function horizonCompatibility(selection: StrategySelection, brokerHorizonSeconds: number | null | undefined): { compatible: boolean; reason: string } {
  if (brokerHorizonSeconds == null || !Number.isFinite(brokerHorizonSeconds)) return { compatible: true, reason: "BROKER_HORIZON_UNKNOWN" };
  if (brokerHorizonSeconds === selection.horizonSeconds) return { compatible: true, reason: "MATCH" };
  return { compatible: false, reason: "HORIZON_INCOMPATIBLE" };
}

export interface GateContext {
  selection: StrategySelection | null;
  latestSignal: LatestOperationalSignal | null;
  brokerHorizonSeconds?: number | null;
  nowMs?: number;
}

/** Gate puro: decide se um lock operacional pode ser aceito. Testado nos cenarios A/B/C. */
export function decideOperationalGate(request: GateRequest, context: GateContext): GateDecision {
  const { selection, latestSignal } = context;
  const nowMs = context.nowMs ?? Date.now();
  if (selection === null) return { allowed: false, reason: "NO_SELECTION", detail: "nenhuma estrategia selecionada" };
  const compatibility = horizonCompatibility(selection, context.brokerHorizonSeconds);
  if (!compatibility.compatible) {
    return { allowed: false, reason: "HORIZON_INCOMPATIBLE", detail: `selecionada ${selection.horizonSeconds}s vs broker ${context.brokerHorizonSeconds}s` };
  }
  if (request.horizonMs !== selection.horizonSeconds * 1000) {
    return { allowed: false, reason: "HORIZON_MISMATCH", detail: `request ${request.horizonMs}ms vs selecao ${selection.horizonSeconds}s` };
  }
  if (latestSignal === null) return { allowed: false, reason: "NO_FRESH_SIGNAL", detail: "sem sinal da variante selecionada" };
  if (latestSignal.family !== selection.family || latestSignal.horizonSeconds !== selection.horizonSeconds) {
    return { allowed: false, reason: "NO_FRESH_SIGNAL", detail: "sinal de outra variante" };
  }
  if (latestSignal.strategyHash !== selection.entryLogicHash) {
    return { allowed: false, reason: "HASH_MISMATCH", detail: `sinal hash ${latestSignal.strategyHash} vs selecao ${selection.entryLogicHash}` };
  }
  if (nowMs - latestSignal.entryTimestamp > SIGNAL_FRESHNESS_MS) {
    return { allowed: false, reason: "NO_FRESH_SIGNAL", detail: `sinal com ${nowMs - latestSignal.entryTimestamp}ms (max ${SIGNAL_FRESHNESS_MS}ms)` };
  }
  if (latestSignal.direction !== request.direction) {
    return { allowed: false, reason: "DIRECTION_MISMATCH", detail: `request ${request.direction} vs sinal ${latestSignal.direction}` };
  }
  return { allowed: true, reason: "OK", variantId: selection.variantId, signalBucket: latestSignal.signalBucket };
}

/** UI helper: notifica que a selecao só valera a partir do proximo sinal se houver operacao ativa. */
export function selectionAppliesFromNextSignal(activeOperation: boolean): { appliesFromNextSignal: boolean; notice: string | null } {
  if (!activeOperation) return { appliesFromNextSignal: false, notice: null };
  return { appliesFromNextSignal: true, notice: "Selecionada. Aplicada a partir do proximo sinal (operacao atual protegida)." };
}
