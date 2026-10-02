/**
 * OTC BOT v14 — SIMPLES E SEGURO
 * =============================================================================
 *  node ws-otc-v14.mjs demo           → opera na conta DEMO
 *  node ws-otc-v14.mjs real           → opera na conta REAL
 *  node ws-otc-v14.mjs                → pergunta a conta (1=REAL, 2=DEMO)
 *  node ws-otc-v14.mjs demo --ativos   → lista os ativos turbo disponíveis
 *
 *  DIREÇÃO: segue a TENDÊNCIA do ativo (EMA8 contra EMA21). Alta → compra CALL no
 *    pullback; baixa → vende PUT no repique. Sem tendência (lateral) → não entra.
 *    NÃO existe mais direção fixa por ativo: era isso que fazia o bot vender no
 *    meio de uma alta só porque o ativo estava marcado como PUT na whitelist.
 *  ENTRADA: stake base fixo (US$2 na demo / R$2 na real).
 *  TODOS OS ATIVOS AO MESMO TEMPO: não existe limite de quantos ativos operam juntos.
 *    O limite é POR ATIVO e é o CICLO DO GALE: 1 entrada + no máximo 2 gales
 *    (trading.maxOpsPerAsset = 3), sempre no mesmo sentido. O que é proibido por
 *    construção é ter CALL e PUT no mesmo ativo.
 *  GALE: quando uma ordem fecha em loss (ou é vendida na reversão), o bot volta no
 *    MESMO ativo para recuperar, no sentido da tendência daquele momento, SEM exigir
 *    pullback novo (trading.galeWindowMs). O valor NÃO escala: todo gale vale a base.
 *    Não existe mais reforço na continuação (era isso que empilhava ordem no ativo).
 *  VENDA NA REVERSÃO: quando o preço anda FLIP_REVERSAL_CANDLES candles fechados
 *    contra a ordem aberta, o bot manda VENDER na hora ('sell-options', o mesmo que o
 *    botão Vender da plataforma). Não vende ordem no lucro (deixa vencer) e não vende
 *    nos últimos segundos. Enquanto há ordem aberta no ativo ele nunca abre o oposto.
 *  TETO DE RISCO = FRAÇÃO DO SALDO: a soma de TODAS as ordens abertas nunca passa de
 *    risk.maxExposurePct% do saldo, e o teto encolhe junto com a conta. Nenhum número
 *    absoluto: $40 fixos em uma conta de $60 era 65% do saldo na mesa.
 *  CIRCUIT BREAKER: risk.stopAfterConsecutiveLosses losses seguidos → o bot para de
 *    abrir ordem nova por risk.pauseAfterLossStreakMs (as abertas fecham sozinhas).
 *  STAKE: FIXO na base (US$2/R$2) em TODA ordem — inclusive nas adicionais do mesmo
 *    ativo. `martingale.levels: 0` desliga a escalada de propósito: nunca aparece
 *    4,33/9,36. Se um dia quiser a escada de volta, levels = 2 religa o cálculo
 *    stake = (perdido + lucro da base) / payout, que se paga a cada degrau vencedor.
 *  EARLY SELL: vende antes do vencimento SÓ quando o preço está revertendo
 *    contra a posição. Se a trajetória continua a favor, não vende — deixa o win.
 *  FILTROS: regime (bloqueia depois de N candles iguais), pullback (4 contra + 1 de
 *    volta), RSI (CALL<=rsiCallMax / PUT>=rsiPutMin), cooldown, trava de stake
 *    (risk.maxStake) e teto de exposição (risk.maxExposurePct do saldo).
 *  ASSINATURA: no boot o bot imprime a revisão e o sha256 do próprio arquivo. Se a
 *    tela mostrar outra stake/limite ou outro hash, é código velho rodando — reinicie.
 *  Sinal só em candle FECHADO (atualização da vela em formação não gera ordem).
 */
import fs from 'fs';
import readline from 'readline';
import https from 'https';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';
import { IqWsClient, computeExpiration } from './iqoption-ws.mjs';

const CONFIG = JSON.parse(fs.readFileSync(new URL('./bot-config-v14.json', import.meta.url), 'utf8'));
const C  = CONFIG.trading ?? {};
const S  = CONFIG.strategy ?? {};
const M  = CONFIG.martingale ?? {};
const R  = CONFIG.risk ?? {};
const CD = CONFIG.cooldown ?? {};
const AF = CONFIG.autoFlip ?? {};
const ES = CONFIG.earlySell ?? {};
const P  = CONFIG.paths ?? {};
const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

const BASE_STAKE       = num(C.baseStake, 2);
const EXPIRATION_MIN   = num(C.expirationMinutes, 2);
// SEM limite de ativos simultâneos: todos os ativos operam ao mesmo tempo, cada um com
// o seu teto de ordens. O único freio global é o teto de exposição (% do saldo) e as
// travas de perda.
const MAX_OPS_PER_ASSET = Math.max(1, Math.round(num(C.maxOpsPerAsset, 3)));
const GALE_WINDOW_MS    = num(C.galeWindowMs, 120_000);
const MAX_LEVELS        = Math.max(0, Math.round(num(M.levels, 2)));
const PAYOUT            = num(M.payoutRate, 0.86);
const MAX_STAKE         = num(R.maxStake, 20);
const MAX_EXPOSURE_PCT  = num(R.maxExposurePct, 10);
const SESSION_LOSS_PCT  = num(R.maxSessionLossPct, 20);
const STOP_AFTER_LOSSES = Math.max(1, Math.round(num(R.stopAfterConsecutiveLosses, 3)));
const STOP_PAUSE_MS     = num(R.pauseAfterLossStreakMs, 1_200_000);
const PAUSE_AFTER_MS    = num(M.pauseAfterLadderMs, 600_000);
const COOLDOWN_WIN_MS   = num(CD.afterWinMs, 15_000);
const COOLDOWN_LOSS_MS  = num(CD.afterLossMs, 5_000);
const AUTO_FLIP         = AF.enabled !== false;
const FLIP_REVERSAL_CANDLES = Math.max(1, Math.round(num(AF.reversalCandles, 2)));
const TREND_LOOKBACK    = Math.max(21, Math.round(num(S.trendLookback, 40)));
const TREND_MIN_SPREAD  = num(S.trendMinEmaSpreadPct, 0.05);
const ES_MIN_REMAINING_MS = num(ES.minRemainingMs, 20_000);
const ES_RETRY_AFTER_MS   = num(ES.retryAfterMs, 8_000);
const ES_MAX_ATTEMPTS     = Math.max(1, Math.round(num(ES.maxAttempts, 4)));

