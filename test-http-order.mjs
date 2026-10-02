// Teste via API HTTP
import https from 'https';
import CONFIG from './bot-config-v13.json' with { type: 'json' };

const LOGIN = CONFIG.login;

function apiReq(path, method, body, ssid) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ssid}`,
      'Origin': 'https://iqoption.com',
      'Referer': 'https://iqoption.com/'
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const options = {
      hostname: 'iqoption.com',
      path: path,
      method: method,
      headers: headers
    };

    const req = https.request(options, res => {
      let responseBody = '';
      res.on('data', d => responseBody += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(responseBody) });
        } catch {
          resolve({ status: res.statusCode, body: responseBody });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('Login...');

  // Login via HTTP
  const loginRes = await apiReq('/v2/login', 'POST', { identifier: LOGIN.email, password: LOGIN.password });
  console.log('Login status:', loginRes.status);

  const ssid = loginRes.body.ssid ?? loginRes.body.result?.ssid;
  if (!ssid) {
    console.log('Login falhou:', JSON.stringify(loginRes.body));
    return;
  }
  console.log('Logado! ssid:', ssid.slice(0, 20) + '...');

  // Obter perfil/balances
  const profileRes = await apiReq('/api/v2/profile', 'GET', null, ssid);
  console.log('Profile:', JSON.stringify(profileRes.body).slice(0, 200));

  const balances = profileRes.body?.balances ?? [];
  const mainBal = balances.find(b => Number(b.amount) > 0) ?? balances[0];
  const balanceId = mainBal?.id;
  console.log(`Saldo: ${mainBal?.currency} $${mainBal?.amount} (id: ${balanceId})`);

  if (!balanceId) {
    console.log('ERRO: Não encontrou balance');
    return;
  }

  // Obter informações do ativo
  const assetRes = await apiReq(`/api/v2/iqoption/actives`, 'GET', null, ssid);
  console.log('Assets:', JSON.stringify(assetRes.body).slice(0, 500));

  // Tentar colocar ordem
  console.log('\nTentando colocar ordem via HTTP...');

  // O endpoint de order é diferente - vamos ver se existe
  // GET /api/v2/spot/digital-options/actives
  // POST /api/v2/buy/validate
  // POST /api/v2/buy

  const orderData = {
    amount: 2,
    active_id: 76,
    direction: 'call',
    option_type: 'turbo',
    expires: 120, // 2 minutos em segundos
    balance_id: Number(balanceId)
  };

  console.log('Order data:', JSON.stringify(orderData));

  const buyRes = await apiReq('/api/v2/buy', 'POST', orderData, ssid);
  console.log('Buy response:', JSON.stringify(buyRes).slice(0, 500));
}

main().catch(e => console.error('ERRO:', e.message));
