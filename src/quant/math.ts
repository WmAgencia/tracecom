/**
 * Utilitários matemáticos do quant engine.
 *
 * Todos determinísticos e puros (sem estado). Operações são O(n) idealmente;
 * evitam alocação excessiva em chamadas de alta frequência (1m/3m).
 */

/** Média simples sobre uma janela deslizante. Devolve null até ter dados. */
export function sma(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

/** Alias para clareza em composições. */
export const smaFn = sma;

/** Média exponencial (EMA). Seed com SMA; alpha = 2/(period+1). */
export function ema(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const alpha = 2 / (period + 1);
  let prev: number | null = null;
  let seedSum = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (i === period - 1) {
      for (let j = 0; j < period; j++) seedSum += values[j]!;
      prev = seedSum / period;
      out.push(prev);
      continue;
    }
    const next: number = values[i]! * alpha + prev! * (1 - alpha);
    prev = next;
    out.push(next);
  }
  return out;
}

/** RSI (Wilder). Retorna null até ter `period+1` valores. */
export function rsi(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  if (values.length <= period) return values.map(() => null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i]! - values[i - 1]!;
    if (diff >= 0) avgGain += diff;
    else avgLoss += -diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out.push(null); // index 0
  for (let i = 1; i <= period; i++) out.push(null);
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!;
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return out;
}

/** True Range e ATR (Wilder). */
export function trueRange(highs: readonly number[], lows: readonly number[], closes: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const h = highs[i]!;
    const l = lows[i]!;
    const c = closes[i - 1];
    if (c === undefined) {
      out.push(h - l);
      continue;
    }
    out.push(Math.max(h - l, Math.abs(h - c), Math.abs(l - c)));
  }
  return out;
}

export function atr(highs: readonly number[], lows: readonly number[], closes: readonly number[], period: number): (number | null)[] {
  const tr = trueRange(highs, lows, closes);
  const out: (number | null)[] = [];
  if (tr.length < period) return tr.map(() => null);
  // inicializa com a média simples (seed)
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  for (let i = 0; i < period - 1; i++) out.push(null);
  let val = sum / period;
  out.push(val);
  // Wilder smoothing para o restante
  for (let i = period; i < tr.length; i++) {
    val = (val * (period - 1) + tr[i]!) / period;
    out.push(val);
  }
  return out;
}

/** Correlação simples (Pearson) entre duas séries (sem NaN, alinhadas). */
export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]!; sb += b[i]!; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i]! - ma, xb = b[i]! - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

/** Mínimo/máximo de uma janela contígua (para suporte/resistência). */
export function rollingMax(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let m = -Infinity;
    for (let j = i - period + 1; j <= i; j++) m = Math.max(m, values[j]!);
    out.push(m);
  }
  return out;
}

export function rollingMin(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let m = Infinity;
    for (let j = i - period + 1; j <= i; j++) m = Math.min(m, values[j]!);
    out.push(m);
  }
  return out;
}

/** Desvio-padrão amostral de uma série. */
export function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Retorna o último valor não-nulo de uma série. */
export function lastValid(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}
