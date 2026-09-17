/** FASE 6.1 — testes da auditoria G2: reconstrucao t0, separacao legacy, outcome vs qualidade,
 * counterfactual rotulado, contabilidade de PnL, isolamento por mercado e gate de critica. */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const audit = await import("../../relay/g2-audit.mjs");
const { buildDataset, analyze, auditCritique, renderReport, parseProcessLog, classifyTiming, contradictionBetween, bucketPayout, MIN_SAMPLE } = audit as unknown as Record<string, any>;
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const professorModule = await import("../../relay/professor.mjs");
const { reviewTrade } = professorModule as unknown as Record<string, any>;

const t0Snapshot = (overrides: Record<string, any> = {}) => ({
  source: "T0_DECISION_SNAPSHOT",
  marketKey: "EURUSD:OTC", marketType: "OTC", capturedAt: 1_789_620_000_000, decisionAt: 1_789_619_999_000,
  action: "BUY", regime: "TREND_UP", setup: "TREND_PULLBACK", trigger: "pullback_com_estrutura_mantida",
  confidence: 0.6, analysisConfidence: 0.6,
  structure: { label: "HH_HL" }, location: { zone: "MEIO_CANAL", distanceToUpperATR: 1.1 }, momentum: { rsi14: 58, acceleration: 0.001 },
  strength: { adx14: 27 }, volatility: { atrRatio: 0.0012 }, microstructure: { streak: 2 },
  supportingEvidence: ["setup:TREND_PULLBACK"], contradictingEvidence: [], primaryRisk: null,
  processLog: [
    { stage: "DATA_INTEGRITY", status: "OK" }, { stage: "REGIME", status: "OK", value: "TREND_UP" },
    { stage: "STRUCTURE", status: "OK", value: "HH_HL" }, { stage: "LOCATION", status: "OK", value: "MEIO_CANAL" },
    { stage: "MOMENTUM", status: "OK", value: 58 }, { stage: "STRENGTH", status: "OK", value: 27 },
    { stage: "VOLATILITY", status: "OK", value: 0.0012 }, { stage: "MICROSTRUCTURE", status: "OK", value: 2 },
    { stage: "SETUP", status: "OK", value: "TREND_PULLBACK" }, { stage: "TRIGGER", status: "OK", value: "pullback_com_estrutura_mantida" },
    { stage: "CONTRADICTIONS", status: "OK", value: [] }, { stage: "DECISION", status: "OK", value: "BUY" },
  ],
  critic: { verdict: "CONFIRM", independentAction: "BUY", contradictions: [], riskFlags: [] },
  consensus: { status: "CONFIRMED", reason: "TRADER_E_CRITIC_ALINHADOS", traderAction: "BUY", criticVerdict: "CONFIRM", criticIndependent: "BUY" },
  knowledgeContextIds: ["TraceCom/02 - Setups/TREND_PULLBACK"], knowledgeVersion: "kb_test", knowledgeUsed: true,
  freshness: { fresh: true, reason: "OK", tickAgeMs: 300 }, brainGeneration: 2,
  ...overrides,
});

const journalRow = ({ id, marketKey = "EURUSD:OTC", direction = "CALL", result, stake = 10, payout = 85, snapshot, entryPrice = 1.1, settlementPrice = 1.101, correlationId = `corr_${id}` }: Record<string, any>) => ({
  trade_id: id, decision_id: `dec_${id}`, correlation_id: correlationId, agent_id: `trader:${marketKey}`, market_key: marketKey, market_type: marketKey.endsWith(":OTC") ? "OTC" : "NORMAL",
  entry_at: "2026-09-17T05:00:00.000Z", settlement_at: "2026-09-17T05:01:00.000Z", payout, stake, direction, result,
  regime: snapshot?.regime ?? null, structure: snapshot?.structure?.label ?? null, location: snapshot?.location?.zone ?? null,
  setup: snapshot?.setup ?? null, trigger: snapshot?.trigger ?? null,
  decision_quality: "GOOD_DECISION",
  payload: { version: "trade-journal-v1", marketKey, direction, result, stake, payout, review: { decisionQuality: "GOOD_DECISION", mistakes: [], lesson: { text: "Processo correto." } }, snapshot, snapshotSource: snapshot?.source ?? "SETTLEMENT_FALLBACK", indicators: snapshot ? { rsi14: snapshot.momentum?.rsi14, adx14: snapshot.strength?.adx14, atrRatio: snapshot.volatility?.atrRatio } : {} },
});

