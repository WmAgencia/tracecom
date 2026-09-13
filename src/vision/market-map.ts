/**
 * Stable, platform-agnostic map of the regions that matter on an IQ Option
 * screenshot. Coordinates are normalized (0..1), so the map survives window
 * resizing and never requires DOM or broker access.
 */
export type MarketRoiId =
  | "asset" | "expiration" | "stake" | "payout" | "chart"
  | "expiryLine" | "price" | "orderButtons" | "candleClock" | "scale";

export interface NormalizedRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export interface MarketRoi { readonly id: MarketRoiId; readonly label: string; readonly rect: NormalizedRect; readonly notes: string; }

const rect = (x: number, y: number, width: number, height: number): NormalizedRect => ({ x, y, width, height });

/** Conservative ROIs for the current desktop IQ Option layout. They are hints
 * for visual analysis only; values remain unavailable when not evidenced. */
export const MARKET_VISION_MAP: Readonly<Record<MarketRoiId, MarketRoi>> = Object.freeze({
  asset: { id: "asset", label: "Ativo", rect: rect(0.055, 0.105, 0.28, 0.12), notes: "Cabeçalho do gráfico; símbolo e OTC." },
  expiration: { id: "expiration", label: "Expiração", rect: rect(0.90, 0.12, 0.095, 0.17), notes: "Painel direito; duração selecionada." },
  stake: { id: "stake", label: "Valor investido", rect: rect(0.90, 0.08, 0.095, 0.10), notes: "Painel direito; somente leitura." },
  payout: { id: "payout", label: "Lucro", rect: rect(0.90, 0.25, 0.095, 0.15), notes: "Percentual exibido pela plataforma." },
  chart: { id: "chart", label: "Gráfico", rect: rect(0.055, 0.12, 0.825, 0.70), notes: "Candles, pavios e estrutura visual." },
  expiryLine: { id: "expiryLine", label: "Linha de expiração", rect: rect(0.68, 0.12, 0.16, 0.70), notes: "Região provável; confirmar visualmente." },
  price: { id: "price", label: "Preço atual", rect: rect(0.83, 0.38, 0.075, 0.12), notes: "Label de preço junto ao eixo direito." },
  orderButtons: { id: "orderButtons", label: "Botões de ordem", rect: rect(0.90, 0.40, 0.095, 0.36), notes: "Detecção passiva; nunca clicar." },
  candleClock: { id: "candleClock", label: "Relógio do candle", rect: rect(0.64, 0.12, 0.16, 0.18), notes: "Contador visível próximo ao candle atual." },
  scale: { id: "scale", label: "Escala", rect: rect(0.055, 0.72, 0.825, 0.10), notes: "Estimativa de candles visíveis." },
});

export function getMarketRoi(id: MarketRoiId): MarketRoi { return MARKET_VISION_MAP[id]; }

export function normalizeRect(input: NormalizedRect): NormalizedRect {
  const x = Math.min(1, Math.max(0, input.x));
  const y = Math.min(1, Math.max(0, input.y));
  const width = Math.min(1 - x, Math.max(0, input.width));
  const height = Math.min(1 - y, Math.max(0, input.height));
  return { x, y, width: Number(width.toFixed(6)), height: Number(height.toFixed(6)) };
}

export function mapRoiToPixels(roi: NormalizedRect, frameWidth: number, frameHeight: number) {
  const safe = normalizeRect(roi);
  return { x: Math.round(safe.x * frameWidth), y: Math.round(safe.y * frameHeight), width: Math.round(safe.width * frameWidth), height: Math.round(safe.height * frameHeight) };
}