if (!(PAYOUT > 0 && PAYOUT < 1)) {
  console.error(`[FATAL] martingale.payoutRate inválido: ${PAYOUT}`);
  process.exit(1);
}

const ARG = process.argv[2]?.toLowerCase();
const WANT_DEMO = ARG === 'demo' ? true : ARG === 'real' ? false : null;
const LIST_ASSETS = process.argv.includes('--ativos');

// Impressão digital do código que está de fato rodando. O bot não recarrega sozinho:
// se a tela/ordem mostrar outra revisão ou outro hash, é código velho rodando.
const CODE_REV = 'R8';
const CODE_HASH = (() => {
  try { return createHash('sha256').update(fs.readFileSync(new URL(import.meta.url), 'utf8')).digest('hex').slice(0, 8); }
  catch { return '????????'; }
})();

// ─── FUNÇÕES PURAS ────────────────────────────────────────────────────────────
const round2 = (v) => Math.round(v * 100) / 100;

// Escada de martingale: recupera o perdido + o lucro que a base daria.
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

// Resultado da ordem — nunca devolve NaN.
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

// Só entrega candle FECHADO. A IQ reenvia a vela em formação a cada tick:
// aqui isso apenas atualiza a vela corrente, nunca cria barra/sinal novo.
export class ClosedCandles {
  constructor(sizeSec) {
    this.sizeMs = sizeSec * 1000;
    this.ticks = [];
    this.formingAt = null;
    this.formingClose = null;
    this.lastClosedAt = 0;
    this.closed5s = 0;
    this.signals = 0;
    this.skips = {};
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
    this.closed5s++;
    return bar;
  }
}

// ─── ESTADO (só o que decide algo; estatística sai dos resultados) ────────────
const WHITELIST = Object.entries(CONFIG.whitelist ?? {}).filter(([key]) => key !== '_desc');

