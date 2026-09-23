/**
 * TRACECOM — CANDLE HISTORY SEED: repopula o buffer de candles 5s com historico
 * REAL vindo do broker (get-candles v2 -> resposta "candles" / "candles-generated").
 *
 * Regras:
 * - somente candles FECHADOS (bucketEnd <= serverNow + tolerancia);
 * - dedupe por bucketStart (nunca sobrescreve o stream live);
 * - nunca fabrica: candle invalido e simplesmente ignorado;
 * - buffer limitado (descarta os mais antigos).
 */
export const CANDLE_HISTORY_VERSION = "candle-history-seed-v1";
export const HISTORY_BACKFILL_CANDLES = 300;

/** Extrai a lista de candles 5s de uma resposta de historico do broker (candles[] ou candles["5"]). */
export function extractHistoryCandles(msg, { sizeSeconds = 5 } = {}) {
  const source = msg?.candles ?? msg?.msg?.candles ?? null;
  if (Array.isArray(source)) return source;
  if (source && typeof source === "object") {
    const five = source[String(sizeSeconds)] ?? source[sizeSeconds];
    if (Array.isArray(five)) return five;
  }
  return [];
}

/** Normaliza/insere candles de historico no buffer existente. `normalize` = normalizeCandle injetado. */
export function seedCandlesFromHistory({ existing, rows = [], sizeSeconds = 5, serverNow = null, maxBuffer = 600, normalize, sourceTag = "BROKER_HISTORY", receivedAt = null } = {}) {
  if (!existing || typeof existing.set !== "function" || typeof normalize !== "function") return { added: 0, skipped: rows.length, newest: null };
  const now = Number(serverNow);
  const tolerance = 2_000;
  let added = 0; let skipped = 0;
  for (const raw of rows) {
    try {
      const candle = normalize(raw, { sizeSeconds, serverTimestamp: Number.isFinite(now) ? now : undefined, receivedAt: receivedAt ?? undefined });
      const validBucket = candle && candle.bucketStart !== null && candle.bucketStart !== undefined && Number.isFinite(Number(candle.bucketStart));
      const validClose = candle && candle.close !== null && candle.close !== undefined && Number.isFinite(Number(candle.close));
      if (!validBucket || !validClose) { skipped += 1; continue; }
      // NUNCA semear candle ainda aberto (causalidade).
      if (Number.isFinite(now) && Number(candle.bucketEnd) > now + tolerance) { skipped += 1; continue; }
      const tagged = { ...candle, source: sourceTag };
      if (existing.has(candle.bucketStart)) { skipped += 1; continue; }
      existing.set(candle.bucketStart, tagged);
      added += 1;
    } catch { skipped += 1; }
  }
  while (existing.size > maxBuffer) {
    let oldest = null;
    for (const key of existing.keys()) if (oldest === null || key < oldest) oldest = key;
    if (oldest === null) break;
    existing.delete(oldest);
  }
  let newest = null;
  for (const value of existing.values()) if (!newest || Number(value.bucketStart) > Number(newest.bucketStart)) newest = value;
  return { added, skipped, newest };
}
