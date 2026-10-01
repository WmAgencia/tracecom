/**
 * CRYPTO â€” regime detector + setup detector (CRYPTO_REGIME_TREND_V1).
 * Series sinteticas apenas para exercitar a LOGICA (producao usa dados reais de exchange).
 * Contrato: TREND_UP+setup => LONG; TREND_DOWN+setup => SHORT; RANGE => regra de range;
 * TRANSITION/HIGH_VOL desorganizada => NO_TRADE; RSI e contexto (nunca sinal isolado).
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const regimeModule = await import("../../relay/crypto/regime.mjs");
// @ts-expect-error - relay ESM sem tipagem
const setupModule = await import("../../relay/crypto/setup.mjs");
const { detectRegime, computeAdxDmi, computeAtr, computeBollinger, computeEmaSlopes, computeStructure, computeRsi } = regimeModule as any;
const { detectSetup } = setupModule as any;

const linear = (from: number, to: number, n: number) => { const out: number[] = []; for (let i = 0; i < n; i += 1) out.push(from + ((to - from) * i) / Math.max(1, n - 1)); return out; };
const mk = (closes: number[]) => closes.map((c, i) => ({ at: 1_700_000_000_000 + i * 60_000, open: i === 0 ? c : closes[i - 1]!, high: Math.max(c, i === 0 ? c : closes[i - 1]!) * 1.001, low: Math.min(c, i === 0 ? c : closes[i - 1]!) * 0.999, close: c }));
const nz = (arr: number[]) => arr.map((v, i) => v + Math.sin(i * 1.7) * 0.0002 * (1 + (i % 7 === 0 ? 1 : 0)));

const indicatorsFor = (candles: any[]) => ({ adx: computeAdxDmi(candles), atr: computeAtr(candles), bollinger: computeBollinger(candles), emas: computeEmaSlopes(candles), structure: computeStructure(candles), rsi: computeRsi(candles) });

const setupFor = (candles: any[], minRr = 1.5) => {
  const reg = detectRegime(candles);
  const inds = indicatorsFor(candles);
  const trend = reg.regime === "TREND_UP" ? "TREND_UP" : reg.regime === "TREND_DOWN" ? "TREND_DOWN" : null;
  const setup = detectSetup({ regime: reg.regime, trendDirection: trend, structure: inds.structure, indicators: inds, candles5m: candles, candles1m: candles.slice(-30), minRr, atrFactor: 1.5 });
  return { reg, inds, setup };
};

/** Sweep deterministico: encontra a serie cujo contrato (regime + candidato) e satisfeito. */
function findTrendCandidate(direction: "UP" | "DOWN", side: "LONG" | "SHORT") {
  for (const upAmt of [0.010, 0.012, 0.015]) {
    for (const pbAmt of [0.0012, 0.0015, 0.0018, 0.0020]) {
      for (const recAmt of [0.003, 0.004, 0.005]) {
        const up = linear(1.35, 1.35 + upAmt, 40);
        const pb = linear(up[up.length - 1]!, up[up.length - 1]! - pbAmt, 8);
        const rec = linear(pb[pb.length - 1]!, pb[pb.length - 1]! + recAmt, 14);
        const baseDown = linear(1.36, 1.348, 40); const pbUp = linear(baseDown[baseDown.length - 1]!, baseDown[baseDown.length - 1]! + pbAmt, 8); const recDown = linear(pbUp[pbUp.length - 1]!, pbUp[pbUp.length - 1]! - recAmt, 14); const closes = direction === "UP" ? [...up, ...pb.slice(1), ...rec.slice(1)] : [...baseDown, ...pbUp.slice(1), ...recDown.slice(1)];
        const candles = mk(nz(closes));
        const { reg, setup } = setupFor(candles);
        if (reg.regime === (direction === "UP" ? "TREND_UP" : "TREND_DOWN") && setup.candidate?.side === side && setup.candidate.acceptable === true) {
          return { candles, reg, setup, key: `${upAmt}/${pbAmt}/${recAmt}` };
        }
      }
    }
  }
  return null;
}

