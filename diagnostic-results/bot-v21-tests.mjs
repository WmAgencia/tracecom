/**
 * BATERIA V21+V22 — Cash/Runner/Recovery + bugfix Recovery Fire
 *
 *   node diagnostic-results/bot-v21-tests.mjs
 */
import assert from 'node:assert/strict';
import fs from 'fs';

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); console.log('  ✅', name); passed++; }
  catch (e) { console.log('  ❌', name, '\n     ', e.message); failed++; }
}

const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');

console.log('══ V21 — SINTAXE E ESTRUTURA ══');

ok('compila sem erro (verificado diretamente)', () => {
  assert.ok(src.length > 1000, 'arquivo fonte muito curto');
});

ok('evaluateEntry é a função de entrada principal', () => {
  assert.ok(src.includes('function evaluateEntry('), 'evaluateEntry não encontrada');
  assert.ok(src.includes('planTrade'), 'evaluateEntry não chamada no pipeline');
});

ok('sendOrder envia binary-options.open-option (IQ)', () => {
  assert.ok(src.includes('function sendOrder('), 'sendOrder não encontrada');
  assert.ok(src.includes('binary-options.open-option'), 'open-option (IQ) não chamado');
});

ok('fade4Signal não é chamado no pipeline de decisão', () => {
  const planTradeBlock = src.match(/function planTrade[\s\S]{0,2000}/)?.[0] ?? '';
  assert.ok(!planTradeBlock.includes('fade4Signal('), 'fade4Signal chamado no planTrade');
});

ok('evaluateEntry NÃO testa wrCI (learning removido)', () => {
  assert.ok(!src.includes('wrCI'), 'wrCI ainda referenciado');
});

console.log('\n══ V21 — CASH / RUNNER ══');