function loadState() {
  let saved = {};
  try { if (P.state && fs.existsSync(P.state)) saved = JSON.parse(fs.readFileSync(P.state, 'utf8')); } catch { saved = {}; }
  const state = {};
  for (const [key, wl] of WHITELIST) {
    const old = saved?.[key] ?? {};
    state[key] = {
      key, name: wl.name, baseDirection: wl.direction,
      direction: old.direction === 'CALL' || old.direction === 'PUT' ? old.direction : wl.direction,
      ladder: Math.max(0, Math.min(Math.round(num(old.ladder, 0)), MAX_LEVELS)),
      cycleOps: 0,
      galeArmedAt: 0,
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
const inFlight = new Map();   // okey → operação em voo (várias por ativo)
const opsFor = (aid) => [...inFlight.values()].filter((o) => o.assetId === aid).sort((a, b) => a.sentAtMs - b.sentAtMs);
const openStake = () => [...inFlight.values()].reduce((sum, o) => sum + o.stake, 0);

// Casa uma mensagem da IQ com a operação local: pelo id da posição, depois pelo
// requestId da ordem e, por último, pela mais antiga do ativo (FIFO). É o que
// permite várias operações abertas no MESMO ativo sem trocar stake/P/L.
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
let currencySymbol = 'R$';   // ajustado para a moeda real da conta escolhida
let closedCount = 0;
let sessionStopLogged = false;
let lossStreakGlobal = 0;   // losses seguidos em QUALQUER ativo (zera no win)
let stopUntil = 0;          // circuit breaker: até quando o bot não abre ordem nova
let stopLogged = false;

const nowMs = () => ws?.serverNow() ?? Date.now();
const sessionLossLimit = () => (initialBalance > 0 ? round2(initialBalance * SESSION_LOSS_PCT / 100) : Infinity);
// Teto de exposição em % do saldo ATUAL: encolhe quando a conta encolhe.
const exposureLimit = () => (currentBalance > 0 ? round2(currentBalance * MAX_EXPOSURE_PCT / 100) : 0);
const skip = (buf, reason) => { if (buf) buf.skips[reason] = (buf.skips[reason] || 0) + 1; };
const WL_WR = Object.fromEntries(WHITELIST.map(([key, wl]) => [key, num(wl.wr, 0)]));
const shortName = (name) => String(name ?? '').replace('front.', '').replace('-OTC', '');
const symbolOf = (currency) => (currency === 'USD' ? 'US$' : currency === 'BRL' ? 'R$' : currency || 'R$');
const fmt = (value) => `${value >= 0 ? '+' : '-'}${currencySymbol}${Math.abs(value).toFixed(2)}`;
const saveState = () => { try { fs.writeFileSync(P.state, JSON.stringify(state, null, 2)); } catch {} };
const saveResults = () => { try { fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2)); } catch {} };

// ─── SINAL ────────────────────────────────────────────────────────────────────
export function detectRegime(ticks) {
  if (ticks.length < S.lookbackRegime) return { state: 'unknown', streak: 0 };
  let max = 0, cur = 0, last = 0;
  for (let i = Math.max(1, ticks.length - num(S.lookbackRegime, 20)); i < ticks.length; i++) {
    // Candle com preço igual não é sequência: mercado parado não pode virar 'trending'.
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

// Tendência do ativo: EMA8 (últimos 12 candles) contra EMA21 (últimos 40), em %
// do preço. direction=null → mercado lateral, e aí o bot NÃO entra.
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

// Quantos candles fechados seguidos andaram CONTRA a direção (0 = indo a favor agora).
export function reversalAgainst(ticks, direction) {
  if (!direction || ticks.length < 2) return 0;
  let streak = 0;
  for (let i = ticks.length - 1; i > 0; i--) {
    const against = direction === 'CALL' ? ticks[i].close < ticks[i - 1].close : ticks[i].close > ticks[i - 1].close;
    if (!against) break;
    streak++;
  }
  return streak;
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

// Núcleo puro da decisão (testável, sem rede e sem estado global).
//   1) REVERTER  → o preço andou contra a op aberta: manda vender o que perdeu e espera
//                  (NUNCA abre o lado oposto com op aberta no ativo)
//   2) ENTRADA   → pullback contra a tendência (4 candles contra + 1 de volta) + RSI
//   3) ADICIONAL → a tendência continua e o preço segue a favor (até maxOpsPerAsset)
// Devolve { skip } quando não entra, ou { kind, direction, reason } quando entra.
// cycleOps = quantas ordens já foram abertas neste ciclo (1 entrada + até 2 adicionais).
export function evaluateEntry({ ticks, open, trend, regime, rsi, now, cycleOps = 0, maxOpsPerAsset = MAX_OPS_PER_ASSET, gale = false }) {
  const openDir = open.length ? open[open.length - 1].direction : null;

  // 1) COM ORDEM ABERTA: só existe uma ação possível — VENDER se o preço reverteu.
  //    O bot NUNCA abre o lado oposto com ordem aberta no ativo (segurar CALL e PUT
  //    juntos é prejuízo estrutural) e nunca empilha outra ordem no mesmo candle: o
  //    gale só entra DEPOIS que a ordem anterior fechou.
  if (openDir) {
    if (AUTO_FLIP) {
      const against = reversalAgainst(ticks, openDir);
      if (against >= FLIP_REVERSAL_CANDLES) {
        return { kind: 'reverter', direction: openDir, reason: `reversão: ${against} candles fechados contra ${openDir}` };
      }
    }
    return { skip: 'semReversao' };
  }

  // Sem tendência definida o bot fica de fora: fade em mercado lateral é loteria.
  if (!trend.direction) return { skip: trend.source === 'dados' ? 'dados40' : 'lateral' };

  // CICLO DO GALE: 1 entrada + no máximo (maxOpsPerAsset - 1) gales. Estourou o teto, o
  // ativo só volta quando o ciclo fechar.
  if (cycleOps >= maxOpsPerAsset) return { skip: 'cicloFechado' };

  // Movimento já esticado bloqueia os dois caminhos.
  if (regime.state === 'trending') return { skip: 'regime' };

  // 2) GALE: a ordem anterior perdeu (ou foi vendida na reversão) e o bot volta no MESMO
  //    ativo para recuperar, no sentido da tendência NAQUELE momento. Não exige o pullback
  //    fechado — o mercado acabou de andar contra e a janela do gale é curta.
  // 3) ENTRADA: pullback contra a tendência (4 candles contra + 1 de volta) + RSI.
  if (!gale && fade4Signal(ticks, trend.direction) !== trend.direction) return { skip: 'semPullback' };
  if (trend.direction === 'CALL' && rsi > num(S.rsiCallMax, 50)) return { skip: 'rsi' };
  if (trend.direction === 'PUT' && rsi < num(S.rsiPutMin, 50)) return { skip: 'rsi' };
  return {
    kind: gale ? 'gale' : 'entrada',
    direction: trend.direction,
    reason: gale ? `gale após loss — tendência ${trend.source} ${trend.spreadPct}%` : `tendência ${trend.source} ${trend.spreadPct}%`,
  };
}

// Junta os dados do ativo com o núcleo puro acima. Devolve null quando não entra.
function planTrade(aid) {
  const b5 = buf5s.get(aid), b1 = buf1m.get(aid);
  if (!b5 || !b1) return null;
  // Dados insuficientes: separa o motivo para não esconder qual buffer está curto.
  if (b5.ticks.length < num(S.lookbackRegime, 20)) { skip(b5, 'dados5'); return null; }
  if (b1.ticks.length < num(S.min1mCandles, 1)) { skip(b5, 'dados1m'); return null; }
  if (!b5.readyLogged) {
    b5.readyLogged = true;
    console.log(`\n[📊] ${shortName(b5.name)} PRONTO: ${b5.ticks.length} candles 5s + ${b1.ticks.length} de 1min — avaliando sinais`);
  }

  const s = state[b5.key];
  const last = b5.ticks[b5.ticks.length - 1];
  if (!s || nowMs() - last.atMs > num(S.staleCandleMs, 30_000)) { skip(b5, 'feed'); return null; }

  const open = opsFor(aid);
  const now = nowMs();
  // O ciclo (1 entrada + gales) só FECHA quando a corrente acabou: ganhou, estourou o
  // teto de ordens, ou a janela do gale venceu sem uma nova ordem.
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
  const decision = evaluateEntry({ ticks: b5.ticks, open, trend, regime, rsi, now, cycleOps: s.cycleOps, gale });
  if (decision.skip) { skip(b5, decision.skip); return null; }
  return { direction: decision.direction, trend, rsi, kind: decision.kind, reason: decision.reason };
}

// Todas as travas de segurança numa função PURA (testável, sem estado global).
// Devolve o motivo do bloqueio ou null quando pode operar.
//   ladoOposto  → já existe op da outra direção no ativo (nunca ficar dos dois lados)
//   maxOps      → ativo já com o teto de ops do ciclo
//   sequencia   → circuit breaker: losses seguidos estouraram o limite
//   perdaSessao → a sessão perdeu o limite definido (nenhuma ordem nova até reiniciar)
// NÃO existe trava por número de ativos: todos operam ao mesmo tempo, cada um com o
// seu teto. O freio global é o teto de exposição.
export function evaluateGuards({
  open, direction, now, pausedUntil = 0, stopUntil = 0, lastOpAt = 0, lastResult = null,
  stake, balance = 0, exposure = 0, exposureLimit = Infinity,
  sessionLoss = 0, sessionLossLimit = Infinity,
}) {
  if (open.some((o) => o.direction !== direction)) return 'ladoOposto';
  if (open.length >= MAX_OPS_PER_ASSET) return 'maxOps';
  if (now < pausedUntil) return 'pausado';
  if (now < stopUntil) return 'sequencia';
  if (sessionLoss >= sessionLossLimit) return 'perdaSessao';
  if (!open.length && lastOpAt && now - lastOpAt < (lastResult === 'win' ? COOLDOWN_WIN_MS : COOLDOWN_LOSS_MS)) return 'cooldown';
  if (balance > 0 && stake > balance) return 'semSaldo';
  if (exposure + stake > exposureLimit) return 'exposicao';
  return null;
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
    sessionLoss: loss, sessionLossLimit: sessionLossLimit(),
  });
  if (reason) {
    if (reason === 'perdaSessao' && !sessionStopLogged) {
      sessionStopLogged = true;
      console.log(`\n[🛑 TRAVA DE PERDA] sessão ${fmt(-loss)} de ${currencySymbol}${sessionLossLimit().toFixed(2)} (${SESSION_LOSS_PCT}% do saldo inicial) → nenhuma ordem nova (reinicie para liberar)`);
    }
    if (reason === 'sequencia' && !stopLogged) {
      stopLogged = true;
      console.log(`\n[🛑 CIRCUIT BREAKER] ${STOP_AFTER_LOSSES} losses seguidos → nenhuma ordem nova por ${Math.round(STOP_PAUSE_MS / 60000)}min (as abertas fecham sozinhas)`);
    }
    skip(buf, reason);
    return null;
  }
  return s;
}

// ─── ORDEM ────────────────────────────────────────────────────────────────────
function maybeTrade(aid) {
  if (!warmupDone) return;
  const plan = planTrade(aid);
  if (!plan) return;
  // Reversão não abre nada: manda vender o que está perdendo e espera o ativo limpar.
  // Log limitado a 1 a cada 15s (senão imprime a cada candle enquanto o preço está contra).
  if (plan.kind === 'reverter') {
    sellReversed(aid, plan.reason);
    return;
  }
  const s = canTrade(aid, plan.direction);
  if (!s) return;

  const stake = ladderStake(s.ladder);
  if (!(stake > 0) || stake > MAX_STAKE) {
    s.pausedUntil = nowMs() + PAUSE_AFTER_MS;
    console.log(`[⛔ BLOQUEADO] ${shortName(s.name)} | stake ${currencySymbol}${stake} acima de ${currencySymbol}${MAX_STAKE} → pausa`);
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
  s.direction = plan.direction;   // última direção usada (informativo: a entrada vem da tendência)
  s.cycleOps = (s.cycleOps ?? 0) + 1;
  b5.signals++;

  ws.send('sendMessage', {
    body: {
      price: stake, active_id: aid, expired: expiration, direction: plan.direction.toLowerCase(),
      option_type_id: optionTypeId, user_balance_id: Number(balanceId),
    },
    name: 'binary-options.open-option', version: '1.0',
  }, requestId);

  saveResults();
  const tag = plan.kind === 'gale' ? ` (gale ${s.cycleOps}/${MAX_OPS_PER_ASSET} no ciclo)` : '';
  console.log(`\n[📤 ORDEM] ${b5.name} | ${plan.direction} | ${currencySymbol}${stake.toFixed(2)}${s.ladder ? ` (martingale ${s.ladder}/${MAX_LEVELS})` : ''}${tag} | ${plan.reason} | exp:${expiration}`);
}

// Depois de pedir uma venda, tudo o que a IQ manda nos 10s seguintes é impresso CRU.
// É assim que se descobre/confirma o nome real do evento de venda no socket.
let rawDumpUntil = 0;
const watchSellReplies = () => { rawDumpUntil = nowMs() + 10_000; };

// Venda antecipada: UMA regra só. O gatilho é a REVERSÃO que evaluateEntry detectou
// (N candles fechados contra a op aberta). Chamada a cada candle fechado com op em voo.
// Só dois casos NÃO vendem, porque vender seria pior que esperar:
//   - a op está no lucro (deixa vencer — vender antes devolve menos que o win);
//   - faltam menos de ES_MIN_REMAINING_MS (a IQ paga muito pouco no fim).
// A mensagem é 'sell-options' (iqoption-ws.mjs). Sem confirmação da IQ, repete a cada
// ES_RETRY_AFTER_MS até ES_MAX_ATTEMPTS.
function sellReversed(aid, reason) {
  const buf = buf5s.get(aid);
  const last = buf?.ticks[buf.ticks.length - 1];
  if (!last) return;
  const now = nowMs();
  let why = null;

  for (const op of opsFor(aid)) {
    if (!op.orderId) { why = 'a IQ ainda não confirmou a abertura'; continue; }
    const remainingMs = op.expiration * 1000 - now;
    if (remainingMs <= ES_MIN_REMAINING_MS) { why = 'fim da opção'; continue; }
    const adverse = op.direction === 'CALL' ? op.entryPrice - last.close : last.close - op.entryPrice;
    if (adverse <= 0) { why = 'ainda no lucro — deixa vencer'; continue; }
    if ((op.sellAttempts ?? 0) >= ES_MAX_ATTEMPTS) { why = `venda não confirmada (${ES_MAX_ATTEMPTS} tentativas)`; continue; }
    if (now - (op.lastSellAt ?? 0) < ES_RETRY_AFTER_MS) return;   // já pediu, aguardando

    op.sellAttempts = (op.sellAttempts ?? 0) + 1;
    op.lastSellAt = now;
    op.sellRequestId = ws.sellOption(op.orderId);
    watchSellReplies();
    console.log(`\n[✂️ VENDA] ${shortName(op.name)} | ${op.direction} | ${reason} | entrada ${op.entryPrice.toFixed(4)} → agora ${last.close.toFixed(4)} | restam ${Math.round(remainingMs / 1000)}s | tentativa ${op.sellAttempts}/${ES_MAX_ATTEMPTS}`);
    return;
  }

  if (why && now - (buf.lastRevertLogAt ?? 0) > 15_000) {
    buf.lastRevertLogAt = now;
    console.log(`\n[↩️ REVERSÃO] ${shortName(buf.name)} | ${reason} → NÃO vendeu: ${why}`);
  }
}

// Próximo estado da escada depois de um resultado. Função pura: não mexe no estado real.
//   loss  → sobe um degrau; escada cheia = pausa no ativo
//   win   → zera a escada; draw → zera a escada
// A direção NÃO é invertida por losses: quem manda na direção é a tendência do
// mercado (inverter contra ela era o que fazia o bot vender no meio de uma alta).
// event: 'pause' | 'win' | 'loss' | 'draw'
export function nextTradeState(s, result, now = Date.now()) {
  const next = {
    ladder: s.ladder, lossStreak: s.lossStreak, direction: s.direction,
    pausedUntil: s.pausedUntil, galeArmedAt: 0, event: result,
  };
  const cycleOps = Math.max(0, Math.round(num(s.cycleOps, 0)));

  if (result === 'loss') {
    next.lossStreak = s.lossStreak + 1;
    // GALE: perdeu e o ciclo ainda tem espaço → arma a próxima ordem no MESMO ativo
    // (é o martingale do dono: 1 entrada + no máximo 2 gales). Passou do teto, o ciclo
    // fecha e o ativo espera a corrente terminar.
    next.galeArmedAt = cycleOps < MAX_OPS_PER_ASSET ? now : 0;
    // Sem escada (levels = 0) o valor é FIXO na base: um loss não escala nada
    // nem pausa o ativo — o teto de ordens por ciclo é quem controla o ritmo.
    if (MAX_LEVELS > 0 && s.ladder >= MAX_LEVELS) {
      next.ladder = 0;
      next.lossStreak = 0;
      next.pausedUntil = now + PAUSE_AFTER_MS;
      next.event = 'pause';
    } else {
      next.ladder = Math.min(s.ladder + 1, MAX_LEVELS);
    }
  } else {
    // win/empate: o ciclo fechou, não existe gale pendente.
    next.ladder = 0;
    next.lossStreak = 0;
  }
  return next;
}

function applyResult(op, result, profit) {
  const s = state[op.key];
  if (!s) return;
  // Venda antecipada conta como loss na escada (foi uma perda, só menor)
  const forLadder = result === 'early' ? 'loss' : result;

  // Circuit breaker GLOBAL: losses seguidos em qualquer ativo param o bot por um
  // tempo. É o que impede a conta de sangrar 62 → 54 → 48 em uma sequência ruim.
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

  if (next.event === 'pause') {
    console.log(`\n[⏸ PAUSA] ${shortName(op.name)}: ${MAX_LEVELS + 1} losses seguidos → ${Math.round(PAUSE_AFTER_MS / 60000)}min`);
  }
  saveState();
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

// ─── LOGS ─────────────────────────────────────────────────────────────────────
let lastActivityLog = 0;
function activityLog(now) {
  if (now - lastActivityLog < 60_000) return;
  lastActivityLog = now;
  const lines = [...buf5s.entries()]
    .filter(([, buf]) => buf.closed5s > 0)
    .map(([id, buf]) => {
      const skips = Object.entries(buf.skips).filter(([, n]) => n > 0).map(([reason, n]) => `${reason}:${n}`).join(' ');
      const b1 = buf1m.get(Number(id));
      const p5 = `${buf.ticks.length}/${num(S.lookbackRegime, 20)}`;
      const p1 = `${b1?.ticks.length ?? 0}/${num(S.min1mCandles, 1)}`;
      const trend = trendDirection(buf.ticks);
      const dir = (trend.direction ?? 'lateral').padEnd(7);
      const pct = `${trend.spreadPct >= 0 ? '+' : ''}${trend.spreadPct.toFixed(2)}%`;
      return `  [${id}] ${shortName(buf.name).padEnd(12)} ${dir} ${pct.padStart(7)} | 5s:${p5} 1m:${p1} | ops:${opsFor(Number(id)).length} | ${buf.signals} sinais | blocos: ${skips || '-'}`;
    });
  console.log(`\n[📡] Atividade (candles 5s fechados no total: ${closedCount}):\n${lines.join('\n') || '  (nada ainda)'}\n`);
}

function statusLine() {
  const done = resultsList.filter((r) => r.result);
  const wins = done.filter((r) => r.result === 'win').length;
  const early = done.filter((r) => r.earlySell).length;
  const wr = done.length ? (wins / done.length * 100).toFixed(1) : '0.0';
  process.stdout.write(`\r[🕯️${closedCount}] [📊${done.length} W:${wins} L:${done.length - wins - early} ✂️${early} WR:${wr}% | 💰${currencySymbol}${(currentBalance - initialBalance).toFixed(2)} | ⏳${inFlight.size} ops ${currencySymbol}${openStake().toFixed(2)}]   `);
}

function summary() {
  const done = resultsList.filter((r) => r.result);
  const wins = done.filter((r) => r.result === 'win').length;
  const early = done.filter((r) => r.earlySell).length;
  console.log('\n\n🛑 RESULTADO FINAL:\n');
  console.log(`📊 Ops: ${done.length} | W: ${wins} | L: ${done.length - wins - early} | Cortadas na reversão: ${early} | WR: ${done.length ? (wins / done.length * 100).toFixed(1) : 0}% | Abertas: ${inFlight.size} | Gales: ${done.filter((r) => r.kind === 'gale').length}`);
  console.log(`💰 Lucro (bot): ${fmt(done.reduce((sum, r) => sum + (r.profit || 0), 0))}`);
  console.log(`💰 Lucro (real): ${fmt(currentBalance - initialBalance)}  ← inclui ${currencySymbol}${openStake().toFixed(2)} ainda em ${inFlight.size} op(ns) aberta(s)`);
  console.log(`💼 Saldo final: ${currencySymbol}${currentBalance.toFixed(2)}`);

  const byKey = {};
  for (const r of done) {
    byKey[r.key] ??= { wins: 0, total: 0, profit: 0, martingales: 0, extra: 0, early: 0 };
    byKey[r.key].total++;
    if (r.result === 'win') byKey[r.key].wins++;
    if (r.ladder > 0) byKey[r.key].martingales++;
    if (r.kind === 'gale') byKey[r.key].extra++;
    if (r.earlySell) byKey[r.key].early++;
    byKey[r.key].profit += r.profit || 0;
  }
  if (Object.keys(byKey).length) {
    console.log('\n📋 Por ativo:');
    for (const [key, d] of Object.entries(byKey)) {
      console.log(`   ${key.padEnd(14)} ${d.wins}/${d.total} (${(d.wins / d.total * 100).toFixed(0)}%) ${fmt(d.profit)} | escalada: ${d.martingales} | gales: ${d.extra} | cortes: ${d.early}`);
    }
  }
  saveResults();
  saveState();
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const ssid = await login();
  console.log('[LOGIN] OK!');
  ws = new IqWsClient();

  // Diagnóstico da venda: imprime CRU o que a IQ responde nos 10s depois de um pedido de
  // venda. Se algum dia a venda parar de funcionar, é aqui que aparece o motivo.
  ws.on('message', (m) => {
    if (nowMs() < rawDumpUntil) console.log(`[🔎 RESPOSTA IQ] ${m?.name} ${JSON.stringify(m?.msg).slice(0, 200)}`);
  });

  ws.on('ready', async () => {
    const rows = (await ws.getBalances())?.msg ?? [];
    console.log('[💼] Contas:');
    for (const b of rows) console.log(`  - ${b.type === 1 ? 'REAL' : b.type === 4 ? 'DEMO' : `TIPO${b.type}`}: ${symbolOf(b.currency)}${Number(b.amount).toFixed(2)} (id: ${b.id}, ${b.currency})`);

    let chosen;
    if (WANT_DEMO === true) chosen = rows.find((b) => b.type === 4);
    else if (WANT_DEMO === false) chosen = rows.find((b) => b.type === 1);
    else {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = () => new Promise((res) => rl.question('[?] 1 = REAL | 2 = DEMO: ', res));
      while (!chosen) {
        const answer = await ask();
        chosen = answer === '1' ? rows.find((b) => b.type === 1) : answer === '2' ? rows.find((b) => b.type === 4) : null;
        if (!chosen) console.log('[!] Digite 1 para REAL ou 2 para DEMO.');
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

    // Fail-closed: sem saldo para a stake base nenhuma ordem seria aceita pela IQ.
    if (initialBalance < BASE_STAKE) {
      console.error(`[ERRO] Saldo insuficiente na conta ${accountType}: ${currencySymbol}${initialBalance.toFixed(2)} < base ${currencySymbol}${BASE_STAKE.toFixed(2)}. Recarregue a conta.`);
      process.exit(1);
    }

    console.log(`\n[💼 CONTA] ${accountType} | id=${balanceId} | saldo ${currencySymbol}${initialBalance.toFixed(2)} (${chosen.currency})`);
    const stakeRule = MAX_LEVELS > 0
      ? `máx ${MAX_LEVELS + 1} entradas na sequência (base + ${MAX_LEVELS} martingale) — escada ${Array.from({ length: MAX_LEVELS + 1 }, (_, lv) => `${currencySymbol}${ladderStake(lv).toFixed(2)}`).join(' → ')}`
      : `STAKE FIXO ${currencySymbol}${BASE_STAKE.toFixed(2)} por ordem (sem martingale: nenhuma op passa da base)`;
    console.log(`[🧬 CÓDIGO] ${CODE_REV} sha256:${CODE_HASH} | confira este hash na tela: se for outro, é código velho rodando (reinicie o bot)`);
    console.log(`[🛡️ RISCO] ${stakeRule} | teto por ordem ${currencySymbol}${MAX_STAKE} | exposição máx ${MAX_EXPOSURE_PCT}% do saldo (${currencySymbol}${exposureLimit().toFixed(2)} agora)\n`);

    const turbo = ((await ws.getInitializationData())?.msg ?? {})?.turbo?.actives ?? {};
    if (LIST_ASSETS) for (const [id, act] of Object.entries(turbo)) if (act?.name) console.log(`  [${id}] ${act.name}`);

    // Casa a whitelist com o mercado turbo tolerando variações de nome (front./-OTC/maiúsculas).
    const running = [], missing = [];
    for (const [key, wl] of WHITELIST) {
      const wanted = new Set([normName(wl.name), normName(key)]);
      const found = Object.entries(turbo).find(([, act]) => act?.name && wanted.has(normName(act.name)));
      if (!found) { missing.push(wl.name); continue; }
      const aid = Number(found[0]);
      buf5s.set(aid, Object.assign(new ClosedCandles(num(S.candleSizeSeconds, 5)), { key, name: found[1].name, aid }));
      buf1m.set(aid, new ClosedCandles(60));
      running.push({ key, wl, aid, name: found[1].name });
    }
    console.log(`[📋] ${running.length}/${WHITELIST.length} ativos rodando (top WR):`);
    for (const a of running.sort((x, y) => WL_WR[y.key] - WL_WR[x.key])) {
      console.log(`   ${WL_WR[a.key].toFixed(1).padStart(5)}%  ${shortName(a.name).padEnd(12)} [${a.aid}] ref:${state[a.key].baseDirection} (entrada vem da tendência)`);
    }
    if (missing.length) console.log(`[⚠️] NÃO encontrados no mercado turbo: ${missing.join(', ')}`);
    console.log(`[⏳] warmup ${(num(S.warmupMs, 5_000) / 1000).toFixed(0)}s | DIREÇÃO = tendência (EMA8x21, mínimo ${TREND_MIN_SPREAD}%) | RSI CALL<=${num(S.rsiCallMax, 50)} / PUT>=${num(S.rsiPutMin, 50)} | regime bloqueia ${num(S.regimeStreakThreshold, 10)}+ candles iguais`);
    console.log(`[🧮 POSIÇÃO] TODOS os ativos operando ao mesmo tempo (sem limite de ativos) | ciclo por ativo: 1 entrada + até ${MAX_OPS_PER_ASSET - 1} gales (máx ${MAX_OPS_PER_ASSET} ordens), sempre no mesmo sentido | exposição máx ${MAX_EXPOSURE_PCT}% do saldo (${currencySymbol}${exposureLimit().toFixed(2)})`);
    console.log(`[♻️ GALE] loss/corte com o ciclo aberto → nova ordem no MESMO ativo em até ${Math.round(GALE_WINDOW_MS / 1000)}s, sem exigir pullback (o valor continua ${currencySymbol}${BASE_STAKE.toFixed(2)})`);
    console.log(`[🛑 FREIOS] reversão ${AUTO_FLIP ? `após ${FLIP_REVERSAL_CANDLES} candles contra → vende e espera (nunca abre o lado oposto com op aberta)` : 'off'} | circuit breaker ${STOP_AFTER_LOSSES} losses seguidos → ${Math.round(STOP_PAUSE_MS / 60000)}min parado | trava de perda da sessão ${SESSION_LOSS_PCT}% (${currencySymbol}${round2(initialBalance * SESSION_LOSS_PCT / 100)})`);
    console.log(`[✂️ VENDA] ON — ${FLIP_REVERSAL_CANDLES} candles fechados contra a ordem → manda vender na hora (mensagem sell-options) | não vende ordem no lucro nem nos últimos ${(ES_MIN_REMAINING_MS / 1000).toFixed(0)}s`);

    // Histórico: enche os buffers 5s/1min ANTES de operar. Sem isso o bot espera
    // ~2min (20 candles de 5s + 1 de 1min) para poder avaliar o primeiro sinal.
    // Sequencial de propósito: o cliente resolve 'candles' sem requestId, então
    // chamadas concorrentes receberiam a mesma resposta (corrida).
    const need5 = num(S.lookbackRegime, 20), need1 = num(S.min1mCandles, 1);
    const now0 = nowMs();
    const asc = (list) => (Array.isArray(list) ? list.slice().sort((x, y) => (toMs(x?.from ?? x?.at) ?? 0) - (toMs(y?.from ?? y?.at) ?? 0)) : []);
    const loaded = [];
    for (const a of running) {
      const row = { key: a.key, c5: 0, c1: 0, ok: true };
      try {
        const h5 = await ws.getCandlesHistory({ activeId: a.aid, size: num(S.candleSizeSeconds, 5), count: 120 });
        for (const c of asc(h5?.msg?.candles)) buf5s.get(a.aid).ingest(c, now0);
        const h1 = await ws.getCandlesHistory({ activeId: a.aid, size: 60, count: 30 });
        for (const c of asc(h1?.msg?.candles)) buf1m.get(a.aid).ingest(c, now0);
      } catch { row.ok = false; }
      row.c5 = buf5s.get(a.aid).ticks.length;
      row.c1 = buf1m.get(a.aid).ticks.length;
      loaded.push(row);
    }

    for (const a of running) { ws.subscribeCandles(a.aid, num(S.candleSizeSeconds, 5)); ws.subscribeCandles(a.aid, 60); }

    const ready = loaded.filter((r) => r.c5 >= need5 && r.c1 >= need1).length;
    console.log(`[🔁] Histórico: ${ready}/${running.length} ativos com dados suficientes (5s>=${need5} e 1m>=${need1})`);
    const short = loaded.filter((r) => r.c5 < need5 || r.c1 < need1);
    if (short.length) console.log('   ' + short.map((r) => `${r.key}: 5s ${r.c5}/${need5} 1m ${r.c1}/${need1}${r.ok ? '' : ' (falha)'}`).join(' | '));

    await new Promise((r) => setTimeout(r, num(S.warmupMs, 5_000)));
    warmupDone = true;
    console.log(`[✅] OPERANDO ${CODE_REV} — direção pela tendência, 1 entrada + até ${MAX_OPS_PER_ASSET - 1} gales por ativo, sinal só em candle fechado\n`);
  });

  ws.on('candle-generated', (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid = Number(raw.active_id ?? raw.activeId);
    const size = sizeOf(raw);
    if (!Number.isFinite(aid) || size === null) return;
    const now = nowMs();

    if (size === num(S.candleSizeSeconds, 5)) {
      const buffer = buf5s.get(aid);
      if (!buffer) return;
      if (buffer.ingest(raw, now)) { closedCount++; maybeTrade(aid); }
    } else if (size === 60) {
      buf1m.get(aid)?.ingest(raw, now);
    }
    activityLog(now);
  });

  ws.on('socket-option-opened', (msg) => {
    const raw = msg?.msg ?? msg;
    const op = findOp({
      aid: Number(raw?.active_id ?? raw?.activeId),
      requestId: msg?.request_id ?? raw?.request_id ?? null,
      orderId: raw?.id ?? null,
      preferPending: true,
    });
    if (!op) { console.log(`\n[⚠️ ABERTURA SEM ORDEM LOCAL] ${JSON.stringify(raw).slice(0, 200)}`); return; }
    op.orderId = raw?.id ?? msg?.request_id ?? null;   // id da posição (usado na venda)
    op.record.orderId = op.orderId;                   // fica gravado no resultados-v14.json
    const tag = op.kind === 'gale' ? ` | gale (${state[op.key]?.cycleOps ?? '?'}/${MAX_OPS_PER_ASSET} no ciclo)` : '';
    console.log(`[✅ ABERTA] ${shortName(op.name)} | ${op.direction} | ${currencySymbol}${op.stake.toFixed(2)} | id:${op.orderId} | exp:${raw?.expired ?? op.expiration}${tag}`);
  });

  // Venda antecipada confirmada pela IQ
  ws.on('sell-equal', async (msg) => {
    const raw = msg?.msg ?? msg;
    const positionId = Number(raw?.id ?? raw?.position_id ?? raw?.option_id);
    const op = findOp({ aid: Number(raw?.active_id ?? raw?.activeId), orderId: positionId });
    if (!op) { console.log(`[💰 VENDA] posição ${positionId} sem ordem local`); return; }
    inFlight.delete(op.okey);

    const received = Number(raw?.sell_profit ?? raw?.profit ?? raw?.amount);
    const profit = Number.isFinite(received) ? round2(received - op.stake) : 0;
    Object.assign(op.record, {
      result: 'early', profit, earlySell: true, sellProfit: Number.isFinite(received) ? received : null,
      profitSource: 'sell_profit_menos_stake', settledAt: new Date().toISOString(),
    });
    saveResults();
    applyResult(op, 'early', profit);
    await refreshBalance();
    statusLine();
    console.log(`\n[✂️ VENDIDA] ${shortName(op.name)} | ${op.direction} | devolvido ${currencySymbol}${Number.isFinite(received) ? received.toFixed(2) : '?'} de ${currencySymbol}${op.stake.toFixed(2)} | P/L: ${fmt(profit)}`);
  });

  ws.on('socket-option-closed', async (msg) => {
    const raw = msg?.msg ?? msg;
    const aid = Number(raw?.active_id ?? raw?.activeId);
    const op = findOp({
      aid,
      orderId: raw?.id ?? raw?.position_id ?? raw?.option_id ?? null,
      requestId: raw?.request_id ?? msg?.request_id ?? null,
    });
    if (!op) { console.log(`[❓ FECHAMENTO SEM ORDEM LOCAL] aid=${aid}`); return; }
    inFlight.delete(op.okey);

    // Se foi pedida uma venda e a IQ fechou do mesmo jeito, isso PRECISA aparecer: era o
    // sintoma de que a mensagem de venda estava sendo ignorada (close-position).
    if (op.sellAttempts) console.log(`\n[⚠️] ${shortName(op.name)} fechou sem a venda pedida (${op.sellAttempts}x) — a IQ não aceitou`);

    const { result, profit, source } = parseSettlement(raw, op);
    Object.assign(op.record, { orderId: op.orderId, result, profit, profitSource: source, settledAt: new Date().toISOString() });
    saveResults();
    applyResult(op, result, profit);
    await refreshBalance();
    statusLine();
    const emoji = result === 'win' ? '✅' : result === 'loss' ? '❌' : '➖';
    const tag = op.kind === 'gale' ? ' (gale)' : '';
    console.log(`\n[${emoji}] ${shortName(op.name)} | ${op.direction} | ${result.toUpperCase()} | P/L: ${fmt(profit)}${op.level ? ` (martingale ${op.level}/${MAX_LEVELS})` : ''}${tag} | abertas: ${opsFor(aid).length}`);
  });

  ws.on('close', () => {
    console.log('\n[WS] Conexão encerrada.');
    if (warmupDone) { summary(); process.exit(0); }
  });

  // Saldo fresco a cada minuto (o bot precisa saber se ainda dá para operar).
  setInterval(() => { refreshBalance(); }, 60_000);

  // Ordem recusada pela IQ não gera 'socket-option-closed': libera o ativo depois da expiração.
  setInterval(() => {
    const limit = Date.now() - (EXPIRATION_MIN * 60_000 + 60_000);
    for (const [okey, op] of inFlight) {
      if (op.record.sentAtMs < limit) {
        inFlight.delete(okey);
        console.log(`\n[⚠️] ${shortName(op.name)}: sem fechamento da IQ (ordem recusada?) — operação liberada`);
      }
    }
  }, 30_000);

  await ws.connect({ ssid });
}

process.on('SIGINT', () => { summary(); process.exit(0); });

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => { console.error('[FATAL]', err); process.exit(1); });
}
