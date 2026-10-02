/**
 * OTC BOT v15 — VENDA POR COTAÇÃO REAL + UNIVERSO SEMPRE CHEIO
 * =============================================================================
 *  node ws-otc-v15.mjs demo           → opera na conta DEMO
 *  node ws-otc-v15.mjs real           → opera na conta REAL (mesmas regras)
 *  node ws-otc-v15.mjs                → pergunta a conta (1=REAL, 2=DEMO)
 *  node ws-otc-v15.mjs demo --ativos   → lista os ativos turbo disponíveis
 *
 *  ATIVOS: NÃO existe limite de ativos operando ao mesmo tempo. O universo garante
 *    no mínimo `universe.minActive` (10) ativos OPERANDO: o top 10 primeiro e, se
 *    algum estiver fechado/suspenso/sem feed, entra a reserva (front.DYDXUSD-OTC,
 *    FARTCOIN, LINK, EOS, HBAR, SEI, IMX, PEN) — e se a reserva faltar, qualquer OTC
 *    turbo disponível completa. O universo é revisado a cada `checkEveryMs` e ativo
 *    sem candle 5s por `replaceStaleMs` é substituído.
 *  ORDENS: 1 entrada + até 2 gales POR ATIVO (trading.maxOpsPerAsset = 3), uma ordem
 *    por vez, sempre no mesmo sentido. Nunca CALL e PUT no mesmo ativo (trava dura).
 *    O gale entra DEPOIS que a ordem anterior fechou em loss, em até galeWindowMs,
 *    sem exigir pullback novo. Stake FIXO na base (2) — inclusive nos gales.
 *  DIREÇÃO: tendência do ativo (EMA8 × EMA21). Alta → CALL no pullback; baixa → PUT
 *    no repique; lateral → fora.
 *  VENDA (v15): SÓ POR COTAÇÃO REAL — nunca mais por reversão. A cotação é
 *    `sell_profit` das posições abertas (resultado LÍQUIDO se vender agora; negativo
 *    quando perdendo). Regras:
 *      • op POSITIVA: realiza quando a cotação passar de `takeProfitPctOfWin` do win
 *        (50% de +1,72 = +0,86 com stake 2 e payout 86%);
 *      • op PERDENDO: só NO FIM (`endgameAfterMs`..`endgameBeforeMs` restantes) e
 *        SOMENTE se (a) a venda devolver ≥ `minRecover` (0,50) e (b) o preço estiver
 *        LONGE da linha de win — distância adversa ≥ `endgameDistanceFactor` (4) × o
 *        candle típico de 5s. Longe = não dá mais chance de reverter; PERTO da linha
 *        o bot ESPERA. Sem cotação fresca = NÃO vende (fail-closed).
 *  PAINEL: uma linha só, estilo odômetro (candles fechados, ops, W, L, vendas, WR,
 *    P/L, abertas, ativos, pausa), atualizada no lugar. Nada de lista por ativo.
 *  LOG: uma linha por ordem/resultado/venda/pausa. O dump cru da IQ que existia para
 *    descobrir o evento de venda só liga com IQ_SELL_DEBUG=1 (e filtra candles).
 */
import fs from 'fs';
import readline from 'readline';
import https from 'https';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';
import { IqWsClient, computeExpiration } from './iqoption-ws.mjs';

const CONFIG = JSON.parse(fs.readFileSync(new URL('./bot-config-v15.json', import.meta.url), 'utf8'));
const C  = CONFIG.trading ?? {};
const S  = CONFIG.strategy ?? {};
const M  = CONFIG.martingale ?? {};
const R  = CONFIG.risk ?? {};
const CD = CONFIG.cooldown ?? {};
const SE = CONFIG.sell ?? {};
const UN = CONFIG.universe ?? {};
const P  = CONFIG.paths ?? {};
const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

const BASE_STAKE        = num(C.baseStake, 2);
const EXPIRATION_MIN    = num(C.expirationMinutes, 2);
const MAX_OPS_PER_ASSET = Math.max(1, Math.round(num(C.maxOpsPerAsset, 3)));
const GALE_WINDOW_MS    = num(C.galeWindowMs, 120_000);
const MAX_LEVELS        = Math.max(0, Math.round(num(M.levels, 2)));
const PAYOUT            = num(M.payoutRate, 0.86);
const MAX_STAKE         = num(R.maxStake, 20);
const MAX_EXPOSURE_PCT  = num(R.maxExposurePct, 50);
const SESSION_LOSS_PCT  = num(R.maxSessionLossPct, 20);
const STOP_AFTER_LOSSES = Math.max(1, Math.round(num(R.stopAfterConsecutiveLosses, 3)));
const STOP_PAUSE_MS     = num(R.pauseAfterLossStreakMs, 300_000);
const PAUSE_AFTER_MS    = num(M.pauseAfterLadderMs, 600_000);
// Flip de direção DESATIVADO (v16): martingale SEM inverter — após loss, aposta no
// MESMO sentido (a tendência é a favor, o preço vai voltar). Reset em qualquer win.
const FLIP_AFTER_LOSSES = 999;  // valor alto = nunca ativa
const COOLDOWN_WIN_MS    = 0;   // re-entrada na próxima candle (sem esperar)
const COOLDOWN_LOSS_MS   = 5000;
const TREND_LOOKBACK    = Math.max(21, Math.round(num(S.trendLookback, 40)));
const TREND_MIN_SPREAD  = num(S.trendMinEmaSpreadPct, 0.05);

// Venda por cotação (v15)
const QUOTE_POLL_MS     = num(SE.quotePollMs, 3_000);
const TAKE_PROFIT_PCT   = num(SE.takeProfitPctOfWin, 50);
const TAKE_PROFIT_MIN   = num(SE.takeProfitMin, 0.80);
const ENDGAME_AFTER_MS  = num(SE.endgameAfterMs, 40_000);
const ENDGAME_BEFORE_MS = num(SE.endgameBeforeMs, 20_000);
const MIN_RECOVER       = num(SE.minRecover, 0.50);
const DISTANCE_FACTOR   = num(SE.endgameDistanceFactor, 4);
const MIN_DISTANCE_PCT  = num(SE.endgameMinDistancePct, 0.05);
const DISTANCE_LOOKBACK = Math.max(5, Math.round(num(SE.distanceLookbackCandles, 12)));
const SELL_RETRY_MS     = num(SE.retryAfterMs, 8_000);
const SELL_MAX_ATTEMPTS = Math.max(1, Math.round(num(SE.maxAttempts, 4)));

// Universo dinâmico (v15)
const MIN_ACTIVE        = Math.max(1, Math.round(num(UN.minActive, 50)));
const MAX_ACTIVE        = Math.max(MIN_ACTIVE, Math.round(num(UN.maxActive, 50)));
const REPLACE_STALE_MS  = num(UN.replaceStaleMs, 180_000);
const UNIVERSE_CHECK_MS = num(UN.checkEveryMs, 60_000);  // 1 min (era 5 min)

if (!(PAYOUT > 0 && PAYOUT < 1)) {
  console.error(`[FATAL] martingale.payoutRate inválido: ${PAYOUT}`);
  process.exit(1);
}
if (MIN_RECOVER <= 0 || MIN_RECOVER >= BASE_STAKE) {
  console.error(`[FATAL] sell.minRecover inválido: ${MIN_RECOVER} (tem que ser > 0 e < stake ${BASE_STAKE})`);
  process.exit(1);
}

