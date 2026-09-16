/**
 * FROZEN STRATEGIES — engines paralelos V1/V2/V3/V8 (shadow) + controle operacional no relay.
 *
 * Paridade 1:1 com src/strategies/{features,frozen,selection,auto,promotion}.ts (validada pelo
 * teste tests/strategies/relay-parity.test.ts). Somente shadow; nenhuma ordem, nenhum clique.
 * Settlement exato: close do candle iniciado em signal_bucket + horizon*1000.
 */
import { buildCandles } from "./experiment.mjs";

export const FROZEN_BUCKET_MS = 5_000;
export const FROZEN_MIN_INDEX = 30;
export const SIGNAL_FRESHNESS_MS = 20_000;

export const FROZEN_STRATEGIES = [
  { family: "V1", entryLogicHash: "70a7bfcb568bec8c", horizons: [300] },
  { family: "V2", entryLogicHash: "6f8b9001c63b7597", horizons: [60, 120] },
  { family: "V3", entryLogicHash: "acf733a866146537", horizons: [45, 60, 120, 180, 300] },
  { family: "V8", entryLogicHash: "712373de3372e158", horizons: [45, 60] },
];

export const FROZEN_VARIANTS = FROZEN_STRATEGIES.flatMap((s) => s.horizons.map((h) => ({ family: s.family, horizonSeconds: h, variantId: `${s.family}-${h}`, entryLogicHash: s.entryLogicHash })));

function cutlerRsi(closes, end, period = 14) {
  if (end - period < 0) return null;
  let gains = 0, losses = 0;
  for (let k = end - period + 1; k <= end; k += 1) { const diff = closes[k] - closes[k - 1]; if (diff >= 0) gains += diff; else losses -= diff; }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function computeFibonacci(candles, index) {
  const start = index - 23;
  if (start < 0) return null;
  let hi = -Infinity, lo = Infinity;
  for (let j = start; j <= index; j += 1) { const c = candles[j]; if (c.high > hi) hi = c.high; if (c.low < lo) lo = c.low; }
  let firstHigh = -1, firstLow = -1;
  for (let j = start; j <= index; j += 1) { const c = candles[j]; if (firstHigh === -1 && c.high === hi) firstHigh = j; if (firstLow === -1 && c.low === lo) firstLow = j; }
  const range = hi - lo;
  const level382 = hi - 0.382 * range, level618 = hi - 0.618 * range;
  const zoneLow = Math.min(level382, level618), zoneHigh = Math.max(level382, level618);
  const close = candles[index].close;
  return { hi, lo, range, upSwing: firstLow <= firstHigh, level382, level618, zoneLow, zoneHigh, inZone: range > 0 && close <= zoneHigh && close >= zoneLow };
}

function computeStructure(candles, index) {
  const highs = [], lows = [];
  for (let j = 2; j <= index - 2; j += 1) {
    const c = candles[j], p1 = candles[j - 1], n1 = candles[j + 1], p2 = candles[j - 2], n2 = candles[j + 2];
    if (c.high > p1.high && c.high > n1.high && c.high > p2.high && c.high > n2.high) highs.push(j);
    if (c.low < p1.low && c.low < n1.low && c.low < p2.low && c.low < n2.low) lows.push(j);
  }
  const recentHighs = highs.filter((j) => j >= index - 47);
  const recentLows = lows.filter((j) => j >= index - 47);
  let structureUp = false, structureDown = false;
  if (recentHighs.length >= 2 && recentLows.length >= 2) {
    const h2 = candles[recentHighs[recentHighs.length - 1]].high, h1 = candles[recentHighs[recentHighs.length - 2]].high;
    const l2 = candles[recentLows[recentLows.length - 1]].low, l1 = candles[recentLows[recentLows.length - 2]].low;
    if (h2 > h1 && l2 > l1) structureUp = true;
    else if (h2 < h1 && l2 < l1) structureDown = true;
  }
  return { structureUp, structureDown };
}

export function computeFrozenFeatures(candles, index) {
  if (index < FROZEN_MIN_INDEX || index >= candles.length) return null;
  const candle = candles[index];
  const closes = [];
  for (let j = 0; j <= index; j += 1) closes.push(candles[j].close);
  const rsi14 = cutlerRsi(closes, index, 14);
  if (rsi14 === null) return null;
  const s = (55 - rsi14) / 45;
  if (index - 24 < 0) return null;
  const r24 = (candle.close - closes[index - 24]) / closes[index - 24];
  const rs12 = [];
  for (let j = index - 11; j <= index; j += 1) rs12.push((closes[j] - closes[j - 1]) / closes[j - 1]);
  const mean = rs12.reduce((acc, x) => acc + x, 0) / rs12.length;
  const vol12 = Math.sqrt(rs12.reduce((acc, x) => acc + (x - mean) ** 2, 0) / rs12.length);
  const fib = computeFibonacci(candles, index);
  if (fib === null) return null;
  const structure = computeStructure(candles, index);
  return { index, start: candle.start, close: candle.close, rsi14, s, vol12, r24, fib, ...structure };
}

export function fibOk(features, direction) {
  if (!features.fib.inZone) return false;
  return direction === "BUY" ? features.fib.upSwing : !features.fib.upSwing;
}

export function evaluateFrozen(family, features) {
  switch (family) {
    case "V1": { if (!(features.vol12 < 0.0009)) return null; const d = features.s > 0.33 ? "BUY" : features.s < -0.33 ? "SELL" : null; return d && fibOk(features, d) ? d : null; }
    case "V2": { if (!(features.vol12 < 0.0012)) return null; const d = features.s > 0.22 ? "BUY" : features.s < -0.22 ? "SELL" : null; return d && fibOk(features, d) ? d : null; }
    case "V3": { if (!(features.vol12 < 0.0012)) return null; const d = features.s > 0.22 && features.r24 > 0 ? "BUY" : features.s < -0.22 && features.r24 < 0 ? "SELL" : null; return d && fibOk(features, d) ? d : null; }
    case "V8": { const d = features.structureUp ? "BUY" : features.structureDown ? "SELL" : null; return d && fibOk(features, d) ? d : null; }
    default: return null;
  }
}

export function settleFrozen(direction, entryPrice, settlementClose) {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(settlementClose)) return "UNKNOWN";
  if (settlementClose === entryPrice) return "DRAW";
  if (direction === "BUY") return settlementClose > entryPrice ? "WIN" : "LOSS";
  return settlementClose < entryPrice ? "WIN" : "LOSS";
}

