/**
 * IQ Option Trader - Autônomo
 * Regras:
 * - Múltiplos activos (15 melhores, sem OTC)
 * - 1 operação por activo por vez
 * - Valor configurável
 * - Confiança ≥ 80%
 * - Análise em tempo real (sem histórico)
 * - Grava dados para backtesting
 * - Relatório HTML bonito
 * - Meta de operações configurável
 *
 * Uso: node ws-trader.mjs [email] [senha] [valor] [conta]
 */
import https from 'https';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { IqWsClient, computeExpiration, normalizeCandle } from './iqoption-ws.mjs';

// ============================================
// CONFIGURAÇÕES
// ============================================
const CONFIG = {
  TRADE_AMOUNT: 100,
  CONFIDENCE_THRESHOLD: 0.70,
  MIN_OPERATIONS: 10,
  MAX_ASSETS: 15,
  WARMUP_SECONDS: 120, // 2 minutos de warmup
  REPORTS_DIR: 'D:/Tracecom project/reports'
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
  if (!ssid) throw new Error(`Login falhou: ${res.body}`);
  console.log(`[LOGIN] OK! User: ${json.result?.user_id ?? json.user_id}`);
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
// CONFIANÇA
// ============================================
function getConfidence(candles) {
  if (!candles || candles.length < 10) return { signal: null, confidence: 0, price: 0, indicators: {} };

  try {
    const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && isFinite(v));
    if (closes.length < 10) return { signal: null, confidence: 0, price: 0, indicators: {} };

    const last = closes[closes.length - 1];
    if (!isFinite(last) || last === 0) return { signal: null, confidence: 0, price: 0, indicators: {} };

    const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : ma5;
    const momentum = last - closes[closes.length - 5];
    const volatility = candles.slice(-5).map(c => (c.max ?? 0) - (c.min ?? 0)).reduce((s, v) => s + v, 0) / 5;
    const volatilityRatio = volatility / last;

    const indicators = {
      rsi: calculateRSI(closes),
      macd: calculateMACD(closes),
      bb: calculateBollingerBands(closes),
      ma5, ma10, ma20
    };

    const alignment = (last > ma5 ? 1 : 0) + (ma5 > ma10 ? 1 : 0) + (last > ma20 ? 1 : 0);
    let signal = null, confidence = 0;

    const bullish = last > ma5 && last > ma10 && ma5 > ma10 && momentum > 0;
    const bearish = last < ma5 && last < ma10 && ma5 < ma10 && momentum < 0;

    if (bullish) {
      signal = 'CALL';
      let score = (alignment / 3) * 0.5 + Math.min(Math.abs(momentum / last) * 200, 1) * 0.3;
      if (indicators.rsi !== null) score += (indicators.rsi < 30 ? 1 : indicators.rsi < 50 ? 0.7 : indicators.rsi < 70 ? 0.4 : 0.1) * 0.2;
      score -= Math.min(volatilityRatio * 10, 0.15);
      confidence = Math.max(0, Math.min(score, 0.95));
    } else if (bearish) {
      signal = 'PUT';
      let score = ((3 - alignment) / 3) * 0.5 + Math.min(Math.abs(momentum / last) * 200, 1) * 0.3;
      if (indicators.rsi !== null) score += (indicators.rsi > 70 ? 1 : indicators.rsi > 50 ? 0.7 : indicators.rsi > 30 ? 0.4 : 0.1) * 0.2;
      score -= Math.min(volatilityRatio * 10, 0.15);
      confidence = Math.max(0, Math.min(score, 0.95));
    }

    return { signal, confidence, price: last, indicators };
  } catch { return { signal: null, confidence: 0, price: 0, indicators: {} }; }
}

// ============================================
// BACKTEST DATA
// ============================================
const backtestData = { timestamp: new Date().toISOString(), config: { ...CONFIG }, candles: new Map(), operations: [], indicators: new Map() };

function saveBacktestData(filename) {
  const data = { ...backtestData, candles: Object.fromEntries(backtestData.candles), indicators: Object.fromEntries(backtestData.indicators) };
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));
}

