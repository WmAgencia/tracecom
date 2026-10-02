// Descobre o endpoint correto de opções ativas
import https from 'https';

function httpReq(options, postData = null) {
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

async function main() {
  const AUTH_HOST = 'api.iqoption.com';
  const API_HOST  = 'iqoption.com';

  // Login
  const loginData = JSON.stringify({ identifier: 'Anaalaura2008@gmail.com', password: 'Eqvpanp.32' });
  const loginRes = await httpReq({
    hostname: AUTH_HOST, path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData), 'Origin': 'https://iqoption.com' },
  }, loginData);
  const ssid = JSON.parse(loginRes.body).result?.ssid ?? JSON.parse(loginRes.body).ssid;
  console.log('[✅] Login OK, SSID:', ssid.slice(0, 10) + '...');

  // Testa vários paths
  const paths = [
    '/api/options/active',
    '/api/v2/options/active',
    '/api/v1/options/active',
    '/api/options',
    '/api/v2/options',
    '/api/v2/options/active/list',
    '/api/v2/options/active/list',
    '/api/binary-options/active',
    '/api/options/v2/active',
    '/api/v1/options',
    '/api/profile/balance',
    '/api/balance',
  ];

  for (const p of paths) {
    const r = await httpReq({
      hostname: API_HOST, path: p, method: 'GET',
      headers: { 'Authorization': `Bearer ${ssid}`, 'Origin': 'https://iqoption.com' },
    });
    console.log(`${p.padEnd(30)} → ${r.status} ${r.body.slice(0, 100)}`);
  }
}

main().catch(e => { console.error('[ERRO]', e.message); process.exit(1); });