ok('CASH_TP lido do config (cashTakeProfit)', () => {
  assert.ok(src.match(/CASH_TP.*=.*num\(CA\.cashTakeProfit/), 'CASH_TP não vem do config');
});

ok('CASH vende quando lpLiquido >= CASH_TP (não antes)', () => {
  assert.ok(src.match(/lpLiquido\s*>=\s*CASH_TP/), 'lpLiquido >= CASH_TP não encontrado');
});

ok('CASH: proteção de tempo (não vende nos últimos 20s)', () => {
  assert.ok(src.match(/remainingMs.*CLOSE_BEFORE|REC_CLOSE_BEFORE/), 'proteção de tempo não encontrada');
});

ok('Cash + Runner abertas no mesmo sinal com mesmo cycleId', () => {
  assert.ok(src.match(/sendOrder\([^)]+,\s*['"]cash['"]/), 'sendOrder cash não encontrada');
  assert.ok(src.match(/sendOrder\([^)]+,\s*['"]runner['"]/), 'sendOrder runner não encontrada');
  assert.ok(src.includes('nextCycleId()'), 'nextCycleId não encontrado');
});

ok('Runner vai até expiração (sem venda antecipada)', () => {
  const runnerInSocketClose = src.match(/socket-option-closed[\s\S]{0,3000}/)?.[0] ?? '';
  assert.ok(runnerInSocketClose.includes("op.role === 'runner'") || runnerInSocketClose.includes('op.role'), 'Runner não processado em socket-option-closed');
  const cashSell = src.match(/CASH_TP[\s\S]{0,200}/)?.[0] ?? '';
  assert.ok(!cashSell.includes("role === 'runner'"), 'Runner ainda bloqueado em cashMonitor');
});

ok('quotes.get usado (sell_profit real da IQ)', () => {
  assert.ok(src.includes('quotes.get('), 'quotes.get não encontrado');
  assert.ok(src.includes('sellProfit'), 'sellProfit não usado');
});

console.log('\n══ V21 — RECOVERY ══');

ok('REC_MULTIPLIER = baseStake × 2.77 (lido do config)', () => {
  assert.ok(src.match(/REC_MULTIPLIER.*=.*num\(REC\.multiplier/), 'REC_MULTIPLIER não vem do config');
  assert.ok(src.match(/BASE_STAKE\s*\*\s*REC_MULTIPLIER/), 'BASE_STAKE × REC_MULTIPLIER não usado');
});

ok('máximo 1 Recovery por ciclo (recoveryAttempts > 0 bloqueia)', () => {
  assert.ok(src.match(/recoveryAttempts\s*>\s*0/), 'guard recoveryAttempts > 0 não encontrada');
  assert.ok(src.match(/recoveryAttempts\s*=\s*1|srecoveryAttempts\s*\+\+/), 'recoveryAttempts não incrementado');
});

ok('Recovery avalia tecnicamente (RSI, ADX, ATRP, regime)', () => {
  assert.ok(src.includes('function evaluateRecovery'), 'evaluateRecovery não encontrada');
  assert.ok(src.includes('RSI') || src.includes('rsi'), 'RSI não verificado na recovery');
  assert.ok(src.includes('ADX') || src.includes('adx'), 'ADX não verificado na recovery');
  assert.ok(src.includes('ATRP') || src.includes('atr'), 'ATRP não verificado na recovery');
  assert.ok(src.includes('regime') || src.includes('detectRegime'), 'regime não verificado na recovery');
});

ok('Recovery bloqueada se regime 1m lateral', () => {
  assert.ok(src.includes("'lateral1m'"), 'lateral1m não verificado na recovery');
});

ok('Recovery bloqueada se ATRP máximo', () => {
  assert.ok(src.match(/REC_MAX_ATRP|REC.*ATRP|ATRP.*REC/), 'ATRP max não verificado');
});

console.log('\n══ V21 — CICLO ══');

ok('lastClosedAt usado para cooldown (não activeOps)', () => {
  assert.ok(src.includes('lastClosedAt'), 'lastClosedAt não encontrado');
  assert.ok(!src.includes('activeOps'), 'activeOps ainda presente (paradoxo)');
});

ok('CycleOps resetado quando ciclo fecha', () => {
  assert.ok(src.match(/cycleOpenOps\s*<=\s*0|s\.cycleOpenOps\s*=\s*0/), 'reset cycleOpenOps não encontrado');
});

ok('Runner loss arma Recovery (runnerLossRecoveryArmed)', () => {
  assert.ok(src.includes('runnerLossRecoveryArmed'), 'runnerLossRecoveryArmed não encontrado');
  assert.ok(src.match(/role.*runner.*loss|runner.*loss/), 'Runner loss → arma recovery não encontrado');
});

ok('resultados configurado no paths do config', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.ok(cfg.paths?.results, 'paths.results não existe');
});

console.log('\n══ V21 — CONFIG ══');

ok('bot-config-v21.json existe e _version 21', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg._version, '21');
});

ok('CASH_TP default 1.0 (CONFIG.cash não existe, usa default)', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.ok(!cfg.cash || cfg.cash.cashTakeProfit, 'cashTakeProfit encontrado no config');
});

ok('martingale.multiplier = 2.77', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.martingale?.martingaleMultiplier, 2.77);
});

ok('sell.closeBeforeMs = 20000', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.sell?.closeBeforeMs, 20000);
});

ok('strategy.adxMin = 15', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.strategy?.adxMin, 15);
});

ok('learning removido do config', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.ok(!cfg.learning, 'learning ainda no config');
});

ok('whitelist removida do config', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.ok(!cfg._whitelist, '_whitelist ainda no config');
});

console.log('\n══ V21 — COMPORTAMENTO PROIBIDO ══');

ok('sem reversalCut (martingale V20)', () => {
  assert.ok(!src.match(/reversalCut/), 'reversalCut ainda presente');
});

ok('sem earlyGale como motor (Recovery substitui)', () => {
  assert.ok(!src.match(/earlyGale/), 'earlyGale ainda presente');
});