// accountType lido das credenciais salvas pelo setup (DEMO | REAL)
// Se não existir credencial, volta ao modo interativo (WANT_DEMO = null).
let SAVED_ACCOUNT_TYPE = null;
try {
  const credsPath = new URL('./bot-credentials.json', import.meta.url);
  if (fs.existsSync(credsPath)) {
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    SAVED_ACCOUNT_TYPE = creds?.accountType ?? null;
  }
} catch {}

const ARG = process.argv[2]?.toLowerCase();
const WANT_DEMO =
  ARG === 'demo' ? true
  : ARG === 'real' ? false
  : SAVED_ACCOUNT_TYPE === 'DEMO' ? true
  : SAVED_ACCOUNT_TYPE === 'REAL' ? false
  : null; // sem credencial → modo interativo
const LIST_ASSETS = process.argv.includes('--ativos');

// Impressão digital do código que está de fato rodando (o bot não recarrega sozinho).
const CODE_REV = 'V15';
const CODE_HASH = (() => {
  try { return createHash('sha256').update(fs.readFileSync(new URL(import.meta.url), 'utf8')).digest('hex').slice(0, 8); }
  catch { return '????????'; }
})();

// ─── FUNÇÕES PURAS ────────────────────────────────────────────────────────────
const round2 = (v) => Math.round(v * 100) / 100;

// Escada de martingale (levels = 0 → sempre a base).
export function ladderStake(level) {
  let stake = BASE_STAKE, lost = 0;
  for (let i = 0; i < Math.max(0, Math.min(level, MAX_LEVELS)); i++) {
    lost += stake;
    stake = round2((lost + BASE_STAKE * PAYOUT) / PAYOUT);
  }
  return stake;
}

// Aceita segundos, milissegundos, nanossegundos e ISO.
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

// Início do bucket do candle, aceitando 'from'/'at' como início OU como "agora".
function candleStartMs(raw, sizeMs) {
  const from = toMs(raw.from ?? raw.start ?? raw.at ?? raw.timestamp);
  if (from !== null) return Math.floor(from / sizeMs) * sizeMs;
  const to = toMs(raw.to ?? raw.end);
  return to !== null ? to - sizeMs : null;
}

// Normaliza nome de ativo: 'front.SUIUSD-OTC' → 'SUIUSD' (tolera variações de nome).
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

// Resultado de um fechamento NORMAL — nunca devolve NaN.
export function parseSettlement(raw, op) {
  const win = String(raw?.win ?? raw?.status ?? raw?.result ?? '').toLowerCase();
  const draw = win === 'equal' || win === 'draw';
  const won = win === 'win';
  const invested = [raw?.invest, raw?.sum, raw?.amount, raw?.price].map(Number).find(Number.isFinite) ?? op.stake;

  let profit = null;
  let source = 'win_amount';
  const winAmount = [raw?.win_amount, raw?.payout].map(Number).find(Number.isFinite);
  if (won && winAmount !== undefined) profit = winAmount > invested ? winAmount - invested : winAmount;
  if (won && (profit === null || profit <= 0)) { profit = round2(invested * PAYOUT); source = 'payout_config'; }
  if (!won) { profit = draw ? 0 : -invested; source = 'invest'; }

  return { result: won ? 'win' : draw ? 'draw' : 'loss', profit: round2(profit), source, invested };
}

