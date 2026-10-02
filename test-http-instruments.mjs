// Obter instrumentos digitais via HTTP API
import https from 'https';
import CONFIG from './bot-config-v13.json' with { type: 'json' };

const LOGIN = CONFIG.login;

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

async function loginIQ() {
  const data = JSON.stringify({ identifier: LOGIN.email, password: LOGIN.password });
  const res = await httpReq({
    hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' },
  }, data);
  const j = JSON.parse(res.body);
  return j.ssid ?? j.result?.ssid;
}

async function main() {
  console.log('Login...');
  const ssid = await loginIQ();
  console.log('Logado!');

  // Tentar diferentes endpoints de instrumentos
  const endpoints = [
    `/api/v2/financial-services/instruments/digital/76/5`,
    `/api/financial-services/instruments/digital/76/5`,
    `/api/v2/instruments/digital/76`,
    `/api/v2/get-instruments/76`,
    `/api/v2/available-instruments/digital/76/5`,
  ];

  for (const endpoint of endpoints) {
    const res = await httpReq({
      hostname: 'iqoption.com', path: endpoint, method: 'GET',
      headers: {
        'Authorization': `Bearer ${ssid}`,
        'XRequestedWith': 'XMLHttpRequest',
        'Origin': 'https://iqoption.com',
        'Referer': 'https://iqoption.com/'
      }
    });
    console.log(`\n[${endpoint}] status=${res.status} body=${res.body?.slice(0, 300)}`);
  }

  // Tentar API OTP OTC
  const otcRes = await httpReq({
    hostname: 'iqoption.com', path: '/api/financial-services/instruments/otc', method: 'GET',
    headers: {
      'Authorization': `Bearer ${ssid}`,
      'XRequestedWith': 'XMLHttpRequest',
      'Origin': 'https://iqoption.com',
      'Referer': 'https://iqoption.com/'
    }
  });
  console.log(`\n[OTC] status=${otcRes.status} body=${otcRes.body?.slice(0, 300)}`);

  // get-user-profile
  const profileRes = await httpReq({
    hostname: 'iqoption.com', path: '/api/v2/user/profile', method: 'GET',
    headers: {
      'Authorization': `Bearer ${ssid}`,
      'XRequestedWith': 'XMLHttpRequest',
      'Origin': 'https://iqoption.com',
      'Referer': 'https://iqoption.com/'
    }
  });
  console.log(`\n[Profile] status=${profileRes.status} body=${profileRes.body?.slice(0, 500)}`);
}

main().catch(e => console.error('ERRO:', e.message));
