/** FASE 6 — Professional Brain G2, Second Brain (Obsidian), Professor, Journal, Hypotheses e Supervisor.
 * Regras: nenhuma estrategia V1/V2/V3/V8 no caminho ativo; memoria point-in-time; Promotion Gate. */
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const brainModule = await import("../../relay/professional-brain.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const secondBrainModule = await import("../../relay/second-brain.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const professorModule = await import("../../relay/professor.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const knowledgeModule = await import("../../relay/knowledge-base.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const structureModule = await import("../../relay/price-structure.mjs");

const { BRAIN_GENERATION, BRAIN_VERSION, CORE_BRAIN, SETUPS, REGIMES, traderBrainDecision, criticBrainAssessment, consensusBrainDecision, PROCESS_STEPS, PRINCIPLES } = brainModule as unknown as Record<string, any>;
const { SecondBrainAdapter, PROTECTED_PREFIXES, normalizeScopePath } = secondBrainModule as unknown as Record<string, any>;
const { reviewTrade, TradingJournal, HypothesisRegistry, PerformanceSupervisor, DECISION_QUALITIES } = professorModule as unknown as Record<string, any>;
const { TradingKnowledgeRetriever } = knowledgeModule as unknown as Record<string, any>;

const featureContext = (rsi = 45, adx = 30, plusDI = 30, minusDI = 12, streak = 3) => ({
  deterministicIndicators: {
    rsi14: { value: rsi }, adx14: { value: adx }, atr14: { value: 0.001 }, atrNormalized: { value: 0.0009 },
    plusDI: { value: plusDI }, minusDI: { value: minusDI }, diSpread: { value: Math.abs(plusDI - minusDI) },
    donchianWidthATR: { value: 3.4 }, distanceToUpperATR: { value: 1.1 }, distanceToLowerATR: { value: 2.3 },
  },
  microstructure: { streak },
});

function trendingCandles(count = 80, start = 1.1, step = 0.0002) {
  const candles = [];
  for (let index = 0; index < count; index += 1) {
    const close = start + index * step;
    candles.push({ bucketStart: index * 5_000, start: index * 5_000, open: close - step / 2, high: close + step, low: close - step, close });
  }
  return candles;
}

describe("PROFESSIONAL BRAIN G2 — processo deterministico, sem estrategias antigas", () => {
  it("expoe geracao 2, principios, processo, regimes e setups (nenhum V1/V2/V3/V8)", () => {
    expect(BRAIN_GENERATION).toBe(2);
    expect(BRAIN_VERSION).toBe("professional-brain-v2");
    expect(PRINCIPLES.length).toBeGreaterThanOrEqual(5);
    expect(PROCESS_STEPS.length).toBeGreaterThanOrEqual(10);
    expect(REGIMES).toContain("UNCLEAR");
    expect(SETUPS).toEqual(expect.arrayContaining(["TREND_PULLBACK", "BREAKOUT_CONTINUATION", "NO_VALID_SETUP"]));
    expect(JSON.stringify(CORE_BRAIN)).not.toMatch(/V[1238]-\d+/);
  });

  it("trader/critic/consensus sao deterministicos e nunca inventam probabilidade", () => {
    const { computeStructureFeatures, classifyRegime } = structureModule as unknown as Record<string, any>;
    const candles = trendingCandles(80);
    const structureFeatures = computeStructureFeatures(candles, candles.length - 1);
    const regime = classifyRegime({ features: { rsi14: 62, r24: 0.012, vol12: 0.0004 }, structureFeatures, context: featureContext(62, 31, 32, 10, 4) });
    const features = { rsi14: 62, s: -0.15, r24: 0.012, vol12: 0.0004 };
    const input = { marketKey: "EURUSD:OTC", marketType: "OTC", features, context: featureContext(62, 31, 32, 10, 4), structureFeatures, regime, freshness: { fresh: true, reason: "OK", tickAgeMs: 500 }, intelligence: { news: { importance: 0.1 }, macro: null }, knowledgeContext: { used: true, knowledgeIds: ["TraceCom/01 - Regimes/TREND_UP"], knowledgeVersion: "kb_test" } };
    const traderA = traderBrainDecision(input);
    const traderB = traderBrainDecision(input);
    expect(traderA.action).toBe(traderB.action);
    expect(traderA.estimatedWinProbability).toBeNull();
    expect(traderA.knowledgeContextIds).toEqual(["TraceCom/01 - Regimes/TREND_UP"]);
    const critic = criticBrainAssessment({ ...input, trader: traderA });
    const consensus = consensusBrainDecision({ trader: traderA, critic, freshness: input.freshness });
    expect(consensus.estimatedWinProbability).toBeNull();
    expect(["CONFIRMED", "NO_CONSENSUS", "VETOED", "WAIT", "STALE"]).toContain(consensus.status);
    expect(Array.isArray(traderA.processLog)).toBe(true);
    expect(traderA.processLog.length).toBeGreaterThanOrEqual(10);
    // dados nao frescos => WAIT
    const stale = traderBrainDecision({ ...input, freshness: { fresh: false, reason: "STALE_ANALYSIS", tickAgeMs: 90_000 } });
    expect(stale.action).toBe("WAIT");
  });
});

describe("SECOND BRAIN — escopo TraceCom, Promotion Gate e modo OFFLINE", () => {
  it("OFFLINE nao conecta nada e reporta politica de escopo", () => {
    const adapter = new SecondBrainAdapter({ vaultPath: null, baseUrl: null, token: null }) as any;
    expect(adapter.mode).toBe("OFFLINE");
    expect(adapter.status().scope).toBe("TraceCom/");
    expect(adapter.status().policy.autoPromotionToValidatedForbidden).toBe(true);
    expect(normalizeScopePath("TraceCom/10 - Agents/X.md")).toBe("TraceCom/10 - Agents/X.md");
    expect(() => normalizeScopePath("OutroProjeto/nota.md")).toThrowError(/SCOPE_VIOLATION/);
    expect(() => normalizeScopePath("TraceCom/../secrets.md")).toThrowError(/SCOPE_VIOLATION/);
    expect(PROTECTED_PREFIXES).toContain("15 - Validated Knowledge");
  });

  it("LOCAL_FS escreve somente no namespace e bloqueia paths protegidos sem Promotion Gate", async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "tracecom-vault-"));
    try {
      const adapter = new SecondBrainAdapter({ vaultPath: vault }) as any;
      expect(adapter.mode).toBe("LOCAL_FS");
      const probe = await adapter.probe();
      expect(probe.reachable).toBe(true);
      const ok = await adapter.writeNote("TraceCom/11 - Trade Journal/EURUSD-OTC/2026-09-17.md", "# diario\n", {});
      expect(ok.written).toBe(true);
      await expect(adapter.writeNote("TraceCom/15 - Validated Knowledge/regra.md", "# regra\n", {})).rejects.toThrowError(/PROMOTION_GATE_REQUIRED/);
      await expect(adapter.readNote("TraceCom/11 - Trade Journal/EURUSD-OTC/2026-09-17.md")).resolves.toContain("diario");
      await expect(adapter.writeNote("TraceCom/../fora.md", "x")).rejects.toThrowError(/SCOPE_VIOLATION/);
      const protectedWrite = await adapter.writeNote("TraceCom/15 - Validated Knowledge/promovida.md", "# promovida\n", { promotion: true });
      expect(protectedWrite.written).toBe(true);
    } finally { await fs.rm(vault, { recursive: true, force: true }); }
  });
});

