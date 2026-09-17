/**
 * APRENDIZ (Fase 5.1) — mesa de laboratório com DOIS agentes: MENTOR (pesquisador) + APRENDIZ.
 *
 * - O mentor pesquisa/testa técnicas próprias (NÃO altera as estratégias congeladas V1/V2/V3/V8),
 *   avalia os trades do aprendiz, extrai lições dos LOSS e passa a técnica melhorada quando há evidência.
 * - Tudo opera SOMENTE em SHADOW (nenhum caminho de ordem; nunca REAL).
 * - Causalidade estrita: treino/lição/promoção usam apenas candles e features disponíveis no momento;
 *   liquidação no candle de horizonte (nunca futuro).
 * - Critérios conservadores e expostos (anti-overfitting/anti-flapping), com cooldown.
 */
export const APPRENTICE_VERSION = "apprentice-v1";

export const TECHNIQUE_BOUNDS = {
  entryRsiLow: [15, 45], entryRsiHigh: [55, 85],
  minAdx: [0, 35], maxAdx: [25, 100], minDiSpread: [0, 20],
  minS: [0.1, 0.6], minR24Abs: [0, 0.001], minStreak: [1, 4],
  donchianBreakout: [0.6, 0.95], donchianReversion: [0.05, 0.4],
  horizonSeconds: [45, 300],
};

export const TECHNIQUE_SEEDS = [
  { id: "T1_RSI_REVERSION", label: "Reversão em RSI extremo", params: { entryRsiLow: 30, entryRsiHigh: 70, minAdx: 0, maxAdx: 100, minDiSpread: 0, minS: 0, minR24Abs: 0, minStreak: 0, donchianBreakout: 0, donchianReversion: 0.2, horizonSeconds: 60 } },
  { id: "T2_DONCHIAN_BREAK", label: "Rompimento Donchian", params: { entryRsiLow: 0, entryRsiHigh: 100, minAdx: 18, maxAdx: 100, minDiSpread: 5, minS: 0, minR24Abs: 0, minStreak: 0, donchianBreakout: 0.85, donchianReversion: 0, horizonSeconds: 60 } },
  { id: "T3_MOMENTUM", label: "Momentum confirmado", params: { entryRsiLow: 0, entryRsiHigh: 100, minAdx: 15, maxAdx: 100, minDiSpread: 0, minS: 0.3, minR24Abs: 0.00005, minStreak: 0, donchianBreakout: 0, donchianReversion: 0, horizonSeconds: 60 } },
  { id: "T4_MICRO_STREAK", label: "Continuação de microestrutura", params: { entryRsiLow: 0, entryRsiHigh: 100, minAdx: 0, maxAdx: 100, minDiSpread: 0, minS: 0, minR24Abs: 0, minStreak: 2, donchianBreakout: 0, donchianReversion: 0, horizonSeconds: 45 } },
  { id: "T5_DI_TREND", label: "Tendência por DI", params: { entryRsiLow: 0, entryRsiHigh: 100, minAdx: 22, maxAdx: 100, minDiSpread: 8, minS: 0, minR24Abs: 0, minStreak: 0, donchianBreakout: 0, donchianReversion: 0, horizonSeconds: 60 } },
];

const clampParam = (name, value) => {
  const bounds = TECHNIQUE_BOUNDS[name];
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return bounds ? Math.max(bounds[0], Math.min(bounds[1], number)) : number;
};

export const APPRENTICE_DEFAULTS = {
  enabled: true,
  execution: "SHADOW_ONLY", // nunca existe execucao REAL/PRACTICE por este agente
  reviewEverySettlements: 20,
  minCandidateSamples: 20,
  minPerformanceDelta: 0.10,
  maxDrawdown: 8,
  maxCandidates: 3,
  cooldownSettlements: 25,
  maxLessonsPerWindow: 6,
  lessonWindowSettlements: 40,
};

