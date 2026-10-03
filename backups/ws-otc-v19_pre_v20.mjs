/**
 * OTC BOT v18 — REGIME DE HORAS + ENTRADA POR RSI 30/70 + SIMULTANEIDADE
 * =============================================================================
 *  node ws-otc-v18.mjs demo           → opera na conta DEMO
 *  node ws-otc-v18.mjs real           → opera na conta REAL (mesmas regras)
 *  node ws-otc-v18.mjs                → pergunta a conta (1=REAL, 2=DEMO)
 *  node ws-otc-v18.mjs demo --ativos   → lista os ativos turbo disponíveis
 *
 *  ENTRADA V18 (regra do dono, 2026-10-02):
 *    1) REGIME DE HORAS: EMA8×21 sobre as velas de 1 MINUTO (hidratação de 240 velas
 *       = 4h no boot). Alta → só CALL; baixa → só PUT; lateral → não entra.
 *    2) GATILHO ÚNICO: RSI(14) nas velas de 5s CRUZANDO para dentro da zona —
 *       ≤ 30 no regime de alta (CALL) ou ≥ 70 no regime de baixa (PUT). Cruzou =
 *       um tiro (sem rajada dentro da zona).
 *    3) SUSTENTÁCULO ("já desceu muito"): preço a ≤ 1,5× candle típico do FUNDO
 *       das últimas 60 velas 5s (CALL) ou do TOPO (PUT). Impede comprar tarde.
 *    O regime 1m é quem separa "suporte pra continuar" de "reversão": 1m virado
 *    contra a direção = não entra. Os gates da V17 (fade4 4+1, ADX≥20, RSI
 *    guarda-corpo 55/45, regime de 20 velas 5s) SAEM da entrada nova — medidos em
 *    9360 janelas reais renderam 1 sinal (morto) e eram eles que mantinham o bot
 *    com 1-2 ordens simultâneas. Alvo: ≥5 ordens simultâneas (ideal 10).
 *  MANTIDOS INTACTOS (decisões do dono): ciclo de 3 ordens por ativo (entrada +
 *    pirâmide + MARTINGALE 2,75× a exposição, um por ciclo), pirâmide SÓ com
 *    ADX ≥ 25 e RSI extremo a favor (CALL ≤ 35 / PUT ≥ 65), venda SÓ com
 *    confirmação de reversão (a mercado), stake FIXO 2, teto de exposição 50% do
 *    saldo, trava de perda da sessão 20%, nunca CALL e PUT no mesmo ativo.
 *  UNIVERSO: TODOS os OTC disponíveis (minActive 500 / maxActive 1000), scan
 *    paralelo de entradas a cada 5s em todos os ativos.
 *  VENDA: SÓ com CONFIRMAÇÃO DE REVERSÃO contra a posição (regra do dono,
 *    2026-10-02): a venda é A MERCADO — a IQ só manda `sell_profit` no
 *    abrir/fechar; o valor real da recompra é lido no fechamento.
 *  PAINEL: uma linha só, estilo odômetro. LOG: uma linha por ordem/resultado.
 *  IQ_SELL_DEBUG=1 liga o dump cru da IQ nas janelas de venda.
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

const CONFIG = JSON.parse(fs.readFileSync(new URL('./bot-config-v18.json', import.meta.url), 'utf8'));
const C  = CONFIG.trading ?? {};
const S  = CONFIG.strategy ?? {};
const M  = CONFIG.martingale ?? {};
const R  = CONFIG.risk ?? {};
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
// MARTINGALE (regra do dono, 2026-10-02): a TERCEIRA ordem do ciclo e o martingale e ele e
// a UNICA capaz de operar acima do stake fixo. Valor = multiplicador x o que esta sendo
// recuperado (a soma das posicoes vendidas por reversao). Um por ciclo: perdeu, volta a base.
const MARTINGALE_MULT   = num(M.martingaleMultiplier, 2.75);
const MAX_STAKE         = num(R.maxStake, 20);
// PIRAMIDAGEM: a 2a posicao no mesmo ativo/sentido so sai na chance QUASE PERFEITA — ADX com
// forca de verdade + RSI no extremo A FAVOR (nao e "nao estar esticado": e estar esticado do
// lado oposto) + a reversao nao pode estar se formando contra a posicao. Fora disso, 1 compra.
const PYRAMID_MAX           = Math.max(0, Math.round(num(S.pyramidMax, 1)));
const PYRAMID_ADX_MIN       = num(S.pyramidAdxMin, 25);
const PYRAMID_RSI_CALL_MAX  = num(S.pyramidRsiCallMax, 35);
const PYRAMID_RSI_PUT_MIN   = num(S.pyramidRsiPutMin, 65);
const MAX_EXPOSURE_PCT  = num(R.maxExposurePct, 50);
const SESSION_LOSS_PCT  = num(R.maxSessionLossPct, 20);
const PAUSE_AFTER_MS    = num(M.pauseAfterLadderMs, 600_000);
// Flip de direção DESATIVADO (V16): martingale SEM inverter — após loss, aposta no
// MESMO sentido (a tendência é a favor, o preço vai voltar). Reset em qualquer win.
const COOLDOWN_WIN_MS    = 0;   // re-entrada na próxima candle (sem esperar)
const COOLDOWN_LOSS_MS   = 5000;
const TREND_LOOKBACK    = Math.max(21, Math.round(num(S.trendLookback, 40)));
const TREND_MIN_SPREAD  = num(S.trendMinEmaSpreadPct, 0.05);

// V18 — ENTRADA NOVA (regra do dono, 2026-10-02): regime de HORAS pelas velas 1m e
// gatilho único: RSI(5s) CRUZANDO 30 (regime de alta → CALL) ou 70 (regime de baixa →
// PUT), com o preço encostado no fundo/topo do range recente ("já desceu muito").
// Os gates V17 (fade4, ADX mínimo, RSI guarda-corpo, regime 5s) saem da entrada nova:
// medidos em 9360 janelas reais = 1 sinal (morto) — eram eles que travavam a
// simultaneidade. Pirâmide, martingale, venda, ciclo de 3 ordens e limites intactos.
const ENTRY_MODE           = String(S.entryMode ?? 'pullback');
const REGIME_1M_MIN_CAND   = Math.max(30, Math.round(num(S.regime1mMinCandles, 120)));
const REGIME_1M_MIN_SPREAD = num(S.regime1mMinEmaSpreadPct, 0.05);
const RSI_TOUCH_CALL       = num(S.rsiTouchCall, 30);
const RSI_TOUCH_PUT        = num(S.rsiTouchPut, 70);
const SUPPORT_LOOKBACK     = Math.max(10, Math.round(num(S.supportLookback, 60)));
const SUPPORT_ATR_FACTOR   = num(S.supportAtrFactor, 1.5);
const BOOT_1M_CANDLES      = Math.max(30, Math.round(num(S.boot1mCandles, 240)));

// Venda (v16): A MERCADO com CONFIRMAÇÃO DE REVERSÃO contra a posição (regra do dono,
// 2026-10-02). A IQ só manda `sell_profit` (devolução da recompra) no abrir/fechar —
// não existe cotação de meio de vida (medido em 2026-10-02) — o valor real da
// recompra é lido no fechamento (`finalizeEarly`).
const CLOSE_BEFORE_MS  = num(SE.closeBeforeMs, 20_000);
const VOL_LOOKBACK     = Math.max(5, Math.round(num(SE.volLookbackCandles, 12)));
const REV              = SE.reversal ?? {};
const REV_CANDLES      = Math.max(2, Math.round(num(REV.candles, 3)));
const REV_CANDLES_MIN  = Math.min(REV_CANDLES, Math.max(1, Math.round(num(REV.candlesAgainstMin, 2))));
const REV_RSI_CALL_MAX = num(REV.rsiCallMax, 45);
const REV_RSI_PUT_MIN  = num(REV.rsiPutMin, 55);
const REV_ADV_FACTOR   = num(REV.minAdverseFactor, 1);
const REV_ADV_MIN_PCT  = num(REV.minAdversePct, 0.02);
const SELL_RETRY_MS    = num(SE.retryAfterMs, 8_000);
const SELL_MAX_ATTEMPTS = Math.max(1, Math.round(num(SE.maxAttempts, 4)));

// Early Gale Monitor: avalia cada operação aberta a cada 1 segundo.
// Se a posição está perdendo acima do limiar dentro da janela,
// abre o gale ANTES da operação fechar — mais eficiente que esperar o loss.
// Sem early gale: só abre gale quando a operação anterior fechou loss.
const EG = SE.earlyGale ?? {};
const EARLY_GALE_ENABLED     = EG.enabled !== false;           // default true
const EARLY_GALE_MIN_MS     = Math.max(5_000, EG.minMs ?? 15_000);   // não avalia antes de 15s
const EARLY_GALE_MAX_MS     = Math.max(EG.minMs ?? 15_000, EG.maxMs ?? 90_000); // janela máxima
const EARLY_GALE_LOSS_THRESHOLD = Math.round((EG.lossThreshold ?? 0.80) * 100) / 100; // sell_profit <= -R$0.80

// Universo dinâmico (v15)
const MIN_ACTIVE        = Math.max(1, Math.round(num(UN.minActive, 50)));
const MAX_ACTIVE        = Math.max(MIN_ACTIVE, Math.round(num(UN.maxActive, 50)));
const REPLACE_STALE_MS  = num(UN.replaceStaleMs, 180_000);
const UNIVERSE_CHECK_MS = num(UN.checkEveryMs, 60_000);  // 1 min (era 5 min)
const ENTRY_SCAN_MS     = num(UN.entryScanEveryMs ?? 5_000, 5_000);  // V17 — varredura de entradas no universo (5s)

if (!(PAYOUT > 0 && PAYOUT < 1)) {
  console.error(`[FATAL] martingale.payoutRate inválido: ${PAYOUT}`);
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
// Preferência do painel (bot-preference.json) sobrepõe o saved do credentials
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
  : null; // sem credencial → modo interativo
const LIST_ASSETS = process.argv.includes('--ativos');

// Impressão digital do código que está de fato rodando (o bot não recarrega sozinho).
const CODE_REV = 'V19';
const CODE_HASH = (() => {
  try { return createHash('sha256').update(fs.readFileSync(new URL(import.meta.url), 'utf8')).digest('hex').slice(0, 8); }
  catch { return '????????'; }
})();

// ─── FUNÇÕES PURAS ────────────────────────────────────────────────────────────
const round2 = (v) => Math.round(v * 100) / 100;

// Valor do MARTINGALE (regra do dono, 2026-10-02): a UNICA ordem que passa do stake fixo.
// `recoverBase` = soma das posições que a venda por reversão acabou de fechar — 2 posições
// de 2,00 dão 4,00 → martingale de 2,75 x 4,00 = US$11,00 (recupera as duas com lucro).
export function martingaleStake(recoverBase) {
  const base = Number(recoverBase);
  if (!Number.isFinite(base) || base <= 0) return 0;
  return round2(MARTINGALE_MULT * base);
}

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

// High/low do candle: a IQ manda `max`/`min` (o fechamento vem em `close`).
// Sem eles o ADX zera (DMI sem range) e bloqueia TODA entrada — bug de 2026-10-02.
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

// Valor DEVOLVIDO pela IQ quando a posição fecha por venda antecipada: `sell_profit`
// (= win_amount no extrato) é quanto entra de VOLTA na conta. NÃO é lucro — o
// resultado líquido da venda é devolução − stake (ver `saleNet`).
export function pickCloseReturn(raw) {
  for (const field of ['sell_profit', 'profit_amount']) {
    const value = raw?.[field];
    if (value === undefined || value === null) continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Resultado LÍQUIDO de uma venda antecipada: devolução − stake. Medido ao vivo em
// 2026-10-02 (a IQ confirma no próprio extrato): devolução < stake = `loose` (perda),
// = stake = `equal`; um win real devolve 3,64 para stake 2,00 (+1,64 líquido).
export function saleNet(returned, stake) {
  const r = Number.isFinite(returned) ? returned : 0;
  const s = Number.isFinite(stake) ? stake : 0;
  return round2(r - s);
}

// Só entrega candle FECHADO (a IQ reenvia a vela em formação a cada tick).
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
    const bar = {
      atMs: this.formingAt, close: this.formingClose,
      high: this.formingHigh ?? this.formingClose, low: this.formingLow ?? this.formingClose,
    };
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
let startedAt = 0;  // timestamp em ms quando o bot iniciou
let closedCandles = 0; // candles 5s fechados (painel)
let sessionStopLogged = false;
let sessionStartBalance = 0; // saldo no boot desta sessão — referência para a trava de perda
let rawDumpUntil = 0;                // janela do dump cru da IQ (IQ_SELL_DEBUG=1); abre em requestSell
const stats = { settled: 0, wins: 0, losses: 0, draws: 0, early: 0, earlyPos: 0, earlyNeg: 0, profit: 0 };

// ─── LOG DE SESSÃO (historico/) ────────────────────────────────────────────────
const HISTORICO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'historico');
let sessionLogFile = null;
let sessionLogStream = null;

function ensureHistoricoDir() {
  try {
    if (!fs.existsSync(HISTORICO_DIR)) {
      fs.mkdirSync(HISTORICO_DIR, { recursive: true });
    }
  } catch {}
}

function startSessionLog() {
  ensureHistoricoDir();
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(-2)}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const fileName = `OP_${dateStr}_${timeStr}.log`;
  sessionLogFile = path.join(HISTORICO_DIR, fileName);
  try {
    const header = `═══════════════════════════════════════════════════════════════\n`;
    const title = `  SESSÃO INICIADA: ${dateStr} às ${timeStr}\n`;
    const info = `  Bot: ${CODE_REV} | Conta: ${accountType} | Saldo inicial: ${currencySymbol}${initialBalance.toFixed(2)}\n`;
    const config = `  Stake: ${currencySymbol}${BASE_STAKE} | Expiração: ${EXPIRATION_MIN}min | Max ativos: ${MAX_ACTIVE}\n`;
    const end = `═══════════════════════════════════════════════════════════════\n\n`;
    fs.writeFileSync(sessionLogFile, header + title + info + config + end);
    sessionLogStream = fs.createWriteStream(sessionLogFile, { flags: 'a' });
    console.log(`[📁] Log de sessão: ${sessionLogFile}`);
  } catch (e) {
    console.error(`[📁] Erro ao criar log de sessão:`, e.message);
    sessionLogStream = null;
  }
}

function sessionLog(text) {
  if (!sessionLogStream) return;
  try {
    const ts = new Date().toISOString().substring(11, 23);
    sessionLogStream.write(`[${ts}] ${text}\n`);
  } catch {}
}

function endSessionLog(summary) {
  if (!sessionLogStream) return;
  try {
    const footer = `\n═══════════════════════════════════════════════════════════════\n`;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const end = `  SESSÃO ENCERRADA: ${timeStr} | Duração: ${elapsedTime()}\n`;
    const result = `  Total ops: ${stats.settled} | Wins: ${stats.wins} | Losses: ${stats.losses} | WR: ${stats.settled ? (stats.wins / stats.settled * 100).toFixed(1) : 0}%\n`;
    const profit = `  Lucro: ${fmt(stats.profit)} | Saldo final: ${currencySymbol}${currentBalance.toFixed(2)}\n`;
    if (summary) {
      sessionLogStream.write(`\n${footer}${end}${result}${profit}`);
    }
    sessionLogStream.write(`${footer}\n`);
    sessionLogStream.end();
    sessionLogStream = null;
  } catch {}
}

const nowMs = () => ws?.serverNow() ?? Date.now();
const sessionLossLimit = () => (sessionStartBalance > 0 ? round2(sessionStartBalance * SESSION_LOSS_PCT / 100) : Infinity);
const exposureLimit = () => (currentBalance > 0 ? round2(currentBalance * MAX_EXPOSURE_PCT / 100) : 0);
const shortName = (name) => String(name ?? '').replace('front.', '').replace('-OTC', '');
const symbolOf = (currency) => (currency === 'USD' ? 'US$' : currency === 'BRL' ? 'R$' : currency || 'R$');
const fmt = (value) => `${value >= 0 ? '+' : '-'}${currencySymbol}${Math.abs(value).toFixed(2)}`;
const saveState = () => { try { fs.writeFileSync(P.state, JSON.stringify(state, null, 2)); } catch {} };
const saveResults = () => { try { fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2)); } catch {} };
const mmss = (ms) => { const total = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; };
const elapsedTime = () => mmss(startedAt ? (ws?.serverNow() ?? Date.now()) - startedAt : 0);

// ─── PAINEL (uma linha, odômetro; nada de listas) ────────────────────────────
// LIVE removido (write-only, nunca era lido)
function dashboardText() {
  const wr = stats.settled ? (stats.wins / stats.settled * 100).toFixed(1) : '0.0';
  const exposed = openStake();
  return `[⏱${elapsedTime()}] [🕯️${closedCandles}] [📊${stats.settled}] [✅${stats.wins}] [❌${stats.losses}] [WR ${wr}%] [💰${fmt(stats.profit)}] [⏳${currencySymbol}${exposed.toFixed(2)}]`;
}
function renderDashboard() {
  // Abordagem simples e portátil: \r volta ao início da linha, escreve,
  // e espaços em branco garantem que conteúdo antigo seja sobrescrito.
  const line = dashboardText();
  process.stdout.write(`\r${line}${' '.repeat(Math.max(0, 120 - line.length))}\r`);
}
function logLine(text) {
  console.log(text);
  sessionLog(text);
  renderDashboard();
}

/* [TELEMETRIA:BEGIN] */
// ─── TELEMETRIA DO PAINEL via WebSocket ─────────────────────────────────────
// O painel é uma CABINE: ele só LÊ o estado que já existe aqui dentro.
// Conexão WebSocket com o painel: empurra telemetria em tempo real.
// Comandos vindos do painel: stop, account_switch, login.
//
const PANEL_WS_URL  = process.env.PANEL_WS_URL  || 'ws://localhost:8080';
const PANEL_SECRET   = process.env.PANEL_SECRET   || 'painel-local';
const TELEMETRY_MS  = 1_000; // intervalo de envio ao painel

