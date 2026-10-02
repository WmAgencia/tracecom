/**
 * OTC BOT v13 — SIMPLES E SEGURO
 * =============================================================================
 *  node ws-otc-v13.mjs demo           → opera na conta DEMO
 *  node ws-otc-v13.mjs real           → opera na conta REAL
 *  node ws-otc-v13.mjs                → pergunta a conta (1=REAL, 2=DEMO)
 *  node ws-otc-v13.mjs demo --ativos   → lista os ativos turbo disponíveis
 *
 *  - 1ª entrada de cada sequência: stake base fixo (R$2).
 *  - Martingale SÓ depois de loss, calculado pelo payout:
 *      stake = (perdido até agora + lucro da base) / payout
 *    → cobre o prejuízo e ainda fecha o lucro da operação base.
 *  - Máximo base + 2 martingales; se as 3 perderem, o ativo pausa.
 *  - Nenhuma ordem acima de risk.maxStake e 1 operação em voo por ativo.
 *  - Sinal só em candle FECHADO (atualização da vela em formação não gera ordem).
 */
import fs from 'fs';
import readline from 'readline';
import https from 'https';
import { pathToFileURL } from 'url';
import { IqWsClient, computeExpiration } from './iqoption-ws.mjs';

const CONFIG = JSON.parse(fs.readFileSync(new URL('./bot-config-v13.json', import.meta.url), 'utf8'));
const C  = CONFIG.trading ?? {};
const S  = CONFIG.strategy ?? {};
const M  = CONFIG.martingale ?? {};
const R  = CONFIG.risk ?? {};
const CD = CONFIG.cooldown ?? {};
const AF = CONFIG.autoFlip ?? {};
const P  = CONFIG.paths ?? {};
const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

const BASE_STAKE       = num(C.baseStake, 2);
const EXPIRATION_MIN   = num(C.expirationMinutes, 2);
const MAX_CONCURRENT   = num(C.maxConcurrentOps, 5);
const MAX_LEVELS       = Math.max(0, Math.round(num(M.levels, 2)));
const PAYOUT           = num(M.payoutRate, 0.86);
const MAX_STAKE        = num(R.maxStake, 20);
const PAUSE_AFTER_MS   = num(M.pauseAfterLadderMs, 600_000);
const COOLDOWN_WIN_MS  = num(CD.afterWinMs, 15_000);
const COOLDOWN_LOSS_MS = num(CD.afterLossMs, 5_000);
const AUTO_FLIP        = AF.enabled !== false;
const AUTO_FLIP_AFTER  = Math.max(1, Math.round(num(AF.afterLosses, 2)));
const REVERT_ON_WIN    = AF.revertOnWin !== false;

if (!(PAYOUT > 0 && PAYOUT < 1)) {
  console.error(`[FATAL] martingale.payoutRate inválido: ${PAYOUT}`);
  process.exit(1);
}

const ARG = process.argv[2]?.toLowerCase();
const WANT_DEMO = ARG === 'demo' ? true : ARG === 'real' ? false : null;
const LIST_ASSETS = process.argv.includes('--ativos');

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
const inFlight = new Map();   // aid → operação em voo (1 por ativo)
let ws = null;
let warmupDone = false;
let balanceId = null;
let initialBalance = 0;
let currentBalance = 0;
let accountType = 'DEMO';
let currencySymbol = 'R$';   // ajustado para a moeda real da conta escolhida
let closedCount = 0;
let flipCount = 0;

const nowMs = () => ws?.serverNow() ?? Date.now();
const opposite = (direction) => (direction === 'CALL' ? 'PUT' : 'CALL');
const skip = (buf, reason) => { if (buf) buf.skips[reason] = (buf.skips[reason] || 0) + 1; };
const WL_WR = Object.fromEntries(WHITELIST.map(([key, wl]) => [key, num(wl.wr, 0)]));
const shortName = (name) => String(name ?? '').replace('front.', '').replace('-OTC', '');
const symbolOf = (currency) => (currency === 'USD' ? 'US$' : currency === 'BRL' ? 'R$' : currency || 'R$');
const fmt = (value) => `${value >= 0 ? '+' : '-'}${currencySymbol}${Math.abs(value).toFixed(2)}`;
const saveState = () => { try { fs.writeFileSync(P.state, JSON.stringify(state, null, 2)); } catch {} };
const saveResults = () => { try { fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2)); } catch {} };

