/** FASE 6.3 — TradeQualityEngine: sem leakage, temporal split, abstencao pura, payout/break-even,
 * estabilidade, price chase, monitor de saude e isolamento por mercado. */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const quality = await import("../../relay/trade-quality.mjs");
const { extractFeatures, evaluateShadowArms, triggerStrength, selectiveCurve, temporalSplit, fitLogistic, auc, criticAudit, stabilityStudy, priceChaseStudy, performanceHealth, BREAK_EVEN_WR, ARM_IDS, scoreTradeQuality, entryLocationCheck, finalMicrostructureVeto, DEFAULT_MIN_TRADE_QUALITY_SCORE } = quality as unknown as Record<string, any>;

const baseSnapshot = (overrides: Record<string, any> = {}) => ({
  source: "T0_DECISION_SNAPSHOT", regime: "TREND_UP", setup: "TREND_PULLBACK", trigger: "pullback_com_estrutura_mantida",
  price: 1.1,
  structure: { label: "HH_HL", candleShape: { bodyRatio: 0.6, upperWick: 0.1, lowerWick: 0.1 }, velocity: { velocity: 0.0001, acceleration: 0.0002 }, events: {} },
  location: { zone: "MID", donchianPosition: 0.55, distanceToUpperATR: 1.2, distanceToLowerATR: 1.8 },
  momentum: { rsi14: 58, acceleration: 0.0002 }, strength: { adx14: 27, plusDI: 25, minusDI: 18, diSpread: 7 },
  volatility: { atr: 0.001, atrRatio: 1.0, compression: false, expansion: false }, microstructure: { streak: 2 },
  critic: { verdict: "CONFIRM", independentAction: "BUY", contradictions: [], riskFlags: [] },
  consensus: { status: "CONFIRMED" },
  ...overrides,
});

const trade = ({ result, pnl, payout = 85, marketKey = "EURUSD:OTC", direction = "CALL", snapshot = baseSnapshot(), timing = { candidatePrice: 1.1, entryPrice: 1.1005, candidateAgeMs: 30_000, directionChanges: 0, candidateChangedBeforeEntry: false }, settlementAt = 1_789_620_600_000 }: Record<string, any>) => ({ tradeId: `t_${Math.random().toString(36).slice(2, 8)}`, marketKey, marketType: marketKey.endsWith(":OTC") ? "OTC" : "NORMAL", direction, stake: 10, payout, result, pnl, settlementAt, snapshot, timing });

describe("TRADE QUALITY — features e leakage", () => {
  it("resultado NUNCA entra como feature (extractFeatures nao le result/pnl como sinal)", () => {
    const win = extractFeatures(trade({ result: "WIN", pnl: 8.5 }), { candidatePrice: 1.1, entryPrice: 1.1005 });
    const loss = extractFeatures(trade({ result: "LOSS", pnl: -10 }), { candidatePrice: 1.1, entryPrice: 1.1005 });
    for (const key of ["rsi", "adx", "atrRatio", "bodyRatio", "acceleration", "directionChanges", "entryDisplacementATR"]) {
      expect(win[key], key).toEqual(loss[key]);
    }
    expect(win.result).toBe("WIN");
    expect(loss.result).toBe("LOSS");
  });

  it("break-even por payout e displacement em ATR", () => {
    expect(BREAK_EVEN_WR(85)).toBeCloseTo(0.5405, 3);
    expect(BREAK_EVEN_WR(50)).toBeCloseTo(0.6667, 3);
    expect(BREAK_EVEN_WR(0)).toBeNull();
    const features = extractFeatures(trade({ result: "WIN", pnl: 8.5 }), { candidatePrice: 1.1, entryPrice: 1.101 });
    expect(features.entryDisplacement).toBeCloseTo(0.001, 6);
    expect(features.entryDisplacementATR).toBeCloseTo(1, 3);
  });
});

