/**
 * Abstração de fonte de candles históricos + paginação.
 *
 * Um provedor pode não devolver todo o histórico numa chamada. Esta camada
 * orquestra paginação, respeita `limit`, faz retry com backoff, e retorna
 * gaps entre páginas quando detectados. Nunca preenche vazio com dado falso.
 */
import type { MarketCandle, Timeframe } from "./model";
import { TIMEFRAME_MS } from "./model";

export interface HistoricalPage {
  readonly candles: readonly MarketCandle[];
  readonly nextStartTime: number | null; // null = fim do histórico
}

export interface HistoricalSource {
  readonly provider: string;
  /** Retorna uma página de candles (já normalizados) terminando antes de `end`. */
  fetchPage(params: {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly start: number;
    readonly end: number;
    readonly limit: number;
  }): Promise<HistoricalPage>;
}

export interface Backoff {
  readonly delayMs: number;
  readonly attempts: number;
  advance(): void;
  reset(): void;
}

/** Backoff exponencial com jitter e teto. */
export class ExponentialBackoff implements Backoff {
  private _attempts = 0;
  constructor(
    private readonly base = 250,
    private readonly multiplier = 2,
    private readonly max = 8_000,
    private readonly jitter = 0.2,
  ) {}

  get delayMs(): number {
    const exp = this.base * Math.pow(this.multiplier, this._attempts);
    const capped = Math.min(exp, this.max);
    const j = capped * this.jitter * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(capped + j));
  }
  get attempts(): number {
    return this._attempts;
  }
  advance(): void {
    this._attempts++;
  }
  reset(): void {
    this._attempts = 0;
  }
}

export interface FetchResult {
  readonly candles: MarketCandle[];
  readonly gaps: readonly { readonly from: number; readonly to: number }[];
  readonly pages: number;
  readonly rawCount: number;
}

/**
 * Busca histórica completa com paginação e detecção de gaps entre páginas.
 * `onPage` opcional para observer progresso/reconciliação.
 */
export async function fetchHistorical(
  source: HistoricalSource,
  params: {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly start: number;
    readonly end: number;
    readonly pageSize?: number;
    readonly maxPages?: number;
    readonly backoff?: Backoff;
  },
): Promise<FetchResult> {
  const pageSize = params.pageSize ?? 500;
  const maxPages = params.maxPages ?? 50;
  const backoff: Backoff = params.backoff ?? new ExponentialBackoff();

  const all: MarketCandle[] = [];
  const gaps: Array<{ from: number; to: number }> = [];
  let cursor = params.start;
  let pages = 0;

  for (let p = 0; p < maxPages; p++) {
    let page: HistoricalPage | null = null;
    let attempts = 0;
    // retry
    for (;;) {
      try {
        page = await source.fetchPage({
          symbol: params.symbol,
          timeframe: params.timeframe,
          start: cursor,
          end: params.end,
          limit: pageSize,
        });
        break;
      } catch {
        attempts++;
        if (attempts > 3) throw new Error(`Falha ao buscar histórico após ${attempts} tentativas`);
        backoff.advance();
        await sleep(backoff.delayMs);
      }
    }
    pages++;
    const candles = page?.candles ?? [];
    backoff.reset();

    for (const c of candles) {
      const last = all[all.length - 1];
      if (last && c.timestamp - last.timestamp > TIMEFRAME_MS[params.timeframe] * 1.5) {
        gaps.push({ from: last.timestamp + TIMEFRAME_MS[params.timeframe], to: c.timestamp });
      }
      all.push(c);
    }

    if (!page?.nextStartTime) break;
    cursor = page.nextStartTime;
    if (cursor >= params.end) break;
  }

  // Ordena e deduplica por timestamp (mantendo o último, mais recente).
  const byTs = new Map<number, MarketCandle>();
  for (const c of all) byTs.set(c.timestamp, c);
  const sorted = Array.from(byTs.values()).sort((a, b) => a.timestamp - b.timestamp);

  return { candles: sorted, gaps, pages, rawCount: all.length };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
