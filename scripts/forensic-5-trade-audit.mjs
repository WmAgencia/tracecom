/**
 * FORENSIC 5-TRADE AUDIT (read-only, deterministico) — reconstroi T0, JIT, Quality Gate, Critic
 * e gera os FATOS computados da auditoria forense das 5 operacoes PRACTICE liquidadas.
 *
 * Uso: node scripts/forensic-5-trade-audit.mjs
 * Entrada: docs/research/data/forensic-5-trades.json (congelado por scripts/forensic-5-trade-dump.mjs)
 * Saida:   docs/research/data/forensic-5-trades-computed.json
 *
 * REGRA: este script NAO decide nada, NAO altera thresholds, NAO toca producao. Ele apenas usa as
 * funcoes reais do runtime (trade-quality.mjs) para recomputar checks e confrontar com o que foi
 * registrado em producao (counterexample / teste de consistencia).
 */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { featuresFromSnapshot, scoreTradeQuality, entryLocationCheck, evaluateShadowArms, triggerStrength } from "../relay/trade-quality.mjs";

const INPUT = path.join("docs", "research", "data", "forensic-5-trades.json");
const OUTPUT = path.join("docs", "research", "data", "forensic-5-trades-computed.json");

const round = (value, digits = 6) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null);
const atrUnits = (delta, atr) => (delta === null || delta === undefined || !Number.isFinite(Number(delta)) || !Number.isFinite(Number(atr)) || Number(atr) <= 0 ? null : Number((Number(delta) / Number(atr)).toFixed(4)));
const iso = (ms) => (Number.isFinite(Number(ms)) ? new Date(Number(ms)).toISOString() : null);

const evidence = JSON.parse(await fs.readFile(INPUT, "utf8"));
const errors = [];

const tradeOf = (tradeId) => evidence.trades.find((trade) => trade.tradeId === tradeId);
const lifecycle = (trade, stage) => (trade.funnel ?? []).filter((row) => row.stage === stage);
const candidateIdOf = (trade) => trade.execution?.meta?.entryTiming?.candidateId ?? null;
const revalidationOf = (trade, candidateId) => lifecycle(trade, "FINAL_REVALIDATION").find((row) => row.detail?.candidateId === candidateId) ?? null;
const creationOf = (trade, candidateId) => (candidateId ? lifecycle(trade, "CANDIDATE_CREATED").find((row) => row.detail?.candidateId === candidateId) ?? null : null);
const shadowOf = (trade, candidateId) => lifecycle(trade, "SHADOW_ARMS").find((row) => row.detail?.candidateId === candidateId) ?? null;