describe("PROFESSOR + JOURNAL — qualidade da decisao separada do resultado", () => {
  it("existe GOOD_DECISION+LOSS e BAD_DECISION+WIN (outcome nao define qualidade)", () => {
    const goodLoss = reviewTrade({ snapshot: { marketKey: "EURUSD:OTC", setup: "TREND_PULLBACK", regime: "TREND_UP", action: "BUY", trigger: "pullback concluido", location: { distanceToUpperATR: 0.4 }, momentum: { acceleration: 0.001 }, analysisConfidence: 0.7, processLog: [{ stage: "SETUP", status: "OK" }], contradictingEvidence: [] }, outcome: "LOSS", result: "LOSS" });
    expect(goodLoss.decisionQuality).toBe("GOOD_DECISION");
    expect(goodLoss.outcomeVsQuality).toBe("GOOD_DECISION+LOSS");
    expect(goodLoss.mistakes).toHaveLength(0);
    const badWin = reviewTrade({ snapshot: { marketKey: "EURUSD:OTC", setup: "NO_VALID_SETUP", regime: "CHAOTIC", action: "BUY", trigger: null, location: { distanceToUpperATR: 3.2 }, momentum: { acceleration: -0.002 }, contradictingEvidence: ["forca_caindo"] }, outcome: "WIN", result: "WIN" });
    expect(badWin.decisionQuality).toBe("BAD_DECISION");
    expect(badWin.outcomeVsQuality).toBe("BAD_DECISION+WIN");
    expect(badWin.mistakes.map((mistake: any) => mistake.code)).toEqual(expect.arrayContaining(["SEM_SETUP", "REGIME_INADEQUADO", "ENTRADA_SEM_TRIGGER"]));
    expect(DECISION_QUALITIES).toContain("ACCEPTABLE_DECISION");
  });

  it("journal agrega memoria por agente e separa decisao de resultado", async () => {
    const journal = new TradingJournal({ pool: null, now: () => 1_789_600_000_000 }) as any;
    journal.recordDecision({ agentId: "trader:EURUSD-OTC", marketKey: "EURUSD:OTC", marketType: "OTC", decisionAt: 1_789_600_000_000, snapshot: { setup: "TREND_PULLBACK", regime: "TREND_UP", action: "WAIT", waitReason: "SEM_SETUP_VALIDO" } });
    await journal.recordTrade({ tradeId: "t1", agentId: "trader:EURUSD-OTC", marketKey: "EURUSD:OTC", marketType: "OTC", settlementAt: 1_789_600_300_000, result: "LOSS", profit: -1, stake: 1, direction: "CALL", snapshot: { setup: "TREND_PULLBACK", regime: "TREND_UP", action: "BUY", trigger: "x", marketKey: "EURUSD:OTC" }, review: { decisionQuality: "GOOD_DECISION", outcome: "LOSS", mistakes: [], lesson: { text: "processo ok" } } });
    const memory = journal.agentMemory("trader:EURUSD-OTC");
    expect(memory.stats).toMatchObject({ trades: 1, losses: 1, goodDecisions: 1, goodDecisionLosses: 1, waitCount: 1 });
    expect(memory.lessons).toHaveLength(1);
    const day = new Date(1_789_600_300_000).toISOString().slice(0, 10);
    const daily = journal.dailyReport(day);
    expect(daily).toMatchObject({ trades: 1, losses: 1, waits: 1, goodDecisionLosses: 1 });
    expect(daily.smallSampleWarning).toContain("AMOSTRA PEQUENA");
  });
});

