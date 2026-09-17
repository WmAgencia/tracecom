/**
 * STRATEGY MANAGER (Fase 5) — selecao deterministica entre as estrategias CONGELADAS.
 *
 * Regras:
 *  - Nao cria, nao altera e nao retroage estrategias; escolhe apenas entre as 10 variantes existentes.
 *  - Revisao a cada N settlements (gatilho), nunca "a que ganhou os ultimos 10".
 *  - Criterios conservadores e CONFIGURAVEIS (expostos, documentados, sem numeros escondidos).
 *  - Hysteresis: cooldown por settlements + tempo minimo entre trocas (anti-flapping).
 *  - Default SHADOW_RECOMMENDATION (apenas recomenda). AUTO_STRATEGY_SWITCH: OFF por padrao,
 *    permitido APENAS em PRACTICE; REAL => proibido.
 *  - Mudanca so vale para decisoes posteriores ao timestamp da promocao.
 */
export const MANAGER_VERSION = "strategy-manager-v1";

export const MANAGER_DEFAULTS = {
  mode: "SHADOW_RECOMMENDATION", // SHADOW_RECOMMENDATION | AUTO_STRATEGY_SWITCH (OFF por padrao = recomendacao)
  autoSwitchEnabled: false,
  reviewEverySettlements: 10,
  minTotalSamples: 60,
  minRecentSamples: 30,
  minPerformanceDelta: 0.08, // diferenca minima de PnL unitario (janela recente do challenger - champion)
  maxDrawdown: 8, // drawdown maximo aceitavel do challenger (unidades de stake)
  minPayoutQuality: 75, // payout medio minimo (%)
  stabilityWindowShort: 20,
  stabilityWindowLong: 100,
  maxStabilityDelta: 0.12, // |pnl/trade curto - pnl/trade longo| maximo do challenger
  cooldownSettlements: 30,
  minTimeBetweenSwitchesMs: 6 * 60 * 60 * 1000,
};

export function wilsonLower(wins, total, z = 1.96) {
  if (!total) return null;
  const p = wins / total;
  const denominator = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return Math.max(0, (center - margin) / denominator);
}

export class StrategyManager {
  constructor({ config = {}, now = () => Date.now() } = {}) {
    this.config = { ...MANAGER_DEFAULTS, ...config };
    this.now = now;
    this.state = new Map(); // marketKey -> { settlementsSinceReview, settlementsSinceSwitch, lastSwitchAt, championVariantId, lastReviewAt, pendingOutcome }
    this.reviews = [];
    this.sequence = 0;
  }

  ensureMarket(marketKey, championVariantId) {
    if (!this.state.has(marketKey)) this.state.set(marketKey, { settlementsSinceReview: 0, settlementsSinceSwitch: Number.MAX_SAFE_INTEGER, lastSwitchAt: null, championVariantId: championVariantId ?? null, lastReviewAt: null, pendingOutcome: null });
    return this.state.get(marketKey);
  }

  setChampion(marketKey, variantId) { this.ensureMarket(marketKey, variantId).championVariantId = variantId; }

  /** Variante preferida pelo gestor (recomendacao pendente > champion). Usada pelo braco E do A/B (shadow). */
  preferredVariant(marketKey) {
    const state = this.state.get(marketKey);
    if (!state) return null;
    const recommended = state.pendingOutcome?.recommendation?.to ?? null;
    return recommended ?? state.championVariantId ?? null;
  }

  /** Alimentado no settlement do champion operacional (todo settlement conta para o gatilho). */
  onSettlement(marketKey, { result, pnl = 0 } = {}) {
    const state = this.ensureMarket(marketKey, null);
    state.settlementsSinceReview += 1;
    state.settlementsSinceSwitch = Math.min(Number.MAX_SAFE_INTEGER, state.settlementsSinceSwitch + 1);
    if (state.pendingOutcome) {
      state.pendingOutcome.settlements.push({ result, pnl: Number(pnl) || 0 });
      if (state.pendingOutcome.settlements.length >= state.pendingOutcome.horizon) {
        const rows = state.pendingOutcome.settlements;
        state.pendingOutcome.result = {
          settlements: rows.length,
          championPnl: Number(rows.reduce((sum, row) => sum + row.pnl, 0).toFixed(4)),
          wins: rows.filter((row) => row.result === "WIN").length,
          losses: rows.filter((row) => row.result === "LOSS").length,
        };
        this.reviews.push({ type: "OUTCOME", marketKey, ...state.pendingOutcome.result, recommendation: state.pendingOutcome.recommendation, at: this.now(), switchApplied: state.pendingOutcome.switchApplied });
        if (this.reviews.length > 500) this.reviews.splice(0, this.reviews.length - 500);
        state.pendingOutcome = null;
      }
    }
    return { settlementsSinceReview: state.settlementsSinceReview, trigger: state.settlementsSinceReview >= this.config.reviewEverySettlements };
  }

