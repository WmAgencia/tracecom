/**
 * ENTRY TIMING (Fase 6.2) — Just-in-Time entry: candidato -> janela -> revalidacao final -> commit.
 *
 * Semantica (binarias 60s, IQ Option):
 *  - targetEntryAt  = fronteira de 60s alinhada ao SERVER TIME da IQ Option (nao ao relogio local).
 *  - targetExpiryAt = targetEntryAt + horizonte (o mesmo par que computeExpiration resolve ao enviar
 *    ~1.5s antes da fronteira; expiration do broker e conferida antes do commit).
 *  - submitAt       = targetEntryAt - entryLeadMs (default 1500ms, limites 1000-2000ms).
 *  - A analise continua rodando ate submitAt; a decisao final e revalidada com o snapshot mais recente.
 *  - Mudou a logica? cancela. Nunca inverte automaticamente, nunca entra atrasado.
 *
 * Este modulo e puro/deterministico: nenhuma IO, nenhuma ordem.
 */
export const ENTRY_TIMING_VERSION = "entry-timing-v1";
export const DEFAULT_ENTRY_LEAD_MS = 1500;
export const MIN_ENTRY_LEAD_MS = 1000;
export const MAX_ENTRY_LEAD_MS = 2000;
export const DEFAULT_MAX_DRIFT_MS = 2500;
export const MIN_REVALIDATION_GAP_MS = 1500;
export const JITTER_BUFFER_MS = 300;
export const SAFETY_BUFFER_MS = 150;
export const HORIZON_MS = 60_000;

export const CANDIDATE_STATUS = ["WAITING_WINDOW", "REVALIDATING", "CONFIRMED", "ORDER_SENT", "POSITION_OPEN", "CANCELLED", "WINDOW_MISSED", "GATE_BLOCKED", "DUPLICATE"];

export function clampLeadMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_ENTRY_LEAD_MS;
  return Math.max(MIN_ENTRY_LEAD_MS, Math.min(MAX_ENTRY_LEAD_MS, Math.round(numeric)));
}

/** entryLeadMs dinamico: p95 de ACK + jitter + safety, sempre dentro de 1000-2000ms. */
export function dynamicEntryLeadMs(ackSamples = [], { min = MIN_ENTRY_LEAD_MS, max = MAX_ENTRY_LEAD_MS, fallback = DEFAULT_ENTRY_LEAD_MS } = {}) {
  const values = ackSamples.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!values.length) return clampLeadMs(fallback);
  const index = Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1);
  const p95 = values[Math.max(0, index)];
  return Math.max(min, Math.min(max, Math.round(p95 + JITTER_BUFFER_MS + SAFETY_BUFFER_MS)));
}

/**
 * Primeira fronteira de horizonte com folga suficiente para revalidar e enviar.
 * serverNowMs: relogio do servidor IQ (ms).
 */
export function nextEntryWindow({ serverNowMs, leadMs = DEFAULT_ENTRY_LEAD_MS, horizonMs = HORIZON_MS, minGapMs = MIN_REVALIDATION_GAP_MS } = {}) {
  const now = Number(serverNowMs);
  if (!Number.isFinite(now) || now <= 0) throw new Error("SERVER_TIME_REQUIRED");
  const lead = clampLeadMs(leadMs);
  const grid = Math.max(1_000, Number(horizonMs) || HORIZON_MS);
  const minTarget = now + lead + Math.max(0, Number(minGapMs) || 0);
  const targetEntryAt = Math.ceil(minTarget / grid) * grid;
  const targetExpiryAt = targetEntryAt + grid;
  return { targetEntryAt, targetExpiryAt, submitAt: targetEntryAt - lead, leadMs: lead, horizonMs: grid, serverNowMs: now };
}

/** Campos comparaveis entre CandidateSnapshot e FinalEntrySnapshot. */
export function comparableSnapshot(input = {}) {
  return {
    action: input.action ?? null, regime: input.regime ?? null, structure: input.structure?.label ?? input.structure ?? null,
    setup: input.setup ?? null, trigger: input.trigger ?? null,
    rsi: input.momentum?.rsi14 ?? input.rsi ?? null, adx: input.strength?.adx14 ?? input.adx ?? null,
    diSpread: input.strength?.diSpread ?? null, atrRatio: input.volatility?.atrRatio ?? null,
    donchian: input.location?.zone ?? input.donchian ?? null,
    criticVerdict: input.critic?.verdict ?? input.criticVerdict ?? null, consensusStatus: input.consensus?.status ?? input.consensusStatus ?? null,
    price: input.price ?? null,
  };
}

const FIELD_LABELS = { action: "action", regime: "regime", structure: "structure", setup: "setup", trigger: "trigger", rsi: "rsi", adx: "adx", diSpread: "diSpread", atrRatio: "atrRatio", donchian: "donchian", criticVerdict: "criticVerdict", consensusStatus: "consensusStatus", price: "price" };