describe("HYPOTHESES + SUPERVISOR — promocao com evidencia e revisao sem troca de metodologia", () => {
  it("hypothesis so promove com amostra prospectiva minima e ganho; sem evidencia permanece HOLD/REJECT", () => {
    const registry = new HypothesisRegistry({ now: () => 1_789_600_000_000, secondBrain: null }) as any;
    const item = registry.create({ originAgent: "trader:EURUSD-OTC", marketKey: "EURUSD:OTC", statement: "Pullback em TREND_UP com RSI>55 tem vantagem no horizonte 60s", observedEffect: "WR 62% em 40 amostras exploratorias", sample: 40, markets: ["EURUSD:OTC"], regime: "TREND_UP", setup: "TREND_PULLBACK" });
    expect(item.state).toBe("CANDIDATE");
    expect(registry.evaluate(item.id).decision).toBe("HOLD");
    for (let index = 0; index < 30; index += 1) registry.observe(item.id, { result: index < 20 ? "WIN" : "LOSS", pnl: index < 20 ? 0.85 : -1 });
    const evaluation = registry.evaluate(item.id);
    expect(evaluation.decided).toBe(30);
    expect(evaluation.decision).toBe("PROMOTE");
    expect(registry.items.get(item.id).state).toBe("PROMOTED");
    const bad = registry.create({ statement: "RU1", marketKey: "EURUSD:OTC", originAgent: "research", sample: 1 });
    for (let index = 0; index < 30; index += 1) registry.observe(bad.id, { result: index < 5 ? "WIN" : "LOSS", pnl: index < 5 ? 0.85 : -1 });
    expect(registry.evaluate(bad.id).decision).toBe("REJECT");
  });

  it("supervisor pede REVIEW_REQUIRED, respeita cooldown e nunca troca estrategia", () => {
    let now = 1_789_600_000_000;
    const supervisor = new PerformanceSupervisor({ now: () => now, log: () => {} }) as any;
    const stats = { trades: 40, wins: 12, losses: 28, draws: 0, pnl: -12, goodDecisions: 12, badDecisions: 28, consecutiveLosses: 8, goodDecisionLosses: 4, badDecisionWins: 1 };
    const first = supervisor.evaluate({ agentId: "trader:EURUSD-OTC", marketKey: "EURUSD:OTC", stats, review: null });
    expect(first.status).toBe("REVIEW_REQUIRED");
    expect(first.reasons).toEqual(expect.arrayContaining(["DRAWDOWN_EXCEDIDO", "SEQUENCIA_DE_PERDAS", "QUALIDADE_DECISORIA_BAIXA"]));
    const second = supervisor.evaluate({ agentId: "trader:EURUSD-OTC", marketKey: "EURUSD:OTC", stats, review: null });
    expect(second.status).toBe("REVIEW_PENDING_COOLDOWN");
    now += 31 * 60_000;
    expect(supervisor.evaluate({ agentId: "trader:EURUSD-OTC", marketKey: "EURUSD:OTC", stats, review: null }).status).toBe("REVIEW_REQUIRED");
    expect(supervisor.status().note).toContain("NAO troca metodologia");
    expect((supervisor.config as any).mode).toBeUndefined();
    const healthy = new PerformanceSupervisor({ now: () => now, log: () => {} }) as any;
    expect(healthy.evaluate({ agentId: "trader:EURUSD-OTC", marketKey: "EURUSD:OTC", stats: { trades: 40, wins: 25, losses: 15, draws: 0, pnl: 6, goodDecisions: 30, badDecisions: 10, consecutiveLosses: 1, goodDecisionLosses: 2, badDecisionWins: 0 }, review: null }).status).toBe("OK");
  });
});

describe("KNOWLEDGE BASE — point-in-time, escopo e provenance", () => {
  it("indice e busca so retornam notas disponiveis no instante da decisao (sem look-ahead)", async () => {
    const retriever = new TradingKnowledgeRetriever({ rootDir: path.join(process.cwd(), "relay", "knowledge"), now: () => 1_789_600_000_000 }) as any;
    const built = await retriever.rebuild();
    expect(built.notes).toBeGreaterThanOrEqual(30);
    const before = retriever.search({ query: "rsi", atMs: 1_000, limit: 5 });
    expect(before.results).toHaveLength(0);
    const nowSearch = retriever.search({ regime: "TREND_UP", setup: "TREND_PULLBACK", marketKey: "EURUSD", atMs: 1_789_600_001_000, limit: 5 });
    expect(nowSearch.scope).toBe("TRACECOM");
    expect(nowSearch.results.length).toBeGreaterThan(0);
    expect(nowSearch.results[0].provenance).toBeTruthy();
    const status = retriever.status();
    expect(status.scope).toBe("TraceCom/");
    expect(Object.keys(status.categories).length).toBeGreaterThanOrEqual(8);
  });
});
