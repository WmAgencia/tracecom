/**
 * AUDITORIA FORENSE — 5 operações PRACTICE (2026-09-18).
 *
 * Estes testes são COUNTEREXAMPLES da auditoria: eles provam (ou refutam) os mapeamentos da cadeia
 * marketKey → activeId → direção → expiry → settlement → journal, e CARACTERIZAM defeitos de
 * instrumentação documentados em docs/research/5-trade-forensic-audit.md (D1/D2/D3/D4).
 *
 * Eles NÃO alteram produção e NÃO reavaliam resultado como qualidade. Evidência congelada:
 * docs/research/data/forensic-5-trades.json (dump read-only) e ...-computed.json (fatos computados).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const quality = await import("../../relay/trade-quality.mjs");
const { featuresFromSnapshot, scoreTradeQuality, evaluateShadowArms } = quality as unknown as Record<string, any>;

type AnyRecord = Record<string, any>;
const evidence: AnyRecord = JSON.parse(readFileSync("docs/research/data/forensic-5-trades.json", "utf8"));
const computed: AnyRecord = JSON.parse(readFileSync("docs/research/data/forensic-5-trades-computed.json", "utf8"));

const EXPECTED_ACTIVE_IDS: Record<string, number> = { "EURUSD:OTC": 76, "AUDCHF:OTC": 2129, "CADCHF:OTC": 2119, "EURAUD:OTC": 2120, "GBPNZD:OTC": 2132 };
const expectedResult = (direction: string, entry: number, settlement: number): string => {
  if (settlement === entry) return "DRAW";
  if (direction === "CALL") return settlement > entry ? "WIN" : "LOSS";
  return settlement < entry ? "WIN" : "LOSS";
};

describe("seleção — exatamente as 5 operações liquidadas de 2026-09-18", () => {
  it("journal e executions fecham 5/5 em 2026-09-18 e nenhum mismatch", () => {
    expect(evidence.selection.journalByDay.find((row: AnyRecord) => row.d === "2026-09-18")?.n).toBe(5);
    expect(evidence.selection.executionsSep18).toHaveLength(5);
    expect(evidence.selection.executionsSep18.every((row: AnyRecord) => row.state === "SETTLED")).toBe(true);
    expect(computed.selection.mismatchesSep18).toBe(0);
    expect(evidence.trades).toHaveLength(5);
    expect(evidence.trades.map((trade: AnyRecord) => trade.tradeId).sort()).toEqual(evidence.selection.executionsSep18.map((row: AnyRecord) => row.execution_id).sort());
  });

  it("nada sem settlement entrou (22 exclusões, todas anteriores a 2026-09-18)", () => {
    expect(evidence.selection.nonSettled).toHaveLength(22);
    expect(evidence.selection.nonSettled.every((row: AnyRecord) => String(row.requested_at) < "2026-09-18")).toBe(true);
    expect(evidence.selection.nonSettledByState?.ACKNOWLEDGED ?? 6).toBe(6);
  });
});

describe("mapeamento marketKey → activeId → symbol (counterexample)", () => {
  it("activeId de cada execução bate com iq_markets", () => {
    for (const trade of evidence.trades) {
      const market = evidence.markets.find((row: AnyRecord) => row.market_key === trade.marketKey);
      expect(market, trade.marketKey).toBeTruthy();
      expect(trade.execution.active_id).toBe(EXPECTED_ACTIVE_IDS[trade.marketKey]);
      expect(trade.execution.active_id).toBe(market.active_id);
      expect(trade.execution.symbol).toBe(market.display);
      expect(trade.execution.market_key).toBe(trade.journal.market_key);
    }
  });
});

describe("direção e settlement sem inversão (counterexample)", () => {
  it("BUY→CALL / SELL→PUT e resultado broker coerente com causal em 5/5", () => {
    for (const trade of computed.trades) {
      const execution = trade.execution;
      if (trade.autonomous) expect(trade.actionMapsToDirection).toBe(true);
      const causal = execution.causal;
      expect(causal).toBeTruthy();
      expect(expectedResult(causal.direction, causal.entry, causal.settlement)).toBe(trade.causalResult);
      expect(trade.causalResult).toBe(trade.brokerResult);
      expect(trade.settlementMismatch).toBe(false);
    }
  });

  it("expiry JIT idêntico ao expiry do broker (0 ms) e ordem↔settlement rastreáveis", () => {
    for (const trade of evidence.trades.filter((row: AnyRecord) => row.execution.meta?.entryTiming)) {
      const computedTrade = computed.trades.find((row: AnyRecord) => row.tradeId === trade.tradeId)!;
      expect(computedTrade.execution.targetExpiryVsBrokerExpiryMs).toBe(0);
      expect(trade.execution.broker_order_id).toBeTruthy();
      const settlement = trade.audit.find((row: AnyRecord) => row.stage === "SETTLEMENT");
      expect(settlement.detail.brokerOrderId).toBe(trade.execution.broker_order_id);
    }
  });
});

describe("trade manual ui:smoke — caracterização (D3)", () => {
  it("não é decisão G2: ordem forçada contra WAIT e journal grava direção da ordem", () => {
    const manual = computed.trades.find((row: AnyRecord) => row.source === "ui:smoke")!;
    expect(manual).toBeTruthy();
    expect(manual.autonomous).toBe(false);
    expect(manual.candidateId).toBeNull();
    expect(manual.consensus.status).toBe("NO_CONSENSUS");
    expect(manual.consensus.traderAction).toBe("WAIT");
    // defeito de observabilidade: o snapshot herda a direção da ORDEM (BUY), divergindo do consenso (WAIT)
    expect(manual.action).toBe("BUY");
    expect(manual.consensus.traderAction).not.toBe(manual.action);
  });
});

describe("Quality Gate — score registrado e defeito D1 (3 checks nunca pontuam)", () => {
  it("WIN AUDCHF: score de produção 95 é reproduzido pela rubrica a partir do snapshot do journal", () => {
    const win = computed.trades.find((trade: AnyRecord) => trade.marketKey === "AUDCHF:OTC")!;
    expect(win.trailingQualityGate.recorded.score).toBe(95);
    expect(win.trailingQualityGate.recomputedFromJournalSnapshot.score).toBe(95);
  });

  it("accel_agrees/velocity_agrees/knowledge_used falham em 100% dos snapshots reais (FACT documentado, NÃO corrigido)", () => {
    const evidenceTrades = evidence.trades.filter((trade: AnyRecord) => trade.execution.meta?.source === "AUTO_DECISION");
    expect(evidenceTrades).toHaveLength(4);
    for (const trade of evidenceTrades) {
      const snapshot = trade.journal.payload.snapshot;
      const direction = snapshot.action === "BUY" ? "BUY" : "SELL";
      const features = featuresFromSnapshot(snapshot, { direction, payout: trade.journal.payout, timing: {} });
      const result = scoreTradeQuality(features);
      const byId = Object.fromEntries(result.checks.map((check: AnyRecord) => [check.id, check.ok]));
      expect(byId.accel_agrees, `${trade.tradeId} accel`).toBe(false);
      expect(byId.velocity_agrees, `${trade.tradeId} velocity`).toBe(false);
      expect(byId.knowledge_used, `${trade.tradeId} knowledge`).toBe(false);
    }
  });

  it("tetos efetivos: nenhum candidato do período passou de 95 (Distribuição SHADOW_ARMS)", () => {
    expect(computed.qualityDistribution.max).toBe(95);
    expect(computed.qualityDistribution.n).toBeGreaterThan(1_000);
    expect(computed.qualityDistribution.atOrAboveThreshold + computed.qualityDistribution.belowThreshold).toBe(computed.qualityDistribution.n);
  });

  it("localização é avaliada independentemente do score (candidato com score 81 rejeitado por OVEREXTENDED_FROM_CHANNEL)", () => {
    const rejected = computed.revalidationStudy.gateRejectedCandidates;
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.some((row: AnyRecord) => row.score >= 75 && row.reasons.includes("OVEREXTENDED_FROM_CHANNEL"))).toBe(true);
  });
});

describe("braço shadow C_STABILITY — defeito D2 (caracterização)", () => {
  it("abstém em >90% dos candidatos e F_COMBINED quase nunca aceita", () => {
    const c = computed.arms.C_STABILITY;
    expect(c.abstain / (c.abstain + c.accept)).toBeGreaterThan(0.9);
    expect(computed.arms.F_COMBINED.accept).toBeLessThanOrEqual(2);
    expect(computed.arms.A_G2_JIT.abstain).toBe(0);
  });

  it("direção nunca mudou entre candidato e final nos 4 autônomos (directionChanges>=2 é impossível)", () => {
    for (const trade of computed.trades.filter((row: AnyRecord) => row.autonomous)) {
      expect(trade.jit.directionChanged).toBe(false);
      expect(trade.jit.changedFields.filter((change: AnyRecord) => change.field === "action")).toHaveLength(0);
    }
  });
});

describe("Critic — discriminativo na janela (Task 8)", () => {
  it("vetou/contestou candidatos rejeitados (VETO>=20 e CONTEST>=40 nas 140 revalidações falhas)", () => {
    let veto = 0, contest = 0, confirm = 0;
    for (const trade of evidence.trades) {
      for (const row of trade.funnel) {
        if (row.stage !== "FINAL_REVALIDATION" || row.detail?.ok === true) continue;
        const check = (row.detail.checks ?? []).find((item: AnyRecord) => item.rule === "E_CRITIC_NOT_VETO");
        if (!check) continue;
        if (check.detail === "VETO") veto += 1;
        else if (check.detail === "CONTEST") contest += 1;
        else if (check.detail === "CONFIRM") confirm += 1;
      }
    }
    expect(veto).toBeGreaterThanOrEqual(20);
    expect(contest).toBeGreaterThanOrEqual(40);
    expect(veto + contest + confirm).toBe(140);
  });
});

describe("D4 — snapshot T0 do gate não é persistido (caracterização)", () => {
  it("journal de todas as 5 grava initialSnapshot=null (não reproduz o score de produção byte a byte)", () => {
    for (const trade of evidence.trades) expect(trade.journal.payload.initialSnapshot).toBeNull();
    const recorded = computed.trades.filter((trade: AnyRecord) => trade.autonomous).map((trade: AnyRecord) => trade.trailingQualityGate.recorded?.score ?? null);
    expect(recorded.filter((score: number | null) => score !== null)).toHaveLength(4);
  });
});
