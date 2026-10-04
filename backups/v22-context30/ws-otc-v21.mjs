/** V22 standalone: contexto 30m, pullback confirmado, prazo 240–300s.
 * Estratégia e limites: docs/V22-CONTEXTO-30M.md. Recovery desativada.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import https from 'https';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';
import { context30, entryPullback, rsiWilder, validWindow, expirationAllowed, trend, dmi, STRATEGY_VERSION } from './v22-context.mjs';
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
const EXPIRATION_MIN = 5;
if (C.expirationMinutes !== 5 || REC.enabled !== false) throw new Error("V22 contexto exige expirationMinutes=5 e recovery.enabled=false");
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

// Entrada standalone V22 (parâmetros no módulo de contexto)
// Histórico — velas mínimas para bootstrapping (5s e 1m)
const HIST_WARMUP_MIN_MINUTES = 30;
const HIST_5S_PER_MIN         = 12;
const HIST_5S_REQUIRED        = Math.max(HIST_WARMUP_MIN_MINUTES * HIST_5S_PER_MIN, 29);
const HIST_1M_REQUIRED = 60;
const BOOTSTRAP_CHUNK        = 20;
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
const CODE_REV = STRATEGY_VERSION;
const CODE_HASH = (() => {
  try { return createHash('sha256').update(fs.readFileSync(new URL(import.meta.url), 'utf8')).update(fs.readFileSync(new URL('./v22-context.mjs',import.meta.url),'utf8')).update(JSON.stringify({C,S,REC})).digest('hex').slice(0, 8); }
  catch { return '????????'; }
})();

// ─── FUNÇÕES AUXILIARES / COMPATIBILIDADE DO ESTADO ─────────────────────────
const round2 = (v) => Math.round(v * 100) / 100;

export function martingaleStake(recoverBase) {
  const base = Number(recoverBase);
  if (!Number.isFinite(base) || base <= 0) return 0;
  return round2(MARTINGALE_MULT * base);
}

// ladderStake removido — martingale usa multiplicador fixo (martingaleMultiplier), não escada
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

// Contexto móvel de 30 minutos em candles nativos 1m; nomes legados só no estado.
const HIST_1M_FETCH = Math.max(62, Math.round(num(S.boot1mCandles,62)));
export function getRegimeForAsset(assetId) {
  return context30(buf1m.get(assetId)?.ticks ?? [], nowMs(), S);
}

export function trendDirection(ticks) {
  if (ticks.length < 50) return {direction:null,spreadPct:0,source:'insuficiente'};
  return {...trend(ticks.slice(-50), S.trendMinEmaSpreadPct ?? .01),source:'ema8x21-5s'};
}

export function calcRSI(ticks, period = 14) { return rsiWilder(ticks, period) ?? 50; }

export function calcADX(ticks, period=14) { return round2(dmi(ticks,period).adx ?? 0); }

export function parseSettlement(raw, op) {
  const win = String(raw?.win ?? raw?.status ?? raw?.result ?? '').toLowerCase();
  // Statusausente ou intermediário = UNKNOWN (não é loss inventado)
  // Reconhece: win, equal, draw, closed, settled, expired — todos FINAIS.
  // Não reconhece (UNKNOWN): pending, open, active, rejected, null, vazio, indefinido.
  const FINAL_STATUSES = ['win', 'equal', 'draw', 'closed', 'settled', 'expired'];
  const INTERMEDIATE_STATUSES = ['pending', 'open', 'active', 'rejected', 'cancelled', 'null', 'undefined', ''];

  if (!win || win === 'null' || win === 'undefined' || win === '') {
    return { result: 'unknown', profit: null, invested: op.stake ?? 0 };
  }
  if (INTERMEDIATE_STATUSES.includes(win)) {
    return { result: 'unknown', profit: null, invested: op.stake ?? 0 };
  }
  if (!FINAL_STATUSES.includes(win)) {
    return { result: 'unknown', profit: null, invested: op.stake ?? 0 };
  }
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
    this.formingOpen = null;
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
      this.formingAt = startMs; this.formingOpen = Number(raw.open ?? raw.price_open ?? raw.o ?? close); this.formingClose = close; this.formingHigh = high; this.formingLow = low;
    } else {
      this.formingClose = close;
      this.formingHigh = Math.max(this.formingHigh ?? high, high);
      this.formingLow = Math.min(this.formingLow ?? low, low);
    }
    if (this.formingAt !== null && nowMs >= this.formingAt + this.sizeMs) closed = this.flushForming() ?? closed;
    // Atualiza lastTickClose para que prevRsi seja calculado corretamente no próximo tick
    this.lastTickClose = close;
    return closed;
  }
  flushForming() {
    if (this.formingAt === null) return null;
    const bar = { atMs: this.formingAt, open: this.formingOpen, close: this.formingClose, high: this.formingHigh ?? this.formingClose, low: this.formingLow ?? this.formingClose };
    this.ticks.push(bar);
    if (this.ticks.length > 500) this.ticks.shift();
    this.lastClosedAt = this.formingAt;
    this.formingAt = null;
    this.formingClose = null;
    this.formingOpen = null;
    this.formingHigh = null;
    this.formingLow = null;
    return bar;
  }
}

// ─── ENTRADA — EMA8×21 + ADX + RSI guarda + corpo vela (V15 puro) ──────────────
// ─── ENTRADA V20 (IDENTICA — NÃO ALTERAR) ────────────────────────────────────
export function evaluateEntry({ ticks, open, regime15m, now = nowMs() }) {
  const decision = entryPullback({ticks, open, context: regime15m, now, settings:S});
  if (decision.skip) return decision;
  const sec = Math.floor(now/1000);
  const {expiration} = computeExpiration(sec, EXPIRATION_MIN);
  return expirationAllowed(expiration,sec,240) ? decision : {skip:'janelaExpiracaoMenor240s'};
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
    cyclePnl: 0,       // P/L acumulado deste ciclo específico (evita double-count)
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
      // V21 ciclo
      cycleId: num(old.cycleId, 0),
      cycleOpenOps: Math.max(0, Math.round(num(old.cycleOpenOps, 0))),
      cyclePnl: round2(num(old.cyclePnl, 0)),
      runnerLossRecoveryArmed: false,
      recoveryAttempts: Math.max(0, Math.round(num(old.recoveryAttempts, 0))),
      galeArmedAt: num(old.galeArmedAt, 0),
    };
  }
  return state;
}

const state = loadState();
const resultsList = [];
const buf5s = new Map();
const buf1m = new Map();
const inFlight      = new Map();          // okey → operação em voo (confirmada pelo broker)
const pendingSet   = new Set();          // okey → ordens enviadas mas sem ACK (P0-fix: openStake não soma esses)
const pending      = new Map();          // okey → {stake, sentAtMs} (P0-fix: metadados para reconciliação)
const awaitingSettlement = new Map();   // okey → op expirada sem settlement — reconciliar com broker
const running  = new Map();          // activeId → { key, name, aid, source, wr, lastCandleAt, since }
const quotes   = new Map();          // orderId → { sellProfit, at }
const settledRecently = new Map();    // okey → timestamp
const bannedUntil     = new Map();   // activeId → timestamp
const cycleStats = {                 // estatísticas por ciclo
  cash:  { settled: 0, wins: 0, losses: 0, pnl: 0 },
  runner: { settled: 0, wins: 0, losses: 0, pnl: 0 },
  recovery: { settled: 0, wins: 0, losses: 0, pnl: 0 },
  cycles: { total: 0, won: 0, lost: 0, pnl: 0 },
};
const opsFor   = (aid) => [...inFlight.values()].filter((o) => o.assetId === aid);
// P0-fix: openStake inclui stake de ordens enviadas mas sem ACK do broker
const openStake = () => {
  // P0-fix: soma apenas inFlight (stake de ordens confirmadas pelo broker).
  // pendingSet tracks ordens enviadas mas sem ACK — contam como "reserva"
  // mas não como exposição real (a stake só é debitada quando o broker aceita).
  return [...inFlight.values()].reduce((sum, o) => sum + o.stake, 0);
};
const nextCycleId = () => Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 999);

function findOp({ aid = null, requestId = null, orderId = null, expiration = null, preferPending = false } = {}) {
  // P0-fix: busca em ordersByRequestId (ordens SENT) + inFlight (ordens ACCEPTED).
  // Nunca retorna ordem arbitrária por ativo — exige ID exato.
  if (requestId !== null && requestId !== undefined && String(requestId).length > 0) {
    const fromIndex = ordersByRequestId.get(String(requestId));
    if (fromIndex) return fromIndex;
  }
  if (orderId !== null && orderId !== undefined && Number.isFinite(Number(orderId))) {
    const strId = String(orderId);
    // inFlight pode ter orderId definido (após ACK)
    const byId = [...inFlight.values()].find((o) => o.orderId !== undefined && o.orderId !== null && String(o.orderId) === strId);
    if (byId) return byId;
    // Também busca em ordersByRequestId ( ACK ainda não chegou mas orderId veio no payload )
    for (const op of ordersByRequestId.values()) {
      if (op.orderId !== undefined && op.orderId !== null && String(op.orderId) === strId) return op;
    }
  }
  if (requestId === null && orderId === null) return null;
  return null;
}

// ─── CORRELAÇÃO DE ACK (auditoria 2026-10-03) ────────────────────────────────
// A IQ NÃO ecoa o request_id nos eventos de posição. Os eventos úteis são:
//  - `socket-option-opened`: id/active_id/amount (amount = stake × 1e6);
//  - push `position-changed` (raw_event.binary_options_option_changed1, result=opened):
//    option_id + active_id + direction + amount + expiration_time.
// As duas pernas do ciclo (cash/runner) são idênticas em stake/direção/vencimento;
// o ACK mais antigo vincula a primeira perna ainda sem orderId (instrumentos fungíveis).
function stakeFromAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 100_000 ? round2(n / 1_000_000) : round2(n);
}

function opByOrderId(orderId) {
  const idNum = Number(orderId);
  if (!Number.isFinite(idNum)) return null;
  return [...inFlight.values()].find((o) => o.orderId !== null && o.orderId !== undefined && Number(o.orderId) === idNum) ?? null;
}

function candidateOps({ aid, direction = null, stake = null, expirationSec = null, freshMs = null }) {
  const now = nowMs();
  return [...inFlight.values()].filter((o) => {
    if (o.settled || o.applied || o.awaitingSettlement) return false;
    if (o.orderId !== null && o.orderId !== undefined) return false;
    if (freshMs !== null && now - (o.sentAtMs ?? 0) > freshMs) return false;
    if (Number.isFinite(Number(aid)) && Number(o.assetId) !== Number(aid)) return false;
    if (direction !== null && String(o.direction).toLowerCase() !== String(direction).toLowerCase()) return false;
    if (Number.isFinite(expirationSec) && Number(o.expiration) !== Number(expirationSec)) return false;
    if (Number.isFinite(stake) && Math.abs(Number(o.stake) - Number(stake)) > 0.011) return false;
    return true;
  }).sort((a, b) => (a.sentAtMs ?? 0) - (b.sentAtMs ?? 0));
}

function attachOrderId(op, orderId, source) {
  const idNum = Number(orderId);
  if (!op || !Number.isFinite(idNum)) return false;
  if (op.orderId !== null && op.orderId !== undefined) return Number(op.orderId) === idNum;
  op.orderId = idNum;
  if (op.record) op.record.orderId = idNum;
  pendingSet.delete(op.okey);
  pending.delete(op.okey);
  if (op.requestId) ordersByRequestId.delete(String(op.requestId));
  savePending();
  logLine(`[✅ ACK] ${shortName(op.name)} ${op.direction} ${(op.role ?? '?').toUpperCase()} | orderId=${idNum} | cyc=${op.cycleId} | ${source}`);
  return true;
}

let ws = null, warmupDone = false;
let balanceId = null, initialBalance = 0, currentBalance = 0;
let accountType = 'DEMO', currencySymbol = 'US$';
let startedAt = 0, closedCandles = 0, sessionStopLogged = false;
let sessionStartBalance = 0;

// P0-fix: índice completo de ordens por requestId (corrige correlação de ACK)
// sendOrder guarda op aqui ANTES de enviar ao broker; socket-option-opened encontra por requestId.
// P0-fix: ordersByRequestId — índice de ordens SENT para correlação de ACK
// Exportado para testes; em produção é usado apenas internamente.
export const ordersByRequestId = new Map();

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
  // Audit fix: ':' e '/' viram fluxo alternado NTFS no Windows (log 0 bytes). Usa '-'.
  const dateStr = `${String(now.getDate()).padStart(2,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getFullYear()).slice(-2)}`;
  const timeStr = `${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
  const fileName = `OP_V22_${dateStr}_${timeStr}.log`;
  sessionLogFile = path.join(HISTORICO_DIR, fileName);
  try {
    const header = `═══════════════════════════════════════════════════════════════\n`;
    const title  = `  SESSÃO V22 INICIADA: ${dateStr} às ${timeStr}\n`;
    const info   = `  Bot: ${CODE_REV} | Conta: ${accountType} | Saldo: ${currencySymbol}${initialBalance.toFixed(2)}\n`;
    const cfg    = `  Cash TP: ${currencySymbol}${CASH_TP.toFixed(2)} | Recovery OFF | Expiração: ${EXPIRATION_MIN}min\n`;
    const end    = `═══════════════════════════════════════════════════════════════\n\n`;
    fs.writeFileSync(sessionLogFile, header + title + info + cfg + end);
    sessionLogStream = fs.createWriteStream(sessionLogFile, { flags: 'a' });
    console.log(`[📁] Log V22: ${sessionLogFile}`);
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
        `  RESULTADO V22 POR PAPEL`,
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
      const regime15m = getRegimeForAsset(op.assetId);
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
        `context30m=${regime15m?.direction ?? '?'}(${regime15m?.spreadPct?.toFixed(2) ?? '?'}%)[${regime15m?.source ?? '?'}] ` +
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
  open, direction, now, pausedUntil = 0,
  stake, balance = 0,
  exposure = 0, committed = 0, exposureLimit = Infinity,
  sessionLoss = 0, sessionLossLimit = Infinity, maxSameDirection = 3,
}) {
  const sameDir = open.filter((o) => o.direction === direction);
  if (sameDir.length >= maxSameDirection) return 'pyramidMax';
  if (open.length >= (C.maxOpsPerAsset ?? 3)) return 'maxOps';
  if (now < pausedUntil) return 'pausado';
  if (sessionLoss >= sessionLossLimit) return 'perdaSessao';
  // Saldo: rejeita zero, negativo, NaN e stake maior que disponível
  if (!Number.isFinite(balance) || balance <= 0 || stake > balance) return 'semSaldo';
  // Exposição total (aberta + nova) não pode ultrapassar o limite de exposição
  if (exposure + stake > exposureLimit) return 'exposureLimit';
  // P0-fix: compromisso financeiro = exposição real + reservas pendentes (ACK não chegou).
  // O broker já debitou a stake; se o ACK chegar depois, a conta pode ficar negativa.
  if (committed + stake > exposureLimit) return 'exposureLimit';
  return null;
}

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
  const rsi     = calcRSI(b5.ticks);
  const adx     = calcADX(b5.ticks);
  // Contexto 30m recalculado com candles 1m fechados e recentes.
  const regime15m = getRegimeForAsset(aid);
  s.regime15m = regime15m;

  const decision = evaluateEntry({ ticks: b5.ticks, open, regime15m: s.regime15m, rsi, adx });
  if (decision.skip) return null;

  // (A Recovery é avaliada em evaluateOpenPositions, dentro da janela do gale)
  return { direction: decision.direction, trend, rsi, adx, kind: 'signal', reason: decision.reason, snapshot: decision.snapshot };
}

// ─── RESERVAS DE ACK (auditoria 2026-10-03) ──────────────────────────────────
// sendOrder já coloca a ordem em inFlight; a reserva `pending` só existe para saber
// qual ordem ainda não recebeu orderId. Contá-la de novo na exposição travava o bot
// após a primeira entrada (reservas antigas nunca expiravam).
const PENDING_TTL_MS = 10 * 60_000;

/** Soma das reservas pendentes que NÃO estão em inFlight (cada stake conta uma única vez). */
export function pendingCommitment(pendingEntries, hasInFlight) {
  let sum = 0;
  for (const [okey, info] of pendingEntries) {
    if (typeof hasInFlight === 'function' && hasInFlight(okey)) continue;
    sum += Number(info?.stake) || 0;
  }
  return round2(sum);
}

