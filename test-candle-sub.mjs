// Testa descobrir active_ids e subscriptions de candles
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

  // Captura TUDO que chega
  let msgCount = 0;
  ws.on('message', (msg) => {
    msgCount++;
    if (msgCount <= 30) {
      const preview = JSON.stringify(msg).slice(0, 200);
      console.log(`[${msgCount}] ${msg.name}: ${preview}`);
    }
  });

  ws.on('ready', async () => {
    console.log('\n[WS] Ready!');

    // Captura 'front' para ver a estrutura
    ws.on('front', (msg) => {
      console.log('\n[FRONT msg]:', typeof msg, JSON.stringify(msg).slice(0, 1000));
    });
  });

  await ws.connect({ ssid, timeoutMs: 30000 });

  // Espera 15s para ver todas as mensagens iniciais
  setTimeout(() => {
    console.log(`\nTotal msgs: ${msgCount}`);
    console.log('\n[FIM]');
    ws.close();
    process.exit(0);
  }, 15000);
}

main().catch(e => { console.error(e.message); process.exit(1); });