function installPanelWebSocket() {
  let ws = null;
  let connected = false;
  let reconnectTimer = null;
  let publishTimer  = null;

  function getSnapshot() {
    const now = nowMs();
    const paused = Object.entries(state)
      .filter(([, s]) => Number(s?.pausedUntil) > now)
      .map(([key, s]) => ({ key, until: s.pausedUntil }));
    const wins = stats.wins, losses = stats.losses;
    return {
      phase: !ws ? 'booting' : !warmupDone ? 'connecting' : 'running',
      accountType, currencySymbol, balanceId,
      initialBalance, balance: currentBalance, sessionStartBalance,
      startedAt, warmupDone, closedCandles,
      sessionLossLimit: sessionLossLimit(),
      exposureLimit: exposureLimit(),
      openStake: openStake(),
      openPositions: [...inFlight.values()].map((o) => ({
        key: o.key, asset: shortName(o.name), direction: o.direction, kind: o.kind,
        stake: o.stake, expiration: o.expiration, sentAtMs: o.sentAtMs,
      })),
      paused,
      stats: { ...stats, wr: wins + losses > 0 ? round2((wins / (wins + losses)) * 100) : 0 },
      universe: { size: running.size, min: MIN_ACTIVE, max: MAX_ACTIVE },
      config: {
        baseStake: BASE_STAKE, expiryMinutes: EXPIRATION_MIN, maxOpsPerAsset: MAX_OPS_PER_ASSET,
        maxStake: MAX_STAKE, payout: PAYOUT, maxExposurePct: MAX_EXPOSURE_PCT, sessionLossPct: SESSION_LOSS_PCT,
      },
      resultsCount: resultsList.length,
      rev: CODE_REV,
      codeHash: CODE_HASH,
    };
  }

  function publish() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ ...getSnapshot(), connection: { ws: ws?.readyState === WebSocket.OPEN ? 'CONNECTED' : 'OFFLINE', feed: warmupDone ? 'LIVE' : 'NO_FEED', candles: closedCandles } }));
    } catch {}
  }

  function handleCommand(msg) {
    const { action, mode, email, password } = msg;
    if (action === 'stop') {
      logLine('[🎮] Comando do painel: PARAR');
      shutdown('PAINEL');
      return;
    }
    if (action === 'account_switch') {
      logLine(`[🎮] Comando do painel: trocar conta para ${mode}`);
      if (mode === 'demo' || mode === 'real') {
        const pref = { mode };
        fs.writeFileSync('./bot-preference.json', JSON.stringify(pref, null, 2));
        logLine(`[🎮] Preferência salva: ${mode}. Reinicie o bot para usar.`);
      }
      return;
    }
    if (action === 'login') {
      if (email && password) {
        logLine(`[🎮] Comando do painel: atualizar credenciais para ${email}`);
        const cred = { email, password };
        fs.writeFileSync('./bot-credentials.json', JSON.stringify(cred, null, 2));
        logLine('[🎮] Credenciais salvas. Reinicie o bot para usar.');
      }
      return;
    }
    if (action === 'logout') {
      try { fs.unlinkSync('./bot-credentials.json'); } catch {}
      logLine('[🎮] Logout feito. Credenciais removidas.');
      return;
    }
  }

  function connect() {
    try {
      ws = new WebSocket(PANEL_WS_URL);
    } catch (err) {
      logLine(`[🎮] WebSocket não disponível: ${err.message} — painel offline`);
      scheduleReconnect();
      return;
    }

    ws.on('open', () => {
      connected = true;
      logLine(`[🎮] Conectado ao painel: ${PANEL_WS_URL}`);
      ws.send(JSON.stringify({ auth: true, secret: PANEL_SECRET }));
      // publica imediatamente
      publish();
      publishTimer = setInterval(publish, TELEMETRY_MS);
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      handleCommand(msg);
    });

    ws.on('close', () => {
      connected = false;
      clearInterval(publishTimer);
      ws = null;
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      logLine(`[🎮] Erro no painel: ${err.message}`);
    });
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 5_000);
  }

  connect();
}
installPanelWebSocket();
/* [TELEMETRIA:END] */
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

