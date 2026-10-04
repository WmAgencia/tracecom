/**
 * V22 — Historical Candle & Indicator Capture
 * ==========================================
 * Grava TODOS os candles (5s e 1m) e indicadores de TODOS os ativos
 * durante 30 minutos para backtesting de estratégias.
 *
 * Uso:
 *   node ws-otc-v22-capture.mjs demo --30min   (padrão 30 min)
 *   node ws-otc-v22-capture.mjs demo --15min
 *   node ws-otc-v22-capture.mjs demo --1hour
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import { IqWsClient } from './iqoption-ws.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Argumentos ────────────────────────────────────────────────────────────────
const ACCOUNT_ARG = (process.argv[2] ?? '').toLowerCase();
const WANT_DEMO = ACCOUNT_ARG === 'demo' ? true : ACCOUNT_ARG === 'real' ? false : null;
const ARG_DURATION = process.argv.find(a => a.startsWith('--')) ?? '--30min';
const DURATION_MS = {
  '--15min': 15 * 60 * 1000,
  '--30min': 30 * 60 * 1000,
  '--45min': 45 * 60 * 1000,
  '--1hour':  60 * 60 * 1000,
  '--2hour': 120 * 60 * 1000,
}[ARG_DURATION] ?? 30 * 60 * 1000;

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG = JSON.parse(fs.readFileSync(new URL('./bot-config-v22.json', import.meta.url)));
const S = CONFIG.strategy ?? {};
const C = CONFIG.trading ?? {};
const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);

// ─── Constantes ───────────────────────────────────────────────────────────────
const RSI_PERIOD      = Math.max(2, Math.round(num(S.rsiPeriod, 14)));
const ADX_PERIOD      = Math.max(2, Math.round(num(S.adxPeriod, 14)));
const EMA_FAST        = Math.max(2, Math.round(num(S.emaFast, 8)));
const EMA_SLOW        = Math.max(2, Math.round(num(S.emaSlow, 21)));
const TREND_LOOKBACK  = Math.max(10, Math.round(num(S.trendLookback, 50)));
const REGIME_1M_MIN   = Math.max(4, Math.round(num(S.lookbackRegime, 20)));
const CANDLE_SIZE     = num(S.candleSizeSeconds, 5);
const RSI_TOUCH_CALL  = num(S.rsiTouchCall, 35);
const RSI_TOUCH_PUT   = num(S.rsiTouchPut, 65);
const ADX_MIN         = num(S.adxMin, 15);
const BODY_RATIO_MIN  = num(S.entryBodyRatio ?? 0.6, 0.6);

// ─── Output dirs ──────────────────────────────────────────────────────────────
const OUT_DIR     = path.join(__dirname, 'v22-historico-candles');
const SESSION_ID  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const SESSION_DIR = path.join(OUT_DIR, `session-${SESSION_ID}`);
const ASSETS_DIR  = path.join(SESSION_DIR, 'assets');

function initOutput() {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SESSION_DIR, 'session-info.json'), JSON.stringify({
    sessionId: SESSION_ID,
    startedAt: new Date().toISOString(),
    durationMs: DURATION_MS,
    durationLabel: `${DURATION_MS / 60000}min`,
    candleSize: CANDLE_SIZE,
    rsiPeriod: RSI_PERIOD,
    adxPeriod: ADX_PERIOD,
    emaFast: EMA_FAST,
    emaSlow: EMA_SLOW,
    trendLookback: TREND_LOOKBACK,
    regime1mMin: REGIME_1M_MIN,
    totalAssets: 0,
    totalCandles5s: 0,
    totalCandles1m: 0,
    activeAssets: [],
  }, null, 2));
}
initOutput();

// ─── Global flush handles ──────────────────────────────────────────────────────
let allCandlesHandle = fs.openSync(path.join(SESSION_DIR, 'ALL_candles.jsonl'), 'w');
let allIndicatorsHandle = fs.openSync(path.join(SESSION_DIR, 'ALL_indicators.jsonl'), 'w');
let candleCount5s = 0;
let candleCount1m = 0;

// ─── Per-asset state ───────────────────────────────────────────────────────────
const assetState = new Map();
// aid → { name, shortName, buf5s[], buf1m[], lastWritten5s, lastWritten1m }

function ensureAsset(aid, name, shortName) {
  if (!assetState.has(aid)) {
    const safe = shortName.replace(/[^a-zA-Z0-9_]/g, '_');
    const assetDir = path.join(ASSETS_DIR, safe);
    if (!fs.existsSync(assetDir)) fs.mkdirSync(assetDir, { recursive: true });
    assetState.set(aid, {
      name, shortName,
      buf5s: [], buf1m: [],
      // Deduplication: last written candle atMs
      lastWritten5sAt: null,
      lastWritten1mAt: null,
    });
  }
  return assetState.get(aid);
}

function writeCandleToAssetFile(assetDir, candles, filename, existingCount) {
  if (!candles.length) return existingCount;
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(path.join(assetDir, filename), 'utf8')); } catch {}
  const merged = [...existing, ...candles];
  fs.writeFileSync(path.join(assetDir, filename), JSON.stringify(merged, null, 2));
  return existingCount + candles.length;
}

function flushAsset(aid) {
  const s = assetState.get(aid);
  if (!s) return;
  const safe = s.shortName.replace(/[^a-zA-Z0-9_]/g, '_');
  const assetDir = path.join(ASSETS_DIR, safe);
  writeCandleToAssetFile(assetDir, s.buf5s, 'candles_5s.json', 0);
  writeCandleToAssetFile(assetDir, s.buf1m, 'candles_1m.json', 0);
  s.buf5s = [];
  s.buf1m = [];
}

function flushAll() {
  for (const aid of assetState.keys()) flushAsset(aid);
  const activeAssets = [...assetState.values()].map(s => s.shortName);
  const infoPath = path.join(SESSION_DIR, 'session-info.json');
  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  info.totalAssets = activeAssets.length;
  info.activeAssets = activeAssets;
  info.totalCandles5s = candleCount5s;
  info.totalCandles1m = candleCount1m;
  fs.writeFileSync(infoPath, JSON.stringify(info, null, 2));
}

// Flush a cada 30 segundos
setInterval(() => {
  flushAll();
  process.stdout.write(`\r[${new Date().toISOString().slice(11, 19)}] FLUSH | ativos=${assetState.size} | 5s=${candleCount5s} | 1m=${candleCount1m}    `);
}, 30_000);

// ─── Candle helpers (espelha ClosedCandles do bot principal) ───────────────────
function toMs(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  return null;
}

function candleStartMs(raw, sizeMs) {
  const from = toMs(raw.from ?? raw.start ?? raw.at ?? raw.timestamp);
  if (from !== null) return Math.floor(from / sizeMs) * sizeMs;
  const to = toMs(raw.to ?? raw.end);
  return to !== null ? to - sizeMs : null;
}

function priceOf(raw) {
  if (raw?.close !== undefined) return Number(raw.close);
  if (raw?.price !== undefined) return Number(raw.price);
  return null;
}

function highOf(raw) { return raw?.max ? Number(raw.max) : raw?.high !== undefined ? Number(raw.high) : null; }
function lowOf(raw)  { return raw?.min ? Number(raw.min) : raw?.low !== undefined ? Number(raw.low) : null; }
function openOf(raw) {
  if (raw?.open !== undefined) return Number(raw.open);
  if (raw?.price_open !== undefined) return Number(raw.price_open);
  if (raw?.o !== undefined) return Number(raw.o);
  return priceOf(raw);
}

// ─── EMA ──────────────────────────────────────────────────────────────────────
function calcEMA(values, period, prevEma = null) {
  if (!values || values.length === 0) return null;
  const k = 2 / (period + 1);
  if (prevEma === null) {
    const seed = values.slice(0, Math.min(values.length, period));
    if (!seed.length) return null;
    return seed.reduce((a, b) => a + b, 0) / seed.length;
  }
  let ema = prevEma;
  for (const v of values) ema = ema + k * (v - ema);
  return ema;
}

// ─── RSI ─────────────────────────────────────────────────────────────────────
function calcRSI(ticks, period = RSI_PERIOD) {
  if (ticks.length < period + 1) return null;
  const closes = ticks.map(t => t.close);
  const slice = closes.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff >= 0) gains += diff; else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// ─── ADX (simplificado — direção + força) ───────────────────────────────────
function calcADX(ticks, period = ADX_PERIOD) {
  if (ticks.length < period * 2) return null;
  let pdmSum = 0, ndmSum = 0, trSum = 0;
  for (let i = ticks.length - period; i < ticks.length; i++) {
    const t0 = ticks[i], t1 = ticks[i - 1];
    if (!t0 || !t1) continue;
    const high = highOf(t0) ?? t0.close;
    const low  = lowOf(t0)  ?? t0.close;
    const pClose = t1.close;
    const pHigh = highOf(t1) ?? pClose;
    const pLow  = lowOf(t1)  ?? pClose;
    const tr = Math.max(high - low, Math.abs(high - pClose), Math.abs(low - pClose));
    const pdm = Math.max(high - pHigh, 0);
    const ndm = Math.max(pLow - low, 0);
    if (pdm > ndm) { pdmSum += pdm; ndmSum = 0; }
    else { ndmSum += ndm; pdmSum = 0; }
    trSum += tr;
  }
  if (trSum === 0) return null;
  const pDI = 100 * pdmSum / trSum;
  const nDI = 100 * ndmSum / trSum;
  if (pDI + nDI === 0) return null;
  return 100 * Math.abs(pDI - nDI) / (pDI + nDI);
}

// ─── ATR ─────────────────────────────────────────────────────────────────────
function calcATR(ticks, period = 14) {
  if (ticks.length < period + 1) return null;
  let sum = 0;
  for (let i = ticks.length - period; i < ticks.length; i++) {
    const t0 = ticks[i], t1 = ticks[i - 1];
    if (!t0 || !t1) continue;
    const tr = Math.max(
      (highOf(t0) ?? t0.close) - (lowOf(t0) ?? t0.close),
      Math.abs((highOf(t0) ?? t0.close) - t1.close),
      Math.abs((lowOf(t0)  ?? t0.close) - t1.close)
    );
    sum += tr;
  }
  return sum / period;
}

// ─── Regime 1m ────────────────────────────────────────────────────────────────
function calcRegime1m(ticks) {
  if (ticks.length < REGIME_1M_MIN + EMA_SLOW) return { direction: 'lateral', spreadPct: 0, source: 'local-1m' };
  const closes = ticks.map(t => t.close).slice(-REGIME_1M_MIN);
  const ema8  = calcEMA(closes.slice(-EMA_FAST * 2), EMA_FAST);
  const ema21 = calcEMA(closes.slice(-EMA_SLOW * 2), EMA_SLOW);
  if (ema8 === null || ema21 === null) return { direction: 'lateral', spreadPct: 0, source: 'local-1m' };
  const spreadPct = (ema8 - ema21) / ema21 * 100;
  const minSpread = num(S.trendMinEmaSpreadPct, 0.01);
  if (spreadPct >= minSpread) return { direction: 'alta',   spreadPct, source: 'local-1m' };
  if (spreadPct <= -minSpread) return { direction: 'baixa', spreadPct, source: 'local-1m' };
  return { direction: 'lateral', spreadPct: 0, source: 'local-1m' };
}

// ─── Bollinger Bands ───────────────────────────────────────────────────────────
function calcBB(ticks, period = 20, stdDevMult = 2) {
  if (ticks.length < period + 1) return null;
  const closes = ticks.map(t => t.close).slice(-period);
  const sma = closes.reduce((a, b) => a + b, 0) / closes.length;
  const variance = closes.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / closes.length;
  const std = Math.sqrt(variance);
  const lastClose = closes[closes.length - 1];
  return { sma, upper: sma + stdDevMult * std, lower: sma - stdDevMult * std, lastClose };
}

// ─── Candlestick pattern ──────────────────────────────────────────────────────
function detectCandlePattern(tick) {
  if (!tick) return null;
  const open  = openOf(tick);
  const close = priceOf(tick);
  const high  = highOf(tick) ?? Math.max(open, close);
  const low   = lowOf(tick)  ?? Math.min(open, close);
  const body  = Math.abs(close - open);
  const range = Math.max(1e-12, high - low);
  if (body < range * 0.1) return null; // doji
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  // Martelo (CALL reversão)
  if (lowerWick >= body * 2 && upperWick <= body * 0.5) return 'hammer';
  // Estrela cadente (PUT reversão)
  if (upperWick >= body * 2 && lowerWick <= body * 0.5) return 'shootingStar';
  // Engolfo
  return null; //省略 — apenas martelo/estrela por agora
}

// ─── Entry evaluation (espelha evaluateEntry do bot) ──────────────────────────
// Usado para marcar NO CADA CANDLE se hoje teria entrado ou não
function evaluateEntryAtTick(ticks5s, ticks1m, regime15m) {
  const adxV20 = ADX_MIN;
  const bodyRatioMin = BODY_RATIO_MIN;
  if (!regime15m || regime15m.direction === 'lateral') return { signal: false, skip: 'lateral15m' };
  const dir15m = regime15m.direction;
  const rsiNow = calcRSI(ticks5s);
  const prevRsi = ticks5s.length >= 16 ? (() => {
    const sub = ticks5s.slice(-16, -1);
    return calcRSI(sub);
  })() : null;
  if (rsiNow === null || prevRsi === null) return { signal: false, skip: 'semRsi' };

  const touchCall = Math.max(RSI_TOUCH_CALL, 35);
  const touchPut  = Math.min(RSI_TOUCH_PUT, 65);
  const crossing = (dir15m === 'alta' && rsiNow <= touchCall && prevRsi > touchCall)
               || (dir15m === 'baixa' && rsiNow >= touchPut && prevRsi < touchPut);
  if (!crossing) return { signal: false, skip: 'semRsiTouch', rsiNow, prevRsi };

  // Ja era oversold/overbought?
  if (dir15m === 'alta'   && prevRsi <= touchCall - 15) return { signal: false, skip: 'jaEraOversold', rsiNow, prevRsi };
  if (dir15m === 'baixa'  && prevRsi >= touchPut + 15)  return { signal: false, skip: 'jaEraOverbought', rsiNow, prevRsi };

  const lastTick = ticks5s[ticks5s.length - 1];
  const open  = openOf(lastTick);
  const close = priceOf(lastTick);
  const high  = highOf(lastTick) ?? Math.max(open, close);
  const low   = lowOf(lastTick)  ?? Math.min(open, close);
  const body  = Math.abs(close - open);
  const range = Math.max(1e-12, high - low);
  if (body / range < bodyRatioMin) return { signal: false, skip: 'corpoFraco', rsiNow };

  const adx = calcADX(ticks5s);
  if (adx === null || adx < adxV20) return { signal: false, skip: 'adxFraco', rsiNow, adx };

  // ADX momentum
  const adxPrev = calcADX(ticks5s.slice(0, -5));
  if (adx !== null && adxPrev !== null && adx <= adxPrev) return { signal: false, skip: 'adxSemMomentum', adx, adxPrev };

  const bb = calcBB(ticks5s);
  if (bb) {
    const direction = dir15m === 'alta' ? 'CALL' : 'PUT';
    const isBBZone = direction === 'CALL'
      ? close <= bb.lower * 1.05
      : close >= bb.upper * 0.95;
    if (!isBBZone) return { signal: false, skip: 'semBBZona', rsiNow, bbLower: bb.lower, bbUpper: bb.upper, close };
  }

  const pat = detectCandlePattern(lastTick);
  const expectedPat = dir15m === 'alta' ? 'hammer' : 'shootingStar';
  if (!pat || pat !== expectedPat) return { signal: false, skip: `semPadrao${expectedPat}`, rsiNow, pattern: pat };

  return {
    signal: true,
    direction: dir15m === 'alta' ? 'CALL' : 'PUT',
    rsiNow: parseFloat(rsiNow.toFixed(2)),
    prevRsi: parseFloat(prevRsi.toFixed(2)),
    adx: parseFloat(adx.toFixed(2)),
    regime: regime15m,
    pattern: pat,
    bb: bb ? { upper: parseFloat(bb.upper.toFixed(8)), lower: parseFloat(bb.lower.toFixed(8)) } : null,
  };
}

// ─── Compute indicadores + sinal para um candle ────────────────────────────────
function computeFullRecord(asset, aid, ticks5s, ticks1m, rawCandle) {
  const atMs = candleStartMs(rawCandle, rawCandle.size === 60 ? 60_000 : CANDLE_SIZE * 1000) ?? rawCandle.time ?? Date.now();

  // Regime 15m (calculado com 1m, source=local-15m pois não temos 15m real)
  const regime15m = ticks1m.length >= 4 ? calcRegime1m(ticks1m) : null;
  // Regime 5s (para análise)
  const regime5s = calcRegime1m(ticks5s);

  // Indicadores com todos os ticks disponíveis
  const closes5s = ticks5s.map(t => t.close);
  const ema8  = calcEMA(closes5s.slice(-EMA_FAST * 2), EMA_FAST);
  const ema21 = calcEMA(closes5s.slice(-EMA_SLOW * 2), EMA_SLOW);
  const rsi   = calcRSI(ticks5s);
  const adx   = calcADX(ticks5s);
  const atr   = calcATR(ticks5s);
  const bb    = calcBB(ticks5s);

  const lastTick = ticks5s[ticks5s.length - 1];
  const prevTick  = ticks5s.length >= 2 ? ticks5s[ticks5s.length - 2] : null;

  const body  = Math.abs(priceOf(lastTick) - openOf(lastTick));
  const range = Math.max(1e-12, (highOf(lastTick) ?? lastTick.close) - (lowOf(lastTick) ?? lastTick.close));

  // Entry evaluation
  const entry = evaluateEntryAtTick(ticks5s, ticks1m, regime15m);

  return {
    // Identificação
    ts: atMs,
    iso: new Date(atMs).toISOString(),
    assetId: aid,
    assetName: asset.shortName,

    // Candle
    open: openOf(lastTick),
    high: highOf(lastTick),
    low: lowOf(lastTick),
    close: priceOf(lastTick),
    volume: rawCandle.volume ?? 0,
    candleSizeSecs: rawCandle.size ?? CANDLE_SIZE,

    // EMA
    ema8: ema8 !== null ? parseFloat(ema8.toFixed(8)) : null,
    ema21: ema21 !== null ? parseFloat(ema21.toFixed(8)) : null,
    emaSpreadPct: (ema8 && ema21) ? parseFloat(((ema8 - ema21) / ema21 * 100).toFixed(4)) : null,

    // RSI
    rsi: rsi !== null ? parseFloat(rsi.toFixed(2)) : null,

    // ADX
    adx: adx !== null ? parseFloat(adx.toFixed(2)) : null,

    // ATR
    atr: atr !== null ? parseFloat(atr.toFixed(8)) : null,

    // Bollinger
    bbUpper: bb ? parseFloat(bb.upper.toFixed(8)) : null,
    bbLower: bb ? parseFloat(bb.lower.toFixed(8)) : null,
    bbSma:   bb ? parseFloat(bb.sma.toFixed(8))   : null,

    // Regime
    regime1m: regime5s?.direction ?? null,
    regime1mSpread: regime5s?.spreadPct ?? null,
    regime15m: regime15m?.direction ?? null,
    regime15mSpread: regime15m?.spreadPct ?? null,

    // Candlestick
    pattern: detectCandlePattern(lastTick),
    bodyRatio: range > 0 ? parseFloat((body / range).toFixed(3)) : null,

    // Entry signal
    signal: entry.signal ?? false,
    signalDirection: entry.direction ?? null,
    skip: entry.skip ?? null,
    signalRsiNow: entry.rsiNow ?? null,
    signalPrevRsi: entry.prevRsi ?? null,
    signalAdx: entry.adx ?? null,
    signalBb: entry.bb ?? null,

    // Meta
    rsiTouchCall: RSI_TOUCH_CALL,
    rsiTouchPut:  RSI_TOUCH_PUT,
    adxMin: ADX_MIN,
    bodyRatioMin: BODY_RATIO_MIN,
  };
}

// ─── Login ────────────────────────────────────────────────────────────────────
function login() {
  return new Promise((resolve, reject) => {
    const email = process.env.IQ_EMAIL || CONFIG.login?.email || '';
    const password = process.env.IQ_PASSWORD || CONFIG.login?.password || '';
    const body = JSON.stringify({ email, password });
    const opts = {
      hostname: 'iqoption.com', path: '/api/v2/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const ssid = json?.result?.ssid;
          if (ssid) resolve(ssid);
          else { console.error('[❌] Login falhou:', data.slice(0, 300)); process.exit(1); }
        } catch (e) { console.error('[❌] Login parse error:', e.message); process.exit(1); }
      });
    });
    req.on('error', (e) => { console.error('[❌] Login error:', e.message); process.exit(1); });
    req.write(body);
    req.end();
  });
}

function nowMs() { return Date.now(); }

// ─── Deduplication ─────────────────────────────────────────────────────────────
function isDuplicate(asset, atMs, sizeSecs) {
  if (sizeSecs === 5) {
    if (asset.lastWritten5sAt === atMs) return true;
    asset.lastWritten5sAt = atMs;
    return false;
  } else {
    if (asset.lastWritten1mAt === atMs) return true;
    asset.lastWritten1mAt = atMs;
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
let ws;
let shuttingDown = false;
const startTime = nowMs();

async function main() {
  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  V22 — Historical Candle & Indicator Capture`);
  console.log(`  Duração: ${DURATION_MS / 60000}min | Sessão: ${SESSION_ID}`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  const ssid = await login();
  console.log('[✅] LOGIN OK');

  ws = new IqWsClient({ log: () => {} });

  ws.on('message', (m) => {
    if (m?.name !== 'candle-generated') return;
    const raw = m.msg;
    const aid = String(raw?.active_id ?? '');
    if (!aid) return;

    const asset = assetState.get(aid);
    if (!asset) return; // Não inscrito

    const size = raw.size ?? CANDLE_SIZE;
    const atMs = candleStartMs(raw, size * 1000) ?? raw.time ?? Date.now();

    // Deduplica
    if (isDuplicate(asset, atMs, size === 60 ? 60 : 5)) return;

    const buf = size === 60 ? asset.buf1m : asset.buf5s;

    // Constrói candle padronizado
    const candle = {
      atMs,
      open:  openOf(raw),
      high:  highOf(raw),
      low:   lowOf(raw),
      close: priceOf(raw),
      volume: raw.volume ?? 0,
    };
    buf.push(candle);

    if (size === 60) candleCount1m++;
    else candleCount5s++;

    // Computa full record e grava no jsonl
    const ticks5s = asset.buf5s;
    const ticks1m = asset.buf1m;
    const record = computeFullRecord(asset, aid, ticks5s, ticks1m, raw);

    // ALL_candles.jsonl = um registro por candle
    fs.writeSync(allCandlesHandle, JSON.stringify(record) + '\n');

    // ALL_indicators.jsonl = indicadores por ativo+tempo
    fs.writeSync(allIndicatorsHandle, JSON.stringify({
      ts: atMs,
      iso: record.iso,
      assetId: aid,
      assetName: asset.shortName,
      sizeSecs: size,
      ema8: record.ema8,
      ema21: record.ema21,
      emaSpreadPct: record.emaSpreadPct,
      rsi: record.rsi,
      adx: record.adx,
      atr: record.atr,
      regime1m: record.regime1m,
      regime15m: record.regime15m,
      signal: record.signal,
      signalDirection: record.signalDirection,
      skip: record.skip,
      signalRsiNow: record.signalRsiNow,
      signalAdx: record.signalAdx,
    }) + '\n');
  });

  await ws.connect({ ssid });

  // Obtém initialization data para mapear IDs
  const init = await ws.getInitializationData();
  const turbo = init?.msg?.turbo?.actives ?? {};
  const allActives = Object.entries(turbo)
    .map(([id, act]) => ({ id: Number(id), name: act?.name, enabled: act?.enabled }))
    .filter(a => a.enabled && a.name);

  // Intersecta com whitelist + reserve
  const whitelistNames = new Set([
    ...Object.keys(CONFIG.whitelist ?? {}),
    ...Object.keys(CONFIG.reserve ?? {}),
  ]);

  const targetActives = allActives.filter(a => {
    const shortName = a.name?.replace('front.', '').split('-')[0] ?? '';
    return whitelistNames.has(shortName);
  }).slice(0, 200);

  console.log(`[📋] Inscrevendo ${targetActives.length} ativos (de ${allActives.length} disponíveis)...`);
  console.log(`[📋] Whitelist: ${[...whitelistNames].slice(0, 10).join(', ')}...`);

  for (const act of targetActives) {
    const aid = String(act.id);
    const shortName = act.name.replace('front.', '').split('-')[0];
    ensureAsset(aid, act.name, shortName);
    ws.subscribeCandles(aid, CANDLE_SIZE);
    ws.subscribeCandles(aid, 60);
  }

  await new Promise(r => setTimeout(r, 2000));
  console.log(`[📋] Inscrevendo ${targetActives.length} ativos (de ${allActives.length} disponíveis)...`);
  console.log(`[📋] Inscrevendo ${assetState.size} ativos via getInitializationData...`);

  // Relógio de progresso
  const progressTick = setInterval(() => {
    const elapsed = nowMs() - startTime;
    const pct = Math.min(100, (elapsed / DURATION_MS) * 100).toFixed(1);
    const remain = Math.max(0, DURATION_MS - elapsed);
    const mins = Math.floor(remain / 60000);
    const secs = Math.floor((remain % 60000) / 1000);
    process.stdout.write(`\r[${new Date().toISOString().slice(11, 19)}] ${pct}% | resta ${mins}m${secs}s | ativos=${assetState.size} | 5s=${candleCount5s} | 1m=${candleCount1m}  `);
  }, 5000);

  console.log(`\n[⏳] Gravando candles por ${DURATION_MS / 60000}min...`);
  console.log(`[💾] Saída: ${SESSION_DIR}`);
  console.log(`[⏱] Início: ${new Date().toISOString()}`);
  console.log(`[⏱] Fim:    ${new Date(startTime + DURATION_MS).toISOString()}`);

  setTimeout(async () => { clearInterval(progressTick); await shutdown('TIMER'); }, DURATION_MS);
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n\n[🛑] Encerrando (${reason})...`);

  flushAll();

  for (const h of [allCandlesHandle, allIndicatorsHandle]) {
    if (h !== null) { try { fs.closeSync(h); } catch {} }
  }
  allCandlesHandle = null;
  allIndicatorsHandle = null;

  const elapsedMs = nowMs() - startTime;
  const assets = [...assetState.values()].map(s => s.shortName);

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  CAPTURA FINALIZADA`);
  console.log(`═══════════════════════════════════════════════════════`);
  console.log(`  Sessão:    ${SESSION_ID}`);
  console.log(`  Duração:   ${(elapsedMs / 60000).toFixed(1)}min`);
  console.log(`  Ativos:    ${assets.length}`);
  console.log(`  Candles 5s: ${candleCount5s}`);
  console.log(`  Candles 1m: ${candleCount1m}`);
  console.log(`  Saída:     ${SESSION_DIR}`);
  console.log(`═══════════════════════════════════════════════════════`);

  // Atualiza session-info.json final
  const infoPath = path.join(SESSION_DIR, 'session-info.json');
  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  info.endedAt = new Date().toISOString();
  info.durationActualMs = elapsedMs;
  info.totalCandles5s = candleCount5s;
  info.totalCandles1m = candleCount1m;
  info.totalAssets = assets.length;
  info.activeAssets = assets;
  fs.writeFileSync(infoPath, JSON.stringify(info, null, 2));

  try { ws?.close(); } catch {}
  process.exit(0);
}

main().catch(e => { console.error('[❌]', e.message); process.exit(1); });