/** Chaves de reservas vencidas (ordem enviada há mais de ttlMs). */
export function pendingStaleKeys(pendingEntries, now, ttlMs = PENDING_TTL_MS) {
  const stale = [];
  for (const [okey, info] of pendingEntries) {
    if (Number(now) - Number(info?.sentAtMs ?? 0) > ttlMs) stale.push(okey);
  }
  return stale;
}

function prunePendingStale() {
  let dropped = 0;
  for (const okey of pendingStaleKeys(pending, nowMs())) {
    pending.delete(okey); pendingSet.delete(okey); dropped++;
  }
  if (dropped > 0) {
    logLine(`[🧹] pending prune: ${dropped} reserva(s) de ACK vencida(s) descartada(s)`);
    savePending();
  }
  return dropped;
}

function canTrade(aid, direction, stake) {
  const buf = buf5s.get(aid);
  const s   = buf ? state[buf.key] : null;
  if (!s) return null;
  const loss = sessionStartBalance > 0 ? sessionStartBalance - currentBalance : 0;
  // Audit fix: committed = exposição real (inFlight) + reservas pendentes que não estão em inFlight
  const committed = round2(openStake() + pendingCommitment(pending, (okey) => inFlight.has(okey)));
  const reason = evaluateGuards({
    open: opsFor(aid), direction, now: nowMs(),
    pausedUntil: s.pausedUntil, lastOpAt: s.lastOpAt, lastResult: s.lastResult,
    stake, balance: currentBalance,
    exposure: openStake(), committed,
    exposureLimit: exposureLimit(),
    sessionLoss: loss, sessionLossLimit: sessionLossLimit(),
    maxSameDirection: C.maxOpsPerAsset ?? 3,
  });
  if (reason) {
    const row = running.get(aid);
    sessionLog(`CAN_TRADE_BLOCKED aid=${aid} ${shortName(row?.name ?? '')} reason=${reason} | stake=${stake} balance=${currentBalance} open=${opsFor(aid).length}`);
    if (reason === 'perdaSessao' && !sessionStopLogged) {
      sessionStopLogged = true;
      logLine(`[🛑 TRAVA DE PERDA] sessão ${fmt(-loss)} de ${currencySymbol}${sessionLossLimit().toFixed(2)} — nenhuma ordem`);
    }
    return null;
  }
  return s;
}