  /** Avalia champion vs challenger (dados do scoreboard prospectivo; nunca mistura mercados). */
  evaluate({ marketKey, marketType, board, challenger, mode, practiceOnly = true }) {
    const state = this.ensureMarket(marketKey, null);
    const championId = state.championVariantId ?? board?.variants?.[0]?.variantId ?? null;
    const champion = board.variants.find((row) => row.variantId === championId) ?? null;
    const checks = [];
    const add = (name, ok, detail) => checks.push({ name, ok: ok === true, detail });
    const modeValue = mode ?? this.config.mode;
    const autoSwitch = modeValue === "AUTO_STRATEGY_SWITCH" && this.config.autoSwitchEnabled === true && practiceOnly === true && marketType !== "REAL";
    add("mode_is_auto", modeValue === "AUTO_STRATEGY_SWITCH", modeValue);
    add("auto_switch_flag", this.config.autoSwitchEnabled === true, this.config.autoSwitchEnabled);
    add("practice_only", practiceOnly === true, practiceOnly);
    if (!challenger) { add("challenger_exists", false, null); return this.#recordReview({ marketKey, marketType, championId, champion, challenger: null, decision: "KEEP", reason: "SEM_CHALLENGER", checks, autoSwitch, state }); }
    add("challenger_exists", true, challenger.variantId);
    add("challenger_total_samples", challenger.trades >= this.config.minTotalSamples, { trades: challenger.trades, min: this.config.minTotalSamples });
    add("challenger_recent_samples", challenger.recent.sample >= this.config.minRecentSamples, { recent: challenger.recent.sample, min: this.config.minRecentSamples });
    add("champion_recent_samples", (champion?.recent?.sample ?? 0) >= this.config.minRecentSamples, { recent: champion?.recent?.sample ?? 0, min: this.config.minRecentSamples });
    const championRecent = champion?.recent?.pnlPerTrade ?? null;
    const challengerRecent = challenger.recent?.pnlPerTrade ?? null;
    const delta = championRecent === null || challengerRecent === null ? null : Number((challengerRecent - championRecent).toFixed(4));
    add("performance_delta", delta !== null && delta >= this.config.minPerformanceDelta, { delta, min: this.config.minPerformanceDelta, championRecent, challengerRecent });
    add("challenger_drawdown", challenger.maxDrawdown <= this.config.maxDrawdown, { drawdown: challenger.maxDrawdown, max: this.config.maxDrawdown });
    add("payout_quality", (challenger.avgPayout ?? 0) >= this.config.minPayoutQuality, { avgPayout: challenger.avgPayout, min: this.config.minPayoutQuality });
    const short = challenger.recent?.pnlPerTrade ?? null;
    const longWindow = challenger.pnlPerTrade ?? null;
    const stabilityDelta = short === null || longWindow === null ? null : Math.abs(Number((short - longWindow).toFixed(4)));
    add("stability", stabilityDelta !== null && stabilityDelta <= this.config.maxStabilityDelta, { stabilityDelta, max: this.config.maxStabilityDelta });
    add("cooldown_settlements", state.settlementsSinceSwitch >= this.config.cooldownSettlements, { since: state.settlementsSinceSwitch, min: this.config.cooldownSettlements });
    const sinceTime = state.lastSwitchAt === null ? Infinity : this.now() - state.lastSwitchAt;
    add("cooldown_time", sinceTime >= this.config.minTimeBetweenSwitchesMs, { sinceMs: Number.isFinite(sinceTime) ? sinceTime : null, minMs: this.config.minTimeBetweenSwitchesMs });
    // Elegibilidade e baseada apenas em EVIDENCIA (hysteresis incluida). Modo/practice definem se PODE APLICAR.
    const evidenceChecks = checks.filter((check) => !["mode_is_auto", "auto_switch_flag", "practice_only"].includes(check.name));
    const failed = evidenceChecks.filter((check) => !check.ok);
    const needsSamples = failed.some((check) => ["challenger_total_samples", "challenger_recent_samples", "champion_recent_samples"].includes(check.name));
    const eligible = failed.length === 0;
    const decision = eligible ? "SWITCH_ELIGIBLE" : "KEEP";
    const reason = eligible ? "CRITERIOS_SATISFEITOS" : needsSamples ? "AMOSTRA_INSUFICIENTE" : `CRITERIO_FALHOU:${failed[0].name}`;
    return this.#recordReview({ marketKey, marketType, championId, champion, challenger, decision, reason, checks, autoSwitch: eligible && autoSwitch, state, delta, stabilityDelta });
  }

  #recordReview({ marketKey, marketType, championId, champion, challenger, decision, reason, checks, autoSwitch, state, delta = null, stabilityDelta = null }) {
    const applied = decision === "SWITCH_ELIGIBLE" && autoSwitch === true;
    const review = {
      id: ++this.sequence, marketKey, marketType, at: this.now(), mode: this.config.mode, autoSwitch,
      champion: championId, challenger: challenger?.variantId ?? null,
      decision: applied ? "SWITCH" : decision === "SWITCH_ELIGIBLE" ? "RECOMMEND_SWITCH" : "KEEP",
      reason, checks,
      evidence: { delta, stabilityDelta, championRecent: champion?.recent ?? null, challengerRecent: challenger?.recent ?? null, challengerTotals: challenger ? { trades: challenger.trades, drawdown: challenger.maxDrawdown, avgPayout: challenger.avgPayout } : null, scoreboardVersion: null },
      scoreboardVersion: null, appliedAt: applied ? this.now() : null,
    };
    if (applied) {
      state.championVariantId = challenger.variantId;
      state.lastSwitchAt = this.now();
      state.settlementsSinceSwitch = 0;
      state.pendingOutcome = { recommendation: { from: championId, to: challenger.variantId }, horizon: 20, settlements: [], switchApplied: true };
    } else if (decision === "SWITCH_ELIGIBLE" || decision === "KEEP") {
      if (decision === "SWITCH_ELIGIBLE") state.pendingOutcome = { recommendation: { from: championId, to: challenger?.variantId ?? null }, horizon: 20, settlements: [], switchApplied: false };
    }
    state.lastReviewAt = this.now();
    state.settlementsSinceReview = 0;
    this.reviews.push({ type: "REVIEW", ...review });
    if (this.reviews.length > 500) this.reviews.splice(0, this.reviews.length - 500);
    return { review, applied, champion: state.championVariantId };
  }

