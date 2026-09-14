/**
 * TraceCom shadow experiment engine (persistent, causal, shadow-only).
 *
 * Runs inside the long-lived relay process. It consumes real accepted
 * PriceObservations from the active shared session, derives causal 5s candles,
 * evaluates deterministic shadow strategies, persists directional shadow trades,
 * and settles each trade exactly 60s later using same-session causal prices.
 *
 * No broker automation. No synthetic prices. Restart-safe: all state lives in
 * PostgreSQL and unsettled trades are recovered by the settlement sweep.
 */
export const EXPERIMENT_HORIZON_MS = 60_000;
export const EXPERIMENT_BUCKET_MS = 5_000;
export const EXPERIMENT_TARGET_TRADES = 10_000;
export const EXPERIMENT_DISCOVERY_TRADES = 5_000;
export const SETTLEMENT_TOLERANCE_MS = 30_000;
export const SETTLEMENT_GRACE_MS = 15_000;
export const MIN_CANDLES = 24;
export const STRATEGY_HORIZON_MS = { "shadow-reversion-v6": 45_000 };
export const horizonFor = (strategyVersion) => STRATEGY_HORIZON_MS[strategyVersion] ?? EXPERIMENT_HORIZON_MS;
export const STRATEGY_VERSIONS = ["shadow-momentum-v1", "shadow-trend-v1", "shadow-reversion-v1", "shadow-reversion-v2", "shadow-reversion-v3", "shadow-reversion-v4", "shadow-pullback-v1", "shadow-snapback-v1", "shadow-dual-rsi-v1", "shadow-bollinger-rsi-v1", "shadow-macd-rsi-v1", "shadow-reversion-v5", "shadow-reversion-v6"];

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function buildCandles(observations) {
  const map = new Map();
  for (const o of observations) {
    if (!Number.isFinite(o.t) || !Number.isFinite(o.v)) continue;
    const bucket = Math.floor(o.t / EXPERIMENT_BUCKET_MS) * EXPERIMENT_BUCKET_MS;
    const c = map.get(bucket);
    if (!c) map.set(bucket, { start: bucket, end: bucket + EXPERIMENT_BUCKET_MS, open: o.v, high: o.v, low: o.v, close: o.v, n: 1 });
    else { c.high = Math.max(c.high, o.v); c.low = Math.min(c.low, o.v); c.close = o.v; c.n += 1; }
  }
  return [...map.values()].sort((a, b) => a.start - b.start);
}