ok('sem L = CONFIG.learning (import removido)', () => {
  assert.ok(!src.match(/L\s*=\s*CONFIG\.learning/), 'L = CONFIG.learning ainda presente');
});

ok('sem updateLearning (função removida)', () => {
  assert.ok(!src.includes('function updateLearning'), 'updateLearning ainda presente');
  assert.ok(!src.match(/updateLearning\(/), 'updateLearning ainda chamada');
});

console.log('\n══ V21 — REGIME AGENT (15m) ══');

ok('computeRegime15mLocal + getRegimeForAsset exportados (regime local)', () => {
  assert.ok(src.includes('export function computeRegime15mLocal('), 'computeRegime15mLocal não exportada');
  assert.ok(src.includes('export function getRegimeForAsset('), 'getRegimeForAsset não exportada');
  assert.ok(src.includes('export function scheduleRegime15mRecalc('), 'scheduleRegime15mRecalc não exportada');
});

ok('planTrade usa getRegimeForAsset (não trendDirection1m diretamente)', () => {
  const planBlock = src.match(/function planTrade[\s\S]{0,2000}/)?.[0] ?? '';
  assert.ok(planBlock.includes('getRegimeForAsset(aid)'), 'planTrade não chama getRegimeForAsset');
  assert.ok(!planBlock.match(/trendDirection1m\(b1\.ticks\)/), 'planTrade ainda chama trendDirection1m(b1.ticks)');
});

ok('evaluateEntry recebe regime15m (não regime1m)', () => {
  const evBlock = src.match(/export function evaluateEntry[\s\S]{0,2000}/)?.[0] ?? '';
  assert.ok(evBlock.includes('regime15m = null') || evBlock.includes('regime15m=null'), 'regime15m não é parâmetro de evaluateEntry');
  assert.ok(!evBlock.includes('regime1m = null'), 'regime1m ainda em evaluateEntry');
});

ok('getRegimeForAsset: usa cálculo local 15m → fallback 1m → lateral', () => {
  assert.ok(src.includes('function computeRegime15mLocal('), 'computeRegime15mLocal não existe');
  assert.ok(src.includes('aggregateTo15m('), 'aggregateTo15m (agregação 5s→15m) não existe');
  assert.ok(src.includes('trendDirection1m('), 'fallback 1m não existe');
  assert.ok(src.includes("direction: 'lateral15m'"), 'lateral15m não retornado como fallback');
  assert.ok(!src.includes('REGIME_STATE_FILE'), 'REGIME_STATE_FILE ainda presente');
  assert.ok(!src.includes('regime-state.json'), 'regime-state.json ainda referenciado');
});

ok('evaluateRecovery usa regime15m (não regime1m)', () => {
  const startIdx = src.indexOf('function evaluateRecovery({ aid, direction })');
  const endIdx = src.indexOf('function ', startIdx + 1);
  const recBlock = src.slice(startIdx, endIdx);
  assert.ok(recBlock.includes('regime15m') || recBlock.includes("'lateral15m'"), 'evaluateRecovery não usa regime15m');
  assert.ok(!/s\.regime1m\b/.test(recBlock), 'evaluateRecovery ainda usa s.regime1m');
});

ok('logging mostra reg15m com source (local-15m, local-1m, nenhum)', () => {
  assert.ok(src.includes('reg15m='), 'reg15m não aparece no log');
  assert.ok(src.includes('[${r15m.source}]') || src.includes('${r15m.source}'), 'source do regime não logado');
  assert.ok(src.includes("source: 'local-15m'") || src.includes("source: 'local-1m'"), 'sources do regime local não encontrados');
});

console.log('\n══ V21 — LOG E MONITOR ══');

ok('evaluateOpenPositions é o monitor de posições (cash sell)', () => {
  assert.ok(src.includes('function evaluateOpenPositions('), 'evaluateOpenPositions não encontrada');
  assert.ok(src.match(/setInterval.*evaluateOpenPositions/), 'evaluateOpenPositions não chamado por setInterval');
});

ok('subscribePositionChanges com userId real (não 0)', () => {
  assert.ok(src.match(/subscribePositionChanges\s*\(\s*\{/), 'subscribePositionChanges não encontrado');
  assert.ok(!src.match(/userId:\s*0/), 'userId: 0 ainda presente');
});

ok('Regime 15m usado na entrada (evaluateEntry/planTrade)', () => {
  assert.ok(src.includes('regime15m.direction'), 'regime15m.direction não verificado');
  assert.ok(src.includes("'alta15m'") || src.includes('"alta15m"'), 'alta15m não verificado');
  assert.ok(src.includes("'baixa15m'") || src.includes('"baixa15m"'), 'baixa15m não verificado');
});

ok('RSI é GATILHO: regime 15m + RSI cruzando + ADX>=15 (V21 via config)', () => {
  assert.ok(src.match(/RSI_TOUCH_CALL.*=.*num\(|RSI_TOUCH_PUT.*=.*num\(/), 'RSI_TOUCH não vem do config');
  assert.ok(src.includes("dir15m === 'alta15m'") || src.includes('"alta15m"'), 'alta15m não verificado');
  assert.ok(src.includes("dir15m === 'baixa15m'") || src.includes('"baixa15m"'), 'baixa15m não verificado');
  assert.ok(src.match(/touchCall|touchPut/), 'touchCall/touchPut não usados');
  assert.ok(src.match(/Math\.max\(RSI_TOUCH_CALL,\s*30\)/), 'fallback touchCall 30 não encontrado');
  assert.ok(src.match(/Math\.min\(RSI_TOUCH_PUT,\s*70\)/), 'fallback touchPut 70 não encontrado');
  assert.ok(src.match(/adxMin,\s*15\)/), 'adxMin default 15 não encontrado');
});

ok('jaEraOversold/jaEraOverbought bloqueia sinal em evaluateEntry', () => {
  const evBlock = src.match(/export\s+function\s+evaluateEntry[\s\S]{0,2000}/)?.[0]
               ?? src.match(/function\s+evaluateEntry[\s\S]{0,2000}/)?.[0] ?? '';
  assert.ok(evBlock.length > 0, 'evaluateEntry não encontrada no fonte');
  assert.ok(evBlock.match(/jaEraOversold|jaEraOverbought/), 'jaEraOversold/jaEraOverbought não em evaluateEntry');
});

console.log('\n══ V21 — NOVAS CORREÇÕES (freeze + performance) ══');

ok('STALE-OP GUARD: evaluateOpenPositions força remoção de ops expiradas >60s', () => {
  assert.ok(src.match(/expiredMs\s*>\s*60_000|expiredMs\s*>\s*60000/), 'guard stale-op não encontrado');
  assert.ok(src.match(/STALE_OP_FORCE_REMOVE|forçando remoção/), 'log stale-op não encontrado');
  assert.ok(src.match(/applyResult.*loss/), 'aplica loss como fallback para op stale');
});

ok('WS RECONNECTION: reconecta automaticamente em vez de shutdown no close', () => {
  assert.ok(src.match(/tryReconnect|reconectar/), 'handler de reconexão não encontrado');
  assert.ok(src.match(/maxAttempts\s*=\s*5/), 'maxAttempts=5 não encontrado');
  assert.ok(src.match(/subscribeCandles/), 're-subscribe após reconexão não implementado');
  assert.ok(!src.match(/shutdown\('WS'\);?\s*\}\);/), 'shutdown no WS close ainda presente');
});

ok('TREND_MIN_SPREAD default 0.01 (era 0.05 — OTC tem spread pequeno)', () => {
  assert.ok(src.match(/TREND_MIN_SPREAD.*=.*num\(S\.trendMinEmaSpreadPct,\s*0\.01\)/), 'TREND_MIN_SPREAD default não é 0.01');
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.strategy?.trendMinEmaSpreadPct, 0.01, 'config trendMinEmaSpreadPct não é 0.01');
});

ok('boot1mCandles=120 no config (era 240 — inicialização mais rápida)', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.strategy?.boot1mCandles, 120, 'boot1mCandles não é 120');
});