function nowMs() { return Date.now(); }
function exposureLimit() { return (currentBalance * MAX_EXPOSURE_PCT) / 100; }
function sessionLossLimit() { return (sessionStartBalance * SESSION_LOSS_PCT) / 100; }

// Ordem: decisão já confirmada pelo contexto e pullback.
function sendOrder(aid, direction, stake, expiration, optionTypeId, requestId, role, cycleId) {
  const b5  = buf5s.get(aid);
  const s   = b5 ? state[b5.key] : null;
  if (!b5 || !s) return null;
  const entryPrice = b5.ticks[b5.ticks.length - 1]?.close ?? null;
  const okey = `${aid}|${expiration}|${requestId}`;
  const record = {
    assetId: aid, active: b5.name, key: s.key, direction, role, cycleId,
    strategyVersion: STRATEGY_VERSION, decisionSnapshot:s.entrySnapshot,
    baseDirection: s.baseDirection, stake, entryPrice, expiration, requestId,
    sentAtMs: nowMs(), timestamp: new Date().toISOString(), rev: CODE_REV,
  };
  resultsList.push(record);
  const op = {
    okey, assetId: aid, key: s.key, name: b5.name, direction, role, cycleId,
    stake, entryPrice, expiration, requestId, sentAtMs: record.sentAtMs, record,
    sellAttempts: 0, lastSellAt: 0, sellRequestedAt: 0, sellKind: null, sellQuote: null,
    applied: false,     // P0-fix: impede double-applyResult (finalizeEarly + stale-op ou socket-option-closed)
  };
  // P0-fix: adiciona em pending-set (não em inFlight) — a ordem ainda não foi confirmada
  // pelo broker. Só passa para inFlight quando o ACK chega (socket-option-opened).
  // openStake soma APENAS inFlight — cada stake é contada exatamente uma vez.
  // pendingSet rastreia quais okeys aguardam ACK para evitar double-count.
  pendingSet.add(okey);
  pending.set(okey, { stake, sentAtMs: record.sentAtMs });
  // P0-fix: guarda op COMPLETA em ordersByRequestId para que o ACK a encontre por requestId
  ordersByRequestId.set(requestId, op);
  savePending();

  s.lastOpAt = record.sentAtMs;
  s.direction = direction;

  // Coloca em inFlight IMEDIATAMENTE — o ACK do broker não ecoa requestId,
  // então a correlação por requestId não funciona. O applied-flag do applyResult
  // garante que a primeira chamada (ACK ou settlement) marca applied=true e a
  // segunda é ignorada. Pending continua rastreando exposição até o ACK.
  inFlight.set(okey, op);
  savePending();

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
  // P0-fix: NÃO retorna aqui se inFlight.size === 0 — Recovery timeout precisa
  // avaliar ciclos órfãos (Cash+Runner fecharam mas Recovery ficou armada).

  monitorBusy = true;
  try {
    // ── STALE-OP GUARD: força remoção de ops que expiraram há >60s sem settlement ──
    // Causa raiz do freeze: WS cai → socket-option-closed para de fire → inFlight nunca limpa
    // Solução: se exp * 1000 < now - 60s, força remoção e aplica resultado como loss
    for (const [okey, op] of [...inFlight.entries()]) {
      if (op.settled) continue;
      // P0-fix: se applied=true, applyResult já foi chamado (ex: finalizeEarly+cash confirm).
      // stale-op NÃO força novamente — evitar recontagem de cycleOpenOps.
      if (op.applied) continue;
      const expiredMs = nowMs() - op.expiration * 1000;
      if (expiredMs > 60_000) {
        // P0-fix: expiração NÃO é derrota. Armazena para reconciliação com broker.
        // O settlement pode chegar com delay (reconexão WS, processamento IQ).
        op.awaitingSettlement = true;
        pendingSet.delete(okey);
        pending.delete(okey);
        inFlight.delete(okey);  // remove de exposição ativa
        awaitingSettlement.set(okey, op);  // rastreia para reconciliação posterior
        savePending();
        logLine(`[⚠️ EXPIROU] ${shortName(op.name)} ${op.direction} ${(op.role ?? '?').toUpperCase()} expirou há ${Math.round(expiredMs/1000)}s — aguardando reconciliação | cyc=${op.cycleId} okey=${op.okey}`);
        sessionLog(`EXPIROU_AWAITING_SETTLEMENT | ${shortName(op.name)} | ${op.direction} | ${(op.role ?? '?').toUpperCase()} | expired=${Math.round(expiredMs/1000)}s | cyc=${op.cycleId} | okey=${op.okey}`);
      }
    }

    for (const op of [...inFlight.values()]) {
      if (op.settled) continue;
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
          // P0-fix: NÃO atualiza stats antes da confirmação — applyResult faz isso
          // quando finalizeEarly for chamado com o settlement real.
          // Só registra que a venda foi solicitada.
          logLine(`[💰 CASH] ${shortName(op.name)} ${op.direction} | venda: sell_profit=${fmt(sellProfit)} TP=${fmt(CASH_TP)} | cyc=${op.cycleId}`);
          sessionLog(`CASH_VENDA_SOLICITADA | ${shortName(op.name)} | ${op.direction} | sell=${fmt(sellProfit)} | TP=${fmt(CASH_TP)} | cyc=${op.cycleId}`);
        }
      }

    }

  } finally {
    monitorBusy = false;
  }
}