const trades = evidence.trades.map((trade) => {
  const journal = trade.journal ?? {};
  const execution = trade.execution ?? {};
  const payload = journal.payload ?? {};
  const snapshot = payload.snapshot ?? {};
  const meta = execution.meta ?? {};
  const candidateId = candidateIdOf(trade);
  const revalidation = revalidationOf(trade, candidateId);
  const creation = creationOf(trade, candidateId);
  const shadow = shadowOf(trade, candidateId);
  const changedFields = revalidation?.detail?.changedFields ?? [];
  const priceChange = changedFields.find((change) => change.field === "price") ?? null;
  const actionChange = changedFields.find((change) => change.field === "action") ?? null;
  const candidateCreatedAtMs = creation ? new Date(creation.created_at).getTime() : null;
  const revalidatedAtMs = meta.entryTiming?.revalidatedAt ?? null;
  const submitAtMs = meta.entryTiming?.submitAtMs ?? null;
  const targetEntryAt = meta.entryTiming?.targetEntryAt ?? null;
  const targetExpiryAt = meta.entryTiming?.targetExpiryAt ?? null;
  const entryPrice = Number(execution.entry_price);
  const candidatePrice = priceChange ? Number(priceChange.before) : null;
  const finalPriceAtRevalidation = priceChange ? Number(priceChange.after) : null;
  const atr = snapshot.volatility?.atr ?? null;
  const direction = snapshot.action === "BUY" ? "BUY" : snapshot.action === "SELL" ? "SELL" : null;
  const timing = {
    candidatePrice,
    entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
    candidateAgeMs: candidateCreatedAtMs !== null && revalidatedAtMs !== null ? revalidatedAtMs - candidateCreatedAtMs : null,
    directionChanges: changedFields.filter((change) => change.field === "action").length,
    candidateChangedBeforeEntry: meta.entryTiming?.candidateChangedBeforeEntry === true,
    fresh: snapshot.freshness?.fresh !== false,
    knowledgeContextIds: snapshot.knowledgeContextIds ?? [],
  };
  const recomputedQuality = direction ? scoreTradeQuality(featuresFromSnapshot(snapshot, { direction, payout: journal.payout, timing })) : null;
  const recomputedLocation = direction ? entryLocationCheck(featuresFromSnapshot(snapshot, { direction, payout: journal.payout, timing })) : null;
  const recomputedArms = direction ? evaluateShadowArms(featuresFromSnapshot(snapshot, { direction, payout: journal.payout, timing })) : null;
  const recordedArms = shadow?.detail?.arms ?? null;
  const causal = meta.causal ?? null;
  const settlementMove = causal ? Number(causal.settlement) - Number(causal.entry) : null;
  const favorable = direction === "BUY" ? settlementMove > 0 : direction === "SELL" ? settlementMove < 0 : null;
  const displacement = timing.entryPrice !== null && candidatePrice !== null ? timing.entryPrice - candidatePrice : null;
  const adverseDisplacement = displacement === null || direction === null ? null : (direction === "BUY" ? displacement > 0 : displacement < 0);
  const critic = snapshot.critic ?? payload.criticDecision ?? null;
  const consensus = snapshot.consensus ?? payload.consensus ?? null;
  return {
    tradeId: trade.tradeId,
    decisionId: execution.decision_id ?? null,
    correlationId: trade.correlationId,
    marketKey: journal.market_key,
    marketType: journal.market_type,
    source: meta.source ?? null,
    stakeSource: meta.stakeSource ?? null,
    autonomous: meta.source === "AUTO_DECISION",
    candidateId,
    candidateCreatedAt: iso(candidateCreatedAtMs),
    candidateAgeMs: timing.candidateAgeMs,
    targetEntryAt,
    targetEntryAtIso: iso(targetEntryAt),
    targetExpiryAt,
    targetExpiryAtIso: iso(targetExpiryAt),
    submitAtMs,
    submitAtIso: iso(submitAtMs),
    requestedAt: execution.requested_at,
    ackedAt: execution.acked_at,
    expirationAt: execution.expiration_at,
    entryAtJournal: journal.entry_at,
    settlementAtJournal: journal.settlement_at,
    direction: journal.direction,
    action: snapshot.action ?? null,
    actionMapsToDirection: (snapshot.action === "BUY" && journal.direction === "CALL") || (snapshot.action === "SELL" && journal.direction === "PUT"),
    activeId: execution.active_id,
    symbol: execution.symbol,
    brokerOrderId: execution.broker_order_id,
    state: execution.state,
    stake: Number(execution.stake),
    payout: Number(execution.payout),
    profit: Number(execution.profit),
    brokerResult: execution.broker_result,
    causalResult: execution.causal_result,
    settlementMismatch: execution.settlement_mismatch === true,
    result: journal.result,
    regime: snapshot.regime ?? journal.regime,
    structure: snapshot.structure?.label ?? journal.structure,
    structureDetail: snapshot.structure?.detail ?? null,
    location: snapshot.location?.zone ?? journal.location,
    setup: snapshot.setup ?? journal.setup,
    trigger: snapshot.trigger ?? journal.trigger,
    processLog: snapshot.processLog ?? null,
    indicators: {
      rsi14: snapshot.momentum?.rsi14 ?? journal.indicators?.rsi14 ?? null,
      velocity: snapshot.momentum?.velocity ?? null,
      acceleration: snapshot.momentum?.acceleration ?? null,
      adx14: snapshot.strength?.adx14 ?? journal.indicators?.adx14 ?? null,
      plusDI: snapshot.strength?.plusDI ?? null,
      minusDI: snapshot.strength?.minusDI ?? null,
      diSpread: snapshot.strength?.diSpread ?? null,
      diAgainstDirection: direction !== null && snapshot.strength ? (direction === "BUY" ? snapshot.strength.minusDI > snapshot.strength.plusDI : snapshot.strength.plusDI > snapshot.strength.minusDI) : null,
      atr,
      atrRatio: snapshot.volatility?.atrRatio ?? journal.indicators?.atrRatio ?? null,
      atrNormalized: Number.isFinite(Number(atr)) && Number.isFinite(entryPrice) ? round(atr / entryPrice, 8) : null,
      donchianPosition: snapshot.location?.donchianPosition ?? null,
      distanceToLowerATR: snapshot.location?.distanceToLowerATR ?? null,
      distanceToUpperATR: snapshot.location?.distanceToUpperATR ?? null,
      extensionMaxATR: Math.max(snapshot.location?.distanceToLowerATR ?? 0, snapshot.location?.distanceToUpperATR ?? 0),
      streak: snapshot.microstructure?.streak ?? null,
      bodyRatio: snapshot.microstructure?.bodyRatio ?? null,
      upperWick: snapshot.microstructure?.upperWick ?? null,
      lowerWick: snapshot.microstructure?.lowerWick ?? null,
      features: snapshot.features ?? null,
    },
    critic,
    consensus,
    supportingEvidence: snapshot.supportingEvidence ?? payload.supportingEvidence ?? [],
    contradictingEvidence: snapshot.contradictingEvidence ?? payload.contradictingEvidence ?? [],
    knowledgeUsed: snapshot.knowledgeUsed ?? false,
    freshness: snapshot.freshness ?? null,
    professor: payload.review ? {
      decisionQuality: payload.review.decisionQuality,
      finalDecisionQuality: payload.review.finalDecisionQuality ?? null,
      mistakes: (payload.review.mistakes ?? []).map((mistake) => mistake.code),
      wouldWaitBeBetter: payload.review.wouldWaitBeBetter === true,
      setup: payload.review.setup,
      action: payload.review.action,
      lesson: payload.review.lesson?.text ?? null,
    } : null,
    trailingQualityGate: execution.state === "SETTLED" ? {
      recorded: shadow ? { score: shadow.detail.qualityScore, entryLocation: shadow.detail.entryLocation, arms: shadow.detail.arms, microVeto: shadow.detail.microVeto } : null,
      recomputedFromJournalSnapshot: recomputedQuality ? {
        score: recomputedQuality.score,
        failedChecks: recomputedQuality.checks.filter((check) => !check.ok).map((check) => check.id),
        checks: recomputedQuality.checks,
        entryLocation: recomputedLocation,
        arms: recomputedArms,
        triggerStrength: triggerStrength(featuresFromSnapshot(snapshot, { direction, payout: journal.payout, timing })),
        recordedArms,
        armsMatch: recordedArms === null ? null : Object.fromEntries(Object.keys(recordedArms).map((arm) => [arm, (recordedArms[arm]?.decision ?? null) === (recomputedArms?.[arm]?.decision ?? null)])),
      } : null,
    } : null,
    jit: {
      entryLeadMs: meta.entryTiming?.entryLeadMs ?? null,
      revalidatedAt: iso(revalidatedAtMs),
      candidateChangedBeforeEntry: timing.candidateChangedBeforeEntry,
      changedFields: changedFields.map((change) => ({ field: change.field, before: change.before, after: change.after })),
      directionChanged: Boolean(actionChange),
      driftMs: meta.entryDriftMs ?? null,
      effectiveEntryAt: iso(meta.effectiveEntryAt),
      displacement,
      displacementATR: atrUnits(displacement, atr),
      adverseDisplacement,
      spreadProxyATR: atrUnits(finalPriceAtRevalidation !== null && candidatePrice !== null ? finalPriceAtRevalidation - candidatePrice : null, atr),
    },
    execution: {
      ackMs: meta.ackMs ?? null,
      decisionToSubmitMs: submitAtMs !== null && meta.entryTiming?.revalidatedAt ? submitAtMs - meta.entryTiming.revalidatedAt : null,
      submitToAckMs: meta.ackMs ?? null,
      ackToExpiryMs: execution.expiration_at && execution.acked_at ? new Date(execution.expiration_at).getTime() - new Date(execution.acked_at).getTime() : null,
      targetExpiryVsBrokerExpiryMs: targetExpiryAt && execution.expiration_at ? new Date(execution.expiration_at).getTime() - targetExpiryAt : null,
      causal,
      settlementMove,
      settlementMoveATR: atrUnits(settlementMove, atr),
      favorableAtExpiry: favorable,
      absSettlementMoveATR: atrUnits(Math.abs(Number(settlementMove ?? 0)), atr),
    },
  };
});