// V18 — REGIME DE HORAS: a mesma EMA8×21, mas sobre as velas de 1 MINUTO (amostra de
// horas — a hidratação do boot traz BOOT_1M_CANDLES velas = 4h). É o regime que o dono
// descreveu: "olha as últimas horas, o ativo tá subindo". direction null = dados
// insuficientes ('dados1m') ou lateral ('lateral1m') — nos dois casos não entra.
export function trendDirection1m(ticks1m, { minCandles = REGIME_1M_MIN_CAND, minSpread = REGIME_1M_MIN_SPREAD } = {}) {
  const n = Array.isArray(ticks1m) ? ticks1m.length : 0;
  if (n < minCandles) return { direction: null, spreadPct: 0, source: 'dados1m', candles: n };
  const closes = ticks1m.map((t) => t.close);
  const fast = ema(closes.slice(-12), 8);
  const slow = ema(closes, 21);
  const spreadPct = slow > 0 ? Math.round(((fast - slow) / slow) * 10_000) / 100 : 0;
  if (spreadPct >= minSpread) return { direction: 'CALL', spreadPct, source: 'alta1m', candles: n };
  if (spreadPct <= -minSpread) return { direction: 'PUT', spreadPct, source: 'baixa1m', candles: n };
  return { direction: null, spreadPct, source: 'lateral1m', candles: n };
}

// V18 — GATILHO ÚNICO: RSI(5s) CRUZANDO para dentro da zona extrema na última vela
// (cruzou = um tiro; ficar DENTRO da zona não re-dispara — sem rajada no mergulho).
export function rsiTouchSignal(ticks, direction, { call = RSI_TOUCH_CALL, put = RSI_TOUCH_PUT } = {}) {
  if (direction !== 'CALL' && direction !== 'PUT') return false;
  if (!Array.isArray(ticks) || ticks.length < S.rsiPeriod + 2) return false;
  const now = calcRSI(ticks);
  const prev = calcRSI(ticks.slice(0, -1));
  if (direction === 'CALL') return now <= call && prev > call;
  return now >= put && prev < put;
}