// Campos de P/L LÍQUIDO que a IQ manda quando a posição fecha por venda antecipada.
// sell_profit = resultado líquido se vender agora (documentado pelo MCP oficial).
export function pickCloseProfit(raw) {
  for (const field of ['sell_profit', 'profit_amount']) {
    const value = raw?.[field];
    if (value === undefined || value === null) continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Só entrega candle FECHADO (a IQ reenvia a vela em formação a cada tick).
export class ClosedCandles {
  constructor(sizeSec) {
    this.sizeMs = sizeSec * 1000;
    this.ticks = [];
    this.formingAt = null;
    this.formingClose = null;
    this.lastClosedAt = 0;
  }
  ingest(raw, nowMs) {
    const startMs = candleStartMs(raw, this.sizeMs);
    const close = priceOf(raw);
    if (startMs === null || close === null || startMs <= this.lastClosedAt) return null;

    let closed = null;
    if (this.formingAt !== null && startMs > this.formingAt) closed = this.flushForming();
    if (this.formingAt === null) { this.formingAt = startMs; this.formingClose = close; }
    else { this.formingClose = close; }
    if (this.formingAt !== null && nowMs >= this.formingAt + this.sizeMs) closed = this.flushForming() ?? closed;
    return closed;
  }
  flushForming() {
    if (this.formingAt === null) return null;
    const bar = { atMs: this.formingAt, close: this.formingClose };
    this.ticks.push(bar);
    if (this.ticks.length > 500) this.ticks.shift();
    this.lastClosedAt = this.formingAt;
    this.formingAt = null;
    this.formingClose = null;
    return bar;
  }
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
      direction: old.direction === 'CALL' || old.direction === 'PUT' ? old.direction : (wl.direction ?? null),
      ladder: Math.max(0, Math.min(Math.round(num(old.ladder, 0)), MAX_LEVELS)),
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
const running = new Map();           // activeId → { key, name, aid, source, wr, lastCandleAt, since }
const quotes = new Map();            // orderId (string) → { sellProfit, field, at }
const settledRecently = new Map();   // okey → timestamp (para ignorar close duplicado)
const bannedUntil = new Map();       // activeId → timestamp (sem feed/fechado: não readiciona já)

const opsFor = (aid) => [...inFlight.values()].filter((o) => o.assetId === aid).sort((a, b) => a.sentAtMs - b.sentAtMs);
const openStake = () => [...inFlight.values()].reduce((sum, o) => sum + o.stake, 0);

// Casa uma mensagem da IQ com a operação local: id da posição → requestId → FIFO do ativo.
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

let ws = null;
let warmupDone = false;
let balanceId = null;
let initialBalance = 0;
let currentBalance = 0;
let accountType = 'DEMO';
let currencySymbol = 'R$';
let openedAt = 0;
let closedCandles = 0;
let startTime = 0;  // timestamp em ms quando o bot iniciou
let sessionStopLogged = false;
let lossStreakGlobal = 0;
let stopUntil = 0;
let stopLogged = false;
let quoteSampleLogged = false;
let quoteProviderOk = false;
let rawDumpUntil = 0;                // janela do dump cru da IQ (IQ_SELL_DEBUG=1); abre em requestSell
const stats = { settled: 0, wins: 0, losses: 0, draws: 0, early: 0, earlyPos: 0, earlyNeg: 0, profit: 0 };

const nowMs = () => ws?.serverNow() ?? Date.now();
const sessionLossLimit = () => (initialBalance > 0 ? round2(initialBalance * SESSION_LOSS_PCT / 100) : Infinity);
const exposureLimit = () => (currentBalance > 0 ? round2(currentBalance * MAX_EXPOSURE_PCT / 100) : 0);
const shortName = (name) => String(name ?? '').replace('front.', '').replace('-OTC', '');
const symbolOf = (currency) => (currency === 'USD' ? 'US$' : currency === 'BRL' ? 'R$' : currency || 'R$');
const fmt = (value) => `${value >= 0 ? '+' : '-'}${currencySymbol}${Math.abs(value).toFixed(2)}`;
const fmt2 = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
const saveState = () => { try { fs.writeFileSync(P.state, JSON.stringify(state, null, 2)); } catch {} };
const saveResults = () => { try { fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2)); } catch {} };
const mmss = (ms) => { const total = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; };
const elapsedTime = () => mmss(startTime ? (ws?.serverNow() ?? Date.now()) - startTime : 0);

// ─── PAINEL (uma linha, odômetro; nada de listas) ────────────────────────────
// LIVE = true sempre para forçar atualização in-place mesmo rodando em background.
const LIVE = true;
function dashboardText() {
  const wr = stats.settled ? (stats.wins / stats.settled * 100).toFixed(1) : '0.0';
  const exposed = openStake();
  return `[⏱${elapsedTime()}] [🕯️${closedCandles}] [📊${stats.settled}] [✅${stats.wins}] [❌${stats.losses}] [WR ${wr}%] [💰${fmt(stats.profit)}] [⏳${currencySymbol}${exposed.toFixed(2)}]`;
}
function renderDashboard() {
  process.stdout.write(`\x1b[2K\r${dashboardText()}`);
}
function logLine(text) {
  process.stdout.write('\x1b[2K\r');
  console.log(text);
  renderDashboard();
}

// ─── SINAL ────────────────────────────────────────────────────────────────────
export function detectRegime(ticks) {
  if (ticks.length < S.lookbackRegime) return { state: 'unknown', streak: 0 };
  let max = 0, cur = 0, last = 0;
  for (let i = Math.max(1, ticks.length - num(S.lookbackRegime, 20)); i < ticks.length; i++) {
    const move = ticks[i].close > ticks[i - 1].close ? 1 : ticks[i].close < ticks[i - 1].close ? -1 : 0;
    if (move === 0) continue;
    if (move === last) cur++; else { cur = 1; last = move; }
    if (cur > max) max = cur;
  }
  return { state: max >= num(S.regimeStreakThreshold, 10) ? 'trending' : 'ranging', streak: max };
}

function ema(values, period) {
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

export function trendDirection(ticks) {
  if (ticks.length < TREND_LOOKBACK) return { direction: null, spreadPct: 0, source: 'dados' };
  const closes = ticks.slice(-TREND_LOOKBACK).map((t) => t.close);
  const fast = ema(closes.slice(-12), 8);
  const slow = ema(closes, 21);
  const spreadPct = slow > 0 ? Math.round(((fast - slow) / slow) * 10_000) / 100 : 0;
  if (spreadPct >= TREND_MIN_SPREAD) return { direction: 'CALL', spreadPct, source: 'alta' };
  if (spreadPct <= -TREND_MIN_SPREAD) return { direction: 'PUT', spreadPct, source: 'baixa' };
  return { direction: null, spreadPct, source: 'lateral' };
}

export function calcRSI(ticks, period = S.rsiPeriod) {
  if (ticks.length < period + 1) return 50;
  const closes = ticks.map((t) => t.close);
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  if (losses === 0) return 100;
  return 100 - (100 / (1 + gains / losses));
}

export function fade4Signal(ticks, direction) {
  if (ticks.length < 5) return null;
  const last5 = ticks.slice(-5);
  const last4 = last5.slice(0, 4);
  const down4 = last4.every((c, i) => i === 0 || c.close < last4[i - 1].close);
  const up4 = last4.every((c, i) => i === 0 || c.close > last4[i - 1].close);
  if (down4 && last5[4].close > last5[3].close && direction === 'CALL') return 'CALL';
  if (up4 && last5[4].close < last5[3].close && direction === 'PUT') return 'PUT';
  return null;
}

// Candle típico de 5s em % (média de |Δclose|/close): é a régua da distância.
export function tickVolPct(ticks, lookback = DISTANCE_LOOKBACK) {
  if (!Array.isArray(ticks) || ticks.length < 3) return 0;
  const start = Math.max(1, ticks.length - (lookback + 1));
  let sum = 0, n = 0;
  for (let i = start; i < ticks.length; i++) {
    const prev = ticks[i - 1]?.close, cur = ticks[i]?.close;
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev <= 0) continue;
    sum += (Math.abs(cur - prev) / prev) * 100;
    n++;
  }
  return n ? sum / n : 0;
}

// Núcleo puro da decisão de ENTRADA. Com ordem aberta não existe ação de preço:
// a V15 nunca mais vende por reversão — quem decide a venda é `sellDecision`
// (cotação real). Aqui só entra ordem nova quando o ativo está limpo.
//
// PIRAMIDAGEM: quando o sinal é MUITO FORTE (tendência confirmada + RSI extremo),
// pode abrir 2ª posição no mesmo sentido. Loss não entra em gale se tiver 2 pyramid.
export function evaluateEntry({ ticks, open, trend, regime, rsi, cycleOps = 0, maxOpsPerAsset = MAX_OPS_PER_ASSET, gale = false, pyramidCount = 0 }) {
  const sameDir = open.filter((o) => o.direction === trend.direction);
  const oppDir  = open.filter((o) => o.direction !== trend.direction);

  if (oppDir.length) return { skip: 'ladoOposto' };
  if (sameDir.length >= 2) return { skip: 'pyramidMax' };        // max 2 pyramid
  if (sameDir.length >= 1) {
    // PIRAMIDAGEM: 2ª posição só se sinal muito forte
    const rsiOk = trend.direction === 'CALL' ? rsi <= 35 : rsi >= 65;
    const strong = regime.state === 'trending' && rsiOk;
    if (!strong) return { skip: 'sinalFracoPyramid' };
    return { kind: 'pyramid', direction: trend.direction, reason: `piramidagem ${sameDir.length + 1}× ${trend.direction} — ${trend.source} ${trend.spreadPct}% | RSI ${rsi.toFixed(0)} | ${regime.state}` };
  }
  if (gale && sameDir.length) return { skip: 'pyramidBlock' };  // gale precedence
  if (!trend.direction) return { skip: trend.source === 'dados' ? 'dados40' : 'lateral' };
  if (cycleOps >= maxOpsPerAsset) return { skip: 'cicloFechado' };
  if (regime.state === 'trending') return { skip: 'regime' };
  if (fade4Signal(ticks, trend.direction) !== trend.direction) return { skip: 'semPullback' };
  if (trend.direction === 'CALL' && rsi > num(S.rsiCallMax, 50)) return { skip: 'rsi' };
  if (trend.direction === 'PUT' && rsi < num(S.rsiPutMin, 50)) return { skip: 'rsi' };
  return {
    kind: gale ? 'gale' : 'entrada',
    direction: trend.direction,
    reason: gale ? `gale após loss — tendência ${trend.source} ${trend.spreadPct}%` : `tendência ${trend.source} ${trend.spreadPct}%`,
  };
}

// Núcleo puro da VENDA (v15). Decisões possíveis:
//   takeProfit  → op positiva e a cotação passou do alvo (50% do win por padrão);
//   endgameCut  → op perdendo, no fim da opção, LONGE da linha e com devolução mínima;
//   hold        → todo o resto (sem cotação, perto da linha, devolveria pouco, fora da janela).
export function sellDecision({
  side, entryPrice, lastClose, tickVol = 0, sellProfit = null, remainingMs = Infinity,
  stake = 0, payout = PAYOUT, cfg = {},
}) {
  const c = {
    pct: num(cfg.takeProfitPctOfWin, TAKE_PROFIT_PCT),
    min: num(cfg.takeProfitMin, TAKE_PROFIT_MIN),
    after: num(cfg.endgameAfterMs, ENDGAME_AFTER_MS),
    before: num(cfg.endgameBeforeMs, ENDGAME_BEFORE_MS),
    recover: num(cfg.minRecover, MIN_RECOVER),
    factor: num(cfg.endgameDistanceFactor, DISTANCE_FACTOR),
    minDist: num(cfg.endgameMinDistancePct, MIN_DISTANCE_PCT),
  };
  if (!(remainingMs > 0)) return { action: 'hold', reason: 'semTempo' };
  if (remainingMs <= c.before) return { action: 'hold', reason: 'janelaDaVendaFechou' };
  if (sellProfit === null || !Number.isFinite(sellProfit)) return { action: 'hold', reason: 'semCotacao' };

  const target = Math.max(c.min, round2(stake * payout * c.pct / 100));
  if (sellProfit >= target) {
    return { action: 'sell', kind: 'takeProfit', target: round2(target), reason: `lucro ${fmt2(sellProfit)} >= ${fmt2(target)}` };
  }
  if (remainingMs <= c.after && sellProfit < 0) {
    const recovery = round2(stake + sellProfit);
    if (recovery < c.recover) return { action: 'hold', reason: 'devolveriaPouco', recovery };
    if (!Number.isFinite(entryPrice) || !Number.isFinite(lastClose) || entryPrice <= 0) return { action: 'hold', reason: 'semPreco' };
    const adverse = side === 'CALL' ? entryPrice - lastClose : lastClose - entryPrice;
    const distPct = round2((Math.abs(adverse) / entryPrice) * 100);
    const needPct = round2(Math.max(c.factor * tickVol, c.minDist));
    if (distPct < needPct) return { action: 'hold', reason: 'pertoDaLinha', distPct, needPct };
    return {
      action: 'sell', kind: 'endgameCut', recovery, distPct, needPct,
      reason: `longe ${distPct}% (>= ${needPct}%) e devolve ${fmt2(recovery)}`,
    };
  }
  return { action: 'hold', reason: sellProfit >= 0 ? 'abaixoDoAlvo' : 'foraDaJanela' };
}

// Linha de posição aberta da IQ → cotação de venda (sell_profit é LIQUIDO).
export function parseQuoteRow(row) {
  if (!row || typeof row !== 'object') return { id: null, sellProfit: null, field: null };
  const id = [row.id, row.option_id, row.position_id, row.optionId].map(Number).find(Number.isFinite) ?? null;
  for (const field of ['sell_profit', 'profit', 'current_profit', 'close_profit']) {
    const value = row[field];
    if (value === undefined || value === null) continue;
    const n = Number(value);
    if (Number.isFinite(n)) return { id, sellProfit: n, field };
  }
  return { id, sellProfit: null, field: null };
}

// Universo: top 10 primeiro, reserva depois, e completa com qualquer OTC turbo
// disponível até minActive. Fechado/suspenso não entra (substitui pelo próximo).
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

// Todas as travas de segurança numa função PURA.
// maxSameDirection: permite até N posições no mesmo sentido (piramidagem)
export function evaluateGuards({
  open, direction, now, pausedUntil = 0, stopUntil = 0, lastOpAt = 0, lastResult = null,
  stake, balance = 0, exposure = 0, exposureLimit = Infinity,
  sessionLoss = 0, sessionLossLimit = Infinity, maxSameDirection = 2,
}) {
  const sameDir = open.filter((o) => o.direction === direction);
  const oppDir  = open.filter((o) => o.direction !== direction);
  if (oppDir.length) return 'ladoOposto';
  if (sameDir.length >= maxSameDirection) return 'pyramidMax';
  if (open.length >= MAX_OPS_PER_ASSET) return 'maxOps';
  if (now < pausedUntil) return 'pausado';
  if (now < stopUntil) return 'sequencia';
  if (sessionLoss >= sessionLossLimit) return 'perdaSessao';
  if (!open.length && lastOpAt && now - lastOpAt < (lastResult === 'win' ? COOLDOWN_WIN_MS : COOLDOWN_LOSS_MS)) return 'cooldown';
  if (balance > 0 && stake > balance) return 'semSaldo';
  if (exposure + stake > exposureLimit) return 'exposicao';
  return null;
}

// Junta os dados do ativo com o núcleo puro acima. Devolve null quando não entra.
function planTrade(aid) {
  const b5 = buf5s.get(aid), b1 = buf1m.get(aid);
  if (!b5 || !b1) return null;
  if (b5.ticks.length < num(S.lookbackRegime, 20)) return null;
  if (b1.ticks.length < num(S.min1mCandles, 1)) return null;

  const s = state[b5.key];
  const last = b5.ticks[b5.ticks.length - 1];
  if (!s || nowMs() - last.atMs > num(S.staleCandleMs, 30_000)) return null;

  const open = opsFor(aid);
  const now = nowMs();

  // Reset do ciclo se fechou em win ou passou da janela de gale
  if (!open.length) {
    const vencido = s.galeArmedAt && now - s.galeArmedAt > GALE_WINDOW_MS;
    if (vencido || s.lastResult === 'win' || s.cycleOps >= MAX_OPS_PER_ASSET) {
      s.cycleOps = 0;
      s.galeArmedAt = 0;
    }
  }

  const gale = !open.length && Boolean(s.galeArmedAt);
  const trend = trendDirection(b5.ticks);
  const regime = detectRegime(b5.ticks);
  const rsi = calcRSI(b5.ticks);

  // Conta pyramid: posições abertas no mesmo sentido (piramidagem)
  const pyramidCount = open.filter((o) => o.direction === trend.direction).length;

  const decision = evaluateEntry({ ticks: b5.ticks, open, trend, regime, rsi, now, cycleOps: s.cycleOps, gale, pyramidCount });
  if (decision.skip) return null;
  // Sem flip: martingale SEM inverter direção — após loss, mesma direção (tendência é a favor)
  return { direction: decision.direction, trend, rsi, kind: decision.kind, reason: decision.reason };
}

function canTrade(aid, direction) {
  const buf = buf5s.get(aid);
  const s = state[buf?.key];
  if (!s) return null;
  const loss = initialBalance > 0 ? initialBalance - currentBalance : 0;
  const reason = evaluateGuards({
    open: opsFor(aid), direction, now: nowMs(),
    pausedUntil: s.pausedUntil, stopUntil, lastOpAt: s.lastOpAt, lastResult: s.lastResult,
    stake: ladderStake(s.ladder), balance: currentBalance,
    exposure: openStake(), exposureLimit: exposureLimit(),
    sessionLoss: loss, sessionLossLimit: sessionLossLimit(), maxSameDirection: 2,
  });
  if (reason) {
    if (reason === 'perdaSessao' && !sessionStopLogged) {
      sessionStopLogged = true;
      logLine(`[🛑 TRAVA DE PERDA] sessão ${fmt(-loss)} de ${currencySymbol}${sessionLossLimit().toFixed(2)} (${SESSION_LOSS_PCT}% do saldo inicial) → nenhuma ordem nova (reinicie para liberar)`);
    }
    if (reason === 'sequencia' && !stopLogged) {
      stopLogged = true;
      logLine(`[🛑 CIRCUIT BREAKER] ${STOP_AFTER_LOSSES} losses seguidos → nenhuma ordem nova por ${Math.round(STOP_PAUSE_MS / 60000)}min (as abertas fecham sozinhas)`);
    }
    return null;
  }
  return s;
}

// ─── ORDEM ────────────────────────────────────────────────────────────────────
function maybeTrade(aid) {
  if (!warmupDone) return;
  const plan = planTrade(aid);
  if (!plan) return;
  const s = canTrade(aid, plan.direction);
  if (!s) return;

  const stake = ladderStake(s.ladder);
  if (!(stake > 0) || stake > MAX_STAKE) {
    s.pausedUntil = nowMs() + PAUSE_AFTER_MS;
    logLine(`[⛔ BLOQUEADO] ${shortName(s.name)} | stake ${currencySymbol}${stake} acima de ${currencySymbol}${MAX_STAKE} → pausa`);
    return;
  }

  const b5 = buf5s.get(aid);
  const entryPrice = b5.ticks[b5.ticks.length - 1]?.close ?? null;
  const { expiration, optionTypeId } = computeExpiration(Math.floor(nowMs() / 1000), EXPIRATION_MIN);
  const requestId = ws.uuid().replace(/-/g, '').slice(0, 12);
  const okey = `${aid}|${expiration}|${requestId}`;
  const record = {
    assetId: aid, active: b5.name, key: s.key, direction: plan.direction, kind: plan.kind,
    baseDirection: s.baseDirection, trendPct: plan.trend.spreadPct, rsi: round2(plan.rsi),
    stake, ladder: s.ladder, entryPrice, expiration, requestId,
    sentAtMs: nowMs(), timestamp: new Date().toISOString(), rev: CODE_REV,
  };
  resultsList.push(record);
  inFlight.set(okey, {
    okey, assetId: aid, key: s.key, name: b5.name, direction: plan.direction, kind: plan.kind,
    stake, level: s.ladder, entryPrice, expiration, requestId, sentAtMs: record.sentAtMs, record,
  });
  s.lastOpAt = record.sentAtMs;
  s.direction = plan.direction;
  if (plan.kind !== 'pyramid') s.cycleOps = (s.cycleOps ?? 0) + 1;  // pyramid não conta no ciclo do gale

  ws.send('sendMessage', {
    body: {
      price: stake, active_id: aid, expired: expiration, direction: plan.direction.toLowerCase(),
      option_type_id: optionTypeId, user_balance_id: Number(balanceId),
    },
    name: 'binary-options.open-option', version: '1.0',
  }, requestId);

  saveResults();
  const kindTag = plan.kind === 'pyramid' ? ` (PYRAMID)` : plan.kind === 'gale' ? ` (gale ${s.cycleOps}/${MAX_OPS_PER_ASSET})` : '';
  logLine(`[📤 ORDEM] ${shortName(b5.name)} ${plan.direction} ${currencySymbol}${stake.toFixed(2)}${kindTag} | ${plan.reason}`);
}

// ─── VENDA (cotação real) ─────────────────────────────────────────────────────
function requestSell(op, decision, now) {
  if ((op.sellAttempts ?? 0) >= SELL_MAX_ATTEMPTS) return;
  if (now - (op.lastSellAt ?? 0) < SELL_RETRY_MS) return;
  op.sellAttempts = (op.sellAttempts ?? 0) + 1;
  op.lastSellAt = now;
  op.sellRequestedAt = now;
  op.sellKind = decision.kind;
  const quote = quotes.get(String(op.orderId));
  op.sellQuote = quote ? quote.sellProfit : null;
  op.sellRequestId = ws.sellOption(op.orderId);
  rawDumpUntil = now + 10_000;   // janela do dump cru (IQ_SELL_DEBUG=1) em volta da venda

  const remainingMs = op.expiration * 1000 - now;
  if (decision.kind === 'takeProfit') {
    logLine(`[✂️ VENDA] ${shortName(op.name)} ${op.direction} | realiza ${fmt(op.sellQuote ?? 0)} (${TAKE_PROFIT_PCT}% do win) | restam ${Math.round(remainingMs / 1000)}s`);
  } else {
    logLine(`[✂️ CORTE] ${shortName(op.name)} ${op.direction} | fim da opção: vende ${fmt(op.sellQuote ?? -op.stake)} (devolve ${currencySymbol}${decision.recovery.toFixed(2)}) | longe ${decision.distPct}% do candle típico ${decision.needPct}% | restam ${Math.round(remainingMs / 1000)}s`);
  }
}

function evaluateSell(op) {
  if (!warmupDone || !op.orderId) return;
  const now = nowMs();
  const remainingMs = op.expiration * 1000 - now;
  const quote = quotes.get(String(op.orderId));
  const fresh = quote && now - quote.at <= QUOTE_POLL_MS * 3;
  const buf = buf5s.get(op.assetId);
  const last = buf?.ticks[buf.ticks.length - 1];
  const decision = sellDecision({
    side: op.direction, entryPrice: op.entryPrice, lastClose: last?.close ?? null,
    tickVol: buf ? tickVolPct(buf.ticks) : 0,
    sellProfit: fresh ? quote.sellProfit : null,
    remainingMs, stake: op.stake, payout: PAYOUT, cfg: SE,
  });
  if (decision.action === 'sell') requestSell(op, decision, now);
}

let quotePollBusy = false;
let quoteFailStreak = 0;
let quoteFailLogged = false;
async function pollQuotes() {
  if (quotePollBusy || !warmupDone || inFlight.size === 0) return;
  quotePollBusy = true;
  try {
    const resp = await ws.getOptions({ limit: 40, instrumentType: 'binary,turbo', balanceId: Number(balanceId) });
    const rows = resp?.msg?.open_options ?? [];
    if (!Array.isArray(rows)) return;
    if (rows.length && !quoteSampleLogged) {
      quoteSampleLogged = true;
      const sample = parseQuoteRow(rows[0]);
      const fields = Object.keys(rows[0] ?? {}).slice(0, 16).join(',');
      if (sample.sellProfit !== null) {
        quoteProviderOk = true;
        logLine(`[💱] cotação OK (campo ${sample.field}) | campos: ${fields}`);
      } else {
        logLine(`[💱] posição aberta sem campo de cotação reconhecido → venda automática DESLIGADA | campos: ${fields}`);
      }
    }
    const next = new Map();
    for (const row of rows) {
      const parsed = parseQuoteRow(row);
      if (parsed.id !== null && parsed.sellProfit !== null) {
        next.set(String(parsed.id), { sellProfit: parsed.sellProfit, field: parsed.field, at: nowMs() });
      }
    }
    if (next.size) { quotes.clear(); for (const [key, value] of next) quotes.set(key, value); quoteProviderOk = true; }
    quoteFailStreak = 0;
    quoteFailLogged = false;
    for (const op of [...inFlight.values()]) evaluateSell(op);
  } catch {
    quoteFailStreak++;
    if (quoteFailStreak >= 5 && !quoteFailLogged) {
      quoteFailLogged = true;
      quoteProviderOk = false;
      logLine('[💱] IQ não respondeu a cotação (5 tentativas) → venda automática DESLIGADA até voltar');
    }
  }
  finally { quotePollBusy = false; }
}

// ─── RESULTADO ────────────────────────────────────────────────────────────────
// Próximo estado do ciclo após um fechamento. Gerencia:
//   - ladder (escala de martingale, 0 = base)
//   - lossStreak (losses seguidos para o flip)
//   - flipped (true = aposta no sentido OPOSTO à tendência — esperando reversão)
//   - cycleOps (contador do ciclo de gale 1 entrada + N gales)
// Venda no lucro com >=0 conta como win; <0 conta como loss.
export function nextTradeState(s, result, now = Date.now()) {
  const cycleOps = Math.max(0, Math.round(num(s.cycleOps, 0)));
  const next = {
    ladder: s.ladder, lossStreak: s.lossStreak, direction: s.direction,
    pausedUntil: s.pausedUntil, galeArmedAt: 0,
    event: result, cycleOps,
  };

  if (result === 'loss') {
    next.lossStreak = s.lossStreak + 1;
    next.galeArmedAt = cycleOps < MAX_OPS_PER_ASSET ? now : 0;
    if (MAX_LEVELS > 0 && s.ladder >= MAX_LEVELS) {
      next.ladder = 0;
      next.lossStreak = 0;
      next.pausedUntil = now + PAUSE_AFTER_MS;
      next.event = 'pause';
    } else {
      next.ladder = Math.min(s.ladder + 1, MAX_LEVELS);
    }
  } else {
    // win ou draw => reset do streak (volta a acompanhar tendência SEM inverter)
    next.ladder = 0;
    next.lossStreak = 0;
  }
  return next;
}

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

function applyResult(op, result, profit) {
  const s = state[op.key];
  if (!s) return;
  // Venda no lucro fecha o ciclo como win; corte no fim continua sendo loss.
  const forLadder = result === 'early' ? (profit >= 0 ? 'win' : 'loss') : result;

  if (forLadder === 'loss') {
    lossStreakGlobal++;
    if (lossStreakGlobal >= STOP_AFTER_LOSSES) {
      lossStreakGlobal = 0;
      stopUntil = nowMs() + STOP_PAUSE_MS;
      stopLogged = false;
    }
  } else if (forLadder === 'win') {
    lossStreakGlobal = 0;
  }

  const next = nextTradeState(s, forLadder, nowMs());
  Object.assign(s, {
    ladder: next.ladder, lossStreak: next.lossStreak,
    direction: next.direction, pausedUntil: next.pausedUntil, lastResult: forLadder,
    galeArmedAt: next.galeArmedAt,
  });

  if (next.event === 'pause') logLine(`[⏸ PAUSA] ${shortName(op.name)}: ${MAX_LEVELS + 1} losses seguidos → ${Math.round(PAUSE_AFTER_MS / 60000)}min`);
  saveState();
}

function finalizeEarly(op, netProfit, source) {
  inFlight.delete(op.okey);
  settledRecently.set(op.okey, nowMs());
  const profit = round2(Number.isFinite(netProfit) ? netProfit : 0);
  Object.assign(op.record, {
    result: 'early', profit, earlySell: true, sellProfit: profit, profitSource: source,
    sellKind: op.sellKind ?? null, settledAt: new Date().toISOString(),
  });
  saveResults();
  registerOutcome(profit, true);
  applyResult(op, 'early', profit);
  void refreshBalance().then(() => { saveState(); renderDashboard(); });
  const emoji = profit >= 0 ? '✂️✅' : '✂️❌';
  logLine(`[${emoji}] ${shortName(op.name)} ${op.direction} | ${op.sellKind === 'takeProfit' ? 'venda no lucro' : 'corte no fim'} ${fmt(profit)}`);
}

async function refreshBalance() {
  try {
    const list = (await ws.getBalances())?.msg ?? [];
    const account = (Array.isArray(list) ? list : []).find((b) => Number(b?.type) === (accountType === 'DEMO' ? 4 : 1));
    if (account && Number.isFinite(Number(account.amount))) currentBalance = Number(account.amount);
  } catch {}
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
async function login() {
  const postData = JSON.stringify({ identifier: CONFIG.login.email, password: CONFIG.login.password });
  const body = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData),
        'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/',
      },
    }, (res) => { let text = ''; res.on('data', (d) => text += d); res.on('end', () => resolve(text)); });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
  const parsed = JSON.parse(body);
  return parsed.result?.ssid ?? parsed.ssid;
}

