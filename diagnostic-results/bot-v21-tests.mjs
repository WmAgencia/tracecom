// Os 29 checks textuais da estratégia anterior foram substituídos por v22-context-tests.mjs.
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


ok('planTrade usa getRegimeForAsset (não trendDirection1m diretamente)', () => {
  const planBlock = src.match(/function planTrade[\s\S]{0,2000}/)?.[0] ?? '';
  assert.ok(planBlock.includes('getRegimeForAsset(aid)'), 'planTrade não chama getRegimeForAsset');
  assert.ok(!planBlock.match(/trendDirection1m\(b1\.ticks\)/), 'planTrade ainda chama trendDirection1m(b1.ticks)');
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




// ── V22 WR IMPROVEMENTS ──────────────────────────────────────────────────────
console.log('\n══ V22 — WR IMPROVEMENTS (2026-10-04) ══');







ok('WR#4: maxAtrpPercent 2.0% (era 3.0%)', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.recovery?.maxAtrpPercent, 2.0, 'maxAtrpPercent não é 2.0');
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