// ─── SINAL ────────────────────────────────────────────────────────────────────
function detectRegime(ticks) {
  if (ticks.length < S.lookbackRegime) return 'unknown';
  const moves = [];
  for (let i = ticks.length - S.lookbackRegime; i < ticks.length; i++) moves.push(ticks[i].close > ticks[i - 1].close ? 1 : -1);
  let max = 1, cur = 1;
  for (let i = 1; i < moves.length; i++) {
    if (moves[i] === moves[i - 1]) cur++; else cur = 1;
    if (cur > max) max = cur;
  }
  return max >= S.regimeStreakThreshold ? 'trending' : 'ranging';
}

function calcRSI(ticks, period = S.rsiPeriod) {
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

function fade4Signal(ticks, direction) {
  if (ticks.length < 5) return null;
  const last5 = ticks.slice(-5);
  const last4 = last5.slice(0, 4);
  const down4 = last4.every((c, i) => i === 0 || c.close < last4[i - 1].close);
  const up4 = last4.every((c, i) => i === 0 || c.close > last4[i - 1].close);
  if (down4 && last5[4].close > last5[3].close && direction === 'CALL') return 'CALL';
  if (up4 && last5[4].close < last5[3].close && direction === 'PUT') return 'PUT';
  return null;
}

function getSignal(aid) {
  const b5 = buf5s.get(aid), b1 = buf1m.get(aid);
  if (!b5 || !b1) return null;
  if (b5.ticks.length < S.lookbackRegime || b1.ticks.length < num(S.min1mCandles, 1)) { skip(b5, 'dados'); return null; }

  const s = state[b5.key];
  const last = b5.ticks[b5.ticks.length - 1];
  if (!s || nowMs() - last.atMs > num(S.staleCandleMs, 30_000)) { skip(b5, 'feed'); return null; }
  if (detectRegime(b5.ticks) === 'trending') { skip(b5, 'regime'); return null; }

  // Direção ativa do ativo (whitelist ou auto-flip depois de losses seguidos)
  const direction = fade4Signal(b5.ticks, s.direction);
  if (!direction) { skip(b5, 'semFade4'); return null; }

  const rsi = calcRSI(b5.ticks);
  if (direction === 'CALL' && rsi > num(S.rsiOverbought, 75)) { skip(b5, 'rsi'); return null; }
  if (direction === 'PUT' && rsi < num(S.rsiOversold, 25)) { skip(b5, 'rsi'); return null; }

  return { direction, rsi };
}

function canTrade(aid) {
  const buf = buf5s.get(aid);
  const s = state[buf?.key];
  if (!s || inFlight.has(aid)) { skip(buf, 'emVoo'); return null; }
  if (inFlight.size >= MAX_CONCURRENT) { skip(buf, 'lotado'); return null; }
  const now = nowMs();
  if (now < s.pausedUntil) { skip(buf, 'pausado'); return null; }
  if (s.lastOpAt && now - s.lastOpAt < (s.lastResult === 'win' ? COOLDOWN_WIN_MS : COOLDOWN_LOSS_MS)) { skip(buf, 'cooldown'); return null; }
  // Saldo insuficiente: a IQ recusaria a ordem (foi assim que o bot antigo travou com a conta zerada)
  if (currentBalance > 0 && ladderStake(s.ladder) > currentBalance) { skip(buf, 'semSaldo'); return null; }
  return s;
}

// ─── ORDEM ────────────────────────────────────────────────────────────────────
function maybeTrade(aid) {
  if (!warmupDone) return;
  const signal = getSignal(aid);
  if (!signal) return;
  const s = canTrade(aid);
  if (!s) return;

  const stake = ladderStake(s.ladder);
  if (!(stake > 0) || stake > MAX_STAKE) {
    s.pausedUntil = nowMs() + PAUSE_AFTER_MS;
    console.log(`[⛔ BLOQUEADO] ${shortName(s.name)} | stake ${currencySymbol}${stake} acima de ${currencySymbol}${MAX_STAKE} → pausa`);
    return;
  }

  const b5 = buf5s.get(aid);
  const { expiration, optionTypeId } = computeExpiration(Math.floor(nowMs() / 1000), EXPIRATION_MIN);
  const requestId = ws.uuid().replace(/-/g, '').slice(0, 12);
  const record = {
    assetId: aid, active: b5.name, key: s.key, direction: signal.direction, rsi: round2(signal.rsi),
    stake, ladder: s.ladder, flipped: s.direction !== s.baseDirection, expiration, requestId,
    sentAtMs: nowMs(), timestamp: new Date().toISOString(),
  };
  resultsList.push(record);
  inFlight.set(aid, { key: s.key, name: b5.name, direction: signal.direction, stake, level: s.ladder, expiration, record });
  s.lastOpAt = record.sentAtMs;
  b5.signals++;

  ws.send('sendMessage', {
    body: {
      price: stake, active_id: aid, expired: expiration, direction: signal.direction.toLowerCase(),
      option_type_id: optionTypeId, user_balance_id: Number(balanceId),
    },
    name: 'binary-options.open-option', version: '1.0',
  }, requestId);

  saveResults();
  console.log(`\n[📤 ORDEM] ${b5.name} | ${signal.direction} | ${currencySymbol}${stake.toFixed(2)}${s.ladder ? ` (martingale ${s.ladder}/${MAX_LEVELS})` : ''} | exp:${expiration}`);
}

// Próximo estado da escada/direção depois de um resultado. Função pura: não mexe no estado real.
//   loss  → sobe um degrau; a cada AUTO_FLIP_AFTER losses inverte a direção; cheio = pausa
//   win   → zera a escada e volta para a direção da whitelist; draw → zera a escada
// event: 'pause' | 'flip' | 'win' | 'loss' | 'draw'
export function nextTradeState(s, result, now = Date.now()) {
  const next = { ladder: s.ladder, lossStreak: s.lossStreak, direction: s.direction, pausedUntil: s.pausedUntil, event: result };

  if (result === 'loss') {
    if (s.ladder >= MAX_LEVELS) {
      next.ladder = 0;
      next.lossStreak = 0;
      next.pausedUntil = now + PAUSE_AFTER_MS;
      next.event = 'pause';
    } else {
      next.ladder = s.ladder + 1;
      next.lossStreak = s.lossStreak + 1;
      if (AUTO_FLIP && next.lossStreak >= AUTO_FLIP_AFTER) {
        next.direction = opposite(s.direction);
        next.lossStreak = 0;
        next.event = 'flip';
      }
    }
  } else {
    next.ladder = 0;
    next.lossStreak = 0;
    if (REVERT_ON_WIN) next.direction = s.baseDirection;
  }
  return next;
}

function applyResult(op, result, profit) {
  const s = state[op.key];
  if (!s) return;
  const next = nextTradeState(s, result);
  Object.assign(s, {
    ladder: next.ladder, lossStreak: next.lossStreak,
    direction: next.direction, pausedUntil: next.pausedUntil, lastResult: result,
  });

  if (next.event === 'pause') {
    console.log(`\n[⏸ PAUSA] ${shortName(op.name)}: ${MAX_LEVELS + 1} losses seguidos → ${Math.round(PAUSE_AFTER_MS / 60000)}min`);
  } else if (next.event === 'flip') {
    flipCount++;
    console.log(`\n[🔄 FLIP] ${shortName(op.name)}: ${AUTO_FLIP_AFTER} losses seguidos → agora ${s.direction} (base ${WL_WR[s.key].toFixed(1)}%)`);
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
      return `  [${id}] ${shortName(buf.name).padEnd(12)} ${state[buf.key]?.direction} (base ${WL_WR[buf.key].toFixed(1)}%) | ${buf.closed5s}c | ${buf.signals} sinais | blocos: ${skips || '-'}`;
    });
  console.log(`\n[📡] Atividade (candles 5s fechados no total: ${closedCount}):\n${lines.join('\n') || '  (nada ainda)'}\n`);
}

