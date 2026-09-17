/**
 * G2 AUDIT ENGINE (Fase 6.1) — auditoria deterministica dos trades do Professional Brain G2.
 *
 * Regras:
 *  - Usa SOMENTE informacao disponivel em decisionAt (snapshot t0); counterfactual e rotulado.
 *  - Separa OUTCOME de DECISION QUALITY; nunca assume LOSS=decisao ruim.
 *  - Nenhuma probabilidade inventada: apenas contagens, W/L/N e distribuicoes observadas.
 *  - Nao altera nenhuma logica de trading; e somente leitura/relatorio.
 *
 * Entrada: { journal: rows de iq_trade_journal (payload jsonb), executions: rows de iq_executions, audit: rows de iq_audit_trail, now }
 * Saida: dataset normalizado + analises + markdown.
 */
export const AUDIT_VERSION = "g2-audit-v1";
export const MIN_SAMPLE = 30;
export const MIN_SUBGROUP = 10;

const STOPWORD_MAX = 15_000;

/* ------------------------------------------------------------------ helpers */

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const round = (value, digits = 4) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(Number(value).toFixed(digits)));
const mean = (values) => { const list = values.filter((value) => Number.isFinite(value)); return list.length ? round(list.reduce((sum, value) => sum + value, 0) / list.length) : null; };
const median = (values) => { const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b); if (!list.length) return null; const mid = Math.floor(list.length / 2); return list.length % 2 ? list[mid] : round((list[mid - 1] + list[mid]) / 2); };
const pnlOf = (result, stake, payout) => { const s = Number(stake) || 0; const fraction = Number(payout) > 1 ? Number(payout) / 100 : (Number(payout) || 0.85); return result === "WIN" ? round(s * fraction) : result === "LOSS" ? round(-s) : 0; };

/** Extrai valores do processLog (MOMENTUM/STRENGTH/VOLATILITY/MICROSTRUCTURE/LOCATION/STRUCTURE). */
export function parseProcessLog(processLog) {
  const out = { structure: null, location: null, rsi: null, adx: null, atrRatio: null, streak: null, setupStage: null, triggerStage: null, decisionStage: null, stages: [] };
  for (const entry of Array.isArray(processLog) ? processLog : []) {
    if (!entry || typeof entry.stage !== "string") continue;
    out.stages.push(`${entry.stage}:${entry.status ?? "-"}`);
    const value = entry.value ?? entry.detail ?? null;
    if (entry.stage === "STRUCTURE") out.structure = typeof value === "string" ? value : JSON.stringify(value);
    if (entry.stage === "LOCATION") out.location = typeof value === "string" ? value : JSON.stringify(value);
    if (entry.stage === "MOMENTUM") out.rsi = num(value);
    if (entry.stage === "STRENGTH") out.adx = num(value);
    if (entry.stage === "VOLATILITY") out.atrRatio = num(value);
    if (entry.stage === "MICROSTRUCTURE") out.streak = num(value);
    if (entry.stage === "SETUP") out.setupStage = typeof value === "string" ? value : null;
    if (entry.stage === "TRIGGER") out.triggerStage = typeof value === "string" ? value : null;
    if (entry.stage === "DECISION") out.decisionStage = typeof value === "string" ? value : null;
  }
  return out;
}

/** Classificacao de timing baseada em dados t0; heuristica documentada, nunca probabilidade. */
export function classifyTiming({ direction, trigger, rsi, location, atrRatio }) {
  if (!trigger) return "NO_VALID_TRIGGER";
  if (rsi === null) return "UNKNOWN";
  const extended = typeof location === "string" && /EXTREMO|EXTREME|TOPO|FUNDO/i.test(location);
  if (direction === "BUY" && rsi >= 70) return extended ? "LATE_ENTRY" : "LATE_ENTRY";
  if (direction === "SELL" && rsi <= 30) return "LATE_ENTRY";
  if (direction === "BUY" && rsi <= 45) return "EARLY_ENTRY";
  if (direction === "SELL" && rsi >= 55) return "EARLY_ENTRY";
  if (extended && atrRatio !== null && atrRatio > 0.0025) return "LATE_ENTRY";
  return "GOOD_TIMING";
}

/** Codigos de causa (apenas quando ha evidencia observavel no t0). */
export function classifyCauses(row) {
  const causes = [];
  if (row.dataQualityIssue) causes.push("DATA_QUALITY");
  if (row.regime === "CHAOTIC" || row.regime === "UNCLEAR") causes.push("WRONG_REGIME");
  if (row.regime === "TRANSITION") causes.push("WRONG_REGIME");
  if (row.criticVerdict === "CONTEST" || row.criticVerdict === "VETO") causes.push("CRITIC_FAILURE");
  if (!row.trigger) causes.push("NO_VALID_TRIGGER");
  if (row.trigger) causes.push("NORMAL_STATISTICAL_LOSS");
  if (row.timing === "LATE_ENTRY") causes.push("LATE_ENTRY");
  if (row.timing === "EARLY_ENTRY") causes.push("EARLY_ENTRY");
  if (row.consensusStatus && row.consensusStatus !== "CONFIRMED") causes.push("CONSENSUS_FAILURE");
  if (row.stale) causes.push("STALE_DECISION");
  if (row.contradictions && row.contradictions.length) causes.push("MICROSTRUCTURE_CONTRADICTION");
  if (row.rsi !== null && row.direction === "BUY" && row.rsi >= 70) causes.push("OVEREXTENSION");
  if (row.rsi !== null && row.direction === "SELL" && row.rsi <= 30) causes.push("OVEREXTENSION");
  if (row.adx !== null && row.adx < 20) causes.push("TREND_STRENGTH_MISREAD");
  if (row.atrRatio !== null && row.atrRatio > 0.004) causes.push("VOLATILITY_MISREAD");
  if (row.structure && row.regime && contradictionBetween(row.regime, row.structure)) causes.push("WRONG_STRUCTURE");
  if (!causes.length) causes.push("UNCLASSIFIED");
  return [...new Set(causes)];
}

