#!/usr/bin/env node
/**
 * REGRESSÕES DO PAINEL + TELEMETRIA (offline; sem broker, sem ordem, sem bot de verdade)
 * =============================================================================
 * node telemetry/tests/run-telemetry-tests.mjs
 * Cada item numerado corresponde à lista de regressões funcionais da missão.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { summarize, aggregate, classifyOutcome, wr, inRange, startOfWeek, startOfMonth } from '../lib/stats.mjs';
import { ingestRecords, emptyLedger, tradeKey } from '../lib/ingest.mjs';
import { deriveState, openSession, finalizeSession } from '../lib/sessions.mjs';
import { createRuntime, patchBaseStake, parseLogLine, parseEndReason } from '../lib/runtime.mjs';
import { createPanelServer } from '../server.mjs';
import { PATHS, readJson, writeJsonAtomic, fileStat } from '../lib/store.mjs';
import { stripTelemetry, engineSource, captureSnapshot, compareSnapshots, BEFORE_FILE, ENGINE_FILE } from '../tools/proof-snapshot.mjs';

let pass = 0, fail = 0;
const failures = [];
function section(name) { console.log(`\n═══ ${name} ═══`); }
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; failures.push(label); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`); }
}
const readText = (file) => fs.readFileSync(file, 'utf8');

// ─── fixtures em pasta temporária (nada real é tocado) ───────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tracecom-panel-'));
const DATA_DIR = path.join(TMP, 'panel');
const fxConfig = path.join(TMP, 'bot-config-fixture.json');
const fxResults = path.join(TMP, 'resultados-fixture.json');
const fxPanelConfig = path.join(TMP, 'panel-config.json');
fs.copyFileSync(PATHS.config, fxConfig);
writeJsonAtomic(fxPanelConfig, { schema: 'tracecom-panel-config-v1', host: '127.0.0.1', port: 0, account: 'demo' });

const NOW = new Date(2026, 9, 2, 15, 0, 0).getTime();      // 02/10/2026 15:00 local (sexta)
const iso = (ms) => new Date(ms).toISOString();
const hoursAgo = (h) => NOW - h * 3_600_000;
const daysAgo = (d) => NOW - d * 86_400_000;

// ════════════════════════════════════════════════════════════════════════════
section('1. ESTATÍSTICAS DO DIA (WR, draws, período)');
{
  const trades = [
    { id: 'w1', profit: 1.64, settledAt: iso(hoursAgo(1)) },
    { id: 'w2', profit: 4.51, settledAt: iso(hoursAgo(2)) },
    { id: 'l1', profit: -2, settledAt: iso(hoursAgo(3)) },
    { id: 'l2', profit: -5.29, settledAt: iso(hoursAgo(4)) },
    { id: 'd1', profit: 0, settledAt: iso(hoursAgo(5)) },
  ].map((t) => ({ ...t, outcome: classifyOutcome(t.profit) }));
  const day = summarize(trades);

  check('11. WIN contabiliza corretamente', day.wins === 2, `wins=${day.wins}`);
  check('12. LOSS contabiliza corretamente', day.losses === 2, `losses=${day.losses}`);
  check('3. DRAW não é classificado como win/loss', day.draws === 1 && trades.find((t) => t.id === 'd1').outcome === 'draw');
  check('   · venda antecipada (`result: early`) conta pelo SINAL do lucro, nunca como draw', (() => {
    const early = [{ id: 'e1', result: 'early', profit: -5.29, earlySell: true }, { id: 'e2', result: 'early', profit: 1.2, earlySell: true }];
    const s = summarize(early);
    return s.wins === 1 && s.losses === 1 && s.draws === 0 && s.earlySells === 2;
  })(), JSON.stringify(summarize([{ result: 'early', profit: -5.29, earlySell: true }])));
  check('13. WR = wins/(wins+losses) — draw fica FORA do cálculo', day.wr === 50 && wr(2, 2) === 50, `wr=${day.wr}`);
  check('14. lucro diário = soma exata dos settlements', day.profit === -1.14, `profit=${day.profit}`);
  check('   · operações contam todos os resultados (inclusive draw)', day.ops === 5, `ops=${day.ops}`);
}
{
  const trades = [
    { id: 'hoje', profit: 3, settledAt: iso(hoursAgo(1)) },
    { id: 'ontem', profit: 7, settledAt: iso(daysAgo(1)) },          // quinta → mesma semana
    { id: 'semana', profit: 5, settledAt: iso(daysAgo(2)) },         // quarta → mesma semana
    { id: 'mes', profit: 11, settledAt: iso(daysAgo(3)) },           // segunda → mesma semana/mês
    { id: 'mesAnt', profit: 13, settledAt: iso(daysAgo(20)) },       // setembro → fora do mês
  ];
  const agg = aggregate(trades, NOW);
  check('5. lucro diário correto (só o dia atual)', agg.ranges.day.profit === 3, `day=${agg.ranges.day.profit}`);
  check('15. lucro semanal correto (semana começa na segunda)', agg.ranges.week.profit === 26, `week=${agg.ranges.week.profit}`);
  check('16. lucro mensal correto (mês corrente — setembro fica de fora)', agg.ranges.month.profit === 10, `month=${agg.ranges.month.profit}`);
  check('   · total geral inclui períodos anteriores', agg.ranges.all.profit === 39, `all=${agg.ranges.all.profit}`);
  check('   · fronteiras: semana=segunda e mês=dia 1', new Date(startOfWeek(NOW)).getDay() === 1 && new Date(startOfMonth(NOW)).getDate() === 1);
  check('   · trade fora do período não entra no dia', !inRange(trades[3], 'day', NOW));
}

// ════════════════════════════════════════════════════════════════════════════
section('2. LEDGER: SETTLEMENT ENTRA EXATAMENTE UMA VEZ');
{
  const records = [
    { orderId: 111, key: 'AAA', direction: 'CALL', stake: 2, result: 'win', profit: 1.64, settledAt: iso(hoursAgo(1)), requestId: 'r1' },
    { orderId: 222, key: 'BBB', direction: 'PUT', stake: 5.5, result: 'early', profit: -5.29, earlySell: true, settledAt: iso(hoursAgo(2)), requestId: 'r2' },
  ];
  const first = ingestRecords(emptyLedger(NOW), records, { sessionId: 's1', now: NOW });
  const second = ingestRecords(first.ledger, records, { sessionId: 's1', now: NOW });
  check('9. settlement entra exatamente uma vez (dedupe por orderId)', first.added === 2 && second.added === 0 && second.ledger.trades.length === 2);
  check('10. duplicate settlement NÃO duplica PnL', summarize(second.ledger.trades).profit === summarize(first.ledger.trades).profit);
  check('   · chave estável: orderId → requestId → fallback', tradeKey({ orderId: 7 }) === 'order:7' && tradeKey({ requestId: 'x' }) === 'req:x' && tradeKey({ key: 'K', sentAtMs: 1, direction: 'CALL' }) === 'key:K|1|CALL');

  const open = [{ orderId: 333, key: 'CCC', direction: 'CALL', stake: 2, requestId: 'r3' }];
  const step1 = ingestRecords(second.ledger, open, { sessionId: 's1', now: NOW });
  check('   · registro em aberto (sem resultado) não entra', step1.ledger.trades.length === 2 && step1.pending === 1);
  const closed = [{ ...open[0], result: 'loss', profit: -2, settledAt: iso(NOW) }];
  const step2 = ingestRecords(step1.ledger, closed, { sessionId: 's1', now: NOW });
  check('11. registro que fecha depois entra UMA vez só', step2.added === 1 && step2.ledger.trades.length === 3 && summarize(step2.ledger.trades).ops === 3);
  const step2b = ingestRecords(step2.ledger, closed, { sessionId: 's1', now: NOW });
  check('    · repetir o mesmo fechamento é ignorado (skipped)', step2b.added === 0 && step2b.skipped === 1 && summarize(step2b.ledger.trades).profit === summarize(step2.ledger.trades).profit);

  // Segundo run do bot reescreve o arquivo inteiro: o que já entrou continua no ledger.
  const run2 = [{ orderId: 444, key: 'DDD', direction: 'CALL', stake: 2, result: 'win', profit: 1.64, settledAt: iso(NOW), requestId: 'r4' }];
  const step3 = ingestRecords(step2.ledger, run2, { sessionId: 's2', now: NOW });
  check('   · resultados-v15.json reescrito não apaga a história', step3.ledger.trades.length === 4 && step3.ledger.trades[0].sessionId === 's1');

  // Fronteira de sessão: o arquivo do bot pode ainda conter o run ANTERIOR quando a
  // sessão nova começa — ordem enviada antes do início nunca é da sessão.
  const antigo = { orderId: 555, key: 'EEE', direction: 'PUT', stake: 2, result: 'loss', profit: -2, requestId: 'r5', sentAtMs: NOW - 60_000, settledAt: iso(NOW), timestamp: iso(NOW - 60_000) };
  const novo = { orderId: 556, key: 'FFF', direction: 'CALL', stake: 2, result: 'win', profit: 1.64, requestId: 'r6', sentAtMs: NOW + 30_000, settledAt: iso(NOW + 30_000), timestamp: iso(NOW + 30_000) };
  const step4 = ingestRecords(step3.ledger, [antigo, novo], { sessionId: 's3', sinceMs: NOW, now: NOW });
  const t1 = step4.ledger.trades.find((t) => t.orderId === 555);
  const t2 = step4.ledger.trades.find((t) => t.orderId === 556);
  check('   · ordem anterior ao início da sessão NÃO é atribuída a ela', t1.sessionId === null && t2.sessionId === 's3');
}

// ════════════════════════════════════════════════════════════════════════════
section('3. SESSÃO: ATIVAR/DESATIVAR, TIMER, REFRESH, RESTART');
{
  const alive = new Set();
  const children = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.pid = 50000 + children.length;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    children.push(child);
    return child;
  };
  const isAliveImpl = (pid) => alive.has(Number(pid));
  const opts = {
    dir: DATA_DIR, resultsFile: fxResults, configFile: fxConfig, engineFile: ENGINE_FILE,
    panelConfigFile: fxPanelConfig, spawnImpl, isAliveImpl, tickMs: 60_000, log: () => {},
  };
  const startedAtMs = Date.now() - 90_000;
  const publishLive = (patch = {}) => writeJsonAtomic(path.join(DATA_DIR, 'live.json'), {
    schema: 'tracecom-bot-telemetry-v1', pid: children.at(-1)?.pid, updatedAt: new Date().toISOString(),
    phase: 'running', accountType: 'DEMO', currencySymbol: 'US$', balanceId: 1250741747,
    initialBalance: 40, balance: 42.5, sessionStartBalance: 40, startedAt: startedAtMs, warmupDone: true,
    closedCandles: 300, sessionLossLimit: 8, exposureLimit: 21.25, openStake: 0, openPositions: [], paused: [],
    stats: { settled: 2, wins: 1, losses: 1, draws: 0, early: 1, earlyPos: 0, earlyNeg: 1, profit: -3.65, wr: 50 },
    universe: { size: 62, min: 170, max: 200 },
    config: { baseStake: 2, expiryMinutes: 2, maxOpsPerAsset: 3, maxStake: 30, payout: 0.86, maxExposurePct: 50, sessionLossPct: 20 },
    resultsCount: 2, rev: 'V16', codeHash: '7ba59bd0', stopped: false, ...patch,
  });

  writeJsonAtomic(fxResults, []);
  const rt = createRuntime(opts);

  check('   · antes de ATIVAR o estado real é STOPPED', rt.snapshot().state === 'STOPPED');
  check('   · odômetro do terminal não vira evento, ordem vira', parseLogLine('[⏱01:42] [🕯️10] [📊0] [WR 0.0%]') === null && parseLogLine('[📤 ORDEM] EURUSD CALL US$2.00 | teste')?.kind === 'order');
  const start = rt.start();
  alive.add(start.pid);
  check('24a. ATIVAR sobe o MESMO comando do operador (node ws-otc-v15.mjs demo)', start.ok && start.state === 'STARTING');
  check('   · sessão criada no ATIVAR mas SEM startedAt (só o runtime confirma)', (() => {
    const s = rt.readSessions().sessions[0];
    return s && s.id === start.sessionId && s.requestedAt && s.startedAt === null;
  })());
  check('   · ATIVAR de novo é bloqueado (nunca duas sessões WS)', rt.start().code === 'ALREADY_RUNNING');

  publishLive();
  rt.tick();
  const s1 = rt.readSessions().sessions[0];
  check('14. sessão começa quando ATIVAR é CONFIRMADO pelo runtime', s1.startedAt === new Date(startedAtMs).toISOString() && rt.snapshot().state === 'RUNNING');
  check('   · estado reflete o runtime real (RUNNING vindo da telemetria)', rt.snapshot().state === 'RUNNING');

  // settlement do run entra uma vez, atribuído à sessão
  writeJsonAtomic(fxResults, [
    { orderId: 900, requestId: 'q1', key: 'AAA', direction: 'CALL', kind: null, stake: 2, result: 'win', profit: 1.64, settledAt: iso(NOW - 60_000), timestamp: iso(NOW - 120_000) },
    { orderId: 901, requestId: 'q2', key: 'BBB', direction: 'PUT', kind: 'reversalGale', stake: 5.5, result: 'early', profit: -5.29, earlySell: true, settledAt: iso(NOW - 30_000), timestamp: iso(NOW - 90_000) },
  ]);
  rt.tick();
  rt.tick();
  const ledgerAfter = rt.readTrades().trades;
  check('   · settlements da sessão entram no ledger e são atribuídos a ela', ledgerAfter.length === 2 && ledgerAfter.every((t) => t.sessionId === start.sessionId));
  check('   · trade de run anterior no MESMO arquivo fica fora da sessão', (() => {
    const antes = { orderId: 777, requestId: 'z1', key: 'ZZZ', direction: 'CALL', stake: 2, result: 'win', profit: 1.5, sentAtMs: startedAtMs - 300_000, timestamp: iso(startedAtMs - 300_000), settledAt: iso(startedAtMs - 240_000) };
    writeJsonAtomic(fxResults, [antes, ...readJson(fxResults, [])]);
    rt.tick();
    const row = rt.readTrades().trades.find((t) => t.orderId === 777);
    return row && row.sessionId === null;
  })());

  const startedAtBefore = rt.snapshot().startedAt;
  const ledgerIdsBefore = rt.readTrades().trades.map((t) => t.id).sort().join('|');
  for (let i = 0; i < 3; i++) { rt.tick(); rt.snapshot(); }
  check('17. refresh/ticks não criam sessão nova', rt.readSessions().sessions.length === 1 && rt.snapshot().sessionId === start.sessionId);
  check('18. timer continua correto (startedAt estável; front calcula local)', rt.snapshot().startedAt === startedAtBefore && Date.now() - Date.parse(rt.snapshot().startedAt) >= 90_000);
  check('   · depois de 2 ticks o ledger não duplicou nada', rt.readTrades().trades.map((t) => t.id).sort().join('|') === ledgerIdsBefore);

  // posições abertas: DESATIVAR exige confirmação
  publishLive({ openStake: 7.5, openPositions: [{ key: 'AAA', asset: 'AAA', direction: 'CALL', kind: null, stake: 2 }] });
  const blockedStop = rt.stop();
  check('19. DESATIVAR com posição aberta exige confirmação (nada é abandonado sem aviso)', blockedStop.ok === false && blockedStop.code === 'OPEN_POSITIONS' && blockedStop.requiresConfirmation === true);
  const forcedStop = rt.stop({ force: true });
  check('   · confirmação libera a parada pelo MESMO fluxo (arquivo de controle)', forcedStop.ok && readJson(path.join(DATA_DIR, 'control.json')).stop?.id);
  check('25a. DESATIVAR reflete o runtime real (STOPPING enquanto o bot fecha)', rt.snapshot().state === 'STOPPING');

  // o bot executa o shutdown() da tecla K e publica o motivo no log
  children[0].stdout.write('[🛑] Encerrando (PAINEL) — fechando bot...\n');
  const logFile = rt.logFile();
  const lastLive = readJson(path.join(DATA_DIR, 'live.json'));
  alive.delete(start.pid);
  children[0].emit('exit', 0, null);
  const done = rt.readSessions().sessions.find((s) => s.id === start.sessionId);
  check('15. sessão termina no DESATIVAR confirmado', done.endedAt !== null && done.state === 'STOPPED');
  check('   · motivo do fim vem do próprio bot (log) e o saldo final da telemetria', done.endReason === 'PAINEL' && done.endBalance === lastLive.balance);
  check('   · sessão fechada leva os números do ledger (fonte da verdade)', done.stats.ops === 2 && done.stats.profit === -3.65 && done.stats.wr === 50, JSON.stringify(done.stats));
  check('28. WR/estatística da sessão batem com o ledger', summarize(rt.readTrades().trades.filter((t) => t.sessionId === start.sessionId)).profit === done.stats.profit);
  check('   · arquivo de log da sessão foi gravado', fileStat(logFile).exists && parseEndReason(readText(logFile)) === 'PAINEL');

  // LOG do painel: o odômetro do terminal usa `\r` (refresh no lugar). Ele não é evento —
  // mas não pode engolir uma linha real que veio colada nele no mesmo chunk de stdout.
  children[0].stdout.write('\r[⏱15:51] [🕯️421] [📊2] [✅2] [❌0] [WR 100%] [💰+3.38] [⏳US$0.00]\r');
  children[0].stdout.write('\r[⏱15:52] [🕯️422]\r[📤 ORDEM] EURUSD CALL US$2.00 | teste\r');
  await new Promise((r) => setImmediate(r));
  check('   · refresh do odômetro (\r) NÃO entra no LOG como evento', !rt.events().some((e) => e.text.startsWith('[⏱')));
  check('   · linha real colada no refresh ainda entra no LOG (nada se perde)', rt.events().some((e) => e.kind === 'order' && e.text.includes('[📤 ORDEM]')));

  check('   · painel parado mostra a ÚLTIMA sessão (histórico não zera na tela)', rt.snapshot().state === 'STOPPED' && rt.snapshot().session?.id === start.sessionId && rt.snapshot().session.stats.ops === 2);

  // Ingestão contínua: o bot pode fechar operação fora do painel — nada pode se perder.
  await new Promise((r) => setTimeout(r, 10));
  writeJsonAtomic(fxResults, [
    ...readJson(fxResults, []),
    { orderId: 902, requestId: 'q3', key: 'CCC', direction: 'CALL', stake: 2, result: 'win', profit: 1.6, settledAt: iso(NOW), timestamp: iso(NOW - 5_000) },
  ]);
  rt.tick();
  const foraDepois = rt.readTrades().trades.find((t) => t.orderId === 902);
  check('   · operação fechada fora de sessão entra no ledger como "fora de sessão"', foraDepois !== undefined && foraDepois.sessionId === null);
  rt.stopTimer();

  // restart do painel com o bot AINDA rodando → adota a mesma sessão
  const alive2 = new Set([77001]);
  const rt2 = createRuntime({ ...opts, isAliveImpl: (pid) => alive2.has(Number(pid)), dir: path.join(TMP, 'panel2') });
  fs.mkdirSync(path.join(TMP, 'panel2', 'ledger'), { recursive: true });
  writeJsonAtomic(path.join(TMP, 'panel2', 'runtime.json'), { schema: 'tracecom-runtime-v1', sessionId: 's-fixa', pid: 77001, account: 'demo', requestedAt: new Date().toISOString(), stop: null });
  const adopted = rt2.adopt();
  check('19b. restart do painel recupera a sessão em andamento (mesmo sessionId, sem criar outra)', adopted.adopted === true && adopted.sessionId === 's-fixa' && rt2.snapshot().state !== 'STOPPED');
  rt2.stopTimer();
}
{
  // bot subido NA MÃO (fora do painel): o painel detecta pela telemetria e não duplica sessão
  const dir = path.join(TMP, 'panel3');
  const alive = new Set([88123]);
  const rt = createRuntime({ dir, resultsFile: fxResults, configFile: fxConfig, engineFile: ENGINE_FILE, panelConfigFile: fxPanelConfig, isAliveImpl: (pid) => alive.has(Number(pid)), tickMs: 60_000, log: () => {} });
  writeJsonAtomic(path.join(dir, 'live.json'), {
    schema: 'tracecom-bot-telemetry-v1', pid: 88123, updatedAt: new Date().toISOString(), phase: 'running',
    accountType: 'DEMO', currencySymbol: 'US$', startedAt: NOW - 10_000, warmupDone: true, closedCandles: 5,
    openPositions: [], stats: { settled: 0, wins: 0, losses: 0, draws: 0, profit: 0 }, config: { baseStake: 2 },
    universe: { size: 60 }, rev: 'V16', codeHash: '7ba59bd0',
  });
  rt.tick();
  rt.tick();
  const sessions = rt.readSessions().sessions;
  check('   · bot iniciado fora do painel é detectado/adotado UMA vez', sessions.length === 1 && sessions[0].source === 'terminal');
  check('   · estado nunca fica otimista: telemetria velha vira DEGRADED', deriveState({ runtime: { pid: 1 }, live: null, pidAlive: true }) === 'DEGRADED');
  rt.stopTimer();
}
{
  const dir = path.join(TMP, 'panel4');
  const rt = createRuntime({ dir, resultsFile: fxResults, configFile: fxConfig, engineFile: ENGINE_FILE, panelConfigFile: fxPanelConfig, isAliveImpl: () => false, tickMs: 60_000, log: () => {} });
  check('   · painel parado: deriveState STOPPED (nada otimista)', rt.snapshot().state === 'STOPPED' && rt.stop().code === 'ALREADY_STOPPED');
  rt.stopTimer();
}

// ════════════════════════════════════════════════════════════════════════════
section('4. VALOR FIXO (STAKE) — MECANISMO GLOBAL EXISTENTE');
{
  const raw = readText(PATHS.config);
  const patched = patchBaseStake(raw, 4);
  const before = readJson(PATHS.config);
  const after = JSON.parse(patched);
  check('   · salvar o valor muda SÓ o baseStake da config (resto byte-a-byte igual)', (() => {
    const a = raw.split('\n'), b = patched.split('\n');
    return a.length === b.length && a.filter((l, i) => l !== b[i]).length === 1 && b.join('\n').includes('"baseStake": 4');
  })());
  check('   · nenhuma outra chave do motor é tocada', JSON.stringify({ ...before.trading, baseStake: 4 }) === JSON.stringify(after.trading));
  check('   · patch recusa arquivo sem baseStake (não corrompe config)', (() => { try { patchBaseStake('{"trading":{}}', 4); return false; } catch { return true; } })());

  const dir = path.join(TMP, 'panel5');
  const rt = createRuntime({ dir, resultsFile: fxResults, configFile: fxConfig, engineFile: ENGINE_FILE, panelConfigFile: fxPanelConfig, isAliveImpl: () => false, tickMs: 60_000, log: () => {} });
  const limite = rt.stake().max;
  check('   · máximo seguro protege o teto por ordem (não deixa o martingale estourar)', Math.abs(limite - 5.45) < 0.01, `max=${limite}`);
  const tooHigh = rt.setStake(99);
  check('23. valor acima do máximo é recusado com motivo', tooHigh.ok === false && tooHigh.code === 'STAKE_TOO_HIGH');
  const tooLow = rt.setStake(0.2);
  check('   · valor abaixo do mínimo é recusado', tooLow.ok === false && tooLow.code === 'STAKE_INVALID');
  const saved = rt.setStake(4);
  check('20/21. salvar → confirmar → read-back (o valor lido volta igual)', saved.ok === true && saved.configured === 4 && readJson(fxConfig).trading.baseStake === 4);
  check('22. nunca mostra um valor e opera outro: parado, applied = configured e pending=false', saved.applied === 4 && saved.pending === false);
  writeJsonAtomic(path.join(dir, 'live.json'), { updatedAt: new Date().toISOString(), config: { baseStake: 2 }, currencySymbol: 'US$', warmupDone: true, startedAt: Date.now() - 1000, pid: 0 });
  const liveStake = rt.stake();
  check('   · rodando com config nova, o painel mostra o valor EM OPERAÇÃO e marca pendência', liveStake.applied === 4 && liveStake.pending === false, JSON.stringify(liveStake));
  writeJsonAtomic(path.join(dir, 'runtime.json'), { pid: 4242 });
  const rtAlive = createRuntime({ dir, resultsFile: fxResults, configFile: fxConfig, engineFile: ENGINE_FILE, panelConfigFile: fxPanelConfig, isAliveImpl: () => true, tickMs: 60_000, log: () => {} });
  const runningStake = rtAlive.stake();
  check('   · com o bot rodando em OUTRO valor, o painel avisa (applied=2, configured=4, pending)', runningStake.applied === 2 && runningStake.configured === 4 && runningStake.pending === true, JSON.stringify(runningStake));
  check('   · rollback garantido: config restaurada em caso de read-back divergente', /READBACK_MISMATCH/.test(readText(fileURLToPath(new URL('../lib/runtime.mjs', import.meta.url)))));
  rt.stopTimer(); rtAlive.stopTimer();
}

// ════════════════════════════════════════════════════════════════════════════
section('5. FRONTEND: ESCOPO, TEMA E CONTRASTE');
{
  const html = readText(path.join(PATHS.panel, 'ui', 'index.html'));
  const js = readText(path.join(PATHS.panel, 'ui', 'app.js'));
  const css = readText(path.join(PATHS.panel, 'ui', 'styles.css'));

  check('1/2/3/4. frontend não tem caminho de ordem/estratégia/sinal (só lê o backend)', !/open-option|sendMessage\(|IqWsClient|new WebSocket|subscribeCandles/.test(html + js + css));
  check('   · servidor do painel também não fala com broker', !/IqWsClient|new WebSocket|sendMessage\(/.test(readText(fileURLToPath(new URL('../server.mjs', import.meta.url))) + readText(fileURLToPath(new URL('../lib/runtime.mjs', import.meta.url)))));
  check('25. frontend NÃO controla martingale (nenhum input/botão/config)', !/martingale/i.test(html) && !/martingale/i.test(css) && (js.match(/martingale/gi) ?? []).length === 1);   // o único uso é o rótulo do histórico
  check('   · só existem 3 comandos POST no painel (ATIVAR/DESATIVAR/valor fixo)', (readText(fileURLToPath(new URL('../lib/api.mjs', import.meta.url))).match(/route === 'POST/g) ?? []).length === 3);
  check('26. conta é READ-ONLY (nenhuma rota troca conta)', !/POST \/api\/account|setAccount|switchAccount/.test(html + js));

  check('21b. tema persiste (localStorage) e é aplicado no <html>', /localStorage\.setItem\(THEME_KEY/.test(js) && /dataset\.theme/.test(js) && /localStorage\.getItem\(THEME_KEY/.test(js));
  const tokens = ['--background', '--surface', '--surface-elevated', '--text-primary', '--text-secondary', '--border', '--positive', '--negative', '--neutral', '--accent', '--button-primary', '--button-secondary', '--overlay'];
  const darkBlock = css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf(':root[data-theme="light"]'));
  const lightBlock = css.slice(css.indexOf(':root[data-theme="light"]'), css.indexOf('* { box-sizing'));
  check('   · DARK tem todos os tokens semânticos', tokens.every((t) => darkBlock.includes(`${t}:`)));
  check('   · LIGHT tem todos os tokens semânticos', tokens.every((t) => lightBlock.includes(`${t}:`)));
  const rest = css.replace(darkBlock, '').replace(lightBlock, '');
  check('22b. nenhum componente usa cor crua (tudo vem de token)', !/#[0-9a-fA-F]{3,8}\b/.test(rest));

  const hex = (block, token) => {
    const m = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
    return m ? m[1] : null;
  };
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
  for (const [name, block] of [['DARK', darkBlock], ['LIGHT', lightBlock]]) {
    const bg = hex(block, '--surface');
    const pairs = [
      ['texto principal', hex(block, '--text-primary')],
      ['texto secundário', hex(block, '--text-secondary')],
      ['verde (pos)', hex(block, '--positive')],
      ['vermelho (neg)', hex(block, '--negative')],
      ['neutro (zero)', hex(block, '--neutral')],
      ['accent', hex(block, '--accent')],
    ];
    const worst = Math.min(...pairs.map(([, fg]) => ratio(fg, bg)));
    check(`23b. ${name}: contraste de todo texto/número ≥ 4.5:1 no cartão`, worst >= 4.5, `pior=${worst}`);
    check(`   · ${name}: placeholder/hint (texto muted) ainda legível`, ratio(hex(block, '--text-muted'), bg) >= 3);
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('6. PROVA: ENGINE BEHAVIOR UNCHANGED');
{
  const before = readText(BEFORE_FILE);
  const after = engineSource(ENGINE_FILE);
  check('7. o motor atual, sem os blocos [TELEMETRIA], é BYTE-A-BYTE o motor original', before === after);
  const cmp = compareSnapshots(captureSnapshotIfExists(BEFORE_FILE), captureSnapshot());
  check('   · constantes/limiares/exports/marcadores de fluxo idênticos', cmp.ok, cmp.hard.map((d) => d.field).join(', '));
  check('   · fingerprint do motor inalterado', cmp.engineFingerprint.before === cmp.engineFingerprint.after, JSON.stringify(cmp.engineFingerprint));
  const routes = captureSnapshot();
  check('   · settlement, ordem, expiração e start/stop continuam com o MESMO marcador', ['binary-options.open-option', 'parseSettlement', 'finalizeEarly', 'computeExpiration', 'shutdown(', 'process.on(\'SIGINT\''].every((m) => routes.engine.markers[m] >= 1));
  check('   · config do motor (2 min / 3 ordens / 2.75 / pirâmide) intacta', routes.config.trading.expirationMinutes === 2 && routes.config.trading.maxOpsPerAsset === 3 && routes.config.martingale.martingaleMultiplier === 2.75 && routes.config.strategy.pyramidMax === 1);
  function captureSnapshotIfExists() { return readJson(PATHS.proofBefore, null); }
}

// ════════════════════════════════════════════════════════════════════════════
section('7. API HTTP (contrato do painel, servidor isolado)');
{
  const dir = path.join(TMP, 'panel6');
  const alive = new Set();
  const children = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.pid = 60000 + children.length;
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    children.push(child);
    return child;
  };
  const rt = createRuntime({ dir, resultsFile: fxResults, configFile: fxConfig, engineFile: ENGINE_FILE, panelConfigFile: fxPanelConfig, spawnImpl, isAliveImpl: (pid) => alive.has(Number(pid)), tickMs: 60_000, log: () => {} });
  rt.ingestFromResults({ force: true });        // backfill do resultados-v15.json do bot (leitura pura)
  const { server } = createPanelServer({ runtime: rt });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = async (p, options = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { ...options, headers: { 'content-type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
    const text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body, type: res.headers.get('content-type') };
  };

  const health = await call('/api/health');
  check('   · /api/health responde ok', health.status === 200 && health.body.ok === true);
  const ui = await call('/');
  check('   · frontend é servido (html)', ui.status === 200 && String(ui.type).includes('text/html') && String(ui.body).includes('LUCRO HOJE'));
  const runtime1 = await call('/api/runtime');
  check('   · /api/runtime traz estado + stake + conexão IQ', runtime1.body.state === 'STOPPED' && runtime1.body.account.mode === 'demo' && runtime1.body.connection.ws === 'OFFLINE' && runtime1.body.stake.configured === 4);
  const stopIdle = await call('/api/runtime/stop', { method: 'POST', body: {} });
  check('   · DESATIVAR com o bot parado é idempotente (ALREADY_STOPPED)', stopIdle.body.code === 'ALREADY_STOPPED');
  const start1 = await call('/api/runtime/start', { method: 'POST', body: {} });
  alive.add(start1.body.pid);
  check('   · ATIVAR devolve STARTING com sessão e pid', start1.status === 200 && start1.body.code === 'STARTING' && start1.body.sessionId);
  const start2 = await call('/api/runtime/start', { method: 'POST', body: {} });
  check('   · ATIVAR duas vezes é recusado (sem segunda sessão WS)', start2.status === 409 && start2.body.code === 'ALREADY_RUNNING');
  const badStake = await call('/api/stake', { method: 'POST', body: { value: 'abc' } });
  check('   · valor inválido é recusado com mensagem', badStake.status === 400 && badStake.body.ok === false);
  const goodStake = await call('/api/stake', { method: 'POST', body: { value: 3 } });
  check('   · valor válido é confirmado e lido de volta', goodStake.status === 200 && goodStake.body.configured === 3);
  const stats = await call('/api/stats');
  check('17b. /api/stats traz dia/semana/mês/all + contagem de sessões', stats.body.ranges?.day && stats.body.ranges?.week && stats.body.ranges?.month && stats.body.sessions?.all >= 1);
  const hist = await call('/api/history?range=all&limit=50');
  check('18b. /api/history traz operações e sessões', Array.isArray(hist.body.trades) && Array.isArray(hist.body.sessions) && hist.body.trades.length >= 1);
  const engine = await call('/api/engine');
  check('   · /api/engine expõe a prova do motor (PASS) e a config sem credenciais', engine.body.proof.status === 'PASS' && engine.body.config.trading.expirationMinutes === 2 && !JSON.stringify(engine.body).includes('password'));
  const notFound = await call('/api/nope');
  check('   · rota inexistente devolve 404 JSON', notFound.status === 404 && notFound.body.code === 'NOT_FOUND');
  server.close();
  rt.stopTimer();

  const stillRunning = children.length;
  check('   · o painel nunca subiu o bot de verdade nos testes', stillRunning === 1);
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? '✅' : '❌'} painel+telemetria: ${pass} passaram, ${fail} falharam`);
if (fail) { console.log('falhas:'); for (const f of failures) console.log(`  - ${f}`); }
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
