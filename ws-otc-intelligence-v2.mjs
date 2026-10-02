/**
 * OTC INTELLIGENCE BOT v2
 * ========================
 * Baseado na análise de 17h de dados históricos:
 * - FADE3: neutro (~50%)
 * - RSI(2) EXTREME: REVERSO! RSI < 15 → PUT, RSI > 85 → CALL
 * - Alguns ativos têm padrões específicos
 *
 * Estratégia: RSI2 Reverso + Filtro por ativo
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration, normalizeCandle } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';
const TRADE_AMOUNT = 50; // Reduzir para teste

// Ativos com padrão positivo identificado na análise
const GOOD_PATTERNS = {
  'Ripple': 'PUT',    // 65% WR
  'Solana': 'PUT',    // 58% WR
  'USD-INR': 'PUT',   // 58% WR
  'Litecoin': 'PUT',  // 56% WR
  'ETH-USD': 'PUT',   // 60% WR
  'USD-SGD': 'CALL',  // 62% WR
  'USD-HKD': 'CALL',  // 54% WR
  'Vaulta': 'CALL',   // 60% WR
  'Dash': 'CALL',     // 54% WR
};

// ============================================
// RSI(2) - Responsivo
// ============================================
function calculateRSI2(closes) {
  const period = 2;
  if (closes.length < period + 1) return NaN;

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  if (avgLoss === 0) return 100;

  let rsi = 100 - (100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
    rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

// ============================================
// Estratégia: RSI2 Reverso + Fade3
// ============================================
function getSignal(candles, assetName) {
  if (!candles || candles.length < 5) return null;

  const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && isFinite(v));
  if (closes.length < 5) return null;

  // Estratégia 1: RSI2 Reverso
  const rsi2 = calculateRSI2(closes);
  if (Number.isFinite(rsi2)) {
    // Descoberta: RSI < 15 → PREÇO CAI, RSI > 85 → PREÇO SOBE
    if (rsi2 < 15) {
      return { signal: 'PUT', strategy: 'RSI2-REVERSE', rsi: rsi2 };
    }
    if (rsi2 > 85) {
      return { signal: 'CALL', strategy: 'RSI2-REVERSE', rsi: rsi2 };
    }
  }

  // Estratégia 2: Fade3 (contra 3 velas) - para ativos específicos
  if (closes.length >= 4) {
    const a = closes[closes.length - 1] > closes[closes.length - 2];
    const b = closes[closes.length - 2] > closes[closes.length - 3];
    const c = closes[closes.length - 3] > closes[closes.length - 4];

    // Padrão específico por ativo
    const pattern = Object.entries(GOOD_PATTERNS).find(([name]) => assetName.includes(name));

    if (a && b && c) {
      // 3 velas para cima
      if (pattern && pattern[1] === 'PUT') {
        return { signal: 'PUT', strategy: 'FADE3-ASSET', rsi: 50 };
      }
      // Default: neutro para Fade3
    }
    if (!a && !b && !c) {
      // 3 velas para baixo
      if (pattern && pattern[1] === 'CALL') {
        return { signal: 'CALL', strategy: 'FADE3-ASSET', rsi: 50 };
      }
    }
  }

  return null;
}

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
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
      'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' }
  }, data);
  const json = JSON.parse(res.body);
  const ssid = json.result?.ssid ?? json.ssid;
  if (!ssid) throw new Error('Login falhou');
  console.log('[LOGIN] OK!\n');
  return ssid;
}

async function main() {
  try {
    const ssid = await login();
    const ws = new IqWsClient({ log: () => {} });

    const candleBuffer = new Map();
    const activeOperations = new Map();
    const resultados = [];

    let balanceId = null;
    let warmupEndTime = null;

    ws.on('ready', async () => {
      console.log('[WS] Ready!');

      const balMsg = await ws.getBalances();
      const balData = balMsg?.msg ?? balMsg;
      const balances = [...(Array.isArray(balData) ? balData : [])].sort((a, b) => b.amount - a.amount);
      const conta = balances.find(b => b.type === 4) || balances[0];

      if (!conta || conta.amount <= 0) {
        console.error('[ERRO] Sem saldo'); ws.close(); return;
      }

      balanceId = conta.id;
      console.log(`[💼 CONTA] DEMO | Saldo: R$${conta.amount.toFixed(2)}\n`);
      console.log('[📊 ESTRATÉGIA] RSI2-REVERSE + FADE3-ASSET\n');

      const initMsg = await ws.getInitializationData();
      const initData = initMsg?.msg ?? initMsg;
      const turboActives = initData?.turbo?.actives ?? {};

      // Filtrar apenas OTC
      const assets = Object.entries(turboActives)
        .filter(([_, a]) => a.name && /otc/i.test(a.name))
        .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

      console.log(`[📋] ${assets.length} activos OTC monitorados`);

      // Filtrar apenas os com padrão identificado
      const goodAssets = assets.filter(a =>
        Object.keys(GOOD_PATTERNS).some(name => a.name.includes(name))
      );

      if (goodAssets.length > 0) {
        console.log(`[📋] Ativos com padrão: ${goodAssets.map(a => a.name).join(', ')}`);
      }
      console.log('');

      for (const asset of assets) {
        candleBuffer.set(asset.activeId, { candles: [], asset });
        ws.subscribeCandles(asset.activeId, 60);
      }

      console.log('[⏳] Warmup 60s...\n');
      await new Promise(r => setTimeout(r, 60_000));

      warmupEndTime = Date.now();
      console.log('[✅] INICIADO!\n');
    });

    ws.on('candle-generated', (msg) => {
      const raw = msg?.msg ?? msg;
      if (!raw) return;

      const aid = raw.active_id ?? raw.activeId ?? raw.id ?? raw.aid;
      if (!aid || !candleBuffer.has(aid)) return;

      const buf = candleBuffer.get(aid);
      try {
        const c = normalizeCandle(raw, { activeId: aid, serverTimestamp: ws?.serverNow(), connectionId: ws?.connectionId });
        const idx = buf.candles.findIndex(x => x.segmentId === c.segmentId);
        if (idx >= 0) buf.candles[idx] = c;
        else buf.candles.push(c);
        if (buf.candles.length > 100) buf.candles.shift();
      } catch { return; }

      if (activeOperations.has(aid)) return;
      if (!warmupEndTime || Date.now() < warmupEndTime) return;

      const result = getSignal(buf.candles, buf.asset.name);
      if (!result) return;

      const { expiration, optionTypeId } = computeExpiration(Math.floor((ws.serverNow() ?? Date.now()) / 1000), 1);

      ws.placeOrder({
        price: TRADE_AMOUNT,
        activeId: aid,
        direction: result.signal,
        expiration,
        optionTypeId,
        balanceId
      });

      activeOperations.set(aid, {
        activeId: aid,
        name: buf.asset.name,
        direction: result.signal,
        strategy: result.strategy,
        expiration,
        rsi: result.rsi,
        openedAt: Date.now()
      });

      console.log(`[📊 ${buf.asset.name}] ${result.strategy} ${result.signal} | RSI: ${result.rsi?.toFixed(1) || 'N/A'}`);

      resultados.push({
        active: buf.asset.name,
        direction: result.signal,
        strategy: result.strategy,
        rsi: result.rsi,
        timestamp: new Date().toISOString()
      });
    });

    ws.on('socket-option-closed', (msg) => {
      const raw = msg?.msg ?? msg;
      if (!raw) return;

      const aid = raw.active_id ?? raw.activeId;
      const op = activeOperations.get(aid);
      if (!op) return;

      const profit = raw.profit ?? 0;
      const result = profit > 0 ? 'win' : 'loss';
      const emoji = result === 'win' ? '✅' : '❌';

      console.log(`[${emoji}] ${op.name} | ${op.strategy} | ${op.direction} | RSI:${op.rsi?.toFixed(1)} | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}`);

      const idx = resultados.findIndex(r => r.active === op.name && r.strategy === op.strategy && !r.result);
      if (idx >= 0) {
        resultados[idx].result = result;
        resultados[idx].profit = profit;
      }

      activeOperations.delete(aid);

      // Estatísticas
      const wins = resultados.filter(r => r.result === 'win').length;
      const total = resultados.filter(r => r.result).length;
      if (total > 0) {
        const wr = ((wins / total) * 100).toFixed(1);
        const totalProfit = resultados.filter(r => r.result).reduce((s, r) => s + (r.profit || 0), 0);
        console.log(`[📈] Total: ${total} | Wins: ${wins} | WR: ${wr}% | Lucro: R$${totalProfit.toFixed(2)}\n`);
        fs.writeFileSync('D:/Tracecom project/resultados-otc-v2.json', JSON.stringify(resultados, null, 2));
      }
    });

    await ws.connect({ ssid });

    while (true) {
      await new Promise(r => setTimeout(r, 5000));
      const wins = resultados.filter(r => r.result === 'win').length;
      const total = resultados.filter(r => r.result).length;
      const opsAtivas = activeOperations.size;
      if (total > 0) {
        process.stdout.write(`\r[⏱️] Ops: ${total} | Ativas: ${opsAtivas} | WR: ${((wins/total)*100).toFixed(0)}%   `);
      }
    }

  } catch (err) {
    console.error('[FATAL]', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log('\n\n🛑 Parando...');

  const wins = resultados.filter(r => r.result === 'win').length;
  const total = resultados.filter(r => r.result).length;

  if (total > 0) {
    console.log(`\n📊 RESULTADO FINAL:`);
    console.log(`   Total: ${total} | Wins: ${wins} | WR: ${((wins/total)*100).toFixed(1)}%`);

    // Por estratégia
    const byStrategy = {};
    for (const r of resultados.filter(r => r.result)) {
      if (!byStrategy[r.strategy]) byStrategy[r.strategy] = { wins: 0, total: 0 };
      byStrategy[r.strategy].total++;
      if (r.result === 'win') byStrategy[r.strategy].wins++;
    }

    console.log(`\n   Por estratégia:`);
    for (const [strat, stats] of Object.entries(byStrategy)) {
      console.log(`   - ${strat}: ${stats.wins}/${stats.total} (${(stats.wins/stats.total*100).toFixed(0)}%)`);
    }
  }

  process.exit(0);
});

main();
