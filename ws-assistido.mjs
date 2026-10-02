/**
 * IQ Option Trader - Modo Assistido (Claude opera manualmente)
 *
 * O robô coleta dados e mostra em tempo real.
 * Claude analisa e decide quando operar.
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration, normalizeCandle } from './iqoption-ws.mjs';

// ============================================
// CONFIGURAÇÕES
// ============================================
const CONFIG = {
  TRADE_AMOUNT: 100,
  MIN_CONFIDENCE: 0.70,
  ACCOUNT_TYPE: 'conta4', // demo
  SIGNAL_FILE: 'D:/Tracecom project/signal.json'
};

// ============================================
// LOGIN
// ============================================
function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function login(email, password) {
  console.log('[LOGIN] Fazendo login...');
  const data = JSON.stringify({ identifier: email, password });
  const res = await httpRequest({
    hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
      'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/',
    }
  }, data);
  const json = JSON.parse(res.body);
  const ssid = json.result?.ssid ?? json.ssid;
  if (!ssid) throw new Error(`Login falhou`);
  console.log(`[LOGIN] OK!`);
  return ssid;
}

// ============================================
// INDICADORES
// ============================================
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateMACD(closes) {
  if (closes.length < 26) return null;
  const ema = (prices, period) => {
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
    return ema;
  };
  const ema12 = ema(closes, 12), ema26 = ema(closes, 26);
  const macd = ema12 - ema26;
  const signal = ema([...Array(9).fill(macd), macd], 9);
  return { macd, signal, histogram: macd - signal };
}

function calculateBollingerBands(closes, period = 20) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((s, v) => s + Math.pow(v - sma, 2), 0) / period);
  return { upper: sma + std * 2, middle: sma, lower: sma - std * 2 };
}

// ============================================
// ANÁLISE COMPLETA
// ============================================
function analyze(candles, name) {
  if (!candles || candles.length < 10) return null;

  const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && isFinite(v));
  if (closes.length < 10) return null;

  const last = closes[closes.length - 1];
  if (!isFinite(last) || last === 0) return null;

  const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : ma5;
  const momentum = last - closes[closes.length - 5];
  const volatility = candles.slice(-5).map(c => (c.max ?? 0) - (c.min ?? 0)).reduce((s, v) => s + v, 0) / 5;

  const rsi = calculateRSI(closes);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes);

  const alignment = (last > ma5 ? 1 : 0) + (ma5 > ma10 ? 1 : 0) + (last > ma20 ? 1 : 0);

  // Análise de tendência
  const bullish = last > ma5 && last > ma10 && ma5 > ma10 && momentum > 0;
  const bearish = last < ma5 && last < ma10 && ma5 < ma10 && momentum < 0;

  // RSI
  const rsiBullish = rsi !== null && rsi < 50 && rsi > 20;
  const rsiBearish = rsi !== null && rsi > 50 && rsi < 80;

  // MACD
  const macdBullish = macd && macd.histogram > 0 && macd.macd > macd.signal;
  const macdBearish = macd && macd.histogram < 0 && macd.macd < macd.signal;

  // Bollinger
  const nearLowerBB = bb && last < bb.middle - (bb.middle - bb.lower) * 0.3;
  const nearUpperBB = bb && last > bb.middle + (bb.upper - bb.middle) * 0.3;

  // Score baseado na minha análise
  let callScore = 0, putScore = 0;

  if (bullish) callScore += 30;
  if (macdBullish) callScore += 20;
  if (rsiBullish) callScore += 20;
  if (nearLowerBB) callScore += 15;
  if (alignment >= 2) callScore += 15;

  if (bearish) putScore += 30;
  if (macdBearish) putScore += 20;
  if (rsiBearish) putScore += 20;
  if (nearUpperBB) putScore += 15;
  if (alignment <= 1) putScore += 15;

  const confidence = Math.max(callScore, putScore) / 100;
  const signal = callScore > putScore ? 'CALL' : putScore > callScore ? 'PUT' : null;

  return {
    name,
    price: last,
    ma5, ma10, ma20,
    momentum,
    rsi,
    macd,
    bb,
    alignment,
    signal,
    confidence,
    callScore,
    putScore,
    candles: candles.length,
    analysis: buildAnalysisText({ bullish, bearish, rsiBullish, rsiBearish, macdBullish, macdBearish, nearLowerBB, nearUpperBB, alignment, rsi, momentum })
  };
}

function buildAnalysisText({ bullish, bearish, rsiBullish, rsiBearish, macdBullish, macdBearish, nearLowerBB, nearUpperBB, alignment, rsi, momentum }) {
  const points = [];
  if (bullish) points.push('📈 Tendência de ALTA');
  if (bearish) points.push('📉 Tendência de BAIXA');
  if (macdBullish) points.push('MACD bullish');
  if (macdBearish) points.push('MACD bearish');
  if (rsiBullish) points.push(`RSI em ${rsi?.toFixed(1)} (sobre-vendido)`);
  if (rsiBearish) points.push(`RSI em ${rsi?.toFixed(1)} (sobre-comprado)`);
  if (nearLowerBB) points.push('Próximo da banda inferior');
  if (nearUpperBB) points.push('Próximo da banda superior');
  if (momentum > 0) points.push(`Momentum +${(momentum * 100).toFixed(2)}%`);
  if (momentum < 0) points.push(`Momentum ${(momentum * 100).toFixed(2)}%`);
  return points.join(' | ') || 'Neutro';
}

// ============================================
// STATE
// ============================================
const candleBuffer = new Map();
let activeOperation = null;
const operationResults = [];
let assetsToTrade = [];
let ws = null;
let balanceId = null;
let warmupEndTime = null;
let lastSignalTime = new Map();

function pushCandle(raw, id) {
  if (!candleBuffer.has(id)) candleBuffer.set(id, []);
  const buf = candleBuffer.get(id);
  try {
    const c = normalizeCandle(raw, { activeId: id, serverTimestamp: ws?.serverNow(), connectionId: ws?.connectionId });
    const idx = buf.findIndex(x => x.segmentId === c.segmentId);
    if (idx >= 0) buf[idx] = c;
    else { buf.push(c); if (buf.length > 100) buf.shift(); }
  } catch { /* ignore */ }
}