// ─── ENTRADA PRINCIPAL (duas posições: Cash + Runner) ─────────────────────────
function maybeTrade(aid) {
  if (!warmupDone) return;
  const row = running.get(aid);
  if (!row || row.bootstrapStatus !== 'READY') return;

  const s = state[buf5s.get(aid)?.key];
  if (!s) return;

  // V21: se Recovery está armada (Runner lossou), NÃO abre novo ciclo
  // A avaliação de Recovery fica por conta do evaluateOpenPositions (5s)
  s.runnerLossRecoveryArmed = false;

  const plan = planTrade(aid);
  if (!plan || plan.kind !== 'signal') return;

  const stake = BASE_STAKE;
  const guard = canTrade(aid, plan.direction, stake * 2);
  if (!guard) return;

  // REMOVIDO: pausedUntil — sem travamento por stake alto
  if (stake > MAX_STAKE || stake * 2 > MAX_STAKE) {
    logLine(`[⛔ BLOQUEADO] ${shortName(s.name)} | stake ${currencySymbol}${stake * 2} acima de ${currencySymbol}${MAX_STAKE}`);
    return;
  }

  const nowSec = Math.floor(nowMs() / 1000);
  const { expiration, optionTypeId } = computeExpiration(nowSec, EXPIRATION_MIN);
  if (!expirationAllowed(expiration, nowSec, 240)) return;
  const signalAt = plan.snapshot.signalAt;
  if (s.lastEntrySignalAt === signalAt) return;
  s.lastEntrySignalAt = signalAt;
  s.entrySnapshot = {...plan.snapshot, expiration, durationSeconds:expiration-nowSec};
  const cycleId = nextCycleId();

  // Gera dois requestIds diferentes
  const reqIdCash   = ws.uuid().replace(/-/g, '').slice(0, 12);
  const reqIdRunner = ws.uuid().replace(/-/g, '').slice(0, 12);

  // CASH
  const cashOp = sendOrder(aid, plan.direction, stake, expiration, optionTypeId, reqIdCash, 'cash', cycleId);
  // RUNNER
  const runnerOp = sendOrder(aid, plan.direction, stake, expiration, optionTypeId, reqIdRunner, 'runner', cycleId);

  if (cashOp && runnerOp) {
    s.cycleId = cycleId;
    s.cycleOpenOps = 2;
    s.cycleOps = (s.cycleOps ?? 0) + 2;

    logLine(`[📤 CICLO ${cycleId}] ${shortName(s.name)} ${plan.direction} | CASH ${currencySymbol}${stake.toFixed(2)} + RUNNER ${currencySymbol}${stake.toFixed(2)} | ${plan.reason} | duração=${expiration-nowSec}s`);
    sessionLog(`CICLO_INICIO | ${shortName(s.name)} | ${plan.direction} | CASH=${fmt(stake)} RUNNER=${fmt(stake)} | ${plan.reason} | cyc=${cycleId}`);

    // Atualiza estado do cycleStats
    cycleStats.cycles.total++;
  }

  saveResults();
}

// ─── COTIZAÇÃO (sell_profit em tempo real) ────────────────────────────────────
let quoteFirstLogged = false;

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
  // ── ACK da abertura: o push traz raw_event.binary_options_option_changed1 (result=opened)
  //    com option_id + active_id + direction + amount + expiration_time. É a fonte que
  //    realmente existe — a IQ não ecoa o request_id. (audit fix)
  const opt = raw?.raw_event?.binary_options_option_changed1 ?? null;
  if (opt && String(opt.result ?? '').toLowerCase() === 'opened') {
    const orderId = opt.option_id ?? raw?.external_id ?? raw?.id ?? null;
    const aid = Number(opt.active_id ?? raw?.active_id);
    const direction = opt.direction ?? null;
    const stake = stakeFromAmount(opt.amount ?? raw?.invest);
    const expirationSec = Number(opt.expiration_time ?? raw?.expiration_time ?? NaN);
    let op = opByOrderId(orderId);
    if (!op) op = candidateOps({ aid, direction, stake, expirationSec: Number.isFinite(expirationSec) ? expirationSec : null, freshMs: 60_000 })[0] ?? null;
    if (op) attachOrderId(op, orderId, 'position-changed');
  }
  // ── cotação (sell_profit real da IQ) ──
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

// ─── FECHAMENTO DE CICLO (extraído para uso em evaluateOpenPositions) ──────────
function closeCycle(s) {
  // Previne double-close (stale-op + Recovery skip, por exemplo)
  if (s.cycleId === 0) return;
  // P/L do ciclo é a soma das pernas acumuladas neste ciclo — não os globais
  const cyclePnl = s.cyclePnl ?? 0;
  cycleStats.cycles.pnl = round2(cycleStats.cycles.pnl + cyclePnl);
  if (cyclePnl > 0) cycleStats.cycles.won++;
  else if (cyclePnl < 0) cycleStats.cycles.lost++;

  logLine(`[🏁 CICLO ${s.cycleId} FECHADO] ${shortName(s.name)} | CASH W=${cycleStats.cash.wins} L=${cycleStats.cash.losses} | RUNNER W=${cycleStats.runner.wins} L=${cycleStats.runner.losses} | REC W=${cycleStats.recovery.wins} L=${cycleStats.recovery.losses} | P/L=${fmt(cyclePnl)}`);
  sessionLog(`CICLO_FIM | ${shortName(s.name)} | cyc=${s.cycleId} | P/L=${fmt(cyclePnl)}`);

  // Reset ciclo completo
  s.cycleId = 0;
  s.cycleOpenOps = 0;
  s.cyclePnl = 0;
  s.runnerLossRecoveryArmed = false;
  s.recoveryReason = null;
  s.recoveryAttempts = 0;
}

// ─── APLICA RESULTADO E FECHA POSIÇÃO ───────────────────────────────────────
function applyResult(op, result, profit) {
  if (op.applied) return;
  if (profit === null || profit === undefined) {
    if (result === 'loss') profit = -op.stake;
    else if (result === 'win') profit = round2(op.stake * PAYOUT);
    else profit = 0;
  }
  op.applied = true;
  registerOutcome(profit, false);  // stats globais no settlement (nunca no pedido)

  const s = state[op.key];
  if (!s) return;

  // Estatísticas por papel (sessão) — contam mesmo se o ciclo já fechou
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
  } else if (op.role === 'recovery') {
    cycleStats.recovery.settled++;
    cycleStats.recovery.pnl = round2(cycleStats.recovery.pnl + (profit || 0));
    if (profit > 0) cycleStats.recovery.wins++;
    else if (profit < 0) cycleStats.recovery.losses++;
  }

  // Estado do ciclo: só mexe se ESTE ciclo ainda está ativo — settlement atrasado de um
  // ciclo já fechado não pode contaminar o próximo (audit fix).
  if (op.cycleId && op.cycleId === s.cycleId) {
    s.cycleOpenOps = Math.max(0, (s.cycleOpenOps ?? 1) - 1);
    s.runnerLossRecoveryArmed = false; // recuperação desligada nesta estratégia
    s.cyclePnl = round2((s.cyclePnl ?? 0) + (profit || 0));
    // Fecha quando TODAS as pernas settlearam. Com Recovery já avaliada (attempts > 0)
    // pode fechar mesmo com a flag armada — audit fix do deadlock pós-Recovery.
    if (s.cycleOpenOps <= 0 && (!s.runnerLossRecoveryArmed || s.recoveryAttempts > 0)) {
      closeCycle(s);
    }
  }

  s.lastResult = result;
  saveState();
}

function finalizeEarly(op, returnedValue, source) {
  // P0-fix: dedup — applied=true → idempotente
  if (op.applied) return;
  op.applied = true;
  settledRecently.set(op.okey, nowMs());
  pendingSet.delete(op.okey);
  pending.delete(op.okey);   // P0-fix: remove da reserva de exposição
  inFlight.delete(op.okey);  // P0-fix: remove de inFlight (se ainda não foi)
  savePending();
  const devolve = round2(Number.isFinite(returnedValue) ? returnedValue : 0);
  const profit = saleNet(devolve, op.stake);
  Object.assign(op.record ?? (op.record = {}), {
    result: 'early', profit, earlySell: true, sellReturn: devolve, profitSource: source,
    sellKind: op.sellKind ?? null, settledAt: new Date().toISOString(),
  });
  saveResults();
  // P0-fix: applyResult chama registerOutcome — uma única记账 global por settlement.
  applyResult(op, 'early', profit);  // applied=true → idempotente
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
  let creds = { email: process.env.IQ_EMAIL, password: process.env.IQ_PASSWORD };
  try {
    const c = JSON.parse(fs.readFileSync(new URL('./bot-credentials.json',import.meta.url), 'utf8'));
    if (c.email && c.password) creds = c;
  } catch {}
  if (!creds.email || !creds.password) throw new Error("Configure bot-credentials.json local ou IQ_EMAIL/IQ_PASSWORD; credenciais não ficam no Git.");
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

  const added = [];
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
    running.set(entry.aid, { ...entry, lastCandleAt: 0, since: nowMs(), bootstrapStatus: 'LOADING_HISTORICAL' });
    added.push(entry.aid);
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
  return added;
}

const asc = (list) => (Array.isArray(list) ? list.slice().sort((x, y) => (toMs(x?.from ?? x?.at) ?? 0) - (toMs(y?.from ?? y?.at) ?? 0)) : []);

