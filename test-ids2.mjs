// Descobre IDs dos ativos OTC via candle close price
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
  const ssid = j.ssid;
  console.log('Login OK');

  const ws = new IqWsClient({ hosts: ['iqoption.com'], log: () => {} });

  ws.on('ready', async () => {
    console.log('WS Ready - testando IDs...');
    // IDs a testar (do range que deu certo)
    // RENDERUSD já sabemos = 76
    const testIds = [70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95];
    const results = {};

    for (const id of testIds) {
      try {
        const r = await ws.getCandlesHistory({ activeId: id, size: 5, count: 1 });
        if (r?.msg?.candles?.length > 0) {
          const c = r.msg.candles[0];
          results[id] = {
            close: c.close,
            open: c.open,
            high: c.max,
            low: c.min,
            from: new Date(c.from * 1000).toISOString(),
            to: new Date(c.to * 1000).toISOString(),
          };
        }
      } catch {}
    }

    console.log('\n=== Resultados ===');
    for (const [id, data] of Object.entries(results)) {
      console.log(`ID ${id}: close=${data.close} range=${data.low?.toFixed(4)}-${data.high?.toFixed(4)}`);
    }

    // Salva num arquivo para referência
    const fs = await import('fs');
    fs.writeFileSync('D:/Tracecom project/active-ids.json', JSON.stringify(results, null, 2));
    console.log('\nSalvo em active-ids.json');

    ws.close();
    process.exit(0);
  });

  await ws.connect({ ssid, timeoutMs: 60000 });
}

main().catch(e => { console.error(e.message); process.exit(1); });
