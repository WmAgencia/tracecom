/**
 * OTC INTELLIGENCE AGENT
 * =======================
 *
 * Objetivo: Coletar dados de OTC e identificar padrões no comportamento
 * do algoritmo da IQ Option.
 *
 * Hipóteses a testar:
 * 1. Há viés direcional em horários específicos?
 * 2. Há padrões de reversão após sequences de X velas?
 * 3. O algoritmo segue médias móveis de algum período?
 * 4. Há correlação com volume de operações?
 *
 * Coleta: 24/7 até ter ~5000 velas por ativo
 */

import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration, normalizeCandle } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';

// Ativos OTC a monitorar
const OTC_ASSETS = [
  'EURUSD-op', 'GBPUSD-op', 'USDJPY-op',
  'AUDUSD-op', 'NZDUSD-op', 'USDCAD-op'
];

// Estado
const candleData = new Map(); // activeId -> array de velas
const volumeData = new Map();  // activeId -> array de {timestamp, direction, amount}
const startTime = Date.now();

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
  console.log(`[LOGIN] OK!\n`);
  return ssid;
}

// ============================================
// ANÁLISE DE PADRÕES
// ============================================
function analyzePatterns(candles) {
  if (candles.length < 50) return null;

  const closes = candles.map(c => c.close);
  const results = {
    consecutiveUp: 0,
    consecutiveDown: 0,
    maxConsecutiveUp: 0,
    maxConsecutiveDown: 0,
    reversalAfterN: { up: {}, down: {} },
    winRateAfterNUp: { 2: { up: 0, total: 0 }, 3: { up: 0, total: 0 }, 4: { up: 0, total: 0 }, 5: { up: 0, total: 0 } },
    winRateAfterNDown: { 2: { up: 0, total: 0 }, 3: { up: 0, total: 0 }, 4: { up: 0, total: 0 }, 5: { up: 0, total: 0 } },
  };

  let currentConsecutive = 0;
  let lastDirection = null;

  for (let i = 10; i < candles.length; i++) {
    const dir = candles[i].close > candles[i-1].close ? 'up' : 'down';

    if (dir === lastDirection) {
      currentConsecutive++;
    } else {
      if (lastDirection === 'up') {
        results.maxConsecutiveUp = Math.max(results.maxConsecutiveUp, currentConsecutive);
        if (currentConsecutive >= 2 && i < candles.length - 1) {
          const nextUp = candles[i].close > candles[i-1].close;
          results.winRateAfterNUp[Math.min(currentConsecutive, 5)][nextUp ? 'up' : 'total']++;
          results.winRateAfterNUp[Math.min(currentConsecutive, 5)].total++;
        }
      } else if (lastDirection === 'down') {
        results.maxConsecutiveDown = Math.max(results.maxConsecutiveDown, currentConsecutive);
        if (currentConsecutive >= 2 && i < candles.length - 1) {
          const nextUp = candles[i].close > candles[i-1].close;
          results.winRateAfterNDown[Math.min(currentConsecutive, 5)][nextUp ? 'up' : 'total']++;
          results.winRateAfterNDown[Math.min(currentConsecutive, 5)].total++;
        }
      }
      currentConsecutive = 1;
      lastDirection = dir;
    }
  }

  return results;
}

