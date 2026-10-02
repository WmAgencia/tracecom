/**
 * OTC INTELLIGENCE BOT v4 - ATIVOS VALIDADOS (Nomes IQ Option)
 * ============================================================
 *
 * Ativos validados (nomes IQ Option):
 * - USDINR-OTC  → PUT  (57.6%, 276 trades, edge +7.6%)
 * - USDSGD-OTC  → CALL (59.7%, 238 trades, edge +9.7%)
 * - USDZAR-OTC  → PUT  (46.3%... deixar de fora, não tem edge)
 *
 * Padrão: Fade3 (contra 3 velas consecutivas)
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration, normalizeCandle } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';
const TRADE_AMOUNT = 100;
const EXPIRATION = 1;

// Ativos validados - nomes IQ Option
const VALIDATED_PATTERNS = [
  { pattern: 'USDINR', direction: 'PUT', wr: 57.6, trades: 276 },
  { pattern: 'USDSGD', direction: 'CALL', wr: 59.7, trades: 238 },
];

function getValidatedPattern(assetName) {
  for (const vp of VALIDATED_PATTERNS) {
    if (assetName.toUpperCase().includes(vp.pattern.toUpperCase())) {
      return vp;
    }
  }
  return null;
}

function getSignal(candles, assetName) {
  if (!candles || candles.length < 5) return null;

  const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && isFinite(v));
  if (closes.length < 5) return null;

  const validated = getValidatedPattern(assetName);
  if (!validated) return null;

  const a = closes[closes.length - 1] > closes[closes.length - 2];
  const b = closes[closes.length - 2] > closes[closes.length - 3];
  const c = closes[closes.length - 3] > closes[closes.length - 4];

  if (a && b && c && validated.direction === 'PUT') {
    return { signal: 'PUT', strategy: 'FADE3', expected: validated.wr };
  }
  if (!a && !b && !c && validated.direction === 'CALL') {
    return { signal: 'CALL', strategy: 'FADE3', expected: validated.wr };
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
  const data = JSON.stringify({ identifier: EMAIL, password: PASSWORD });
  const res = await httpRequest({
    hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
      'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' }
  }, data);
  const json = JSON.parse(res.body);
  const ssid = json.result?.ssid ?? json.ssid;
  if (!ssid) throw new Error('Login falhou');
  return ssid;
}

let resultados = [];
const candleBuffer = new Map();
const activeOperations = new Map();

async function main() {
  try {
    const ssid = await login();
    console.log('[LOGIN] OK!\n');

    const ws = new IqWsClient({ log: () => {} });
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

      const initMsg = await ws.getInitializationData();
      const initData = initMsg?.msg ?? initMsg;
      const turboActives = initData?.turbo?.actives ?? {};

      console.log('='.repeat(60));
      console.log('📊 ESTRATÉGIA: FADE3 - ATIVOS VALIDADOS');
      console.log('='.repeat(60));
      console.log('\n📋 Padrões históricos:');
      for (const vp of VALIDATED_PATTERNS) {
        console.log(`   ${vp.pattern.padEnd(15)} → ${vp.direction.padEnd(4)} (WR: ${vp.wr}%, n=${vp.trades})`);
      }
      console.log('');

      // Filtrar OTC que correspondem
      const allAssets = Object.entries(turboActives)
        .filter(([_, a]) => a.name && /otc/i.test(a.name))
        .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

      let foundCount = 0;
      for (const asset of allAssets) {
        const pattern = getValidatedPattern(asset.name);
        if (pattern) {
          candleBuffer.set(asset.activeId, { candles: [], asset, pattern });
          ws.subscribeCandles(asset.activeId, 60);
          foundCount++;
          console.log(`[✅] ${asset.name} → ${pattern.direction} (esperado: ${pattern.wr}%)`);
        }
      }

      if (foundCount === 0) {
        console.log('[⚠️] Nenhum ativo válido encontrado!');
      }

      console.log(`\n[📋] ${foundCount}/${VALIDATED_PATTERNS.length} ativos encontrados`);
      console.log('[⏳] Warmup 60s...\n');

      await new Promise(r => setTimeout(r, 60_000));
      warmupEndTime = Date.now();
      console.log('[✅] INICIADO! Aguardando sinais...\n');
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

      const { expiration, optionTypeId } = computeExpiration(
        Math.floor((ws.serverNow() ?? Date.now()) / 1000),
        EXPIRATION
      );

      ws.placeOrder({
        price: TRADE_AMOUNT,
        activeId: aid,
        direction: result.signal,
        expiration,
        optionTypeId,
        balanceId
      });

      activeOperations.set(aid, {
        name: buf.asset.name,
        direction: result.signal,
        expected: result.expected,
        openedAt: Date.now()
      });

      console.log(`[📊 ${buf.asset.name}] ${result.signal} (esperado: ${result.expected}%)`);
      resultados.push({
        active: buf.asset.name,
        direction: result.signal,
        expected: result.expected,
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

      console.log(`[${emoji}] ${op.name} | ${op.direction} | Esperado:${op.expected}% | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}`);

      const idx = resultados.findIndex(r => r.active === op.name && !r.result);
      if (idx >= 0) {
        resultados[idx].result = result;
        resultados[idx].profit = profit;
        fs.writeFileSync('D:/Tracecom project/resultados-otc-v3.json', JSON.stringify(resultados, null, 2));
      }

      activeOperations.delete(aid);

      const wins = resultados.filter(r => r.result === 'win').length;
      const total = resultados.filter(r => r.result).length;
      if (total > 0) {
        const wr = ((wins / total) * 100).toFixed(1);
        const profitTotal = resultados.reduce((s, r) => s + (r.profit || 0), 0);
        console.log(`[📈] Total: ${total} | Wins: ${wins} | WR: ${wr}% | Lucro: R$${profitTotal.toFixed(2)}\n`);
      }
    });

    await ws.connect({ ssid });

    while (true) {
      await new Promise(r => setTimeout(r, 5000));
      const wins = resultados.filter(r => r.result === 'win').length;
      const total = resultados.filter(r => r.result).length;
      if (total > 0) {
        process.stdout.write(`\r[⏱️ ${new Date().toLocaleTimeString()}] Ops: ${total} | WR: ${((wins/total)*100).toFixed(0)}%   `);
      }
    }

  } catch (err) {
    console.error('[FATAL]', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log('\n\n🛑 RESULTADO FINAL:\n');
  const wins = resultados.filter(r => r.result === 'win').length;
  const total = resultados.filter(r => r.result).length;

  if (total > 0) {
    console.log(`📊 Total: ${total} | Wins: ${wins} | WR: ${((wins/total)*100).toFixed(1)}%`);
    console.log(`💰 Lucro: R$${resultados.reduce((s, r) => s + (r.profit || 0), 0).toFixed(2)}`);

    console.log('\n📋 Por ativo:');
    const byActive = {};
    for (const r of resultados.filter(r => r.result)) {
      if (!byActive[r.active]) byActive[r.active] = { wins: 0, total: 0, profit: 0 };
      byActive[r.active].total++;
      if (r.result === 'win') byActive[r.active].wins++;
      byActive[r.active].profit += r.profit || 0;
    }
    for (const [name, stats] of Object.entries(byActive)) {
      console.log(`   ${name}: ${stats.wins}/${stats.total} (${(stats.wins/stats.total*100).toFixed(0)}%) | R$${stats.profit.toFixed(2)}`);
    }
  }

  fs.writeFileSync('D:/Tracecom project/resultados-otc-v3-final.json', JSON.stringify(resultados, null, 2));
  process.exit(0);
});

main();