/**
 * Bootstrap de UM ativo: carrega histórico 5s + 1m e transita o estado.
 * Retorna { ok, received5s, received1m, gapMs }
 */
async function bootstrapAsset(aid) {
  const row = running.get(aid);
  if (!row) return { ok: false, reason: 'notRunning' };
  const now0 = nowMs();
  let received5s = 0, received1m = 0, gapMs = 0;
  try {
    const [h5, h1] = await Promise.all([
      ws.getCandlesHistory({ activeId: aid, size: num(S.candleSizeSeconds, 5), count: HIST_5S_REQUIRED + 2 }),
      // Sessenta velas 1m fechadas para aquecimento; contexto móvel de 30 minutos.
      ws.getCandlesHistory({ activeId: aid, size: 60, count: HIST_1M_FETCH }),
    ]);
    const c5s = asc(h5?.msg?.candles ?? []);
    const c1m = asc(h1?.msg?.candles ?? []);
    for (const c of c5s) buf5s.get(aid)?.ingest(c, now0);
    for (const c of c1m) buf1m.get(aid)?.ingest(c, now0);
    received5s = buf5s.get(aid).ticks.length;
    received1m = buf1m.get(aid).ticks.length;

    // Verificar continuidade/gaps
    if (c5s.length >= 2) {
      const lastTs = toMs(c5s[c5s.length - 1]?.from ?? c5s[c5s.length - 1]?.at) ?? 0;
      const nowTs  = now0;
      gapMs = nowTs - lastTs;
    }
    row.bootstrapStatus = 'WARMING_UP';
    row.bootstrapAt = now0;

    const has5s = received5s >= HIST_5S_REQUIRED;
    const has1m = received1m >= HIST_1M_REQUIRED;
    const continuous = validWindow(buf5s.get(aid).ticks, 5000, HIST_5S_REQUIRED, now0) && validWindow(buf1m.get(aid).ticks, 60000, HIST_1M_REQUIRED, now0);

    if (has5s && has1m && continuous) {
      row.bootstrapStatus = 'READY';
      row.bootstrapReadyAt = now0;
      return { ok: true, received5s, received1m, gapMs, name: row.name };
    } else {
      row.bootstrapStatus = 'DATA_NOT_READY';
      row.bootstrapFailReason = [
        !has5s ? `5s:${received5s}<${HIST_5S_REQUIRED}` : '',
        !has1m ? `1m:${received1m}<${HIST_1M_REQUIRED}` : '',
        !continuous ? `gap:${Math.round(gapMs/1000)}s` : '',
      ].filter(Boolean).join('|');
      return { ok: false, received5s, received1m, gapMs, name: row.name };
    }
  } catch (err) {
    row.bootstrapStatus = 'DATA_NOT_READY';
    row.bootstrapFailReason = `exception:${String(err).slice(0,60)}`;
    return { ok: false, received5s, received1m, gapMs };
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
    const added = applyUniverse(actives, 'revisão');
    const pending = [...running].filter(([, row]) => row.bootstrapStatus === 'DATA_NOT_READY').map(([aid]) => aid);
    // Bootstrap dos novos ativos adicionados
    for (const aid of new Set([...added, ...pending])) {
      const result = await bootstrapAsset(aid);
      const row = running.get(aid);
      if (row) {
        if (result.ok) {
          const r15m = getRegimeForAsset(aid);
          logLine(`  [✅ ${shortName(row.name)}] HIST=${HIST_WARMUP_MIN_MINUTES}m+ | context30m=${r15m.direction}(${r15m.spreadPct?.toFixed(3) ?? 'n/a'})[${r15m.source}]`);
        } else {
          logLine(`  [⚠️ ${shortName(row.name)}] DATA_NOT_READY | ${row.bootstrapFailReason ?? 'unknown'}`);
        }
      }
    }
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
    toSave[key] = {
      direction: s.direction, ladder: s.ladder, lossStreak: s.lossStreak,
      pausedUntil: s.pausedUntil, lastOpAt: s.lastOpAt, lastResult: s.lastResult,
      // V21 ciclo
      cycleId: s.cycleId, cycleOpenOps: s.cycleOpenOps, cyclePnl: s.cyclePnl,
      runnerLossRecoveryArmed: s.runnerLossRecoveryArmed,
      recoveryAttempts: s.recoveryAttempts,
      galeArmedAt: s.galeArmedAt,
      regime15m: s.regime15m ? { direction: s.regime15m.direction, source: s.regime15m.source } : null,
    };
  }
  // P0-fix: atomic write
  try {
    const tmp = (P.state ?? './bot-state-v21.json') + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(toSave, null, 2));
    fs.renameSync(tmp, P.state ?? './bot-state-v21.json');
  } catch (e) { logLine(`[⚠️ saveState] ${e.message}`); }
}

// P0-fix: persiste pending+inFlight para reconciliação após restart
// Salvamos: (a) inFlight (operações confirmadas), (b) pending (enviadas sem ACK),
// (c) awaitingSettlement (expiradas sem settlement — reconciliar com broker),
// (d) settledLedger (IDs de settlements já processados — dedup idempotente).
function savePending() {
  const pendingFile = (P.state ?? './bot-state-v21.json').replace('.json', '-pending.json');
  const data = {
    ts: Date.now(),
    // P0-fix: schema completo — inclui key, record, assetId para startup restaurar
    inFlight: [...inFlight.values()].map((o) => ({
      okey: o.okey, key: o.key, assetId: o.assetId, name: o.name,
      direction: o.direction, role: o.role, cycleId: o.cycleId,
      stake: o.stake, expiration: o.expiration, requestId: o.requestId,
      sentAtMs: o.sentAtMs, applied: o.applied ?? false,
      awaitingSettlement: o.awaitingSettlement ?? false,
      unknownSettlement: o.unknownSettlement ?? false,
      orderId: o.orderId ?? null,
      record: o.record ?? null,
    })),
    pending: [...pending.entries()],
    pendingSet: [...pendingSet],
    awaitingSettlement: [...awaitingSettlement.values()].map((o) => ({
      okey: o.okey, key: o.key, assetId: o.assetId, name: o.name,
      direction: o.direction, role: o.role, cycleId: o.cycleId,
      stake: o.stake, expiration: o.expiration, requestId: o.requestId,
      sentAtMs: o.sentAtMs, orderId: o.orderId ?? null,
      applied: o.applied ?? false,
      unknownSettlement: o.unknownSettlement ?? false,
      record: o.record ?? null,
    })),
    // P0-fix: settledLedger — IDs de settlements já processados (dedup persistente)
    settledLedger: [...settledLedger.entries()],
  };
  // P0-fix: atomic write — tudo de uma vez, sem inconsistência entre inFlight e pending
  try {
    const tmp = pendingFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, pendingFile);
  } catch (e) { logLine(`[⚠️ savePending] ${e.message}`); }
}

// P0-fix: settledLedger — índice persistente de settlements já processados por brokerOrderId
// Evita que o mesmo settlement seja aplicado duas vezes após restart.
const settledLedger = new Map();

// P0-fix: carrega estado pendente do disco após restart
export function loadPending() {
  const pendingFile = (P.state ?? './bot-state-v21.json').replace('.json', '-pending.json');
  try {
    if (!fs.existsSync(pendingFile)) return { inFlight: [], pending: [], awaitingSettlement: [], settledLedger: [] };
    const raw = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    return {
      inFlight: Array.isArray(raw.inFlight) ? raw.inFlight : [],
      pending: Array.isArray(raw.pending) ? raw.pending : [],
      awaitingSettlement: Array.isArray(raw.awaitingSettlement) ? raw.awaitingSettlement : [],
      settledLedger: Array.isArray(raw.settledLedger) ? raw.settledLedger : [],
    };
  } catch (e) {
    logLine(`[⚠️ loadPending] Falha ao carregar ${pendingFile}: ${e.message}`);
    return { inFlight: [], pending: [], awaitingSettlement: [], settledLedger: [] };
  }
}