const executionRow = ({ id, entry = 1.1, settlement = 1.101, requestedAt = "2026-09-17T04:59:58.900Z", ackedAt = "2026-09-17T04:59:59.100Z" }: Record<string, any>) => ({
  execution_id: id, decision_id: `dec_${id}`, state: "SETTLED", entry_price: entry, broker_result: "WIN", causal_result: "WIN",
  meta: { marketKey: "EURUSD:OTC", causal: { entry, settlement, direction: "CALL" } },
  requested_at: requestedAt, acked_at: ackedAt, settled_at: "2026-09-17T05:01:00.000Z",
});

describe("G2 AUDIT — reconstrucao e integridade", () => {
  it("usa somente dados t0 quando o snapshot T0 existe e marca fallback quando nao existe", () => {
    const good = journalRow({ id: "t0", result: "WIN", snapshot: t0Snapshot() });
    const fallback = journalRow({ id: "fb", result: "LOSS", snapshot: null });
    const dataset = buildDataset({ journalRows: [good, fallback], executions: [executionRow({ id: "t0" }), executionRow({ id: "fb", settlement: 1.09 })], auditRows: [] });
    const rows = dataset.rows as any[];
    expect(rows).toHaveLength(2);
    const first = rows.find((row) => row.tradeId === "t0");
    const second = rows.find((row) => row.tradeId === "fb");
    expect(first.t0Reliable).toBe(true);
    expect(first.rsi).toBe(58);
    expect(first.adx).toBe(27);
    expect(first.timing).toBe("GOOD_TIMING");
    expect(first.causes).not.toContain("INSUFFICIENT_CONTEXT");
    expect(second.t0Reliable).toBe(false);
    expect(second.timing).toBe("UNKNOWN");
    expect(second.causes).toContain("INSUFFICIENT_CONTEXT");
    expect(second.decisionQualityEffective).toBe("UNCLEAR_DECISION_QUALITY");
    expect(second.decisionQualityRaw).toBe("GOOD_DECISION");
  });

  it("lega (V1/V2/V3/V8) fica fora: dataset so consome o journal G2 fornecido e mantem strategySource por trade", () => {
    const dataset = buildDataset({ journalRows: [journalRow({ id: "g2", result: "WIN", snapshot: t0Snapshot() })], executions: [executionRow({ id: "g2" })], auditRows: [] });
    expect(dataset.rows).toHaveLength(1);
    expect(dataset.rows[0].strategySource).toBeNull();
    expect(String(dataset.legacy.note)).toContain("LEGACY");
  });

  it("precos entram do meta.causal e alimentam o counterfactual rotulado", () => {
    const dataset = buildDataset({ journalRows: [journalRow({ id: "p1", result: "LOSS", settlementPrice: 1.09, snapshot: t0Snapshot() })], executions: [executionRow({ id: "p1", settlement: 1.09 })], auditRows: [] });
    const row = dataset.rows[0];
    expect(row.entryPrice).toBe(1.1);
    expect(row.settlementPrice).toBe(1.09);
    expect(row.priceDelta).toBeCloseTo(-0.01, 6);
    expect(row.counterfactual).toMatchObject({ label: "COUNTERFACTUAL_ONLY" });
    expect(row.counterfactual.invert.direction).toBe("SELL");
    expect(row.counterfactual.invert.result).toBe("WIN");
    expect(row.counterfactual.wait.result).toBe("WAIT");
    expect(row.result).toBe("LOSS");
  });

  it("PnL segue stake x payout; DRAW=0; correlationId e marketKey preservados", () => {
    const rows = [
      journalRow({ id: "w", result: "WIN", stake: 10, payout: 85, snapshot: t0Snapshot() }),
      journalRow({ id: "l", result: "LOSS", stake: 10, payout: 85, snapshot: t0Snapshot() }),
      journalRow({ id: "d", result: "DRAW", stake: 10, payout: 85, snapshot: t0Snapshot() }),
    ];
    const dataset = buildDataset({ journalRows: rows, executions: [], auditRows: [] });
    const byId = Object.fromEntries(dataset.rows.map((row: any) => [row.tradeId, row]));
    expect(byId.w.pnl).toBeCloseTo(8.5, 4);
    expect(byId.l.pnl).toBeCloseTo(-10, 4);
    expect(byId.d.pnl).toBe(0);
    expect(byId.w.correlationId).toBe("corr_w");
    expect(byId.w.marketType).toBe("OTC");
  });
});