/** Compara snapshots e devolve mudancas observaveis (para candidateChangedBeforeEntry). */
export function compareCandidateSnapshots(initial = {}, final = {}) {
  const changes = [];
  for (const key of Object.keys(FIELD_LABELS)) {
    const before = initial[key] ?? null;
    const after = final[key] ?? null;
    if (before === null && after === null) continue;
    const same = typeof before === "number" || typeof after === "number" ? Number(before) === Number(after) : before === after;
    if (!same) changes.push({ field: FIELD_LABELS[key], before, after });
  }
  return { changed: changes.length > 0, changes };
}

const REGIME_INCOMPATIBLE = ["CHAOTIC", "UNCLEAR", "TRANSITION"];
const REGIME_COMPATIBLE = {
  TREND_UP: ["TREND_UP", "EXPANSION"],
  TREND_DOWN: ["TREND_DOWN", "EXPANSION"],
  EXPANSION: ["EXPANSION", "TREND_UP", "TREND_DOWN"],
  RANGE: ["RANGE", "COMPRESSION"],
  COMPRESSION: ["COMPRESSION", "RANGE"],
};
export function regimeCompatible(candidateRegime, finalRegime) {
  if (finalRegime === null || finalRegime === undefined) return false;
  if (REGIME_INCOMPATIBLE.includes(finalRegime)) return false;
  if (!candidateRegime) return true;
  const allowed = REGIME_COMPATIBLE[candidateRegime];
  if (!allowed) return candidateRegime === finalRegime;
  return allowed.includes(finalRegime);
}

/**
 * Revalidacao final (T - entryLeadMs): regras A-H. H (gate) e responsabilidade do chamador.
 * Retorna { ok, reason, checks }.
 */
export function revalidateCandidate({ candidate = {}, final = {}, freshness = {}, config = {} } = {}) {
  const checks = [];
  const add = (rule, ok, detail = null) => checks.push({ rule, ok: ok === true, detail });
  const action = final.action ?? null;
  add("A_ACTION_UNCHANGED", action === candidate.action, { candidate: candidate.action, final: action });
  const regime = final.regime ?? null;
  add("B_REGIME_COMPATIBLE", regimeCompatible(candidate.regime, regime), { candidate: candidate.regime ?? null, final: regime });
  add("C_SETUP_VALID", Boolean(final.setup) && final.setup !== "NO_VALID_SETUP" && (!candidate.setup || final.setup === candidate.setup), { candidate: candidate.setup ?? null, final: final.setup ?? null });
  add("D_TRIGGER_PRESENT", Boolean(final.trigger), final.trigger ?? null);
  add("E_CRITIC_NOT_VETO", final.criticVerdict !== "VETO", final.criticVerdict ?? null);
  add("F_CONSENSUS_CONFIRMED", final.consensusStatus === "CONFIRMED" && action === candidate.action, final.consensusStatus ?? null);
  add("G_DATA_FRESH", freshness.fresh === true, freshness.reason ?? null);
  const failed = checks.filter((check) => !check.ok);
  const reasonMap = {
    A_ACTION_UNCHANGED: final.action === "WAIT" ? "CANDIDATE_LOGIC_CHANGED_TO_WAIT" : "CANDIDATE_LOGIC_CHANGED_DIRECTION",
    B_REGIME_COMPATIBLE: "CANDIDATE_REGIME_CHANGED", C_SETUP_VALID: "CANDIDATE_SETUP_INVALIDATED", D_TRIGGER_PRESENT: "CANDIDATE_TRIGGER_GONE",
    E_CRITIC_NOT_VETO: "CANDIDATE_CRITIC_VETO", F_CONSENSUS_CONFIRMED: "CANDIDATE_CONSENSUS_LOST", G_DATA_FRESH: "CANDIDATE_DATA_STALE",
  };
  return { ok: failed.length === 0, reason: failed.length ? reasonMap[failed[0].rule] ?? "CANDIDATE_REVALIDATION_FAILED" : null, checks };
}

export function makeCandidate({ marketKey, marketType, action, now, serverNow, window, snapshot = {}, correlationId = null }) {
  return {
    id: `cand_${marketKey.replace(":", "_")}_${window.targetEntryAt}`,
    version: ENTRY_TIMING_VERSION, marketKey, marketType, action, correlationId,
    createdAt: now, serverNowAtCreate: serverNow, targetEntryAt: window.targetEntryAt, targetExpiryAt: window.targetExpiryAt,
    submitAt: window.submitAt, entryLeadMs: window.leadMs, status: "WAITING_WINDOW", updatedAt: now,
    evaluations: 0, initial: comparableSnapshot(snapshot), initialFull: snapshot,
    changes: { changed: false, changes: [] }, revalidatedAt: null, confirmation: null, cancelReason: null, confirmedAt: null,
  };
}

