// Descobre IDs numéricos para ativos OTC
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

const ASSETS = {
  'RENDERUSD': 'front.RENDERUSD-OTC',
  'WIFUSD': 'front.WIFUSD-OTC',
  'DOTUSD': 'front.DOTUSD-OTC',
  'SUIUSD': 'front.SUIUSD-OTC',
  'XPTUSD': 'front.XPTUSD-OTC',
  'ORDIUSD': 'front.ORDIUSD-OTC',
  'HYPE': 'front.HYPE-OTC',
  'TRON': 'front.TRON-OTC',
  'SHIBUSD': 'front.SHIBUSD-OTC',
  'RAYDIUMUSD': 'front.RAYDIUMUSD-OTC',
};

async function main() {
  const loginData = JSON.stringify({ identifier: 'Anaalaura2008@gmail.com', password: 'Eqvpanp.32' });
  const loginRes = await httpReq({
    hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData), 'Origin': 'https://iqoption.com' },
  }, loginData);
  const j = JSON.parse(loginRes.body);
  const ssid = j.ssid;
  console.log('Login OK');

  const ws = new IqWsClient({ hosts: ['iqoption.com'], log: () => {} });

  ws.on('ready', async () => {
    console.log('WS Ready - buscando candles...');
    const nowSec = Math.floor(Date.now() / 1000);
    const found = {};

    // Busca candles para IDs 70-200 sequencialmente
    for (let id = 70; id <= 200; id++) {
      try {
        const result = await ws.getCandlesHistory({ activeId: id, size: 5, count: 1 });
        if (result?.msg?.candles?.length > 0) {
          const c = result.msg.candles[0];
          console.log(`ID ${id}: OK (candle close=${c.close})`);
          found[id] = c;
        }
      } catch {
        // timeout ou erro
      }
    }

    console.log('\n=== IDs encontrados ===');
    for (const [id, candle] of Object.entries(found)) {
      console.log(`ID ${id}: close=${candle.close}`);
    }

    ws.close();
    process.exit(0);
  });

  await ws.connect({ ssid, timeoutMs: 60000 });
}

main().catch(e => { console.error(e.message); process.exit(1); });