describe("G2 AUDIT — qualidade x resultado e contrafactual", () => {
  it("GOOD_DECISION+LOSS e BAD_DECISION+WIN existem e sao contabilizados separadamente", () => {
    const goodLoss: any = journalRow({ id: "gl", result: "LOSS", snapshot: t0Snapshot() });
    goodLoss.payload.review = { decisionQuality: "GOOD_DECISION", mistakes: [], lesson: { text: "Processo correto." } };
    goodLoss.decision_quality = "GOOD_DECISION";
    const badWin: any = journalRow({ id: "bw", result: "WIN", snapshot: t0Snapshot({ setup: "NO_VALID_SETUP", trigger: null }) });
    badWin.payload.review = { decisionQuality: "BAD_DECISION", mistakes: [{ code: "SEM_SETUP" }], lesson: { text: "Evitar SEM_SETUP." } };
    badWin.decision_quality = "BAD_DECISION";
    const dataset = buildDataset({ journalRows: [goodLoss, badWin], executions: [], auditRows: [] });
    const analysis = analyze(dataset);
    expect(analysis.outcomesByQuality["GOOD_DECISION+LOSS"]).toBe(1);
    expect(analysis.outcomesByQuality["BAD_DECISION+WIN"]).toBe(1);
    expect(analysis.professor.goodDecisionLosses).toBe(1);
    expect(analysis.professor.badDecisionWins).toBe(1);
  });

  it("professor avalia o snapshot ANTES do outcome: mesma qualidade para WIN e LOSS; outcome muda so o rotulo", () => {
    const snapshot = t0Snapshot();
    const win = reviewTrade({ snapshot, outcome: "WIN", result: "WIN" });
    const loss = reviewTrade({ snapshot, outcome: "LOSS", result: "LOSS" });
    expect(win.decisionQuality).toBe(loss.decisionQuality);
    expect(win.outcomeVsQuality).toBe("GOOD_DECISION+WIN");
    expect(loss.outcomeVsQuality).toBe("GOOD_DECISION+LOSS");
  });

  it("counterfactual nao contamina a decisao viva (linha permanece a mesma alem do campo rotulado)", () => {
    const dataset = buildDataset({ journalRows: [journalRow({ id: "cf", result: "LOSS", snapshot: t0Snapshot() })], executions: [executionRow({ id: "cf", settlement: 1.09 })], auditRows: [] });
    const row = dataset.rows[0];
    const before = { ...row };
    expect(before.causes).toContain("NORMAL_STATISTICAL_LOSS");
    expect(before.setup).toBe("TREND_PULLBACK");
    expect(before.timing).toBe("GOOD_TIMING");
    expect(before.counterfactual.label).toBe("COUNTERFACTUAL_ONLY");
    expect(analysisOf(row)).not.toBeNull();
  });
});

function analysisOf(row: any) { return row.counterfactual; }

