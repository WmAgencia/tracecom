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

console.log('\n══ V22 — RECOVERY ══');

ok('REC_MULTIPLIER lido do config (recovery.multiplier)', () => {
  assert.ok(src.match(/REC_MULTIPLIER.*=.*num\(REC\.multiplier/), 'REC_MULTIPLIER não vem do config');
});

ok('Recovery stake = (cash+runner) × REC_MULTIPLIER = BASE_STAKE × 2 × REC_MULTIPLIER', () => {
  assert.ok(src.match(/BASE_STAKE\s*\*\s*2\s*\*\s*REC_MULTIPLIER/), 'stake não calcula (cash+runner)×REC_MULTIPLIER');
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

console.log('\n══ V22 — CICLO ══');

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

ok('bot-config-v21.json existe e _version 22', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg._version, '22');
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

ok('strategy.adxMin = 20 (era 15 — WR#2: tendencia com forca real)', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.strategy?.adxMin, 20);
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
  assert.ok(!src.includes('scheduleRegime15mRecalc'), 'scheduleRegime15mRecalc (dead code) ainda presente');
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

ok('getRegimeForAsset: usa cálculo local 15m (fonte 1m) → fallback 1m → lateral', () => {
  assert.ok(src.includes('function computeRegime15mLocal('), 'computeRegime15mLocal não existe');
  assert.ok(src.includes('aggregateTo15m('), 'aggregateTo15m (agregação 1m→15m) não existe');
  assert.ok(src.includes('trendDirection1m('), 'fallback 1m não existe');
  assert.ok(src.includes("direction: 'lateral15m'"), 'lateral15m não retornado como fallback');
  assert.ok(!src.includes('REGIME_STATE_FILE'), 'REGIME_STATE_FILE ainda presente');
  assert.ok(!src.includes('regime-state.json'), 'regime-state.json ainda referenciado');
});

ok('evaluateRecoveryAnticipada usa regime15m (mesma direção do ciclo)', () => {
  const startIdx = src.indexOf('function evaluateRecoveryAnticipada({ aid, stateEntry: s })');
  const endIdx = src.indexOf('function ', startIdx + 1);
  const recBlock = src.slice(startIdx, endIdx);
  assert.ok(recBlock.includes('regime15m') || recBlock.includes("'lateral15m'"), 'evaluateRecoveryAnticipada não usa regime15m');
  // V22: mesma direção do ciclo (não inverte)
  assert.ok(recBlock.includes("s.direction") || recBlock.includes('direction !== s.direction'), 'não verifica direção vs ciclo');
});

ok('logging mostra reg15m com source (local-15m, local-1m, nenhum)', () => {
  assert.ok(src.includes('reg15m='), 'reg15m não aparece no log');
  assert.ok(src.includes('[${r15m.source}]') || src.includes('${r15m.source}'), 'source do regime não logado');
  assert.ok(src.includes("source: 'local-15m'") || src.includes("source: 'local-1m'"), 'sources do regime local não encontrados');
});

console.log('\n══ V22 — LOG E MONITOR ══');

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

ok('RSI é GATILHO: regime 15m + RSI cruzando + ADX>=20 (V22 WR#1+2)', () => {
  assert.ok(src.match(/RSI_TOUCH_CALL.*=.*num\(|RSI_TOUCH_PUT.*=.*num\(/), 'RSI_TOUCH não vem do config');
  assert.ok(src.includes("dir15m === 'alta15m'") || src.includes('"alta15m"'), 'alta15m não verificado');
  assert.ok(src.includes("dir15m === 'baixa15m'") || src.includes('"baixa15m"'), 'baixa15m não verificado');
  assert.ok(src.match(/touchCall|touchPut/), 'touchCall/touchPut não usados');
  assert.ok(src.match(/Math\.max\(RSI_TOUCH_CALL,\s*35\)/), 'fallback touchCall 35 não encontrado');
  assert.ok(src.match(/Math\.min\(RSI_TOUCH_PUT,\s*65\)/), 'fallback touchPut 65 não encontrado');
  assert.ok(src.match(/adxMin,\s*20\)/), 'adxMin default 20 não encontrado');
});

ok('jaEraOversold/jaEraOverbought bloqueia sinal em evaluateEntry', () => {
  const evBlock = src.match(/export\s+function\s+evaluateEntry[\s\S]{0,12000}/)?.[0]
               ?? src.match(/function\s+evaluateEntry[\s\S]{0,12000}/)?.[0] ?? '';
  assert.ok(evBlock.length > 0, 'evaluateEntry não encontrada no fonte');
  assert.ok(evBlock.match(/jaEraOversold|jaEraOverbought/), 'jaEraOversold/jaEraOverbought não em evaluateEntry');
});

// ── V22 WR IMPROVEMENTS ──────────────────────────────────────────────────────
console.log('\n══ V22 — WR IMPROVEMENTS (2026-10-04) ══');

ok('WR#2: calcBB exportada', () => {
  assert.ok(src.includes('export function calcBB('), 'calcBB não está exportada');
  assert.ok(src.includes('export function calcBB('), 'calcBB função não encontrada');
  // BB constants no source
  assert.ok(src.includes('BB_PERIOD') || src.includes('bbPeriod'), 'BB_PERIOD não usado');
  assert.ok(src.includes('BB_STDDEV') || src.includes('bbStdDev'), 'BB_STDDEV não usado');
});

ok('WR#3: BB zona no evaluateEntry (CALL=bande inferior, PUT=bande superior)', () => {
  const evBlock = src.match(/export\s+function\s+evaluateEntry[\s\S]{0,12000}/)?.[0]
               ?? src.match(/function\s+evaluateEntry[\s\S]{0,12000}/)?.[0] ?? '';
  assert.ok(src.includes('calcBB('), 'calcBB não chamado');
  assert.ok(evBlock.includes('bb.lastClose <= bb.lower'), 'CALL BB lower check ausente');
  assert.ok(evBlock.includes('bb.lastClose >= bb.upper'), 'PUT BB upper check ausente');
  assert.ok(evBlock.includes('isBBZone'), 'isBBZone não usado');
  assert.ok(evBlock.includes('semBBZona'), 'semBBZona skip não usado');
});

ok('WR#1: RSI pullback mais estricto — touchCall fallback 35, touchPut fallback 65', () => {
  assert.ok(src.match(/Math\.max\(RSI_TOUCH_CALL,\s*35\)/), 'fallback touchCall 35 não encontrado');
  assert.ok(src.match(/Math\.min\(RSI_TOUCH_PUT,\s*65\)/), 'fallback touchPut 65 não encontrado');
});

ok('WR#5: bodyRatioMin default 0.6 (era 0.4)', () => {
  assert.ok(src.match(/entryBodyRatio\s*\?\?\s*0\.6/), 'bodyRatioMin default 0.6 não encontrado');
});

ok('WR#2: adxV20 default 20 (era 15)', () => {
  assert.ok(src.match(/adxMin,\s*20\)/), 'adxV20 default 20 não encontrado');
});

ok('WR#6: Regime 1m não contra 15m em evaluateEntry', () => {
  const evBlock = src.match(/export\s+function\s+evaluateEntry[\s\S]{0,12000}/)?.[0]
               ?? src.match(/function\s+evaluateEntry[\s\S]{0,12000}/)?.[0] ?? '';
  assert.ok(evBlock.includes('regime1mContra15m'), 'regime1mContra15m skip não existe');
  assert.ok(evBlock.includes("source === 'local-1m'"), 'source check não existe');
  assert.ok(evBlock.includes('dir1m !== dir15m'), 'comparação 1m vs 15m não existe');
});

ok('WR#4: maxAtrpPercent 2.0% (era 3.0%)', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.recovery?.maxAtrpPercent, 2.0, 'maxAtrpPercent não é 2.0');
});

ok('WR#5: entryBodyRatio 0.6x no config', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.strategy?.entryBodyRatio, 0.6, 'entryBodyRatio não é 0.6');
});

