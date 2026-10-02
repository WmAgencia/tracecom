// Testa endpoints HTTP com diferentes auth methods
import https from 'https';

function httpReq(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = ''; res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 500) }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function main() {
  const AUTH_HOST = 'api.iqoption.com';
  const API_HOST  = 'iqoption.com';

  const loginData = JSON.stringify({ identifier: 'Anaalaura2008@gmail.com', password: 'Eqvpanp.32' });
  const loginRes = await httpReq({
    hostname: AUTH_HOST, path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData), 'Origin': 'https://iqoption.com' },
  }, loginData);
  const j = JSON.parse(loginRes.body);
  const ssid = j.ssid ?? j.result?.ssid;
  console.log('Login OK, SSID:', ssid.slice(0, 10));

  const tests = [
    // Cookie approach
    { host: API_HOST, path: '/api/options/active', method: 'GET', auth: `Cookie: ssoid=${ssid}` },
    { host: API_HOST, path: '/api/v2/options/active', method: 'GET', auth: `Cookie: ssoid=${ssid}` },
    // Bearer approach
    { host: API_HOST, path: '/api/options/active', method: 'GET', auth: `Authorization: Bearer ${ssid}` },
    { host: API_HOST, path: '/api/v2/options/active', method: 'GET', auth: `Authorization: Bearer ${ssid}` },
    // Com Origin e Referer
    { host: API_HOST, path: '/api/options/active', method: 'GET', auth: `Authorization: Bearer ${ssid}`, origin: 'https://iqoption.com' },
    // Cookie + Referer
    { host: API_HOST, path: '/api/options/active', method: 'GET', auth: `Cookie: ssoid=${ssid}`, origin: 'https://iqoption.com', referer: 'https://iqoption.com/' },
    // Tentativas alternativas
    { host: API_HOST, path: '/api/v1/options/active', method: 'GET', auth: `Authorization: Bearer ${ssid}` },
    { host: API_HOST, path: '/api/binary/options/active', method: 'GET', auth: `Authorization: Bearer ${ssid}` },
    // Balance como referência (funciona no WS)
    { host: API_HOST, path: '/api/balance', method: 'GET', auth: `Authorization: Bearer ${ssid}` },
  ];

  for (const t of tests) {
    const headers = { 'Authorization': '', 'Cookie': '', 'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' };
    if (t.auth.startsWith('Cookie')) headers['Cookie'] = t.auth;
    else if (t.auth.startsWith('Authorization')) headers['Authorization'] = t.auth;
    if (t.origin) headers['Origin'] = t.origin;
    if (t.referer) headers['Referer'] = t.referer;

    const r = await httpReq({
      hostname: t.host, path: t.path, method: t.method,
      headers,
    });
    const marker = r.status === 200 ? '✅' : '❌';
    console.log(`${marker} ${t.host}${t.path} [${t.method}] [${t.auth.split(' ')[0]}] → ${r.status} ${r.body}`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
