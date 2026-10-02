/**
 * OTC BOT v5.1 - CORRIGIDO
 * ========================
 * Fixes vs v5:
 *  - Usa candles de 5s (size=5) — únicos que chegam distintos a cada update
 *  - Subscrição live funciona; histórico de OTC não
 *  - Detect de "3 velas na mesma direção" usa `at` (timestamp de update), não bucketStart
 *  - Mantém exatamente a mesma estratégia Fade3 + 5 ativos validados
 *
 * Estratégia:
 *  - Sei       → PUT  (62.7% WR, +12.7% edge)
 *  - USD-HKD  → CALL (57.4% WR, +7.4% edge)
 *  - Litecoin → PUT  (56.6% WR, +6.6% edge)
 *  - Polkadot → PUT  (55.5% WR, +5.5% edge)
 *  - USD-ZAR  → PUT  (55.1% WR, +5.1% edge)
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration, normalizeCandle } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';
const TRADE_AMOUNT = 2;            // R$2 por op (conservador)
const EXPIRATION_MIN = 1;          // expiração 1 minuto
const CANDLE_SIZE = 5;             // candles de 5s (chegam distintos a cada tick)
const MIN_CANDLES_FOR_SIGNAL = 3;  // 3 candles consecutivos
const COOLDOWN_MS = 65_000;        // espera o ciclo fechar antes de novo sinal no mesmo ativo
const DEDUP_MS = 500;              // descarta candles com mesmo `at` em <500ms

const VALIDATED_ASSETS = [
  { names: ['SEIUSD', 'Sei'], direction: 'PUT', wr: 62.7, edge: 12.7 },
  { names: ['USDHKD', 'USD-HKD'], direction: 'CALL', wr: 57.4, edge: 7.4 },
  { names: ['LTCUSD', 'Litecoin'], direction: 'PUT', wr: 56.6, edge: 6.6 },
  { names: ['DOTUSD', 'Polkadot'], direction: 'PUT', wr: 55.5, edge: 5.5 },
  { names: ['USDZAR', 'USD-ZAR'], direction: 'PUT', wr: 55.1, edge: 5.1 },
];

function getValidatedPattern(assetName) {
  for (const va of VALIDATED_ASSETS) {
    for (const name of va.names) {
      if (assetName.toUpperCase().includes(name.toUpperCase())) {
        return va;
      }
    }
  }
  return null;
}

// Buffer por ativo: lista de candles com `at` (ms) e `close`
// Candles de 5s chegam a cada 5s com `at` distinto — perfeito para detectar 3 consecutivas
const candleBuffer = new Map();
const activeOperations = new Map();
const resultados = [];

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

// Adiciona/atualiza candle no buffer respeitando `at` único (dedup)
function pushCandle(buf, raw, serverTimestamp) {
  const at = Number(raw.at ?? raw.timestamp);
  // Para 5s, raw.at vem em nanosegundos (1790728214000000000) ou já em ms?
  // Observado: 1790728214000000000 = 1.79e18 → nanosegundos
  let atMs;
  if (at > 1e15) atMs = Math.round(at / 1e6);
  else if (at > 1e12) atMs = Math.round(at);
  else atMs = at * 1000;

  // Dedup: se o último candle tem o mesmo `at`, ignora
  if (buf.ticks.length > 0 && Math.abs(buf.ticks[buf.ticks.length - 1].atMs - atMs) < DEDUP_MS) {
    return false;
  }

  const close = Number(raw.close);
  if (!Number.isFinite(close)) return false;

  buf.ticks.push({ atMs, close });
  // mantém últimos 100 ticks
  if (buf.ticks.length > 100) buf.ticks.shift();
  return true;
}

// Detecta Fade3: 3 velas consecutivas na mesma direção
function getSignal(buf, assetName) {
  const validated = getValidatedPattern(assetName);
  if (!validated) return null;
  if (buf.ticks.length < MIN_CANDLES_FOR_SIGNAL) return null;

  const t = buf.ticks;
  const last3 = t.slice(-3);

  // Candles devem ser razoavelmente recentes (todos nos últimos 30s)
  const now = Date.now();
  if (now - last3[last3.length - 1].atMs > 30_000) return null;

  const a = last3[0].close < last3[1].close; // subiu
  const b = last3[1].close < last3[2].close; // subiu

  if (a && b && validated.direction === 'PUT') {
    return { signal: 'PUT', strategy: 'FADE3', expected: validated.wr, edge: validated.edge };
  }
  if (!a && !b && validated.direction === 'CALL') {
    return { signal: 'CALL', strategy: 'FADE3', expected: validated.wr, edge: validated.edge };
  }
  return null;
}

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
      console.log(`📊 BOT v5.1 - 5 ATIVOS (candles ${CANDLE_SIZE}s)`);
      console.log('='.repeat(60));
      console.log('\n📋 Padrões históricos:');
      for (const va of VALIDATED_ASSETS) {
        console.log(`   ${va.names[0].padEnd(15)} → ${va.direction.padEnd(4)} (WR: ${va.wr}%, Edge: +${va.edge}%)`);
      }
      console.log('');

      const allAssets = Object.entries(turboActives)
        .filter(([_, a]) => a.name && /otc/i.test(a.name))
        .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

      let foundCount = 0;
      for (const asset of allAssets) {
        const pattern = getValidatedPattern(asset.name);
        if (pattern) {
          candleBuffer.set(asset.activeId, { ticks: [], asset, pattern });
          ws.subscribeCandles(asset.activeId, CANDLE_SIZE);
          foundCount++;
          console.log(`[✅] ${asset.name} → ${pattern.direction} (size=${CANDLE_SIZE}s)`);
        }
      }

      console.log(`\n[📋] ${foundCount}/5 ativos encontrados`);
      console.log('[⏳] Warmup 20s...\n');

      await new Promise(r => setTimeout(r, 20_000));
      warmupEndTime = Date.now();
      console.log('[✅] INICIADO! Aguardando sinais...\n');
    });

    ws.on('candle-generated', (msg) => {
      const raw = msg?.msg ?? msg;
      if (!raw) return;

      const aid = raw.active_id ?? raw.activeId ?? raw.id ?? raw.aid;
      if (!aid || !candleBuffer.has(aid)) return;

      const buf = candleBuffer.get(aid);
      pushCandle(buf, raw, ws.serverNow());

      // Cooldown após abrir op
      const op = activeOperations.get(aid);
      if (op && (Date.now() - op.openedAt) < COOLDOWN_MS) return;

      if (!warmupEndTime || Date.now() < warmupEndTime) return;

      const result = getSignal(buf, buf.asset.name);
      if (!result) return;

      const { expiration, optionTypeId } = computeExpiration(
        Math.floor((ws.serverNow() ?? Date.now()) / 1000),
        EXPIRATION_MIN
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
        edge: result.edge,
        openedAt: Date.now()
      });

      console.log(`[📊 ${buf.asset.name}] ${result.signal} (WR:${result.expected}% edge:+${result.edge}%) @ R$${TRADE_AMOUNT}`);
      resultados.push({
        active: buf.asset.name,
        direction: result.signal,
        expected: result.expected,
        edge: result.edge,
        price: TRADE_AMOUNT,
        timestamp: new Date().toISOString()
      });
      fs.writeFileSync('D:/Tracecom project/resultados-v5.json', JSON.stringify(resultados, null, 2));
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

      console.log(`[${emoji}] ${op.name} | ${op.direction} | Esperado:${op.expected}% | Edge:+${op.edge}% | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}`);

      const idx = resultados.findIndex(r => r.active === op.name && !r.result);
      if (idx >= 0) {
        resultados[idx].result = result;
        resultados[idx].profit = profit;
        fs.writeFileSync('D:/Tracecom project/resultados-v5.json', JSON.stringify(resultados, null, 2));
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

    // Heartbeat / status
    setInterval(() => {
      const wins = resultados.filter(r => r.result === 'win').length;
      const total = resultados.filter(r => r.result).length;
      if (total > 0) {
        process.stdout.write(`\r[⏱️ ${new Date().toLocaleTimeString()}] Ops: ${total} | WR: ${((wins/total)*100).toFixed(0)}%   `);
      }
    }, 5000);

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
      if (!byActive[r.active]) byActive[r.active] = { wins: 0, total: 0, profit: 0, expected: r.expected };
      byActive[r.active].total++;
      if (r.result === 'win') byActive[r.active].wins++;
      byActive[r.active].profit += r.profit || 0;
    }
    for (const [name, stats] of Object.entries(byActive)) {
      const wr = (stats.wins/stats.total*100).toFixed(0);
      console.log(`   ${name}: ${stats.wins}/${stats.total} (${wr}%) | R$${stats.profit.toFixed(2)} | Esperado: ${stats.expected}%`);
    }
  }

  fs.writeFileSync('D:/Tracecom project/resultados-v5-final.json', JSON.stringify(resultados, null, 2));
  process.exit(0);
});

main();