function printAnalysis() {
  console.clear();
  console.log('\n╔══════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                           📊 ANÁLISE EM TEMPO REAL                                              ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════════════════════╣');

  const analyses = [];

  for (const asset of assetsToTrade) {
    const buf = candleBuffer.get(asset.activeId) ?? [];
    const analysis = analyze(buf, asset.name);
    if (analysis) {
      analyses.push(analysis);
    }
  }

  // Ordenar por confiança
  analyses.sort((a, b) => b.confidence - a.confidence);

  // Mostrar activos disponíveis
  if (analyses.length > 0 && analyses[0].candles >= 10) {
    console.log('  📋 Activos: ' + assetsToTrade.map(a => a.name).slice(0,5).join(', ') + '...');
  }

  // Top 5 oportunidades
  console.log('\n  🔥 TOP OPORTUNIDADES:');
  const top5 = analyses.slice(0, 5);
  for (const a of top5) {
    const emoji = a.signal === 'CALL' ? '🟢' : a.signal === 'PUT' ? '🔴' : '⚪';
    const conf = (a.confidence * 100).toFixed(0).padStart(3);
    console.log(`  ${emoji} ${a.name.padEnd(20)} ${(a.signal || '---').padEnd(5)} ${conf}% | RSI: ${a.rsi?.toFixed(1) || 'N/A'.padEnd(5)} | ${a.analysis.substring(0, 50)}`);
  }

  console.log('\n  📋 TODOS OS ATIVOS:');
  for (const a of analyses) {
    const emoji = a.signal === 'CALL' ? '🟢' : a.signal === 'PUT' ? '🔴' : '⚪';
    const conf = (a.confidence * 100).toFixed(0).padStart(3);
    console.log(`  ${emoji} ${a.name.padEnd(20)} ${(a.signal || '---').padEnd(5)} ${conf}% | RSI: ${a.rsi?.toFixed(1) || 'N/A'.padEnd(5)}`);
  }

  console.log('\n  📈 RESULTADO DAS OPERAÇÕES:');
  const wins = operationResults.filter(r => r.result === 'win').length;
  const total = operationResults.length;
  const wr = total > 0 ? ((wins / total) * 100).toFixed(0) : 0;
  console.log(`  Operações: ${total} | Wins: ${wins} | Losses: ${total - wins} | WR: ${wr}%`);

  if (operationResults.length > 0) {
    console.log('\n  🕐 ÚLTIMAS OPERAÇÕES:');
    for (const op of operationResults.slice(-5)) {
      const emoji = op.result === 'win' ? '✅' : '❌';
      console.log(`  ${emoji} ${op.direction} ${op.active} | ${op.profit > 0 ? '+' : ''}R$${op.profit.toFixed(2)}`);
    }
  }

  console.log('\n╠══════════════════════════════════════════════════════════════════════════════════════════════╣');
  console.log('║  COMANDOS: Escreva no arquivo signal.json para operar                                          ║');
  console.log('║  {"action": "TRADE", "active": "front.EURUSD-op", "direction": "CALL"}                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════╝\n');
}

async function placeTrade(activeId, activeName, direction) {
  if (activeOperation) {
    console.log('[🚀] Já existe operação activa');
    return;
  }

  const serverTs = Math.floor((ws.serverNow() ?? Date.now()) / 1000);
  console.log('[🚀] Server time:', serverTs);

  const { expiration, optionTypeId } = computeExpiration(serverTs, 5);
  console.log('[🚀] Expiration:', expiration, 'OptionTypeId:', optionTypeId);

  console.log('[🚀] BalanceId:', balanceId, 'ActiveId:', activeId);

  ws.placeOrder({
    price: CONFIG.TRADE_AMOUNT,
    activeId,
    direction,
    expiration,
    optionTypeId,
    balanceId
  });

  activeOperation = { activeId, activeName, direction, expiration, openedAt: Date.now() };
  console.log(`\n🚀 OPERANDO: ${activeName} | ${direction} | R$${CONFIG.TRADE_AMOUNT}\n`);
}