export function validateSelection(family, horizonSeconds) {
  const strategy = FROZEN_STRATEGIES.find((s) => s.family === family);
  if (!strategy || !strategy.horizons.includes(horizonSeconds)) return null;
  return { family, horizonSeconds, variantId: `${family}-${horizonSeconds}`, entryLogicHash: strategy.entryLogicHash, mode: "MANUAL" };
}

export async function getSelection(pool) {
  const row = (await pool.query("SELECT * FROM strategy_selection WHERE id=1")).rows[0];
  if (row) return row;
  await pool.query("INSERT INTO strategy_selection(id,mode,family,horizon_seconds,entry_logic_hash,variant_id,reason) VALUES(1,'MANUAL','V3',60,'acf733a866146537','V3-60','bootstrap') ON CONFLICT (id) DO NOTHING");
  return (await pool.query("SELECT * FROM strategy_selection WHERE id=1")).rows[0];
}

export async function setSelection(pool, { family, horizonSeconds, reason = "manual", actor = "ui", mode = "MANUAL" }) {
  const valid = validateSelection(family, horizonSeconds);
  if (!valid) return { ok: false, error: "INVALID_VARIANT" };
  const resolvedMode = mode === "AUTO" ? "AUTO" : "MANUAL";
  const current = await getSelection(pool);
  await pool.query("UPDATE strategy_selection SET mode=$7, family=$1, horizon_seconds=$2, entry_logic_hash=$3, variant_id=$4, reason=$5, actor=$6, updated_at=now() WHERE id=1", [valid.family, valid.horizonSeconds, valid.entryLogicHash, valid.variantId, String(reason).slice(0, 200), String(actor).slice(0, 64), resolvedMode]);
  await pool.query("INSERT INTO strategy_selection_audit(old_variant,new_variant,mode,reason,actor) VALUES($1,$2,$3,$4,$5)", [current?.variant_id ?? null, valid.variantId, resolvedMode, String(reason).slice(0, 200), String(actor).slice(0, 64)]);
  return { ok: true, selection: await getSelection(pool) };
}

