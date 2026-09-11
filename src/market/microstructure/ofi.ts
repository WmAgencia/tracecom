/**
 * Order Flow Imbalance (OFI) — métrica de microestrutura baseada em
 * Cont, Kukanov & Stoikov (2014): "The Price Impact of Order Book Events".
 *
 * Idéia: medir a pressão de compra/venda comparando a MUDANÇA de volume
 * nos top N níveis do book entre dois snapshots consecutivos.
 *
 *   Δbid(p) = curr_bid_size(p) − prev_bid_size(p)
 *   Δask(p) = curr_ask_size(p) − prev_ask_size(p)
 *
 * Para cada nível p:
 *   • presente em ambos  → Δ = curr − prev
 *   • sumiu do book     → Δ = −prev
 *   • apareceu no book  → Δ =  curr
 *
 * OFI = Σ_p (Δbid(p) − Δask(p)) sobre os top N níveis.
 *
 * Normalização: dividimos pela média do volume total nos dois lados
 * (`(bidVol + askVol) / 2`) para obter um sinal em [−1, +1], onde +1
 * indica pressão compradora máxima. Quando não há volume, retornamos 0
 * (estado degenerado; não inventamos sinal).
 */
export interface OFILevel {
  readonly price: number;
  readonly size: number;
}

export interface OFIBook {
  readonly bids: readonly OFILevel[];
  readonly asks: readonly OFILevel[];
}

export interface OFIInput {
  readonly prevBook: OFIBook;
  readonly currBook: OFIBook;
  /** Profundidade considerada (top N níveis de cada lado). Default: 10. */
  readonly depth?: number;
}

export interface OFIResult {
  /** OFI normalizado em [−1, +1]. Positivo = pressão compradora. */
  readonly ofi: number;
  /** Soma do size das bids dentro da profundidade, no book corrente. */
  readonly bidVolume: number;
  /** Soma do size das asks dentro da profundidade, no book corrente. */
  readonly askVolume: number;
  /** (bidVol − askVol) / (bidVol + askVol), em [−1, +1]. */
  readonly depthImbalance: number;
}

const DEFAULT_DEPTH = 10;

/** Indexa um book por preço para lookup O(1). */
function indexByPrice(side: readonly OFILevel[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const level of side) {
    map.set(level.price, level.size);
  }
  return map;
}

/** Soma size dos primeiros `depth` níveis de um lado do book. */
function sumDepth(side: readonly OFILevel[], depth: number): number {
  let total = 0;
  const limit = Math.min(depth, side.length);
  for (let i = 0; i < limit; i++) {
    total += side[i]!.size;
  }
  return total;
}

/**
 * Calcula Order Flow Imbalance entre dois snapshots consecutivos.
 *
 * Função PURA: sem I/O, sem `Date.now()`, sem efeitos colaterais.
 * Adequada para testes determinísticos e uso em pipeline de eventos.
 */
export function computeOFI(input: OFIInput): OFIResult {
  const depth = input.depth ?? DEFAULT_DEPTH;
  const prevBids = indexByPrice(input.prevBook.bids);
  const prevAsks = indexByPrice(input.prevBook.asks);
  const currBids = indexByPrice(input.currBook.bids);
  const currAsks = indexByPrice(input.currBook.asks);

  // Conjunto dos preços relevantes: união dos top N de cada lado nos dois books.
  const prices = new Set<number>();
  const pushTop = (side: readonly OFILevel[]): void => {
    const limit = Math.min(depth, side.length);
    for (let i = 0; i < limit; i++) {
      prices.add(side[i]!.price);
    }
  };
  pushTop(input.prevBook.bids);
  pushTop(input.prevBook.asks);
  pushTop(input.currBook.bids);
  pushTop(input.currBook.asks);

  let ofiRaw = 0;
  for (const price of prices) {
    const prevBid = prevBids.get(price) ?? 0;
    const currBid = currBids.get(price) ?? 0;
    const prevAsk = prevAsks.get(price) ?? 0;
    const currAsk = currAsks.get(price) ?? 0;

    // Bids e asks compartilham o mesmo preço? Tratamos como bid (buy side).
    // Em book real, um preço não é simultaneamente bid e ask — se houver
    // cruzamento, o contribuidor positivo de bid já captura a pressão.
    const dBid = currBid - prevBid;
    const dAsk = currAsk - prevAsk;
    ofiRaw += dBid - dAsk;
  }

  const bidVolume = sumDepth(input.currBook.bids, depth);
  const askVolume = sumDepth(input.currBook.asks, depth);
  const totalVol = bidVolume + askVolume;

  // Normalização em [−1, +1]: divisão pela média dos volumes (paper original).
  const normalizer = totalVol / 2;
  const ofi = normalizer > 0 ? clamp(ofiRaw / normalizer, -1, 1) : 0;

  const depthImbalance = totalVol > 0 ? (bidVolume - askVolume) / totalVol : 0;

  return { ofi, bidVolume, askVolume, depthImbalance };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