/* ------------------- funil + distribuicao do Quality Score (shadow arms Sep 17-18) ------------------- */
const armIds = ["A_G2_JIT", "B_QUALITY_GATE", "C_STABILITY", "D_CRITIC", "E_MICROSTRUCTURE", "F_COMBINED"];
const arms = Object.fromEntries(armIds.map((arm) => [arm, { accept: 0, abstain: 0, reasons: {} }]));
for (const row of evidence.shadowArms ?? []) {
  for (const arm of armIds) {
    const value = row.arms?.[arm];
    if (!value) continue;
    if (value.decision === "ACCEPT") arms[arm].accept += 1;
    else { arms[arm].abstain += 1; arms[arm].reasons[value.reason ?? "UNKNOWN"] = (arms[arm].reasons[value.reason ?? "UNKNOWN"] ?? 0) + 1; }
  }
}
const scores = (evidence.shadowArms ?? []).map((row) => Number(row.quality_score)).filter(Number.isFinite);
const histogram = {};
for (const score of scores) { const bucket = Math.floor(score / 5) * 5; histogram[bucket] = (histogram[bucket] ?? 0) + 1; }
const qualityDistribution = {
  n: scores.length,
  min: scores.length ? Math.min(...scores) : null,
  max: scores.length ? Math.max(...scores) : null,
  mean: scores.length ? round(scores.reduce((sum, value) => sum + value, 0) / scores.length, 2) : null,
  atOrAboveThreshold: scores.filter((value) => value >= 75).length,
  belowThreshold: scores.filter((value) => value < 75).length,
  histogram: Object.fromEntries(Object.entries(histogram).sort((a, b) => Number(a[0]) - Number(b[0]))),
};

