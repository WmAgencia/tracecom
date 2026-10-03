/**
 * OTC BOT v21 — CASH / RUNNER / RECOVERY
 * ========================================
 *  node ws-otc-v21.mjs demo           → opera na conta DEMO/PRACTICE
 *  node ws-otc-v21.mjs real          → opera na conta REAL (fail-closed: precisa armar)
 *  node ws-otc-v21.mjs               → pergunta a conta (1=REAL, 2=DEMO)
 *
 *  NOVIDADE V21 (regra do dono, 2026-10-02):
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada sinal válido abre DUAS posições iguais e simultâneas:
 *    • CASH (mesmo stake): vende quando L/P pós-venda >= cashTakeProfit (R$1,00).
 *      Usa o valor REAL que a IQ oferece na venda (sell_profit), não estimativa.
 *    • RUNNER (mesmo stake): vai até a expiração natural.
 *
 *  RECOVERY (máx 1 por ciclo, opcional):
 *    Só entra quando Runner fecha em LOSS e há NOVA confirmação técnica:
 *    zona suporte/resistência + RSI reagindo + ADX/DMI + ATRP <= maxAtrp
 *    + regime 1m válido + tempo disponível >= closeBeforeMs.
 *    RECOVERY != "Runner lossou → aumentar stake". Não é martingale cego.
 *    Stake = base × recoveryMultiplier (2.75x → cobre 2 losses a payout 72.73%+).
 *
 *  CICLO: sinal válido → Cash+Runner (mesmo cycleId).
 *    Recovery adiciona ao ciclo se confirmada. Ciclo fecha quando Runner settleia.
 *
 *  A ESTRATÉGIA DE ENTRADA (regime 1m, RSI 30/70, ADX>=15, corpo>=0.4xATR)
 *  é IDENTICA à V20 — NADA foi alterado nos filtros de sinal.
 *  ─────────────────────────────────────────────────────────────────────────────
 *  PRÁTICA/DEMO APENAS. Nenhuma operação REAL durante os testes.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import https from 'https';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import { IqWsClient, computeExpiration } from './iqoption-ws.mjs';

const CONFIG = JSON.parse(fs.readFileSync(new URL('./bot-config-v21.json', import.meta.url), 'utf8'));
const C    = CONFIG.trading ?? {};
const S    = CONFIG.strategy ?? {};
const M    = CONFIG.martingale ?? {};
const R    = CONFIG.risk ?? {};
const CA   = CONFIG.cash ?? {};
const REC  = CONFIG.recovery ?? {};
const SE   = CONFIG.sell ?? {};
const UN   = CONFIG.universe ?? {};
const P    = CONFIG.paths ?? {};
const num  = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

const BASE_STAKE        = num(C.baseStake, 2);
const EXPIRATION_MIN    = num(C.expirationMinutes, 2);
const GALE_WINDOW_MS    = num(C.galeWindowMs, 120_000);
const PAYOUT            = num(M.payoutRate, 0.86);
const MARTINGALE_MULT   = num(M.martingaleMultiplier, 2.75);
const MAX_STAKE         = num(R.maxStake, 20);
const MAX_EXPOSURE_PCT = num(R.maxExposurePct, 100);
const SESSION_LOSS_PCT  = num(R.maxSessionLossPct, 20);
const PAUSE_AFTER_MS    = num(M.pauseAfterLadderMs, 600_000);

// CASH — venda antecipada
const CASH_TP            = num(CA.cashTakeProfit, 1.00);
const SELL_RETRY_MS      = num(SE.retryAfterMs, 8_000);
const SELL_MAX_ATTEMPTS  = Math.max(1, Math.round(num(SE.maxAttempts, 4)));
const CLOSE_BEFORE_MS    = num(SE.closeBeforeMs, 20_000);

// RECOVERY
const REC_MULTIPLIER    = num(REC.multiplier, 2.75);
const REC_MAX_ATRP_PCT  = num(REC.maxAtrpPercent, 3.0);
const REC_CLOSE_BEFORE   = num(REC.closeBeforeMs, 20_000);

// ENTRADA V20 (IDENTICA — NÃO ALTERAR)
const ENTRY_MODE            = String(S.entryMode ?? 'rsiTouch');
const REGIME_1M_MIN_CAND   = Math.max(30, Math.round(num(S.regime1mMinCandles, 120)));
const REGIME_1M_MIN_SPREAD = num(S.regime1mMinEmaSpreadPct, 0.03);
const RSI_TOUCH_CALL        = num(S.rsiTouchCall, 30);
const RSI_TOUCH_PUT         = num(S.rsiTouchPut, 70);
const SUPPORT_LOOKBACK      = Math.max(10, Math.round(num(S.supportLookback, 60)));
const SUPPORT_ATR_FACTOR    = num(S.supportAtrFactor, 1.5);
const BOOT_1M_CANDLES       = Math.max(30, Math.round(num(S.boot1mCandles, 240)));
const COOLDOWN_WIN_MS       = 0;
const COOLDOWN_LOSS_MS      = 5000;
const TREND_LOOKBACK        = Math.max(21, Math.round(num(S.trendLookback, 40)));
const TREND_MIN_SPREAD      = num(S.trendMinEmaSpreadPct, 0.05);
const REV                   = SE.reversal ?? {};
const REV_CANDLES           = Math.max(2, Math.round(num(REV.candles, 3)));
const REV_CANDLES_MIN       = Math.min(REV_CANDLES, Math.max(1, Math.round(num(REV.candlesAgainstMin, 2))));
const REV_RSI_CALL_MAX      = num(REV.rsiCallMax, 45);
const REV_RSI_PUT_MIN       = num(REV.rsiPutMin, 55);

// Universo
const MIN_ACTIVE       = Math.max(1, Math.round(num(UN.minActive, 50)));
const MAX_ACTIVE       = Math.max(MIN_ACTIVE, Math.round(num(UN.maxActive, 50)));
const REPLACE_STALE_MS = num(UN.replaceStaleMs, 180_000);
const UNIVERSE_CHECK_MS = num(UN.checkEveryMs, 60_000);
const ENTRY_SCAN_MS    = num(UN.entryScanEveryMs ?? 5_000, 5_000);

// ─── ACCOUNT TYPE (DEMO ONLY — regra do dono) ─────────────────────────────────
let SAVED_ACCOUNT_TYPE = null;
try {
  const credsPath = new URL('./bot-credentials.json', import.meta.url);
  if (fs.existsSync(credsPath)) {
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    SAVED_ACCOUNT_TYPE = creds?.accountType ?? null;
  }
} catch {}
try {
  if (fs.existsSync('./bot-preference.json')) {
    const pref = JSON.parse(fs.readFileSync('./bot-preference.json', 'utf8'));
    if (pref?.mode === 'demo') SAVED_ACCOUNT_TYPE = 'DEMO';
    else if (pref?.mode === 'real') SAVED_ACCOUNT_TYPE = 'REAL';
  }
} catch {}

const ARG = process.argv[2]?.toLowerCase();
const WANT_DEMO =
  ARG === 'demo' ? true
  : ARG === 'real' ? false
  : SAVED_ACCOUNT_TYPE === 'DEMO' ? true
  : SAVED_ACCOUNT_TYPE === 'REAL' ? false
  : null;
const LIST_ASSETS = process.argv.includes('--ativos');

// ─── CODE ID ─────────────────────────────────────────────────────────────────
const CODE_REV = 'V21';
const CODE_HASH = (() => {
  try { return createHash('sha256').update(fs.readFileSync(new URL(import.meta.url), 'utf8')).digest('hex').slice(0, 8); }
  catch { return '????????'; }
})();

// ─── FUNÇÕES PURAS (mantidas da V20 — NENHUMA ALTERAÇÃO) ─────────────────────
const round2 = (v) => Math.round(v * 100) / 100;

export function martingaleStake(recoverBase) {
  const base = Number(recoverBase);
  if (!Number.isFinite(base) || base <= 0) return 0;
  return round2(MARTINGALE_MULT * base);
}

export function ladderStake(level) {
  let stake = BASE_STAKE, lost = 0;
  for (let i = 0; i < Math.max(0, Math.min(level, 2)); i++) {
    lost += stake;
    stake = round2((lost + BASE_STAKE * PAYOUT) / PAYOUT);
  }
  return stake;
}

function toMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1e15) return Math.round(n / 1e6);
  if (n > 1e12) return Math.round(n);
  if (n > 1e9) return Math.round(n * 1000);
  return null;
}

function candleStartMs(raw, sizeMs) {
  const from = toMs(raw.from ?? raw.start ?? raw.at ?? raw.timestamp);
  if (from !== null) return Math.floor(from / sizeMs) * sizeMs;
  const to = toMs(raw.to ?? raw.end);
  return to !== null ? to - sizeMs : null;
}

export function normName(name) {
  return String(name ?? '').toUpperCase().replace(/^FRONT[.\-_\s]?/, '').replace(/[-_\s]?OTC$/, '').replace(/[^A-Z0-9]/g, '');
}

function sizeOf(raw) {
  const explicit = Number(raw.size ?? raw.candle_size ?? raw.candle?.size);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const from = toMs(raw.from ?? raw.start), to = toMs(raw.to ?? raw.end);
  if (from !== null && to !== null && to > from) return Math.round((to - from) / 1000);
  return null;
}

function priceOf(raw) {
  for (const value of [raw.close, raw.value, raw.price_close, raw.c]) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function highOf(raw) {
  for (const value of [raw.high, raw.max, raw.price_high, raw.h]) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function lowOf(raw) {
  for (const value of [raw.low, raw.min, raw.price_low, raw.l]) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// EMA pura
function calcEMA(prices, period) {
  const k = 2 / (period + 1);
  let ema = null;
  for (const p of prices) {
    if (ema === null) ema = p;
    else ema = p * k + ema * (1 - k);
  }
  return ema;
}

export function trendDirection1m(ticks) {
  if (!Array.isArray(ticks) || ticks.length < 8) return { direction: 'lateral1m', source: 'insuficiente', spreadPct: 0, candles: 0 };
  const closes = ticks.map((t) => t.close);
  const ema8  = calcEMA(closes, 8);
  const ema21  = calcEMA(closes, 21);
  if (ema8 === null || ema21 === null || ema21 === 0) return { direction: 'lateral1m', source: 'ema', spreadPct: 0, candles: ticks.length };
  const spread = ((ema8 - ema21) / ema21) * 100;
  const dir = spread >= REGIME_1M_MIN_SPREAD ? 'alta1m' : spread <= -REGIME_1M_MIN_SPREAD ? 'baixa1m' : 'lateral1m';
  return { direction: dir, source: 'ema8x21', spreadPct: round2(spread), candles: ticks.length };
}

export function trendDirection(ticks) {
  if (!Array.isArray(ticks) || ticks.length < TREND_LOOKBACK) return { direction: null, source: 'insuficiente', spreadPct: 0 };
  const closes = ticks.map((t) => t.close);
  const ema8  = calcEMA(closes, 8);
  const ema21  = calcEMA(closes, 21);
  if (ema8 === null || ema21 === null || ema21 === 0) return { direction: null, source: 'ema', spreadPct: 0 };
  const spread = ((ema8 - ema21) / ema21) * 100;
  const dir = spread >= TREND_MIN_SPREAD ? 'CALL' : spread <= -TREND_MIN_SPREAD ? 'PUT' : null;
  return { direction: dir, source: 'ema8x21', spreadPct: round2(spread) };
}

export function detectRegime(ticks) {
  if (!Array.isArray(ticks) || ticks.length < 20) return 'incerto';
  const recent = ticks.slice(-20);
  const highs = recent.map((t) => t.high ?? t.close);
  const lows  = recent.map((t) => t.low ?? t.close);
  const maxHigh = Math.max(...highs);
  const minLow  = Math.min(...lows);
  const range = maxHigh - minLow;
  if (range <= 0) return 'incerto';
  const lastClose = ticks[ticks.length - 1].close;
  const bodyUp   = lastClose >= (maxHigh + minLow) / 2;
  const touches  = recent.filter((t) => (t.high ?? t.close) >= maxHigh - range * 0.05 || (t.low ?? t.close) <= minLow + range * 0.05).length;
  if (touches >= 10) return 'lateral';
  return bodyUp ? 'alta' : 'baixa';
}

export function calcRSI(ticks, period = 14) {
  if (!Array.isArray(ticks) || ticks.length < period + 1) return 50;
  const closes = ticks.map((t) => t.close);
  let gain = 0, loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gain += diff;
    else loss -= diff;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - (100 / (1 + rs));
}

export function calcADX(ticks, period = 14) {
  if (!Array.isArray(ticks) || ticks.length < period * 2 + 1) return 0;
  const highs = ticks.map((t) => t.high ?? t.close);
  const lows  = ticks.map((t) => t.low ?? t.close);
  const closes = ticks.map((t) => t.close);
  const trs = [];
  for (let i = 1; i < ticks.length; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1]));
    trs.push(tr);
  }
  const adxPeriod = Math.min(period, trs.length);
  if (adxPeriod < 2) return 0;
  const avgTR = trs.slice(-adxPeriod).reduce((a, b) => a + b, 0) / adxPeriod;
  if (avgTR <= 0) return 0;
  const lastClose = closes[closes.length - 1];
  const emaClose = calcEMA(closes.slice(-adxPeriod * 2), adxPeriod * 2);
  const atr = avgTR;
  return round2((Math.abs(lastClose - emaClose) / atr) * 100);
}

function tickVolPct(ticks) {
  if (!Array.isArray(ticks) || ticks.length < 2) return 0.02;
  const closes = ticks.map((t) => t.close);
  const rets  = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.abs(closes[i] - closes[i-1]) / closes[i-1]);
  return rets.slice(-12).reduce((a, b) => a + b, 0) / Math.max(1, rets.slice(-12).length);
}

export function parseSettlement(raw, op) {
  const win = String(raw?.win ?? raw?.status ?? raw?.result ?? '').toLowerCase();
  const draw = win === 'equal' || win === 'draw';
  const won  = win === 'win';
  const invested = [raw?.invest, raw?.sum, raw?.amount, raw?.price].map(Number).find(Number.isFinite) ?? op.stake;
  let profit = null;
  const winAmount = [raw?.win_amount, raw?.payout].map(Number).find(Number.isFinite);
  if (won && winAmount !== undefined) profit = winAmount > invested ? winAmount - invested : winAmount;
  if (won && (profit === null || profit <= 0)) { profit = round2(invested * PAYOUT); }
  if (!won) { profit = draw ? 0 : -invested; }
  return { result: won ? 'win' : draw ? 'draw' : 'loss', profit: round2(profit), invested };
}

export function pickCloseReturn(raw) {
  for (const field of ['sell_profit', 'profit_amount']) {
    const value = raw?.[field];
    if (value === undefined || value === null) continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function saleNet(returned, stake) {
  const r = Number.isFinite(returned) ? returned : 0;
  const s = Number.isFinite(stake) ? stake : 0;
  return round2(r - s);
}

export class ClosedCandles {
  constructor(sizeSec) {
    this.sizeMs = sizeSec * 1000;
    this.ticks = [];
    this.formingAt = null;
    this.formingClose = null;
    this.formingHigh = null;
    this.formingLow = null;
    this.lastClosedAt = 0;
  }
  ingest(raw, nowMs) {
    const startMs = candleStartMs(raw, this.sizeMs);
    const close = priceOf(raw);
    if (startMs === null || close === null || startMs <= this.lastClosedAt) return null;
    const high = highOf(raw) ?? close, low = lowOf(raw) ?? close;
    let closed = null;
    if (this.formingAt !== null && startMs > this.formingAt) closed = this.flushForming();
    if (this.formingAt === null) {
      this.formingAt = startMs; this.formingClose = close; this.formingHigh = high; this.formingLow = low;
    } else {
      this.formingClose = close;
      this.formingHigh = Math.max(this.formingHigh ?? high, high);
      this.formingLow = Math.min(this.formingLow ?? low, low);
    }
    if (this.formingAt !== null && nowMs >= this.formingAt + this.sizeMs) closed = this.flushForming() ?? closed;
    return closed;
  }
  flushForming() {
    if (this.formingAt === null) return null;
    const bar = { atMs: this.formingAt, close: this.formingClose, high: this.formingHigh ?? this.formingClose, low: this.formingLow ?? this.formingClose };
    this.ticks.push(bar);
    if (this.ticks.length > 500) this.ticks.shift();
    this.lastClosedAt = this.formingAt;
    this.formingAt = null;
    this.formingClose = null;
    this.formingHigh = null;
    this.formingLow = null;
    return bar;
  }
}

// ─── ENTRADA V20 (IDENTICA — NÃO ALTERAR) ────────────────────────────────────
export function evaluateEntry({ ticks, open, trend, regime, rsi, adx, cycleOps = 0, gale = false, reversalGale = false, mode = 'rsiTouch', regime1m = null }) {
  const adxV20 = num(S.adxMinEntry, 15);
  const bodyRatioMin = num(S.entryBodyRatio ?? 0.4, 0.4);
  if (mode !== 'rsiTouch') return { skip: 'modeInvalido' };
  if (!regime1m || regime1m.direction === 'lateral1m') return { skip: 'lateral1m' };
  const dir1m = regime1m.direction;
  const rsiNow = rsi;
  const prevIdx = Math.max(0, ticks.length - 2);
  const prevRsi = calcRSI(ticks.slice(0, prevIdx + 1));
  const crossing = (dir1m === 'alta1m' && rsiNow <= RSI_TOUCH_CALL && prevRsi > RSI_TOUCH_CALL)
                || (dir1m === 'baixa1m' && rsiNow >= RSI_TOUCH_PUT  && prevRsi < RSI_TOUCH_PUT);
  if (!crossing) return { skip: 'semRsiTouch' };
  const lastTick = ticks[ticks.length - 1];
  if (!lastTick) return { skip: 'semVela' };
  const body  = Math.abs(lastTick.close - (lastTick.open ?? lastTick.close));
  const range = Math.max(1e-12, (lastTick.high ?? lastTick.close) - (lastTick.low ?? lastTick.close));
  if (body / range < bodyRatioMin) return { skip: 'corpoFraco' };
  if (adx < adxV20) return { skip: 'adxFraco' };
  const direction = dir1m === 'alta1m' ? 'CALL' : 'PUT';
  const sTicks = ticks.slice(-SUPPORT_LOOKBACK);
  if (!sTicks.length) return { skip: 'semSuporte' };
  const atr = sTicks.reduce((mx, t) => Math.max(mx, Math.abs((t.high ?? t.close) - (t.low ?? t.close))), 0) / Math.max(1, sTicks.reduce((a, t) => a + (t.close ?? 0), 0) / sTicks.length) * 100;
  const lastClose = lastTick.close;
  if (direction === 'CALL') {
    const minLow = Math.min(...sTicks.map((t) => t.low ?? t.close));
    if (lastClose > minLow + SUPPORT_ATR_FACTOR * (atr / 100) * lastClose) return { skip: 'semSuporte' };
  } else {
    const maxHigh = Math.max(...sTicks.map((t) => t.high ?? t.close));
    if (lastClose < maxHigh - SUPPORT_ATR_FACTOR * (atr / 100) * lastClose) return { skip: 'semSuporte' };
  }
  const opp = open.filter((o) => o.direction !== direction);
  if (opp.length) return { skip: 'ladoOposto' };
  return { skip: null, direction, reason: `regime${dir1m}|RSI${rsiNow.toFixed(0)}|ADX${adx.toFixed(1)}|spread${regime1m.spreadPct}%|rsiPrev${prevRsi.toFixed(0)}|bodyRatio${(body/range).toFixed(2)}` };
}

// ─── ESTADO ───────────────────────────────────────────────────────────────────
const WHITELIST = Object.entries(CONFIG.whitelist ?? {}).filter(([key]) => key !== '_nota');
const RESERVE   = Object.entries(CONFIG.reserve ?? {}).filter(([key]) => key !== '_nota');

function defaultState(key, name, baseDirection = null) {
  return {
    key, name, baseDirection,
    direction: baseDirection,
    ladder: 0, cycleOps: 0, galeArmedAt: 0,
    lossStreak: 0, pausedUntil: 0, lastOpAt: 0, lastResult: null,
    // V21 — ciclo Cash/Runner/Recovery
    cycleId: 0,        // ID do ciclo ativo (0 = sem ciclo)
    cycleOpenOps: 0,   // quantas ops do ciclo ainda estão abertas
    runnerLossRecoveryArmed: false,  // true = Runner lossou e Recovery está armada
    recoveryReason: null,           // razão do último Recovery ser armado
    recoveryAttempts: 0,            // quantas Recovery foram feitas neste ciclo (máx 1)
  };
}

function loadState() {
  let saved = {};
  try { if (P.state && fs.existsSync(P.state)) saved = JSON.parse(fs.readFileSync(P.state, 'utf8')); } catch { saved = {}; }
  const state = {};
  for (const [key, wl] of [...WHITELIST, ...RESERVE]) {
    const old = saved?.[key] ?? {};
    state[key] = {
      ...defaultState(key, wl.name, wl.direction ?? null),
      direction: typeof old.direction === 'string' && (old.direction === 'CALL' || old.direction === 'PUT') ? old.direction : (wl.direction ?? null),
      ladder: Math.max(0, Math.min(Math.round(num(old.ladder, 0)), 2)),
      lossStreak: Math.max(0, Math.round(num(old.lossStreak, 0))),
      pausedUntil: num(old.pausedUntil, 0),
      lastOpAt: num(old.lastOpAt, 0),
      lastResult: typeof old.lastResult === 'string' ? old.lastResult : null,
    };
  }
  return state;
}

const state = loadState();
const resultsList = [];
const buf5s = new Map();
const buf1m = new Map();
const inFlight = new Map();          // okey → operação em voo
const running  = new Map();          // activeId → { key, name, aid, source, wr, lastCandleAt, since }
const quotes   = new Map();          // orderId → { sellProfit, at }
const settledRecently = new Map();    // okey → timestamp
const bannedUntil     = new Map();   // activeId → timestamp
const cycleStats = {                  // estatísticas por ciclo
  cash:  { settled: 0, wins: 0, losses: 0, pnl: 0 },
  runner: { settled: 0, wins: 0, losses: 0, pnl: 0 },
  recovery: { settled: 0, wins: 0, losses: 0, pnl: 0 },
  cycles: { total: 0, won: 0, lost: 0, pnl: 0 },
};

const opsFor   = (aid) => [...inFlight.values()].filter((o) => o.assetId === aid);
const openStake = () => [...inFlight.values()].reduce((sum, o) => sum + o.stake, 0);
const nextCycleId = () => Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 999);

function findOp({ aid = null, requestId = null, orderId = null, preferPending = false } = {}) {
  const list = [...inFlight.values()];
  if (orderId !== null && orderId !== undefined && Number.isFinite(Number(orderId))) {
    const byId = list.find((o) => o.orderId !== undefined && o.orderId !== null && String(o.orderId) === String(orderId));
    if (byId) return byId;
  }
  if (requestId) {
    const byReq = list.find((o) => o.requestId === requestId);
    if (byReq) return byReq;
  }
  if (aid === null || !Number.isFinite(aid)) return null;
  const forAsset = opsFor(aid);
  if (!forAsset.length) return null;
  if (preferPending) return forAsset.find((o) => o.orderId === undefined || o.orderId === null) ?? forAsset[0];
  return forAsset.find((o) => o.orderId !== undefined && o.orderId !== null) ?? forAsset[0];
}

let ws = null, warmupDone = false;
let balanceId = null, initialBalance = 0, currentBalance = 0;
let accountType = 'DEMO', currencySymbol = 'US$';
let startedAt = 0, closedCandles = 0, sessionStopLogged = false;
let sessionStartBalance = 0;
const stats = { settled: 0, wins: 0, losses: 0, draws: 0, early: 0, earlyPos: 0, earlyNeg: 0, profit: 0 };

// ─── LOG DE SESSÃO ────────────────────────────────────────────────────────────
const HISTORICO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'historico');
let sessionLogFile = null, sessionLogStream = null;

function ensureHistoricoDir() {
  try { if (!fs.existsSync(HISTORICO_DIR)) fs.mkdirSync(HISTORICO_DIR, { recursive: true }); } catch {}
}

function startSessionLog() {
  ensureHistoricoDir();
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getFullYear()).slice(-2)}`;
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const fileName = `OP_V21_${dateStr}_${timeStr}.log`;
  sessionLogFile = path.join(HISTORICO_DIR, fileName);
  try {
    const header = `═══════════════════════════════════════════════════════════════\n`;
    const title  = `  SESSÃO V21 INICIADA: ${dateStr} às ${timeStr}\n`;
    const info   = `  Bot: ${CODE_REV} | Conta: ${accountType} | Saldo: ${currencySymbol}${initialBalance.toFixed(2)}\n`;
    const cfg    = `  Cash TP: ${currencySymbol}${CASH_TP.toFixed(2)} | Recovery ×${REC_MULTIPLIER} | Expiração: ${EXPIRATION_MIN}min\n`;
    const end    = `═══════════════════════════════════════════════════════════════\n\n`;
    fs.writeFileSync(sessionLogFile, header + title + info + cfg + end);
    sessionLogStream = fs.createWriteStream(sessionLogFile, { flags: 'a' });
    console.log(`[📁] Log V21: ${sessionLogFile}`);
  } catch (e) {
    console.error(`[📁] Erro ao criar log:`, e.message);
    sessionLogStream = null;
  }
}

function sessionLog(line) {
  if (!sessionLogStream) return;
  try {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    sessionLogStream.write(`[${ts}] ${line}\n`);
  } catch {}
}

function endSessionLog(final = false) {
  if (!sessionLogStream) return;
  try {
    if (final) {
      const cs = cycleStats;
      const csLines = [
        `═══════════════════════════════════════════════════════════════`,
        `  RESULTADO V21 POR PAPEL`,
        `  CASH:     N=${cs.cash.settled} W=${cs.cash.wins} L=${cs.cash.losses} P/L=${fmt(cs.cash.pnl)}`,
        `  RUNNER:   N=${cs.runner.settled} W=${cs.runner.wins} L=${cs.runner.losses} P/L=${fmt(cs.runner.pnl)}`,
        `  RECOVERY: N=${cs.recovery.settled} W=${cs.recovery.wins} L=${cs.recovery.losses} P/L=${fmt(cs.recovery.pnl)}`,
        `  CICLOS:   ${cs.cycles.total} total | W=${cs.cycles.won} L=${cs.cycles.lost} P/L=${fmt(cs.cycles.pnl)}`,
        `═══════════════════════════════════════════════════════════════`,
      ].join('\n');
      sessionLogStream.write(`\n${csLines}\n`);
    }
    sessionLogStream.end();
  } catch {}
}

// ─── LOGGING ─────────────────────────────────────────────────────────────────
function shortName(n) {
  return normName(n ?? '');
}

function fmt(v) {
  const s = v >= 0 ? '+' : '';
  return `${s}${currencySymbol}${round2(v).toFixed(2)}`;
}

let lastLog = '';
function logLine(msg) {
  if (msg === lastLog) return;
  lastLog = msg;
  console.log(msg);
}

// ─── ANALYSE 5s (V21 — log detalhado de cada ciclo) ──────────────────────────
let analyseLogInterval = null;

function startAnalyseLog() {
  if (analyseLogInterval) return;
  analyseLogInterval = setInterval(() => {
    if (!warmupDone || inFlight.size === 0) return;
    for (const op of inFlight.values()) {
      const q = quotes.get(String(op.orderId));
      const sellProfit = q?.sellProfit ?? null;
      const remainingMs = op.expiration * 1000 - Date.now();
      const remainingSec = Math.max(0, Math.round(remainingMs / 1000));
      const lpPósVenda = sellProfit !== null ? saleNet(sellProfit, op.stake) : null;
      const buf = buf5s.get(op.assetId);
      const ticks = buf?.ticks ?? [];
      const rsi  = ticks.length >= 15 ? calcRSI(ticks) : null;
      const adx  = ticks.length >= 30 ? calcADX(ticks) : null;
      const trend = ticks.length >= 21 ? trendDirection(ticks) : null;
      const b1   = buf1m.get(op.assetId);
      const regime1m = b1?.ticks?.length >= 8 ? trendDirection1m(b1.ticks) : null;
      const s    = state[op.key];
      const recoveryArmed = s?.runnerLossRecoveryArmed ?? false;
      const cycleStatus = recoveryArmed ? 'RECOVERY_ARMADA' : 'CASH/RUNNER_ABERTA';
      const lpStr = lpPósVenda !== null ? `LP=${fmt(lpPósVenda)}` : 'LP=?';
      console.log(
        `[AN5s] ${shortName(op.name)} ${op.direction} ${op.role?.toUpperCase()} cyc=${op.cycleId} ` +
        `price=${buf?.ticks?.slice(-1)?.[0]?.close?.toFixed(5) ?? '?'} ` +
        `exp=${remainingSec}s ${lpStr} ` +
        `RSI=${rsi?.toFixed(0) ?? '?'} ADX=${adx?.toFixed(1) ?? '?'} ` +
        `trend=${trend?.direction ?? '?'}(${trend?.spreadPct ?? '?'}%) ` +
        `reg1m=${regime1m?.direction ?? '?'} ` +
        `cycle=${cycleStatus} ` +
        `cycleOps=${s?.cycleOps ?? '?'}/${C.maxOpsPerAsset ?? 3}`
      );
    }
  }, 5_000);
}

function stopAnalyseLog() {
  if (analyseLogInterval) { clearInterval(analyseLogInterval); analyseLogInterval = null; }
}

// ─── UNIVERSO (mantido da V20) ────────────────────────────────────────────────
export function selectUniverse({ whitelist = [], reserve = [], actives = [], minActive = MIN_ACTIVE, maxActive = MAX_ACTIVE } = {}) {
  const index = new Map();
  for (const row of actives) {
    if (!row || !row.name) continue;
    const name = normName(row.name);
    if (!index.has(name)) index.set(name, row);
  }
  const usable = (row) => Boolean(row) && row.enabled !== false && row.is_suspended !== true && row.suspended !== true;
  const selected = [];
  const used = new Set();
  const add = (entry, source) => {
    const hit = index.get(normName(entry.name)) ?? index.get(normName(entry.key));
    if (!hit || !usable(hit) || used.has(entry.key)) return false;
    const aid = Number(hit.id ?? hit.active_id);
    if (!Number.isFinite(aid)) return false;
    used.add(entry.key);
    selected.push({ key: entry.key, name: hit.name ?? entry.name, aid, source, wr: entry.wr ?? null });
    return true;
  };
  const unavailableTop = [];
  for (const entry of whitelist) if (!add(entry, 'top')) unavailableTop.push(shortName(entry.name ?? entry.key));
  for (const entry of reserve) { if (selected.length >= maxActive) break; add(entry, 'reserva'); }
  if (selected.length < minActive) {
    for (const row of actives) {
      if (selected.length >= minActive) break;
      if (!row || !row.name || !/otc/i.test(String(row.name)) || !usable(row)) continue;
      const key = normName(row.name);
      if (used.has(key)) continue;
      const aid = Number(row.id ?? row.active_id);
      if (!Number.isFinite(aid)) continue;
      used.add(key);
      selected.push({ key, name: row.name, aid, source: 'auto', wr: null });
    }
  }
  return { selected, unavailableTop };
}

// ─── TRAVAS PURAS ─────────────────────────────────────────────────────────────
export function evaluateGuards({
  open, direction, now, pausedUntil = 0, lastOpAt = 0, lastResult = null,
  stake, balance = 0, exposure = 0, exposureLimit = Infinity,
  sessionLoss = 0, sessionLossLimit = Infinity, maxSameDirection = 3,
}) {
  const sameDir = open.filter((o) => o.direction === direction);
  if (sameDir.length >= maxSameDirection) return 'pyramidMax';
  if (open.length >= (C.maxOpsPerAsset ?? 3)) return 'maxOps';
  if (now < pausedUntil) return 'pausado';
  if (sessionLoss >= sessionLossLimit) return 'perdaSessao';
  if (!open.length && lastOpAt && now - lastOpAt < (lastResult === 'win' ? COOLDOWN_WIN_MS : COOLDOWN_LOSS_MS)) return 'cooldown';
  if (balance > 0 && stake > balance) return 'semSaldo';
  return null;
}

// ─── PLAN/TRADE ────────────────────────────────────────────────────────────────
function planTrade(aid) {
  const b5 = buf5s.get(aid), b1 = buf1m.get(aid);
  if (!b5 || !b1) return null;
  if (b5.ticks.length < num(S.lookbackRegime, 20)) return null;
  if (b1.ticks.length < num(S.min1mCandles, 1)) return null;
  const s = state[b5.key];
  const last = b5.ticks[b5.ticks.length - 1];
  if (!s || nowMs() - last.atMs > num(S.staleCandleMs, 30_000)) return null;
  const open = opsFor(aid);
  const now  = nowMs();

  // Reset do ciclo se todas as ops fecharam
  if (!open.length) {
    const vencido = s.galeArmedAt && now - s.galeArmedAt > GALE_WINDOW_MS;
    if (vencido || s.lastResult === 'win' || s.cycleOps >= (C.maxOpsPerAsset ?? 3)) {
      s.cycleOps = 0;
      s.galeArmedAt = 0;
      s.runnerLossRecoveryArmed = false;
      s.recoveryReason = null;
      s.recoveryAttempts = 0;
      s.cycleId = 0;
      s.cycleOpenOps = 0;
    }
  }

  // V21: bloqueia nova entrada se ciclo ainda tem ops abertas (Cash+Runner simultâneas)
  if (open.length > 0) return null;

  const trend = trendDirection(b5.ticks);
  const regime = detectRegime(b5.ticks);
  const rsi   = calcRSI(b5.ticks);
  const adx   = calcADX(b5.ticks);
  const b1Last = b1.ticks[b1.ticks.length - 1] ?? null;
  if (!s.regime1m || s.regime1m.at !== b1Last?.atMs) {
    s.regime1m = { ...trendDirection1m(b1.ticks), at: b1Last?.atMs ?? null };
  }

  const decision = evaluateEntry({ ticks: b5.ticks, open, trend, regime, rsi, adx, cycleOps: s.cycleOps, mode: ENTRY_MODE, regime1m: s.regime1m });
  if (decision.skip) return null;

  // Se Runner lossou e Recovery NÃO foi feita → avalia Recovery
  if (s.runnerLossRecoveryArmed && s.recoveryAttempts === 0) {
    const recResult = evaluateRecovery({ aid, direction: decision.direction });
    if (recResult.skip) {
      sessionLog(`RECOVERY_SKIPPED ${recResult.skip} | ${shortName(s.name)} | direção=${decision.direction}`);
      return { direction: decision.direction, trend, rsi, adx, kind: 'recovery_skipped', recoverySkipReason: recResult.skip };
    }
    return { direction: decision.direction, trend, rsi, adx, kind: 'recovery', reason: recResult.reason, recoveryReason: recResult.recoveryReason };
  }

  return { direction: decision.direction, trend, rsi, adx, kind: 'signal', reason: decision.reason };
}

function canTrade(aid, direction, stake) {
  const buf = buf5s.get(aid);
  const s   = buf ? state[buf.key] : null;
  if (!s) return null;
  const loss = sessionStartBalance > 0 ? sessionStartBalance - currentBalance : 0;
  const reason = evaluateGuards({
    open: opsFor(aid), direction, now: nowMs(),
    pausedUntil: s.pausedUntil, lastOpAt: s.lastOpAt, lastResult: s.lastResult,
    stake, balance: currentBalance,
    exposure: openStake(), exposureLimit: exposureLimit(),
    sessionLoss: loss, sessionLossLimit: sessionLossLimit(),
    maxSameDirection: C.maxOpsPerAsset ?? 3,
  });
  if (reason) {
    if (reason === 'perdaSessao' && !sessionStopLogged) {
      sessionStopLogged = true;
      logLine(`[🛑 TRAVA DE PERDA] sessão ${fmt(-loss)} de ${currencySymbol}${sessionLossLimit().toFixed(2)} — nenhuma ordem`);
    }
    return null;
  }
  return s;
}

// ─── RECOVERY: avaliação técnica (nova confirmação) ───────────────────────────
function evaluateRecovery({ aid, direction }) {
  const buf = buf5s.get(aid), b1 = buf1m.get(aid);
  if (!buf || !b1) return { skip: 'SEM_DADOS' };
  const ticks = buf.ticks;
  if (!Array.isArray(ticks) || ticks.length < 20) return { skip: 'DADOS_INSUFICIENTES' };

  // Tempo: não entra nos últimos REC_CLOSE_BEFORE ms antes do vencimento
  // (precisamos de pelo menos closeBeforeMs de vida útil)
  const openOps = opsFor(aid);
  const runnerOp = openOps.find((o) => o.role === 'runner');
  if (runnerOp) {
    const remainingMs = runnerOp.expiration * 1000 - nowMs();
    if (remainingMs < REC_CLOSE_BEFORE) return { skip: 'RECOVERY_SKIPPED_TOO_LATE' };
  }

  // Regime 1m ainda válido (não virou contra)
  const s = state[buf.key];
  if (!s?.regime1m || s.regime1m.direction === 'lateral1m') return { skip: 'REGIME_INVALIDADO' };
  if (direction === 'CALL' && s.regime1m.direction !== 'alta1m') return { skip: 'REGIME_INVALIDADO' };
  if (direction === 'PUT'  && s.regime1m.direction !== 'baixa1m') return { skip: 'REGIME_INVALIDADO' };

  const rsi  = calcRSI(ticks);
  const adx  = calcADX(ticks);
  const trend = trendDirection(ticks);

  // RSI reagindo (não precisa estar no extremo, mas precisa mostrar reação)
  // Recovery CALL: RSI subiu (reagiu para cima após queda)
  // Recovery PUT: RSI caiu (reagiu para baixo após alta)
  const rsiReacting = direction === 'CALL' ? rsi >= 35 && rsi <= 55 : direction === 'PUT' ? rsi >= 45 && rsi <= 65 : false;
  if (!rsiReacting) return { skip: 'RSI_NAO_REAGIU' };

  // ADX confirma tendência
  if (adx < 15) return { skip: 'ADX_FRACO' };

  // ATRP: volatilidade não pode estar em explosion
  const closes = ticks.map((t) => t.close);
  const atrAvg = ticks.slice(-14).reduce((sum, t, i, arr) => {
    if (i === 0) return 0;
    return sum + Math.abs((t.high ?? t.close) - (t.low ?? t.close));
  }, 0) / Math.max(1, ticks.slice(-14).length);
  const lastClose = closes[closes.length - 1];
  const ATRP = atrAvg > 0 ? (atrAvg / lastClose) * 100 : 0;
  if (ATRP > REC_MAX_ATRP_PCT) return { skip: `ATRP_ALTO_${ATRP.toFixed(1)}%` };

  // Tendência 5s a favor
  if (trend.direction !== direction) return { skip: 'TREND_CONTRA' };

  // Zona de suporte/resistência (preço perto de EMA ou de estrutura)
  const ema21 = calcEMA(closes, 21);
  const ema8  = calcEMA(closes, 8);
  if (!ema21 || !ema8) return { skip: 'SEM_EMA' };
  const spreadFromEma = Math.abs(lastClose - ema21) / ema21 * 100;
  if (spreadFromEma > 0.15) return { skip: 'PRECO_LONGE_DA_EMA' };

  const reason = `Recovery confirmada: RSI=${rsi.toFixed(0)} ADX=${adx.toFixed(1)} ATRP=${ATRP.toFixed(2)}% EMA8=${ema8.toFixed(5)} EMA21=${ema21.toFixed(5)} spreadEma=${spreadFromEma.toFixed(3)}%`;
  return { skip: null, reason, recoveryReason: reason };
}

// ─── ENVIAR ORDEM ─────────────────────────────────────────────────────────────
function nowMs() { return Date.now(); }

function exposureLimit() {
  return (currentBalance * MAX_EXPOSURE_PCT) / 100;
}

function sessionLossLimit() {
  return (sessionStartBalance * SESSION_LOSS_PCT) / 100;
}

function sendOrder(aid, direction, stake, expiration, optionTypeId, requestId, role, cycleId) {
  const b5  = buf5s.get(aid);
  const s   = b5 ? state[b5.key] : null;
  if (!b5 || !s) return null;
  const entryPrice = b5.ticks[b5.ticks.length - 1]?.close ?? null;
  const okey = `${aid}|${expiration}|${requestId}`;
  const record = {
    assetId: aid, active: b5.name, key: s.key, direction, role, cycleId,
    baseDirection: s.baseDirection, stake, entryPrice, expiration, requestId,
    sentAtMs: nowMs(), timestamp: new Date().toISOString(), rev: CODE_REV,
  };
  resultsList.push(record);
  const op = {
    okey, assetId: aid, key: s.key, name: b5.name, direction, role, cycleId,
    stake, entryPrice, expiration, requestId, sentAtMs: record.sentAtMs, record,
    sellAttempts: 0, lastSellAt: 0, sellRequestedAt: 0, sellKind: null, sellQuote: null,
  };
  inFlight.set(okey, op);
  s.lastOpAt = record.sentAtMs;
  s.direction = direction;

  ws.send('sendMessage', {
    body: {
      price: stake, active_id: aid, expired: expiration,
      direction: direction.toLowerCase(),
      option_type_id: optionTypeId, user_balance_id: Number(balanceId),
    },
    name: 'binary-options.open-option', version: '1.0',
  }, requestId);

  return op;
}

// ─── MONITOR DE POSIÇÕES ABERTAS (5s — V21: Cash + Recovery) ───────────────────
let monitorBusy = false;

async function evaluateOpenPositions() {
  if (monitorBusy || !warmupDone) return;
  if (inFlight.size === 0) return;

  monitorBusy = true;
  try {
    for (const op of [...inFlight.values()]) {
      // ── CASH: avalia venda antecipada por L/P pós-venda real ──────────────
      if (op.role === 'cash') {
        const q = quotes.get(String(op.orderId));
        if (!q) continue;
        const sellProfit = q.sellProfit;
        if (sellProfit === null || sellProfit === undefined) continue;

        const remainingMs = op.expiration * 1000 - nowMs();
        if (remainingMs <= CLOSE_BEFORE_MS) continue;  // IQ não aceita venda no fim
        if ((op.sellAttempts ?? 0) >= SELL_MAX_ATTEMPTS) continue;
        if (nowMs() - (op.lastSellAt ?? 0) < SELL_RETRY_MS) continue;

        const lpLiquido = saleNet(sellProfit, op.stake);
        if (lpLiquido >= CASH_TP) {
          op.sellAttempts = (op.sellAttempts ?? 0) + 1;
          op.lastSellAt = nowMs();
          op.sellRequestedAt = nowMs();
          op.sellKind = 'cashTarget';
          op.sellQuote = sellProfit;
          const reqId = ws.sellOption(op.orderId);
          op.sellRequestId = reqId;
          const netProfit = saleNet(sellProfit, op.stake);
          const s = state[op.key];
          if (s) {
            s.cycleOpenOps = Math.max(0, (s.cycleOpenOps ?? 1) - 1);
            cycleStats.cash.settled++;
            cycleStats.cash.pnl = round2(cycleStats.cash.pnl + netProfit);
            if (netProfit > 0) cycleStats.cash.wins++;
            else cycleStats.cash.losses++;
          }
          registerOutcome(netProfit, true);
          logLine(`[💰 CASH] ${shortName(op.name)} ${op.direction} | venda: sell_profit=${fmt(sellProfit)} LP=${fmt(netProfit)} >= TP=${fmt(CASH_TP)} | cyc=${op.cycleId}`);
          sessionLog(`CASH_VENDA | ${shortName(op.name)} | ${op.direction} | sell=${fmt(sellProfit)} | LP=${fmt(netProfit)} | TP=${fmt(CASH_TP)} | cyc=${op.cycleId}`);
        }
      }

      // ── RUNNER: detecta loss para armar Recovery ───────────────────────────
      if (op.role === 'runner' && !op.settled) {
        const q = quotes.get(String(op.orderId));
        if (!q) continue;
        const sellProfit = q.sellProfit;
        if (sellProfit === null || sellProfit === undefined) continue;

        const s = state[op.key];
        if (!s) continue;
        // Se Runner está perdendo (sell_profit < stake) E ainda não armamos Recovery
        if (sellProfit < op.stake && !s.runnerLossRecoveryArmed) {
          // Recovery é armada no settlement do Runner, não aqui
        }
      }
    }

    // ── RECOVERY: avaliar se alguma Recovery deve ser disparada ────────────
    for (const [key, s] of Object.entries(state)) {
      if (!s.runnerLossRecoveryArmed || s.recoveryAttempts > 0) continue;
      // Encontra o ativo correspondente
      const aidEntry = [...running.entries()].find(([, v]) => v.key === key);
      if (!aidEntry) continue;
      const [aid] = aidEntry;
      const buf = buf5s.get(aid);
      if (!buf) continue;

      const openOps = opsFor(aid);
      // Se não há mais Runner aberta, Recovery já deveria ter sido avaliada no settlement
      if (openOps.some((o) => o.role === 'runner' && !o.settled)) continue;
      // Runner fechou — avalia se Recovery deve entrar
      const direction = s.direction === 'CALL' ? 'PUT' : 'CALL';
      const stake = round2(BASE_STAKE * REC_MULTIPLIER);
      const remainingMs = openOps.length > 0 ? (openOps.reduce((mx, o) => Math.max(mx, o.expiration * 1000 - nowMs()), 0)) : Infinity;

      if (remainingMs < REC_CLOSE_BEFORE) {
        sessionLog(`RECOVERY_SKIPPED_TOO_LATE | ${shortName(s.name)} | tempo=${Math.round(remainingMs/1000)}s`);
        s.runnerLossRecoveryArmed = false;
        continue;
      }

      const recCheck = evaluateRecovery({ aid, direction });
      if (recCheck.skip) {
        sessionLog(`RECOVERY_SKIPPED ${recCheck.skip} | ${shortName(s.name)}`);
        s.runnerLossRecoveryArmed = false;
        continue;
      }

      // Recovery confirmada — avalia guards e envia
      const guard = canTrade(aid, direction, stake);
      if (!guard) {
        sessionLog(`RECOVERY_GUARD_FAILED | ${shortName(s.name)} | direcao=${direction} | stake=${stake}`);
        s.runnerLossRecoveryArmed = false;
        continue;
      }

      const { expiration, optionTypeId } = computeExpiration(Math.floor(nowMs() / 1000), EXPIRATION_MIN);
      const requestId = ws.uuid().replace(/-/g, '').slice(0, 12);
      sendOrder(aid, direction, stake, expiration, optionTypeId, requestId, 'recovery', s.cycleId);
      s.recoveryAttempts = 1;
      s.runnerLossRecoveryArmed = false;
      guard.cycleOps = (guard.cycleOps ?? 0) + 1;
      const op = inFlight.get(`${aid}|${expiration}|${requestId}`);
      if (op) op.recoveryReason = recCheck.recoveryReason;
      logLine(`[🎲 RECOVERY] ${shortName(s.name)} ${direction} ${fmt(stake)} | ${recCheck.reason} | cyc=${s.cycleId}`);
      sessionLog(`RECOVERY_DISPARADA | ${shortName(s.name)} | ${direction} | stake=${fmt(stake)} | ${recCheck.recoveryReason} | cyc=${s.cycleId}`);
    }
  } finally {
    monitorBusy = false;
  }
}

// ─── ENTRADA PRINCIPAL (duas posições: Cash + Runner) ─────────────────────────
function maybeTrade(aid) {
  if (!warmupDone) return;
  const plan = planTrade(aid);
  if (!plan) return;

  const s = state[buf5s.get(aid)?.key];
  if (!s) return;

  // Recovery já Skipped — loga e ignora
  if (plan.kind === 'recovery_skipped') {
    sessionLog(`RECOVERY_SKIPPED ${plan.recoverySkipReason} | ${shortName(s.name)}`);
    s.runnerLossRecoveryArmed = false;
    return;
  }

  // Se Recovery foi confirmada pelo planTrade
  if (plan.kind === 'recovery') {
    // Já é tratada no bloco de Recovery acima (planTrade retorna para Recovery)
    return;
  }

  // Entrada normal: Cash + Runner
  if (plan.kind !== 'signal') return;

  const stake = BASE_STAKE;
  const guard = canTrade(aid, plan.direction, stake * 2);
  if (!guard) return;

  if (stake > MAX_STAKE || stake * 2 > MAX_STAKE) {
    guard.pausedUntil = nowMs() + PAUSE_AFTER_MS;
    logLine(`[⛔ BLOQUEADO] ${shortName(s.name)} | stake ${currencySymbol}${stake * 2} acima de ${currencySymbol}${MAX_STAKE}`);
    return;
  }

  const { expiration, optionTypeId } = computeExpiration(Math.floor(nowMs() / 1000), EXPIRATION_MIN);
  const cycleId = nextCycleId();

  // Gera dois requestIds diferentes
  const reqCash   = ws.uuid().replace(/-/g, '').slice(0, 12);
  const reqRunner = ws.uuid().replace(/-/g, '').slice(0, 12);

  // CASH
  const cashOp = sendOrder(aid, plan.direction, stake, expiration, optionTypeId, reqCash, 'cash', cycleId);
  // RUNNER
  const runnerOp = sendOrder(aid, plan.direction, stake, expiration, optionTypeId, reqRunner, 'runner', cycleId);

  if (cashOp && runnerOp) {
    s.cycleId = cycleId;
    s.cycleOpenOps = 2;
    s.cycleOps = (s.cycleOps ?? 0) + 2;

    logLine(`[📤 CICLO ${cycleId}] ${shortName(s.name)} ${plan.direction} | CASH ${currencySymbol}${stake.toFixed(2)} + RUNNER ${currencySymbol}${stake.toFixed(2)} | ${plan.reason}`);
    sessionLog(`CICLO_INICIO | ${shortName(s.name)} | ${plan.direction} | CASH=${fmt(stake)} RUNNER=${fmt(stake)} | ${plan.reason} | cyc=${cycleId}`);

    // Atualiza estado do cycleStats
    cycleStats.cycles.total++;
  }

  saveResults();
}

// ─── COTIZAÇÃO (sell_profit em tempo real) ────────────────────────────────────
let quoteFirstLogged = false;
let posDumpCount = 0;

export function parsePositionChanged(raw) {
  const value = raw?.sell_profit;
  if (value === undefined || value === null) return null;
  const opt = raw?.raw_event?.binary_options_option_changed1 ?? null;
  const id  = Number(raw?.external_id ?? opt?.option_id ?? raw?.id);
  const sellProfit = Number(value);
  if (!Number.isFinite(id) || !Number.isFinite(sellProfit)) return null;
  return { id, sellProfit };
}

function onPositionChanged(raw) {
  const parsed = parsePositionChanged(raw);
  if (!parsed) return;
  quotes.set(String(parsed.id), { sellProfit: parsed.sellProfit, at: nowMs() });
  if (!quoteFirstLogged) {
    quoteFirstLogged = true;
    logLine('[💱] cotação em tempo real OK (sell_profit) — Cash monitorada a cada 5s');
  }
}

// ─── REGISTRO DE RESULTADO ────────────────────────────────────────────────────
function registerOutcome(profit, early = false) {
  stats.settled++;
  stats.profit = round2(stats.profit + (profit || 0));
  if (profit > 0) stats.wins++;
  else if (profit < 0) stats.losses++;
  else stats.draws++;
  if (early) {
    stats.early++;
    if (profit > 0) stats.earlyPos++;
    else if (profit < 0) stats.earlyNeg++;
  }
}

// ─── APLICA RESULTADO E FECHA POSIÇÃO ───────────────────────────────────────
function applyResult(op, result, profit) {
  const s = state[op.key];
  if (!s) return;

  // Atualiza ciclo
  if (op.cycleId) {
    s.cycleOpenOps = Math.max(0, (s.cycleOpenOps ?? 1) - 1);

    // Estatísticas por papel
    if (op.role === 'cash') {
      cycleStats.cash.settled++;
      cycleStats.cash.pnl = round2(cycleStats.cash.pnl + (profit || 0));
      if (profit > 0) cycleStats.cash.wins++;
      else if (profit < 0) cycleStats.cash.losses++;
    } else if (op.role === 'runner') {
      cycleStats.runner.settled++;
      cycleStats.runner.pnl = round2(cycleStats.runner.pnl + (profit || 0));
      if (profit > 0) cycleStats.runner.wins++;
      else if (profit < 0) cycleStats.runner.losses++;
      // Runner lossou → arma Recovery
      if (result === 'loss' && s.recoveryAttempts === 0) {
        s.runnerLossRecoveryArmed = true;
        s.recoveryReason = null;
        logLine(`[🎲 ARMADA] ${shortName(op.name)} Runner lossou → Recovery armada | cyc=${op.cycleId}`);
        sessionLog(`RECOVERY_ARMADA | ${shortName(op.name)} | loss=${fmt(profit)} | cyc=${op.cycleId}`);
      }
    } else if (op.role === 'recovery') {
      cycleStats.recovery.settled++;
      cycleStats.recovery.pnl = round2(cycleStats.recovery.pnl + (profit || 0));
      if (profit > 0) cycleStats.recovery.wins++;
      else if (profit < 0) cycleStats.recovery.losses++;
    }

    // Ciclo fechou (todas as ops fecharam)
    if (s.cycleOpenOps <= 0) {
      const cashWon   = cycleStats.cash.settled > 0 ? cycleStats.cash.pnl > 0 : null;
      const runnerWon = cycleStats.runner.settled > 0 ? cycleStats.runner.pnl > 0 : null;
      const recWon    = cycleStats.recovery.settled > 0 ? cycleStats.recovery.pnl > 0 : null;
      // P/L do ciclo
      const cyclePnl = (cycleStats.cash.pnl + cycleStats.runner.pnl + cycleStats.recovery.pnl);
      cycleStats.cycles.pnl = round2(cycleStats.cycles.pnl + cyclePnl);
      if (cyclePnl > 0) cycleStats.cycles.won++;
      else if (cyclePnl < 0) cycleStats.cycles.lost++;

      logLine(`[🏁 CICLO ${op.cycleId} FECHADO] ${shortName(op.name)} | CASH W=${cycleStats.cash.wins} L=${cycleStats.cash.losses} | RUNNER W=${cycleStats.runner.wins} L=${cycleStats.runner.losses} | REC W=${cycleStats.recovery.wins} L=${cycleStats.recovery.losses} | P/L=${fmt(cyclePnl)}`);
      sessionLog(`CICLO_FIM | ${shortName(op.name)} | cyc=${op.cycleId} | P/L=${fmt(cyclePnl)}`);

      // Reset ciclo
      s.cycleId = 0;
      s.cycleOpenOps = 0;
      s.runnerLossRecoveryArmed = false;
      s.recoveryReason = null;
      s.recoveryAttempts = 0;
      s.lastResult = result;
    }
  }

  // Estado legado (mantido para compatibilidade com evaluateGuards)
  if (result === 'loss') {
    s.lossStreak = (s.lossStreak ?? 0) + 1;
  } else {
    s.lossStreak = 0;
    s.lastResult = result;
  }

  saveState();
}

function finalizeEarly(op, returnedValue, source) {
  inFlight.delete(op.okey);
  settledRecently.set(op.okey, nowMs());
  const devolve = round2(Number.isFinite(returnedValue) ? returnedValue : 0);
  const profit = saleNet(devolve, op.stake);
  Object.assign(op.record, {
    result: 'early', profit, earlySell: true, sellReturn: devolve, profitSource: source,
    sellKind: op.sellKind ?? null, settledAt: new Date().toISOString(),
  });
  saveResults();
  applyResult(op, 'early', profit);
  void refreshBalance().then(() => { saveState(); renderDashboard(); });
  const emoji = profit >= 0 ? '✂️✅' : '✂️❌';
  logLine(`[${emoji} ${op.role?.toUpperCase()}] ${shortName(op.name)} ${op.direction} | venda: devolve ${fmt(devolve)} (líquido ${fmt(profit)}) | cyc=${op.cycleId}`);
  sessionLog(`VENDA_CASH | ${shortName(op.name)} | ${op.direction} | devolve=${fmt(devolve)} | LP=${fmt(profit)} | role=${op.role} | cyc=${op.cycleId}`);
}

async function refreshBalance() {
  try {
    const list = (await ws.getBalances())?.msg ?? [];
    const account = (Array.isArray(list) ? list : []).find((b) => Number(b?.type) === (accountType === 'DEMO' ? 4 : 1));
    if (account && Number.isFinite(Number(account.amount))) currentBalance = Number(account.amount);
  } catch {}
}

// ─── LOGIN ─────────────────────────────────────────────────────────────────────
async function login() {
  let creds = { email: CONFIG.login.email, password: CONFIG.login.password };
  try {
    const c = JSON.parse(fs.readFileSync('./bot-credentials.json', 'utf8'));
    if (c.email && c.password) creds = c;
  } catch {}
  const postData = JSON.stringify({ identifier: creds.email, password: creds.password });
  const body = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData), 'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' },
    }, (res) => { let text = ''; res.on('data', (d) => text += d); res.on('end', () => resolve(text)); });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
  const parsed = JSON.parse(body);
  return parsed.result?.ssid ?? parsed.ssid;
}

async function fetchActives() {
  const init = (await ws.getInitializationData())?.msg ?? {};
  const turbo = init?.turbo?.actives ?? {};
  return Object.entries(turbo).map(([id, act]) => ({ id: Number(id), name: act?.name, enabled: act?.enabled, is_suspended: act?.is_suspended }));
}

function ensureState(key, name, baseDirection = null) {
  if (!state[key]) state[key] = defaultState(key, name, baseDirection);
  return state[key];
}

function applyUniverse(actives, reason, { subscribe = true } = {}) {
  const whitelist = WHITELIST.map(([key, wl]) => ({ key, name: wl.name, wr: num(wl.wr, 0) }));
  const reserve  = RESERVE.map(([key, wl]) => ({ key, name: wl.name, wr: null }));
  const usable    = actives.filter((row) => !bannedUntil.has(Number(row.id)) || bannedUntil.get(Number(row.id)) < nowMs());
  const { selected, unavailableTop } = selectUniverse({ whitelist, reserve, actives: usable, minActive: MIN_ACTIVE, maxActive: MAX_ACTIVE });

  for (const aid of running.keys()) {
    if (!selected.some((e) => e.aid === aid)) {
      if (opsFor(aid).length) continue;
      running.delete(aid); buf5s.delete(aid); buf1m.delete(aid);
    }
  }
  for (const entry of selected) {
    if (running.has(entry.aid)) continue;
    buf5s.set(entry.aid, Object.assign(new ClosedCandles(num(S.candleSizeSeconds, 5)), { key: entry.key, name: entry.name, aid: entry.aid }));
    buf1m.set(entry.aid, new ClosedCandles(60));
    ensureState(entry.key, entry.name);
    running.set(entry.aid, { ...entry, lastCandleAt: 0, since: nowMs() });
    if (subscribe) { ws.subscribeCandles(entry.aid, num(S.candleSizeSeconds, 5)); ws.subscribeCandles(entry.aid, 60); }
  }
  const names = [...running.values()].map((r) => shortName(r.name)).join(' • ');
  if (reason === 'boot') {
    logLine(`[📋] ${running.size} ativos | min=${MIN_ACTIVE} | max=${MAX_ACTIVE}`);
    logLine(`     ${names.slice(0, 300)}${names.length > 300 ? '...' : ''}`);
    if (unavailableTop.length) logLine(`[⚠️] top fora agora: ${unavailableTop.slice(0, 10).join(', ')}`);
    if (running.size < MIN_ACTIVE) logLine(`[⚠️] universo ABAIXO do mínimo ${MIN_ACTIVE}`);
  } else {
    logLine(`[🔁] universo (${reason}): ${running.size} ativos`);
  }
}

async function rebalanceUniverse() {
  if (!ws) return;
  try {
    const actives = await fetchActives();
    for (const [aid, row] of running) {
      const info = actives.find((a) => Number(a.id) === aid);
      const closed = !info || info.enabled === false || info.is_suspended === true;
      const stale   = row.lastCandleAt > 0 && nowMs() - row.lastCandleAt > REPLACE_STALE_MS;
      const noFeed  = row.lastCandleAt === 0 && nowMs() - row.since > REPLACE_STALE_MS;
      if (closed || stale || noFeed) {
        if (opsFor(aid).length) continue;
        bannedUntil.set(aid, nowMs() + REPLACE_STALE_MS);
        running.delete(aid); buf5s.delete(aid); buf1m.delete(aid);
      }
    }
    applyUniverse(actives, 'revisão');
  } catch {}
}

// ─── DASHBOARD ─────────────────────────────────────────────────────────────────
let dashboardHidden = false;

function symbolOf(currency) {
  return currency === 'BRL' ? 'R$' : '$';
}

function renderDashboard() {
  if (dashboardHidden) return;
  const elapsed = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const open = [...inFlight.values()].reduce((sum, o) => sum + o.stake, 0);
  const wr   = stats.settled ? `${(stats.wins / stats.settled * 100).toFixed(1)}%` : '0.0%';
  const line = `\r[⏱${mm}:${ss}] [🔼${closedCandles}] [📊${stats.settled}] [✅${stats.wins}] [❌${stats.losses}] [WR ${wr}] [💰${fmt(stats.profit)}] [⏳${fmt(open)}]`;
  if (process.stdout.isTTY) {
    process.stdout.write(`\x1b[2K\r${line}`.slice(0, process.stdout.columns || 120));
  }
}

// ─── PERSISTÊNCIA ──────────────────────────────────────────────────────────────
function saveResults() {
  try { fs.writeFileSync(P.results ?? './resultados-v21.json', JSON.stringify(resultsList.slice(-1000), null, 2)); } catch {}
}

function saveState() {
  const toSave = {};
  for (const [key, s] of Object.entries(state)) {
    toSave[key] = { direction: s.direction, ladder: s.ladder, lossStreak: s.lossStreak, pausedUntil: s.pausedUntil, lastOpAt: s.lastOpAt, lastResult: s.lastResult };
  }
  try { fs.writeFileSync(P.state ?? './bot-state-v21.json', JSON.stringify(toSave, null, 2)); } catch {}
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────
const fatal = (err) => { console.error('[FATAL]', err); process.exit(1); };

async function main() {
  const ssid = await login();
  logLine('[✅] LOGIN OK — conectando ao WebSocket...');
  ws = new IqWsClient({ log: (...args) => logLine(args.join(' ')) });

  ws.on('message', (m) => {
    if (m?.name === 'position-changed') onPositionChanged(m?.msg ?? {});
  });

  // Kill switch
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', (str, key) => {
      if (key?.ctrl && key.name === 'c') { shutdown('SIGINT'); return; }
      if (str === 'k' || str === 'K') { shutdown('K'); return; }
      if (str === 't' || str === 'T') { dashboardHidden = !dashboardHidden; if (dashboardHidden) process.stdout.write('\x1b[2K\r'); else renderDashboard(); }
    });
    logLine('[🎮] K / Ctrl+C para matar com relatório');
  }

  const onReady = async () => {
    const rows = (await ws.getBalances())?.msg ?? [];
    let chosen;
    if (WANT_DEMO === true) chosen = rows.find((b) => b.type === 4);
    else if (WANT_DEMO === false) chosen = rows.find((b) => b.type === 1);
    else {
      logLine('[💼] Contas: ' + rows.map((b) => `${b.type === 1 ? 'REAL' : 'DEMO'} ${symbolOf(b.currency)}${Number(b.amount).toFixed(2)}`).join(' | '));
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = () => new Promise((res) => rl.question('[?] 1=REAL | 2=DEMO: ', res));
      while (!chosen) {
        const answer = await ask();
        chosen = answer === '1' ? rows.find((b) => b.type === 1) : answer === '2' ? rows.find((b) => b.type === 4) : null;
        if (!chosen) logLine('[!] 1 ou 2.');
      }
      rl.close();
    }
    if (!chosen || Number(chosen.amount) <= 0) { console.error('[ERRO] Conta inválida ou sem saldo.'); ws.close(); process.exit(1); }
    balanceId = chosen.id;
    initialBalance = currentBalance = Number(chosen.amount);
    sessionStartBalance = currentBalance;
    accountType = chosen.type === 4 ? 'DEMO' : 'REAL';
    currencySymbol = symbolOf(chosen.currency);

    if (initialBalance < BASE_STAKE) { console.error(`[ERRO] Saldo insuficiente: ${currencySymbol}${initialBalance.toFixed(2)}`); process.exit(1); }

    logLine(`[💼] CONTA ${accountType} (${chosen.currency}) | saldo ${currencySymbol}${initialBalance.toFixed(2)}`);
    ws.subscribePositionChanges({ userId: chosen.user_id, balanceId, instrumentType: 'turbo-option' });
    ws.subscribePositionChanges({ userId: chosen.user_id, balanceId, instrumentType: 'binary-option' });
    logLine(`[🧬] CÓDIGO ${CODE_REV} | stake ${currencySymbol}${BASE_STAKE.toFixed(2)} | Cash TP=${fmt(CASH_TP)} | Recovery ×${REC_MULTIPLIER} | expiração ${EXPIRATION_MIN}min`);
    logLine(`[📤] CASH + RUNNER: cada sinal abre 2 posições iguais | CASH: vende quando LP>=${fmt(CASH_TP)} (sell_profit real) | RUNNER: vai até expiração`);
    logLine(`[🎲] RECOVERY: máx 1 por ciclo, após Runner loss + confirmação técnica | stake=${fmt(BASE_STAKE * REC_MULTIPLIER)} | REGIME INVALIDADO bloqueia`);
    logLine(`[🛡️] ENTRADA (V20 IDENTICA): regime 1m (EMA8×21), RSI cruzando ${RSI_TOUCH_CALL}/${RSI_TOUCH_PUT}, ADX>=${num(S.adxMinEntry,15)}, corpo>=${num(S.entryBodyRatio,0.4)}xATR`);
    logLine(`[⚠️] DEMO/PRACTICE APENAS — nenhuma operação REAL durante os testes`);

    const actives = await fetchActives();
    applyUniverse(actives, 'boot', { subscribe: false });

    const need5 = num(S.lookbackRegime, 20);
    const need1 = Math.min(REGIME_1M_MIN_CAND, BOOT_1M_CANDLES);
    const now0 = nowMs();
    const asc = (list) => (Array.isArray(list) ? list.slice().sort((x, y) => (toMs(x?.from ?? x?.at) ?? 0) - (toMs(y?.from ?? y?.at) ?? 0)) : []);

    const CHUNK = 20;
    const aids = [...running.keys()];
    let ready = 0, semResposta = 0;
    const tHist = Date.now();
    for (let i = 0; i < aids.length; i += CHUNK) {
      await Promise.all(aids.slice(i, i + CHUNK).map(async (aid) => {
        try {
          const h5 = await ws.getCandlesHistory({ activeId: aid, size: num(S.candleSizeSeconds, 5), count: 40 });
          for (const c of asc(h5?.msg?.candles)) buf5s.get(aid)?.ingest(c, now0);
          const h1 = await ws.getCandlesHistory({ activeId: aid, size: 60, count: BOOT_1M_CANDLES });
          for (const c of asc(h1?.msg?.candles)) buf1m.get(aid)?.ingest(c, now0);
        } catch { semResposta++; }
        if (buf5s.get(aid)?.ticks.length >= need5 && buf1m.get(aid)?.ticks.length >= need1) ready++;
        running.get(aid).lastCandleAt = 0;
      }));
    }
    logLine(`[🔁] histórico: ${ready}/${running.size} prontos (5s≥${need5}, 1m≥${need1}) | ${((Date.now() - tHist) / 1000).toFixed(1)}s`);

    for (const aid of running.keys()) {
      ws.subscribeCandles(aid, num(S.candleSizeSeconds, 5));
      ws.subscribeCandles(aid, 60);
    }
    await new Promise((r) => setTimeout(r, num(S.warmupMs, 1_500)));
    warmupDone = true;
    startedAt = nowMs();
    startSessionLog();
    startAnalyseLog();
    logLine(`[✅] OPERANDO ${CODE_REV} — Cash/Runner/Recovery | painel abaixo`);
    renderDashboard();

    setInterval(() => { if (!shuttingDown) renderDashboard(); }, 1_000);
    // Scan de entradas
    setInterval(() => { if (shuttingDown || !warmupDone) return; for (const aid of running.keys()) maybeTrade(aid); }, ENTRY_SCAN_MS);
    // Monitor de posições abertas (5s — Cash sell + Recovery trigger)
    setInterval(() => { void evaluateOpenPositions(); }, 5_000);
    // Rebalanceamento de universo
    setInterval(() => { void rebalanceUniverse(); }, UNIVERSE_CHECK_MS);
    // Verificação de ACK
    setInterval(() => {
      for (const op of inFlight.values()) {
        if (!op.ackLogged && !op.orderId && nowMs() - op.sentAtMs > 5_000) {
          op.ackLogged = true;
          logLine(`[⚠️] ${shortName(op.name)}: sem ACK em 5s (${op.role})`);
        }
      }
      for (const [okey, at] of settledRecently) if (nowMs() - at > 300_000) settledRecently.delete(okey);
      renderDashboard();
    }, 1_000);
  };

  ws.on('ready', () => { void onReady().catch(fatal); });

  ws.on('candle-generated', (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid  = Number(raw.active_id ?? raw.activeId);
    const size = sizeOf(raw);
    if (!Number.isFinite(aid) || size === null) return;
    const now  = nowMs();
    const row  = running.get(aid);
    if (size === num(S.candleSizeSeconds, 5)) {
      const buffer = buf5s.get(aid);
      if (!buffer) return;
      if (buffer.ingest(raw, now)) {
        closedCandles++;
        if (row) row.lastCandleAt = now;
        maybeTrade(aid);
        renderDashboard();
      }
    } else if (size === 60) {
      buf1m.get(aid)?.ingest(raw, now);
    }
  });

  ws.on('socket-option-opened', (msg) => {
    const raw = msg?.msg ?? msg;
    const op = findOp({ aid: Number(raw?.active_id ?? raw?.activeId), requestId: msg?.request_id ?? raw?.request_id ?? null, orderId: raw?.id ?? null, preferPending: true });
    if (!op) { logLine(`[⚠️ ABERTURA SEM ORDEM] ${JSON.stringify(raw).slice(0, 160)}`); return; }
    op.orderId = raw?.id ?? msg?.request_id ?? null;
    op.record.orderId = op.orderId;
  });

  ws.on('sell-equal', async (msg) => {
    const raw = msg?.msg ?? msg;
    const positionId = Number(raw?.id ?? raw?.position_id ?? raw?.option_id);
    const op = findOp({ aid: Number(raw?.active_id ?? raw?.activeId), orderId: positionId });
    if (!op) return;
    finalizeEarly(op, pickCloseReturn(raw) ?? op.sellQuote, 'sell_equal');
  });

  ws.on('socket-option-closed', async (msg) => {
    const raw  = msg?.msg ?? msg;
    const aid  = Number(raw?.active_id ?? raw?.activeId);
    const op   = findOp({ aid, orderId: raw?.id ?? raw?.position_id ?? raw?.option_id ?? null, requestId: raw?.request_id ?? msg?.request_id ?? null });
    if (!op) {
      const recent = [...settledRecently.values()].some((at) => nowMs() - at < 60_000);
      if (!recent) logLine(`[❓ FECHAMENTO SEM ORDEM] aid=${aid}`);
      return;
    }
    const now = nowMs();
    const earlyByUs = op.sellRequestedAt && (op.expiration * 1000 - now) > 5_000;
    if (earlyByUs) {
      const rawReturn = pickCloseReturn(raw);
      const devolve = Number.isFinite(rawReturn) ? rawReturn : op.sellQuote;
      finalizeEarly(op, devolve, Number.isFinite(rawReturn) ? 'close_sell_return' : 'sell_quote');
      return;
    }

    inFlight.delete(op.okey);
    settledRecently.set(op.okey, now);
    op.settled = true;
    const { result, profit } = parseSettlement(raw, op);
    Object.assign(op.record, { orderId: op.orderId, result, profit, settledAt: new Date().toISOString() });
    saveResults();
    registerOutcome(profit, false);
    applyResult(op, result, profit);
    await refreshBalance();
    renderDashboard();
    const emoji = result === 'win' ? '✅' : result === 'loss' ? '❌' : '➖';
    logLine(`[${emoji}] ${shortName(op.name)} ${op.direction} ${(op.role ?? '?').toUpperCase()} ${result.toUpperCase()} ${fmt(profit)} | cyc=${op.cycleId}`);
    sessionLog(`SETTLEMENT | ${shortName(op.name)} | ${op.direction} | ${(op.role ?? '?').toUpperCase()} | ${result.toUpperCase()} | LP=${fmt(profit)} | cyc=${op.cycleId}`);
  });

  ws.on('close', () => { if (!shuttingDown) { logLine('\n[WS] Conexão fechada.'); shutdown('WS'); } });
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await ws.connect({ ssid });
}

function summary() {
  const cs = cycleStats;
  const csPnl = cs.cycles.pnl;
  logLine('\n🛑 RESULTADO V21 FINAL:\n');
  logLine(`📊 Ops totais: ${stats.settled} | W: ${stats.wins} | L: ${stats.losses} | Draw: ${stats.draws} | Vendas: ${stats.early} | WR: ${stats.settled ? (stats.wins / stats.settled * 100).toFixed(1) : 0}%`);
  logLine(`💰 Lucro (bot): ${fmt(stats.profit)}`);
  logLine(`💰 Lucro (real): ${fmt(currentBalance - initialBalance)} ← incl. ${currencySymbol}${openStake().toFixed(2)} em ${inFlight.size} pos. aberta(s)`);
  logLine('');
  logLine(`── CASH ──`);
  logLine(`  N=${cs.cash.settled} | W=${cs.cash.wins} | L=${cs.cash.losses} | P/L=${fmt(cs.cash.pnl)}`);
  logLine(`── RUNNER ──`);
  logLine(`  N=${cs.runner.settled} | W=${cs.runner.wins} | L=${cs.runner.losses} | P/L=${fmt(cs.runner.pnl)}`);
  logLine(`── RECOVERY ──`);
  logLine(`  N=${cs.recovery.settled} | W=${cs.recovery.wins} | L=${cs.recovery.losses} | P/L=${fmt(cs.recovery.pnl)}`);
  logLine(`── CICLOS ──`);
  logLine(`  Total=${cs.cycles.total} | W=${cs.cycles.won} | L=${cs.cycles.lost} | P/L=${fmt(cs.cycles.pnl)}`);
  logLine(`💼 Saldo final: ${currencySymbol}${currentBalance.toFixed(2)}`);
  saveResults(); saveState();
}

let shuttingDown = false;
function shutdown(reason = 'K') {
  if (shuttingDown) return;
  shuttingDown = true;
  logLine(`\n[🛑] Encerrando (${reason})...`);
  stopAnalyseLog();
  try { endSessionLog(true); } catch {}
  try { ws?.close(); } catch {}
  try { if (process.stdin.isTTY) { process.stdin.setRawMode(false); process.stdin.pause(); } } catch {}
  try { summary(); } catch {}
  setTimeout(() => process.exit(0), 100).unref();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(fatal);
}