// ─── UNIVERSO (mínimo de ativos sempre operando) ─────────────────────────────
async function fetchActives() {
  const init = (await ws.getInitializationData())?.msg ?? {};
  const turbo = init?.turbo?.actives ?? {};
  return Object.entries(turbo).map(([id, act]) => ({
    id: Number(id), name: act?.name, enabled: act?.enabled, is_suspended: act?.is_suspended,
  }));
}

function ensureState(key, name, baseDirection = null) {
  if (!state[key]) state[key] = defaultState(key, name, baseDirection);
  return state[key];
}

function applyUniverse(actives, reason) {
  const whitelist = WHITELIST.map(([key, wl]) => ({ key, name: wl.name, wr: num(wl.wr, 0) }));
  const reserve = RESERVE.map(([key, wl]) => ({ key, name: wl.name, wr: null }));
  const usable = actives.filter((row) => !bannedUntil.has(Number(row.id)) || bannedUntil.get(Number(row.id)) < nowMs());
  const { selected, unavailableTop } = selectUniverse({ whitelist, reserve, actives: usable, minActive: MIN_ACTIVE, maxActive: MAX_ACTIVE });

  for (const aid of running.keys()) {
    if (!selected.some((entry) => entry.aid === aid)) {
      if (opsFor(aid).length) continue;   // ordem aberta: o ativo fica até fechar
      running.delete(aid);
      buf5s.delete(aid);
      buf1m.delete(aid);
    }
  }
  for (const entry of selected) {
    if (running.has(entry.aid)) continue;
    buf5s.set(entry.aid, Object.assign(new ClosedCandles(num(S.candleSizeSeconds, 5)), { key: entry.key, name: entry.name, aid: entry.aid }));
    buf1m.set(entry.aid, new ClosedCandles(60));
    ensureState(entry.key, entry.name);
    running.set(entry.aid, { ...entry, lastCandleAt: 0, since: nowMs() });
    ws.subscribeCandles(entry.aid, num(S.candleSizeSeconds, 5));
    ws.subscribeCandles(entry.aid, 60);
  }
  const names = [...running.values()].map((row) => shortName(row.name)).join(' • ');
  if (reason === 'boot') {
    logLine(`[📋] ${running.size} ativos operando${running.size < MIN_ACTIVE ? ` (ABAIXO do mínimo ${MIN_ACTIVE} — mercado sem ativos disponíveis)` : ''}`);
    logLine(`     ${names}`);
    if (unavailableTop.length) logLine(`[⚠️] top fechado/ausente agora: ${unavailableTop.join(', ')}`);
  } else {
    logLine(`[🔁] universo (${reason}): ${running.size} ativos${unavailableTop.length ? ` | fora agora: ${unavailableTop.join(', ')}` : ''}`);
  }
}