// V18 — SUSTENTÁCULO ("já desceu muito"): o preço tem de estar ENCOSTADO no extremo do
// range recente — perto do fundo das últimas N velas 5s no CALL (suporte) ou do topo no
// PUT (resistência), em múltiplos do candle típico (tickVolPct). Serve para não comprar
// tarde: RSI ainda na zona mas preço já escapou do fundo = entrada podre.
export function supportProximity(ticks, direction, { lookback = SUPPORT_LOOKBACK, factor = SUPPORT_ATR_FACTOR } = {}) {
  if (direction !== 'CALL' && direction !== 'PUT') return { ok: false, distPct: NaN, extreme: null };
  if (!Array.isArray(ticks) || ticks.length < 3) return { ok: false, distPct: NaN, extreme: null };
  const window = ticks.slice(-lookback);
  const close = Number(window[window.length - 1]?.close);
  if (!Number.isFinite(close) || close <= 0) return { ok: false, distPct: NaN, extreme: null };
  const values = window.map((t) => Number(direction === 'CALL' ? (t.low ?? t.close) : (t.high ?? t.close))).filter(Number.isFinite);
  if (!values.length) return { ok: false, distPct: NaN, extreme: null };
  const extreme = direction === 'CALL' ? Math.min(...values) : Math.max(...values);
  const typical = close * (tickVolPct(ticks) / 100); // movimento típico de 1 vela 5s em preço
  const dist = Math.abs(close - extreme);
  return { ok: dist <= Math.max(factor * typical, 1e-12), distPct: (dist / close) * 100, extreme };
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

// ADX (Average Directional Index) — mede a FORÇA da tendência (não a direção).
// ADX >= 20 = tendência com força suficiente para operar.
// Valores abaixo de 20 = mercado fraco/lateral, entrada proibida.
export function calcADX(ticks, period = 14) {
  if (ticks.length < period * 2 + 1) return 0;
  const pDM = [], nDM = [], trs = [];
  for (let i = 1; i < ticks.length; i++) {
    const h = ticks[i].high ?? ticks[i].close, l = ticks[i].low ?? ticks[i].close;
    const ph = ticks[i - 1].high ?? ticks[i - 1].close, pl = ticks[i - 1].low ?? ticks[i - 1].close;
    const hl = (h - l), hpc = Math.abs(h - ph), lpc = Math.abs(l - pl);
    trs.push(Math.max(hl, hpc, lpc));
    pDM.push(hpc > lpc && hpc > 0 ? hpc : 0);
    nDM.push(lpc > hpc && lpc > 0 ? lpc : 0);
  }
  // Suavização Wilder
  const smooth = (arr, n) => {
    if (n >= arr.length) return 0;
    let s = arr.slice(0, n).reduce((a, b) => a + b, 0);
    const res = [s];
    for (let i = n; i < arr.length; i++) { s = s - s / n + arr[i]; res.push(s); }
    return res;
  };
  const sTR = smooth(trs, period), sPDM = smooth(pDM, period), sNDM = smooth(nDM, period);
  const di = (sPDM, sTR) => sTR > 0 ? (sPDM / sTR) * 100 : 0;
  const plus = di(sPDM[sPDM.length - 1], sTR[sTR.length - 1]);
  const minus = di(sNDM[sNDM.length - 1], sTR[sTR.length - 1]);
  const dx = plus + minus > 0 ? (Math.abs(plus - minus) / (plus + minus)) * 100 : 0;
  // ADX = EMA do DX (usando Wilder-like smoothing simplificado)
  if (ticks.length < period * 2) return dx;
  let adx = dx;
  const adxK = 2 / (period + 1);
  const lastIdx = sTR.length - 1;
  for (let i = 0; i < Math.min(period - 1, lastIdx); i++) {
    const idx = lastIdx - i;
    const dxi = (Math.abs(
      di(sPDM[idx] ?? sPDM[sPDM.length - 1], sTR[idx] ?? sTR[sTR.length - 1]) -
      di(sNDM[idx] ?? sNDM[sNDM.length - 1], sTR[idx] ?? sTR[sTR.length - 1])
    ) / (
      (di(sPDM[idx] ?? sPDM[sPDM.length - 1], sTR[idx] ?? sTR[sTR.length - 1]) +
       di(sNDM[idx] ?? sNDM[sNDM.length - 1], sTR[idx] ?? sTR[sTR.length - 1])) + 0.0001
    )) * 100;
    adx = dxi * adxK + adx * (1 - adxK);
  }
  return Math.min(adx, 100);
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

// Candle típico de 5s em % (média de |Δclose|/close): é a régua do movimento.
export function tickVolPct(ticks, lookback = VOL_LOOKBACK) {
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

// Núcleo puro da decisão de ENTRADA. A entrada nunca vende: quem decide a venda é
// `sellDecision` (reversão confirmada; venda a mercado). Aqui só entra ordem nova
// quando o ativo está limpo.
//
// PIRAMIDAGEM: quando o sinal é MUITO FORTE (tendência confirmada + RSI extremo),
// pode abrir 2ª posição no mesmo sentido. Loss não entra em gale se tiver 2 pyramid.
//
// PROTEÇÕES V16 (contra losses como DYDX/Vaulta/TRON):
//   • ADX >= adxMin: tendência precisa ter força mínima (não é só direção)
//   • RSI mais apertado (CALL: <=55, PUT: >=45): evita entradas em RSI extremo
//   • pullback check ANTES do regime: um pullback DENTRO da tendência é válido
//     (o regime trending bloqueia se não tiver pullback formado, não antes)
export function evaluateEntry({ ticks, open, trend, regime, rsi, adx = 0, cycleOps = 0, maxOpsPerAsset = MAX_OPS_PER_ASSET, gale = false, adxMin = num(S.adxMin, 20), reversalCfg = SE.reversal, reversalGale = false, mode = 'pullback', regime1m = null, rsiTouchCall = RSI_TOUCH_CALL, rsiTouchPut = RSI_TOUCH_PUT, supportLookback = SUPPORT_LOOKBACK, supportAtrFactor = SUPPORT_ATR_FACTOR }) {
  const sameDir = open.filter((o) => o.direction === trend.direction);
  const oppDir  = open.filter((o) => o.direction !== trend.direction);

  if (oppDir.length) return { skip: 'ladoOposto' };
  if (sameDir.length >= maxOpsPerAsset) return { skip: 'cicloFechado' };
  if (sameDir.length >= 1) {
    // PIRAMIDAGEM (regra do dono, 2026-10-02): no máximo 2 posições no mesmo sentido, e a 2ª
    // só sai na CHANCE QUASE PERFEITA DE NÃO REVERTER — os três fatores juntos, porque o que
    // produziu o desastre do DOTUSD (2026-10-02) foi reforçar tendência morrendo (ADX caindo
    // 23,0 → 20,7 → 16,1) e comprar topo com o RSI já na média.
    //   1) ADX >= PYRAMID_ADX_MIN — tendência com força de verdade (não "sem estar fraca");
    //   2) RSI no EXTREMO A FAVOR — CALL só com RSI <= 35, PUT só com RSI >= 65 (é o
    //      "RSI lá embaixo no regime de alta" do dono);
    //   3) reversão não pode estar se formando contra a posição (preço adverso à 1ª entrada).
    if (sameDir.length > PYRAMID_MAX) return { skip: 'pyramidMax' };
    if (adx < PYRAMID_ADX_MIN) return { skip: 'pyramidAdx' };
    const extremo = trend.direction === 'CALL' ? rsi <= PYRAMID_RSI_CALL_MAX : rsi >= PYRAMID_RSI_PUT_MIN;
    if (!extremo) return { skip: 'pyramidRsi' };
    const base = sameDir.find((o) => Number.isFinite(Number(o.entryPrice)));
    if (base) {
      const rev = reversalAgainst({
        side: trend.direction, ticks, entryPrice: Number(base.entryPrice),
        cfg: { ...reversalCfg, requireTrendFlip: false },
      });
      if (rev.confirmed) return { skip: 'reversaoFormando', reversal: rev };
    }
    return { kind: 'pyramid', direction: trend.direction, reason: `piramidagem ${sameDir.length + 1}x ${trend.direction} — sinal extremo: ${trend.source} ${trend.spreadPct}% | RSI ${rsi.toFixed(0)} | ADX ${adx.toFixed(1)}` };
  }
  // GALE DE REVERSÃO: o gatilho já foi dado (a venda por reversão confirmou o flip).
  // Aqui só se confere que a tendência ainda aponta o sentido armado — os portões da
  // entrada normal (pullback, regime, ADX, RSI) não se aplicam: eles existem para
  // achar o momento de entrar, e o momento acabou de ser dado. As travas globais
  // (lado oposto, exposição, sessão, saldo) continuam valendo em `evaluateGuards`.
  if (reversalGale) {
    if (!trend.direction) return { skip: trend.source === 'dados' ? 'dados40' : 'lateral' };
    return {
      kind: 'reversalGale', direction: trend.direction,
      reason: `martingale — reversão confirmada: tendência ${trend.source} ${trend.spreadPct}% | RSI ${rsi.toFixed(0)} | ADX ${adx.toFixed(1)}`,
    };
  }
  // ── V18 — ENTRADA NOVA (regra do dono, 2026-10-02): regime de HORAS (1m) + RSI(5s)
  // tocando 30/70 + preço encostado no suporte/resistência. Sem fade4, sem ADX mínimo,
  // sem guarda-corpo e sem regime de 5s: esses gates medem o curtíssimo prazo e brigam
  // com o próprio mergulho que a gente quer comprar (medido: 1 sinal em 9360 janelas).
  // É o regime 1m quem responde "suporte pra continuar subindo ou reversão": 1m virado
  // contra = não entra. O gale (acima) e a pirâmide (abaixo) seguem as regras do dono.
  if (mode === 'rsiTouch') {
    if (cycleOps >= maxOpsPerAsset) return { skip: 'cicloFechado' };
    if (!regime1m?.direction) return { skip: regime1m?.source === 'dados1m' ? 'dados1m' : 'lateral1m', regime1m };
    if (!rsiTouchSignal(ticks, regime1m.direction, { call: rsiTouchCall, put: rsiTouchPut })) return { skip: 'semRsiTouch', rsi };
    const sup = supportProximity(ticks, regime1m.direction, { lookback: supportLookback, factor: supportAtrFactor });
    if (!sup.ok) return { skip: 'semSuporte', rsi, sup };
    return {
      kind: 'entrada', direction: regime1m.direction,
      reason: `regime ${regime1m.source} ${regime1m.spreadPct}% (${regime1m.candles} velas 1m) | RSI ${rsi.toFixed(0)} cruzou ${regime1m.direction === 'CALL' ? rsiTouchCall : rsiTouchPut} | a ${sup.distPct.toFixed(3)}% do ${regime1m.direction === 'CALL' ? 'fundo' : 'topo'} do range`,
    };
  }
  if (!trend.direction) return { skip: trend.source === 'dados' ? 'dados40' : 'lateral' };
  // ADX: bloqueia tendência fraca (e ADX=0 = histórico sem range/insuficiente).
  if (adx < adxMin) return { skip: 'adxFraco' };
  if (cycleOps >= maxOpsPerAsset) return { skip: 'cicloFechado' };
  // Pullback PRIMEIRO — pullback dentro da tendência é válido (corrige bug V15)
  if (fade4Signal(ticks, trend.direction) !== trend.direction) return { skip: 'semPullback' };
  // Regime trending SÓ bloqueia se não tiver pullback formado (não antes do pullback)
  if (regime.state === 'trending') return { skip: 'regime' };
  // RSI guarda-corpo mais apertado V16 (55/45 em vez de 60/40)
  if (trend.direction === 'CALL' && rsi > num(S.rsiCallMax, 55)) return { skip: 'rsi' };
  if (trend.direction === 'PUT' && rsi < num(S.rsiPutMin, 45)) return { skip: 'rsi' };
  return {
    kind: gale ? 'gale' : 'entrada',
    direction: trend.direction,
    reason: gale ? `gale após loss — tendência ${trend.source} ${trend.spreadPct}%` : `tendência ${trend.source} ${trend.spreadPct}% | RSI ${rsi.toFixed(0)} | ADX ${adx.toFixed(1)}`,
  };
}

// Confirmação de REVERSÃO contra a posição (núcleo puro). Vender antes só com
// "grande chance de dar loss": o mercado precisa mostrar reversão CONFIRMADA contra
// a operação, não ruído. Fatores (todos precisam concordar):
//   1) tendência virou contra (EMA8×21 além do spread mínimo);
//   2) RSI do lado oposto (CALL ≤ rsiCallMax / PUT ≥ rsiPutMin);
//   3) velas de 5s fechando contra (minCandles de `candles`);
//   4) preço adverso à entrada ≥ factor × o candle típico de 5s (piso advMin).
export function reversalAgainst({ side, ticks, entryPrice, cfg = {} }) {
  const c = {
    candles: REV_CANDLES, minCandles: REV_CANDLES_MIN,
    rsiCallMax: REV_RSI_CALL_MAX, rsiPutMin: REV_RSI_PUT_MIN,
    advFactor: REV_ADV_FACTOR, advMin: REV_ADV_MIN_PCT,
    ...cfg,
  };
  if (side !== 'CALL' && side !== 'PUT') return { confirmed: false, reason: 'lado' };
  if (!Array.isArray(ticks) || ticks.length < TREND_LOOKBACK) return { confirmed: false, reason: 'dados' };
  const opp = side === 'CALL' ? 'PUT' : 'CALL';
  const trend = trendDirection(ticks);
  // `requireTrendFlip: false` = reversão SE FORMANDO (usa só preço/velas/momentum):
  // é o portão da piramidagem, que já é bloqueada antes pela guarda `ladoOposto`
  // quando a EMA vira de vez.
  if (c.requireTrendFlip !== false && trend.direction !== opp) {
    return { confirmed: false, reason: 'tendenciaNaoVirou', spreadPct: trend.spreadPct };
  }
  const win = ticks.slice(-(c.candles + 1));
  let against = 0;
  for (let i = 1; i < win.length; i++) {
    const down = win[i].close < win[i - 1].close;
    if (side === 'CALL' ? down : !down) against++;
  }
  if (against < c.minCandles) return { confirmed: false, reason: 'semSequencia', against, total: win.length - 1 };
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return { confirmed: false, reason: 'semPreco' };
  const lastClose = ticks[ticks.length - 1].close;
  const adverse = side === 'CALL' ? entryPrice - lastClose : lastClose - entryPrice;
  const adversePct = (adverse / entryPrice) * 100;
  const needPct = Math.max(c.advFactor * tickVolPct(ticks), c.advMin);
  if (adversePct < needPct) return { confirmed: false, reason: 'movimentoCurto', adversePct: round2(adversePct), needPct: round2(needPct) };
  const rsi = calcRSI(ticks);
  if (side === 'CALL' && rsi > c.rsiCallMax) return { confirmed: false, reason: 'semMomentum', rsi: Math.round(rsi) };
  if (side === 'PUT' && rsi < c.rsiPutMin) return { confirmed: false, reason: 'semMomentum', rsi: Math.round(rsi) };
  return {
    confirmed: true, spreadPct: trend.spreadPct, rsi: Math.round(rsi),
    against, total: win.length - 1, adversePct: round2(adversePct), needPct: round2(needPct),
  };
}

// Núcleo puro da VENDA (v16, regra do dono em 2026-10-02). Sem cotação de meio de vida
// disponível, a venda é A MERCADO e o valor da recompra é lido no fechamento. Decisões:
//   reversalCut → reversão CONFIRMADA contra a op (preço adverso à entrada);
//   hold        → todo o resto — sem reversão ou dentro dos últimos segundos que a IQ
//                 não aceita venda (closeBeforeMs).
export function sellDecision({
  side, entryPrice, ticks, remainingMs = Infinity, cfg = {},
}) {
  const closeBefore = num(cfg.closeBeforeMs, CLOSE_BEFORE_MS);
  if (!(remainingMs > 0)) return { action: 'hold', reason: 'semTempo' };
  if (remainingMs <= closeBefore) return { action: 'hold', reason: 'janelaDaVendaFechou' };
  const rev = reversalAgainst({ side, ticks, entryPrice, cfg: cfg.reversal });
  if (!rev.confirmed) return { action: 'hold', ...rev, reason: `semReversao:${rev.reason}` };
  return {
    action: 'sell', kind: 'reversalCut',
    reason: `reversão contra ${side}: tendência ${rev.spreadPct}% | RSI ${rev.rsi} | ${rev.against}/${rev.total} velas contra | ${rev.adversePct}% adverso (>= ${rev.needPct}%)`,
    ...rev,
  };
}

// Linha de posição aberta da IQ → cotação de venda (`sell_profit` = DEVOLUÇÃO da
// recompra). Extrai a cotação do push `position-changed` (broker). O id da opção vem
// em `external_id` (o mesmo que o bot guarda ao abrir) — sem número válido ou sem
// sell_profit, não é cotação.
export function parsePositionChanged(raw) {
  const value = raw?.sell_profit;
  if (value === undefined || value === null) return null;
  const option = raw?.raw_event?.binary_options_option_changed1;
  const id = Number(raw?.external_id ?? option?.option_id ?? raw?.id);
  const sellProfit = Number(value);
  if (!Number.isFinite(id) || !Number.isFinite(sellProfit)) return null;
  return { id, sellProfit };
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
// Circuit breaker REMOVIDO em V16: a trava de perda da sessão (20%) continua funcionando.
export function evaluateGuards({
  open, direction, now, pausedUntil = 0, lastOpAt = 0, lastResult = null,
  stake, balance = 0, exposure = 0, exposureLimit = Infinity,
  sessionLoss = 0, sessionLossLimit = Infinity, maxSameDirection = 3,
}) {
  const sameDir = open.filter((o) => o.direction === direction);
  const oppDir  = open.filter((o) => o.direction !== direction);
  if (oppDir.length) return 'ladoOposto';
  if (sameDir.length >= maxSameDirection) return 'pyramidMax';
  if (open.length >= MAX_OPS_PER_ASSET) return 'maxOps';
  if (now < pausedUntil) return 'pausado';
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
  const adx = calcADX(b5.ticks);
  // V18: regime de HORAS (velas 1m) — recalculado só quando entra vela 1m nova (cache
  // por ativo), porque o scan roda a cada 5s e a série 1m só muda 1×/min.
  const b1Last = b1.ticks[b1.ticks.length - 1] ?? null;
  if (!s.regime1m || s.regime1m.at !== b1Last?.atMs) {
    s.regime1m = { ...trendDirection1m(b1.ticks), at: b1Last?.atMs ?? null };
  }

  // MARTINGALE / GALE DE REVERSÃO (regra do dono, 2026-10-02): depois de vender por reversão o
  // ativo entra no sentido NOVO sem esperar pullback — o flip é o gatilho — e essa entrada é a
  // TERCEIRA ordem do ciclo: o martingale (multiplicador x a soma das posições vendidas). Só
  // vale sem posição aberta (o lado antigo tem de estar fechado) e dentro da janela do gale.
  const rg = s.reversalGale && now - s.reversalGale.at <= GALE_WINDOW_MS && s.reversalGale.stakeBase > 0 ? s.reversalGale : null;
  if (s.reversalGale && !rg) s.reversalGale = null;
  const martingale = !open.length && rg && rg.direction === trend.direction ? rg : null;

  const decision = evaluateEntry({ ticks: b5.ticks, open, trend, regime, rsi, adx, cycleOps: s.cycleOps, gale, reversalGale: Boolean(martingale), mode: ENTRY_MODE, regime1m: s.regime1m });
  if (decision.skip) return null;
  // Sem flip: entrada/gale NA MESMA direção da tendência (a tendência é a favor)
  return {
    direction: decision.direction, trend, rsi, adx, kind: decision.kind, reason: decision.reason,
    martingaleBase: martingale ? martingale.stakeBase : 0,
  };
}

function canTrade(aid, direction) {
  const buf = buf5s.get(aid);
  const s = state[buf?.key];
  if (!s) return null;
  const loss = sessionStartBalance > 0 ? sessionStartBalance - currentBalance : 0;
  const reason = evaluateGuards({
    open: opsFor(aid), direction, now: nowMs(),
    pausedUntil: s.pausedUntil, lastOpAt: s.lastOpAt, lastResult: s.lastResult,
    stake: ladderStake(s.ladder), balance: currentBalance,
    exposure: openStake(), exposureLimit: exposureLimit(),
    sessionLoss: loss, sessionLossLimit: sessionLossLimit(), maxSameDirection: 3,
  });
  if (reason) {
    if (reason === 'perdaSessao' && !sessionStopLogged) {
      sessionStopLogged = true;
      logLine(`[🛑 TRAVA DE PERDA] sessão ${fmt(-loss)} de ${currencySymbol}${sessionLossLimit().toFixed(2)} (${SESSION_LOSS_PCT}% do saldo inicial) → nenhuma ordem nova (reinicie para liberar)`);
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

  // A TERCEIRA ordem do ciclo é o MARTINGALE e é a ÚNICA que passa do stake fixo.
  // Qualquer outra ordem (entrada, gale, pirâmide) usa o stake fixo BASE_STAKE = R$2.
  const martingale = plan.kind === 'reversalGale';
  const stake = martingale ? martingaleStake(plan.martingaleBase) : BASE_STAKE;
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
    martingaleBase: martingale ? plan.martingaleBase : 0,
    sentAtMs: nowMs(), timestamp: new Date().toISOString(), rev: CODE_REV,
  };
  resultsList.push(record);
  inFlight.set(okey, {
    okey, assetId: aid, key: s.key, name: b5.name, direction: plan.direction, kind: plan.kind,
    stake, level: s.ladder, entryPrice, expiration, requestId, sentAtMs: record.sentAtMs, record,
  });
  s.lastOpAt = record.sentAtMs;
  s.direction = plan.direction;
  if (plan.kind === 'reversalGale') s.reversalGale = null;   // gatilho consumido (um martingale por ciclo)
  s.cycleOps = (s.cycleOps ?? 0) + 1;                        // ciclo = 3 ordens: entrada (+pirâmide) + martingale

  ws.send('sendMessage', {
    body: {
      price: stake, active_id: aid, expired: expiration, direction: plan.direction.toLowerCase(),
      option_type_id: optionTypeId, user_balance_id: Number(balanceId),
    },
    name: 'binary-options.open-option', version: '1.0',
  }, requestId);

  saveResults();
  const kindTag = plan.kind === 'pyramid' ? ' (PIRÂMIDE)' : plan.kind === 'reversalGale' ? ` (MARTINGALE ${MARTINGALE_MULT}x)` : plan.kind === 'gale' ? ` (reentrada ${s.cycleOps}/${MAX_OPS_PER_ASSET})` : '';
  logLine(`[📤 ORDEM] ${shortName(b5.name)} ${plan.direction} ${currencySymbol}${stake.toFixed(2)}${kindTag} | ${plan.reason}`);
  sessionLog(`ORDEM | ${shortName(b5.name)} | ${plan.direction} | stake=${currencySymbol}${stake.toFixed(2)} | tipo=${plan.kind} | ${plan.reason} | ciclo=${s.cycleOps}/${MAX_OPS_PER_ASSET}`);
}

// ─── VENDA (reversão confirmada, a mercado) ───────────────────────────────────
function requestSell(op, decision, now) {
  if ((op.sellAttempts ?? 0) >= SELL_MAX_ATTEMPTS) return;
  if (now - (op.lastSellAt ?? 0) < SELL_RETRY_MS) return;
  op.sellAttempts = (op.sellAttempts ?? 0) + 1;
  op.lastSellAt = now;
  op.sellRequestedAt = now;
  op.sellKind = decision.kind;
  const quote = quotes.get(String(op.orderId));
  op.sellQuote = quote ? quote.sellProfit : null; // última cotação vista (fallback do fechamento)
  op.sellRequestId = ws.sellOption(op.orderId);
  rawDumpUntil = now + 10_000;   // janela do dump cru (IQ_SELL_DEBUG=1) em volta da venda

  const remainingMs = op.expiration * 1000 - now;
  logLine(`[✂️ REVERSÃO] ${shortName(op.name)} ${op.direction} | venda a mercado (o valor sai no fechamento) | ${decision.reason} | restam ${Math.round(remainingMs / 1000)}s`);
}

function evaluateSell(op) {
  // V19 — venda por reversão REMOVIDA (regra do dono 2026-10-02).
  // Toda posição vai até o fim natural (a IQ fecha na expiração via socket-option-closed).
  // O martingale na reversão é avaliado por outro caminho (plan.kind === 'reversalGale').
  if (!warmupDone || !op.orderId) return;
  // no-op intencional
  return;
  // código antigo preservado abaixo para reativação se você mudar de ideia
  // const now = nowMs();
  // const remainingMs = op.expiration * 1000 - now;
  // const buf = buf5s.get(op.assetId);
  // const decision = sellDecision({ side: op.direction, entryPrice: op.entryPrice, ticks: buf?.ticks ?? null, remainingMs, cfg: SE });
  // if (decision.action === 'sell') requestSell(op, decision, now);
}

let monitorBusy = false;
let earlyGaleMonitorLogged = false;
let quoteFirstLogged = false;
let posDumpCount = 0;
// Cotação do broker: o push `position-changed` (v3.0, assinado no boot) só chega no
// ABRIR e no FECHAR da posição — não existe cotação de meio de vida (medido em
// 2026-10-02: push só na abertura e `get-options` estático). O `sell_profit` é a
// DEVOLUÇÃO da recompra e fica guardado como fallback do valor de fechamento;
// a decisão de venda é pela reversão (`sellDecision`).
function onPositionChanged(raw) {
  // IQ_SELL_DEBUG=1: imprime os 6 primeiros eventos CRUS (mesmo sem sell_profit) —
  // é a prova do que o broker manda enquanto a posição está aberta. Sem a
  // variável, silêncio total.
  if (process.env.IQ_SELL_DEBUG === '1' && posDumpCount < 6) {
    posDumpCount++;
    const opt = raw?.raw_event?.binary_options_option_changed1 ?? null;
    const cand = {
      id: raw?.external_id ?? opt?.option_id ?? raw?.id ?? null,
      status: raw?.status ?? null,
      sell_profit: raw?.sell_profit ?? opt?.sell_profit ?? null,
      close_profit: opt?.close_profit ?? null,
      pnl: opt?.pnl ?? null,
      expected_profit: raw?.expected_profit ?? null,
      current_price: raw?.current_price ?? null,
    };
    logLine(`[🔎 IQ] position-changed #${posDumpCount}: ${JSON.stringify(cand)} | chaves=${Object.keys(raw ?? {}).join(',')} | raw=${JSON.stringify(raw).slice(0, 600)}`);
  }
  const parsed = parsePositionChanged(raw);
  if (!parsed) return;
  quotes.set(String(parsed.id), { sellProfit: parsed.sellProfit, at: nowMs() });
  if (!quoteFirstLogged) {
    quoteFirstLogged = true;
    logLine('[💱] cotação em tempo real OK (sell_profit) — venda antecipada ativa');
  }
}

// ─── EARLY GALE MONITOR ───────────────────────────────────────────────────────
// Roda a cada 1 segundo enquanto há operações em voo.
// Reavalia cada posição aberta com a cotação fresca e, se a posição está
// perdendo além do limiar dentro da janela, abre o gale ANTES da operação
// original fechar em loss — tornando o martingale mais eficiente.
async function monitorOperations() {
  if (!EARLY_GALE_ENABLED) return;
  if (monitorBusy || !warmupDone) return;
  if (inFlight.size === 0) return;

  monitorBusy = true;
  try {
    for (const op of [...inFlight.values()]) {
      const q = quotes.get(String(op.id));
      if (!q) continue;

      const elapsed = nowMs() - op.openAt;

      // Fora da janela → não avalia
      if (elapsed < EARLY_GALE_MIN_MS || elapsed > EARLY_GALE_MAX_MS) continue;

      // Posição não está perdendo o suficiente → não avalia
      if (q.sellProfit > -EARLY_GALE_LOSS_THRESHOLD) continue;

      // Verifica se o ciclo permite mais operações
      const s = state[op.key];
      if (!s) continue;
      if (s.cycleOps >= MAX_OPS_PER_ASSET) continue;

      // Verifica galeArmedAt: só abre gale se está armado e não venceu
      const galeWindowOk = s.galeArmedAt > 0 && (nowMs() - s.galeArmedAt) <= GALE_WINDOW_MS;
      if (!galeWindowOk) continue;

      // Log só na primeira vez que detectar uma posição elegível
      if (!earlyGaleMonitorLogged) {
        earlyGaleMonitorLogged = true;
        logLine(`[👁️] EARLY GALE ativo: janela ${EARLY_GALE_MIN_MS / 1000}s..${EARLY_GALE_MAX_MS / 1000}s | limiar R$${EARLY_GALE_LOSS_THRESHOLD.toFixed(2)}`);
      }

      // Dispara a avaliação de entrada para este ativo
      maybeTrade(op.assetId);
    }
  } finally {
    monitorBusy = false;
  }
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
    // V16: SEM circuit breaker. O bot opera sempausa por losses consecutivos.
    // A única proteção contra perdas é a trava de sessão (20%) e o teto de exposição.
  }

  const next = nextTradeState(s, forLadder, nowMs());
  Object.assign(s, {
    ladder: next.ladder, lossStreak: next.lossStreak,
    direction: next.direction, pausedUntil: next.pausedUntil, lastResult: forLadder,
    galeArmedAt: next.galeArmedAt,
  });
  // Fim da sequência: o martingale fechou (ganhou ou perdeu) → o ciclo zera e a próxima
  // ordem do ativo volta ao stake base. Um martingale por sequência, nunca emendado.
  if (op.kind === 'reversalGale') {
    s.cycleOps = 0;
    s.galeArmedAt = 0;
    s.reversalGale = null;
  }

  if (next.event === 'pause') logLine(`[⏸ PAUSA] ${shortName(op.name)}: ${MAX_LEVELS + 1} losses seguidos → ${Math.round(PAUSE_AFTER_MS / 60000)}min`);
  saveState();
}

function finalizeEarly(op, returnedValue, source) {
  inFlight.delete(op.okey);
  settledRecently.set(op.okey, nowMs());
  // `sell_profit` é a DEVOLUÇÃO da recompra (não o lucro): resultado = devolução − stake.
  const devolve = round2(Number.isFinite(returnedValue) ? returnedValue : 0);
  const profit = saleNet(devolve, op.stake);
  Object.assign(op.record, {
    result: 'early', profit, earlySell: true, sellReturn: devolve, profitSource: source,
    sellKind: op.sellKind ?? null, settledAt: new Date().toISOString(),
  });
  saveResults();
  registerOutcome(profit, true);
  applyResult(op, 'early', profit);
  // Martingale: vendeu por reversão → arma a entrada no sentido NOVO (janela do gale) e ACUMULA
  // o que está sendo recuperado. Cada ordem da mesma sequência que fechar por reversão soma o seu
  // stake — é essa soma que o martingale multiplica (2 posições de 2,00 → 4,00 → US$11,00).
  // O MARTINGALE NÃO ARMA OUTRO MARTINGALE (`op.kind !== 'reversalGale'`): se a própria ordem
  // de martingale for vendida por reversão, a sequência acaba e a próxima volta ao stake base.
  // Sem essa guarda a escada compõe (5,50 → 15,13 → 41,59 → ...) — foi o 2,75 composto que
  // zerou a conta em 10-01.
  if (op.sellKind === 'reversalCut' && SE.reversalGale !== false && op.stake > 0 && op.kind !== 'reversalGale') {
    const s = state[op.key];
    if (s) {
      const prev = s.reversalGale && nowMs() - s.reversalGale.at <= GALE_WINDOW_MS ? s.reversalGale : null;
      s.reversalGale = {
        direction: op.direction === 'CALL' ? 'PUT' : 'CALL',
        at: prev ? prev.at : nowMs(),
        stakeBase: round2((prev?.stakeBase ?? 0) + op.stake),
      };
      saveState();
    }
  }
  void refreshBalance().then(() => { saveState(); renderDashboard(); });
  const emoji = profit >= 0 ? '✂️✅' : '✂️❌';
  logLine(`[${emoji}] ${shortName(op.name)} ${op.direction} | venda por reversão: devolve ${fmt(devolve)} (líquido ${fmt(profit)})`);
  sessionLog(`VENDA ANTECIPADA | ${shortName(op.name)} | ${op.direction} | devolve=${fmt(devolve)} | lucro=${fmt(profit)} | tipo=${op.kind} | sellKind=${op.sellKind}`);
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
  // Credenciais do painel (bot-credentials.json) sobrepõem o config
  let creds = { email: CONFIG.login.email, password: CONFIG.login.password };
  try {
    const c = JSON.parse(fs.readFileSync('./bot-credentials.json', 'utf8'));
    if (c.email && c.password) creds = c;
  } catch {}
  const postData = JSON.stringify({ identifier: creds.email, password: creds.password });
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

function applyUniverse(actives, reason, { subscribe = true } = {}) {
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
    if (subscribe) {
      ws.subscribeCandles(entry.aid, num(S.candleSizeSeconds, 5));
      ws.subscribeCandles(entry.aid, 60);
    }
  }
  const names = [...running.values()].map((row) => shortName(row.name)).join(' • ');
  if (reason === 'boot') {
    logLine(`[📋] ${running.size} ativos no universo | min=${MIN_ACTIVE} | max=${MAX_ACTIVE}`);
    logLine(`     ${names.slice(0, 300)}${names.length > 300 ? '...' : ''}`);
    if (unavailableTop.length) logLine(`[⚠️] top fora agora: ${unavailableTop.slice(0, 10).join(', ')}`);
    if (running.size < MIN_ACTIVE) logLine(`[⚠️] ATENÇÃO: universo ABAIXO do mínimo ${MIN_ACTIVE}`);
  } else {
    logLine(`[🔁] universo (${reason}): ${running.size} ativos${unavailableTop.length ? ` | fora agora: ${unavailableTop.slice(0, 5).join(', ')}` : ''}`);
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

  // Cotação da venda antecipada: push de posições do broker (sell_profit).
  ws.on('message', (m) => {
    if (m?.name === 'position-changed') onPositionChanged(m?.msg ?? {});
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
    sessionStartBalance = currentBalance; // referência da perda da sessão — ZERA aqui a cada boot
    accountType = chosen.type === 4 ? 'DEMO' : 'REAL';
    currencySymbol = symbolOf(chosen.currency);

    if (initialBalance < BASE_STAKE) {
      console.error(`[ERRO] Saldo insuficiente na conta ${accountType}: ${currencySymbol}${initialBalance.toFixed(2)} < base ${currencySymbol}${BASE_STAKE.toFixed(2)}.`);
      process.exit(1);
    }

    logLine(`[💼] CONTA ${accountType} (${chosen.currency}) | id=${balanceId} | saldo ${currencySymbol}${initialBalance.toFixed(2)}`);
    // Venda antecipada: assina o push de posições (sell_profit em tempo real).
    ws.subscribePositionChanges({ userId: chosen.user_id, balanceId, instrumentType: 'turbo-option' });
    ws.subscribePositionChanges({ userId: chosen.user_id, balanceId, instrumentType: 'binary-option' });
    logLine(`[🧬] CÓDIGO ${CODE_REV} sha256:${CODE_HASH} — se a tela mostrar outro, é código velho (reinicie)`);
    logLine(`[🎛️] stake ${currencySymbol}${BASE_STAKE.toFixed(2)} | expiração ${EXPIRATION_MIN}min | ciclo de ${MAX_OPS_PER_ASSET} ordens por ativo: entrada (+ ${PYRAMID_MAX} pirâmide) + MARTINGALE ${MARTINGALE_MULT}× a exposição, um por ciclo | até ${MAX_ACTIVE} ativos OTC 24/7 | teto expo ${MAX_EXPOSURE_PCT}% | teto por ordem ${currencySymbol}${MAX_STAKE.toFixed(2)}`);
    logLine(`[✂️] VENDA só com CONFIRMAÇÃO DE REVERSÃO contra a posição (venda A MERCADO — a IQ só manda cotação no abrir/fechar; o valor da recompra sai no fechamento) | confirmação: tendência virou + RSI CALL≤${REV_RSI_CALL_MAX}/PUT≥${REV_RSI_PUT_MIN} + ${REV_CANDLES_MIN}/${REV_CANDLES} velas contra + adverso ≥ ${REV_ADV_FACTOR}× candle típico | IQ não aceita nos últimos ${Math.round(CLOSE_BEFORE_MS / 1000)}s`);
    logLine(`[🔁] MARTINGALE: depois de vender por reversão o bot entra no sentido NOVO (janela ${Math.round(GALE_WINDOW_MS / 1000)}s) e essa 3ª ordem vale ${MARTINGALE_MULT}× a soma das posições vendidas (${currencySymbol}${(MARTINGALE_MULT * BASE_STAKE * 2).toFixed(2)} com 2 abertas de ${currencySymbol}${BASE_STAKE.toFixed(2)}) | único por ciclo`);
    logLine(`[🎯] ENTRADA V18 (regra do dono): regime de HORAS (${REGIME_1M_MIN_CAND}+ velas 1m, EMA8×21 spread ≥ ${REGIME_1M_MIN_SPREAD}% — hidratação ${BOOT_1M_CANDLES} velas 1m no boot) | RSI(5s) cruza ${RSI_TOUCH_CALL} → CALL na alta / cruza ${RSI_TOUCH_PUT} → PUT na baixa | preço a ≤ ${SUPPORT_ATR_FACTOR}× candle típico do fundo/topo das últimas ${SUPPORT_LOOKBACK} velas | 1m virado contra = NÃO entra (é reversão, não suporte)`);
    logLine(`[🛡️] pirâmide como sempre: ADX ≥ ${PYRAMID_ADX_MIN} e RSI extremo a favor (CALL ≤ ${PYRAMID_RSI_CALL_MAX} / PUT ≥ ${PYRAMID_RSI_PUT_MIN}) | no máximo ${PYRAMID_MAX + 1} posições no mesmo sentido | ciclo de ${MAX_OPS_PER_ASSET} ordens | martingale ${MARTINGALE_MULT}× um por ciclo`);
    if (EARLY_GALE_ENABLED) {
      logLine(`[👁️] EARLY GALE: a cada 1s verifica ops abertas | janela ${EARLY_GALE_MIN_MS / 1000}–${EARLY_GALE_MAX_MS / 1000}s | abre gale se sell_profit <= -${currencySymbol}${EARLY_GALE_LOSS_THRESHOLD.toFixed(2)}`);
    } else {
      logLine(`[👁️] EARLY GALE: desativado`);
    }

    const actives = await fetchActives();
    if (LIST_ASSETS) {
      for (const act of actives) if (act?.name) logLine(`  [${act.id}] ${act.name}`);
    }
    // Universo primeiro SEM assinar o feed: o histórico hidrata antes do feed ao vivo.
    applyUniverse(actives, 'boot', { subscribe: false });

    // Histórico: enche os buffers 5s/1min antes de operar e ANTES de assinar o feed.
    // Ordem crítica: com o feed ativo, o candle em formação "engole" o lote de
    // histórico (ClosedCandles.ingest) e o buffer fica vazio — medido em 2026-10-02:
    // 0/30 ativos com feed assinado antes vs 30/30 com a hidratação primeiro.
    const need5 = num(S.lookbackRegime, 20), need1 = ENTRY_MODE === 'rsiTouch' ? Math.min(REGIME_1M_MIN_CAND, BOOT_1M_CANDLES) : num(S.min1mCandles, 1);
    const now0 = nowMs();
    const asc = (list) => (Array.isArray(list) ? list.slice().sort((x, y) => (toMs(x?.from ?? x?.at) ?? 0) - (toMs(y?.from ?? y?.at) ?? 0)) : []);
    // Chunks de 10 em paralelo: o cliente casa a resposta por request_id (a IQ ecoa),
    // então chamadas concorrentes NÃO se cruzam. Burst maior que isso cai em rate limit.
    const CHUNK = 20;
    const aids = [...running.keys()];
    let ready = 0, semResposta = 0;
    const tHist = Date.now();
    for (let i = 0; i < aids.length; i += CHUNK) {
      const chunk = aids.slice(i, i + CHUNK);
      await Promise.all(chunk.map(async (aid) => {
        const row = running.get(aid);
        try {
          const h5 = await ws.getCandlesHistory({ activeId: aid, size: num(S.candleSizeSeconds, 5), count: 40 });
          for (const candle of asc(h5?.msg?.candles)) buf5s.get(aid)?.ingest(candle, now0);
          const h1 = await ws.getCandlesHistory({ activeId: aid, size: 60, count: BOOT_1M_CANDLES });
          for (const candle of asc(h1?.msg?.candles)) buf1m.get(aid)?.ingest(candle, now0);
        } catch { semResposta++; /* best-effort: o feed ao vivo completa */ }
        const b5 = buf5s.get(aid), b1 = buf1m.get(aid);
        if (b5 && b1 && b5.ticks.length >= need5 && b1.ticks.length >= need1) ready++;
        if (row) row.lastCandleAt = 0;
      }));
    }
    logLine(`[🔁] histórico: ${ready}/${running.size} ativos com dados suficientes (5s≥${need5}, 1m≥${need1})${semResposta ? ` | ${semResposta} sem resposta` : ''} | ${((Date.now() - tHist) / 1000).toFixed(1)}s`);

    // Agora sim: assina o feed ao vivo (a ordem acima é crítica).
    for (const aid of running.keys()) {
      ws.subscribeCandles(aid, num(S.candleSizeSeconds, 5));
      ws.subscribeCandles(aid, 60);
    }

    await new Promise((r) => setTimeout(r, num(S.warmupMs, 1_500)));
    warmupDone = true;
    startedAt = nowMs();  // início do cronômetro
    startSessionLog();  // Inicia o log de sessão
    logLine(`[✅] OPERANDO ${CODE_REV} — venda por reversão (a mercado), painel abaixo`);
    logLine(`[🎯] scan paralelo: avaliando ENTRADA em todos os ativos do universo a cada ${ENTRY_SCAN_MS / 1000}s — alvo ≥ 10 ordens simultâneas`);
    renderDashboard();
    // Cronômetro: atualiza painel a cada segundo
    setInterval(() => { if (!shuttingDown) renderDashboard(); }, 1_000);
    // SCAN DE ENTRADA — V17: a cada ENTRY_SCAN_MS percorre todos os ativos do universo
    // e chama maybeTrade (que checa guards, regime, pullback, RSI, ADX, martingale).
    // Isso garante que TODOS os ativos com sinal sejam avaliados, não só os que acabaram
    // de fechar candle 5s. Objetivo: ≥10 ordens simultâneas.
    setInterval(() => {
      if (shuttingDown || !warmupDone) return;
      for (const aid of running.keys()) maybeTrade(aid);
    }, ENTRY_SCAN_MS);
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
  // este handler fica como reconciliação (sell_profit é a DEVOLUÇÃO da recompra;
  // o líquido é devolução − stake, calculado no finalizeEarly).
  ws.on('sell-equal', async (msg) => {
    const raw = msg?.msg ?? msg;
    const positionId = Number(raw?.id ?? raw?.position_id ?? raw?.option_id);
    const op = findOp({ aid: Number(raw?.active_id ?? raw?.activeId), orderId: positionId });
    if (!op) return;
    finalizeEarly(op, pickCloseReturn(raw) ?? op.sellQuote, 'sell_equal');
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
      const rawReturn = pickCloseReturn(raw);
      const devolve = Number.isFinite(rawReturn) ? rawReturn : op.sellQuote;
      if (!Number.isFinite(devolve)) {
        logLine(`[⚠️] ${shortName(op.name)}: fechou por venda mas a devolução não foi lida — campos: ${Object.keys(raw ?? {}).slice(0, 12).join(',')}`);
      }
      finalizeEarly(op, devolve, Number.isFinite(rawReturn) ? 'close_sell_return' : 'sell_quote');
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
    sessionLog(`RESULTADO | ${shortName(op.name)} | ${op.direction} | ${result.toUpperCase()} | lucro=${fmt(profit)} | tipo=${op.kind} | stake=${currencySymbol}${op.stake.toFixed(2)}`);
  });

  ws.on('close', () => {
    // O cliente só avisa 'close' quando a conexão JÁ PRONTA cai (falha de boot
    // não conta). Não existe reconexão: queda = fim da sessão — resumo final e
    // exit, nada de zumbi com painel girando e feed morto.
    if (shuttingDown) return;
    logLine('\n[WS] Conexão encerrada — encerrando o bot (sem reconexão).');
    shutdown('WS');
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
  // Diagnóstico: mostra universo + lookups enquanto nenhuma op fechou
  if (!stats.settled) {
    const b5total = [...buf5s.values()].reduce((a, b) => a + b.ticks.length, 0);
    const b1total = [...buf1m.values()].reduce((a, b) => a + b.ticks.length, 0);
    const sample = [...buf5s.values()][0];
    const adxVal = sample ? calcADX(sample.ticks) : null;
    logLine(`[🔍] diag 60s: uni=${running.size}/${MIN_ACTIVE} | buf5s=${b5total} candles | buf1m=${b1total} | adxSample=${adxVal?.toFixed(1) ?? '?'} | trades=${stats.settled}`);
  }
  if (PROFIT_TARGET <= 0) return;
  if (stats.profit >= PROFIT_TARGET && !profitTargetLogged) {
    profitTargetLogged = true;
    logLine(`\n[🎯 META BATIDA] lucro ${fmt(stats.profit)} >= alvo ${currencySymbol}${PROFIT_TARGET.toFixed(2)} → encerrando bot`);
    shutdown('META');
  }
}

setInterval(() => { void refreshBalance().then(checkProfitTarget); }, 60_000);
  // V19 — venda por reversão REMOVIDA. O setInterval fica inerte (evaluateSell é no-op).
  setInterval(() => { for (const op of [...inFlight.values()]) evaluateSell(op); }, 1_000);
  if (EARLY_GALE_ENABLED) setInterval(() => { void monitorOperations(); }, 1_000);
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
  logLine(`\n[🛑] Encerrando (${reason}) — fechando bot...`);

  // 0) Encerra o log de sessão com o resumo final
  try { endSessionLog(true); } catch {}

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