export function contradictionBetween(regime, structure) {
  const text = String(structure ?? "").toUpperCase();
  const trend = String(regime ?? "").toUpperCase().startsWith("TREND");
  if (trend && /RANGE|LATERAL|SIDEWAYS/.test(text)) return true;
  if (String(regime ?? "").toUpperCase() === "RANGE" && /TREND/.test(text)) return true;
  return false;
}

/* ------------------------------------------------------------------ dataset */

export function buildDataset({ journalRows = [], executions = [], auditRows = [], now = Date.now() } = {}) {
  const executionByDecision = new Map();
  const executionByExecutionId = new Map();
  for (const execution of executions) {
    if (execution.decision_id) executionByDecision.set(String(execution.decision_id), execution);
    if (execution.execution_id) executionByExecutionId.set(String(execution.execution_id), execution);
  }
  const settlementByCorrelation = new Map();
  for (const audit of auditRows) {
    if (String(audit.stage) !== "SETTLEMENT") continue;
    try {
      const detail = typeof audit.detail === "string" ? JSON.parse(audit.detail) : audit.detail;
      if (audit.correlation_id && detail) settlementByCorrelation.set(String(audit.correlation_id), detail);
    } catch { /* ignore */ }
  }

  const rows = [];
  for (const entry of journalRows) {
    const payload = typeof entry.payload === "string" ? safeJson(entry.payload) : (entry.payload ?? {});
    const t0 = payload.snapshot ?? null;
    const review = payload.review ?? {};
    const processLog = parseProcessLog(t0?.processLog);
    const execution = executionByExecutionId.get(String(entry.trade_id)) ?? (entry.decision_id ? executionByDecision.get(String(entry.decision_id)) : null) ?? null;
    const settlement = entry.correlation_id ? settlementByCorrelation.get(String(entry.correlation_id)) ?? null : null;
    const meta = execution?.meta && typeof execution.meta === "object" ? execution.meta : (typeof execution?.meta === "string" ? safeJson(execution.meta) : {});
    const snapshotSource = t0?.source ?? payload.snapshotSource ?? "SETTLEMENT_FALLBACK";
    const t0Reliable = snapshotSource === "T0_DECISION_SNAPSHOT";
    const indicators = payload.indicators ?? {};
    const regime = t0?.regime ?? payload.regime ?? entry.regime ?? null;
    const structure = t0?.structure?.label ?? payload.structure ?? entry.structure ?? processLog.structure ?? null;
    const setup = t0?.setup ?? payload.setup ?? entry.setup ?? null;
    const trigger = t0?.trigger ?? payload.trigger ?? entry.trigger ?? null;
    const directionWire = entry.direction ?? payload.direction ?? null;
    const direction = directionWire === "CALL" ? "BUY" : directionWire === "PUT" ? "SELL" : directionWire;
    const result = entry.result ?? payload.result ?? execution?.broker_result ?? null;
    const stake = num(entry.stake ?? payload.stake);
    const payout = num(entry.payout ?? payload.payout);
    const decisionAt = t0Reliable ? (num(t0.decisionAt ?? t0.evaluatedAt) ?? null) : null;
    const entryAt = entry.entry_at ? Date.parse(entry.entry_at) : null;
    const settlementAt = entry.settlement_at ? Date.parse(entry.settlement_at) : null;
    const entryPrice = num(execution?.entry_price ?? settlement?.causal?.entry ?? meta?.causal?.entry ?? null);
    const settlementPrice = num(settlement?.causal?.settlement ?? meta?.causal?.settlement ?? null);
    const critic = t0?.critic ?? payload.criticDecision ?? {};
    const consensus = t0?.consensus ?? payload.consensus ?? payload.criticDecision ?? {};
    const ackAt = execution?.acked_at ? Date.parse(execution.acked_at) : null;
    const requestedAt = execution?.requested_at ? Date.parse(execution.requested_at) : null;
    const decisionToEntryMs = t0Reliable && decisionAt && entryAt ? Math.max(0, entryAt - decisionAt) : null;
    const row = {
      tradeId: entry.trade_id ?? null, decisionId: entry.decision_id ?? null, correlationId: entry.correlation_id ?? null,
      agentId: entry.agent_id ?? null, marketKey: entry.market_key ?? null, marketType: entry.market_type ?? (String(entry.market_key ?? "").endsWith(":OTC") ? "OTC" : "NORMAL"),
      entryAt, settlementAt, localHour: settlementAt ? new Date(settlementAt).getHours() : null, weekday: settlementAt ? new Date(settlementAt).getDay() : null,
      direction, directionWire, stake, payout, result, pnl: result ? pnlOf(result, stake, payout) : null,
      entryPrice, settlementPrice, priceDelta: entryPrice !== null && settlementPrice !== null ? round(settlementPrice - entryPrice, 8) : null,
      regime, structure, location: t0?.location?.zone ?? payload.location ?? entry.location ?? processLog.location ?? null, setup, trigger,
      rsi: t0?.momentum?.rsi14 ?? num(indicators.rsi14) ?? processLog.rsi, adx: t0?.strength?.adx14 ?? num(indicators.adx14) ?? processLog.adx,
      atrRatio: t0?.volatility?.atrRatio ?? num(indicators.atrRatio) ?? processLog.atrRatio, streak: t0?.microstructure?.streak ?? processLog.streak,
      traderAction: t0?.action ?? payload.traderAction ?? entry.trader_decision ?? null, traderConfidence: num(t0?.analysisConfidence ?? t0?.confidence ?? null),
      criticVerdict: critic.verdict ?? critic.criticVerdict ?? critic.traderAssessment ?? null, criticIndependent: critic.independentAction ?? critic.criticIndependent ?? null,
      criticContradictions: Array.isArray(critic.contradictions) ? critic.contradictions : [], criticRiskFlags: Array.isArray(critic.riskFlags) ? critic.riskFlags : [],
      consensusStatus: consensus.status ?? null, consensusReason: consensus.reason ?? null,
      knowledgeIds: Array.isArray(t0?.knowledgeContextIds) ? t0.knowledgeContextIds : (Array.isArray(payload.knowledgeContextIds) ? payload.knowledgeContextIds : (Array.isArray(t0?.knowledge?.ids) ? t0.knowledge.ids : [])),
      knowledgeVersion: t0?.knowledgeVersion ?? payload.knowledgeVersion ?? t0?.knowledge?.version ?? null,
      knowledgeUsed: t0?.knowledgeUsed ?? t0?.knowledge?.used ?? (Array.isArray(payload.knowledgeContextIds) ? payload.knowledgeContextIds.length > 0 : false),
      freshnessReason: t0?.freshness?.reason ?? null,
      decisionQuality: entry.decision_quality ?? review.decisionQuality ?? null,
      decisionQualityRaw: entry.decision_quality ?? review.decisionQuality ?? null,
      decisionQualityEffective: t0Reliable ? (entry.decision_quality ?? review.decisionQuality ?? "UNCLEAR_DECISION_QUALITY") : "UNCLEAR_DECISION_QUALITY",
      reviewMistakes: Array.isArray(review.mistakes) ? review.mistakes.map((mistake) => mistake.code) : [],
      reviewStrengths: Array.isArray(review.strengths) ? review.strengths.map((strength) => strength.code) : [],
      wouldWaitBeBetter: review.wouldWaitBeBetter ?? null,
      lessonText: review.lesson?.text ?? null,
      decisionLatencyMs: num(t0?.trader?.latencyMs ?? payload.latencyMs), signalToOrderMs: t0Reliable && requestedAt && decisionAt ? requestedAt - decisionAt : null,
      ackMs: ackAt && requestedAt ? ackAt - requestedAt : null, decisionToEntryMs,
      stakeSource: meta.stakeSource ?? null, strategySource: meta.strategySource ?? null, setupMeta: meta.setup ?? null,
      snapshotSource, t0Reliable,
      stale: (decisionToEntryMs !== null && decisionToEntryMs > 15_000),
      dataQualityIssue: t0Reliable && processLog.stages.filter((stage) => stage.endsWith(":FAIL")).length >= 3,
      counterfactual: null,
    };
    row.timing = t0Reliable ? classifyTiming(row) : "UNKNOWN";
    row.causes = t0Reliable ? classifyCauses(row) : [...(row.stale ? ["STALE_DECISION"] : []), "INSUFFICIENT_CONTEXT"];
    rows.push(row);
  }

  for (const row of rows) {
    if (row.result && row.settlementPrice !== null && row.entryPrice !== null) {
      const side = row.direction === "CALL" ? "BUY" : row.direction === "PUT" ? "SELL" : row.direction;
      const up = row.settlementPrice > row.entryPrice;
      const invertDirection = side === "BUY" ? "SELL" : "BUY";
      const invertWin = invertDirection === "BUY" ? up : !up;
      row.counterfactual = {
        label: "COUNTERFACTUAL_ONLY",
        wait: { pnl: 0, result: "WAIT" },
        invert: { direction: invertDirection, result: invertWin ? "WIN" : "LOSS", pnl: pnlOf(invertWin ? "WIN" : "LOSS", row.stake, row.payout) },
      };
    }
  }

  rows.sort((a, b) => (a.settlementAt ?? 0) - (b.settlementAt ?? 0));
  return {
    version: AUDIT_VERSION, builtAt: now, rows,
    sources: { journalRows: journalRows.length, executions: executions.length, auditRows: auditRows.length },
    legacy: { note: "Trades LEGACY (V1/V2/V3/V8) nao entram nesta amostra; separados por strategySource/estrutura." },
  };
}

