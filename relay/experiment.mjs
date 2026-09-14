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
export const STRATEGY_VERSIONS = ["shadow-momentum-v1", "shadow-trend-v1", "shadow-reversion-v1"];

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
  const ema = (p) => { if (n < p) return null; const a = 2 / (p + 1); let e = closes.slice(0, p).reduce((s, x) => s + x, 0) / p; for (let i = p; i < n; i++) e = closes[i] * a + e * (1 - a); return e; };
  const ema9 = ema(9), ema21 = ema(21);
  let rsi = null;
  if (n > 15) { let g = 0, l = 0; for (let i = n - 14; i < n; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; } rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  let vol = null;
  if (n > 13) { const rs = []; for (let i = n - 12; i < n; i++) rs.push((closes[i] - closes[i - 1]) / closes[i - 1]); const m = rs.reduce((s, x) => s + x, 0) / rs.length; vol = Math.sqrt(rs.reduce((s, x) => s + (x - m) ** 2, 0) / rs.length); }
  return { momentum30: ret(6), momentum60: ret(12), momentum120: ret(24), slope: ema9 !== null && ema21 ? (ema9 - ema21) / ema21 : null, rsi, vol, last: closes[n - 1] ?? null };
}

export function evaluateStrategies(f) {
  const score = (v, scale) => (v === null ? 0 : clamp(v / scale, -1, 1));
  const raw = [];
  { const s = score(f.momentum30, .0008) * .6 + score(f.momentum60, .0012) * .4; raw.push({ strategyVersion: "shadow-momentum-v1", direction: s > .25 ? "BUY" : s < -.25 ? "SELL" : "WAIT", score: s }); }
  { const s = score(f.slope, .0008) * .7 + score(f.momentum120, .002) * .3; raw.push({ strategyVersion: "shadow-trend-v1", direction: s > .3 ? "BUY" : s < -.3 ? "SELL" : "WAIT", score: s }); }
  { const volOk = f.vol !== null && f.vol < .0009; const s = f.rsi === null ? 0 : (55 - f.rsi) / 45; raw.push({ strategyVersion: "shadow-reversion-v1", direction: volOk && s > .33 ? "BUY" : volOk && s < -.33 ? "SELL" : "WAIT", score: s }); }
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

async function settleDueTrades(pool, now) {
  const due = (await pool.query("SELECT t.*, e.phase AS experiment_phase FROM shadow_trades t LEFT JOIN shadow_experiments e ON e.experiment_id = t.experiment_id WHERE t.result IS NULL AND t.settlement_target_at + $1 <= $2 ORDER BY t.settlement_target_at ASC LIMIT 200", [SETTLEMENT_GRACE_MS, now])).rows;
  let settled = 0, counted = 0;
  for (const trade of due) {
    const target = Number(trade.settlement_target_at);
    const ref = (await pool.query("SELECT value, price_observation_id, EXTRACT(EPOCH FROM observed_at)*1000 AS t FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND observed_at >= to_timestamp($2/1000.0) AND observed_at <= to_timestamp($3/1000.0) AND ($4::text IS NULL OR segment_id = $4) ORDER BY observed_at ASC LIMIT 1", [trade.session_id, target, target + SETTLEMENT_TOLERANCE_MS, trade.segment_id ?? null])).rows[0];
    const result = settleOutcome(trade.decision, Number(trade.reference_price), ref ? Number(ref.value) : NaN);
    const settledAt = now;
    await pool.query("UPDATE shadow_trades SET settlement_price=$2, settlement_price_observation_id=$3, settlement_observed_at=$4, result=$5, settled_at=$6 WHERE trade_id=$1 AND result IS NULL", [trade.trade_id, ref ? Number(ref.value) : null, ref ? ref.price_observation_id : null, ref ? Number(ref.t) : null, result, settledAt]);
    settled += 1;
    if (result === "WIN" || result === "LOSS" || result === "DRAW") {
      counted += 1;
      const phase = trade.phase === "VALIDATION" ? "VALIDATION" : "DISCOVERY";
      await pool.query(`UPDATE shadow_experiments SET valid_settled_trades = valid_settled_trades + 1, ${phase === "VALIDATION" ? "validation_count" : "discovery_count"} = ${phase === "VALIDATION" ? "validation_count" : "discovery_count"} + 1, last_trade_at = $2, updated_at = now() WHERE experiment_id = $1`, [trade.experiment_id, settledAt]);
    }
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
  const observations = (await pool.query("SELECT value, EXTRACT(EPOCH FROM observed_at)*1000 AS t, price_observation_id, segment_id, market_context_id, asset_canonical, market_type, context_validation_status FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' ORDER BY observed_at DESC LIMIT 400", [session.id])).rows
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
      [tradeId, fresh.experiment_id, marketEventId, strategy.strategyVersion, strategy.direction, strategy.confidence, strategy.pBuy, strategy.pSell, strategy.pWait, strategy.probabilitySource, null, reference.v, reference.id, reference.t, reference.t + EXPERIMENT_HORIZON_MS, session.id, reference.context, reference.segment, reference.asset, reference.marketType, now, fresh.phase === "VALIDATION" ? "VALIDATION" : "DISCOVERY"]);
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
  const checkpoints = (await pool.query("SELECT at_trade, metrics, created_at FROM shadow_experiment_checkpoints WHERE experiment_id=$1 ORDER BY at_trade ASC", [exp.experiment_id])).rows;
  return { experiment: exp, perStrategy, checkpoints, brokerAutomation: "NONE", shadowOnly: true };
}

export async function experimentTrades(pool, limit = 100) {
  const trades = (await pool.query("SELECT trade_id, strategy_version, decision, confidence, p_buy, p_sell, p_wait, reference_price, reference_timestamp, settlement_price, settlement_target_at, settlement_observed_at, result, asset_canonical, market_type, segment_id, created_at, settled_at FROM shadow_trades ORDER BY created_at DESC LIMIT $1", [Math.max(1, Math.min(500, Number(limit) || 100))])).rows;
  return { trades, brokerAutomation: "NONE", shadowOnly: true };
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
  return () => clearInterval(timer);
}
