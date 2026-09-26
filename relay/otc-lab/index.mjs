/**
 * OTC_BLACKBOX_LAB_V1
 *
 * Pesquisa isolada: somente observações OTC fornecidas pelo feed normal da
 * conta. Este módulo não conhece V3, Crypto, armamento ou envio de ordens.
 */
export const OTC_LAB_VERSION = "OTC_BLACKBOX_LAB_V1";
export const OTC_HORIZON_MS = 300_000;

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const direction = (from, to, tolerance = 1e-10) => {
  if (Math.abs(to - from) <= tolerance) return "FLAT";
  return to > from ? "UP" : "DOWN";
};

export function otcFeatures(rows, index) {
  const current = rows[index];
  const close = finite(current?.close);
  if (!current || close === null) return null;
  const returns = {};
  for (const seconds of [1, 5, 10, 15, 30, 60, 120, 180, 300]) {
    const previous = [...rows.slice(0, index)].reverse().find((row) => current.at - row.at >= seconds * 1000);
    returns[`return${seconds}s`] = previous?.close > 0 ? (close - previous.close) / previous.close : null;
  }
  const recent = rows.slice(Math.max(0, index - 20), index + 1).map((row) => row.close).filter(Number.isFinite);
  const mean = recent.length ? recent.reduce((sum, value) => sum + value, 0) / recent.length : null;
  const variance = mean === null ? null : recent.reduce((sum, value) => sum + (value - mean) ** 2, 0) / recent.length;
  return Object.freeze({
    returns,
    velocity: returns.return5s,
    acceleration: returns.return5s !== null && returns.return10s !== null ? returns.return5s - returns.return10s / 2 : null,
    localMean: mean,
    zScore: variance && variance > 0 ? (close - mean) / Math.sqrt(variance) : null,
    second: new Date(current.at).getUTCSeconds(),
    minute: new Date(current.at).getUTCMinutes(),
    minuteModulo5: new Date(current.at).getUTCMinutes() % 5,
  });
}

export function temporalSplit(rows, { train = 0.6, validation = 0.2, embargoMs = OTC_HORIZON_MS } = {}) {
  const ordered = [...rows].sort((a, b) => a.at - b.at);
  const trainEnd = Math.floor(ordered.length * train);
  const validationEnd = Math.floor(ordered.length * (train + validation));
  const embargo = (part, boundary) => part.filter((row) => row.at + embargoMs <= boundary);
  const validationBoundary = ordered[validationEnd]?.at ?? Infinity;
  const testBoundary = ordered[ordered.length - 1]?.at ?? Infinity;
  return Object.freeze({
    train: embargo(ordered.slice(0, trainEnd), ordered[trainEnd]?.at ?? Infinity),
    validation: embargo(ordered.slice(trainEnd, validationEnd), validationBoundary),
    test: embargo(ordered.slice(validationEnd), testBoundary),
    embargoMs,
    chronological: true,
  });
}

export class OtcBlackBoxLab {
  constructor({ enabled = process.env.OTC_LAB_ENABLED === "true", now = () => Date.now(), log = () => {} } = {}) {
    this.enabled = enabled;
    this.now = now;
    this.log = log;
    this.byMarket = new Map();
    this.labels = [];
    this.labelled = new Set();
  }

  observe(sample) {
    if (!this.enabled) return { accepted: false, reason: "OTC_LAB_DISABLED" };
    const marketKey = String(sample?.marketKey ?? "").toUpperCase();
    const at = finite(sample?.at);
    const close = finite(sample?.close);
    if (!marketKey.endsWith(":OTC")) return { accepted: false, reason: "OTC_ONLY" };
    if (at === null || close === null || close <= 0) return { accepted: false, reason: "INVALID_OBSERVATION" };
    const rows = this.byMarket.get(marketKey) ?? [];
    if (rows.length && at <= rows[rows.length - 1].at) return { accepted: false, reason: "OUT_OF_ORDER" };
    const row = Object.freeze({ marketKey, at, open: finite(sample.open) ?? close, high: finite(sample.high) ?? close, low: finite(sample.low) ?? close, close, volume: finite(sample.volume), payout: finite(sample.payout), availability: sample.availability ?? null });
    rows.push(row);
    while (rows.length > 200_000) rows.shift();
    this.byMarket.set(marketKey, rows);
    this.#settle(marketKey, rows, row);
    return { accepted: true, marketKey, features: otcFeatures(rows, rows.length - 1), execution: "NONE" };
  }

  #settle(marketKey, rows, newest) {
    for (const entry of rows) {
      const id = `${marketKey}:${entry.at}`;
      if (entry.at + OTC_HORIZON_MS > newest.at || this.labelled.has(id)) continue;
      this.labelled.add(id);
      this.labels.push(Object.freeze({ marketKey, at: entry.at, settledAt: newest.at, entryPrice: entry.close, futurePrice: newest.close, moveAbsolute: newest.close - entry.close, movePct: (newest.close - entry.close) / entry.close, direction: direction(entry.close, newest.close), payout: entry.payout, features: otcFeatures(rows, rows.indexOf(entry)) }));
    }
  }

  status() {
    const markets = [...this.byMarket.entries()].map(([marketKey, rows]) => ({ marketKey, observations: rows.length, labels: this.labels.filter((label) => label.marketKey === marketKey).length, firstAt: rows[0]?.at ?? null, lastAt: rows.at(-1)?.at ?? null }));
    return Object.freeze({ version: OTC_LAB_VERSION, enabled: this.enabled, isolated: true, execution: "NONE", realMoneyExecution: 0, syntheticData: false, horizonSeconds: 300, markets, labels: this.labels.length, state: this.labels.length ? "COLLECTING" : "NO_OBSERVED_OTC_DATA" });
  }
}
