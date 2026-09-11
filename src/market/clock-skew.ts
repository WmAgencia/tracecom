/**
 * Clock Skew Correction — corrige drift entre timestamps do provider (Binance)
 * e o relógio do servidor.
 *
 * O problema: candles podem chegar com `timestamp` (início do bucket, conforme
 * o relógio do provider) e `receivedAt` (relógio local) muito defasados. Em
 * alguns provedores, `timestamp` é o tempo do EVENTO e `receivedAt` é quando
 * o cliente local recebeu — se houver drift de relógio (ex.: servidor local
 * adiantado/atrasado em relação à Binance), todos os candles carregam o erro.
 *
 * Esta função é OPT-IN: o pipeline atual NÃO a chama (não muta, não
 * consome). Foi criada para uso explícito por quem precisar reconciliar
 * séries com clock skew (backtests comparando exchanges, ingest externo,
 * análises cross-provider).
 *
 * Princípios:
 *   1. NÃO mutar candles de entrada — sempre retornar novo array.
 *   2. NÃO fabricar timestamps — se a correção extrapolaria `maxOffsetMs`,
 *      descartar o candle suspeito (e logar warning).
 *   3. Idempotência: se já alinhado (offset ≈ 0), devolve array inalterado.
 *
 * Estimativa de skew:
 *   `serverTimeMs - max(candles.receivedAt)` é usado como referência porque
 *   `receivedAt` reflete o relógio local e `serverTime` reflete o da Binance
 *   naquele momento. Se o servidor local está adiantado em 30s, offset > 0.
 */
import type { MarketCandle } from "./model";

/** Opções para `applyClockSkewCorrection`. */
export interface ClockSkewOptions {
  /**
   * Limite absoluto de offset (ms) aceito. Se o offset estimado exceder este
   * valor, um warning é logado e candles cuja magnitude de correção exceder
   * o limite são DESCARTADOS (não corrigidos). Padrão: 60_000 (60s).
   */
  readonly maxOffsetMs?: number;
  /** Função de log para warnings. Padrão: `console.warn`. */
  readonly logger?: (msg: string) => void;
}

const DEFAULT_MAX_OFFSET_MS = 60_000;

export interface ClockSkewResult {
  /** Candles corrigidos (e filtrados). Pode estar vazio se todos descartados. */
  readonly candles: readonly MarketCandle[];
  /** Offset estimado aplicado (ms). Positivo = relógio local adiantado. */
  readonly offsetMs: number;
  /** Quantos candles foram descartados por exceder `maxOffsetMs`. */
  readonly droppedCount: number;
}

/**
 * Aplica correção de clock skew a uma série de candles.
 *
 * NÃO muta o array de entrada. Retorna novo array de candles com
 * `timestamp` ajustado pelo offset estimado entre `serverTimeMs` e o
 * `receivedAt` mais recente da entrada.
 *
 * @param candles Candles a corrigir. Se vazio, retorna vazio.
 * @param serverTimeMs Tempo atual do servidor Binance (epoch ms), obtido
 *                     via `GET /api/v3/time`.
 * @param opts Veja `ClockSkewOptions`.
 */
export function applyClockSkewCorrection(
  candles: readonly MarketCandle[],
  serverTimeMs: number,
  opts: ClockSkewOptions = {},
): ClockSkewResult {
  const log = opts.logger ?? ((m) => console.warn(m));
  const maxOffsetMs = opts.maxOffsetMs ?? DEFAULT_MAX_OFFSET_MS;

  if (candles.length === 0) {
    return { candles: [], offsetMs: 0, droppedCount: 0 };
  }
  if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0) {
    log(`[clock-skew] serverTimeMs inválido (${serverTimeMs}); nada corrigido.`);
    return { candles: candles.slice(), offsetMs: 0, droppedCount: 0 };
  }

  // receivedAt mais recente como referência do relógio local.
  let maxReceivedAt = -Infinity;
  for (const c of candles) {
    if (c.receivedAt > maxReceivedAt) maxReceivedAt = c.receivedAt;
  }
  // Offset = quanto o relógio local está adiantado em relação ao Binance.
  const offsetMs = serverTimeMs - maxReceivedAt;

  // Idempotência: se já alinhado, devolve inalterado.
  if (offsetMs === 0) {
    return { candles: candles.slice(), offsetMs: 0, droppedCount: 0 };
  }

  if (Math.abs(offsetMs) > maxOffsetMs) {
    log(
      `[clock-skew] offset estimado ${offsetMs}ms excede maxOffsetMs=${maxOffsetMs}ms; ` +
      `descartando candles com desvio excessivo.`,
    );
  }

  const out: MarketCandle[] = [];
  let droppedCount = 0;
  for (const c of candles) {
    const newTs = c.timestamp + offsetMs;
    // Se a correção de um candle isolado extrapolaria o limite, descarta.
    // (offsetMs absoluto > maxOffsetMs já é a condição de teto geral.)
    if (Math.abs(offsetMs) > maxOffsetMs) {
      droppedCount++;
      continue;
    }
    // Se o timestamp corrigido ficou inválido, descarta também.
    if (!Number.isFinite(newTs) || newTs <= 0) {
      droppedCount++;
      continue;
    }
    out.push({ ...c, timestamp: newTs });
  }

  return { candles: out, offsetMs, droppedCount };
}

/**
 * Estima o clock skew entre o servidor local e a Binance via
 * `GET /api/v3/time`. Retorna a diferença (ms): positivo = local adiantado.
 *
 * NÃO introduz dependência externa de NTP — usa apenas o endpoint público
 * `time` da Binance.
 *
 * @param fetchImpl Implementação de fetch (default: `globalThis.fetch`).
 * @param baseUrl Base URL da Binance (default: produção).
 */
export async function estimateBinanceClockSkew(
  fetchImpl: typeof fetch = globalThis.fetch,
  baseUrl: string = "https://api.binance.com/api/v3",
): Promise<number> {
  const before = Date.now();
  const res = await fetchImpl(`${baseUrl}/time`);
  if (!res.ok) {
    throw new Error(`Binance /time falhou: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { serverTime: number };
  const after = Date.now();
  // Compensa latência: midpoint entre before e after como estimativa do
  // "agora" local no momento em que o servidor respondeu.
  const localMid = (before + after) / 2;
  return json.serverTime - localMid;
}