// Revisão do universo: substitui fechado/suspenso/sem feed mantendo o mínimo.
async function rebalanceUniverse() {
  if (!ws) return;
  try {
    const actives = await fetchActives();
    const byAid = new Map(actives.map((row) => [Number(row.id), row]));
    for (const [aid, row] of running) {
      const info = byAid.get(aid);
      const closed = !info || info.enabled === false || info.is_suspended === true;
      const stale = row.lastCandleAt > 0 && nowMs() - row.lastCandleAt > REPLACE_STALE_MS;
      const noFeedYet = row.lastCandleAt === 0 && nowMs() - row.since > REPLACE_STALE_MS;
      if (closed || stale || noFeedYet) {
        if (opsFor(aid).length) continue;   // ordem aberta: o ativo fica até fechar
        bannedUntil.set(aid, nowMs() + REPLACE_STALE_MS);
        running.delete(aid);
        buf5s.delete(aid);
        buf1m.delete(aid);
      }
    }
    applyUniverse(actives, 'revisão');
  } catch { /* revisão é best-effort; o universo atual continua */ }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
const fatal = (err) => { console.error('[FATAL]', err); process.exit(1); };

async function main() {
  const ssid = await login();
  logLine('[✅] LOGIN OK — conectando ao WebSocket da IQ...');
  ws = new IqWsClient({ log: (...args) => logLine(args.join(' ')) });

  // Diagnóstico da venda: com IQ_SELL_DEBUG=1 imprime (sem candles) o que a IQ manda
  // nos 10s seguintes a um pedido de venda (a janela abre em `requestSell`). Sem a
  // variável, silêncio total — o painel é a única saída viva.
  ws.on('message', (m) => {
    if (process.env.IQ_SELL_DEBUG !== '1' || nowMs() > rawDumpUntil) return;
    const name = String(m?.name ?? '?');
    if (name === 'candle-generated' || name === 'timeSync' || name === 'heartbeat') return;
    logLine(`[🔎 IQ] ${name} ${JSON.stringify(m?.msg).slice(0, 180)}`);
  });

  // ─── KILL SWITCH: tecla K ou Ctrl+C (rawtevlado por completo) ─────────────
  // Cmd no Windows mapeia Ctrl+C para "copiar" e Ctrl+V para "colar" — por isso o
  // kill switch por letra é o caminho primário. Ctrl+C também funciona porque o
  // raw mode aceita o evento mesmo no PowerShell (que envia SIGINT real).
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', (str, key) => {
      // Ctrl+C => shutdown imediato com relatório
      if (key && (key.ctrl && key.name === 'c')) {
        shutdown('SIGINT');
        return;
      }
      // K (maiúscula ou minúscula) => kill switch manual com relatório
      if (str === 'k' || str === 'K') {
        shutdown('K');
        return;
      }
      // T => toggle mostrar/ocultar painel (debug)
      if (str === 't' || str === 'T') {
        dashboardHidden = !dashboardHidden;
        if (dashboardHidden) process.stdout.write('\x1b[2K\r');
        else renderDashboard();
        return;
      }
    });
    logLine('[🎮] Kill switch: pressione K (ou Ctrl+C) para parar com relatório final');
  } else {
    logLine('[🎮] Sem TTY detectado (terminal não interativo) — use Ctrl+C/SIGINT para parar');
  }

  const onReady = async () => {
    const rows = (await ws.getBalances())?.msg ?? [];
    let chosen;
    if (WANT_DEMO === true) chosen = rows.find((b) => b.type === 4);
    else if (WANT_DEMO === false) chosen = rows.find((b) => b.type === 1);
    else {
      logLine('[💼] Contas: ' + rows.map((b) => `${b.type === 1 ? 'REAL' : b.type === 4 ? 'DEMO' : `TIPO${b.type}`} ${symbolOf(b.currency)}${Number(b.amount).toFixed(2)}`).join(' | '));
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = () => new Promise((res) => rl.question('[?] 1 = REAL | 2 = DEMO: ', res));
      while (!chosen) {
        const answer = await ask();
        chosen = answer === '1' ? rows.find((b) => b.type === 1) : answer === '2' ? rows.find((b) => b.type === 4) : null;
        if (!chosen) logLine('[!] Digite 1 para REAL ou 2 para DEMO.');
      }
      rl.close();
    }
    if (!chosen || Number(chosen.amount) <= 0) {
      console.error('[ERRO] Conta inválida ou sem saldo.');
      ws.close();
      process.exit(1);
    }
    balanceId = chosen.id;
    initialBalance = currentBalance = Number(chosen.amount);
    accountType = chosen.type === 4 ? 'DEMO' : 'REAL';
    currencySymbol = symbolOf(chosen.currency);
    openedAt = nowMs();

    if (initialBalance < BASE_STAKE) {
      console.error(`[ERRO] Saldo insuficiente na conta ${accountType}: ${currencySymbol}${initialBalance.toFixed(2)} < base ${currencySymbol}${BASE_STAKE.toFixed(2)}.`);
      process.exit(1);
    }

    logLine(`[💼] CONTA ${accountType} (${chosen.currency}) | id=${balanceId} | saldo ${currencySymbol}${initialBalance.toFixed(2)}`);
    logLine(`[🧬] CÓDIGO ${CODE_REV} sha256:${CODE_HASH} — se a tela mostrar outro, é código velho (reinicie)`);
    logLine(`[🎛️] stake ${currencySymbol}${BASE_STAKE.toFixed(2)} | expiração ${EXPIRATION_MIN}min | piramidagem: até 2× mesmo sentido | martingale sem flip | sem cooldown após win | ${MIN_ACTIVE} ativos OTC 24/7 | teto expo ${MAX_EXPOSURE_PCT}%`);
    logLine(`[✂️] VENDA só por cotação real: realiza op positiva ≥ ${currencySymbol}${round2(Math.max(TAKE_PROFIT_MIN, BASE_STAKE * PAYOUT * TAKE_PROFIT_PCT / 100)).toFixed(2)} (${TAKE_PROFIT_PCT}% do win) | corte no fim (${Math.round(ENDGAME_BEFORE_MS / 1000)}–${Math.round(ENDGAME_AFTER_MS / 1000)}s) só se estiver LONGE da linha (≥ ${DISTANCE_FACTOR}× o candle típico) e devolver ≥ ${currencySymbol}${MIN_RECOVER.toFixed(2)} | NUNCA vende por reversão`);

    const actives = await fetchActives();
    if (LIST_ASSETS) {
      for (const act of actives) if (act?.name) logLine(`  [${act.id}] ${act.name}`);
    }
    applyUniverse(actives, 'boot');

    // Histórico: enche os buffers 5s/1min antes de operar (sequencial de propósito:
    // o cliente resolve 'candles' sem requestId e chamadas concorrentes se cruzam).
    const need5 = num(S.lookbackRegime, 20), need1 = num(S.min1mCandles, 1);
    const now0 = nowMs();
    const asc = (list) => (Array.isArray(list) ? list.slice().sort((x, y) => (toMs(x?.from ?? x?.at) ?? 0) - (toMs(y?.from ?? y?.at) ?? 0)) : []);
    let ready = 0;
    for (const [aid, row] of running) {
      try {
        const h5 = await ws.getCandlesHistory({ activeId: aid, size: num(S.candleSizeSeconds, 5), count: 120 });
        for (const candle of asc(h5?.msg?.candles)) buf5s.get(aid)?.ingest(candle, now0);
        const h1 = await ws.getCandlesHistory({ activeId: aid, size: 60, count: 30 });
        for (const candle of asc(h1?.msg?.candles)) buf1m.get(aid)?.ingest(candle, now0);
      } catch { /* histórico é best-effort; o feed ao vivo completa */ }
      const b5 = buf5s.get(aid), b1 = buf1m.get(aid);
      if (b5 && b1 && b5.ticks.length >= need5 && b1.ticks.length >= need1) ready++;
      row.lastCandleAt = 0;
    }
    logLine(`[🔁] histórico: ${ready}/${running.size} ativos com dados suficientes (5s≥${need5}, 1m≥${need1})`);

    await new Promise((r) => setTimeout(r, num(S.warmupMs, 5_000)));
    warmupDone = true;
    startTime = nowMs();  // início do cronômetro
    logLine(`[✅] OPERANDO ${CODE_REV} — venda por cotação real, painel abaixo`);
    renderDashboard();
    // Cronômetro: atualiza painel a cada segundo
    setInterval(() => { if (!shuttingDown) renderDashboard(); }, 1_000);
  };
  ws.on('ready', () => { void onReady().catch(fatal); });

  ws.on('candle-generated', (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid = Number(raw.active_id ?? raw.activeId);
    const size = sizeOf(raw);
    if (!Number.isFinite(aid) || size === null) return;
    const now = nowMs();
    const row = running.get(aid);

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
    const op = findOp({
      aid: Number(raw?.active_id ?? raw?.activeId),
      requestId: msg?.request_id ?? raw?.request_id ?? null,
      orderId: raw?.id ?? null,
      preferPending: true,
    });
    if (!op) { logLine(`[⚠️ ABERTURA SEM ORDEM LOCAL] ${JSON.stringify(raw).slice(0, 160)}`); return; }
    op.orderId = raw?.id ?? msg?.request_id ?? null;
    op.record.orderId = op.orderId;
  });

  // Venda confirmada. O caminho principal é o `socket-option-closed` antecipado;
  // este handler fica como reconciliação (sell_profit é LIQUIDO, nunca "menos stake").
  ws.on('sell-equal', async (msg) => {
    const raw = msg?.msg ?? msg;
    const positionId = Number(raw?.id ?? raw?.position_id ?? raw?.option_id);
    const op = findOp({ aid: Number(raw?.active_id ?? raw?.activeId), orderId: positionId });
    if (!op) return;
    finalizeEarly(op, pickCloseProfit(raw) ?? op.sellQuote, 'sell_equal');
  });

  ws.on('socket-option-closed', async (msg) => {
    const raw = msg?.msg ?? msg;
    const aid = Number(raw?.active_id ?? raw?.activeId);
    const op = findOp({
      aid,
      orderId: raw?.id ?? raw?.position_id ?? raw?.option_id ?? null,
      requestId: raw?.request_id ?? msg?.request_id ?? null,
    });
    if (!op) {
      const recent = [...settledRecently.values()].some((at) => nowMs() - at < 60_000);
      if (!recent) logLine(`[❓ FECHAMENTO SEM ORDEM LOCAL] aid=${aid}`);
      return;
    }
    const now = nowMs();
    const earlyByUs = op.sellRequestedAt && (op.expiration * 1000 - now) > 5_000;
    if (earlyByUs) {
      const rawProfit = pickCloseProfit(raw);
      const net = Number.isFinite(rawProfit) ? rawProfit : op.sellQuote;
      if (!Number.isFinite(net)) {
        logLine(`[⚠️] ${shortName(op.name)}: fechou por venda mas a cotação não foi lida — campos: ${Object.keys(raw ?? {}).slice(0, 12).join(',')}`);
      }
      finalizeEarly(op, net, Number.isFinite(rawProfit) ? 'close_sell_profit' : 'sell_quote');
      return;
    }
    if (op.sellRequestedAt) logLine(`[⚠️] ${shortName(op.name)}: venda pedida não foi aceita — fechou no vencimento`);

    inFlight.delete(op.okey);
    settledRecently.set(op.okey, now);
    const { result, profit, source } = parseSettlement(raw, op);
    Object.assign(op.record, { orderId: op.orderId, result, profit, profitSource: source, settledAt: new Date().toISOString() });
    saveResults();
    registerOutcome(profit, false);
    applyResult(op, result, profit);
    await refreshBalance();
    renderDashboard();
    const emoji = result === 'win' ? '✅' : result === 'loss' ? '❌' : '➖';
    const tag = op.kind === 'gale' ? ' (gale)' : '';
    logLine(`[${emoji}] ${shortName(op.name)} ${op.direction} ${result.toUpperCase()} ${fmt(profit)}${tag}`);
  });

  ws.on('close', () => {
    // Se não estamos saindo por kill switch, só loga (a reconexão é gerida
    // pelo IqWsClient). Se estamos saindo, ignora (o summary já foi impresso).
    if (!shuttingDown) logLine('\n[WS] Conexão encerrada.');
  });

  // SIGINT e SIGTERM — backup do Ctrl+C (PowerShell às vezes mapeia para copy).
  // Se o raw mode já capturou o Ctrl+C, este handler é só segurança extra.
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Meta de lucro: para o bot sozinho ao bater o alvo (e imprime relatório final).
const PROFIT_TARGET    = num(CONFIG.stop?.profitTarget, 1000);
let profitTargetLogged = false;
function checkProfitTarget() {
  if (!warmupDone || shuttingDown) return;
  if (PROFIT_TARGET <= 0) return;
  if (stats.profit >= PROFIT_TARGET && !profitTargetLogged) {
    profitTargetLogged = true;
    logLine(`\n[🎯 META BATIDA] lucro ${fmt(stats.profit)} >= alvo ${currencySymbol}${PROFIT_TARGET.toFixed(2)} → encerrando bot`);
    shutdown('META');
  }
}

