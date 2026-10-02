/**
 * IQ Option Trader - MULTI OPERAÇÕES
 *
 * Faz múltiplas operações SIMULTÂNEAS em diferentes ativos
 * Um por ativo, opera em todos ao mesmo tempo
 *
 * Uso: node ws-multi.mjs [email] [senha] [valor]
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration, normalizeCandle } from './iqoption-ws.mjs';

const EMAIL = process.argv[2] || 'Anaalaura2008@gmail.com';
const PASSWORD = process.argv[3] || 'Eqvpanp.32';
const TRADE_AMOUNT = parseFloat(process.argv[4]) || 100;

const RESULTADOS_FILE = 'D:/Tracecom project/resultados.json';

// State global
const candleBuffer = new Map();
const activeOperations = new Map();  // activeId -> operation
const resultados = [];
let assets = [];
let ws = null;
let balanceId = null;
let warmupEndTime = null;
let running = true;

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

async function login() {
  console.log('[LOGIN] Fazendo login...');
  const data = JSON.stringify({ identifier: EMAIL, password: PASSWORD });
  const res = await httpRequest({
    hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
      'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/',
    }
  }, data);
  const json = JSON.parse(res.body);
  const ssid = json.result?.ssid ?? json.ssid;
  if (!ssid) throw new Error('Login falhou');
  console.log(`[LOGIN] OK! User: ${json.result?.user_id}`);
  return ssid;
}

function getSignal(candles) {
  if (!candles || candles.length < 5) return null;

  const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && isFinite(v));
  if (closes.length < 5) return null;

  const last = closes[closes.length - 1];
  if (!isFinite(last) || last === 0) return null;

  const ma3 = closes.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const momentum = last - closes[closes.length - 3];

  // Sinal simples baseado em médias móveis
  if (last > ma3 && last > ma5 && momentum > 0) {
    return 'CALL';
  } else if (last < ma3 && last < ma5 && momentum < 0) {
    return 'PUT';
  }
  return null;
}

function salvarResultados() {
  fs.writeFileSync(RESULTADOS_FILE, JSON.stringify(resultados, null, 2));
}

async function main() {
  try {
    const ssid = await login();
    ws = new IqWsClient({ log: () => {} });

    ws.on('ready', async () => {
      console.log('[WS] Ready!');

      // Pegar saldo
      const balMsg = await ws.getBalances();
      const balData = balMsg?.msg ?? balMsg;
      const balances = [...(Array.isArray(balData) ? balData : [])].sort((a, b) => b.amount - a.amount);
      const conta = balances.find(b => b.type === 4) || balances[0];

      if (!conta || conta.amount <= 0) {
        console.error('[ERRO] Sem saldo');
        ws.close();
        return;
      }

      balanceId = conta.id;
      const tipo = conta.type === 0 ? 'REAL' : conta.type === 4 ? 'DEMO' : 'PRÁTICA';
      console.log(`[💼 CONTA] ${tipo} | Saldo: R$${conta.amount.toFixed(2)}`);

      // Pegar activos
      const initMsg = await ws.getInitializationData();
      const initData = initMsg?.msg ?? initMsg;
      const turboActives = initData?.turbo?.actives ?? {};

      assets = Object.entries(turboActives)
        .filter(([_, a]) => a.name && !/otc/i.test(a.name) && a.enabled && !a.is_suspended)
        .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

      console.log(`[📋] ${assets.length} activos disponíveis\n`);

      // Subscrever a todos
      for (const asset of assets) {
        candleBuffer.set(asset.activeId, []);
        ws.subscribeCandles(asset.activeId, 5);
      }

      console.log('[⏳] Warmup 60s...\n');
      await new Promise(r => setTimeout(r, 60_000));

      warmupEndTime = Date.now();
      console.log('[✅] INICIADO! Fazendo operações em todos os ativos...\n');
    });

    ws.on('candle-generated', (msg) => {
      const raw = msg?.msg ?? msg;
      if (!raw) return;

      const aid = raw.active_id ?? raw.activeId ?? raw.id ?? raw.aid;
      if (!aid || !candleBuffer.has(aid)) return;

      const buf = candleBuffer.get(aid);
      try {
        const c = normalizeCandle(raw, { activeId: aid, serverTimestamp: ws?.serverNow(), connectionId: ws?.connectionId });
        const idx = buf.findIndex(x => x.segmentId === c.segmentId);
        if (idx >= 0) buf[idx] = c;
        else buf.push(c);
        if (buf.length > 100) buf.shift();
      } catch { return; }

      // Verificar se pode operar neste ativo
      if (activeOperations.has(aid)) return; // Já tem operação
      if (!warmupEndTime || Date.now() < warmupEndTime) return;
      if (buf.length < 5) return;

      const signal = getSignal(buf);
      if (!signal) return;

      const asset = assets.find(a => a.activeId === aid);
      const assetName = asset?.name ?? String(aid);

      // Verificar se expirou (máximo 5 min)
      const op = activeOperations.get(aid);
      if (op && Date.now() > op.expiration * 1000 + 30_000) {
        activeOperations.delete(aid);
      } else if (op) {
        return; // Ainda tem operação activa
      }

      // Colocar ordem
      const serverTs = Math.floor((ws.serverNow() ?? Date.now()) / 1000);
      const { expiration, optionTypeId } = computeExpiration(serverTs, 5);

      ws.placeOrder({
        price: TRADE_AMOUNT,
        activeId: aid,
        direction: signal,
        expiration,
        optionTypeId,
        balanceId
      });

      activeOperations.set(aid, {
        activeId: aid,
        name: assetName,
        direction: signal,
        expiration,
        openedAt: Date.now()
      });

      console.log(`[📊 ${assetName}] ${signal} | R$${TRADE_AMOUNT}`);
    });

    ws.on('socket-option-closed', (msg) => {
      const raw = msg?.msg ?? msg;
      if (!raw) return;

      const aid = raw.active_id ?? raw.activeId;
      const op = activeOperations.get(aid);
      if (!op) return;

      const profit = raw.profit ?? 0;
      const result = profit > 0 ? 'win' : 'loss';

      resultados.push({
        active: op.name,
        direction: op.direction,
        result,
        profit,
        timestamp: new Date().toISOString()
      });

      activeOperations.delete(aid);

      console.log(`[${result === 'win' ? '✅' : '❌'}] ${op.name} | ${op.direction} | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}`);

      // Estatísticas
      const wins = resultados.filter(r => r.result === 'win').length;
      const total = resultados.length;
      const wr = ((wins / total) * 100).toFixed(1);
      console.log(`[📈] Total: ${total} | Wins: ${wins} | WR: ${wr}%\n`);

      salvarResultados();

      if (total >= 10) {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📊 RELATÓRIO FINAL');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Total: ${total}`);
        console.log(`Wins: ${wins}`);
        console.log(`Losses: ${total - wins}`);
        console.log(`Win Rate: ${wr}%`);
        const lucro = resultados.reduce((s, r) => s + r.profit, 0);
        console.log(`Lucro: ${lucro >= 0 ? '+' : '-'}R$${Math.abs(lucro).toFixed(2)}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        running = false;
      }
    });

    await ws.connect({ ssid });

    // Loop principal
    while (running) {
      await new Promise(r => setTimeout(r, 2000));

      // Mostrar status a cada 30s
      const opsAtivas = activeOperations.size;
      const wins = resultados.filter(r => r.result === 'win').length;
      const total = resultados.length;
      if (total > 0) {
        process.stdout.write(`\r[⏱️] Ops: ${total} | Ativas: ${opsAtivas} | WR: ${((wins/total)*100).toFixed(0)}%   `);
      }
    }

    ws.close();

  } catch (err) {
    console.error('[FATAL]', err);
  } finally {
    ws?.close();
    process.exit(0);
  }
}

main();
