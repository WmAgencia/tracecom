/**
 * DATAHUB METRICS — percentis e janelas deslizantes sem dependencias.
 *
 * Usado pelo Event Bus (latencia de entrega, fila, drops) e pelo Agent System V4
 * (latencia de analise por fase). Read-only em relacao ao hot path: nunca decide nada.
 */
export const METRICS_VERSION = "datahub-metrics-v1";

export function percentile(values, fraction) {
  const list = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const position = Math.min(list.length - 1, Math.max(0, Math.ceil(fraction * list.length) - 1));
  return list[position];
}

export function summarize(values) {
  const list = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(value));
  if (!list.length) return { count: 0, p50: null, p95: null, p99: null, max: null, mean: null };
  const total = list.reduce((sum, value) => sum + value, 0);
  return {
    count: list.length,
    p50: percentile(list, 0.5),
    p95: percentile(list, 0.95),
    p99: percentile(list, 0.99),
    max: Math.max(...list),
    mean: Number((total / list.length).toFixed(3)),
  };
}

/** Janela deslizante limitada (ring buffer) com resumo p50/p95/p99. */
export class RollingWindow {
  constructor({ maxSamples = 512 } = {}) {
    this.maxSamples = Math.max(1, Number(maxSamples) || 512);
    this.values = [];
  }

  record(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    this.values.push(numeric);
    if (this.values.length > this.maxSamples) this.values.splice(0, this.values.length - this.maxSamples);
    return numeric;
  }

  summary() { return summarize(this.values); }

  reset() { this.values = []; }

  get size() { return this.values.length; }
}

/** Contadores com janela de tempo para taxa por segundo (events/sec). */
export class RateCounter {
  constructor({ windowMs = 60_000, now = () => Date.now() } = {}) {
    this.windowMs = Math.max(1_000, Number(windowMs) || 60_000);
    this.now = now;
    this.marks = [];
    this.total = 0;
  }

  add(count = 1) {
    const numeric = Number(count);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    this.total += numeric;
    const at = this.now();
    this.marks.push({ at, count: numeric });
    this.#prune(at);
    return numeric;
  }

  ratePerSecond() {
    const at = this.now();
    this.#prune(at);
    if (!this.marks.length) return 0;
    const oldest = this.marks[0].at;
    const spanMs = Math.max(1_000, at - oldest);
    const count = this.marks.reduce((sum, mark) => sum + mark.count, 0);
    return Number(((count / spanMs) * 1_000).toFixed(4));
  }

  #prune(at) {
    const floor = at - this.windowMs;
    let firstValid = 0;
    while (firstValid < this.marks.length && this.marks[firstValid].at < floor) firstValid += 1;
    if (firstValid > 0) this.marks.splice(0, firstValid);
  }
}

/** Snapshot de processo (CPU/RAM) para relatorios de performance. Nunca bloqueia. */
export function processSnapshot(baseline = null) {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage(baseline ?? undefined);
  const cpuTotalMs = Number(((cpu.user + cpu.system) / 1_000).toFixed(3));
  return {
    memory: { rssMb: Number((memory.rss / 1024 / 1024).toFixed(2)), heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(2)) },
    cpu: { userMs: Number((cpu.user / 1_000).toFixed(3)), systemMs: Number((cpu.system / 1_000).toFixed(3)), totalMs: cpuTotalMs },
    at: Date.now(),
  };
}