// ─── RECONCILIAÇÃO COM BROKER ──────────────────────────────────────────────────
async function reconcileWithBroker() {
  if (awaitingSettlement.size === 0) return;

  logLine(`[🔍 RECONCILIAÇÃO] ${awaitingSettlement.size} posição(s) expirada(s) sem settlement — consultando histórico do broker...`);

  let rawOptions;
  try {
    rawOptions = await ws.getOptions({ limit: 100, balanceId, instrumentType: "turbo,binary" });
  } catch (e) {
    logLine(`[⚠️ RECONCILIAÇÃO] Falha ao consultar broker: ${e.message}`);
    sessionLog(`RECONCILE_FAIL | ${e.message}`);
    return;
  }

  // P0-fix: adapta envelope — IQ pode retornar {open_options, closed_options} ou {msg: []}
  let options = [];
  if (Array.isArray(rawOptions)) {
    options = rawOptions;
  } else if (Array.isArray(rawOptions?.msg)) {
    options = rawOptions.msg;
  } else if (rawOptions?.msg && typeof rawOptions.msg === 'object') {
    // {open_options: [...], closed_options: [...]} ou similar
    const openOpts = rawOptions.msg.open_options ?? rawOptions.msg.open ?? [];
    const closedOpts = rawOptions.msg.closed_options ?? rawOptions.msg.closed ?? [];
    options = [...(Array.isArray(openOpts) ? openOpts : []), ...(Array.isArray(closedOpts) ? closedOpts : [])];
  } else {
    logLine(`[⚠️ RECONCILIAÇÃO] Resposta inválida do broker (tipo: ${typeof rawOptions})`);
    return;
  }

  if (!Array.isArray(options)) {
    logLine(`[⚠️ RECONCILIAÇÃO] Resposta inválida do broker (não é array)`);
    return;
  }

  let reconciled = 0;
  for (const [okey, op] of awaitingSettlement) {
    // P0-fix: dedup — se já processou esse settlement, pula
    const dedupKey = `${op.orderId ?? ''}|${op.requestId ?? ''}`;
    if (dedupKey && settledLedger.has(dedupKey)) {
      logLine(`[⚠️ RECONCILIAR] ${shortName(op.name)} okey=${okey} já processada (dedup ledger)`);
      continue;
    }

    // Casa pelo orderId (do broker) ou requestId (do bot)
    const brokerOpt = options.find((b) => {
      if (op.orderId && String(b.id) === String(op.orderId)) return true;
      if (op.requestId && String(b.request_id) === String(op.requestId)) return true;
      return false;
    });

    if (!brokerOpt) {
      const expiredMs = nowMs() - (op.expiration ?? op.createdAt ?? 0);
      const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min após expiração = confirmado fechado no broker
      if (expiredMs > STALE_THRESHOLD_MS) {
        // Ordem expirou há tempo suficiente mas não está no histórico do broker
        // (ex: bot ficou offline, ordem liquidou durante o downtime).
        // Fecha como unknown (conservador — não conta como loss) e remove da fila.
        logLine(`[⚠️ RECONCILIAR] ${shortName(op.name)} okey=${okey} expirou há ${Math.round(expiredMs/60000)}min — fechada como unknown (offline-stale)`);
        sessionLog(`RECONCILE_STALE | ${shortName(op.name)} | okey=${okey} | expired=${Math.round(expiredMs/60000)}min | orderId=${op.orderId}`);
        awaitingSettlement.delete(okey);
        if (dedupKey) settledLedger.set(dedupKey, nowMs());
        savePending();
        // applyResult com unknown/profit=null é seguro: não conta loss, não corrompe streak
        const s = state[op.key];
        if (!op.applied && s) applyResult(op, 'unknown', null);
        reconciled++;
        continue;
      }
      // Ainda dentro da janela — mantém para próxima reconciliação
      logLine(`[⚠️ RECONCILIAR] ${shortName(op.name)} okey=${okey} ainda em janela (${Math.round(expiredMs/60000)}min) — mantém na fila`);
      sessionLog(`RECONCILE_NOT_FOUND | ${shortName(op.name)} | okey=${okey} | orderId=${op.orderId}`);
      continue;
    }

    // P0-fix: normaliza ANTES de remover de awaitingSettlement
    const result = normalizeBrokerResult(brokerOpt);
    const profit = normalizeBrokerProfit(brokerOpt, op.stake);

    logLine(`[🔍 RECONCILIADO] ${shortName(op.name)} ${op.direction} → ${result.toUpperCase()} LP=${fmt(profit)} | okey=${okey}`);
    sessionLog(`RECONCILED | ${shortName(op.name)} | ${result.toUpperCase()} | LP=${fmt(profit)} | okey=${okey} | brokerId=${brokerOpt.id}`);

    // P0-fix: unknown mantém na fila — resultado final confirmado prossegue
    if (result === 'unknown') {
      // Mantém em awaitingSettlement para próxima reconciliação
      logLine(`[⚠️ RECONCILIAR] ${shortName(op.name)} okey=${okey} result=unknown — mantém na fila`);
      sessionLog(`RECONCILE_UNKNOWN | ${shortName(op.name)} | okey=${okey}`);
      continue;
    }

    // P0-fix: resultado FINAL confirmado — processa sem recolocar em inFlight
    // Registra no ledger para dedup
    if (dedupKey) settledLedger.set(dedupKey, nowMs());
    // Remove de awaitingSettlement (após normalização)
    awaitingSettlement.delete(okey);
    savePending();

    if (op.record) op.record.orderId = op.orderId;
    Object.assign(op.record ?? (op.record = {}), { result, profit, reconciled: true, settledAt: new Date().toISOString() });
    saveResults();

    const s = state[op.key];
    if (!op.applied && s) {
      // Ciclo ainda aberto — usa applyResult para accounting completo
      applyResult(op, result, profit);
      reconciled++;
    } else {
      // Ciclo já fechou (ex: Recovery entrou) — só registra resultado
      registerOutcome(profit, false);
      reconciled++;
    }
  }

  if (reconciled > 0) {
    savePending();
    renderDashboard();
  }
  logLine(`[🔍 RECONCILIAÇÃO] ${reconciled}/${awaitingSettlement.size + reconciled} posições reconciliadas`);
}

export function normalizeBrokerResult(opt) {
  // win / loss / draw / unknown
  // P0-fix: só aceita resultado FINAL confirmado. Intermediários = unknown.
  if (!opt) return 'unknown';
  const status = String(opt.status ?? '').toLowerCase();
  const win = String(opt.win ?? '').toLowerCase();
  // Fonte principal no histórico real da IQ (closed_options não traz `status`)
  if (win === 'win') return 'win';
  if (win === 'loose' || win === 'loss') return 'loss';
  if (win === 'equal' || win === 'draw') return 'draw';
  const FINAL_STATUSES = ['closed', 'settled', 'expired'];
  const INTERMEDIATE_STATUSES = ['open', 'pending', 'active', 'sell_open', 'rejected', 'cancelled'];
  if (FINAL_STATUSES.includes(status)) {
    // P0-fix: usa SOMENTE profit (realizado) — NUNCA expected_profit como lucro realizado
    const p = Number(opt.profit ?? 0);
    if (Number.isFinite(p) && p !== 0) return p > 0 ? 'win' : 'loss';
    return 'draw';
  }
  if (INTERMEDIATE_STATUSES.includes(status)) return 'unknown';
  return 'unknown';
}

