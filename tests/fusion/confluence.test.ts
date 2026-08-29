import { describe, expect, it } from 'vitest';
import {
  analyzeConfluence,
  rsiWilder,
  technicalScoreSimple,
  type TFCandle,
  type TFSnapshot,
} from '../../src/fusion/confluence';

/**
 * Helpers — geradores de candles sintéticos com características previsíveis.
 *
 * Parâmetros calibrados via probe-confluence.ts para produzir RSI na faixa
 * 30..70 quando se quer "alinhado", e RSI extremo (>70 ou <30) quando se
 * quer "não-alinhado por RSI". Drift define a direção técnica; noise mantém
 * o RSI em zona neutra.
 *
 * IMPORTANTE: o módulo `confluence.ts` exige >= 30 candles por TF.
 */

// RNG determinístico (Mulberry32 com seed fixa → testes reprodutíveis).
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface MakeOpts {
  readonly n?: number;
  readonly start?: number;
  /** Drift linear por candle (fração). Ex: 0.002 = +0.2%/candle. */
  readonly drift?: number;
  /** Amplitude do ruído simétrico por candle (fração). Ex: 0.015 = ±1.5%. */
  readonly noise?: number;
  readonly seed?: number;
}

function makeCandles(opts: MakeOpts = {}): TFCandle[] {
  const n = opts.n ?? 60;
  const start = opts.start ?? 100;
  const drift = opts.drift ?? 0;
  const noise = opts.noise ?? 0.015;
  const rand = rng(opts.seed ?? 42);
  const out: TFCandle[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    const noisePct = (rand() * 2 - 1) * noise;
    const change = drift + noisePct;
    price = price * (1 + change);
    const spread = Math.abs(noisePct) + 0.0005;
    out.push({
      close: price,
      high: price * (1 + spread),
      low: price * (1 - spread),
    });
  }
  return out;
}

// Tendência de alta com RSI ~57 e technical_score > 0.
// Calibrado via probe-confluence.ts: drift=+0.2%/candle, noise ±2%.
function uptrendCandles(n = 60): TFCandle[] {
  return makeCandles({ n, drift: 0.002, noise: 0.020, seed: 42 });
}

// Tendência de baixa com RSI ~34 e technical_score < 0.
// Calibrado: drift=-0.2%/candle, noise ±2%, seed=8 (estável).
function downtrendCandles(n = 60): TFCandle[] {
  return makeCandles({ n, drift: -0.002, noise: 0.020, seed: 8 });
}

// Lateralização leve → RSI ~77 (acima de 70, não-alinhado por gating RSI).
// Usado para simular 4h "neutro" no teste de 2 alinhados + 1 neutro.
function rangeCandles(n = 60): TFCandle[] {
  return makeCandles({ n, drift: 0, noise: 0.005, seed: 3 });
}

// Up extremo → RSI ≥ 70 (≥ 100 tipicamente), technical_score > 0 mas RSI gating falha.
function extremeUpCandles(n = 60): TFCandle[] {
  return makeCandles({ n, drift: 0.01, noise: 0.002, seed: 4 });
}

// Down extremo → RSI ≤ 30 (≤ 0 tipicamente).
function extremeDownCandles(n = 60): TFCandle[] {
  return makeCandles({ n, drift: -0.01, noise: 0.002, seed: 5 });
}

function snap(tf: '15m' | '1h' | '4h', candles: TFCandle[]): TFSnapshot {
  return { tf, candles };
}