setInterval(() => { void refreshBalance().then(checkProfitTarget); }, 60_000);
  setInterval(() => { void pollQuotes(); }, QUOTE_POLL_MS);
  setInterval(() => { void rebalanceUniverse(); }, UNIVERSE_CHECK_MS);

  // Sem ACK da IQ em 5s = ordem não chegou ao broker (aparece no painel).
  setInterval(() => {
    for (const op of inFlight.values()) {
      if (!op.ackLogged && !op.orderId && nowMs() - op.sentAtMs > 5_000) {
        op.ackLogged = true;
        logLine(`[⚠️] ${shortName(op.name)}: sem ACK da IQ em 5s (a ordem pode não ter chegado)`);
      }
    }
    for (const [okey, at] of settledRecently) if (nowMs() - at > 300_000) settledRecently.delete(okey);
    renderDashboard();
  }, 1_000);

  setInterval(() => {
    const limit = Date.now() - (EXPIRATION_MIN * 60_000 + 60_000);
    for (const [okey, op] of inFlight) {
      if (op.record.sentAtMs < limit) {
        inFlight.delete(okey);
        logLine(`[⚠️] ${shortName(op.name)}: sem fechamento da IQ (ordem recusada?) — operação liberada`);
      }
    }
  }, 30_000);

  await ws.connect({ ssid });
}

