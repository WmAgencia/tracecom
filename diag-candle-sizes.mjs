/**
 * Diagnóstico: descobrir tamanhos de candle aceitos por cada ativo OTC
 */
import https from 'https';
import { IqWsClient } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';

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

async function main() {
  const ssid = await login();
  console.log('[LOGIN] OK\n');

  const ws = new IqWsClient({ log: () => {} });

  ws.on('ready', async () => {
    console.log('[WS] Ready!\n');

    const initMsg = await ws.getInitializationData();
    const initData = initMsg?.msg ?? initMsg;
    const turboActives = initData?.turbo?.actives ?? {};

    // Filtrar os 5 ativos-alvo
    const targets = ['SEIUSD', 'USDHKD', 'LTCUSD', 'DOTUSD', 'USDZAR'];
    const allAssets = Object.entries(turboActives)
      .filter(([_, a]) => a.name && /otc/i.test(a.name))
      .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

    console.log('='.repeat(70));
    console.log('🔍 TESTANDO TAMANHOS DE CANDLE PARA CADA ATIVO OTC');
    console.log('='.repeat(70) + '\n');

    const sizes = [5, 10, 15, 30, 60, 120, 300];

    for (const asset of allAssets) {
      const isTarget = targets.some(t => asset.name.toUpperCase().includes(t));
      if (!isTarget) continue;

      console.log(`📊 ${asset.name} (id=${asset.activeId})`);
      for (const size of sizes) {
        try {
          const candles = await ws.getCandlesHistory({
            activeId: asset.activeId,
            size,
            count: 3,
            timeoutMs: 5000
          });
          const msg = candles?.msg ?? candles;
          const arr = Array.isArray(msg?.candles) ? msg.candles : [];
          if (arr.length > 0) {
            console.log(`   ✅ size=${size}s → ${arr.length} candles (último close=${arr[arr.length-1].close})`);
          } else {
            console.log(`   ❌ size=${size}s → 0 candles`);
          }
        } catch (e) {
          console.log(`   ⚠️  size=${size}s → TIMEOUT/ERRO`);
        }
      }
      console.log('');
    }

    // Testar também subscrição live com cada tamanho
    console.log('='.repeat(70));
    console.log('🔴 TESTANDO SUBSCRIÇÃO LIVE (candle-generated)');
    console.log('='.repeat(70) + '\n');

    const targetAsset = allAssets.find(a => a.name.toUpperCase().includes('USDHKD'));
    if (targetAsset) {
      console.log(`Testando ${targetAsset.name} com diferentes sizes...\n`);

      for (const size of sizes) {
        console.log(`   Subscrevendo size=${size}s...`);
        let count = 0;
        const onCandle = (msg) => {
          const raw = msg?.msg ?? msg;
          if (raw && Number(raw.active_id ?? raw.activeId) === targetAsset.activeId) {
            count++;
          }
        };
        ws.on('candle-generated', onCandle);
        ws.subscribeCandles(targetAsset.activeId, size);

        await new Promise(r => setTimeout(r, 7000));

        ws.removeListener('candle-generated', onCandle);
        console.log(`      → ${count} candles recebidos em 7s\n`);
      }
    }

    ws.close();
    process.exit(0);
  });

  await ws.connect({ ssid });
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
