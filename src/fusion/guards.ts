/**
 * CAMADA 3 — Proteções / Guards (Circuit Breakers).
 *
 * Funções puras, sem dependência de DB. O estado é externo (caller passa
 * `state`, recebe de volta um novo `state` para persistir em outra camada).
 *
 * Regras (na ordem):
 *  1. Cooldown ainda ativo (now < cooldownUntil)               → bloqueia
 *  2. consecutiveLosses >= 3                                   → ativa cooldown 30min
 *  3. dailyLossPct > 5 (5%)                                    → bloqueia (drawdown diário)
 *  4. dailyLossPct reseta quando muda o dia UTC
 *  5. atrPct > 0.08 (8%)                                       → bloqueia (volatilidade extrema)
 *  6. lastCandleAgeMs > 5*60*1000 (5 min)                      → bloqueia (dados stale)
 *  7. caso contrário                                           → permite
 *
 * Observação: as checagens de ATR/stale não alteram o estado — apenas o
 * fluxo de entrada no diário (recordLoss/recordWin/resetGuard) o faz.
 */
export interface GuardState {
  consecutiveLosses: number;
  cooldownUntil: number | null; // ms epoch
  dailyLossPct: number; // soma de losses do dia em % (positivo)
  lastLossAt: number | null;
  circuitTrippedAt: number | null;
  lastUpdatedDay: string; // YYYY-MM-DD UTC
}

export interface GuardInput {
  state: GuardState;
  atrPct: number | null; // volatilidade recente (em %; ex.: 8 = 8%)
  lastCandleAgeMs: number | null; // idade do último candle em ms
  now: number; // ms epoch
}

export interface GuardDecision {
  allow: boolean;
  reason?: string;
}

const COOLDOWN_MS = 30 * 60 * 1000;
const DAILY_DRAWDOWN_LIMIT_PCT = 5;
const MAX_ATR_PCT = 0.08; // 8% (em fração)
const MAX_CANDLE_AGE_MS = 5 * 60 * 1000; // 5 min
const CONSECUTIVE_LOSS_TRIGGER = 3;

/** YYYY-MM-DD em UTC a partir de um epoch ms. */
export function utcDay(now: number): string {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function freshGuardState(now: number): GuardState {
  return {
    consecutiveLosses: 0,
    cooldownUntil: null,
    dailyLossPct: 0,
    lastLossAt: null,
    circuitTrippedAt: null,
    lastUpdatedDay: utcDay(now),
  };
}

/** Garante consistência do estado com a data atual (reseta drawdown se virou o dia). */
export function rolloverIfNewDay(state: GuardState, now: number): GuardState {
  const today = utcDay(now);
  if (state.lastUpdatedDay === today) return state;
  return {
    ...state,
    dailyLossPct: 0,
    lastUpdatedDay: today,
  };
}

export function evaluateGuards(input: GuardInput): GuardDecision {
  const { state, atrPct, lastCandleAgeMs, now } = input;

  // 1) cooldown ativo
  if (state.cooldownUntil !== null && now < state.cooldownUntil) {
    return {
      allow: false,
      reason: `cooldown ativo após ${state.consecutiveLosses} losses`,
    };
  }

  // 3) drawdown diário (após rollover de dia)
  const rolled = rolloverIfNewDay(state, now);
  if (rolled.dailyLossPct > DAILY_DRAWDOWN_LIMIT_PCT) {
    return { allow: false, reason: "drawdown diário excedeu 5%" };
  }

  // 5) volatilidade extrema
  if (atrPct !== null && atrPct > MAX_ATR_PCT) {
    return { allow: false, reason: "volatilidade extrema" };
  }

  // 6) dados stale
  if (lastCandleAgeMs !== null && lastCandleAgeMs > MAX_CANDLE_AGE_MS) {
    return { allow: false, reason: "dados stale" };
  }

  return { allow: true };
}

/** Acionado quando uma operação termina em loss. Atualiza contadores e, se
 *  bater o gatilho (>= 3 losses consecutivas), abre cooldown de 30 min. */
export function recordLoss(state: GuardState, lossPct: number, now: number): GuardState {
  const rolled = rolloverIfNewDay(state, now);
  const nextConsec = rolled.consecutiveLosses + 1;
  const tripped = nextConsec >= CONSECUTIVE_LOSS_TRIGGER;
  return {
    ...rolled,
    consecutiveLosses: nextConsec,
    dailyLossPct: rolled.dailyLossPct + Math.max(0, lossPct),
    lastLossAt: now,
    cooldownUntil: tripped ? now + COOLDOWN_MS : rolled.cooldownUntil,
    circuitTrippedAt: tripped ? now : rolled.circuitTrippedAt,
  };
}

/** Win zera a sequência de losses consecutivas e mantém o resto como está
 *  (cooldown só é limpo por tempo, não por win). */
export function recordWin(state: GuardState, now: number): GuardState {
  const rolled = rolloverIfNewDay(state, now);
  return {
    ...rolled,
    consecutiveLosses: 0,
  };
}

/** Reset manual/operacional (ex.: início de sessão, intervenção). */
export function resetGuard(state: GuardState, now: number): GuardState {
  return freshGuardState(now);
}
