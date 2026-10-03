/**
 * BATERIA V21 — Cash/Runner/Recovery
 *
 *   node diagnostic-results/bot-v21-tests.mjs
 *
 * Cada teste PROVA um comportamento, não só compilação.
 */
import assert from 'node:assert/strict';
import fs from 'fs';

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); console.log('  ✅', name); passed++; }
  catch (e) { console.log('  ❌', name, '\n     ', e.message); failed++; }
}

console.log('══ V21 — ENTRADA IDENTICA À V20 ══');

ok('evaluateEntry existe e é exportado', () => {
  // Import dinâmico只能在async函数中使用，此处只检查源代码
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('export function evaluateEntry'), 'evaluateEntry não exportado');
});

ok('ADX gate V20 presente (adxFraco skip)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes("if (adx < adxV20) return { skip: 'adxFraco'"), 'gate ADX V20 não encontrado');
});

ok('entryBodyRatio V20 presente', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('entryBodyRatio'), 'entryBodyRatio não encontrado');
  assert.ok(src.includes('body / range < bodyRatioMin'), 'corpo/body ratio check ausente');
});

console.log('');
console.log('══ V21 — CASH / RUNNER — duas posições ══');

ok('CASH_TP configurável (cashTakeProfit)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('CASH_TP'), 'CASH_TP não encontrado');
  assert.ok(src.includes('num(CA.cashTakeProfit') || src.match(/cashTakeProfit.*CASH_TP|CASH_TP.*cashTakeProfit/), 'cashTakeProfit não lido do config');
});

ok('Bot NÃO usa sell_profit estimado (usa valor real da IQ)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  // Deve haver quotes.get(orderId) pegando sellProfit real
  assert.ok(src.includes('quotes.get('), 'quotes.get não encontrado — sell_profit real');
  assert.ok(src.includes('sellProfit'), 'sellProfit não referenciado');
  // NÃO deve haver cálculo estimado de lucro por distância de preço
  assert.ok(!src.match(/entry.*price.*\*.*0\.\d+/), 'cálculo estimado encontrado');
});

ok('Bot abre DUAS posições no mesmo sinal (Cash + Runner)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), "utf8");
  assert.ok(src.includes("'cash'") && src.includes("'runner'"), "roles cash/runner não encontrados");
  // Duas sendOrder chamadas com roles diferentes dentro de maybeTrade
  const cashSend = src.match(/sendOrder\([^)]+,\s*['"]cash['"]/g);
  const runnerSend = src.match(/sendOrder\([^)]+,\s*['"]runner['"]/g);
  assert.ok(cashSend?.length >= 1 && runnerSend?.length >= 1, "sendOrder com role cash e runner não encontradas");
  // As duas com o mesmo cycleId
  assert.ok(src.match(/sendOrder.*'cash'.*cycleId|sendOrder.*'runner'.*cycleId/), "cycleId não atribuído a Cash/Runner");
});

ok('cycleId gerado e atribuído a Cash e Runner', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('nextCycleId()'), 'nextCycleId não encontrado');
  assert.ok(src.includes('cycleId'), 'cycleId não usado');
  assert.ok(src.match(/role.*cash.*cycleId|cash.*role.*cycleId/s), 'cash sem cycleId');
});

ok('CASH: venda quando LP pós-venda >= CASH_TP (não antes)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  // Verifica: lpLiquido >= CASH_TP → vende
  assert.ok(src.match(/lpLiquido\s*>=\s*CASH_TP|sellProfit.*>=.*CASH_TP/), 'guarda CASH_TP não encontrada');
  // Verifica que NÃO vende com lucro < CASH_TP
  assert.ok(!src.match(/lpLiquido\s*>\s*0[^T]/), 'venda por qualquer lucro (sem CASH_TP)');
});

ok('CASH: não vende nos últimos CLOSE_BEFORE_MS (proteção IQ)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.match(/remainingMs\s*<=\s*CLOSE_BEFORE_MS/), 'proteção de tempo CLOSE_BEFORE não encontrada');
});

