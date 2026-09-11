/**
 * Cumulative Volume Delta (CVD) — métrica clássica de tape reading.
 *
 * Cada trade é classificado pelo lado do TAKER (agressor):
 *   • `isBuyerMaker === true`  → taker vendeu (sell agressão)
 *   • `isBuyerMaker === false` → taker comprou (buy agressão)
 *
 * O delta por trade é +size (buy) ou −size (sell). O CVD é a soma
 * acumulada desse sinal ao longo da janela.
 *
 * Também devolvemos a forma normalizada (delta / volume total), que
 * cabe em [−1, +1]: +1 = todo volume foi compra agressora, −1 = venda.
 *
 * Função PURA: sem I/O, sem `Date.now()`. Idempotente sobre o array
 * de entrada.
 */
export interface CVDTrade {
  readonly timestamp: number;
  readonly price: number;
  readonly size: number;
  readonly isBuyerMaker: boolean;
}

export interface CVDInput {
  readonly trades: readonly CVDTrade[];
}

export interface CVDResult {
  /** Soma cumulativa signed (running sum) — o CVD propriamente dito. */
  readonly cvd: number;
  /** Σ size de trades com taker comprador. */
  readonly buyVolume: number;
  /** Σ size de trades com taker vendedor. */
  readonly sellVolume: number;
  /** buyVolume − sellVolume. */
  readonly delta: number;
  /** delta / (buyVolume + sellVolume), em [−1, +1]. 0 se volume total = 0. */
  readonly cvdNormalized: number;
}

/**
 * Calcula o Cumulative Volume Delta sobre uma janela de trades.
 *
 * O array de entrada é tratado como já ordenado no tempo — esta função
 * NÃO reordena. Para janelas com ordem desconhecida, ordene antes de
 * chamar (a responsabilidade fica do caller; manter a função pura).
 */
export function computeCVD(input: CVDInput): CVDResult {
  let cvd = 0;
  let buyVolume = 0;
  let sellVolume = 0;

  for (const trade of input.trades) {
    if (trade.isBuyerMaker) {
      // Taker vendeu → contribuição negativa.
      sellVolume += trade.size;
      cvd -= trade.size;
    } else {
      // Taker comprou → contribuição positiva.
      buyVolume += trade.size;
      cvd += trade.size;
    }
  }

  const delta = buyVolume - sellVolume;
  const totalVol = buyVolume + sellVolume;
  const cvdNormalized = totalVol > 0 ? clamp(delta / totalVol, -1, 1) : 0;

  return { cvd, buyVolume, sellVolume, delta, cvdNormalized };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