describe("TRADE QUALITY — abstencao pura e bracos", () => {
  it("bracos somente ACCEPT/ABSTAIN e nunca mudam a direcao", () => {
    const features = extractFeatures(trade({ result: "WIN", pnl: 8.5 }), {});
    const arms = evaluateShadowArms(features);
    expect(Object.keys(arms).sort()).toEqual([...ARM_IDS].sort());
    for (const arm of Object.values(arms) as any[]) {
      expect(["ACCEPT", "ABSTAIN"]).toContain(arm.decision);
    }
    expect(arms.A_G2_JIT.decision).toBe("ACCEPT");
  });

  it("regime incerto, conflito de DI, trigger fraco, instabilidade, critic nao-CONFIRM e overextension abstem", () => {
    const base = extractFeatures(trade({ result: "WIN", pnl: 8.5 }), {});
    expect(evaluateShadowArms({ ...base, regime: "TRANSITION" }).B_QUALITY_GATE.decision).toBe("ABSTAIN");
    expect(evaluateShadowArms({ ...base, plusDI: 10, minusDI: 30, direction: "BUY" }).B_QUALITY_GATE.decision).toBe("ABSTAIN");
    expect(evaluateShadowArms({ ...base, trigger: null }).B_QUALITY_GATE.decision).toBe("ABSTAIN");
    expect(evaluateShadowArms({ ...base, candidateChangedBeforeEntry: true }).C_STABILITY.decision).toBe("ABSTAIN");
    expect(evaluateShadowArms({ ...base, criticVerdict: "CONTEST" }).D_CRITIC.decision).toBe("ABSTAIN");
    expect(evaluateShadowArms({ ...base, criticRiskFlags: ["noticia_alto_impacto"] }).D_CRITIC.decision).toBe("ABSTAIN");
    expect(evaluateShadowArms({ ...base, acceleration: -0.0002 }).E_MICROSTRUCTURE.decision).toBe("ABSTAIN");
    expect(evaluateShadowArms({ ...base, distanceUpperATR: 3.2 }).E_MICROSTRUCTURE.decision).toBe("ABSTAIN");
    expect(evaluateShadowArms(base).F_COMBINED.decision).toBe("ACCEPT");
  });

  it("triggerStrength e deterministico e explica componentes", () => {
    const features = extractFeatures(trade({ result: "WIN", pnl: 8.5 }), {});
    const strength = triggerStrength(features);
    expect(strength.score).toBeGreaterThanOrEqual(4);
    expect(strength.reasons).toEqual(expect.arrayContaining(["corpo_dominante", "trigger_presente", "critic_confirm", "di_a_favor"]));
  });
});

describe("TRADE QUALITY — temporal split, modelo e curva", () => {
  it("split temporal mantem ordem cronologica e gap (sem embaralhar)", () => {
    const rows = Array.from({ length: 20 }, (_, index) => trade({ result: index % 2 ? "WIN" : "LOSS", pnl: index % 2 ? 8.5 : -10, settlementAt: 1_000_000 + index * 60_000 }));
    const split = temporalSplit(rows, { discovery: 0.5, validation: 0.25, gapMs: 120_000 });
    expect(split.sizes.total).toBe(20);
    expect(split.sizes.discovery).toBe(10);
    const minDiscovery = Math.max(...split.discovery.map((row: any) => row.settlementAt));
    for (const row of split.validation) expect(row.settlementAt).toBeGreaterThan(minDiscovery);
    const ordered = [...rows].sort((a, b) => a.settlementAt - b.settlementAt);
    expect(split.discovery[0]!.tradeId).toBe(ordered[0]!.tradeId);
  });

  it("curva seletiva mostra coverage x WR e nao avalia threshold com resultado em treino", () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ ...trade({ result: index % 3 ? "WIN" : "LOSS", pnl: index % 3 ? 8.5 : -10 }), qualityScore: index * 4 }));
    const curve = selectiveCurve(rows, [40, 60, 80]);
    expect(curve[0]!.coverage).toBeCloseTo(20 / 30, 3);
    expect(curve[2]!.accepted).toBeLessThan(curve[0]!.accepted);
  });

  it("modelo logistico exige amostra e retorna AUC valido; AUC e simetrico", () => {
    const small = fitLogistic([], ["rsi"]);
    expect(small.ok).toBe(false);
    const rows = Array.from({ length: 24 }, (_, index) => ({ ...extractFeatures(trade({ result: index < 12 ? "WIN" : "LOSS", pnl: index < 12 ? 8.5 : -10 }), {}), result: index < 12 ? "WIN" : "LOSS", rsi: index < 12 ? 60 + index : 40 - index }));
    const model = fitLogistic(rows, ["rsi"], { iterations: 400 });
    expect(model.ok).toBe(true);
    expect(model.auc).toBeGreaterThan(0.8);
    expect(auc([{ score: 0.9, label: 1 }, { score: 0.1, label: 0 }])).toBe(1);
    expect(auc([])).toBeNull();
  });
});