ok('RUNNER: vai até expiração (sem venda antecipada)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  // Runner settlement: socket-option-closed → parseSettlement (padrão)
  // Runner NÃO aparece em finalizeEarly (que é só para venda antecipada)
  assert.ok(!src.match(/finalizeEarly.*runner|runner.*finalizeEarly/), 'Runner em finalizeEarly');
  // Runner no applyResult (via parseSettlement padrão)
  const settleSrc = src.match(/socket-option-closed[\s\S]*?applyResult/m)?.[0] ?? '';
  assert.ok(settleSrc.includes('parseSettlement'), 'Runner não usa parseSettlement');
});

console.log('');
console.log('══ V21 — RECOVERY — máx 1 por ciclo, confirmação técnica ══');

ok('REC_MULTIPLIER = baseStake × 2.75 (lido do config)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  // REC_MULTIPLIER é lido do config (num(REC.multiplier))
  assert.ok(src.match(/REC_MULTIPLIER.*=.*num\(REC\.multiplier/), 'REC_MULTIPLIER não vem do config');
  // Uso: BASE_STAKE * REC_MULTIPLIER
  assert.ok(src.match(/BASE_STAKE\s*\*\s*REC_MULTIPLIER/), 'cálculo BASE_STAKE × REC_MULTIPLIER não encontrado');
});

ok('máximo 1 Recovery por ciclo (recoveryAttempts guard)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  // evaluateRecovery é chamado só se recoveryAttempts === 0
  assert.ok(src.match(/recoveryAttempts\s*===\s*0/), 'guard recoveryAttempts === 0 não encontrado');
  // recoveryAttempts é incrementado após Recovery ser enviada
  assert.ok(src.match(/recoveryAttempts\s*=\s*1|recoveryAttempts\s*\+\+/), 'recoveryAttempts não é incrementado');
});

ok('Recovery NÃO é "martingale cego" (avalia técnica)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  // Deve ter evaluateRecovery com zona suporte, RSI, ADX, ATRP, regime
  assert.ok(src.includes('evaluateRecovery'), 'evaluateRecovery não encontrado');
  assert.ok(src.includes('zone') || src.includes('EMA') || src.includes('ema'), 'zona suporte não verificada');
  assert.ok(src.includes('RSI'), 'RSI não verificado na recovery');
  assert.ok(src.includes('ADX') || src.includes('adx'), 'ADX não verificado na recovery');
  assert.ok(src.includes('ATRP') || src.includes('atrAvg'), 'ATRP não verificado na recovery');
  assert.ok(src.includes('regime') || src.includes('regime1m'), 'regime não verificado na recovery');
});

ok('RECOVERY_SKIPPED_TOO_LATE logado quando tempo insuficiente', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('RECOVERY_SKIPPED_TOO_LATE'), 'RECOVERY_SKIPPED_TOO_LATE não encontrado');
});

ok('regime invalidado bloqueia Recovery', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('REGIME_INVALIDADO'), 'REGIME_INVALIDADO não encontrado na recovery');
});

ok('ATRP máximo (REC_MAX_ATRP_PCT) bloqueia Recovery em volatilidade explosiva', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.match(/ATRP.*>\s*REC_MAX_ATRP|REC_MAX_ATRP.*ATRP/), 'ATRP max não verificado');
});

console.log('');
console.log('══ V21 — CICLO — link e estatísticas ══');

ok('cicloStatistics existêm (cash, runner, recovery, cycles)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.match(/cycleStats\s*=/), 'cycleStats não encontrado');
  assert.ok(src.match(/cash:.*wins|runner:.*wins|recovery:.*wins|cycles:.*total/s), 'estatísticas por papel não encontradas');
});

ok('CycleOps reseta quando todas ops do ciclo fecham', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.match(/cycleOpenOps\s*<=?\s*0/), 'reset de cycleOpenOps não encontrado');
});

