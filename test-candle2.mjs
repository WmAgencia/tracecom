// Testa订阅 candles com active_id numérico vs string
import { IqWsClient } from './iqoption-ws.mjs';
import https from 'https';

function httpReq(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = ''; res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function main() {
  const loginData = JSON.stringify({ identifier: 'Anaalaura2008@gmail.com', password: 'Eqvpanp.32' });
  const loginRes = await httpReq({
    hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData), 'Origin': 'https://iqoption.com' },
  }, loginData);
  const j = JSON.parse(loginRes.body);
  const ssid = j.ssid ?? j.result?.ssid;
  console.log('Login OK, SSID:', ssid.slice(0, 8));

  const ws = new IqWsClient({ hosts: ['iqoption.com'], log: () => {} });

  // Captura TUDO
  let msgCount = 0;
  ws.on('message', (msg) => {
    msgCount++;
    const preview = JSON.stringify(msg).slice(0, 150);
    console.log(`[MSG ${msgCount}] ${msg.name}: ${preview}`);
  });

  ws.on('ready', async () => {
    console.log('\n[WS] Ready! Enviando subscription...\n');

    // Testa订阅 com formato correto
    ws.send("subscribeMessage", {
      name: "candle-generated",
      params: {
        routingFilters: {
          active_id: "RENDERUSD",  // só o nome do asset
          size: 5
        }
      }
    });
    console.log('[ENVIADO] subscribeMessage com active_id: RENDERUSD (só nome)');
  });

  await ws.connect({ ssid, timeoutMs: 30000 });

  setTimeout(() => {
    console.log(`\nTotal msgs: ${msgCount}`);
    ws.close();
    process.exit(0);
  }, 15000);
}

main().catch(e => { console.error(e.message); process.exit(1); });
