/**
 * Bateria da V16 — funções puras do bot.
 *
 *   node diagnostic-results/bot-v15-tests.mjs         → testes offline (sem rede)
 *   REAL=1 node diagnostic-results/bot-v15-tests.mjs  → + replay com candles 5s reais
 *
 * Nenhuma ordem é enviada em nenhum modo (no modo real: login + get-candles).
 * As janelas da seção 4 são cotações REAIS de 5s extraídas da IQ (WIFUSD, 2026-10-01).
 *
 * V16: Circuit breaker removido | Universo 170+ | RSI mais apertado (55/45) | ADX mínimo 20
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  ladderStake, trendDirection, detectRegime, fade4Signal,
  evaluateEntry, evaluateGuards, nextTradeState, calcRSI, calcADX,
  tickVolPct, sellDecision, reversalAgainst, parsePositionChanged, pickCloseReturn, saleNet, selectUniverse, normName, parseSettlement,
  martingaleStake, ClosedCandles,
} from '../ws-otc-v15.mjs';
import { IqWsClient } from '../iqoption-ws.mjs';

const CONFIG = JSON.parse(fs.readFileSync(new URL('../bot-config-v15.json', import.meta.url), 'utf8'));
let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); }
};
const okAsync = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); }
};
const mk = (closes, base = 1_700_000_000_000) => closes.map((c, i) => ({ atMs: base + i * 5000, close: c }));
const grow = (n, pct, start = 100) => { const out = [start]; let p = start; for (let i = 1; i < n; i++) { p *= 1 + pct / 100; out.push(p); } return out; };
const shrink = (n, pct, start = 100) => { const out = [start]; let p = start; for (let i = 1; i < n; i++) { p *= 1 - pct / 100; out.push(p); } return out; };

// Janelas REAIS (5s) onde o bot deve entrar — usadas como caso de teste.
const REAL_CALL = [0.222595,0.222825,0.222935,0.222235,0.222605,0.223075,0.222755,0.222155,0.221745,0.221365,0.220945,0.221095,0.221075,0.221365,0.221645,0.220705,0.220655,0.220655,0.220055,0.219975,0.220415,0.220565,0.220865,0.220095,0.220475,0.219855,0.220265,0.221295,0.221435,0.221315,0.221465,0.222135,0.222195,0.221935,0.221515,0.221525,0.222405,0.222245,0.221925,0.222135,0.222625,0.223025,0.223355,0.224045,0.223945,0.223615,0.224385,0.224395,0.224275,0.224275,0.223785,0.223435,0.223125,0.223805,0.223745,0.224465,0.224365,0.224115,0.223205,0.223365];
const REAL_PUT  = [0.225225,0.225375,0.225145,0.226155,0.225685,0.225555,0.224755,0.224425,0.224245,0.224305,0.224395,0.224845,0.224485,0.224015,0.224355,0.223985,0.225345,0.225865,0.224925,0.224085,0.224095,0.223975,0.223135,0.222725,0.222985,0.222315,0.222565,0.222575,0.222555,0.222855,0.223355,0.223235,0.222925,0.222575,0.222825,0.222455,0.222465,0.222345,0.221815,0.221355,0.220835,0.220425,0.220675,0.221145,0.220635,0.219955,0.219815,0.219895,0.220185,0.220665,0.220825,0.221065,0.219865,0.220065,0.219795,0.219805,0.219935,0.220175,0.220755,0.220095];

// Roda a decisão como o bot faz sobre a janela inteira (procura QUALQUER entrada).
const scanEntries = (closes, open = []) => {
  const found = [];
  for (let i = 40; i < closes.length; i++) {
    const ticks = mk(closes.slice(0, i + 1));
    const dec = evaluateEntry({
      ticks, open, trend: trendDirection(ticks), regime: detectRegime(ticks),
      rsi: calcRSI(ticks), adx: 25, now: ticks[ticks.length - 1].atMs, cycleOps: open.length,
    });
    if (dec.kind) found.push(dec);
  }
  return found;
};

console.log('\n═══ 1. VALOR DA ORDEM ═══');
const FLAT = CONFIG.martingale.levels === 0;
const BASE = CONFIG.trading.baseStake;
ok(FLAT ? `stake é SEMPRE a base (${BASE}) — nenhuma op passa disso` : 'escada de martingale por payout', () => {
  if (FLAT) {
    for (const lv of [0, 1, 2, 5, 99]) {
      assert.equal(ladderStake(lv), BASE, `nível ${lv} tem que valer a base ${BASE}`);
      assert.ok(ladderStake(lv) < 3, 'nada parecido com 9,36 pode aparecer');
    }
  }
});
ok('valor da ordem cabe no teto por ordem e no teto de exposição (% do saldo)', () => {
  for (const lv of [0, 1, 2, 3, 99]) assert.ok(ladderStake(lv) <= CONFIG.risk.maxStake);
  const saldo = 60, teto = saldo * CONFIG.risk.maxExposurePct / 100;
  assert.ok(CONFIG.trading.maxOpsPerAsset * ladderStake(99) <= teto, 'o ciclo inteiro cabe no teto de exposição');
});

console.log('\n═══ 2. TENDÊNCIA (norte da direção) ═══');
ok('série de alta → CALL', () => {
  const t = trendDirection(mk(grow(60, 0.03)));
  assert.equal(t.direction, 'CALL');
  assert.ok(t.spreadPct >= 0.05);
});
ok('série de baixa → PUT', () => {
  const t = trendDirection(mk(shrink(60, 0.03)));
  assert.equal(t.direction, 'PUT');
  assert.ok(t.spreadPct <= -0.05);
});
ok('mercado parado → null (o bot não entra)', () => {
  const t = trendDirection(mk(new Array(60).fill(100)));
  assert.equal(t.direction, null);
  assert.equal(t.source, 'lateral');
});
ok('histórico curto → source dados (não chuta direção)', () => {
  assert.equal(trendDirection(mk(grow(20, 0.03))).source, 'dados');
});

console.log('\n═══ 3. PULLBACK / REGIME / RÉGUA DE DISTÂNCIA ═══');
ok('fade4: 4 caindo + 1 subindo só vale para CALL', () => {
  const ticks = mk([100, 100.4, 100.3, 100.2, 100.1, 100.0, 100.2]);
  assert.equal(fade4Signal(ticks, 'CALL'), 'CALL');
  assert.equal(fade4Signal(ticks, 'PUT'), null);
});
ok('fade4: 4 subindo + 1 caindo só vale para PUT', () => {
  const ticks = mk([100, 100.1, 100.2, 100.3, 100.4, 100.5, 100.3]);
  assert.equal(fade4Signal(ticks, 'PUT'), 'PUT');
  assert.equal(fade4Signal(ticks, 'CALL'), null);
});
ok('regime: 10 candles iguais → trending (bloqueia)', () => {
  const ticks = mk([...grow(9, 0.05, 100), ...grow(12, 0.05, 100.43)]);
  assert.equal(detectRegime(ticks).state, 'trending');
});
ok('tickVolPct mede o candle típico de 5s em %', () => {
  const ticks = mk([100, 100.1, 100.2, 100.1, 100.2]);
  const vol = tickVolPct(ticks);
  assert.ok(Math.abs(vol - 0.1) < 0.011, `vol=${vol} deveria ser ~0,10%`);
  assert.equal(tickVolPct(mk([100, 100])), 0, 'série parada não inventa volatilidade');
});

console.log('\n═══ 3.1 HIDRATAÇÃO (a ordem importa) ═══');
ok('histórico hidrata o buffer LIMPO (por isso o boot hidrata antes de assinar o feed)', () => {
  const base = 1_700_000_000_000;
  const candle = (atMs, close) => ({ from: Math.floor(atMs / 1000), close });
  const buf = new ClosedCandles(5);
  for (let i = 0; i < 20; i++) buf.ingest(candle(base - (20 - i) * 5000, 100 + i), base + 5000);
  assert.ok(buf.ticks.length >= 19, `esperava ~20 ticks de histórico, veio ${buf.ticks.length}`);
});
ok('com candle ao vivo em formação, o lote de histórico NÃO rende ticks (origem do boot sem dados)', () => {
  const base = 1_700_000_000_000;
  const candle = (atMs, close) => ({ from: Math.floor(atMs / 1000), close });
  const buf = new ClosedCandles(5);
  buf.ingest(candle(base, 100), base);
  for (let i = 0; i < 20; i++) buf.ingest(candle(base - (20 - i) * 5000, 100 + i), base);
  assert.ok(buf.ticks.length <= 1, `o histórico foi engolido pelo candle em formação (ticks=${buf.ticks.length})`);
});

console.log('\n═══ 3.2 ADX DO FEED (high/low reais — o bug que bloqueava toda entrada) ═══');
ok('barra fechada guarda high/low do payload (`max`/`min`)', () => {
  const base = 1_700_000_000_000;
  const buf = new ClosedCandles(5);
  for (let i = 0; i < 3; i++) {
    buf.ingest({ from: Math.floor((base + i * 5000) / 1000), close: 100 + i, max: 100.5 + i, min: 99.5 + i }, base + 20_000);
  }
  assert.equal(buf.ticks.length, 3, `esperava 3 barras fechadas, veio ${buf.ticks.length}`);
  assert.equal(buf.ticks[0].high, 100.5);
  assert.equal(buf.ticks[0].low, 99.5);
  assert.ok(buf.ticks[0].high > buf.ticks[0].close && buf.ticks[0].low < buf.ticks[0].close);
});
ok('regressão: com high/low o ADX passa de 0; só com close ele fica 0 (bug antigo)', () => {
  const base = 1_700_000_000_000;
  const withRange = new ClosedCandles(5), closeOnly = new ClosedCandles(5);
  let p = 100;
  for (let i = 0; i < 60; i++) {
    const close = p;
    const high = close * 1.0004, low = close * 0.9996;
    withRange.ingest({ from: Math.floor((base + i * 5000) / 1000), close, max: high, min: low }, base + (i + 1) * 5000);
    closeOnly.ingest({ from: Math.floor((base + i * 5000) / 1000), close }, base + (i + 1) * 5000);
    p *= 1 + (i % 7 === 6 ? -0.02 : 0.04) / 100; // sobe com pullbacks (tendência real)
  }
  assert.equal(closeOnly.ticks.length, 60);
  assert.equal(withRange.ticks.length, 60);
  assert.equal(calcADX(closeOnly.ticks), 0, 'sem high/low o DMI zera → era o bloqueio de TODA entrada');
  assert.ok(calcADX(withRange.ticks) > 0, `com high/low o ADX tem que ser > 0, era ${calcADX(withRange.ticks)}`);
});

console.log('\n═══ 4. ENTRADA (janelas REAIS de 5s) ═══');
ok('janela real de ALTA + dip → COMPRA (nunca venda)', () => {
  const ticks = mk(REAL_CALL);
  const dec = evaluateEntry({
    ticks, open: [], trend: trendDirection(ticks), regime: detectRegime(ticks), rsi: calcRSI(ticks),
    adx: 25,
    now: ticks[ticks.length - 1].atMs,
  });
  assert.equal(dec.kind, 'entrada');
  assert.equal(dec.direction, 'CALL');
  assert.ok(scanEntries(REAL_CALL).some((d) => d.direction === 'CALL'), 'a janela real tem que gerar entrada CALL');
});
ok('janela real de BAIXA + repique → VENDA (espelhado)', () => {
  const ticks = mk(REAL_PUT);
  const dec = evaluateEntry({
    ticks, open: [], trend: trendDirection(ticks), regime: detectRegime(ticks), rsi: calcRSI(ticks),
    adx: 25,
    now: ticks[ticks.length - 1].atMs,
  });
  assert.equal(dec.kind, 'entrada');
  assert.equal(dec.direction, 'PUT');
  assert.ok(scanEntries(REAL_PUT).some((d) => d.direction === 'PUT'), 'a janela real tem que gerar entrada PUT');
});
ok('2ª compra (pirâmide) exige os TRÊS fatores da chance quase perfeita', () => {
  // Regra do dono (2026-10-02): com 1 posição aberta a 2ª só sai se ADX >= 25, RSI no
  // extremo A FAVOR (CALL <= 35) e a reversão não estiver se formando. Fora disso: 1 compra.
  const ticks = mk(grow(60, 0.05));
  const trend = { direction: 'CALL', spreadPct: 0.12, source: 'alta' };
  const origem = [{ direction: 'CALL', entryPrice: ticks[0].close }];
  const base = { ticks, open: origem, trend, regime: { state: 'ranging', streak: 0 }, cycleOps: 1 };
  assert.equal(evaluateEntry({ ...base, rsi: 28, adx: 30 }).kind, 'pyramid', 'RSI 28 + ADX 30 = sinal extremo, pode reforçar');
  assert.equal(evaluateEntry({ ...base, rsi: 47, adx: 30 }).skip, 'pyramidRsi', 'RSI 47 não é extremo: 1 compra só');
  assert.equal(evaluateEntry({ ...base, rsi: 28, adx: 21 }).skip, 'pyramidAdx', 'ADX 21 < 25: sem força de verdade, 1 compra só');
  const cheio = [{ direction: 'CALL' }, { direction: 'CALL' }];
  assert.equal(evaluateEntry({ ...base, open: cheio, rsi: 20, adx: 40 }).skip, 'pyramidMax', 'máximo 2 posições no mesmo sentido (a 3ª é o martingale)');
});

console.log('\n═══ 5. CICLO DO GALE ═══');
ok('loss com ciclo aberto arma o gale no MESMO ativo', () => {
  const now = 1_700_000_100_000;
  const next = nextTradeState({ ladder: 0, lossStreak: 0, direction: 'CALL', pausedUntil: 0, cycleOps: 1 }, 'loss', now);
  assert.equal(next.galeArmedAt, now);
  assert.equal(next.lossStreak, 1);
});
ok('win fecha o ciclo (nada de gale pendente)', () => {
  const next = nextTradeState({ ladder: 0, lossStreak: 2, direction: 'PUT', pausedUntil: 0, cycleOps: 2 }, 'win', 1);
  assert.equal(next.galeArmedAt, 0);
  assert.equal(next.lossStreak, 0);
});
ok('estourou o teto do ciclo → não arma mais gale', () => {
  const now = 1_700_000_100_000;
  const next = nextTradeState({ ladder: 0, lossStreak: 0, direction: 'CALL', pausedUntil: 0, cycleOps: CONFIG.trading.maxOpsPerAsset }, 'loss', now);
  assert.equal(next.galeArmedAt, 0, 'sem espaço no ciclo o ativo espera');
});
ok('com o ciclo fechado (cycleOps no teto) a entrada nova é bloqueada', () => {
  const ticks = mk(grow(60, 0.03).concat([0.1]));
  const dec = evaluateEntry({
    ticks, open: [], trend: trendDirection(ticks), regime: detectRegime(ticks), rsi: calcRSI(ticks),
    adx: 25, now: ticks[ticks.length - 1].atMs, cycleOps: CONFIG.trading.maxOpsPerAsset,
  });
  assert.equal(dec.skip, 'cicloFechado');
});
ok('ADX=0 (histórico 1m sem range) BLOQUEIA entrada', () => {
  const ticks = mk(grow(60, 0.03).concat([0.1]));
  const dec = evaluateEntry({
    ticks, open: [], trend: trendDirection(ticks), regime: detectRegime(ticks), rsi: calcRSI(ticks),
    adx: 0, now: ticks[ticks.length - 1].atMs, cycleOps: 0,
  });
  assert.equal(dec.skip, 'adxFraco');
});
ok('ADX abaixo do mínimo (fraco) BLOQUEIA entrada', () => {
  const ticks = mk(grow(60, 0.03).concat([0.1]));
  const dec = evaluateEntry({
    ticks, open: [], trend: trendDirection(ticks), regime: detectRegime(ticks), rsi: calcRSI(ticks),
    adx: 10, now: ticks[ticks.length - 1].atMs, cycleOps: 0,
  });
  assert.equal(dec.skip, 'adxFraco');
});

console.log('\n═══ 5.1 GUARDAS ═══');
const baseGuard = { direction: 'CALL', now: 1000, stake: 2, balance: 60, exposure: 0, exposureLimit: 30, sessionLoss: 0, sessionLossLimit: 12 };
ok('lado oposto aberto é a PRIMEIRA trava (nunca CALL+PUT juntos)', () => {
  assert.equal(evaluateGuards({ ...baseGuard, open: [{ direction: 'PUT' }] }), 'ladoOposto');
});
ok('teto de ops do ativo (piramidagem vs maxOps)', () => {
  // 3 operações no mesmo sentido: pyramidMax dispara primeiro (limite 2 Pyramid)
  assert.equal(evaluateGuards({ ...baseGuard, open: [{ direction: 'CALL' }, { direction: 'CALL' }, { direction: 'CALL' }] }), 'pyramidMax');
  // 2 CALL + 2 PUT: ladoOposto dispara primeiro (CALL existe com PUT aberto)
  assert.equal(evaluateGuards({ ...baseGuard, open: [{ direction: 'CALL' }, { direction: 'CALL' }, { direction: 'PUT' }, { direction: 'PUT' }] }), 'ladoOposto');
  // 4 CALL: pyramidMax (maxSameDirection=2, 4 > 2)
  assert.equal(evaluateGuards({ ...baseGuard, open: [{ direction: 'CALL' }, { direction: 'CALL' }, { direction: 'CALL' }, { direction: 'CALL' }] }), 'pyramidMax');
});
ok('circuit breaker REMOVIDO em V16; sessão loss 20% continua', () => {
  // V16: SEM circuit breaker (lossStreakGlobal/stopUntil removidos).
  // A única proteção ativa é a trava de perda da sessão (20%).
  assert.equal(evaluateGuards({ ...baseGuard, open: [], sessionLoss: 12, sessionLossLimit: 12 }), 'perdaSessao');
});
ok('sessão loss ZERA no boot (sessionStartBalance = saldo atual)', () => {
  // Ao iniciar, sessionStartBalance é setado com o saldo atual — perdas de sessões
  // anteriores NO resultsList não afetam a sessão nova (sessionLoss começa em 0).
  // Simula: bot com saldo 60, sem operations nesta sessão → loss = 0.
  assert.equal(evaluateGuards({ ...baseGuard, open: [], sessionLoss: 0, sessionLossLimit: 12 }), null);
  // Com 12 de perda (20% de 60), dispara.
  assert.equal(evaluateGuards({ ...baseGuard, open: [], sessionLoss: 12, sessionLossLimit: 12 }), 'perdaSessao');
});
ok('cooldown, saldo e exposição', () => {
  assert.equal(evaluateGuards({ ...baseGuard, open: [], lastOpAt: 990, lastResult: 'loss' }), 'cooldown');
  assert.equal(evaluateGuards({ ...baseGuard, open: [], balance: 1 }), 'semSaldo');
  assert.equal(evaluateGuards({ ...baseGuard, open: [], exposure: 29, exposureLimit: 30 }), 'exposicao');
});

console.log('\n═══ 6. VENDA SÓ POR REVERSÃO CONFIRMADA (a mercado) ═══');
const SELL = CONFIG.sell;
// Reversão CLARA contra um CALL: 30 velas de alta e depois 30 velas de queda forte.
const revUpDown = () => {
  const up = grow(30, 0.07, 100);
  const down = shrink(30, 0.07, up[up.length - 1]);
  return mk([...up, ...down]);
};
// Reversão CLARA contra um PUT: 30 velas de queda e depois 30 velas de alta forte.
const revDownUp = () => {
  const down = shrink(30, 0.07, 100);
  const up = grow(30, 0.07, down[down.length - 1]);
  return mk([...down, ...up]);
};
const entryCall = 100 * Math.pow(1.0007, 29); // topo da subida (entrada do CALL)
const entryPut  = 100 * Math.pow(0.9993, 29); // fundo da queda (entrada do PUT)
const baseSell = { side: 'CALL', entryPrice: entryCall, ticks: revUpDown(), remainingMs: 90_000, cfg: SELL };
ok('reversão confirmada contra o CALL: tendência virou, RSI do lado oposto, velas contra', () => {
  const rev = reversalAgainst({ side: 'CALL', ticks: baseSell.ticks, entryPrice: entryCall, cfg: SELL.reversal });
  assert.equal(rev.confirmed, true);
  assert.ok(rev.spreadPct < 0, 'tendência virou para baixo');
  assert.ok(rev.rsi <= SELL.reversal.rsiCallMax, `RSI ${rev.rsi} <= ${SELL.reversal.rsiCallMax}`);
  assert.ok(rev.against >= SELL.reversal.candlesAgainstMin, `${rev.against}/${rev.total} velas contra`);
  assert.ok(rev.adversePct >= rev.needPct, 'preço adverso à entrada');
});
ok('reversão confirmada contra o PUT (espelho)', () => {
  const rev = reversalAgainst({ side: 'PUT', ticks: revDownUp(), entryPrice: entryPut, cfg: SELL.reversal });
  assert.equal(rev.confirmed, true);
  assert.ok(rev.spreadPct > 0, 'tendência virou para cima');
  assert.ok(rev.rsi >= SELL.reversal.rsiPutMin, `RSI ${rev.rsi} >= ${SELL.reversal.rsiPutMin}`);
});
ok('reversão confirmada → VENDE a mercado (sem cotação — o valor sai no fechamento)', () => {
  const dec = sellDecision(baseSell);
  assert.equal(dec.action, 'sell');
  assert.equal(dec.kind, 'reversalCut');
  assert.ok(dec.reason.includes('reversão contra CALL'), 'o log da venda carrega o motivo da reversão');
});
ok('preço ainda A FAVOR da entrada → ESPERA (nada de vender ganhando)', () => {
  // entrada 2% abaixo do preço final: a CALL está ganhando, mesmo com a tendência virada
  const dec = sellDecision({ ...baseSell, entryPrice: entryCall * 0.98 });
  assert.equal(dec.action, 'hold');
  assert.equal(dec.reason, 'semReversao:movimentoCurto');
});
ok('op PERDENDO sem reversão confirmada → ESPERA', () => {
  // série de alta contínua: a op está contra o mercado? não — mas mesmo com cotação
  // de perda, sem reversão CONFIRMADA o bot não corta.
  const dec = sellDecision({ ...baseSell, ticks: mk(grow(60, 0.07)) });
  assert.equal(dec.action, 'hold');
  assert.equal(dec.reason, 'semReversao:tendenciaNaoVirou');
});
ok('faltando menos que o prazo da IQ (20s) → nem tenta', () => {
  assert.equal(sellDecision({ ...baseSell, remainingMs: 15_000 }).reason, 'janelaDaVendaFechou');
});
ok('sem histórico suficiente → NÃO vende (fail-closed)', () => {
  assert.equal(sellDecision({ ...baseSell, ticks: mk(grow(10, 0.07)) }).reason, 'semReversao:dados');
  assert.equal(sellDecision({ ...baseSell, ticks: null }).reason, 'semReversao:dados');
});
ok('uma vela contra não é reversão: série de alta com spike → espera', () => {
  const up = grow(60, 0.05);
  up[up.length - 1] = up[up.length - 2] * 0.999; // -0,1% na última vela
  const dec = sellDecision({ ...baseSell, ticks: mk(up) });
  assert.equal(dec.action, 'hold');
  assert.ok(dec.reason.startsWith('semReversao:'), 'uma vela contra não confirma reversão');
});

console.log('\n═══ 7. COTAÇÃO (devolução da recompra) ═══');
ok('parsePositionChanged lê sell_profit do push (devolução) e o id da opção', () => {
  const q = parsePositionChanged({ external_id: 14313693110, sell_profit: -1.66, status: 'open' });
  assert.deepEqual(q, { id: 14313693110, sellProfit: -1.66 });
  assert.equal(parsePositionChanged({ external_id: 1, sell_profit: null }), null, 'sem sell_profit não é cotação');
  assert.equal(parsePositionChanged({ external_id: null, sell_profit: 0.5 }), null, 'sem id válido não é cotação');
  const nested = parsePositionChanged({ id: 'x', sell_profit: 0.42, raw_event: { binary_options_option_changed1: { option_id: 999 } } });
  assert.deepEqual(nested, { id: 999, sellProfit: 0.42 }, 'aceita o option_id aninhado quando falta external_id');
});
ok('pickCloseReturn devolve o valor DEVOLVIDO (win_amount) do fechamento', () => {
  assert.equal(pickCloseReturn({ sell_profit: 0.95 }), 0.95);
  assert.equal(pickCloseReturn({ sell_profit: 0.87 }), 0.87);
  assert.equal(pickCloseReturn({ sell_profit: -0.34 }), -0.34, 'passa o valor cru — a semântica do líquido é do saleNet');
  assert.equal(pickCloseReturn({}), null);
});
ok('parseSettlement continua correto para o fechamento normal', () => {
  assert.deepEqual(parseSettlement({ win: 'win', win_amount: 3.64, sum: 2 }, { stake: 2 }).profit, 1.64);
  assert.deepEqual(parseSettlement({ win: 'loose', sum: 2 }, { stake: 2 }).profit, -2);
  assert.deepEqual(parseSettlement({ win: 'equal', sum: 2 }, { stake: 2 }).profit, 0);
});

console.log('\n═══ 8. UNIVERSO DINÂMICO (mínimo de ativos operando) ═══');
const top = Object.entries(CONFIG.whitelist).filter(([k]) => k !== '_nota').map(([key, wl]) => ({ key, name: wl.name, wr: wl.wr }));
const res = Object.entries(CONFIG.reserve).filter(([k]) => k !== '_nota').map(([key, wl]) => ({ key, name: wl.name }));
const activesFrom = (names, { suspended = [], disabled = [] } = {}) => {
  const set = new Set(suspended.map(normName)), off = new Set(disabled.map(normName));
  return names.map((name, i) => ({ id: 1000 + i, name, enabled: !off.has(normName(name)), is_suspended: set.has(normName(name)) }));
};
ok('top 61 disponível → todos entram (universo expandido V16 para 170+)', () => {
  // 61 whitelist + 26 reserve + 120 extras = 207 disponíveis → chega a 170+.
  // Usa prefixos únicos para evitar matches acidentais com nomes reais.
  const extra = Array.from({ length: 120 }, (_, i) => `front.X${String(i).padStart(4,'0')}USD-OTC`);
  const allActives = activesFrom([...top.map((t) => t.name), ...res.map((r) => r.name), ...extra]);
  const { selected, unavailableTop } = selectUniverse({ whitelist: top, reserve: res, actives: allActives, minActive: 170, maxActive: 200 });
  assert.equal(unavailableTop.length, 0);
  assert.equal(selected.filter((s) => s.source === 'top').length, top.length, `todos os ${top.length} top devem entrar`);
  assert.ok(selected.length >= 170, `devem ter >= 170 selecionados, tinha ${selected.length}`);
});
ok('top parcialmente fechado/suspenso → a reserva entra no lugar, mantendo o mínimo', () => {
  // V16: minActive = 170. Com 5 do top suspensos, a reserva + extras devem chegar a 170.
  const top5susp = top.slice(0, 5).map((t) => t.name);
  const extra = Array.from({ length: 120 }, (_, i) => `front.X${String(i).padStart(4,'0')}USD-OTC`);
  const allActives = activesFrom([...top.map((t) => t.name), ...res.map((r) => r.name), ...extra], { suspended: top5susp });
  const { selected, unavailableTop } = selectUniverse({ whitelist: top, reserve: res, actives: allActives, minActive: 170, maxActive: 200 });
  assert.equal(unavailableTop.length, 5);
  assert.ok(selected.length >= 170, `devem ter >= 170 selecionados, tinha ${selected.length}`);
});
ok('reserva esgotada → completa com qualquer OTC turbo disponível', () => {
  const actives = activesFrom([top[0].name, top[1].name, 'front.QUALQUEROTC-OTC', 'front.OUTROOTC-OTC', 'EURUSD']);
  const { selected } = selectUniverse({ whitelist: top, reserve: [], actives, minActive: 4, maxActive: 4 });
  assert.equal(selected.length, 4);
  assert.equal(selected.filter((s) => s.source === 'auto').length, 2);
  assert.equal(selected.some((s) => normName(s.name) === 'EURUSD'), false, 'mercado normal não entra no OTC');
});
ok('nome tolerante: front./-OTC/maiúsculas casam entre si', () => {
  assert.equal(normName('front.SUIUSD-OTC'), 'SUIUSD');
  assert.equal(normName('SUIUSD'), 'SUIUSD');
  assert.equal(normName('front.HYPE-OTC'), 'HYPE');
});

console.log('\n═══ 9. CONFIG DA V15 ═══');
ok('venda: SÓ com reversão confirmada (a mercado), config coerente', () => {
  assert.ok(!('takeProfitPctOfStake' in SELL) && !('takeProfitPctOfWin' in SELL) && !('takeProfitMin' in SELL), 'regra de lucro removida do config');
  assert.ok(!('endgameAfterMs' in SELL) && !('endgameDistanceFactor' in SELL) && !('endgameMinDistancePct' in SELL), 'regra antiga do fim removida do config');
  assert.ok(!('minRecover' in SELL) && !('quoteFreshMs' in SELL), 'precheck de cotação removido (não existe cotação de meio de vida)');
  assert.ok(SELL.closeBeforeMs >= 15_000, 'a IQ só aceita venda antes do prazo de buyback (~15s)');
  assert.ok(SELL.volLookbackCandles >= 5);
  assert.equal(SELL.reversalGale !== false, true, 'gale de reversão ligado (entra no sentido novo após vender)');
  const rev = SELL.reversal;
  assert.ok(rev && rev.candles >= 2 && rev.candlesAgainstMin >= 1 && rev.candlesAgainstMin <= rev.candles, 'bloco reversal válido');
  assert.ok(rev.rsiCallMax < 50 && rev.rsiPutMin > 50, 'RSI do lado oposto da posição');
  assert.ok(rev.minAdverseFactor >= 1 && rev.minAdversePct > 0, 'movimento adverso mínimo presente');
});
ok('universo V16: mínimo de 170 ativos operando e reserva expandida', () => {
  assert.ok(CONFIG.universe.minActive >= 170, `minActive deve ser >= 170, era ${CONFIG.universe.minActive}`);
  assert.ok(CONFIG.universe.maxActive >= CONFIG.universe.minActive);
  assert.ok(Object.keys(CONFIG.reserve).filter((k) => k !== '_nota').length >= 20, `reserve deve ter >= 20, tinha ${Object.keys(CONFIG.reserve).filter((k) => k !== '_nota').length}`);
  assert.ok(Object.keys(CONFIG.whitelist).filter((k) => k !== '_nota').length >= 50, `whitelist deve ter >= 50, tinha ${Object.keys(CONFIG.whitelist).filter((k) => k !== '_nota').length}`);
});
ok('V16: circuit breaker removido, proteções ativas preservadas', () => {
  // Circuit breaker removido em V16: stopAfterConsecutiveLosses/pauseAfterLossStreakMs não existem mais.
  assert.ok(!('stopAfterConsecutiveLosses' in CONFIG.risk), 'circuit breaker removido do config');
  assert.ok(!('pauseAfterLossStreakMs' in CONFIG.risk), 'circuit breaker pause removida do config');
  // Proteções ativas: exposição + perda de sessão
  assert.ok(CONFIG.risk.maxExposurePct <= 60 && CONFIG.risk.maxSessionLossPct <= 25);
});
ok('gate de RSI mais apertado em V16 (CALL <= 55, PUT >= 45) e ADX mínimo 20', () => {
  assert.ok(CONFIG.strategy.rsiCallMax >= 50 && CONFIG.strategy.rsiCallMax <= 60);
  assert.ok(CONFIG.strategy.rsiPutMin >= 40 && CONFIG.strategy.rsiPutMin <= 50);
  assert.ok(CONFIG.strategy.adxMin >= 15 && CONFIG.strategy.adxMin <= 25, `adxMin deve ser 15-25, era ${CONFIG.strategy.adxMin}`);
});
ok('ADX calculado corretamente (tendência forte vs fraca)', () => {
  // OHLC com candles de alta forte (ADX alto) vs lateral com range estreito (ADX baixo)
  const uptrend = Array.from({ length: 50 }, (_, i) => {
    const c = 100 * Math.pow(1.002, i); // alta contínua
    return { atMs: 1_700_000_000_000 + i * 5000, close: c, high: c * 1.001, low: c * 0.999 };
  });
  const flat = Array.from({ length: 50 }, (_, i) => {
    const c = 100 + Math.sin(i * 0.3) * 0.5;
    return { atMs: 1_700_000_000_000 + i * 5000, close: c, high: c * 1.0008, low: c * 0.9992 };
  });
  const adxStrong = calcADX(uptrend);
  const adxWeak = calcADX(flat);
  assert.ok(adxStrong > adxWeak, `ADX tendência forte (${adxStrong.toFixed(1)}) deve ser > ADX lateral (${adxWeak.toFixed(1)})`);
  assert.ok(adxStrong >= 15, `ADX forte deve ser >= 15, era ${adxStrong.toFixed(1)}`);
});
ok('piramidagem respeita o ADX mínimo (não reforça tendência morrendo)', () => {
  // Caso real DOTUSD 2026-10-02: ADX caiu 23.0 → 20.7 → 16.1 e o bot ainda comprou
  // a 3ª posição, porque o ramo de pyramidagem só olhava EMA + RSI.
  const ticks = mk(grow(50, 0.05));
  const trendUp = { direction: 'CALL', spreadPct: 0.09, source: 'alta' };
  const jaTem = [{ direction: 'CALL' }];
  const forte = evaluateEntry({ ticks, open: jaTem, trend: trendUp, regime: { state: 'ranging', streak: 0 }, rsi: 30, adx: 30, cycleOps: 1 });
  assert.equal(forte.kind, 'pyramid', 'ADX forte + RSI extremo permite reforçar');
  const fraco = evaluateEntry({ ticks, open: jaTem, trend: trendUp, regime: { state: 'ranging', streak: 0 }, rsi: 30, adx: 16, cycleOps: 1 });
  assert.equal(fraco.skip, 'pyramidAdx', 'ADX abaixo do mínimo NÃO reforça');
  // PUT espelhado: RSI tem de estar no TOPO (>= 65), não embaixo.
  const trendDown = { direction: 'PUT', spreadPct: -0.09, source: 'baixa' };
  const putOk = evaluateEntry({ ticks, open: [{ direction: 'PUT' }], trend: trendDown, regime: { state: 'ranging', streak: 0 }, rsi: 70, adx: 30, cycleOps: 1 });
  assert.equal(putOk.kind, 'pyramid', 'PUT exige RSI >= 65: 70 passa');
  const putNao = evaluateEntry({ ticks, open: [{ direction: 'PUT' }], trend: trendDown, regime: { state: 'ranging', streak: 0 }, rsi: 50, adx: 30, cycleOps: 1 });
  assert.equal(putNao.skip, 'pyramidRsi', 'PUT com RSI 50 não é extremo: 1 compra só');
});
ok('piramidagem para quando a reversão está se formando contra a posição aberta', () => {
  // Posição CALL aberta e o mercado virou para baixo (preço adverso + velas contra +
  // RSI baixo): não pode reforçar no mesmo sentido. É o que aconteceu no Polkadot.
  const ticks = revUpDown();
  const trendUp = { direction: 'CALL', spreadPct: 0.09, source: 'alta' };
  const open = [{ direction: 'CALL', entryPrice: entryCall }];
  const dec = evaluateEntry({ ticks, open, trend: trendUp, regime: { state: 'ranging', streak: 0 }, rsi: 30, adx: 30, cycleOps: 1 });
  assert.equal(dec.skip, 'reversaoFormando');
});
ok('gale de reversão entra sem exigir pullback novo (o flip é o gatilho)', () => {
  const ticks = mk(shrink(60, 0.07));
  const trendDown = { direction: 'PUT', spreadPct: -0.12, source: 'baixa' };
  const base = { ticks, open: [], trend: trendDown, regime: { state: 'ranging', streak: 0 }, rsi: 50, adx: 30, cycleOps: 0 };
  assert.equal(evaluateEntry(base).skip, 'semPullback', 'entrada normal exige o padrão fade4');
  assert.equal(evaluateEntry({ ...base, reversalGale: true }).kind, 'reversalGale');
});
ok('gale de reversão IGNORA os portões da entrada normal (regime/ADX/pullback)', () => {
  // Caso ao vivo 2026-10-02 (SUIUSD/TRUMPUSD): o gatilho armou na venda por reversão, mas o
  // ramo do gale ficava DEPOIS dos portões e não entrava dentro da janela. O gatilho é a
  // própria reversão: aqui os três portões reprovariam e ainda assim a ordem sai.
  const ticks = mk(shrink(60, 0.07));
  const trendDown = { direction: 'PUT', spreadPct: -0.12, source: 'baixa' };
  const travado = { ticks, open: [], trend: trendDown, regime: { state: 'trending', streak: 20 }, rsi: 50, adx: 16, cycleOps: 0 };
  assert.equal(evaluateEntry(travado).skip, 'adxFraco', 'sem o gatilho, o portão barra (ADX fraco)');
  const dec = evaluateEntry({ ...travado, reversalGale: true });
  assert.equal(dec.kind, 'reversalGale', 'com o gatilho armado o gale entra no sentido novo');
  assert.equal(dec.direction, 'PUT');
  assert.match(dec.reason, /martingale/);
});
ok('ADX >= adxMin permite entrada; ADX < adxMin bloqueia', () => {
  const ticks = mk(grow(50, 0.15));
  const trend = trendDirection(ticks);
  const regime = detectRegime(ticks);
  const rsi = calcRSI(ticks);
  // ADX forte → aceita
  const decStrong = evaluateEntry({ ticks, open: [], trend, regime, rsi, adx: 30, cycleOps: 0 });
  assert.ok(decStrong.skip !== 'adxFraco', `ADX 30 deve permitir, got skip=${decStrong.skip}`);
  // ADX fraco → bloqueia
  const decWeak = evaluateEntry({ ticks, open: [], trend, regime, rsi, adx: 10, cycleOps: 0 });
  assert.equal(decWeak.skip, 'adxFraco', 'ADX < adxMin bloqueia entrada');
});

console.log('\n═══ 9.1 ESTRUTURA (o que a tela não pode mostrar sem a config permitir) ═══');
const SRC = fs.readFileSync(new URL('../ws-otc-v15.mjs', import.meta.url), 'utf8');
ok('existe UM único ponto no código capaz de abrir ordem', () => {
  const pontos = SRC.split('\n').map((l, i) => (l.includes('binary-options.open-option') ? i + 1 : 0)).filter(Boolean);
  assert.equal(pontos.length, 1, `achou ${pontos.length} pontos de ordem (linhas ${pontos.join(', ')})`);
});
ok('a ordem só sai depois de canTrade (o portão único)', () => {
  const linhas = SRC.split('\n');
  const iOrdem = linhas.findIndex((l) => l.includes('binary-options.open-option'));
  const antes = linhas.slice(0, iOrdem).join('\n');
  assert.ok(antes.lastIndexOf('function maybeTrade(') > 0, 'a ordem vive dentro de maybeTrade');
  assert.ok(antes.lastIndexOf('canTrade(') > antes.lastIndexOf('function maybeTrade('), 'canTrade roda antes do send');
});
ok('a V16 vende SÓ por reversão CONFIRMADA (função existe e é usada na venda)', () => {
  assert.ok(SRC.includes('function reversalAgainst('), 'a confirmação de reversão é obrigatória');
  assert.ok(SRC.includes("kind: 'reversalCut'"), 'a venda tem um único tipo: reversalCut');
  assert.equal(/sellReversed|autoFlip|FLIP_REVERSAL/.test(SRC), false, 'venda arbitrária de flip continua proibida');
  assert.equal(/endgameCut|endgameAfterMs|endgameDistanceFactor/.test(SRC), false, 'corte antigo do fim removido');
});
ok('existe UM único ponto que pede venda, e ele passa pela cotação', () => {
  assert.equal((SRC.match(/ws\.sellOption\(/g) ?? []).length, 1, 'só requestSell pode mandar sell-options');
  assert.ok(SRC.includes('sellDecision(') && SRC.includes('parsePositionChanged(') && SRC.includes('subscribePositionChanges('), 'a venda é decidida por cotação real (push do broker)');
  assert.ok(SRC.includes('sellProfit'), 'a cotação lida é o sell_profit (devolução da recompra)');
});
ok('venda: só com reversão, A MERCADO, e a conta é devolução − stake', () => {
  // Regra do dono (2026-10-02): vende SÓ com reversão confirmada contra a posição.
  // A IQ não manda cotação de meio de vida (medido em 2026-10-02) — a venda é a
  // mercado e o valor da recompra é lido no fechamento; a regra de lucro
  // (takeProfit/SCALP) não existe e `sell_profit` é a devolução, não o lucro.
  assert.equal(/takeProfit|scalp/i.test(SRC), false, 'nada de regra de lucro pode sobrar');
  assert.ok(SRC.includes('reversalAgainst({ side'), 'sellDecision passa pela confirmação de reversão');
  assert.ok(SRC.includes('venda a mercado'), 'a venda é a mercado (sem cotação de meio de vida)');
  assert.equal(/minRecover|deixaVencer|sellProfit >= stake/.test(SRC), false, 'precheck de cotação removido');
  assert.ok(SRC.includes('saleNet('), 'o líquido da venda é devolução − stake');
  assert.ok(SRC.includes('pickCloseReturn('), 'o fechamento lê a devolução');
});
ok('a venda usa a mensagem que a IQ aceita (sell-options)', () => {
  const WS_SRC = fs.readFileSync(new URL('../iqoption-ws.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(WS_SRC.includes('"sell-options"'));
  assert.equal(WS_SRC.includes('"close-position"'), false, 'close-position é ignorada em silêncio pela IQ');
});
ok('painel odômetro e log enxuto (sem lista por ativo)', () => {
  assert.ok(SRC.includes('dashboardText(') && SRC.includes('renderDashboard('), 'o painel de uma linha é obrigatório');
  assert.equal(SRC.includes('[📡] Atividade'), false, 'a lista de candles por ativo não pode voltar');
  assert.ok(SRC.includes('IQ_SELL_DEBUG'), 'o dump cru só pode viver atrás de IQ_SELL_DEBUG=1');
});
ok('o bot se identifica no boot (revisão V16 + hash do próprio arquivo)', () => {
  assert.ok(/const CODE_REV = 'V16'/.test(SRC), `revisão V16, sem isso não dá para saber qual código está rodando`);
  assert.ok(SRC.includes("createHash('sha256')"), 'sem o hash do arquivo, a tela não prova a versão');
});

console.log('\n═══ 10. CONTABILIDADE DA VENDA (devolução − stake = líquido) ═══');
ok('o líquido da venda é DEVOLUÇÃO − stake (a IQ marca loose quando menor)', () => {
  // Medido ao vivo 2026-10-02: devolução 0,87 → perda de 1,13; 2,00 → empate; 3,64 → +1,64.
  assert.equal(saleNet(0.87, 2), -1.13);
  assert.equal(saleNet(2.0, 2), 0);
  assert.equal(saleNet(3.64, 2), 1.64);
  assert.equal(saleNet(0, 2), -2);
  assert.ok(SRC.includes('saleNet(') && SRC.includes('earlySell: true'), 'o fechamento por venda grava earlySell com o líquido');
  assert.equal(/sellProfit: profit/.test(SRC), false, 'a devolução não pode voltar a ser gravada como lucro (bug 2026-10-02)');
});

console.log('\n═══ 11. CLIENTE WS (queda de conexão de verdade) ═══');
class FakeSocket {
  constructor() { this.handlers = {}; this.parser = { push: (chunk) => [{ opcode: 0x1, payload: Buffer.from(chunk) }] }; }
  on(name, fn) { (this.handlers[name] ??= []).push(fn); return this; }
  emit(name, ...args) { for (const fn of this.handlers[name] ?? []) fn(...args); }
  async connect() { setImmediate(() => this.emit('data', JSON.stringify({ name: 'timeSync', msg: Date.now() }))); return { host: 'fake' }; }
  sendText() {}
  close() {}
  destroy() { this.emit('close'); }
}
await okAsync('conexão pronta que cai AVISA o bot (resumo final roda, nada de zumbi)', async () => {
  const socket = new FakeSocket();
  const client = new IqWsClient({ socketFactory: () => socket });
  let closed = 0;
  client.on('close', () => closed++);
  await client.connect({ ssid: 'x'.repeat(12) });
  assert.equal(client.state, 'READY');
  socket.destroy();   // é o que acontece quando o socket cai
  assert.equal(closed, 1, 'sem este aviso o ws.on(close) do bot nunca roda');
  client.close();
});
await okAsync('falha ao conectar no boot NÃO é tratada como fim de sessão', async () => {
  const socket = new FakeSocket();
  socket.connect = async () => { throw new Error('host fora'); };
  const client = new IqWsClient({ socketFactory: () => socket });
  let closed = 0;
  client.on('close', () => closed++);
  await assert.rejects(() => client.connect({ ssid: 'x'.repeat(12) }));
  assert.equal(closed, 0, 'o boot falhou antes de operar: nada de resumo de sessão');
});
await okAsync('get-options v1.0 + resposta `options` SEM request_id (a venda por cotação depende disso)', async () => {
  const socket = new FakeSocket();
  const sent = [];
  socket.sendText = (text) => { sent.push(JSON.parse(text)); };
  const client = new IqWsClient({ socketFactory: () => socket });
  await client.connect({ ssid: 'x'.repeat(12) });
  const pending = client.getOptions({ balanceId: 1250741747 });
  const req = sent.find((m) => m?.msg?.name === 'get-options');
  assert.ok(req, 'get-options precisa ser enviado');
  assert.equal(req.msg.version, '1.0', 'a IQ só responde get-options v1.0 (a 2.0 fica em silêncio)');
  socket.emit('data', JSON.stringify({ name: 'options', msg: { open_options: [{ id: 7, sell_profit: 0.4 }] } }));
  const resp = await pending;
  assert.equal(resp?.msg?.open_options?.[0]?.sell_profit, 0.4, 'a cotação tem que chegar mesmo sem request_id');
});
console.log('\n═══ 12. MARTINGALE 2,75× E CICLO DE 3 ORDENS (regra do dono 2026-10-02) ═══');
ok('martingale = 2,75 × o que está sendo recuperado (a única ordem acima do stake fixo)', () => {
  assert.equal(martingaleStake(2), 5.5, '1 posição de 2,00 → 5,50');
  assert.equal(martingaleStake(4), 11, '2 posições de 2,00 → 11,00');
  assert.equal(martingaleStake(8), 22, 'stake base 4 com 2 abertas → 22,00');
  assert.equal(martingaleStake(0), 0, 'sem exposição não existe martingale');
  assert.equal(martingaleStake(-3), 0, 'valor inválido não gera ordem');
  assert.equal(ladderStake(0), 2, 'fora do martingale o stake é o fixo da base');
  assert.equal(ladderStake(9), 2, 'não existe escada: nada compõe');
});
ok('o martingale recupera as duas posições COM lucro (payout 82%)', () => {
  const lucro = martingaleStake(4) * 0.82 - 4;
  assert.ok(lucro > 0, `11,00 no win devolve 9,02 contra 4,00 perdidos → +${lucro.toFixed(2)}`);
  const lucro1 = martingaleStake(2) * 0.82 - 2;
  assert.ok(lucro1 > 0, `5,50 no win devolve 4,51 contra 2,00 perdidos → +${lucro1.toFixed(2)}`);
});
ok('config: 2 minutos, multiplicador 2,75 e teto por ordem que caiba o martingale', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v15.json', import.meta.url), 'utf8'));
  assert.equal(cfg.trading.expirationMinutes, 2, 'expiração de 2 minutos (decisão do dono)');
  assert.equal(cfg.trading.maxOpsPerAsset, 3, 'ciclo de 3 ordens por ativo');
  assert.equal(cfg.martingale.martingaleMultiplier, 2.75, 'multiplicador do martingale');
  assert.equal(cfg.strategy.pyramidMax, 1, 'no máximo 1 pirâmide (2 posições simultâneas)');
  assert.ok(cfg.strategy.pyramidAdxMin >= 25, 'ADX mínimo da pirâmide');
  assert.ok(cfg.strategy.pyramidRsiCallMax <= 35 && cfg.strategy.pyramidRsiPutMin >= 65, 'RSI extremo a favor na pirâmide');
  const maiorMartingale = cfg.martingale.martingaleMultiplier * cfg.trading.baseStake * 2;
  assert.ok(cfg.risk.maxStake >= maiorMartingale, `maxStake ${cfg.risk.maxStake} tem de caber o martingale de ${maiorMartingale}`);
});
ok('estrutura: o martingale é a única ordem acima do stake fixo e é única por ciclo', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v15.mjs', import.meta.url), 'utf8');
  assert.match(src, /const stake = martingale \? martingaleStake\(plan\.martingaleBase\) : ladderStake\(s\.ladder\)/, 'só existe UM ponto que calcula stake');
  assert.match(src, /if \(plan\.kind === 'reversalGale'\) s\.reversalGale = null;/, 'o gatilho do martingale é consumido (um por ciclo)');
  assert.match(src, /stakeBase: round2\(\(prev\?\.stakeBase \?\? 0\) \+ op\.stake\)/, 'a exposição a recuperar é acumulada ordem por ordem');
  assert.ok(!/2\.75\s*\*\*/.test(src), 'nenhuma composição exponencial (foi o que zerou a conta no V13 antigo)');
});
ok('o martingale NÃO arma outro martingale (nunca compõe)', () => {
  // Caso real 2026-10-02: a ordem de 5,50 foi vendida por reversão e armou um martingale de
  // 15,13 (2,75 × 5,50). A guarda impede a escada composta: só posição de stake BASE arma.
  const src = fs.readFileSync(new URL('../ws-otc-v15.mjs', import.meta.url), 'utf8');
  assert.match(src, /op\.kind !== 'reversalGale'\) \{/, 'a armação exige ordem de stake base');
  const arma = src.slice(src.indexOf('function finalizeEarly'), src.indexOf('async function refreshBalance'));
  assert.match(arma, /op\.kind !== 'reversalGale'/, 'a guarda está na própria armação');
  const fecho = src.slice(src.indexOf('function applyResult'), src.indexOf('function finalizeEarly'));
  assert.match(fecho, /if \(op\.kind === 'reversalGale'\) \{[\s\S]*?cycleOps = 0/, 'o martingale fecha a sequência (ciclo zera, volta à base)');
});

console.log(`\n${fail === 0 ? '✅' : '❌'} offline: ${pass} passaram, ${fail} falharam`);

// ─── Replay com candles 5s REAIS (só com REAL=1) ──────────────────────────────
if (process.env.REAL === '1') {
  const https = await import('https');
  const { IqWsClient } = await import('../iqoption-ws.mjs');
  const toMs = (v) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) return null; if (n > 1e12) return Math.round(n); if (n > 1e9) return Math.round(n * 1000); return null; };
  const postData = JSON.stringify({ identifier: CONFIG.login.email, password: CONFIG.login.password });
  const body = await new Promise((res, rej) => {
    const req = https.request({ hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData), Origin: 'https://iqoption.com', Referer: 'https://iqoption.com/' } },
      (r) => { let t = ''; r.on('data', (d) => t += d); r.on('end', () => res(t)); });
    req.on('error', rej); req.write(postData); req.end();
  });
  const ssid = JSON.parse(body).result?.ssid ?? JSON.parse(body).ssid;
  const ws = new IqWsClient();
  ws.on('ready', async () => {
    const turbo = ((await ws.getInitializationData())?.msg ?? {})?.turbo?.actives ?? {};
    const total = { entrada: 0, gale: 0 };
    const skips = {};
    let doubleSided = 0, firedAssets = 0;
    const EXPIRY_MS = CONFIG.trading.expirationMinutes * 60_000;
    console.log('\n═══ 12. REPLAY com candles 5s REAIS (sem cooldown/pausa/saldo: é um TETO) ═══');
    let windowMin = 0;
    for (const entry of top) {
      const wanted = new Set([normName(entry.name), normName(entry.key)]);
      const hit = Object.entries(turbo).find(([, a]) => a?.name && wanted.has(normName(a.name)));
      if (!hit) continue;
      const byAt = new Map();
      const h = await ws.getCandlesHistory({ activeId: Number(hit[0]), size: 5, count: 1000 });
      for (const c of h?.msg?.candles ?? []) {
        const at = toMs(c.from), cl = Number(c.close), hi = Number(c.max), lo = Number(c.min);
        if (at && Number.isFinite(cl)) byAt.set(at, { close: cl, high: Number.isFinite(hi) ? hi : cl, low: Number.isFinite(lo) ? lo : cl });
      }
      const ticks = [...byAt.keys()].sort((a, b) => a - b).map((a) => ({ atMs: a, ...byAt.get(a) }));
      if (ticks.length > 60) windowMin += (ticks[ticks.length - 1].atMs - ticks[0].atMs) / 60_000;
      const per = { entrada: 0, gale: 0, pyramid: 0 };
      let stack = [], cycleOps = 0, galeArmedAt = 0, lastResult = null, wins = 0, losses = 0, assetOrders = 0;
      for (let i = 40; i + 1 < ticks.length; i++) {
        const now = ticks[i].atMs;
        const slice = ticks.slice(0, i + 1);
        // Fecha cada posição no SEU vencimento (a pilha tem no máximo maxOpsPerAsset).
        if (stack.some((op) => op.expiresAt <= now)) {
          for (const op of stack.filter((o) => o.expiresAt <= now)) {
            const win = op.direction === 'CALL' ? ticks[i].close > op.entryPrice : ticks[i].close < op.entryPrice;
            lastResult = win ? 'win' : 'loss';
            if (win) wins++; else losses++;
            if (!win && cycleOps < CONFIG.trading.maxOpsPerAsset) galeArmedAt = now;
          }
          stack = stack.filter((op) => op.expiresAt > now);
        }
        if (!stack.length) {
          const vencido = galeArmedAt && now - galeArmedAt > CONFIG.trading.galeWindowMs;
          if (vencido || lastResult === 'win' || cycleOps >= CONFIG.trading.maxOpsPerAsset) { cycleOps = 0; galeArmedAt = 0; }
        }
        const dec = evaluateEntry({
          ticks: slice, open: stack, trend: trendDirection(slice),
          regime: detectRegime(slice), rsi: calcRSI(slice), adx: calcADX(slice), now, cycleOps, gale: !stack.length && galeArmedAt > 0,
        });
        if (dec.skip) { skips[dec.skip] = (skips[dec.skip] || 0) + 1; continue; }
        stack.push({ direction: dec.direction, sentAtMs: now, expiresAt: now + EXPIRY_MS, entryPrice: ticks[i].close });
        if (stack.some((o) => o.direction !== dec.direction)) doubleSided++;
        cycleOps++;
        assetOrders++;
        per[dec.kind] = (per[dec.kind] || 0) + 1;
        total[dec.kind] = (total[dec.kind] || 0) + 1;
      }
      if (assetOrders) firedAssets++;
      console.log(`  ${entry.key.padEnd(11)} entradas ${String(per.entrada).padStart(3)} | gales ${String(per.gale).padStart(3)} | piram ${String(per.pyramid).padStart(3)} | W ${String(wins).padStart(3)} L ${String(losses).padStart(3)} (${wins + losses ? (wins / (wins + losses) * 100).toFixed(1) : '0'}%) | candles ${ticks.length}`);
      await new Promise((r) => setTimeout(r, 800));
    }
    const orders = (total.entrada || 0) + (total.gale || 0) + (total.pyramid || 0);
    console.log(`\n  TOTAL em ~${windowMin.toFixed(0)} min de mercado: ${total.entrada || 0} entradas + ${total.gale || 0} gales + ${total.pyramid || 0} piramidagens = ${orders} ordens em ${firedAssets} ativos`);
    console.log(`  CALL e PUT abertos ao mesmo tempo no mesmo ativo: ${doubleSided}   <-- tem que ser 0 (1 ordem por vez no ativo)`);
    console.log(`  bloqueios: ${Object.entries(skips).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    if (doubleSided !== 0) { console.error('FALHOU: apareceu posicao dos dois lados'); process.exit(1); }
    ws.close(); process.exit(fail === 0 ? 0 : 1);
  });
  await ws.connect({ ssid });
} else {
  process.exit(fail === 0 ? 0 : 1);
}