export function normalizeBrokerProfit(opt, stake) {
  // P0-fix: usa SOMENTE valor realizado. expected_profit é projeção, não realized.
  const p = Number(opt.profit ?? NaN);
  if (Number.isFinite(p) && p !== 0) return round2(p);
  // Histórico da IQ: win_amount − sum (win) / −sum (loss) / 0 (equal)
  const win = String(opt.win ?? '').toLowerCase();
  const invested = Number(opt.sum ?? opt.amount ?? stake ?? NaN);
  if (win === 'win' || win === 'loose' || win === 'loss') {
    const payout = Number(opt.win_amount ?? NaN);
    if (win === 'win' && Number.isFinite(payout) && Number.isFinite(invested)) return round2(payout - invested);
    return Number.isFinite(invested) ? round2(-invested) : null;
  }
  if (win === 'equal' || win === 'draw') return 0;
  if (Number.isFinite(p)) return round2(p); // profit === 0 explícito
  return null;
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
    logLine(`[🧬] CÓDIGO ${CODE_REV} sha256:${CODE_HASH} | stake ${currencySymbol}${BASE_STAKE.toFixed(2)} | Cash TP=${fmt(CASH_TP)} | Recovery OFF | expiração ${EXPIRATION_MIN}min`);
    logLine(`[📤] CASH + RUNNER: cada sinal abre 2 posições iguais | CASH: vende quando LP>=${fmt(CASH_TP)} (sell_profit real) | RUNNER: vai até expiração`);
    logLine(`[RECOVERY] Desativada para avaliar entrada sem martingale.`);
    logLine(`[ENTRADA] Contexto 30m + tendência recente 1m/5s + DI + zona confirmada + retomada RSI/preço | prazo 240–300s`);
    logLine(`[⚠️] DEMO/PRACTICE APENAS — nenhuma operação REAL durante os testes`);

    const actives = await fetchActives();
    applyUniverse(actives, 'boot', { subscribe: false });

    // ── BOOTSTRAP: carrega histórico para TODOS os ativos antes de assinar live ──
    const tHist = Date.now();
    let ready = 0, notReady = 0;

    const bootstrapPromises = [];
    for (const aid of running.keys()) {
      bootstrapPromises.push((async () => {
        const result = await bootstrapAsset(aid);
        if (result.ok) ready++;
        else notReady++;
        const row = running.get(aid);
        if (row) row.lastCandleAt = 0;
      })());
      // processar em chunks para não sobrecarregar a API da IQ
      if (bootstrapPromises.length >= BOOTSTRAP_CHUNK) {
        await Promise.all(bootstrapPromises.splice(0, BOOTSTRAP_CHUNK));
      }
    }
    await Promise.all(bootstrapPromises);
    const elapsed = ((Date.now() - tHist) / 1000).toFixed(1);

    // Log de bootstrap por ativo pronto
    for (const [aid, row] of running) {
      if (row.bootstrapStatus === 'READY') {
        const b5 = buf5s.get(aid)?.ticks.length ?? 0;
        const b1 = buf1m.get(aid)?.ticks.length ?? 0;
        const r15m = getRegimeForAsset(aid);
        const diag = `5s=${b5} 1m=${b1} context30m=${r15m.direction}(${r15m.spreadPct?.toFixed(3) ?? 'n/a'})[${r15m.source}]`;
        logLine(`  [✅ ${shortName(row.name)}] HIST=${HIST_WARMUP_MIN_MINUTES}m+ | ${diag}`);
      } else if (row.bootstrapStatus === 'DATA_NOT_READY') {
        logLine(`  [⚠️ ${shortName(row.name)}] DATA_NOT_READY | ${row.bootstrapFailReason ?? 'unknown'}`);
      }
    }
    logLine(`[🔁] bootstrap: ${ready}/${running.size} READY | ${notReady} aguardando/dados incompletos | ${elapsed}s`);

    // ── P0-FIX: Restauração de estado após reinício ──────────────────────────────
    const recovered = loadPending();
    // P0-fix: restoreds ledger de settlements já processados (dedup)
    if (recovered.settledLedger && recovered.settledLedger.length > 0) {
      for (const [key, ts] of recovered.settledLedger) {
        settledLedger.set(key, ts);
      }
    }
    if (recovered.inFlight && recovered.inFlight.length > 0) {
      logLine(`[🔄] RESTAURANDO ${recovered.inFlight.length} posição(s) aberta(s) do arquivo pending...`);
      for (const opData of recovered.inFlight) {
        if (!opData.key || !opData.okey) continue;
        // P0-fix: reconstrói op com todos os campos restaurados
        const op = {
          okey: opData.okey,
          key: opData.key,
          assetId: opData.assetId,
          name: opData.name,
          direction: opData.direction,
          role: opData.role,
          cycleId: opData.cycleId,
          stake: opData.stake,
          expiration: opData.expiration,
          requestId: opData.requestId,
          sentAtMs: opData.sentAtMs,
          applied: opData.applied ?? false,
          awaitingSettlement: opData.awaitingSettlement ?? false,
          unknownSettlement: opData.unknownSettlement ?? false,
          orderId: opData.orderId ?? null,
          record: opData.record ?? null,
        };
        inFlight.set(op.okey, op);
        // Se a op já expirou, o stale-op guard vai tratá-la abaixo
      }
    }
    // Ops que estavam pendentes (enviadas mas não-ACkadas) são recarregadas como pending
    // P0-fix: também restaura ordersByRequestId para que o ACK futuro ainda possa encontrar
    if (recovered.pending && recovered.pending.length > 0) {
      logLine(`[⏳] RESTAURANDO ${recovered.pending.length} ordem(ns) pendente(s) de ACK...`);
      for (const [okey, info] of recovered.pending) {
        pending.set(okey, info);
        pendingSet.add(okey);
      }
      // Audit fix: reservas antigas (processo morto antes do ACK) não podem travar a exposição
      prunePendingStale();
    }
    // Ops que expiraram sem settlement — restaurar para reconciliação com broker
    if (recovered.awaitingSettlement && recovered.awaitingSettlement.length > 0) {
      logLine(`[🔍] RESTAURANDO ${recovered.awaitingSettlement.length} posição(s) expirada(s) sem settlement...`);
      for (const opData of recovered.awaitingSettlement) {
        if (!opData.okey) continue;
        // P0-fix: reconstrói op com record
        const op = {
          okey: opData.okey,
          key: opData.key,
          assetId: opData.assetId,
          name: opData.name,
          direction: opData.direction,
          role: opData.role,
          cycleId: opData.cycleId,
          stake: opData.stake,
          expiration: opData.expiration,
          requestId: opData.requestId,
          sentAtMs: opData.sentAtMs,
          orderId: opData.orderId ?? null,
          applied: opData.applied ?? false,
          unknownSettlement: opData.unknownSettlement ?? false,
          record: opData.record ?? null,
        };
        awaitingSettlement.set(op.okey, op);
      }
    }
    // Reconcilia com histórico do broker — busca resultado real das ops expiradas
    await reconcileWithBroker();

    for (const aid of running.keys()) {
      ws.subscribeCandles(aid, num(S.candleSizeSeconds, 5));
      ws.subscribeCandles(aid, 60);
    }
    await new Promise((r) => setTimeout(r, num(S.warmupMs, 1_500)));
    warmupDone = true;
    startedAt = nowMs();

    logLine(`[CONTEXTO] 30 minutos móveis, atualização em cada decisão; bootstrap 360 candles 5s e 60 candles 1m.`);
    startSessionLog();
    startAnalyseLog();
    logLine(`[✅] OPERANDO ${CODE_REV} — Cash/Runner | recuperação DESATIVADA | painel abaixo`);
    renderDashboard();

    // Diagnóstico: mostra RSI e skip reasons a cada 60s
    setInterval(() => {
      if (!warmupDone || shuttingDown) return;
      const skipCount = {};
      const samples = [];
      for (const aid of running.keys()) {
        const row = running.get(aid);
        if (row?.bootstrapStatus !== 'READY') continue;
        const b5 = buf5s.get(aid);
        if (!b5) continue;
        const s = state[b5.key];
        const open = opsFor(aid);
        const rsi = calcRSI(b5.ticks);
        const adx = calcADX(b5.ticks);

        // Bloqueios extras do diagnóstico (avaliados antes de evaluateEntry)
        if (open.length > 0) { skipCount['posicaoAberta'] = (skipCount['posicaoAberta'] || 0) + 1; continue; }

        // Chama evaluateEntry DIRETAMENTE — não replica a lógica manualmente
        const decision = evaluateEntry({ ticks: b5.ticks, open, rsi, adx, regime15m: getRegimeForAsset(aid) });
        const skip = decision.skip;
        if (skip) {
          skipCount[skip] = (skipCount[skip] || 0) + 1;
        } else {
          // Mostra os que teriam entrado
          const regime = s?.regime15m?.direction ?? '?';
          const prevRsi = calcRSI(b5.ticks.slice(-15, -1));
          if (samples.length < 8) {
            samples.push(`${shortName(row.name)} rsi=${rsi.toFixed(1)} prevRsi=${prevRsi.toFixed(1)} adx=${adx.toFixed(0)} regime=${regime} ✅`);
          }
        }
      }
      const topSkips = Object.entries(skipCount).sort((x, y) => y[1] - x[1]).slice(0, 4)
        .map(([k, v]) => `${k}=${v}`).join(' | ');
      logLine(`[🔍 DIAG] ${running.size} ativos ready | skips: ${topSkips || 'nenhum'}`);
      if (samples.length) logLine(`[🔍 DIAG] amostra: ${samples.join(' | ')}`);
    }, 60_000);

    setInterval(() => { if (!shuttingDown) renderDashboard(); }, 1_000);
    // Scan de entradas
    setInterval(() => { if (shuttingDown || !warmupDone) return; for (const aid of running.keys()) maybeTrade(aid); }, ENTRY_SCAN_MS);
    // Monitor de posições abertas (5s — Cash sell + Recovery trigger)
    setInterval(() => { void evaluateOpenPositions(); }, 5_000);
    // Rebalanceamento de universo
    setInterval(() => { void rebalanceUniverse(); }, UNIVERSE_CHECK_MS);
    // P0-fix: reconciliação periódica — tenta resolver ops pendentes a cada 60s
    // Não conflita com reconciliação do startup (a do boot é imediata).
    // Audit fix: junto, descarta reservas de ACK vencidas (não podem travar exposição).
    setInterval(() => { if (shuttingDown || !warmupDone) return; prunePendingStale(); void reconcileWithBroker(); }, 60_000);
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
    const orderId = raw?.id ?? raw?.option_id ?? null;
    const aid = Number(raw?.active_id ?? raw?.activeId);
    const serverReqId = raw?.request_id ?? msg?.request_id ?? null;
    const serverExp = Number(raw?.expiration ?? raw?.expired ?? raw?.expiration_time ?? raw?.exp_time ?? null);
    const stake = stakeFromAmount(raw?.amount ?? raw?.invest);
    // (a) eco exato do request_id — quando a IQ mandar
    let op = opByOrderId(orderId) ?? (serverReqId ? findOp({ requestId: serverReqId }) : null);
    // (b) correlação por posição — o caminho real (a IQ não ecoa request_id)
    if (!op) op = candidateOps({ aid, stake, expirationSec: Number.isFinite(serverExp) && serverExp > 0 ? serverExp : null, freshMs: 60_000 })[0] ?? null;
    if (!op) { logLine(`[⚠️ ABERTURA SEM ORDEM] reqId=${serverReqId} ordId=${orderId} exp=${serverExp} aid=${aid}`); return; }
    // O ACK NÃO contabiliza nada — só vincula o orderId. O settlement chega em
    // socket-option-closed e é ele que chama applyResult (audit fix).
    attachOrderId(op, orderId, 'socket-option-opened');
  });

  ws.on('sell-equal', async (msg) => {
    const raw = msg?.msg ?? msg;
    const positionId = Number(raw?.id ?? raw?.position_id ?? raw?.option_id);
    const aid = Number(raw?.active_id ?? raw?.activeId);
    const op = findOp({ aid, orderId: positionId });
    if (!op) {
      const recent = [...settledRecently.values()].some((at) => nowMs() - at < 60_000);
      if (!recent) {
        logLine(`[❓ SELL_EQUAL SEM ORDEM] aid=${aid} posId=${positionId} — op não encontrada`);
        sessionLog(`RECONCILE_SELL_EQUAL | aid=${aid} | posId=${positionId}`);
      }
      return;
    }
    finalizeEarly(op, pickCloseReturn(raw) ?? op.sellQuote, 'sell_equal');
  });

  ws.on('socket-option-closed', async (msg) => {
    const raw  = msg?.msg ?? msg;
    const aid  = Number(raw?.active_id ?? raw?.activeId);
    const orderId = raw?.id ?? raw?.position_id ?? raw?.option_id ?? null;
    const serverExp = Number(raw?.expiration ?? raw?.expired ?? raw?.exp_time ?? null);
    const dirRaw = raw?.dir ?? raw?.direction ?? null;
    let op = findOp({ aid, orderId, requestId: raw?.request_id ?? msg?.request_id ?? null });
    // Audit fix: ACK perdido? casa pelo ativo + vencimento + direção (as pernas do ciclo
    // são fungíveis) para o settlement nunca ser descartado.
    if (!op) op = candidateOps({ aid, direction: dirRaw, expirationSec: Number.isFinite(serverExp) && serverExp > 0 ? serverExp : null })[0] ?? null;
    if (!op) {
      const recent = [...settledRecently.values()].some((at) => nowMs() - at < 60_000);
      if (!recent) {
        const reqId = raw?.request_id ?? msg?.request_id ?? null;
        const win   = raw?.win ?? raw?.status ?? raw?.result ?? '?';
        logLine(`[❓ RECONCILIAR] aid=${aid} exp=${serverExp} reqId=${reqId} ordId=${orderId} win=${win} — nenhuma op em inFlight`);
        sessionLog(`RECONCILE_NO_OP | aid=${aid} | exp=${serverExp} | reqId=${reqId} | ordId=${orderId} | win=${win}`);
      }
      return;
    }
    // P0-fix: se já processada, ignora
    if (op.applied) return;

    const now = nowMs();
    const earlyByUs = op.sellRequestedAt && (op.expiration * 1000 - now) > 5_000;
    if (earlyByUs) {
      const rawReturn = pickCloseReturn(raw);
      const devolve = Number.isFinite(rawReturn) ? rawReturn : op.sellQuote;
      finalizeEarly(op, devolve, Number.isFinite(rawReturn) ? 'close_sell_return' : 'sell_quote');
      return;
    }

    const { result, profit } = parseSettlement(raw, op);

    // Remove de todas as estruturas de exposição
    inFlight.delete(op.okey);
    pendingSet.delete(op.okey);
    pending.delete(op.okey);
    settledRecently.set(op.okey, now);
    op.settled = true;
    if (op.record) op.record.orderId = op.orderId;

    // P0-fix: unknown = broker não confirmou resultado FINAL.
    // Mantém em awaitingSettlement para reconciliação posterior — não descarta.
    if (result === 'unknown') {
      op.unknownSettlement = true;
      awaitingSettlement.set(op.okey, op);   // P0-fix: restaura na fila de reconciliação
      savePending();                          // P0-fix: persiste antes de sair
      Object.assign(op.record ?? (op.record = {}), { result, settledAt: new Date().toISOString() });
      saveResults();
      logLine(`[⚠️ RECONCILIAR] ${shortName(op.name)} ${op.direction} settlement=unknown — aguardando confirmação | cyc=${op.cycleId} okey=${op.okey}`);
      sessionLog(`SETTLEMENT_UNKNOWN | ${shortName(op.name)} | ${op.direction} | ${(op.role ?? '?').toUpperCase()} | cyc=${op.cycleId} | okey=${op.okey}`);
      renderDashboard();
      return;
    }

    // P0-fix: resultado FINAL confirmado — atualiza ledger e stats UMA vez via applyResult.
    // Removida chamada redundante de registerOutcome aqui (applyResult já chama).
    Object.assign(op.record ?? (op.record = {}), { result, profit, settledAt: new Date().toISOString() });
    saveResults();
    applyResult(op, result, profit);
    await refreshBalance();
    renderDashboard();
    const emoji = result === 'win' ? '✅' : result === 'loss' ? '❌' : '➖';
    logLine(`[${emoji}] ${shortName(op.name)} ${op.direction} ${(op.role ?? '?').toUpperCase()} ${result.toUpperCase()} ${fmt(profit)} | cyc=${op.cycleId}`);
    sessionLog(`SETTLEMENT | ${shortName(op.name)} | ${op.direction} | ${(op.role ?? '?').toUpperCase()} | ${result.toUpperCase()} | LP=${fmt(profit)} | cyc=${op.cycleId}`);
  });

  ws.on('close', () => {
    if (shuttingDown) return;
    logLine('\n[WS] Conexão fechada — tentando reconectar...');
    let attempt = 1;
    const maxAttempts = 5;
    const tryReconnect = async () => {
      if (shuttingDown) return;
      try {
        await ws.connect({ ssid });
        logLine(`[WS] Reconectado (tentativa ${attempt})`);
        // Não re-aplica universo — o ws já tem o state interno dos ativos
        // Mas forçamos re-subscribe dos ativos correntes
        for (const [aid] of running) {
          ws.subscribeCandles(aid, num(S.candleSizeSeconds, 5));
          ws.subscribeCandles(aid, 60);
        }
      } catch (err) {
        if (shuttingDown) return;
        const delay = Math.min(5000 * Math.pow(1.5, attempt - 1), 60_000);
        logLine(`[WS] Reconexão falhou (${attempt}/${maxAttempts}) em ${delay}ms: ${String(err).slice(0, 80)}`);
        if (attempt < maxAttempts) {
          attempt++;
          setTimeout(tryReconnect, delay);
        } else {
          logLine('[WS] Máximo de tentativas de reconexão atingido. Encerrando.');
          shutdown('WS_RECONNECT_FAILED');
        }
      }
    };
    setTimeout(tryReconnect, 2000);
  });
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await ws.connect({ ssid });
}

function summary() {
  const cs = cycleStats;
  logLine('\n🛑 RESULTADO V22 FINAL:\n');
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