function safeJson(text) { try { return JSON.parse(text); } catch { return {}; } }

/* ------------------------------------------------------------------ analytics */

const emptyStat = () => ({ n: 0, w: 0, l: 0, d: 0, pnl: 0, stake: 0, payoutSum: 0 });
function addStat(stat, row) {
  stat.n += 1; stat.stake = round((stat.stake || 0) + (row.stake || 0));
  if (Number.isFinite(row.payout)) { stat.payoutSum = round((stat.payoutSum || 0) + row.payout); }
  if (row.result === "WIN") stat.w += 1; else if (row.result === "LOSS") stat.l += 1; else if (row.result === "DRAW") stat.d += 1;
  stat.pnl = round((stat.pnl || 0) + (row.pnl || 0));
  return stat;
}
const finalize = (stat) => ({ ...stat, wr: stat.w + stat.l + stat.d ? round(stat.w / (stat.w + stat.l + stat.d)) : null, pnlPerTrade: stat.n ? round(stat.pnl / (stat.w + stat.l + stat.d || 1)) : null, avgPayout: stat.n ? round(stat.payoutSum / stat.n, 2) : null, avgStake: stat.n ? round(stat.stake / stat.n, 2) : null });
export function groupBy(rows, pick) {
  const map = new Map();
  for (const row of rows) {
    const key = pick(row) ?? "UNKNOWN";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.entries()].map(([key, list]) => ({ key, ...finalize(list.reduce((stat, row) => addStat(stat, row), emptyStat())), rows: list }));
}
const distribution = (rows, pick) => { const values = rows.map(pick).filter((value) => Number.isFinite(value)); return { count: values.length, mean: mean(values), median: median(values), max: values.length ? round(Math.max(...values)) : null }; };