/** Braço de pesquisa prospectivo: decisao no momento do candidato vs entrada just-in-time. */
export class EntryTimingExperiment {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.version = "entry-timing-experiment-v1";
    this.early = []; // aguardando liquidacao causal do braco EARLY_DECISION_SHADOW
    this.earlySettled = [];
    this.jit = []; // entradas efetivas (JUST_IN_TIME_ENTRY)
    this.counters = { candidates: 0, cancellations: 0, directionChanges: 0, setupInvalidated: 0, windowMissed: 0 };
  }

  recordCandidate({ marketKey, marketType, candidateId, action, entryPrice, payout, atMs, targetEntryAt, targetExpiryAt, regime = null, setup = null, trigger = null }) {
    this.counters.candidates += 1;
    const record = { id: candidateId, marketKey, marketType, action, entryPrice: Number(entryPrice) || null, payout: Number(payout) || null, atMs, targetEntryAt, targetExpiryAt, regime, setup, trigger, settled: false, result: null, pnl: null };
    this.early.push(record);
    if (this.early.length > 1000) this.early.splice(0, this.early.length - 1000);
    return record;
  }

  recordCancellation({ candidateId = null, reason, changes = [] }) {
    this.counters.cancellations += 1;
    if (changes.some((change) => change.field === "action")) this.counters.directionChanges += 1;
    if (reason === "CANDIDATE_SETUP_INVALIDATED") this.counters.setupInvalidated += 1;
    if (reason === "ENTRY_WINDOW_MISSED") this.counters.windowMissed += 1;
    return { candidateId, reason, counter: this.counters.cancellations };
  }

  recordExecution({ marketKey, candidateId, action, result, stake, payout, entryAt, settlementAt, entryPrice = null }) {
    const fraction = Number(payout) > 1 ? Number(payout) / 100 : (Number(payout) || 0.85);
    const pnl = result === "WIN" ? Number(stake) * fraction : result === "LOSS" ? -Number(stake) : 0;
    const record = { id: candidateId, marketKey, action, result, stake: Number(stake) || 0, payout: Number(payout) || null, pnl: Number(pnl.toFixed(4)), entryAt, settlementAt, entryPrice };
    this.jit.push(record);
    if (this.jit.length > 1000) this.jit.splice(0, this.jit.length - 1000);
    return record;
  }

  /** Liquidacao causal do braco EARLY (candle fechado >= targetExpiryAt). */
  settle({ marketKey, candles, index, nowMs }) {
    if (!Array.isArray(candles) || index < 0 || index >= candles.length) return 0;
    const candle = candles[index];
    let settled = 0;
    for (const record of this.early) {
      if (record.settled || record.marketKey !== marketKey) continue;
      if (!Number.isFinite(record.entryPrice) || record.entryPrice === null) { record.settled = true; record.result = "UNKNOWN"; record.pnl = null; settled += 1; continue; }
      if (candle.bucketStart < record.targetExpiryAt) continue;
      const up = candle.close > record.entryPrice;
      record.result = record.action === "BUY" ? (up ? "WIN" : candle.close < record.entryPrice ? "LOSS" : "DRAW") : (!up ? "WIN" : candle.close > record.entryPrice ? "LOSS" : "DRAW");
      const fraction = record.payout > 1 ? record.payout / 100 : (record.payout || 0.85);
      record.pnl = Number((record.result === "WIN" ? fraction : record.result === "LOSS" ? -1 : 0).toFixed(4));
      record.settled = true;
      record.settlementBucket = candle.bucketStart;
      this.earlySettled.push(record);
      settled += 1;
    }
    if (this.earlySettled.length > 1000) this.earlySettled.splice(0, this.earlySettled.length - 1000);
    return settled;
  }

  scoreboard() {
    const summarize = (rows, pickPnl) => {
      let n = 0, wins = 0, losses = 0, draws = 0, pnl = 0;
      for (const row of rows) { n += 1; pnl += Number(pickPnl(row)) || 0; if (row.result === "WIN") wins += 1; else if (row.result === "LOSS") losses += 1; else draws += 1; }
      const decided = wins + losses + draws;
      return { n, wins, losses, draws, winRate: decided ? Number((wins / decided).toFixed(4)) : null, pnl: Number(pnl.toFixed(4)), pnlPerTrade: decided ? Number((pnl / decided).toFixed(4)) : null };
    };
    return {
      version: this.version, counters: { ...this.counters },
      arms: {
        EARLY_DECISION_SHADOW: summarize(this.early.filter((row) => row.settled), (row) => row.pnl),
        JUST_IN_TIME_ENTRY: summarize(this.jit, (row) => row.pnl),
      },
      note: "Comparacao prospectiva; nunca usar os 15 trades historicos para declarar JIT melhor.",
    };
  }

  toJSON() {
    return { version: this.version, counters: { ...this.counters }, early: this.early.slice(-300), jit: this.jit.slice(-300) };
  }

  loadFrom(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return false;
    this.counters = { ...this.counters, ...(snapshot.counters ?? {}) };
    this.early = Array.isArray(snapshot.early) ? snapshot.early.slice(-300) : [];
    this.jit = Array.isArray(snapshot.jit) ? snapshot.jit.slice(-300) : [];
    this.earlySettled = [];
    return true;
  }
}