/* ------------------- selecao / exclusoes ------------------- */
const selection = {
  journalByDay: evidence.selection?.journalByDay ?? [],
  executionsSep18: (evidence.selection?.executionsSep18 ?? []).map((row) => ({ executionId: row.execution_id, marketKey: row.market_key, state: row.state, result: row.broker_result, requestedAt: row.requested_at })),
  nonSettledCount: (evidence.selection?.nonSettled ?? []).length,
  nonSettledByState: Object.fromEntries(Object.entries((evidence.selection?.nonSettled ?? []).reduce((map, row) => { map[row.state] = (map[row.state] ?? 0) + 1; return map; }, {})).sort()),
  mismatchCount: (evidence.selection?.mismatches ?? []).length,
  mismatchesSep18: (evidence.selection?.mismatches ?? []).filter((row) => String(row.requested_at).startsWith("2026-09-18")).length,
};

/* ------------------- mapa JIT dos 5 mercados (candidatos que NAO executaram) ------------------- */
const funnelSummary = {};
for (const trade of evidence.trades) {
  const rows = trade.funnel ?? [];
  const created = rows.filter((row) => row.stage === "CANDIDATE_CREATED").length;
  const cancelled = rows.filter((row) => row.stage === "CANDIDATE_CANCELLED").length;
  const revalidatedOk = rows.filter((row) => row.stage === "FINAL_REVALIDATION" && row.detail?.ok === true).length;
  const shadowRows = rows.filter((row) => row.stage === "SHADOW_ARMS");
  const gateRejected = rows.filter((row) => row.stage === "CANDIDATE_CANCELLED" && ["VALID_SETUP_BUT_BAD_ENTRY_PRICE", "QUALITY_SCORE_BELOW_THRESHOLD"].includes(row.detail?.reason)).length;
  const microRejected = rows.filter((row) => row.stage === "CANDIDATE_CANCELLED" && String(row.detail?.reason ?? "").startsWith("MICROSTRUCTURE_")).length;
  const cancelReasons = rows.filter((row) => row.stage === "CANDIDATE_CANCELLED").reduce((map, row) => { const reason = row.detail?.reason ?? "UNKNOWN"; map[reason] = (map[reason] ?? 0) + 1; return map; }, {});
  funnelSummary[trade.marketKey] = { candidatesCreated: created, revalidatedOk, executed: 1, cancelled, gateRejected, microRejected, shadowScored: shadowRows.length, cancelReasons };
}