  setConfig(patch = {}) {
    const allowed = Object.keys(MANAGER_DEFAULTS);
    const next = { ...this.config };
    for (const [key, value] of Object.entries(patch)) {
      if (!allowed.includes(key)) continue;
      if (key === "mode") next.mode = value === "AUTO_STRATEGY_SWITCH" ? "AUTO_STRATEGY_SWITCH" : "SHADOW_RECOMMENDATION";
      else if (key === "autoSwitchEnabled") next.autoSwitchEnabled = value === true;
      else if (Number.isFinite(Number(value))) next[key] = Number(value);
    }
    this.config = next;
    return this.config;
  }

  status() {
    return {
      version: MANAGER_VERSION, mode: this.config.mode, autoSwitchEnabled: this.config.autoSwitchEnabled,
      config: { ...this.config },
      markets: [...this.state.entries()].map(([marketKey, state]) => ({ marketKey, ...state, pendingOutcome: state.pendingOutcome ? { recommendation: state.pendingOutcome.recommendation, horizon: state.pendingOutcome.horizon, collected: state.pendingOutcome.settlements.length } : null })),
      reviews: this.reviews.slice(-20).reverse(),
    };
  }

  toJSON() { return { version: MANAGER_VERSION, config: this.config, state: [...this.state.entries()], reviews: this.reviews.slice(-200) }; }
  loadFrom(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.state)) return false;
    this.config = { ...this.config, ...(snapshot.config ?? {}) };
    for (const [marketKey, state] of snapshot.state) this.state.set(marketKey, { ...state, pendingOutcome: null });
    this.reviews = Array.isArray(snapshot.reviews) ? snapshot.reviews.slice(-200) : [];
    return true;
  }
}
