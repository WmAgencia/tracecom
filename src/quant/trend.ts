/**
 * Indicadores de tendência: SMA, EMA, MACD, ADX.
 * Determinísticos; consomem séries planas (arrays) — nunca LLM.
 */
import type { Series } from "./types";
import { sma as smaFn, ema as emaFn } from "./math";

export function sma(values: readonly number[], period: number): Series {
  return smaFn(values, period);
}

export function ema(values: readonly number[], period: number): Series {
  return emaFn(values, period);
}

export interface MacdResult {
  readonly line: Series;
  readonly signal: Series;
  readonly histogram: Series;
}

export function macd(values: readonly number[], fast: number, slow: number, signalPeriod: number): MacdResult {
  const line = emaFn(values, fast).map((v, i) => {
    const eSlow = emaFn(values, slow)[i];
    return v !== null && eSlow != null ? v - (eSlow as number) : null;
  });
  // signal = EMA do macd line (considerando apenas valores não-nulos, na ordem)
  const nonNull = line.map((v, i) => ({ v, i })).filter((x) => x.v !== null).map((x) => x.v!) as number[];
  const signalFor = emaFn(nonNull, signalPeriod);
  let cur = 0;
  const signal: Series = line.map((v) => {
    if (v === null) return null;
    const s = signalFor[cur] ?? null;
    cur++;
    return s;
  });
  const histogram: Series = line.map((v, i) => (v !== null && signal[i] !== null ? v - (signal[i] as number) : null));
  return { line, signal, histogram };
}

export function adx(highs: readonly number[], lows: readonly number[], closes: readonly number[], period: number): Series {
  const n = closes.length;
  if (n < period * 2) return Array.from({ length: n }, () => null);

  // 1) True Range, +DM, -DM
  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 0; i < n; i++) {
    const h = highs[i]!, l = lows[i]!, pc = closes[i - 1];
    const range = pc === undefined ? h - l : Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    tr.push(range);
    if (i === 0) { plusDM.push(0); minusDM.push(0); continue; }
    const up = h - highs[i - 1]!;
    const down = lows[i - 1]! - l;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }

  // 2) Suavização Wilder de TR, +DM, -DM (período)
  const smooth = (src: number[]): number[] => {
    const out: number[] = [];
    let acc = 0;
    for (let i = 0; i < period; i++) acc += src[i]!;
    out.push(acc);
    for (let i = period; i < n; i++) {
      acc = acc - acc / period + src[i]!;
      out.push(acc);
    }
    return out;
  };
  const trS = smooth(tr);
  const plusS = smooth(plusDM);
  const minusS = smooth(minusDM);

  // 3) DX por índice
  const dx: number[] = [];
  for (let i = 0; i < trS.length; i++) {
    const t = trS[i]!;
    if (t === 0) { dx.push(0); continue; }
    const pdi = (100 * plusS[i]!) / t;
    const mdi = (100 * minusS[i]!) / t;
    const sum = pdi + mdi;
    dx.push(sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum);
  }

  // 4) ADX = média (Wilder) dos últimos `period` DX
  const out: (number | null)[] = Array.from({ length: n }, () => null);
  // deslocamento: o primeiro DX válido começa após `period` (índice period-1)
  for (let i = 0; i < n; i++) {
    // precisa de period DX disponíveis => i >= period - 1 + period - 1
    const need = period * 2 - 1;
    if (i < need) continue;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) acc += dx[j] ?? 0;
    out[i] = acc / period;
  }
  return out;
}
