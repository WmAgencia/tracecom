/**
 * Catálogo de ativos da Tracecon.
 *
 * Um ativo é identificado por (provider, symbol) porque o mesmo ticker em
 * providers diferentes pode ter convenções distintas de base/quote/market.
 */
export type AssetMarket = "crypto" | "stock" | "forex" | "index" | "commodity";

export interface Asset {
  readonly id: string;
  readonly symbol: string; // símbolo canônico no provider
  readonly name: string;
  readonly market: AssetMarket;
  readonly provider: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly status: "active" | "inactive" | "unverified";
  readonly metadata: Readonly<Record<string, string>>;
}

export interface AssetCatalog {
  /** Retorna ativo por id canônico (`provider:symbol`) ou por símbolo. */
  find(idOrSymbol: string): Asset | null;
  list(filter?: { market?: AssetMarket; provider?: string }): Asset[];
}

export class StaticAssetCatalog implements AssetCatalog {
  constructor(private readonly assets: Asset[]) {}
  async seed(): Promise<void> {
    void 0;
  }
  find(idOrSymbol: string): Asset | null {
    return this.assets.find((a) => a.id === idOrSymbol || a.symbol.toUpperCase() === idOrSymbol.toUpperCase()) ?? null;
  }
  list(filter?: { market?: AssetMarket; provider?: string }): Asset[] {
    return this.assets.filter(
      (a) => (!filter?.market || a.market === filter.market) && (!filter?.provider || a.provider === filter.provider),
    );
  }
  all(): Asset[] {
    return this.assets;
  }
}

/** Catálogo mínimo validado contra a Binance (símbolos reais). */
export const DEFAULT_CRYPTO_CATALOG: Asset[] = [
  { id: "binance:BTCUSDT", symbol: "BTCUSDT", name: "Bitcoin", market: "crypto", provider: "binance", baseAsset: "BTC", quoteAsset: "USDT", status: "active", metadata: {} },
  { id: "binance:ETHUSDT", symbol: "ETHUSDT", name: "Ethereum", market: "crypto", provider: "binance", baseAsset: "ETH", quoteAsset: "USDT", status: "active", metadata: {} },
  { id: "binance:SOLUSDT", symbol: "SOLUSDT", name: "Solana", market: "crypto", provider: "binance", baseAsset: "SOL", quoteAsset: "USDT", status: "active", metadata: {} },
  { id: "binance:BNBUSDT", symbol: "BNBUSDT", name: "BNB", market: "crypto", provider: "binance", baseAsset: "BNB", quoteAsset: "USDT", status: "active", metadata: {} },
  { id: "binance:XRPUSDT", symbol: "XRPUSDT", name: "XRP", market: "crypto", provider: "binance", baseAsset: "XRP", quoteAsset: "USDT", status: "active", metadata: {} },
  { id: "binance:BTCUSDC", symbol: "BTCUSDC", name: "Bitcoin", market: "crypto", provider: "binance", baseAsset: "BTC", quoteAsset: "USDC", status: "active", metadata: {} },
  { id: "binance:ETHBTC", symbol: "ETHBTC", name: "Ethereum", market: "crypto", provider: "binance", baseAsset: "ETH", quoteAsset: "BTC", status: "active", metadata: {} },
];