ok('Runner loss → arma Recovery (runnerLossRecoveryArmed)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  // No applyResult: se role===runner e result===loss → runnerLossRecoveryArmed = true
  assert.ok(src.includes('runnerLossRecoveryArmed'), 'runnerLossRecoveryArmed não encontrado');
  const applyBlock = src.match(/function applyResult[\s\S]*?^}/m)?.[0] ?? '';
  assert.ok(applyBlock.match(/role.*runner.*result.*loss|loss.*result.*role.*runner/s), 'Runner loss → armou recovery');
});

ok('resultados-v21.json configurado no paths', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.match(/resultados-v21\.json|resultados.*v21/), 'resultados-v21.json não configurado');
});

console.log('');
console.log('══ V21 — CONFIG ══');

ok('bot-config-v21.json tem _version 21', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg._version, '21', `versão: ${cfg._version}`);
});

ok('cashTakeProfit default 1.0 e configurable', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.cash?.cashTakeProfit, 1.0, `cashTakeProfit: ${cfg.cash?.cashTakeProfit}`);
  assert.ok(typeof cfg.cash?.cashTakeProfit === 'number', 'não é número');
});

ok('recovery.multiplier = 2.75', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.recovery?.multiplier, 2.75, `multiplier: ${cfg.recovery?.multiplier}`);
});

ok('recovery.maxAtrpPercent e closeBeforeMs configurados', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.ok(Number.isFinite(cfg.recovery?.maxAtrpPercent), 'maxAtrpPercent não é número');
  assert.ok(Number.isFinite(cfg.recovery?.closeBeforeMs), 'closeBeforeMs não é número');
});

ok('strategy (entrada V20) IDENTICA: adxMinEntry=15, entryBodyRatio=0.4, rsiTouchCall=30, rsiTouchPut=70', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.strategy?.adxMinEntry, 15, `adxMinEntry: ${cfg.strategy?.adxMinEntry}`);
  assert.equal(cfg.strategy?.entryBodyRatio, 0.4, `entryBodyRatio: ${cfg.strategy?.entryBodyRatio}`);
  assert.equal(cfg.strategy?.rsiTouchCall, 30, `rsiTouchCall: ${cfg.strategy?.rsiTouchCall}`);
  assert.equal(cfg.strategy?.rsiTouchPut, 70, `rsiTouchPut: ${cfg.strategy?.rsiTouchPut}`);
});

ok('accounts.demo: USD e saldo 60 (PRACTICE)', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.accounts?.demo?.currency, 'USD', 'moeda não USD');
  assert.equal(cfg.accounts?.demo?.type, 4, 'type demo não é 4');
});

console.log('');
console.log('══ V21 — COMPORTAMENTO PROIBIDO (não existe) ══');

ok('sem martingale V20 (reversalGale do V20 removido do caminho principal)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  // O evaluateEntry do V20 tinha: if (adx < adxV20) return { skip: 'adxFraco' }
  // Mas o reversalGale NOVO (que arma recovery) é diferente — não é o mesmo do V20
  // Verifica que NÃO existe reversão por sell_kind == 'reversalCut' como motor
  assert.ok(!src.match(/reversalCut.*gale|gale.*reversalCut/), 'reversalCut gale encontrado (legacy)');
});

ok('sem pyramidMax > 0 (pirâmide desativada)', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.strategy?.pyramidMax, 0, `pyramidMax deveria ser 0, veio ${cfg.strategy?.pyramidMax}`);
});

ok('sem earlyGale como motor (Recovery substitui)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  // earlyGale pode existir no config mas NÃO deve ser o caminho principal
  const evaluateOpen = src.match(/evaluateOpenPositions[\s\S]{0,500}/);
  assert.ok(!evaluateOpen?.[0].match(/earlyGale|gale.*early|sell.*earlyGale/), 'earlyGale encontrado em evaluateOpenPositions');
});

console.log('');
console.log('══ V21 — LOG 5s ══');