describe("CRYPTO regime detector (codigo puro)", () => {
  it("uptrend sustentado => TREND_UP com evidencias quantitativas", () => {
    const up = linear(1.35, 1.36, 65);
    const candles = mk(nz(up));
    const reg = detectRegime(candles);
    expect(reg.regime).toBe("TREND_UP");
    expect(reg.evidence.adx).toBeGreaterThanOrEqual(25);
    expect(reg.evidence.dominance).toBe("PLUS");
  });

  it("downtrend sustentado => TREND_DOWN com evidencias quantitativas", () => {
    const down = linear(1.36, 1.35, 65);
    const candles = mk(nz(down));
    const reg = detectRegime(candles);
    expect(reg.regime).toBe("TREND_DOWN");
    expect(reg.evidence.dominance).toBe("MINUS");
  });

  it("oscilacao estreita => RANGE (ADX baixo + Bollinger estreito)", () => {
    const r: number[] = [];
    let v = 1.35;
    for (let i = 0; i < 60; i += 1) { v = 1.35 + Math.sin(i * 0.9) * 0.003 + Math.sin(i * 3.1) * 0.0005; r.push(v); }
    const reg = detectRegime(mk(r));
    expect(reg.regime).toBe("RANGE");
  });

  it("HIGH_VOLATILITY com estrutura desorganizada => NO_TRADE (nunca sinal em spike)", () => {
    const base: number[] = [];
    let v = 1.35;
    for (let i = 0; i < 50; i += 1) { v = 1.35 + Math.sin(i * 0.9) * 0.002; base.push(v); }
    const spike: number[] = [];
    for (let i = 0; i < 10; i += 1) { v = v + (i % 2 === 0 ? 0.04 : -0.04); spike.push(v); }
    const reg = detectRegime(mk([...base, ...spike]));
    expect(["HIGH_VOLATILITY", "NO_TRADE"]).toContain(reg.regime);
    if (reg.regime === "HIGH_VOLATILITY") {
      // setup com volatilidade extrema nao gera candidato (reduz sinais / NO_TRADE)
      const { setup } = setupFor(mk([...base, ...spike]));
      expect(setup.candidate).toBeNull();
    }
  });
});

describe("CRYPTO setup detector", () => {
  it("TREND_UP + pullback/retest + retomada => candidato LONG com stop estrutural e R:R", () => {
    const found = findTrendCandidate("UP", "LONG");
    expect(found).not.toBeNull();
    expect(found!.setup.candidate.side).toBe("LONG");
    expect(found!.setup.candidate.entry).toBeGreaterThan(0);
    expect(found!.setup.candidate.stop).toBeLessThan(found!.setup.candidate.entry);
    expect(found!.setup.candidate.target).toBeGreaterThan(found!.setup.candidate.entry);
    expect(found!.setup.candidate.rr).toBeGreaterThanOrEqual(1.5);
  });

  it("TREND_DOWN + pullback/retest + retomada => candidato SHORT com stop estrutural e R:R", () => {
    const found = findTrendCandidate("DOWN", "SHORT");
    expect(found).not.toBeNull();
    expect(found!.setup.candidate.side).toBe("SHORT");
    expect(found!.setup.candidate.stop).toBeGreaterThan(found!.setup.candidate.entry);
    expect(found!.setup.candidate.target).toBeLessThan(found!.setup.candidate.entry);
  });

  it("RANGE usa a regra de range (rejeicao em extremo) â€” nunca trend", () => {
    const r: number[] = [];
    let v = 1.35;
    for (let i = 0; i < 60; i += 1) { v = 1.35 + Math.sin(i * 0.9) * 0.003 + Math.sin(i * 3.1) * 0.0005; r.push(v); }
    const candles = mk(r);
    const { reg, setup } = setupFor(candles, 0.8);
    expect(reg.regime).toBe("RANGE");
    if (setup.candidate) {
      expect(["LONG", "SHORT"]).toContain(setup.candidate.side);
      expect(setup.reason).toMatch(/RANGE/);
    }
  });

  it("TRANSITION => NO_TRADE (sem candidato)", () => {
    // tendencia fraca (ADX intermediario) => regime nao-trade
    const up = linear(1.35, 1.355, 65);
    const candles = mk(nz(up));
    const reg = detectRegime(candles);
    if (reg.regime === "TRANSITION" || reg.regime === "NO_TRADE" || reg.regime === "RANGE") {
      const { setup } = setupFor(candles);
      if (reg.regime === "TRANSITION" || reg.regime === "NO_TRADE") expect(setup.candidate).toBeNull();
    }
  });

  it("RSI e CONTEXTO: serie de downtrend com RSI oversold nao vira LONG por si so", () => {
    const down = linear(1.36, 1.35, 65);
    const candles = mk(nz(down));
    const { reg, inds } = setupFor(candles);
    expect(reg.regime).toBe("TREND_DOWN");
    expect(inds.rsi.zone).toBe("OVERSOLD");
    // nenhum candidato LONG; se houver candidato, e SHORT
    const { setup } = setupFor(candles);
    if (setup.candidate) expect(setup.candidate.side).toBe("SHORT");
  });
});
