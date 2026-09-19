/**
 * LATE WINDOW TIMING (Fase 4/5) — LATE_WINDOW_V2 em SHADOW.
 *
 * Cobre: semantica real da IQ (turbo 1m: E-90s .. E-30s exclusivo), margem adaptativa por latencia,
 * ciclo de vida do shadow, transicoes de validade (WAIT/direcao/gate/critic), anti-leakage,
 * isolamento NORMAL x OTC, reinicio, persistencia serializada e fia\u00e7\u00e3o no runtime com relogio
 * deterministico (a politica NOVA nunca envia ordem).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const timing = await import("../../relay/late-window-timing.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const ws = await import("../../relay/iqoption-ws.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");
const {
  LATE_WINDOW_VERSION, TIMING_POLICY_CURRENT, TIMING_POLICY_LATE, LATE_WINDOW_POLICY,
  TURBO_1M_CUTOFF_MS, MIN_LATE_MARGIN_MS, MAX_LATE_MARGIN_MS,
  sameExpirationWindow, sameExpirationAt, lateDeadlineAt, adaptiveLateMarginMs, percentileMs,
  evaluateLateCandidate, findFutureReferences, LateWindowTimingShadow,
} = timing as unknown as Record<string, any>;
const { computeExpiration } = ws as unknown as Record<string, any>;
const { IqMultiRuntime } = runtimeModule as unknown as Record<string, any>;

const E = Date.UTC(2026, 8, 18, 22, 35, 0); // 22:35:00Z, fronteira de minuto
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("1. semantica IQ: janela da MESMA expiracao (turbo 1m)", () => {
  it("janela [E-90s, E-30s) com corte exclusivo", () => {
    const window = sameExpirationWindow({ targetExpiryAt: E });
    expect(window.supported).toBe(true);
    expect(window.opensAt).toBe(E - 90_000);
    expect(window.cutoffExclusiveAt).toBe(E - 30_000);
    expect(window.widthMs).toBe(60_000);
    expect(TURBO_1M_CUTOFF_MS).toBe(30_000);
  });

  it("limites exatos: E-90s inclusivo, E-90s-1ms fora, E-30s-1ms dentro, E-30s fora", () => {
    expect(sameExpirationAt({ targetExpiryAt: E, atMs: E - 90_000 })).toBe(true);
    expect(sameExpirationAt({ targetExpiryAt: E, atMs: E - 90_001 })).toBe(false);
    expect(sameExpirationAt({ targetExpiryAt: E, atMs: E - 30_001 })).toBe(true);
    expect(sameExpirationAt({ targetExpiryAt: E, atMs: E - 30_000 })).toBe(false);
  });

  it("concorda com computeExpiration REAL do relay (mesma expiracao dentro da janela)", () => {
    for (const offset of [89_999, 60_000, 30_001, 30_000, 29_999, 90_000, 90_001]) {
      const at = E - offset;
      const actual = computeExpiration(Math.floor(at / 1000), 1).expiration * 1000;
      expect({ offset, actual, expected: sameExpirationAt({ targetExpiryAt: E, atMs: at }) }).toEqual({ offset, actual, expected: actual === E });
    }
    expect(computeExpiration(Math.floor((E - 30_001) / 1000), 1).expiration * 1000).toBe(E);
    expect(computeExpiration(Math.floor((E - 29_999) / 1000), 1).expiration * 1000).toBe(E + 60_000);
    expect(computeExpiration(Math.floor((E - 30_000) / 1000), 1).expiration * 1000).toBe(E + 60_000);
  });

  it("produto fora de escopo (binary/digital) nao tem janela LATE", () => {
    expect(sameExpirationWindow({ targetExpiryAt: E, productKind: "binary" }).supported).toBe(false);
    expect(sameExpirationAt({ targetExpiryAt: E, atMs: E - 60_000, productKind: "binary" })).toBe(false);
  });

  it("deadline = cutoff - margem, sempre antes do corte exclusivo", () => {
    const deadline = lateDeadlineAt({ targetExpiryAt: E, marginMs: 3_805 });
    expect(deadline).toBe(E - 30_000 - 3_805);
    expect(sameExpirationAt({ targetExpiryAt: E, atMs: deadline })).toBe(true);
    expect(deadline).toBeLessThan(E - 30_000);
  });
});

describe("2. margem operacional adaptativa (derivada de latencia real)", () => {
  it("sem amostras usa fallbacks e respeita limites", () => {
    const margin = adaptiveLateMarginMs({});
    expect(margin.marginMs).toBeGreaterThanOrEqual(MIN_LATE_MARGIN_MS);
    expect(margin.marginMs).toBeLessThanOrEqual(MAX_LATE_MARGIN_MS);
    expect(margin.components.sources).toEqual({ ack: "FALLBACK", persist: "FALLBACK", decision: "FALLBACK" });
  });

  it("latencia rapida -> margem menor; lenta/instavel -> margem maior (clamp)", () => {
    const fast = adaptiveLateMarginMs({ ackSamples: [300, 320, 350, 400], persistSamples: [400, 450], decisionSamples: [2, 4] });
    const slow = adaptiveLateMarginMs({ ackSamples: [2_500, 2_600, 2_700], persistSamples: [1_800, 1_900], decisionSamples: [10, 12] });
    expect(fast.marginMs).toBeLessThan(slow.marginMs);
    expect(slow.marginMs).toBe(MAX_LATE_MARGIN_MS);
    expect(fast.marginMs).toBeGreaterThanOrEqual(MIN_LATE_MARGIN_MS);
  });

  it("percentileMs ignora amostras invalidas", () => {
    expect(percentileMs([100, 200, null, -5, "x"], 0.5)).toBe(100);
    expect(percentileMs([], 0.95)).toBeNull();
  });
});

describe("3. veredito LATE com as MESMAS regras (nunca reimplementa pesos)", () => {
  const candidate = { action: "SELL", regime: "TREND_DOWN", setup: "TREND_PULLBACK" };
  const ok = { action: "SELL", regime: "TREND_DOWN", setup: "TREND_PULLBACK", trigger: "pullback_com_estrutura_mantida", criticVerdict: "CONFIRM", consensusStatus: "CONFIRMED" };
  const gateOk = { enabled: true, score: 83, threshold: 75, locationOk: true, microVeto: false };

  it("valida quando revalidacao + gate passam", () => {
    const verdict = evaluateLateCandidate({ candidate, final: ok, freshness: { fresh: true }, gate: gateOk });
    expect(verdict.valid).toBe(true);
    expect(verdict.gate.accepted).toBe(true);
  });

  it("WAIT cancela com motivo e NUNCA inverte direcao", () => {
    expect(evaluateLateCandidate({ candidate, final: { ...ok, action: "WAIT" }, freshness: { fresh: true }, gate: gateOk }).reason).toBe("CANDIDATE_LOGIC_CHANGED_TO_WAIT");
    expect(evaluateLateCandidate({ candidate, final: { ...ok, action: "BUY" }, freshness: { fresh: true }, gate: gateOk }).reason).toBe("CANDIDATE_LOGIC_CHANGED_DIRECTION");
    expect(evaluateLateCandidate({ candidate, final: { ...ok, action: "BUY" }, freshness: { fresh: true }, gate: gateOk }).valid).toBe(false);
  });

  it("critic/consensus/setup/trigger/regime/stale cancelam", () => {
    expect(evaluateLateCandidate({ candidate, final: { ...ok, criticVerdict: "VETO" }, freshness: { fresh: true }, gate: gateOk }).reason).toBe("CANDIDATE_CRITIC_VETO");
    expect(evaluateLateCandidate({ candidate, final: { ...ok, consensusStatus: "NO_CONSENSUS" }, freshness: { fresh: true }, gate: gateOk }).reason).toBe("CANDIDATE_CONSENSUS_LOST");
    expect(evaluateLateCandidate({ candidate, final: { ...ok, setup: "NO_VALID_SETUP" }, freshness: { fresh: true }, gate: gateOk }).reason).toBe("CANDIDATE_SETUP_INVALIDATED");
    expect(evaluateLateCandidate({ candidate, final: { ...ok, trigger: null }, freshness: { fresh: true }, gate: gateOk }).reason).toBe("CANDIDATE_TRIGGER_GONE");
    expect(evaluateLateCandidate({ candidate, final: { ...ok, regime: "TRANSITION" }, freshness: { fresh: true }, gate: gateOk }).reason).toBe("CANDIDATE_REGIME_CHANGED");
    expect(evaluateLateCandidate({ candidate, final: ok, freshness: { fresh: false, reason: "STALE" }, gate: gateOk }).reason).toBe("CANDIDATE_DATA_STALE");
  });

  it("Quality Gate (localizacao/micro/score) bloqueia sem mudar a direcao", () => {
    expect(evaluateLateCandidate({ candidate, final: ok, freshness: { fresh: true }, gate: { ...gateOk, locationOk: false } }).reason).toBe("VALID_SETUP_BUT_BAD_ENTRY_PRICE");
    expect(evaluateLateCandidate({ candidate, final: ok, freshness: { fresh: true }, gate: { ...gateOk, microVeto: true } }).reason).toBe("MICROSTRUCTURE_VETO");
    expect(evaluateLateCandidate({ candidate, final: ok, freshness: { fresh: true }, gate: { ...gateOk, score: 60 } }).reason).toBe("QUALITY_SCORE_BELOW_THRESHOLD");
    expect(evaluateLateCandidate({ candidate, final: ok, freshness: { fresh: true }, gate: { enabled: false, score: 10 } }).valid).toBe(true);
  });

  it("politica explicita: SHADOW_ONLY e sem controle", () => {
    expect(LATE_WINDOW_POLICY.execution).toBe("SHADOW_ONLY");
    expect(LATE_WINDOW_POLICY.controlsExecution).toBe(false);
    expect(LATE_WINDOW_POLICY.controlsDirection).toBe(false);
    expect(LATE_WINDOW_POLICY.controlsStake).toBe(false);
    expect(LATE_WINDOW_VERSION).toBe("late-window-timing-v1");
    expect(TIMING_POLICY_LATE).toBe("LATE_WINDOW_V2");
    expect(TIMING_POLICY_CURRENT).toBe("CURRENT_V1");
  });
});

describe("4. ciclo de vida do shadow e comparacao CURRENT x LATE", () => {
  function makeShadow(nowMs = E - 60_000) {
    const clock = { nowMs };
    return { clock, shadow: new LateWindowTimingShadow({ now: () => clock.nowMs }) as any };
  }
  const beginArgs = (over = {}) => ({
    marketKey: "EURUSD:OTC", marketType: "OTC", activeId: 76, agentId: "trader:EURUSD:OTC",
    candidateId: "cand_late_1", correlationId: "corr_late_1", direction: "SELL",
    candidateSnapshot: { action: "SELL", at: E - 61_000, price: 1.1434, regime: "TREND_DOWN", setup: "TREND_PULLBACK", trigger: "pullback", critic: { verdict: "CONFIRM" }, consensus: { status: "CONFIRMED" }, freshness: { fresh: true, tickAgeMs: 10 } },
    targetEntryAt: E - 60_000, targetExpiryAt: E, currentSubmitAt: E - 61_347, currentLeadMs: 1_347, productKind: "turbo", payout: 82,
    serverNowMs: E - 61_000, latency: { ackSamples: [900, 1_000], persistSamples: [900], decisionSamples: [3] }, atMs: E - 61_000, ...over,
  });
  const finalOk = { action: "SELL", regime: "TREND_DOWN", setup: "TREND_PULLBACK", trigger: "pullback", criticVerdict: "CONFIRM", consensusStatus: "CONFIRMED" };
  const observeArgs = (atMs: number, over = {}) => ({
    marketKey: "EURUSD:OTC", candidateId: "cand_late_1", atMs, serverNowMs: atMs, final: finalOk, freshness: { fresh: true },
    latestSnapshot: { action: "SELL", price: 1.1433 }, score: 83, threshold: 75, locationOk: true, microVeto: false, gateEnabled: true,
    price: 1.1433, candles: [{ bucketStart: E - 60_000, close: 1.1434 }, { bucketStart: E - 55_000, close: 1.1433 }], payout: 82, ...over,
  });

  it("begin congela T0, calcula deadline e margem adaptativa", () => {
    const { shadow } = makeShadow();
    const observation = shadow.begin(beginArgs());
    expect(observation.id).toBe("timing_cand_late_1");
    expect(observation.policyVersion).toBe(TIMING_POLICY_LATE);
    expect(observation.currentPolicyVersion).toBe(TIMING_POLICY_CURRENT);
    expect(observation.late.deadlineAt).toBe(E - 30_000 - observation.policy.margin.marginMs);
    expect(observation.policy.sameExpirationAtDeadline).toBe(true);
    expect(Object.isFrozen(observation.t0)).toBe(true);
    expect(observation.t0.candidateAt).toBe(E - 61_000);
  });

  it("mantem observando apos o CURRENT entrar/encerrar; veredito e a ultima avaliacao antes do deadline", () => {
    const { shadow } = makeShadow();
    const observation = shadow.begin(beginArgs());
    shadow.markCurrentSend({ candidateId: "cand_late_1", executionId: "exec_1", disposition: "EXECUTED", atMs: E - 59_000 });
    shadow.markCurrentAck({ candidateId: "cand_late_1", atMs: E - 58_500, brokerOrderId: "ORD1", brokerExpirationSec: E / 1000, entryPrice: 1.1434 });
    shadow.observe(observeArgs(E - 40_000, { final: { ...finalOk, action: "WAIT" }, score: 50 }));
    shadow.observe(observeArgs(E - 33_000, {}));
    const deadline = observation.late.deadlineAt;
    shadow.observe(observeArgs(deadline + 500, { final: { ...finalOk, action: "WAIT" }, score: 10 }));
    expect(observation.outcome).toBe("LATE_ACCEPT");
    expect(observation.late.verdict).toBe("ACCEPT");
    expect(observation.late.evaluations.filter((row: any) => row.afterDeadline).length).toBe(1);
    expect(observation.comparison.keptSameExpiration).toBe(true);
    expect(observation.comparison.additionalObservedMsVsCurrentSubmit).toBe(deadline - (E - 61_347));
    expect(observation.comparison.additionalCandles5s).toBeGreaterThanOrEqual(1);
    expect(observation.comparison.additionalTickPrices).toBeGreaterThanOrEqual(1);
    expect(observation.comparison.becameInvalid).toBe(true);
    expect(observation.comparison.recovered).toBe(true);
    expect(observation.comparison.controlPolicy).toBe("SHADOW_ONLY_NEVER_CONTROLS_EXECUTION");
    expect(observation.current.brokerExpirationSec).toBe(E / 1000);
    expect(observation.current.expirationMismatch).toBe(false);
  });

  it("vira WAIT perto do deadline -> LATE_CANCEL com motivo (nao vira PUT)", () => {
    const { shadow } = makeShadow();
    const observation = shadow.begin(beginArgs({ candidateId: "cand_late_2" }));
    shadow.observe(observeArgs(E - 40_000, { candidateId: "cand_late_2" }));
    shadow.observe(observeArgs(E - 33_000, { candidateId: "cand_late_2", final: { ...finalOk, action: "WAIT" } }));
    shadow.finalize({ marketKey: "EURUSD:OTC", atMs: E - 30_000, reason: "TEST_DEADLINE" });
    expect(observation.outcome).toBe("LATE_CANCEL");
    expect(observation.outcomeReason).toBe("CANDIDATE_LOGIC_CHANGED_TO_WAIT");
    expect(observation.late.verdict).toBe("CANCEL_CANDIDATE_LOGIC_CHANGED_TO_WAIT");
    expect(observation.comparison.directionFlipped).toBe(false);
    expect(observation.comparison.actionChangedToWait).toBe(true);
  });

  it("gate piora perto do deadline -> cancelamento registrado", () => {
    const { shadow } = makeShadow();
    const observation = shadow.begin(beginArgs({ candidateId: "cand_late_3" }));
    shadow.observe(observeArgs(E - 40_000, { candidateId: "cand_late_3" }));
    shadow.observe(observeArgs(E - 33_000, { candidateId: "cand_late_3", locationOk: false }));
    shadow.finalize({ marketKey: "EURUSD:OTC", atMs: E - 30_000, reason: "TEST_DEADLINE" });
    expect(observation.outcome).toBe("LATE_CANCEL");
    expect(observation.outcomeReason).toBe("VALID_SETUP_BUT_BAD_ENTRY_PRICE");
  });

  it("deadline de uma janela NAO finaliza a janela seguinte do mesmo mercado", () => {
    const { shadow } = makeShadow();
    const first = shadow.begin(beginArgs({ candidateId: "cand_dl_1" }));
    const second = shadow.begin(beginArgs({ candidateId: "cand_dl_2", targetEntryAt: E, targetExpiryAt: E + 60_000, currentSubmitAt: E - 1_347, atMs: E - 60_000, serverNowMs: E - 60_000 }));
    shadow.observe(observeArgs(E - 40_000, { candidateId: "cand_dl_1" }));
    shadow.observe(observeArgs(E - 33_000, { candidateId: "cand_dl_1" }));
    shadow.observe(observeArgs(E - 32_000, { candidateId: "cand_dl_1" })); // passou o deadline da 1a janela
    expect(first.outcome).toBe("LATE_ACCEPT");
    expect(second.outcome).toBe("OBSERVING");
    expect(second.late.lastEvaluationAt).toBeNull();
    expect(shadow.activeObservationsForMarket("EURUSD:OTC").map((row: any) => row.candidateId)).toEqual(["cand_dl_2"]);
  });

  it("liquidacao causal do braco LATE (nunca broker)", () => {
    const { shadow, clock } = makeShadow();
    const observation = shadow.begin(beginArgs({ candidateId: "cand_late_4" }));
    shadow.observe(observeArgs(E - 40_000, { candidateId: "cand_late_4" }));
    shadow.observe(observeArgs(E - 33_000, { candidateId: "cand_late_4" }));
    shadow.finalize({ marketKey: "EURUSD:OTC", atMs: E - 30_000, reason: "TEST_DEADLINE" });
    expect(observation.outcome).toBe("LATE_ACCEPT");
    clock.nowMs = E + 5_000;
    const settled = shadow.settleCausal({ marketKey: "EURUSD:OTC", candles: [{ bucketStart: E - 5_000, close: 1.1430 }, { bucketStart: E, close: 1.1420 }], index: 1, nowMs: clock.nowMs });
    expect(settled).toBe(1);
    expect(observation.late.result).toBe("WIN"); // SELL e fechou abaixo da entrada
    expect(observation.late.settlementBasis).toBe("CAUSAL_COUNTERFACTUAL");
    expect(observation.late.normalizedPnl).toBeCloseTo(0.82, 4);
  });
});

describe("5. anti-leakage e isolamento", () => {
  it("T0 nao muda com observacoes posteriores; avaliacoes pos-deadline nao decidem", () => {
    const shadow = new LateWindowTimingShadow({ now: () => E - 60_000 }) as any;
    const observation = shadow.begin({
      marketKey: "EURUSD:OTC", marketType: "OTC", candidateId: "cand_leak", direction: "SELL",
      candidateSnapshot: { action: "SELL", at: E - 61_000, price: 1.14, regime: "TREND_DOWN", setup: "TREND_PULLBACK" },
      targetEntryAt: E - 60_000, targetExpiryAt: E, currentSubmitAt: E - 61_000, productKind: "turbo", payout: 82, serverNowMs: E - 61_000, atMs: E - 61_000,
    });
    const t0Before = JSON.stringify(observation.t0);
    shadow.observe({ marketKey: "EURUSD:OTC", candidateId: "cand_leak", serverNowMs: E - 40_000, final: { action: "SELL", regime: "TREND_DOWN", setup: "TREND_PULLBACK", trigger: "x", criticVerdict: "CONFIRM", consensusStatus: "CONFIRMED" }, freshness: { fresh: true }, latestSnapshot: { price: 1.14 }, score: 95, threshold: 75, locationOk: true, microVeto: false, gateEnabled: true, price: 1.14 });
    shadow.observe({ marketKey: "EURUSD:OTC", candidateId: "cand_leak", serverNowMs: E - 31_000, final: { action: "SELL", regime: "TREND_DOWN", setup: "TREND_PULLBACK", trigger: "x", criticVerdict: "CONFIRM", consensusStatus: "CONFIRMED" }, freshness: { fresh: true }, latestSnapshot: { price: 9.999 }, score: 95, threshold: 75, locationOk: true, microVeto: false, gateEnabled: true, price: 9.999 });
    expect(JSON.stringify(observation.t0)).toBe(t0Before);
    expect(findFutureReferences(observation.t0, E - 61_000)).toHaveLength(0);
    expect(findFutureReferences({ decisionAt: E, futureCandles: [{ bucketStart: E + 5_000 }] }, E)).toContain("t0.futureCandles");
    const verdictBefore = observation.late.verdict;
    shadow.observe({ marketKey: "EURUSD:OTC", candidateId: "cand_leak", serverNowMs: E + 1_000, final: { action: "WAIT" }, freshness: { fresh: true }, score: 10, threshold: 75, locationOk: false, gateEnabled: true, price: 1 });
    expect(observation.outcome).toBe("LATE_ACCEPT");
    expect(observation.late.verdict).toBe(verdictBefore);
  });

  it("janelas consecutivas coexistem; so a MESMA expiracao e supersedida por candidato novo", () => {
    const shadow = new LateWindowTimingShadow({ now: () => E - 61_000 }) as any;
    const base = { marketKey: "EURUSD:OTC", marketType: "OTC", direction: "BUY", candidateSnapshot: { at: E - 61_000, price: 1.1 }, productKind: "turbo", payout: 82, serverNowMs: E - 61_000, atMs: E - 61_000 };
    const first = shadow.begin({ ...base, candidateId: "cand_w1", targetEntryAt: E - 60_000, targetExpiryAt: E, currentSubmitAt: E - 61_347 });
    const second = shadow.begin({ ...base, candidateId: "cand_w2", targetEntryAt: E, targetExpiryAt: E + 60_000, currentSubmitAt: E - 1_347, atMs: E - 60_000 });
    expect(first.outcome).toBe("OBSERVING");
    expect(second.outcome).toBe("OBSERVING");
    expect(shadow.activeObservationsForMarket("EURUSD:OTC")).toHaveLength(2);
    const replacement = shadow.begin({ ...base, candidateId: "cand_w1b", targetEntryAt: E - 60_000, targetExpiryAt: E, currentSubmitAt: E - 60_000, atMs: E - 55_000 });
    expect(first.outcome).toBe("SUPERSEDED_BY_NEW_CANDIDATE");
    expect(first.outcomeReason).toBe("NO_EVALUATION_BEFORE_DEADLINE");
    expect(second.outcome).toBe("OBSERVING");
    expect(shadow.getByWindow(`EURUSD:OTC:${E}`)?.candidateId).toBe("cand_w1b");
    expect(replacement.outcome).toBe("OBSERVING");
  });

  it("isolamento NORMAL x OTC: mercados nao se contaminam", () => {
    const shadow = new LateWindowTimingShadow({ now: () => E - 60_000 }) as any;
    const base = { direction: "BUY", candidateSnapshot: { at: E - 61_000, price: 1.1 }, targetEntryAt: E - 60_000, targetExpiryAt: E, productKind: "turbo", payout: 82, serverNowMs: E - 61_000, atMs: E - 61_000 };
    const otc = shadow.begin({ ...base, marketKey: "EURUSD:OTC", marketType: "OTC", candidateId: "c_otc" });
    const normal = shadow.begin({ ...base, marketKey: "EURUSD:NORMAL", marketType: "NORMAL", candidateId: "c_normal" });
    expect(otc.id).not.toBe(normal.id);
    expect(shadow.activeForMarket("EURUSD:OTC")?.candidateId).toBe("c_otc");
    expect(shadow.activeForMarket("EURUSD:NORMAL")?.candidateId).toBe("c_normal");
    shadow.finalize({ marketKey: "EURUSD:OTC", atMs: E, reason: "TEST" });
    expect(normal.outcome).toBe("OBSERVING");
    expect(shadow.activeForMarket("EURUSD:NORMAL")?.candidateId).toBe("c_normal");
  });

  it("reinicio: toJSON/loadFrom preserva a associacao por candidateId", () => {
    const first = new LateWindowTimingShadow({ now: () => E - 60_000 }) as any;
    first.begin({ marketKey: "EURUSD:OTC", marketType: "OTC", candidateId: "cand_restart", direction: "BUY", candidateSnapshot: { at: E - 61_000, price: 1.1 }, targetEntryAt: E - 60_000, targetExpiryAt: E, productKind: "turbo", payout: 82, serverNowMs: E - 61_000, atMs: E - 61_000 });
    const snapshot = first.toJSON();
    const second = new LateWindowTimingShadow({ now: () => E - 30_000 }) as any;
    expect(second.loadFrom(snapshot)).toBe(true);
    expect(second.getByCandidate("cand_restart")?.id).toBe("timing_cand_restart");
    expect(second.markCurrentAck({ candidateId: "cand_restart", atMs: E - 58_000, brokerOrderId: "ORD9", brokerExpirationSec: E / 1000, entryPrice: 1.1 })).toBe("timing_cand_restart");
  });

  it("persistencia: INSERT antes de UPDATE e placeholders 1:1", async () => {
    const events: string[] = [];
    let insertResolved = false;
    const pool = {
      query: async (sql: string, params: any[] = []) => {
        const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
        if (placeholders.length) {
          expect(Math.max(...placeholders)).toBe(params.length);
          expect(new Set(placeholders).size).toBe(params.length);
        }
        if (sql.includes("INSERT INTO iq_timing_policy_observations")) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          insertResolved = true; events.push("insert:resolved");
        } else if (sql.includes("UPDATE iq_timing_policy_observations")) {
          events.push(`update:insertResolved=${insertResolved}`);
        }
        return { rows: [] };
      },
    };
    const shadow = new LateWindowTimingShadow({ pool, now: () => E - 60_000 }) as any;
    shadow.begin({ marketKey: "EURUSD:OTC", marketType: "OTC", candidateId: "cand_sql", direction: "SELL", candidateSnapshot: { at: E - 61_000, price: 1.14 }, targetEntryAt: E - 60_000, targetExpiryAt: E, currentSubmitAt: E - 61_000, productKind: "turbo", payout: 82, serverNowMs: E - 61_000, atMs: E - 61_000, latency: { ackSamples: [800] } });
    shadow.markCurrentSend({ candidateId: "cand_sql", executionId: "exec_sql", disposition: "EXECUTED", atMs: E - 59_000 });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(events).toContain("insert:resolved");
    expect(events).toContain("update:insertResolved=true");
    expect(events.indexOf("insert:resolved")).toBeLessThan(events.findIndex((event) => event.startsWith("update:")));
  });

  it("migration 030 e isolada do shadow lab 029 e coberta pela retencao", () => {
    const migration = readFileSync("relay/migrations/030_timing_policy_shadow.sql", "utf8");
    expect(migration).toContain("iq_timing_policy_observations");
    expect(migration).toContain("timing_policy_version");
    expect(migration).toContain("LATE_WINDOW_V2");
    expect(migration).toContain("iq_timing_policy_t0_immutable");
    expect(migration).toContain("is immutable");
    expect(readFileSync("relay/migrations/029_prospective_shadow_lab.sql", "utf8")).toContain("iq_shadow_observations");
    expect(readFileSync("scripts/db-retention.mjs", "utf8")).toContain("iq_timing_policy_observations");
    expect(readFileSync("scripts/db-retention.mjs", "utf8")).toContain("TIMING_POLICY_RETENTION_HOURS");
  });
});

describe("6. runtime: politica NOVA observa e NUNCA executa", () => {
  const BASE = Date.UTC(2026, 8, 17, 12, 0, 20);

  function brain(action: string, over: Record<string, any> = {}) {
    const setup = over.setup ?? (action === "WAIT" ? "NO_VALID_SETUP" : "TREND_PULLBACK");
    const trigger = over.trigger ?? (action === "WAIT" ? null : "pullback_com_estrutura_mantida");
    const trader = {
      agent: "TRADER", action, setup, trigger, analysisConfidence: action === "WAIT" ? 0 : 0.62, waitReason: action === "WAIT" ? "SEM_SETUP_VALIDO" : null,
      processLog: [{ stage: "DECISION", status: "OK", value: action }], structure: { label: "HH_HL", candleShape: { bodyRatio: 0.7, upperWick: 0.1, lowerWick: 0.2 }, velocity: { velocity: 0.0002, acceleration: 0.00001 } },
      location: { zone: "MEIO_CANAL", donchianPosition: 0.6, distanceToUpperATR: 1.2, distanceToLowerATR: 1.1, channelHigh: 1.2, channelLow: 1.0 },
      momentum: { rsi14: 58, acceleration: 0.001 }, strength: { adx14: 27, diSpread: 12, plusDI: 20, minusDI: 8 }, volatility: { atrRatio: 0.0012, atr: 0.0002 }, microstructure: { streak: 2, bodyRatio: 0.7 },
      supportingEvidence: ["setup:" + setup], contradictingEvidence: [], primaryRisk: null, latencyMs: 1, ...over.trader,
    };
    const critic = { agent: "CRITIC", traderAssessment: over.criticVerdict ?? "CONFIRM", independentAction: over.criticIndependent ?? action, contradictions: over.criticContradictions ?? [], riskFlags: over.criticRiskFlags ?? [], finalRecommendation: action === "WAIT" ? "WAIT" : action, latencyMs: 1 };
    const consensus = { action, status: over.consensusStatus ?? (action === "WAIT" ? "WAIT" : "CONFIRMED"), reason: action === "WAIT" ? "TRADER_WAIT" : "TRADER_E_CRITIC_ALINHADOS", rules: [], analysisConfidence: action === "WAIT" ? 0 : 0.62, estimatedWinProbability: null, latencyMs: 1 };
    return { trader, critic, consensus, regime: over.regime ?? "TREND_UP", fresh: over.fresh };
  }

  function fixture() {
    const clock = { nowMs: BASE };
    const overrides = new Map<string, any>();
    const runtime = new IqMultiRuntime({
      pool: null, getSsid: () => null, now: () => clock.nowMs, log: () => {}, ackTimeoutMs: 150,
      decisionOverride: ({ marketKey }: any) => { const override = overrides.get(marketKey); return override ? override() : brain("WAIT"); },
    }) as any;
    runtime.session = { connected: true, host: "ws.iqoption.com", connectionId: "conn-late", serverTimeMs: clock.nowMs, clockSkewMs: 0, timeValid: true, connectedAt: clock.nowMs };
    runtime.connection = { connectionId: "conn-late", host: "ws.iqoption.com", serverTimeMs: clock.nowMs, clockSkewMs: 0, timeValid: true };
    runtime.account = { practice: { verified: true, balanceId: 555, balance: 10_000, currency: "USD" }, real: { available: false, balanceId: null, balance: null, currency: null }, hasReal: false, checkedAt: clock.nowMs, type: "PRACTICE" };
    runtime.config.autoExecute = true; runtime.config.globalMaxStake = 100; runtime.config.calculatedBankrollStake = 1; runtime.config.qualityGateEnabled = true; runtime.config.minTradeQualityScore = 75;
    runtime.__sent = [];
    runtime.client = {
      serverNow: () => clock.nowMs,
      placeOrder: (options: Record<string, unknown>) => { runtime.__sent.push(options); return options.requestId; },
      getOptions: async () => ({ response: { msg: { closed_options: [] } } }),
    };
    const ctx = runtime.markets.get("EURUSD:OTC");
    ctx.availability = "OPEN"; ctx.activeId = 76; ctx.payout = 85; ctx.payoutSource = "test"; ctx.enabled = true; ctx.maxStake = 100; ctx.instrumentTypes = ["binary", "turbo"];
    let bucket = Math.floor((clock.nowMs - 40 * 5_000) / 5_000) * 5_000;
    const ingest = (bucketStart: number, close: number) => { runtime.ingestEvent("candle-generated", { connectionId: "conn-late", receivedAt: clock.nowMs, msg: { active_id: 76, size: 5, from: Math.floor(bucketStart / 1000), to: Math.floor(bucketStart / 1000) + 5, open: close - 0.00001, high: close + 0.00002, low: close - 0.00002, close } }); bucket = bucketStart; };
    for (let index = 0; index < 40; index += 1) ingest(bucket + 5_000, 1.1 + index * 0.00001);
    runtime.arm(100, { confirmation: true });
    const step = ({ advanceMs = 5_000, close = null } = {}) => {
      clock.nowMs += advanceMs;
      const aligned = Math.floor(clock.nowMs / 5_000) * 5_000 - 5_000;
      ingest(Math.max(bucket + 5_000, aligned), close ?? Number(ctx.lastCandle?.close ?? 1.1));
    };
    const ack = async (orderId: string, expiredOverride: number | null = null) => { const pending = runtime.pendingOrders.get("EURUSD:OTC"); if (!pending) return null; runtime.ingestEvent("socket-option-opened", { connectionId: "conn-late", receivedAt: clock.nowMs, msg: { id: orderId, active_id: pending.activeId, price: pending.stake, expired: expiredOverride ?? pending.expirationSec } }); await sleep(20); return pending; };
    return { runtime, clock, overrides, ctx, step, ack };
  }

  it("cria a observacao LATE no candidato e nao envia ordem extra", async () => {
    const { runtime, ctx, overrides, step } = fixture();
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    expect(ctx.candidate).toBeTruthy();
    const observation = runtime.timingShadow.activeForMarket("EURUSD:OTC");
    expect(observation).toBeTruthy();
    expect(observation.policyVersion).toBe(TIMING_POLICY_LATE);
    expect(observation.currentPolicyVersion).toBe(TIMING_POLICY_CURRENT);
    expect(runtime.__sent).toHaveLength(0);
    const status = runtime.timingPolicyStatus();
    expect(status.execution).toBe("SHADOW_ONLY");
    expect(status.controlsExecution).toBe(false);
    expect(status.timingPolicyVersion).toBe(TIMING_POLICY_LATE);
    runtime.stop("END");
  });

  it("apos CURRENT enviar/ACK, a politica NOVA continua observando e finaliza no deadline", async () => {
    const { runtime, clock, ctx, overrides, step, ack } = fixture();
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    const candidate = ctx.candidate;
    clock.nowMs = candidate.submitAt - 4_000;
    step({ advanceMs: 4_000 });
    await sleep(20);
    expect(runtime.__sent).toHaveLength(1);
    await ack("ORD-LATE-1");
    const observation = runtime.timingShadow.getByCandidate(candidate.id);
    expect(observation.current.ackedAt).not.toBeNull();
    expect(observation.current.expirationMismatch).toBe(false);
    // avanca alem do deadline LATE mantendo BUY: continua valida
    while (clock.nowMs < candidate.targetExpiryAt - 20_000) step();
    expect(observation.outcome === "LATE_ACCEPT" || observation.outcome === "OBSERVING").toBe(true);
    while (clock.nowMs < candidate.targetExpiryAt - 60_000 + 70_000 && observation.outcome === "OBSERVING") step();
    expect(observation.outcome).toBe("LATE_ACCEPT");
    expect(observation.late.verdict).toBe("ACCEPT");
    expect(observation.comparison.keptSameExpiration).toBe(true);
    expect(observation.comparison.additionalObservedMsVsCurrentEntry).toBeGreaterThan(20_000);
    // liquidacao causal do braco LATE ao fechar o candle da expiracao
    while (observation.late.result === null && clock.nowMs < candidate.targetExpiryAt + 30_000) step();
    expect(observation.late.result).not.toBeNull();
    expect(runtime.__sent).toHaveLength(1); // nunca enviou segunda ordem
    runtime.stop("END");
  });

  it("se a logica virar WAIT antes do deadline, LATE_CANCEL e nenhuma ordem nova", async () => {
    const { runtime, clock, ctx, overrides, step, ack } = fixture();
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    const candidate = ctx.candidate;
    clock.nowMs = candidate.submitAt - 4_000;
    step({ advanceMs: 4_000 });
    await sleep(20);
    expect(runtime.__sent).toHaveLength(1);
    await ack("ORD-LATE-2");
    overrides.set("EURUSD:OTC", () => brain("WAIT"));
    while (clock.nowMs < candidate.targetExpiryAt - 25_000) step();
    const observation = runtime.timingShadow.getByCandidate(candidate.id);
    expect(observation.outcome).toBe("LATE_CANCEL");
    expect(observation.outcomeReason).toBe("CANDIDATE_LOGIC_CHANGED_TO_WAIT");
    expect(runtime.__sent).toHaveLength(1);
    runtime.stop("END");
  });

  it("expiracao aceita diferente da solicitada e registrada como inconsistencia (nunca silenciosa)", async () => {
    const { runtime, clock, ctx, overrides, step } = fixture();
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    const candidate = ctx.candidate;
    clock.nowMs = candidate.submitAt - 4_000;
    step({ advanceMs: 4_000 });
    await sleep(20);
    const pending = runtime.pendingOrders.get("EURUSD:OTC");
    expect(pending).toBeTruthy();
    const acceptedExpiration = candidate.targetExpiryAt / 1000 + 60;
    // Evento `option` casa por requestId e informa `expired` REALMENTE aceito pelo broker.
    runtime.ingestEvent("option", { connectionId: "conn-late", receivedAt: clock.nowMs, requestId: pending.requestId, msg: { id: "ORD-LATE-MISMATCH", expired: acceptedExpiration, price: pending.stake } });
    await sleep(20);
    const observation = runtime.timingShadow.getByCandidate(candidate.id);
    expect(observation.current.brokerExpirationSec).toBe(acceptedExpiration);
    expect(observation.current.expirationMismatch).toBe(true);
    expect(runtime.auditTrail({ stage: "BROKER_EXPIRATION_MISMATCH" }).audit.length).toBeGreaterThanOrEqual(1);
    runtime.stop("END");
  });

  it("modulos de decisao nao importam a politica de timing (zero alteracao estrategica)", () => {
    for (const file of ["relay/professional-brain.mjs", "relay/trade-quality.mjs", "relay/entry-timing.mjs", "relay/portfolio-gate.mjs"]) {
      expect(readFileSync(file, "utf8")).not.toContain("late-window-timing");
    }
    const runtimeSource = readFileSync("relay/iq-multi-runtime.mjs", "utf8");
    expect(runtimeSource).toContain("this.timingShadow.markCurrentSend");
    expect(runtimeSource).not.toMatch(/if\s*\([^)]*timingShadow[^)]*\)\s*(return this\.#handleSignal|return this\.requestOrder)/);
  });
});