describe('analyzeConfluence — comportamento básico', () => {
  it('3 TFs alinhados em up → direction=up, agreement=1.0, boost=0.3', () => {
    const r = analyzeConfluence({
      direction: 'up',
      perTf: [
        snap('15m', uptrendCandles()),
        snap('1h', uptrendCandles()),
        snap('4h', uptrendCandles()),
      ],
    });
    expect(r.direction).toBe('up');
    expect(r.agreementScore).toBeCloseTo(1.0, 6);
    expect(r.confidenceBoost).toBeCloseTo(0.3, 6);
    expect(r.perTf).toHaveLength(3);
    expect(r.perTf.every((p) => p.aligned)).toBe(true);
  });

  it('2 TFs alinhados (15m+1h), 4h neutro (range, RSI extremo) → ainda up, agreement entre 0.65 e 0.85', () => {
    // 4h range → RSI ≥ 70 (não-alinhado pelo gating de RSI).
    // agreement = (0.7 + 1.0) / (0.7 + 1.0 + 0.9) = 1.7 / 2.6 ≈ 0.6538
    const r = analyzeConfluence({
      direction: 'up',
      perTf: [
        snap('15m', uptrendCandles()),
        snap('1h', uptrendCandles()),
        snap('4h', rangeCandles()),
      ],
    });
    expect(r.direction).toBe('up');
    expect(r.agreementScore).toBeGreaterThanOrEqual(0.65);
    expect(r.agreementScore).toBeLessThanOrEqual(0.85);
    expect(r.confidenceBoost).toBeCloseTo(r.agreementScore * 0.3, 6);
  });

  it('1h up + 4h down → neutral (apenas 1 TF alinhado, < 2 mínimo)', () => {
    const r = analyzeConfluence({
      direction: 'up',
      perTf: [
        snap('1h', uptrendCandles()),
        snap('4h', downtrendCandles()),
      ],
    });
    // 4h tem sinal técnico oposto → não-alinhado.
    // Apenas 1 TF alinhado (< 2 mínimo) → direction = neutral.
    expect(r.direction).toBe('neutral');
    // agreement = 1.0 / 1.9 ≈ 0.5263 (acima do limite 0.5 mas bloqueado pela regra de mínimo)
    expect(r.agreementScore).toBeGreaterThan(0.5);
  });

  it('candles insuficientes (<30) → TF reportado como não alinhado e zerado', () => {
    const r = analyzeConfluence({
      direction: 'up',
      perTf: [
        snap('15m', uptrendCandles(20)), // < 30
        snap('1h', uptrendCandles()),
        snap('4h', uptrendCandles()),
      ],
    });
    const tf15m = r.perTf.find((p) => p.tf === '15m')!;
    expect(tf15m.aligned).toBe(false);
    expect(tf15m.weight).toBe(0);
    // Os outros dois estão alinhados → agreement = (0 + 1.0 + 0.9) / (0 + 1.0 + 0.9) = 1.0
    expect(r.direction).toBe('up');
    expect(r.agreementScore).toBeCloseTo(1.0, 6);
  });

  it('agreement no limite (0.5) → retorna neutral (regra: estritamente maior)', () => {
    // Constrói um cenário em que agreement fica <= 0.5:
    //   15m e 4h com RSI extremo (≥70 ou ≤30) → não-alinhados
    //   1h alinhado (up leve, RSI em faixa neutra)
    // agreement = 1.0 / (0.7 + 1.0 + 0.9) = 1/2.6 ≈ 0.3846
    const r = analyzeConfluence({
      direction: 'up',
      perTf: [
        snap('15m', extremeUpCandles()), // RSI extremo → não-alinhado
        snap('4h', extremeUpCandles()), // RSI extremo → não-alinhado
        snap('1h', uptrendCandles()),    // alinhado
      ],
    });
    expect(r.agreementScore).toBeLessThanOrEqual(0.5);
    expect(r.direction).toBe('neutral');
  });

  it('direção down com 3 TFs alinhados → direction=down', () => {
    const r = analyzeConfluence({
      direction: 'down',
      perTf: [
        snap('15m', downtrendCandles()),
        snap('1h', downtrendCandles()),
        snap('4h', downtrendCandles()),
      ],
    });
    expect(r.direction).toBe('down');
    expect(r.agreementScore).toBeCloseTo(1.0, 6);
    expect(r.confidenceBoost).toBeCloseTo(0.3, 6);
  });
});

describe('analyzeConfluence — sanitização e bordas', () => {
  it('sem TFs fornecidos → neutral com reason explícita', () => {
    const r = analyzeConfluence({ direction: 'up', perTf: [] });
    expect(r.direction).toBe('neutral');
    expect(r.agreementScore).toBe(0);
    expect(r.confidenceBoost).toBe(0);
    expect(r.perTf).toHaveLength(0);
    expect(r.reason).toMatch(/nenhum timeframe/i);
  });

  it('apenas 1 TF com candles suficientes e alinhado (mínimo 2 não satisfeito) → neutral', () => {
    const r = analyzeConfluence({
      direction: 'up',
      perTf: [
        snap('1h', uptrendCandles()),
        // 15m e 4h com dados insuficientes — pesos = 0, alinhados = false
        snap('15m', uptrendCandles(10)),
        snap('4h', uptrendCandles(10)),
      ],
    });
    expect(r.direction).toBe('neutral');
  });
});

describe('utilitários internos (RSI Wilder + technical score)', () => {
  it('rsiWilder retorna null para candles insuficientes', () => {
    expect(rsiWilder([1, 2, 3], 14)).toBeNull();
  });

  it('rsiWilder em uptrend ruidoso sustentado → RSI entre 30 e 70', () => {
    const closes = uptrendCandles().map((c) => c.close);
    const rsi = rsiWilder(closes, 14)!;
    expect(rsi).not.toBeNull();
    expect(rsi).toBeGreaterThan(30);
    expect(rsi).toBeLessThan(70);
  });

  it('rsiWilder em série com RSI extremo (>70)', () => {
    const closes = extremeUpCandles().map((c) => c.close);
    const rsi = rsiWilder(closes, 14)!;
    expect(rsi).toBeGreaterThan(70);
  });

  it('technicalScoreSimple retorna positivo em uptrend', () => {
    const closes = uptrendCandles().map((c) => c.close);
    const score = technicalScoreSimple(closes);
    expect(score).toBeGreaterThan(0);
  });

  it('technicalScoreSimple retorna negativo em downtrend', () => {
    const closes = downtrendCandles().map((c) => c.close);
    const score = technicalScoreSimple(closes);
    expect(score).toBeLessThan(0);
  });

  it('technicalScoreSimple retorna ~0 em range', () => {
    const closes = rangeCandles().map((c) => c.close);
    const score = technicalScoreSimple(closes);
    expect(Math.abs(score)).toBeLessThan(0.05);
  });
});
