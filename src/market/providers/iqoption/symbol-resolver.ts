/** IQ Option instrument identity. `-OTC` is intentionally distinct from Forex. */
export interface IqInstrument {
  readonly symbol: string;
  readonly activeId: string;
  readonly isOtc: boolean;
}

export function normalizeIqSymbol(raw: string): { symbol: string; isOtc: boolean } | null {
  const compact = raw.toUpperCase().replace(/\s+/g, "").replace("/", "");
  const isOtc = /(?:-|_)OTC$/.test(compact);
  const symbol = compact.replace(/(?:-|_)OTC$/, "");
  if (!/^[A-Z0-9]{4,12}$/.test(symbol)) return null;
  return { symbol: isOtc ? `${symbol}-OTC` : symbol, isOtc };
}

export class IqSymbolResolver {
  private readonly byActiveId = new Map<string, IqInstrument>();

  register(activeId: string | number, rawSymbol: string): IqInstrument | null {
    const normalized = normalizeIqSymbol(rawSymbol);
    if (!normalized) return null;
    const instrument: IqInstrument = { activeId: String(activeId), ...normalized };
    this.byActiveId.set(instrument.activeId, instrument);
    return instrument;
  }

  resolve(activeId: string | number): IqInstrument | null {
    return this.byActiveId.get(String(activeId)) ?? null;
  }
}