export async function setAutoSelection(pool, { family, horizonSeconds, reason, metrics = {} }) {
  const valid = validateSelection(family, horizonSeconds);
  if (!valid) return { ok: false, error: "INVALID_VARIANT" };
  const current = await getSelection(pool);
  await pool.query("UPDATE strategy_selection SET mode='AUTO', family=$1, horizon_seconds=$2, entry_logic_hash=$3, variant_id=$4, reason=$5, actor='auto', updated_at=now() WHERE id=1", [valid.family, valid.horizonSeconds, valid.entryLogicHash, valid.variantId, String(reason).slice(0, 200)]);
  await pool.query("INSERT INTO strategy_selection_audit(old_variant,new_variant,mode,reason,metrics,actor) VALUES($1,$2,'AUTO',$3,$4::jsonb,'auto')", [current?.variant_id ?? null, valid.variantId, String(reason).slice(0, 200), JSON.stringify(metrics)]);
  return { ok: true, selection: await getSelection(pool) };
}

export async function activeObservations(pool) {
  const session = (await pool.query("SELECT id FROM live_sessions WHERE last_seen_at > now() - interval '2 minutes' ORDER BY last_seen_at DESC LIMIT 1")).rows[0];
  if (!session) return { session: null, observations: [] };
  const rows = (await pool.query("SELECT value, EXTRACT(EPOCH FROM observed_at)*1000 AS t, price_observation_id, segment_id, market_context_id, asset_canonical, market_type, context_validation_status FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' ORDER BY observed_at DESC LIMIT 5000", [session.id])).rows
    .map((r) => ({ t: Number(r.t), v: Number(r.value), id: r.price_observation_id, segment: r.segment_id, asset: r.asset_canonical, marketType: r.market_type, validation: r.context_validation_status }))
    .filter((o) => o.t > 0 && Number.isFinite(o.v));
  if (!rows.length) return { session: session.id, observations: [] };
  const latest = rows.reduce((a, b) => (b.t > a.t ? b : a));
  const observations = rows.filter((o) => (o.segment ?? null) === (latest.segment ?? null)).sort((a, b) => a.t - b.t);
  return { session: session.id, observations, asset: latest.asset ?? null, marketType: latest.marketType ?? null };
}

export async function frozenTick(pool, options = {}) {
  const now = options.now ?? Date.now();
  const settlement = await settleFrozenDue(pool, now);
  const { session, observations, asset } = await activeObservations(pool);
  if (!session) return { status: "NO_ACTIVE_SESSION", settlement };
  const candles = buildCandles(observations);
  if (candles.length < FROZEN_MIN_INDEX + 1) return { status: "INSUFFICIENT_HISTORY", candles: candles.length, settlement };
  let index = candles.length - 1;
  if (now < candles[index].start + FROZEN_BUCKET_MS) index -= 1; // somente candle completo
  const features = computeFrozenFeatures(candles, index);
  if (!features) return { status: "NO_FEATURES", settlement };
  let created = 0;
  for (const strategy of FROZEN_STRATEGIES) {
    const direction = evaluateFrozen(strategy.family, features);
    if (direction === null) continue;
    for (const horizon of strategy.horizons) {
      const inserted = await pool.query("INSERT INTO frozen_signals(session_id,segment_id,family,horizon_seconds,direction,signal_bucket,entry_price,strategy_hash,features) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT (family,horizon_seconds,signal_bucket) DO NOTHING", [session, observations[observations.length - 1]?.segment ?? null, strategy.family, horizon, direction, features.start, features.close, strategy.entryLogicHash, JSON.stringify({ s: features.s, vol12: features.vol12, r24: features.r24, inZone: features.fib.inZone, upSwing: features.fib.upSwing, structureUp: features.structureUp, structureDown: features.structureDown, asset })]);
      if (inserted.rowCount > 0) created += 1;
      await pool.query("INSERT INTO frozen_latest_signal(family,horizon_seconds,direction,signal_bucket,entry_price,entry_timestamp,strategy_hash,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (family,horizon_seconds) DO UPDATE SET direction=EXCLUDED.direction, signal_bucket=EXCLUDED.signal_bucket, entry_price=EXCLUDED.entry_price, entry_timestamp=EXCLUDED.entry_timestamp, updated_at=now()", [strategy.family, horizon, direction, features.start, features.close, features.start + FROZEN_BUCKET_MS, strategy.entryLogicHash]);
    }
  }
  return { status: "RUNNING", created, settlement, candles: candles.length, asset };
}