/** Avaliacao causal de uma tecnica propria (usa apenas features/contexto do instante). */
export function evaluateTechnique(technique, features, context) {
  if (!features || !context) return null;
  const p = technique.params;
  const indicators = context.deterministicIndicators ?? {};
  const rsi = indicators.rsi14?.value ?? null;
  const adx = indicators.adx14?.value ?? null;
  const diSpread = indicators.diSpread?.value ?? null;
  const position = indicators.donchianPosition?.value ?? null;
  const streak = context.microstructure?.streak ?? null;
  if (rsi === null || adx === null) return null;
  if (p.minAdx && adx < p.minAdx) return null;
  if (p.maxAdx && adx > p.maxAdx) return null;
  if (p.minDiSpread && (diSpread ?? 0) < p.minDiSpread) return null;
  if (p.minStreak && Math.abs(streak ?? 0) < p.minStreak) return null;
  if (p.minS && Math.abs(features.s ?? 0) < p.minS) return null;
  if (p.minR24Abs && Math.abs(features.r24 ?? 0) < p.minR24Abs) return null;
  if (technique.id === "T1_RSI_REVERSION") {
    if (rsi <= p.entryRsiLow && (position === null || position <= p.donchianReversion)) return "BUY";
    if (rsi >= p.entryRsiHigh && (position === null || position >= 1 - p.donchianReversion)) return "SELL";
    return null;
  }
  if (p.donchianBreakout && position !== null) {
    if (position >= p.donchianBreakout) return "BUY";
    if (position <= 1 - p.donchianBreakout) return "SELL";
    return null;
  }
  if (p.minStreak) return (streak ?? 0) > 0 ? "BUY" : (streak ?? 0) < 0 ? "SELL" : null;
  if (p.minDiSpread) return (features.s ?? 0) > 0 ? "BUY" : (features.s ?? 0) < 0 ? "SELL" : null;
  return (features.s ?? 0) > 0.1 ? "BUY" : (features.s ?? 0) < -0.1 ? "SELL" : null;
}

export class ApprenticeDesk {
  constructor({ now = () => Date.now(), config = {}, onEvent = () => {} } = {}) {
    this.now = now;
    this.config = { ...APPRENTICE_DEFAULTS, ...config };
    this.onEvent = onEvent;
    this.techniques = new Map();
    for (const seed of TECHNIQUE_SEEDS) this.#register({ ...seed, status: "ACTIVE", generation: 1, createdAt: now() });
    this.currentTechniqueId = "T1_RSI_REVERSION";
    this.markets = new Map(); // marketKey -> { stats: Map<techniqueId, stats>, open: Map<techniqueKey, trade>, trades: [] }
    this.lessons = [];
    this.promotions = [];
    this.sequence = 0;
    this.settlementsSinceSwitch = Number.MAX_SAFE_INTEGER;
    this.lessonsInWindow = 0;
    this.lastPromotionAt = null;
  }

  #register(technique) { this.techniques.set(technique.id, technique); return technique; }

