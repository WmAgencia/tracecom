/** Selects a working Forex provider without ever crossing into crypto. */
import type { HistoricalSource } from "../../history";
import type { MarketCandle, MarketOrderBook, MarketSymbol, MarketTick, ProviderConnectionState, Timeframe } from "../../model";
import type { MarketDataProvider, MarketListener, SubscribeOptions } from "../../providerV2";

export class AutoForexProvider implements MarketDataProvider {
  readonly id = "auto-forex";
  private active: MarketDataProvider | null = null;
  private lastError: unknown = null;

  constructor(private readonly candidates: readonly MarketDataProvider[]) {
    if (candidates.length === 0) throw new Error("Auto Forex exige ao menos um provider real");
  }

  get state(): ProviderConnectionState { return this.active?.state ?? (this.lastError ? "error" : "disconnected"); }
  get connectedAt(): number | null { return this.active?.connectedAt ?? null; }
  getStatus(): ProviderConnectionState { return this.state; }

  async connect(): Promise<void> {
    if (this.active?.state === "connected") return;
    const errors: string[] = [];
    for (const candidate of this.candidates) {
      try {
        await candidate.connect();
        this.active = candidate;
        return;
      } catch (error) {
        this.lastError = error;
        errors.push(`${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
        candidate.disconnect();
      }
    }
    throw new Error(`PROVIDER_UNAVAILABLE: nenhum provider Forex respondeu (${errors.join("; ")})`);
  }

  disconnect(): void { this.active?.disconnect(); this.active = null; }
  async subscribe(opts: SubscribeOptions, listener: MarketListener): Promise<() => void> { await this.connect(); return this.requireActive().subscribe(opts, listener); }
  async getTicker(symbol: string) { await this.connect(); return this.requireActive().getTicker(symbol); }
  async getCandles(params: { symbol: string; timeframe: Timeframe; start: number; end?: number; limit?: number }) { await this.connect(); return this.requireActive().getCandles(params); }
  async getTrades(symbol: string, limit?: number): Promise<{ trades: MarketTick[]; source: string }> { await this.connect(); return this.requireActive().getTrades(symbol, limit); }
  async getOrderBook(symbol: string, limit?: number): Promise<MarketOrderBook> { await this.connect(); return this.requireActive().getOrderBook(symbol, limit); }
  async getMarketMetadata(symbol: string): Promise<MarketSymbol | null> { await this.connect(); return this.requireActive().getMarketMetadata(symbol); }
  get historical(): HistoricalSource { return { provider: this.id, fetchPage: async (params) => { await this.connect(); return this.requireActive().historical.fetchPage(params); } }; }
  get activeProviderId(): string | null { return this.active?.id ?? null; }
  private requireActive(): MarketDataProvider { if (!this.active) throw new Error("PROVIDER_UNAVAILABLE: Auto Forex sem provider ativo"); return this.active; }
}
