// Obter instrumentos digitais reais da IQ
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

  // Tentar obter instrumentos disponíveis para EURUSD-OTC (active_id=76)
  const activeId = 76;

  // 1. Digital instruments
  const res1 = await httpReq({
    hostname: 'iqoption.com', path: `/api/financial-services/instruments/digital/${activeId}/5`, method: 'GET',
    headers: {
      'Authorization': `Bearer ${ssid}`,
      'XRequestedWith': 'XMLHttpRequest',
      'Origin': 'https://iqoption.com',
      'Referer': 'https://iqoption.com/'
    }
  });
  console.log('Digital instruments:', res1.body?.slice(0, 500));

  // 2. Get server time
  const res2 = await httpReq({
    hostname: 'iqoption.com', path: '/api/presenter/result/getServerTimestamp', method: 'GET',
    headers: {
      'Authorization': `Bearer ${ssid}`,
      'XRequestedWith': 'XMLHttpRequest',
      'Origin': 'https://iqoption.com',
      'Referer': 'https://iqoption.com/'
    }
  });
  console.log('Server time:', res2.body?.slice(0, 200));

  // 3. Get user profile
  const res3 = await httpReq({
    hostname: 'api.iqoption.com', path: '/api/v2/profile', method: 'GET',
    headers: {
      'Authorization': ssid,
      'Origin': 'https://iqoption.com',
      'Referer': 'https://iqoption.com/'
    }
  });
  console.log('Profile:', res3.body?.slice(0, 500));

  // 4. Tentar OTCD get offer
  const offerRes = await httpReq({
    hostname: 'iqoption.com', path: `/api/financial-services/instruments/otc`, method: 'GET',
    headers: {
      'Authorization': `Bearer ${ssid}`,
      'XRequestedWith': 'XMLHttpRequest',
      'Origin': 'https://iqoption.com',
      'Referer': 'https://iqoption.com/'
    }
  });
  console.log('OTC offer:', offerRes.body?.slice(0, 500));

  // 5. Get available assets
  const assetsRes = await httpReq({
    hostname: 'api.iqoption.com', path: '/api/v2/available-countries', method: 'GET',
    headers: {
      'Authorization': ssid,
      'Origin': 'https://iqoption.com',
      'Referer': 'https://iqoption.com/'
    }
  });
  console.log('Available countries:', assetsRes.body?.slice(0, 500));
}

main().catch(e => console.error('ERRO:', e.message));