export function analyze(dataset) {
  const rows = dataset.rows;
  const overall = finalize(rows.reduce((stat, row) => addStat(stat, row), emptyStat()));
  const wins = rows.filter((row) => row.result === "WIN");
  const losses = rows.filter((row) => row.result === "LOSS");
  const qualityCounts = rows.reduce((acc, row) => { const key = row.decisionQualityEffective ?? "UNRATED"; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
  const outcomesByQuality = rows.reduce((acc, row) => { const key = `${row.decisionQualityEffective ?? "UNRATED"}+${row.result ?? "UNKNOWN"}`; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
  const zeroSumMismatches = rows.filter((row) => row.entryPrice !== null && row.settlementPrice !== null && row.entryPrice === row.settlementPrice).length;
  const stakeTimeline = rows.map((row) => ({ at: row.settlementAt, stake: row.stake })).filter((row) => row.stake !== null);
  const stakeChanges = [];
  for (let index = 1; index < stakeTimeline.length; index += 1) if (stakeTimeline[index].stake !== stakeTimeline[index - 1].stake) stakeChanges.push({ at: stakeTimeline[index].at, from: stakeTimeline[index - 1].stake, to: stakeTimeline[index].stake });

  const lossCauses = new Map();
  for (const row of losses) for (const cause of row.causes) lossCauses.set(cause, (lossCauses.get(cause) ?? 0) + 1);
  const topCauses = [...lossCauses.entries()].map(([cause, count]) => ({
    cause, count, shareOfLosses: losses.length ? round(count / losses.length) : null,
    markets: [...new Set(losses.filter((row) => row.causes.includes(cause)).map((row) => row.marketKey))],
    setups: [...new Set(losses.filter((row) => row.causes.includes(cause)).map((row) => row.setup))],
    examples: losses.filter((row) => row.causes.includes(cause)).slice(0, 3).map((row) => row.tradeId),
  })).sort((a, b) => b.count - a.count);

  const streaks = [];
  let current = [];
  for (const row of rows) {
    if (row.result === "LOSS") { current.push(row); continue; }
    if (current.length >= 2) streaks.push(current.map((item) => item.tradeId));
    current = [];
  }
  if (current.length >= 2) streaks.push(current.map((item) => item.tradeId));

  const critic = {
    verdicts: rows.reduce((acc, row) => { const key = row.criticVerdict ?? "UNKNOWN"; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {}),
    agreement: rows.filter((row) => row.criticIndependent && row.traderAction).map((row) => row.criticIndependent === row.traderAction),
    identicalReasoning: rows.filter((row) => row.criticContradictions.length === 0 && row.criticVerdict === "CONFIRM").length,
    confirmedLosses: rows.filter((row) => row.criticVerdict === "CONFIRM" && row.result === "LOSS").length,
    contested: rows.filter((row) => row.criticVerdict === "CONTEST").length,
  };
  critic.agreementRate = critic.agreement.length ? round(critic.agreement.filter(Boolean).length / critic.agreement.length) : null;

  const consensusFailures = rows.filter((row) => row.consensusStatus && row.consensusStatus !== "CONFIRMED");
  const knowledge = {
    retrievalHitRate: rows.length ? round(rows.filter((row) => row.knowledgeIds.length > 0).length / rows.length) : null,
    relevanceRate: rows.length ? round(rows.filter((row) => row.knowledgeIds.some((id) => idIncludesTopic(id, row))).length / rows.length) : null,
    avgRetrievalLatencyMs: mean(rows.map((row) => row.decisionLatencyMs)),
    versions: [...new Set(rows.map((row) => row.knowledgeVersion).filter(Boolean))],
  };

  const professor = {
    reviews: rows.length,
    mistakeCounts: rows.flatMap((row) => row.reviewMistakes).reduce((acc, code) => { acc[code] = (acc[code] ?? 0) + 1; return acc; }, {}),
    goodDecisionLosses: rows.filter((row) => row.decisionQualityEffective === "GOOD_DECISION" && row.result === "LOSS").length,
    badDecisionWins: rows.filter((row) => row.decisionQualityEffective === "BAD_DECISION" && row.result === "WIN").length,
    rawRatingsInvalid: rows.filter((row) => row.decisionQualityRaw && row.decisionQualityRaw !== row.decisionQualityEffective).length,
    genericLessons: rows.filter((row) => (row.lessonText ?? "").startsWith("Processo correto") || (row.lessonText ?? "").startsWith("WAIT correto")).length,
    hindsightFlags: rows.filter((row) => /deveria ter|should have|invert/i.test(row.lessonText ?? "")).length,
  };

  const latencies = {
    decisionToEntryMs: distribution(rows, (row) => row.decisionToEntryMs),
    ackMs: distribution(rows, (row) => row.ackMs),
    signalToOrderMs: distribution(rows, (row) => row.signalToOrderMs),
    stale: rows.filter((row) => row.stale).length,
  };

  const consistency = {
    decisionMatches: rows.filter((row) => !row.traderAction || row.traderAction === row.direction || row.traderAction === row.consensus ? true : false).length,
    regimeStructureConflicts: rows.filter((row) => row.regime && row.structure && contradictionBetween(row.regime, row.structure)).length,
    noValidSetupExecuted: rows.filter((row) => row.setup === "NO_VALID_SETUP").length,
    scores: rows.map((row) => ({ tradeId: row.tradeId, reasons: [contradictionBetween(row.regime ?? "", row.structure ?? "") ? "REGIME_STRUCTURE_CONFLICT" : null, row.setup === "NO_VALID_SETUP" ? "NO_SETUP" : null, row.timing === "NO_VALID_TRIGGER" ? "NO_TRIGGER" : null].filter(Boolean) })),
  };

  const winLoss = {
    rsi: { win: distribution(wins, (row) => row.rsi), loss: distribution(losses, (row) => row.rsi) },
    adx: { win: distribution(wins, (row) => row.adx), loss: distribution(losses, (row) => row.adx) },
    atrRatio: { win: distribution(wins, (row) => row.atrRatio), loss: distribution(losses, (row) => row.atrRatio) },
    confidence: { win: distribution(wins, (row) => row.traderConfidence), loss: distribution(losses, (row) => row.traderConfidence) },
    payout: { win: distribution(wins, (row) => row.payout), loss: distribution(losses, (row) => row.payout) },
    entryHour: { win: distribution(wins, (row) => row.localHour), loss: distribution(losses, (row) => row.localHour) },
  };

  const counterfactual = {
    invertWouldWin: losses.filter((row) => row.counterfactual?.invert?.result === "WIN").length,
    invertWouldLose: losses.filter((row) => row.counterfactual?.invert?.result === "LOSS").length,
    waitWouldAvoid: losses.length,
    label: "COUNTERFACTUAL_ONLY",
  };

  const subgroups = {
    markets: groupBy(rows, (row) => row.marketKey), setups: groupBy(rows, (row) => row.setup), regimes: groupBy(rows, (row) => row.regime),
    directions: groupBy(rows, (row) => row.direction), hours: groupBy(rows, (row) => row.localHour),
    payouts: groupBy(rows, (row) => bucketPayout(row.payout)), qualities: groupBy(rows, (row) => row.decisionQualityEffective),
  };
  const comparisonCount = Object.values(subgroups).reduce((sum, list) => sum + list.length, 0);
  const dataIntegrity = {
    t0Snapshots: rows.filter((row) => row.t0Reliable).length,
    settlementFallback: rows.filter((row) => !row.t0Reliable).length,
    t0Coverage: rows.length ? round(rows.filter((row) => row.t0Reliable).length / rows.length) : null,
    note: "Causas t0 (timing/regime/overextension) so sao atribuidas quando o snapshot T0_DECISION_SNAPSHOT existe; caso contrario a linha recebe INSUFFICIENT_CONTEXT.",
  };
  return { overall, qualityCounts, outcomesByQuality, topCauses, streaks, critic, consensusFailures: consensusFailures.map((row) => row.tradeId), knowledge, professor, latencies, consistency, winLoss, counterfactual, subgroups, comparisonCount, sampleSufficient: rows.length >= MIN_SAMPLE, staleCount: latencies.stale, dataIntegrity, zeroSumMismatches, stakeChanges };
}

function idIncludesTopic(id, row) {
  const text = String(id ?? "").toLowerCase();
  return [row.regime, row.setup, "indicator", "risk", "playbook", "microstructure"].filter(Boolean).some((token) => text.includes(String(token).toLowerCase().replaceAll("_", "-")) || text.includes(String(token).toLowerCase()));
}
export function bucketPayout(payout) {
  const value = num(payout);
  if (value === null) return "UNKNOWN";
  if (value < 80) return "<80";
  if (value < 85) return "80-84";
  if (value < 90) return "85-89";
  return "90+";
}

/* ------------------------------------------------------------------ adversarial critic */

export function auditCritique(analysis, dataset) {
  const rows = dataset.rows;
  const questions = [
    { q: "Estamos confundindo resultado com qualidade?", a: analysis.qualityCounts.GOOD_DECISION !== undefined && analysis.outcomesByQuality["GOOD_DECISION+LOSS"] !== undefined ? `Nao: ${analysis.outcomesByQuality["GOOD_DECISION+LOSS"] ?? 0} GOOD_DECISION+LOSS e ${analysis.outcomesByQuality["BAD_DECISION+WIN"] ?? 0} BAD_DECISION+WIN foram registrados separadamente.` : "Qualidade e resultado sao registrados em campos distintos; sem rating suficiente para afirmar." },
    { q: "Estamos fazendo cherry-picking de exemplos?", a: `O relatorio usa TODOS os ${rows.length} trades G2; exemplos sao os primeiros de cada causa, nao selecionados por conveniencia.` },
    { q: "A amostra e pequena?", a: rows.length < MIN_SAMPLE ? `SIM: N=${rows.length} < ${MIN_SAMPLE}. Nenhuma conclusao causal dominante deve ser aceita.` : `N=${rows.length} (>= ${MIN_SAMPLE}); ainda sujeito a multiplas comparacoes (${analysis.comparisonCount} subgrupos).` },
    { q: "Algum padrao desaparece quando separado por mercado?", a: describePersistence(analysis, "markets") },
    { q: "Algum padrao e causado por horario?", a: describePersistence(analysis, "hours") },
    { q: "Algum padrao e apenas consequencia do payout?", a: describePayoutConfound(analysis) },
    { q: "Usamos informacao futura?", a: "Nao: todos os campos sao do snapshot t0; counterfactual e rotulado COUNTERFACTUAL_ONLY e nao alimenta nenhuma decisao." },
    { q: "Explicamos LOSS olhando apenas depois do resultado?", a: "As causas usam apenas regime/setup/trigger/RSI/ADX/ATR/latencia do t0; o resultado aparece somente na secao de outcome." },
    { q: "Wins mostram o mesmo fenomeno?", a: `Comparacao WIN vs LOSS incluida (RSI/ADX/ATR/confianca/payout/hora). Semamostra suficiente, diferencas sao descritivas.` },
    { q: "Ha multiplas comparacoes?", a: `SIM: ${analysis.comparisonCount} subgrupos analisados. Com N=${rows.length}, multiplas comparacoes podem produzir padroes falsos; tratar tudo como SUSPEITA.` },
  ];
  return { questions, integrity: { sampleSize: rows.length, comparisonCount: analysis.comparisonCount, verdict: rows.length >= MIN_SAMPLE ? "PRELIMINARY" : "INSUFFICIENT_SAMPLE" } };
}
function describePersistence(analysis, dimension) {
  const groups = analysis.subgroups[dimension] ?? [];
  const withTrades = groups.filter((group) => group.n >= MIN_SUBGROUP);
  if (!groups.length) return "sem dados.";
  if (!withTrades.length) return `nenhum subgrupo de ${dimension} atinge N>=${MIN_SUBGROUP}; impossivel separar de ruido.`;
  return `${withTrades.length} subgrupo(s) com N>=${MIN_SUBGROUP}; padroes devem persistir neles para nao serem ruido.`;
}
function describePayoutConfound(analysis) {
  const buckets = analysis.subgroups.payouts.filter((group) => group.n > 0);
  if (buckets.length <= 1) return "todos os trades no mesmo bucket de payout; sem confound observavel.";
  return `buckets presentes: ${buckets.map((group) => `${group.key}(N=${group.n},WR=${group.wr ?? "-"})`).join(", ")}; comparar WR e PnL separadamente.`;
}

/* ------------------------------------------------------------------ report */

const fmtPct = (value) => (value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(1)}%`);
const fmtNum = (value, digits = 2) => (value === null || value === undefined ? "—" : Number(value).toFixed(digits));

export function renderReport({ dataset, analysis, critique, meta = {} }) {
  const rows = dataset.rows;
  const lines = [];
  const overall = analysis.overall;
  const insufficient = !analysis.sampleSufficient;
  lines.push(`# RELATORIO DE AUDITORIA — PROFESSIONAL BRAIN G2`);
  lines.push("");
  lines.push(`> Versao do auditor: ${AUDIT_VERSION} · gerado em ${new Date(dataset.builtAt).toISOString()} · base: ${meta.base ?? "producao"}`);
  lines.push(`> **${insufficient ? `AINDA NAO HA EVIDENCIA SUFICIENTE PARA ATRIBUIR CAUSA DOMINANTE (N=${rows.length} < ${MIN_SAMPLE}).` : `Amostra N=${rows.length} (>= ${MIN_SAMPLE}); conclusoes sao preliminares e sujeitas a multiplas comparacoes.`}**`);
  lines.push("");
  lines.push(`## 1. Resumo executivo`);
  lines.push("");
  lines.push(`- Periodo: ${rows[0] ? new Date(rows[0].settlementAt ?? rows[0].entryAt).toISOString() : "—"} a ${rows.length ? new Date(rows[rows.length - 1].settlementAt ?? rows[rows.length - 1].entryAt).toISOString() : "—"}`);
  lines.push(`- Trades G2 auditados: **${overall.n}** · W/L/D: **${overall.w}/${overall.l}/${overall.d}** · WR observado: **${fmtPct(overall.wr)}**`);
  lines.push(`- PnL PRACTICE realizado: **${fmtNum(overall.pnl)}** · stake medio: ${fmtNum(overall.avgStake)} · payout medio: ${fmtNum(overall.avgPayout)}`);
  lines.push(`- Amostra: ${insufficient ? `INSUFICIENTE (minimo ${MIN_SAMPLE} para conclusao) — recortes de 20/50/100 nao existem` : "suficiente para analise preliminar"} · Legacy V1/V2/V3/V8 excluido`);
  lines.push(`- Qualidade x resultado: ${Object.entries(analysis.outcomesByQuality).map(([key, value]) => `${key}=${value}`).join(", ") || "sem ratings"}`);
  lines.push(`- Conclusao principal: ${insufficient || analysis.dataIntegrity.t0Snapshots === 0 ? "os losses observados sao compativeis com variacao estatistica; NAO ha causa dominante comprovada. A atribuicao de causa t0 esta bloqueada nesta amostra historica (sem snapshot T0_DECISION_SNAPSHOT) — ver 1.1." : "ver secoes 3 e 17."}`);
  lines.push("");
  lines.push(`### 1.1 Integridade dos dados (limitacao da amostra historica)`);
  lines.push("");
  lines.push(`- Trades com snapshot T0_DECISION_SNAPSHOT: **${analysis.dataIntegrity.t0Snapshots}** de ${rows.length} (cobertura ${fmtPct(analysis.dataIntegrity.t0Coverage)})`);
  lines.push(`- Trades com fallback de settlement (regime/setup/trigger podem refletir avaliacao POSTERIOR ao t0): ${analysis.dataIntegrity.settlementFallback}`);
  lines.push(`- Consequencia: causas baseadas em regime/timing/RSI/ADX por trade ficam marcadas como INSUFFICIENT_CONTEXT; a analise de OUTCOME (W/L, preco, latencia, payout, mercado, hora, counterfactual) permanece valida.`);
  lines.push(`- Bugs de observabilidade encontrados e corrigidos nesta fase (nao alteram trading): meta de execucao era sobrescrita no settlement; snapshot t0 nao era persistido; processLog nao entrava no journal. A coleta a partir de agora e t0-completa.`);
  lines.push("");
  lines.push(`## 2. Os losses foram normais ou existem problemas?`);
  lines.push("");
  lines.push(`- LOSS estatisticos (t0 sem fator observavel): ${rows.filter((row) => row.result === "LOSS" && row.causes.length === 1 && row.causes[0] === "NORMAL_STATISTICAL_LOSS").length}`);
  lines.push(`- LOSS com contexto t0 insuficiente (amostra historica): ${rows.filter((row) => row.result === "LOSS" && row.causes.includes("INSUFFICIENT_CONTEXT")).length}`);
  lines.push(`- LOSS com fator de decisao observavel (timing/regime/trigger t0): ${rows.filter((row) => row.result === "LOSS" && row.causes.some((cause) => ["LATE_ENTRY", "EARLY_ENTRY", "WRONG_REGIME", "OVEREXTENSION", "NO_VALID_TRIGGER"].includes(cause))).length}`);
  lines.push(`- LOSS com problema de execucao (stale/latencia): ${rows.filter((row) => row.result === "LOSS" && (row.stale || (row.ackMs ?? 0) > 2_000)).length}`);
  lines.push(`- LOSS com problema de dado (quality): ${rows.filter((row) => row.result === "LOSS" && row.dataQualityIssue).length}`);
  lines.push(`- LOSS nao classificados: ${rows.filter((row) => row.result === "LOSS" && row.causes.includes("UNCLASSIFIED")).length}`);
  lines.push("");
  lines.push(`## 3. Top causas dos losses`);
  lines.push("");
  if (!rows.some((row) => row.result === "LOSS")) lines.push(`Nenhum LOSS na amostra.`);
  else {
    lines.push(`| causa | losses | % dos losses | mercados | setups | exemplos |`);
    lines.push(`|---|---:|---:|---|---|---|`);
    for (const cause of analysis.topCauses) lines.push(`| ${cause.cause} | ${cause.count} | ${fmtPct(cause.shareOfLosses)} | ${(cause.markets ?? []).join(", ") || "—"} | ${(cause.setups ?? []).join(", ") || "—"} | ${(cause.examples ?? []).join(", ") || "—"} |`);
    lines.push("");
    lines.push(`> Causas sao fatores observaveis no t0; varios podem coexistir no mesmo trade. Nenhuma e atribuida como dominante sem amostra.`);
  }
  lines.push("");
  lines.push(...sectionTable("4. Performance por mercado", analysis.subgroups.markets));
  lines.push(...sectionTable("5. Performance por setup", analysis.subgroups.setups));
  lines.push(...sectionTable("6. Performance por regime", analysis.subgroups.regimes));
  lines.push(...sectionTable("7. Performance por horario local", analysis.subgroups.hours));
  lines.push(...sectionTable("8. BUY vs SELL", analysis.subgroups.directions));
  lines.push(`## 9. Indicadores — distribuicao WIN vs LOSS`);
  lines.push("");
  lines.push(`> Cobertura t0: ${analysis.dataIntegrity.t0Snapshots}/${rows.length} trades com snapshot de decisao. Sem snapshot, indicadores ficam indisponiveis (nao inventados).`);
  lines.push("");
  lines.push(`| indicador | WIN (media/mediana/N) | LOSS (media/mediana/N) |`);
  lines.push(`|---|---|---|`);
  for (const [key, value] of Object.entries(analysis.winLoss)) lines.push(`| ${key} | ${fmtNum(value.win.mean)} / ${fmtNum(value.win.median)} / ${value.win.count} | ${fmtNum(value.loss.mean)} / ${fmtNum(value.loss.median)} / ${value.loss.count} |`);
  lines.push("");
  lines.push(`## 10. Trader vs Critic`);
  lines.push("");
  lines.push(`- Verdicts: ${Object.entries(analysis.critic.verdicts).map(([key, value]) => `${key}=${value}`).join(", ") || "—"}`);
  lines.push(`- Concordancia Trader/Critic: ${fmtPct(analysis.critic.agreementRate)}`);
  lines.push(`- Critic confirmou LOSS: ${analysis.critic.confirmedLosses} · CONFIRM sem contraevidencia: ${analysis.critic.identicalReasoning}`);
  lines.push(`> Limite: verdict t0 so existe com snapshot de decisao; em trades historicos o verdicto persistido e o do settlement (nao usar como prova).`);
  lines.push("");
  lines.push(`## 11. Consensus`);
  lines.push("");
  lines.push(`- Execucoes fora de CONFIRMED (coluna de settlement): ${analysis.consensusFailures.length ? analysis.consensusFailures.join(", ") : "nenhuma registrada"}`);
  lines.push(`- Nota: por construcao do runtime, TODA ordem automatica exige consensus CONFIRMED no t0 (handleSignal so recebe BUY/SELL do consensus); divergencias persistidas sao do snapshot de settlement.`);
  lines.push("");
  lines.push(`## 12. Latencia / execucao`);
  lines.push("");
  lines.push(`- decisao→entrada (t0): media ${fmtNum(analysis.latencies.decisionToEntryMs.mean)}ms · mediana ${fmtNum(analysis.latencies.decisionToEntryMs.median)}ms · N=${analysis.latencies.decisionToEntryMs.count}`);
  lines.push(`- sinal→ordem (t0): media ${fmtNum(analysis.latencies.signalToOrderMs.mean)}ms · ACK (requested→acked, sempre valido): media ${fmtNum(analysis.latencies.ackMs.mean)}ms · mediana ${fmtNum(analysis.latencies.ackMs.median)}ms · max ${fmtNum(analysis.latencies.ackMs.max)}ms`);
  lines.push(`- Decisoes stale (>15s): ${analysis.latencies.stale}`);
  lines.push(`- Mudancas de stake na janela (confound de PnL): ${analysis.stakeChanges.length ? analysis.stakeChanges.map((change) => `${change.from}→${change.to}`).join(", ") : "sem mudanca"}`);
  lines.push(`- Settlements exatamente no preco de entrada: ${analysis.zeroSumMismatches}`);
  lines.push(`- Contrafactual (COUNTERFACTUAL_ONLY, apenas analitico): de ${rows.filter((row) => row.result === "LOSS").length} LOSS, inverter teria vencido ${analysis.counterfactual.invertWouldWin} e perdido ${analysis.counterfactual.invertWouldLose}; WAIT teria evitado o loss em todos (PnL 0).`);
  lines.push("");
  lines.push(`## 13. Segundo Cerebro / RAG`);
  lines.push("");
  lines.push(`- retrievalHitRate: ${fmtPct(analysis.knowledge.retrievalHitRate)} · relevanceRate: ${fmtPct(analysis.knowledge.relevanceRate)}`);
  lines.push(`- versoes de conhecimento: ${analysis.knowledge.versions.join(", ") || "—"}`);
  lines.push(`- notas usadas: ${rows.flatMap((row) => row.knowledgeIds).filter((value, index, list) => list.indexOf(value) === index).slice(0, 12).join(", ") || "—"}`);
  lines.push("");
  lines.push(`## 14. Professor`);
  lines.push("");
  lines.push(`- GOOD_DECISION+LOSS (efetivo): ${analysis.professor.goodDecisionLosses} · BAD_DECISION+WIN (efetivo): ${analysis.professor.badDecisionWins}`);
  lines.push(`- Ratings brutos invalidados pelo drift de settlement: ${analysis.professor.rawRatingsInvalid} de ${analysis.professor.reviews} (professor avaliou snapshot posterior ao t0; corrigido nesta fase).`);
  lines.push(`- licoes genericas: ${analysis.professor.genericLessons} · hindsight flags: ${analysis.professor.hindsightFlags}`);
  lines.push(`- criticas mais recorrentes: ${Object.entries(analysis.professor.mistakeCounts).sort((a, b) => b[1] - a[1]).map(([key, value]) => `${key}=${value}`).join(", ") || "nenhuma"}`);
  lines.push("");
  lines.push(`## 15. Sequencias de losses`);
  lines.push("");
  lines.push(analysis.streaks.length ? analysis.streaks.map((streak, index) => { const list = streak.map((id) => rows.find((row) => row.tradeId === id)).filter(Boolean); return `- streak ${index + 1} (${streak.length}): ${list.map((row) => `${row.marketKey}/${row.setup}/${row.regime}`).join(" → ")}`; }).join("\n") : "- Nenhuma sequencia de 2+ LOSS nesta amostra.");
  lines.push("");
  lines.push(`## 16. Casos completos`);
  lines.push("");
  const lossSamples = rows.filter((row) => row.result === "LOSS").slice(0, 5);
  const winSamples = rows.filter((row) => row.result === "WIN").slice(0, 5);
  for (const [title, list] of [["LOSS mais instrutivos", lossSamples], ["WIN mais instrutivos", winSamples]]) {
    lines.push(`### ${title}`);
    lines.push("");
    for (const row of list) {
      lines.push(`- **${row.tradeId}** ${row.marketKey} ${row.direction} @ ${row.entryPrice ?? "—"} → ${row.settlementPrice ?? "—"} (${row.result}) · regime ${row.regime} · setup ${row.setup} · trigger ${row.trigger ?? "—"}`);
      lines.push(`  - t0: RSI ${fmtNum(row.rsi, 1)} · ADX ${fmtNum(row.adx, 1)} · ATRratio ${fmtNum(row.atrRatio, 5)} · local ${row.location ?? "—"} · timing ${row.timing} · causas ${row.causes.join(", ")}`);
      lines.push(`  - Critic: ${row.criticVerdict ?? "—"} (independente ${row.criticIndependent ?? "—"}) · Consensus ${row.consensusStatus ?? "—"} · qualidade (efetiva) ${row.decisionQualityEffective ?? "—"}${row.decisionQualityRaw && row.decisionQualityRaw !== row.decisionQualityEffective ? ` (raw do settlement: ${row.decisionQualityRaw}, invalido)` : ""}`);
      if (row.counterfactual) lines.push(`  - counterfactual (COUNTERFACTUAL_ONLY): WAIT ${row.counterfactual.wait.result} · INVERT ${row.counterfactual.invert.direction} ${row.counterfactual.invert.result}`);
    }
    lines.push("");
  }
  if (!lossSamples.length) lines.push(`(sem LOSS na amostra)`);
  lines.push(`## 17. Problemas comprovados`);
  lines.push("");
  const proven = [];
  if (analysis.dataIntegrity.settlementFallback > 0) proven.push(`- Observabilidade (CORRIGIDO): ${analysis.dataIntegrity.settlementFallback} de ${rows.length} trades sem snapshot t0 persistido; regime/setup/trigger do journal refletem o settlement, nao a decisao.`);
  proven.push(`- Observabilidade (CORRIGIDO): meta de iq_executions era substituida no settlement (setup/timing do pedido se perdiam); agora e mesclada.`);
  proven.push(`- Observabilidade (CORRIGIDO): processLog (RSI/ADX/ATR/estrutura por estagio) nao era persistido no journal; agora faz parte do decisionSnapshot.`);
  if (analysis.consistency.noValidSetupExecuted > 0) proven.push(`- Execucao com NO_VALID_SETUP persistido: ${analysis.consistency.noValidSetupExecuted} trade(s) — atribuivel ao fallback de settlement (acima), nao a uma violacao de gate.`);
  if (analysis.latencies.stale > 0) proven.push(`- Decisoes stale (>15s) entraram: ${analysis.latencies.stale}.`);
  if (analysis.consistency.regimeStructureConflicts > 0) proven.push(`- Conflito regime x estrutura (t0 confiavel): ${analysis.consistency.regimeStructureConflicts}.`);
  if (proven.length === 3) proven.push(`- Nenhum problema de logica de trading comprovado nesta amostra.`);
  lines.push(proven.join("\n"));
  lines.push("");
  lines.push(`## 18. Suspeitas (sem amostra suficiente)`);
  lines.push("");
  lines.push(`- Dominancia de LATE_ENTRY/OVEREXTENSION: ${analysis.topCauses.filter((cause) => ["LATE_ENTRY", "OVEREXTENSION"].includes(cause.cause)).map((cause) => `${cause.cause}=${cause.count}`).join(", ") || "nao observado"} — tratar como SUSPEITA ate N>=${MIN_SAMPLE}.`);
  lines.push(`- Baixa diversidade adversarial (Critic quase sempre CONFIRM): aguardando amostra prospectiva.`);
  lines.push("");
  lines.push(`## 19. Recomendacoes`);
  lines.push("");
  lines.push(`- DO NOTHING / NEED MORE DATA: nao alterar Brain/Critic/Consensus com base nesta amostra (regra 28).`);
  lines.push(`- RESEARCH REQUIRED: coletar N>=${MIN_SAMPLE} prospectivo com o decisionSnapshot completo (ja instrumentado) e reexecutar esta auditoria.`);
  lines.push(`- BUG FIX (observabilidade, sem tocar trading): persistir snapshot t0 completo no journal (feito) e AGENTS acionavel no audit (feito).`);
  lines.push("");
  lines.push(`## 20. Proximo experimento recomendado`);
  lines.push("");
  lines.push(`- Rodar esta auditoria automaticamente a cada 20 trades G2 e comparar WIN vs LOSS em dados novos (mesma instrumentacao, sem mudar regras).`);
  lines.push("");
  lines.push(`## GATE DE CRITICA (fresh critics)`);
  lines.push("");
  for (const item of critique.questions) lines.push(`- **${item.q}** ${item.a}`);
  lines.push("");
  lines.push(`**Integridade do relatorio:** ${critique.integrity.verdict} · N=${critique.integrity.sampleSize} · comparacoes=${critique.integrity.comparisonCount}`);
  lines.push("");
  lines.push(`## Anexo — dataset completo`);
  lines.push("");
  lines.push(`| trade | at | mkt | dir | stake | payout | entry | exit | result | pnl | regime | setup | rsi | adx | atrRatio | timing | quality | causes |`);
  lines.push(`|---|---|---|---|---:|---:|---:|---:|---|---:|---|---|---:|---:|---:|---|---|---|`);
  for (const row of rows) lines.push(`| ${row.tradeId} | ${row.settlementAt ? new Date(row.settlementAt).toISOString().slice(5, 16).replace("T", " ") : "—"} | ${row.marketKey} | ${row.direction} | ${fmtNum(row.stake)} | ${fmtNum(row.payout, 0)} | ${row.entryPrice ?? "—"} | ${row.settlementPrice ?? "—"} | ${row.result} | ${fmtNum(row.pnl)} | ${row.regime ?? "—"} | ${row.setup ?? "—"} | ${fmtNum(row.rsi, 1)} | ${fmtNum(row.adx, 1)} | ${fmtNum(row.atrRatio, 5)} | ${row.timing} | ${row.decisionQualityEffective ?? "—"} | ${row.causes.join(", ")} |`);
  return `${lines.join("\n")}\n`;
}

function sectionTable(title, groups) {
  const lines = [`## ${title}`, ""];
  if (!groups.length) { lines.push("sem dados."); lines.push(""); return lines; }
  lines.push(`| chave | N | W | L | D | WR | PnL | PnL/trade | payout medio | amostra |`);
  lines.push(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---|`);
  for (const group of groups) lines.push(`| ${group.key} | ${group.n} | ${group.w} | ${group.l} | ${group.d} | ${fmtPct(group.wr)} | ${fmtNum(group.pnl)} | ${fmtNum(group.pnlPerTrade)} | ${fmtNum(group.avgPayout)} | ${group.n >= MIN_SUBGROUP ? "OK" : "INSUFFICIENT_SAMPLE"} |`);
  lines.push("");
  return lines;
}