async function settleFrozenDue(pool, now) {
  const due = (await pool.query("SELECT * FROM frozen_signals WHERE settled_outcome IS NULL AND settlement_attempts < 20 AND signal_bucket + horizon_seconds*1000 + 5000 <= $1 ORDER BY signal_bucket ASC LIMIT 200", [now - 2000])).rows;
  let settled = 0;
  for (const signal of due) {
    const targetBucket = Number(signal.signal_bucket) + Number(signal.horizon_seconds) * 1000;
    const ref = (await pool.query("SELECT value FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND observed_at >= to_timestamp($2/1000.0) AND observed_at < to_timestamp($3/1000.0) AND ($4::text IS NULL OR segment_id = $4) ORDER BY observed_at DESC LIMIT 1", [signal.session_id, targetBucket, targetBucket + 5000, signal.segment_id ?? null])).rows[0];
    if (ref) {
      const outcome = settleFrozen(signal.direction, Number(signal.entry_price), Number(ref.value));
      await pool.query("UPDATE frozen_signals SET settled_outcome=$2, settlement_price=$3, settlement_bucket=$4, settled_at=now(), settlement_attempts=settlement_attempts+1 WHERE id=$1 AND settled_outcome IS NULL", [signal.id, outcome, Number(ref.value), targetBucket]);
      settled += 1;
    } else {
      await pool.query("UPDATE frozen_signals SET settlement_attempts=settlement_attempts+1 WHERE id=$1 AND settled_outcome IS NULL", [signal.id]);
    }
  }
  return { settled };
}

export async function frozenStats(pool, limit = 20000) {
  const rows = (await pool.query("SELECT id, family, horizon_seconds, direction, signal_bucket, entry_price, strategy_hash, settled_outcome, settlement_price, settled_at FROM frozen_signals ORDER BY signal_bucket DESC LIMIT $1", [Math.min(50000, Math.max(100, Number(limit) || 20000))])).rows;
  const byVariant = new Map();
  for (const row of rows) {
    const key = `${row.family}-${row.horizon_seconds}`;
    const entry = byVariant.get(key) ?? { family: row.family, horizonSeconds: Number(row.horizon_seconds), signals: 0, wins: 0, losses: 0, draws: 0, unknown: 0, pending: 0, buySignals: 0, buyWins: 0, buyLosses: 0, sellSignals: 0, sellWins: 0, sellLosses: 0, lastSignal: null, lastResult: null, independentN: 0, independentWins: 0, independentLosses: 0, lastBucket: null };
    entry.signals += 1;
    if (row.settled_outcome === "WIN") entry.wins += 1; else if (row.settled_outcome === "LOSS") entry.losses += 1; else if (row.settled_outcome === "DRAW") entry.draws += 1; else if (row.settled_outcome === "UNKNOWN") entry.unknown += 1; else entry.pending += 1;
    if (row.direction === "BUY") { entry.buySignals += 1; if (row.settled_outcome === "WIN") entry.buyWins += 1; if (row.settled_outcome === "LOSS") entry.buyLosses += 1; } else { entry.sellSignals += 1; if (row.settled_outcome === "WIN") entry.sellWins += 1; if (row.settled_outcome === "LOSS") entry.sellLosses += 1; }
    if (entry.lastSignal === null) entry.lastSignal = { direction: row.direction, signalBucket: Number(row.signal_bucket), entryPrice: Number(row.entry_price), hash: row.strategy_hash };
    if (entry.lastResult === null && row.settled_outcome !== null) entry.lastResult = { outcome: row.settled_outcome, settlementPrice: row.settlement_price === null ? null : Number(row.settlement_price) };
    byVariant.set(key, entry);
  }
  // independencia conservadora (greedy por horizonte) — usa linhas decididas em ordem crescente
  for (const entry of byVariant.values()) {
    const decided = rows.filter((r) => r.family === entry.family && Number(r.horizon_seconds) === entry.horizonSeconds && (r.settled_outcome === "WIN" || r.settled_outcome === "LOSS")).sort((a, b) => Number(a.signal_bucket) - Number(b.signal_bucket));
    let last = -Infinity;
    for (const row of decided) {
      const bucket = Number(row.signal_bucket);
      if (bucket - last >= entry.horizonSeconds * 1000) { entry.independentN += 1; if (row.settled_outcome === "WIN") entry.independentWins += 1; else entry.independentLosses += 1; last = bucket; }
    }
  }
  return [...byVariant.values()].sort((a, b) => a.family.localeCompare(b.family) || a.horizonSeconds - b.horizonSeconds);
}