export function computeFeatures(candles) {
  const closes = candles.map((c) => c.close);
  const n = closes.length;
  const ret = (k) => (n > k && closes[n - 1 - k] ? (closes[n - 1] - closes[n - 1 - k]) / closes[n - 1 - k] : null);
  const emaOver = (arr, p) => { if (arr.length < p) return null; const a = 2 / (p + 1); let e = arr.slice(0, p).reduce((s, x) => s + x, 0) / p; for (let i = p; i < arr.length; i++) e = arr[i] * a + e * (1 - a); return e; };
  const ema = (p) => emaOver(closes, p);
  const rsiOver = (arr, p) => { if (arr.length <= p) return null; let g = 0, l = 0; for (let i = arr.length - p; i < arr.length; i++) { const d = arr[i] - arr[i - 1]; if (d >= 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
  const ema9 = ema(9), ema21 = ema(21), ema12 = ema(12), ema26 = ema(26);
  const rsi = rsiOver(closes, 14);
  const rsi3 = rsiOver(closes, 3);
  const macdHist = ema12 !== null && ema26 !== null ? ema12 - ema26 : null;
  let macdHistPrev = null;
  if (n >= 27) { const prev = closes.slice(0, n - 1); const e12 = emaOver(prev, 12), e26 = emaOver(prev, 26); if (e12 !== null && e26 !== null) macdHistPrev = e12 - e26; }
  let bbUpper = null, bbLower = null;
  if (n >= 20) { const w = closes.slice(n - 20); const m = w.reduce((s, x) => s + x, 0) / w.length; const sd = Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / w.length); bbUpper = m + 2 * sd; bbLower = m - 2 * sd; }
  let vol = null;
  if (n > 13) { const rs = []; for (let i = n - 12; i < n; i++) rs.push((closes[i] - closes[i - 1]) / closes[i - 1]); const m = rs.reduce((s, x) => s + x, 0) / rs.length; vol = Math.sqrt(rs.reduce((s, x) => s + (x - m) ** 2, 0) / rs.length); }
  return { momentum30: ret(6), momentum60: ret(12), momentum120: ret(24), slope: ema9 !== null && ema21 ? (ema9 - ema21) / ema21 : null, rsi, rsi3, ema12, ema26, macdHist, macdHistPrev, bbUpper, bbLower, vol, last: closes[n - 1] ?? null };
}

export function evaluateStrategies(f) {
  const score = (v, scale) => (v === null ? 0 : clamp(v / scale, -1, 1));
  const raw = [];
  { const s = score(f.momentum30, .0008) * .6 + score(f.momentum60, .0012) * .4; raw.push({ strategyVersion: "shadow-momentum-v1", direction: s > .25 ? "BUY" : s < -.25 ? "SELL" : "WAIT", score: s }); }
  { const s = score(f.slope, .0008) * .7 + score(f.momentum120, .002) * .3; raw.push({ strategyVersion: "shadow-trend-v1", direction: s > .3 ? "BUY" : s < -.3 ? "SELL" : "WAIT", score: s }); }
  { const volOk = f.vol !== null && f.vol < .0009; const s = f.rsi === null ? 0 : (55 - f.rsi) / 45; raw.push({ strategyVersion: "shadow-reversion-v1", direction: volOk && s > .33 ? "BUY" : volOk && s < -.33 ? "SELL" : "WAIT", score: s }); }
  { const volOk = f.vol !== null && f.vol < .0012; const s = f.rsi === null ? 0 : (55 - f.rsi) / 45; raw.push({ strategyVersion: "shadow-reversion-v2", direction: volOk && s > .22 ? "BUY" : volOk && s < -.22 ? "SELL" : "WAIT", score: s }); }
  { const volOk = f.vol !== null && f.vol < .0012; const s = f.rsi === null ? 0 : (55 - f.rsi) / 45; const up = f.momentum120 !== null && f.momentum120 > 0; const down = f.momentum120 !== null && f.momentum120 < 0; raw.push({ strategyVersion: "shadow-reversion-v3", direction: volOk && s > .22 && up ? "BUY" : volOk && s < -.22 && down ? "SELL" : "WAIT", score: s }); }
  { const volOk = f.vol !== null && f.vol < .0012; const s = f.rsi === null ? 0 : (55 - f.rsi) / 45; const up = f.momentum120 !== null && f.momentum120 > 0; const down = f.momentum120 !== null && f.momentum120 < 0; const turningUp = f.momentum30 !== null && f.momentum30 > 0; const turningDown = f.momentum30 !== null && f.momentum30 < 0; raw.push({ strategyVersion: "shadow-reversion-v4", direction: volOk && s > .22 && up && turningUp ? "BUY" : volOk && s < -.22 && down && turningDown ? "SELL" : "WAIT", score: s }); }
  { const up = f.slope !== null && f.slope > 0; const down = f.slope !== null && f.slope < 0; const rec = f.momentum30 !== null && f.momentum30 > 0; const drop = f.momentum30 !== null && f.momentum30 < 0; const s = f.rsi === null ? 0 : (50 - f.rsi) / 50; raw.push({ strategyVersion: "shadow-pullback-v1", direction: up && f.rsi !== null && f.rsi < 42 && rec ? "BUY" : down && f.rsi !== null && f.rsi > 58 && drop ? "SELL" : "WAIT", score: s }); }
  { const tr = f.momentum120 === null ? 0 : Math.sign(f.momentum120); const s = f.rsi3 === null ? 0 : (55 - f.rsi3) / 45; raw.push({ strategyVersion: "shadow-snapback-v1", direction: tr > 0 && f.rsi3 !== null && f.rsi3 < 15 ? "BUY" : tr < 0 && f.rsi3 !== null && f.rsi3 > 85 ? "SELL" : "WAIT", score: s }); }
  { const s = f.rsi3 === null ? 0 : (55 - f.rsi3) / 45; raw.push({ strategyVersion: "shadow-dual-rsi-v1", direction: f.rsi3 !== null && f.rsi3 < 30 && f.rsi !== null && f.rsi > 45 ? "BUY" : f.rsi3 !== null && f.rsi3 > 70 && f.rsi !== null && f.rsi < 55 ? "SELL" : "WAIT", score: s }); }
  { const s = f.rsi === null ? 0 : (55 - f.rsi) / 45; raw.push({ strategyVersion: "shadow-bollinger-rsi-v1", direction: f.last !== null && f.bbLower !== null && f.last <= f.bbLower && f.rsi !== null && f.rsi < 30 ? "BUY" : f.last !== null && f.bbUpper !== null && f.last >= f.bbUpper && f.rsi !== null && f.rsi > 70 ? "SELL" : "WAIT", score: s }); }
  { const climb = f.macdHist !== null && f.macdHistPrev !== null && f.macdHist > f.macdHistPrev; const fall = f.macdHist !== null && f.macdHistPrev !== null && f.macdHist < f.macdHistPrev; const s = f.macdHist === null ? 0 : clamp(f.macdHist * 20000, -1, 1); raw.push({ strategyVersion: "shadow-macd-rsi-v1", direction: f.rsi !== null && f.rsi < 50 && f.macdHist !== null && f.macdHist > 0 && climb ? "BUY" : f.rsi !== null && f.rsi > 50 && f.macdHist !== null && f.macdHist < 0 && fall ? "SELL" : "WAIT", score: s }); }
  { const volOk = f.vol !== null && f.vol < .0009; const s = f.rsi === null ? 0 : (55 - f.rsi) / 45; const deep = Math.abs(s) >= .63 && Math.abs(s) <= .857; raw.push({ strategyVersion: "shadow-reversion-v5", direction: volOk && deep && s > 0 ? "BUY" : volOk && deep && s < 0 ? "SELL" : "WAIT", score: s }); }
  { const volOk = f.vol !== null && f.vol < .0009; const s = f.rsi === null ? 0 : (55 - f.rsi) / 45; const deep = Math.abs(s) >= .63 && Math.abs(s) <= .857; raw.push({ strategyVersion: "shadow-reversion-v6", direction: volOk && deep && s > 0 ? "BUY" : volOk && deep && s < 0 ? "SELL" : "WAIT", score: s }); }
  return raw.map((x) => {
    const edge = Math.abs(x.score);
    const pDir = clamp(.5 + edge * .35, .5, .9);
    const pWait = clamp(1 - edge * 1.2, .05, .5);
    const rest = (1 - pWait) / 2;
    const pBuy = x.direction === "BUY" ? pDir * (1 - pWait) : x.direction === "SELL" ? (1 - pDir) * (1 - pWait) : rest;
    const pSell = x.direction === "SELL" ? pDir * (1 - pWait) : x.direction === "BUY" ? (1 - pDir) * (1 - pWait) : rest;
    const total = pBuy + pSell + pWait;
    return { ...x, pBuy: pBuy / total, pSell: pSell / total, pWait: pWait / total, confidence: pDir, probabilitySource: "EVIDENCE_MODEL" };
  });
}

export function settleOutcome(direction, entryPrice, exitPrice) {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice)) return "UNKNOWN";
  if (exitPrice === entryPrice) return "DRAW";
  if (direction === "BUY") return exitPrice > entryPrice ? "WIN" : "LOSS";
  return exitPrice < entryPrice ? "WIN" : "LOSS";
}