function checkSignal() {
  try {
    if (!fs.existsSync(CONFIG.SIGNAL_FILE)) return;

    console.log('[📡] Signal detectado!');
    const signal = JSON.parse(fs.readFileSync(CONFIG.SIGNAL_FILE, 'utf8'));
    console.log('[📡] Signal:', JSON.stringify(signal));

    if (signal.action === 'TRADE' && !activeOperation) {
      const asset = assetsToTrade.find(a => a.name === signal.active);
      if (asset) {
        console.log('[📡] Ativo encontrado:', asset.name, asset.activeId);
        placeTrade(asset.activeId, asset.name, signal.direction);
      } else {
        console.log('[📡] Ativo NÃO encontrado:', signal.active);
        console.log('[📡] Activos disponíveis:', assetsToTrade.map(a => a.name).join(', '));
      }
      fs.unlinkSync(CONFIG.SIGNAL_FILE);
    }
  } catch (e) { console.log('[📡] Erro:', e.message); }
}

// ============================================
// MAIN
// ============================================
async function main() {
  const email = process.argv[2] || 'Anaalaura2008@gmail.com';
  const password = process.argv[3] || 'Eqvpanp.32';

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🤖  IQ OPTION TRADER - MODO ASSISTIDO');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Claude analisa os dados e envia sinais via signal.json\n');

  const ssid = await login(email, password);
  ws = new IqWsClient({ log: () => {} });

  ws.on('ready', async () => {
    console.log('[WS] Ready!\n');

    // Pegar balances
    const balMsg = await ws.getBalances();
    const balData = balMsg?.msg ?? balMsg;
    const balances = [...(Array.isArray(balData) ? balData : [])].sort((a, b) => b.amount - a.amount);
    const selected = balances.find(b => b.type === 4) || balances[0];

    if (!selected || selected.amount <= 0) {
      console.error('[ERRO] Sem saldo'); ws.close(); return;
    }

    balanceId = selected.id;
    const typeName = selected.type === 0 ? 'REAL' : selected.type === 1 ? 'PRÁTICA' : 'DEMO';
    console.log(`[💼 CONTA] ${typeName} | Saldo: R$${selected.amount.toFixed(2)}\n`);

    // Obter activos
    const initMsg = await ws.getInitializationData();
    const initData = initMsg?.msg ?? initMsg;
    console.log('[DEBUG] initData keys:', Object.keys(initData || {}));
    console.log('[DEBUG] result keys:', Object.keys(initData?.result || {}));
    const turboActives = initData?.result?.turbo?.actives ?? initData?.turbo?.actives ?? {};
    console.log('[DEBUG] turboActives count:', Object.keys(turboActives).length);

    assetsToTrade = Object.entries(turboActives)
      .filter(([_, a]) => a.name && !/otc/i.test(a.name) && a.enabled && !a.is_suspended)
      .slice(0, 15)
      .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

    console.log(`[📋] ${assetsToTrade.length} activos monitorados: ${assetsToTrade.map(a => a.name).join(', ')}\n`);

    // Subscrever
    for (const asset of assetsToTrade) {
      candleBuffer.set(asset.activeId, []);
      ws.subscribeCandles(asset.activeId, 5);
    }

    warmupEndTime = Date.now() + 30000; // 30s warmup
    console.log('[⏳] Aguardando warmup...\n');
  });

  ws.on('candle-generated', (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid = raw.active_id ?? raw.activeId ?? raw.id ?? raw.aid;
    if (!aid || !candleBuffer.has(aid)) return;
    pushCandle(raw, aid);
  });

  ws.on('option-opened', (msg) => {
    const raw = msg?.msg ?? msg;
    console.log('[✅] Ordem confirmada:', JSON.stringify(raw).substring(0, 100));
  });

  ws.on('message', (msg) => {
    if (msg?.name && /option|buy|result/i.test(msg.name)) {
      console.log('[MSG]', msg.name, ':', JSON.stringify(msg?.msg ?? msg).substring(0, 100));
    }
  });

  ws.on('socket-option-closed', (msg) => {
    const raw = msg?.msg ?? msg;
    console.log('[📊] Opção fechada:', JSON.stringify(raw));
    if (!raw || !activeOperation) return;

    const profit = raw.profit ?? 0;
    const result = profit > 0 ? 'win' : 'loss';

    operationResults.push({
      active: activeOperation.activeName,
      direction: activeOperation.direction,
      result,
      profit,
      closedAt: Date.now()
    });

    console.log(`\n[${result === 'win' ? '✅ WIN' : '❌ LOSS'}] ${activeOperation.activeName} | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}\n`);
    activeOperation = null;
  });

  await ws.connect({ ssid });

  // Aguardar warmup
  await new Promise(r => setTimeout(r, 30000));

  console.log('[✅] INICIADO! Analisando...\n');

  // Loop principal
  while (true) {
    printAnalysis();
    checkSignal();
    await new Promise(r => setTimeout(r, 5000));
  }
}

main().catch(console.error);