describe("TRADE QUALITY — score 0-100, entry location e veto de microestrutura", () => {
  it("score alto com evidencia alinhada e abaixo do threshold com evidencia fraca", () => {
    const strong = extractFeatures(trade({ result: "WIN", pnl: 8.5 }), { candidatePrice: 1.1, entryPrice: 1.1005 });
    strong.knowledgeContextIds = ["TraceCom/02 - Setups/TREND_PULLBACK"];
    const strongScore = scoreTradeQuality(strong);
    expect(strongScore.score).toBeGreaterThanOrEqual(75);
    expect(strongScore.max).toBe(100);
    expect(Object.keys(strongScore)).not.toContain("estimatedWinProbability");
    const weak = { ...strong, trigger: null, regime: "TRANSITION", structureLabel: "RANGE", plusDI: 10, minusDI: 30, adx: 12, rsi: 78, streak: -3, acceleration: -0.001, donchianPosition: 0.5, knowledgeContextIds: [] };
    expect(scoreTradeQuality(weak).score).toBeLessThan(DEFAULT_MIN_TRADE_QUALITY_SCORE);
    expect(DEFAULT_MIN_TRADE_QUALITY_SCORE).toBe(75);
  });

  it("entry location: setup valido mas preco ja andou => VALID_SETUP_BUT_BAD_ENTRY_PRICE", () => {
    const features = extractFeatures(trade({ result: "WIN", pnl: 8.5 }), { candidatePrice: 1.1, entryPrice: 1.1015 });
    expect(features.entryDisplacementATR).toBeCloseTo(1.5, 3);
    const location = entryLocationCheck(features);
    expect(location.ok).toBe(false);
    expect(location.code).toBe("VALID_SETUP_BUT_BAD_ENTRY_PRICE");
    expect(location.reasons).toContain("ENTRY_DISPLACEMENT_CHASED");
    const cleanLocation = entryLocationCheck(extractFeatures(trade({ result: "WIN", pnl: 8.5 }), { candidatePrice: 1.1, entryPrice: 1.1005 }));
    expect(cleanLocation.ok).toBe(true);
  });

  it("veto de microestrutura so veta (nunca cria direcao) e registra motivo", () => {
    const veto = finalMicrostructureVeto({ direction: "BUY", atr: 0.001, lastTick: { price: 1.0995, ageMs: 100 }, lastClose: 1.1 });
    expect(veto.veto).toBe(true);
    expect(veto.reason).toBe("ADVERSE_TICK_DISPLACEMENT");
    const pass = finalMicrostructureVeto({ direction: "SELL", atr: 0.001, lastTick: { price: 1.0995, ageMs: 100 }, lastClose: 1.1 });
    expect(pass.veto).toBe(false);
    expect(finalMicrostructureVeto({ direction: "BUY", atr: null, lastTick: { price: 1.0, ageMs: 1 }, lastClose: 1.1 }).veto).toBe(false);
    const resultKeys = Object.keys(veto).sort();
    expect(resultKeys).toEqual(["detail", "reason", "veto"]);
  });
});

describe("TRADE QUALITY — critic, estabilidade, price chase e saude", () => {
  it("critic audit categoriza losses confirmados com evidencias t0", () => {
    const rows = [
      { tradeId: "a", marketKey: "EURUSD:OTC", features: extractFeatures(trade({ result: "LOSS", pnl: -10, snapshot: baseSnapshot({ regime: "TRANSITION", momentum: { rsi14: 74 } }) }), {}) },
      { tradeId: "b", marketKey: "EURUSD:OTC", features: extractFeatures(trade({ result: "LOSS", pnl: -10, snapshot: baseSnapshot({ strength: { adx14: 20, plusDI: 10, minusDI: 30, diSpread: 20 } }) }), {}) },
    ];
    const audit = criticAudit(rows);
    expect(audit.confirmedLosses).toBe(2);
    expect(audit.counts.REGIME_UNCERTAIN).toBe(1);
    expect(audit.counts.DI_CONFLICT).toBe(1);
    expect(audit.counts.LATE_ENTRY ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("estabilidade e price chase bucketizam conforme direcao e displacement", () => {
    const stable = { ...extractFeatures(trade({ result: "WIN", pnl: 8.5 }), { candidatePrice: 1.1, entryPrice: 1.1005 }), result: "WIN", normalizedPnl: 0.85, directionChanges: 0, candidateChangedBeforeEntry: false };
    const unstable = { ...extractFeatures(trade({ result: "LOSS", pnl: -10 }), { candidatePrice: 1.1, entryPrice: 1.1 }), result: "LOSS", normalizedPnl: -1, directionChanges: 2, candidateChangedBeforeEntry: true };
    const stability = stabilityStudy([stable, unstable]);
    expect(stability.find((row: any) => row.key === "STABLE")).toMatchObject({ n: 1, wins: 1 });
    expect(stability.find((row: any) => row.key === "CHANGED_2PLUS")).toMatchObject({ n: 1, losses: 1 });
    const chase = priceChaseStudy([stable, { ...unstable, entryDisplacementATR: -1.2 }]);
    expect(chase.buckets.MODERATE.n).toBe(1);
    expect(chase.buckets.NEGATIVE.n).toBe(1);
  });

  it("monitor de saude recomenda pausa sem mudar estrategia/stake e isola mercados", () => {
    const losses = Array.from({ length: 7 }, () => ({ result: "LOSS", normalizedPnl: -1 }));
    const health = performanceHealth({ trades: losses, coverage: 0.3 });
    expect(health.status).toBe("PAUSE_NEW_ENTRIES_RECOMMENDED");
    expect(health.reasons).toContain("SEQUENTIAL_LOSS_CONCENTRATION");
    expect(health.note).toContain("nao muda estrategia");
    const eur = extractFeatures(trade({ result: "WIN", pnl: 8.5, marketKey: "EURUSD:OTC" }), {});
    const gbp = extractFeatures(trade({ result: "LOSS", pnl: -10, marketKey: "GBPUSD:NORMAL" }), {});
    expect(eur.marketKey).toBe("EURUSD:OTC");
    expect(gbp.marketType).toBe("NORMAL");
  });
});