function summary() {
  logLine('\n🛑 RESULTADO FINAL:\n');
  logLine(`📊 Ops: ${stats.settled} | W: ${stats.wins} | L: ${stats.losses} | Draw: ${stats.draws} | Vendas: ${stats.early} (${stats.earlyPos}+ / ${stats.earlyNeg}-) | WR: ${stats.settled ? (stats.wins / stats.settled * 100).toFixed(1) : 0}%`);
  logLine(`💰 Lucro (bot): ${fmt(stats.profit)}`);
  logLine(`💰 Lucro (real): ${fmt(currentBalance - initialBalance)}  ← inclui ${currencySymbol}${openStake().toFixed(2)} ainda em ${inFlight.size} op(ns) aberta(s)`);
  logLine(`💼 Saldo final: ${currencySymbol}${currentBalance.toFixed(2)}`);
  saveResults();
  saveState();
}

// Kill switch central: fecha WS, limpa intervals, fecha stdin, sai com 0.
// Garante que o processo MORRA (sem restar loop/interval impedindo o exit).
let shuttingDown = false;
let dashboardHidden = false;
function shutdown(reason = 'K') {
  if (shuttingDown) return;
  shuttingDown = true;
  logLine(`\n[🛑] Kill switch ativado (${reason}) — fechando bot...`);

  // 1) Fecha o WebSocket (para de receber candles e ordens novas)
  try { ws?.close(); } catch {}

  // 2) Restaura stdin (importante no PowerShell/Windows para devolver o prompt)
  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  } catch {}

  // 3) Imprime o relatório final
  try { summary(); } catch {}

  // 4) Sai com 0 — forçado. process.exit(0) não pode ser interrompido por handles.
  //    (timeouts e WS pendentes NÃO bloqueiam o exit no Node 18+)
  setTimeout(() => process.exit(0), 100).unref();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(fatal);
}