/* ------------------- estudo do Critic / revalidacao (todos os mercados da janela) ------------------- */
const revalidationStudy = { total: 0, ok: 0, failed: 0, failedByRule: {}, reasonCounts: {}, criticVerdicts: {}, canceledAfterGate: {}, armAbstainReasons: {} };
const gateRejectedCandidates = [];
for (const trade of evidence.trades) {
  for (const row of trade.funnel ?? []) {
    if (row.stage === "FINAL_REVALIDATION") {
      revalidationStudy.total += 1;
      if (row.detail?.ok === true) revalidationStudy.ok += 1;
      else {
        revalidationStudy.failed += 1;
        for (const check of row.detail?.checks ?? []) if (check.ok !== true) revalidationStudy.failedByRule[check.rule] = (revalidationStudy.failedByRule[check.rule] ?? 0) + 1;
        const reason = row.detail?.reason ?? "UNKNOWN";
        revalidationStudy.reasonCounts[reason] = (revalidationStudy.reasonCounts[reason] ?? 0) + 1;
      }
    }
    if (row.stage === "AGENTS") {
      const verdict = row.detail?.criticVerdict ?? "UNKNOWN";
      revalidationStudy.criticVerdicts[verdict] = (revalidationStudy.criticVerdicts[verdict] ?? 0) + 1;
    }
    if (row.stage === "CANDIDATE_CANCELLED") {
      const reason = row.detail?.reason ?? "UNKNOWN";
      revalidationStudy.canceledAfterGate[reason] = (revalidationStudy.canceledAfterGate[reason] ?? 0) + 1;
    }
    if (row.stage === "SHADOW_ARMS") {
      const candidateId = row.detail?.candidateId;
      const priceChange = (trade.funnel ?? []).find((other) => other.stage === "FINAL_REVALIDATION" && other.detail?.candidateId === candidateId)?.detail?.changedFields?.find((change) => change.field === "price");
      const score = row.detail?.qualityScore ?? null;
      const location = row.detail?.entryLocation ?? null;
      if (location?.ok === false) gateRejectedCandidates.push({ marketKey: trade.market_key, candidateId, score, reasons: location.reasons ?? [], priceBefore: priceChange?.before ?? null, priceAfter: priceChange?.after ?? null });
      for (const [arm, value] of Object.entries(row.detail?.arms ?? {})) {
        if (value?.decision === "ABSTAIN" && value.reason) {
          const key = `${arm}/${value.reason}`;
          revalidationStudy.armAbstainReasons[key] = (revalidationStudy.armAbstainReasons[key] ?? 0) + 1;
        }
      }
    }
  }
}
revalidationStudy.gateRejectedCandidates = gateRejectedCandidates;

const out = {
  meta: {
    schema: "forensic-5-trades-computed-v1",
    sourceEvidence: INPUT,
    sourceEvidenceGeneratedAt: evidence.meta?.generatedAt ?? null,
    computedAt: new Date().toISOString(),
    engine: "scripts/forensic-5-trade-audit.mjs",
    independence:
      "Quality/arms recomputados com trade-quality.mjs de producao a partir do snapshot ja registrado (T0_DECISION_SNAPSHOT no journal). O valor RECORDED em producao (SHADOW_ARMS) e a fonte primaria; a recomputacao e o counterexample.",
    errors,
  },
  trades,
  qualityDistribution,
  arms,
  funnelSummary,
  revalidationStudy,
  selection,
};
await fs.writeFile(OUTPUT, JSON.stringify(out, null, 1), "utf8");
console.log(JSON.stringify({
  ok: errors.length === 0,
  trades: trades.length,
  qualityDistribution,
  arms: Object.fromEntries(Object.entries(arms).map(([arm, value]) => [arm, `${value.accept}A/${value.abstain}B`])),
  funnel: funnelSummary,
  output: OUTPUT,
}, null, 2));