  #market(marketKey) {
    if (!this.markets.has(marketKey)) this.markets.set(marketKey, { stats: new Map(), open: new Map(), trades: [] });
    return this.markets.get(marketKey);
  }
  #stats(marketKey, techniqueId) {
    const market = this.#market(marketKey);
    if (!market.stats.has(techniqueId)) market.stats.set(techniqueId, { trades: 0, wins: 0, losses: 0, draws: 0, pnl: 0, lastResults: [], maxDrawdown: 0, equity: 0, peak: 0, lessons: 0 });
    return market.stats.get(techniqueId);
  }

  listTechniques() {
    return [...this.techniques.values()].map((technique) => ({ id: technique.id, label: technique.label, status: technique.status, generation: technique.generation, params: technique.params, parent: technique.parent ?? null }));
  }

  /** Observa um candle (com features do Feature Engine) e roda TODAS as tecnicas da biblioteca em shadow. */
  observeCandle({ marketKey, marketType, candles, index, features, context, payout = null, atMs = null }) {
    if (!this.config.enabled || !Array.isArray(candles) || index < 0 || index >= candles.length) return { opened: 0, settled: 0 };
    const candle = candles[index];
    const market = this.#market(marketKey);
    let opened = 0, settled = 0;
    for (const [key, trade] of [...market.open.entries()]) {
      if (candle.bucketStart < trade.settlementAfterMs) continue;
      const result = trade.direction === "BUY" ? (candle.close > trade.entryPrice ? "WIN" : candle.close < trade.entryPrice ? "LOSS" : "DRAW") : (candle.close < trade.entryPrice ? "WIN" : candle.close > trade.entryPrice ? "LOSS" : "DRAW");
      const stats = this.#stats(marketKey, trade.techniqueId);
      const fraction = payoutFractionS(trade.payout);
      const pnl = result === "WIN" ? fraction : result === "LOSS" ? -1 : 0;
      stats.trades += 1; stats.pnl = Number((stats.pnl + pnl).toFixed(4));
      stats.equity += pnl; stats.peak = Math.max(stats.peak, stats.equity); stats.maxDrawdown = Math.max(stats.maxDrawdown, stats.peak - stats.equity);
      if (result === "WIN") stats.wins += 1; else if (result === "LOSS") stats.losses += 1; else stats.draws += 1;
      stats.lastResults.push(result); if (stats.lastResults.length > 300) stats.lastResults.splice(0, stats.lastResults.length - 300);
      market.trades.push({ id: ++this.sequence, marketKey, marketType, techniqueId: trade.techniqueId, direction: trade.direction, entryPrice: trade.entryPrice, entryBucket: trade.entryBucket, settlementBucket: candle.bucketStart, result, pnl: Number(pnl.toFixed(4)), payout: trade.payout ?? null, at: atMs ?? this.now(), entryFeatures: trade.entryFeatures });
      if (market.trades.length > 1500) market.trades.splice(0, market.trades.length - 1500);
      market.open.delete(key);
      settled += 1;
      this.settlementsSinceSwitch = Math.min(Number.MAX_SAFE_INTEGER, this.settlementsSinceSwitch + 1);
      if (trade.techniqueId === this.currentTechniqueId && result === "LOSS") this.mentorAnalyzeLoss(marketKey, marketType, trade, candle, { atMs });
      this.#maybeReview({ marketKey, marketType, atMs });
    }
    if (!features || !context) return { opened: 0, settled };
    for (const technique of this.techniques.values()) {
      if (technique.status === "RETIRED") continue;
      const key = `${technique.id}`;
      if (market.open.has(key)) continue;
      const direction = evaluateTechnique(technique, features, context);
      if (!direction) continue;
      market.open.set(key, { techniqueId: technique.id, direction, entryPrice: candle.close, entryBucket: candle.bucketStart, settlementAfterMs: candle.bucketStart + technique.params.horizonSeconds * 1000, payout, entryFeatures: { rsi14: features.rsi14, adx: context.deterministicIndicators?.adx14?.value ?? null, s: features.s, streak: context.microstructure?.streak ?? null, position: context.deterministicIndicators?.donchianPosition?.value ?? null }, atMs: atMs ?? this.now() });
      opened += 1;
    }
    return { opened, settled };
  }

  /** Mentor: extrai licao objetiva do LOSS (o que podia ter feito melhor) e propoe ajuste limitado. */
  mentorAnalyzeLoss(marketKey, marketType, trade, candle, { atMs } = {}) {
    const at = atMs ?? this.now();
    if (this.lessonsInWindow >= this.config.maxLessonsPerWindow) return null;
    const features = trade.entryFeatures ?? {};
    const reasons = [];
    if (features.adx14 !== null && features.adx14 < 20) reasons.push({ code: "ADX_FRACO", detail: `ADX ${Number(features.adx14).toFixed(1)} no momento da entrada` });
    if (features.streak !== null && Math.sign(features.streak) !== (trade.direction === "BUY" ? 1 : -1)) reasons.push({ code: "MICRO_CONTRA", detail: `microestrutura ${features.streak} contra a direção ${trade.direction}` });
    if (features.position !== null && trade.direction === "BUY" && features.position > 0.8) reasons.push({ code: "ENTRADA_ESTICADA", detail: `posição ${Number(features.position).toFixed(2)} no topo do canal` });
    if (features.position !== null && trade.direction === "SELL" && features.position < 0.2) reasons.push({ code: "ENTRADA_ESTICADA", detail: `posição ${Number(features.position).toFixed(2)} no fundo do canal` });
    if (!reasons.length) reasons.push({ code: "SEM_PADRAO_CLARO", detail: "sem padrão dominante no instante da entrada" });
    const technique = this.techniques.get(this.currentTechniqueId);
    const adjustment = this.#proposeAdjustment(technique, reasons);
    const lesson = { id: ++this.sequence, marketKey, marketType, techniqueId: technique?.id ?? null, at, result: "LOSS", reasons, adjustment, candidateId: null };
    stats_lessons(this.#stats(marketKey, technique?.id), 1);
    this.lessonsInWindow += 1;
    if (this.lessons.length > 300) this.lessons.splice(0, this.lessons.length - 300);
    if (adjustment) {
      const candidateId = `${technique.id}.g${(technique.generation ?? 1) + 1}_${this.promotions.length + this.techniques.size}`;
      const candidate = this.#register({ id: candidateId, label: `${technique.label} (aprendida)`, params: { ...technique.params, ...adjustment.params }, status: "CANDIDATE", generation: (technique.generation ?? 1) + 1, parent: technique.id, createdAt: at });
      lesson.candidateId = candidate.id;
      this.lessons.push(lesson);
      void this.onEvent("apprentice.lesson", { marketKey, lessonId: lesson.id, techniqueId: technique.id, candidateId: candidate.id, reasons: reasons.map((reason) => reason.code), adjustment: adjustment.params });
      return lesson;
    }
    this.lessons.push(lesson);
    void this.onEvent("apprentice.lesson", { marketKey, lessonId: lesson.id, techniqueId: technique?.id ?? null, reasons: reasons.map((reason) => reason.code), candidateId: null });
    return lesson;
  }

  #proposeAdjustment(technique, reasons) {
    if (!technique) return null;
    const codes = new Set(reasons.map((reason) => reason.code));
    const params = {};
    const p = technique.params;
    if (codes.has("ADX_FRACO")) params.minAdx = clampParam("minAdx", Math.max(p.minAdx ?? 0, 18) + 4);
    if (codes.has("MICRO_CONTRA")) params.minStreak = clampParam("minStreak", Math.max(p.minStreak ?? 0, 0) + 1);
    if (codes.has("ENTRADA_ESTICADA")) {
      params.donchianBreakout = clampParam("donchianBreakout", Math.max(p.donchianBreakout ?? 0, 0.7) + 0.03);
      params.donchianReversion = clampParam("donchianReversion", Math.max(p.donchianReversion ?? 0.15, 0.15) + 0.02);
    }
    const entries = Object.entries(params).filter(([, value]) => value !== null);
    if (!entries.length || this.#candidateCount() >= this.config.maxCandidates) return null;
    return { params: Object.fromEntries(entries.slice(0, 2)), reason: [...codes].join(",") };
  }

  #candidateCount() { return [...this.techniques.values()].filter((technique) => technique.status === "CANDIDATE").length; }

  /** Revisao periodica (a cada N settlements): promove candidata somente com evidencia prospectiva suficiente. */
  #maybeReview({ marketKey, marketType, atMs } = {}) {
    const total = [...this.markets.values()].reduce((sum, market) => sum + [...market.stats.values()].reduce((acc, stats) => acc + stats.trades, 0), 0);
    if (total === 0 || total % this.config.reviewEverySettlements !== 0) return null;
    return this.review({ marketKey, marketType, atMs });
  }

  review({ marketKey = null, atMs = null } = {}) {
    const at = atMs ?? this.now();
    const current = this.techniques.get(this.currentTechniqueId);
    const summary = this.scoreboard();
    const currentAgg = summary.aggregate.find((row) => row.techniqueId === this.currentTechniqueId) ?? null;
    const candidates = this.techniques.get ? [...this.techniques.values()].filter((technique) => technique.status === "CANDIDATE") : [];
    let best = null;
    for (const candidate of candidates) {
      const row = summary.aggregate.find((entry) => entry.techniqueId === candidate.id);
      if (!row || row.trades < this.config.minCandidateSamples) continue;
      const delta = (row.pnlPerTrade ?? -Infinity) - (currentAgg?.pnlPerTrade ?? 0);
      if (delta < this.config.minPerformanceDelta) continue;
      if (row.maxDrawdown > this.config.maxDrawdown) continue;
      if (!best || (row.pnlPerTrade ?? -Infinity) > (best.row.pnlPerTrade ?? -Infinity)) best = { candidate, row, delta };
    }
    const cooldownOk = this.settlementsSinceSwitch >= this.config.cooldownSettlements;
    const decision = best ? (cooldownOk ? "PROMOTE" : "HOLD_COOLDOWN") : candidates.length ? "HOLD_INSUFFICIENT_EVIDENCE" : "NO_CANDIDATE";
    const review = { at, marketKey, currentTechniqueId: this.currentTechniqueId, candidateId: best?.candidate.id ?? null, decision, delta: best?.delta ?? null, current: currentAgg, candidate: best?.row ?? null, cooldownOk, lessons: this.lessonsInWindow };
    if (decision === "PROMOTE") {
      best.candidate.status = "ACTIVE";
      if (current) current.status = "RETIRED";
      this.currentTechniqueId = best.candidate.id;
      this.settlementsSinceSwitch = 0;
      this.lastPromotionAt = at;
      this.promotions.push({ id: ++this.sequence, at, from: current?.id ?? null, to: best.candidate.id, delta: best.delta, evidence: { current: currentAgg, candidate: best.row }, lessons: this.lessons.slice(-5).map((lesson) => ({ reasons: lesson.reasons, adjustment: lesson.adjustment })) });
      if (this.promotions.length > 100) this.promotions.splice(0, this.promotions.length - 100);
      void this.onEvent("apprentice.promotion", { from: current?.id ?? null, to: best.candidate.id, delta: best.delta, candidateTrades: best.row.trades });
      review.decision = "PROMOTE";
    } else void this.onEvent("apprentice.review", review);
    this.lessonsInWindow = Math.max(0, this.lessonsInWindow - 4);
    return review;
  }

  scoreboard() {
    const aggregateMap = new Map();
    for (const market of this.markets.values()) for (const [techniqueId, stats] of market.stats.entries()) {
      const row = aggregateMap.get(techniqueId) ?? { techniqueId, trades: 0, wins: 0, losses: 0, draws: 0, pnl: 0 };
      row.trades += stats.trades; row.wins += stats.wins; row.losses += stats.losses; row.draws += stats.draws; row.pnl = Number((row.pnl + stats.pnl).toFixed(4));
      aggregateMap.set(techniqueId, row);
    }
    const aggregate = [...aggregateMap.values()].map((row) => ({ ...row, winRate: row.wins + row.losses + row.draws ? Number((row.wins / (row.wins + row.losses + row.draws)).toFixed(4)) : null, pnlPerTrade: row.trades ? Number((row.pnl / row.trades).toFixed(4)) : null }));
    return {
      version: APPRENTICE_VERSION, execution: "SHADOW_ONLY",
      currentTechniqueId: this.currentTechniqueId,
      techniques: this.listTechniques(),
      aggregate,
      byMarket: [...this.markets.entries()].map(([marketKey, market]) => ({ marketKey, techniques: [...market.stats.entries()].map(([techniqueId, stats]) => ({ techniqueId, ...stats, lastResults: undefined })) })),
      lessons: this.lessons.slice(-15).reverse(),
      promotions: this.promotions.slice(-10).reverse(),
      settlementsSinceSwitch: this.settlementsSinceSwitch === Number.MAX_SAFE_INTEGER ? null : this.settlementsSinceSwitch,
      config: { ...this.config },
    };
  }

  recentTrades(limit = 30) {
    const all = [...this.markets.values()].flatMap((market) => market.trades).sort((a, b) => b.settlementBucket - a.settlementBucket);
    return all.slice(0, Math.max(1, Math.min(200, limit)));
  }

  toJSON() {
    return {
      version: APPRENTICE_VERSION,
      currentTechniqueId: this.currentTechniqueId,
      techniques: [...this.techniques.values()],
      markets: [...this.markets.entries()].map(([marketKey, market]) => ({ marketKey, stats: [...market.stats.entries()], trades: market.trades.slice(-120) })),
      lessons: this.lessons.slice(-100), promotions: this.promotions.slice(-50),
      settlementsSinceSwitch: this.settlementsSinceSwitch === Number.MAX_SAFE_INTEGER ? null : this.settlementsSinceSwitch,
    };
  }

  loadFrom(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.techniques)) return false;
    this.techniques = new Map(snapshot.techniques.map((technique) => [technique.id, technique]));
    this.currentTechniqueId = snapshot.currentTechniqueId ?? this.currentTechniqueId;
    this.markets = new Map();
    for (const row of snapshot.markets ?? []) {
      const market = this.#market(row.marketKey);
      for (const [techniqueId, stats] of row.stats ?? []) market.stats.set(techniqueId, stats);
      market.trades = Array.isArray(row.trades) ? row.trades : [];
    }
    this.lessons = Array.isArray(snapshot.lessons) ? snapshot.lessons : [];
    this.promotions = Array.isArray(snapshot.promotions) ? snapshot.promotions : [];
    if (snapshot.settlementsSinceSwitch !== null && snapshot.settlementsSinceSwitch !== undefined) this.settlementsSinceSwitch = Number(snapshot.settlementsSinceSwitch) || 0;
    return true;
  }
}

const payoutFractionS = (payout) => (Number.isFinite(Number(payout)) && Number(payout) > 0 ? (Number(payout) > 1 ? Number(payout) / 100 : Number(payout)) : 0.85);
const stats_lessons = (stats, amount) => { if (stats) stats.lessons += amount; };