describe("G2 AUDIT — heuristicas determinizadas e gate de critica", () => {
  it("timing: NO_VALID_TRIGGER, LATE_ENTRY e GOOD_TIMING com regras explicitas", () => {
    expect(classifyTiming({ direction: "BUY", trigger: null, rsi: 50, location: null, atrRatio: null })).toBe("NO_VALID_TRIGGER");
    expect(classifyTiming({ direction: "BUY", trigger: "x", rsi: 74, location: "TOPO_DO_CANAL", atrRatio: 0.003 })).toBe("LATE_ENTRY");
    expect(classifyTiming({ direction: "SELL", trigger: "x", rsi: 26, location: null, atrRatio: null })).toBe("LATE_ENTRY");
    expect(classifyTiming({ direction: "BUY", trigger: "x", rsi: 42, location: null, atrRatio: null })).toBe("EARLY_ENTRY");
    expect(classifyTiming({ direction: "SELL", trigger: "x", rsi: 44, location: "MEIO", atrRatio: 0.001 })).toBe("GOOD_TIMING");
    expect(classifyTiming({ direction: "BUY", trigger: "x", rsi: null, location: null, atrRatio: null })).toBe("UNKNOWN");
  });

  it("parseProcessLog extrai indicadores e deteta contradicao regime x estrutura", () => {
    const parsed = parseProcessLog(t0Snapshot().processLog);
    expect(parsed.rsi).toBe(58);
    expect(parsed.adx).toBe(27);
    expect(parsed.atrRatio).toBeCloseTo(0.0012, 6);
    expect(parsed.structure).toBe("HH_HL");
    expect(parsed.decisionStage).toBe("BUY");
    expect(contradictionBetween("TREND_UP", "RANGE_LATERAL")).toBe(true);
    expect(contradictionBetween("TREND_UP", "HH_HL")).toBe(false);
    expect(contradictionBetween("RANGE", "TREND_UP")).toBe(true);
    expect(bucketPayout(77)).toBe("<80");
    expect(bucketPayout(84)).toBe("80-84");
    expect(bucketPayout(86)).toBe("85-89");
    expect(bucketPayout(92)).toBe("90+");
  });

  it("relatorio pequeno declara falta de evidencia e o critic gate lista multiplas comparacoes", () => {
    const dataset = buildDataset({ journalRows: [journalRow({ id: "r1", result: "LOSS", snapshot: t0Snapshot() })], executions: [executionRow({ id: "r1", settlement: 1.09 })], auditRows: [] });
    const analysis = analyze(dataset);
    const critique = auditCritique(analysis, dataset);
    const report = renderReport({ dataset, analysis, critique });
    expect(analysis.sampleSufficient).toBe(false);
    expect(report).toContain("AINDA NAO HA EVIDENCIA SUFICIENTE PARA ATRIBUIR CAUSA DOMINANTE");
    expect(report).toContain("COUNTERFACTUAL_ONLY");
    expect(report).toContain("GATE DE CRITICA");
    expect(critique.integrity.verdict).toBe("INSUFFICIENT_SAMPLE");
    expect(critique.integrity.comparisonCount).toBeGreaterThan(0);
    expect(MIN_SAMPLE).toBe(30);
    expect(critique.questions.some((item: any) => item.q.includes("informacao futura"))).toBe(true);
  });

  it("isolamento por mercado: placar nao mistura NORMAL e OTC", () => {
    const dataset = buildDataset({
      journalRows: [
        journalRow({ id: "otc", marketKey: "EURUSD:OTC", result: "WIN", snapshot: t0Snapshot({ marketKey: "EURUSD:OTC" }) }),
        journalRow({ id: "nor", marketKey: "EURUSD:NORMAL", result: "LOSS", snapshot: t0Snapshot({ marketKey: "EURUSD:NORMAL", marketType: "NORMAL" }) }),
      ],
      executions: [], auditRows: [],
    });
    const analysis = analyze(dataset);
    const otc = (analysis.subgroups.markets as any[]).find((group) => group.key === "EURUSD:OTC");
    const normal = (analysis.subgroups.markets as any[]).find((group) => group.key === "EURUSD:NORMAL");
    expect(otc).toMatchObject({ n: 1, w: 1, l: 0 });
    expect(normal).toMatchObject({ n: 1, w: 0, l: 1 });
    expect(dataset.rows[0].marketType).toBe("OTC");
    expect(dataset.rows[1].marketType).toBe("NORMAL");
  });

  it("correlationId liga journal e audit trail de settlement", () => {
    const auditRows = [{ correlation_id: "corr_x", stage: "SETTLEMENT", detail: { causal: { entry: 2.0, settlement: 2.01, direction: "CALL" } } }];
    const dataset = buildDataset({ journalRows: [journalRow({ id: "x", result: "WIN", correlationId: "corr_x", snapshot: t0Snapshot() })], executions: [], auditRows });
    expect(dataset.rows[0].entryPrice).toBe(2.0);
    expect(dataset.rows[0].settlementPrice).toBe(2.01);
  });
});