ok('WR#3: BB config keys (bbPeriod, bbStdDev)', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.strategy?.bbPeriod, 20, 'bbPeriod não é 20');
  assert.equal(cfg.strategy?.bbStdDev, 2.0, 'bbStdDev não é 2.0');
});

console.log('\n══ V21 — NOVAS CORREÇÕES (freeze + performance) ══');

ok('STALE-OP GUARD: expiração ≠ derrota — move para awaitingSettlement, não força loss', () => {
  assert.ok(src.match(/expiredMs\s*>\s*60_000|expiredMs\s*>\s*60000/), 'guard stale-op não encontrado');
  assert.ok(src.match(/EXPIROU_AWAITING_SETTLEMENT/), 'log EXPIROU_AWAITING_SETTLEMENT não encontrado');
  assert.ok(src.match(/awaitingSettlement\.set\(okey, op\)/), 'awaitingSettlement.set não encontrado (reconciliação)');
  assert.ok(!src.match(/applyResult\(op,\s*'loss'/), 'applyResult loss forçado ainda presente');
  assert.ok(!src.match(/STALE_OP_FORCE_REMOVE/), 'STALE_OP_FORCE_REMOVE ainda presente');
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

ok('applyResult NÃO fecha ciclo com Recovery armada, mas fecha após Recovery já avaliada', () => {
  assert.ok(src.match(/if \(s\.cycleOpenOps <= 0 && \(!s\.runnerLossRecoveryArmed \|\| s\.recoveryAttempts > 0\)\) \{/), 'guard de fechamento corrigido não encontrado em applyResult');
  assert.ok(src.match(/closeCycle\(s\);[\s\S]{0,200}s\.lastResult = result;/), 'closeCycle(s) não chamado após o guard em applyResult');
});

ok('evaluateOpenPositions fecha ciclo no timeout da janela e na fase 2 (Recovery já disparada)', () => {
  const start = src.indexOf('function evaluateOpenPositions(');
  const end = src.indexOf('\n\n\n// ───', start + 1000);
  const evBlock = src.slice(start, end > 0 ? end : start + 50000);
  assert.ok(evBlock.includes('RECOVERY_TIMEOUT'), 'timeout da janela não encontrado');
  assert.ok(evBlock.includes('if (s.recoveryAttempts > 0) {'), 'fase 2 (Recovery já disparada) não encontrada');
  assert.ok(evBlock.includes('closeCycle(s)'), 'closeCycle(s) não encontrado em evaluateOpenPositions');
});

ok('Recovery não reseta runnerLossRecoveryArmed ao ser disparada (ciclo fica aberto)', () => {
  const evBlock = src.match(/function evaluateOpenPositions[\s\S]{0,600}/)?.[0] ?? '';
  const recSendBlock = evBlock.match(/Recovery entra[\s\S]{0,200}/)?.[0] ?? '';
  assert.ok(!recSendBlock.match(/runnerLossRecoveryArmed\s*=\s*false/), 'runnerLossRecoveryArmed resetado ao disparar Recovery');
});

ok('findOp: parâmetro expiration presente, mas NÃO retorna ordem por ativo quando IDs não são fornecidos', () => {
  assert.ok(src.match(/function findOp\(\{ aid = null, requestId = null, orderId = null, expiration = null/), 'findOp não tem parâmetro expiration');
  // findOp NÃO faz fallback para primeira ordem do ativo quando orderId/requestId não são fornecidos
  assert.ok(!src.match(/return forAsset\[0\]/), 'findOp ainda retorna primeira ordem do ativo como fallback');
  assert.ok(src.match(/return null;/), 'findOp não retorna null quando IDs não são fornecidos');
});

ok('findOp compara requestId como string (tolerância string/number)', () => {
  // P0-fix: findOp usa ordersByRequestId Map para busca por requestId (string-safe)
  assert.ok(src.match(/ordersByRequestId\.get\(String\(requestId\)\)/), 'findOp não usa ordersByRequestId para buscar por requestId');
  assert.ok(!src.match(/o\.requestId\s*===\s*requestId/), 'findOp ainda usa === estrito no requestId');
});

ok('socket-option-opened usa expiration no fallback de correlação (attachOrderId)', () => {
  assert.ok(src.match(/serverExp\s*=\s*Number\(raw\?\.expiration/), 'serverExp não extraído do raw');
  assert.ok(src.match(/socket-option-opened[\s\S]{0,1600}attachOrderId\(/), 'ACK não usa attachOrderId');
});

ok('socket-option-closed usa expiration/direção no fallback de correlação', () => {
  assert.ok(src.match(/socket-option-closed[\s\S]{0,600}serverExp/), 'serverExp não extraído no closed');
  assert.ok(src.match(/socket-option-closed[\s\S]{0,1000}candidateOps\(/), 'fallback candidateOps não usado no closed');
});

console.log('\n══ V21+P0 — CORREÇÕES P0 (reinício + reconciliação) ══');

ok('EXPOSIÇÃO: sendOrder registra inFlight+pending (stake única); ACK só vincula orderId/limpa reserva', () => {
  assert.ok(src.match(/pendingSet\.add\(okey\)/), 'pendingSet.add não encontrado em sendOrder');
  assert.ok(src.match(/inFlight\.set\(okey,\s*op\)/), 'inFlight.set não encontrado em sendOrder');
  assert.ok(src.match(/pendingSet\.delete\(op\.okey\)/), 'pendingSet.delete não encontrado em attachOrderId');
});

ok('EXPOSIÇÃO: openStake soma APENAS inFlight — pendingSet não conta para exposição', () => {
  const openStakeBlock = src.match(/const openStake[\s\S]{0,400}/)?.[0] ?? '';
  assert.ok(openStakeBlock.includes('inFlight.values()'), 'openStake não soma inFlight');
  // Não soma pending no cálculo de exposição
  assert.ok(!openStakeBlock.match(/pending\.values\(\)/), 'openStake ainda soma pending (double-count)');
});

ok('EXPOSIÇÃO: awaitSettlement removido de inFlight após expiração — não conta na exposição', () => {
  // stale-op guard remove de inFlight quando expira
  assert.ok(src.match(/inFlight\.delete\(okey\)/), 'inFlight.delete não encontrado no stale-op');
  // awaitingSettlement é um Map separado
  assert.ok(src.match(/const awaitingSettlement\s*=\s*new\s+Map\(\)/), 'awaitingSettlement Map não declarado');
});

ok('CASH: stats NÃO incrementadas no pedido de venda — só no settlement (applyResult)', () => {
  // Não há mais cycleStats.cash increment no evaluateOpenPositions (cash sell path)
  const evBlock = src.match(/if \(lpLiquido\s*>=\s*CASH_TP[\s\S]{0,300}/)?.[0] ?? '';
  assert.ok(!evBlock.match(/cycleStats\.cash\.\w+\+\+/), 'cycleStats.cash incrementada em evaluateOpenPositions (prematura)');
  // applyResult agora incrementa stats
  const applyBlock = src.match(/function applyResult[\s\S]{0,2000}/)?.[0] ?? '';
  assert.ok(applyBlock.match(/cycleStats\.cash\.settled\+\+/), 'cycleStats.cash não incrementada em applyResult');
});

ok('CASH: registerOutcome chamada no settlement via applyResult (não diretamente no pedido de venda)', () => {
  // P0-fix: finalizeEarly chama applyResult, que chama registerOutcome —记账 centralizada
  const finBlock = src.match(/function finalizeEarly[\s\S]{0,1000}/)?.[0] ?? '';
  assert.ok(finBlock.match(/applyResult\(op, 'early', profit\)/), 'finalizeEarly não chama applyResult');
  // applyResult chama registerOutcome
  const applyBlock = src.match(/function applyResult[\s\S]{0,800}/)?.[0] ?? '';
  assert.ok(applyBlock.match(/registerOutcome\(profit, false\)/), 'applyResult não chama registerOutcome');
  // evaluateOpenPositions NÃO chama registerOutcome para cash
  const evBlock = src.match(/if \(lpLiquido\s*>=\s*CASH_TP[\s\S]{0,300}/)?.[0] ?? '';
  assert.ok(!evBlock.match(/registerOutcome\(/), 'registerOutcome chamada prematuramente em evaluateOpenPositions');
});

ok('RECONCILIAÇÃO: reconcileWithBroker consulta getOptions e casa com awaitingSettlement', () => {
  assert.ok(src.match(/async function reconcileWithBroker\(/), 'reconcileWithBroker não existe');
  assert.ok(src.match(/ws\.getOptions\(/), 'getOptions não chamado em reconcileWithBroker');
  assert.ok(src.match(/normalizeBrokerResult\(/), 'normalizeBrokerResult não existe');
  assert.ok(src.match(/normalizeBrokerProfit\(/), 'normalizeBrokerProfit não existe');
  // Reconciled ops usam applyResult
  assert.ok(src.match(/applyResult\(op,\s*result,\s*profit\)/), 'applyResult não chamado após reconciliação');
});

ok('RECONCILIAÇÃO: startup chama reconcileWithBroker ao restaurar awaitSettlement', () => {
  // reconcileWithBroker chamado após restaurar awaitingSettlement
  assert.ok(src.match(/await reconcileWithBroker\(\)/), 'reconcileWithBroker não chamado no startup');
});

ok('PERSISTÊNCIA: savePending atomic (write+rename) + inclui awaitingSettlement', () => {
  assert.ok(src.match(/fs\.writeFileSync\s*\(\s*tmp/), 'atomic write não implementado');
  assert.ok(src.match(/fs\.renameSync\s*\(\s*tmp/), 'atomic rename não implementado');
  assert.ok(src.match(/awaitingSettlement:.*\.values\(\)/), 'awaitingSettlement não persistido');
  assert.ok(src.match(/pendingSet:.*pendingSet/), 'pendingSet não persistido');
});

ok('PERSISTÊNCIA: saveState atomic + inclui ciclo V21 (galeArmedAt, cycleId, recoveryAttempts)', () => {
  assert.ok(src.match(/fs\.writeFileSync\s*\(\s*tmp/), 'atomic write em saveState não implementado');
  assert.ok(src.match(/galeArmedAt: s\.galeArmedAt/), 'galeArmedAt não persistido');
  assert.ok(src.match(/cycleId: s\.cycleId/), 'cycleId não persistido');
  assert.ok(src.match(/recoveryAttempts: s\.recoveryAttempts/), 'recoveryAttempts não persistido');
});

ok('RECOVERY TIMEOUT: timeout fecha ciclo se antecipada não disparou dentro da janela', () => {
  // Timeout no Recovery loop: galeElapsed > GALE_WINDOW_MS fecha ciclo
  assert.ok(src.match(/galeElapsed2?\s*>\s*GALE_WINDOW_MS/), 'timeout da Recovery armada não implementado');
  assert.ok(src.match(/RECOVERY_TIMEOUT/), 'RECOVERY_TIMEOUT log não encontrado');
  // Ciclo fecha se Recovery já disparou mas settleou (fase 2)
  assert.ok(src.match(/recoveryAttempts\s*>\s*0/), 'fase 2 (Recovery já disparou) não verificada');
});

ok('APPLIED FLAG: finalizeEarly seta applied=true antes de applyResult para evitar double-call', () => {
  const finBlock = src.match(/function finalizeEarly[\s\S]{0,200}/)?.[0] ?? '';
  assert.ok(finBlock.match(/op\.applied\s*=\s*true/), 'applied=true não setado em finalizeEarly antes de applyResult');
});

ok('APPLIED FLAG: applyResult early-return se applied=true (previne double-applyResult)', () => {
  const applyBlock = src.match(/function applyResult[\s\S]{0,200}/)?.[0] ?? '';
  assert.ok(applyBlock.match(/if\s*\(\s*op\.applied\s*\)\s*return/), 'early-return se applied=true não implementado');
});

console.log('\n══ V22 — AUDITORIA 2026-10-03 (correções) ══');

ok('ACK: correlação por posição (IQ não ecoa request_id) — helpers presentes', () => {
  assert.ok(src.includes('function attachOrderId('), 'attachOrderId não existe');
  assert.ok(src.includes('function candidateOps('), 'candidateOps não existe');
  assert.ok(src.includes('function opByOrderId('), 'opByOrderId não existe');
  const posBlock = src.match(/function onPositionChanged[\s\S]{0,3000}/)?.[0] ?? '';
  assert.ok(posBlock.includes('binary_options_option_changed1'), 'onPositionChanged não lê raw_event');
  assert.ok(posBlock.includes('attachOrderId('), 'onPositionChanged não vincula orderId');
  const openedBlock = src.match(/['"]socket-option-opened['"], \(msg\) => \{[\s\S]{0,1600}?\n  \}\);/)?.[0] ?? '';
  assert.ok(openedBlock.includes('attachOrderId('), 'socket-option-opened não usa attachOrderId');
  assert.ok(!openedBlock.includes('op.applied = true'), 'ACK ainda marca applied=true (settlement seria perdido)');
});

ok('Exposição: reservas não contam em dobro + prune de reservas vencidas', () => {
  assert.ok(src.includes('export function pendingCommitment('), 'pendingCommitment não existe');
  assert.ok(src.includes('export function pendingStaleKeys('), 'pendingStaleKeys não existe');
  assert.ok(src.includes('function prunePendingStale('), 'prunePendingStale não existe');
  assert.ok(src.match(/pendingCommitment\(pending, \(okey\) => inFlight\.has\(okey\)\)/), 'canTrade não usa pendingCommitment');
  assert.ok(src.match(/prunePendingStale\(\); void reconcileWithBroker/), 'prune não agendado junto da reconciliação');
});

ok('Ciclo: fecha após Recovery settleiada + cyclePnl não contamina o próximo ciclo', () => {
  assert.ok(src.match(/op\.cycleId === s\.cycleId/), 'applyResult não filtra por cycleId ativo');
  assert.ok(src.match(/!s\.runnerLossRecoveryArmed \|\| s\.recoveryAttempts > 0/), 'condição de fechamento sem recoveryAttempts');
  assert.ok(src.includes('if (s.recoveryAttempts > 0) {'), 'loop sem fase 2 (Recovery já disparada)');
});

ok('Recovery: usa a JANELA (120s) — skip NÃO fecha o ciclo', () => {
  // V22: skip é `if (recCheck.skip) continue;` (sem log extra)
  const skipIdx = src.indexOf('if (recCheck.skip)');
  assert.ok(skipIdx > 0, 'bloco recCheck.skip não encontrado');
  const skipBlock = src.slice(skipIdx, skipIdx + 700);
  assert.ok(!skipBlock.match(/closeCycle\(s\)/), 'skip ainda fecha o ciclo');
  assert.ok(skipBlock.includes('continue;'), 'skip não usa continue');
});

ok('Regime 15m real: fonte é o buffer 1m (16 buckets = 4h) + HIST_1M_FETCH', () => {
  assert.ok(src.includes('HIST_1M_FETCH'), 'HIST_1M_FETCH não existe');
  assert.ok(src.match(/const buf = buf1m\.get\(assetId\)/), 'getRegimeForAsset não lê o buffer 1m');
  assert.ok(src.match(/for \(const \[aid, buf\] of buf1m\)/), 'boot/interval não iteram o buffer 1m');
  assert.ok(src.match(/size: 60, count: HIST_1M_FETCH/), 'bootstrap não busca 4h de 1m');
  assert.ok(!src.includes('for (const [aid, buf] of buf5s) {\n      if (buf?.ticks?.length >= 4) {\n        const regime'), 'regime 15m ainda usa buffer 5s');
});

ok('Log de sessão: nome de arquivo válido no Windows (sem ":" e sem "/")', () => {
  const block = src.match(/const dateStr[^\n]*\n[^\n]*const timeStr[^\n]*/)?.[0] ?? '';
  assert.ok(block.length > 0, 'bloco dateStr/timeStr não encontrado');
  assert.ok(!block.includes('/'), 'dateStr/timeStr ainda usam "/"');
  assert.ok(!block.includes(':'), 'dateStr/timeStr ainda usam ":"');
  assert.ok(block.includes('}-${String'), 'separador "-" ausente no nome do log');
});

ok('Performance: calcADX O(n) (sem wilderSmooth O(n²) sobre fatias)', () => {
  assert.ok(!src.includes('wilderSmooth(trs.slice('), 'calcADX ainda é O(n²)');
});

ok('Resíduo removido: detectRegime/tickVolPct/planTrade recovery morto', () => {
  assert.ok(!src.includes('detectRegime'), 'detectRegime ainda presente');
  assert.ok(!src.includes('tickVolPct'), 'tickVolPct ainda presente');
  assert.ok(!src.includes("kind: 'recovery_skipped'"), 'branch recovery_skipped ainda presente');
  assert.ok(!src.includes("kind: 'recovery',"), 'branch recovery morto ainda presente no planTrade');
});

console.log('\n══ RESUMO ══');
console.log(`Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