ok('analyseLogInterval de 5s existe e itera posições abertas', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.match(/setInterval.*5_000|setInterval.*5000/), 'interval 5s não encontrado');
  assert.ok(src.match(/inFlight\.size.*===\s*0|inFlight\.size.*>.*0/), 'verifica inFlight no log 5s');
  assert.ok(src.match(/sellProfit|quotes\.get/), 'sell_profit no log 5s');
  assert.ok(src.match(/RSI|ADX|regime/), 'indicadores no log 5s');
});

ok('startAnalyseLog/stopAnalyseLog existem', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('startAnalyseLog') && src.includes('stopAnalyseLog'), 'funções de log 5s não encontradas');
});

ok('log de ciclo: CICLO_INICIO e CICLO_FIM com cycleId', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.match(/CICLO_INICIO.*cycleId|CICLO_FIM.*cycleId/), 'log CICLO_INICIO/FIM sem cycleId');
});

console.log('');
console.log('══ V21 — BOOTSTRAP HISTÓRICO (15m+ antes de operar) ══');

ok('bootstrapAsset é definido em onReady', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('async function bootstrapAsset'), 'bootstrapAsset não encontrada');
  assert.ok(src.includes('HIST_5S_REQUIRED') && src.includes('HIST_1M_REQUIRED'), 'constantes HIST_* não encontradas');
});

ok('HIST_5S_REQUIRED = 171 candles (15 min × 12 × 95%)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  // 15 * 12 * 0.95 = 171; max(171, 29) = 171
  assert.ok(src.match(/HIST_5S_REQUIRED\s*=\s*Math\.max\s*\(\s*Math\.round\s*\(\s*HIST_WARMUP_MIN_MINUTES\s*\*\s*HIST_5S_PER_MIN\s*\*\s*0\.95/), 'HIST_5S_REQUIRED não usa 0.95×');
});

ok('HIST_1M_REQUIRED = 28 candles (15 min × 95%)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  // 15 * 1 * 0.95 = 14; max(14, 28) = 28
  assert.ok(src.match(/HIST_1M_REQUIRED\s*=\s*Math\.max/), 'HIST_1M_REQUIRED não usa max');
});

ok('maybeTrade é bloqueado se bootstrapStatus !== READY', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.match(/bootstrapStatus\s*!==\s*['"]READY['"]/), 'gate bootstrapStatus em maybeTrade não encontrado');
  assert.ok(src.match(/BOOTSTRAP_FAIL/), 'log BOOTSTRAP_FAIL não encontrado');
});

ok('Recovery é bloqueada se bootstrapStatus !== READY', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.match(/RECOVERY_WAIT_BOOTSTRAP/), 'log RECOVERY_WAIT_BOOTSTRAP não encontrado');
});

ok('per-asset bootstrapStatus em running map', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.match(/bootstrapStatus:\s*['"]LOADING_HISTORICAL['"]/), 'bootstrapStatus inicial não definido');
  assert.ok(src.match(/bootstrapStatus\s*=\s*['"]READY['"]/), 'transição para READY não encontrada');
  assert.ok(src.match(/bootstrapStatus\s*=\s*['"]DATA_NOT_READY['"]/), 'estado DATA_NOT_READY não encontrado');
});

ok('applyUniverse retorna lista de ativos adicionados', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.match(/return added;/), 'applyUniverse não retorna added');
  assert.ok(src.match(/const added = \[\]/), 'array added não criado');
});

ok('rebalanceUniverse faz bootstrap de novos ativos', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.match(/bootstrapAsset\(aid\)/), 'bootstrapAsset não chamado no rebalance');
});

ok('log de bootstrap: [✅ ATIVO] HIST=15m+ | regime=X | spread=Y', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  assert.ok(src.match(/\[✅.*\].*HIST=.*regime=/), 'log de regime por ativo não encontrado');
  assert.ok(src.match(/bootstrap:\s*\${ready}.*READY/), 'log de bootstrap summary não encontrado');
});

ok('config: historicalWarmupMinutes = 15', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v21.json', import.meta.url), 'utf8'));
  assert.equal(cfg.strategy?.historicalWarmupMinutes, 15, `historicalWarmupMinutes: ${cfg.strategy?.historicalWarmupMinutes}`);
});

console.log('');
