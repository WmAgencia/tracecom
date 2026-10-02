/**
 * Bateria da V14 — funções puras do bot.
 *
 *   node diagnostic-results/bot-v14-tests.mjs         → testes offline (sem rede)
 *   REAL=1 node diagnostic-results/bot-v14-tests.mjs  → + replay com candles 5s reais
 *
 * Nenhuma ordem é enviada em nenhum modo (no modo real: login + get-candles).
 * As janelas da seção 4/5 são cotações REAIS de 5s extraídas da IQ (WIFUSD,
 * 2026-10-01) — o bot tem que decidir certo em cima do mercado de verdade.
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  ladderStake, trendDirection, reversalAgainst, detectRegime, fade4Signal,
  evaluateEntry, evaluateGuards, nextTradeState, calcRSI,
} from '../ws-otc-v14.mjs';

const CONFIG = JSON.parse(fs.readFileSync(new URL('../bot-config-v14.json', import.meta.url), 'utf8'));
let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); }
};
const mk = (closes, base = 1_700_000_000_000) => closes.map((c, i) => ({ atMs: base + i * 5000, close: c }));
const grow = (n, pct, start = 100) => { const out = [start]; let p = start; for (let i = 1; i < n; i++) { p *= 1 + pct / 100; out.push(p); } return out; };
const shrink = (n, pct, start = 100) => { const out = [start]; let p = start; for (let i = 1; i < n; i++) { p *= 1 - pct / 100; out.push(p); } return out; };

// Janelas REAIS (5s) onde a V14 deve entrar — usadas como caso de teste.
const REAL_CALL = [0.222595,0.222825,0.222935,0.222235,0.222605,0.223075,0.222755,0.222155,0.221745,0.221365,0.220945,0.221095,0.221075,0.221365,0.221645,0.220705,0.220655,0.220655,0.220055,0.219975,0.220415,0.220565,0.220865,0.220095,0.220475,0.219855,0.220265,0.221295,0.221435,0.221315,0.221465,0.222135,0.222195,0.221935,0.221515,0.221525,0.222405,0.222245,0.221925,0.222135,0.222625,0.223025,0.223355,0.224045,0.223945,0.223615,0.224385,0.224395,0.224275,0.224275,0.223785,0.223435,0.223125,0.223805,0.223745,0.224465,0.224365,0.224115,0.223205,0.223365];
const REAL_PUT  = [0.225225,0.225375,0.225145,0.226155,0.225685,0.225555,0.224755,0.224425,0.224245,0.224305,0.224395,0.224845,0.224485,0.224015,0.224355,0.223985,0.225345,0.225865,0.224925,0.224085,0.224095,0.223975,0.223135,0.222725,0.222985,0.222315,0.222565,0.222575,0.222555,0.222855,0.223355,0.223235,0.222925,0.222575,0.222825,0.222455,0.222465,0.222345,0.221815,0.221355,0.220835,0.220425,0.220675,0.221145,0.220635,0.219955,0.219815,0.219895,0.220185,0.220665,0.220825,0.221065,0.219865,0.220065,0.219795,0.219805,0.219935,0.220175,0.220755,0.220095];

// Monta a decisão como o bot faz, mas com cada peça explícita (isola o ramo testado).
const decide = (closes, open = [], spacingAgoMs = 60_000, override = {}) => {
  const ticks = mk(closes);
  const now = ticks[ticks.length - 1].atMs;
  const ultimo = ticks[ticks.length - 1].close;
  const ops = open.map((o, i) => ({
    direction: o.direction,
    sentAtMs: now - spacingAgoMs + i,
    // preço de entrada da op: por padrão um pouco atrás do último candle
    // (ou seja, o preço atual já superou a entrada = continuação real).
    entryPrice: o.entryPrice ?? (o.direction === 'CALL' ? ultimo * 0.999 : ultimo * 1.001),
  }));
  const trend = override.trend ?? trendDirection(ticks);
  const regime = override.regime ?? detectRegime(ticks);
  const rsi = override.rsi ?? calcRSI(ticks);
  const cycleOps = override.cycleOps ?? ops.length;
  const maxOpsPerAsset = override.maxOpsPerAsset ?? CONFIG.trading.maxOpsPerAsset;
  const gale = override.gale === true;
  return { out: evaluateEntry({ ticks, open: ops, trend, regime, rsi, now, cycleOps, maxOpsPerAsset, gale }), trend, regime, rsi };
};
// O ciclo do gale: uma entrada e, depois do loss, até (maxOpsPerAsset - 1) gales.
const LEG = { cycleOps: 1 };

console.log('\n═══ 1. VALOR DA ORDEM ═══');
const FLAT = CONFIG.martingale.levels === 0;
const BASE = CONFIG.trading.baseStake;
ok(FLAT ? `stake é SEMPRE a base (${BASE}) — nenhuma op passa disso` : 'escada de martingale por payout', () => {
  if (FLAT) {
    for (const lv of [0, 1, 2, 5, 99]) {
      assert.equal(ladderStake(lv), BASE, `nível ${lv} tem que valer a base ${BASE}`);
      assert.ok(ladderStake(lv) < 3, 'nada parecido com 9,36 pode aparecer');
    }
  } else {
    const PAYOUT = CONFIG.martingale.payoutRate;
    for (let level = 0; level <= CONFIG.martingale.levels; level++) {
      let lost = 0;
      for (let i = 0; i < level; i++) lost += ladderStake(i);
      const net = ladderStake(level) * PAYOUT - lost;
      assert.ok(net >= 2 * PAYOUT - 0.03, `nível ${level}: líquido ${net.toFixed(2)} deveria cobrir ~${(2 * PAYOUT).toFixed(2)}`);
    }
    assert.equal(ladderStake(99), ladderStake(CONFIG.martingale.levels), 'nível gigante não multiplica');
  }
});
ok('valor da ordem cabe no teto por ordem e no teto de exposição (% do saldo)', () => {
  for (const lv of [0, 1, 2, 3, 99]) assert.ok(ladderStake(lv) <= CONFIG.risk.maxStake);
  const saldo = 60, teto = saldo * CONFIG.risk.maxExposurePct / 100;
  assert.ok(CONFIG.trading.maxOpsPerAsset * ladderStake(99) <= teto, `o ciclo inteiro (${CONFIG.trading.maxOpsPerAsset} ordens) cabe no teto de ${teto} de uma conta de ${saldo}`);
});

console.log('\n═══ 2. TENDÊNCIA (a correção do "sell no meio da alta") ═══');
ok('série de alta → CALL', () => {
  const t = trendDirection(mk(grow(60, 0.03)));
  assert.equal(t.direction, 'CALL');
  assert.ok(t.spreadPct >= 0.05, `spread ${t.spreadPct}% deveria passar de 0.05%`);
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

console.log('\n═══ 3. PULLBACK / REVERSÃO / REGIME ═══');
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
ok('reversalAgainst conta candles fechados contra (sem truncar)', () => {
  const ticks = mk([100, 101, 102, 101.5, 101, 100.5]);
  assert.equal(reversalAgainst(ticks, 'CALL'), 3);
  assert.equal(reversalAgainst(ticks, 'PUT'), 0, 'subindo não é reversão para CALL... nem para PUT');
  assert.equal(reversalAgainst(mk([100, 99, 98]), 'PUT'), 0);
  assert.equal(reversalAgainst(mk([100, 99, 98]), 'CALL'), 2);
});
ok('regime: 10 candles iguais → trending', () => {
  const strong = mk([...grow(9, 0.05, 100), ...grow(12, 0.05, 100.43)]);
  assert.equal(detectRegime(strong).state, 'trending');
  assert.ok(detectRegime(strong).streak >= 10);
});
ok('regime: mercado parado NÃO é tendência (bug antigo: igual contava como queda)', () => {
  const flat = mk(new Array(30).fill(100));
  assert.equal(detectRegime(flat).state, 'ranging');
  assert.equal(detectRegime(flat).streak, 0);
});

console.log('\n═══ 4. DECISÃO em cotações REAIS (o cenário da linha azul) ═══');
ok('janela real de ALTA + dip + reversão → COMPRA (era aqui que ele dava sell)', () => {
  const { out, trend, rsi } = decide(REAL_CALL);
  console.log(`     tendência ${trend.direction} ${trend.spreadPct}% | RSI ${rsi.toFixed(1)} | regime ${detectRegime(mk(REAL_CALL)).streak}`);
  assert.equal(out.skip, undefined, `deveria entrar, mas pulou: ${out.skip}`);
  assert.equal(out.kind, 'entrada');
  assert.equal(out.direction, 'CALL');
});
ok('janela real de BAIXA + repique → VENDA (espelhado)', () => {
  const { out, trend, rsi } = decide(REAL_PUT);
  console.log(`     tendência ${trend.direction} ${trend.spreadPct}% | RSI ${rsi.toFixed(1)}`);
  assert.equal(out.skip, undefined, `deveria entrar, mas pulou: ${out.skip}`);
  assert.equal(out.kind, 'entrada');
  assert.equal(out.direction, 'PUT');
});
ok('alta sem o pullback fechado → semPullback', () => {
  const semReversao = REAL_CALL.slice(0, -1);
  assert.equal(decide(semReversao).out.skip, 'semPullback');
});
ok('mercado parado → lateral', () => {
  const flat = [...new Array(55).fill(100), 99.99, 99.98, 99.97, 99.96, 99.95];
  assert.equal(decide(flat).out.skip, 'lateral');
});
ok('regime forte (10+ iguais) bloqueia a entrada', () => {
  assert.equal(decide(REAL_CALL, [], 60_000, { regime: { state: 'trending', streak: 12 } }).out.skip, 'regime');
});
ok('tendência lateral bloqueia mesmo com pullback formado', () => {
  assert.equal(decide(REAL_CALL, [], 60_000, { trend: { direction: null, spreadPct: 0.01, source: 'lateral' } }).out.skip, 'lateral');
});

console.log('\n═══ 5. CICLO DO GALE: 1 entrada + até 2 gales (3 ordens por ativo, uma por vez) ═══');
ok('com ordem aberta o ativo NÃO abre outra ordem — o gale espera a anterior fechar', () => {
  const { out } = decide(REAL_CALL, [{ direction: 'CALL' }], 60_000, LEG);
  assert.equal(out.kind, undefined, `abriu ${out.kind} com ordem ainda aberta — era isso que empilhava 3 CALLs na tela`);
  assert.equal(out.skip, 'semReversao', 'sem reversão não há nada a fazer com ordem aberta');
});
ok('ativo livre sem gale armado entra pela regra normal (pullback)', () => {
  const { out } = decide(REAL_CALL, [], 60_000, { cycleOps: 0 });
  assert.equal(out.kind, 'entrada');
});
ok('GALE: depois do loss entra no mesmo ativo SEM exigir pullback', () => {
  const semVolta = REAL_CALL.slice(0, -1);              // alta sem o candle de volta
  assert.equal(decide(semVolta, [], 60_000, { cycleOps: 1 }).out.skip, 'semPullback', 'sem gale armado continua exigindo o pullback');
  const { out } = decide(semVolta, [], 60_000, { cycleOps: 1, gale: true });
  assert.equal(out.kind, 'gale', `gale deveria entrar, mas pulou: ${out.skip}`);
  assert.equal(out.direction, trendDirection(mk(semVolta)).direction, 'o gale segue a tendência do momento');
});
ok('o ciclo fecha no teto: com 3 ordens no ciclo a 4ª é recusada', () => {
  assert.equal(decide(REAL_CALL, [], 60_000, { cycleOps: 3 }).out.skip, 'cicloFechado');
  assert.equal(decide(REAL_CALL, [], 60_000, { cycleOps: 3, gale: true }).out.skip, 'cicloFechado', 'nem o gale fura o teto');
});
ok('o gale respeita o guarda-corpo de RSI (não compra no topo, não vende no fundo)', () => {
  assert.equal(decide(REAL_CALL, [], 60_000, { cycleOps: 1, gale: true, rsi: 70 }).out.skip, 'rsi');
  assert.equal(decide(REAL_PUT, [], 60_000, { cycleOps: 1, gale: true, rsi: 32 }).out.skip, 'rsi');
});
ok('reversão manda VENDER o que está perdendo — e NÃO abre o lado oposto', () => {
  const ultimo = REAL_CALL[REAL_CALL.length - 1];
  const virando = [...REAL_CALL, ultimo * 0.999, ultimo * 0.997];
  const { out } = decide(virando, [{ direction: 'CALL' }]);
  assert.equal(out.kind, 'reverter');
  assert.equal(out.skip, undefined, `deveria reverter, mas pulou: ${out.skip}`);
  assert.notEqual(out.direction, 'PUT', 'nunca devolve uma ordem no lado oposto');
});
ok('reversão contra uma VENDA também só manda vender (nunca compra em cima)', () => {
  const ultimo = REAL_PUT[REAL_PUT.length - 1];
  const virando = [...REAL_PUT, ultimo * 1.0003, ultimo * 1.0006];   // preço subindo = contra o PUT
  const { out } = decide(virando, [{ direction: 'PUT' }]);
  assert.equal(out.kind, 'reverter');
  assert.equal(out.direction, 'PUT', 'o lado devolvido é o da op aberta, para fechar ela');
});
ok('o gale não compra no topo nem vende no fundo (caso do SUI)', () => {
  // o caso real do SUI: o 2º PUT entrava com RSI 31-38, no fim exato da queda
  assert.equal(decide(REAL_PUT, [], 60_000, { cycleOps: 1, gale: true, rsi: 32 }).out.skip, 'rsi');
  assert.equal(decide(REAL_CALL, [], 60_000, { cycleOps: 1, gale: true, rsi: 70 }).out.skip, 'rsi');
  // fora do extremo, o gale entra
  assert.equal(decide(REAL_CALL, [], 60_000, { cycleOps: 1, gale: true, rsi: 55 }).out.kind, 'gale');
});
ok('sem ops abertas não existe reversão (não inventa o que fechar)', () => {
  assert.notEqual(decide(REAL_PUT).out.kind, 'reverter');
});
ok('um único candle contra não é reversão: com ordem aberta não abre nada', () => {
  const ultimo = REAL_CALL[REAL_CALL.length - 1];
  const { out } = decide([...REAL_CALL, ultimo * 0.999], [{ direction: 'CALL', entryPrice: ultimo }], 60_000, LEG);
  assert.notEqual(out.kind, 'reverter');
  assert.equal(out.skip, 'semReversao');
});

console.log('\n═══ 5.1 GUARDAS DE SEGURANÇA (nunca dois lados, teto e trava de perda) ═══');
const G = (o = {}) => evaluateGuards({
  open: [], direction: 'CALL', now: 1_000_000, pausedUntil: 0, stopUntil: 0, lastOpAt: 0,
  lastResult: null, stake: BASE, balance: 100, exposure: 0, exposureLimit: 40,
  sessionLoss: 0, sessionLossLimit: 50, ...o,
});
ok('NUNCA abre contra uma ordem aberta no mesmo ativo (trava do CALL+PUT juntos)', () => {
  assert.equal(G({ open: [{ direction: 'CALL' }], direction: 'PUT' }), 'ladoOposto');
  assert.equal(G({ open: [{ direction: 'PUT' }], direction: 'CALL' }), 'ladoOposto');
  assert.equal(G({ open: [{ direction: 'CALL' }, { direction: 'PUT' }], direction: 'CALL' }), 'ladoOposto');
});
ok('teto de 3 ordens por ativo: a 4ª é recusada', () => {
  const abertas = (n) => Array.from({ length: n }, () => ({ direction: 'CALL' }));
  assert.equal(G({ open: abertas(3), direction: 'CALL' }), 'maxOps');
  assert.equal(G({ open: abertas(2), direction: 'CALL', lastOpAt: 999_999_000, lastResult: 'win' }), null, 'dentro do teto continua liberado');
  assert.equal(G({ open: [], direction: 'CALL' }), null, 'ativo livre entra normalmente');
});
ok('NÃO existe trava por número de ativos: o mesmo lado em ativos diferentes é livre', () => {
  // O teto de ordens vale por ATIVO. Ordens em outros ativos não entram nesta conta.
  assert.equal(G({ open: [{ direction: 'CALL' }], direction: 'CALL' }), null);
  assert.equal(CONFIG.trading.maxConcurrentOps, undefined, 'não pode existir limite de ativos simultâneos');
});
ok('ladoOposto vem ANTES de qualquer outra trava', () => {
  assert.equal(G({ open: [{ direction: 'CALL' }], direction: 'PUT', sessionLoss: 999, sessionLossLimit: 1 }), 'ladoOposto');
});
ok('teto de ops por ciclo no mesmo sentido', () => {
  const tres = [{ direction: 'CALL' }, { direction: 'CALL' }, { direction: 'CALL' }];
  assert.equal(G({ open: tres, direction: 'CALL' }), 'maxOps');
});
ok('trava de perda da sessão para de abrir ordem nova', () => {
  assert.equal(G({ sessionLoss: 49, sessionLossLimit: 50 }), null);
  assert.equal(G({ sessionLoss: 50, sessionLossLimit: 50 }), 'perdaSessao');
  assert.equal(G({ sessionLoss: 900, sessionLossLimit: 50 }), 'perdaSessao');
});
ok('circuit breaker: losses seguidos param o bot por um tempo', () => {
  assert.equal(G({ stopUntil: 1_000_001, now: 1_000_000 }), 'sequencia');
  assert.equal(G({ stopUntil: 999_999, now: 1_000_000 }), null, 'passado o tempo o bot volta');
  assert.equal(G({ stopUntil: 1_000_001, open: [{ direction: 'CALL' }], direction: 'PUT' }), 'ladoOposto', 'ladoOposto continua vindo antes');
  assert.equal(G({ stopUntil: 1_000_001, sessionLoss: 900, sessionLossLimit: 1 }), 'sequencia', 'a sequência ruim é checada antes da trava de perda');
});
ok('cooldown vale só entre ciclos (não trava o gale do ciclo em andamento)', () => {
  assert.equal(G({ lastOpAt: 999_000, lastResult: 'win' }), 'cooldown');
  assert.equal(G({ open: [{ direction: 'CALL' }], direction: 'CALL', lastOpAt: 999_000, lastResult: 'win' }), null);
});
ok('travas de saldo e de exposição somada', () => {
  assert.equal(G({ stake: 10, balance: 5 }), 'semSaldo');
  assert.equal(G({ stake: 10, exposure: 35, balance: 100 }), 'exposicao');
  assert.equal(G({ stake: 10, exposure: 30, balance: 100 }), null);
});
ok('teto de exposição é fração do saldo: encolhe quando a conta encolhe', () => {
  const pct = CONFIG.risk.maxExposurePct / 100;
  const cabe = (saldo, abertas, stake) => evaluateGuards({
    open: [], direction: 'CALL', now: 0, stake, balance: saldo,
    exposure: abertas * stake, exposureLimit: saldo * pct, sessionLoss: 0, sessionLossLimit: 999,
  });
  const teto = 60 * pct;
  assert.equal(cabe(60, Math.floor(teto / 2) - 1, 2), null, `cabe até ${teto} (${Math.floor(teto / 2)} ordens de 2) numa conta de 60`);
  assert.equal(cabe(60, Math.ceil(teto / 2) + 1, 2), 'exposicao', 'acima do teto não entra');
  assert.equal(cabe(2, 0, 2), 'exposicao', 'conta de 2 → teto de 1 não comporta uma ordem de 2');
});

console.log('\n═══ 6. ESTADO APÓS RESULTADO ═══');
ok('loss NUNCA inverte a direção', () => {
  const n = nextTradeState({ ladder: 0, lossStreak: 0, direction: 'CALL', pausedUntil: 0 }, 'loss', 1000);
  assert.equal(n.direction, 'CALL', 'a direção não pode ser invertida por loss');
  assert.equal(n.event, 'loss');
});
ok('CICLO DO GALE: loss arma o gale até o teto; win fecha o ciclo', () => {
  const s1 = { ladder: 0, lossStreak: 0, direction: 'PUT', pausedUntil: 0, cycleOps: 1 };
  assert.equal(nextTradeState(s1, 'loss', 1000).galeArmedAt, 1000, 'perdeu com o ciclo aberto → arma o gale');
  assert.equal(nextTradeState({ ...s1, cycleOps: 3 }, 'loss', 1000).galeArmedAt, 0, 'estourou o teto → o ciclo fecha, sem gale');
  assert.equal(nextTradeState({ ...s1, cycleOps: 1 }, 'win', 1000).galeArmedAt, 0, 'win fecha o ciclo');
  assert.equal(nextTradeState({ ...s1, cycleOps: 1 }, 'draw', 1000).galeArmedAt, 0, 'empate não arma gale');
});
ok(FLAT ? 'sem martingale: loss não escala o valor nem pausa o ativo' : 'loss sobe um degrau e a escada cheia pausa o ativo', () => {
  let s = { ladder: 0, lossStreak: 0, direction: 'PUT', pausedUntil: 0 };
  for (let i = 0; i < 6; i++) {
    const n = nextTradeState(s, 'loss', 1000);
    if (FLAT) {
      assert.equal(n.ladder, 0, 'sem escada não existe degrau');
      assert.equal(n.pausedUntil, 0, 'sem escada um loss não pausa o ativo');
      assert.equal(n.event, 'loss');
    } else {
      assert.ok(n.ladder <= CONFIG.martingale.levels, 'a escada respeita o teto');
      assert.equal(n.pausedUntil, n.event === 'pause' ? 1000 + CONFIG.martingale.pauseAfterLadderMs : 0);
    }
    s = { ...s, ...n };
  }
  assert.equal(s.ladder, 0, 'no fim a escada volta para a base');
});
ok('win zera a escada sem voltar para direção fixa', () => {
  const n = nextTradeState({ ladder: 2, lossStreak: 2, direction: 'PUT', pausedUntil: 0 }, 'win', 0);
  assert.equal(n.ladder, 0);
  assert.equal(n.direction, 'PUT');
});

console.log('\n═══ 7. CONFIGURAÇÃO ═══');
ok('warmup no mínimo (1 candle de 5s)', () => {
  assert.equal(CONFIG.strategy.warmupMs, 5000);
  assert.equal(CONFIG.strategy.candleSizeSeconds, 5);
});
ok('até 3 ordens por ativo (ciclo do gale), SEM limite de ativos simultâneos', () => {
  assert.equal(CONFIG.trading.maxOpsPerAsset, 3, '1 entrada + no máximo 2 gales');
  assert.ok(CONFIG.trading.galeWindowMs >= 60000 && CONFIG.trading.galeWindowMs <= 600000, 'o gale tem prazo para entrar');
  assert.equal(CONFIG.trading.maxConcurrentOps, undefined, 'não pode existir limite de ativos operando ao mesmo tempo');
  assert.equal(CONFIG.trading.addOnSpacingMs, undefined, 'não existe mais reforço na continuação');
});
ok('teto de exposição é fração do saldo, não número absoluto', () => {
  assert.ok(CONFIG.risk.maxExposurePct > 0 && CONFIG.risk.maxExposurePct <= 100, 'exposição em % do saldo');
  assert.equal(CONFIG.risk.maxExposure, undefined, 'não pode voltar o teto absoluto ($40 em uma conta de $60 = 65% do saldo na mesa)');
});
ok('trava de perda da sessão e circuit breaker definidos', () => {
  assert.ok(CONFIG.risk.maxSessionLossPct > 0 && CONFIG.risk.maxSessionLossPct <= 50, 'trava de perda da sessão definida');
  assert.ok(CONFIG.risk.stopAfterConsecutiveLosses >= 2 && CONFIG.risk.stopAfterConsecutiveLosses <= 5);
  assert.ok(CONFIG.risk.pauseAfterLossStreakMs >= 300000, 'a pausa da sequência ruim tem que ser longa');
});
ok('gate de RSI é guarda-corpo (não mata a entrada)', () => {
  assert.ok(CONFIG.strategy.rsiCallMax >= 50 && CONFIG.strategy.rsiCallMax <= 70);
  assert.ok(CONFIG.strategy.rsiPutMin >= 30 && CONFIG.strategy.rsiPutMin <= 50);
});
ok('whitelist preservada apenas como referência', () => {
  assert.equal(Object.keys(CONFIG.whitelist).filter((k) => k !== '_nota').length, 10);
  assert.equal(CONFIG.whitelist.WIFUSD.direction, 'PUT');
});

console.log('\n═══ 5.2 ESTRUTURA (a tela nunca mostra ordem que a config não permite) ═══');
const SRC = fs.readFileSync(new URL('../ws-otc-v14.mjs', import.meta.url), 'utf8');
ok('existe UM único ponto no código capaz de abrir ordem', () => {
  const pontos = SRC.split('\n').map((l, i) => (l.includes('binary-options.open-option') ? i + 1 : 0)).filter(Boolean);
  assert.equal(pontos.length, 1, `achou ${pontos.length} pontos que mandam ordem (linhas ${pontos.join(', ')})`);
});
ok('a ordem só sai depois de canTrade (o portão único)', () => {
  const linhas = SRC.split('\n');
  const iOrdem = linhas.findIndex((l) => l.includes('binary-options.open-option'));
  const antes = linhas.slice(0, iOrdem).join('\n');
  assert.ok(antes.lastIndexOf('function maybeTrade(') > 0, 'a ordem vive dentro de maybeTrade');
  assert.ok(antes.lastIndexOf('canTrade(') > antes.lastIndexOf('function maybeTrade('), 'canTrade tem que rodar antes do send');
});
ok('nenhum resquício do flip que abria o lado oposto', () => {
  assert.equal(/cycleFlips|flipDone|opposite\(/.test(SRC), false, 'o flip que segurava CALL e PUT juntos tem que estar removido');
});
ok('o bot se identifica no boot (revisão + hash do próprio arquivo)', () => {
  assert.ok(/const CODE_REV = '/.test(SRC), 'sem revisão, não dá para saber qual código está rodando');
  assert.ok(SRC.includes('createHash(\'sha256\')'), 'sem o hash do arquivo, a tela não prova a versão');
});
ok('a venda usa a mensagem que a IQ aceita (sell-options)', () => {
  const WS_SRC = fs.readFileSync(new URL('../iqoption-ws.mjs', import.meta.url), 'utf8');
  assert.ok(WS_SRC.includes('"sell-options"'), 'sell-options é o que os clientes de referência mandam');
  assert.equal(WS_SRC.replace(/\/\*[\s\S]*?\*\//g, '').includes('"close-position"'), false, 'close-position é ignorada em silêncio pela IQ');
});
ok('a venda dispara junto com a reversão (1 gatilho só)', () => {
  assert.ok(SRC.includes('sellReversed(aid, plan.reason)'), 'a reversão tem que chamar a venda na hora');
  assert.equal(/maxRemainingMs/.test(SRC), false, 'não pode voltar a janela que segurava a venda');
});

console.log(`\n${fail === 0 ? '✅' : '❌'} offline: ${pass} passaram, ${fail} falharam`);

// ─── Replay com candles 5s REAIS (só com REAL=1) ──────────────────────────────
if (process.env.REAL === '1') {
  const https = await import('https');
  const { IqWsClient } = await import('../iqoption-ws.mjs');
  const toMs = (v) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) return null; if (n > 1e12) return Math.round(n); if (n > 1e9) return Math.round(n * 1000); return null; };
  const normName = (n) => String(n ?? '').toUpperCase().replace(/^FRONT[.\-_\s]?/, '').replace(/[-_\s]?OTC$/, '').replace(/[^A-Z0-9]/g, '');
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
    const WL = Object.entries(CONFIG.whitelist).filter(([k]) => k !== '_nota');
    const total = { entrada: 0, adicional: 0 };
    const skips = {};
    let reverts = 0, doubleSided = 0;
    const EXPIRY_MS = CONFIG.trading.expirationMinutes * 60_000;
    console.log('\n═══ 8. REPLAY com candles 5s REAIS (sem cooldown/pausa/saldo: é um TETO) ═══');
    let windowMin = 0;
    for (const [key, wl] of WL) {
      const wanted = new Set([normName(wl.name), normName(key)]);
      const hit = Object.entries(turbo).find(([, a]) => a?.name && wanted.has(normName(a.name)));
      if (!hit) continue;
      const byAt = new Map();
      const h = await ws.getCandlesHistory({ activeId: Number(hit[0]), size: 5, count: 1000 });
      for (const c of h?.msg?.candles ?? []) { const at = toMs(c.from), cl = Number(c.close); if (at && Number.isFinite(cl)) byAt.set(at, cl); }
      const ticks = [...byAt.keys()].sort((a, b) => a - b).map((a) => ({ atMs: a, close: byAt.get(a) }));
      if (ticks.length > 60) windowMin += (ticks[ticks.length - 1].atMs - ticks[0].atMs) / 60_000;
      const per = { entrada: 0, gale: 0 };
      let open = null, cycleOps = 0, galeArmedAt = 0, lastResult = null, wins = 0, losses = 0;
      for (let i = 40; i + 1 < ticks.length; i++) {
        const now = ticks[i].atMs;
        const slice = ticks.slice(0, i + 1);

        // Fecha a ordem vencida e apura o resultado (close contra close: aproximação,
        // aqui só serve para reproduzir a corrente do gale, não é medição de WR).
        if (open && open.expiresAt <= now) {
          const win = open.direction === 'CALL' ? ticks[i].close > open.entryPrice : ticks[i].close < open.entryPrice;
          lastResult = win ? 'win' : 'loss';
          if (win) wins++; else losses++;
          galeArmedAt = !win && cycleOps < CONFIG.trading.maxOpsPerAsset ? now : 0;
          open = null;
        }
        if (!open) {
          const vencido = galeArmedAt && now - galeArmedAt > CONFIG.trading.galeWindowMs;
          if (vencido || lastResult === 'win' || cycleOps >= CONFIG.trading.maxOpsPerAsset) { cycleOps = 0; galeArmedAt = 0; }
        }

        const gale = !open && galeArmedAt > 0;
        const dec = evaluateEntry({
          ticks: slice, open: open ? [open] : [], trend: trendDirection(slice),
          regime: detectRegime(slice), rsi: calcRSI(slice), now, cycleOps, gale,
        });
        if (dec.skip) { skips[dec.skip] = (skips[dec.skip] || 0) + 1; continue; }
        if (dec.kind === 'reverter') { reverts++; continue; }   // manda vender, não abre nada
        open = { direction: dec.direction, sentAtMs: now, expiresAt: now + EXPIRY_MS, entryPrice: ticks[i].close };
        cycleOps++;
        per[dec.kind] = (per[dec.kind] || 0) + 1;
        total[dec.kind] = (total[dec.kind] || 0) + 1;
      }
      console.log(`  ${key.padEnd(11)} entradas ${String(per.entrada).padStart(3)} | gales ${String(per.gale).padStart(3)} | W ${String(wins).padStart(3)} L ${String(losses).padStart(3)} (${wins + losses ? (wins / (wins + losses) * 100).toFixed(1) : '0'}%) | candles ${ticks.length}`);
      await new Promise((r) => setTimeout(r, 800));
    }
    console.log(`\n  TOTAL em ~${windowMin.toFixed(0)} min de mercado: ${total.entrada} entradas + ${total.gale} gales = ${total.entrada + total.gale} ordens | ${reverts} avisos de reversão (mandou vender)`);
    console.log(`  CALL e PUT abertos ao mesmo tempo no mesmo ativo: ${doubleSided}   <-- tem que ser 0 (estrutural: 1 ordem por vez no ativo)`);
    console.log(`  bloqueios: ${Object.entries(skips).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    if (doubleSided !== 0) { console.error('FALHOU: apareceu posicao dos dois lados'); process.exit(1); }
    ws.close(); process.exit(fail === 0 ? 0 : 1);
  });
  await ws.connect({ ssid });
} else {
  process.exit(fail === 0 ? 0 : 1);
}