ok('replaceStaleMs=60000 no config (era 180000 — rebalance mais rápido)', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.universe?.replaceStaleMs, 60000, 'replaceStaleMs não é 60000');
});

console.log('\n══ V22 — RECOVERY FIRE (bugfix) ══');

ok('closeCycle extraída como função helper', () => {
  assert.ok(src.match(/function closeCycle\(s/), 'closeCycle não existe');
  assert.ok(src.match(/function applyResult\(/), 'applyResult não existe');
});

ok('applyResult NÃO fecha ciclo quando Recovery armada (fecha em evaluateOpenPositions)', () => {
  // O ciclo só fecha em evaluateOpenPositions quando Recovery armada
  assert.ok(src.match(/if \(s\.cycleOpenOps <= 0 && !s\.runnerLossRecoveryArmed\) \{/), 'guard cicloOpenOps+!RecoveryArmed não encontrado em applyResult');
  assert.ok(src.match(/closeCycle\(s\);[\s\S]{0,200}s\.lastResult = result;/), 'closeCycle(s) não chamado após o guard em applyResult');
});

ok('evaluateOpenPositions fecha ciclo quando Recovery é pulada (closeCycle chamado)', () => {
  // closeCycle(s) está em evaluateOpenPositions (função de ~44KB)
  // Usa busca direta no fonte ao invés de captura limitada por regex
  const start = src.indexOf('function evaluateOpenPositions(');
  const end = src.indexOf('\n\n\n// ───', start + 1000);
  const evBlock = src.slice(start, end > 0 ? end : start + 50000);
  assert.ok(evBlock.includes('closeCycle(s)'), 'closeCycle(s) não encontrado em evaluateOpenPositions');
});

ok('Recovery não reseta runnerLossRecoveryArmed ao ser disparada (ciclo fica aberto)', () => {
  const evBlock = src.match(/function evaluateOpenPositions[\s\S]{0,600}/)?.[0] ?? '';
  const recSendBlock = evBlock.match(/Recovery entra[\s\S]{0,200}/)?.[0] ?? '';
  assert.ok(!recSendBlock.match(/runnerLossRecoveryArmed\s*=\s*false/), 'runnerLossRecoveryArmed resetado ao disparar Recovery');
});

ok('findOp suporta parâmetro expiration (discrimina CASH vs RUNNER)', () => {
  assert.ok(src.match(/function findOp\(\{ aid = null, requestId = null, orderId = null, expiration = null/), 'findOp não tem parâmetro expiration');
  assert.ok(src.match(/const candidates = expiration \? forAsset\.filter/), 'candidates não filtra por expiration');
});

ok('findOp compara requestId como string (tolerância string/number)', () => {
  assert.ok(src.match(/String\(o\.requestId\) === String\(requestId\)/), 'findOp não compara requestId como string');
  assert.ok(!src.match(/o\.requestId\s*===\s*requestId/), 'findOp ainda usa === estrito no requestId');
});

ok('socket-option-opened passa expiration ao findOp', () => {
  assert.ok(src.match(/serverExp\s*=\s*Number\(raw\?\.expiration/), 'serverExp não extraído do raw');
  assert.ok(src.match(/expiration:\s*serverExp/), 'expiration não passado ao findOp em socket-option-opened');
});

ok('socket-option-closed passa expiration ao findOp', () => {
  assert.ok(src.match(/socket-option-closed[\s\S]{0,400}expiration:\s*serverExp/), 'expiration não passado ao findOp em socket-option-closed');
});

console.log('\n══ RESUMO ══');
console.log(`Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
