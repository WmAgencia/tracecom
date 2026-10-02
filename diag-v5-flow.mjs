/**
 * Debug do ws-otc-v5 - comparar candles recebidos via subscription
 */
import https from 'https';
import { IqWsClient, normalizeCandle } from './iqoption-ws.mjs';

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
  return json.result?.ssid ?? json.ssid;
}

async function main() {
  const ssid = await login();
  console.log('[LOGIN] OK\n');

  const ws = new IqWsClient({ log: () => {} });

  let candleCount = 0;
  let candleError = 0;
  let firstFew = [];

  ws.on('ready', async () => {
    console.log('[WS] Ready!\n');

    // Pegar init data
    const initMsg = await ws.getInitializationData();
    const initData = initMsg?.msg ?? initMsg;
    const turboActives = initData?.turbo?.actives ?? {};
    const targetAsset = Object.entries(turboActives)
      .find(([_, a]) => a.name && /USDHKD/i.test(a.name) && /otc/i.test(a.name));

    if (!targetAsset) {
      console.log('Ativo não encontrado');
      process.exit(1);
    }

    const [id, act] = targetAsset;
    const activeId = Number(id);
    console.log(`📊 Ativo: ${act.name} (id=${activeId})\n`);

    // Escutar TODOS os eventos
    ws.on('message', (m) => {
      // console.log('MSG:', JSON.stringify(m).slice(0, 200));
    });

    ws.on('candle-generated', (msg) => {
      candleCount++;
      const raw = msg?.msg ?? msg;
      if (firstFew.length < 3) {
        firstFew.push(JSON.stringify(raw));
      }

      // Tentar normalizar exatamente como o v5 faz
      try {
        const c = normalizeCandle(raw, {
          activeId,
          serverTimestamp: ws.serverNow(),
          connectionId: ws.connectionId
        });
        console.log(`✅ candle ${candleCount}: close=${c.close}, segmentId=${c.segmentId}`);
      } catch (e) {
        candleError++;
        console.log(`❌ candle ${candleCount} ERRO ao normalizar: ${e.code} - ${e.message}`);
        if (candleError <= 3) {
          console.log(`   Raw:`, JSON.stringify(raw).slice(0, 300));
        }
      }
    });

    // Subscribe como o v5 faz
    console.log(`Subscrevendo activeId=${activeId}, size=60...\n`);
    ws.subscribeCandles(activeId, 60);

    await new Promise(r => setTimeout(r, 20000));

    console.log(`\n📊 RESUMO:`);
    console.log(`   Total recebido: ${candleCount}`);
    console.log(`   Erros normalize: ${candleError}`);

    if (firstFew.length > 0) {
      console.log(`\nPrimeiros candles raw:`);
      firstFew.forEach((f, i) => console.log(`  ${i+1}: ${f}`));
    }

    ws.close();
    process.exit(0);
  });

  await ws.connect({ ssid });
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