// ============================================
// RELATÓRIO HTML
// ============================================
function generateHTMLReport(results, config, sessionInfo) {
  const total = results.length;
  const wins = results.filter(r => r.result === 'win').length;
  const losses = total - wins;
  const winRate = total > 0 ? (wins / total * 100).toFixed(1) : 0;
  const profit = results.reduce((s, r) => s + (r.profit || 0), 0);

  const operationsRows = results.map(r => `
    <tr class="${r.result === 'win' ? 'win' : 'loss'}">
      <td>${new Date(r.closedAt).toLocaleTimeString()}</td>
      <td>${r.active}</td>
      <td><span class="direction ${r.direction.toLowerCase()}">${r.direction}</span></td>
      <td>${r.profit > 0 ? '+' : ''}R$${r.profit.toFixed(2)}</td>
      <td>${((r.confidence || 0) * 100).toFixed(0)}%</td>
      <td class="${r.result}">${r.result === 'win' ? '✅ WIN' : '❌ LOSS'}</td>
    </tr>
  `).join('');

  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${CONFIG.REPORTS_DIR}/report_${dateStr}_${Date.now()}.html`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Relatório IQ Option - ${dateStr}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #fff; min-height: 100vh; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { text-align: center; color: #00d4ff; margin-bottom: 30px; font-size: 2em; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .card { background: rgba(255,255,255,0.1); border-radius: 15px; padding: 25px; text-align: center; backdrop-filter: blur(10px); }
    .card h3 { color: #888; font-size: 0.9em; text-transform: uppercase; margin-bottom: 10px; }
    .card .value { font-size: 2.5em; font-weight: bold; }
    .card .value.positive { color: #00ff88; }
    .card .value.negative { color: #ff4757; }
    .card .value.neutral { color: #00d4ff; }
    .win-rate { background: ${winRate >= 60 ? 'linear-gradient(135deg, #00ff88, #00d4ff)' : 'linear-gradient(135deg, #ff4757, #ff6b6b)'} !important; }
    table { width: 100%; border-collapse: collapse; background: rgba(255,255,255,0.05); border-radius: 10px; overflow: hidden; }
    th { background: rgba(0,212,255,0.3); padding: 15px; text-align: left; font-weight: 600; }
    td { padding: 12px 15px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    tr:hover { background: rgba(255,255,255,0.1); }
    .win td { background: rgba(0,255,136,0.1); }
    .loss td { background: rgba(255,71,87,0.1); }
    .direction { padding: 5px 10px; border-radius: 5px; font-weight: bold; }
    .direction.call { background: #00ff88; color: #000; }
    .direction.put { background: #ff4757; color: #fff; }
    .result { font-weight: bold; }
    .result.win { color: #00ff88; }
    .result.loss { color: #ff4757; }
    .footer { text-align: center; margin-top: 30px; color: #666; font-size: 0.9em; }
    .meta { text-align: center; margin-bottom: 20px; color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Relatório IQ Option Trader</h1>
    <div class="meta">Sessão: ${sessionInfo.date} | Email: ${sessionInfo.email} | Conta: ${sessionInfo.accountType}</div>

    <div class="summary">
      <div class="card win-rate">
        <h3>Win Rate</h3>
        <div class="value ${winRate >= 60 ? 'positive' : 'negative'}">${winRate}%</div>
      </div>
      <div class="card">
        <h3>Total de Operações</h3>
        <div class="value neutral">${total}</div>
      </div>
      <div class="card">
        <h3>Wins</h3>
        <div class="value positive">${wins}</div>
      </div>
      <div class="card">
        <h3>Losses</h3>
        <div class="value negative">${losses}</div>
      </div>
      <div class="card">
        <h3>Lucro/Prejuízo</h3>
        <div class="value ${profit >= 0 ? 'positive' : 'negative'}">${profit >= 0 ? '+' : '-'}R$${Math.abs(profit).toFixed(2)}</div>
      </div>
      <div class="card">
        <h3>Valor por Operação</h3>
        <div class="value neutral">R$${config.TRADE_AMOUNT}</div>
      </div>
    </div>

    <h2 style="margin: 20px 0; color: #00d4ff;">📋 Detalhamento das Operações</h2>
    <table>
      <thead>
        <tr>
          <th>Hora</th>
          <th>Ativo</th>
          <th>Direção</th>
          <th>Lucro</th>
          <th>Confiança</th>
          <th>Resultado</th>
        </tr>
      </thead>
      <tbody>
        ${operationsRows}
      </tbody>
    </table>

    <div class="footer">
      <p>Gerado automaticamente por IQ Option Trader Bot</p>
      <p>Confiança mínima: ${(config.CONFIDENCE_THRESHOLD * 100)}% | Ativos analisados: ${config.MAX_ASSETS}</p>
    </div>
  </div>
</body>
</html>`;

  if (!fs.existsSync(CONFIG.REPORTS_DIR)) {
    fs.mkdirSync(CONFIG.REPORTS_DIR, { recursive: true });
  }

  fs.writeFileSync(filename, html);
  return filename;
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
let running = true;
let lastCandleTime = new Map();
let operationCount = 0;
let tradeAmount = CONFIG.TRADE_AMOUNT;
let email = '';
let typeName = '';

function pushCandle(raw, id) {
  if (!candleBuffer.has(id)) candleBuffer.set(id, []);
  const buf = candleBuffer.get(id);
  try {
    const c = normalizeCandle(raw, { activeId: id, serverTimestamp: ws?.serverNow(), connectionId: ws?.connectionId });
    if (lastCandleTime.get(id) === c.segmentId) return;
    lastCandleTime.set(id, c.segmentId);
    const idx = buf.findIndex(x => x.segmentId === c.segmentId);
    if (idx >= 0) buf[idx] = c;
    else { buf.push(c); if (buf.length > 300) buf.shift(); }

    // Guardar para backtest
    if (!backtestData.candles.has(id)) backtestData.candles.set(id, []);
    const history = backtestData.candles.get(id);
    if (idx >= 0) history[idx] = c;
    else history.push(c);

    // Guardar indicadores
    if (buf.length % 5 === 0) {
      const { indicators } = getConfidence(buf);
      if (!backtestData.indicators.has(id)) backtestData.indicators.set(id, []);
      backtestData.indicators.get(id).push({ timestamp: Date.now(), ...indicators });
    }
  } catch { /* ignore */ }
}

async function placeTrade(activeId, activeName, direction, confidence, price) {
  if (activeOperation) return;
  if (!warmupEndTime || Date.now() < warmupEndTime) return;

  const serverTs = Math.floor((ws.serverNow() ?? Date.now()) / 1000);
  const { expiration, optionTypeId } = computeExpiration(serverTs, 5);

  ws.placeOrder({ price: tradeAmount, activeId, direction, expiration, optionTypeId, balanceId });
  activeOperation = { activeId, activeName, direction, price, confidence, expiration, openedAt: Date.now() };
  console.log(`[📊 TRADE] ${activeName} | ${direction} R$${tradeAmount} | conf=${(confidence * 100).toFixed(1)}%`);
}

function checkExpiredOperations() {
  if (!activeOperation) return;
  if (Date.now() >= activeOperation.expiration * 1000 + 30_000) activeOperation = null;
}

// ============================================
// MAIN
// ============================================
async function main() {
  try {
    // Parse args
    const args = process.argv.slice(2);
    email = args[0] || '';
    const password = args[1] || '';
    tradeAmount = parseFloat(args[2]) || CONFIG.TRADE_AMOUNT;
    const accountChoice = args[3] || '';

    CONFIG.TRADE_AMOUNT = tradeAmount;

    console.log(`\n[🤖] IQ Option Trader - Autônomo`);
    console.log(`[💰] Valor: R$${tradeAmount} | Confiança: ${(CONFIG.CONFIDENCE_THRESHOLD*100)}% | Meta: ${CONFIG.MIN_OPERATIONS} ops\n`);

    const ssid = await login(email, password);
    ws = new IqWsClient({ log: () => {} });

    ws.on('ready', async () => {
      console.log('[WS] Ready!\n');

      // Pegar balances
      const balMsg = await ws.getBalances();
      const balData = balMsg?.msg ?? balMsg;
      const balances = [...(Array.isArray(balData) ? balData : [])].sort((a, b) => b.amount - a.amount);

      // Selecionar conta
      let selected;
      if (accountChoice) {
        const targetType = accountChoice.toLowerCase();
        selected = balances.find(b =>
          (targetType === 'real' && b.type === 0) ||
          (targetType === 'demo' && (b.type === 4 || b.type === 1)) ||
          (targetType === 'pratica' && b.type === 1) ||
          (targetType === 'conta4' && b.type === 4)
        ) || balances[0];
      } else {
        selected = balances[0];
      }

      if (!selected || selected.amount <= 0) {
        console.error('[ERRO] Nenhuma conta com saldo'); ws.close(); return;
      }

      balanceId = selected.id;
      typeName = selected.type === 0 ? 'REAL' : selected.type === 1 ? 'PRÁTICA' : selected.type === 4 ? 'DEMO' : `CONTA(${selected.type})`;
      console.log(`[💼 CONTA] ${typeName} | Saldo: R$${selected.amount.toFixed(2)}\n`);

      // Obter activos
      const initMsg = await ws.getInitializationData();
      const initData = initMsg?.msg ?? initMsg;
      const turboActives = initData?.result?.turbo?.actives ?? initData?.turbo?.actives ?? {};

      assetsToTrade = Object.entries(turboActives)
        .filter(([_, a]) => a.name && !/otc/i.test(a.name) && a.enabled && !a.is_suspended)
        .slice(0, CONFIG.MAX_ASSETS)
        .map(([id, act]) => ({ activeId: Number(id), name: act.name, ...act }));

      console.log(`[📋] ${assetsToTrade.length} activos selecionados\n`);

      // Subscrever a todos
      console.log('[🔔] Inscrevendo em candles em tempo real...');
      for (const asset of assetsToTrade) {
        candleBuffer.set(asset.activeId, []);
        lastCandleTime.set(asset.activeId, null);
        try {
          ws.subscribeCandles(asset.activeId, 5);
        } catch { /* ignore */ }
      }

      console.log(`\n[⏳] Warmup: ${CONFIG.WARMUP_SECONDS}s para acumular candles...`);
      console.log('[📊] Candles por activo (warmup):\n');

      // Mostrar candles durante warmup
      for (let i = 0; i < CONFIG.WARMUP_SECONDS; i += 10) {
        await new Promise(r => setTimeout(r, 10000));
        for (const asset of assetsToTrade.slice(0, 5)) {
          const buf = candleBuffer.get(asset.activeId) ?? [];
          process.stdout.write(`  ${asset.name}: ${buf.length} candles\r`);
        }
        console.log('');
      }

      // Status final do warmup
      console.log('\n[📊] Status após warmup:');
      for (const asset of assetsToTrade) {
        const buf = candleBuffer.get(asset.activeId) ?? [];
        console.log(`  ${asset.name}: ${buf.length} candles`);
      }

      warmupEndTime = Date.now();
      console.log('\n[✅] ROBÔ INICIADO! Analisando oportunidades...\n');
    });

    ws.on('candle-generated', (msg) => {
      const raw = msg?.msg ?? msg;
      if (!raw) return;
      const aid = raw.active_id ?? raw.activeId ?? raw.id ?? raw.aid;
      if (!aid || !candleBuffer.has(aid)) return;

      const asset = assetsToTrade.find(a => a.activeId === aid);

      pushCandle(raw, aid);
      checkExpiredOperations();

      if (activeOperation || !warmupEndTime || Date.now() < warmupEndTime) return;
      if (operationResults.some(r => r.activeId === aid)) return;

      const buf = candleBuffer.get(aid) ?? [];
      if (buf.length < 10) return;

      const { signal, confidence, price, indicators } = getConfidence(buf);

      // Debug: mostrar confiança mesmo quando não opera
      if (confidence > 0.5) {
        console.log(`[🔍 ${asset?.name || aid}] ${signal || 'NONE'} conf=${(confidence*100).toFixed(1)}%`);
      }

      if (!signal || confidence < CONFIG.CONFIDENCE_THRESHOLD) return;

      const assetName = asset?.name ?? String(aid);

      console.log(`[📈 ${assetName}] RSI:${indicators.rsi?.toFixed(1) || 'N/A'} | MACD:${indicators.macd?.histogram?.toFixed(5) || 'N/A'} | Conf:${(confidence*100).toFixed(1)}%`);

      placeTrade(aid, assetName, signal, confidence, price).catch(e => console.log(`[❌] ${e.message}`));
    });

    ws.on('socket-option-closed', (msg) => {
      const raw = msg?.msg ?? msg;
      if (!raw || !activeOperation || activeOperation.openedAt < warmupEndTime) return;

      const profit = raw.profit ?? 0;
      const result = profit > 0 ? 'win' : 'loss';
      const dir = raw.dir ?? activeOperation.direction;

      operationResults.push({
        activeId: activeOperation.activeId, active: activeOperation.activeName,
        direction: dir, result, profit, confidence: activeOperation.confidence,
        closedAt: Date.now()
      });

      operationCount = operationResults.length;

      console.log(`\n[${result === 'win' ? '✅ WIN' : '❌ LOSS'}] ${activeOperation.activeName} | profit=${profit > 0 ? '+' : ''}${profit.toFixed(2)}`);
      const wins = operationResults.filter(r => r.result === 'win').length;
      console.log(`[📊 PARCIAL] Wins: ${wins} | Losses: ${operationCount - wins} | Total: ${operationCount} | WR: ${((wins/operationCount)*100).toFixed(0)}%\n`);

      backtestData.operations.push(operationResults[operationResults.length - 1]);
      activeOperation = null;

      if (operationCount >= CONFIG.MIN_OPERATIONS) {
        console.log(`[🎯] Meta de ${CONFIG.MIN_OPERATIONS} operações atingida!\n`);
        running = false;
      }
    });

    // Debug: mostrar todos os eventos
    ws.on('message', (msg) => {
      const name = msg?.name;
      if (name && /candle|heartbeat|timeSync/i.test(name)) {
        process.stdout.write('.');
      }
    });

    await ws.connect({ ssid });

    // Loop principal
    while (running) {
      await new Promise(r => setTimeout(r, 1000));
    }

    // ============================================
    // RELATÓRIO FINAL
    // ============================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊  RELATÓRIO FINAL');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const wins = operationResults.filter(r => r.result === 'win').length;
    const losses = operationResults.length - wins;
    const winRate = operationResults.length > 0 ? (wins / operationResults.length * 100).toFixed(1) : 0;
    const profit = operationResults.reduce((s, r) => s + (r.profit || 0), 0);

    console.log(`\n📈 Total de operações: ${operationResults.length}`);
    console.log(`✅ Wins: ${wins} | ❌ Losses: ${losses}`);
    console.log(`🎯 Win Rate: ${winRate}%`);
    console.log(`💰 Lucro/Prejuízo: ${profit >= 0 ? '+' : '-'}R$${Math.abs(profit).toFixed(2)}`);
    console.log(`💵 Valor por operação: R$${tradeAmount}`);
    console.log('');

    if (Number(winRate) >= 60) {
      console.log('🏆 META BATIDA! Win rate ≥ 60%');
    } else {
      console.log(`📉 Abaixo da meta. Precisa de ${Math.ceil((0.6 * operationResults.length - wins) / 0.4)} wins a mais para atingir 60%`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Salvar JSON
    const jsonFile = `${CONFIG.REPORTS_DIR}/backtest_${Date.now()}.json`;
    saveBacktestData(jsonFile);
    console.log(`[💾] JSON: ${jsonFile}`);

    // Salvar HTML
    const htmlFile = generateHTMLReport(operationResults, CONFIG, {
      date: new Date().toLocaleString('pt-BR'),
      email: email,
      accountType: typeName
    });
    console.log(`[📄] HTML: ${htmlFile}`);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    ws.close();

  } catch (err) {
    console.error('[FATAL]', err);
  } finally {
    ws?.close();
    process.exit(0);
  }
}

main();