function statusLine() {
  const done = resultsList.filter((r) => r.result);
  const wins = done.filter((r) => r.result === 'win').length;
  const wr = done.length ? (wins / done.length * 100).toFixed(1) : '0.0';
  process.stdout.write(`\r[🕯️${closedCount}] [📊${done.length} W:${wins} L:${done.length - wins} WR:${wr}% | 💰${currencySymbol}${(currentBalance - initialBalance).toFixed(2)} | ⏳${inFlight.size}]   `);
}

function summary() {
  const done = resultsList.filter((r) => r.result);
  const wins = done.filter((r) => r.result === 'win').length;
  console.log('\n\n🛑 RESULTADO FINAL:\n');
  console.log(`📊 Ops: ${done.length} | W: ${wins} | L: ${done.length - wins} | WR: ${done.length ? (wins / done.length * 100).toFixed(1) : 0}% | Abertas: ${inFlight.size} | Auto-flips: ${flipCount}`);
  console.log(`💰 Lucro (bot): ${fmt(done.reduce((sum, r) => sum + (r.profit || 0), 0))}`);
  console.log(`💰 Lucro (real): ${fmt(currentBalance - initialBalance)}`);
  console.log(`💼 Saldo final: ${currencySymbol}${currentBalance.toFixed(2)}`);

  const byKey = {};
  for (const r of done) {
    byKey[r.key] ??= { wins: 0, total: 0, profit: 0, martingales: 0, flipped: 0 };
    byKey[r.key].total++;
    if (r.result === 'win') byKey[r.key].wins++;
    if (r.ladder > 0) byKey[r.key].martingales++;
    if (r.flipped) byKey[r.key].flipped++;
    byKey[r.key].profit += r.profit || 0;
  }
  if (Object.keys(byKey).length) {
    console.log('\n📋 Por ativo:');
    for (const [key, d] of Object.entries(byKey)) {
      console.log(`   ${key.padEnd(14)} ${d.wins}/${d.total} (${(d.wins / d.total * 100).toFixed(0)}%) ${fmt(d.profit)} | martingales: ${d.martingales} | flip: ${d.flipped}`);
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
    console.log(`[🛡️ RISCO] base ${currencySymbol}${BASE_STAKE.toFixed(2)} | máx ${MAX_LEVELS + 1} entradas (base + ${MAX_LEVELS} martingale) | payout ${(PAYOUT * 100).toFixed(0)}% | trava ${currencySymbol}${MAX_STAKE}`);
    console.log(`[🧮 ESCADA] ${Array.from({ length: MAX_LEVELS + 1 }, (_, lv) => `n${lv}=${currencySymbol}${ladderStake(lv).toFixed(2)}`).join(' → ')}\n`);

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
      ws.subscribeCandles(aid, num(S.candleSizeSeconds, 5));
      ws.subscribeCandles(aid, 60);
      running.push({ key, wl, aid, name: found[1].name });
    }
    console.log(`[📋] ${running.length}/${WHITELIST.length} ativos rodando (top WR):`);
    for (const a of running.sort((x, y) => WL_WR[y.key] - WL_WR[x.key])) {
      console.log(`   ${WL_WR[a.key].toFixed(1).padStart(5)}%  ${shortName(a.name).padEnd(12)} [${a.aid}] ${state[a.key].direction}`);
    }
    if (missing.length) console.log(`[⚠️] NÃO encontrados no mercado turbo: ${missing.join(', ')}`);
    console.log(`[⏳] warmup ${(num(S.warmupMs, 30_000) / 1000).toFixed(0)}s | RSI ${num(S.rsiOversold, 25)}/${num(S.rsiOverbought, 75)} | auto-flip ${AUTO_FLIP ? `após ${AUTO_FLIP_AFTER} losses` : 'off'} | máx ${MAX_CONCURRENT} ops simultâneas`);

    await new Promise((r) => setTimeout(r, num(S.warmupMs, 30_000)));
    warmupDone = true;
    console.log('[✅] OPERANDO (sinal só em candle fechado)\n');
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
    const op = inFlight.get(Number(raw?.active_id ?? raw?.activeId));
    if (op) console.log(`[✅ ABERTA] ${shortName(op.name)} | ${op.direction} | ${currencySymbol}${op.stake.toFixed(2)} | exp:${raw.expired ?? op.expiration}`);
  });

  ws.on('socket-option-closed', async (msg) => {
    const raw = msg?.msg ?? msg;
    const aid = Number(raw?.active_id ?? raw?.activeId);
    const op = inFlight.get(aid);
    if (!op) { console.log(`[❓ FECHAMENTO SEM ORDEM LOCAL] aid=${aid}`); return; }
    inFlight.delete(aid);

    const { result, profit, source } = parseSettlement(raw, op);
    Object.assign(op.record, { result, profit, profitSource: source, settledAt: new Date().toISOString() });
    saveResults();
    applyResult(op, result, profit);
    await refreshBalance();
    statusLine();
    const emoji = result === 'win' ? '✅' : result === 'loss' ? '❌' : '➖';
    console.log(`\n[${emoji}] ${shortName(op.name)} | ${op.direction} | ${result.toUpperCase()} | P/L: ${fmt(profit)}${op.level ? ` (martingale ${op.level}/${MAX_LEVELS})` : ''}`);
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
    for (const [aid, op] of inFlight) {
      if (op.record.sentAtMs < limit) {
        inFlight.delete(aid);
        console.log(`\n[⚠️] ${shortName(op.name)}: sem fechamento da IQ (ordem recusada?) — ativo liberado`);
      }
    }
  }, 30_000);

  await ws.connect({ ssid });
}

process.on('SIGINT', () => { summary(); process.exit(0); });

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => { console.error('[FATAL]', err); process.exit(1); });
}
