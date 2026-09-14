export type StructuredMarketObservation = {
  observationId: string;
  frameId: string | null;
  capturedAt: number;
  processedAt: number;
  marketContextId: string | null;
  segmentId: string | null;
  assetRaw: string | null;
  assetCanonical: string | null;
  marketType: string | null;
  currentPrice: number | null;
  priceSource: string | null;
  priceConfidence: number | null;
  baseTimeframeSeconds: number | null;
  tradeExpirationSeconds: number | null;
  investmentValue: number | null;
  positionExists: boolean;
  positionDirection: "BUY" | "SELL" | "UNKNOWN";
  positionConfidence: number | null;
  observationQuality: "VALID" | "PARTIAL" | "UNAVAILABLE";
};

export type MarketObserverMetrics = { observerCycles: number; successfulObservations: number; failedObservations: number; skippedCycles: number; meanLatencyMs: number | null; p95LatencyMs: number | null; overlappingJobs: number };

/** Single-flight 1Hz observer scheduler. It only emits facts; it never decides. */
export class MarketObserver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = true;
  private latencies: number[] = [];
  private metricsState: MarketObserverMetrics = { observerCycles: 0, successfulObservations: 0, failedObservations: 0, skippedCycles: 0, meanLatencyMs: null, p95LatencyMs: null, overlappingJobs: 0 };
  constructor(private readonly capture: () => Promise<StructuredMarketObservation>, private readonly persist: (observation: StructuredMarketObservation) => Promise<void> | void, private readonly intervalMs = 1_000) {}
  start(): void { if (!this.stopped) return; this.stopped = false; this.schedule(0); }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; }
  metrics(): MarketObserverMetrics { return { ...this.metricsState, meanLatencyMs: this.latencies.length ? this.latencies.reduce((s, x) => s + x, 0) / this.latencies.length : null, p95LatencyMs: this.latencies.length ? [...this.latencies].sort((a, b) => a - b)[Math.floor((this.latencies.length - 1) * .95)]! : null }; }
  private schedule(delay: number): void { if (!this.stopped) this.timer = setTimeout(() => void this.cycle(), delay); }
  private async cycle(): Promise<void> {
    if (this.stopped) return;
    if (this.running) { this.metricsState.skippedCycles += 1; this.schedule(this.intervalMs); return; }
    this.running = true; this.metricsState.observerCycles += 1; const started = Date.now();
    try { const observation = await this.capture(); await this.persist(observation); this.metricsState.successfulObservations += 1; } catch { this.metricsState.failedObservations += 1; } finally { this.latencies.push(Date.now() - started); this.latencies = this.latencies.slice(-300); this.running = false; this.schedule(Math.max(0, this.intervalMs - (Date.now() - started))); }
  }
}
