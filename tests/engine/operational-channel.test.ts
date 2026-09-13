import { describe, expect, it } from "vitest";
import { COOLDOWN_MS, ENTRY_COUNTDOWN_MS, emptyChannelState, reduceChannel, type ChannelEvent, type ChannelState } from "../../src/engine/operational-channel";

const T0 = 1_000_000;
const candidate = (direction: "BUY" | "SELL" | "WAIT", overrides: Partial<Extract<ChannelEvent, { type: "CANDIDATE" }>> = {}): ChannelEvent => ({ type: "CANDIDATE", direction, profile: "BALANCED", rawConfidence: .73, regime: "UNCERTAIN", macroTrend: "SIDEWAYS", microTrend: "UP", trendAlignment: "NEUTRAL", counterTrend: false, reversalEvidenceCount: 0, candleId: "candle_1", frameId: "frame_1", ...overrides });

function run(state: ChannelState, events: Array<{ event: ChannelEvent; now: number }>): ChannelState { return events.reduce((current, item) => reduceChannel(current, item.event, item.now), state); }

describe("exclusive operational channel", () => {
  it("locks the first BUY and never lets SELL/WAIT replace it during countdown", () => {
    let state = reduceChannel(emptyChannelState(), candidate("BUY"), T0);
    expect(state.state).toBe("ENTRY_COUNTDOWN");
    expect(state.signal?.direction).toBe("BUY");
    expect(state.lastEffects).toContain("OPERATIONAL_SIGNAL_LOCKED");
    state = run(state, [{ event: candidate("SELL", { rawConfidence: .9, regime: "TREND_DOWN" }), now: T0 + 5_000 }, { event: candidate("WAIT"), now: T0 + 8_000 }, { event: candidate("BUY"), now: T0 + 9_000 }]);
    expect(state.signal?.direction).toBe("BUY");
    expect(state.countdownEndsAt).toBe(T0 + ENTRY_COUNTDOWN_MS);
    expect(state.researchDecisions).toBe(3);
  });

  it("locks SELL and blocks BUY replacement", () => {
    let state = reduceChannel(emptyChannelState(), candidate("SELL"), T0);
    state = reduceChannel(state, candidate("BUY", { rawConfidence: .95 }), T0 + 3_000);
    expect(state.signal?.direction).toBe("SELL");
  });

  it("does not lock WAIT and does not restart countdown on new candles", () => {
    const idle = reduceChannel(emptyChannelState(), candidate("WAIT"), T0);
    expect(idle.state).toBe("READY");
    expect(idle.signal).toBeNull();
    let state = reduceChannel(emptyChannelState(), candidate("BUY"), T0);
    state = reduceChannel(state, { type: "TICK" }, T0 + 1_000);
    expect(state.countdownEndsAt).toBe(T0 + ENTRY_COUNTDOWN_MS);
  });

  it("cancels before entry on critical invalidation and never reverses", () => {
    let state = reduceChannel(emptyChannelState(), candidate("BUY"), T0);
    state = reduceChannel(state, { type: "CRITICAL_INVALIDATION", reason: "macro_flip_against_signal" }, T0 + 4_000);
    expect(state.state).toBe("COOLDOWN");
    expect(state.signal).toBeNull();
    expect(state.metrics.preEntryInvalidations).toBe(1);
    state = reduceChannel(state, candidate("SELL"), T0 + 4_100);
    expect(state.state).toBe("COOLDOWN");
    expect(state.signal).toBeNull();
  });

  it("goes to ENTRY_NOT_CONFIRMED without inventing a manual trade", () => {
    let state = reduceChannel(emptyChannelState(), candidate("BUY"), T0);
    state = reduceChannel(state, { type: "TICK" }, T0 + ENTRY_COUNTDOWN_MS);
    expect(state.state).toBe("WAITING_ENTRY_CONFIRMATION");
    state = reduceChannel(state, { type: "TICK" }, T0 + ENTRY_COUNTDOWN_MS + 21_000);
    expect(state.state).toBe("COOLDOWN");
    expect(state.metrics.entryNotConfirmed).toBe(1);
    expect(state.metrics.manualTradesSettled).toBe(0);
    expect(state.lastEffects).toContain("ENTRY_NOT_CONFIRMED");
  });

  it("confirms a visual position, anchors the manual entry price and settles T+60 from entry", () => {
    let state = reduceChannel(emptyChannelState(), candidate("BUY"), T0);
    state = reduceChannel(state, { type: "TICK" }, T0 + ENTRY_COUNTDOWN_MS);
    state = reduceChannel(state, { type: "MANUAL_POSITION", detected: true, direction: "BUY", confidence: .8, evidence: ["position_panel"], price: 1.3850, priceConfidence: .97, priceSource: "IQ_OPTION_CURRENT_PRICE_LABEL" }, T0 + 14_000);
    expect(state.state).toBe("IN_POSITION");
    expect(state.manualEntry?.price).toBe(1.3850);
    expect(state.settlementAt).toBe(T0 + 14_000 + 60_000);
    // Um preço oposto durante a operação é apenas diagnóstico.
    state = reduceChannel(state, candidate("SELL", { rawConfidence: .9 }), T0 + 20_000);
    expect(state.metrics.midTradeDirectionFlips).toBe(1);
    expect(state.lastEffects).toContain("MID_TRADE_DIRECTION_FLIP");
    expect(state.state).toBe("IN_POSITION");
    // Sem settlement antes do T+60 causal.
    state = reduceChannel(state, { type: "SETTLEMENT", now: T0 + 60_000, exitPrice: 1.3860, exitPriceConfidence: .97, exitPriceSource: "IQ_OPTION_CURRENT_PRICE_LABEL" }, T0 + 60_000);
    expect(state.state).toBe("IN_POSITION");
    state = reduceChannel(state, { type: "SETTLEMENT", now: T0 + 74_000, exitPrice: 1.3860, exitPriceConfidence: .97, exitPriceSource: "IQ_OPTION_CURRENT_PRICE_LABEL" }, T0 + 74_000);
    expect(state.state).toBe("SETTLED");
    expect(state.settlement?.result).toBe("WIN");
    expect(state.metrics.manualWins).toBe(1);
    expect(state.lastEffects).toContain("TRADE_SETTLED");
    state = reduceChannel(state, { type: "TICK" }, T0 + 74_000 + COOLDOWN_MS + 1);
    expect(state.state).toBe("READY");
    expect(state.metrics.manualTradesSettled).toBe(1);
  });

  it("settles LOSS and DRAW through settleTrade semantics", () => {
    const base = (() => { let state = reduceChannel(emptyChannelState(), candidate("SELL"), T0); state = reduceChannel(state, { type: "TICK" }, T0 + ENTRY_COUNTDOWN_MS); return reduceChannel(state, { type: "MANUAL_POSITION", detected: true, direction: "SELL", confidence: .8, evidence: ["panel"], price: 1.3850, priceConfidence: .9, priceSource: "X" }, T0 + 12_000); })();
    const loss = reduceChannel(base, { type: "SETTLEMENT", now: T0 + 72_000, exitPrice: 1.3860, exitPriceConfidence: .9, exitPriceSource: "X" }, T0 + 72_000);
    expect(loss.settlement?.result).toBe("LOSS");
    const win = reduceChannel(base, { type: "SETTLEMENT", now: T0 + 72_000, exitPrice: 1.3840, exitPriceConfidence: .9, exitPriceSource: "X" }, T0 + 72_000);
    expect(win.settlement?.result).toBe("WIN");
    const draw = reduceChannel(base, { type: "SETTLEMENT", now: T0 + 72_000, exitPrice: 1.3850, exitPriceConfidence: .9, exitPriceSource: "X" }, T0 + 72_000);
    expect(draw.settlement?.result).toBe("DRAW");
    const unknown = reduceChannel(base, { type: "SETTLEMENT", now: T0 + 72_000, exitPrice: null, exitPriceConfidence: 0, exitPriceSource: "UNAVAILABLE" }, T0 + 72_000);
    expect(unknown.settlement?.result).toBe("UNKNOWN");
    expect(unknown.metrics.manualUnknown).toBe(1);
  });

  it("does not confirm positions with mismatching direction or missing price", () => {
    let state = reduceChannel(emptyChannelState(), candidate("BUY"), T0);
    state = reduceChannel(state, { type: "TICK" }, T0 + ENTRY_COUNTDOWN_MS);
    state = reduceChannel(state, { type: "MANUAL_POSITION", detected: true, direction: "SELL", confidence: .9, evidence: [], price: 1.385, priceConfidence: .9, priceSource: "X" }, T0 + 12_000);
    expect(state.state).toBe("WAITING_ENTRY_CONFIRMATION");
    expect(state.lastEffects).toContain("POSITION_DIRECTION_MISMATCH");
    state = reduceChannel(state, { type: "MANUAL_POSITION", detected: true, direction: "BUY", confidence: .9, evidence: [], price: null, priceConfidence: 0, priceSource: "UNAVAILABLE" }, T0 + 13_000);
    expect(state.state).toBe("POSITION_DETECTION_UNCERTAIN");
    expect(state.lastEffects).toContain("MANUAL_ENTRY_PRICE_UNAVAILABLE");
  });

  it("ignores profile switches during an active operation and arms them for the next one", () => {
    let state = reduceChannel(emptyChannelState(), candidate("BUY"), T0);
    state = reduceChannel(state, { type: "PROFILE_SWITCH", profile: "AGGRESSIVE" }, T0 + 1_000);
    expect(state.signal?.profile).toBe("BALANCED");
    expect(state.lastEffects).toContain("PROFILE_SWITCH_DURING_OPERATION_IGNORED");
    expect(state.state).toBe("ENTRY_COUNTDOWN");
    state = reduceChannel(state, { type: "TICK" }, T0 + ENTRY_COUNTDOWN_MS + 21_000);
    state = reduceChannel(state, { type: "TICK" }, T0 + ENTRY_COUNTDOWN_MS + 21_000 + COOLDOWN_MS + 1);
    state = reduceChannel(state, { type: "PROFILE_SWITCH", profile: "AGGRESSIVE" }, T0 + 60_000);
    expect(state.lastEffects).toContain("PROFILE_SWITCH_ARMED_FOR_NEXT_OPERATION");
  });

  it("survives cold start by serializing the active channel state", () => {
    let state = reduceChannel(emptyChannelState(), candidate("BUY"), T0);
    state = reduceChannel(state, { type: "TICK" }, T0 + ENTRY_COUNTDOWN_MS);
    state = reduceChannel(state, { type: "MANUAL_POSITION", detected: true, direction: "BUY", confidence: .8, evidence: ["panel"], price: 1.3851, priceConfidence: .9, priceSource: "X" }, T0 + 12_000);
    const restored = JSON.parse(JSON.stringify(state)) as ChannelState;
    expect(restored.state).toBe("IN_POSITION");
    expect(restored.manualEntry?.price).toBe(1.3851);
    const settled = reduceChannel(restored, { type: "SETTLEMENT", now: T0 + 72_000, exitPrice: 1.3861, exitPriceConfidence: .9, exitPriceSource: "X" }, T0 + 72_000);
    expect(settled.settlement?.result).toBe("WIN");
  });

  it("replays the real BUY→SELL→BUY log without any visible replacement", () => {
    let state = reduceChannel(emptyChannelState(), candidate("BUY", { rawConfidence: .73, regime: "UNCERTAIN" }), T0);
    expect(state.signal?.direction).toBe("BUY");
    state = reduceChannel(state, candidate("SELL", { rawConfidence: .90, regime: "TREND_DOWN", macroTrend: "DOWN", trendAlignment: "COUNTER_TREND", reversalEvidenceCount: 0 }), T0 + 5_000);
    state = reduceChannel(state, candidate("BUY", { rawConfidence: .7 }), T0 + 10_000);
    expect(state.signal?.direction).toBe("BUY");
    expect(state.countdownEndsAt).toBe(T0 + ENTRY_COUNTDOWN_MS);
    expect(state.metrics.operationalSignals).toBe(1);
    expect(state.researchDecisions).toBe(2);
    state = reduceChannel(state, { type: "CRITICAL_INVALIDATION", reason: "opposite_confident_reversal" }, T0 + 15_000);
    expect(state.state).toBe("COOLDOWN");
    expect(state.signal).toBeNull();
    expect(state.metrics.preEntryInvalidations).toBe(1);
  });
});