function printAnalysis(name, patterns, candles) {
  if (!patterns) return;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 ANÁLISE: ${name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Velas coletadas: ${candles.length}`);
  console.log(`\n📈 Sequências:`);
  console.log(`  Máx. consecutivas de ALTA: ${patterns.maxConsecutiveUp}`);
  console.log(`  Máx. consecutivas de BAIXA: ${patterns.maxConsecutiveDown}`);

  console.log(`\n🔄 Reversão após N velas de ALTA:`);
  for (const n of [2, 3, 4, 5]) {
    const stats = patterns.winRateAfterNUp[n];
    if (stats && stats.total > 0) {
      const wr = (stats.up / stats.total * 100).toFixed(1);
      const edge = (stats.up / stats.total - 0.5) * 100;
      console.log(`  ${n} velas ↑ →Próxima ALTA: ${wr}% (n=${stats.total}, edge=${edge > 0 ? '+' : ''}${edge.toFixed(1)}%)`);
    }
  }

  console.log(`\n🔄 Reversão após N velas de BAIXA:`);
  for (const n of [2, 3, 4, 5]) {
    const stats = patterns.winRateAfterNDown[n];
    if (stats && stats.total > 0) {
      const wr = (stats.up / stats.total * 100).toFixed(1);
      const edge = (stats.up / stats.total - 0.5) * 100;
      console.log(`  ${n} velas ↓ →Próxima ALTA: ${wr}% (n=${stats.total}, edge=${edge > 0 ? '+' : ''}${edge.toFixed(1)}%)`);
    }
  }

  // Análise de horário
  const byHour = {};
  for (const c of candles) {
    const hour = new Date(c.timestamp).getHours();
    if (!byHour[hour]) byHour[hour] = { up: 0, down: 0 };
    if (c.close > c.open) byHour[hour].up++;
    else byHour[hour].down++;
  }

  console.log(`\n🕐 Distribuição por hora (UTC):`);
  for (const [hour, stats] of Object.entries(byHour).sort((a, b) => a[0] - b[0])) {
    const total = stats.up + stats.down;
    if (total >= 10) {
      const wr = (stats.up / total * 100).toFixed(0);
      console.log(`  ${hour}h: ${stats.up}↑ / ${stats.down}↓ (${wr}% UP)`);
    }
  }
}

async function main() {
  try {
    const ssid = await login();
    const ws = new IqWsClient({ log: () => {} });

    ws.on('ready', async () => {
      console.log('[WS] Ready!');

      const initMsg = await ws.getInitializationData();
      const initData = initMsg?.msg ?? initMsg;
      const turboActives = initData?.turbo?.actives ?? {};

      // Filtrar apenas ativos OTC
      const assets = Object.entries(turboActives)
        .filter(([_, a]) => a.name && /otc/i.test(a.name))
        .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

      console.log(`[📋] ${assets.length} activos OTC monitorados`);
      console.log(`[📋] Ativos: ${assets.map(a => a.name).join(', ')}\n`);

      for (const asset of assets) {
        candleData.set(asset.activeId, []);
        ws.subscribeCandles(asset.activeId, 60);
      }

      console.log('[✅] INICIADO! Coletando dados OTC...\n');
      console.log('Pressione Ctrl+C para parar e analisar.\n');
    });

    ws.on('candle-generated', (msg) => {
      const raw = msg?.msg ?? msg;
      if (!raw) return;

      const aid = raw.active_id ?? raw.activeId ?? raw.id ?? raw.aid;
      if (!aid || !candleData.has(aid)) return;

      const buf = candleData.get(aid);
      try {
        const c = normalizeCandle(raw, { activeId: aid, serverTimestamp: ws?.serverNow(), connectionId: ws?.connectionId });
        c.timestamp = Date.now();
        const idx = buf.findIndex(x => x.segmentId === c.segmentId);
        if (idx >= 0) buf[idx] = c;
        else buf.push(c);
        if (buf.length > 10000) buf.shift();
      } catch { return; }

      // Mostrar contagem a cada 30s
      const elapsed = Math.floor((Date.now() - startTime) / 30000);
      if (elapsed > 0 && Date.now() % 30000 < 1000) {
        process.stdout.write(`\r[📊] Coleta: ${buf.length} velas | Tempo: ${Math.floor((Date.now() - startTime) / 60000)}min   `);
      }
    });

    await ws.connect({ ssid });

    // Loop de análise periódica
    let lastAnalysis = 0;
    while (true) {
      await new Promise(r => setTimeout(r, 60000)); // A cada minuto

      const now = Date.now();
      if (now - lastAnalysis > 300000) { // A cada 5 min
        for (const [aid, candles] of candleData) {
          const asset = Object.entries({}).find(([, a]) => a.activeId === aid)?.[1];
          const name = [...candleData.entries()].find(([k]) => k === aid)?.[0]?.toString() || `AID:${aid}`;
          const patterns = analyzePatterns(candles);
          if (patterns && candles.length >= 50) {
            printAnalysis(name, patterns, candles);
          }
        }
        lastAnalysis = now;

        // Salvar dados coletados
        const snapshot = {
          timestamp: new Date().toISOString(),
          candles: Object.fromEntries(candleData)
        };
        fs.writeFileSync('D:/Tracecom project/otc-intelligence/snapshot.json', JSON.stringify(snapshot));
        console.log(`\n💾 Snapshot salvo!`);
      }
    }

  } catch (err) {
    console.error('[FATAL]', err);
    process.exit(1);
  }
}

// Capturar Ctrl+C para análise final
process.on('SIGINT', () => {
  console.log('\n\n🛑 Parando coleta...\n');

  for (const [aid, candles] of candleData) {
    const patterns = analyzePatterns(candles);
    printAnalysis(`AID:${aid}`, patterns, candles);
  }

  // Salvar dados completos
  const fullData = {
    collectedAt: new Date().toISOString(),
    duration_minutes: Math.floor((Date.now() - startTime) / 60000),
    candles: Object.fromEntries(candleData)
  };

  fs.mkdirSync('D:/Tracecom project/otc-intelligence', { recursive: true });
  fs.writeFileSync('D:/Tracecom project/otc-intelligence/full-data.json', JSON.stringify(fullData, null, 2));
  console.log(`\n💾 Dados salvos em otc-intelligence/full-data.json`);
  process.exit(0);
});

main();