export function wilsonLower(wins, total, z = 1.96) {
  if (total <= 0) return null;
  const p = wins / total, d = 1 + (z * z) / total;
  const c = (p + (z * z) / (2 * total)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / d;
  return Math.max(0, c - h);
}

async function ensureExperiment(pool, now, targetAsset, targetTrades) {
  let exp = (await pool.query("SELECT * FROM shadow_experiments ORDER BY created_at ASC LIMIT 1")).rows[0];
  if (!exp) exp = (await pool.query("INSERT INTO shadow_experiments(experiment_id,target_trades,target_asset,phase,status,started_at) VALUES($1,$2,$3,'DISCOVERY','RUNNING',$4) RETURNING *", [`shadow_${now}`, targetTrades, targetAsset, now])).rows[0];
  else if (exp.target_asset !== targetAsset && exp.phase !== "COMPLETE" && !exp.validation_started_at) exp = (await pool.query("UPDATE shadow_experiments SET target_asset=$2, updated_at=now() WHERE experiment_id=$1 RETURNING *", [exp.experiment_id, targetAsset])).rows[0];
  return exp;
}

export function shouldAttemptSettlement(now, settlementTargetAt, graceMs = SETTLEMENT_GRACE_MS) {
  return Number.isFinite(now) && Number.isFinite(settlementTargetAt) && now >= settlementTargetAt + graceMs;
}

async function findSettlementObservation(pool, trade, toleranceMs) {
  const target = Number(trade.settlement_target_at);
  return (await pool.query("SELECT value, price_observation_id, EXTRACT(EPOCH FROM observed_at)*1000 AS t FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND observed_at >= to_timestamp($2/1000.0) AND observed_at <= to_timestamp($3/1000.0) AND ($4::text IS NULL OR segment_id = $4) ORDER BY observed_at ASC LIMIT 1", [trade.session_id, target, target + toleranceMs, trade.segment_id ?? null])).rows[0] ?? null;
}

async function bumpCounters(pool, trade, now) {
  const phase = trade.phase === "VALIDATION" ? "VALIDATION" : "DISCOVERY";
  await pool.query(`UPDATE shadow_experiments SET valid_settled_trades = valid_settled_trades + 1, ${phase === "VALIDATION" ? "validation_count" : "discovery_count"} = ${phase === "VALIDATION" ? "validation_count" : "discovery_count"} + 1, last_trade_at=$2, updated_at=now() WHERE experiment_id=$1`, [trade.experiment_id, now]);
}

async function resolveTrade(pool, trade, now, toleranceMs) {
  const ref = await findSettlementObservation(pool, trade, toleranceMs);
  const result = settleOutcome(trade.decision, Number(trade.reference_price), ref ? Number(ref.value) : NaN);
  await pool.query("UPDATE shadow_trades SET settlement_price=$2, settlement_price_observation_id=$3, settlement_observed_at=$4, result=$5, settled_at=$6 WHERE trade_id=$1 AND result IS NULL", [trade.trade_id, ref ? Number(ref.value) : null, ref ? ref.price_observation_id : null, ref ? Number(ref.t) : null, result, now]);
  if (result === "WIN" || result === "LOSS" || result === "DRAW") { await bumpCounters(pool, trade, now); return 1; }
  return 0;
}

async function settleDueTrades(pool, now) {
  const due = (await pool.query("SELECT t.* FROM shadow_trades t WHERE t.result IS NULL AND t.settlement_target_at + $1 <= $2 ORDER BY t.settlement_target_at ASC LIMIT 200", [SETTLEMENT_GRACE_MS, now])).rows;
  let settled = 0, counted = 0;
  for (const trade of due) { settled += 1; counted += await resolveTrade(pool, trade, now, SETTLEMENT_TOLERANCE_MS); }
  const retryable = (await pool.query("SELECT * FROM shadow_trades WHERE result='UNKNOWN' AND retry_count < 3 AND (last_retry_at IS NULL OR last_retry_at + 30000 <= $1) ORDER BY settlement_target_at ASC LIMIT 100", [now])).rows;
  for (const trade of retryable) {
    const ref = await findSettlementObservation(pool, trade, 120_000);
    if (ref) {
      const result = settleOutcome(trade.decision, Number(trade.reference_price), Number(ref.value));
      const updated = await pool.query("UPDATE shadow_trades SET settlement_price=$2, settlement_price_observation_id=$3, settlement_observed_at=$4, result=$5, settled_at=$6, retry_count=retry_count+1, last_retry_at=$6 WHERE trade_id=$1 AND result='UNKNOWN'", [trade.trade_id, Number(ref.value), ref.price_observation_id, Number(ref.t), result, now]);
      if (updated.rowCount > 0 && (result === "WIN" || result === "LOSS" || result === "DRAW")) { counted += 1; await bumpCounters(pool, trade, now); }
    } else await pool.query("UPDATE shadow_trades SET retry_count=retry_count+1, last_retry_at=$2 WHERE trade_id=$1", [trade.trade_id, now]);
  }
  return { settled, counted };
}

async function freezeFinalists(pool, experimentId, now) {
  const rows = (await pool.query("SELECT strategy_version, COUNT(*) FILTER (WHERE result IN ('WIN','LOSS')) AS n, COUNT(*) FILTER (WHERE result='WIN') AS wins FROM shadow_trades WHERE experiment_id=$1 AND phase='DISCOVERY' GROUP BY strategy_version", [experimentId])).rows;
  const scored = rows.map((r) => ({ strategyVersion: r.strategy_version, n: Number(r.n), wins: Number(r.wins), wilson: wilsonLower(Number(r.wins), Number(r.n)) })).filter((r) => r.n >= 100).sort((a, b) => (b.wilson ?? 0) - (a.wilson ?? 0));
  const finalists = scored.length ? scored.slice(0, 3) : rows.map((r) => ({ strategyVersion: r.strategy_version, n: Number(r.n), wins: Number(r.wins), wilson: null })).slice(0, 3);
  await pool.query("UPDATE shadow_experiments SET phase='VALIDATION', status='VALIDATION_RUNNING', validation_started_at=$2, frozen_strategy_versions=$3::jsonb, updated_at=now() WHERE experiment_id=$1", [experimentId, now, JSON.stringify(finalists)]);
  return finalists;
}

async function recordCheckpoint(pool, exp, now) {
  const count = Number(exp.valid_settled_trades);
  if (count === 0 || count % 1000 !== 0) return;
  const existing = (await pool.query("SELECT 1 FROM shadow_experiment_checkpoints WHERE experiment_id=$1 AND at_trade=$2", [exp.experiment_id, count])).rowCount;
  if (existing) return;
  const perStrategy = (await pool.query("SELECT strategy_version, COUNT(*) AS settled, COUNT(*) FILTER (WHERE result='WIN') AS wins, COUNT(*) FILTER (WHERE result='LOSS') AS losses, COUNT(*) FILTER (WHERE result='DRAW') AS draws FROM shadow_trades WHERE experiment_id=$1 AND result IN ('WIN','LOSS','DRAW') GROUP BY strategy_version", [exp.experiment_id])).rows;
  const metrics = { validSettledTrades: count, discoveryCount: Number(exp.discovery_count), validationCount: Number(exp.validation_count), uniqueMarketEvents: Number(exp.unique_market_events), evaluations: Number(exp.evaluations), phase: exp.phase, perStrategy };
  await pool.query("INSERT INTO shadow_experiment_checkpoints(experiment_id, at_trade, metrics) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING", [exp.experiment_id, count, JSON.stringify(metrics)]);
  console.info("SHADOW_EXPERIMENT_CHECKPOINT", JSON.stringify({ experimentId: exp.experiment_id, atTrade: count, phase: exp.phase }));
}

let lastAssetMismatchKey = null;

async function dominantLiveAsset(pool) {
  const row = (await pool.query("SELECT asset_canonical AS asset, COUNT(*)::int AS observations, MAX(observed_at) AS last_seen FROM price_observations WHERE status='ACCEPTED' AND asset_canonical IS NOT NULL AND market_type='OTC' AND context_validation_status='VALID' AND observed_at > now() - interval '10 minutes' GROUP BY asset_canonical ORDER BY observations DESC LIMIT 1")).rows[0];
  return row ?? null;
}

export async function experimentTick(pool, options = {}) {
  const now = options.now ?? Date.now();
  const targetAsset = options.targetAsset ?? process.env.SHADOW_EXPERIMENT_ASSET ?? "USD/CAD";
  const targetTrades = options.targetTrades ?? EXPERIMENT_TARGET_TRADES;
  const exp = await ensureExperiment(pool, now, targetAsset, targetTrades);
  const settlement = await settleDueTrades(pool, now);
  const fresh = (await pool.query("SELECT * FROM shadow_experiments WHERE experiment_id=$1", [exp.experiment_id])).rows[0];
  await recordCheckpoint(pool, fresh, now);
  if (fresh.phase === "COMPLETE") return { status: "COMPLETE", settlement, validSettledTrades: Number(fresh.valid_settled_trades) };
  if (Number(fresh.valid_settled_trades) >= Number(fresh.target_trades)) {
    const remaining = (await pool.query("SELECT COUNT(*)::int AS n FROM shadow_trades WHERE experiment_id=$1 AND result IS NULL", [fresh.experiment_id])).rows[0].n;
    if (remaining === 0) { await pool.query("UPDATE shadow_experiments SET phase='COMPLETE', status='COMPLETE', updated_at=now() WHERE experiment_id=$1", [fresh.experiment_id]); return { status: "COMPLETE", settlement, validSettledTrades: Number(fresh.valid_settled_trades) }; }
    return { status: "FINALIZING", settlement, validSettledTrades: Number(fresh.valid_settled_trades) };
  }
  const session = (await pool.query("SELECT id FROM live_sessions WHERE last_seen_at > now() - interval '2 minutes' ORDER BY last_seen_at DESC LIMIT 1")).rows[0];
  if (!session) return { status: fresh.status, reason: "NO_ACTIVE_SESSION", settlement };
  const live = await dominantLiveAsset(pool);
  if (live && live.asset !== targetAsset) {
    const key = `${fresh.experiment_id}:${live.asset}`;
    if (lastAssetMismatchKey !== key) {
      lastAssetMismatchKey = key;
      console.info("SHADOW_EXPERIMENT_ASSET_MISMATCH", JSON.stringify({ experimentId: fresh.experiment_id, targetAsset, liveAsset: live.asset, observations: live.observations, lastSeenAt: live.last_seen }));
    }
    return { status: fresh.status, reason: "ASSET_MISMATCH", targetAsset, liveAsset: live.asset, settlement };
  }
  lastAssetMismatchKey = null;
  const observations = (await pool.query("SELECT value, EXTRACT(EPOCH FROM observed_at)*1000 AS t, price_observation_id, segment_id, market_context_id, asset_canonical, market_type, context_validation_status FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' ORDER BY observed_at DESC LIMIT 5000", [session.id])).rows
    .map((r) => ({ t: Number(r.t), v: Number(r.value), id: r.price_observation_id, segment: r.segment_id, context: r.market_context_id, asset: r.asset_canonical, marketType: r.market_type, validation: r.context_validation_status }))
    .filter((o) => o.t > 0 && Number.isFinite(o.v) && o.asset === targetAsset && o.marketType === "OTC" && o.validation === "VALID")
    .sort((a, b) => a.t - b.t);
  const candles = buildCandles(observations);
  if (candles.length < MIN_CANDLES) return { status: fresh.status, reason: "INSUFFICIENT_CAUSAL_HISTORY", candles: candles.length, settlement };
  const last = candles[candles.length - 1];
  if (now - last.start > EXPERIMENT_BUCKET_MS * 3) return { status: fresh.status, reason: "STALE_OBSERVATIONS", lastCandle: last.start, settlement };
  const marketEventId = `${session.id}:${last.start}`;
  const features = computeFeatures(candles);
  let strategies = evaluateStrategies(features);
  if (fresh.phase === "VALIDATION" && Array.isArray(fresh.frozen_strategy_versions)) {
    const allowed = new Set((fresh.frozen_strategy_versions ?? []).map((x) => x.strategyVersion));
    strategies = strategies.filter((s) => allowed.has(s.strategyVersion));
  }
  const eventExists = (await pool.query("SELECT 1 FROM shadow_trades WHERE market_event_id=$1 LIMIT 1", [marketEventId])).rowCount > 0;
  const reference = observations[observations.length - 1];
  let created = 0, evaluated = 0;
  for (const strategy of strategies) {
    if (strategy.direction !== "BUY" && strategy.direction !== "SELL") { evaluated += 1; continue; }
    const exists = (await pool.query("SELECT 1 FROM shadow_trades WHERE market_event_id=$1 AND strategy_version=$2", [marketEventId, strategy.strategyVersion])).rowCount > 0;
    if (exists) continue;
    const tradeId = `${strategy.strategyVersion}_${last.start}_${Math.random().toString(36).slice(2, 8)}`;
    const inserted = await pool.query("INSERT INTO shadow_trades(trade_id, experiment_id, market_event_id, strategy_version, decision, confidence, p_buy, p_sell, p_wait, probability_source, regime, reference_price, reference_price_observation_id, reference_timestamp, settlement_target_at, session_id, market_context_id, segment_id, asset_canonical, market_type, created_at, phase) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) ON CONFLICT (market_event_id, strategy_version) DO NOTHING",
      [tradeId, fresh.experiment_id, marketEventId, strategy.strategyVersion, strategy.direction, strategy.confidence, strategy.pBuy, strategy.pSell, strategy.pWait, strategy.probabilitySource, null, reference.v, reference.id, reference.t, reference.t + horizonFor(strategy.strategyVersion), session.id, reference.context, reference.segment, reference.asset, reference.marketType, now, fresh.phase === "VALIDATION" ? "VALIDATION" : "DISCOVERY"]);
    if (inserted.rowCount > 0) { created += 1; evaluated += 1; }
  }
  await pool.query("UPDATE shadow_experiments SET evaluations = evaluations + $2, unique_market_events = unique_market_events + $3, last_trade_at = CASE WHEN $4 > 0 THEN $5 ELSE last_trade_at END, updated_at = now() WHERE experiment_id=$1", [fresh.experiment_id, evaluated, !eventExists && created > 0 ? 1 : 0, created, now]);
  const after = (await pool.query("SELECT * FROM shadow_experiments WHERE experiment_id=$1", [fresh.experiment_id])).rows[0];
  if (after.phase === "DISCOVERY" && Number(after.discovery_count) >= EXPERIMENT_DISCOVERY_TRADES) {
    const finalists = await freezeFinalists(pool, after.experiment_id, now);
    console.info("SHADOW_EXPERIMENT_FROZEN", JSON.stringify({ experimentId: after.experiment_id, finalists }));
  }
  return { status: "RUNNING", created, settlement, validSettledTrades: Number(after.valid_settled_trades) };
}

export async function experimentStatus(pool) {
  const exp = (await pool.query("SELECT * FROM shadow_experiments ORDER BY created_at ASC LIMIT 1")).rows[0] ?? null;
  if (!exp) return { experiment: null, status: "NOT_STARTED" };
  const perStrategy = (await pool.query("SELECT strategy_version, COUNT(*)::int AS trades, COUNT(*) FILTER (WHERE result='WIN')::int AS wins, COUNT(*) FILTER (WHERE result='LOSS')::int AS losses, COUNT(*) FILTER (WHERE result='DRAW')::int AS draws, COUNT(*) FILTER (WHERE result='UNKNOWN')::int AS unknown, COUNT(*) FILTER (WHERE result IS NULL)::int AS pending FROM shadow_trades WHERE experiment_id=$1 GROUP BY strategy_version", [exp.experiment_id])).rows;
  const live = await dominantLiveAsset(pool);
  const checkpoints = (await pool.query("SELECT at_trade, metrics, created_at FROM shadow_experiment_checkpoints WHERE experiment_id=$1 ORDER BY at_trade ASC", [exp.experiment_id])).rows;
  return { experiment: exp, liveAsset: live?.asset ?? null, liveAssetObservations: live?.observations ?? 0, liveAssetLastSeenAt: live?.last_seen ?? null, assetMismatch: live ? live.asset !== exp.target_asset : false, perStrategy, checkpoints, brokerAutomation: "NONE", shadowOnly: true };
}

export async function experimentTrades(pool, limit = 100) {
  const trades = (await pool.query("SELECT trade_id, strategy_version, decision, confidence, p_buy, p_sell, p_wait, reference_price, reference_timestamp, settlement_price, settlement_target_at, settlement_observed_at, result, asset_canonical, market_type, segment_id, created_at, settled_at FROM shadow_trades ORDER BY created_at DESC LIMIT $1", [Math.max(1, Math.min(500, Number(limit) || 100))])).rows;
  return { trades, brokerAutomation: "NONE", shadowOnly: true };
}

export async function retroEvaluate(pool, { strategies = null, maxCreations = 400, now = Date.now() } = {}) {
  const exp = (await pool.query("SELECT * FROM shadow_experiments ORDER BY created_at ASC LIMIT 1")).rows[0];
  if (!exp) return { created: 0, reason: "NO_EXPERIMENT" };
  if (exp.phase !== "DISCOVERY") return { created: 0, reason: "FROZEN_OR_COMPLETE" };
  const allowed = new Set(strategies && strategies.length ? strategies : STRATEGY_VERSIONS);
  const sessions = (await pool.query("SELECT session_id FROM price_observations WHERE status='ACCEPTED' GROUP BY session_id ORDER BY MAX(observed_at) DESC LIMIT 50")).rows.map((r) => r.session_id);
  let created = 0, counted = 0, evaluations = 0, newEvents = 0;
  for (const sid of sessions) {
    if (created >= maxCreations) break;
    const rows = (await pool.query("SELECT value, EXTRACT(EPOCH FROM observed_at)*1000 AS t, price_observation_id, segment_id, market_context_id, asset_canonical, market_type, context_validation_status FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' ORDER BY observed_at ASC", [sid])).rows
      .map((r) => ({ t: Number(r.t), v: Number(r.value), id: r.price_observation_id, segment: r.segment_id, context: r.market_context_id, asset: r.asset_canonical, marketType: r.market_type, validation: r.context_validation_status }))
      .filter((o) => o.t > 0 && Number.isFinite(o.v) && o.asset === exp.target_asset && o.marketType === "OTC" && o.validation === "VALID");
    const groups = new Map();
    for (const o of rows) { const key = o.segment ?? "none"; groups.set(key, [...(groups.get(key) ?? []), o]); }
    for (const [segment, group] of groups) {
      if (created >= maxCreations) break;
      const candles = buildCandles(group);
      if (candles.length < MIN_CANDLES) continue;
      for (let i = MIN_CANDLES - 1; i < candles.length && created < maxCreations; i++) {
        const candle = candles[i];
        const marketEventId = `${sid}:${candle.start}`;
        const eventHadTrades = (await pool.query("SELECT 1 FROM shadow_trades WHERE market_event_id=$1 LIMIT 1", [marketEventId])).rowCount > 0;
        const allEvals = evaluateStrategies(computeFeatures(candles.slice(0, i + 1))).filter((s) => allowed.has(s.strategyVersion));
        evaluations += allEvals.length;
        const evals = allEvals.filter((s) => s.direction === "BUY" || s.direction === "SELL");
        if (!evals.length) continue;
        const reference = [...group].reverse().find((o) => o.t <= candle.start + EXPERIMENT_BUCKET_MS);
        if (!reference) continue;
        let eventCreated = 0;
        for (const strategy of evals) {
          const horizon = horizonFor(strategy.strategyVersion);
          const settleRef = group.find((o) => o.t >= reference.t + horizon && o.t <= reference.t + horizon + SETTLEMENT_TOLERANCE_MS);
          if (!settleRef) continue;
          const tradeId = `${strategy.strategyVersion}_${candle.start}_${Math.random().toString(36).slice(2, 8)}`;
          const result = settleOutcome(strategy.direction, reference.v, settleRef.v);
          const inserted = await pool.query("INSERT INTO shadow_trades(trade_id,experiment_id,market_event_id,strategy_version,decision,confidence,p_buy,p_sell,p_wait,probability_source,regime,reference_price,reference_price_observation_id,reference_timestamp,settlement_target_at,settlement_price,settlement_price_observation_id,settlement_observed_at,result,session_id,market_context_id,segment_id,asset_canonical,market_type,created_at,settled_at,phase) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$25,'DISCOVERY') ON CONFLICT (market_event_id,strategy_version) DO NOTHING",
            [tradeId, exp.experiment_id, marketEventId, strategy.strategyVersion, strategy.direction, strategy.confidence, strategy.pBuy, strategy.pSell, strategy.pWait, strategy.probabilitySource, null, reference.v, reference.id, reference.t, reference.t + horizon, settleRef.v, settleRef.id, settleRef.t, result, sid, reference.context, segment === "none" ? null : segment, reference.asset, reference.marketType, now]);
          if (inserted.rowCount > 0) { created += 1; eventCreated += 1; if (result === "WIN" || result === "LOSS" || result === "DRAW") counted += 1; }
        }
        if (eventCreated > 0 && !eventHadTrades) newEvents += 1;
      }
    }
  }
  if (counted > 0 || newEvents > 0 || evaluations > 0) {
    await pool.query("UPDATE shadow_experiments SET evaluations = evaluations + $2, unique_market_events = unique_market_events + $3, valid_settled_trades = valid_settled_trades + $4, discovery_count = discovery_count + $4, updated_at=now() WHERE experiment_id=$1", [exp.experiment_id, evaluations, newEvents, counted]);
  }
  const after = (await pool.query("SELECT * FROM shadow_experiments WHERE experiment_id=$1", [exp.experiment_id])).rows[0];
  await recordCheckpoint(pool, after, now);
  return { created, counted, evaluations, newEvents, validSettledTrades: Number(after.valid_settled_trades) };
}

export function startExperimentLoop(pool, intervalMs = 5_000) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { const result = await experimentTick(pool); if (result.created || result.settlement?.counted) console.info("SHADOW_EXPERIMENT_TICK", JSON.stringify(result)); }
    catch (error) { console.error("SHADOW_EXPERIMENT_TICK_ERROR", error instanceof Error ? error.message : String(error)); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), intervalMs);
  const retroTimer = setInterval(async () => {
    try {
      const swept = await retroEvaluate(pool, { maxCreations: 2000 });
      if (swept.created) console.info("SHADOW_EXPERIMENT_RETRO_SWEEP", JSON.stringify(swept));
    } catch (error) { console.error("SHADOW_EXPERIMENT_RETRO_ERROR", error instanceof Error ? error.message : String(error)); }
  }, 30 * 60_000);
  return () => { clearInterval(timer); clearInterval(retroTimer); };
}