export async function selectionAudit(pool, limit = 50) {
  return (await pool.query("SELECT old_variant,new_variant,mode,reason,metrics,actor,created_at FROM strategy_selection_audit ORDER BY created_at DESC LIMIT $1", [Math.min(200, limit)])).rows;
}

export function wrOf(entry) {
  const decided = entry.wins + entry.losses;
  return decided > 0 ? +((entry.wins / decided) * 100).toFixed(2) : null;
}

export async function frozenHistory(pool, limit = 200) {
  return (await pool.query("SELECT family,horizon_seconds,direction,signal_bucket,entry_price,strategy_hash,settled_outcome,settlement_price,settlement_bucket,settled_at,created_at FROM frozen_signals ORDER BY signal_bucket DESC LIMIT $1", [Math.min(500, Math.max(10, Number(limit) || 200))])).rows;
}

export const AUTO_BREAKEVEN_WR = 52.91;
export const AUTO_MIN_EDGE_PP = 2.0;
export const AUTO_MIN_INDEPENDENT_N = 30;
export const AUTO_TIE_DELTA = 0.005;

function autoWilsonLower(wins, n) {
  if (n <= 0) return null;
  const z = 1.96, p = wins / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return Math.max(0, c - h);
}

/** Politica AUTO deterministica (paridade com src/strategies/auto.ts). Mantem a selecao se nada elegivel. */
export async function maybeAutoSelect(pool) {
  const selection = await getSelection(pool);
  if (selection.mode !== "AUTO") return { changed: false, reason: "MODE_MANUAL" };
  const stats = await frozenStats(pool);
  const eligible = stats.map((entry) => {
    const decidedIndep = entry.independentWins + entry.independentLosses;
    const wr = decidedIndep > 0 ? +((entry.independentWins / decidedIndep) * 100).toFixed(2) : null;
    const wilson = autoWilsonLower(entry.independentWins, entry.independentN);
    const ok = entry.independentN >= AUTO_MIN_INDEPENDENT_N && wr !== null && wr >= AUTO_BREAKEVEN_WR + AUTO_MIN_EDGE_PP && wilson !== null;
    return { entry, wr, wilson, ok };
  }).filter((x) => x.ok);
  if (eligible.length === 0) return { changed: false, reason: "AUTO_KEEP_NO_ELIGIBLE" };
  eligible.sort((a, b) => {
    const delta = b.wilson - a.wilson;
    if (Math.abs(delta) > AUTO_TIE_DELTA) return delta;
    if (b.entry.independentN !== a.entry.independentN) return b.entry.independentN - a.entry.independentN;
    const aIndex = FROZEN_VARIANTS.findIndex((v) => v.variantId === `${a.entry.family}-${a.entry.horizonSeconds}`);
    const bIndex = FROZEN_VARIANTS.findIndex((v) => v.variantId === `${b.entry.family}-${b.entry.horizonSeconds}`);
    return aIndex - bIndex;
  });
  const best = eligible[0];
  const bestId = `${best.entry.family}-${best.entry.horizonSeconds}`;
  if (bestId === selection.variant_id) return { changed: false, reason: "AUTO_KEEP" };
  const metrics = eligible.slice(0, 5).map((x) => ({ variantId: `${x.entry.family}-${x.entry.horizonSeconds}`, wr: x.wr, n: x.entry.independentN, wilsonLower: +x.wilson.toFixed(4) }));
  const result = await setAutoSelection(pool, { family: best.entry.family, horizonSeconds: best.entry.horizonSeconds, reason: `AUTO switch -> ${bestId} (wilsonLo=${best.wilson.toFixed(4)}, n=${best.entry.independentN})`, metrics: { ranked: metrics } });
  return { changed: result.ok === true, reason: result.ok ? "AUTO_SWITCH" : "AUTO_FAILED", selection: result.selection ?? null };
}
